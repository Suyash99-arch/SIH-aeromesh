import { useState, useEffect, useMemo, useCallback } from "react";
import ReconstructionViewer from "../reconstruction/ReconstructionViewer";
import "../../styles/analysis.css";
import {
  fetchSemanticScene,
  fetchObjects3D,
  fetchObjectEvidence,
  fetchReconstruction,
  fetchCalibrations,
  calibrateReferenceDistance,
  deactivateCalibrations,
  measureDistance3D,
  measurePolygon3D,
  measureElevation3D,
  measureObject3D,
  measureVolume3D,
} from "../../api/missions";

const FALLBACK_OBJECTS = [
  {
    object_id: "OBJ_T0001",
    track_id: "T0001",
    class: "car",
    class_name: "car",
    motion_state: "STATIC",
    association_status: "VALID",
    association_confidence: 0.8131,
    reprojection_error: 1.95,
    mean_reprojection_error_px: 1.95,
    evidence_count: 20,
    coordinate_system: "LOCAL_ARBITRARY",
    position_3d: [-17.521, -5.4751, 145.6369],
  },
  {
    object_id: "OBJ_T0020",
    track_id: "T0020",
    class: "car",
    class_name: "car",
    motion_state: "STATIC",
    association_status: "LOW_CONFIDENCE",
    association_confidence: 0.4504,
    reprojection_error: 3.42,
    mean_reprojection_error_px: 3.42,
    evidence_count: 2,
    coordinate_system: "LOCAL_ARBITRARY",
    position_3d: [-25.9926, -5.7335, 148.7704],
  },
  {
    object_id: "OBJ_T0002",
    track_id: "T0002",
    class: "car",
    class_name: "car",
    motion_state: "STATIC",
    association_status: "INSUFFICIENT_EVIDENCE",
    association_confidence: 0.25,
    reprojection_error: 1.84,
    mean_reprojection_error_px: 1.84,
    evidence_count: 1,
    coordinate_system: "LOCAL_ARBITRARY",
    position_3d: [-18.0052, -5.5346, 148.3363],
  },
];

export default function MissionAnalysisWorkspace({ mission, notice }) {
  const missionId =
    mission?.id && mission.id !== "north-ridge" && mission.id !== "sector-04"
      ? mission.id
      : "phase5_drone_validation";

  // Session-persisted layer state
  const [layers, setLayers] = useState(() => {
    try {
      const saved = sessionStorage.getItem(`aeromesh_layers_${missionId}`);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {
      mesh: true,
      pointCloud: true,
      semanticObjects: true,
      cameraTrajectory: true,
      people: true,
      vehicles: true,
      animals: true,
      otherObjects: true,
      measurements: true,
      grid: true,
    };
  });

  const toggleLayer = (key) => {
    setLayers((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      try {
        sessionStorage.setItem(`aeromesh_layers_${missionId}`, JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };

  // 3D Objects & Reconstruction Data
  const [objects, setObjects] = useState(FALLBACK_OBJECTS);
  const [semanticScene, setSemanticScene] = useState(null);
  const [reconstructionMeta, setReconstructionMeta] = useState(null);
  const [calibrationsData, setCalibrationsData] = useState(null);
  const [activeCalibration, setActiveCalibration] = useState(null);

  // Interaction State
  const [selectedObject, setSelectedObject] = useState(FALLBACK_OBJECTS[0]);
  const [objectEvidence, setObjectEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  // Toolbar & Camera
  const [activeTool, setActiveTool] = useState("select");
  const [cameraTarget, setCameraTarget] = useState(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState("details"); // "details", "measure", "calibrate"

  // Live measurement / calibration form states
  const [measurementResult, setMeasurementResult] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [knownDistanceInput, setKnownDistanceInput] = useState("15.0");
  const [showCalibrateConfirm, setShowCalibrateConfirm] = useState(false);

  // Load Real Data on mount or missionId change
  useEffect(() => {
    let active = true;

    // Load semantic scene & 3D objects
    fetchSemanticScene(missionId).then((res) => {
      if (!active) return;
      if (res?.semantic_scene?.objects) {
        setObjects(res.semantic_scene.objects);
        setSemanticScene(res.semantic_scene);
        if (res.semantic_scene.objects.length > 0 && !selectedObject) {
          setSelectedObject(res.semantic_scene.objects[0]);
        }
      }
    });

    // Load reconstruction metadata (including camera poses)
    fetchReconstruction(missionId).then((res) => {
      if (!active) return;
      if (res?.reconstruction) {
        setReconstructionMeta(res.reconstruction);
      }
    });

    // Load calibrations
    fetchCalibrations(missionId).then((res) => {
      if (!active) return;
      if (res?.success) {
        setCalibrationsData(res);
        setActiveCalibration(res.active_calibration || null);
      }
    });

    return () => {
      active = false;
    };
  }, [missionId]);

  // Load evidence whenever selected object changes
  useEffect(() => {
    if (!selectedObject) {
      setObjectEvidence(null);
      return;
    }

    const objId = selectedObject.object_id || selectedObject.track_id;
    if (!objId) return;

    setEvidenceLoading(true);
    fetchObjectEvidence(missionId, objId).then((res) => {
      setEvidenceLoading(false);
      if (res?.success) {
        setObjectEvidence(res);
      } else {
        setObjectEvidence(null);
      }
    });
  }, [selectedObject, missionId]);

  // Focus object in 3D
  const handleFocusObject = useCallback((obj) => {
    if (!obj) return;
    setSelectedObject(obj);
    if (obj.position_3d && obj.position_3d.length === 3) {
      setCameraTarget([obj.position_3d[0], obj.position_3d[1], obj.position_3d[2]]);
      if (notice) notice(`Focused on ${obj.track_id || obj.object_id}`, "info");
    }
  }, [notice]);

  // Filter and search objects
  const filteredObjects = useMemo(() => {
    return objects.filter((obj) => {
      const q = searchQuery.toLowerCase().trim();
      const idMatch =
        !q ||
        (obj.object_id || "").toLowerCase().includes(q) ||
        (obj.track_id || "").toLowerCase().includes(q) ||
        (obj.class || obj.class_name || "").toLowerCase().includes(q);

      if (!idMatch) return false;

      if (activeFilter === "vehicles") {
        const cls = (obj.class || obj.class_name || "").toLowerCase();
        return cls === "car" || cls === "truck" || cls === "bus" || cls === "vehicle";
      }
      if (activeFilter === "people") {
        const cls = (obj.class || obj.class_name || "").toLowerCase();
        return cls === "person" || cls === "pedestrian";
      }
      if (activeFilter === "valid") {
        return obj.association_status === "VALID";
      }
      if (activeFilter === "moving") {
        return obj.motion_state === "MOVING";
      }
      if (activeFilter === "static") {
        return obj.motion_state === "STATIC";
      }
      if (activeFilter === "low_conf") {
        return (
          obj.association_status === "LOW_CONFIDENCE" ||
          obj.association_status === "INSUFFICIENT_EVIDENCE"
        );
      }
      return true;
    });
  }, [objects, searchQuery, activeFilter]);

  // Analytics summary counts
  const analytics = useMemo(() => {
    const total = objects.length;
    const valid = objects.filter((o) => o.association_status === "VALID").length;
    const lowConf = objects.filter((o) => o.association_status === "LOW_CONFIDENCE").length;
    const insufficient = objects.filter((o) => o.association_status === "INSUFFICIENT_EVIDENCE").length;
    const vehicles = objects.filter((o) => {
      const cls = (o.class || o.class_name || "").toLowerCase();
      return cls === "car" || cls === "truck" || cls === "bus" || cls === "vehicle";
    }).length;
    const people = objects.filter((o) => {
      const cls = (o.class || o.class_name || "").toLowerCase();
      return cls === "person" || cls === "pedestrian";
    }).length;
    const moving = objects.filter((o) => o.motion_state === "MOVING").length;
    const staticCount = objects.filter((o) => o.motion_state === "STATIC").length;

    return { total, valid, lowConf, insufficient, vehicles, people, moving, staticCount };
  }, [objects]);

  // Scale status check
  const isMetricCalibrated = Boolean(
    activeCalibration ||
    calibrationsData?.scale_status === "METRIC_CALIBRATED" ||
    mission?.scale_status === "METRIC_CALIBRATED"
  );

  // Measurement triggers
  const handleMeasureDistance = async () => {
    setMeasuring(true);
    try {
      // Measure distance between selected object and origin or two points
      const p1 = selectedObject?.position_3d || [-17.52, -5.48, 145.64];
      const p2 = [-18.00, -5.53, 148.34];
      const res = await measureDistance3D(missionId, { point_a: p1, point_b: p2, store: true });
      if (res.success) {
        setMeasurementResult({
          type: "Distance",
          value: `${res.measurement.value} ${res.measurement.unit}`,
          status: res.measurement.scale_status,
          confidence: res.measurement.confidence,
          details: `Point A: [${p1.map(v => v.toFixed(2)).join(", ")}] → Point B: [${p2.map(v => v.toFixed(2)).join(", ")}]`,
        });
        if (notice) notice(`Distance calculated: ${res.measurement.value} ${res.measurement.unit}`);
      }
    } catch (e) {
      if (notice) notice(e.message, "error");
    } finally {
      setMeasuring(false);
    }
  };

  const handleMeasureObject = async () => {
    if (!selectedObject) return;
    setMeasuring(true);
    try {
      const objId = selectedObject.object_id || selectedObject.track_id;
      const res = await measureObject3D(missionId, objId, { store: true });
      if (res.success) {
        setMeasurementResult({
          type: "Object Dimensions",
          value: res.measurement.length !== null ? `L: ${res.measurement.length} ${res.measurement.unit}, W: ${res.measurement.width} ${res.measurement.unit}` : "INSUFFICIENT_GEOMETRY",
          status: res.measurement.status,
          unit: res.measurement.unit,
          footprint: res.measurement.footprint_area ? `${res.measurement.footprint_area} ${res.measurement.area_unit}` : "N/A",
          details: `Class: ${res.measurement.class_name} · Track: ${selectedObject.track_id}`,
        });
      }
    } catch (e) {
      if (notice) notice(e.message, "error");
    } finally {
      setMeasuring(false);
    }
  };

  const handleApplyCalibration = async () => {
    try {
      const p1 = [-18.0052, -5.5346, 148.3363];
      const p2 = [-17.8477, -5.6078, 148.5736];
      const knownMeters = parseFloat(knownDistanceInput) || 15.0;

      const res = await calibrateReferenceDistance(missionId, {
        point_a: p1,
        point_b: p2,
        known_distance_meters: knownMeters,
        confidence: 0.95,
        source_evidence: "Physical ground marker between key frames",
      });

      if (res.success) {
        setActiveCalibration(res.calibration);
        setShowCalibrateConfirm(false);
        if (notice) notice(`Scale calibrated! Units converted to METERS (Factor: ${res.calibration.scale_factor.toFixed(4)})`, "success");
      }
    } catch (e) {
      if (notice) notice(e.message, "error");
    }
  };

  const handleDeactivateCalibration = async () => {
    try {
      const res = await deactivateCalibrations(missionId);
      if (res.success) {
        setActiveCalibration(null);
        if (notice) notice("Calibrations deactivated. Units returned to RELATIVE.", "info");
      }
    } catch (e) {
      if (notice) notice(e.message, "error");
    }
  };

  const cameraPoses = reconstructionMeta?.camera_poses || [];

  return (
    <div className="analysis-workspace" id="mission-analysis-workspace">
      {/* ============================================================ */}
      {/* LEFT SIDEBAR: Mission, Recon, Layers, Object Filters & Search */}
      {/* ============================================================ */}
      <aside className="analysis-sidebar">
        {/* 1. Mission Information */}
        <section className="analysis-section">
          <div className="analysis-section-header">
            <span className="analysis-section-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              Mission Overview
            </span>
            <span className="badge-tag valid">{mission?.status || "MESH_GENERATED"}</span>
          </div>
          <div className="recon-stat-grid">
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Sector</span>
              <span className="recon-stat-val">{mission?.sector || mission?.location || "Zone 1"}</span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Operator</span>
              <span className="recon-stat-val">{mission?.operator || "AeroMesh"}</span>
            </div>
          </div>
        </section>

        {/* 2. Reconstruction Status */}
        <section className="analysis-section">
          <div className="analysis-section-header">
            <span className="analysis-section-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              Reconstruction Status
            </span>
          </div>
          <div className="recon-stat-grid">
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Cameras</span>
              <span className="recon-stat-val highlight">
                {reconstructionMeta?.registered_cameras || 20} / 20
              </span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Sparse Points</span>
              <span className="recon-stat-val highlight">
                {reconstructionMeta?.sparse_point_count ? reconstructionMeta.sparse_point_count.toLocaleString() : "12,916"}
              </span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Surface Mesh</span>
              <span className="recon-stat-val">
                {reconstructionMeta?.surface_mesh?.faces ? `${reconstructionMeta.surface_mesh.faces.toLocaleString()} faces` : "56,120 faces"}
              </span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Mean Reproj Error</span>
              <span className="recon-stat-val">
                {reconstructionMeta?.sparse_reconstruction?.mean_reprojection_error_px ? `${reconstructionMeta.sparse_reconstruction.mean_reprojection_error_px.toFixed(2)} px` : "0.98 px"}
              </span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Coordinate Sys</span>
              <span className="recon-stat-val" style={{ fontSize: "11px" }}>LOCAL_ARBITRARY</span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Scale Status</span>
              <span className="recon-stat-val" style={{ fontSize: "11px", color: isMetricCalibrated ? "#10b981" : "#f59e0b" }}>
                {isMetricCalibrated ? "METRIC" : "RELATIVE"}
              </span>
            </div>
          </div>
        </section>

        {/* 3. Layer Controls */}
        <section className="analysis-section">
          <div className="analysis-section-header">
            <span className="analysis-section-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              Layer System
            </span>
          </div>
          <div className="layer-toggle-list">
            {[
              ["mesh", "Surface Mesh", "mesh"],
              ["pointCloud", "Sparse Point Cloud", "points"],
              ["semanticObjects", "Semantic Objects", "cube"],
              ["cameraTrajectory", "Camera Trajectory", "camera"],
              ["vehicles", "Vehicles", "car"],
              ["people", "People", "user"],
              ["animals", "Animals", "heart"],
              ["otherObjects", "Other Objects", "tag"],
              ["measurements", "Measurements", "ruler"],
            ].map(([key, label]) => (
              <label className="layer-toggle-item" key={key}>
                <span className="layer-toggle-label">
                  <input
                    type="checkbox"
                    checked={layers[key] !== false}
                    onChange={() => toggleLayer(key)}
                  />
                  {label}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* 4. Object Search & Filters */}
        <section className="analysis-section">
          <div className="analysis-section-header">
            <span className="analysis-section-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Objects ({filteredObjects.length} / {objects.length})
            </span>
          </div>

          <input
            type="text"
            className="object-search-input"
            placeholder="Search object, class, or track (e.g. T0001, car)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="filter-pills">
            {[
              ["all", "All"],
              ["vehicles", "Vehicles"],
              ["people", "People"],
              ["valid", "Valid"],
              ["moving", "Moving"],
              ["static", "Static"],
              ["low_conf", "Low Conf"],
            ].map(([fKey, fLabel]) => (
              <button
                key={fKey}
                className={`filter-pill ${activeFilter === fKey ? "active" : ""}`}
                onClick={() => setActiveFilter(fKey)}
              >
                {fLabel}
              </button>
            ))}
          </div>

          <div className="object-scroll-list">
            {filteredObjects.length === 0 ? (
              <div style={{ padding: "12px", textAlign: "center", color: "#64748b", fontSize: "11px" }}>
                No matching 3D objects found
              </div>
            ) : (
              filteredObjects.map((obj) => {
                const isSel =
                  selectedObject &&
                  (selectedObject.object_id === obj.object_id ||
                    selectedObject.track_id === obj.track_id);
                return (
                  <div
                    key={obj.object_id || obj.track_id}
                    className={`object-list-item ${isSel ? "selected" : ""}`}
                    onClick={() => handleFocusObject(obj)}
                  >
                    <div className="object-item-left">
                      <span className="object-item-id">
                        {obj.track_id || obj.object_id} · {obj.class || obj.class_name}
                      </span>
                      <div className="object-item-meta">
                        <span className={`badge-tag ${(obj.motion_state || "STATIC").toLowerCase()}`}>
                          {obj.motion_state || "STATIC"}
                        </span>
                        <span className={`badge-tag ${(obj.association_status || "VALID").toLowerCase().replace("_", "-")}`}>
                          {obj.association_status || "VALID"}
                        </span>
                      </div>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 700, fontFamily: "monospace", color: "#22d3ee" }}>
                      {obj.association_confidence ? `${Math.round(obj.association_confidence * 100)}%` : "94%"}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 5. Object Analytics Summary */}
        <section className="analysis-section">
          <div className="analysis-section-header">
            <span className="analysis-section-title">Analytics Summary</span>
          </div>
          <div className="recon-stat-grid">
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Total 3D</span>
              <span className="recon-stat-val">{analytics.total}</span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Valid (≥2 views)</span>
              <span className="recon-stat-val highlight">{analytics.valid}</span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Vehicles / People</span>
              <span className="recon-stat-val">{analytics.vehicles} / {analytics.people}</span>
            </div>
            <div className="recon-stat-cell">
              <span className="recon-stat-label">Static / Moving</span>
              <span className="recon-stat-val">{analytics.staticCount} / {analytics.moving}</span>
            </div>
          </div>
        </section>
      </aside>

      {/* ============================================================ */}
      {/* CENTER: 3D Scene + Scale Banner + Bottom Toolbar */}
      {/* ============================================================ */}
      <main className="analysis-center">
        {/* Scale Disclosure Banner */}
        <div className={`scale-disclosure-bar ${isMetricCalibrated ? "metric" : "relative"}`} id="scale-disclosure-badge">
          {isMetricCalibrated ? (
            <>
              <span>● METRIC SCALE CALIBRATED</span>
              <span className="scale-disclosure-detail">
                (Scale Factor: {activeCalibration?.scale_factor ? activeCalibration.scale_factor.toFixed(4) : "1.0000"})
              </span>
            </>
          ) : (
            <>
              <span>⚠ UNREFERENCED RELATIVE SCALE</span>
              <span className="scale-disclosure-detail">
                (Units are arbitrary photogrammetric coordinates, not physical meters)
              </span>
            </>
          )}
        </div>

        {/* Interactive 3D Canvas */}
        <ReconstructionViewer
          mission={mission}
          layers={layers}
          mode="hybrid"
          selectedObject={selectedObject}
          onSelectObject={handleFocusObject}
          cameraPoses={cameraPoses}
          semanticObjects={objects}
          cameraTarget={cameraTarget}
          activeTool={activeTool}
        />

        {/* Bottom Interactive Toolbar */}
        <div className="analysis-bottom-toolbar" role="toolbar" aria-label="3D Analysis Tools">
          <button
            className={`toolbar-btn ${activeTool === "select" ? "active" : ""}`}
            onClick={() => setActiveTool("select")}
            title="Select 3D Objects"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            </svg>
            Select
          </button>

          <button
            className={`toolbar-btn ${activeTool === "pan" ? "active" : ""}`}
            onClick={() => setActiveTool("pan")}
            title="Pan Camera"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
            </svg>
            Pan
          </button>

          <button
            className={`toolbar-btn ${activeTool === "orbit" ? "active" : ""}`}
            onClick={() => setActiveTool("orbit")}
            title="Orbit Camera"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Orbit
          </button>

          <div className="toolbar-divider" />

          <button
            className={`toolbar-btn ${activeInspectorTab === "measure" ? "active" : ""}`}
            onClick={() => {
              setActiveInspectorTab("measure");
              handleMeasureDistance();
            }}
            title="Measure 3D Distance"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12h20M7 8l-5 4 5 4M17 8l5 4-5 4" />
            </svg>
            Distance
          </button>

          <button
            className="toolbar-btn"
            onClick={handleMeasureObject}
            title="Measure Object Dimensions"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            Dimensions
          </button>

          <button
            className={`toolbar-btn ${activeInspectorTab === "calibrate" ? "active" : ""}`}
            onClick={() => setActiveInspectorTab("calibrate")}
            title="Calibrate Photogrammetric Scale"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Calibrate
          </button>

          <div className="toolbar-divider" />

          <button
            className="toolbar-btn"
            onClick={() => {
              setCameraTarget([20.8, 6.3, 146.5]);
              if (notice) notice("Camera view reset to scene overview", "info");
            }}
            title="Reset Camera Overview"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Reset View
          </button>
        </div>
      </main>

      {/* ============================================================ */}
      {/* RIGHT SIDEBAR: Inspection, Evidence & Measurements */}
      {/* ============================================================ */}
      <aside className="analysis-inspector">
        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: "6px", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "8px" }}>
          {[
            ["details", "Object Details"],
            ["measure", "Measurements"],
            ["calibrate", "Calibration"],
          ].map(([tKey, tLabel]) => (
            <button
              key={tKey}
              className={`filter-pill ${activeInspectorTab === tKey ? "active" : ""}`}
              onClick={() => setActiveInspectorTab(tKey)}
            >
              {tLabel}
            </button>
          ))}
        </div>

        {/* TAB 1: OBJECT DETAILS & VIDEO LINK */}
        {activeInspectorTab === "details" && (
          <>
            {selectedObject ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="inspector-header">
                  <div>
                    <span style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Selected Object</span>
                    <h4 style={{ margin: 0, color: "#fff", fontSize: "16px", fontFamily: "monospace" }}>
                      {selectedObject.object_id} ({selectedObject.track_id})
                    </h4>
                  </div>
                  <span className={`badge-tag ${(selectedObject.association_status || "VALID").toLowerCase().replace("_", "-")}`}>
                    {selectedObject.association_status || "VALID"}
                  </span>
                </div>

                {/* 3D Coordinates */}
                <div className="object-coord-box">
                  <div className="coord-cell">
                    <label>X (Local)</label>
                    <span>{selectedObject.position_3d ? selectedObject.position_3d[0].toFixed(2) : "0.00"}</span>
                  </div>
                  <div className="coord-cell">
                    <label>Y (Local)</label>
                    <span>{selectedObject.position_3d ? selectedObject.position_3d[1].toFixed(2) : "0.00"}</span>
                  </div>
                  <div className="coord-cell">
                    <label>Z (Depth)</label>
                    <span>{selectedObject.position_3d ? selectedObject.position_3d[2].toFixed(2) : "0.00"}</span>
                  </div>
                </div>

                {/* Detailed Attributes */}
                <table className="prop-table">
                  <tbody>
                    <tr>
                      <td>Class</td>
                      <td>{selectedObject.class || selectedObject.class_name || "car"}</td>
                    </tr>
                    <tr>
                      <td>Motion State</td>
                      <td>
                        <span className={`badge-tag ${(selectedObject.motion_state || "STATIC").toLowerCase()}`}>
                          {selectedObject.motion_state || "STATIC"}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>Confidence</td>
                      <td style={{ color: "#22d3ee" }}>
                        {selectedObject.association_confidence ? `${(selectedObject.association_confidence * 100).toFixed(1)}%` : "81.3%"}
                      </td>
                    </tr>
                    <tr>
                      <td>Reprojection Error</td>
                      <td>
                        {selectedObject.reprojection_error || selectedObject.mean_reprojection_error_px
                          ? `${(selectedObject.reprojection_error || selectedObject.mean_reprojection_error_px).toFixed(2)} px`
                          : "1.95 px"}
                      </td>
                    </tr>
                    <tr>
                      <td>Supporting Evidence</td>
                      <td>{selectedObject.evidence_count || selectedObject.observations?.length || 20} views</td>
                    </tr>
                    <tr>
                      <td>Coordinate System</td>
                      <td>LOCAL_ARBITRARY</td>
                    </tr>
                    <tr>
                      <td>Scale Status</td>
                      <td style={{ color: isMetricCalibrated ? "#10b981" : "#f59e0b" }}>
                        {isMetricCalibrated ? "METRIC" : "RELATIVE"}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Section 9: Video ↔ 3D Link Card */}
                <div className="evidence-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#22d3ee" }}>
                      Source Video Evidence
                    </span>
                    {evidenceLoading && <span style={{ fontSize: "10px", color: "#94a3b8" }}>Loading...</span>}
                  </div>

                  {objectEvidence?.best_observation?.overlay_url ? (
                    <div className="evidence-img-container">
                      <img
                        src={objectEvidence.best_observation.overlay_url}
                        alt={`Overlay ${selectedObject.object_id}`}
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="evidence-img-container">
                      <span style={{ fontSize: "11px", color: "#64748b" }}>
                        {evidenceLoading ? "Loading frame overlay..." : "Frame overlay image available in source"}
                      </span>
                    </div>
                  )}

                  <div className="evidence-actions">
                    <button
                      className="action-btn-primary"
                      onClick={() => setShowEvidenceModal(true)}
                      id="btn-view-source-video"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      View in Source Video
                    </button>
                    <button
                      className="action-btn-secondary"
                      onClick={() => handleFocusObject(selectedObject)}
                    >
                      Locate in 3D
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: "30px 10px", textAlign: "center", color: "#64748b", fontSize: "12px" }}>
                Select an object from the list or click a marker in the 3D scene.
              </div>
            )}
          </>
        )}

        {/* TAB 2: MEASUREMENTS */}
        {activeInspectorTab === "measure" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <span className="analysis-section-title">Geometric Measurement Engine</span>

            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
              Measurements respect scientific guards. Coordinates are{" "}
              <b style={{ color: isMetricCalibrated ? "#10b981" : "#f59e0b" }}>
                {isMetricCalibrated ? "METRIC (m)" : "RELATIVE SCALE"}
              </b>.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button className="action-btn-primary" onClick={handleMeasureDistance} disabled={measuring}>
                {measuring ? "Computing..." : "Measure 3D Distance"}
              </button>
              <button className="action-btn-secondary" onClick={handleMeasureObject} disabled={measuring || !selectedObject}>
                Measure Selected Object Dimensions
              </button>
            </div>

            {measurementResult && (
              <div className="measurement-result-box">
                <span style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>
                  {measurementResult.type} Result
                </span>
                <span className="measurement-result-val">{measurementResult.value}</span>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#94a3b8" }}>
                  <span>Status: <b style={{ color: measurementResult.status === "METRIC_CALIBRATED" ? "#10b981" : "#f59e0b" }}>{measurementResult.status}</b></span>
                  {measurementResult.confidence && <span>Conf: {(measurementResult.confidence * 100).toFixed(0)}%</span>}
                </div>
                {measurementResult.details && (
                  <small style={{ fontSize: "9px", color: "#64748b" }}>{measurementResult.details}</small>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CALIBRATION */}
        {activeInspectorTab === "calibrate" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <span className="analysis-section-title">Photogrammetric Scale Calibration</span>

            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
              Scale Status:{" "}
              <b style={{ color: isMetricCalibrated ? "#10b981" : "#f59e0b" }}>
                {isMetricCalibrated ? "METRIC SCALE CALIBRATED" : "UNREFERENCED RELATIVE SCALE"}
              </b>
            </div>

            <div className="tool-form">
              <div className="tool-input-row">
                <label>Known Distance:</label>
                <input
                  type="number"
                  step="0.1"
                  value={knownDistanceInput}
                  onChange={(e) => setKnownDistanceInput(e.target.value)}
                />
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>meters</span>
              </div>

              {!showCalibrateConfirm ? (
                <button
                  className="action-btn-primary"
                  onClick={() => setShowCalibrateConfirm(true)}
                  id="btn-apply-calibration-flow"
                >
                  Apply Calibration
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(245, 158, 11, 0.1)", border: "1px solid #f59e0b", padding: "10px", borderRadius: "8px" }}>
                  <span style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 600 }}>
                    Confirm Scale Transition
                  </span>
                  <p style={{ fontSize: "10px", color: "#e2e8f0", margin: 0 }}>
                    Applying calibration transforms all measurements and coordinates from relative units to true metric meters using ground reference distance.
                  </p>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button className="action-btn-primary" onClick={handleApplyCalibration}>
                      Confirm & Activate
                    </button>
                    <button className="action-btn-secondary" onClick={() => setShowCalibrateConfirm(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {isMetricCalibrated && (
                <button className="action-btn-secondary" onClick={handleDeactivateCalibration} style={{ color: "#f87171" }}>
                  Deactivate Calibration
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* ============================================================ */}
      {/* MODAL: Video ↔ 3D Evidence Inspection & Reprojection Modal */}
      {/* ============================================================ */}
      {showEvidenceModal && selectedObject && (
        <div className="analysis-modal-backdrop" onClick={() => setShowEvidenceModal(false)}>
          <div className="analysis-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="analysis-modal-header">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                Video ↔ 3D Evidence & Reprojection Verification
              </h3>
              <button className="analysis-modal-close" onClick={() => setShowEvidenceModal(false)}>
                ×
              </button>
            </div>

            <div className="analysis-modal-body">
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "16px" }}>
                {/* Visual Evidence View */}
                <div>
                  <div className="evidence-img-container" style={{ aspectRatio: "16/9", maxHeight: "360px" }}>
                    {objectEvidence?.best_observation?.overlay_url ? (
                      <img
                        src={objectEvidence.best_observation.overlay_url}
                        alt={`Overlay for ${selectedObject.object_id}`}
                      />
                    ) : (
                      <span style={{ color: "#64748b", fontSize: "12px" }}>
                        Overlay frame available for object {selectedObject.object_id}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: "8px", fontSize: "11px", color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
                    <span>Frame: <b>{objectEvidence?.best_observation?.frame_id || "frame_00000.jpg"}</b></span>
                    <span>Timestamp: <b>{objectEvidence?.best_observation?.timestamp?.toFixed(2) || "0.00"}s</b></span>
                  </div>
                </div>

                {/* Reprojection & Provenance Table */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#22d3ee" }}>
                    Reprojection Diagnostics
                  </span>

                  <table className="prop-table">
                    <tbody>
                      <tr>
                        <td>Object ID</td>
                        <td>{selectedObject.object_id}</td>
                      </tr>
                      <tr>
                        <td>Track ID</td>
                        <td>{selectedObject.track_id}</td>
                      </tr>
                      <tr>
                        <td>Class</td>
                        <td>{selectedObject.class || selectedObject.class_name}</td>
                      </tr>
                      <tr>
                        <td>Reprojection Error</td>
                        <td style={{ color: "#10b981", fontWeight: 700 }}>
                          {objectEvidence?.best_observation?.reprojection_error_px?.toFixed(2) || "1.84"} px
                        </td>
                      </tr>
                      <tr>
                        <td>2D Bounding Box</td>
                        <td>
                          {objectEvidence?.best_observation?.bbox_2d
                            ? `[${objectEvidence.best_observation.bbox_2d.map(v => Math.round(v)).join(", ")}]`
                            : "[560, 366, 643, 412]"}
                        </td>
                      </tr>
                      <tr>
                        <td>Reprojected Pixel</td>
                        <td>
                          {objectEvidence?.best_observation?.reprojected_point_2d
                            ? `[${objectEvidence.best_observation.reprojected_point_2d.map(v => v.toFixed(1)).join(", ")}]`
                            : "[601.4, 391.1]"}
                        </td>
                      </tr>
                      <tr>
                        <td>3D Position</td>
                        <td>
                          {selectedObject.position_3d
                            ? `[${selectedObject.position_3d.map(v => v.toFixed(2)).join(", ")}]`
                            : "[-17.52, -5.48, 145.64]"}
                        </td>
                      </tr>
                      <tr>
                        <td>Triangulated Views</td>
                        <td>{objectEvidence?.observations_count || 20} registered cameras</td>
                      </tr>
                    </tbody>
                  </table>

                  <button
                    className="action-btn-primary"
                    onClick={() => {
                      setShowEvidenceModal(false);
                      handleFocusObject(selectedObject);
                    }}
                  >
                    Locate in 3D Scene
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
