import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { resolveAssetUrl, fetchArtifactsStatus } from "../../api/missions.js";

export default function VideoPlayer({
  mission,
  frame,
  setFrame,
  playing,
  setPlaying,
  speed,
}) {
  const videoRef = useRef(null);
  // True while the user (or program) is actively dragging/seeking
  const userSeekingRef = useRef(false);
  // Prevent the frame→time effect from firing during timeupdate-driven frame updates
  const timeUpdateActiveRef = useRef(false);

  const [videoReady, setVideoReady] = useState(() => {
    if (!mission || mission.status === "PARTIAL" || mission.status === "pending" || mission.status === "uploading") {
      return false;
    }
    return Boolean(mission?.video?.url || (mission?.video?.filename && mission?.video?.status !== "pending"));
  });
  const [artifactReason, setArtifactReason] = useState("");

  useEffect(() => {
    let active = true;
    if (mission?.id && mission?.status !== "PARTIAL") {
      fetchArtifactsStatus(mission.id).then((res) => {
        if (active) {
          const vArt = res?.artifacts?.video;
          const isReady = vArt?.status === "ready" || Boolean(mission?.video?.url);
          setVideoReady(isReady);
          if (vArt?.reason) setArtifactReason(vArt.reason);
        }
      }).catch(() => {
        if (active) setVideoReady(false);
      });
    } else {
      setVideoReady(false);
    }
    return () => { active = false; };
  }, [mission?.id, mission?.status, mission?.video?.filename, mission?.video?.url]);

  // Prefer the browser-friendly proxy URL; fall back to original
  const rawVideoSrc = videoReady
    ? (mission?.assets?.video_proxy ||
       mission?.assets?.video ||
       mission?.video?.proxy_url ||
       mission?.video?.url ||
       (mission?.id && mission?.status !== "PARTIAL" && mission?.status !== "pending"
         ? `/api/v1/missions/${mission.id}/video/proxy`
         : ""))
    : "";
  const videoSrc = useMemo(() => (rawVideoSrc ? resolveAssetUrl(rawVideoSrc) : ""), [rawVideoSrc]);
  const hasVideoAsset = Boolean(videoSrc && videoReady);

  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(videoSrc));
  const [buffering, setBuffering] = useState(false);
  const [ended, setEnded] = useState(false);
  // Real duration from the video element — NOT from mission.frames
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setFailed(false);
    setErrorMessage("");
    setLoading(Boolean(videoSrc));
    setEnded(false);
  }, [videoSrc]);

  // ------------------------------------------------------------------
  // frame → currentTime  (ONLY when the user drags the slider,
  // i.e. userSeekingRef.current is true; never during playback)
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
  // timeupdate → frame (during playback, this is the ONLY writer of frame)
  // ------------------------------------------------------------------
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration === 0) return;
    if (userSeekingRef.current) return; // user is dragging — don't overwrite frame
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
  // Unavailable / error state
  // ------------------------------------------------------------------
  if (!hasVideoAsset || failed) {
    return (
      <div className="video-player-container">
        <div
          className="video-unavailable-state"
          role="status"
          aria-live="polite"
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#061017",
            border: "1px solid rgba(116, 220, 239, 0.2)",
            color: "#94a3b8",
            padding: "24px",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <svg
            width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="#f59e0b" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginBottom: "14px" }}
          >
            <path d="m22 8-6 4 6 4V8Z" />
            <rect width="14" height="12" x="2" y="6" rx="2" />
            <line x1="2" x2="22" y1="2" y2="22" />
          </svg>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "13px", fontWeight: 700, letterSpacing: "0.1em", color: "#fbbf24", marginBottom: "8px" }}>
            VIDEO UNAVAILABLE
          </div>
          <div style={{ fontSize: "12px", maxWidth: "380px", lineHeight: 1.5, color: "#cbd5e1", marginBottom: "10px" }}>
            {failed
              ? (errorMessage || `Video stream failed to load for mission "${mission?.name || mission?.id}".`)
              : (artifactReason
                  ? `Video not available: ${artifactReason}`
                  : `Video not available for mission "${mission?.name || mission?.id}".`)}
          </div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "10px", color: "#64748b", wordBreak: "break-all" }}>
            Endpoint: {rawVideoSrc || "None"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="video-player-container" style={{ position: "relative" }}>
      <video
        key={mission.id}
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
        onError={() => {
          setLoading(false);
          setFailed(true);
          setPlaying(false);
          setErrorMessage("Video playback failed: flight stream asset could not be loaded.");
        }}
      />

      {/* Buffering overlay */}
      {buffering && !ended && (
        <div
          aria-live="polite"
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(6, 16, 23, 0.55)", pointerEvents: "none",
          }}
        >
          <div style={{ color: "#38bdf8", fontFamily: "ui-monospace, monospace", fontSize: "12px", letterSpacing: "0.08em" }}>
            ◌ BUFFERING…
          </div>
        </div>
      )}

      {/* Ended overlay with Replay button */}
      {ended && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "rgba(6, 16, 23, 0.72)",
          }}
        >
          <div style={{ color: "#f8fafc", fontFamily: "ui-monospace, monospace", fontSize: "13px", marginBottom: "16px", letterSpacing: "0.06em" }}>
            END OF FOOTAGE
          </div>
          <button
            id="video-replay-btn"
            onClick={handleReplay}
            style={{
              background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.5)",
              color: "#38bdf8", fontFamily: "ui-monospace, monospace", fontSize: "12px",
              fontWeight: 700, letterSpacing: "0.06em", padding: "8px 20px",
              borderRadius: "6px", cursor: "pointer",
            }}
          >
            ↺ REPLAY
          </button>
        </div>
      )}

      {loading && (
        <div className="video-loading" aria-live="polite">
          <i />
          LOADING FLIGHT FOOTAGE FOR {mission?.name?.toUpperCase?.() || mission?.id || "MISSION"}
        </div>
      )}
    </div>
  );
}
