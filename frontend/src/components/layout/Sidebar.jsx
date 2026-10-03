import { motion, useReducedMotion } from "framer-motion";
import { useState, useEffect } from "react";
import Icon from "../ui/Icon";
import MissionSelectorPanel from "./MissionSelectorPanel";
import {
  missionNavigation,
  intelligenceNavigation,
  outputNavigation,
  systemNavigation,
} from "../../data/navigation";

/** Checks /api/v1/ai-engine/status; returns live detector, reconstruction, compute, and tiling status */
function useEngineStatus() {
  const [status, setStatus] = useState({
    detector: null,
    reconstruction: null,
    compute: null,
    tiling: null,
    overall: null,
  });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/v1/ai-engine/status");
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          const detReady = json?.detector?.status === "READY";
          const reconReady = json?.reconstruction?.status === "READY";
          const overall = (detReady && reconReady) ? "ONLINE" : (detReady || reconReady) ? "PARTIAL" : "DEGRADED";
          setStatus({
            detector: json?.detector?.label || (detReady ? "YOLO Ready" : "Detector: not loaded"),
            detectorStatus: json?.detector?.status || "NOT_LOADED",
            reconstruction: json?.reconstruction?.label || (reconReady ? "pycolmap 4.1.1" : "Reconstruction Offline"),
            reconstructionStatus: json?.reconstruction?.status || "UNAVAILABLE",
            compute: json?.compute?.label || "CPU only",
            computeDevice: json?.compute?.device || "cpu",
            tiling: json?.tiling?.label || "2x2 Tiling",
            tilingStatus: json?.tiling?.status || "ACTIVE",
            overall,
          });
        } else {
          setStatus({
            detector: "Detector: not loaded",
            detectorStatus: "OFFLINE",
            reconstruction: "pycolmap Offline",
            reconstructionStatus: "OFFLINE",
            compute: "CPU only",
            computeDevice: "cpu",
            tiling: "Tiling Inactive",
            tilingStatus: "OFFLINE",
            overall: "OFFLINE",
          });
        }
      } catch {
        if (!cancelled) {
          setStatus({
            detector: "Detector: not loaded",
            detectorStatus: "OFFLINE",
            reconstruction: "pycolmap Offline",
            reconstructionStatus: "OFFLINE",
            compute: "CPU only",
            computeDevice: "cpu",
            tiling: "Tiling Inactive",
            tilingStatus: "OFFLINE",
            overall: "OFFLINE",
          });
        }
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return status;
}


function Nav({ title, items, activePage, navigate }) {
  const reduceMotion = useReducedMotion();

  return (
    <nav className="nav-group">
      <span className="nav-title">{title}</span>
      {items.map(([id, label, icon, count]) => {
        const isActive = activePage === id;

        return (
          <motion.button
            layout
            key={id}
            className={`nav-item ${isActive ? "active" : ""}`}
            onClick={() => navigate(id)}
            whileHover={reduceMotion ? undefined : { scale: 1.01 }}
            whileTap={reduceMotion ? undefined : { scale: 0.97, rotate: -3 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {isActive && !reduceMotion && (
              <motion.span
                layoutId="nav-active-pill"
                className="nav-active-pill"
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
              />
            )}
            <Icon name={icon} />
            <span>{label}</span>
            {count && <b>{count}</b>}
          </motion.button>
        );
      })}
    </nav>
  );
}

export default function Sidebar({
  activePage,
  navigate,
  notice,
  mission,
  setMission,
  onCreateMission,
  onNavigateHome,
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const engineStatus = useEngineStatus();

  return (
    <>
      <aside className="sidebar">
        <div
          className="brand"
          onClick={onNavigateHome}
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer" }}
          title="Return to Presentation Home Page"
        >
          <div>
            <Icon name="Radar" size={21} />
          </div>
          <section>
            <strong>HEXA SPARK</strong>
            <small>AERIAL INTELLIGENCE PLATFORM</small>
          </section>
        </div>

        <button className="workspace" onClick={() => setSelectorOpen(true)}>
          <b>{mission?.name?.[0] || "A"}</b>
          <span>
            <small>ACTIVE MISSION</small>
            <strong>
              {mission?.name || "Unknown mission"} ·{" "}
              {mission?.sector || "New mission"}
            </strong>
          </span>
        </button>

        <button
          className="nav-item create-mission-btn"
          onClick={onCreateMission}
          id="btn-sidebar-new-mission"
        >
          <Icon name="Plus" />
          <span>New Mission</span>
        </button>

        <Nav
          title="MISSION"
          items={missionNavigation}
          {...{ activePage, navigate }}
        />
        <Nav
          title="INTELLIGENCE"
          items={intelligenceNavigation}
          {...{ activePage, navigate }}
        />
        <Nav
          title="OUTPUT"
          items={outputNavigation}
          {...{ activePage, navigate }}
        />
        <div className="sidebar-spacer" />

        <div className="engine">
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <i /> AI ENGINE
            </span>
            <b style={{
              color: engineStatus.overall === "ONLINE" ? '#38bdf8' : engineStatus.overall === null ? '#fbbf24' : '#f87171',
              fontSize: '10px',
            }}>
              {engineStatus.overall || "CHECKING"}
            </b>
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Detection</span>
              <b style={{
                color: engineStatus.detectorStatus === 'READY' ? '#10b981' : '#f87171',
                fontSize: '9.5px',
                background: engineStatus.detectorStatus === 'READY' ? '#10b9811e' : '#f871711e',
                padding: '1px 5px',
                borderRadius: '4px',
              }}>
                {engineStatus.detector || 'Loading…'}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>SfM 3D</span>
              <b style={{
                color: engineStatus.reconstructionStatus === 'READY' ? '#10b981' : '#f87171',
                fontSize: '9.5px',
                background: engineStatus.reconstructionStatus === 'READY' ? '#10b9811e' : '#f871711e',
                padding: '1px 5px',
                borderRadius: '4px',
              }}>
                {engineStatus.reconstruction || 'Loading…'}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Hardware</span>
              <b style={{
                color: engineStatus.computeDevice === 'cuda' ? '#38bdf8' : '#e2e8f0',
                fontSize: '9.5px',
                background: 'rgba(255,255,255,0.06)',
                padding: '1px 5px',
                borderRadius: '4px',
              }}>
                {engineStatus.compute || 'CPU only'}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Inference</span>
              <b style={{
                color: '#38bdf8',
                fontSize: '9.5px',
                background: '#38bdf81e',
                padding: '1px 5px',
                borderRadius: '4px',
              }}>
                {engineStatus.tiling || '2x2 Tiled'}
              </b>
            </div>
          </div>
        </div>

        <Nav
          title="SYSTEM"
          items={systemNavigation}
          {...{ activePage, navigate }}
        />
        <footer>
          HEXA SPARK v0.9.0 <i>•</i> SIH BUILD
        </footer>
      </aside>

      {selectorOpen && (
        <MissionSelectorPanel
          active={mission}
          setActive={setMission}
          notice={notice}
          onClose={() => setSelectorOpen(false)}
        />
      )}
    </>
  );
}
