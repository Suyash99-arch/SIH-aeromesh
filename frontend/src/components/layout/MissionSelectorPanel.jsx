import { useEffect, useState } from "react";
import Icon from "../ui/Icon";
import { listMissions } from "../../api/missions";

export default function MissionSelectorPanel({
  active,
  setActive,
  notice,
  onClose,
}) {
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    listMissions().then((items) => {
      if (!mounted) return;
      setMissions(items || []);
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="mission-selector-modal">
      <div className="mission-selector-backdrop" onClick={onClose} />
      <div className="mission-selector-panel">
        <button className="panel-close" onClick={onClose}>
          ×
        </button>
        <div className="panel-header">
          <Icon name="Compass" size={18} />
          <h3>Active Flight Mission Switcher</h3>
        </div>

        {loading ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8" }}>
            Loading flight missions...
          </div>
        ) : missions.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8" }}>
            <p>No active flight missions found in workspace.</p>
            <p style={{ fontSize: "13px", marginTop: "8px" }}>
              Upload drone flight video to initiate 3D reconstruction.
            </p>
          </div>
        ) : (
          <div className="mission-list">
            {missions.map((m) => {
              const isSelected = active?.id === m.id || active === m.id;
              return (
                <button
                  key={m.id}
                  className={`mission-item ${isSelected ? "active" : ""}`}
                  onClick={() => {
                    setActive(m.id);
                    notice?.(`${m.name} active app-wide`);
                    onClose?.();
                  }}
                >
                  <div className="item-main">
                    <span className="name">{m.name}</span>
                    <span className="sector">{m.sector || m.location || "Sector Recon"}</span>
                  </div>
                  <span className={`status-pill ${m.status}`}>{m.status}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
