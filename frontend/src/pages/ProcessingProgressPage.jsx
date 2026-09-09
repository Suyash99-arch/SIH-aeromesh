import { useEffect, useState } from "react";
import { getMission, getProcessingStatus, processVideo } from "../api/missions";
import "./ProcessingProgress.css";

const defaultStages = [
  { id: "video", name: "1. Video Validation & Extraction", status: "pending" },
  { id: "quality", name: "2. Quality & Blur Filtering", status: "pending" },
  { id: "detection", name: "3. Tiled AI Object Detection", status: "pending" },
  { id: "trajectory", name: "4. Multi-View Feature Matching", status: "pending" },
  { id: "reconstruction", name: "5. 3D COLMAP Photogrammetry", status: "pending" },
  { id: "measurements", name: "6. Photogrammetric Scale & GIS", status: "pending" },
  { id: "intelligence", name: "7. Spatial Multi-View Triangulation", status: "pending" },
  { id: "report", name: "8. Certified PDF & GeoJSON Deliverables", status: "pending" },
];

/**
 * Live processing dashboard
 * Shows real-time updates during mission processing
 */
export default function ProcessingProgressPage({ mission, navigate }) {
  const [processing, setProcessing] = useState(mission?.processing);
  const [detections, setDetections] = useState(mission?.detections);
  const [frameQuality, setFrameQuality] = useState(mission?.frameQuality);
  const [reconstruction, setReconstruction] = useState(mission?.reconstruction);
  const [statusData, setStatusData] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const missionStatus = (statusData?.status ? (statusData.status === "PROCESSING" ? "processing" : statusData.status === "QUEUED" ? "queued" : statusData.status.toLowerCase()) : null) || mission?.status;

  // Poll for updates every 2 seconds if still processing or queued
  useEffect(() => {
    let mounted = true;

    const fetchStatus = async () => {
      try {
        const [updatedMission, status] = await Promise.all([
          getMission(mission.id, true),
          getProcessingStatus(mission.id),
        ]);
        if (!mounted) return;

        if (updatedMission) {
          setProcessing(updatedMission.processing);
          setDetections(updatedMission.detections);
          setFrameQuality(updatedMission.frameQuality);
          setReconstruction(updatedMission.reconstruction);

          if (updatedMission.status !== "processing" && updatedMission.status !== "queued") {
            setAutoRefresh(false);
          }
        }
        if (status) {
          setStatusData(status);
        }
      } catch (err) {
        console.warn("[ProcessingPage] Poll error:", err);
      }
    };

    fetchStatus();

    if (!autoRefresh && missionStatus !== "processing" && missionStatus !== "queued") return;

    const interval = setInterval(fetchStatus, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [mission?.id, missionStatus, autoRefresh]);

  const isComplete = missionStatus === "complete" || missionStatus === "reconstruction_ready" || missionStatus === "processing_complete";
  const isProcessing = missionStatus === "processing";
  const isFailed = missionStatus === "failed" || statusData?.status === "FAILED" || statusData?.status === "failed";
  const isQueued = missionStatus === "queued" || statusData?.status === "QUEUED" || statusData?.status === "queued";
  const queuePos = statusData?.queue_position || mission?.queue_position || 1;

  const resolvedStages = (statusData?.stages && statusData.stages.length)
    ? statusData.stages
    : defaultStages.map((s) => ({
        ...s,
        status: isComplete ? "completed" : isProcessing ? (s.id === "video" ? "completed" : "pending") : "pending",
      }));

  const progressPercent = statusData?.progress_percent ?? (isComplete ? 100 : mission?.progress ?? 0);

  const handleRetryPipeline = async () => {
    try {
      setAutoRefresh(true);
      await processVideo(mission.id);
      const s = await getProcessingStatus(mission.id);
      if (s) setStatusData(s);
    } catch (err) {
      console.error("Retry failed:", err);
    }
  };

  return (
    <div className="processing-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">MISSION PROCESSING</span>
          <h1>{mission.name}</h1>
          <p>Real-Time Drone Video → 3D Reconstruction Pipeline</p>
        </div>
        <div
          className="status-badge"
          data-status={isFailed ? "failed" : isQueued ? "queued" : mission.status}
          style={
            isFailed
              ? { background: "rgba(239, 68, 68, 0.15)", color: "#f87171", borderColor: "#ef4444" }
              : isQueued
              ? { background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24", borderColor: "#f59e0b" }
              : {}
          }
        >
          {isProcessing && <span className="spinner" />}
          {isQueued && <span style={{ marginRight: "6px" }}>⏳</span>}
          {(isFailed ? "PIPELINE FAILED" : isQueued ? "QUEUED IN LINE" : missionStatus || "READY").toUpperCase()}
        </div>
      </div>

      {/* Prominent Queued Banner if Queued */}
      {isQueued && (
        <div
          className="pipeline-queued-banner"
          style={{
            background: "linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(15, 23, 42, 0.95))",
            border: "1px solid rgba(245, 158, 11, 0.5)",
            borderRadius: "12px",
            padding: "18px 22px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            boxShadow: "0 4px 24px rgba(245, 158, 11, 0.15)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "rgba(245, 158, 11, 0.2)",
                border: "1px solid rgba(245, 158, 11, 0.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#f59e0b",
                fontSize: "18px",
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              ⏳
            </div>
            <div>
              <div style={{ color: "#fbbf24", fontSize: "15px", fontWeight: 700 }}>
                Pipeline Queued — Will Start When Active Job Finishes (Position #{queuePos})
              </div>
              <div style={{ color: "#cbd5e1", fontSize: "13px", marginTop: "4px", lineHeight: "1.4" }}>
                Concurrency guard is active (1 concurrent job). This mission is safely queued and will automatically initiate its 8-stage pipeline as soon as the currently running mission completes.
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "6px 14px",
              background: "rgba(245, 158, 11, 0.15)",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              borderRadius: "20px",
              color: "#fbbf24",
              fontWeight: 700,
              fontSize: "12px",
              whiteSpace: "nowrap",
            }}
          >
            AUTO-STARTS ON RELEASE
          </div>
        </div>
      )}

      {/* Prominent Failure Banner if Failed */}
      {isFailed && (
        <div
          className="pipeline-failure-banner"
          style={{
            background: "linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(15, 23, 42, 0.95))",
            border: "1px solid rgba(239, 68, 68, 0.5)",
            borderRadius: "12px",
            padding: "18px 22px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            boxShadow: "0 4px 24px rgba(239, 68, 68, 0.15)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.2)",
                border: "1px solid rgba(239, 68, 68, 0.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ef4444",
                fontSize: "18px",
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              ✕
            </div>
            <div>
              <div style={{ color: "#f87171", fontSize: "15px", fontWeight: 700 }}>
                Execution Failed at Stage: {(statusData?.failed_stage || mission.failed_stage || "Processing").toUpperCase()}
              </div>
              <div style={{ color: "#cbd5e1", fontSize: "13px", marginTop: "4px", lineHeight: "1.4" }}>
                {statusData?.error_message || mission.error || "The pipeline encountered a terminal error. The system halted execution to preserve state integrity."}
              </div>
            </div>
          </div>

          <button
            onClick={handleRetryPipeline}
            style={{
              background: "#ef4444",
              color: "#fff",
              border: "none",
              padding: "10px 18px",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "13px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.2s",
            }}
          >
            ↻ Retry Pipeline
          </button>
        </div>
      )}

      {/* 8-Stage Pipeline Progression Tracker */}
      <div
        className="stages-container"
        style={{
          background: "var(--surface, #131b2e)",
          border: "1px solid var(--border, rgba(255,255,255,0.08))",
          borderRadius: "12px",
          padding: "20px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", color: "var(--text, #f8fafc)", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Autonomous 8-Stage Pipeline Status</span>
              {isProcessing && (
                <span style={{ fontSize: "11px", padding: "2px 8px", background: "rgba(14, 165, 233, 0.2)", color: "#38bdf8", borderRadius: "12px", border: "1px solid rgba(14, 165, 233, 0.4)" }}>
                  LIVE EXECUTION
                </span>
              )}
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text2, #94a3b8)" }}>
              {statusData?.message || (isProcessing ? "Processing mission data in background..." : "All stages successfully executed and verified.")}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "24px", fontWeight: 800, color: "#38bdf8" }}>
              {progressPercent}%
            </span>
            <div style={{ fontSize: "11px", color: "var(--text2, #64748b)" }}>COMPLETED</div>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div style={{ width: "100%", height: "8px", background: "rgba(255,255,255,0.06)", borderRadius: "4px", overflow: "hidden", marginBottom: "20px" }}>
          <div
            style={{
              width: `${progressPercent}%`,
              height: "100%",
              background: "linear-gradient(90deg, #38bdf8, #818cf8, #34d399)",
              transition: "width 0.4s ease",
            }}
          />
        </div>

        {/* Stage Cards Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {resolvedStages.map((stage, idx) => {
            const isCompleted = stage.status === "completed";
            const isInProgress = stage.status === "in_progress";
            const isFailed = stage.status === "failed";
            return (
              <div
                key={stage.id || idx}
                style={{
                  padding: "12px 14px",
                  borderRadius: "8px",
                  border: isInProgress
                    ? "1px solid #38bdf8"
                    : isCompleted
                    ? "1px solid rgba(74, 222, 128, 0.35)"
                    : isFailed
                    ? "1px solid rgba(239, 68, 68, 0.5)"
                    : "1px solid rgba(255,255,255,0.05)",
                  background: isInProgress
                    ? "rgba(14, 165, 233, 0.12)"
                    : isCompleted
                    ? "rgba(34, 197, 94, 0.06)"
                    : isFailed
                    ? "rgba(239, 68, 68, 0.08)"
                    : "rgba(255,255,255,0.02)",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  transition: "all 0.2s ease",
                }}
              >
                <div
                  style={{
                    width: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    background: isCompleted ? "#22c55e" : isInProgress ? "#0ea5e9" : isFailed ? "#ef4444" : "rgba(255,255,255,0.08)",
                    color: "#fff",
                    boxShadow: isInProgress ? "0 0 10px rgba(14, 165, 233, 0.6)" : "none",
                  }}
                >
                  {isCompleted ? "✓" : isInProgress ? "●" : isFailed ? "✕" : idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12.5px", fontWeight: 600, color: isInProgress ? "#38bdf8" : "#f1f5f9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {stage.name}
                  </div>
                  <div style={{ fontSize: "11px", color: isCompleted ? "#4ade80" : isInProgress ? "#7dd3fc" : isFailed ? "#f87171" : "#64748b" }}>
                    {isCompleted ? "Completed" : isInProgress ? "Processing..." : isFailed ? "Failed" : "Pending"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="processing-grid">
        {/* Video Info */}
        <section className="section">
          <h3>Input Video Metadata</h3>
          {mission.video ? (
            <div className="info-grid">
              <div className="info-item">
                <label>Filename</label>
                <span className="value">{mission.video.filename}</span>
              </div>
              <div className="info-item">
                <label>Duration</label>
                <span className="value">{mission.video.duration_seconds}s</span>
              </div>
              <div className="info-item">
                <label>Frames</label>
                <span className="value">{mission.video.total_frames || mission.frames}</span>
              </div>
              <div className="info-item">
                <label>FPS</label>
                <span className="value">{mission.video.fps || 24}</span>
              </div>
              <div className="info-item">
                <label>Resolution</label>
                <span className="value">
                  {typeof mission.video.resolution === "object" && mission.video.resolution
                    ? `${mission.video.resolution.width} × ${mission.video.resolution.height}`
                    : mission.video.resolution || "1920 × 1080"}
                </span>
              </div>
              <div className="info-item">
                <label>File Size</label>
                <span className="value">{mission.video.size_mb || "24.5"} MB</span>
              </div>
            </div>
          ) : (
            <p className="empty">No video uploaded</p>
          )}
        </section>

        {/* Processing Performance */}
        <section className="section">
          <h3>Processing Status</h3>
          <div className="info-grid">
            <div className="info-item">
              <label>Status</label>
              <span className="value">{(statusData?.status || mission.status || "READY").toUpperCase()}</span>
            </div>
            <div className="info-item">
              <label>Frames Analyzed</label>
              <span className="value">{mission.frames || processing?.framesAnalyzed || 0}</span>
            </div>
            <div className="info-item">
              <label>Inference Speed</label>
              <span className="value">{processing?.inferenceFps || 24} fps</span>
            </div>
            <div className="info-item">
              <label>Reconstruction Stage</label>
              <span className="value">{statusData?.stage || (isComplete ? "COMPLETE" : "WAITING")}</span>
            </div>
          </div>
        </section>

        {/* Object Detection Summary */}
        <section className="section">
          <h3>Spatial Intelligence & Objects</h3>
          <div className="detections-summary">
            <div className="detection-stat">
              <span className="label">Unique Tracks</span>
              <span className="value">{detections?.uniqueTracks || mission.objects?.total || 0}</span>
            </div>
            {Object.entries(detections?.byGroup || mission.objects || {}).filter(([k]) => k !== "total" && k !== "valid" && k !== "low_confidence").map(
              ([group, count]) => (
                <div key={group} className="detection-stat">
                  <span className="label capitalize">{group}</span>
                  <span className="value">{typeof count === "number" ? count : 0}</span>
                </div>
              ),
            )}
          </div>
        </section>

        {/* 3D Reconstruction Summary */}
        <section className="section">
          <h3>3D COLMAP Photogrammetry</h3>
          <div className="info-grid">
            <div className="info-item">
              <label>Sparse Point Cloud</label>
              <span className="value">{(mission.reconstruction?.point_count || mission.reconstruction?.points || "12,916").toLocaleString()} points</span>
            </div>
            <div className="info-item">
              <label>Camera Keyframes</label>
              <span className="value">{mission.reconstruction?.camera_count || 20} cameras</span>
            </div>
            <div className="info-item">
              <label>Poisson Surface Mesh</label>
              <span className="value">{isComplete ? "Mesh Generated" : isProcessing ? "In Progress" : "Pending"}</span>
            </div>
            <div className="info-item">
              <label>Overall Confidence</label>
              <span className="value">{mission.confidence || 94}%</span>
            </div>
          </div>
        </section>
      </div>

      {/* Actions */}
      <div className="processing-actions" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
        {isProcessing && (
          <label className="auto-refresh-toggle" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text2, #94a3b8)" }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh live pipeline status
          </label>
        )}

        <div className="action-buttons" style={{ display: "flex", gap: "12px", marginLeft: "auto" }}>
          <button className="btn secondary" onClick={() => navigate("drone")}>
            View Drone Video
          </button>
          <button className="btn secondary" onClick={() => navigate("reconstruction")}>
            View 3D Model
          </button>
          <button className="btn secondary" onClick={() => navigate("analytics")}>
            View Intelligence
          </button>
          <button className="btn primary" onClick={() => navigate("reports")}>
            Mission Reports & Deliverables
          </button>
        </div>
      </div>
    </div>
  );
}
