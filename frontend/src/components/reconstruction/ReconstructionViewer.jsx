import { Canvas, useThree } from "@react-three/fiber";
import { Grid, Line, OrbitControls, Stars, Text } from "@react-three/drei";
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { resolveAssetUrl } from "../../api/missions.js";
import ErrorBoundary from "../common/ErrorBoundary";

// Global cache for downloaded ArrayBuffers and bounds to eliminate redundant network transfers
// without holding live GPU-bound BufferGeometry instances across mission switches.
const bufferCache = new Map();

/**
 * Disposes a material and all attached textures cleanly from GPU memory.
 */
export function disposeMaterial(material) {
  if (!material) return;
  for (const key of Object.keys(material)) {
    const val = material[key];
    if (val && typeof val === "object" && val.isTexture) {
      try {
        val.dispose();
      } catch {
        /* ignore */
      }
    }
  }
  try {
    material.dispose();
  } catch {
    /* ignore */
  }
}

/**
 * Recursively disposes all geometries, materials, and textures for any Three.js object.
 */
export function disposeThreeResource(obj) {
  if (!obj) return;
  if (obj.isBufferGeometry) {
    try {
      obj.dispose();
    } catch {
      /* ignore */
    }
    return;
  }
  if (obj.isMaterial) {
    disposeMaterial(obj);
    return;
  }
  if (obj.isObject3D) {
    obj.traverse((child) => {
      if (child.geometry) {
        try {
          child.geometry.dispose();
        } catch {
          /* ignore */
        }
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(child.material);
        }
      }
    });
  }
}

/**
 * Ensures all geometry attributes and index buffers use WebGL-supported typed arrays.
 * Converts Float64Array to Float32Array (preventing 'THREE.WebGLAttributes: Unsupported buffer data format'),
 * flattens nested arrays, and guarantees index buffers are Uint32Array / Uint16Array.
 */
export function sanitizeBufferGeometry(geom) {
  if (!geom) return geom;

  // 1. Sanitize standard vertex attributes (position, normal, color, uv, etc.)
  if (geom.attributes) {
    for (const [name, attr] of Object.entries(geom.attributes)) {
      if (!attr || !attr.array) continue;

      const array = attr.array;
      let needsReplace = false;
      let newArray = null;

      // Handle Float64Array (WebGL only supports 32-bit float attributes on GPU)
      if (array instanceof Float64Array) {
        newArray = new Float32Array(array);
        needsReplace = true;
      }
      // Handle plain JS arrays or nested arrays [[x, y, z], ...]
      else if (Array.isArray(array)) {
        const flat = typeof array.flat === "function" ? array.flat(Infinity) : array;
        newArray = new Float32Array(flat);
        needsReplace = true;
      }
      // Handle any non-standard typed array that WebGLAttributes rejects
      else if (
        !(
          array instanceof Float32Array ||
          (typeof Float16Array !== "undefined" && array instanceof Float16Array) ||
          array instanceof Uint16Array ||
          array instanceof Int16Array ||
          array instanceof Uint32Array ||
          array instanceof Int32Array ||
          array instanceof Int8Array ||
          array instanceof Uint8Array ||
          array instanceof Uint8ClampedArray
        )
      ) {
        newArray = new Float32Array(array);
        needsReplace = true;
      }

      if (needsReplace && newArray) {
        geom.setAttribute(
          name,
          new THREE.BufferAttribute(
            newArray,
            attr.itemSize || 3,
            attr.normalized || false,
          ),
        );
      }
    }
  }

  // 2. Sanitize index attribute
  if (geom.index && geom.index.array) {
    const idxArray = geom.index.array;
    if (
      !(
        idxArray instanceof Uint32Array ||
        idxArray instanceof Uint16Array ||
        idxArray instanceof Uint8Array
      )
    ) {
      const flat =
        Array.isArray(idxArray) && typeof idxArray.flat === "function"
          ? idxArray.flat(Infinity)
          : idxArray;
      geom.setIndex(new THREE.BufferAttribute(new Uint32Array(flat), 1));
    }
  }

  return geom;
}

/**
 * Real Point Cloud Renderer
 * Visualizes dense or sparse photogrammetric point clouds using PLY format.
 * Includes complete GPU memory disposal on mission/URL change or component unmount.
 */
function RealPointCloud({ url, onBoundsComputed }) {
  const [geometry, setGeometry] = useState(null);
  const currentGeometryRef = useRef(null);
  const currentMaterialRef = useRef(null);

  // Clean up GPU resources on unmount or before new point cloud loads
  useEffect(() => {
    return () => {
      if (currentGeometryRef.current) {
        try {
          currentGeometryRef.current.dispose();
        } catch (e) {
          console.warn("[RealPointCloud] Error disposing geometry:", e);
        }
        currentGeometryRef.current = null;
      }
      if (currentMaterialRef.current) {
        try {
          disposeMaterial(currentMaterialRef.current);
        } catch (e) {
          console.warn("[RealPointCloud] Error disposing material:", e);
        }
        currentMaterialRef.current = null;
      }
    };
  }, [url]);

  useEffect(() => {
    if (!url) return;
    let active = true;

    async function loadPointCloud() {
      try {
        let buffer;
        let cachedBounds;
        if (bufferCache.has(url)) {
          const cached = bufferCache.get(url);
          buffer = cached.buffer;
          cachedBounds = cached.bounds;
        } else {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buffer = await res.arrayBuffer();
          if (!active) return;
        }

        const loader = new PLYLoader();
        const rawGeom = loader.parse(buffer);
        if (!active) return;

        const geom = sanitizeBufferGeometry(rawGeom);
        geom.computeVertexNormals();
        geom.computeBoundingBox();

        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        if (geom.boundingBox) {
          geom.boundingBox.getCenter(center);
          geom.boundingBox.getSize(size);
        }
        const radius = Math.max(size.x, size.y, size.z) / 2 || 15;
        const bounds = cachedBounds || {
          center: [center.x, center.y, center.z],
          size: [size.x, size.y, size.z],
          radius,
        };

        bufferCache.set(url, { buffer, bounds });

        // Dispose previous geometry before mounting new one
        if (currentGeometryRef.current && currentGeometryRef.current !== geom) {
          try {
            currentGeometryRef.current.dispose();
          } catch {
            /* ignore */
          }
        }
        currentGeometryRef.current = geom;
        setGeometry(geom);
        if (onBoundsComputed) onBoundsComputed(bounds);
      } catch (err) {
        console.warn("[RealPointCloud] Could not load real PLY point cloud:", err);
      }
    }

    loadPointCloud();

    return () => {
      active = false;
    };
  }, [url, onBoundsComputed]);

  if (!geometry) return null;

  return (
    <points geometry={geometry}>
      <pointsMaterial
        ref={currentMaterialRef}
        size={0.14}
        vertexColors={geometry.hasAttribute("color")}
        color={geometry.hasAttribute("color") ? undefined : "#38d7ff"}
        sizeAttenuation
        transparent
        opacity={0.92}
      />
    </points>
  );
}

/**
 * Real Surface Mesh Renderer
 * Supports binary GLTF (.glb), text GLTF (.gltf), Wavefront (.obj), and PLY surface meshes.
 * Includes complete GPU memory disposal of previous geometry, materials, and textures
 * whenever the active mission/URL changes or the component unmounts.
 */
function RealMesh({ url, mode, onBoundsComputed, onError }) {
  const [meshData, setMeshData] = useState(null);
  const currentMeshDataRef = useRef(null);
  const currentMaterialRef = useRef(null);

  // Helper to cleanly dispose of previous geometry, materials, and textures
  const disposeCurrentMesh = useCallback(() => {
    if (currentMeshDataRef.current) {
      const data = currentMeshDataRef.current;
      try {
        if (data.type === "geometry" && data.geometry) {
          data.geometry.dispose();
        } else if ((data.type === "gltf" || data.type === "obj") && data.scene) {
          disposeThreeResource(data.scene);
        }
      } catch (e) {
        console.warn("[RealMesh] Error disposing previous geometry:", e);
      }
      currentMeshDataRef.current = null;
    }
    if (currentMaterialRef.current) {
      disposeMaterial(currentMaterialRef.current);
      currentMaterialRef.current = null;
    }
  }, []);

  // Cleanup on unmount or URL change
  useEffect(() => {
    return () => {
      disposeCurrentMesh();
    };
  }, [url, disposeCurrentMesh]);

  useEffect(() => {
    if (!url) return;
    let active = true;

    async function loadMesh() {
      try {
        let buffer;
        let cachedBounds;
        if (bufferCache.has(url)) {
          const cached = bufferCache.get(url);
          if (cached.error) {
            if (onError) onError(cached.error);
            return;
          }
          buffer = cached.buffer;
          cachedBounds = cached.bounds;
        } else {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} fetching mesh`);
          }
          buffer = await res.arrayBuffer();
          if (!active) return;
        }

        // Inspect header bytes
        const bytes = new Uint8Array(
          buffer,
          0,
          Math.min(32, buffer.byteLength),
        );
        const isGLB =
          bytes[0] === 0x67 &&
          bytes[1] === 0x6c &&
          bytes[2] === 0x54 &&
          bytes[3] === 0x46; // 'glTF'
        const isPLY =
          bytes[0] === 0x70 && bytes[1] === 0x6c && bytes[2] === 0x79; // 'ply'

        if (isGLB || (!isPLY && (url.endsWith(".glb") || url.endsWith(".gltf")))) {
          const loader = new GLTFLoader();
          loader.parse(
            buffer,
            "",
            (gltf) => {
              if (!active) return;
              gltf.scene.traverse((child) => {
                if (child.isMesh && child.geometry) {
                  sanitizeBufferGeometry(child.geometry);
                }
              });
              const box = new THREE.Box3().setFromObject(gltf.scene);
              const center = new THREE.Vector3();
              const size = new THREE.Vector3();
              box.getCenter(center);
              box.getSize(size);
              const radius = Math.max(size.x, size.y, size.z) / 2 || 15;
              const bounds = cachedBounds || {
                center: [center.x, center.y, center.z],
                size: [size.x, size.y, size.z],
                radius,
              };

              bufferCache.set(url, { buffer, bounds });
              const data = { type: "gltf", scene: gltf.scene, bounds };

              // Dispose previous resources before setting new ones
              disposeCurrentMesh();
              currentMeshDataRef.current = data;
              setMeshData(data);
              if (onBoundsComputed) onBoundsComputed(bounds);
            },
            (err) => {
              console.warn("[RealMesh] GLTFLoader parse error:", err, url);
              bufferCache.set(url, { error: err });
              if (onError) onError(err);
            },
          );
        } else if (
          url.endsWith(".obj") ||
          (!isPLY && new TextDecoder().decode(bytes).includes("#"))
        ) {
          const text = new TextDecoder().decode(buffer);
          const loader = new OBJLoader();
          const obj = loader.parse(text);
          obj.traverse((child) => {
            if (child.isMesh) {
              if (child.geometry) {
                sanitizeBufferGeometry(child.geometry);
              }
              child.material = new THREE.MeshStandardMaterial({
                color: "#28758a",
                metalness: 0.2,
                roughness: 0.7,
                side: THREE.DoubleSide,
              });
            }
          });
          const box = new THREE.Box3().setFromObject(obj);
          const center = new THREE.Vector3();
          const size = new THREE.Vector3();
          box.getCenter(center);
          box.getSize(size);
          const radius = Math.max(size.x, size.y, size.z) / 2 || 15;
          const bounds = cachedBounds || {
            center: [center.x, center.y, center.z],
            size: [size.x, size.y, size.z],
            radius,
          };

          bufferCache.set(url, { buffer, bounds });
          const data = { type: "obj", scene: obj, bounds };

          // Dispose previous resources before setting new ones
          disposeCurrentMesh();
          currentMeshDataRef.current = data;
          setMeshData(data);
          if (onBoundsComputed) onBoundsComputed(bounds);
        } else {
          // Fallback to PLY surface mesh
          const loader = new PLYLoader();
          const rawGeom = loader.parse(buffer);
          const geom = sanitizeBufferGeometry(rawGeom);
          geom.computeVertexNormals();
          geom.computeBoundingBox();

          const center = new THREE.Vector3();
          const size = new THREE.Vector3();
          if (geom.boundingBox) {
            geom.boundingBox.getCenter(center);
            geom.boundingBox.getSize(size);
          }
          const radius = Math.max(size.x, size.y, size.z) / 2 || 15;
          const bounds = cachedBounds || {
            center: [center.x, center.y, center.z],
            size: [size.x, size.y, size.z],
            radius,
          };

          bufferCache.set(url, { buffer, bounds });
          const data = { type: "geometry", geometry: geom, bounds };

          // Dispose previous resources before setting new ones
          disposeCurrentMesh();
          currentMeshDataRef.current = data;
          setMeshData(data);
          if (onBoundsComputed) onBoundsComputed(bounds);
        }
      } catch (err) {
        console.warn(`[RealMesh] Could not load or validate real surface mesh from ${url}:`, err);
        bufferCache.set(url, { error: err });
        if (onError) onError(err);
      }
    }

    loadMesh();
    return () => {
      active = false;
    };
  }, [url, onBoundsComputed, onError, disposeCurrentMesh]);

  // Handle mode adjustments (wireframe / topographic)
  useEffect(() => {
    if (!meshData) return;
    if (meshData.type === "gltf" || meshData.type === "obj") {
      meshData.scene.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.wireframe = mode === "wireframe";
          if (mode === "topographic") {
            child.material.color = new THREE.Color("#28758a");
          }
        }
      });
    }
  }, [meshData, mode]);

  if (!meshData) return null;

  if (meshData.type === "gltf" || meshData.type === "obj") {
    return <primitive object={meshData.scene} />;
  }

  const hasVertexColors = Boolean(meshData.geometry?.attributes?.color);

  return (
    <mesh geometry={meshData.geometry}>
      <meshStandardMaterial
        ref={currentMaterialRef}
        vertexColors={hasVertexColors}
        color={hasVertexColors ? 0xffffff : (mode === "topographic" ? "#28758a" : "#1c5a69")}
        wireframe={mode === "wireframe"}
        metalness={0.15}
        roughness={0.65}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Camera Trajectory Component
/**
 * Camera Station Frustum Component
 * Renders an oriented frustum pyramid and station sphere marker pointing along viewing direction.
 */
function CameraStation({ cam, isSelected, onSelectCamera }) {
  const [x, y, z] = cam.position;
  const groupRef = useRef();

  useEffect(() => {
    if (groupRef.current) {
      if (cam.viewing_direction && Array.isArray(cam.viewing_direction)) {
        const target = new THREE.Vector3(
          x + cam.viewing_direction[0] * 5,
          y + cam.viewing_direction[1] * 5,
          z + cam.viewing_direction[2] * 5,
        );
        groupRef.current.lookAt(target);
      } else {
        groupRef.current.lookAt(new THREE.Vector3(0, 0, 8));
      }
    }
  }, [cam, x, y, z]);

  return (
    <group position={[x, y, z]}>
      {/* Station marker sphere */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          if (onSelectCamera) onSelectCamera(cam);
        }}
      >
        <sphereGeometry args={[isSelected ? 0.6 : 0.4, 16, 16]} />
        <meshStandardMaterial
          color={isSelected ? "#f59e0b" : "#38bdf8"}
          emissive={isSelected ? "#f59e0b" : "#0284c7"}
          emissiveIntensity={isSelected ? 0.9 : 0.5}
        />
      </mesh>

      {/* Oriented frustum wireframe pyramid */}
      <group ref={groupRef}>
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 1.2]}
          onClick={(e) => {
            e.stopPropagation();
            if (onSelectCamera) onSelectCamera(cam);
          }}
        >
          <coneGeometry args={[1.0, 2.2, 4]} />
          <meshBasicMaterial
            color={isSelected ? "#fbbf24" : "#22d3ee"}
            wireframe
          />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Camera Trajectory Component
 * Displays registered camera stations and flight path from SfM poses.
 */
function CameraTrajectory({ poses, onSelectCamera, selectedCameraId }) {
  const sorted = useMemo(() => {
    if (!poses || !Array.isArray(poses)) return [];
    return [...poses].sort((a, b) =>
      (a.image_name || "").localeCompare(b.image_name || ""),
    );
  }, [poses]);

  const points = useMemo(() => {
    return sorted
      .filter((p) => p.position && p.position.length === 3)
      .map(
        (p) => new THREE.Vector3(p.position[0], p.position[1], p.position[2]),
      );
  }, [sorted]);

  if (!poses || !Array.isArray(poses) || poses.length === 0) return null;

  return (
    <group>
      {points.length > 1 && (
        <Line
          points={points}
          color="#38bdf8"
          lineWidth={3.5}
          transparent
          opacity={0.9}
        />
      )}
      {sorted.map((cam, i) => {
        if (!cam.position || cam.position.length !== 3) return null;
        const isSelected =
          selectedCameraId === (cam.image_name || cam.image_id);
        return (
          <CameraStation
            key={cam.image_id || cam.image_name || i}
            cam={cam}
            isSelected={isSelected}
            onSelectCamera={onSelectCamera}
          />
        );
      })}
    </group>
  );
}

/**
 * Semantic 3D Objects Component
 * Renders verified 3D objects with motion status coloring and interactive selection.
 */
function SemanticObjects3D({ objects, selectedId, onSelect, layers }) {
  if (!objects || !Array.isArray(objects) || objects.length === 0) return null;

  return (
    <group>
      {objects.map((obj, i) => {
        if (!obj.position_3d || obj.association_status === "REJECTED")
          return null;

        const cls = (obj.class || obj.class_name || "").toLowerCase();
        if (layers) {
          if (
            layers.vehicles === false &&
            (cls === "car" ||
              cls === "truck" ||
              cls === "bus" ||
              cls === "van" ||
              cls === "bicycle" ||
              cls === "motorcycle" ||
              cls === "vehicle")
          )
            return null;
          if (
            (layers.people === false || layers.humans === false) &&
            (cls === "person" || cls === "pedestrian" || cls === "people" || cls === "human")
          )
            return null;
          if (
            layers.fireSmoke === false &&
            (cls === "fire" || cls === "smoke")
          )
            return null;
          if (
            layers.damage === false &&
            (cls === "damage" || cls === "debris" || cls === "rubble")
          )
            return null;
          if (
            layers.entryExit === false &&
            (cls === "entry" || cls === "exit" || cls === "door" || cls === "gate")
          )
            return null;
          if (
            layers.animals === false &&
            (cls === "dog" || cls === "cat" || cls === "horse" || cls === "cow")
          )
            return null;
          if (
            layers.otherObjects === false &&
            cls !== "car" &&
            cls !== "truck" &&
            cls !== "bus" &&
            cls !== "van" &&
            cls !== "person" &&
            cls !== "pedestrian"
          )
            return null;
        }

        const isLowConf =
          obj.association_status === "LOW_CONFIDENCE" ||
          obj.association_status === "INSUFFICIENT_EVIDENCE" ||
          (obj.evidence_count || 1) < 2 ||
          (obj.association_confidence && obj.association_confidence < 0.60);

        if (isLowConf && !layers?.lowConfidence) {
          return null;
        }

        const [x, y, z] = obj.position_3d;
        const isSelected =
          selectedId === obj.object_id || selectedId === obj.track_id;
        const motionState = (obj.motion_state || "STATIC").toUpperCase();

        const baseColor =
          motionState === "MOVING"
            ? "#f97316"
            : motionState === "STATIC"
              ? "#22d3ee"
              : "#a855f7";

        const color = isSelected ? "#fbbf24" : isLowConf ? "#64748b" : baseColor;
        const markerRadius = isSelected ? 0.8 : isLowConf ? 0.3 : 0.55;
        const markerOpacity = isLowConf && !isSelected ? 0.35 : 0.95;
        const emissiveIntensity = isSelected ? 1.0 : isLowConf ? 0.1 : 0.5;

        return (
          <group
            key={obj.object_id || i}
            position={[x, y, z]}
            onClick={(e) => {
              e.stopPropagation();
              if (onSelect) onSelect(obj);
            }}
          >
            {/* Center marker sphere */}
            <mesh>
              <sphereGeometry args={[markerRadius, 16, 16]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={emissiveIntensity}
                roughness={isLowConf ? 0.7 : 0.2}
                metalness={isLowConf ? 0.2 : 0.8}
                transparent={isLowConf && !isSelected}
                opacity={markerOpacity}
              />
            </mesh>

            {/* Selection highlight ring */}
            {isSelected && (
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.1, 1.4, 24]} />
                <meshBasicMaterial
                  color="#fbbf24"
                  side={THREE.DoubleSide}
                  transparent
                  opacity={0.9}
                />
              </mesh>
            )}

            {/* 3D Label: show for selected or verified high-confidence objects */}
            {(isSelected || (!isLowConf && layers?.labels !== false)) && (
              <Text
                font="/fonts/space_grotesk.ttf"
                position={[0, 1.1, 0]}
                fontSize={isSelected ? 0.75 : 0.55}
                color={isSelected ? "#fbbf24" : "#e2e8f0"}
                anchorX="center"
                anchorY="bottom"
                outlineWidth={0.04}
                outlineColor="#061017"
              >
                {`${obj.track_id || obj.object_id} · ${obj.class || obj.class_name || "object"}`}
              </Text>
            )}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Custom Operator Markings Component
 * Renders user-dropped pins with interactive selection and custom colors.
 */
function CustomMarkings3D({ markings, selectedId, onSelect }) {
  if (!markings || !Array.isArray(markings) || markings.length === 0) return null;

  return (
    <group>
      {markings.map((m) => {
        if (m.visible === false) return null;
        const [x, y, z] = Array.isArray(m.position) ? m.position : [0, 0, 0];
        const isSelected = selectedId === m.id;
        const color = m.color || "#38bdf8";

        return (
          <group
            key={m.id}
            position={[x, y, z]}
            onClick={(e) => {
              e.stopPropagation();
              if (onSelect) onSelect(m);
            }}
          >
            {/* Base pin stem */}
            <mesh position={[0, 0.75, 0]}>
              <cylinderGeometry args={[0.08, 0.04, 1.5, 8]} />
              <meshStandardMaterial color={color} />
            </mesh>
            {/* Top sphere marker */}
            <mesh position={[0, 1.6, 0]}>
              <sphereGeometry args={[isSelected ? 0.65 : 0.45, 16, 16]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={isSelected ? 0.9 : 0.5}
                roughness={0.2}
                metalness={0.7}
              />
            </mesh>
            {/* Text label */}
            <Text
              font="/fonts/space_grotesk.ttf"
              position={[0, 2.4, 0]}
              fontSize={0.65}
              color="#ffffff"
              anchorX="center"
              anchorY="bottom"
              outlineWidth={0.06}
              outlineColor="#061017"
            >
              {m.name || "Marker"}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

/**
 * 3D Scene Root Component
 */
function Scene({
  layers,
  mode,
  mission,
  meshUrl: propMeshUrl,
  pointCloudUrl: propPointCloudUrl,
  reconstructionMeta,
  onSelectObject,
  selectedObject,
  cameraPoses,
  semanticObjects,
  cameraTarget,
  activeTool,
  cameraActionsRef,
  onBoundsReady,
  onSelectCamera,
  selectedCameraId,
  customMarkings = [],
  selectedMarkingId,
  onSelectMarking,
  onSceneClick,
}) {
  const controlsRef = useRef();
  const hasAutoFramedRef = useRef(false);
  const [modelBounds, setModelBounds] = useState(null);

  const pointCloudUrl = useMemo(() => {
    const mId = mission?.id || null;
    const raw =
      propPointCloudUrl ||
      reconstructionMeta?.point_cloud_url ||
      mission?.reconstruction?.point_cloud_url ||
      mission?.assets?.pointCloud ||
      (mId ? `/api/missions/${mId}/reconstruction/pointcloud` : null);
    return raw ? resolveAssetUrl(raw) : null;
  }, [propPointCloudUrl, reconstructionMeta, mission]);

  const meshUrl = useMemo(() => {
    const mId = mission?.id || null;
    const raw =
      propMeshUrl ||
      reconstructionMeta?.mesh_url ||
      mission?.reconstruction?.mesh_url ||
      mission?.assets?.mesh ||
      (mId ? `/api/missions/${mId}/reconstruction/mesh` : null) ||
      mission?.assets?.model;
    return raw ? resolveAssetUrl(raw) : null;
  }, [propMeshUrl, reconstructionMeta, mission]);

  const isRealReconstruction = Boolean(
    meshUrl ||
    pointCloudUrl ||
    mission?.reconstruction?.status === "MESH_GENERATED" ||
    mission?.reconstruction?.status === "RECONSTRUCTED" ||
    (mission?.reconstruction?.sparse_point_count &&
      mission.reconstruction.sparse_point_count > 0) ||
    (mission?.reconstruction?.dense_point_count &&
      mission.reconstruction.dense_point_count > 0),
  );

  const [meshFailed, setMeshFailed] = useState(false);

  useEffect(() => {
    setMeshFailed(false);
  }, [meshUrl]);

  const handleMeshError = useCallback(
    (err) => {
      console.warn(
        `[ReconstructionViewer] Mesh failed to load or render (${meshUrl}), falling back to point cloud:`,
        err,
      );
      setMeshFailed(true);
    },
    [meshUrl],
  );

  // Hierarchy rules:
  // 1. If real mesh exists and hasn't failed, mesh is PRIMARY.
  // 2. Point cloud is optional layer (default false if mesh exists; true if mesh is absent or fails).
  const hasMesh = Boolean(meshUrl) && !meshFailed;
  const showMesh =
    !meshFailed &&
    layers.mesh !== false &&
    hasMesh &&
    mode !== "point cloud" &&
    layers.pointsOnly !== true;
  const showCloud =
    layers.pointCloud === true ||
    layers.pointsOnly === true ||
    (meshFailed && Boolean(pointCloudUrl)) ||
    (!hasMesh && layers.pointCloud !== false && Boolean(pointCloudUrl));

  const showSemanticObjects =
    layers.semanticObjects !== false && layers.objects !== false;

  const poseStatus =
    reconstructionMeta?.pose_status ||
    mission?.reconstruction?.pose_status ||
    (cameraPoses && cameraPoses.length > 0 ? "AVAILABLE" : null);

  const isPoseUnavailable =
    poseStatus === "UNAVAILABLE_NO_TELEMETRY" ||
    (!cameraPoses && !mission?.reconstruction?.camera_poses);

  const showCameraTrajectory =
    !isPoseUnavailable &&
    layers.cameraTrajectory !== false &&
    layers.flight !== false;

  const poses = isPoseUnavailable
    ? []
    : (cameraPoses || mission?.reconstruction?.camera_poses || []);

  const objectsToRender =
    semanticObjects ||
    mission?.objects_3d ||
    mission?.semantic_scene?.objects ||
    [];

  // Reset auto-framing on mission or mesh change
  useEffect(() => {
    hasAutoFramedRef.current = false;
  }, [mission?.id, meshUrl]);

  const centroid = useMemo(() => {
    const c =
      reconstructionMeta?.centroid || mission?.reconstruction?.centroid;
    if (Array.isArray(c) && c.length === 3) return c;
    return modelBounds?.center || [0.0, 1.5, 2.0];
  }, [mission, reconstructionMeta, modelBounds]);

  // Handle bounds calculation and automatic viewport framing
  const handleBoundsComputed = useCallback(
    (bounds) => {
      if (!bounds) return;
      setModelBounds(bounds);
      if (onBoundsReady) onBoundsReady(bounds);

      if (!hasAutoFramedRef.current && controlsRef.current) {
        hasAutoFramedRef.current = true;
        const [cx, cy, cz] = bounds.center || [0.0, 0.0, 0.0];
        const r = Math.max(bounds.radius || 25.0, 15.0);
        const fov = 45;
        const dist = (r / Math.sin((fov * Math.PI) / 360)) * 1.35;
        const camera = controlsRef.current.object;

        camera.position.set(
          cx + dist * 0.45,
          cy + dist * 0.65,
          cz + dist * 0.75,
        );
        camera.lookAt(cx, cy, cz);
        controlsRef.current.target.set(cx, cy, cz);
        controlsRef.current.update();
      }
    },
    [onBoundsReady],
  );

  // Respond to cameraTarget prop with smooth close-up positioning
  useEffect(() => {
    if (!cameraTarget || !controlsRef.current) return;
    const [tx, ty, tz] = cameraTarget;
    const controls = controlsRef.current;
    const cam = controls.object;

    controls.target.set(tx, ty, tz);

    const offset = cam.position.clone().sub(new THREE.Vector3(tx, ty, tz));
    const currDist = offset.length();
    const idealDist = Math.min(Math.max(currDist * 0.4, 4.0), 8.0);
    if (offset.lengthSq() > 0.001) {
      offset.normalize().multiplyScalar(idealDist);
      if (offset.y < 1.2) offset.y = 1.8;
    } else {
      offset.set(4, 3, 4);
    }
    cam.position.set(tx + offset.x, ty + offset.y, tz + offset.z);
    cam.lookAt(tx, ty, tz);
    controls.update();
  }, [cameraTarget]);

  // Bind camera navigation actions
  useEffect(() => {
    if (!cameraActionsRef) return;
    cameraActionsRef.current = {
      zoomIn: () => {
        if (!controlsRef.current) return;
        const cam = controlsRef.current.object;
        const target = controlsRef.current.target;
        cam.position.lerp(target, 0.25);
        controlsRef.current.update();
      },
      zoomOut: () => {
        if (!controlsRef.current) return;
        const cam = controlsRef.current.object;
        const target = controlsRef.current.target;
        cam.position.addScaledVector(cam.position.clone().sub(target), 0.25);
        controlsRef.current.update();
      },
      fit: () => {
        if (!controlsRef.current) return;
        const b = modelBounds || { center: centroid, radius: 25 };
        const [cx, cy, cz] = b.center;
        const dist = (b.radius / Math.sin((45 * Math.PI) / 360)) * 1.15;
        const cam = controlsRef.current.object;
        cam.position.set(cx + dist * 0.45, cy + dist * 0.65, cz + dist * 0.75);
        cam.lookAt(cx, cy, cz);
        controlsRef.current.target.set(cx, cy, cz);
        controlsRef.current.update();
      },
      reset: () => {
        if (!controlsRef.current) return;
        const [cx, cy, cz] = centroid;
        const cam = controlsRef.current.object;
        cam.position.set(cx + 25, cy + 35, cz + 40);
        cam.lookAt(cx, cy, cz);
        controlsRef.current.target.set(cx, cy, cz);
        controlsRef.current.update();
      },
    };
  }, [cameraActionsRef, modelBounds, centroid]);

  const gridY = modelBounds?.center
    ? modelBounds.center[1] -
      (modelBounds.size?.[1] ? modelBounds.size[1] / 2 + 1 : 8)
    : centroid[1] - 8;

  return (
    <>
      <color attach="background" args={["#061017"]} />
      <fog attach="fog" args={["#061017", 250, 1500]} />

      {/* Realistic Environment Lighting */}
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#b4f0ff", "#1e293b", 0.85]} />
      <directionalLight
        position={[50, 100, 60]}
        intensity={2.0}
        color="#ffffff"
      />
      <directionalLight
        position={[-40, 30, -30]}
        intensity={0.6}
        color="#93c5fd"
      />

      {/* Ground Grid */}
      {layers.grid !== false && (
        <Grid
          args={[250, 250]}
          position={[centroid[0], gridY, centroid[2]]}
          cellColor="#1c6674"
          sectionColor="#2b9eb3"
          cellSize={5}
          sectionSize={25}
          fadeDistance={200}
          infiniteGrid
        />
      )}

      {/* Photogrammetric Reconstruction Geometry */}
      {isRealReconstruction && (
        <group
          onClick={(e) => {
            if (activeTool === "marker" && onSceneClick && e.point) {
              e.stopPropagation();
              onSceneClick([
                Number(e.point.x.toFixed(2)),
                Number(e.point.y.toFixed(2)),
                Number(e.point.z.toFixed(2)),
              ]);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (e.point && controlsRef.current) {
              const [px, py, pz] = [e.point.x, e.point.y, e.point.z];
              const controls = controlsRef.current;
              const cam = controls.object;
              controls.target.set(px, py, pz);
              const offset = cam.position.clone().sub(new THREE.Vector3(px, py, pz));
              const newDist = Math.min(Math.max(offset.length() * 0.5, 3.0), 10.0);
              offset.normalize().multiplyScalar(newDist);
              if (offset.y < 1.0) offset.y = 1.5;
              cam.position.set(px + offset.x, py + offset.y, pz + offset.z);
              cam.lookAt(px, py, pz);
              controls.update();
            }
          }}
        >
          {showMesh && meshUrl && (
            <RealMesh
              url={meshUrl}
              mode={mode}
              onBoundsComputed={handleBoundsComputed}
              onError={handleMeshError}
            />
          )}

          {showCloud && pointCloudUrl && (
            <RealPointCloud
              url={pointCloudUrl}
              onBoundsComputed={handleBoundsComputed}
            />
          )}

          {showCameraTrajectory && (
            <CameraTrajectory
              poses={poses}
              onSelectCamera={onSelectCamera}
              selectedCameraId={selectedCameraId}
            />
          )}

          {showSemanticObjects && (
            <SemanticObjects3D
              objects={objectsToRender}
              selectedId={selectedObject?.object_id || selectedObject?.track_id}
              onSelect={onSelectObject}
              layers={layers}
            />
          )}

          {layers.customMarkings !== false && customMarkings && customMarkings.length > 0 && (
            <CustomMarkings3D
              markings={customMarkings}
              selectedId={selectedMarkingId}
              onSelect={onSelectMarking}
            />
          )}
        </group>
      )}

      <Stars radius={120} depth={60} count={800} factor={2} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        minDistance={0.1}
        maxDistance={1200}
        zoomSpeed={0.85}
        rotateSpeed={0.8}
        panSpeed={0.8}
        mouseButtons={{
          LEFT: activeTool === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: activeTool === "orbit" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

/**
 * Monitors WebGL renderer lifecycle, intercepts webglcontextlost to prevent browser
 * permanent context termination, and handles clean disposal on unmount.
 */
function RendererLifecycleManager({ onContextLost, onContextRestored }) {
  const { gl } = useThree();

  useEffect(() => {
    const domEl = gl.domElement;
    if (!domEl) return;

    const handleContextLost = (event) => {
      // Required: prevents browser from permanently discarding the WebGL context
      event.preventDefault();
      console.warn(
        "[ReconstructionViewer] THREE.WebGLRenderer: WebGL Context Lost! Preventing default to allow recovery.",
      );
      onContextLost?.();
    };

    const handleContextRestored = () => {
      console.info(
        "[ReconstructionViewer] THREE.WebGLRenderer: WebGL Context Restored! Re-initializing 3D scene.",
      );
      try {
        gl.resetState();
      } catch {
        /* ignore */
      }
      onContextRestored?.();
    };

    domEl.addEventListener("webglcontextlost", handleContextLost, false);
    domEl.addEventListener("webglcontextrestored", handleContextRestored, false);

    return () => {
      domEl.removeEventListener("webglcontextlost", handleContextLost);
      domEl.removeEventListener("webglcontextrestored", handleContextRestored);
    };
  }, [gl, onContextLost, onContextRestored]);

  return null;
}

class WebGLBoundary extends Component {
  state = { failed: false, error: null };

  static getDerivedStateFromError(error) {
    return { failed: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ReconstructionViewer WebGLBoundary]:", error, errorInfo);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="reconstruction-webgl-error" role="alert" style={{
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          textAlign: "center",
          background: "rgba(6, 16, 23, 0.95)",
          color: "#f87171"
        }}>
          <strong style={{ fontSize: "15px", marginBottom: "8px" }}>3D VIEWER UNAVAILABLE</strong>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", maxWidth: "340px", marginBottom: "16px" }}>
            WebGL could not initialize or encountered a graphics pipeline error on this device.
          </span>
          <button
            type="button"
            onClick={() => this.setState({ failed: false, error: null })}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              background: "rgba(56, 215, 255, 0.15)",
              border: "1px solid rgba(56, 215, 255, 0.3)",
              color: "#38d7ff",
              fontSize: "12px",
              cursor: "pointer"
            }}
          >
            Retry 3D Viewer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * ReconstructionViewer Primary Export
 */
export default function ReconstructionViewer({
  layers = {},
  mode = "hybrid",
  mission,
  meshUrl: propMeshUrl,
  pointCloudUrl: propPointCloudUrl,
  reconstructionMeta,
  onFinding,
  onSelectObject,
  selectedObject,
  cameraPoses,
  semanticObjects,
  cameraTarget,
  activeTool = "select",
  onToggleLayer,
  onSelectCamera,
  viewerRef,
  hideEmbeddedControls = false,
  sceneType,
  sceneTypeTag,
  sceneTypeCategory,
  customMarkings = [],
  selectedMarkingId,
  onSelectMarking,
  onSceneClick,
}) {
  const containerRef = useRef();
  const cameraActionsRef = useRef({});
  const [internalLayers, setInternalLayers] = useState({});
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [contextVersion, setContextVersion] = useState(0);

  const handleContextLost = useCallback(() => {
    console.warn("[ReconstructionViewer] WebGL Context Loss event received.");
  }, []);

  const handleContextRestored = useCallback(() => {
    console.info("[ReconstructionViewer] WebGL Context Restored - triggering clean scene reload.");
    bufferCache.clear();
    setContextVersion((v) => v + 1);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen?.();
    }
  }, []);

  useEffect(() => {
    if (viewerRef) {
      viewerRef.current = {
        zoomIn: () => cameraActionsRef.current?.zoomIn?.(),
        zoomOut: () => cameraActionsRef.current?.zoomOut?.(),
        fit: () => cameraActionsRef.current?.fit?.(),
        reset: () => cameraActionsRef.current?.reset?.(),
        toggleFullscreen,
      };
    }
  }, [viewerRef, toggleFullscreen]);

  // Merge parent layers with any local toggle overrides
  const effectiveLayers = useMemo(
    () => ({ ...layers, ...internalLayers }),
    [layers, internalLayers],
  );

  const toggleLayer = (key) => {
    if (onToggleLayer) {
      onToggleLayer(key);
    } else {
      if (key === "pointsOnly") {
        setInternalLayers((prev) => {
          const isPointsOnly = prev.pointsOnly === true;
          return {
            ...prev,
            pointsOnly: !isPointsOnly,
            mesh: isPointsOnly, // Restore mesh if turning off
            pointCloud: !isPointsOnly,
          };
        });
        return;
      }
      setInternalLayers((prev) => ({
        ...prev,
        [key]: !prev[key],
      }));
    }
  };

  const handleSelectCamera = useCallback(
    (camera) => {
      const cameraId = camera?.image_name || camera?.image_id || null;
      setSelectedCameraId(cameraId);
      onSelectCamera?.(camera);
    },
    [onSelectCamera],
  );

  const mId = mission?.id || null;
  const meshUrl =
    propMeshUrl ||
    reconstructionMeta?.mesh_url ||
    mission?.reconstruction?.mesh_url ||
    (typeof mission?.assets?.mesh === "string" ? mission.assets.mesh : null) ||
    (mId ? resolveAssetUrl(`/api/missions/${mId}/reconstruction/mesh`) : null) ||
    (typeof mission?.assets?.model === "string" ? mission.assets.model : null);
  const pointCloudUrl =
    propPointCloudUrl ||
    reconstructionMeta?.point_cloud_url ||
    mission?.reconstruction?.point_cloud_url ||
    (typeof mission?.assets?.pointCloud === "string"
      ? mission.assets.pointCloud
      : null) ||
    (mId ? resolveAssetUrl(`/api/missions/${mId}/reconstruction/pointcloud`) : null);

  const hasMesh = Boolean(meshUrl);
  const hasPointCloud = Boolean(pointCloudUrl);
  const isReal = hasMesh || hasPointCloud;

  const pointCount =
    reconstructionMeta?.sparse_point_count ||
    reconstructionMeta?.point_count ||
    mission?.reconstruction?.dense_point_count ||
    mission?.reconstruction?.point_count ||
    mission?.reconstruction?.sparse_point_count ||
    null;

  const meshVertices =
    reconstructionMeta?.mesh?.vertices ||
    mission?.reconstruction?.mesh_vertex_count ||
    mission?.reconstruction?.surface_mesh?.vertices ||
    null;

  const scaleStatus =
    reconstructionMeta?.scale?.scale_status ||
    mission?.reconstruction?.scale?.scale_status ||
    mission?.scale_status ||
    "CALIBRATED (COLMAP)";

  const poseStatus =
    reconstructionMeta?.pose_status ||
    mission?.reconstruction?.pose_status ||
    (cameraPoses && cameraPoses.length > 0 ? "AVAILABLE" : null);

  const isPoseUnavailable =
    poseStatus === "UNAVAILABLE_NO_TELEMETRY" ||
    (!cameraPoses && !mission?.reconstruction?.camera_poses && !reconstructionMeta?.camera_poses);

  return (
    <ErrorBoundary
      sectionName="3D Reconstruction Viewer"
      fallbackTitle="Something went wrong displaying this section"
    >
      <div
        ref={containerRef}
        className="reconstruction-canvas"
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <WebGLBoundary>
          <Canvas
            key={contextVersion}
            camera={{ position: [10, 20, 30], fov: 45, near: 0.1, far: 2500 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
            onCreated={({ gl, scene, camera }) => {
              window.__threeDebug = { gl, scene, camera };
              gl.setClearColor("#061017");
            }}
          >
            <Suspense fallback={null}>
              <RendererLifecycleManager
                onContextLost={handleContextLost}
                onContextRestored={handleContextRestored}
              />
              <Scene
                layers={effectiveLayers}
                mode={mode}
                mission={mission}
                meshUrl={meshUrl}
                pointCloudUrl={pointCloudUrl}
                reconstructionMeta={reconstructionMeta}
                onFinding={onFinding}
                onSelectObject={onSelectObject}
                selectedObject={selectedObject}
                cameraPoses={cameraPoses}
                semanticObjects={semanticObjects}
                cameraTarget={cameraTarget}
                activeTool={activeTool}
                cameraActionsRef={cameraActionsRef}
                onSelectCamera={handleSelectCamera}
                selectedCameraId={selectedCameraId}
                customMarkings={customMarkings}
                selectedMarkingId={selectedMarkingId}
                onSelectMarking={onSelectMarking}
                onSceneClick={onSceneClick}
              />
            </Suspense>
          </Canvas>
        </WebGLBoundary>

        {/* Empty State Warning Overlay */}
        {!hasMesh && !hasPointCloud && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(6, 16, 23, 0.75)",
              backdropFilter: "blur(4px)",
              color: "#94a3b8",
              textAlign: "center",
              padding: "20px",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.5"
              style={{ marginBottom: "12px", opacity: 0.8 }}
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <h4
              style={{
                margin: "0 0 6px 0",
                color: "#f1f5f9",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              No Reconstructed Geometry Available
            </h4>
            <p
              style={{
                margin: 0,
                fontSize: "11px",
                maxWidth: "320px",
                lineHeight: 1.5,
                color: "#94a3b8",
              }}
            >
              This mission does not have an active 3D surface mesh or point cloud
              on disk. Run photogrammetric reconstruction in Flight Processing to
              generate geometry.
            </p>
          </div>
        )}

        {/* Embedded HUD and Controls (shown only when hideEmbeddedControls is false) */}
        {!hideEmbeddedControls && (
          <>
            {/* Top HUD Status */}
            <div className="viewer-hud top">
              <span>
                <i /> {sceneType ? `LIVE 3D RECONSTRUCTION · ${sceneType.toUpperCase()}` : "LIVE 3D RECONSTRUCTION"}
              </span>
              <b>
                {hasMesh
                  ? (sceneTypeTag ? `${sceneTypeTag} · PRIMARY SURFACE MESH` : "PRIMARY SURFACE MESH")
                  : hasPointCloud
                    ? "POINT CLOUD (Mesh not yet generated)"
                    : "NO RECONSTRUCTION DATA"}
              </b>
              {isPoseUnavailable && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    marginLeft: "12px",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: "rgba(245, 158, 11, 0.2)",
                    color: "#fbbf24",
                    fontSize: "11px",
                    fontWeight: 600,
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                  }}
                  title="No per-frame GPS/IMU telemetry was available for this flight. Trajectory rendering is disabled."
                >
                  ● Camera trajectory not available (no telemetry for this flight)
                </span>
              )}
            </div>

            {/* Layer Toggle Pills Overlay */}
            <div
              style={{
                position: "absolute",
                top: "46px",
                left: "14px",
                display: "flex",
                gap: "6px",
                zIndex: 10,
                flexWrap: "wrap",
              }}
            >
              {[
                {
                  key: "pointsOnly",
                  label: "Points Only",
                  available: hasPointCloud,
                  active: effectiveLayers.pointsOnly === true,
                },
                {
                  key: "mesh",
                  label: "Mesh",
                  available: hasMesh,
                  active:
                    effectiveLayers.mesh !== false &&
                    effectiveLayers.pointsOnly !== true,
                },
                {
                  key: "pointCloud",
                  label: "Cloud Overlay",
                  available: hasPointCloud,
                  active:
                    effectiveLayers.pointCloud === true ||
                    effectiveLayers.pointsOnly === true ||
                    (!hasMesh && effectiveLayers.pointCloud !== false),
                },
                {
                  key: "semanticObjects",
                  label: "Objects",
                  available: true,
                  active: effectiveLayers.semanticObjects !== false,
                },
                {
                  key: "cameraTrajectory",
                  label: "Flight",
                  available: true,
                  active: effectiveLayers.cameraTrajectory !== false,
                },
                {
                  key: "grid",
                  label: "Grid",
                  available: true,
                  active: effectiveLayers.grid !== false,
                },
                {
                  key: "labels",
                  label: "Labels",
                  available: true,
                  active: effectiveLayers.labels !== false,
                },
              ].map(({ key, label, available, active }) => {
                return (
                  <button
                    key={key}
                    onClick={() => toggleLayer(key)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                      background: active
                        ? "rgba(56, 215, 255, 0.25)"
                        : "rgba(15, 23, 42, 0.75)",
                      border: active
                        ? "1px solid #38d7ff"
                        : "1px solid rgba(255, 255, 255, 0.12)",
                      color: active ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
                      opacity: available ? 1 : 0.4,
                      pointerEvents: available ? "auto" : "none",
                      backdropFilter: "blur(4px)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Viewport Action Controls (Zoom, Fit, Reset, Fullscreen) */}
            <div
              style={{
                position: "absolute",
                bottom: "36px",
                left: "14px",
                display: "flex",
                gap: "6px",
                zIndex: 10,
                background: "rgba(6, 16, 23, 0.82)",
                padding: "6px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                backdropFilter: "blur(8px)",
              }}
            >
              <button
                onClick={() => cameraActionsRef.current.zoomIn?.()}
                style={navBtnStyle}
                title="Zoom In"
              >
                ＋
              </button>
              <button
                onClick={() => cameraActionsRef.current.zoomOut?.()}
                style={navBtnStyle}
                title="Zoom Out"
              >
                －
              </button>
              <button
                onClick={() => cameraActionsRef.current.fit?.()}
                style={navBtnStyle}
                title="Fit Model to Viewport"
              >
                ⛶ Fit
              </button>
              <button
                onClick={() => cameraActionsRef.current.reset?.()}
                style={navBtnStyle}
                title="Reset Camera Overview"
              >
                ⟲ Reset
              </button>
              <button
                onClick={toggleFullscreen}
                style={navBtnStyle}
                title="Toggle Fullscreen"
              >
                Fullscreen
              </button>
            </div>
          </>
        )}

        {/* Selected Object Info Card */}
        {selectedObject && (
          <div
            style={{
              position: "absolute",
              bottom: "36px",
              right: "14px",
              background: "rgba(6, 16, 23, 0.9)",
              border: "1px solid rgba(56, 215, 255, 0.3)",
              borderRadius: "8px",
              padding: "10px 14px",
              color: "#f8fafc",
              fontSize: "12px",
              zIndex: 10,
              maxWidth: "260px",
              backdropFilter: "blur(8px)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "6px",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                paddingBottom: "4px",
              }}
            >
              <span style={{ fontWeight: "bold", color: "#38d7ff" }}>
                {selectedObject.object_id ||
                  selectedObject.track_id ||
                  selectedObject.id ||
                  "Object"}
              </span>
              <button
                onClick={() => onSelectObject?.(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "rgba(255,255,255,0.6)",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
                title="Close card"
              >
                ✕
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div>
                Class:{" "}
                <b style={{ color: "#38d7ff" }}>
                  {selectedObject.class || selectedObject.class_name}
                </b>
              </div>
              {selectedObject.position_3d && (
                <div>
                  3D Pos:{" "}
                  <span style={{ fontFamily: "monospace", color: "#e2e8f0" }}>
                    [
                    {selectedObject.position_3d
                      .map((v) => Number(v).toFixed(2))
                      .join(", ")}
                    ]
                  </span>
                </div>
              )}
              <div>
                Motion:{" "}
                <b
                  style={{
                    color:
                      selectedObject.motion_state === "MOVING"
                        ? "#f97316"
                        : "#22d3ee",
                  }}
                >
                  {selectedObject.motion_state || "STATIC"}
                </b>
              </div>
              {selectedObject.association_status && (
                <div>
                  Status: <span>{selectedObject.association_status}</span>
                </div>
              )}
              {selectedObject.reprojection_error && (
                <div>
                  Reproj Error:{" "}
                  <span>{selectedObject.reprojection_error} px</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State Overlay when no reconstruction exists */}
        {!isReal && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(6, 16, 23, 0.75)",
              zIndex: 5,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                padding: "24px 32px",
                background: "rgba(15, 23, 42, 0.85)",
                border: "1px solid rgba(56, 215, 255, 0.2)",
                borderRadius: "12px",
                textAlign: "center",
                backdropFilter: "blur(12px)",
                maxWidth: "420px",
              }}
            >
              <div style={{ fontSize: "28px", marginBottom: "8px" }}>📦</div>
              <h4
                style={{
                  margin: "0 0 8px 0",
                  color: "#38d7ff",
                  fontSize: "16px",
                }}
              >
                Awaiting 3D Reconstruction
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  color: "rgba(255, 255, 255, 0.65)",
                  lineHeight: 1.5,
                }}
              >
                No photogrammetry model generated yet for this mission. Upload a
                drone video and run the pipeline to produce the 3D surface mesh.
              </p>
            </div>
          </div>
        )}

        {/* Bottom Coordinate & Scale HUD */}
        <div className="viewer-hud bottom">
          Coordinate System: <b>LOCAL_ARBITRARY</b> · Scale: <b>{scaleStatus}</b>
        </div>

        {/* Schematic Notice Label */}
        <div className="viewer-schematic-label" aria-label="Schematic notice">
          {hasMesh
            ? `AUTHORITATIVE REAL 3D MESH (${meshVertices ? `${meshVertices.toLocaleString()} vertices` : "Poisson Mesh"} · Scale: ${scaleStatus})`
            : hasPointCloud
              ? `POINT CLOUD ONLY (${pointCount ? `${Number(pointCount).toLocaleString()} points` : "Dense Cloud"} · Mesh not yet generated)`
              : "NO 3D MODEL AVAILABLE (Awaiting reconstruction)"}
        </div>

        {/* Legend */}
        <div className="recon-legend" aria-label="Reconstruction legend">
          <span className="cyan">CYAN static object</span>
          <span className="amber">AMBER moving object</span>
          <span className="blue">BLUE surface mesh</span>
          <span className="purple">PURPLE AI findings</span>
        </div>

        {/* North Indicator */}
        <div className="viewer-north" aria-label="North orientation">
          N <i>↑</i>
        </div>
      </div>
    </ErrorBoundary>
  );
}

const navBtnStyle = {
  background: "rgba(255, 255, 255, 0.08)",
  border: "1px solid rgba(255, 255, 255, 0.15)",
  color: "#ffffff",
  borderRadius: "6px",
  padding: "4px 8px",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "background 0.15s ease",
};
