import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Line, OrbitControls, Stars, Text } from "@react-three/drei";
import { Component, Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

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
          [-4.5, 1.2, 1.8, 2.2, 1.5],
          [1.5, 0.9, 2.1, 2.3, 1.4],
          [4.2, 1.5, 1.9, 1.8, 1.6],
        ]
      : kind === "bridge"
        ? [
            [-5, 0, 1.1, 3, 13],
            [0, 0, 1.1, 3, 13],
            [5, 0, 1.1, 3, 13],
            [-5, -5, 4, 0.7, 0.7],
            [0, -5, 4, 0.7, 0.7],
            [5, -5, 4, 0.7, 0.7],
          ]
        : kind === "river"
          ? [
              [-6, -3.8, 1.4, 3.8, 1.1],
              [-1.7, -3.8, 1.9, 2.8, 1.1],
              [2, -3.8, 1.2, 3.2, 1.1],
              [5.4, -3.8, 1.6, 2.3, 1.1],
              [-4.2, 3.5, 0.9, 4.5, 0.8],
              [1.1, 3.5, 1.1, 3.5, 0.8],
            ]
          : kind === "urban"
            ? [
                [-5, -3, 5, 2, 3],
                [-1.8, -2.1, 7, 2.5, 2],
                [2.5, -2.8, 6, 2, 4],
                [4, 1.5, 8, 2.1, 2],
                [0, 2.5, 4, 3.5, 1.4],
                [-5, 3, 6, 1.7, 2.7],
              ]
            : kind === "harbor"
              ? [
                  [-6.5, -2.5, 1.3, 2.5, 3.5],
                  [-2.1, -2.8, 1.6, 3, 3],
                  [2.2, -2.3, 1.4, 2.8, 3.2],
                  [5.6, -2.7, 1.8, 2.2, 2.8],
                  [-4.8, 2.2, 1.1, 2.8, 1.8],
                  [0.5, 2.5, 1.3, 3.2, 1.6],
                  [4.1, 2.8, 1.2, 2.3, 1.5],
                ]
              : [
                  [-5, -3, 2.5, 2, 3],
                  [-1.8, -2.1, 3.8, 2.5, 2],
                  [2.5, -2.8, 2.7, 2, 4],
                  [4, 1.5, 4.8, 2.1, 2],
                  [0, 2.5, 2.3, 3.5, 1.4],
                  [-5, 3, 1.8, 1.7, 2.7],
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
      <mesh rotation={[-Math.PI / 2, 0, -0.65]}>
        <planeGeometry args={[18, 0.85]} />
        <meshBasicMaterial color="#162a31" />
      </mesh>
    </group>
  );
}
function CoverageArea() {
  return (
    <mesh position={[0, 0.11, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[8.8, 48]} />
      <meshBasicMaterial color="#38d7ff" transparent opacity={0.055} />
    </mesh>
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
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current)
      ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.11) * 0.012;
  });
  return (
    <points ref={ref}>
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
function FlightPath() {
  const drone = useRef();
  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-9, 4, -6),
        new THREE.Vector3(-4, 5, 2),
        new THREE.Vector3(0, 3, 4),
        new THREE.Vector3(5, 5, 1),
        new THREE.Vector3(8, 3, -5),
      ]),
    [],
  );
  const pts = curve.getPoints(90);
  useFrame(({ clock }) => {
    if (drone.current)
      drone.current.position.copy(
        curve.getPointAt((clock.elapsedTime * 0.045) % 1),
      );
  });
  return (
    <>
      <Line
        points={pts}
        color="#38d7ff"
        lineWidth={1.8}
        transparent
        opacity={0.9}
      />
      <mesh ref={drone}>
        <octahedronGeometry args={[0.22]} />
        <meshBasicMaterial color="#b7f6ff" />
      </mesh>
    </>
  );
}
function Marker({ position, finding, onSelect }) {
  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(finding);
      }}
    >
      <mesh>
        <sphereGeometry args={[0.19, 16, 16]} />
        <meshBasicMaterial
          color={finding.severity === "critical" ? "#ff6978" : "#ffb15d"}
        />
      </mesh>
      <Suspense fallback={null}>
        <Text
          position={[0, 0.5, 0]}
          fontSize={0.22}
          color="#e5f8fc"
          anchorX="center"
        >
          {finding.title.toUpperCase()} · {finding.confidence}%
        </Text>
      </Suspense>
    </group>
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
  const { height, width, length, area } = mission.measurements;
  return (
    <group>
      <Measurement
        label={`HEIGHT ${height}`}
        points={[
          [-5, 0.1, -4.6],
          [-5, 2.8, -4.6],
        ]}
      />
      <Measurement
        label={`WIDTH ${width}`}
        points={[
          [-6.2, 0.14, -4.6],
          [-3.8, 0.14, -4.6],
        ]}
      />
      <Measurement
        label={`LENGTH ${length}`}
        points={[
          [-6.2, 0.15, -5.2],
          [4.8, 0.15, -5.2],
        ]}
      />
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
    </group>
  );
}
function Scene({ layers, mode, onFinding, mission }) {
  const cloudOnly = mode === "point cloud",
    showCloud = layers.cloud && (mode !== "solid" || cloudOnly);
  const positions = [
    [-5, 3.1, -3],
    [4, 5.5, 1.5],
    [1, 0.7, 3],
  ];

  if (!mission?.assets?.model && !mission?.assets?.pointCloud) {
    return (
      <group>
        <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[8.6, 32]} />
          <meshBasicMaterial color="#1b2d36" transparent opacity={0.6} />
        </mesh>
        <Text
          position={[0, 1.2, 0]}
          fontSize={0.4}
          color="#9bdbe7"
          anchorX="center"
          anchorY="middle"
        >
          ASSET NOT AVAILABLE
        </Text>
      </group>
    );
  }

  return (
    <>
      <color attach="background" args={["#061017"]} />
      <fog attach="fog" args={["#061017", 13, 35]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 12, 7]} intensity={2} color="#b4f0ff" />
      {layers.grid && (
        <Grid
          args={[24, 18]}
          position={[0, 0.08, 0]}
          cellColor="#1c6674"
          sectionColor="#2b9eb3"
          cellSize={0.5}
          sectionSize={2}
          fadeDistance={26}
          infiniteGrid
        />
      )}
      <CoverageArea />
      {layers.terrain && !cloudOnly && <Terrain mode={mode} />}{" "}
      {layers.roads && !cloudOnly && <Roads />}
      {layers.buildings && !cloudOnly && (
        <Buildings mode={mode} kind={mission.reconstruction.kind} />
      )}{" "}
      {showCloud && <Cloud />}
      {layers.flight && <FlightPath />}
      {layers.occlusion && (
        <mesh position={[1, 0.3, 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[2, 32]} />
          <meshBasicMaterial color="#ff6f7b" transparent opacity={0.34} />
        </mesh>
      )}
      {layers.findings &&
        mission.findings.map((f, i) => (
          <Marker
            key={f.id}
            position={positions[i]}
            finding={f}
            onSelect={onFinding}
          />
        ))}
      {layers.confidence && <MeasurementOverlays mission={mission} />}
      <Stars radius={45} depth={30} count={900} factor={2} />
      <OrbitControls
        makeDefault
        minDistance={7}
        maxDistance={32}
        maxPolarAngle={Math.PI / 2.08}
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
  layers,
  mode,
  onFinding,
  mission,
}) {
  return (
    <div className="reconstruction-canvas">
      <WebGLBoundary>
        <Canvas
          camera={{ position: [15, 14, 17], fov: 43 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => gl.setClearColor("#061017")}
        >
          <Suspense fallback={null}>
            <Scene
              layers={layers}
              mode={mode}
              onFinding={onFinding}
              mission={mission}
            />
          </Suspense>
        </Canvas>
      </WebGLBoundary>
      <div className="viewer-hud top">
        <span>
          <i /> LIVE VIEW
        </span>
        <b>MESH READY</b>
      </div>
      <div className="viewer-hud bottom">
        {mission.telemetry.position} <b>{mission.telemetry.gps}</b>
      </div>
      <div className="viewer-schematic-label" aria-label="Schematic notice">
        PROCEDURAL SCHEMATIC: Confidence and layout representation, not
        photorealistic
      </div>
      <div className="recon-legend" aria-label="Reconstruction legend">
        <span className="blue">BLUE reconstructed</span>
        <span className="cyan">CYAN flight path</span>
        <span className="red">RED critical</span>
        <span className="amber">AMBER uncertainty</span>
        <span className="purple">PURPLE AI finding</span>
      </div>
      <div className="viewer-north" aria-label="North orientation">
        N <i>↑</i>
      </div>
    </div>
  );
}
