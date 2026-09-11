import { useEffect, useRef, useState, useMemo } from "react";
import { resolveAssetUrl } from "../../api/missions.js";

export default function VideoPlayer({
  mission,
  frame,
  setFrame,
  playing,
  setPlaying,
  speed,
}) {
  const videoRef = useRef(null);
  const seekingRef = useRef(false);

  // Canonical video URL - single source of truth
  const rawVideoSrc =
    mission?.assets?.video ||
    mission?.video?.url ||
    (mission?.id ? `/api/missions/${mission.id}/video` : "");
  const videoSrc = useMemo(() => resolveAssetUrl(rawVideoSrc), [rawVideoSrc]);
  const hasVideoAsset = Boolean(videoSrc);

  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(videoSrc));
  const [duration, setDuration] = useState(0);

  const totalFrames = Math.max(
    1,
    mission?.frames || mission?.video?.total_frames || 125,
  );

  useEffect(() => {
    setFailed(false);
    setErrorMessage("");
    setLoading(Boolean(videoSrc));
  }, [videoSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !duration || seekingRef.current) return;
    const nextTime = ((frame - 1) / totalFrames) * duration;
    if (Math.abs(video.currentTime - nextTime) > 0.05) {
      video.currentTime = nextTime;
    }
  }, [duration, frame, totalFrames]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    if (playing) {
      video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, [playing, setPlaying, speed]);

  const updateFrame = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration === 0)
      return;
    seekingRef.current = true;
    setFrame(
      Math.min(
        totalFrames,
        Math.max(
          1,
          Math.round((video.currentTime / video.duration) * totalFrames),
        ),
      ),
    );
    requestAnimationFrame(() => {
      seekingRef.current = false;
    });
  };

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
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginBottom: "14px" }}
          >
            <path d="m22 8-6 4 6 4V8Z" />
            <rect width="14" height="12" x="2" y="6" rx="2" />
            <line x1="2" x2="22" y1="2" y2="22" />
          </svg>
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "#fbbf24",
              marginBottom: "8px",
            }}
          >
            VIDEO UNAVAILABLE
          </div>
          <div
            style={{
              fontSize: "12px",
              maxWidth: "380px",
              lineHeight: 1.5,
              color: "#cbd5e1",
              marginBottom: "10px",
            }}
          >
            {failed
              ? errorMessage ||
                `Video stream failed to load for mission "${mission?.name || mission?.id}".`
              : `No video stream asset registered for mission "${mission?.name || mission?.id}".`}
          </div>
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "10px",
              color: "#64748b",
              wordBreak: "break-all",
            }}
          >
            Endpoint: {rawVideoSrc || "None"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="video-player-container">
      <video
        key={mission.id}
        ref={videoRef}
        className="flight-video"
        src={videoSrc}
        preload="metadata"
        playsInline
        muted
        onCanPlay={() => setLoading(false)}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
          setLoading(false);
        }}
        onTimeUpdate={updateFrame}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
          setPlaying(false);
          setErrorMessage(
            "Video playback failed: flight stream asset could not be loaded.",
          );
        }}
      />
      {loading && (
        <div className="video-loading" aria-live="polite">
          <i />
          LOADING FLIGHT FOOTAGE FOR {mission.name.toUpperCase()}
        </div>
      )}
    </div>
  );
}
