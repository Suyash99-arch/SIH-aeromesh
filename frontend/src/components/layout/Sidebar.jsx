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

/** Checks /api/v1/health; returns { reconstruction, detection, geospatial } readiness */
function useEngineStatus() {
  const [status, setStatus] = useState({ reconstruction: null, detection: null, geospatial: null, overall: null });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/v1/health");
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          const online = json?.status === "healthy";
          const cvReady = json?.opencv_status === "ready" || json?.opencv_status === true;
          const ffReady = json?.ffmpeg_status === "ready" || json?.ffmpeg_status === true;
          setStatus({
            overall: online ? "ONLINE" : "DEGRADED",
            reconstruction: online ? "READY" : "UNAVAILABLE",
            detection: (online && cvReady) ? "READY" : online ? "PARTIAL" : "UNAVAILABLE",
            geospatial: online ? "READY" : "UNAVAILABLE",
          });
        } else {
          setStatus({ overall: "OFFLINE", reconstruction: "OFFLINE", detection: "OFFLINE", geospatial: "OFFLINE" });
        }
      } catch {
        if (!cancelled)
          setStatus({ overall: "OFFLINE", reconstruction: "OFFLINE", detection: "OFFLINE", geospatial: "OFFLINE" });
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
          {[
            ["Reconstruction", engineStatus.reconstruction],
            ["Detection", engineStatus.detection],
            ["Geospatial", engineStatus.geospatial],
          ].map(([label, st]) => {
            const color = st === "READY" ? '#10b981' : st === "PARTIAL" ? '#fbbf24' : st === null ? '#64748b' : '#f87171';
            return (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
                <span>{label}</span>
                <b style={{ color, fontSize: '10px', background: `${color}1e`, padding: '1px 6px', borderRadius: '4px' }}>
                  {st || "…"}
                </b>
              </div>
            );
          })}
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
