import { useEffect, useState } from "react";
import Icon from "../ui/Icon";
import { listMissions } from "../../api/missions";
import { useUI } from "../../context/UIContext";

export default function MissionSelectorPanel({
  active,
  setActive,
  notice,
  onClose,
}) {
  const { t } = useUI();
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
          <h3>{t("selector.title")}</h3>
        </div>

        {loading ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8" }}>
            {t("selector.loading")}
          </div>
        ) : missions.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8" }}>
            <p>{t("selector.empty")}</p>
            <p style={{ fontSize: "13px", marginTop: "8px" }}>
              {t("selector.uploadPrompt")}
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
                    <span className="sector">{m.sector || m.location || t("selector.defaultSector")}</span>
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
