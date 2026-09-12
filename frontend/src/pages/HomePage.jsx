import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Icon from "../components/ui/Icon";
import ReconstructionViewer from "../components/reconstruction/ReconstructionViewer";
import HeroCompassReconstruction from "../components/hero/HeroCompassReconstruction";
import FloatingWord from "../components/hero/FloatingWord";
import NarrativePipelineSequence from "../components/narrative/NarrativePipelineSequence";
import { listMissions, BACKEND_URL, resolveAssetUrl } from "../api/missions";
import { missions as seedMissions } from "../data/missions";
import "../styles/homepage.css";

// 11 Operational Workflow Stages with Rigorous Technical Architecture
const WORKFLOW_STAGES = [
  {
    id: "survey",
    number: "01",
    phase: "PHASE 01 / 11",
    tag: "FLIGHT PLANNING",
    title: "1. Autonomous Corridor & Sensor Path Planning",
    subtitle:
      "UAV executes pre-programmed corridor waypoints over the inspection zone with stabilized oblique and nadir optical configurations.",
    technicalExplanation:
      "Computes flight geometry based on desired Ground Sampling Distance (GSD ≤ 2.5 cm/px), terrain elevation models, and camera FOV. Enforces ≥75% longitudinal overlap and ≥65% lateral sidelap to ensure multi-view ray intersection baseline geometry for photogrammetry.",
    mathSpecs: "GSD = (Sensor Width × Altitude × 100) / (Focal Length × Image Width) · Nadir/Oblique -45° to -90°",
    inputsOutputs: "Input: Mission Boundary Polygon · Output: Waypoint Trajectory & RTK Base Sync",
    tech: ["Autonomous Waypoints", "45m AGL Altitude", "RTK-GPS Sync", "GSD ≤ 2.5 cm/px"],
    targetPage: "drone",
    telemetry: {
      label: "Flight Altitude",
      value: "45.2 m AGL",
      sub: "Speed: 6.2 m/s · Heading: 042° · RTK Fixed",
    },
  },
  {
    id: "capture",
    number: "02",
    phase: "PHASE 02 / 11",
    tag: "SENSOR STREAM",
    title: "2. Aerial Video & Telemetry Capture",
    subtitle:
      "High-resolution 4K optical feed captured with millisecond-accurate hardware timestamp synchronization and spatial IMU attitude.",
    technicalExplanation:
      "Streams uncompressed 4K video frames encoded in H.264/H.265. Synchronously logs 100Hz IMU attitude (pitch, roll, yaw), barometric altitude, and dual-frequency GNSS position tags directly into the video container metadata stream.",
    mathSpecs: "3840×2160 UHD @ 24.0 FPS · PTS/DTS Millisecond Timestamp Alignment · 45 Mbps Stream",
    inputsOutputs: "Input: CMOS 1-inch Optical Sensor · Output: 4K MP4 Stream with Synchronized Telemetry",
    tech: ["4K UHD Optical", "24.0 Native FPS", "100Hz IMU Logging", "Gimbal Stabilization"],
    targetPage: "drone",
    telemetry: {
      label: "Sensor Stream",
      value: "24.0 FPS UHD",
      sub: "Bitrate: 45 Mbps · Exp: 1/500s · ISO 100",
    },
  },
  {
    id: "ingest",
    number: "03",
    phase: "PHASE 03 / 11",
    tag: "QUALITY GATE",
    title: "3. Laplacian Blur Filtering & Keyframe Culling",
    subtitle:
      "Automated quality gateway filters motion blur, rotor wash vibration, and eliminates redundant spatial frames before reconstruction.",
    technicalExplanation:
      "Computes the Variance of Laplacian operator across every extracted video frame to quantify high-frequency edge sharpness. Suppresses motion-blurred frames below threshold σ² < 100 and computes inter-frame spatial baseline to prune 900+ raw video frames into ~20 high-information keyframes.",
    mathSpecs: "Sharpness Score = Var(∇² I) = E[(∇² I - μ)²] · Baseline Filter: Δpos > 0.8m or Δangle > 4.5°",
    inputsOutputs: "Input: 960 Video Frames · Output: 20 Optimal Inlier Keyframes for Bundle Adjustment",
    tech: ["Variance of Laplacian", "Edge Gradient Filter", "Redundancy Culling", "Sharpness > 88%"],
    targetPage: "drone",
    telemetry: {
      label: "Quality Score",
      value: "94.2% Sharpness",
      sub: "960 raw frames → 20 optimal keyframes",
    },
  },
  {
    id: "ai_detect",
    number: "04",
    phase: "PHASE 04 / 11",
    tag: "NEURAL DETECTION",
    title: "4. YOLOv11 Neural Object Detection & Tracking",
    subtitle:
      "Deep convolutional neural network detects vehicles, maritime vessels, aircraft, and personnel with persistent multi-frame tracking.",
    technicalExplanation:
      "Runs YOLOv11 deep neural network on selected keyframes with FP16 acceleration. Associates 2D detections across sequential frames using ByteTrack Kalman filtering to establish immutable track IDs, preventing duplicate counts across camera perspectives.",
    mathSpecs: "mAP@50: 89.4% · ByteTrack Spatio-Temporal Kalman Filtering · Spatial IOU Association ≥ 0.70",
    inputsOutputs: "Input: Keyframe Images · Output: Class Probabilities & Tracked 2D Bounding Bboxes",
    tech: ["YOLOv11 Architecture", "ByteTrack Tracker", "Multi-Class Classifier", "14ms GPU Latency"],
    targetPage: "reconstruction",
    telemetry: {
      label: "AI Detections",
      value: "Validated Tracks",
      sub: "Vehicles, Vessels & Personnel localized",
    },
  },
  {
    id: "sfm_reconstruct",
    number: "05",
    phase: "PHASE 05 / 11",
    tag: "SPARSE SfM",
    title: "5. PyCOLMAP Structure-from-Motion (SfM)",
    subtitle:
      "Calculates camera poses, optical center intrinsics, and constructs a high-precision sparse 3D point cloud via bundle adjustment.",
    technicalExplanation:
      "PyCOLMAP extracts Scale-Invariant Feature Transform (SIFT) descriptors across keyframe image pairs, verifies epipolar two-view geometry with RANSAC, and optimizes non-linear Levenberg-Marquardt bundle adjustment to estimate full 6-DoF camera poses and inlier 3D world points.",
    mathSpecs: "min_{R,t,X} ∑ || x_{ij} - π(K, R_i X_j + t_i) ||² · Mean Reprojection Error < 0.50 px",
    inputsOutputs: "Input: Keyframe Pair Matches · Output: 6-DoF Camera Extrinsics & 2,357 Inlier 3D Points",
    tech: ["PyCOLMAP Bundle Adj", "SIFT Feature Matching", "RANSAC Verification", "6-DoF Poses"],
    targetPage: "reconstruction",
    telemetry: {
      label: "Sparse Geometry",
      value: "20 / 20 Cameras",
      sub: "2,357 points · Reprojection error: 0.493 px",
    },
  },
  {
    id: "surface_mesh",
    number: "06",
    phase: "PHASE 06 / 11",
    tag: "POISSON MESH",
    title: "6. Dense Poisson Surface Mesh Generation",
    subtitle:
      "Reconstructs continuous watertight triangle surface geometry from oriented point normals for realistic geometric inspection.",
    technicalExplanation:
      "Calculates oriented 3D normal vectors from sparse surface points and camera ray directions. Solves the screened Poisson equation to find an indicator function whose gradient best matches the vector field, triangulating a continuous polygon surface with 24,000+ faces.",
    mathSpecs: "Poisson Equation: ∇² χ = ∇ · V · Iso-surface Extraction via Dual Marching Cubes",
    inputsOutputs: "Input: Oriented 3D Point Normals · Output: Standard .PLY Triangle Surface Mesh",
    tech: ["Screened Poisson", "Normal Estimation", "Dual Marching Cubes", "Three.js Surface Mesh"],
    targetPage: "reconstruction",
    telemetry: {
      label: "Surface Mesh",
      value: "24,229 Faces",
      sub: "12,366 vertices · Watertight triangle topology",
    },
  },
  {
    id: "spatial_fusion",
    number: "07",
    phase: "PHASE 07 / 11",
    tag: "3D SPATIAL FUSION",
    title: "7. AI-to-3D Camera Ray Back-Projection",
    subtitle:
      "Unprojects 2D neural detections into 3D world space, intersecting rays with the surface mesh to create authoritative 3D objects.",
    technicalExplanation:
      "Casts 3D rays from 2D YOLO bounding box centers through camera intrinsics K and pose (R,t). Performs Möller-Trumbore ray-triangle intersection against the 3D surface mesh to find exact 3D coordinates. Multi-view validation requires ≥2 agreeing camera views with reprojection error ≤ 25 px.",
    mathSpecs: "Ray: r(t) = C + t · (R^T K^{-1} x) · Multi-View Reprojection Verification: err < 25.0 px",
    inputsOutputs: "Input: 2D BBoxes + 3D Mesh · Output: Fused 3D Coordinates & Reprojection Overlays",
    tech: ["Möller-Trumbore Rays", "Ray Back-Projection", "Multi-View Validation", "Verified 3D Objects"],
    targetPage: "reconstruction",
    telemetry: {
      label: "Spatial Fusion",
      value: "Authoritative 3D",
      sub: "Multi-view confirmed 3D centroids",
    },
  },
  {
    id: "orbit_zoom",
    number: "08",
    phase: "PHASE 08 / 11",
    tag: "WEBGL DIGITAL TWIN",
    title: "8. Interactive 3D WebGL Digital Twin Navigation",
    subtitle:
      "GPU-accelerated 60 FPS 3D viewport enables orbital navigation, camera frustum inspection, and multi-layer toggles.",
    technicalExplanation:
      "Three.js WebGL rendering engine presents the complete reconstructed environment with real-time dynamic lighting, wireframe overlay modes, camera flight path frustums, and localized 3D bounding markers. Supports smooth auto-framing, point cloud overlays, and object inspection.",
    mathSpecs: "WebGL 2.0 Shader Pipeline · Perspective Camera Fov 45° · OrbitControls 60 FPS",
    inputsOutputs: "Input: Mesh PLY + 3D Objects · Output: Interactive Real-Time 3D Digital Twin",
    tech: ["Three.js WebGL", "Interactive Controls", "Camera Frustums", "60 FPS Hardware Render"],
    targetPage: "reconstruction",
    telemetry: {
      label: "Interactive Twin",
      value: "60 FPS GPU View",
      sub: "Full orbit, pan, zoom & layer isolation",
    },
  },
  {
    id: "measurements",
    number: "09",
    phase: "PHASE 09 / 11",
    tag: "SCALE CALIBRATION",
    title: "9. Ground Baseline & Metric Scale Calibration",
    subtitle:
      "Resolves monocular Structure-from-Motion scale ambiguity to convert arbitrary coordinates into certified metric meters.",
    technicalExplanation:
      "Pure monocular photogrammetry is inherently scale-ambiguous. By specifying a known physical reference distance (e.g. 10m road lane or survey marker), AEROMESH computes the exact metric scaling tensor S, upgrading unreferenced coordinates into certified meters with formal uncertainty bounds.",
    mathSpecs: "Scale Factor: S = d_{known} / ||P_A - P_B||₂ · Metric Distance: D = S · ||P_1 - P_2||₂",
    inputsOutputs: "Input: Known Baseline Distance · Output: Metric Calibrated Spatial Geometry (m)",
    tech: ["Baseline Calibration", "Scale Ambiguity Solver", "Certified Meters", "Uncertainty Bounds"],
    targetPage: "reconstruction",
    telemetry: {
      label: "Scale Status",
      value: "Certified Metric",
      sub: "Relative units converted to meters (m)",
    },
  },
  {
    id: "findings",
    number: "10",
    phase: "PHASE 10 / 11",
    tag: "OPERATIONAL INTEL",
    title: "10. 3D Spatial Anomaly & Motion Disambiguation",
    subtitle:
      "Separates moving dynamic objects from stationary infrastructure and evaluates operational safety clearance rules.",
    technicalExplanation:
      "Analyzes temporal displacement vectors of localized 3D centroids across successive camera exposures. Disambiguates moving targets (Δd > 1.8m) from stationary elements, checking spatial proximity against safety buffers to trigger automated operational findings.",
    mathSpecs: "Motion: ||P(t₂) - P(t₁)||₂ > 1.8m → MOVING · Spatial Buffer Anomaly Detection",
    inputsOutputs: "Input: 3D Object Trajectories · Output: Motion Classification & Operational Findings",
    tech: ["Motion Disambiguation", "Proximity Buffers", "Severity Classification", "Decision Engine"],
    targetPage: "findings",
    telemetry: {
      label: "Operational Intel",
      value: "Automated Rules",
      sub: "Moving vs Static separation active",
    },
  },
  {
    id: "report",
    number: "11",
    phase: "PHASE 11 / 11",
    tag: "AUDIT EXPORT",
    title: "11. Certified Engineering Report & GIS Package",
    subtitle:
      "Compiles certified executive PDF engineering reports, GeoJSON GIS layers, and complete cryptographic evidence packages.",
    technicalExplanation:
      "Compiles complete multi-phase pipeline audit trail into publication-ready deliverables: ReportLab-generated engineering PDF, GeoJSON GIS vector layers with refusal disclosures for unreferenced datasets, CSV object tables, and a ZIP evidence archive with visual reprojection overlays.",
    mathSpecs: "SHA-256 Package Checksum · GeoJSON RFC 7946 Standard · Executive PDF Vector Layout",
    inputsOutputs: "Input: Complete Mission Database · Output: Certified PDF, GeoJSON, CSV & ZIP",
    tech: ["ReportLab PDF Engine", "GeoJSON Vector Layers", "Visual Overlays", "Audit ZIP Archive"],
    targetPage: "reports",
    telemetry: {
      label: "Mission Deliverable",
      value: "Certified Audit Pack",
      sub: "PDF, GeoJSON, CSV & ZIP export ready",
    },
  },
];

// Interactive Dynamic Visual Display for each of the 11 steps
function StageVisualCanvas({ stageIndex }) {
  switch (stageIndex) {
    case 0: // 1. Drone Survey Flight
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <defs>
            <pattern
              id="grid1"
              width="30"
              height="30"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 30 0 L 0 0 0 30"
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="400" height="250" fill="url(#grid1)" />
          {/* Survey Target Building */}
          <polygon
            points="120,170 200,120 280,170 200,220"
            fill="rgba(14,165,233,0.12)"
            stroke="#0ea5e9"
            strokeWidth="1.5"
          />
          <polygon
            points="120,170 200,120 200,60 120,110"
            fill="rgba(14,165,233,0.2)"
            stroke="#0ea5e9"
            strokeWidth="1.5"
          />
          <polygon
            points="280,170 200,120 200,60 280,110"
            fill="rgba(14,165,233,0.15)"
            stroke="#0ea5e9"
            strokeWidth="1.5"
          />
          {/* Flight Path Waypoints */}
          <polyline
            points="40,50 140,40 260,40 360,60"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
            strokeDasharray="6,4"
          />
          <circle cx="40" cy="50" r="4" fill="#38bdf8" />
          <circle cx="140" cy="40" r="4" fill="#38bdf8" />
          <circle cx="260" cy="40" r="4" fill="#38bdf8" />
          {/* Drone Icon */}
          <g transform="translate(260, 40)">
            <circle cx="0" cy="0" r="8" fill="#38bdf8" />
            <line
              x1="-14"
              y1="0"
              x2="14"
              y2="0"
              stroke="#38bdf8"
              strokeWidth="2"
            />
            <line
              x1="0"
              y1="-14"
              x2="0"
              y2="14"
              stroke="#38bdf8"
              strokeWidth="2"
            />
            <circle
              cx="-14"
              cy="0"
              r="4"
              fill="none"
              stroke="#0ea5e9"
              strokeWidth="1.5"
            />
            <circle
              cx="14"
              cy="0"
              r="4"
              fill="none"
              stroke="#0ea5e9"
              strokeWidth="1.5"
            />
          </g>
          {/* Sensor Cone */}
          <polygon
            points="260,40 180,140 260,180"
            fill="rgba(14,165,233,0.15)"
            stroke="rgba(14,165,233,0.35)"
            strokeDasharray="3,3"
          />
          <text
            x="20"
            y="230"
            fill="#94a3b8"
            fontSize="10"
            fontFamily="monospace"
          >
            UAV TRAJECTORY · ALT: 45.2m · GIMBAL: -45°
          </text>
        </svg>
      );

    case 1: // 2. Video Capture
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#040810" />
          {/* Viewfinder Border */}
          <path
            d="M 20 50 L 20 20 L 50 20"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
          />
          <path
            d="M 380 50 L 380 20 L 350 20"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
          />
          <path
            d="M 20 200 L 20 230 L 50 230"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
          />
          <path
            d="M 380 200 L 380 230 L 350 230"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
          />
          {/* Crosshair */}
          <line
            x1="180"
            y1="125"
            x2="220"
            y2="125"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.8"
          />
          <line
            x1="200"
            y1="105"
            x2="200"
            y2="145"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.8"
          />
          <circle
            cx="200"
            cy="125"
            r="30"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.4"
            strokeDasharray="4,4"
          />
          {/* Recording HUD */}
          <circle cx="36" cy="36" r="5" fill="#ef4444" />
          <text
            x="48"
            y="40"
            fill="#ef4444"
            fontSize="11"
            fontWeight="bold"
            fontFamily="monospace"
          >
            REC · 24.0 FPS
          </text>
          <text
            x="320"
            y="40"
            fill="#38bdf8"
            fontSize="10"
            fontFamily="monospace"
          >
            4K UHD
          </text>
          <text
            x="26"
            y="218"
            fill="#94a3b8"
            fontSize="10"
            fontFamily="monospace"
          >
            FRAME 00482/00720
          </text>
          <text
            x="270"
            y="218"
            fill="#10b981"
            fontSize="10"
            fontFamily="monospace"
          >
            SHARPNESS: 94.2%
          </text>
        </svg>
      );

    case 2: // 3. Video Ingest
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#050b14" />
          <text
            x="30"
            y="40"
            fill="#94a3b8"
            fontSize="11"
            fontFamily="monospace"
          >
            KEYFRAME SELECTION GATEWAY
          </text>
          {/* Frames Ingestion Chain */}
          {[0, 1, 2, 3].map((idx) => {
            const x = 30 + idx * 88;
            const isBlur = idx === 1;
            return (
              <g key={idx}>
                <rect
                  x={x}
                  y="65"
                  width="76"
                  height="50"
                  rx="4"
                  fill="#0f1624"
                  stroke={isBlur ? "#ef4444" : "#0ea5e9"}
                  strokeWidth="1.5"
                />
                <rect
                  x={x + 4}
                  y="69"
                  width="68"
                  height="42"
                  fill={isBlur ? "rgba(239,68,68,0.1)" : "rgba(14,165,233,0.1)"}
                />
                <text
                  x={x + 8}
                  y="95"
                  fill={isBlur ? "#f87171" : "#38bdf8"}
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {`F${idx * 15}`}
                </text>
                <text
                  x={x + 8}
                  y="130"
                  fill={isBlur ? "#ef4444" : "#10b981"}
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {isBlur ? "REJECT" : "KEEP"}
                </text>
              </g>
            );
          })}
          {/* Quality Metrics Box */}
          <rect
            x="30"
            y="160"
            width="340"
            height="55"
            rx="6"
            fill="#0f1624"
            stroke="rgba(255,255,255,0.08)"
          />
          <text
            x="44"
            y="182"
            fill="#38bdf8"
            fontSize="11"
            fontWeight="bold"
            fontFamily="monospace"
          >
            Laplacian Variance: 482.1 (Threshold: 100.0)
          </text>
          <text
            x="44"
            y="200"
            fill="#94a3b8"
            fontSize="10"
            fontFamily="monospace"
          >
            Overlap Baseline: 78% · Redundant Frames Suppressed
          </text>
        </svg>
      );

    case 3: // 4. AI Frame Analysis
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#060c18" />
          {/* Road Surface */}
          <polygon
            points="50,230 160,70 240,70 350,230"
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.08)"
          />
          {/* Bounding Box 1 */}
          <rect
            x="140"
            y="120"
            width="80"
            height="45"
            fill="rgba(14,165,233,0.12)"
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
          <rect x="140" y="106" width="70" height="14" fill="#0ea5e9" />
          <text
            x="144"
            y="117"
            fill="#ffffff"
            fontSize="9"
            fontWeight="bold"
            fontFamily="monospace"
          >
            car 94% [T0011]
          </text>
          {/* Bounding Box 2 */}
          <rect
            x="230"
            y="150"
            width="95"
            height="55"
            fill="rgba(16,185,129,0.12)"
            stroke="#10b981"
            strokeWidth="1.5"
          />
          <rect x="230" y="136" width="76" height="14" fill="#10b981" />
          <text
            x="234"
            y="147"
            fill="#ffffff"
            fontSize="9"
            fontWeight="bold"
            fontFamily="monospace"
          >
            truck 88% [T0008]
          </text>
          <text
            x="20"
            y="30"
            fill="#38bdf8"
            fontSize="10"
            fontWeight="bold"
            fontFamily="monospace"
          >
            YOLOv11n + BYTETRACK PERSISTENCE
          </text>
        </svg>
      );

    case 4: // 5. SfM 3D Reconstruction
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#040912" />
          {/* Point Cloud Constellation */}
          {[
            [120, 140],
            [135, 125],
            [150, 160],
            [170, 130],
            [190, 150],
            [210, 120],
            [225, 145],
            [240, 130],
            [260, 155],
            [280, 135],
            [180, 175],
            [220, 180],
          ].map(([px, py], i) => (
            <circle
              key={i}
              cx={px}
              cy={py}
              r="2.5"
              fill="#38bdf8"
              opacity="0.85"
            />
          ))}
          {/* Camera Frustums along Trajectory */}
          {[60, 140, 220, 300].map((cx, idx) => (
            <g key={idx}>
              <polygon
                points={`${cx},50 ${cx - 15},85 ${cx + 15},85`}
                fill="rgba(245,158,11,0.15)"
                stroke="#f59e0b"
                strokeWidth="1.2"
              />
              <circle cx={cx} cy="50" r="3" fill="#fbbf24" />
              <line
                x1={cx}
                y1="50"
                x2="200"
                y2="140"
                stroke="rgba(245,158,11,0.2)"
                strokeDasharray="3,3"
              />
            </g>
          ))}
          <text
            x="20"
            y="230"
            fill="#fbbf24"
            fontSize="10"
            fontFamily="monospace"
          >
            COLMAP SfM: 20 REGISTERED POSES · 12,916 INLIER POINTS
          </text>
        </svg>
      );

    case 5: // 6. Dense Surface Mesh
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#050a14" />
          {/* Wireframe Mesh Grid */}
          <polygon
            points="60,190 200,100 340,190 200,230"
            fill="rgba(14,165,233,0.18)"
            stroke="#0ea5e9"
            strokeWidth="1.5"
          />
          {/* Internal Triangulation Faces */}
          <line
            x1="60"
            y1="190"
            x2="200"
            y2="190"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
          <line
            x1="340"
            y1="190"
            x2="200"
            y2="190"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
          <line
            x1="200"
            y1="100"
            x2="200"
            y2="230"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.6"
          />
          <line
            x1="130"
            y1="145"
            x2="270"
            y2="145"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.4"
          />
          <line
            x1="130"
            y1="145"
            x2="200"
            y2="190"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.4"
          />
          <line
            x1="270"
            y1="145"
            x2="200"
            y2="190"
            stroke="#38bdf8"
            strokeWidth="1"
            strokeOpacity="0.4"
          />
          <text
            x="20"
            y="35"
            fill="#38bdf8"
            fontSize="11"
            fontWeight="bold"
            fontFamily="monospace"
          >
            POISSON SURFACE RECONSTRUCTION
          </text>
          <text
            x="20"
            y="55"
            fill="#94a3b8"
            fontSize="10"
            fontFamily="monospace"
          >
            56,120 Triangles · Solid Watertight Road Plane
          </text>
        </svg>
      );

    case 6: // 7. 3D Spatial Fusion
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#040812" />
          {/* Road Surface */}
          <polygon
            points="40,210 200,130 360,210 200,240"
            fill="rgba(255,255,255,0.04)"
            stroke="rgba(255,255,255,0.1)"
          />
          {/* 3D Oriented Bounding Box 1 */}
          <polygon
            points="120,180 160,160 200,175 160,195"
            fill="rgba(14,165,233,0.3)"
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
          <polygon
            points="120,160 160,140 200,155 160,175"
            fill="rgba(14,165,233,0.5)"
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
          <line
            x1="120"
            y1="180"
            x2="120"
            y2="160"
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
          <line
            x1="160"
            y1="195"
            x2="160"
            y2="175"
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
          <line
            x1="200"
            y1="175"
            x2="200"
            y2="155"
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
          {/* Label Card */}
          <rect
            x="90"
            y="105"
            width="130"
            height="26"
            rx="4"
            fill="#0f1624"
            stroke="#38bdf8"
            strokeWidth="1"
          />
          <text
            x="96"
            y="122"
            fill="#38bdf8"
            fontSize="10"
            fontWeight="bold"
            fontFamily="monospace"
          >
            OBJ_T0011 [53.1, 50.5, 7.2]
          </text>
          <text
            x="20"
            y="35"
            fill="#10b981"
            fontSize="11"
            fontWeight="bold"
            fontFamily="monospace"
          >
            RAY TRIANGULATION · REPROJ ERROR: 1.95px
          </text>
        </svg>
      );

    case 7: // 8. Interactive 3D WebGL Navigation
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#040914" />
          {/* 3D Compass & Orbit Ring */}
          <circle
            cx="200"
            cy="125"
            r="70"
            fill="none"
            stroke="rgba(14,165,233,0.25)"
            strokeWidth="1.5"
          />
          <ellipse
            cx="200"
            cy="125"
            rx="70"
            ry="25"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
          <line
            x1="200"
            y1="45"
            x2="200"
            y2="205"
            stroke="rgba(255,255,255,0.2)"
            strokeDasharray="3,3"
          />
          {/* Axis Indicators */}
          <text x="205" y="55" fill="#ef4444" fontSize="10" fontWeight="bold">
            Y (Up)
          </text>
          <text x="280" y="130" fill="#10b981" fontSize="10" fontWeight="bold">
            X (East)
          </text>
          <text x="140" y="165" fill="#38bdf8" fontSize="10" fontWeight="bold">
            Z (Depth)
          </text>
          <circle cx="200" cy="125" r="4" fill="#ffffff" />
          {/* Controls HUD Badge */}
          <rect
            x="20"
            y="20"
            width="160"
            height="30"
            rx="4"
            fill="#0f1624"
            stroke="rgba(255,255,255,0.1)"
          />
          <text
            x="28"
            y="38"
            fill="#38bdf8"
            fontSize="10"
            fontWeight="bold"
            fontFamily="monospace"
          >
            OrbitControls: 60 FPS
          </text>
          <text
            x="20"
            y="230"
            fill="#94a3b8"
            fontSize="10"
            fontFamily="monospace"
          >
            FREE ORBIT · PAN · ZOOM · LAYER TOGGLES
          </text>
        </svg>
      );

    case 8: // 9. Photogrammetric Measurements
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#050a14" />
          {/* Measurement Vector */}
          <line
            x1="80"
            y1="140"
            x2="310"
            y2="140"
            stroke="#10b981"
            strokeWidth="2.5"
          />
          <circle cx="80" cy="140" r="5" fill="#10b981" />
          <circle cx="310" cy="140" r="5" fill="#10b981" />
          {/* Caliper Endpoints */}
          <line
            x1="80"
            y1="125"
            x2="80"
            y2="155"
            stroke="#10b981"
            strokeWidth="2"
          />
          <line
            x1="310"
            y1="125"
            x2="310"
            y2="155"
            stroke="#10b981"
            strokeWidth="2"
          />
          {/* Readout Box */}
          <rect
            x="145"
            y="110"
            width="110"
            height="28"
            rx="4"
            fill="#0f1624"
            stroke="#10b981"
            strokeWidth="1.5"
          />
          <text
            x="156"
            y="128"
            fill="#10b981"
            fontSize="12"
            fontWeight="bold"
            fontFamily="monospace"
          >
            15.00 m (±0.04m)
          </text>
          <text
            x="20"
            y="40"
            fill="#10b981"
            fontSize="11"
            fontWeight="bold"
            fontFamily="monospace"
          >
            ● METRIC SCALE CALIBRATED
          </text>
          <text
            x="20"
            y="60"
            fill="#94a3b8"
            fontSize="10"
            fontFamily="monospace"
          >
            Reference Baseline: 15.00m · Scale Factor: 1.0000 m/unit
          </text>
        </svg>
      );

    case 9: // 10. AI Operational Findings
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#060b14" />
          {/* Finding Card 1 (Critical) */}
          <rect
            x="30"
            y="40"
            width="340"
            height="65"
            rx="6"
            fill="#0f1624"
            stroke="#ef4444"
            strokeWidth="1.5"
          />
          <circle
            cx="55"
            cy="72"
            r="12"
            fill="rgba(239,68,68,0.15)"
            stroke="#ef4444"
          />
          <text x="52" y="76" fill="#ef4444" fontSize="12" fontWeight="bold">
            !
          </text>
          <text
            x="78"
            y="62"
            fill="#ef4444"
            fontSize="10"
            fontWeight="bold"
            fontFamily="monospace"
          >
            CRITICAL · RESTRICTED LANE OBSTRUCTION
          </text>
          <text x="78" y="78" fill="#ffffff" fontSize="11" fontWeight="bold">
            Vehicle stationary for &gt;180s in emergency zone
          </text>
          <text
            x="78"
            y="94"
            fill="#94a3b8"
            fontSize="9"
            fontFamily="monospace"
          >
            Track T0011 · Frame 482 · Localized at [53.06, 50.45, 7.16]
          </text>
          {/* Finding Card 2 (Warning) */}
          <rect
            x="30"
            y="125"
            width="340"
            height="65"
            rx="6"
            fill="#0f1624"
            stroke="#f59e0b"
            strokeWidth="1.5"
          />
          <circle
            cx="55"
            cy="157"
            r="12"
            fill="rgba(245,158,11,0.15)"
            stroke="#f59e0b"
          />
          <text x="52" y="161" fill="#f59e0b" fontSize="12" fontWeight="bold">
            ▲
          </text>
          <text
            x="78"
            y="147"
            fill="#f59e0b"
            fontSize="10"
            fontWeight="bold"
            fontFamily="monospace"
          >
            WARNING · SPEED ANOMALY DETECTED
          </text>
          <text x="78" y="163" fill="#ffffff" fontSize="11" fontWeight="bold">
            Truck velocity vector exceeds 45 km/h limit
          </text>
          <text
            x="78"
            y="179"
            fill="#94a3b8"
            fontSize="9"
            fontFamily="monospace"
          >
            Track T0008 · Reprojection Conf: 91%
          </text>
        </svg>
      );

    case 10: // 11. Final Mission Report
    default:
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#050a14" />
          {/* Report Document Sheet */}
          <rect
            x="90"
            y="30"
            width="220"
            height="190"
            rx="6"
            fill="#0f1624"
            stroke="rgba(255,255,255,0.15)"
          />
          {/* Document Header */}
          <rect x="110" y="48" width="80" height="10" fill="#38bdf8" rx="2" />
          <rect
            x="110"
            y="66"
            width="160"
            height="4"
            fill="rgba(255,255,255,0.2)"
            rx="2"
          />
          <rect
            x="110"
            y="76"
            width="130"
            height="4"
            fill="rgba(255,255,255,0.2)"
            rx="2"
          />
          {/* Document Table Mock */}
          <line
            x1="110"
            y1="94"
            x2="280"
            y2="94"
            stroke="rgba(255,255,255,0.1)"
          />
          <rect x="110" y="104" width="60" height="6" fill="#10b981" rx="2" />
          <rect x="230" y="104" width="40" height="6" fill="#38bdf8" rx="2" />
          <rect
            x="110"
            y="118"
            width="70"
            height="6"
            fill="rgba(255,255,255,0.3)"
            rx="2"
          />
          <rect
            x="230"
            y="118"
            width="30"
            height="6"
            fill="rgba(255,255,255,0.3)"
            rx="2"
          />
          {/* Verification Badge */}
          <circle
            cx="260"
            cy="180"
            r="18"
            fill="rgba(16,185,129,0.15)"
            stroke="#10b981"
            strokeWidth="1.5"
          />
          <text x="249" y="184" fill="#10b981" fontSize="12" fontWeight="bold">
            ✓
          </text>
          <text
            x="110"
            y="180"
            fill="#94a3b8"
            fontSize="9"
            fontFamily="monospace"
          >
            AEROMESH CERTIFIED
          </text>
          <text
            x="110"
            y="194"
            fill="#38bdf8"
            fontSize="9"
            fontFamily="monospace"
          >
            PDF · GeoJSON · CSV
          </text>
        </svg>
      );
  }
}

export default function HomePage({ onNavigateDashboard, onStartMission, currentUser, onOpenAuth }) {
  const [activeStep, setActiveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [workflowVisible, setWorkflowVisible] = useState(false);
  const [missionsList, setMissionsList] = useState([]);
  const [systemHealth, setSystemHealth] = useState({
    online: true,
    status: "All Systems Operational",
  });
  const timerRef = useRef(null);
  const workflowRef = useRef(null);

  useEffect(() => {
    const section = workflowRef.current;
    if (!section || typeof IntersectionObserver === "undefined") {
      setWorkflowVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setWorkflowVisible(entry.isIntersecting),
      { threshold: 0.12 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  // Auto-play timer for the 11 workflow steps
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % WORKFLOW_STAGES.length);
    }, 4800);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying]);

  const demoVideoUrl = resolveAssetUrl(
    missionsList[0]?.assets?.video || missionsList[0]?.video?.url || "",
  );

  // Load real backend missions & health
  useEffect(() => {
    let active = true;

    listMissions()
      .then((m) => {
        if (!active) return;
        if (Array.isArray(m) && m.length > 0) {
          setMissionsList(m.slice(0, 5));
        } else {
          setMissionsList(seedMissions.slice(0, 5));
        }
      })
      .catch(() => {
        if (active) setMissionsList(seedMissions.slice(0, 5));
      });

    fetch(`${BACKEND_URL}/api/health`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setSystemHealth({
          online: data.status === "healthy" || data.backend === "ready",
          status:
            data.status === "healthy" ? "All Systems Operational" : "Degraded",
        });
      })
      .catch(() => {
        if (active)
          setSystemHealth({
            online: false,
            status: "Offline Mode (Local Fallback)",
          });
      });

    return () => {
      active = false;
    };
  }, []);

  const handleNextStep = () => {
    setIsPlaying(false);
    setActiveStep((prev) => (prev + 1) % WORKFLOW_STAGES.length);
  };

  const handlePrevStep = () => {
    setIsPlaying(false);
    setActiveStep(
      (prev) => (prev - 1 + WORKFLOW_STAGES.length) % WORKFLOW_STAGES.length,
    );
  };

  const currentStage = WORKFLOW_STAGES[activeStep];

  return (
    <div className="homepage" id="top">
      {/* 1. TOP NAVIGATION */}
      <nav className="homepage-nav">
        <div
          className="nav-brand"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <div className="glowing-icon-circle sm">
            <Icon name="Radar" size={18} />
          </div>
          <div className="logo-text">
            <strong>AEROMESH</strong>
            <small>AERIAL INTELLIGENCE</small>
          </div>
        </div>

        <div className="nav-menu">
          <a href="#top">Home</a>
          <a
            href="#mission-command"
            onClick={(e) => {
              e.preventDefault();
              onNavigateDashboard("overview");
            }}
          >
            Mission Command
          </a>
          <a
            href="#history"
            onClick={(e) => {
              e.preventDefault();
              onNavigateDashboard("missions");
            }}
          >
            History
          </a>
          <a href="#pipeline-narrative">Pipeline Motion</a>
          <a href="#workflow">11-Step Workflow</a>
        </div>

        <div className="nav-actions">
          {currentUser ? (
            <button
              onClick={() => onNavigateDashboard("profile")}
              className="status-badge valid"
              style={{
                fontSize: 11,
                padding: "4px 12px",
                cursor: "pointer",
                background: "rgba(14,165,233,0.15)",
                border: "1px solid rgba(14,165,233,0.3)",
                color: "#38bdf8",
              }}
              title="View your Operator Profile"
            >
              <span className="pulse-dot-cyan" />
              <span>{currentUser.full_name} ({currentUser.role})</span>
            </button>
          ) : (
            <button
              onClick={onOpenAuth}
              id="btn-nav-login"
              style={{
                background: "rgba(56, 189, 248, 0.12)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                color: "#38bdf8",
                padding: "6px 14px",
                borderRadius: "20px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>🔒</span>
              <span>Operator Login</span>
            </button>
          )}
          <button
            className="hero-btn-pill hero-btn-pill-secondary"
            style={{ height: 36, padding: "0 16px", fontSize: 12 }}
            onClick={() => onNavigateDashboard("missions")}
            id="btn-nav-history"
          >
            <Icon name="Clock" size={13} />
            History
          </button>
          <button
            className="hero-btn-pill hero-btn-pill-primary"
            style={{ height: 36, padding: "0 18px", fontSize: 12 }}
            onClick={onStartMission}
            id="btn-nav-new-analysis"
          >
            <Icon name="Plus" size={13} />
            New Analysis
          </button>
        </div>
      </nav>

      {/* 2. CINEMATIC HERO SECTION */}
      <section className="homepage-hero" id="hero">
        <div className="hero-content">
          <div className="hero-text">
            <span className="hero-badge">
              <span className="pulse-dot-cyan" />
              COMMERCIAL AERIAL INTELLIGENCE & GIS
            </span>

            {/* Glowing AEROMESH Wordmark with Shimmer Sweep */}
            <div className="hero-wordmark-container">
              <h1 className="hero-wordmark-title" data-text="AEROMESH">
                <FloatingWord sparkColor="cyan">AEROMESH</FloatingWord>
              </h1>
              <div className="hero-wordmark-tagline">
                From Drone Footage <FloatingWord sparkColor="violet"><span>to 3D Intelligence</span></FloatingWord>
              </div>
            </div>

            <p className="hero-subtitle">
              Transform single-pass UAV video footage into millimeter-calibrated 3D point clouds,
              photogrammetric meshes, neural object tracks, and survey-grade GIS intelligence.
            </p>

            {/* Reference-Style Glowing Pill Buttons */}
            <div className="hero-pill-buttons">
              <button
                className="hero-btn-pill hero-btn-pill-primary"
                onClick={onStartMission}
                id="btn-hero-new-analysis"
              >
                <Icon name="Plus" size={16} />
                New Analysis
              </button>

              <button
                className="hero-btn-pill hero-btn-pill-secondary"
                onClick={() => onNavigateDashboard("missions")}
                id="btn-hero-history"
              >
                <Icon name="Clock" size={15} />
                History (Missions)
              </button>

              <button
                className="hero-btn-pill hero-btn-pill-secondary"
                onClick={() => onNavigateDashboard("overview")}
                id="btn-hero-command"
              >
                <Icon name="Radio" size={15} />
                Mission Command
              </button>
            </div>

            {/* Live Metrics Strip */}
            <div className="hero-metrics-strip">
              <div className="hero-stat-item">
                <span className="hero-stat-val">20 / 20</span>
                <span className="hero-stat-label">COLMAP Cameras</span>
              </div>
              <div className="hero-stat-item">
                <span className="hero-stat-val">12,916</span>
                <span className="hero-stat-label">Inlier 3D Points</span>
              </div>
              <div className="hero-stat-item">
                <span className="hero-stat-val">56,120</span>
                <span className="hero-stat-label">Surface Faces</span>
              </div>
              <div className="hero-stat-item">
                <span
                  className="hero-stat-val"
                  style={{ color: systemHealth.online ? "var(--status-active)" : "#f59e0b" }}
                >
                  {systemHealth.online ? "ONLINE" : "OFFLINE"}
                </span>
                <span className="hero-stat-label">Hardware Engine</span>
              </div>
            </div>
          </div>

          {/* Central Hero Visual: Auto-rotating 3D Model in Concentric Compass Rings */}
          <div className="hero-visual-staging">
            <HeroCompassReconstruction />
          </div>
        </div>
      </section>

      {/* 3. NARRATIVE PIPELINE ANIMATION — THE "WOW" SEQUENCE */}
      <section className="narrative-pipeline-section" id="pipeline-narrative">
        <NarrativePipelineSequence />
      </section>

      {/* 4. REFERENCE BOTTOM FEATURE CARDS GRID */}
      <section className="feature-card-section" id="capabilities-grid">
        <div className="feature-grid-4col">
          <div className="feature-glass-card glass" id="card-feature-reconstruction">
            <div className="glass-sheen" aria-hidden="true" />
            <div className="glowing-icon-circle lg">
              <Icon name="Box" size={24} />
            </div>
            <h4>3D Reconstruction</h4>
            <p>
              Autonomous single-pass Structure-from-Motion and dense multi-view stereo generating
              survey-grade 3D point clouds and Poisson surface meshes.
            </p>
          </div>

          <div className="feature-glass-card glass" id="card-feature-360">
            <div className="glass-sheen" aria-hidden="true" />
            <div className="glowing-icon-circle lg">
              <Icon name="Compass" size={24} />
            </div>
            <h4>Explore in 360°</h4>
            <p>
              Full 6-DoF spatial orbit navigation, orthographic nadir clipping planes, and real-time
              camera frustum station inspection in high precision.
            </p>
          </div>

          <div className="feature-glass-card glass" id="card-feature-analysis">
            <div className="glass-sheen" aria-hidden="true" />
            <div className="glowing-icon-circle lg">
              <Icon name="Radar" size={24} />
            </div>
            <h4>Detailed Analysis</h4>
            <p>
              Deep YOLO11 convolutional neural detection coupled with ByteTrack spatio-temporal Kalman
              filtering and ground sampling distance calibration.
            </p>
          </div>

          <div className="feature-glass-card glass" id="card-feature-future">
            <div className="glass-sheen" aria-hidden="true" />
            <div className="glowing-icon-circle lg">
              <Icon name="Shield" size={24} />
            </div>
            <h4>Future Ready</h4>
            <p>
              Certified deliverables pipeline auto-compiling executive PDF engineering reports,
              GeoJSON spatial layers, CSV telemetry, and zipped audit packages.
            </p>
          </div>
        </div>
      </section>

      {/* 3. THE 11-STAGE INTERACTIVE WORKFLOW SIMULATOR */}
      <section
        className={`workflow-section ${workflowVisible ? "is-visible" : ""}`}
        id="workflow"
        ref={workflowRef}
      >
        <div className="section-header-center">
          <span className="eyebrow">AEROMESH MISSION LIFECYCLE</span>
          <h2>The 11-Stage Aerial Intelligence Pipeline</h2>
          <p>
            From drone video ingestion to survey-grade 3D environment
            reconstruction, neural object localization, and calibrated geometric
            analytics.
          </p>
        </div>

        {/* 11-Step Scrub Bar */}
        <div
          className="workflow-stepper"
          role="tablist"
          aria-label="Pipeline Stages"
        >
          {WORKFLOW_STAGES.map((stg, idx) => (
            <button
              key={stg.id}
              className={`step-chip ${activeStep === idx ? "active" : ""}`}
              onClick={() => {
                setIsPlaying(false);
                setActiveStep(idx);
              }}
            >
              <span className="step-chip-num">{stg.number}</span>
              <span>{stg.title.split(". ")[1]}</span>
            </button>
          ))}
        </div>

        {/* Dynamic Split Showcase Card with Smooth Transitions */}
        <div className="workflow-stage-card">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStage.id}
              className="workflow-stage-inner"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Left Column: Technical In-Depth Architecture */}
              <div className="stage-info-column">
                <div className="stage-header-meta">
                  <div className="stage-phase-row">
                    <span className="stage-phase-tag">
                      <i className="pulse-dot" />
                      {currentStage.phase} · {currentStage.tag}
                    </span>
                    <span className="stage-step-indicator">
                      Step {currentStage.number} / 11
                    </span>
                  </div>

                  <h3 className="stage-title">{currentStage.title}</h3>
                  <p className="stage-description">{currentStage.subtitle}</p>

                  {/* Technical Deep Dive Panel */}
                  <div className="stage-technical-panel">
                    <div className="tech-panel-header">
                      <Icon name="Cpu" size={13} />
                      <span>HOW IT WORKS TECHNICALLY</span>
                    </div>
                    <p className="tech-panel-explanation">
                      {currentStage.technicalExplanation}
                    </p>

                    <div className="tech-panel-specs">
                      <div className="tech-spec-row">
                        <span className="tech-spec-label">Formulation / Specs:</span>
                        <code className="tech-spec-code">{currentStage.mathSpecs}</code>
                      </div>
                      <div className="tech-spec-row">
                        <span className="tech-spec-label">I/O Pipeline:</span>
                        <span className="tech-spec-val">{currentStage.inputsOutputs}</span>
                      </div>
                    </div>
                  </div>

                  <div className="stage-tech-tags">
                    {currentStage.tech.map((t, i) => (
                      <span
                        key={i}
                        className={`stage-tech-pill ${i === 0 ? "highlight" : ""}`}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Stage Navigation & Workspace Trigger */}
                <div className="stage-nav-controls">
                  <div className="stage-player-controls">
                    <button
                      className="player-btn"
                      onClick={handlePrevStep}
                      title="Previous Stage"
                    >
                      ←
                    </button>
                    <button
                      className={`player-btn ${isPlaying ? "playing" : ""}`}
                      onClick={() => setIsPlaying((p) => !p)}
                      title={isPlaying ? "Pause Auto-Advance" : "Play Auto-Advance"}
                    >
                      {isPlaying ? "❚❚" : "▶"}
                    </button>
                    <button
                      className="player-btn"
                      onClick={handleNextStep}
                      title="Next Stage"
                    >
                      →
                    </button>
                    <span className="player-timer-hint">
                      {isPlaying ? "Auto-advancing" : "Paused"}
                    </span>
                  </div>

                  <button
                    className="stage-action-link"
                    onClick={onNavigateDashboard}
                  >
                    <span>Launch in Workspace</span>
                    <Icon name="ArrowRight" size={14} />
                  </button>
                </div>
              </div>

              {/* Right Column: Visual Graphic, Real Drone Video, or Real 3D Mesh */}
              <div className="stage-visual-column">
                <div className="stage-canvas-wrapper" aria-live="polite">
                  {activeStep === 1 && demoVideoUrl ? (
                    <div className="stage-video-preview">
                      <video
                        src={demoVideoUrl}
                        muted
                        loop
                        autoPlay
                        playsInline
                        controls
                        aria-label="Mission drone footage preview"
                      />
                      <span className="stage-video-label">LIVE MISSION SOURCE VIDEO</span>
                    </div>
                  ) : (activeStep === 4 || activeStep === 5) && missionsList[0] ? (
                    <div className="stage-recon-preview">
                      <ReconstructionViewer
                        mission={missionsList[0]}
                        hideEmbeddedControls={true}
                      />
                      <span className="stage-video-label">LIVE 3D RECONSTRUCTION PREVIEW</span>
                    </div>
                  ) : (
                    <StageVisualCanvas stageIndex={activeStep} />
                  )}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* 4. CORE CAPABILITIES */}
      <section className="capabilities-section" id="capabilities">
        <div className="section-header-center">
          <span className="eyebrow">ENTERPRISE SYSTEM ARCHITECTURE</span>
          <h2>Built for Precision GIS & Aerial Intelligence</h2>
          <p>
            Hardware-accelerated photogrammetry, real-time spatial fusion, and
            scientific scale calibration.
          </p>
        </div>

        <div className="capabilities-grid-4">
          <div className="cap-card">
            <div className="cap-card-icon">
              <Icon name="Box" size={20} />
            </div>
            <h3>3D Photogrammetry</h3>
            <p>
              COLMAP Structure-from-Motion paired with Depth Anything V2 depth
              estimation and Poisson meshing generates survey-grade 3D twins.
            </p>
          </div>

          <div className="cap-card">
            <div className="cap-card-icon">
              <Icon name="Radar" size={20} />
            </div>
            <h3>YOLOv11 Spatial Fusion</h3>
            <p>
              Deep learning models detect and track vehicles, infrastructure,
              and pedestrians, ray-triangulating 2D tracks into 3D world
              coordinates.
            </p>
          </div>

          <div className="cap-card">
            <div className="cap-card-icon">
              <Icon name="Ruler" size={20} />
            </div>
            <h3>Scale Calibration</h3>
            <p>
              Resolves monocular scale ambiguity via ground reference distance
              calibration, reporting certifiable metric meters for distance and
              height.
            </p>
          </div>

          <div className="cap-card">
            <div className="cap-card-icon">
              <Icon name="FileText" size={20} />
            </div>
            <h3>Standardized Handoff</h3>
            <p>
              Automated compilation of executive PDF engineering reports,
              GeoJSON GIS feature layers, CSV logs, and zipped evidence
              packages.
            </p>
          </div>
        </div>
      </section>

      {/* 6. CALL TO ACTION BANNER */}
      <section className="cta-banner" id="architecture">
        <div className="cta-banner-content">
          <span className="hero-badge">AEROMESH SIH DEMONSTRATION READY</span>
          <h2>Transform Aerial Footage into 3D Intelligence</h2>
          <p>
            Experience the complete end-to-end pipeline: video ingestion, neural
            object tracking, photogrammetric 3D reconstruction, and certified
            engineering reports.
          </p>
          <div className="hero-buttons" style={{ justifyContent: "center" }}>
            <button className="hero-btn-primary" onClick={onStartMission}>
              <Icon name="Plus" size={16} />
              Start New Mission
            </button>
            <button
              className="hero-btn-secondary"
              onClick={onNavigateDashboard}
            >
              <Icon name="Box" size={16} />
              Explore Demo
            </button>
          </div>
        </div>
      </section>

      {/* 7. FOOTER */}
      <footer className="homepage-footer">
        <div>
          <strong style={{ color: "#ffffff", letterSpacing: "0.08em" }}>
            AEROMESH
          </strong>
          <span style={{ marginLeft: "8px", color: "#64748b" }}>
            Single-Pass Drone Video to 3D Reconstruction Platform
          </span>
        </div>
        <div className="footer-meta">
          <span>Smart India Hackathon 2024</span>
          <span>FastAPI · Three.js · YOLOv11 · COLMAP</span>
        </div>
      </footer>
    </div>
  );
}
