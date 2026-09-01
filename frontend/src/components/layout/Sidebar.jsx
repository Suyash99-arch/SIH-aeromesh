import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import Icon from "../ui/Icon";
import MissionSelectorPanel from "./MissionSelectorPanel";
import {
  missionNavigation,
  intelligenceNavigation,
  outputNavigation,
  systemNavigation,
} from "../../data/navigation";

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
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <div>
            <Icon name="Radar" size={21} />
          </div>
          <section>
            <strong>AEROMESH</strong>
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
          <header>
            <span>
              <i /> AI ENGINE
            </span>
            <b>ONLINE</b>
          </header>
          {["Reconstruction", "Detection", "Geospatial"].map((x) => (
            <div key={x}>
              <span>{x}</span>
              <b>READY</b>
            </div>
          ))}
        </div>

        <Nav
          title="SYSTEM"
          items={systemNavigation}
          {...{ activePage, navigate }}
        />
        <footer>
          AEROMESH v0.9.0 <i>•</i> SIH BUILD
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
