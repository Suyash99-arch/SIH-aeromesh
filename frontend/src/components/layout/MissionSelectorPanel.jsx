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

      const backendMap = new Map(items.map((m) => [m.id, m]));
      // Merge seeded missions with updated backend states
      const mergedSeeded = seededMissions.map((s) => {
        const backendMatch = backendMap.get(s.id);
        if (backendMatch) {
          return {
            ...s,
            ...backendMatch,
            status: backendMatch.status || s.status,
            progress: backendMatch.progress ?? s.progress,
          };
        }
        return s;
      });

      const seededIds = new Set(seededMissions.map((s) => s.id));
      const newBackendMissions = items
        .filter((item) => item && item.id && !seededIds.has(item.id))
        .map((item) => ({
          id: item.id,
          name: item.name || `Mission ${item.id}`,
          sector: item.sector || "Sector Recon",
          status: item.status || "ready",
          type: item.type || "Single-Pass 3D Ingestion",
          coverage: item.coverage || "0.45 km²",
          confidence: item.confidence || 92,
          frames: item.frames || 0,
          objects: item.objects || { total: 0 },
          findings: item.findings || [],
          duration: item.duration || "00:45",
          progress: item.progress || 0,
        }));

      setMissions([...mergedSeeded, ...newBackendMissions]);
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
            Switch the active flight context app-wide across 3D photogrammetry, detections, and deliverables.
          </p>
        </header>

        <div className="mission-cards" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {missions.map((m) => {
            const isActive = active?.id === m.id;
            const isProcessing = m.status === "processing";
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
                    {m.type?.includes("Disaster") ? (
                      <Icon name="AlertTriangle" size={24} />
                    ) : m.type?.includes("Bridge") ? (
                      <Icon name="GitBranch" size={24} />
                    ) : (
                      <Icon name="Building2" size={24} />
                    )}
                  </div>
                  <div className="card-title">
                    <strong>{m.name}</strong>
                    <small>{m.sector}</small>
                  </div>
                  <div className={`status-badge ${m.status}`}>
                    {isProcessing ? `PROCESSING (${m.progress || 0}%)` : (m.status || "READY").toUpperCase()}
                  </div>
                </div>

                <p className="card-type">{m.type || "Aerial Reconnaissance"}</p>

                <div className="card-meta">
                  <div className="meta-item">
                    <Icon name="Eye" size={14} />
                    <span>{m.findings?.length || 0} findings</span>
                  </div>
                  <div className="meta-item">
                    <Icon name="Map" size={14} />
                    <span>{m.coverage || "—"}</span>
                  </div>
                  <div className="meta-item">
                    <Icon name="Zap" size={14} />
                    <span>{m.confidence || 90}% AI</span>
                  </div>
                </div>

                <div className="card-stats">
                  <div className="stat">
                    <small>Frames</small>
                    <b>{m.frames ?? 0}</b>
                  </div>
                  <div className="stat">
                    <small>Objects</small>
                    <b>{m.objects?.total ?? 0}</b>
                  </div>
                  <div className="stat">
                    <small>Flight</small>
                    <b>{m.duration || "—"}</b>
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
