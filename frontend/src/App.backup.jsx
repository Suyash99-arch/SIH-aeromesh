import { useMemo, useRef, useState } from "react";
import "./App.css";

/* =========================================================
   ICON SYSTEM
========================================================= */

function Icon({ type, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  const icons = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),

    mission: (
      <>
        <path d="M12 3v4" />
        <path d="M12 17v4" />
        <path d="M3 12h4" />
        <path d="M17 12h4" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),

    drone: (
      <>
        <path d="M8 12h8" />
        <path d="M12 8v8" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" />
        <path d="M5 7h3v3H5z" />
        <path d="M16 7h3v3h-3z" />
        <path d="M5 14h3v3H5z" />
        <path d="M16 14h3v3h-3z" />
      </>
    ),

    cube: (
      <>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="m4 7.5 8 4.5 8-4.5" />
        <path d="M12 12v9" />
      </>
    ),

    map: (
      <>
        <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
        <path d="M9 3v15" />
        <path d="M15 6v15" />
      </>
    ),

    analytics: (
      <>
        <path d="M4 19V5" />
        <path d="M4 19h17" />
        <path d="m7 15 4-4 3 2 5-6" />
      </>
    ),

    ruler: (
      <>
        <path d="m4 16 12-12 4 4L8 20H4z" />
        <path d="m13 7 4 4" />
        <path d="m10 10 2 2" />
        <path d="m7 13 2 2" />
      </>
    ),

    brain: (
      <>
        <path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3" />
        <path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3" />
        <path d="M9 4v16" />
        <path d="M15 4v16" />
        <path d="M9 8h3" />
        <path d="M12 12h3" />
        <path d="M9 16h3" />
      </>
    ),

    report: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M15 3v5h4" />
        <path d="M9 12h6" />
        <path d="M9 16h6" />
      </>
    ),

    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </>
    ),

    play: <path d="m9 6 9 6-9 6z" fill="currentColor" stroke="none" />,

    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),

    alert: (
      <>
        <path d="M12 3 2.8 20h18.4z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </>
    ),

    check: <path d="m5 12 4 4L19 6" />,

    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),

    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.9-1.1L14.3 3h-4.6l-.4 2.9a8 8 0 0 0-1.9 1.1l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .7.1 1.1l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.9 1.1l.4 2.9h4.6l.4-2.9a8 8 0 0 0 1.9-1.1l2.4 1 2-3.4-2-1.5c.1-.4.1-.7.1-1.1z" />
      </>
    ),
  };

  return <svg {...common}>{icons[type] || icons.grid}</svg>;
}

/* =========================================================
   NAVIGATION
========================================================= */

const navigation = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "missions", label: "Missions", icon: "mission", count: "04" },
  { id: "drone", label: "Drone Intelligence", icon: "drone" },
  { id: "reconstruction", label: "3D Reconstruction", icon: "cube" },
];

const analysisNavigation = [
  { id: "map", label: "Geospatial Map", icon: "map" },
  { id: "analytics", label: "Scene Analytics", icon: "analytics" },
  { id: "measurements", label: "Measurements", icon: "ruler" },
  {
    id: "findings",
    label: "AI Findings",
    icon: "brain",
    count: "06",
    alert: true,
  },
  { id: "reports", label: "Reports", icon: "report" },
];

const allNavigation = [...navigation, ...analysisNavigation];

/* =========================================================
   SMALL COMPONENTS
========================================================= */

function StatusBadge({ children, tone = "green" }) {
  return (
    <span className={`status-badge ${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

function MetricCard({ icon, label, value, detail, tone = "blue" }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon type={icon} size={18} />
      </div>

      <div className="metric-copy">
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        <div className="metric-detail">{detail}</div>
      </div>
    </div>
  );
}

function Finding({ icon, title, location, confidence, tone }) {
  return (
    <div className="finding-row">
      <div className={`finding-icon ${tone}`}>
        <Icon type={icon} size={16} />
      </div>

      <div className="finding-main">
        <div className="finding-title">{title}</div>
        <div className="finding-location">{location}</div>
      </div>

      <div className="finding-confidence">
        <strong>{confidence}</strong>
        <span>confidence</span>
      </div>
    </div>
  );
}

function PipelineStep({ number, title, state, active = false }) {
  return (
    <div className={`pipeline-card ${active ? "active" : ""}`}>
      <div className="pipeline-number">{number}</div>
      <div className="pipeline-title">{title}</div>

      <div className={`pipeline-state ${state === "RUNNING" ? "running" : ""}`}>
        {state === "COMPLETE" ? "✓" : "●"} {state}
      </div>
    </div>
  );
}

/* =========================================================
   OVERVIEW
========================================================= */

function Overview({ onNavigate }) {
  return (
    <>
      <section className="hero-card">
        <div className="hero-grid" />

        <div className="hero-content">
          <div className="hero-eyebrow">
            <span className="pulse-dot" />
            SINGLE-PASS AERIAL INTELLIGENCE
          </div>

          <h1>
            Turn one drone flight
            <br />
            into <span>actionable 3D intelligence.</span>
          </h1>

          <p>
            Reconstruct terrain and structures, detect damage and objects,
            measure scenes, and generate geospatial intelligence from a
            single-pass drone video.
          </p>

          <div className="hero-actions">
            <button
              className="button primary large"
              onClick={() => onNavigate("drone")}
            >
              <Icon type="upload" size={15} />
              Start New Mission
            </button>

            <button
              className="button large"
              onClick={() => onNavigate("reconstruction")}
            >
              View Reconstruction
              <Icon type="arrow" size={15} />
            </button>
          </div>
        </div>

        <div className="hero-visual">
          <div className="radar">
            <div className="radar-ring ring-1" />
            <div className="radar-ring ring-2" />
            <div className="radar-ring ring-3" />
            <div className="radar-cross horizontal" />
            <div className="radar-cross vertical" />
            <div className="radar-sweep" />

            <div className="radar-point point-a" />
            <div className="radar-point point-b" />
            <div className="radar-point point-c" />

            <div className="radar-center">
              <Icon type="drone" size={21} />
            </div>
          </div>

          <div className="visual-label label-top">LIVE SCENE INTELLIGENCE</div>

          <div className="visual-label label-bottom">
            <span>GPS LOCK</span>
            <b>RTK / PPK READY</b>
          </div>
        </div>
      </section>

      <div className="section-heading">
        <div>
          <div className="section-kicker">MISSION OVERVIEW</div>
          <h2>Operational intelligence</h2>
        </div>

        <StatusBadge>ALL SYSTEMS OPERATIONAL</StatusBadge>
      </div>

      <section className="metrics-grid">
        <MetricCard
          icon="mission"
          label="Active Missions"
          value="04"
          detail="+2 this week"
          tone="blue"
        />

        <MetricCard
          icon="drone"
          label="Video Processing"
          value="01"
          detail="Single-pass pipeline"
          tone="cyan"
        />

        <MetricCard
          icon="brain"
          label="AI Findings"
          value="27"
          detail="6 high priority"
          tone="purple"
        />

        <MetricCard
          icon="alert"
          label="Critical Alerts"
          value="03"
          detail="Requires attention"
          tone="red"
        />
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-kicker">ACTIVE MISSION</div>
              <h3>Disaster Response — Sector 04</h3>
            </div>

            <StatusBadge>PROCESSING</StatusBadge>
          </div>

          <div className="mission-summary">
            <div className="mission-stat">
              <span>Source</span>
              <strong>4K DRONE VIDEO</strong>
            </div>

            <div className="mission-stat">
              <span>Coverage</span>
              <strong>2.84 km²</strong>
            </div>

            <div className="mission-stat">
              <span>Frames</span>
              <strong>1,284</strong>
            </div>

            <div className="mission-stat">
              <span>GPS Accuracy</span>
              <strong>±0.8 m</strong>
            </div>
          </div>

          <div className="progress-block">
            <div className="progress-head">
              <span>AI reconstruction pipeline</span>
              <strong>72%</strong>
            </div>

            <div className="progress-track">
              <div className="progress-fill" style={{ width: "72%" }} />
            </div>
          </div>

          <div className="pipeline">
            <PipelineStep
              number="01"
              title="Frame extraction"
              state="COMPLETE"
            />

            <PipelineStep
              number="02"
              title="Visual odometry"
              state="COMPLETE"
            />

            <PipelineStep
              number="03"
              title="3D reconstruction"
              state="RUNNING"
              active
            />

            <PipelineStep
              number="04"
              title="AI scene analysis"
              state="WAITING"
            />
          </div>
        </div>

        <div className="panel findings-panel">
          <div className="panel-header">
            <div>
              <div className="panel-kicker">AI SCENE UNDERSTANDING</div>
              <h3>Priority findings</h3>
            </div>

            <button
              className="text-button"
              onClick={() => onNavigate("findings")}
            >
              View all
              <Icon type="arrow" size={13} />
            </button>
          </div>

          <div className="findings-list">
            <Finding
              icon="alert"
              title="Structural damage"
              location="Building A · North facade"
              confidence="94%"
              tone="red"
            />

            <Finding
              icon="alert"
              title="Fire / thermal anomaly"
              location="Warehouse complex · Zone 3"
              confidence="91%"
              tone="orange"
            />

            <Finding
              icon="mission"
              title="Person detected"
              location="Collapsed structure · Grid B7"
              confidence="88%"
              tone="purple"
            />

            <Finding
              icon="drone"
              title="Road obstruction"
              location="Access route · Segment 02"
              confidence="84%"
              tone="blue"
            />
          </div>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-kicker">RECENT MISSIONS</div>
              <h3>Mission activity</h3>
            </div>

            <button
              className="text-button"
              onClick={() => onNavigate("missions")}
            >
              Open missions
              <Icon type="arrow" size={13} />
            </button>
          </div>

          <div className="activity-list">
            <div className="activity-row">
              <div className="activity-marker complete">
                <Icon type="check" size={13} />
              </div>

              <div className="activity-content">
                <strong>Urban Survey — Sector 12</strong>
                <span>3D reconstruction completed</span>
              </div>

              <div className="activity-time">12 min ago</div>
            </div>

            <div className="activity-row">
              <div className="activity-marker processing">
                <Icon type="drone" size={13} />
              </div>

              <div className="activity-content">
                <strong>Disaster Response — Sector 04</strong>
                <span>AI analysis in progress</span>
              </div>

              <div className="activity-time">28 min ago</div>
            </div>

            <div className="activity-row">
              <div className="activity-marker">
                <Icon type="map" size={13} />
              </div>

              <div className="activity-content">
                <strong>Bridge Inspection — East Corridor</strong>
                <span>Geospatial analysis available</span>
              </div>

              <div className="activity-time">2 hr ago</div>
            </div>
          </div>
        </div>

        <div className="panel system-panel">
          <div className="panel-header">
            <div>
              <div className="panel-kicker">PLATFORM HEALTH</div>
              <h3>System status</h3>
            </div>

            <StatusBadge>ONLINE</StatusBadge>
          </div>

          <div className="health-row">
            <span>AI inference engine</span>
            <strong>99.2%</strong>
          </div>

          <div className="health-row">
            <span>Reconstruction engine</span>
            <strong>98.7%</strong>
          </div>

          <div className="health-row">
            <span>Geospatial services</span>
            <strong>100%</strong>
          </div>

          <div className="health-row">
            <span>Processing queue</span>
            <strong>04 jobs</strong>
          </div>
        </div>
      </section>
    </>
  );
}

/* =========================================================
   MODULE DATA
========================================================= */

const moduleData = {
  missions: {
    kicker: "MISSION CONTROL",
    title: "Missions",
    description:
      "Create, monitor and manage single-pass aerial intelligence missions.",
    icon: "mission",
    action: "Create Mission",
    stats: [
      ["Active", "04"],
      ["Completed", "128"],
      ["Processing", "01"],
      ["Alerts", "03"],
    ],
  },

  drone: {
    kicker: "DRONE INTELLIGENCE",
    title: "Single-Pass Video Processing",
    description:
      "Upload drone video and flight metadata to begin the intelligence pipeline.",
    icon: "drone",
    action: "Upload Flight",
    stats: [
      ["Video", "4K"],
      ["Frames", "1,284"],
      ["GPS", "RTK"],
      ["Pipeline", "72%"],
    ],
  },

  reconstruction: {
    kicker: "3D RECONSTRUCTION",
    title: "Scene Reconstruction",
    description:
      "Generate a metrically useful representation of terrain, structures and infrastructure.",
    icon: "cube",
    action: "Open 3D Viewer",
    stats: [
      ["Coverage", "2.84 km²"],
      ["Accuracy", "±0.8 m"],
      ["Mesh", "READY"],
      ["Quality", "HIGH"],
    ],
  },

  map: {
    kicker: "GEOSPATIAL INTELLIGENCE",
    title: "Geospatial Map",
    description:
      "Explore flight paths, detected objects, damage zones and critical findings.",
    icon: "map",
    action: "Open Map",
    stats: [
      ["Coverage", "2.84 km²"],
      ["Objects", "47"],
      ["Zones", "12"],
      ["GPS", "LOCKED"],
    ],
  },

  analytics: {
    kicker: "SCENE ANALYTICS",
    title: "Scene Analytics",
    description:
      "Understand people, vehicles, hazards and structural conditions inside the scene.",
    icon: "analytics",
    action: "Run Analysis",
    stats: [
      ["Objects", "47"],
      ["Classes", "09"],
      ["Confidence", "91%"],
      ["Status", "READY"],
    ],
  },

  measurements: {
    kicker: "METRIC ANALYSIS",
    title: "Measurements",
    description:
      "Measure distances, heights, areas and geographic coordinates from the reconstructed scene.",
    icon: "ruler",
    action: "Start Measuring",
    stats: [
      ["Distance", "842 m"],
      ["Area", "2.84 km²"],
      ["Height", "31.4 m"],
      ["Accuracy", "HIGH"],
    ],
  },

  findings: {
    kicker: "AI INTELLIGENCE",
    title: "AI Findings",
    description:
      "Review people, vehicles, fire indicators, structural damage and other detected events.",
    icon: "brain",
    action: "Analyze Scene",
    stats: [
      ["Findings", "27"],
      ["Critical", "03"],
      ["High", "06"],
      ["Confidence", "92%"],
    ],
  },

  reports: {
    kicker: "MISSION REPORTING",
    title: "Reports",
    description:
      "Generate operational reports containing reconstruction, maps, measurements and AI findings.",
    icon: "report",
    action: "Generate Report",
    stats: [
      ["Reports", "24"],
      ["Generated", "128"],
      ["Exports", "PDF"],
      ["Status", "READY"],
    ],
  },
};

/* =========================================================
   PREMIUM MODULE PAGE
========================================================= */

function ModulePage({ id, onBack, onAction }) {
  const page = moduleData[id] || moduleData.missions;

  return (
    <section className="module-page">
      <div className="module-top">
        <div className={`module-icon ${id}`}>
          <Icon type={page.icon} size={28} />
        </div>

        <StatusBadge>ENGINE READY</StatusBadge>
      </div>

      <div className="section-kicker">{page.kicker}</div>

      <h2>{page.title}</h2>

      <p className="module-description">{page.description}</p>

      <div className="module-stat-grid">
        {page.stats.map(([label, value]) => (
          <div className="module-stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="module-workspace">
        <div className="workspace-placeholder">
          <div className="workspace-placeholder-icon">
            <Icon type={page.icon} size={22} />
          </div>

          <div>
            <strong>Intelligence workspace ready</strong>

            <span>
              This module is connected to the AeroMesh processing pipeline. Live
              processing, visualization and export services can be connected
              here.
            </span>
          </div>
        </div>

        <div className="module-actions">
          <button
            className="button primary large"
            onClick={() => onAction(page.title)}
          >
            <Icon type={page.icon} size={15} />
            {page.action}
          </button>

          <button className="button large" onClick={onBack}>
            Back to Overview
          </button>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  const [activePage, setActivePage] = useState("overview");
  const [notification, setNotification] = useState("");
  const toastTimer = useRef(null);

  const currentPage = useMemo(() => {
    return allNavigation.find((item) => item.id === activePage);
  }, [activePage]);

  const showNotice = (message) => {
    setNotification(message);

    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }

    toastTimer.current = window.setTimeout(() => {
      setNotification("");
    }, 2800);
  };

  const navigate = (id) => {
    setActivePage(id);

    if (id !== "overview") {
      const page = allNavigation.find((item) => item.id === id);

      showNotice(`${page?.label || "Module"} workspace selected`);
    }
  };

  const handleModuleAction = (title) => {
    if (title === "Single-Pass Video Processing") {
      navigate("drone");
      showNotice("Ready to upload drone video");
      return;
    }

    showNotice(`${title} initialized`);
  };

  return (
    <div className="app-shell">
      {/* =====================================================
          SIDEBAR
      ===================================================== */}

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon type="drone" size={21} />
          </div>

          <div>
            <div className="brand-name">AEROMESH</div>
            <div className="brand-sub">AERIAL INTELLIGENCE PLATFORM</div>
          </div>
        </div>

        <button className="workspace-selector" type="button">
          <div className="workspace-avatar">D</div>

          <div className="workspace-copy">
            <span>WORKSPACE</span>
            <strong>Disaster Response</strong>
          </div>

          <span className="workspace-chevron">⌄</span>
        </button>

        <nav className="nav-section">
          <div className="nav-title">Mission Control</div>

          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activePage === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <span className="nav-icon">
                <Icon type={item.icon} size={17} />
              </span>

              <span>{item.label}</span>

              {item.count && <b className="nav-count">{item.count}</b>}
            </button>
          ))}
        </nav>

        <nav className="nav-section analysis-section">
          <div className="nav-title">Intelligence</div>

          {analysisNavigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activePage === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <span className="nav-icon">
                <Icon type={item.icon} size={17} />
              </span>

              <span>{item.label}</span>

              {item.count && (
                <b className={`nav-count ${item.alert ? "alert" : ""}`}>
                  {item.count}
                </b>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="engine-card">
          <div className="engine-header">
            <span className="engine-status" />
            <span>AI ENGINE</span>
            <strong>ONLINE</strong>
          </div>

          <div className="engine-line">
            <span>Reconstruction</span>
            <b>READY</b>
          </div>

          <div className="engine-line">
            <span>Detection</span>
            <b>READY</b>
          </div>

          <div className="engine-line">
            <span>Geospatial</span>
            <b>READY</b>
          </div>
        </div>

        <button
          className="settings-button"
          type="button"
          onClick={() => showNotice("Platform settings opened")}
        >
          <Icon type="settings" size={16} />
          Platform Settings
        </button>

        <div className="sidebar-footer">
          AEROMESH v0.9.0
          <span>•</span>
          SIH BUILD
        </div>
      </aside>

      {/* =====================================================
          MAIN APPLICATION
      ===================================================== */}

      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Mission Control</span>
            <i>/</i>
            <strong>{currentPage.label}</strong>
          </div>

          <div className="top-actions">
            <div className="system-online">
              <span />
              ALL SYSTEMS OPERATIONAL
            </div>

            <div className="top-divider" />

            <div className="ai-chip">
              <Icon type="brain" size={13} />
              AI CORE
            </div>

            <button
              className="operator"
              type="button"
              onClick={() => showNotice("Operator profile")}
            >
              <div className="operator-avatar">OP</div>

              <div>
                <strong>Operator</strong>
                <span>Mission Control</span>
              </div>

              <span className="operator-chevron">⌄</span>
            </button>
          </div>
        </header>

        <div className="content">
          {activePage === "overview" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="section-kicker">
                    AEROMESH / MISSION CONTROL
                  </div>

                  <h1>Operational Overview</h1>

                  <p>
                    Real-time visibility across reconstruction, geospatial
                    intelligence and AI scene understanding.
                  </p>
                </div>

                <div className="heading-meta">
                  <div>
                    <span>LAST SYNC</span>
                    <strong>16:42:08 IST</strong>
                  </div>

                  <div>
                    <span>REGION</span>
                    <strong>SECTOR 04</strong>
                  </div>
                </div>
              </div>

              <Overview onNavigate={navigate} />
            </>
          ) : (
            <>
              <div className="page-heading compact">
                <div>
                  <div className="section-kicker">
                    AEROMESH / {currentPage.label.toUpperCase()}
                  </div>

                  <h1>{currentPage.label}</h1>

                  <p>
                    Operational workspace for the AeroMesh intelligence
                    pipeline.
                  </p>
                </div>

                <StatusBadge>ENGINE READY</StatusBadge>
              </div>

              <ModulePage
                id={activePage}
                onBack={() => navigate("overview")}
                onAction={handleModuleAction}
              />
            </>
          )}
        </div>
      </main>

      {/* =====================================================
          TOAST
      ===================================================== */}

      {notification && (
        <div className="toast">
          <span className="toast-check">
            <Icon type="check" size={12} />
          </span>

          {notification}
        </div>
      )}
    </div>
  );
}
