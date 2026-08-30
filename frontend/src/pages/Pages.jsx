import { useMemo, useState } from "react";
import Icon from "../components/ui/Icon";
import { Button, Panel, Progress, Status } from "../components/ui/UI";
import { missions, pipelineStages } from "../data/missions";
import ReconstructionViewer from "../components/reconstruction/ReconstructionViewer";
import VideoPlayer from "../components/reconstruction/VideoPlayer";

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

const Stat = ({ label, value }) => (
  <div className="data-stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

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
  return (
    <>
      <Header
        kicker="AEROMESH / MISSION COMMAND"
        title={`${mission.name} — ${mission.sector}`}
        copy="One flight converted into transparent, actionable aerial intelligence."
      >
        <Status tone={mission.status === "processing" ? "info" : "success"}>
          {mission.status.toUpperCase()}
        </Status>
      </Header>

      <section className="hero command-hero">
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
        <div className="mission-radar">
          <span>3D CONFIDENCE</span>
          <b>{mission.confidence}%</b>
          <small>
            {mission.coverage} COVERAGE · {mission.duration} FLIGHT
          </small>
        </div>
      </section>

      <div className="command-stats">
        {[
          ["Coverage", mission.coverage],
          ["Flight duration", mission.duration],
          ["Frames processed", mission.frames.toLocaleString()],
          ["Objects detected", mission.objects.total],
          ["AI findings", mission.findings.length],
          [
            "Critical findings",
            mission.findings.filter((f) => f.severity === "critical").length,
          ],
        ].map((x) => (
          <Stat key={x[0]} label={x[0]} value={x[1]} />
        ))}
      </div>

      <Panel className="pipeline-panel">
        <span className="eyebrow">INTERACTIVE MISSION PIPELINE</span>
        <h3>Video → quality → trajectory → reconstruction → intelligence</h3>
        <StagePipeline navigate={navigate} />
        <div className="progress-head">
          <span>Mission processing</span>
          <b>{mission.progress}%</b>
        </div>
        <Progress value={mission.progress} />
      </Panel>

      <div className="overview-grid">
        <Panel>
          <span className="eyebrow">MISSION-SPECIFIC RECOMMENDATIONS</span>
          <h3>Actionable intelligence</h3>
          <ol className="recommendations">
            {mission.recommendations.map((r, i) => (
              <li key={r}>
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
        {list.map((m) => (
          <button
            className={`mission-row ${mission.id === m.id ? "selected" : ""}`}
            key={m.id}
            onClick={() => {
              setMission(m.id);
              notice(`${m.name} is now active`);
            }}
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
          </button>
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
  const [mode, setMode] = useState("hybrid");
  const [selected, setSelected] = useState(null);
  const [layers, setLayers] = useState({
    terrain: true,
    buildings: true,
    roads: true,
    flight: true,
    cloud: true,
    findings: true,
    grid: true,
    occlusion: false,
    confidence: true,
  });

  const toggle = (k) => setLayers((p) => ({ ...p, [k]: !p[k] }));
  const qualityMetrics = [
    [
      "Motion Blur",
      mission.quality.blur,
      "Estimated motion stability across reconstruction frames.",
    ],
    [
      "Compression",
      mission.quality.compression,
      "Preserved image detail after video compression.",
    ],
    [
      "Lighting",
      mission.quality.lighting,
      "Lighting consistency across the single flight.",
    ],
    [
      "GPS Confidence",
      mission.quality.gps,
      "Estimated trajectory reliability.",
    ],
    [
      "Sensor Noise",
      mission.quality.sensor,
      "Signal quality after sensor-noise correction.",
    ],
    [
      "Surface Coverage",
      mission.reconstruction.visible,
      "Percentage of the scene sufficiently observed.",
    ],
    [
      "Occlusion",
      100 - mission.reconstruction.occluded,
      "Surface visibility after occluded regions are discounted.",
    ],
    [
      "Metric Confidence",
      Number.parseInt(mission.measurements.confidence, 10),
      "Expected measurement reliability without dense GCPs.",
    ],
  ];

  return (
    <>
      <Header
        kicker="3D RECONSTRUCTION"
        title={`${mission.name} model`}
        copy="A georeferenced 3D representation generated from the selected drone flight."
      >
        <Status>EST. CONFIDENCE {mission.confidence}%</Status>
      </Header>

      <section className="reconstruction">
        <ReconstructionViewer
          key={mission.id}
          mission={mission}
          layers={layers}
          mode={mode}
          onFinding={setSelected}
        />

        <aside className="recon-controls">
          <span className="eyebrow">VIEW MODE</span>
          <div className="mode-controls">
            {["hybrid", "solid", "wireframe", "point cloud", "topographic"].map(
              (x) => (
                <button
                  key={x}
                  className={mode === x ? "active" : ""}
                  onClick={() => setMode(x)}
                >
                  {x}
                </button>
              ),
            )}
          </div>

          <span className="eyebrow">LAYERS</span>
          <div className="layer-controls">
            {[
              ["terrain", "Terrain"],
              ["buildings", "Structures"],
              ["roads", "Roads"],
              ["flight", "Flight path"],
              ["cloud", "Point cloud"],
              ["findings", "AI findings"],
              ["occlusion", "Occlusion"],
              ["confidence", "Confidence"],
              ["grid", "Survey grid"],
            ].map(([k, l]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={layers[k]}
                  onChange={() => toggle(k)}
                />
                <span>{l}</span>
              </label>
            ))}
          </div>

          <Button
            onClick={() =>
              notice(
                "Orbit controls: drag to rotate · scroll to zoom · right-drag to pan",
              )
            }
          >
            Camera controls
          </Button>

          {selected && (
            <div className="finding-pop">
              <button onClick={() => setSelected(null)}>×</button>
              <span className="eyebrow">{selected.severity}</span>
              <strong>{selected.title}</strong>
              <small>
                Source frame {selected.frame}. Linked evidence is available in
                video and map views.
              </small>
            </div>
          )}
        </aside>
      </section>

      <div className="recon-metrics">
        {[
          ["POINT CLOUD", mission.reconstruction.points],
          ["MESH", "READY"],
          ["TEXTURE", mission.reconstruction.texture],
          ["VISIBLE", `${mission.reconstruction.visible}%`],
          ["OCCLUDED", `${mission.reconstruction.occluded}%`],
          ["PARTIAL", `${mission.reconstruction.partial}%`],
        ].map(([label, value]) => (
          <Stat key={label} label={label} value={value} />
        ))}
      </div>
      <Panel className="reconstruction-quality">
        <span className="eyebrow">
          RECONSTRUCTION CONFIDENCE / DATA QUALITY
        </span>
        <div>
          {qualityMetrics.map(([label, value, help]) => (
            <section key={label} title={help}>
              <span>{label}</span>
              <Progress value={value} />
              <b>{value}%</b>
            </section>
          ))}
        </div>
      </Panel>
    </>
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
        <Header kicker={cfg[0]} title={cfg[1]} copy={cfg[2]} />
        <div className="measure-layout">
          <Panel className="measure-scene">
            <div className={`measure-line ${mode.toLowerCase()}`} />
            <span>
              {mode === "Distance"
                ? mission.measurements.distance
                : mode === "Area"
                  ? mission.measurements.area
                  : mission.measurements.height}
            </span>
            <small>
              Prototype measurement overlay · estimated uncertainty{" "}
              {mission.measurements.uncertainty}
            </small>
          </Panel>

          <Panel>
            <span className="eyebrow">MEASUREMENT MODE</span>
            {["Distance", "Area", "Height"].map((x) => (
              <Button
                key={x}
                variant={mode === x ? "primary" : "secondary"}
                onClick={() => setMode(x)}
              >
                {x}
              </Button>
            ))}

            <div className="detail-data">
              {Object.entries(mission.measurements).map(([k, v]) => (
                <Stat key={k} label={k} value={v} />
              ))}
            </div>

            <small className="help-text">
              Distance uses two selected model points; area and height use
              selected reconstructed structures.
            </small>
          </Panel>
        </div>
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
            ["Flight path", mission.telemetry.position],
            ["Coverage", mission.coverage],
            ["Detections", mission.findings.length],
            ["Accuracy", mission.telemetry.accuracy],
          ].map((x) => (
            <Stat key={x[0]} label={x[0]} value={x[1]} />
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
              <Stat label="Total" value={mission.objects.total} />
              <Stat label="People" value={mission.objects.people} />
              <Stat label="Vehicles" value={mission.objects.vehicles} />
              <Stat label="Structures" value={mission.objects.structures} />
              <Stat label="Hazards" value={mission.objects.hazards} />
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
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const generate = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setOpen(true);
      notice("Mission report generated");
    }, 900);
  };

  const exportReport = () => {
    const text = `AEROMESH MISSION REPORT
${mission.name} — ${mission.sector}
Coverage: ${mission.coverage}
Flight: ${mission.duration}
Frames: ${mission.frames}
3D confidence: ${mission.confidence}%

FINDINGS:
${mission.findings.map((f) => `- ${f.title} (${f.confidence}% confidence): ${f.action}`).join("\n")}

RECOMMENDATIONS:
${mission.recommendations.map((r) => `- ${r}`).join("\n")}`;

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.download = `aeromesh-${mission.id}-report.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    notice("Report exported");
  };

  return (
    <>
      <Header
        kicker="OUTPUT"
        title="Mission Reports"
        copy="Generate a shareable mission summary with findings and recommendations."
      >
        <Button variant="primary" onClick={generate}>
          {generating ? "Generating…" : "Generate report"}
        </Button>
      </Header>

      <Panel className="report-preview">
        <span className="eyebrow">READY REPORT</span>
        <h2>
          {mission.name} — {mission.sector}
        </h2>
        <div className="command-stats">
          {[
            ["Coverage", mission.coverage],
            ["Flight", mission.duration],
            ["Frames", mission.frames],
            ["3D confidence", `${mission.confidence}%`],
          ].map((x) => (
            <Stat key={x[0]} label={x[0]} value={x[1]} />
          ))}
        </div>
        <Button onClick={() => setOpen(true)}>Preview</Button>
        <Button onClick={exportReport}>Export .txt</Button>
      </Panel>

      {open && (
        <div className="report-modal" role="dialog">
          <article>
            <button onClick={() => setOpen(false)}>×</button>
            <span className="eyebrow">AEROMESH / DECISION REPORT</span>
            <h2>
              {mission.name} — {mission.sector}
            </h2>
            <p>
              Flight quality, trajectory correction and reconstruction evidence
              have been consolidated for operational review.
            </p>
            <div className="detail-data">
              <Stat
                label="Flight"
                value={`${mission.duration} · ${mission.frames} frames`}
              />
              <Stat label="Coverage" value={mission.coverage} />
              <Stat label="3D confidence" value={`${mission.confidence}%`} />
              <Stat
                label="GPS uncertainty"
                value={mission.measurements.uncertainty}
              />
              <Stat
                label="Frame quality"
                value={`${mission.quality.sharpness}%`}
              />
              <Stat
                label="Measurements"
                value={`${mission.measurements.height} H · ${mission.measurements.area}`}
              />
            </div>

            <h3>AI findings</h3>
            {mission.findings.map((f) => (
              <p key={f.id}>
                <b>{f.title}</b> · {f.confidence}% · {f.action}
              </p>
            ))}

            <h3>Recommendations</h3>
            {mission.recommendations.map((r) => (
              <p key={r}>• {r}</p>
            ))}

            <Button variant="primary" onClick={exportReport}>
              Export report
            </Button>
          </article>
        </div>
      )}
    </>
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
