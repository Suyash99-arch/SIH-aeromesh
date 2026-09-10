import React from "react";
import Icon from "../ui/Icon";

/**
 * Bottom Stat Strip
 * Matches Reference Screenshot 1:
 * Displays real aggregated counts from pipeline detection data:
 * - Total People
 * - Total Vehicles
 * - Fire/Smoke Incidents (explicitly discloses standard YOLO limitations)
 * - Damaged Areas (explicitly discloses standard YOLO limitations)
 * - Entry/Exit Points (from custom markings / operator annotations)
 * - 3D Surface Density (real photogrammetry points / vertices)
 */
export default function BottomStatStrip({
  totalPeople = 0,
  totalVehicles = 0,
  entryExitCount = 0,
  pointCount = null,
  meshVertices = null,
  scaleStatus = "RELATIVE_SCALE",
}) {
  const densityDisplay = meshVertices
    ? `${Number(meshVertices).toLocaleString()} Vertices`
    : pointCount
      ? `${Number(pointCount).toLocaleString()} Points`
      : "Active 3D Mesh";

  return (
    <footer className="incident-bottom-stat-strip" aria-label="Incident Detection Summary">
      {/* 1. People Count */}
      <div className="stat-strip-cell">
        <div className="stat-strip-label">
          <Icon name="Users" size={13} className="stat-icon cyan" />
          <span>TOTAL PEOPLE</span>
        </div>
        <div className="stat-strip-value cyan">{totalPeople}</div>
        <div className="stat-strip-sub">Real Detection[] Count</div>
      </div>

      {/* 2. Vehicles Count */}
      <div className="stat-strip-cell">
        <div className="stat-strip-label">
          <Icon name="Truck" size={13} className="stat-icon cyan" />
          <span>TOTAL VEHICLES</span>
        </div>
        <div className="stat-strip-value cyan">{totalVehicles}</div>
        <div className="stat-strip-sub">Automotive & Transport</div>
      </div>

      {/* 3. Fire & Smoke Incidents (Honest Disclosure) */}
      <div className="stat-strip-cell">
        <div className="stat-strip-label">
          <Icon name="Flame" size={13} className="stat-icon amber" />
          <span>FIRE INCIDENTS</span>
        </div>
        <div className="stat-strip-value amber">0</div>
        <div className="stat-strip-sub warning-text" title="YOLO11 COCO dataset does not predict flame/smoke classes. Requires fine-tuned FLAME model.">
          Requires FLAME Weights
        </div>
      </div>

      {/* 4. Damaged Areas (Honest Disclosure) */}
      <div className="stat-strip-cell">
        <div className="stat-strip-label">
          <Icon name="AlertTriangle" size={13} className="stat-icon amber" />
          <span>DAMAGED AREAS</span>
        </div>
        <div className="stat-strip-value amber">0</div>
        <div className="stat-strip-sub warning-text" title="Photogrammetric pipeline reconstructs geometry; debris & damage classification requires xBD disaster weights.">
          Requires xBD Weights
        </div>
      </div>

      {/* 5. Entry / Exit Points */}
      <div className="stat-strip-cell">
        <div className="stat-strip-label">
          <Icon name="DoorOpen" size={13} className="stat-icon purple" />
          <span>ENTRY / EXIT POINTS</span>
        </div>
        <div className="stat-strip-value purple">{entryExitCount}</div>
        <div className="stat-strip-sub">Operator Saved Markings</div>
      </div>

      {/* 6. 3D Surface Density */}
      <div className="stat-strip-cell">
        <div className="stat-strip-label">
          <Icon name="Layers" size={13} className="stat-icon blue" />
          <span>3D RECONSTRUCTION</span>
        </div>
        <div className="stat-strip-value">{densityDisplay}</div>
        <div className="stat-strip-sub">{scaleStatus}</div>
      </div>
    </footer>
  );
}
