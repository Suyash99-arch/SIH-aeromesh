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
  return (
    <nav className="nav-group">
      <span className="nav-title">{title}</span>
      {items.map(([id, label, icon, count]) => (
        <button
          className={`nav-item ${activePage === id ? "active" : ""}`}
          onClick={() => navigate(id)}
          key={id}
        >
          <Icon name={icon} />
          <span>{label}</span>
          {count && <b>{count}</b>}
        </button>
      ))}
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
