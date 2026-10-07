import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { resolveAssetUrl, fetchArtifactsStatus, uploadVideoChunk, uploadVideo, getMission } from "../../api/missions.js";
import Icon from "../ui/Icon";

export default function VideoPlayer({
  mission,
  frame,
  setFrame,
  playing,
  setPlaying,
  speed,
  detections: propDetections,
  semanticObjects: propSemanticObjects,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const replaceFileInputRef = useRef(null);

  // True while the user (or program) is actively dragging/seeking
  const userSeekingRef = useRef(false);
  // Prevent the frame→time effect from firing during timeupdate-driven frame updates
  const timeUpdateActiveRef = useRef(false);

  // Determine potential video endpoints
  const proxyUrl =
    mission?.assets?.video_proxy ||
    mission?.video?.proxy_url ||
    (mission?.id ? `/api/v1/missions/${mission.id}/video/proxy` : "");

  const directUrl =
    mission?.assets?.video ||
    mission?.video?.original_url ||
    mission?.video?.url ||
    (mission?.id ? `/api/v1/missions/${mission.id}/video` : "");

  // Fallback state tracking: 0 = try proxy, 1 = try direct original, 2 = all failed
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [customOverrideUrl, setCustomOverrideUrl] = useState(null);

  // Re-upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusMsg, setUploadStatusMsg] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);

  // Video playback states
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [ended, setEnded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  // Compute active candidate URL based on attempt index
  const activeCandidateUrl = useMemo(() => {
    let base = "";
    if (customOverrideUrl) base = customOverrideUrl;
    else if (attemptIndex === 0) base = proxyUrl || directUrl;
    else if (attemptIndex === 1) base = directUrl;
    if (!base) return "";
    if (retryCount > 0) {
      const sep = base.includes("?") ? "&" : "?";
      return `${base}${sep}_r=${retryCount}`;
    }
    return base;
  }, [customOverrideUrl, attemptIndex, proxyUrl, directUrl, retryCount]);

  const videoSrc = useMemo(() => {
    return activeCandidateUrl ? resolveAssetUrl(activeCandidateUrl) : "";
  }, [activeCandidateUrl]);

  // Reset states on mission change
  useEffect(() => {
    setAttemptIndex(0);
    setRetryCount(0);
    setCustomOverrideUrl(null);
    setFailed(false);
    setErrorMessage("");
    setSelectedFile(null);
    setIsUploading(false);
    setUploadProgress(0);
    setUploadError("");
  }, [mission?.id]);

  useEffect(() => {
    if (videoSrc) {
      setLoading(true);
      setFailed(false);
      setErrorMessage("");
      setEnded(false);
    } else {
      setLoading(false);
      setFailed(true);
    }
  }, [videoSrc]);

  // ------------------------------------------------------------------
  // Video Error & Automatic Fallback Handler
  // ------------------------------------------------------------------
  const handleVideoError = () => {
    setLoading(false);
    setPlaying(false);

    if (attemptIndex === 0 && directUrl && directUrl !== proxyUrl) {
      console.warn(`[VideoPlayer] Proxy stream failed for mission ${mission?.id}. Falling back to direct video URL.`);
      setAttemptIndex(1);
    } else {
      setFailed(true);
      setErrorMessage("Flight video stream asset could not be loaded or is offline.");
    }
  };

  // ------------------------------------------------------------------
  // Video Upload Handlers
  // ------------------------------------------------------------------
  const handleFileSelect = (file, autoStart = true) => {
    if (!file) return;
    if (!file.name.match(/\.(mp4|mov|mkv|avi|webm)$/i)) {
      setUploadError("Please select a valid video file (.mp4, .mov, .mkv, .avi, .webm)");
      return;
    }
    setSelectedFile(file);
    setUploadError("");
    if (autoStart) {
      handleStartUpload(file);
    }
  };

  const handleStartUpload = async (fileToUpload) => {
    const file = fileToUpload || selectedFile;
    if (!file || !mission?.id) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError("");
    setUploadStatusMsg("Starting video ingestion...");

    try {
      let result;
      try {
        result = await uploadVideoChunk(mission.id, file, (info) => {
          const num = typeof info === "object" ? Number(info.progress ?? 0) : Number(info ?? 0);
          setUploadProgress(num);
          const chunkStr = typeof info === "object" && info.chunkIndex && info.totalChunks
            ? `chunk ${info.chunkIndex}/${info.totalChunks} `
            : "";
          const speedStr = typeof info === "object" && info.speedMBps
            ? ` @ ${info.speedMBps} MB/s`
            : "";
          setUploadStatusMsg(`Uploading ${chunkStr}(${num}%${speedStr})`);
        });
      } catch (chunkErr) {
        console.warn("[VideoPlayer] Chunked upload failed, falling back to direct upload:", chunkErr);
        setUploadStatusMsg("Uploading via direct stream...");
        result = await uploadVideo(mission.id, file);
      }

      setUploadProgress(100);
      setUploadStatusMsg("Video uploaded successfully! Initializing player...");

      const newUrl = `/api/v1/missions/${mission.id}/video?t=${Date.now()}`;
      setCustomOverrideUrl(newUrl);
      setFailed(false);
      setErrorMessage("");
      setShowReplaceModal(false);
      setSelectedFile(null);

      try {
        await getMission(mission.id, true);
        window.dispatchEvent(new CustomEvent("aeromesh:mission_updated", { detail: { id: mission.id } }));
      } catch (_) {}

      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadStatusMsg("");
        if (videoRef.current) {
          videoRef.current.load();
        }
      }, 1000);
    } catch (err) {
      console.error("[VideoPlayer] Upload error:", err);
      setIsUploading(false);
      setUploadError(err.message || "Failed to upload video to this mission.");
    }
  };

  // ------------------------------------------------------------------
  // frame → currentTime (seeking)
  // ------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !duration || !userSeekingRef.current) return;
    const totalF = mission?.video?.total_frames || mission?.frames || 1;
    const nextTime = ((frame - 1) / Math.max(1, totalF - 1)) * duration;
    if (Math.abs(video.currentTime - nextTime) > 0.08) {
      video.currentTime = nextTime;
    }
  }, [frame, duration, mission?.video?.total_frames, mission?.frames]);

  // ------------------------------------------------------------------
  // play / pause / speed
  // ------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = Number(speed) || 1;
    if (playing) {
      setEnded(false);
      video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, [playing, setPlaying, speed]);

  // ------------------------------------------------------------------
  // timeupdate → frame
  // ------------------------------------------------------------------
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration === 0) return;
    if (userSeekingRef.current) return;
    timeUpdateActiveRef.current = true;
    const totalF = mission?.video?.total_frames || mission?.frames || 1;
    const f = Math.min(
      totalF,
      Math.max(1, Math.round((video.currentTime / video.duration) * totalF))
    );
    setFrame(f);
    timeUpdateActiveRef.current = false;
  }, [setFrame, mission?.video?.total_frames, mission?.frames]);

  const handleReplay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setEnded(false);
    video.currentTime = 0;
    setPlaying(true);
  }, [setPlaying]);

  // ------------------------------------------------------------------
  // Object Detection Overlay — per-frame bounding box index
  // ------------------------------------------------------------------
  const detectionsByFrame = useMemo(() => {
    const map = {};
    const sources = [
      propDetections,
      propSemanticObjects,
      mission?.semantic_scene?.observations,
      mission?.semantic_scene?.objects,
      mission?.detections,
      mission?.objects_3d,
    ];
    for (const src of sources) {
      if (!Array.isArray(src)) continue;
      for (const det of src) {
        const observations = det.observations || (det.bbox ? [det] : []);
        for (const obs of observations) {
          const fi = obs.frame_index ?? obs.frame_id ?? obs.frame ?? det.frame_index ?? det.frame_id;
          if (fi == null) continue;
          const bbox = obs.bbox || obs.bounding_box || det.bbox || det.bounding_box;
          if (!bbox || bbox.length < 4) continue;
          const entry = {
            bbox,
            cls: obs.class || obs.class_name || det.class || det.class_name || det.category || "object",
            track_id: obs.track_id || det.track_id || det.object_id || "",
            confidence: obs.confidence ?? det.confidence ?? det.mean_confidence ?? null,
          };
          const key = Number(fi);
          if (!map[key]) map[key] = [];
          map[key].push(entry);
        }
      }
    }
    return map;
  }, [propDetections, propSemanticObjects, mission]);

  // Draw detection bounding boxes on overlay canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const dets = detectionsByFrame[frame] || detectionsByFrame[frame - 1] || detectionsByFrame[frame + 1] || [];
    if (dets.length === 0) return;

    const vw = video.videoWidth || rect.width;
    const vh = video.videoHeight || rect.height;

    const CLASS_COLORS = {
      car: "#22d3ee", truck: "#f59e0b", bus: "#a78bfa", van: "#34d399",
      motorcycle: "#fb923c", bicycle: "#818cf8", tricycle: "#06b6d4",
      "awning-tricycle": "#06b6d4",
      person: "#f43f5e", pedestrian: "#f43f5e", people: "#f43f5e", human: "#f43f5e",
      vehicle: "#22d3ee", automobile: "#22d3ee",
      boat: "#3b82f6", ship: "#3b82f6", vessel: "#3b82f6",
      fire: "#ef4444", smoke: "#9ca3af", damage: "#dc2626",
      building: "#a3e635", infrastructure: "#facc15",
    };

    for (const det of dets) {
      let [x1, y1, x2, y2] = det.bbox;

      if (x1 <= 1.0 && y1 <= 1.0 && x2 <= 1.0 && y2 <= 1.0) {
        x1 *= rect.width; y1 *= rect.height; x2 *= rect.width; y2 *= rect.height;
      } else {
        x1 = (x1 / vw) * rect.width; y1 = (y1 / vh) * rect.height;
        x2 = (x2 / vw) * rect.width; y2 = (y2 / vh) * rect.height;
      }

      const w = x2 - x1;
      const h = y2 - y1;
      if (w < 2 || h < 2) continue;

      const clsKey = (det.cls || "object").toLowerCase();
      const color = CLASS_COLORS[clsKey] || "#38bdf8";
      const confStr = det.confidence != null ? ` ${Math.round(det.confidence * (det.confidence <= 1 ? 100 : 1))}%` : "";
      const label = `${(det.cls || "OBJ").toUpperCase()}${det.track_id ? ` (${det.track_id})` : ""}${confStr}`;

      // Semi-transparent fill
      ctx.fillStyle = color + "12";
      ctx.fillRect(x1, y1, w, h);

      // Box border
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(x1, y1, w, h);

      // Corner accents
      const cornerLen = Math.min(14, w / 3.5, h / 3.5);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(x1, y1 + cornerLen); ctx.lineTo(x1, y1); ctx.lineTo(x1 + cornerLen, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2 - cornerLen, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + cornerLen); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y2 - cornerLen); ctx.lineTo(x1, y2); ctx.lineTo(x1 + cornerLen, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2 - cornerLen, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - cornerLen); ctx.stroke();

      // Label background pill
      ctx.font = "bold 11px 'Inter', 'Segoe UI', sans-serif";
      const metrics = ctx.measureText(label);
      const labelW = metrics.width + 12;
      const labelH = 18;
      const labelY = y1 > labelH + 4 ? y1 - labelH - 2 : y1 + 2;

      const lx = x1;
      const ly = labelY;
      const lr = 3;
      ctx.fillStyle = color + "dd";
      ctx.beginPath();
      ctx.moveTo(lx + lr, ly);
      ctx.lineTo(lx + labelW - lr, ly);
      ctx.quadraticCurveTo(lx + labelW, ly, lx + labelW, ly + lr);
      ctx.lineTo(lx + labelW, ly + labelH - lr);
      ctx.quadraticCurveTo(lx + labelW, ly + labelH, lx + labelW - lr, ly + labelH);
      ctx.lineTo(lx + lr, ly + labelH);
      ctx.quadraticCurveTo(lx, ly + labelH, lx, ly + labelH - lr);
      ctx.lineTo(lx, ly + lr);
      ctx.quadraticCurveTo(lx, ly, lx + lr, ly);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#000000";
      ctx.fillText(label, x1 + 6, labelY + 13);
    }
  }, [frame, detectionsByFrame]);

  // Resize overlay canvas when video element resizes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas || !video) return;
      const rect = video.getBoundingClientRect();
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    });
    ro.observe(video);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------------
  // Drag & drop handlers
  // ------------------------------------------------------------------
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => { setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.[0]) {
      handleFileSelect(e.dataTransfer.files[0], true);
    }
  };

  const currentFrameDetections = detectionsByFrame[frame] || detectionsByFrame[frame - 1] || [];
  const detectionCount = currentFrameDetections.length;

  // ------------------------------------------------------------------
  // RENDER: Unavailable / Error State with In-Player Re-Upload UI
  // ------------------------------------------------------------------
  if (failed || !videoSrc) {
    return (
      <div className="video-player-container">
        <div
          className={`video-unavailable-state ${isDragging ? "dragging-over" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="video-unavailable-inner">
            <div className="video-alert-icon-box">
              <Icon name="VideoOff" size={36} />
            </div>

            <div className="video-alert-title">
              VIDEO FOOTAGE UNAVAILABLE
            </div>

            <div className="video-alert-description">
              {errorMessage || `Flight video stream asset could not be loaded for mission "${mission?.name || mission?.id}".`}
            </div>

            <div className="video-reupload-box">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/x-matroska,video/avi"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileSelect(e.target.files[0], true);
                }}
              />

              {!selectedFile ? (
                <div className="upload-prompt-row">
                  <button
                    className="btn-select-video-file"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    <Icon name="Upload" size={16} />
                    <span>Upload / Re-Upload Video</span>
                  </button>
                  <span className="upload-drag-hint">or drag &amp; drop MP4/MOV file here</span>
                </div>
              ) : (
                <div className="upload-selected-file-card">
                  <div className="file-info-header">
                    <Icon name="Film" size={16} />
                    <span className="file-name" title={selectedFile.name}>
                      {selectedFile.name}
                    </span>
                    <span className="file-size">
                      ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
                    </span>
                  </div>

                  {isUploading ? (
                    <div className="upload-progress-container">
                      <div className="upload-progress-bar">
                        <div
                          className="upload-progress-fill"
                          style={{ width: `${Math.round(Number(uploadProgress?.progress ?? uploadProgress ?? 0))}%` }}
                        />
                      </div>
                      <div className="upload-progress-text">
                        <span>{String(uploadStatusMsg || "")}</span>
                        <span>{Math.round(Number(uploadProgress?.progress ?? uploadProgress ?? 0))}%</span>
                      </div>
                    </div>
                  ) : (
                    <div className="upload-confirm-buttons">
                      <button className="btn-cancel-file" onClick={() => setSelectedFile(null)}>
                        Change File
                      </button>
                      <button className="btn-submit-upload" onClick={() => handleStartUpload()}>
                        <Icon name="UploadCloud" size={15} />
                        Attach &amp; Launch Video
                      </button>
                    </div>
                  )}
                </div>
              )}

              {uploadError && (
                <div className="upload-error-alert">
                  <Icon name="AlertCircle" size={14} />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>

            <div className="video-diagnostics-row">
              <button
                className="btn-retry-stream"
                onClick={() => {
                  setAttemptIndex(0);
                  setFailed(false);
                  setErrorMessage("");
                  setLoading(true);
                  setRetryCount((prev) => prev + 1);
                }}
              >
                <Icon name="RefreshCw" size={13} />
                <span>Retry Stream Connection</span>
              </button>
              <span className="endpoint-hint">
                Target: <code>{activeCandidateUrl || directUrl || "None"}</code>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // RENDER: Active Video Player with Detection Overlay
  // ------------------------------------------------------------------
  return (
    <div className="video-player-container" style={{ position: "relative" }}>
      <input
        ref={replaceFileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-matroska,video/avi"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.[0]) handleFileSelect(e.target.files[0], true);
        }}
      />

      <div className="video-player-top-actions">
        <button
          className="btn-player-reupload"
          onClick={() => replaceFileInputRef.current?.click()}
          disabled={isUploading}
          title="Re-upload or replace video footage for this mission"
        >
          <Icon name="Upload" size={12} />
          <span>{isUploading ? "Uploading..." : "Replace Video"}</span>
        </button>
      </div>

      <video
        key={`${mission?.id}-${attemptIndex}-${customOverrideUrl}`}
        ref={videoRef}
        className="mission-video-element"
        src={videoSrc}
        preload="metadata"
        playsInline
        muted
        onCanPlay={() => { setLoading(false); setBuffering(false); }}
        onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); setLoading(false); }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => { setPlaying(true); setEnded(false); }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setEnded(true); }}
        onSeeking={() => { userSeekingRef.current = true; setBuffering(true); }}
        onSeeked={() => { userSeekingRef.current = false; setBuffering(false); }}
        onError={handleVideoError}
      />

      {/* Object Detection Bounding Box Overlay Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 5,
        }}
      />

      {/* Detection Count HUD Badge */}
      {detectionCount > 0 && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            left: "8px",
            background: "rgba(6, 16, 23, 0.88)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            borderRadius: "6px",
            padding: "4px 10px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            zIndex: 15,
            fontSize: "11px",
            fontWeight: 600,
            color: "#38bdf8",
            letterSpacing: "0.04em",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2.5">
            <rect x="1" y="1" width="22" height="22" rx="3" />
            <circle cx="12" cy="12" r="3" fill="#22d3ee" />
          </svg>
          {detectionCount} DETECTION{detectionCount !== 1 ? "S" : ""} · F{frame}
        </div>
      )}

      {isUploading && (
        <div
          className="video-upload-overlay"
          style={{
            position: "absolute", inset: 0,
            background: "rgba(10, 15, 25, 0.88)", backdropFilter: "blur(6px)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            zIndex: 40, padding: "24px",
          }}
        >
          <div style={{ maxWidth: 440, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#38bdf8", marginBottom: "6px", letterSpacing: "0.04em" }}>
              INGESTING NEW MISSION FOOTAGE
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", marginBottom: "16px" }}>
              {selectedFile?.name || "Video file"} ({(Number(selectedFile?.size || 0) / (1024 * 1024)).toFixed(1)} MB)
            </div>
            <div style={{ width: "100%", height: 8, background: "rgba(255,255,255,0.12)", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
              <div style={{
                width: `${Math.round(Number(uploadProgress?.progress ?? uploadProgress ?? 0))}%`,
                height: "100%", background: "linear-gradient(90deg, #38bdf8, #818cf8)", transition: "width 0.2s ease",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>
              <span>{uploadStatusMsg || "Uploading chunks..."}</span>
              <span style={{ fontWeight: 600, color: "#38bdf8" }}>
                {Math.round(Number(uploadProgress?.progress ?? uploadProgress ?? 0))}%
              </span>
            </div>
          </div>
        </div>
      )}

      {buffering && !ended && (
        <div className="video-buffering-overlay" aria-live="polite">
          <div className="buffering-text">◌ BUFFERING STREAM…</div>
        </div>
      )}

      {ended && (
        <div className="video-ended-overlay">
          <div className="ended-title">MISSION FOOTAGE COMPLETE</div>
          <button id="video-replay-btn" className="btn-video-replay" onClick={handleReplay}>
            ↺ REPLAY
          </button>
        </div>
      )}

      {loading && (
        <div className="video-loading" aria-live="polite">
          <i />
          STREAMING FLIGHT FOOTAGE FOR {mission?.name?.toUpperCase?.() || mission?.id || "MISSION"}
        </div>
      )}
    </div>
  );
}
