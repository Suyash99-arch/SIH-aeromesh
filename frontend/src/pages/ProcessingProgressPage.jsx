import { useEffect, useState } from "react";
import { getMission } from "../../api/missions";
import "./ProcessingProgress.css";

/**
 * Live processing dashboard
 * Shows real-time updates during mission processing
 */
export default function ProcessingProgressPage({ mission, navigate }) {
  const [processing, setProcessing] = useState(mission?.processing);
  const [detections, setDetections] = useState(mission?.detections);
  const [frameQuality, setFrameQuality] = useState(mission?.frameQuality);
  const [reconstruction, setReconstruction] = useState(mission?.reconstruction);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const missionStatus = mission?.status;

  // Poll for updates every 2 seconds if still processing
  useEffect(() => {
    if (!autoRefresh || missionStatus !== "processing") return;

    const interval = setInterval(async () => {
      const updated = await getMission(mission.id);
      if (updated) {
        setProcessing(updated.processing);
        setDetections(updated.detections);
        setFrameQuality(updated.frameQuality);
        setReconstruction(updated.reconstruction);

        // Stop refreshing when complete
        if (updated.status !== "processing") {
          setAutoRefresh(false);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [mission?.id, missionStatus, autoRefresh]);

  const isComplete = missionStatus === "processing_complete";
  const isProcessing = missionStatus === "processing";

  return (
    <div className="processing-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">MISSION PROCESSING</span>
          <h1>{mission.name}</h1>
          <p>Single-Pass 3D Reconstruction Pipeline</p>
        </div>
        <div className="status-badge" data-status={mission.status}>
          {missionStatus === "processing" && <span className="spinner" />}
          {missionStatus?.toUpperCase()}
        </div>
      </div>

      <div className="processing-grid">
        {/* Video Info */}
        <section className="section">
          <h3>Input Video</h3>
          {mission.video ? (
            <div className="info-grid">
              <div className="info-item">
                <label>Filename</label>
                <value>{mission.video.filename}</value>
              </div>
              <div className="info-item">
                <label>Duration</label>
                <value>{mission.video.duration_seconds}s</value>
              </div>
              <div className="info-item">
                <label>Frames</label>
                <value>{mission.video.total_frames}</value>
              </div>
              <div className="info-item">
                <label>FPS</label>
                <value>{mission.video.fps}</value>
              </div>
              <div className="info-item">
                <label>Resolution</label>
                <value>
                  {mission.video.resolution.width}×
                  {mission.video.resolution.height}
                </value>
              </div>
              <div className="info-item">
                <label>File Size</label>
                <value>{mission.video.size_mb} MB</value>
              </div>
            </div>
          ) : (
            <p className="empty">No video uploaded</p>
          )}
        </section>

        {/* Processing Progress */}
        {processing && (
          <section className="section">
            <h3>Processing Status</h3>
            <div className="info-grid">
              <div className="info-item">
                <label>Status</label>
                <value>{processing.status}</value>
              </div>
              <div className="info-item">
                <label>Frames Analyzed</label>
                <value>{processing.framesAnalyzed}</value>
              </div>
              <div className="info-item">
                <label>Inference Speed</label>
                <value>{processing.inferenceFps} fps</value>
              </div>
              <div className="info-item">
                <label>Sample Rate</label>
                <value>{processing.sampleFps} fps</value>
              </div>
            </div>
          </section>
        )}

        {/* Frame Quality */}
        {frameQuality && (
          <section className="section">
            <h3>Frame Quality Analysis</h3>
            {frameQuality.average && (
              <div className="quality-metrics">
                <div className="metric">
                  <label>Sharpness</label>
                  <div className="quality-bar">
                    <div
                      className="quality-fill"
                      style={{
                        width: `${Math.min(frameQuality.average.sharpness, 100)}%`,
                      }}
                    />
                    <span className="quality-value">
                      {frameQuality.average.sharpness.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="metric">
                  <label>Brightness</label>
                  <div className="quality-bar">
                    <div
                      className="quality-fill"
                      style={{
                        width: `${Math.min(frameQuality.average.brightness, 100)}%`,
                      }}
                    />
                    <span className="quality-value">
                      {frameQuality.average.brightness.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="metric">
                  <label>Contrast</label>
                  <div className="quality-bar">
                    <div
                      className="quality-fill"
                      style={{
                        width: `${Math.min(frameQuality.average.contrast, 100)}%`,
                      }}
                    />
                    <span className="quality-value">
                      {frameQuality.average.contrast.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Object Detection */}
        {detections && (
          <section className="section">
            <h3>Object Detection Results</h3>
            <div className="detections-summary">
              <div className="detection-stat">
                <span className="label">Unique Tracks</span>
                <span className="value">{detections.uniqueTracks}</span>
              </div>
              {Object.entries(detections.byGroup || {}).map(
                ([group, count]) => (
                  <div key={group} className="detection-stat">
                    <span className="label capitalize">{group}</span>
                    <span className="value">{count}</span>
                  </div>
                ),
              )}
            </div>
            {detections.observations && (
              <div className="observations-count">
                Total observations: {detections.observations.length}
              </div>
            )}
          </section>
        )}

        {/* 3D Reconstruction */}
        {reconstruction && (
          <section className="section">
            <h3>3D Reconstruction</h3>
            <div className="info-grid">
              <div className="info-item">
                <label>Point Cloud</label>
                <value>{reconstruction.pointCloud?.points_count} points</value>
              </div>
              <div className="info-item">
                <label>Overall Confidence</label>
                <value>{reconstruction.confidence}%</value>
              </div>
              <div className="info-item">
                <label>Uncertainty</label>
                <value>
                  ±{(reconstruction.uncertainty?.overall * 100).toFixed(1)}%
                </value>
              </div>
            </div>

            <div className="coverage-breakdown">
              <h4>Surface Coverage</h4>
              <div className="coverage-bars">
                <div className="coverage-bar observed">
                  <span>{reconstruction.observedSurface}%</span>
                  OBSERVED
                </div>
                <div className="coverage-bar partial">
                  <span>{reconstruction.partialSurface}%</span>
                  PARTIAL
                </div>
                <div className="coverage-bar occluded">
                  <span>{reconstruction.occludedSurface}%</span>
                  OCCLUDED
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Actions */}
      <div className="processing-actions">
        {isProcessing && (
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
        )}

        {isComplete && (
          <div className="action-buttons">
            <button className="btn secondary" onClick={() => navigate("drone")}>
              View Video
            </button>
            <button
              className="btn secondary"
              onClick={() => navigate("reconstruction")}
            >
              View 3D Model
            </button>
            <button
              className="btn secondary"
              onClick={() => navigate("analytics")}
            >
              View Intelligence
            </button>
            <button className="btn primary" onClick={() => navigate("reports")}>
              Generate Report
            </button>
          </div>
        )}
      </div>

      {/* Detailed Status */}
      <section className="section detailed-log">
        <h3>Processing Log</h3>
        <div className="log-content">
          <div className="log-entry success">
            ✓ Video uploaded: {mission.video?.filename}
          </div>
          <div className="log-entry success">
            ✓ Metadata extracted: {mission.video?.duration_seconds}s,{" "}
            {mission.video?.total_frames} frames
          </div>
          {processing && (
            <>
              <div className="log-entry success">
                ✓ Frame extraction: {processing.framesAnalyzed} frames analyzed
              </div>
              <div className="log-entry success">
                ✓ Object detection: {detections?.uniqueTracks} unique objects
                tracked
              </div>
            </>
          )}
          {isProcessing && (
            <div className="log-entry processing">
              ⏳ 3D reconstruction in progress...
            </div>
          )}
          {isComplete && (
            <div className="log-entry success">
              ✓ Reconstruction complete:{" "}
              {reconstruction?.pointCloud?.points_count} points
            </div>
          )}
          {isComplete && (
            <div className="log-entry success">
              ✓ Ready for analysis and reporting
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
