import React from "react";
import Icon from "../ui/Icon";

/**
 * Video Frames Tab Component
 * Matches Reference Screenshot 2:
 * - Source video player
 * - Frame Gallery with thumbnail grid of real extracted keyframes from pipeline
 * - Frame Details panel with per-frame detection breakdown by class
 */
export default function VideoFramesTab({
  missionId,
  mission,
  keyframes = [],
  selectedKeyframe,
  onSelectKeyframe,
  onSwitchTo3D,
}) {
  const videoSrc = `/api/missions/${missionId}/video`;

  return (
    <div className="video-frames-workspace" id="video-frames-workspace">
      {/* Left / Main Section: Video Player + Frame Gallery */}
      <div className="video-frames-main">
        {/* Source Video Player */}
        <section className="video-player-card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Icon name="Film" size={14} className="card-header-icon" />
              <h3>Source Drone Flight Video</h3>
            </div>
            <span className="video-codec-pill">H.264 / MP4 · Local Playback</span>
          </div>

          <div className="video-player-viewport">
            <video
              controls
              src={videoSrc}
              poster={keyframes[0]?.url}
              className="source-video-element"
            >
              Your browser does not support HTML5 video playback.
            </video>
          </div>
        </section>

        {/* Keyframe Gallery */}
        <section className="frame-gallery-card">
          <div className="card-header between">
            <div className="flex items-center gap-2">
              <Icon name="Grid" size={14} className="card-header-icon" />
              <h3>Keyframe Extraction Gallery</h3>
            </div>
            <span className="gallery-count-pill">{keyframes.length} Keyframes Extracted</span>
          </div>

          <div className="frame-gallery-grid">
            {keyframes.length === 0 ? (
              <div className="gallery-empty">
                <Icon name="Clock" size={24} className="mb-2 opacity-50" />
                <span>No keyframes extracted yet. Run the pipeline to populate keyframes.</span>
              </div>
            ) : (
              keyframes.map((kf, idx) => {
                const isSelected = selectedKeyframe?.frame_id === kf.frame_id;
                const totalDets = kf.detections_count || (kf.detections ? kf.detections.length : 0);

                return (
                  <div
                    key={kf.frame_id || idx}
                    className={`gallery-thumb-card ${isSelected ? "selected" : ""}`}
                    onClick={() => onSelectKeyframe?.(kf)}
                  >
                    <div className="thumb-image-wrap">
                      <img
                        src={kf.url}
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
                        {typeof kf.timestamp === "number" ? `${kf.timestamp.toFixed(1)}s` : `00:${String(idx * 2).padStart(2, '0')}`}
                      </span>
                    </div>
                  </div>
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
          <h3>Frame Details & Inspection</h3>
        </div>

        {selectedKeyframe ? (
          <div className="frame-details-content">
            {/* Selected Frame Preview with Overlays */}
            <div className="selected-frame-preview">
              <img
                src={selectedKeyframe.url}
                alt={selectedKeyframe.frame_id}
                onError={(e) => {
                  e.currentTarget.src =
                    "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180' viewBox='0 0 320 180'%3E%3Crect width='320' height='180' fill='%230b1326'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-family='sans-serif' font-size='12'%3E" +
                    selectedKeyframe.frame_id +
                    "%3C/text%3E%3C/svg%3E";
                }}
              />
              <div className="preview-overlay-info">
                <span>{selectedKeyframe.filename || selectedKeyframe.frame_id}</span>
                <span>Frame #{selectedKeyframe.frame_index !== undefined ? selectedKeyframe.frame_index + 1 : 1}</span>
              </div>
            </div>

            {/* Diagnostics Stats */}
            <div className="frame-meta-grid">
              <div className="meta-cell">
                <span className="meta-cell-label">Timestamp</span>
                <span className="meta-cell-val">
                  {typeof selectedKeyframe.timestamp === "number"
                    ? `${selectedKeyframe.timestamp.toFixed(2)}s`
                    : "0.00s"}
                </span>
              </div>
              <div className="meta-cell">
                <span className="meta-cell-label">Total Detections</span>
                <span className="meta-cell-val cyan">
                  {selectedKeyframe.detections_count ||
                    (selectedKeyframe.detections ? selectedKeyframe.detections.length : 0)}
                </span>
              </div>
            </div>

            {/* Detections Breakdown by Class */}
            <div className="detections-by-class-section">
              <h4>Class Breakdown</h4>
              <div className="class-breakdown-pills">
                {selectedKeyframe.counts_by_class &&
                Object.keys(selectedKeyframe.counts_by_class).length > 0 ? (
                  Object.entries(selectedKeyframe.counts_by_class).map(([cls, count]) => (
                    <div key={cls} className="class-pill">
                      <span className="class-name">{cls}</span>
                      <span className="class-count">{count}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted">No objects detected in this frame.</div>
                )}
              </div>
            </div>

            {/* Individual Bounding Box Detections */}
            <div className="frame-detections-list">
              <h4>Bounding Box Detections</h4>
              {selectedKeyframe.detections && selectedKeyframe.detections.length > 0 ? (
                <div className="detections-scroll">
                  {selectedKeyframe.detections.map((det, dIdx) => (
                    <div key={dIdx} className="detection-row">
                      <div className="det-row-left">
                        <span className="det-class">{det.class_name || det.class || "object"}</span>
                        <span className="det-conf">
                          {typeof det.confidence === "number"
                            ? `${(det.confidence * 100).toFixed(1)}%`
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
                <div className="text-xs text-muted">No bounding boxes registered for this frame.</div>
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
                Inspect in 3D Model View
              </button>
            </div>
          </div>
        ) : (
          <div className="frame-details-empty">
            <Icon name="MousePointer" size={20} className="opacity-40 mb-2" />
            <span>Select a keyframe from the gallery above to inspect detections and bounding boxes.</span>
          </div>
        )}
      </aside>
    </div>
  );
}
