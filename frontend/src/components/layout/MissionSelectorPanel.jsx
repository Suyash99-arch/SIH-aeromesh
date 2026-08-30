import { useEffect, useState } from "react";
import Icon from "../ui/Icon";
import { missions as seededMissions } from "../../data/missions";
import { listMissions } from "../../api/missions";

export default function MissionSelectorPanel({
  active,
  setActive,
  notice,
  onClose,
}) {
  const [missions, setMissions] = useState(seededMissions);

  useEffect(() => {
    let mounted = true;

    listMissions().then((items) => {
      if (!mounted) return;
      if (!items || !items.length) {
        setMissions(seededMissions);
        return;
      }

      const deduped = [...items]
        .filter((item) => item && item.id)
        .map((item) => ({
          ...item,
          name: item.name || `Mission ${item.id}`,
          sector: item.sector || "Sector",
          status: item.status || "ready",
        }))
        .filter(
          (item, index, arr) =>
            arr.findIndex((candidate) => candidate.id === item.id) === index,
        )
        .slice(0, 6);

      const seededIds = new Set(seededMissions.map((item) => item.id));
      const additionalMissions = deduped.filter(
        (item) => !seededIds.has(item.id),
      );
      setMissions([...seededMissions, ...additionalMissions].slice(0, 6));
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
        <header className="panel-header">
          <span className="eyebrow">MISSION COMMAND</span>
          <h2>Select Active Mission</h2>
          <p>
            Each mission demonstrates the complete aerial intelligence pipeline.
          </p>
        </header>

        <div className="mission-cards">
          {missions.map((m) => {
            const isActive = active.id === m.id;
            return (
              <button
                key={m.id}
                className={`mission-card ${isActive ? "active" : ""} ${m.status}`}
                onClick={() => {
                  if (!m?.id) return;
                  setActive(m.id);
                  notice(`${m.name} is now active`);
                  onClose();
                }}
              >
                <div className="card-header">
                  <div className="card-icon">
                    {m.type.includes("Disaster") ? (
                      <Icon name="AlertTriangle" size={24} />
                    ) : m.type.includes("Bridge") ? (
                      <Icon name="GitBranch" size={24} />
                    ) : (
                      <Icon name="Building2" size={24} />
                    )}
                  </div>
                  <div className="card-title">
                    <strong>{m.name}</strong>
                    <small>{m.sector}</small>
                  </div>
                  <div className={`status-badge ${m.status}`}>{m.status}</div>
                </div>

                <p className="card-type">{m.type}</p>

                <div className="card-meta">
                  <div className="meta-item">
                    <Icon name="Eye" size={14} />
                    <span>{m.findings.length} findings</span>
                  </div>
                  <div className="meta-item">
                    <Icon name="Map" size={14} />
                    <span>{m.coverage}</span>
                  </div>
                  <div className="meta-item">
                    <Icon name="Zap" size={14} />
                    <span>{m.confidence}% AI</span>
                  </div>
                </div>

                <div className="card-stats">
                  <div className="stat">
                    <small>Frames</small>
                    <b>{m.frames}</b>
                  </div>
                  <div className="stat">
                    <small>Objects</small>
                    <b>{m.objects.total}</b>
                  </div>
                  <div className="stat">
                    <small>Flight</small>
                    <b>{m.duration}</b>
                  </div>
                </div>

                <div className={`active-indicator ${isActive ? "show" : ""}`}>
                  <Icon name="Check" size={16} /> ACTIVE
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
