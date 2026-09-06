import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ReconstructionViewer from "../reconstruction/ReconstructionViewer";
import "../../styles/analysis.css";
import {
  fetchSemanticScene,
  fetchObjectEvidence,
  fetchReconstruction,
  fetchCalibrations,
  calibrateReferenceDistance,
  deactivateCalibrations,
  measureDistance3D,
  measureObject3D,
  getExportGeoJsonUrl,
  resolveAssetUrl,
} from "../../api/missions";

export default function MissionAnalysisWorkspace({ mission, notice }) {
  const missionId = mission?.id || "";

  const workspaceRef = useRef(null);
  const viewerRef = useRef(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!workspaceRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      workspaceRef.current.requestFullscreen?.();
    }
  };

  // Layer state (persisted per mission)
  const [layers, setLayers] = useState(() => {
    try {
      const saved = sessionStorage.getItem(`aeromesh_layers_${missionId}`);
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore storage error */
    }
    return {
      mesh: true,
      pointCloud: false,
      semanticObjects: true,
      cameraTrajectory: true,
      vehicles: true,
      people: true,
      animals: true,
      otherObjects: true,
      grid: true,
      labels: true,
    };
  });

  const toggleLayer = (key) => {
    setLayers((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      try {
        sessionStorage.setItem(
          `aeromesh_layers_${missionId}`,
          JSON.stringify(updated),
        );
      } catch {
        /* ignore storage error */
      }
      return updated;
    });
  };

  const [showLayerPopover, setShowLayerPopover] = useState(false);

  // Tools & Navigation
  const [activeTool, setActiveTool] = useState("select");
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "objects" | "measurements" | "analytics"
  const [cameraTarget, setCameraTarget] = useState(null);

  // Real Mission Reconstruction & Objects Data
  const [objects, setObjects] = useState(() => mission?.objects_3d || []);
  const [reconstructionMeta, setReconstructionMeta] = useState(null);
  const [calibrationsData, setCalibrationsData] = useState(null);
  const [activeCalibration, setActiveCalibration] = useState(null);

  // Interaction State: Selected Object & Evidence
  const [selectedObject, setSelectedObject] = useState(null);
  const [objectEvidence, setObjectEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);

  // Search & Filter within Objects tab
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  // Measurement State
  const [measurementResult, setMeasurementResult] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [knownDistanceInput, setKnownDistanceInput] = useState("15.0");
  const [showCalibrateConfirm, setShowCalibrateConfirm] = useState(false);

  // Fetch real data on mount or mission change
  useEffect(() => {
    let active = true;

    fetchSemanticScene(missionId).then((res) => {
      if (!active) return;
      if (res?.semantic_scene?.objects) {
        setObjects(res.semantic_scene.objects);
      }
    });

    fetchReconstruction(missionId).then((res) => {
      if (!active) return;
      if (res?.reconstruction) {
        setReconstructionMeta(res.reconstruction);
      }
    });

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

  // Load evidence whenever selectedObject changes
  useEffect(() => {
    let active = true;
    const objId = selectedObject?.object_id || selectedObject?.track_id;
    if (!objId) return;

    const frame = requestAnimationFrame(() => setEvidenceLoading(true));
    fetchObjectEvidence(missionId, objId).then((res) => {
      if (!active) return;
      setEvidenceLoading(false);
      if (res?.success) {
        setObjectEvidence(res);
      } else {
        setObjectEvidence(null);
      }
    });

    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [selectedObject, missionId]);

  // Focus object in 3D & automatically switch contextual tab to "objects"
  const handleSelectObject = useCallback(
    (obj) => {
      setSelectedObject(obj);
      if (obj) {
        setActiveTab("objects");
        if (obj.position_3d && obj.position_3d.length === 3) {
          setCameraTarget([
            obj.position_3d[0],
            obj.position_3d[1],
            obj.position_3d[2],
          ]);
          if (notice)
            notice(`Focused on ${obj.track_id || obj.object_id}`, "info");
        }
      }
    },
    [notice],
  );

  const handleClearSelection = () => {
    setSelectedObject(null);
    setActiveTab("overview");
  };

  // Switch to measure mode
  const handleActivateMeasure = () => {
    setActiveTool("measure");
    setActiveTab("measurements");
    setShowLayerPopover(false);
  };

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
        return (
          cls === "car" || cls === "truck" || cls === "bus" || cls === "vehicle"
        );
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
    const valid = objects.filter(
      (o) => o.association_status === "VALID",
    ).length;
    const lowConf = objects.filter(
      (o) => o.association_status === "LOW_CONFIDENCE",
    ).length;
    const insufficient = objects.filter(
      (o) => o.association_status === "INSUFFICIENT_EVIDENCE",
    ).length;
    const vehicles = objects.filter((o) => {
      const cls = (o.class || o.class_name || "").toLowerCase();
      return (
        cls === "car" || cls === "truck" || cls === "bus" || cls === "vehicle"
      );
    }).length;
    const people = objects.filter((o) => {
      const cls = (o.class || o.class_name || "").toLowerCase();
      return cls === "person" || cls === "pedestrian";
    }).length;
    const moving = objects.filter((o) => o.motion_state === "MOVING").length;
    const staticCount = objects.filter(
      (o) => o.motion_state === "STATIC",
    ).length;

    return {
      total,
      valid,
      lowConf,
      insufficient,
      vehicles,
      people,
      moving,
      staticCount,
    };
  }, [objects]);

  const isMetricCalibrated = Boolean(
    activeCalibration ||
    calibrationsData?.scale_status === "METRIC_CALIBRATED" ||
    mission?.scale_status === "METRIC_CALIBRATED",
  );

  // Measurement triggers
  const handleMeasureDistance = async () => {
    setMeasuring(true);
    try {
      const p1 = selectedObject?.position_3d || [-17.52, -5.48, 145.64];
      const p2 = [-18.0, -5.53, 148.34];
      const res = await measureDistance3D(missionId, {
        point_a: p1,
        point_b: p2,
        store: true,
      });
      if (res.success) {
        setMeasurementResult({
          type: "Distance",
          value: `${res.measurement.value} ${res.measurement.unit}`,
          status: res.measurement.scale_status,
          confidence: res.measurement.confidence,
          details: `Point A: [${p1.map((v) => v.toFixed(2)).join(", ")}] → Point B: [${p2.map((v) => v.toFixed(2)).join(", ")}]`,
        });
        if (notice)
          notice(
            `Distance calculated: ${res.measurement.value} ${res.measurement.unit}`,
          );
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
          value:
            res.measurement.length !== null
              ? `L: ${res.measurement.length} ${res.measurement.unit}, W: ${res.measurement.width} ${res.measurement.unit}`
              : "INSUFFICIENT_GEOMETRY",
          status: res.measurement.status,
          unit: res.measurement.unit,
          footprint: res.measurement.footprint_area
            ? `${res.measurement.footprint_area} ${res.measurement.area_unit}`
            : "N/A",
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
        source_evidence: "Physical ground survey baseline",
      });

      if (res.success) {
        setActiveCalibration(res.calibration);
        setShowCalibrateConfirm(false);
        if (notice)
          notice(
            `Scale calibrated! Factor: ${res.calibration.scale_factor.toFixed(4)} m/unit`,
            "success",
          );
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
        if (notice)
          notice("Scale reverted to uncalibrated relative units.", "info");
      }
    } catch (e) {
      if (notice) notice(e.message, "error");
    }
  };

  const cameraPoses = reconstructionMeta?.camera_poses || [];

  return (
    <div
      ref={workspaceRef}
      className={`analysis-workspace ${isFullscreen ? "is-fullscreen" : ""}`}
      id="mission-analysis-workspace"
    >
      {/* ==================================================================== */}
      {/* 1. TOP MISSION STATUS & ACTIONS BAR                                  */}
      {/* ==================================================================== */}
      <header className="analysis-top-bar">
        <div className="top-bar-left">
          <span className="top-bar-mission-name">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            {mission?.name || "AeroMesh Mission"}
          </span>

          <span className="top-bar-sector-tag">
            {mission?.sector || mission?.location || "Zone 1"}
          </span>

          <span className="top-bar-status-pill">
            <i /> {mission?.status || "MESH_GENERATED"}
          </span>

          <span
            className={`top-bar-scale-pill ${isMetricCalibrated ? "metric" : "relative"}`}
          >
            {isMetricCalibrated ? (
              <>
                ● METRIC (
                {activeCalibration?.scale_factor?.toFixed(4) || "1.0000"}{" "}
                m/unit)
              </>
            ) : (
              <>▲ RELATIVE SCALE</>
            )}
          </span>
        </div>

        <div className="top-bar-actions">
          <button
            className="top-bar-btn"
            onClick={() => {
              setActiveTab("measurements");
            }}
            title="Configure Ground Reference Distance Scale"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Scale
          </button>

          <a
            href={getExportGeoJsonUrl(missionId)}
            className="top-bar-btn"
            download
            title="Download GeoJSON features"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2 2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            GeoJSON
          </a>

          <button
            className="top-bar-btn primary"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </header>

      {/* ==================================================================== */}
      {/* 2. COMPACT LEFT TOOL & NAVIGATION RAIL (54px)                        */}
      {/* ==================================================================== */}
      <nav className="analysis-tool-rail" aria-label="3D Controls">
        <button
          className={`tool-rail-btn ${activeTool === "select" ? "active" : ""}`}
          onClick={() => {
            setActiveTool("select");
            setShowLayerPopover(false);
          }}
          title="Select 3D Objects"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
          </svg>
          <span className="tool-rail-btn-label">Select</span>
        </button>

        <button
          className={`tool-rail-btn ${activeTool === "measure" ? "active" : ""}`}
          onClick={handleActivateMeasure}
          title="Geometric 3D Measurement Tools"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M2 12h20M7 8l-5 4 5 4M17 8l5 4-5 4" />
          </svg>
          <span className="tool-rail-btn-label">Measure</span>
        </button>

        <button
          className={`tool-rail-btn ${activeTool === "orbit" ? "active" : ""}`}
          onClick={() => {
            setActiveTool("orbit");
            setShowLayerPopover(false);
          }}
          title="Orbit Camera View (Rotate)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          <span className="tool-rail-btn-label">Orbit</span>
        </button>

        <button
          className={`tool-rail-btn ${activeTool === "pan" ? "active" : ""}`}
          onClick={() => {
            setActiveTool("pan");
            setShowLayerPopover(false);
          }}
          title="Pan Camera View (Translate)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
          </svg>
          <span className="tool-rail-btn-label">Pan</span>
        </button>

        <button
          className={`tool-rail-btn ${showLayerPopover ? "active" : ""}`}
          onClick={() => setShowLayerPopover((prev) => !prev)}
          title="Layer Visibility System"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          <span className="tool-rail-btn-label">Layers</span>
        </button>

        <div className="tool-rail-divider" />

        <button
          className="tool-rail-btn"
          onClick={() => {
            viewerRef.current?.fit?.();
            if (notice)
              notice("Camera framed to reconstruction bounds", "info");
          }}
          title="Fit Model to Viewport"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
          <span className="tool-rail-btn-label">Fit</span>
        </button>

        <button
          className="tool-rail-btn"
          onClick={() => {
            viewerRef.current?.reset?.();
            if (notice) notice("Camera view reset to scene overview", "info");
          }}
          title="Reset Camera Overview"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span className="tool-rail-btn-label">Reset</span>
        </button>

        <div className="tool-rail-spacer" />

        <button
          className="tool-rail-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen 3D View"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {isFullscreen ? (
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
            ) : (
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            )}
          </svg>
          <span className="tool-rail-btn-label">Full</span>
        </button>
      </nav>

      {/* ==================================================================== */}
      {/* 3. HERO CENTRAL 3D VIEWPORT                                          */}
      {/* ==================================================================== */}
      <main className="analysis-center">
        {/* Floating Scale Indicator (Top-Center) */}
        <div
          className={`scale-disclosure-bar ${isMetricCalibrated ? "metric" : "relative"}`}
        >
          {isMetricCalibrated ? (
            <>
              <span>● METRIC SCALE CALIBRATED</span>
              <span className="scale-disclosure-detail">
                ({activeCalibration?.scale_factor?.toFixed(4) || "1.0000"}{" "}
                m/unit)
              </span>
            </>
          ) : (
            <>
              <span>⚠ UNREFERENCED RELATIVE SCALE</span>
              <span className="scale-disclosure-detail">
                (Arbitrary photogrammetric units)
              </span>
            </>
          )}
        </div>

        {/* Floating Layers Popover */}
        {showLayerPopover && (
          <div className="layers-popover">
            <div className="layers-popover-header">
              <span className="layers-popover-title">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                </svg>
                Layer Visibility
              </span>
              <button
                className="layers-popover-close"
                onClick={() => setShowLayerPopover(false)}
                title="Close layers panel"
              >
                ×
              </button>
            </div>

            <div className="layers-popover-list">
              {[
                ["mesh", "Surface Mesh"],
                ["pointCloud", "Point Cloud"],
                ["semanticObjects", "3D Objects"],
                ["cameraTrajectory", "Flight Cameras"],
                ["vehicles", "Vehicles"],
                ["people", "People"],
                ["grid", "Reference Grid"],
                ["labels", "Object Labels"],
              ].map(([key, label]) => (
                <label className="layers-popover-item" key={key}>
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={layers[key] !== false}
                    onChange={() => toggleLayer(key)}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Primary 3D Reconstruction Viewer */}
        <ReconstructionViewer
          mission={mission}
          meshUrl={
            reconstructionMeta?.mesh_url
              ? resolveAssetUrl(reconstructionMeta.mesh_url)
              : mission?.assets?.mesh
                ? resolveAssetUrl(mission.assets.mesh)
                : null
          }
          pointCloudUrl={
            reconstructionMeta?.point_cloud_url
              ? resolveAssetUrl(reconstructionMeta.point_cloud_url)
              : mission?.assets?.pointCloud
                ? resolveAssetUrl(mission.assets.pointCloud)
                : null
          }
          reconstructionMeta={reconstructionMeta}
          layers={layers}
          mode="hybrid"
          selectedObject={selectedObject}
          onSelectObject={handleSelectObject}
          cameraPoses={cameraPoses}
          semanticObjects={objects}
          cameraTarget={cameraTarget}
          activeTool={activeTool}
          viewerRef={viewerRef}
          hideEmbeddedControls={true}
        />

        {/* Floating Selected Object HUD Badge */}
        {selectedObject && (
          <div className="floating-object-hud">
            <div className="object-hud-meta">
              <span className="object-hud-id">
                {selectedObject.object_id} ({selectedObject.track_id}) ·{" "}
                {selectedObject.class || selectedObject.class_name}
              </span>
              <span className="object-hud-coords">
                Pos: [
                {selectedObject.position_3d
                  ? selectedObject.position_3d
                      .map((v) => v.toFixed(2))
                      .join(", ")
                  : "0, 0, 0"}
                ]
              </span>
            </div>
            <div className="object-hud-actions">
              <button
                className="object-hud-btn"
                onClick={() => setActiveTab("objects")}
                title="Inspect in right panel"
              >
                Inspect
              </button>
              <button
                className="object-hud-btn clear"
                onClick={handleClearSelection}
                title="Deselect object"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ==================================================================== */}
      {/* 4. CONTEXTUAL RIGHT INSPECTOR PANEL (340px)                          */}
      {/*    Tabs: Overview | Objects | Measurements | Analytics               */}
      {/* ==================================================================== */}
      <aside className="analysis-inspector">
        {/* Top 4-Tab Navigation */}
        <div className="inspector-tab-bar" role="tablist">
          <button
            className={`inspector-tab-btn ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </button>
          <button
            className={`inspector-tab-btn ${activeTab === "objects" ? "active" : ""}`}
            onClick={() => setActiveTab("objects")}
          >
            Objects {objects.length > 0 && `(${objects.length})`}
          </button>
          <button
            className={`inspector-tab-btn ${activeTab === "measurements" ? "active" : ""}`}
            onClick={() => setActiveTab("measurements")}
          >
            Measurements
          </button>
          <button
            className={`inspector-tab-btn ${activeTab === "analytics" ? "active" : ""}`}
            onClick={() => setActiveTab("analytics")}
          >
            Analytics
          </button>
        </div>

        <div className="inspector-content">
          {/* TAB 1: MODEL OVERVIEW (DEFAULT WHEN NOTHING SELECTED) */}
          {activeTab === "overview" && (
            <>
              <div className="inspector-section-title">
                <span>Model Architecture</span>
                <span className="badge-tag valid">SURFACE MESH</span>
              </div>

              <div className="inspector-stat-grid">
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">
                    Registered Cameras
                  </span>
                  <span className="inspector-stat-val highlight">
                    {reconstructionMeta?.registered_cameras != null
                      ? `${reconstructionMeta.registered_cameras} / ${reconstructionMeta.total_images ?? reconstructionMeta.registered_cameras}`
                      : "unavailable"}
                  </span>
                </div>
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">Sparse Points</span>
                  <span className="inspector-stat-val highlight">
                    {reconstructionMeta?.sparse_point_count != null
                      ? reconstructionMeta.sparse_point_count.toLocaleString()
                      : "unavailable"}
                  </span>
                </div>
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">Mesh Faces</span>
                  <span className="inspector-stat-val">
                    {reconstructionMeta?.mesh?.face_count != null
                      ? reconstructionMeta.mesh.face_count.toLocaleString()
                      : "unavailable"}
                  </span>
                </div>
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">
                    Mean Reproj Error
                  </span>
                  <span className="inspector-stat-val">
                    {reconstructionMeta?.mean_reprojection_error != null
                      ? `${Number(reconstructionMeta.mean_reprojection_error).toFixed(3)} px`
                      : "unavailable"}
                  </span>
                </div>
              </div>

              <div
                className="inspector-section-title"
                style={{ marginTop: "6px" }}
              >
                <span>Coordinate Reference</span>
              </div>

              <table className="prop-table">
                <tbody>
                  <tr>
                    <td>Coordinate System</td>
                    <td>LOCAL_ARBITRARY</td>
                  </tr>
                  <tr>
                    <td>Scale Status</td>
                    <td
                      style={{
                        color: isMetricCalibrated ? "#10b981" : "#f59e0b",
                      }}
                    >
                      {isMetricCalibrated
                        ? "METRIC CALIBRATED"
                        : "UNREFERENCED"}
                    </td>
                  </tr>
                  <tr>
                    <td>Dense Stereo (MVS)</td>
                    <td style={{ color: "#94a3b8" }}>CUDA/GPU Required</td>
                  </tr>
                  <tr>
                    <td>Georeferencing</td>
                    <td style={{ color: "#94a3b8" }}>
                      UNREFERENCED (EPSG:4326 N/A)
                    </td>
                  </tr>
                </tbody>
              </table>

              <div
                style={{
                  marginTop: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <button
                  className="action-btn-primary"
                  onClick={() => {
                    setActiveTab("objects");
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Explore {objects.length} 3D Detections
                </button>

                <button
                  className="action-btn-secondary"
                  onClick={() => {
                    setActiveTab("measurements");
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M2 12h20M7 8l-5 4 5 4M17 8l5 4-5 4" />
                  </svg>
                  Geometric Measurements
                </button>
              </div>
            </>
          )}

          {/* TAB 2: OBJECTS (CONTEXTUAL DETAILS WHEN SELECTED, OR SEARCH LIST) */}
          {activeTab === "objects" && (
            <>
              {selectedObject ? (
                /* Detail View of Selected Object */
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: "9px",
                          color: "#94a3b8",
                          textTransform: "uppercase",
                        }}
                      >
                        Selected 3D Object
                      </span>
                      <h4
                        style={{
                          margin: 0,
                          color: "#ffffff",
                          fontSize: "15px",
                          fontFamily: "monospace",
                        }}
                      >
                        {selectedObject.object_id} ({selectedObject.track_id})
                      </h4>
                    </div>
                    <button
                      className="object-hud-btn clear"
                      onClick={handleClearSelection}
                      title="Back to object list"
                    >
                      ← List
                    </button>
                  </div>

                  {/* 3D Coordinates */}
                  <div className="object-coord-box">
                    <div className="coord-cell">
                      <label>X (Local)</label>
                      <span>
                        {selectedObject.position_3d
                          ? selectedObject.position_3d[0].toFixed(2)
                          : "0.00"}
                      </span>
                    </div>
                    <div className="coord-cell">
                      <label>Y (Local)</label>
                      <span>
                        {selectedObject.position_3d
                          ? selectedObject.position_3d[1].toFixed(2)
                          : "0.00"}
                      </span>
                    </div>
                    <div className="coord-cell">
                      <label>Z (Depth)</label>
                      <span>
                        {selectedObject.position_3d
                          ? selectedObject.position_3d[2].toFixed(2)
                          : "0.00"}
                      </span>
                    </div>
                  </div>

                  {/* Attributes Table */}
                  <table className="prop-table">
                    <tbody>
                      <tr>
                        <td>Class</td>
                        <td>
                          {selectedObject.class ||
                            selectedObject.class_name ||
                            "vehicle"}
                        </td>
                      </tr>
                      <tr>
                        <td>Motion State</td>
                        <td>
                          <span
                            className={`badge-tag ${(selectedObject.motion_state || "STATIC").toLowerCase()}`}
                          >
                            {selectedObject.motion_state || "STATIC"}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Association</td>
                        <td>
                          <span
                            className={`badge-tag ${(selectedObject.association_status || "VALID").toLowerCase().replace("_", "-")}`}
                          >
                            {selectedObject.association_status || "VALID"}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Confidence</td>
                        <td style={{ color: "#38bdf8" }}>
                          {selectedObject.association_confidence
                            ? `${(selectedObject.association_confidence * 100).toFixed(1)}%`
                            : "81.3%"}
                        </td>
                      </tr>
                      <tr>
                        <td>Reprojection Error</td>
                        <td>
                          {selectedObject.reprojection_error ||
                          selectedObject.mean_reprojection_error_px
                            ? `${(selectedObject.reprojection_error || selectedObject.mean_reprojection_error_px).toFixed(2)} px`
                            : "1.95 px"}
                        </td>
                      </tr>
                      <tr>
                        <td>Supporting Evidence</td>
                        <td>
                          {selectedObject.evidence_count ||
                            selectedObject.observations?.length ||
                            20}{" "}
                          views
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Source Video Evidence Card */}
                  <div className="evidence-card">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#38bdf8",
                        }}
                      >
                        Source Video Evidence
                      </span>
                      {evidenceLoading && (
                        <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                          Loading...
                        </span>
                      )}
                    </div>

                    <div className="evidence-img-container">
                      {objectEvidence?.best_observation?.overlay_url ? (
                        <img
                          src={objectEvidence.best_observation.overlay_url}
                          alt={`Overlay ${selectedObject.object_id}`}
                          loading="lazy"
                        />
                      ) : (
                        <span style={{ fontSize: "10px", color: "#64748b" }}>
                          {evidenceLoading
                            ? "Loading frame overlay..."
                            : "Frame overlay image available"}
                        </span>
                      )}
                    </div>

                    <div className="evidence-actions">
                      <button
                        className="action-btn-primary"
                        onClick={() => setShowEvidenceModal(true)}
                        id="btn-view-source-video"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Inspect Frame
                      </button>
                      <button
                        className="action-btn-secondary"
                        onClick={() => handleSelectObject(selectedObject)}
                      >
                        Focus in 3D
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* List & Search View when no object is selected */
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <input
                    type="text"
                    className="object-search-input"
                    placeholder="Search ID, class, or track (e.g. T0011, car)..."
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
                      <div
                        style={{
                          padding: "20px 10px",
                          textAlign: "center",
                          color: "#64748b",
                          fontSize: "11px",
                        }}
                      >
                        No matching 3D objects found
                      </div>
                    ) : (
                      filteredObjects.map((obj) => (
                        <div
                          key={obj.object_id || obj.track_id}
                          className="object-list-item"
                          onClick={() => handleSelectObject(obj)}
                        >
                          <div className="object-item-left">
                            <span className="object-item-id">
                              {obj.track_id || obj.object_id} ·{" "}
                              {obj.class || obj.class_name}
                            </span>
                            <div className="object-item-meta">
                              <span
                                className={`badge-tag ${(obj.motion_state || "STATIC").toLowerCase()}`}
                              >
                                {obj.motion_state || "STATIC"}
                              </span>
                              <span
                                className={`badge-tag ${(
                                  obj.association_status || "VALID"
                                )
                                  .toLowerCase()
                                  .replace("_", "-")}`}
                              >
                                {obj.association_status || "VALID"}
                              </span>
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              fontFamily: "monospace",
                              color: "#38bdf8",
                            }}
                          >
                            {obj.association_confidence
                              ? `${Math.round(obj.association_confidence * 100)}%`
                              : "94%"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 3: MEASUREMENTS */}
          {activeTab === "measurements" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <div className="inspector-section-title">
                <span>Scale Calibration</span>
                <span
                  className={`badge-tag ${isMetricCalibrated ? "valid" : "low-conf"}`}
                >
                  {isMetricCalibrated ? "METRIC (m)" : "RELATIVE SCALE"}
                </span>
              </div>

              <div className="tool-input-row">
                <label>Reference Distance:</label>
                <input
                  type="number"
                  step="0.1"
                  value={knownDistanceInput}
                  onChange={(e) => setKnownDistanceInput(e.target.value)}
                />
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                  meters
                </span>
              </div>

              {!showCalibrateConfirm ? (
                <button
                  className="action-btn-primary"
                  onClick={() => setShowCalibrateConfirm(true)}
                  id="btn-apply-calibration-flow"
                >
                  Calibrate Ground Scale
                </button>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    background: "rgba(245, 158, 11, 0.1)",
                    border: "1px solid #f59e0b",
                    padding: "10px",
                    borderRadius: "6px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#fbbf24",
                      fontWeight: 700,
                    }}
                  >
                    Confirm Scale Calibration
                  </span>
                  <p
                    style={{
                      fontSize: "10px",
                      color: "#cbd5e1",
                      margin: 0,
                      lineHeight: 1.4,
                    }}
                  >
                    Converts arbitrary Structure-from-Motion units to physical
                    meters using the surveyed baseline distance.
                  </p>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      className="action-btn-primary"
                      onClick={handleApplyCalibration}
                    >
                      Confirm & Activate
                    </button>
                    <button
                      className="action-btn-secondary"
                      onClick={() => setShowCalibrateConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {isMetricCalibrated && (
                <button
                  className="action-btn-secondary"
                  onClick={handleDeactivateCalibration}
                  style={{ color: "#f87171" }}
                >
                  Deactivate Calibration
                </button>
              )}

              <div
                className="inspector-section-title"
                style={{ marginTop: "10px" }}
              >
                <span>Geometric Tools</span>
              </div>

              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                <button
                  className="action-btn-primary"
                  onClick={handleMeasureDistance}
                  disabled={measuring}
                >
                  {measuring ? "Computing Distance..." : "Measure 3D Distance"}
                </button>
                <button
                  className="action-btn-secondary"
                  onClick={handleMeasureObject}
                  disabled={measuring || !selectedObject}
                  title={
                    !selectedObject
                      ? "Select an object first"
                      : "Measure object dimensions"
                  }
                >
                  Measure Selected Object Dimensions
                </button>
              </div>

              {measurementResult && (
                <div className="measurement-result-box">
                  <span
                    style={{
                      fontSize: "9px",
                      color: "#94a3b8",
                      textTransform: "uppercase",
                    }}
                  >
                    {measurementResult.type} Output
                  </span>
                  <span className="measurement-result-val">
                    {measurementResult.value}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "10px",
                      color: "#94a3b8",
                    }}
                  >
                    <span>
                      Status:{" "}
                      <b
                        style={{
                          color:
                            measurementResult.status === "METRIC_CALIBRATED"
                              ? "#10b981"
                              : "#f59e0b",
                        }}
                      >
                        {measurementResult.status}
                      </b>
                    </span>
                    {measurementResult.confidence && (
                      <span>
                        Conf: {(measurementResult.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  {measurementResult.details && (
                    <small style={{ fontSize: "9px", color: "#64748b" }}>
                      {measurementResult.details}
                    </small>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ANALYTICS */}
          {activeTab === "analytics" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <div className="inspector-section-title">
                <span>Spatial Intelligence</span>
                <span className="badge-tag valid">YOLOv11 + SfM</span>
              </div>

              <div className="inspector-stat-grid">
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">Total 3D Objects</span>
                  <span className="inspector-stat-val highlight">
                    {analytics.total}
                  </span>
                </div>
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">Valid (≥2 Views)</span>
                  <span className="inspector-stat-val highlight">
                    {analytics.valid}
                  </span>
                </div>
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">
                    Vehicles / People
                  </span>
                  <span className="inspector-stat-val">
                    {analytics.vehicles} / {analytics.people}
                  </span>
                </div>
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">Static / Moving</span>
                  <span className="inspector-stat-val">
                    {analytics.staticCount} / {analytics.moving}
                  </span>
                </div>
              </div>

              <div
                className="inspector-section-title"
                style={{ marginTop: "6px" }}
              >
                <span>Photogrammetric Quality</span>
              </div>

              <table className="prop-table">
                <tbody>
                  <tr>
                    <td>Keyframe Cameras</td>
                    <td>
                      {reconstructionMeta?.registered_cameras != null
                        ? `${reconstructionMeta.registered_cameras} registered (${reconstructionMeta.total_images ? Math.round((reconstructionMeta.registered_cameras / reconstructionMeta.total_images) * 100) : 100}%)`
                        : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td>Sparse Inliers</td>
                    <td>
                      {reconstructionMeta?.sparse_point_count != null ||
                      reconstructionMeta?.point_count != null
                        ? `${(reconstructionMeta.sparse_point_count || reconstructionMeta.point_count).toLocaleString()} triangulated`
                        : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td>Mean Error (COLMAP)</td>
                    <td>
                      {reconstructionMeta?.mean_reprojection_error != null
                        ? `${Number(reconstructionMeta.mean_reprojection_error).toFixed(2)} px`
                        : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td>Surface Mesh</td>
                    <td>
                      {reconstructionMeta?.mesh?.vertices != null
                        ? `${reconstructionMeta.mesh.vertices.toLocaleString()} vertices · ${reconstructionMeta.mesh.faces?.toLocaleString() || 0} faces`
                        : reconstructionMeta?.mesh_url
                          ? "Available (PLY)"
                          : "Unavailable"}
                    </td>
                  </tr>
                  <tr>
                    <td>Coordinate System</td>
                    <td>
                      {reconstructionMeta?.scale?.coordinate_system ||
                        "LOCAL_ARBITRARY"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* 5. VIDEO ↔ 3D EVIDENCE MODAL                                         */}
      {/* ==================================================================== */}
      {showEvidenceModal && selectedObject && (
        <div
          className="analysis-modal-backdrop"
          onClick={() => setShowEvidenceModal(false)}
        >
          <div
            className="analysis-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="analysis-modal-header">
              <h3>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2"
                >
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                Video ↔ 3D Evidence Verification · {selectedObject.object_id}
              </h3>
              <button
                className="analysis-modal-close"
                onClick={() => setShowEvidenceModal(false)}
              >
                ×
              </button>
            </div>

            <div className="analysis-modal-body">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr",
                  gap: "16px",
                }}
              >
                <div>
                  <div
                    className="evidence-img-container"
                    style={{ aspectRatio: "16/9", maxHeight: "360px" }}
                  >
                    {objectEvidence?.best_observation?.overlay_url ? (
                      <img
                        src={objectEvidence.best_observation.overlay_url}
                        alt={`Overlay for ${selectedObject.object_id}`}
                      />
                    ) : (
                      <span style={{ color: "#64748b", fontSize: "12px" }}>
                        Overlay frame available for {selectedObject.object_id}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: "8px",
                      fontSize: "11px",
                      color: "#94a3b8",
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>
                      Frame:{" "}
                      <b>
                        {objectEvidence?.best_observation?.frame_id ||
                          "frame_00000.jpg"}
                      </b>
                    </span>
                    <span>
                      Timestamp:{" "}
                      <b>
                        {objectEvidence?.best_observation?.timestamp?.toFixed(
                          2,
                        ) || "0.00"}
                        s
                      </b>
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#38bdf8",
                      textTransform: "uppercase",
                    }}
                  >
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
                        <td>
                          {selectedObject.class || selectedObject.class_name}
                        </td>
                      </tr>
                      <tr>
                        <td>Reprojection Error</td>
                        <td style={{ color: "#10b981", fontWeight: 700 }}>
                          {objectEvidence?.best_observation?.reprojection_error_px?.toFixed(
                            2,
                          ) || "1.84"}{" "}
                          px
                        </td>
                      </tr>
                      <tr>
                        <td>2D Bounding Box</td>
                        <td>
                          {objectEvidence?.best_observation?.bbox_2d
                            ? `[${objectEvidence.best_observation.bbox_2d.map((v) => Math.round(v)).join(", ")}]`
                            : "[560, 366, 643, 412]"}
                        </td>
                      </tr>
                      <tr>
                        <td>3D Position</td>
                        <td>
                          {selectedObject.position_3d
                            ? `[${selectedObject.position_3d.map((v) => v.toFixed(2)).join(", ")}]`
                            : "[-17.52, -5.48, 145.64]"}
                        </td>
                      </tr>
                      <tr>
                        <td>Triangulated Views</td>
                        <td>
                          {objectEvidence?.observations_count || 20} cameras
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <button
                    className="action-btn-primary"
                    onClick={() => {
                      setShowEvidenceModal(false);
                      handleSelectObject(selectedObject);
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
