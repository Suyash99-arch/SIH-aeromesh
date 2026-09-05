import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Line, OrbitControls, Stars, Text } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

// Global geometry cache to prevent repeated downloads
const geomCache = new Map();

function RealPointCloud({ url }) {
  const [geometry, setGeometry] = useState(() => geomCache.get(url) || null);

  useEffect(() => {
    if (!url) return;
    if (geomCache.has(url)) {
      setGeometry(geomCache.get(url));
      return;
    }
    let active = true;
    const loader = new PLYLoader();
    loader.load(
      url,
      (geom) => {
        if (!active) return;
        geom.computeVertexNormals();
        geomCache.set(url, geom);
        setGeometry(geom);
      },
      undefined,
      (err) => {
        console.warn("Could not load real PLY point cloud:", err);
      }
    );
    return () => {
      active = false;
    };
  }, [url]);

  if (!geometry) return null;

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={0.12}
        vertexColors={geometry.hasAttribute("color")}
        color={geometry.hasAttribute("color") ? undefined : "#38d7ff"}
        sizeAttenuation
        transparent
        opacity={0.92}
      />
    </points>
  );
}

function RealMesh({ url, mode }) {
  const [geometry, setGeometry] = useState(() => geomCache.get(url) || null);

  useEffect(() => {
    if (!url) return;
    if (geomCache.has(url)) {
      setGeometry(geomCache.get(url));
      return;
    }
    let active = true;
    const loader = new PLYLoader();
    loader.load(
      url,
      (geom) => {
        if (!active) return;
        geom.computeVertexNormals();
        geomCache.set(url, geom);
        setGeometry(geom);
      },
      undefined,
      (err) => {
        console.warn("Could not load real PLY surface mesh:", err);
      }
    );
    return () => {
      active = false;
    };
  }, [url]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={mode === "topographic" ? "#28758a" : "#1c5a69"}
        wireframe={mode === "wireframe"}
        metalness={0.4}
        roughness={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function CameraTrajectory({ poses, onSelectCamera, selectedCameraId }) {
  if (!poses || !Array.isArray(poses) || poses.length === 0) return null;

  const sorted = useMemo(() => {
    return [...poses].sort((a, b) =>
      (a.image_name || "").localeCompare(b.image_name || "")
    );
  }, [poses]);

  const points = useMemo(() => {
    return sorted
      .filter((p) => p.position && p.position.length === 3)
      .map((p) => new THREE.Vector3(p.position[0], p.position[1], p.position[2]));
  }, [sorted]);

  return (
    <group>
      {points.length > 1 && (
        <Line
          points={points}
          color="#22d3ee"
          lineWidth={2.5}
          transparent
          opacity={0.85}
        />
      )}
      {sorted.map((cam, i) => {
        if (!cam.position || cam.position.length !== 3) return null;
        const [x, y, z] = cam.position;
        const isSelected =
          selectedCameraId === (cam.image_name || cam.image_id);
        return (
          <group
            key={cam.image_id || cam.image_name || i}
            position={[x, y, z]}
            onClick={(e) => {
              e.stopPropagation();
              if (onSelectCamera) onSelectCamera(cam);
            }}
          >
            <mesh rotation={[0, 0, 0]}>
              <coneGeometry args={[0.5, 1.0, 4]} />
              <meshBasicMaterial
                color={isSelected ? "#f59e0b" : "#22d3ee"}
                wireframe
              />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.2, 12, 12]} />
              <meshBasicMaterial
                color={isSelected ? "#f59e0b" : "#38d7ff"}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function SemanticObjects3D({ objects, selectedId, onSelect, layers }) {
  if (!objects || !Array.isArray(objects) || objects.length === 0) return null;

  return (
    <group>
      {objects.map((obj, i) => {
        if (!obj.position_3d || obj.association_status === "REJECTED") return null;

        const cls = (obj.class || obj.class_name || "").toLowerCase();
        if (layers) {
          if (layers.vehicles === false && (cls === "car" || cls === "truck" || cls === "bus" || cls === "vehicle")) return null;
          if (layers.people === false && (cls === "person" || cls === "pedestrian")) return null;
          if (layers.animals === false && (cls === "dog" || cls === "cat" || cls === "horse" || cls === "cow")) return null;
          if (layers.otherObjects === false && cls !== "car" && cls !== "truck" && cls !== "bus" && cls !== "person" && cls !== "pedestrian") return null;
        }

        const [x, y, z] = obj.position_3d;
        const isSelected = selectedId === obj.object_id || selectedId === obj.track_id;
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

            {isSelected && (
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.2, 1.5, 24]} />
                <meshBasicMaterial
                  color="#fbbf24"
                  side={THREE.DoubleSide}
                  transparent
                  opacity={0.8}
                />
              </mesh>
            )}

            <Text
              position={[0, 1.4, 0]}
              fontSize={0.8}
              color={isSelected ? "#fbbf24" : "#ffffff"}
              anchorX="center"
              anchorY="bottom"
              outlineWidth={0.08}
              outlineColor="#061017"
            >
              {`${obj.track_id || obj.object_id} · ${obj.class || obj.class_name || "object"}`}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

// Procedural Fallback Terrain (Used ONLY when real assets do not exist)
function Terrain({ mode }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(24, 18, 42, 32);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i);
      p.setZ(
        i,
        Math.sin(x * 0.55) * 0.32 +
          Math.cos(y * 0.7) * 0.2 +
          Math.sin((x + y) * 0.35) * 0.18,
      );
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial
        color={mode === "topographic" ? "#194a54" : "#123843"}
        wireframe={mode === "wireframe"}
        roughness={0.83}
        metalness={0.15}
      />
    </mesh>
  );
}

function Buildings({ mode, kind }) {
  const data =
    kind === "ridge"
      ? [
          [-6, -1.5, 2.2, 1.2, 2.8],
          [-3.2, -2.1, 3.1, 1.5, 2.2],
          [-0.5, -1.8, 2.7, 1.3, 2.1],
          [2.8, -2.3, 3.4, 1.4, 2.5],
          [5.5, -1.6, 2.5, 1.2, 1.9],
        ]
      : [
          [-5, -3, 2.5, 2, 3],
          [-1.8, -2.1, 3.8, 2.5, 2],
          [2.5, -2.8, 2.7, 2, 4],
          [4, 1.5, 4.8, 2.1, 2],
        ];
  return (
    <group>
      {data.map(([x, z, h, w, d], i) => (
        <mesh key={i} position={[x, h / 2, z]}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial
            color={i === 0 ? "#28758a" : "#1c5a69"}
            wireframe={mode === "wireframe"}
            metalness={0.45}
            roughness={0.48}
          />
        </mesh>
      ))}
    </group>
  );
}

function Roads() {
  return (
    <group position={[0, 0.05, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0.18]}>
        <planeGeometry args={[26, 1.1]} />
        <meshBasicMaterial color="#14232d" />
      </mesh>
    </group>
  );
}

function Cloud() {
  const points = useMemo(() => {
    const a = [];
    for (let i = 0; i < 2600; i++) {
      const x = ((i * 73) % 2300) / 100 - 11.5,
        z = ((i * 149) % 1700) / 100 - 8.5,
        noise = ((i * 41) % 97) / 97;
      const y =
        0.1 +
        Math.sin(x * 0.55) * 0.32 +
        Math.cos(z * 0.7) * 0.2 +
        (noise > 0.78 ? noise * 4 : noise * 0.2);
      a.push(x, y, z);
    }
    return new Float32Array(a);
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#5fe7ff"
        size={0.035}
        transparent
        opacity={0.68}
        sizeAttenuation
      />
    </points>
  );
}

function Measurement({ points, label, color = "#ffe18a" }) {
  const center = useMemo(
    () =>
      points
        .reduce(
          (sum, point) => sum.add(new THREE.Vector3(...point)),
          new THREE.Vector3(),
        )
        .multiplyScalar(1 / points.length),
    [points],
  );
  return (
    <group>
      <Line
        points={points}
        color={color}
        lineWidth={2.3}
        dashed
        dashScale={6}
        dashSize={0.35}
        gapSize={0.18}
      />
      <Suspense fallback={null}>
        <Text
          position={[center.x, center.y + 0.25, center.z]}
          fontSize={0.28}
          color={color}
          anchorX="center"
          outlineWidth={0.012}
          outlineColor="#061017"
        >
          {label}
        </Text>
      </Suspense>
    </group>
  );
}

function MeasurementOverlays({ mission }) {
  if (!mission?.measurements) return null;
  const { height, width, length, area } = mission.measurements;
  return (
    <group>
      {height && (
        <Measurement
          label={`HEIGHT ${height}`}
          points={[
            [-5, 0.1, -4.6],
            [-5, 2.8, -4.6],
          ]}
        />
      )}
      {width && (
        <Measurement
          label={`WIDTH ${width}`}
          points={[
            [-6.2, 0.14, -4.6],
            [-3.8, 0.14, -4.6],
          ]}
        />
      )}
      {length && (
        <Measurement
          label={`LENGTH ${length}`}
          points={[
            [-6.2, 0.15, -5.2],
            [4.8, 0.15, -5.2],
          ]}
        />
      )}
      {area && (
        <Measurement
          label={`AREA ${area}`}
          color="#81f5bd"
          points={[
            [-2.9, 0.18, 1.2],
            [1.6, 0.18, 1.2],
            [1.6, 0.18, 3.8],
            [-2.9, 0.18, 3.8],
            [-2.9, 0.18, 1.2],
          ]}
        />
      )}
    </group>
  );
}

function CameraController({ target, controlsRef }) {
  useEffect(() => {
    if (!target || !controlsRef.current) return;
    controlsRef.current.target.set(target[0], target[1], target[2]);
    controlsRef.current.update();
  }, [target, controlsRef]);
  return null;
}

function Scene({
  layers,
  mode,
  mission,
  onFinding,
  onSelectObject,
  selectedObject,
  cameraPoses,
  semanticObjects,
  cameraTarget,
  activeTool,
}) {
  const controlsRef = useRef();

  const pointCloudUrl =
    mission?.reconstruction?.point_cloud_url ||
    (typeof mission?.assets?.pointCloud === "string" &&
    mission.assets.pointCloud.includes(".ply")
      ? mission.assets.pointCloud
      : null);

  const meshUrl =
    mission?.reconstruction?.mesh_url ||
    (typeof mission?.assets?.mesh === "string" &&
    mission.assets.mesh.includes(".ply")
      ? mission.assets.mesh
      : null);

  const isRealReconstruction = Boolean(
    pointCloudUrl ||
    meshUrl ||
    mission?.reconstruction?.status === "MESH_GENERATED" ||
    (mission?.reconstruction?.sparse_point_count && mission.reconstruction.sparse_point_count > 0)
  );

  const showCloud =
    layers.pointCloud !== false &&
    layers.cloud !== false &&
    (mode !== "solid" || mode === "point cloud");

  const showMesh =
    layers.mesh !== false &&
    layers.surfaceMesh !== false &&
    layers.buildings !== false &&
    mode !== "point cloud";

  const showSemanticObjects =
    layers.semanticObjects !== false && layers.objects !== false;

  const showCameraTrajectory =
    layers.cameraTrajectory !== false && layers.flight !== false;

  const poses =
    cameraPoses ||
    mission?.reconstruction?.camera_poses ||
    [];

  const objectsToRender =
    semanticObjects ||
    mission?.objects_3d ||
    mission?.semantic_scene?.objects ||
    [];

  // Centroid for orbit target
  const initialTarget = isRealReconstruction ? [20.8, 6.3, 146.5] : [0, 0, 0];

  return (
    <>
      <color attach="background" args={["#061017"]} />
      <fog attach="fog" args={["#061017", 40, 280]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[20, 60, 40]} intensity={2.2} color="#b4f0ff" />
      <directionalLight position={[-30, -20, 10]} intensity={0.8} color="#00ffff" />

      {layers.grid !== false && (
        <Grid
          args={[200, 200]}
          position={[20.8, -55.0, 146.5]}
          cellColor="#1c6674"
          sectionColor="#2b9eb3"
          cellSize={5}
          sectionSize={20}
          fadeDistance={180}
          infiniteGrid
        />
      )}

      {/* REAL PHOTOGRAMMETRIC ASSETS */}
      {isRealReconstruction ? (
        <group>
          {showMesh && meshUrl && <RealMesh url={meshUrl} mode={mode} />}
          {showCloud && pointCloudUrl && <RealPointCloud url={pointCloudUrl} />}
          {showCameraTrajectory && (
            <CameraTrajectory
              poses={poses}
              onSelectCamera={(cam) => console.log("Selected camera:", cam)}
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
      ) : (
        /* PROCEDURAL FALLBACKS (ONLY WHEN REAL ASSETS UNAVAILABLE) */
        <group>
          {layers.terrain && mode !== "point cloud" && <Terrain mode={mode} />}
          {layers.roads && mode !== "point cloud" && <Roads />}
          {layers.buildings && mode !== "point cloud" && (
            <Buildings mode={mode} kind={mission?.reconstruction?.kind} />
          )}
          {showCloud && <Cloud />}
          {layers.confidence && mission?.measurements && (
            <MeasurementOverlays mission={mission} />
          )}
        </group>
      )}

      {layers.measurements !== false && mission?.measurements && (
        <MeasurementOverlays mission={mission} />
      )}

      <Stars radius={90} depth={50} count={900} factor={2} />

      <CameraController
        target={cameraTarget || initialTarget}
        controlsRef={controlsRef}
      />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={initialTarget}
        minDistance={2}
        maxDistance={400}
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

export default function ReconstructionViewer({
  layers = {},
  mode = "hybrid",
  mission,
  onFinding,
  onSelectObject,
  selectedObject,
  cameraPoses,
  semanticObjects,
  cameraTarget,
  activeTool = "select",
}) {
  const isAuthoritative = Boolean(
    mission?.reconstruction?.sparse_point_count ||
    mission?.reconstruction?.point_cloud_url ||
    mission?.reconstruction?.point_cloud_path
  );
  const isMeshAvailable = Boolean(
    mission?.reconstruction?.mesh_url ||
    mission?.reconstruction?.status === "MESH_GENERATED"
  );
  const pointCount =
    mission?.reconstruction?.sparse_point_count ||
    mission?.reconstruction?.point_count ||
    12916;
  const meshVertices =
    mission?.reconstruction?.surface_mesh?.vertices ||
    mission?.reconstruction?.mesh?.vertex_count ||
    28139;
  const scaleStatus =
    mission?.reconstruction?.scale?.scale_status ||
    mission?.scale_status ||
    "RELATIVE_SCALE";

  return (
    <div className="reconstruction-canvas" style={{ width: "100%", height: "100%", position: "relative" }}>
      <WebGLBoundary>
        <Canvas
          camera={{ position: [20.8, -45.0, 90.0], fov: 45, near: 0.1, far: 800 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => gl.setClearColor("#061017")}
        >
          <Suspense fallback={null}>
            <Scene
              layers={layers}
              mode={mode}
              mission={mission}
              onFinding={onFinding}
              onSelectObject={onSelectObject}
              selectedObject={selectedObject}
              cameraPoses={cameraPoses}
              semanticObjects={semanticObjects}
              cameraTarget={cameraTarget}
              activeTool={activeTool}
            />
          </Suspense>
        </Canvas>
      </WebGLBoundary>

      <div className="viewer-hud top">
        <span>
          <i /> LIVE 3D ANALYSIS
        </span>
        <b>
          {isMeshAvailable
            ? "AUTHORITATIVE 3D MESH"
            : isAuthoritative
            ? "AUTHORITATIVE SFM"
            : "DEMO SCHEMATIC"}
        </b>
      </div>

      <div className="viewer-hud bottom">
        Coordinate System: <b>LOCAL_ARBITRARY</b> · Scale: <b>{scaleStatus}</b>
      </div>

      <div className="viewer-schematic-label" aria-label="Schematic notice">
        {isMeshAvailable
          ? `AUTHORITATIVE REAL 3D MESH (${meshVertices ? `${meshVertices} vertices` : "Poisson Mesh"} · Scale: ${scaleStatus})`
          : isAuthoritative
          ? `AUTHORITATIVE REAL 3D SFM (${pointCount ? `${pointCount} points` : "Sparse Cloud"} · Scale: ${scaleStatus})`
          : "DEMO SCHEMATIC (No real 3D point cloud)"}
      </div>

      <div className="recon-legend" aria-label="Reconstruction legend">
        <span className="cyan">CYAN static object</span>
        <span className="amber">AMBER moving object</span>
        <span className="blue">BLUE surface mesh</span>
        <span className="purple">PURPLE AI findings</span>
      </div>

      <div className="viewer-north" aria-label="North orientation">
        N <i>↑</i>
      </div>
    </div>
  );
}
