import React, { useState } from "react";
import Icon from "../ui/Icon";

const PRESET_COLORS = [
  { label: "Cyan", value: "#38bdf8" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Red", value: "#ef4444" },
  { label: "Green", value: "#10b981" },
  { label: "Purple", value: "#a855f7" },
];

const PRESET_TYPES = [
  "Entry Point",
  "Exit Point",
  "Survivor Location",
  "Structural Hazard",
  "Command Post",
  "Point of Interest",
];

export default function AddMarkerModal({ isOpen, onClose, onSave, initialCoords }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("Entry Point");
  const [color, setColor] = useState("#38bdf8");
  const [coords, setCoords] = useState(() => initialCoords || [0.0, 1.5, 0.0]);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (onSave) {
        await onSave({
          name: name.trim(),
          type,
          color,
          position: [
            parseFloat(coords[0]) || 0,
            parseFloat(coords[1]) || 0,
            parseFloat(coords[2]) || 0,
          ],
        });
      }
    } catch (err) {
      console.error("[AddMarkerModal] Error saving marker:", err);
    } finally {
      setSubmitting(false);
      onClose();
    }
  };

  return (
    <div className="analysis-modal-backdrop" onClick={onClose}>
      <div className="analysis-modal-content marker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="analysis-modal-header">
          <div className="flex items-center gap-2">
            <Icon name="MapPin" size={16} className="cyan" />
            <h3>Drop Custom 3D Marker</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="marker-modal-form" style={{ padding: "20px" }}>
          <div className="form-row">
            <label className="form-label">Marker Name / Identifier *</label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="e.g., North Entry Point, Trapped Survivor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-row">
            <label className="form-label">Marker Category / Type</label>
            <select
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {PRESET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label className="form-label">Marker Color</label>
            <div className="color-preset-row">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`color-chip ${color === c.value ? "active" : ""}`}
                  style={{ background: c.value }}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">3D Coordinates [X, Y, Z]</label>
            <div className="coords-input-row">
              <input
                type="number"
                step="0.1"
                className="form-input"
                placeholder="X"
                value={coords[0]}
                onChange={(e) => setCoords([e.target.value, coords[1], coords[2]])}
              />
              <input
                type="number"
                step="0.1"
                className="form-input"
                placeholder="Y"
                value={coords[1]}
                onChange={(e) => setCoords([coords[0], e.target.value, coords[2]])}
              />
              <input
                type="number"
                step="0.1"
                className="form-input"
                placeholder="Z"
                value={coords[2]}
                onChange={(e) => setCoords([coords[0], coords[1], e.target.value])}
              />
            </div>
            <small className="form-hint">Coordinates correspond to photogrammetric local metric space.</small>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !name.trim()}
            >
              {submitting ? "Placing..." : "Drop Marker"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
