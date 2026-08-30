import { useEffect, useRef, useState } from "react";

const fallbackPoster = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#155261"/><stop offset="1" stop-color="#061017"/></linearGradient><pattern id="g" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#62d8ea" stroke-opacity=".17"/></pattern></defs><rect width="1280" height="720" fill="url(#s)"/><rect width="1280" height="720" fill="url(#g)"/><path d="M0 590L300 365 570 560 830 290 1280 570V720H0Z" fill="#173e3d"/><path d="M0 650L410 470 760 645 1020 400 1280 545V720H0Z" fill="#0d292d"/><rect x="460" y="300" width="160" height="180" fill="#285361"/><rect x="650" y="240" width="210" height="245" fill="#1d4857"/><path d="M0 535L1280 320" stroke="#e3bc69" stroke-width="12" stroke-opacity=".75"/><circle cx="640" cy="360" r="56" fill="none" stroke="#7be8f7" stroke-width="3"/><path d="M610 360H670M640 330V390" stroke="#7be8f7" stroke-width="3"/></svg>`)}`;

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
  const videoSrc = mission?.assets?.video || "";
  const hasVideoAsset = Boolean(videoSrc);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(videoSrc));
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !duration || seekingRef.current) return;
    const nextTime = ((frame - 1) / mission.frames) * duration;
    if (Math.abs(video.currentTime - nextTime) > 0.35)
      video.currentTime = nextTime;
  }, [duration, frame, mission.frames]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    if (playing) video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [playing, setPlaying, speed]);

  const updateFrame = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration === 0)
      return;
    seekingRef.current = true;
    setFrame(
      Math.min(
        mission.frames,
        Math.max(
          1,
          Math.round((video.currentTime / video.duration) * mission.frames),
        ),
      ),
    );
    requestAnimationFrame(() => {
      seekingRef.current = false;
    });
  };

  if (!hasVideoAsset) {
    return (
      <div className="video-player-container">
        <div
          className="video-fallback"
          role="img"
          aria-label="Video asset unavailable"
        >
          <img src={fallbackPoster} alt="Mission video unavailable" />
          <span>ASSET NOT AVAILABLE — VIDEO UNAVAILABLE FOR THIS MISSION</span>
        </div>
      </div>
    );
  }

  return (
    <div className="video-player-container">
      {failed ? (
        <div
          className="video-fallback"
          role="img"
          aria-label="Fallback aerial disaster response scene"
        >
          <img
            src={fallbackPoster}
            alt="Aerial disaster response fallback scene"
          />
          <span>FLIGHT VIDEO UNAVAILABLE — FALLBACK SCENE</span>
        </div>
      ) : (
        <>
          <video
            key={mission.id}
            ref={videoRef}
            className="flight-video"
            src={videoSrc}
            poster={fallbackPoster}
            preload="metadata"
            playsInline
            muted
            onCanPlay={() => setLoading(false)}
            onLoadedMetadata={(event) =>
              setDuration(event.currentTarget.duration)
            }
            onTimeUpdate={updateFrame}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
              setPlaying(false);
            }}
          />
          {loading && (
            <div className="video-loading" aria-live="polite">
              <i />
              LOADING FLIGHT FOOTAGE FOR {mission.name.toUpperCase()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
