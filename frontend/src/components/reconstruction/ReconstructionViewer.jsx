import { Canvas } from "@react-three/fiber";
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

// Global cache to prevent repeated geometry re-downloads
const geomCache = new Map();

/**
 * Real Point Cloud Renderer
 * Visualizes dense or sparse photogrammetric point clouds using PLY format.
 */
function RealPointCloud({ url, onBoundsComputed }) {
  const [geometry, setGeometry] = useState(() => {
    const cached = geomCache.get(url);
    return cached?.geometry || null;
  });

  useEffect(() => {
    if (!url) return;
    if (geomCache.has(url)) {
      const cached = geomCache.get(url);
      if (cached?.geometry) {
        if (geometry !== cached.geometry) {
          const raf = requestAnimationFrame(() => setGeometry(cached.geometry));
          return () => cancelAnimationFrame(raf);
        }
        if (onBoundsComputed && cached.bounds) {
          onBoundsComputed(cached.bounds);
        }
      }
      return;
    }

    let active = true;
    const loader = new PLYLoader();
    loader.load(
      url,
      (geom) => {
        if (!active) return;
        geom.computeVertexNormals();
        geom.computeBoundingBox();

        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        if (geom.boundingBox) {
          geom.boundingBox.getCenter(center);
          geom.boundingBox.getSize(size);
        }
        const radius = Math.max(size.x, size.y, size.z) / 2 || 15;
        const bounds = {
          center: [center.x, center.y, center.z],
          size: [size.x, size.y, size.z],
          radius,
        };

        geomCache.set(url, { geometry: geom, bounds });
        setGeometry(geom);
        if (onBoundsComputed) onBoundsComputed(bounds);
        // Diagnostic logging for blob debugging
        console.log("[DEBUG] RealPointCloud loaded:", {
          pointCount: geom.attributes.position?.count,
          bounds,
          url: url.substring(url.lastIndexOf("/") + 1),
        });
      },
      undefined,
      (err) => {
        console.warn("Could not load real PLY point cloud:", err);
      },
    );

    return () => {
      active = false;
    };
  }, [url, onBoundsComputed]);

  if (!geometry) return null;

  return (
    <points geometry={geometry}>
      <pointsMaterial
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
 */
function RealMesh({ url, mode, onBoundsComputed }) {
  const [meshData, setMeshData] = useState(() => geomCache.get(url) || null);

  useEffect(() => {
    if (!url) return;
    if (geomCache.has(url)) {
      const cached = geomCache.get(url);
      if (meshData !== cached) {
        const raf = requestAnimationFrame(() => setMeshData(cached));
        return () => cancelAnimationFrame(raf);
      }
      if (onBoundsComputed && cached?.bounds) {
        onBoundsComputed(cached.bounds);
      }
      return;
    }

    let active = true;

    async function loadMesh() {
      try {
        const res = await fetch(url);
        if (!res.ok)
          throw new Error(`Mesh fetch failed with HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (!active) return;

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

        if (isGLB || url.endsWith(".glb") || url.endsWith(".gltf")) {
          const loader = new GLTFLoader();
          loader.parse(
            buffer,
            "",
            (gltf) => {
              if (!active) return;
              const box = new THREE.Box3().setFromObject(gltf.scene);
              const center = new THREE.Vector3();
              const size = new THREE.Vector3();
              box.getCenter(center);
              box.getSize(size);
              const radius = Math.max(size.x, size.y, size.z) / 2 || 15;
              const bounds = {
                center: [center.x, center.y, center.z],
                size: [size.x, size.y, size.z],
                radius,
              };

              const data = { type: "gltf", scene: gltf.scene, bounds };
              geomCache.set(url, data);
              setMeshData(data);
              if (onBoundsComputed) onBoundsComputed(bounds);
            },
            (err) => {
              console.warn("[DEBUG] GLTFLoader parse error:", err, url);
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
          const bounds = {
            center: [center.x, center.y, center.z],
            size: [size.x, size.y, size.z],
            radius,
          };

          const data = { type: "obj", scene: obj, bounds };
          console.log("[DEBUG] RealMesh (OBJ) loaded:", {
            bounds,
            url: url.substring(url.lastIndexOf("/") + 1),
          });
          geomCache.set(url, data);
          setMeshData(data);
          if (onBoundsComputed) onBoundsComputed(bounds);
        } else {
          // Fallback to PLY surface mesh
          const loader = new PLYLoader();
          const geom = loader.parse(buffer);
          geom.computeVertexNormals();
          geom.computeBoundingBox();

          const center = new THREE.Vector3();
          const size = new THREE.Vector3();
          if (geom.boundingBox) {
            geom.boundingBox.getCenter(center);
            geom.boundingBox.getSize(size);
          }
          const radius = Math.max(size.x, size.y, size.z) / 2 || 15;
          const bounds = {
            center: [center.x, center.y, center.z],
            size: [size.x, size.y, size.z],
            radius,
          };

          const data = { type: "geometry", geometry: geom, bounds };
          geomCache.set(url, data);
          setMeshData(data);
          if (onBoundsComputed) onBoundsComputed(bounds);
          console.log("[DEBUG] RealMesh (PLY) loaded:", {
            vertexCount: geom.attributes.position?.count,
            bounds,
            url: url.substring(url.lastIndexOf("/") + 1),
          });
        }
      } catch (err) {
        console.warn("Could not load real surface mesh:", err);
        console.warn("[DEBUG] Could not load real surface mesh:", err, url);
      }
    }

    loadMesh();
    return () => {
      active = false;
    };
  }, [url, onBoundsComputed]);

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

  return (
    <mesh geometry={meshData.geometry}>
      <meshStandardMaterial
        color={mode === "topographic" ? "#28758a" : "#1c5a69"}
        wireframe={mode === "wireframe"}
        metalness={0.25}
        roughness={0.7}
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
              cls === "vehicle")
          )
            return null;
          if (
            layers.people === false &&
            (cls === "person" || cls === "pedestrian" || cls === "people")
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

        const [x, y, z] = obj.position_3d;
        const isSelected =
          selectedId === obj.object_id || selectedId === obj.track_id;
        const motionState = (obj.motion_state || "STATIC").toUpperCase();

        const color =
          motionState === "MOVING"
            ? "#f97316"
            : motionState === "STATIC"
              ? "#22d3ee"
              : "#a855f7";

        return (
          <group
            key={obj.object_id || i}
            position={[x, y, z]}
            onClick={(e) => {
              e.stopPropagation();
              if (onSelect) onSelect(obj);
            }}
          >
            {/* Sphere center marker */}
            <mesh>
              <sphereGeometry args={[isSelected ? 0.9 : 0.6, 16, 16]} />
              <meshStandardMaterial
                color={isSelected ? "#fbbf24" : color}
                emissive={isSelected ? "#fbbf24" : color}
                emissiveIntensity={isSelected ? 1.0 : 0.6}
                roughness={0.2}
                metalness={0.8}
              />
            </mesh>

            {/* Selection highlight ring */}
            {isSelected && (
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.2, 1.6, 24]} />
                <meshBasicMaterial
                  color="#fbbf24"
                  side={THREE.DoubleSide}
                  transparent
                  opacity={0.85}
                />
              </mesh>
            )}

            {/* 3D Label */}
            {layers.labels !== false && (
              <Text
                position={[0, 1.5, 0]}
                fontSize={0.85}
                color={isSelected ? "#fbbf24" : "#ffffff"}
                anchorX="center"
                anchorY="bottom"
                outlineWidth={0.08}
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
}) {
  const controlsRef = useRef();
  const hasAutoFramedRef = useRef(false);
  const [modelBounds, setModelBounds] = useState(null);

  const pointCloudUrl = useMemo(() => {
    const raw =
      propPointCloudUrl ||
      reconstructionMeta?.point_cloud_url ||
      mission?.reconstruction?.point_cloud_url ||
      mission?.assets?.pointCloud ||
      null;
    return raw ? resolveAssetUrl(raw) : null;
  }, [propPointCloudUrl, reconstructionMeta, mission]);

  const meshUrl = useMemo(() => {
    const raw =
      propMeshUrl ||
      reconstructionMeta?.mesh_url ||
      mission?.reconstruction?.mesh_url ||
      mission?.assets?.mesh ||
      null;
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

  // Hierarchy rules:
  // 1. If real mesh exists, mesh is PRIMARY.
  // 2. Point cloud is optional layer (default false if mesh exists; true if mesh is absent).
  const hasMesh = Boolean(meshUrl);
  const showMesh =
    layers.mesh !== false &&
    hasMesh &&
    mode !== "point cloud" &&
    layers.pointsOnly !== true;
  const showCloud =
    layers.pointCloud === true ||
    layers.pointsOnly === true ||
    (!hasMesh && layers.pointCloud !== false && Boolean(pointCloudUrl));

  const showSemanticObjects =
    layers.semanticObjects !== false && layers.objects !== false;
  const showCameraTrajectory =
    layers.cameraTrajectory !== false && layers.flight !== false;

  const poses = cameraPoses || mission?.reconstruction?.camera_poses || [];
  const objectsToRender =
    semanticObjects ||
    mission?.objects_3d ||
    mission?.semantic_scene?.objects ||
    [];

  const centroid = useMemo(() => {
    const c =
      reconstructionMeta?.centroid || mission?.reconstruction?.centroid;
    if (Array.isArray(c) && c.length === 3) return c;
    return [0.0, 1.5, 2.0];
  }, [mission, reconstructionMeta]);

  // Handle bounds calculation and automatic viewport framing
  const handleBoundsComputed = useCallback(
    (bounds) => {
      if (!bounds) return;
      setModelBounds(bounds);
      if (onBoundsReady) onBoundsReady(bounds);

      if (!hasAutoFramedRef.current && controlsRef.current) {
        hasAutoFramedRef.current = true;
        // Focus on the reconstruction corridor centroid rather than distant background geometry
        const focusTarget =
          Array.isArray(centroid) && centroid.length === 3
            ? centroid
            : bounds.center;
        const [cx, cy, cz] = focusTarget;
        const r = Math.min(bounds.radius || 15, 16.0);
        const fov = 45;
        const dist = (r / Math.sin((fov * Math.PI) / 360)) * 1.15;
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
    [onBoundsReady, centroid],
  );

  // Respond to cameraTarget prop
  useEffect(() => {
    if (!cameraTarget || !controlsRef.current) return;
    controlsRef.current.target.set(
      cameraTarget[0],
      cameraTarget[1],
      cameraTarget[2],
    );
    controlsRef.current.update();
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
      <fog attach="fog" args={["#061017", 60, 350]} />

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
        <group>
          {showMesh && meshUrl && (
            <RealMesh
              url={meshUrl}
              mode={mode}
              onBoundsComputed={handleBoundsComputed}
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
        </group>
      )}

      <Stars radius={120} depth={60} count={800} factor={2} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={centroid}
        minDistance={0.001}
        maxDistance={600}
        mouseButtons={{
          LEFT: activeTool === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: activeTool === "orbit" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

class WebGLBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="reconstruction-webgl-error" role="alert">
          <strong>3D VIEWER UNAVAILABLE</strong>
          <span>WebGL could not initialize on this device.</span>
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
}) {
  const containerRef = useRef();
  const cameraActionsRef = useRef({});
  const [internalLayers, setInternalLayers] = useState({});
  const [selectedCameraId, setSelectedCameraId] = useState(null);

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
        [key]: prev[key] !== undefined ? !prev[key] : !effectiveLayers[key],
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

  const meshUrl =
    propMeshUrl ||
    reconstructionMeta?.mesh_url ||
    mission?.reconstruction?.mesh_url ||
    (typeof mission?.assets?.mesh === "string" ? mission.assets.mesh : null);
  const pointCloudUrl =
    propPointCloudUrl ||
    reconstructionMeta?.point_cloud_url ||
    mission?.reconstruction?.point_cloud_url ||
    (typeof mission?.assets?.pointCloud === "string"
      ? mission.assets.pointCloud
      : null);

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

  return (
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
          camera={{ position: [10, 20, 30], fov: 45, near: 0.001, far: 800 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => gl.setClearColor("#061017")}
        >
          <Suspense fallback={null}>
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
            />
          </Suspense>
        </Canvas>
      </WebGLBoundary>

      {/* Honest Empty State if no 3D data exists */}
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
              <i /> LIVE 3D RECONSTRUCTION
            </span>
            <b>
              {hasMesh
                ? "PRIMARY SURFACE MESH"
                : hasPointCloud
                  ? "POINT CLOUD (Mesh not yet generated)"
                  : "NO RECONSTRUCTION DATA"}
            </b>
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
                  disabled={!available}
                  style={{
                    background:
                      active && available
                        ? "rgba(34, 211, 238, 0.2)"
                        : "rgba(6, 16, 23, 0.75)",
                    border:
                      active && available
                        ? "1px solid #22d3ee"
                        : "1px solid rgba(255, 255, 255, 0.15)",
                    color:
                      active && available
                        ? "#38d7ff"
                        : "rgba(255, 255, 255, 0.5)",
                    borderRadius: "14px",
                    padding: "3px 10px",
                    fontSize: "11px",
                    cursor: available ? "pointer" : "not-allowed",
                    fontWeight: 600,
                    backdropFilter: "blur(6px)",
                    transition: "all 0.15s ease",
                  }}
                  title={`Toggle ${label} visibility`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Navigation Tools Overlay (Bottom-Left) */}
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
            top: "84px",
            right: "14px",
            background: "rgba(6, 16, 23, 0.9)",
            border: "1px solid #fbbf24",
            borderRadius: "8px",
            padding: "12px 16px",
            color: "#ffffff",
            fontSize: "12px",
            zIndex: 15,
            minWidth: "220px",
            backdropFilter: "blur(10px)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontWeight: 700, color: "#fbbf24" }}>
              {selectedObject.object_id || selectedObject.track_id}
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
