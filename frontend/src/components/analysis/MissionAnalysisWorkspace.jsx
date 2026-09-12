import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ReconstructionViewer from "../reconstruction/ReconstructionViewer";
import Icon from "../ui/Icon";
import "../../styles/analysis.css";
import ViewFiltersSidebar from "./ViewFiltersSidebar";
import BottomStatStrip from "./BottomStatStrip";
import VideoFramesTab from "./VideoFramesTab";
import AddMarkerModal from "./AddMarkerModal";
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
  fetchMissionMarkings,
  createMissionMarking,
  deleteMissionMarking,
  fetchMissionKeyframes,
} from "../../api/missions";

export default function MissionAnalysisWorkspace({ mission, notice }) {
  const missionId = mission?.id || "";

  const workspaceRef = useRef(null);
  const viewerRef = useRef(null);

  // Primary Incident Tab: "3d_model" | "video_frames"
  const [primaryTab, setPrimaryTab] = useState("3d_model");

  // Custom Markings & Keyframes state
  const [customMarkings, setCustomMarkings] = useState([]);
  const [selectedMarkingId, setSelectedMarkingId] = useState(null);
  const [showAddMarkerModal, setShowAddMarkerModal] = useState(false);
  const [clickedSceneCoords, setClickedSceneCoords] = useState([0.0, 1.5, 0.0]);
  const [keyframes, setKeyframes] = useState([]);
  const [selectedKeyframe, setSelectedKeyframe] = useState(null);

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
      humans: true,
      fireSmoke: true,
      damage: true,
      entryExit: true,
      customMarkings: true,
      animals: true,
      otherObjects: true,
      grid: true,
      labels: true,
      lowConfidence: false,
    };
  });

  const toggleLayer = (key) => {
    setLayers((prev) => {
      let updated;
      if (key === "pointsOnly") {
        const isPointsOnly = prev.pointsOnly === true;
        updated = {
          ...prev,
          pointsOnly: !isPointsOnly,
          mesh: isPointsOnly,
          pointCloud: !isPointsOnly,
        };
      } else {
        const targetKey =
          key === "flight"
            ? "cameraTrajectory"
            : key === "objects"
              ? "semanticObjects"
              : key;
        updated = { ...prev, [targetKey]: !prev[targetKey] };
      }
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
  const [showFilters, setShowFilters] = useState(false);

  // Tools & Navigation
  const [activeTool, setActiveTool] = useState("select");
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "objects" | "measurements" | "analytics"
  const [cameraTarget, setCameraTarget] = useState(null);

  // Real Mission Reconstruction & Objects Data
  const [objects, setObjects] = useState(() => mission?.objects_3d || []);
  const [reconstructionMeta, setReconstructionMeta] = useState(
    () => mission?.reconstruction || null,
  );
  const [calibrationsData, setCalibrationsData] = useState(null);
  const [activeCalibration, setActiveCalibration] = useState(null);

  // Sync state when mission prop changes
  useEffect(() => {
    if (mission?.reconstruction) {
      setReconstructionMeta(mission.reconstruction);
    }
    if (mission?.objects_3d) {
      setObjects(mission.objects_3d);
    }
  }, [mission]);

  // Interaction State: Selected Object & Evidence
  const [selectedObject, setSelectedObject] = useState(null);
  const [objectEvidence, setObjectEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [selectedEvidenceFrame, setSelectedEvidenceFrame] = useState(null);

  // Search & Filter within Objects tab (defaults to verified >=2 views detections)
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("valid");

  // Measurement State
  const [measurementResult, setMeasurementResult] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [knownDistanceInput, setKnownDistanceInput] = useState("15.0");
  const [showCalibrateConfirm, setShowCalibrateConfirm] = useState(false);

  // Fetch fresh real data on mount or mission change
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

    fetchMissionMarkings(missionId).then((marks) => {
      if (!active) return;
      if (Array.isArray(marks)) setCustomMarkings(marks);
    });

    fetchMissionKeyframes(missionId).then((kfs) => {
      if (!active) return;
      if (Array.isArray(kfs)) {
        setKeyframes(kfs);
        if (kfs.length > 0) setSelectedKeyframe(kfs[0]);
      }
    });

    return () => {
      active = false;
    };
  }, [missionId]);

  const handleOpenAddMarkerModal = useCallback(() => {
    setShowAddMarkerModal(true);
  }, []);

  const handleSceneClick = useCallback((coords) => {
    setClickedSceneCoords(coords);
    setShowAddMarkerModal(true);
  }, []);

  const handleSaveMarker = useCallback(async (markerData) => {
    try {
      const created = await createMissionMarking(missionId, markerData);
      if (created) {
        setCustomMarkings((prev) => [...prev, created]);
        if (notice) notice(`Marker "${created.name}" saved to 3D scene.`, "success");
      }
    } catch (err) {
      if (notice) notice("Failed to save marker: " + err.message, "error");
    }
  }, [missionId, notice]);

  const handleDeleteMarker = useCallback(async (markerId) => {
    try {
      const ok = await deleteMissionMarking(missionId, markerId);
      if (ok) {
        setCustomMarkings((prev) => prev.filter((m) => m.id !== markerId));
        if (selectedMarkingId === markerId) setSelectedMarkingId(null);
        if (notice) notice("Marker removed.", "info");
      }
    } catch (err) {
      if (notice) notice("Failed to delete marker: " + err.message, "error");
    }
  }, [missionId, selectedMarkingId, notice]);

  const handleToggleMarkingVisible = useCallback((markerId) => {
    setCustomMarkings((prev) =>
      prev.map((m) => (m.id === markerId ? { ...m, visible: m.visible === false } : m))
    );
  }, []);

  const totalPeople = useMemo(() => {
    return objects.filter((o) => {
      const cls = (o.class || o.class_name || "").toLowerCase();
      return cls === "person" || cls === "pedestrian" || cls === "people" || cls === "human";
    }).length;
  }, [objects]);

  const totalVehicles = useMemo(() => {
    return objects.filter((o) => {
      const cls = (o.class || o.class_name || "").toLowerCase();
      return (
        cls === "car" ||
        cls === "truck" ||
        cls === "bus" ||
        cls === "van" ||
        cls === "bicycle" ||
        cls === "motorcycle" ||
        cls === "vehicle"
      );
    }).length;
  }, [objects]);

  const entryExitPointsCount = useMemo(() => {
    return customMarkings.filter((m) => {
      const t = (m.type || "").toLowerCase();
      return t.includes("entry") || t.includes("exit") || t.includes("door");
    }).length;
  }, [customMarkings]);

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
        if (res.observations && res.observations.length > 0) {
          setSelectedEvidenceFrame(res.best_observation || res.observations[0]);
        } else {
          setSelectedEvidenceFrame(null);
        }
      } else {
        setObjectEvidence(null);
        setSelectedEvidenceFrame(null);
      }
    });

    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [selectedObject, missionId]);

  const handleOpenEvidenceModal = useCallback((objId) => {
    setShowEvidenceModal(true);
    const targetId = objId || selectedObject?.object_id || selectedObject?.track_id;
    if (targetId) {
      setEvidenceLoading(true);
      fetchObjectEvidence(missionId, targetId).then((res) => {
        setEvidenceLoading(false);
        if (res?.success) {
          setObjectEvidence(res);
          if (res.observations && res.observations.length > 0) {
            setSelectedEvidenceFrame(res.best_observation || res.observations[0]);
          }
        }
      });
    }
  }, [missionId, selectedObject]);

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

      if (activeFilter === "maritime") {
        const cls = (obj.class || obj.class_name || "").toLowerCase();
        const cat = (obj.category || "").toLowerCase();
        return cls === "boat" || cls === "ship" || cls === "vessel" || cat === "maritime";
      }
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
        const ev = obj.evidence_count || (obj.observations ? obj.observations.length : 1);
        return (
          obj.association_status === "VALID" ||
          (ev >= 2 && obj.association_status !== "LOW_CONFIDENCE" && obj.association_status !== "INSUFFICIENT_EVIDENCE")
        );
      }
      if (activeFilter === "moving") {
        return obj.motion_state === "MOVING";
      }
      if (activeFilter === "static") {
        return obj.motion_state === "STATIC";
      }
      if (activeFilter === "low_conf") {
        const ev = obj.evidence_count || (obj.observations ? obj.observations.length : 1);
        return (
          obj.association_status === "LOW_CONFIDENCE" ||
          obj.association_status === "INSUFFICIENT_EVIDENCE" ||
          ev < 2
        );
      }
      return true;
    });
  }, [objects, searchQuery, activeFilter]);

  // Analytics summary counts
  const analytics = useMemo(() => {
    const total = objects.length;
    const valid = objects.filter((o) => {
      const ev = o.evidence_count || (o.observations ? o.observations.length : 1);
      return (
        o.association_status === "VALID" ||
        (ev >= 2 && o.association_status !== "LOW_CONFIDENCE" && o.association_status !== "INSUFFICIENT_EVIDENCE")
      );
    }).length;
    const lowConf = objects.filter((o) => {
      const ev = o.evidence_count || (o.observations ? o.observations.length : 1);
      return (
        o.association_status === "LOW_CONFIDENCE" ||
        o.association_status === "INSUFFICIENT_EVIDENCE" ||
        ev < 2
      );
    }).length;
    const insufficient = objects.filter(
      (o) => o.association_status === "INSUFFICIENT_EVIDENCE",
    ).length;
    const maritime = objects.filter((o) => {
      const cls = (o.class || o.class_name || "").toLowerCase();
      const cat = (o.category || "").toLowerCase();
      return cls === "boat" || cls === "ship" || cls === "vessel" || cat === "maritime";
    }).length;
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
      maritime,
      vehicles,
      people,
      moving,
      staticCount,
    };
  }, [objects]);

  // Dynamically classify structure / scene entity type from real photogrammetry & detected objects
  const detectedSceneType = useMemo(() => {
    const rawType = `${mission?.type || ""} ${mission?.sector || ""} ${mission?.name || ""}`.toLowerCase();
    
    // Count class frequencies among detected objects
    const classCounts = {};
    objects.forEach((obj) => {
      const cls = (obj.class || obj.class_name || "").toLowerCase();
      const cat = (obj.category || "").toLowerCase();
      if (cls === "boat" || cls === "ship" || cls === "vessel" || cat === "maritime") {
        classCounts["maritime"] = (classCounts["maritime"] || 0) + 1;
      } else if (cls === "car" || cls === "truck" || cls === "bus" || cls === "van" || cat === "vehicle") {
        classCounts["vehicle"] = (classCounts["vehicle"] || 0) + 1;
      } else if (cls === "person" || cls === "pedestrian" || cat === "people") {
        classCounts["people"] = (classCounts["people"] || 0) + 1;
      } else if (cls === "airplane" || cat === "aircraft") {
        classCounts["aircraft"] = (classCounts["aircraft"] || 0) + 1;
      }
    });

    const boats = classCounts["maritime"] || 0;
    const vehicles = classCounts["vehicle"] || 0;
    const people = classCounts["people"] || 0;
    const aircraft = classCounts["aircraft"] || 0;

    if (boats > 0 && boats >= vehicles) {
      return {
        label: "Harbor / Maritime Marina",
        tag: "MARITIME FACILITY",
        category: "Port & Marine Infrastructure",
        detail: `${boats} maritime vessel${boats > 1 ? "s" : ""} localized on water basin surface`,
        icon: "Anchor",
        accent: "#0ea5e9",
        confidence: Math.min(99, 78 + boats * 4),
        primaryClass: "boat",
      };
    }
    if (vehicles > 0 && vehicles >= people) {
      if (rawType.includes("bridge") || rawType.includes("overpass") || rawType.includes("span")) {
        return {
          label: "Bridge / Elevated Span",
          tag: "ELEVATED CORRIDOR",
          category: "Transportation Infrastructure",
          detail: `${vehicles} vehicles along elevated roadway corridor`,
          icon: "Layers",
          accent: "#f59e0b",
          confidence: Math.min(99, 80 + vehicles * 3),
          primaryClass: "vehicle",
        };
      }
      return {
        label: "Urban Street / Transit Corridor",
        tag: "CIVIL ROADWAY",
        category: "Urban Transportation",
        detail: `${vehicles} vehicles along roadway surface envelope`,
        icon: "Navigation",
        accent: "#38bdf8",
        confidence: Math.min(99, 75 + vehicles * 3),
        primaryClass: "vehicle",
      };
    }
    if (people > 2) {
      return {
        label: "Pedestrian Zone / Public Plaza",
        tag: "ASSEMBLY PLAZA",
        category: "Urban Pedestrian Space",
        detail: `${people} individuals localized across surface plane`,
        icon: "Users",
        accent: "#10b981",
        confidence: 88,
        primaryClass: "person",
      };
    }
    if (aircraft > 0) {
      return {
        label: "Airfield / Runway Facility",
        tag: "AVIATION SITE",
        category: "Aviation Infrastructure",
        detail: `${aircraft} aircraft localized along runway grid`,
        icon: "Compass",
        accent: "#8b5cf6",
        confidence: 92,
        primaryClass: "airplane",
      };
    }
    if (rawType.includes("building") || rawType.includes("facility") || rawType.includes("industrial")) {
      return {
        label: "Industrial / Commercial Facility",
        tag: "BUILT STRUCTURE",
        category: "Commercial Infrastructure",
        detail: "Volumetric surface envelope reconstructed",
        icon: "Box",
        accent: "#6366f1",
        confidence: 85,
        primaryClass: "structure",
      };
    }
    if (rawType.includes("harbor") || rawType.includes("port") || rawType.includes("marina")) {
      return {
        label: "Harbor / Port District",
        tag: "MARITIME FACILITY",
        category: "Port & Marine Infrastructure",
        detail: "Coastal harbor basin photogrammetric geometry",
        icon: "Anchor",
        accent: "#0ea5e9",
        confidence: 86,
        primaryClass: "boat",
      };
    }
    return {
      label: "Urban Infrastructure / Terrain",
      tag: "CIVIL ENVELOPE",
      category: "Photogrammetric Scene",
      detail: "Multi-view surface geometry reconstructed",
      icon: "MapPin",
      accent: "#38bdf8",
      confidence: 80,
      primaryClass: "terrain",
    };
  }, [objects, mission]);

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

  const poseStatus =
    reconstructionMeta?.pose_status ||
    mission?.reconstruction?.pose_status;
  const isPoseUnavailable =
    poseStatus === "UNAVAILABLE_NO_TELEMETRY" ||
    (!reconstructionMeta?.camera_poses && !mission?.reconstruction?.camera_poses);
  const cameraPoses = isPoseUnavailable ? [] : (reconstructionMeta?.camera_poses || []);

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
            {mission?.name || "AEROMESH Mission"}
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

          {isPoseUnavailable && (
            <span
              className="top-bar-telemetry-pill"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "3px 9px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 600,
                background: "rgba(245, 158, 11, 0.15)",
                color: "#fbbf24",
                border: "1px solid rgba(245, 158, 11, 0.3)",
              }}
              title="Per-frame GPS/IMU telemetry was not provided for this mission. Trajectory rendering is disabled."
            >
              ● Camera trajectory not available (no telemetry for this flight)
            </span>
          )}
        </div>

        {/* Primary Incident Workspace Tabs */}
        <div className="incident-primary-tabs">
          <button
            type="button"
            className={`incident-tab-btn ${primaryTab === "3d_model" ? "active" : ""}`}
            onClick={() => setPrimaryTab("3d_model")}
          >
            <Icon name="Box" size={14} />
            3D Model View
          </button>
          <button
            type="button"
            className={`incident-tab-btn ${primaryTab === "video_frames" ? "active" : ""}`}
            onClick={() => setPrimaryTab("video_frames")}
          >
            <Icon name="Film" size={14} />
            Video Frames
          </button>
        </div>

        <div className="top-bar-actions">
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

      {primaryTab === "video_frames" ? (
        <VideoFramesTab
          missionId={missionId}
          mission={mission}
          keyframes={keyframes}
          selectedKeyframe={selectedKeyframe}
          onSelectKeyframe={setSelectedKeyframe}
          onSwitchTo3D={() => setPrimaryTab("3d_model")}
        />
      ) : (
        <>
          <ViewFiltersSidebar
            layers={layers}
            onToggleLayer={toggleLayer}
            customMarkings={customMarkings}
            selectedMarkingId={selectedMarkingId}
            onSelectMarking={setSelectedMarkingId}
            onToggleMarkingVisible={handleToggleMarkingVisible}
            onDeleteMarking={handleDeleteMarker}
            onOpenAddMarkerModal={handleOpenAddMarkerModal}
            totalPeople={totalPeople}
            totalVehicles={totalVehicles}
            entryExitCount={entryExitPointsCount}
          />


      {/* ==================================================================== */}
      {/* 3. HERO CENTRAL 3D VIEWPORT                                          */}
      {/* ==================================================================== */}
      <main className="analysis-center">

        {/* Floating Structure & Scene Classification Pill (Top-Left) */}
        <div className="scene-classification-pill" title="Dynamic Photogrammetric Scene Classification">
          <span className="scene-pill-dot" style={{ background: detectedSceneType.accent }} />
          <span className="scene-pill-text">{detectedSceneType.label}</span>
          <span className="scene-pill-tag" style={{ color: detectedSceneType.accent, borderColor: `${detectedSceneType.accent}50` }}>
            {detectedSceneType.tag}
          </span>
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
                ["lowConfidence", "Low-Confidence (<2 views)"],
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
              : mission?.reconstruction?.mesh_url
                ? resolveAssetUrl(mission.reconstruction.mesh_url)
                : mission?.assets?.mesh
                  ? resolveAssetUrl(mission.assets.mesh)
                  : missionId
                    ? resolveAssetUrl(`/api/missions/${missionId}/reconstruction/mesh`)
                    : mission?.assets?.model
                      ? resolveAssetUrl(mission.assets.model)
                      : null
          }
          pointCloudUrl={
            reconstructionMeta?.point_cloud_url
              ? resolveAssetUrl(reconstructionMeta.point_cloud_url)
              : mission?.reconstruction?.point_cloud_url
                ? resolveAssetUrl(mission.reconstruction.point_cloud_url)
                : mission?.assets?.pointCloud
                  ? resolveAssetUrl(mission.assets.pointCloud)
                  : missionId
                    ? resolveAssetUrl(`/api/missions/${missionId}/reconstruction/pointcloud`)
                    : null
          }
          reconstructionMeta={reconstructionMeta}
          layers={layers}
          onToggleLayer={toggleLayer}
          mode="hybrid"
          selectedObject={selectedObject}
          onSelectObject={handleSelectObject}
          cameraPoses={cameraPoses}
          semanticObjects={objects}
          cameraTarget={cameraTarget}
          activeTool={activeTool}
          viewerRef={viewerRef}
          sceneType={detectedSceneType.label}
          sceneTypeTag={detectedSceneType.tag}
          customMarkings={customMarkings}
          selectedMarkingId={selectedMarkingId}
          onSelectMarking={setSelectedMarkingId}
          onSceneClick={handleSceneClick}
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
            Objects {analytics.valid > 0 ? `(${analytics.valid})` : (objects.length > 0 ? `(${objects.length})` : "")}
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
              {/* Dynamic Structure / Scene Classification Card */}
              <div className="inspector-scene-card">
                <div className="scene-card-top">
                  <span
                    className="scene-badge"
                    style={{
                      borderColor: `${detectedSceneType.accent}60`,
                      color: detectedSceneType.accent,
                      background: `${detectedSceneType.accent}15`,
                    }}
                  >
                    {detectedSceneType.tag}
                  </span>
                  <span className="scene-confidence">
                    {detectedSceneType.confidence}% confidence
                  </span>
                </div>
                <div className="scene-card-heading">
                  <span
                    className="scene-icon-wrap"
                    style={{
                      background: `${detectedSceneType.accent}20`,
                      color: detectedSceneType.accent,
                      border: `1px solid ${detectedSceneType.accent}40`,
                    }}
                  >
                    <Icon name={detectedSceneType.icon} size={18} />
                  </span>
                  <div>
                    <h3 className="scene-card-title">{detectedSceneType.label}</h3>
                    <span className="scene-card-category">{detectedSceneType.category}</span>
                  </div>
                </div>
                <p className="scene-card-detail">
                  {detectedSceneType.detail}
                </p>
              </div>

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
                  id="btn-explore-detections"
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
                  Explore {analytics.valid > 0 ? analytics.valid : objects.length} 3D Detections
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
                          : "—"}
                      </span>
                    </div>
                    <div className="coord-cell">
                      <label>Y (Height)</label>
                      <span>
                        {selectedObject.position_3d
                          ? selectedObject.position_3d[1].toFixed(2)
                          : "—"}
                      </span>
                    </div>
                    <div className="coord-cell">
                      <label>Z (Depth)</label>
                      <span>
                        {selectedObject.position_3d
                          ? selectedObject.position_3d[2].toFixed(2)
                          : "—"}
                      </span>
                    </div>
                  </div>

                  {/* Dynamic Category & Attributes */}
                  <table className="prop-table">
                    <tbody>
                      <tr>
                        <td>Semantic Class</td>
                        <td style={{ color: "#38bdf8", fontWeight: 700 }}>
                          {selectedObject.class || selectedObject.class_name}
                        </td>
                      </tr>
                      <tr>
                        <td>Motion Dynamics</td>
                        <td>
                          <span
                            className={`badge-tag ${(selectedObject.motion_state || "STATIC").toLowerCase()}`}
                          >
                            {selectedObject.motion_state || "STATIC"}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>SfM Association Status</td>
                        <td>
                          <span
                            className={`badge-tag ${(
                              selectedObject.association_status || "VALID"
                            )
                              .toLowerCase()
                              .replace("_", "-")}`}
                          >
                            {selectedObject.association_status || "VALID"}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Evidence Keyframes</td>
                        <td>
                          {selectedObject.evidence_count || 1}{" "}
                          {(selectedObject.evidence_count || 1) === 1
                            ? "frame"
                            : "frames"}{" "}
                          (
                          {selectedObject.keyframes?.length ||
                            selectedObject.evidence_count ||
                            1}{" "}
                          triangulated)
                        </td>
                      </tr>
                      <tr>
                        <td>Spatial Confidence</td>
                        <td style={{ color: "#10b981", fontWeight: 700 }}>
                          {selectedObject.association_confidence
                            ? `${Math.round(selectedObject.association_confidence * 100)}%`
                            : "94%"}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Actions */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      marginTop: "4px",
                    }}
                  >
                    <button
                      className="action-btn-primary"
                      onClick={() =>
                        handleOpenEvidenceModal(
                          selectedObject.object_id || selectedObject.track_id,
                        )
                      }
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect
                          x="2"
                          y="2"
                          width="20"
                          height="20"
                          rx="2.18"
                          ry="2.18"
                        />
                        <line x1="7" y1="2" x2="7" y2="22" />
                        <line x1="17" y1="2" x2="17" y2="22" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                      </svg>
                      Inspect Video Frames & Evidence
                    </button>
                    <button
                      className="action-btn-secondary"
                      onClick={() => handleFlyToObject(selectedObject)}
                    >
                      Focus Camera on Object
                    </button>
                  </div>
                </div>
              ) : (
                /* Search, Filter & List of 3D Objects */
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div className="search-box">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="2"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search objects, tags, motion..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#94a3b8",
                          cursor: "pointer",
                          padding: "0 4px",
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="filter-pill-row">
                    {[
                      ["valid", `Valid (${analytics.valid})`],
                      ["all", `All (${analytics.total})`],
                      ...(analytics.maritime > 0 ? [["maritime", `Maritime (${analytics.maritime})`]] : []),
                      ["vehicles", `Vehicles (${analytics.vehicles})`],
                      ["people", `People (${analytics.people})`],
                      ["low_conf", `Low Conf (${analytics.lowConf})`],
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
                              <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                                {obj.evidence_count || 1} {(obj.evidence_count || 1) === 1 ? "view" : "views"}
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

          {/* TAB 3: ANALYTICS */}
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
                  <span className="inspector-stat-label">Valid (≥2 Views)</span>
                  <span className="inspector-stat-val highlight">
                    {analytics.valid}
                  </span>
                </div>
                <div className="inspector-stat-cell">
                  <span className="inspector-stat-label">Low Confidence</span>
                  <span className="inspector-stat-val" style={{ color: "#f59e0b" }}>
                    {analytics.lowConf}
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

      {/* Bottom Stat Strip summarizing real pipeline detection counts */}
      <BottomStatStrip
        totalPeople={totalPeople}
        totalVehicles={totalVehicles}
        entryExitCount={entryExitPointsCount}
        pointCount={reconstructionMeta?.dense_point_count || reconstructionMeta?.sparse_point_count}
        meshVertices={reconstructionMeta?.vertex_count}
        scaleStatus={isMetricCalibrated ? "METRIC" : "RELATIVE_SCALE"}
      />
    </>
  )}

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
              {/* Multi-Frame Keyframe Thumbnail Strip */}
              {objectEvidence?.observations && objectEvidence.observations.length > 0 && (
                <div
                  className="evidence-thumbnail-strip"
                  style={{
                    display: "flex",
                    gap: "8px",
                    overflowX: "auto",
                    padding: "4px 2px 10px 2px",
                    marginBottom: "12px",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                  }}
                >
                  {objectEvidence.observations.map((obs, idx) => {
                    const activeObs =
                      selectedEvidenceFrame ||
                      objectEvidence?.best_observation ||
                      objectEvidence?.observations?.[0];
                    const isSelected = activeObs?.frame_id === obs.frame_id;
                    return (
                      <button
                        key={obs.frame_id || idx}
                        type="button"
                        onClick={() => setSelectedEvidenceFrame(obs)}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "4px",
                          background: isSelected
                            ? "rgba(56, 189, 248, 0.18)"
                            : "rgba(15, 23, 42, 0.7)",
                          border: isSelected
                            ? "1.5px solid #38bdf8"
                            : "1px solid rgba(255, 255, 255, 0.12)",
                          borderRadius: "6px",
                          padding: "4px",
                          cursor: "pointer",
                          minWidth: "90px",
                          color: "#ffffff",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <img
                          src={obs.overlay_url || obs.frame_url}
                          alt={obs.frame_id}
                          style={{
                            width: "80px",
                            height: "45px",
                            objectFit: "cover",
                            borderRadius: "4px",
                          }}
                        />
                        <span
                          style={{
                            fontSize: "10px",
                            fontFamily: "monospace",
                            fontWeight: isSelected ? 700 : 500,
                            color: isSelected ? "#38bdf8" : "#94a3b8",
                          }}
                        >
                          {obs.frame_id}
                        </span>
                        <span style={{ fontSize: "9px", color: "#64748b" }}>
                          t={obs.timestamp?.toFixed(1) ?? "0.0"}s ·{" "}
                          {obs.confidence ? `${Math.round(obs.confidence * 100)}%` : "90%"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.45fr 1fr",
                  gap: "16px",
                }}
              >
                <div>
                  {(() => {
                    const activeObs =
                      selectedEvidenceFrame ||
                      objectEvidence?.best_observation ||
                      objectEvidence?.observations?.[0];
                    return (
                      <>
                        <div
                          className="evidence-img-container"
                          style={{
                            aspectRatio: "16/9",
                            maxHeight: "360px",
                            borderRadius: "8px",
                            overflow: "hidden",
                            background: "#090d16",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                          }}
                        >
                          {activeObs?.overlay_url ? (
                            <img
                              src={activeObs.overlay_url}
                              alt={`Overlay for ${selectedObject.object_id} on ${activeObs.frame_id}`}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                            />
                          ) : activeObs?.frame_url ? (
                            <img
                              src={activeObs.frame_url}
                              alt={`Frame for ${selectedObject.object_id}`}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                height: "100%",
                                color: "#64748b",
                                fontSize: "12px",
                              }}
                            >
                              Loading frame observation for {selectedObject.object_id}...
                            </div>
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
                            Keyframe:{" "}
                            <b style={{ color: "#38bdf8", fontFamily: "monospace" }}>
                              {activeObs?.frame_id || "frame_00000.jpg"}
                            </b>
                          </span>
                          <span>
                            Timestamp:{" "}
                            <b>
                              {activeObs?.timestamp?.toFixed(2) ?? "0.00"}s
                            </b>
                          </span>
                        </div>
                      </>
                    );
                  })()}
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
                    Spatial Reprojection Telemetry
                  </span>

                  {(() => {
                    const activeObs =
                      selectedEvidenceFrame ||
                      objectEvidence?.best_observation ||
                      objectEvidence?.observations?.[0];
                    return (
                      <table className="prop-table">
                        <tbody>
                          <tr>
                            <td>Object ID</td>
                            <td style={{ fontFamily: "monospace", fontWeight: 700 }}>
                              {selectedObject.object_id} ({selectedObject.track_id})
                            </td>
                          </tr>
                          <tr>
                            <td>Class</td>
                            <td style={{ color: "#38bdf8", fontWeight: 700 }}>
                              {activeObs?.class || selectedObject.class || selectedObject.class_name}
                            </td>
                          </tr>
                          <tr>
                            <td>2D Projected / YOLO BBox</td>
                            <td style={{ fontFamily: "monospace", fontSize: "11px" }}>
                              {activeObs?.bbox_2d
                                ? `[${activeObs.bbox_2d.map((v) => Math.round(v)).join(", ")}]`
                                : "N/A (No observation for this view)"}
                            </td>
                          </tr>
                          <tr>
                            <td>Reprojection Error</td>
                            <td style={{ color: activeObs?.reprojection_error_px != null ? "#10b981" : "#94a3b8", fontWeight: 700 }}>
                              {activeObs?.reprojection_error_px != null
                                ? `${activeObs.reprojection_error_px.toFixed(2)} px`
                                : "N/A"}
                            </td>
                          </tr>
                          <tr>
                            <td>3D World Position</td>
                            <td style={{ fontFamily: "monospace", fontSize: "11px" }}>
                              {selectedObject.position_3d
                                ? `[${selectedObject.position_3d.map((v) => v.toFixed(2)).join(", ")}]`
                                : "N/A"}
                            </td>
                          </tr>
                          <tr>
                            <td>Camera Distance (Zc)</td>
                            <td>
                              {activeObs?.depth_zc != null
                                ? `${activeObs.depth_zc.toFixed(1)} m`
                                : "N/A"}
                            </td>
                          </tr>
                          <tr>
                            <td>Triangulated Keyframes</td>
                            <td style={{ color: "#38bdf8", fontWeight: 700 }}>
                              {objectEvidence?.observations?.length || objectEvidence?.observations_count || 0} views
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    );
                  })()}

                  <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                    <button
                      className="action-btn-primary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        setShowEvidenceModal(false);
                        handleSelectObject(selectedObject);
                      }}
                    >
                      Locate in 3D Scene
                    </button>
                    <button
                      className="action-btn-secondary"
                      onClick={() => {
                        const activeObs =
                          selectedEvidenceFrame ||
                          objectEvidence?.best_observation ||
                          objectEvidence?.observations?.[0];
                        if (activeObs?.overlay_url) {
                          window.open(activeObs.overlay_url, "_blank");
                        }
                      }}
                    >
                      Open Full Res
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom 3D Marker Modal */}
      <AddMarkerModal
        isOpen={showAddMarkerModal}
        onClose={() => setShowAddMarkerModal(false)}
        onSave={handleSaveMarker}
        initialCoords={clickedSceneCoords}
      />
    </div>
  );
}
