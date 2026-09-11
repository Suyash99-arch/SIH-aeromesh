import React from "react";
import Icon from "../ui/Icon";

/**
 * View Filters Sidebar & Custom Markings Panel
 * Matches Reference Screenshot 1:
 * - View Filters toggles: Humans, Vehicles, Fire & Smoke, Damage, Entry/Exit Points, 3D Mesh, Point Cloud
 * - Custom Markings panel: Add marker, saved markings list with visibility toggles and deletion
 */
export default function ViewFiltersSidebar({
  layers = {},
  onToggleLayer,
  customMarkings = [],
  selectedMarkingId,
  onSelectMarking,
  onToggleMarkingVisible,
  onDeleteMarking,
  onOpenAddMarkerModal,
  totalPeople = 0,
  totalVehicles = 0,
  entryExitCount = 0,
}) {
  return (
    <aside className="view-filters-sidebar" aria-label="Scene Filters and Markings">
      {/* 1. VIEW FILTERS */}
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <Icon name="Sliders" size={14} className="section-icon" />
          <span className="section-title">VIEW FILTERS</span>
        </div>

        <div className="filter-group">
          {/* Humans */}
          <label className="filter-item">
            <input
              type="checkbox"
              checked={layers.people !== false && layers.humans !== false}
              onChange={() => {
                onToggleLayer?.("people");
                onToggleLayer?.("humans");
              }}
            />
            <span className="filter-label">Humans</span>
            <span className="filter-badge count">{totalPeople}</span>
          </label>

          {/* Vehicles */}
          <label className="filter-item">
            <input
              type="checkbox"
              checked={layers.vehicles !== false}
              onChange={() => onToggleLayer?.("vehicles")}
            />
            <span className="filter-label">Vehicles</span>
            <span className="filter-badge count">{totalVehicles}</span>
          </label>

          {/* Fire & Smoke */}
          <label className="filter-item warning-item">
            <input
              type="checkbox"
              checked={layers.fireSmoke !== false}
              onChange={() => onToggleLayer?.("fireSmoke")}
            />
            <span className="filter-label">Fire & Smoke</span>
            <span
              className="filter-badge notice"
              title="Standard YOLO11 COCO weights do not detect fire/smoke. Requires fine-tuned FLAME model."
            >
              0 (Requires FLAME weights)
            </span>
          </label>

          {/* Structural Damage */}
          <label className="filter-item warning-item">
            <input
              type="checkbox"
              checked={layers.damage !== false}
              onChange={() => onToggleLayer?.("damage")}
            />
            <span className="filter-label">Structural Damage</span>
            <span
              className="filter-badge notice"
              title="Standard detection does not segment structural damage. Requires xBD disaster model weights."
            >
              0 (Requires xBD weights)
            </span>
          </label>

          {/* Entry/Exit Points */}
          <label className="filter-item">
            <input
              type="checkbox"
              checked={layers.entryExit !== false}
              onChange={() => onToggleLayer?.("entryExit")}
            />
            <span className="filter-label">Entry / Exit Points</span>
            <span className="filter-badge count">{entryExitCount}</span>
          </label>

          {/* 3D Reconstruction Mesh */}
          <label className="filter-item">
            <input
              type="checkbox"
              checked={layers.mesh !== false}
              onChange={() => onToggleLayer?.("mesh")}
            />
            <span className="filter-label">3D Reconstruction Mesh</span>
            <span className="filter-badge active">Active</span>
          </label>

          {/* Point Cloud Overlay */}
          <label className="filter-item">
            <input
              type="checkbox"
              checked={layers.pointCloud === true}
              onChange={() => onToggleLayer?.("pointCloud")}
            />
            <span className="filter-label">Point Cloud Overlay</span>
            <span className="filter-badge">Optional</span>
          </label>
        </div>
      </div>

      <div className="sidebar-divider" />

      {/* 2. CUSTOM MARKINGS */}
      <div className="sidebar-section">
        <div className="sidebar-section-header between">
          <div className="flex items-center gap-1.5" style={{ minWidth: 0, flexShrink: 1 }}>
            <Icon name="MapPin" size={14} className="section-icon cyan" />
            <span className="section-title" style={{ whiteSpace: "nowrap", fontSize: "11px", letterSpacing: "0.03em" }}>CUSTOM MARKINGS</span>
          </div>
          <button
            type="button"
            className="add-marker-btn"
            onClick={onOpenAddMarkerModal}
            title="Add a custom labeled marker to the 3D scene"
          >
            + Drop Marker
          </button>
        </div>

        <div className="saved-markings-list">
          {customMarkings.length === 0 ? (
            <div className="markings-empty">
              <span>No custom markers dropped yet.</span>
              <small>Click "+ Drop Marker" to place persistent entry/exit, survivor, or hazard pins onto the 3D scene.</small>
            </div>
          ) : (
            customMarkings.map((m) => {
              const isSelected = selectedMarkingId === m.id;
              const isVisible = m.visible !== false;
              const coords = Array.isArray(m.position)
                ? `[${m.position.map((v) => Number(v).toFixed(1)).join(", ")}]`
                : "[0.0, 0.0, 0.0]";

              return (
                <div
                  key={m.id}
                  className={`marking-card ${isSelected ? "selected" : ""} ${!isVisible ? "hidden-marker" : ""}`}
                  onClick={() => onSelectMarking?.(m.id)}
                >
                  <div className="marking-header">
                    <span
                      className="marking-color-dot"
                      style={{ background: m.color || "#38bdf8" }}
                    />
                    <span className="marking-name">{m.name || "Untitled Marker"}</span>
                    <span className="marking-type-pill">{m.type || "POI"}</span>
                  </div>

                  <div className="marking-footer">
                    <span className="marking-coords">{coords}</span>
                    <div className="marking-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="marking-action-btn"
                        onClick={() => onToggleMarkingVisible?.(m.id)}
                        title={isVisible ? "Hide marker in 3D" : "Show marker in 3D"}
                      >
                        <Icon name={isVisible ? "Eye" : "EyeOff"} size={13} />
                      </button>
                      <button
                        type="button"
                        className="marking-action-btn delete"
                        onClick={() => onDeleteMarking?.(m.id)}
                        title="Delete marker from mission"
                      >
                        <Icon name="Trash2" size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
