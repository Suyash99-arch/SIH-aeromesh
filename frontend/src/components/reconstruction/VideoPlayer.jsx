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
}) {
  const videoRef = useRef(null);
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

  // Compute active candidate URL based on attempt index
  const activeCandidateUrl = useMemo(() => {
    if (customOverrideUrl) return customOverrideUrl;
    if (attemptIndex === 0) return proxyUrl || directUrl;
    if (attemptIndex === 1) return directUrl;
    return "";
  }, [customOverrideUrl, attemptIndex, proxyUrl, directUrl]);

  const videoSrc = useMemo(() => {
    return activeCandidateUrl ? resolveAssetUrl(activeCandidateUrl) : "";
  }, [activeCandidateUrl]);

  // Reset states on mission change
  useEffect(() => {
    setAttemptIndex(0);
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
      // First fallback: proxy failed, seamlessly switch to direct video
      console.warn(`[VideoPlayer] Proxy stream failed for mission ${mission?.id}. Falling back to direct video URL.`);
      setAttemptIndex(1);
    } else {
      // Both proxy and direct failed or no alternate source available
      setFailed(true);
      setErrorMessage("Flight video stream asset could not be loaded or is offline.");
    }
  };

  // ------------------------------------------------------------------
  // Video Upload Handlers
  // ------------------------------------------------------------------
  const handleFileSelect = (file) => {
    if (!file) return;
    if (!file.name.match(/\.(mp4|mov|mkv|avi|webm)$/i)) {
      setUploadError("Please select a valid video file (.mp4, .mov, .mkv, .avi, .webm)");
      return;
    }
    setSelectedFile(file);
    setUploadError("");
  };

  const handleStartUpload = async (fileToUpload) => {
    const file = fileToUpload || selectedFile;
    if (!file || !mission?.id) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError("");
    setUploadStatusMsg("Starting video ingestion...");

    try {
      // Attempt chunked upload with progress tracking
      let result;
      try {
        result = await uploadVideoChunk(mission.id, file, (pct) => {
          setUploadProgress(pct);
          setUploadStatusMsg(`Uploading: ${pct}%`);
        });
      } catch (chunkErr) {
        console.warn("[VideoPlayer] Chunked upload failed, falling back to direct upload:", chunkErr);
        setUploadStatusMsg("Uploading via direct stream...");
        result = await uploadVideo(mission.id, file);
      }

      setUploadProgress(100);
      setUploadStatusMsg("Video uploaded successfully! Initializing player...");

      // Update video URL with cache buster to force immediate reload
      const newUrl = `/api/v1/missions/${mission.id}/video?t=${Date.now()}`;
      setCustomOverrideUrl(newUrl);
      setFailed(false);
      setErrorMessage("");
      setShowReplaceModal(false);
      setSelectedFile(null);

      // Trigger mission reload in background
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
  // Drag & drop handlers
  // ------------------------------------------------------------------
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

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

            {/* Re-Upload Dropzone / Action Panel */}
            <div className="video-reupload-box">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/x-matroska,video/avi"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
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
                  <span className="upload-drag-hint">or drag & drop MP4/MOV file here</span>
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
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <div className="upload-progress-text">
                        <span>{uploadStatusMsg}</span>
                        <span>{uploadProgress}%</span>
                      </div>
                    </div>
                  ) : (
                    <div className="upload-confirm-buttons">
                      <button
                        className="btn-cancel-file"
                        onClick={() => setSelectedFile(null)}
                      >
                        Change File
                      </button>
                      <button
                        className="btn-submit-upload"
                        onClick={() => handleStartUpload()}
                      >
                        <Icon name="UploadCloud" size={15} />
                        Attach & Launch Video
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

            {/* Endpoint / Retry Diagnostics */}
            <div className="video-diagnostics-row">
              <button
                className="btn-retry-stream"
                onClick={() => {
                  setAttemptIndex(0);
                  setFailed(false);
                  setErrorMessage("");
                  setLoading(true);
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
  // RENDER: Active Video Player
  // ------------------------------------------------------------------
  return (
    <div className="video-player-container" style={{ position: "relative" }}>
      {/* Hidden file input for header re-upload */}
      <input
        ref={replaceFileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-matroska,video/avi"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.[0]) {
            handleFileSelect(e.target.files[0]);
            setShowReplaceModal(true);
          }
        }}
      />

      {/* Quick In-Player Re-upload / Replace Button */}
      <div className="video-player-top-actions">
        <button
          className="btn-player-reupload"
          onClick={() => {
            setShowReplaceModal(true);
            replaceFileInputRef.current?.click();
          }}
          title="Re-upload or replace video footage for this mission"
        >
          <Icon name="Upload" size={12} />
          <span>Replace Video</span>
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
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          setLoading(false);
        }}
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

      {/* Buffering overlay */}
      {buffering && !ended && (
        <div className="video-buffering-overlay" aria-live="polite">
          <div className="buffering-text">
            ◌ BUFFERING STREAM…
          </div>
        </div>
      )}

      {/* Ended overlay with Replay button */}
      {ended && (
        <div className="video-ended-overlay">
          <div className="ended-title">
            MISSION FOOTAGE COMPLETE
          </div>
          <button
            id="video-replay-btn"
            className="btn-video-replay"
            onClick={handleReplay}
          >
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
