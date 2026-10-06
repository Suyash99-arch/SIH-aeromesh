import { useEffect, useState, useMemo } from "react";
import Icon from "../ui/Icon";
import { listMissions, deleteMission, clearCache } from "../../api/missions";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteMission, setConfirmDeleteMission] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  const loadMissionsList = async () => {
    try {
      setLoading(true);
      const items = await listMissions();
      setMissions(items || []);
    } catch (err) {
      console.error("[MissionSelector] Error loading missions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMissionsList();
  }, []);

  const activeId = typeof active === "object" ? active?.id : active;

  const filteredMissions = useMemo(() => {
    if (!searchQuery.trim()) return missions;
    const q = searchQuery.toLowerCase().trim();
    return missions.filter((m) => {
      const name = (m.name || "").toLowerCase();
      const sector = (m.sector || m.location || "").toLowerCase();
      const id = (m.id || "").toLowerCase();
      const status = (m.status || "").toLowerCase();
      return name.includes(q) || sector.includes(q) || id.includes(q) || status.includes(q);
    });
  }, [missions, searchQuery]);

  const handleDelete = async (m) => {
    try {
      setDeletingId(m.id);
      setDeleteError("");
      await deleteMission(m.id);
      clearCache();

      // Update local state immediately
      const updatedList = missions.filter((item) => item.id !== m.id);
      setMissions(updatedList);

      // If active mission was deleted, select next available mission
      if (activeId === m.id) {
        const nextMission = updatedList[0];
        if (nextMission) {
          setActive?.(nextMission.id);
          notice?.(`Mission "${m.name}" deleted. Switched to "${nextMission.name}".`);
        } else {
          setActive?.(null);
          notice?.(`Mission "${m.name}" deleted.`);
        }
      } else {
        notice?.(`Mission "${m.name}" deleted successfully.`);
      }

      setConfirmDeleteMission(null);
    } catch (err) {
      console.error("[MissionSelector] Delete error:", err);
      setDeleteError(err.message || "Failed to delete mission");
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case "complete":
      case "COMPLETED":
        return "status-badge-complete";
      case "processing":
      case "RUNNING":
        return "status-badge-processing";
      case "video_uploaded":
        return "status-badge-uploaded";
      case "created":
      case "ready":
        return "status-badge-created";
      case "error":
      case "FAILED":
        return "status-badge-failed";
      default:
        return "status-badge-default";
    }
  };

  return (
    <div className="mission-selector-modal" role="dialog" aria-modal="true">
      <div className="mission-selector-backdrop" onClick={onClose} />
      
      <div className="mission-selector-panel">
        {/* Header */}
        <div className="panel-header-row">
          <div className="panel-header-info">
            <div className="panel-title-group">
              <span className="panel-icon-wrap">
                <Icon name="Compass" size={20} />
              </span>
              <div>
                <h3 className="panel-main-title">{t("selector.title") || "Active Flight Mission Switcher"}</h3>
                <p className="panel-subtitle">
                  Select active mission, inspect telemetry status, or manage aerial survey records.
                </p>
              </div>
            </div>
          </div>
          <button className="panel-close-btn" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>

        {/* Search & Stats Bar */}
        <div className="panel-filter-bar">
          <div className="panel-search-box">
            <Icon name="Search" size={15} />
            <input
              type="text"
              placeholder="Search by mission name, sector, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="panel-search-input"
            />
            {searchQuery && (
              <button className="clear-search-btn" onClick={() => setSearchQuery("")}>
                ×
              </button>
            )}
          </div>
          <div className="panel-count-badge">
            {filteredMissions.length} {filteredMissions.length === 1 ? "Mission" : "Missions"}
          </div>
        </div>

        {/* Delete Confirmation Alert Modal */}
        {confirmDeleteMission && (
          <div className="delete-confirm-overlay">
            <div className="delete-confirm-card">
              <div className="delete-confirm-icon">
                <Icon name="AlertTriangle" size={24} />
              </div>
              <h4>Delete Mission "{confirmDeleteMission.name}"?</h4>
              <p>
                This will permanently delete this mission along with all ingested video footage,
                extracted frames, AI detections, and 3D reconstruction meshes. This action cannot be undone.
              </p>
              {deleteError && <div className="delete-error-msg">{deleteError}</div>}
              <div className="delete-confirm-actions">
                <button
                  className="btn-cancel"
                  onClick={() => {
                    setConfirmDeleteMission(null);
                    setDeleteError("");
                  }}
                  disabled={Boolean(deletingId)}
                >
                  Cancel
                </button>
                <button
                  className="btn-danger-confirm"
                  onClick={() => handleDelete(confirmDeleteMission)}
                  disabled={Boolean(deletingId)}
                >
                  {deletingId ? "Deleting..." : "Permanently Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Missions List */}
        <div className="panel-content-area">
          {loading ? (
            <div className="panel-loading-state">
              <span className="spinner-icon" />
              <p>{t("selector.loading") || "Loading missions registry..."}</p>
            </div>
          ) : filteredMissions.length === 0 ? (
            <div className="panel-empty-state">
              <p>{searchQuery ? "No missions match your search query." : (t("selector.empty") || "No missions available.")}</p>
              <p className="empty-subtext">
                {searchQuery ? "Try searching with a different term." : (t("selector.uploadPrompt") || "Create or ingest a new flight mission to get started.")}
              </p>
            </div>
          ) : (
            <div className="missions-grid">
              {filteredMissions.map((m) => {
                const isSelected = activeId === m.id;
                const sectorText = m.sector || m.location || t("selector.defaultSector") || "Sector Unassigned";
                const frameCount = m.frames || m.video?.total_frames || m.stats?.frames || 0;
                const statusPill = m.status || "created";

                return (
                  <div
                    key={m.id}
                    className={`mission-card-item ${isSelected ? "selected-active" : ""}`}
                  >
                    <div
                      className="mission-card-body"
                      onClick={() => {
                        setActive?.(m.id);
                        notice?.(`Mission "${m.name}" set as active.`);
                        onClose?.();
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setActive?.(m.id);
                          notice?.(`Mission "${m.name}" set as active.`);
                          onClose?.();
                        }
                      }}
                    >
                      <div className="mission-card-top">
                        <div className="mission-card-title-group">
                          <span className={`active-indicator-dot ${isSelected ? "dot-active" : ""}`} />
                          <h4 className="mission-title-text" title={m.name}>
                            {m.name || "Untitled Mission"}
                          </h4>
                        </div>
                        <span className={`status-badge-pill ${getStatusBadgeClass(statusPill)}`}>
                          {statusPill}
                        </span>
                      </div>

                      <div className="mission-meta-row">
                        <span className="meta-tag sector-tag" title={sectorText}>
                          <Icon name="MapPin" size={12} />
                          {sectorText}
                        </span>
                        {frameCount > 0 && (
                          <span className="meta-tag frames-tag">
                            <Icon name="Film" size={12} />
                            {frameCount} frames
                          </span>
                        )}
                        {m.coverage && (
                          <span className="meta-tag coverage-tag">
                            {m.coverage}
                          </span>
                        )}
                      </div>

                      <div className="mission-id-row">
                        <span className="mission-id-label">ID:</span>
                        <code className="mission-id-code">{m.id?.slice(0, 8)}...</code>
                        {isSelected && (
                          <span className="active-tag-badge">ACTIVE</span>
                        )}
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="mission-card-actions">
                      <button
                        className={`action-btn-select ${isSelected ? "is-active-btn" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActive?.(m.id);
                          notice?.(`Mission "${m.name}" set as active.`);
                          onClose?.();
                        }}
                        title={isSelected ? "Currently Active Mission" : "Switch to this Mission"}
                      >
                        {isSelected ? "Active" : "Switch"}
                      </button>

                      <button
                        className="action-btn-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteMission(m);
                        }}
                        title={`Delete Mission "${m.name}"`}
                        aria-label={`Delete Mission ${m.name}`}
                      >
                        <Icon name="Trash2" size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="panel-footer-row">
          <div className="footer-legend">
            <span className="legend-item"><span className="legend-dot dot-complete" /> Completed</span>
            <span className="legend-item"><span className="legend-dot dot-processing" /> Processing</span>
            <span className="legend-item"><span className="legend-dot dot-uploaded" /> Video Uploaded</span>
            <span className="legend-item"><span className="legend-dot dot-created" /> Created</span>
          </div>
          <button className="panel-done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
