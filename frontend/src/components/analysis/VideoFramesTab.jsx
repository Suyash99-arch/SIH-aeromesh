import React, { useEffect, useRef, useState } from "react";
import Icon from "../ui/Icon";
import { resolveAssetUrl } from "../../api/missions";
import { useUI } from "../../context/UIContext";

function parseVideoResolution(resolution) {
  if (typeof resolution === "string") {
    const match = resolution.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  if (Array.isArray(resolution) && resolution.length >= 2) {
    return [Number(resolution[0]), Number(resolution[1])];
  }
  if (resolution && typeof resolution === "object") {
    const width = Number(resolution.width ?? resolution.w);
    const height = Number(resolution.height ?? resolution.h);
    if (width > 0 && height > 0) return [width, height];
  }
  return [];
}

function validDimension(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}


function getBoundingBoxStyle(bbox, frameWidth = 1920, frameHeight = 1080) {
  if (!bbox || !Array.isArray(bbox) || bbox.length < 4) return null;
  const [b0, b1, b2, b3] = bbox.slice(0, 4).map(Number);
  if (![b0, b1, b2, b3].every(Number.isFinite)) return null;
  // If normalized 0..1
  if (b0 <= 1 && b1 <= 1 && b2 <= 1 && b3 <= 1) {
    return {
      left: `${b0 * 100}%`,
      top: `${b1 * 100}%`,
      width: `${b2 * 100}%`,
      height: `${b3 * 100}%`,
    };
  }
  // Pixel coordinates in original image resolution
  const frameW = frameWidth || 1920;
  const frameH = frameHeight || 1080;
  const isMinMax = b2 > b0 && b3 > b1;
  if (isMinMax) {
    return {
      left: `${(b0 / frameW) * 100}%`,
      top: `${(b1 / frameH) * 100}%`,
      width: `${((b2 - b0) / frameW) * 100}%`,
      height: `${((b3 - b1) / frameH) * 100}%`,
    };
  }
  return {
    left: `${(b0 / frameW) * 100}%`,
    top: `${(b1 / frameH) * 100}%`,
    width: `${(b2 / frameW) * 100}%`,
    height: `${(b3 / frameH) * 100}%`,
  };
}

function getDetColor(cls) {
  const c = String(cls || "").toLowerCase();
  if (c.includes("car") || c.includes("vehicle")) return "#38bdf8";
  if (c.includes("van") || c.includes("bus") || c.includes("truck")) return "#a855f7";
  if (c.includes("person") || c.includes("pedestrian") || c.includes("human")) return "#10b981";
  return "#fbbf24";
}

/**
 * Video Frames Tab Component
 * Fine-tuned video playback & frame inspection:
 * - Source video player with speed control and keyframe sync
 * - Frame Gallery with thumbnail grid of real extracted keyframes
 * - High-precision 2D detection bounding box overlays on keyframe preview
 * - Frame Details panel with detection telemetry
 */
export default function VideoFramesTab({
  missionId,
  mission,
  keyframes = [],
  selectedKeyframe,
  onSelectKeyframe,
  onSwitchTo3D,
}) {
  const { t } = useUI();
  const videoSrc = resolveAssetUrl(
    mission?.assets?.video_proxy || mission?.video?.proxy_url ||
    (missionId ? `/api/v1/missions/${missionId}/video/proxy` : "")
  );
  const directVideoSrc = resolveAssetUrl(
    mission?.assets?.video || mission?.video?.original_url || mission?.video?.url ||
    (missionId ? `/api/v1/missions/${missionId}/video` : "")
  );

  const videoRef = useRef(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [filterClass, setFilterClass] = useState("all");
  const [minConfidence, setMinConfidence] = useState(0.25);
  const [videoSourceIndex, setVideoSourceIndex] = useState(0);
  const [videoUnavailable, setVideoUnavailable] = useState(false);

  const safeKeyframes = Array.isArray(keyframes)
    ? keyframes.filter((frame) => frame && typeof frame === "object")
    : [];
  const parsedRes = parseVideoResolution(mission?.video?.resolution);
  const resolvedW = validDimension(selectedKeyframe?.width, parsedRes[0]) || validDimension(mission?.video?.width, 1920);
  const resolvedH = validDimension(selectedKeyframe?.height, parsedRes[1]) || validDimension(mission?.video?.height, 1080);
  const videoSources = [...new Set([videoSrc, directVideoSrc].filter(Boolean))];
  const activeVideoSrc = videoSources[Math.min(videoSourceIndex, Math.max(0, videoSources.length - 1))] || "";

  useEffect(() => {
    setVideoSourceIndex(0);
    setVideoUnavailable(false);
  }, [missionId, videoSrc, directVideoSrc]);

  const filteredKeyframes = safeKeyframes.filter((kf) => {
    if (filterClass === "all") return true;
    if (filterClass === "with_detections") {
      return (Number(kf.detections_count) || (Array.isArray(kf.detections) ? kf.detections.length : 0)) > 0;
    }
    if (kf.counts_by_class && typeof kf.counts_by_class === "object" && Number(kf.counts_by_class[filterClass]) > 0) return true;
    return false;
  });

  const selectedDetections = Array.isArray(selectedKeyframe?.detections)
    ? selectedKeyframe.detections.filter((detection) => detection && typeof detection === "object")
    : [];
  const selectedCounts = selectedKeyframe?.counts_by_class && typeof selectedKeyframe.counts_by_class === "object" && !Array.isArray(selectedKeyframe.counts_by_class)
    ? selectedKeyframe.counts_by_class
    : {};
  const frameClasses = [...new Set(safeKeyframes.flatMap((frame) => {
    const counts = frame.counts_by_class && typeof frame.counts_by_class === "object" && !Array.isArray(frame.counts_by_class)
      ? Object.keys(frame.counts_by_class)
      : [];
    const detections = Array.isArray(frame.detections)
      ? frame.detections.map((detection) => detection?.class_name || detection?.class).filter(Boolean).map(String)
      : [];
    return [...counts, ...detections];
  }))].sort((a, b) => a.localeCompare(b));

  return (
    <div className="video-frames-workspace" id="video-frames-workspace">
      {/* Left / Main Section: Video Player + Frame Gallery */}
      <div className="video-frames-main">
        {/* Source Video Player */}
        <section className="video-player-card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Icon name="Film" size={14} className="card-header-icon" />
              <h3>{t("videoFrames.title")}</h3>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span className="video-codec-pill">H.264 / MP4 · Local Playback</span>
              <div
                style={{
                  display: "flex",
                  gap: "3px",
                  background: "rgba(15, 23, 42, 0.7)",
                  padding: "2px 4px",
                  borderRadius: "5px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                }}
              >
                {[0.5, 1.0, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.playbackRate = rate;
                        setPlaybackSpeed(rate);
                      }
                    }}
                    style={{
                      border: "none",
                      background: playbackSpeed === rate ? "#38bdf8" : "transparent",
                      color: playbackSpeed === rate ? "#061017" : "#94a3b8",
                      fontSize: "10px",
                      fontWeight: 700,
                      borderRadius: "3px",
                      padding: "2px 5px",
                      cursor: "pointer",
                    }}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="video-player-viewport">
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              src={activeVideoSrc}
              poster={resolveAssetUrl(safeKeyframes[0]?.url || "")}
              className="source-video-element"
              onLoadedMetadata={() => setVideoUnavailable(false)}
              onError={() => {
                if (videoSourceIndex + 1 < videoSources.length) {
                  setVideoSourceIndex((index) => index + 1);
                } else {
                  setVideoUnavailable(true);
                }
              }}
            >
              Your browser does not support HTML5 video playback.
            </video>
            {videoUnavailable && (
              <div className="video-source-alert" role="status">
                <strong>Video source unavailable</strong>
                <span>Upload or re-upload a video for this mission, then refresh this view.</span>
              </div>
            )}
          </div>

          {/* Stepper & Sync Controls */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "8px",
              padding: "4px 8px",
              background: "rgba(10, 16, 26, 0.6)",
              borderRadius: "6px",
            }}
          >
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                style={{
                  padding: "4px 9px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "5px",
                  background: "rgba(15, 23, 42, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#e2e8f0",
                  cursor: "pointer",
                }}
                onClick={() => {
                  if (safeKeyframes.length === 0) return;
                  const currIdx = safeKeyframes.findIndex(
                    (k) => k.frame_id === selectedKeyframe?.frame_id,
                  );
                  const prevIdx = currIdx > 0 ? currIdx - 1 : safeKeyframes.length - 1;
                  onSelectKeyframe?.(safeKeyframes[prevIdx]);
                  if (videoRef.current && typeof safeKeyframes[prevIdx].timestamp === "number") {
                    videoRef.current.currentTime = safeKeyframes[prevIdx].timestamp;
                  }
                }}
              >
                ◀ Prev Frame
              </button>
              <button
                type="button"
                style={{
                  padding: "4px 9px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "5px",
                  background: "rgba(15, 23, 42, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#e2e8f0",
                  cursor: "pointer",
                }}
                onClick={() => {
                  if (safeKeyframes.length === 0) return;
                  const currIdx = safeKeyframes.findIndex(
                    (k) => k.frame_id === selectedKeyframe?.frame_id,
                  );
                  const nextIdx = currIdx < safeKeyframes.length - 1 ? currIdx + 1 : 0;
                  onSelectKeyframe?.(safeKeyframes[nextIdx]);
                  if (videoRef.current && typeof safeKeyframes[nextIdx].timestamp === "number") {
                    videoRef.current.currentTime = safeKeyframes[nextIdx].timestamp;
                  }
                }}
              >
                Next Frame ▶
              </button>
            </div>
            {selectedKeyframe && typeof selectedKeyframe.timestamp === "number" && (
              <button
                type="button"
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "5px",
                  background: "rgba(56, 189, 248, 0.15)",
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  color: "#38bdf8",
                  cursor: "pointer",
                }}
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = selectedKeyframe.timestamp;
                    videoRef.current.play?.();
                  }
                }}
              >
                ▶ Jump Video to Frame ({selectedKeyframe.timestamp.toFixed(1)}s)
              </button>
            )}
          </div>
        </section>

        {/* Keyframe Gallery */}
        <section className="frame-gallery-card">
          <div className="card-header between">
            <div className="flex items-center gap-2">
              <Icon name="Grid" size={14} className="card-header-icon" />
              <h3>{t("videoFrames.title")}</h3>
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <label className="frame-filter-label">
                <span className="sr-only">Filter frames</span>
                <select
                  className="frame-filter-select"
                  value={filterClass}
                  onChange={(event) => setFilterClass(event.target.value)}
                >
                  <option value="all">All frames</option>
                  <option value="with_detections">With detections</option>
                  {frameClasses.map((frameClass) => (
                    <option value={frameClass} key={frameClass}>{frameClass}</option>
                  ))}
                </select>
              </label>
              <span className="gallery-count-pill">
                {filteredKeyframes.length} / {safeKeyframes.length} Frames
              </span>
            </div>
          </div>

          <div className="frame-gallery-grid">
            {filteredKeyframes.length === 0 ? (
              <div className="gallery-empty">
                <Icon name="Clock" size={24} className="mb-2 opacity-50" />
                <span>{t("videoFrames.noDetectionsOnFrame")}</span>
              </div>
            ) : (
              filteredKeyframes.map((kf, idx) => {
                const isSelected = selectedKeyframe?.frame_id === kf.frame_id;
                const totalDets = Number(kf.detections_count) || (Array.isArray(kf.detections) ? kf.detections.length : 0);

                return (
                  <button
                    key={kf.frame_id || idx}
                    type="button"
                    className={`gallery-thumb-card ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      onSelectKeyframe?.(kf);
                      if (videoRef.current && typeof kf.timestamp === "number") {
                        videoRef.current.currentTime = kf.timestamp;
                      }
                    }}
                  >
                    <div className="thumb-image-wrap">
                      <img
                        src={resolveAssetUrl(kf.url || "")}
                        alt={`Frame ${idx + 1}`}
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.src =
                            "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90' viewBox='0 0 160 90'%3E%3Crect width='160' height='90' fill='%230b1326'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-family='sans-serif' font-size='11'%3EFrame %23" +
                            (idx + 1) +
                            "%3C/text%3E%3C/svg%3E";
                        }}
                      />
                      <span className="thumb-idx-badge">#{idx + 1}</span>
                      {totalDets > 0 && (
                        <span className="thumb-det-badge">{totalDets} Detections</span>
                      )}
                    </div>
                    <div className="thumb-footer">
                      <span className="thumb-id">{kf.filename || kf.frame_id}</span>
                      <span className="thumb-time">
                        {typeof kf.timestamp === "number"
                          ? `${kf.timestamp.toFixed(1)}s`
                          : `00:${String(idx * 2).padStart(2, "0")}`}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Right Rail: Frame Details Panel */}
      <aside className="frame-details-panel">
        <div className="panel-header">
          <Icon name="Search" size={14} className="panel-icon" />
          <h3>{t("videoFrames.inspectFrame")}</h3>
        </div>

        {selectedKeyframe ? (
          <div className="frame-details-content">
            {/* Selected Frame Preview with Real Bounding Box Overlays */}
            <div
              className="selected-frame-preview"
              style={{
                position: "relative",
                overflow: "hidden",
                borderRadius: "8px",
                background: "#080e18",
              }}
            >
              <img
                src={resolveAssetUrl(selectedKeyframe.url || "")}
                alt={selectedKeyframe.frame_id}
                style={{ width: "100%", height: "auto", display: "block" }}
                onError={(e) => {
                  e.currentTarget.src =
                    "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180' viewBox='0 0 320 180'%3E%3Crect width='320' height='180' fill='%230b1326'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-family='sans-serif' font-size='12'%3E" +
                    selectedKeyframe.frame_id +
                    "%3C/text%3E%3C/svg%3E";
                }}
              />

              {/* Real 2D Bounding Box Visual Overlays */}
              {selectedDetections
                  .filter((det) => {
                    const conf = det.confidence != null ? (det.confidence > 1 ? det.confidence / 100 : det.confidence) : 1.0;
                    if (conf < minConfidence) return false;
                    if (filterClass !== "all" && filterClass !== "with_detections") {
                      const cls = String(det.class_name || det.class || "").toLowerCase();
                      if (!cls.includes(filterClass.toLowerCase())) return false;
                    }
                    return true;
                  })
                  .map((det, i) => {
                    const style = getBoundingBoxStyle(det.bbox, resolvedW, resolvedH);
                    if (!style) return null;
                    const color = getDetColor(det.class_name || det.class);
                    return (
                      <div
                        key={i}
                        style={{
                          position: "absolute",
                          ...style,
                          border: `2px solid ${color}`,
                          backgroundColor: `${color}18`,
                          borderRadius: "3px",
                          pointerEvents: "none",
                          boxShadow: `0 0 8px ${color}60`,
                          boxSizing: "border-box",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: "-17px",
                            left: "-2px",
                            background: color,
                            color: "#061017",
                            fontSize: "9px",
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: "3px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {det.class_name || det.class || "object"}{" "}
                          {det.confidence
                            ? `${Math.round(det.confidence > 1 ? det.confidence : det.confidence * 100)}%`
                            : ""}
                        </span>
                      </div>
                    );
                  })}

              <div className="preview-overlay-info">
                <span>{selectedKeyframe.filename || selectedKeyframe.frame_id}</span>
                <span>
                  Frame #
                  {selectedKeyframe.frame_index !== undefined
                    ? selectedKeyframe.frame_index + 1
                    : 1}
                </span>
              </div>
            </div>

            {/* Diagnostics Stats */}
            <div className="frame-meta-grid">
              <div className="meta-cell">
                <span className="meta-cell-label">{t("videoFrames.timestamp")}</span>
                <span className="meta-cell-val">
                  {typeof selectedKeyframe.timestamp === "number"
                    ? `${selectedKeyframe.timestamp.toFixed(2)}s`
                    : "0.00s"}
                </span>
              </div>
              <div className="meta-cell">
                <span className="meta-cell-label">{t("missionCommand.totalDetections")}</span>
                <span className="meta-cell-val cyan">
                  {Number(selectedKeyframe.detections_count) || selectedDetections.length}
                </span>
              </div>
            </div>

            {/* Confidence Slider Control */}
            <div style={{ margin: "10px 0", padding: "8px 12px", background: "rgba(15, 23, 42, 0.7)", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px", color: "#94a3b8" }}>
                <span>{t("videoFrames.minConfidence")}:</span>
                <b style={{ color: "#38bdf8" }}>≥ {Math.round(minConfidence * 100)}%</b>
              </div>
              <input
                type="range"
                min="5"
                max="95"
                step="5"
                value={Math.round(minConfidence * 100)}
                onChange={(e) => setMinConfidence(Number(e.target.value) / 100)}
                style={{ width: "100%", accentColor: "#38bdf8", cursor: "pointer" }}
              />
            </div>

            {/* Detections Breakdown by Class */}
            <div className="detections-by-class-section">
              <h4>{t("missionCommand.byClass")}</h4>
              <div className="class-breakdown-pills">
                {Object.keys(selectedCounts).length > 0 ? (
                  Object.entries(selectedCounts).map(
                    ([cls, count]) => (
                      <div key={cls} className="class-pill">
                        <span className="class-name">{cls}</span>
                        <span className="class-count">{count}</span>
                      </div>
                    ),
                  )
                ) : (
                  <div className="text-xs text-muted">{t("videoFrames.noDetectionsOnFrame")}</div>
                )}
              </div>
            </div>

            {/* Individual Bounding Box Detections */}
            <div className="frame-detections-list">
              <h4>{t("videoFrames.title")}</h4>
              {selectedDetections.length > 0 ? (
                <div className="detections-scroll">
                  {selectedDetections.map((det, dIdx) => (
                    <div key={dIdx} className="detection-row">
                      <div className="det-row-left">
                        <span
                          className="det-class"
                          style={{ color: getDetColor(det.class_name || det.class) }}
                        >
                          {det.class_name || det.class || "object"}
                        </span>
                        <span className="det-conf">
                          {typeof det.confidence === "number"
                            ? `${(det.confidence > 1 ? det.confidence : det.confidence * 100).toFixed(1)}%`
                            : "Verified"}
                        </span>
                      </div>
                      {det.bbox && (
                        <span className="det-bbox">
                          [{det.bbox.map((v) => Math.round(v)).join(", ")}]
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted">
                  {t("videoFrames.noDetectionsOnFrame")}
                </div>
              )}
            </div>

            {/* Action to Focus in 3D */}
            <div className="frame-actions">
              <button
                type="button"
                className="switch-to-3d-btn"
                onClick={onSwitchTo3D}
              >
                <Icon name="Box" size={14} />
                {t("missionCommand.openViewer")}
              </button>
            </div>
          </div>
        ) : (
          <div className="frame-details-empty">
            <Icon name="MousePointer" size={20} className="opacity-40 mb-2" />
            <span>{t("videoFrames.inspectFrame")}</span>
          </div>
        )}
      </aside>
    </div>
  );
}
