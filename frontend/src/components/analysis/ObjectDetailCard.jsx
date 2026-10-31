import React, { useEffect, useState } from "react";
import { resolveAssetUrl } from "../../api/missions";

export default function ObjectDetailCard({
  missionId,
  objectId,
  currentFrame,
  onSeekFrame,
  onShowIn3D,
  onShowInVideo,
  onClose,
  viewContext = "video", // "video" | "3d"
}) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    if (!missionId || !objectId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const cleanId = String(objectId).replace(/^OBJ_/, "");
    fetch(resolveAssetUrl(`/api/v1/missions/${missionId}/objects/${cleanId}`))
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Object not found (HTTP ${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (active) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          console.warn("[ObjectDetailCard] Failed to fetch object detail:", err);
          setError(err.message || "Failed to load object details");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [missionId, objectId]);

  if (!objectId) return null;

  // Active observation in current frame or closest observation
  const obsList = detail?.observations || [];
  let currentObs = null;
  if (obsList.length > 0) {
    currentObs = obsList.find((o) => o.frame_idx === currentFrame);
    if (!currentObs && currentFrame != null) {
      // Find closest observation
      let minDiff = Infinity;
      for (const o of obsList) {
        const diff = Math.abs(o.frame_idx - currentFrame);
        if (diff < minDiff) {
          minDiff = diff;
          currentObs = o;
        }
      }
    }
    if (!currentObs) currentObs = obsList[0];
  }

  const clsName = (detail?.class || "object").toUpperCase();
  const trackId = detail?.track_id || objectId;
  const frameNum = currentObs?.frame_idx ?? currentFrame ?? 0;
  const timeSec = currentObs?.time_s != null ? currentObs.time_s.toFixed(1) : "0.0";
  const confidencePct = currentObs?.confidence != null
    ? Math.round(currentObs.confidence * (currentObs.confidence <= 1 ? 100 : 1))
    : detail?.confidence != null
      ? Math.round(detail.confidence * (detail.confidence <= 1 ? 100 : 1))
      : 0;

  const motionState = (detail?.motion_state || "STATIC").toUpperCase();
  const pos3d = detail?.position_3d;
  const posText = pos3d && Array.isArray(pos3d) && pos3d.length >= 3
    ? `[${pos3d[0].toFixed(2)}, ${pos3d[1].toFixed(2)}, ${pos3d[2].toFixed(2)}] m`
    : "Unreferenced local frame";

  return (
    <div
      className="interactive-object-card"
      style={{
        position: "absolute",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(56, 189, 248, 0.4)",
        borderRadius: "10px",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6)",
        color: "#f8fafc",
        padding: "14px 18px",
        width: "min(92vw, 480px)",
        zIndex: 50,
        fontSize: "0.85rem",
        animation: "fadeInUp 0.2s ease-out",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#38bdf8", letterSpacing: "0.02em" }}>
            This is a {clsName} ({trackId}) in frame {frameNum} at {timeSec} s
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "4px", color: "#94a3b8", fontSize: "0.78rem" }}>
            <span>
              Confidence: <strong style={{ color: "#f8fafc" }}>{confidencePct}%</strong>
            </span>
            <span>·</span>
            <span>
              Motion:{" "}
              <strong style={{ color: motionState === "MOVING" ? "#f97316" : "#22d3ee" }}>
                {motionState}
              </strong>
            </span>
            <span>·</span>
            <span title="3D Coordinate">
              3D: <strong style={{ color: "#f8fafc" }}>{posText}</strong>
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "1.1rem",
            padding: "2px 6px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {loading && <div style={{ color: "#64748b", fontSize: "0.75rem", margin: "6px 0" }}>Loading observations…</div>}
      {error && <div style={{ color: "#f87171", fontSize: "0.75rem", margin: "6px 0" }}>{error}</div>}

      {/* Observation Thumbnails Strip */}
      {obsList.length > 0 && (
        <div style={{ margin: "10px 0 6px 0" }}>
          <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Observations Strip ({obsList.length} hits · click to seek)
          </div>
          <div
            style={{
              display: "flex",
              gap: "6px",
              overflowX: "auto",
              paddingBottom: "4px",
              scrollbarWidth: "thin",
            }}
          >
            {obsList.map((obs) => {
              const isSelected = obs.frame_idx === frameNum;
              return (
                <button
                  key={`thumb-f${obs.frame_idx}`}
                  onClick={() => onSeekFrame?.(obs.frame_idx)}
                  title={`Seek to frame ${obs.frame_idx} (${obs.time_s}s, ${Math.round(obs.confidence * 100)}%)`}
                  style={{
                    background: isSelected ? "rgba(56, 189, 248, 0.25)" : "rgba(30, 41, 59, 0.7)",
                    border: isSelected ? "1.5px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "4px",
                    padding: "3px",
                    cursor: "pointer",
                    flexShrink: 0,
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: "56px",
                  }}
                >
                  <img
                    src={resolveAssetUrl(obs.thumb_url)}
                    alt={`Frame ${obs.frame_idx}`}
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                    style={{
                      width: "48px",
                      height: "32px",
                      objectFit: "cover",
                      borderRadius: "2px",
                      background: "#0f172a",
                    }}
                  />
                  <span style={{ fontSize: "0.68rem", color: isSelected ? "#38bdf8" : "#94a3b8", marginTop: "2px" }}>
                    f{obs.frame_idx}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
        {viewContext === "video" && onShowIn3D && (
          <button
            onClick={() => onShowIn3D(detail || { object_id: objectId, track_id: trackId, position_3d: pos3d })}
            style={{
              background: "#0284c7",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              padding: "5px 12px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Show in 3D
          </button>
        )}
        {viewContext === "3d" && onShowInVideo && (
          <button
            onClick={() => onShowInVideo(frameNum, detail)}
            style={{
              background: "#0284c7",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              padding: "5px 12px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Show in video frame
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            color: "#94a3b8",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "4px",
            padding: "5px 12px",
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
