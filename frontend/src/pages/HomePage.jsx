import { useState, useEffect, useRef } from "react";
import Icon from "../components/ui/Icon";
import { listMissions, BACKEND_URL } from "../api/missions";
import { missions as seedMissions } from "../data/missions";
import "../styles/homepage.css";

// 11 Operational Workflow Stages
const WORKFLOW_STAGES = [
  {
    id: "survey",
    number: "01",
    phase: "PHASE 01 / 11",
    tag: "AUTONOMOUS FLIGHT",
    title: "1. Drone Survey Flight",
    subtitle: "UAV executes pre-planned flight corridor over inspection zone with stabilized oblique and nadir gimbal angles.",
    tech: ["Autonomous Waypoints", "45m AGL Altitude", "4K Sensor", "GPS Sync"],
    targetPage: "drone",
    telemetry: { label: "Flight Altitude", value: "45.2 m AGL", sub: "Speed: 6.2 m/s · Heading: 042°" },
  },
  {
    id: "capture",
    number: "02",
    phase: "PHASE 02 / 11",
    tag: "SENSOR STREAM",
    title: "2. Aerial Footage Capture",
    subtitle: "Drone camera captures high-resolution 24 FPS footage with synchronized barometric and spatial telemetry.",
    tech: ["3840x2160 UHD", "24.0 FPS", "H.264 / ProRes", "Hardware Gimbal"],
    targetPage: "drone",
    telemetry: { label: "Sensor Stream", value: "24.0 FPS UHD", sub: "Bitrate: 45 Mbps · Exp: 1/500s" },
  },
  {
    id: "ingest",
    number: "03",
    phase: "PHASE 03 / 11",
    tag: "QUALITY GATEWAY",
    title: "3. Video Ingest & Quality Gate",
    subtitle: "Video enters AeroMesh pipeline. Frame extraction filters motion blur via Laplacian variance and removes duplicate views.",
    tech: ["Laplacian Variance", "61 Keyframes Extracted", "Sharpness > 85%", "Duplicate Removal"],
    targetPage: "drone",
    telemetry: { label: "Quality Score", value: "94.2% Sharpness", sub: "720 frames → 61 keyframes" },
  },
  {
    id: "ai_detect",
    number: "04",
    phase: "PHASE 04 / 11",
    tag: "NEURAL TRACKING",
    title: "4. YOLOv11 Frame Analysis",
    subtitle: "Deep neural network detects vehicles, pedestrians, and infrastructure. ByteTrack preserves persistent track IDs across frames.",
    tech: ["YOLOv11n", "ByteTrack Persistence", "14ms Inference", "Multi-Class Bounding"],
    targetPage: "reconstruction",
    telemetry: { label: "AI Detections", value: "399 Instances", sub: "23 unique persistent tracks" },
  },
  {
    id: "sfm_reconstruct",
    number: "05",
    phase: "PHASE 05 / 11",
    tag: "SPARSE GEOMETRY",
    title: "5. COLMAP SfM 3D Reconstruction",
    subtitle: "Structure-from-Motion bundle adjustment calculates exact intrinsic camera matrices, camera poses, and sparse 3D point cloud.",
    tech: ["COLMAP Bundle Adj", "20 Registered Cameras", "12,916 Points", "0.98 px Error"],
    targetPage: "reconstruction",
    telemetry: { label: "Sparse Inliers", value: "12,916 Points", sub: "Mean reprojection error: 0.98 px" },
  },
  {
    id: "surface_mesh",
    number: "06",
    phase: "PHASE 06 / 11",
    tag: "POISSON MESH",
    title: "6. Dense Surface Mesh Generation",
    subtitle: "Depth Anything V2 depth maps are backprojected into world coordinates; Screened Poisson reconstruction generates dense 3D terrain.",
    tech: ["Poisson Surface Reconstruction", "Depth Anything V2", "56,120 Faces", "Road Plane Z≈7.16m"],
    targetPage: "reconstruction",
    telemetry: { label: "Surface Geometry", value: "56,120 Faces", sub: "28,139 vertices · Solid terrain" },
  },
  {
    id: "spatial_fusion",
    number: "07",
    phase: "PHASE 07 / 11",
    tag: "MULTI-VIEW FUSION",
    title: "7. 3D Spatial Fusion & Triangulation",
    subtitle: "2D track detections from multiple camera viewpoints are triangulated through optical centers into authoritative 3D spatial world objects.",
    tech: ["Multi-View Triangulation", "Ray Unprojection", "Reprojection < 25px", "3D Bounding Boxes"],
    targetPage: "reconstruction",
    telemetry: { label: "Fused 3D Objects", value: "4 Valid Road Vehicles", sub: "OBJ_T0011 at [53.06, 50.45, 7.16]" },
  },
  {
    id: "orbit_zoom",
    number: "08",
    phase: "PHASE 08 / 11",
    tag: "WEBGL HERO",
    title: "8. Interactive 3D WebGL Navigation",
    subtitle: "Users freely orbit, pan, and zoom the digital twin with Three.js OrbitControls, layer visibility toggles, and auto-framing.",
    tech: ["Three.js WebGL", "Auto-Framing Bounds", "Layer Toggles", "60 FPS Render"],
    targetPage: "reconstruction",
    telemetry: { label: "Interactive Viewport", value: "60 FPS WebGL", sub: "Free Orbit · Pan · Zoom · Layers" },
  },
  {
    id: "measurements",
    number: "09",
    phase: "PHASE 09 / 11",
    tag: "SCIENTIFIC SCALE",
    title: "9. Photogrammetric Scale & Measurements",
    subtitle: "Reference ground distance calibrates scale ambiguity, transforming relative units into certified metric meters for distance and height.",
    tech: ["15.00m Survey Baseline", "Scale Factor 1.0000 m/u", "3D Distance Vector", "Elevation Delta"],
    targetPage: "reconstruction",
    telemetry: { label: "Scale Calibration", value: "METRIC CALIBRATED", sub: "Baseline: 15.00m (±0.04m)" },
  },
  {
    id: "findings",
    number: "10",
    phase: "PHASE 10 / 11",
    tag: "OPERATIONAL INTEL",
    title: "10. AI Operational Findings & Anomalies",
    subtitle: "Spatial rules engine flags stationary vehicles in restricted lanes, structural clearance issues, and high-priority anomalies.",
    tech: ["Spatial Anomaly Rules", "Speed Vector Estimation", "Severity Classification", "Decision Support"],
    targetPage: "findings",
    telemetry: { label: "AI Findings", value: "1 Critical · 2 Warnings", sub: "Lane obstruction localized in 3D" },
  },
  {
    id: "report",
    number: "11",
    phase: "PHASE 11 / 11",
    tag: "DELIVERABLES",
    title: "11. Certified Mission Report Generation",
    subtitle: "Automated compilation of executive PDF engineering reports, GeoJSON GIS layers, CSV object logs, and complete evidence packages.",
    tech: ["ReportLab PDF Engine", "GeoJSON Features", "CSV Metadata", "Evidence ZIP Package"],
    targetPage: "reports",
    telemetry: { label: "Report Package", value: "Certified PDF & GeoJSON", sub: "Export ready with cryptographic hash" },
  },
];

// Interactive Dynamic Visual Display for each of the 11 steps
function StageVisualCanvas({ stageIndex }) {
  switch (stageIndex) {
    case 0: // 1. Drone Survey Flight
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <defs>
            <pattern id="grid1" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="400" height="250" fill="url(#grid1)" />
          {/* Survey Target Building */}
          <polygon points="120,170 200,120 280,170 200,220" fill="rgba(14,165,233,0.12)" stroke="#0ea5e9" strokeWidth="1.5" />
          <polygon points="120,170 200,120 200,60 120,110" fill="rgba(14,165,233,0.2)" stroke="#0ea5e9" strokeWidth="1.5" />
          <polygon points="280,170 200,120 200,60 280,110" fill="rgba(14,165,233,0.15)" stroke="#0ea5e9" strokeWidth="1.5" />
          {/* Flight Path Waypoints */}
          <polyline points="40,50 140,40 260,40 360,60" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6,4" />
          <circle cx="40" cy="50" r="4" fill="#38bdf8" />
          <circle cx="140" cy="40" r="4" fill="#38bdf8" />
          <circle cx="260" cy="40" r="4" fill="#38bdf8" />
          {/* Drone Icon */}
          <g transform="translate(260, 40)">
            <circle cx="0" cy="0" r="8" fill="#38bdf8" />
            <line x1="-14" y1="0" x2="14" y2="0" stroke="#38bdf8" strokeWidth="2" />
            <line x1="0" y1="-14" x2="0" y2="14" stroke="#38bdf8" strokeWidth="2" />
            <circle cx="-14" cy="0" r="4" fill="none" stroke="#0ea5e9" strokeWidth="1.5" />
            <circle cx="14" cy="0" r="4" fill="none" stroke="#0ea5e9" strokeWidth="1.5" />
          </g>
          {/* Sensor Cone */}
          <polygon points="260,40 180,140 260,180" fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.35)" strokeDasharray="3,3" />
          <text x="20" y="230" fill="#94a3b8" fontSize="10" fontFamily="monospace">UAV TRAJECTORY · ALT: 45.2m · GIMBAL: -45°</text>
        </svg>
      );

    case 1: // 2. Video Capture
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#040810" />
          {/* Viewfinder Border */}
          <path d="M 20 50 L 20 20 L 50 20" fill="none" stroke="#38bdf8" strokeWidth="2" />
          <path d="M 380 50 L 380 20 L 350 20" fill="none" stroke="#38bdf8" strokeWidth="2" />
          <path d="M 20 200 L 20 230 L 50 230" fill="none" stroke="#38bdf8" strokeWidth="2" />
          <path d="M 380 200 L 380 230 L 350 230" fill="none" stroke="#38bdf8" strokeWidth="2" />
          {/* Crosshair */}
          <line x1="180" y1="125" x2="220" y2="125" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.8" />
          <line x1="200" y1="105" x2="200" y2="145" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.8" />
          <circle cx="200" cy="125" r="30" fill="none" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.4" strokeDasharray="4,4" />
          {/* Recording HUD */}
          <circle cx="36" cy="36" r="5" fill="#ef4444" />
          <text x="48" y="40" fill="#ef4444" fontSize="11" fontWeight="bold" fontFamily="monospace">REC · 24.0 FPS</text>
          <text x="320" y="40" fill="#38bdf8" fontSize="10" fontFamily="monospace">4K UHD</text>
          <text x="26" y="218" fill="#94a3b8" fontSize="10" fontFamily="monospace">FRAME 00482/00720</text>
          <text x="270" y="218" fill="#10b981" fontSize="10" fontFamily="monospace">SHARPNESS: 94.2%</text>
        </svg>
      );

    case 2: // 3. Video Ingest
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#050b14" />
          <text x="30" y="40" fill="#94a3b8" fontSize="11" fontFamily="monospace">KEYFRAME SELECTION GATEWAY</text>
          {/* Frames Ingestion Chain */}
          {[0, 1, 2, 3].map((idx) => {
            const x = 30 + idx * 88;
            const isBlur = idx === 1;
            return (
              <g key={idx}>
                <rect x={x} y="65" width="76" height="50" rx="4" fill="#0f1624" stroke={isBlur ? "#ef4444" : "#0ea5e9"} strokeWidth="1.5" />
                <rect x={x + 4} y="69" width="68" height="42" fill={isBlur ? "rgba(239,68,68,0.1)" : "rgba(14,165,233,0.1)"} />
                <text x={x + 8} y="95" fill={isBlur ? "#f87171" : "#38bdf8"} fontSize="9" fontFamily="monospace">
                  {`F${idx * 15}`}
                </text>
                <text x={x + 8} y="130" fill={isBlur ? "#ef4444" : "#10b981"} fontSize="9" fontWeight="bold" fontFamily="monospace">
                  {isBlur ? "REJECT" : "KEEP"}
                </text>
              </g>
            );
          })}
          {/* Quality Metrics Box */}
          <rect x="30" y="160" width="340" height="55" rx="6" fill="#0f1624" stroke="rgba(255,255,255,0.08)" />
          <text x="44" y="182" fill="#38bdf8" fontSize="11" fontWeight="bold" fontFamily="monospace">Laplacian Variance: 482.1 (Threshold: 100.0)</text>
          <text x="44" y="200" fill="#94a3b8" fontSize="10" fontFamily="monospace">Overlap Baseline: 78% · Redundant Frames Suppressed</text>
        </svg>
      );

    case 3: // 4. AI Frame Analysis
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#060c18" />
          {/* Road Surface */}
          <polygon points="50,230 160,70 240,70 350,230" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
          {/* Bounding Box 1 */}
          <rect x="140" y="120" width="80" height="45" fill="rgba(14,165,233,0.12)" stroke="#38bdf8" strokeWidth="1.5" />
          <rect x="140" y="106" width="70" height="14" fill="#0ea5e9" />
          <text x="144" y="117" fill="#ffffff" fontSize="9" fontWeight="bold" fontFamily="monospace">car 94% [T0011]</text>
          {/* Bounding Box 2 */}
          <rect x="230" y="150" width="95" height="55" fill="rgba(16,185,129,0.12)" stroke="#10b981" strokeWidth="1.5" />
          <rect x="230" y="136" width="76" height="14" fill="#10b981" />
          <text x="234" y="147" fill="#ffffff" fontSize="9" fontWeight="bold" fontFamily="monospace">truck 88% [T0008]</text>
          <text x="20" y="30" fill="#38bdf8" fontSize="10" fontWeight="bold" fontFamily="monospace">YOLOv11n + BYTETRACK PERSISTENCE</text>
        </svg>
      );

    case 4: // 5. SfM 3D Reconstruction
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#040912" />
          {/* Point Cloud Constellation */}
          {[
            [120, 140], [135, 125], [150, 160], [170, 130], [190, 150], [210, 120],
            [225, 145], [240, 130], [260, 155], [280, 135], [180, 175], [220, 180]
          ].map(([px, py], i) => (
            <circle key={i} cx={px} cy={py} r="2.5" fill="#38bdf8" opacity="0.85" />
          ))}
          {/* Camera Frustums along Trajectory */}
          {[60, 140, 220, 300].map((cx, idx) => (
            <g key={idx}>
              <polygon points={`${cx},50 ${cx - 15},85 ${cx + 15},85`} fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth="1.2" />
              <circle cx={cx} cy="50" r="3" fill="#fbbf24" />
              <line x1={cx} y1="50" x2="200" y2="140" stroke="rgba(245,158,11,0.2)" strokeDasharray="3,3" />
            </g>
          ))}
          <text x="20" y="230" fill="#fbbf24" fontSize="10" fontFamily="monospace">COLMAP SfM: 20 REGISTERED POSES · 12,916 INLIER POINTS</text>
        </svg>
      );

    case 5: // 6. Dense Surface Mesh
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#050a14" />
          {/* Wireframe Mesh Grid */}
          <polygon points="60,190 200,100 340,190 200,230" fill="rgba(14,165,233,0.18)" stroke="#0ea5e9" strokeWidth="1.5" />
          {/* Internal Triangulation Faces */}
          <line x1="60" y1="190" x2="200" y2="190" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.5" />
          <line x1="340" y1="190" x2="200" y2="190" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.5" />
          <line x1="200" y1="100" x2="200" y2="230" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.6" />
          <line x1="130" y1="145" x2="270" y2="145" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="130" y1="145" x2="200" y2="190" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="270" y1="145" x2="200" y2="190" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.4" />
          <text x="20" y="35" fill="#38bdf8" fontSize="11" fontWeight="bold" fontFamily="monospace">POISSON SURFACE RECONSTRUCTION</text>
          <text x="20" y="55" fill="#94a3b8" fontSize="10" fontFamily="monospace">56,120 Triangles · Solid Watertight Road Plane</text>
        </svg>
      );

    case 6: // 7. 3D Spatial Fusion
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#040812" />
          {/* Road Surface */}
          <polygon points="40,210 200,130 360,210 200,240" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
          {/* 3D Oriented Bounding Box 1 */}
          <polygon points="120,180 160,160 200,175 160,195" fill="rgba(14,165,233,0.3)" stroke="#38bdf8" strokeWidth="1.5" />
          <polygon points="120,160 160,140 200,155 160,175" fill="rgba(14,165,233,0.5)" stroke="#38bdf8" strokeWidth="1.5" />
          <line x1="120" y1="180" x2="120" y2="160" stroke="#38bdf8" strokeWidth="1.5" />
          <line x1="160" y1="195" x2="160" y2="175" stroke="#38bdf8" strokeWidth="1.5" />
          <line x1="200" y1="175" x2="200" y2="155" stroke="#38bdf8" strokeWidth="1.5" />
          {/* Label Card */}
          <rect x="90" y="105" width="130" height="26" rx="4" fill="#0f1624" stroke="#38bdf8" strokeWidth="1" />
          <text x="96" y="122" fill="#38bdf8" fontSize="10" fontWeight="bold" fontFamily="monospace">OBJ_T0011 [53.1, 50.5, 7.2]</text>
          <text x="20" y="35" fill="#10b981" fontSize="11" fontWeight="bold" fontFamily="monospace">RAY TRIANGULATION · REPROJ ERROR: 1.95px</text>
        </svg>
      );

    case 7: // 8. Interactive 3D WebGL Navigation
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#040914" />
          {/* 3D Compass & Orbit Ring */}
          <circle cx="200" cy="125" r="70" fill="none" stroke="rgba(14,165,233,0.25)" strokeWidth="1.5" />
          <ellipse cx="200" cy="125" rx="70" ry="25" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
          <line x1="200" y1="45" x2="200" y2="205" stroke="rgba(255,255,255,0.2)" strokeDasharray="3,3" />
          {/* Axis Indicators */}
          <text x="205" y="55" fill="#ef4444" fontSize="10" fontWeight="bold">Y (Up)</text>
          <text x="280" y="130" fill="#10b981" fontSize="10" fontWeight="bold">X (East)</text>
          <text x="140" y="165" fill="#38bdf8" fontSize="10" fontWeight="bold">Z (Depth)</text>
          <circle cx="200" cy="125" r="4" fill="#ffffff" />
          {/* Controls HUD Badge */}
          <rect x="20" y="20" width="160" height="30" rx="4" fill="#0f1624" stroke="rgba(255,255,255,0.1)" />
          <text x="28" y="38" fill="#38bdf8" fontSize="10" fontWeight="bold" fontFamily="monospace">OrbitControls: 60 FPS</text>
          <text x="20" y="230" fill="#94a3b8" fontSize="10" fontFamily="monospace">FREE ORBIT · PAN · ZOOM · LAYER TOGGLES</text>
        </svg>
      );

    case 8: // 9. Photogrammetric Measurements
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#050a14" />
          {/* Measurement Vector */}
          <line x1="80" y1="140" x2="310" y2="140" stroke="#10b981" strokeWidth="2.5" />
          <circle cx="80" cy="140" r="5" fill="#10b981" />
          <circle cx="310" cy="140" r="5" fill="#10b981" />
          {/* Caliper Endpoints */}
          <line x1="80" y1="125" x2="80" y2="155" stroke="#10b981" strokeWidth="2" />
          <line x1="310" y1="125" x2="310" y2="155" stroke="#10b981" strokeWidth="2" />
          {/* Readout Box */}
          <rect x="145" y="110" width="110" height="28" rx="4" fill="#0f1624" stroke="#10b981" strokeWidth="1.5" />
          <text x="156" y="128" fill="#10b981" fontSize="12" fontWeight="bold" fontFamily="monospace">15.00 m (±0.04m)</text>
          <text x="20" y="40" fill="#10b981" fontSize="11" fontWeight="bold" fontFamily="monospace">● METRIC SCALE CALIBRATED</text>
          <text x="20" y="60" fill="#94a3b8" fontSize="10" fontFamily="monospace">Reference Baseline: 15.00m · Scale Factor: 1.0000 m/unit</text>
        </svg>
      );

    case 9: // 10. AI Operational Findings
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#060b14" />
          {/* Finding Card 1 (Critical) */}
          <rect x="30" y="40" width="340" height="65" rx="6" fill="#0f1624" stroke="#ef4444" strokeWidth="1.5" />
          <circle cx="55" cy="72" r="12" fill="rgba(239,68,68,0.15)" stroke="#ef4444" />
          <text x="52" y="76" fill="#ef4444" fontSize="12" fontWeight="bold">!</text>
          <text x="78" y="62" fill="#ef4444" fontSize="10" fontWeight="bold" fontFamily="monospace">CRITICAL · RESTRICTED LANE OBSTRUCTION</text>
          <text x="78" y="78" fill="#ffffff" fontSize="11" fontWeight="bold">Vehicle stationary for &gt;180s in emergency zone</text>
          <text x="78" y="94" fill="#94a3b8" fontSize="9" fontFamily="monospace">Track T0011 · Frame 482 · Localized at [53.06, 50.45, 7.16]</text>
          {/* Finding Card 2 (Warning) */}
          <rect x="30" y="125" width="340" height="65" rx="6" fill="#0f1624" stroke="#f59e0b" strokeWidth="1.5" />
          <circle cx="55" cy="157" r="12" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" />
          <text x="52" y="161" fill="#f59e0b" fontSize="12" fontWeight="bold">▲</text>
          <text x="78" y="147" fill="#f59e0b" fontSize="10" fontWeight="bold" fontFamily="monospace">WARNING · SPEED ANOMALY DETECTED</text>
          <text x="78" y="163" fill="#ffffff" fontSize="11" fontWeight="bold">Truck velocity vector exceeds 45 km/h limit</text>
          <text x="78" y="179" fill="#94a3b8" fontSize="9" fontFamily="monospace">Track T0008 · Reprojection Conf: 91%</text>
        </svg>
      );

    case 10: // 11. Final Mission Report
    default:
      return (
        <svg viewBox="0 0 400 250" className="stage-svg">
          <rect width="400" height="250" fill="#050a14" />
          {/* Report Document Sheet */}
          <rect x="90" y="30" width="220" height="190" rx="6" fill="#0f1624" stroke="rgba(255,255,255,0.15)" />
          {/* Document Header */}
          <rect x="110" y="48" width="80" height="10" fill="#38bdf8" rx="2" />
          <rect x="110" y="66" width="160" height="4" fill="rgba(255,255,255,0.2)" rx="2" />
          <rect x="110" y="76" width="130" height="4" fill="rgba(255,255,255,0.2)" rx="2" />
          {/* Document Table Mock */}
          <line x1="110" y1="94" x2="280" y2="94" stroke="rgba(255,255,255,0.1)" />
          <rect x="110" y="104" width="60" height="6" fill="#10b981" rx="2" />
          <rect x="230" y="104" width="40" height="6" fill="#38bdf8" rx="2" />
          <rect x="110" y="118" width="70" height="6" fill="rgba(255,255,255,0.3)" rx="2" />
          <rect x="230" y="118" width="30" height="6" fill="rgba(255,255,255,0.3)" rx="2" />
          {/* Verification Badge */}
          <circle cx="260" cy="180" r="18" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="1.5" />
          <text x="249" y="184" fill="#10b981" fontSize="12" fontWeight="bold">✓</text>
          <text x="110" y="180" fill="#94a3b8" fontSize="9" fontFamily="monospace">AEROMESH CERTIFIED</text>
          <text x="110" y="194" fill="#38bdf8" fontSize="9" fontFamily="monospace">PDF · GeoJSON · CSV</text>
        </svg>
      );
  }
}

export default function HomePage({ onNavigateDashboard, onStartMission }) {
  const [activeStep, setActiveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [missionsList, setMissionsList] = useState([]);
  const [systemHealth, setSystemHealth] = useState({ online: true, status: "All Systems Operational" });
  const timerRef = useRef(null);

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
          status: data.status === "healthy" ? "All Systems Operational" : "Degraded",
        });
      })
      .catch(() => {
        if (active) setSystemHealth({ online: false, status: "Offline Mode (Local Fallback)" });
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
    setActiveStep((prev) => (prev - 1 + WORKFLOW_STAGES.length) % WORKFLOW_STAGES.length);
  };

  const currentStage = WORKFLOW_STAGES[activeStep];

  return (
    <div className="homepage" id="top">
      {/* 1. TOP NAVIGATION */}
      <nav className="homepage-nav">
        <div className="nav-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <div className="logo-icon">
            <Icon name="Radar" size={20} />
          </div>
          <div className="logo-text">
            <strong>AEROMESH</strong>
            <small>AERIAL INTELLIGENCE</small>
          </div>
        </div>

        <div className="nav-menu">
          <a href="#hero">Overview</a>
          <a href="#workflow">11-Step Workflow</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#missions">Missions</a>
          <a href="#architecture">Architecture</a>
        </div>

        <div className="nav-actions">
          <button className="nav-btn secondary" onClick={onNavigateDashboard}>
            Dashboard
          </button>
          <button className="nav-btn primary" onClick={onStartMission}>
            <Icon name="Plus" size={14} />
            New Mission
          </button>
        </div>
      </nav>

      {/* 2. CINEMATIC HERO SECTION */}
      <section className="homepage-hero" id="hero">
        <div className="hero-content">
          <div className="hero-text">
            <span className="hero-badge">
              <Icon name="Radar" size={13} />
              Commercial Aerial Intelligence & GIS
            </span>

            <h1>
              From Drone Footage
              <span>to 3D Intelligence</span>
            </h1>

            <p className="hero-subtitle">
              Transform aerial imagery into interactive 3D environments, object intelligence,
              spatial measurements and actionable mission insights.
            </p>

            <div className="hero-buttons">
              <button className="hero-btn-primary" onClick={onStartMission} id="btn-hero-start-mission">
                <Icon name="Plus" size={16} />
                Start New Mission
              </button>

              <button className="hero-btn-secondary" onClick={onNavigateDashboard} id="btn-hero-explore-demo">
                <Icon name="Box" size={16} />
                Explore Demo
              </button>
            </div>

            {/* Live Metrics Ticker */}
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
                <span className="hero-stat-val" style={{ color: systemHealth.online ? "#10b981" : "#f59e0b" }}>
                  {systemHealth.online ? "ONLINE" : "OFFLINE"}
                </span>
                <span className="hero-stat-label">Backend Ready</span>
              </div>
            </div>
          </div>

          {/* Right Console Card */}
          <div className="hero-console">
            <div className="console-header">
              <div className="console-title">
                <Icon name="Radar" size={14} />
                <span>MISSION COMMAND TELEMETRY</span>
              </div>
              <span className="badge-tag valid">SURFACE MESH ACTIVE</span>
            </div>

            <div className="console-display">
              <svg viewBox="0 0 500 320" className="console-svg-canvas">
                <defs>
                  <linearGradient id="meshGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0.1" />
                  </linearGradient>
                </defs>
                {/* 3D Wireframe Mesh Simulation */}
                <polygon points="100,240 250,140 400,240 250,290" fill="url(#meshGrad)" stroke="#38bdf8" strokeWidth="1.5" />
                <line x1="100" y1="240" x2="250" y2="240" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.5" />
                <line x1="400" y1="240" x2="250" y2="240" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.5" />
                <line x1="250" y1="140" x2="250" y2="290" stroke="#38bdf8" strokeWidth="1.2" strokeOpacity="0.6" />
                <line x1="175" y1="190" x2="325" y2="190" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.4" />
                {/* Localized 3D Object Box */}
                <polygon points="210,210 240,195 270,205 240,220" fill="rgba(245,158,11,0.4)" stroke="#f59e0b" strokeWidth="1.5" />
                <polygon points="210,195 240,180 270,190 240,205" fill="rgba(245,158,11,0.6)" stroke="#f59e0b" strokeWidth="1.5" />
                <line x1="210" y1="210" x2="210" y2="195" stroke="#f59e0b" strokeWidth="1.5" />
                <line x1="270" y1="205" x2="270" y2="190" stroke="#f59e0b" strokeWidth="1.5" />
                {/* HUD Overlay Tags */}
                <rect x="20" y="20" width="160" height="26" rx="4" fill="#0f1624" stroke="rgba(255,255,255,0.1)" />
                <text x="28" y="37" fill="#38bdf8" fontSize="11" fontWeight="bold" fontFamily="monospace">OBJ_T0011 · car · 94%</text>
                <text x="20" y="300" fill="#94a3b8" fontSize="10" fontFamily="monospace">Z ≈ 7.16m Road Plane · Reproj 1.95px</text>
              </svg>
            </div>

            <div className="console-footer">
              <div className="console-foot-item">
                <span>Photogrammetry</span>
                <strong>COLMAP + Poisson</strong>
              </div>
              <div className="console-foot-item">
                <span>Object Tracking</span>
                <strong>YOLOv11 + ByteTrack</strong>
              </div>
              <div className="console-foot-item">
                <span>Scale Status</span>
                <strong>Metric Calibrated (m)</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. THE 11-STAGE INTERACTIVE WORKFLOW SIMULATOR */}
      <section className="workflow-section" id="workflow">
        <div className="section-header-center">
          <span className="eyebrow">AEROMESH MISSION LIFECYCLE</span>
          <h2>The 11-Stage Aerial Intelligence Pipeline</h2>
          <p>
            From drone video ingestion to survey-grade 3D environment reconstruction,
            neural object localization, and calibrated geometric analytics.
          </p>
        </div>

        {/* 11-Step Scrub Bar */}
        <div className="workflow-stepper" role="tablist" aria-label="Pipeline Stages">
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

        {/* Dynamic Split Showcase Card */}
        <div className="workflow-stage-card">
          {/* Left Column: Information & Pipeline Telemetry */}
          <div className="stage-info-column">
            <div className="stage-header-meta">
              <span className="stage-phase-tag">
                <i style={{ width: 6, height: 6, borderRadius: "50%", background: "#38bdf8", display: "inline-block" }} />
                {currentStage.phase} · {currentStage.tag}
              </span>
              <h3 className="stage-title">{currentStage.title}</h3>
              <p className="stage-description">{currentStage.subtitle}</p>

              <div className="stage-tech-tags">
                {currentStage.tech.map((t, i) => (
                  <span key={i} className={`stage-tech-pill ${i === 0 ? "highlight" : ""}`}>
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Stage Navigation & Workspace Trigger */}
            <div className="stage-nav-controls">
              <div className="stage-player-controls">
                <button className="player-btn" onClick={handlePrevStep} title="Previous Stage">
                  ←
                </button>
                <button
                  className="player-btn"
                  onClick={() => setIsPlaying((p) => !p)}
                  title={isPlaying ? "Pause Auto-Advance" : "Play Auto-Advance"}
                >
                  {isPlaying ? "❚❚" : "▶"}
                </button>
                <button className="player-btn" onClick={handleNextStep} title="Next Stage">
                  →
                </button>
              </div>

              <button className="stage-action-link" onClick={onNavigateDashboard}>
                <span>Launch in Workspace</span>
                <Icon name="ArrowRight" size={14} />
              </button>
            </div>
          </div>

          {/* Right Column: Visual Graphic for this Step */}
          <div className="stage-visual-column">
            <div className="stage-canvas-wrapper">
              <StageVisualCanvas stageIndex={activeStep} />
            </div>
          </div>
        </div>
      </section>

      {/* 4. CORE CAPABILITIES */}
      <section className="capabilities-section" id="capabilities">
        <div className="section-header-center">
          <span className="eyebrow">ENTERPRISE SYSTEM ARCHITECTURE</span>
          <h2>Built for Precision GIS & Aerial Intelligence</h2>
          <p>
            Hardware-accelerated photogrammetry, real-time spatial fusion, and scientific scale calibration.
          </p>
        </div>

        <div className="capabilities-grid-4">
          <div className="cap-card">
            <div className="cap-card-icon">
              <Icon name="Box" size={20} />
            </div>
            <h3>3D Photogrammetry</h3>
            <p>
              COLMAP Structure-from-Motion paired with Depth Anything V2 depth estimation and Poisson meshing generates survey-grade 3D twins.
            </p>
          </div>

          <div className="cap-card">
            <div className="cap-card-icon">
              <Icon name="Radar" size={20} />
            </div>
            <h3>YOLOv11 Spatial Fusion</h3>
            <p>
              Deep learning models detect and track vehicles, infrastructure, and pedestrians, ray-triangulating 2D tracks into 3D world coordinates.
            </p>
          </div>

          <div className="cap-card">
            <div className="cap-card-icon">
              <Icon name="Ruler" size={20} />
            </div>
            <h3>Scale Calibration</h3>
            <p>
              Resolves monocular scale ambiguity via ground reference distance calibration, reporting certifiable metric meters for distance and height.
            </p>
          </div>

          <div className="cap-card">
            <div className="cap-card-icon">
              <Icon name="FileText" size={20} />
            </div>
            <h3>Standardized Handoff</h3>
            <p>
              Automated compilation of executive PDF engineering reports, GeoJSON GIS feature layers, CSV logs, and zipped evidence packages.
            </p>
          </div>
        </div>
      </section>

      {/* 5. RECENT MISSIONS */}
      <section className="missions-section" id="missions">
        <div className="section-header-center">
          <span className="eyebrow">MISSION ARCHIVE</span>
          <h2>Operational Flight Surveys</h2>
          <p>Live missions indexed in the database with complete spatial reconstruction packages.</p>
        </div>

        <div className="missions-table-card">
          <div className="missions-row-header">
            <div>Mission Title & ID</div>
            <div>UAV Platform</div>
            <div>Scale Status</div>
            <div>Reconstruction</div>
            <div>Action</div>
          </div>

          {missionsList.map((m) => (
            <div key={m.id} className="missions-row-item">
              <div>
                <span className="mission-row-id">{m.name || m.id}</span>
                <span style={{ display: "block", fontSize: "10px", color: "#64748b" }}>
                  {m.sector || "Operational Corridor A"}
                </span>
              </div>
              <div style={{ color: "#94a3b8" }}>{m.drone || "AERO-X4"}</div>
              <div>
                <span className={`badge-tag ${m.scale_status === "METRIC_CALIBRATED" ? "valid" : "low-conf"}`}>
                  {m.scale_status === "METRIC_CALIBRATED" ? "METRIC (m)" : "RELATIVE"}
                </span>
              </div>
              <div>
                <span className="badge-tag valid">SURFACE MESH</span>
              </div>
              <div>
                <button className="row-action-btn" onClick={onNavigateDashboard}>
                  Open →
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 6. CALL TO ACTION BANNER */}
      <section className="cta-banner" id="architecture">
        <div className="cta-banner-content">
          <span className="hero-badge">AEROMESH SIH DEMONSTRATION READY</span>
          <h2>Transform Aerial Footage into 3D Intelligence</h2>
          <p>
            Experience the complete end-to-end pipeline: video ingestion, neural object tracking,
            photogrammetric 3D reconstruction, and certified engineering reports.
          </p>
          <div className="hero-buttons" style={{ justifyContent: "center" }}>
            <button className="hero-btn-primary" onClick={onStartMission}>
              <Icon name="Plus" size={16} />
              Start New Mission
            </button>
            <button className="hero-btn-secondary" onClick={onNavigateDashboard}>
              <Icon name="Box" size={16} />
              Explore Demo
            </button>
          </div>
        </div>
      </section>

      {/* 7. FOOTER */}
      <footer className="homepage-footer">
        <div>
          <strong style={{ color: "#ffffff", letterSpacing: "0.08em" }}>AEROMESH AI</strong>
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
