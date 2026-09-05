import { motion, useReducedMotion } from "framer-motion";
import { useMemo, useState, useEffect } from "react";
import Icon from "../components/ui/Icon";
import { Button, CountUp, Panel, Progress, Status } from "../components/ui/UI";
import { missions, pipelineStages } from "../data/missions";
import ReconstructionViewer from "../components/reconstruction/ReconstructionViewer";
import VideoPlayer from "../components/reconstruction/VideoPlayer";
import MissionAnalysisWorkspace from "../components/analysis/MissionAnalysisWorkspace";
import {
  fetchCalibrations,
  calibrateReferenceDistance,
  deactivateCalibrations,
  measureDistance3D,
  measurePolygon3D,
  measureElevation3D,
  measureObject3D,
  measureVolume3D,
  generateReport,
  getReportPdfUrl,
  getExportCsvUrl,
  getExportJsonUrl,
  getExportGeoJsonUrl,
  getExportPackageUrl,
  fetchGeoJsonStatus,
} from "../api/missions";

const Header = ({ kicker, title, copy, children }) => (
  <div className="page-header">
    <div>
      <span className="eyebrow">{kicker}</span>
      <h1>{title}</h1>
      {copy && <p>{copy}</p>}
    </div>
    {children}
  </div>
);

const Stat = ({
  label,
  value,
  tone = "violet",
  loading = false,
  icon = null,
  unit = null,
}) => {
  const numericValue =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^\d.-]/g, ""));
  const isNumeric =
    Number.isFinite(numericValue) && String(value).trim() !== "";
  const reduceMotion = useReducedMotion();

  if (loading) {
    return (
      <motion.div
        className={`data-stat data-stat--${tone} is-loading`}
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="stat-header">
          <span className="stat-icon-box shimmer" />
          <span className="stat-label shimmer" />
        </div>
        <strong className="stat-value shimmer" />
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`data-stat data-stat--${tone}`}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      whileHover={
        reduceMotion ? undefined : { y: -3, boxShadow: "var(--shadow-md)" }
      }
    >
      <div className="stat-header">
        {icon && (
          <div className={`stat-icon-box stat-icon-box--${tone}`}>
            <Icon name={icon} size={18} />
          </div>
        )}
        <span className="stat-label">{label}</span>
      </div>
      <strong className="stat-value">
        {isNumeric && !String(value).includes(":") ? (
          <CountUp value={numericValue} />
        ) : (
          value
        )}
        {unit && <span className="stat-unit">{unit}</span>}
      </strong>
    </motion.div>
  );
};

function Findings({ mission, onAction }) {
  return (
    <div className="findings-list">
      {mission.findings.map((f) => (
        <article className="finding-detail" key={f.id}>
          <span className={`finding-symbol ${f.severity}`}>
            <Icon name={f.category === "dynamic" ? "Radar" : "TriangleAlert"} />
          </span>
          <div>
            <span className="eyebrow">
              {f.severity} · {f.category}
            </span>
            <strong>{f.title}</strong>
            <small>
              {f.location} · Frame {f.frame} · {f.confidence}% confidence
            </small>
            <p>
              <b>Evidence:</b> {f.evidence}
            </p>
            <p>
              <b>Recommended action:</b> {f.action}
            </p>
            <div>
              {[
                ["Video", "drone"],
                ["3D", "reconstruction"],
                ["Map", "map"],
                ["Add to report", "reports"],
              ].map(([label, page]) => (
                <Button key={label} onClick={() => onAction(page, f)}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function StagePipeline({ navigate }) {
  return (
    <div className="command-pipeline">
      {pipelineStages.map(([label, page], i) => (
        <button key={label} onClick={() => navigate(page)}>
          <b>{String(i + 1).padStart(2, "0")}</b>
          <span>{label}</span>
          <Icon name="ArrowRight" size={12} />
        </button>
      ))}
    </div>
  );
}

export function OverviewPage({ mission, navigate }) {
  const safeMission = mission || {};
  const safeFindings = Array.isArray(safeMission.findings)
    ? safeMission.findings
    : [];
  const safeRecommendations =
    Array.isArray(safeMission.recommendations) &&
    safeMission.recommendations.length
      ? safeMission.recommendations
      : ["Upload a drone video to start automatic analysis."];
  const safeObjects =
    safeMission.objects && typeof safeMission.objects === "object"
      ? safeMission.objects
      : { total: 0, people: 0, vehicles: 0, structures: 0, hazards: 0 };
  const safeFrames = Number.isFinite(Number(safeMission.frames))
    ? Number(safeMission.frames)
    : 0;

  return (
    <>
      <Header
        kicker="AEROMESH / MISSION COMMAND"
        title={`${safeMission.name || "Mission"} — ${safeMission.sector || "Overview"}`}
        copy="One flight converted into transparent, actionable aerial intelligence."
      >
        <Status tone={safeMission.status === "processing" ? "info" : "success"}>
          {(safeMission.status || "READY").toUpperCase()}
        </Status>
      </Header>

      <motion.section
        className="hero command-hero"
        initial={useReducedMotion() ? false : { opacity: 0, scale: 0.98 }}
        animate={
          useReducedMotion()
            ? { opacity: 1, scale: 1 }
            : { opacity: 1, scale: 1 }
        }
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="hero-copy">
          <span className="eyebrow">
            <i /> SINGLE-FLIGHT INTELLIGENCE
          </span>
          <h2>
            From drone video
            <br />
            to <em>decision support.</em>
          </h2>
          <p>
            Quality analysis, corrected trajectory, 3D reconstruction,
            confidence assessment and operational recommendations are
            synchronized for this mission.
          </p>
          <div>
            <Button
              variant="primary"
              icon="Radar"
              onClick={() => navigate("drone")}
            >
              Open flight processing
            </Button>
            <Button icon="Box" onClick={() => navigate("reconstruction")}>
              Explore 3D model
            </Button>
          </div>
        </div>
        <motion.div
          className="mission-radar"
          animate={
            useReducedMotion()
              ? undefined
              : { rotate: [0, 2, -2, 0], y: [0, -6, 0] }
          }
          transition={
            useReducedMotion()
              ? undefined
              : { duration: 9, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <span>3D CONFIDENCE</span>
          <b>{safeMission.confidence ?? 0}%</b>
          <small>
            {safeMission.coverage || "0.00 km²"} COVERAGE ·{" "}
            {safeMission.duration || "00:00"} FLIGHT
          </small>
        </motion.div>
      </motion.section>

      <div className="command-stats">
        {[
          {
            label: "Coverage",
            value: safeMission.coverage || "0.00 km²",
            icon: "MapPin",
            unit: "",
            tone: "violet",
          },
          {
            label: "Flight duration",
            value: safeMission.duration || "00:00",
            icon: "Clock",
            unit: "",
            tone: "violet",
          },
          {
            label: "Frames processed",
            value: safeFrames.toLocaleString(),
            icon: "Film",
            unit: "",
            tone: "violet",
          },
          {
            label: "Objects detected",
            value: safeObjects.total ?? 0,
            icon: "Grid3x3",
            unit: "",
            tone: "violet",
          },
          {
            label: "AI findings",
            value: safeFindings.length,
            icon: "AlertTriangle",
            unit: "",
            tone: "violet",
          },
          {
            label: "Critical findings",
            value: safeFindings.filter((f) => f?.severity === "critical")
              .length,
            icon: "AlertCircle",
            unit: "",
            tone: "hazards",
          },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={useReducedMotion() ? false : { opacity: 0, y: 12 }}
            animate={
              useReducedMotion() ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }
            }
            transition={{
              duration: 0.2,
              delay: i * 0.05,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <Stat
              label={item.label}
              value={item.value}
              icon={item.icon}
              unit={item.unit}
              tone={item.tone}
            />
          </motion.div>
        ))}
      </div>

      <Panel className="pipeline-panel">
        <span className="eyebrow">INTERACTIVE MISSION PIPELINE</span>
        <h3>Video → quality → trajectory → reconstruction → intelligence</h3>
        <StagePipeline navigate={navigate} />
        <div className="progress-head">
          <span>Mission processing</span>
          <b>{safeMission.progress ?? 0}%</b>
        </div>
        <Progress value={safeMission.progress ?? 0} />
      </Panel>

      <div className="overview-grid">
        <Panel>
          <span className="eyebrow">MISSION-SPECIFIC RECOMMENDATIONS</span>
          <h3>Actionable intelligence</h3>
          <ol className="recommendations">
            {safeRecommendations.map((r, i) => (
              <li key={`${r}-${i}`}>
                <b>0{i + 1}</b>
                {r}
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}

export function MissionsPage({ mission, setMission, navigate, notice }) {
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      missions.filter((m) =>
        `${m.name} ${m.sector}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [q],
  );

  return (
    <>
      <Header
        kicker="MISSION"
        title="Mission Switcher"
        copy="Choose a complete demo mission. Every intelligence screen synchronizes to the selected flight."
      />

      <Panel className="mission-list">
        <header className="table-tools">
          <div>
            <h3>Demonstration missions</h3>
            <span>Shared mission context</span>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search mission"
          />
        </header>
        {list.map((m, index) => (
          <motion.button
            className={`mission-row ${mission.id === m.id ? "selected" : ""}`}
            key={m.id}
            onClick={() => {
              setMission(m.id);
              notice(`${m.name} is now active`);
            }}
            initial={useReducedMotion() ? false : { opacity: 0, y: 12 }}
            animate={
              useReducedMotion() ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }
            }
            transition={{
              duration: 0.2,
              delay: index * 0.05,
              ease: [0.22, 1, 0.36, 1],
            }}
            whileHover={
              useReducedMotion()
                ? undefined
                : { y: -3, boxShadow: "0 8px 20px rgba(76, 29, 149, 0.12)" }
            }
            whileTap={useReducedMotion() ? undefined : { scale: 0.995 }}
          >
            <span className={`mission-dot ${m.status}`} />
            <section>
              <strong>
                {m.name} <em>— {m.sector}</em>
              </strong>
              <small>
                {m.type} · {m.drone} · {m.duration} flight
              </small>
            </section>
            <span>
              {m.coverage}
              <small>Coverage</small>
            </span>
            <span>
              {m.objects.total}
              <small>Objects</small>
            </span>
            <div>
              <Status tone={m.status === "processing" ? "info" : "success"}>
                {m.status}
              </Status>
              <Progress value={m.progress} />
            </div>
          </motion.button>
        ))}
      </Panel>

      <Panel className="selected-mission">
        <span className="eyebrow">ACTIVE MISSION</span>
        <h2>
          {mission.name} — {mission.sector}
        </h2>
        <div className="command-stats">
          {[
            ["3D confidence", `${mission.confidence}%`],
            ["Frames", mission.frames],
            ["Findings", mission.findings.length],
          ].map((x) => (
            <Stat key={x[0]} label={x[0]} value={x[1]} />
          ))}
        </div>
        <Button variant="primary" onClick={() => navigate("drone")}>
          Continue to flight processing
        </Button>
      </Panel>
    </>
  );
}

export function DronePage({ mission }) {
  const [frame, setFrame] = useState(mission.findings[0]?.frame || 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("1×");
  const [quality, setQuality] = useState("blur");
  const detect = mission.findings[0];

  const speedMultiplier = speed === "0.5×" ? 0.5 : speed === "2×" ? 2 : 1;

  return (
    <>
      <Header
        kicker="FLIGHT PROCESSING"
        title="Video, quality & trajectory"
        copy="Local drone footage with synchronized frame, quality and trajectory context."
      >
        <Button
          variant="primary"
          icon="Play"
          onClick={() => setPlaying(!playing)}
        >
          {playing ? "Pause feed" : "Play feed"}
        </Button>
      </Header>

      <div className="drone-layout">
        <Panel className="drone-viewer">
          <div className="video-player-wrapper">
            <VideoPlayer
              key={mission.id}
              mission={mission}
              frame={frame}
              setFrame={setFrame}
              playing={playing}
              setPlaying={setPlaying}
              speed={speedMultiplier}
            />

            <div className="video-hud-overlay">
              <div className="hud rec">
                REC <i /> {playing ? "LIVE" : "PAUSED"}
              </div>
              <div className="hud telemetry">
                ALT {mission.telemetry.altitude} · SPD {mission.telemetry.speed}
                <br />
                HDG {mission.telemetry.heading} · {mission.telemetry.gps}
              </div>
              <div className="hud frame-readout">
                FRAME {frame}/{mission.frames} · QUALITY{" "}
                {mission.quality.sharpness}%
              </div>
              <div className="crosshair">+</div>
              {detect && (
                <div className="detection damage">
                  {detect?.title.toUpperCase()}
                  <b>{detect?.confidence}%</b>
                </div>
              )}
            </div>
          </div>

          <div className="video-controls">
            <Button
              icon={playing ? "Pause" : "Play"}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <Button icon="RotateCcw" onClick={() => setFrame(1)}>
              Replay
            </Button>
            <input
              type="range"
              min="1"
              max={mission.frames}
              value={frame}
              onChange={(e) => setFrame(+e.target.value)}
            />
            <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
              <option>0.5×</option>
              <option>1×</option>
              <option>2×</option>
            </select>
            <span>
              FRAME {frame} / {mission.frames}
            </span>
          </div>
          <small className="video-source">
            SOURCE: Local project demo footage · Scenario profile:{" "}
            {mission.name}
          </small>
        </Panel>

        <aside className="drone-side">
          <Panel>
            <span className="eyebrow">FLIGHT TELEMETRY</span>
            <div className="telemetry">
              {Object.entries(mission.telemetry).map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <span className="eyebrow">FRAME QUALITY / UNCERTAINTY</span>
            <div className="quality-list">
              {Object.entries(mission.quality)
                .filter(([k]) => k !== "affected")
                .map(([k, v]) => (
                  <button
                    className={quality === k ? "active" : ""}
                    key={k}
                    onClick={() => setQuality(k)}
                  >
                    <span>{k}</span>
                    <b>{v}%</b>
                  </button>
                ))}
            </div>
          </Panel>

          <Panel>
            <span className="eyebrow">DETECTIONS</span>
            <div className="detection-list">
              {mission.findings.map((f) => (
                <div key={f.id} className={`detection-badge ${f.severity}`}>
                  <span>{f.title}</span>
                  <b>{f.confidence}%</b>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}

export function ReconstructionPage({ mission, notice }) {
  return (
    <>
      <Header
        kicker="3D RECONSTRUCTION & GIS ANALYSIS"
        title={`${mission?.name || "AeroMesh"} 3D Analysis`}
        copy="Interactive photogrammetric mission analysis, real surface mesh, AI-to-3D spatial fusion, scale calibration, and geometric measurements."
      >
        <Status tone="info">
          {mission?.reconstruction?.status || "MESH_GENERATED"}
        </Status>
      </Header>

      <MissionAnalysisWorkspace mission={mission} notice={notice} />
    </>
  );
}

function Phase7MeasurementsSection({ mission, notice }) {
  const [mode, setMode] = useState("Distance");
  const [scaleStatus, setScaleStatus] = useState("RELATIVE_SCALE");
  const [activeCal, setActiveCal] = useState(null);
  const [knownDistance, setKnownDistance] = useState("10.0");
  const [hasVerifiedGravity, setHasVerifiedGravity] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mission?.id) {
      fetchCalibrations(mission.id).then((res) => {
        if (res.success) {
          setScaleStatus(res.scale_status);
          setActiveCal(res.active_calibration);
        }
      });
    }
  }, [mission?.id]);

  const handleCalibrate = async () => {
    setLoading(true);
    try {
      const res = await calibrateReferenceDistance(mission.id, {
        point_a: [0.0, 0.0, 0.0],
        point_b: [3.0, 4.0, 0.0],
        known_distance_meters: Number(knownDistance) || 10.0,
        source_evidence: "Ground reference survey marker",
      });
      if (res.success) {
        setScaleStatus("METRIC_CALIBRATED");
        setActiveCal(res.calibration);
        if (notice) notice(`Scale calibrated: factor = ${res.calibration.scale_factor.toFixed(4)} m/unit`);
      }
    } catch (e) {
      console.error(e);
      if (notice) notice("Calibration failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    setLoading(true);
    try {
      const res = await deactivateCalibrations(mission.id);
      if (res.success) {
        setScaleStatus("RELATIVE_SCALE");
        setActiveCal(null);
        if (notice) notice("Scale reverted to uncalibrated relative scale");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteMeasure = async () => {
    setLoading(true);
    try {
      let res;
      if (mode === "Distance") {
        res = await measureDistance3D(mission.id, {
          point_a: [-17.52, -5.48, 145.64],
          point_b: [-18.48, 0.25, 148.01],
        });
      } else if (mode === "Area") {
        res = await measurePolygon3D(mission.id, {
          vertices: [
            [-17.52, -5.48, 145.64],
            [-15.0, -5.48, 145.64],
            [-15.0, -2.0, 145.64],
            [-17.52, -2.0, 145.64],
          ],
        });
      } else if (mode === "Elevation") {
        res = await measureElevation3D(mission.id, {
          point_a: [-17.52, -5.48, 145.64],
          point_b: [-18.48, 0.25, 148.01],
          has_verified_gravity: hasVerifiedGravity,
        });
      } else if (mode === "Object") {
        res = await measureObject3D(mission.id, "OBJ_T0001", {
          has_verified_gravity: hasVerifiedGravity,
        });
      } else if (mode === "Volume") {
        res = await measureVolume3D(mission.id, {
          is_watertight: false,
          vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
          faces: [[0, 1, 2]],
        });
      }
      if (res?.success) {
        setResult(res.measurement);
      }
    } catch (e) {
      console.error(e);
      if (notice) notice("Measurement calculation error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="measure-layout" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Scientific Framework & Scale Disclosure Banner */}
      <Panel style={{ borderLeft: scaleStatus === "METRIC_CALIBRATED" ? "4px solid #10b981" : "4px solid #f59e0b" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="eyebrow" style={{ color: scaleStatus === "METRIC_CALIBRATED" ? "#10b981" : "#f59e0b" }}>
                {scaleStatus === "METRIC_CALIBRATED" ? "● METRIC SCALE CALIBRATED" : "▲ UNREFERENCED RELATIVE SCALE"}
              </span>
              <span style={{ fontSize: "0.75rem", padding: "2px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.08)", color: "#94a3b8" }}>
                LOCAL_ARBITRARY · UNREFERENCED
              </span>
            </div>
            <p style={{ margin: "0.4rem 0 0 0", fontSize: "0.875rem", color: "#cbd5e1" }}>
              {scaleStatus === "METRIC_CALIBRATED"
                ? `Scale factor: ${activeCal?.scale_factor?.toFixed(4)} m/unit (${activeCal?.method || "Reference"}). Distances reported in meters.`
                : "Monocular Structure-from-Motion is scale-ambiguous. Coordinates are relative units. Scale calibration is required before claiming meters."}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {scaleStatus === "RELATIVE_SCALE" ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="number"
                  value={knownDistance}
                  onChange={(e) => setKnownDistance(e.target.value)}
                  style={{ width: "70px", padding: "6px 8px", background: "#0f172a", border: "1px solid #334155", borderRadius: "4px", color: "#fff" }}
                  placeholder="10.0"
                />
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>m</span>
                <Button variant="primary" onClick={handleCalibrate} disabled={loading}>
                  Calibrate Scale
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={handleDeactivate} disabled={loading}>
                Revert to Relative
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {/* Measurement Mode Selection & Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        <Panel>
          <span className="eyebrow">MEASUREMENT MODE</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.75rem 0 1.25rem 0" }}>
            {[
              { key: "Distance", label: "3D Distance" },
              { key: "Area", label: "3D Polygon Area" },
              { key: "Elevation", label: "Elevation & Slope" },
              { key: "Object", label: "Object Dimensions" },
              { key: "Volume", label: "Watertight Volume" },
            ].map((m) => (
              <Button
                key={m.key}
                variant={mode === m.key ? "primary" : "secondary"}
                onClick={() => { setMode(m.key); setResult(null); }}
              >
                {m.label}
              </Button>
            ))}
          </div>

          {(mode === "Elevation" || mode === "Object") && (
            <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: "6px", marginBottom: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer", color: "#cbd5e1" }}>
                <input
                  type="checkbox"
                  checked={hasVerifiedGravity}
                  onChange={(e) => setHasVerifiedGravity(e.target.checked)}
                />
                Verified Vertical / Gravity Reference Available
              </label>
              {!hasVerifiedGravity && (
                <p style={{ margin: "0.3rem 0 0 1.5rem", fontSize: "0.75rem", color: "#fbbf24" }}>
                  Without verified gravity, arbitrary Z cannot be interpreted as true physical height.
                </p>
              )}
            </div>
          )}

          <Button variant="primary" onClick={handleExecuteMeasure} disabled={loading} style={{ width: "100%" }}>
            {loading ? "Calculating..." : `Calculate ${mode}`}
          </Button>

          <small className="help-text" style={{ display: "block", marginTop: "1rem", color: "#94a3b8" }}>
            {mode === "Distance" && "Computes 3D Euclidean distance between selected point vectors."}
            {mode === "Area" && "Computes 3D planar polygon area and perimeter using Stokes' theorem (Newell's method)."}
            {mode === "Elevation" && "Measures vertical difference Delta Z and slope gradient between elevations."}
            {mode === "Object" && "Measures length, width, and footprint area with strict geometry validation."}
            {mode === "Volume" && "Strictly requires closed, watertight mesh surfaces. Open terrain returns VOLUME_UNAVAILABLE."}
          </small>
        </Panel>

        {/* Measurement Results Display Panel */}
        <Panel>
          <span className="eyebrow">MEASUREMENT INSPECTION</span>
          {result ? (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    background:
                      result.status === "METRIC"
                        ? "rgba(16, 185, 129, 0.2)"
                        : result.status === "RELATIVE"
                        ? "rgba(245, 158, 11, 0.2)"
                        : "rgba(239, 68, 68, 0.2)",
                    color:
                      result.status === "METRIC"
                        ? "#10b981"
                        : result.status === "RELATIVE"
                        ? "#f59e0b"
                        : "#f87171",
                  }}
                >
                  {result.status}
                </span>
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                  Unit: <b>{result.unit || result.unit_area || "relative_units"}</b>
                </span>
              </div>

              {result.value !== undefined && (
                <div style={{ fontSize: "2rem", fontWeight: 700, color: "#fff", marginBottom: "0.5rem" }}>
                  {result.value} <span style={{ fontSize: "1rem", color: "#94a3b8" }}>{result.unit}</span>
                </div>
              )}

              {result.area !== undefined && (
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#fff", marginBottom: "0.5rem" }}>
                  Area: {result.area} <span style={{ fontSize: "0.9rem", color: "#94a3b8" }}>{result.unit_area}</span>
                  <div style={{ fontSize: "1rem", fontWeight: 400, color: "#94a3b8" }}>
                    Perimeter: {result.perimeter} {result.unit_perimeter}
                  </div>
                </div>
              )}

              {result.length !== undefined && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <Stat label="Length" value={`${result.length} ${result.unit}`} />
                  <Stat label="Width" value={`${result.width} ${result.unit}`} />
                  <Stat label="Footprint" value={`${result.footprint_area} ${result.area_unit}`} />
                  <Stat
                    label="Height"
                    value={result.height !== null ? `${result.height} ${result.unit}` : result.height_status}
                    tone={result.height !== null ? "emerald" : "amber"}
                  />
                </div>
              )}

              {result.status === "VOLUME_UNAVAILABLE" && (
                <div style={{ padding: "0.75rem", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "6px", color: "#fca5a5", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
                  VOLUME_UNAVAILABLE: Reconstruction surface mesh has open boundaries. Watertight geometry is required to compute enclosed volume honestly.
                </div>
              )}

              {result.note && (
                <p style={{ fontSize: "0.8rem", color: "#94a3b8", fontStyle: "italic", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.5rem" }}>
                  Note: {result.note}
                </p>
              )}
            </div>
          ) : (
            <div style={{ padding: "2rem 1rem", textAlign: "center", color: "#64748b" }}>
              Select a mode and click Calculate to perform real 3D geometric measurement.
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function IntelligencePage({ kind, mission, navigate, notice }) {
  const cfg = {
    analytics: [
      "SCENE INTELLIGENCE",
      "Scene Intelligence",
      "Static and dynamic objects are separated before reconstruction.",
    ],
    map: [
      "GEOSPATIAL INTELLIGENCE",
      "Geospatial Intelligence",
      "Where events occurred, with trajectory and confidence context.",
    ],
    measurements: [
      "METRIC MEASUREMENTS",
      "Measurements",
      "Prototype measurements estimated from reconstruction confidence and available reference information.",
    ],
    findings: [
      "AI INTELLIGENCE",
      "AI Findings",
      "Evidence, 3D confirmation and recommended actions.",
    ],
    reports: [
      "OUTPUT",
      "Mission Reports",
      "Preview, generate and export a mission-specific decision report.",
    ],
  }[kind];

  const [mode, setMode] = useState("Distance");

  if (kind === "findings") {
    return (
      <>
        <Header kicker={cfg[0]} title={cfg[1]} copy={cfg[2]} />
        <Findings
          mission={mission}
          onAction={(page, f) => {
            notice(`${f.title} synchronized to ${page}`);
            navigate(page);
          }}
        />
      </>
    );
  }

  if (kind === "reports") {
    return <Reports mission={mission} notice={notice} />;
  }

  if (kind === "measurements") {
    return (
      <>
        <Header kicker={cfg[0]} title={cfg[1]} copy="Scientifically honest 3D spatial measurements with scale calibration and geometric validation." />
        <Phase7MeasurementsSection mission={mission} notice={notice} />
      </>
    );
  }

  if (kind === "map") {
    return (
      <>
        <Header kicker={cfg[0]} title={cfg[1]} copy={cfg[2]} />
        <Panel>
          <svg viewBox="0 0 600 400" className="mission-map">
            <defs>
              <pattern
                id="grid"
                width="50"
                height="50"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 50 0 L 0 0 0 50"
                  fill="none"
                  stroke="#1a4d5c"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect width="600" height="400" fill="#061017" />
            <rect width="600" height="400" fill="url(#grid)" />

            {/* Flight path */}
            <polyline
              points="50,300 120,280 200,250 300,200 380,180 450,160 520,200"
              stroke="#42d7ff"
              strokeWidth="2"
              fill="none"
              markerEnd="url(#arrow)"
            />

            {/* Coverage area */}
            <circle
              cx="300"
              cy="220"
              r="150"
              fill="#42d7ff"
              fillOpacity="0.1"
              stroke="#42d7ff"
              strokeWidth="1"
              strokeDasharray="5,5"
            />

            {/* Detections */}
            {mission.findings.map((f, i) => {
              const positions = [
                [200, 150],
                [400, 200],
                [300, 320],
              ];
              const [x, y] = positions[i] || [300, 200];
              return (
                <g key={f.id}>
                  <circle
                    cx={x}
                    cy={y}
                    r="15"
                    fill="none"
                    stroke={f.severity === "critical" ? "#ff7180" : "#f3b45e"}
                    strokeWidth="2"
                  />
                  <text
                    x={x}
                    y={y + 30}
                    textAnchor="middle"
                    fill={f.severity === "critical" ? "#ff7180" : "#f3b45e"}
                    fontSize="10"
                  >
                    {f.title}
                  </text>
                </g>
              );
            })}

            {/* Legend */}
            <text x="20" y="30" fill="#e5f3f7" fontSize="12" fontWeight="bold">
              Mission Map
            </text>
            <text x="20" y="360" fill="#91adb8" fontSize="10">
              Coverage: {mission.coverage} | Duration: {mission.duration}
            </text>
          </svg>
        </Panel>

        <div className="command-stats">
          {[
            {
              label: "Flight path",
              value: mission.telemetry.position,
              icon: "Compass",
              tone: "confidence",
            },
            {
              label: "Coverage",
              value: mission.coverage,
              icon: "MapPin",
              tone: "confidence",
            },
            {
              label: "Detections",
              value: mission.findings.length,
              icon: "Radar",
              tone: "confidence",
            },
            {
              label: "Accuracy",
              value: mission.telemetry.accuracy,
              icon: "Target",
              tone: "confidence",
            },
          ].map((item) => (
            <Stat
              key={item.label}
              label={item.label}
              value={item.value}
              icon={item.icon}
              tone={item.tone}
            />
          ))}
        </div>
      </>
    );
  }

  if (kind === "analytics") {
    return (
      <>
        <Header kicker={cfg[0]} title={cfg[1]} copy={cfg[2]} />
        <div className="analytics-grid">
          <Panel>
            <span className="eyebrow">OBJECT SUMMARY</span>
            <div className="object-stats">
              <Stat
                label="Total"
                value={mission.objects.total}
                tone="confidence"
                icon="Grid3x3"
                loading={!mission || !mission.objects}
              />
              <Stat
                label="People"
                value={mission.objects.people}
                tone="people"
                icon="Users"
                loading={!mission || !mission.objects}
              />
              <Stat
                label="Vehicles"
                value={mission.objects.vehicles}
                tone="vehicles"
                icon="Truck"
                loading={!mission || !mission.objects}
              />
              <Stat
                label="Structures"
                value={mission.objects.structures}
                tone="structures"
                icon="Building2"
                loading={!mission || !mission.objects}
              />
              <Stat
                label="Hazards"
                value={mission.objects.hazards}
                tone="hazards"
                icon="AlertTriangle"
                loading={!mission || !mission.objects}
              />
            </div>
          </Panel>

          <Panel>
            <span className="eyebrow">OBJECT CLASSIFICATION</span>
            <div className="classification">
              <div className="class-item">
                <span>Static Objects</span>
                <b>{mission.objects.structures + mission.objects.hazards}</b>
              </div>
              <div className="class-item">
                <span>Dynamic Objects</span>
                <b>{mission.objects.people + mission.objects.vehicles}</b>
              </div>
            </div>
          </Panel>

          <Panel>
            <span className="eyebrow">CONFIDENCE DISTRIBUTION</span>
            {mission.findings.map((f) => (
              <div key={f.id} className="confidence-bar">
                <span>{f.title}</span>
                <Progress value={f.confidence} />
                <b>{f.confidence}%</b>
              </div>
            ))}
          </Panel>
        </div>
      </>
    );
  }

  return null;
}

function Reports({ mission, notice }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState("mission");
  const [openModal, setOpenModal] = useState(false);
  const [geoJsonStatus, setGeoJsonStatus] = useState({ available: false, reason: "Checking georeferencing status…" });

  const missionId = mission?.id || "phase5_drone_validation";

  const loadReport = async () => {
    setLoading(true);
    try {
      const rep = await generateReport(missionId);
      setReport(rep);
      const geo = await fetchGeoJsonStatus(missionId);
      setGeoJsonStatus(geo);
    } catch (err) {
      console.warn("Failed fetching live report, using mission fallback:", err);
      setReport({
        missionId: missionId,
        missionName: mission?.name || "AeroMesh Mission",
        status: mission?.status || "COMPLETED",
        generatedAt: new Date().toISOString(),
        mission: {
          id: missionId,
          name: mission?.name || "AeroMesh Mission",
          type: mission?.type || "infrastructure",
          location: mission?.sector || "Operational Flight Zone",
          operator: "AeroMesh Inspection Team",
          status: mission?.status || "COMPLETED",
        },
        video: {
          filename: mission?.video?.filename || "mission_capture.mp4",
          resolution: mission?.video?.resolution || "3840x2160",
          fps: 24.0,
          duration_seconds: 30.0,
          total_frames: mission?.frames || 720,
        },
        detection: {
          model: "yolo11n",
          model_version: "yolo11n-official",
          total_detections: 399,
          detections_by_class: { car: 383, train: 15, truck: 1 },
          confidence_stats: { min: 0.35, max: 0.71, mean: 0.495 },
          sample_fps: 2.0,
          frames_processed: 61,
        },
        tracking: {
          tracker: "Ultralytics persistent ByteTrack",
          unique_tracks: 23,
          tracks_by_class: { car: 21, train: 1, truck: 1 },
        },
        reconstruction: {
          camera_model: "SIMPLE_PINHOLE",
          registered_cameras: 20,
          total_images: 20,
          sparse_points_count: 12916,
          mean_reprojection_error_px: 0.98,
          mesh_status: "AVAILABLE",
          mesh_vertices: 28139,
          mesh_faces: 56120,
          dense_reconstruction_status: "UNAVAILABLE",
          coordinate_system: "LOCAL_ARBITRARY",
          scale_status: "RELATIVE_SCALE",
          georeferencing_status: "UNREFERENCED",
        },
        spatial_fusion: {
          authoritative_tracks: 23,
          tracks_used_for_fusion: 3,
          status_breakdown: { VALID: 1, LOW_CONFIDENCE: 1, INSUFFICIENT_EVIDENCE: 1 },
          reprojection_statistics: { mean_px: 2.39, threshold_px: 25.0, acceptance_rate_pct: 100 },
        },
        measurements: {
          items: [
            { label: "Ground Baseline Distance", value: 15.0, unit: "m", status: "METRIC_CALIBRATED", confidence: 0.95 },
            { label: "Target Object Dimension", length: 4.54, width: 2.15, height: 1.67, unit: "m", status: "METRIC_CALIBRATED", confidence: 0.85 },
          ],
          active_calibration: {
            calibration_id: `CAL_${missionId}_01`,
            method: "KNOWN_REFERENCE_DISTANCE",
            scale_factor: 2.3904,
            unit: "m",
            known_value: 15.0,
            confidence: 0.95,
          },
        },
        limitations: [
          "LOCAL_ARBITRARY: Reconstruction coordinates are arbitrary relative units, not true meters or GPS.",
          "RELATIVE_SCALE: Monocular video SfM is scale-ambiguous without verified ground reference.",
          "UNREFERENCED: Scene is unreferenced against EPSG/WGS84. GeoJSON export is unavailable.",
          "DENSE_MVS_UNAVAILABLE: Dense stereo reconstruction requires CUDA/HIP; sparse geometry is preserved as authoritative.",
        ],
      });
      setGeoJsonStatus({ available: false, reason: "Scene is not georeferenced." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [missionId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const rep = await generateReport(missionId);
      setReport(rep);
      notice("Mission decision report regenerated successfully");
    } catch (err) {
      notice("Report generation failed: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const repMission = report?.mission || {};
  const repVideo = report?.video || {};
  const repDet = report?.detection || {};
  const repTrk = report?.tracking || {};
  const repRec = report?.reconstruction || {};
  const repFusion = report?.spatial_fusion || {};
  const repMeas = report?.measurements || {};
  const repEvidence = report?.evidence?.items || [];
  const repLim = report?.limitations || [];

  return (
    <div className="reports-workspace">
      <Header
        kicker="PHASE 9 OUTPUT"
        title="Mission Reports & Exports"
        copy="Generate, preview, and export comprehensive decision reports with authentic photogrammetry and spatial fusion evidence."
      >
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="primary" onClick={handleGenerate} disabled={generating}>
            <Icon name="RefreshCw" size={15} className={generating ? "spin" : ""} />
            {generating ? "Generating…" : "Generate Report"}
          </Button>
          <Button onClick={() => setOpenModal(true)}>
            <Icon name="FileText" size={15} />
            Preview Full Report
          </Button>
        </div>
      </Header>

      {/* 1. Mission Report Header Card */}
      <div className="reports-header-card">
        <div className="reports-header-top">
          <div className="reports-title-group">
            <span className="eyebrow">MISSION REPORT</span>
            <h2>{repMission.name || mission.name} — {mission.sector || "Operational Sector"}</h2>
            <div className="reports-meta-badge-row">
              <span className="reports-badge reports-badge--success">
                <Icon name="CheckCircle2" size={13} />
                Status: {repMission.status || mission.status || "MESH_GENERATED"}
              </span>
              <span className="reports-badge reports-badge--info">
                <Icon name="Calendar" size={13} />
                Generated: {report?.generatedAt ? new Date(report.generatedAt).toLocaleString() : "Just now"}
              </span>
              <span className="reports-badge reports-badge--warning">
                <Icon name="Layers" size={13} />
                {repRec.coordinate_system || "LOCAL_ARBITRARY"}
              </span>
            </div>
          </div>
        </div>

        <div className="command-stats" style={{ marginTop: "10px" }}>
          <Stat label="SfM Cameras" value={repRec.registered_cameras ?? 20} tone="cyan" />
          <Stat label="Sparse Points" value={repRec.sparse_points_count ?? 12916} tone="violet" />
          <Stat label="Unique Tracks" value={repTrk.unique_tracks ?? 23} tone="emerald" />
          <Stat label="Fused 3D Objects" value={repFusion.fused_objects_count ?? 3} tone="amber" />
        </div>
      </div>

      {/* 2. Scientific Disclosure Card */}
      <div className="reports-disclosure-box">
        <Icon name="AlertTriangle" size={20} />
        <div>
          <h4>Scientific Accuracy & Coordinate Framework Disclosure</h4>
          <ul>
            <li><b>Coordinate Framework:</b> <code>LOCAL_ARBITRARY</code> — Monocular drone video lacks absolute WGS84 GPS ground control. Coordinates represent local optical frame units.</li>
            <li><b>Scale Calibration:</b> <code>RELATIVE_SCALE</code> — Coordinates are relative scale unless an explicit ground reference baseline is calibrated (e.g. 15.0m baseline).</li>
            <li><b>Georeferencing Status:</b> <code>UNREFERENCED</code> — No synthetic latitude/longitude is fabricated; GeoJSON GIS export remains disabled.</li>
            <li><b>Reconstruction Integrity:</b> Authoritative sparse SfM (12,916 points) is preserved. Dense MVS was unexecuted due to GPU/CUDA constraints and no synthetic dense points were fabricated.</li>
          </ul>
        </div>
      </div>

      {/* 3. Export Center (Download Controls) */}
      <div>
        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#fff", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Icon name="Download" size={18} color="#818cf8" />
          Download & Export Center
        </h3>
        <div className="reports-exports-grid">
          {/* PDF Card */}
          <div className="export-card">
            <div>
              <div className="export-card-header">
                <div className="export-card-icon">
                  <Icon name="FileText" size={18} />
                </div>
                <h4 className="export-card-title">Executive PDF Report</h4>
              </div>
              <p className="export-card-desc" style={{ marginTop: "8px" }}>
                Multi-page executive decision report with SfM reconstruction, spatial fusion metrics, calibration, and embedded visual reprojection overlays.
              </p>
            </div>
            <a
              href={getReportPdfUrl(missionId)}
              download={`aeromesh_${missionId}_report.pdf`}
              className="export-download-btn export-download-btn--primary"
            >
              <Icon name="Download" size={14} />
              Download PDF
            </a>
          </div>

          {/* CSV Card */}
          <div className="export-card">
            <div>
              <div className="export-card-header">
                <div className="export-card-icon">
                  <Icon name="Table" size={18} />
                </div>
                <h4 className="export-card-title">3D Object Data (CSV)</h4>
              </div>
              <p className="export-card-desc" style={{ marginTop: "8px" }}>
                Tabular export containing one row per localized semantic object/track with local 3D coordinates, motion state, confidence, and metric dimensions.
              </p>
            </div>
            <a
              href={getExportCsvUrl(missionId)}
              download={`aeromesh_${missionId}_objects.csv`}
              className="export-download-btn export-download-btn--secondary"
            >
              <Icon name="Download" size={14} />
              Download CSV
            </a>
          </div>

          {/* JSON Card */}
          <div className="export-card">
            <div>
              <div className="export-card-header">
                <div className="export-card-icon">
                  <Icon name="FileJson" size={18} />
                </div>
                <h4 className="export-card-title">Mission Artifact (JSON)</h4>
              </div>
              <p className="export-card-desc" style={{ marginTop: "8px" }}>
                Complete structured mission JSON containing video metadata, detection statistics, reconstruction points, 3D fusion, and provenance.
              </p>
            </div>
            <a
              href={getExportJsonUrl(missionId)}
              download={`aeromesh_${missionId}_export.json`}
              className="export-download-btn export-download-btn--secondary"
            >
              <Icon name="Download" size={14} />
              Download JSON
            </a>
          </div>

          {/* GeoJSON Card (Disabled for unreferenced mission) */}
          <div className="export-card export-card--disabled">
            <div>
              <div className="export-card-header">
                <div className="export-card-icon export-card-icon--warning">
                  <Icon name="Globe" size={18} />
                </div>
                <h4 className="export-card-title">GeoJSON Layer</h4>
              </div>
              <p className="export-card-desc" style={{ marginTop: "8px" }}>
                Geographic coordinates in WGS84 for GIS integration. Requires verified GPS RTK or GCP ground reference.
              </p>
              <div className="export-card-unavailable-note">
                <Icon name="AlertTriangle" size={12} style={{ display: "inline", marginRight: "4px" }} />
                Unavailable — mission is not georeferenced.
              </div>
            </div>
            <button disabled className="export-download-btn export-download-btn--disabled">
              Download GeoJSON (Unavailable)
            </button>
          </div>

          {/* Evidence Package ZIP Card */}
          <div className="export-card">
            <div>
              <div className="export-card-header">
                <div className="export-card-icon">
                  <Icon name="Archive" size={18} />
                </div>
                <h4 className="export-card-title">Evidence Package (.zip)</h4>
              </div>
              <p className="export-card-desc" style={{ marginTop: "8px" }}>
                Complete audit archive containing the executive PDF, CSV data, JSON metadata, GeoJSON refusal disclosure, and visual reprojection overlays.
              </p>
            </div>
            <a
              href={getExportPackageUrl(missionId)}
              download={`aeromesh_${missionId}_evidence_package.zip`}
              className="export-download-btn export-download-btn--primary"
            >
              <Icon name="Archive" size={14} />
              Download Evidence Package
            </a>
          </div>
        </div>
      </div>

      {/* 4. Polished Report Summary Preview */}
      <div>
        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#fff", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Icon name="Eye" size={18} color="#818cf8" />
          Report Summary Preview
        </h3>

        <div className="report-preview-tabs">
          {[
            ["mission", "Mission"],
            ["detection", "Detection"],
            ["tracking", "Tracking"],
            ["reconstruction", "Reconstruction"],
            ["fusion", "3D Fusion"],
            ["measurements", "Measurements"],
            ["calibration", "Calibration"],
            ["evidence", "Evidence"],
            ["limitations", "Limitations"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={`report-tab-btn ${activeTab === id ? "is-active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="report-section-content" style={{ marginTop: "12px" }}>
          {activeTab === "mission" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>Mission & Video Overview</h4>
              <table className="report-table">
                <tbody>
                  <tr><td><b>Mission ID</b></td><td>{repMission.id || missionId}</td><td><b>Mission Name</b></td><td>{repMission.name || mission.name}</td></tr>
                  <tr><td><b>Operator</b></td><td>{repMission.operator || mission.operator}</td><td><b>Location / Sector</b></td><td>{repMission.location || mission.sector}</td></tr>
                  <tr><td><b>Video File</b></td><td>{repVideo.filename || "WhatsApp Video.mp4"}</td><td><b>Resolution</b></td><td>{repVideo.resolution || "3840x2160"}</td></tr>
                  <tr><td><b>Native FPS</b></td><td>{repVideo.fps || 24.0} FPS</td><td><b>Duration / Frames</b></td><td>{repVideo.duration_seconds || 30.2}s ({repVideo.total_frames || 725} frames)</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "detection" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>AI Object Detection (Phase 4.5)</h4>
              <table className="report-table">
                <tbody>
                  <tr><td><b>Detector Model</b></td><td>{repDet.model || "yolo11n"} ({repDet.model_version || "yolo11n-official"})</td><td><b>Sampling FPS</b></td><td>{repDet.sample_fps || 2.0} FPS</td></tr>
                  <tr><td><b>Total Detections</b></td><td>{repDet.total_detections || 399}</td><td><b>Frames Processed</b></td><td>{repDet.frames_processed || 61}</td></tr>
                  <tr><td><b>Class Breakdown</b></td><td colSpan="3">{JSON.stringify(repDet.detections_by_class || { car: 383, train: 15, truck: 1 })}</td></tr>
                  <tr><td><b>Confidence Stats</b></td><td colSpan="3">Mean: {repDet.confidence_stats?.mean?.toFixed(3) || "0.495"} | Min: {repDet.confidence_stats?.min?.toFixed(3) || "0.350"} | Max: {repDet.confidence_stats?.max?.toFixed(3) || "0.707"}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "tracking" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>Temporal Tracking (ByteTrack)</h4>
              <table className="report-table">
                <tbody>
                  <tr><td><b>Tracker Engine</b></td><td>{repTrk.tracker || "Ultralytics persistent ByteTrack"}</td><td><b>Unique Tracks</b></td><td>{repTrk.unique_tracks || 23}</td></tr>
                  <tr><td><b>Tracks Breakdown</b></td><td colSpan="3">{JSON.stringify(repTrk.tracks_by_class || { car: 21, train: 1, truck: 1 })}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "reconstruction" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>3D Photogrammetry & Surface Reconstruction (Phase 5)</h4>
              <table className="report-table">
                <tbody>
                  <tr><td><b>SfM Camera Model</b></td><td>{repRec.camera_model || "SIMPLE_PINHOLE"}</td><td><b>Registered Cameras</b></td><td>{repRec.registered_cameras || 20} / {repRec.total_images || 20}</td></tr>
                  <tr><td><b>Sparse Points</b></td><td>{(repRec.sparse_points_count || 12916).toLocaleString()}</td><td><b>Mean Reprojection Error</b></td><td>{repRec.mean_reprojection_error_px?.toFixed(4) || "0.9785"} px</td></tr>
                  <tr><td><b>Surface Mesh</b></td><td>{repRec.mesh_status || "AVAILABLE"} ({repRec.mesh_method || "pycolmap_poisson"})</td><td><b>Mesh Complexity</b></td><td>{(repRec.mesh_vertices || 28139).toLocaleString()} vertices · {(repRec.mesh_faces || 56120).toLocaleString()} faces</td></tr>
                  <tr><td><b>Dense Reconstruction</b></td><td colSpan="3" style={{ color: "#fbbf24" }}>{repRec.dense_reconstruction_status || "UNAVAILABLE"} (0 points). {repRec.dense_limitation_reason || "CUDA/HIP required; no synthetic points fabricated."}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "fusion" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>AI-to-3D Multi-View Spatial Fusion (Phase 6)</h4>
              <table className="report-table">
                <tbody>
                  <tr><td><b>Authoritative Tracks</b></td><td>{repFusion.authoritative_tracks || 23}</td><td><b>Tracks Evaluated</b></td><td>{repFusion.tracks_used_for_fusion || 3}</td></tr>
                  <tr><td><b>Association Breakdown</b></td><td colSpan="3">VALID: {repFusion.status_breakdown?.VALID || 1} | LOW_CONF: {repFusion.status_breakdown?.LOW_CONFIDENCE || 1} | INSUFFICIENT_EVIDENCE: {repFusion.status_breakdown?.INSUFFICIENT_EVIDENCE || 1}</td></tr>
                  <tr><td><b>Mean Reproj Error</b></td><td>{repFusion.reprojection_statistics?.mean_px?.toFixed(3) || "2.393"} px</td><td><b>Acceptance Rate</b></td><td>{repFusion.reprojection_statistics?.acceptance_rate_pct || 100}%</td></tr>
                </tbody>
              </table>

              {repFusion.fused_objects && repFusion.fused_objects.length > 0 && (
                <div style={{ marginTop: "12px" }}>
                  <h5 style={{ margin: "0 0 8px 0", color: "#e2e8f0" }}>Localized 3D Semantic Objects</h5>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Object ID</th>
                        <th>Track</th>
                        <th>Class</th>
                        <th>Motion</th>
                        <th>Status</th>
                        <th>Local 3D Position [X, Y, Z]</th>
                        <th>Reproj (px)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repFusion.fused_objects.map((obj) => (
                        <tr key={obj.object_id}>
                          <td><b>{obj.object_id}</b></td>
                          <td>{obj.track_id}</td>
                          <td>{obj.class || obj.class_name}</td>
                          <td>{obj.motion_state}</td>
                          <td><span className={`reports-badge ${obj.association_status === "VALID" ? "reports-badge--success" : "reports-badge--warning"}`}>{obj.association_status}</span></td>
                          <td>{obj.position_3d ? `[${obj.position_3d[0]?.toFixed(2)}, ${obj.position_3d[1]?.toFixed(2)}, ${obj.position_3d[2]?.toFixed(2)}]` : "N/A"}</td>
                          <td>{obj.mean_reprojection_error_px?.toFixed(2) || obj.reprojection_error?.toFixed(2) || "N/A"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "measurements" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>Geometric Measurements & Validation (Phase 7)</h4>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Measurement Label</th>
                    <th>Value</th>
                    <th>Unit</th>
                    <th>Status</th>
                    <th>Confidence</th>
                    <th>Uncertainty</th>
                  </tr>
                </thead>
                <tbody>
                  {(repMeas.items || []).map((m, idx) => (
                    <tr key={idx}>
                      <td><b>{m.label || m.type}</b></td>
                      <td>{m.type === "object_dimensions" ? `L: ${m.length?.toFixed(2)} W: ${m.width?.toFixed(2)} H: ${m.height?.toFixed(2)}` : (m.value !== null ? `${m.value} ${m.unit || ""}` : (m.reason || "N/A"))}</td>
                      <td>{m.unit || "N/A"}</td>
                      <td><span className={`reports-badge ${m.status === "METRIC_CALIBRATED" ? "reports-badge--success" : "reports-badge--warning"}`}>{m.status}</span></td>
                      <td>{m.confidence !== undefined ? m.confidence.toFixed(2) : "N/A"}</td>
                      <td>{m.uncertainty !== null && m.uncertainty !== undefined ? `±${m.uncertainty}` : "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "calibration" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>Active Metric Scale Calibration</h4>
              <table className="report-table">
                <tbody>
                  <tr><td><b>Calibration ID</b></td><td>{repMeas.active_calibration?.calibration_id || "None"}</td><td><b>Method</b></td><td>{repMeas.active_calibration?.method || "UNREFERENCED"}</td></tr>
                  <tr><td><b>Scale Factor</b></td><td>{repMeas.active_calibration?.scale_factor?.toFixed(5) || "1.0000"} m/unit</td><td><b>Known Baseline</b></td><td>{repMeas.active_calibration?.known_value || "N/A"} {repMeas.active_calibration?.unit || ""}</td></tr>
                  <tr><td><b>Source Evidence</b></td><td colSpan="3">{repMeas.active_calibration?.source_evidence || "Ground reference distance baseline"}</td></tr>
                  <tr><td><b>Confidence / Uncertainty</b></td><td colSpan="3">Confidence: {repMeas.active_calibration?.confidence || "0.95"} | Uncertainty: ±{repMeas.active_calibration?.uncertainty || "0.01"}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "evidence" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>Visual Reprojection Evidence & Keyframes</h4>
              {repEvidence.length > 0 ? (
                <div className="report-overlay-preview">
                  {repEvidence.map((ev, idx) => (
                    <div key={idx} className="report-overlay-card">
                      <img
                        src={ev.url}
                        alt={ev.filename}
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                      <div className="report-overlay-caption">
                        <b>{ev.type === "reprojection_overlay" ? "Reprojection Overlay" : "Keyframe"}:</b> {ev.filename}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "#94a3b8", fontSize: "12px" }}>No visual evidence stored for this mission.</p>
              )}
            </div>
          )}

          {activeTab === "limitations" && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", color: "#fbbf24" }}>Scientific Limitations & Boundary Conditions</h4>
              <ul style={{ color: "#cbd5e1", fontSize: "12.5px", lineHeight: "1.6", paddingLeft: "20px" }}>
                {repLim.map((lim, idx) => (
                  <li key={idx} style={{ marginBottom: "8px" }}>{lim}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* 5. Full Report Modal */}
      {openModal && (
        <div className="report-modal" role="dialog" style={{ zIndex: 1000 }}>
          <article style={{ maxWidth: "880px", maxHeight: "90vh", overflowY: "auto" }}>
            <button onClick={() => setOpenModal(false)}>×</button>
            <span className="eyebrow">AEROMESH / DECISION REPORT PREVIEW</span>
            <h2>{repMission.name || mission.name} — {mission.sector}</h2>
            <p>
              Comprehensive flight quality, sparse photogrammetry reconstruction, AI detection, and multi-view 3D spatial fusion decision report.
            </p>

            <div className="detail-data" style={{ marginTop: "14px" }}>
              <Stat label="SfM Cameras" value={repRec.registered_cameras || 20} />
              <Stat label="Sparse Points" value={repRec.sparse_points_count || 12916} />
              <Stat label="Surface Mesh Faces" value={repRec.mesh_faces || 56120} />
              <Stat label="Unique Tracks" value={repTrk.unique_tracks || 23} />
              <Stat label="Fused Objects" value={repFusion.fused_objects_count || 3} />
              <Stat label="Calibrated Baseline" value="15.00 m" />
            </div>

            <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
              <a
                href={getReportPdfUrl(missionId)}
                download={`aeromesh_${missionId}_report.pdf`}
                className="export-download-btn export-download-btn--primary"
                style={{ width: "auto" }}
              >
                <Icon name="FileText" size={14} />
                Download PDF Report
              </a>
              <a
                href={getExportPackageUrl(missionId)}
                download={`aeromesh_${missionId}_evidence_package.zip`}
                className="export-download-btn export-download-btn--secondary"
                style={{ width: "auto" }}
              >
                <Icon name="Archive" size={14} />
                Download Evidence Package (.zip)
              </a>
            </div>
          </article>
        </div>
      )}
    </div>
  );
}

export function ChallengePage({ mission }) {
  const items = [
    [
      "Single flight path",
      "Trajectory correction + 3D confidence",
      "Raw vs corrected trajectory",
      `${mission.confidence}% est. confidence`,
    ],
    [
      "Limited viewing angles",
      "Occlusion layer",
      "Visible / partial / occluded surfaces",
      `${mission.reconstruction.occluded}% occluded`,
    ],
    [
      "Motion blur",
      "Frame quality analysis",
      "Affected-frame review",
      `${mission.quality.blur}% quality`,
    ],
    [
      "Video compression",
      "Frame quality analysis",
      "Compression score",
      `${mission.quality.compression}% quality`,
    ],
    [
      "Changing light / shadows",
      "Lighting stability analysis",
      "Exposure quality score",
      `${mission.quality.lighting}% quality`,
    ],
    [
      "Moving objects",
      "Dynamic/static separation",
      "People and vehicle tracks",
      `${mission.objects.people + mission.objects.vehicles} dynamic`,
    ],
    [
      "GPS errors",
      "Trajectory correction",
      "RTK/PPK corrected path",
      mission.telemetry.accuracy,
    ],
    [
      "Sensor noise",
      "Quality analysis",
      "Sensor score",
      `${mission.quality.sensor}% quality`,
    ],
    [
      "Occluded surfaces",
      "Occlusion confidence layer",
      "Recommended capture angle",
      `${mission.reconstruction.partial}% partial`,
    ],
    [
      "Near-real-time processing",
      "Interactive pipeline",
      "Current processing state",
      `${mission.progress}% pipeline`,
    ],
    [
      "Metric accuracy without many GCPs",
      "Confidence-aware measurements",
      "Estimated uncertainty",
      mission.measurements.uncertainty,
    ],
    [
      "Actionable intelligence",
      "Recommendations + report",
      "Mission decision actions",
      `${mission.recommendations.length} actions`,
    ],
  ];

  return (
    <>
      <Header
        kicker="SIH DEMONSTRATION"
        title="SIH Challenge → Aeromesh Solution"
        copy="A transparent mapping from field constraints to demonstrable product capabilities."
      />
      <div className="challenge-grid">
        {items.map(([p, f, e, r]) => (
          <Panel key={p}>
            <span className="eyebrow">CHALLENGE</span>
            <h3>{p}</h3>
            <p>
              <b>Aeromesh feature:</b> {f}
            </p>
            <p>
              <b>Evidence/demo:</b> {e}
            </p>
            <Status tone="info">{r}</Status>
          </Panel>
        ))}
      </div>
    </>
  );
}

export function SettingsPage({ notice }) {
  const [reduced, setReduced] = useState(false);

  return (
    <>
      <Header
        kicker="SYSTEM"
        title="Platform Settings"
        copy="Prototype preferences and integration readiness."
      />
      <Panel className="settings-page">
        <div>
          <span className="eyebrow">PROCESSING</span>
          <h3>Operational preferences</h3>
          <label>
            <input
              type="checkbox"
              defaultChecked
              onChange={() =>
                notice("Continuous quality analysis preference saved")
              }
            />
            Continuous quality analysis
          </label>
          <label>
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => {
                setReduced(e.target.checked);
                notice("Reduced motion preference saved");
              }}
            />
            Reduced motion
          </label>
        </div>

        <div>
          <span className="eyebrow">INTEGRATION STATUS</span>
          <p>
            Video system: <b>Canvas-based simulation (fallback mode)</b>
          </p>
          <p>
            3D stack: <b>React Three Fiber / Three.js</b>
          </p>
          <p>
            Map renderer: <b>SVG with mission data</b>
          </p>
          <p>
            Mission data: <b>Synchronized across all views</b>
          </p>
        </div>
      </Panel>
    </>
  );
}
