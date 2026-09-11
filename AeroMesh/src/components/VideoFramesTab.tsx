import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Play, Pause, Volume2, VolumeX, Maximize, RefreshCw, Trash2,
  Clock, Monitor, ChevronLeft, ChevronRight, X,
  Film, AlertCircle, Loader2, UploadCloud, Eye
} from 'lucide-react';
import { useIncident } from '../context/IncidentContext';
import type { VideoFrame } from '../types';
import { formatTimestamp } from '../utils/frameExtractor';

const FRAMES_PER_PAGE = 12; // 4 columns × 3 rows

export const VideoFramesTab: React.FC = () => {
  const {
    incident,
    videoBlobUrl,
    videoMeta,
    videoFile,
    frames,
    selectedFrame,
    setSelectedFrame,
    reloadFrames,
    extraction,
    setVideoFile,
  } = useIncident();

  // ── Video player state ────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  // Auto-select first frame if none selected
  useEffect(() => {
    if (frames.length > 0 && !selectedFrame) {
      setSelectedFrame(frames[0]);
    }
  }, [frames, selectedFrame, setSelectedFrame]);

  // ── Gallery pagination ────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(frames.length / FRAMES_PER_PAGE));
  const pageFrames = frames.slice(
    (currentPage - 1) * FRAMES_PER_PAGE,
    currentPage * FRAMES_PER_PAGE
  );

  // Reset states when video changes (official React pattern for deriving state changes during render)
  const [prevVideoBlobUrl, setPrevVideoBlobUrl] = useState<string | null>(videoBlobUrl);
  if (prevVideoBlobUrl !== videoBlobUrl) {
    setPrevVideoBlobUrl(videoBlobUrl);
    setCurrentPage(1);
    setIsPlaying(false);
    setCurrentTimeSec(0);
    setPlayerError(null);
  }

  // ── Player: sync time & handle errors ─────────────────────────────────────
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onTime = () => setCurrentTimeSec(vid.currentTime);
    const onEnd = () => setIsPlaying(false);
    const onErr = () => {
      setIsPlaying(false);
      setPlayerError('Video failed to play. The codec may not be supported by this browser.');
    };
    vid.addEventListener('timeupdate', onTime);
    vid.addEventListener('ended', onEnd);
    vid.addEventListener('error', onErr);
    return () => {
      vid.removeEventListener('timeupdate', onTime);
      vid.removeEventListener('ended', onEnd);
      vid.removeEventListener('error', onErr);
    };
  }, [videoBlobUrl]);

  // ── Player: seek when selected frame changes ─────────────────────────────
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !selectedFrame) return;
    try {
      vid.currentTime = selectedFrame.timestampSeconds;
    } catch {
      // ignore seek boundary errors
    }
  }, [selectedFrame]);

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play()
        .then(() => setIsPlaying(true))
        .catch(() => setPlayerError('Could not start video playback.'));
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    if (!vid) return;
    const t = parseFloat(e.target.value);
    vid.currentTime = t;
    setCurrentTimeSec(t);

    // Sync selected frame to nearest frame if close
    if (frames.length > 0) {
      let closest = frames[0];
      let minDiff = Math.abs(frames[0].timestampSeconds - t);
      for (let i = 1; i < frames.length; i++) {
        const diff = Math.abs(frames[i].timestampSeconds - t);
        if (diff < minDiff) {
          minDiff = diff;
          closest = frames[i];
        }
      }
      if (minDiff < 1.0 && closest.id !== selectedFrame?.id) {
        setSelectedFrame(closest);
      }
    }
  };

  // ── Frame click ───────────────────────────────────────────────────────────
  const handleFrameClick = useCallback((frame: VideoFrame) => {
    setSelectedFrame(frame);
    const frameIndex = frames.findIndex(f => f.id === frame.id);
    if (frameIndex >= 0) {
      setCurrentPage(Math.floor(frameIndex / FRAMES_PER_PAGE) + 1);
    }
    const vid = videoRef.current;
    if (vid) {
      vid.currentTime = frame.timestampSeconds;
      setCurrentTimeSec(frame.timestampSeconds);
    }
  }, [frames, setSelectedFrame]);

  // ── Prev / Next frame ─────────────────────────────────────────────────────
  const handlePrevFrame = useCallback(() => {
    if (!selectedFrame || frames.length === 0) return;
    const idx = frames.findIndex(f => f.id === selectedFrame.id);
    if (idx > 0) {
      handleFrameClick(frames[idx - 1]);
    }
  }, [selectedFrame, frames, handleFrameClick]);

  const handleNextFrame = useCallback(() => {
    if (!selectedFrame || frames.length === 0) return;
    const idx = frames.findIndex(f => f.id === selectedFrame.id);
    if (idx >= 0 && idx < frames.length - 1) {
      handleFrameClick(frames[idx + 1]);
    }
  }, [selectedFrame, frames, handleFrameClick]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
    }
    // reset input so picking the same file re-triggers
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveVideo = () => {
    setVideoFile(null);
  };

  const duration = videoMeta?.duration ?? 0;
  const isExtracting = extraction.status === 'extracting';
  const extractionError = extraction.status === 'error' ? extraction.error : null;
  const pct = extraction.progress.total > 0
    ? Math.round((extraction.progress.current / extraction.progress.total) * 100)
    : 0;

  // ── NO VIDEO UPLOADED EMPTY STATE (Requirement 12) ────────────────────────
  if (!videoBlobUrl && !videoFile && frames.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#030712] p-6">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept="video/mp4,video/quicktime,video/x-msvideo,video/*"
          className="hidden"
          id="video-frames-file-upload-empty"
        />

        <div className="text-center space-y-5 max-w-md p-8 rounded-2xl bg-[#081024]/90 border border-[#16274e] shadow-[0_0_30px_rgba(0,0,0,0.8)]">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-[#0b1633] border border-[#1e3a70] flex items-center justify-center shadow-[0_0_20px_rgba(0,210,255,0.2)]">
            <Film className="w-10 h-10 text-cyan-400" />
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold text-white tracking-tight">
              Upload a drone video to view extracted frames.
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Upload footage from your aerial inspection or drone survey. AeroMesh will automatically extract
              time-indexed keyframes and calculate video specifications.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white text-xs font-semibold shadow-[0_0_15px_rgba(0,210,255,0.4)] transition-all"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Upload Video</span>
            </button>
            <Link
              to="/new-analysis"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#0c1836] border border-[#1d3568] hover:border-cyan-400/50 text-slate-300 hover:text-white text-xs font-medium transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>New Analysis Page</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN ACTIVE LAYOUT ────────────────────────────────────────────────────
  return (
    <div className="w-full h-full overflow-y-auto bg-[#030712]">
      {/* Hidden file input for changing video */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="video/mp4,video/quicktime,video/x-msvideo,video/*"
        className="hidden"
        id="video-frames-file-upload-active"
      />

      <div className="flex gap-3 p-3 min-h-full items-start">

        {/* ══ Column 1: Uploaded Video + Video Info (220px) ════════════════════ */}
        <div className="flex-shrink-0 w-52 space-y-3">

          {/* Uploaded Video Card */}
          <div className="p-3 rounded-xl bg-[#081024] border border-[#142345] space-y-2.5">
            <h3 className="text-[11px] font-bold text-white uppercase tracking-widest">
              Uploaded Video
            </h3>

            {/* Thumbnail preview */}
            <div className="relative aspect-video rounded-lg overflow-hidden border border-[#182c58] bg-black group">
              {videoBlobUrl ? (
                <video
                  src={videoBlobUrl}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#050b18]">
                  <Film className="w-6 h-6 text-slate-600" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <button
                type="button"
                onClick={togglePlay}
                className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-blue-600/85 hover:bg-blue-600 text-white flex items-center justify-center shadow-[0_0_15px_rgba(0,210,255,0.5)] group-hover:scale-110 transition-transform"
                title={isPlaying ? 'Pause video' : 'Play video'}
              >
                {isPlaying
                  ? <Pause className="w-3 h-3 fill-white" />
                  : <Play className="w-3 h-3 fill-white translate-x-px" />
                }
              </button>
            </div>

            {/* File meta & Extraction Status */}
            <div className="flex items-center justify-between text-[11px]">
              <div className="truncate pr-1 flex-1">
                <p className="font-semibold text-slate-200 truncate" title={incident.videoName || videoFile?.name || 'video.mp4'}>
                  {incident.videoName || videoFile?.name || 'video.mp4'}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">
                  {incident.videoSize ?? (videoFile ? (videoFile.size / (1024 * 1024)).toFixed(1) + ' MB' : '—')}
                </p>
              </div>

              {extraction.status === 'done' && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-500/50 text-emerald-400 font-semibold text-[10px] flex items-center gap-1 flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Ready
                </span>
              )}
              {extraction.status === 'extracting' && (
                <span className="px-2 py-0.5 rounded-full bg-blue-950/70 border border-blue-400/50 text-blue-300 font-semibold text-[10px] flex items-center gap-1 flex-shrink-0">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  {pct}%
                </span>
              )}
              {extraction.status === 'error' && (
                <span className="px-2 py-0.5 rounded-full bg-rose-950/70 border border-rose-500/50 text-rose-300 font-semibold text-[10px] flex items-center gap-1 flex-shrink-0">
                  <AlertCircle className="w-2.5 h-2.5" />
                  Error
                </span>
              )}
            </div>

            {/* Action Buttons: Change / Remove */}
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-[#0c1836] border border-[#1d3568] hover:border-cyan-400/50 text-[10px] font-semibold text-slate-300 hover:text-white transition-colors"
                title="Change drone video"
              >
                <RefreshCw className="w-2.5 h-2.5 text-cyan-400" />
                <span>Change</span>
              </button>
              <button
                type="button"
                onClick={handleRemoveVideo}
                className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-[#0c1836] border border-[#1d3568] hover:border-rose-500/50 text-[10px] font-semibold text-slate-300 hover:text-rose-400 transition-colors"
                title="Remove video footage"
              >
                <Trash2 className="w-2.5 h-2.5 text-rose-400" />
                <span>Remove</span>
              </button>
            </div>
          </div>

          {/* Video Info Card — real metadata only, no fabricated values (Requirement 16) */}
          <div className="p-3 rounded-xl bg-[#081024] border border-[#142345] space-y-2.5">
            <h3 className="text-[11px] font-bold text-white uppercase tracking-widest pb-2 border-b border-[#101e3d]">
              Video Info
            </h3>

            {videoMeta ? (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-cyan-400" /> Duration
                  </span>
                  <span className="text-slate-200 font-mono font-semibold">{videoMeta.durationFormatted}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Monitor className="w-3 h-3 text-cyan-400" /> Resolution
                  </span>
                  <span className="text-slate-200 font-mono font-semibold text-right">{videoMeta.resolutionFormatted}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Film className="w-3 h-3 text-cyan-400" /> Extracted Frames
                  </span>
                  <span className="text-slate-200 font-mono font-semibold">{frames.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Eye className="w-3 h-3 text-cyan-400" /> Frame Rate
                  </span>
                  <span className="text-slate-200 font-mono font-semibold">
                    {videoMeta.fps !== null && videoMeta.fps !== undefined
                      ? `${videoMeta.fps} fps`
                      : '—'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 italic py-2 text-center">
                {isExtracting ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                    Reading metadata…
                  </span>
                ) : (
                  'Metadata not available'
                )}
              </div>
            )}
          </div>
        </div>

        {/* ══ Column 2: Main Video Player / Large Preview (flex-1) ══════════════ */}
        <div className="flex-1 min-w-0 rounded-xl bg-[#081024] border border-[#142345] overflow-hidden flex flex-col">

          {/* Main screen */}
          <div
            className="relative bg-black flex items-center justify-center select-none"
            style={{ aspectRatio: '16/10' }}
          >
            {playerError ? (
              <div className="text-center p-6 space-y-2">
                <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
                <p className="text-sm text-slate-300 font-medium">{playerError}</p>
                <p className="text-xs text-slate-500">Try re-uploading or selecting an MP4 video file.</p>
              </div>
            ) : videoBlobUrl ? (
              <>
                {/* Real video player */}
                <video
                  ref={videoRef}
                  src={videoBlobUrl}
                  className="w-full h-full object-contain bg-black"
                  playsInline
                  muted={isMuted}
                  onClick={togglePlay}
                  onError={() => setPlayerError('Video failed to load.')}
                />

                {/* Instant preview overlay when paused & selected frame is available */}
                {!isPlaying && selectedFrame?.imageUrl && (
                  <img
                    src={selectedFrame.imageUrl}
                    alt={`Frame at ${selectedFrame.timestamp}`}
                    className="absolute inset-0 w-full h-full object-contain bg-black pointer-events-none"
                  />
                )}

                {/* Play button overlay (when paused) */}
                {!isPlaying && (
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="absolute w-14 h-14 rounded-full bg-blue-600/85 hover:bg-blue-600 text-white flex items-center justify-center shadow-[0_0_25px_rgba(0,210,255,0.7)] backdrop-blur-sm transition-transform hover:scale-105"
                    title="Play video"
                  >
                    <Play className="w-6 h-6 fill-white translate-x-0.5" />
                  </button>
                )}

                {/* Header labels */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/70 border border-white/10 backdrop-blur-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-[10px] font-mono text-cyan-300 font-bold uppercase tracking-wider">
                    {incident.id || 'DRONE FOOTAGE'}
                  </span>
                </div>

                {selectedFrame && (
                  <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-black/70 border border-white/10 backdrop-blur-sm flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-300">
                      Frame {selectedFrame.frameNumber}/{selectedFrame.totalFrames}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-cyan-300">
                      {selectedFrame.timestamp}
                    </span>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Player controls bar */}
          <div className="p-2.5 bg-[#050b18] border-t border-[#122143] flex items-center gap-3 text-xs text-slate-300">
            {/* Play/Pause */}
            <button
              type="button"
              onClick={togglePlay}
              className="text-slate-300 hover:text-cyan-400 transition-colors flex-shrink-0"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            </button>

            {/* Prev / Next frame buttons (Requirement 7) */}
            <button
              type="button"
              onClick={handlePrevFrame}
              disabled={!selectedFrame || frames.findIndex(f => f.id === selectedFrame.id) === 0}
              className="text-slate-400 hover:text-white disabled:opacity-30 flex-shrink-0 transition-colors"
              title="Previous frame"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNextFrame}
              disabled={!selectedFrame || frames.findIndex(f => f.id === selectedFrame.id) === frames.length - 1}
              className="text-slate-400 hover:text-white disabled:opacity-30 flex-shrink-0 transition-colors"
              title="Next frame"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Timecode */}
            <span className="font-mono text-[11px] text-slate-400 flex-shrink-0 select-none">
              {formatTimestamp(currentTimeSec)} / {videoMeta?.durationFormatted ?? '--:--'}
            </span>

            {/* Scrubber slider */}
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.05}
              value={currentTimeSec}
              onChange={handleScrub}
              className="flex-1 h-1 accent-cyan-400 cursor-pointer bg-slate-700 rounded-lg"
              title="Seek video position"
            />

            {/* Audio Mute toggle */}
            <button
              type="button"
              onClick={() => setIsMuted(m => !m)}
              className="text-slate-400 hover:text-white flex-shrink-0 transition-colors"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Fullscreen */}
            <button
              type="button"
              onClick={() => videoRef.current?.requestFullscreen?.()}
              className="text-slate-400 hover:text-white flex-shrink-0 transition-colors"
              title="Fullscreen"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ══ Column 3: Frame Gallery (280px) ══════════════════════════════════ */}
        <div className="flex-shrink-0 w-72 rounded-xl bg-[#081024] border border-[#142345] p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-[#101e3d]">
            <h3 className="text-[11px] font-bold text-white uppercase tracking-widest">
              Frame Gallery
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-mono">
                {frames.length} frames
              </span>
              <button
                type="button"
                onClick={reloadFrames}
                className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-[#0c1630] transition-colors"
                title="Reload Frames"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* ── Gallery body ─────────────────────────────────────────────── */}
          {isExtracting ? (
            /* Extraction progress */
            <div className="flex-1 flex flex-col items-center justify-center py-10 space-y-3">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <p className="text-xs text-slate-300 font-semibold">Extracting frames…</p>
              <div className="w-full bg-[#101e3d] rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400 font-mono">
                {extraction.progress.current} / {extraction.progress.total}
              </p>
            </div>
          ) : extractionError ? (
            /* Error state */
            <div className="flex-1 flex flex-col items-center justify-center py-8 space-y-3 text-center">
              <AlertCircle className="w-8 h-8 text-rose-500" />
              <p className="text-xs text-rose-400 font-semibold">Frame extraction error</p>
              <p className="text-[10px] text-slate-400 px-2 leading-relaxed">{extractionError}</p>
              <button
                type="button"
                onClick={() => videoFile && setVideoFile(videoFile)}
                className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Retry extraction
              </button>
            </div>
          ) : frames.length === 0 ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center py-8 space-y-2 text-center">
              <Film className="w-8 h-8 text-slate-600" />
              <p className="text-[11px] text-slate-400">No frames extracted</p>
            </div>
          ) : (
            /* Frame thumbnails grid: 4 columns × 3 rows */
            <div className="grid grid-cols-4 gap-1.5">
              {pageFrames.map((frame) => {
                const isSelected = selectedFrame?.id === frame.id;
                return (
                  <button
                    key={frame.id}
                    type="button"
                    onClick={() => handleFrameClick(frame)}
                    className={`relative rounded-md overflow-hidden border transition-all text-left group aspect-[4/3] focus:outline-none ${
                      isSelected
                        ? 'border-cyan-400 shadow-[0_0_12px_rgba(0,210,255,0.7)] ring-1 ring-cyan-400'
                        : 'border-[#14264e] hover:border-slate-400/60 opacity-80 hover:opacity-100'
                    }`}
                    title={`Frame ${frame.frameNumber} at ${frame.timestamp}`}
                  >
                    {frame.imageUrl ? (
                      <img
                        src={frame.imageUrl}
                        alt={`Frame at ${frame.timestamp}`}
                        className="w-full h-full object-cover filter brightness-90 group-hover:brightness-100 transition-all"
                        loading="eager"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = '/assets/frames/bridge/frame_01.jpg';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full bg-[#0a1226] flex items-center justify-center">
                        <Film className="w-3 h-3 text-slate-600" />
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-black/85 px-0.5 py-px text-center">
                      <span className="text-[8px] font-mono text-slate-200 font-semibold">{frame.timestamp}</span>
                    </div>
                    {isSelected && <div className="absolute inset-0 bg-cyan-400/15" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Pagination (Requirement 8) */}
          {!isExtracting && !extractionError && frames.length > FRAMES_PER_PAGE && (
            <div className="flex items-center justify-between pt-1 border-t border-[#101e3d] text-xs">
              <span className="text-[10px] text-slate-500 font-mono">
                Page {currentPage} of {totalPages}
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={`page-${page}`}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={`w-5 h-5 rounded flex items-center justify-center font-mono text-[10px] transition-colors ${
                      currentPage === page
                        ? 'bg-blue-600 text-white font-bold shadow-[0_0_8px_rgba(37,99,235,0.5)]'
                        : 'text-slate-400 hover:text-white hover:bg-[#0c1836]'
                    }`}
                  >
                    {page}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ══ Column 4: Frame Details (200px) ══════════════════════════════════ */}
        <div className="flex-shrink-0 w-48 rounded-xl bg-[#081024] border border-[#142345] p-3 space-y-3">

          <div className="flex items-center justify-between pb-2 border-b border-[#101e3d]">
            <h3 className="text-[11px] font-bold text-white uppercase tracking-widest">
              Frame Details
            </h3>
            {selectedFrame && (
              <button
                type="button"
                onClick={() => setSelectedFrame(null)}
                className="text-slate-400 hover:text-white transition-colors"
                title="Deselect frame"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {selectedFrame ? (
            <>
              {/* Selected frame preview thumbnail */}
              <div className="rounded-lg overflow-hidden border border-[#182c58] aspect-video bg-black shadow-inner">
                {selectedFrame.imageUrl ? (
                  <img
                    src={selectedFrame.imageUrl}
                    alt={`Frame at ${selectedFrame.timestamp}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-5 h-5 text-slate-600" />
                  </div>
                )}
              </div>

              {/* Frame information */}
              <div className="space-y-1">
                <h4 className="text-[11px] font-bold text-white">
                  Frame {selectedFrame.frameNumber} / {selectedFrame.totalFrames}
                </h4>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>Timestamp:</span>
                  <span className="text-cyan-300 font-bold">{selectedFrame.timestamp}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>Time Offset:</span>
                  <span className="text-slate-300">{selectedFrame.timestampSeconds.toFixed(2)}s</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>Resolution:</span>
                  <span className="text-slate-300">{videoMeta?.resolutionFormatted ?? '—'}</span>
                </div>
              </div>

              {/* Prev / Next controls */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handlePrevFrame}
                  disabled={frames.findIndex(f => f.id === selectedFrame.id) === 0}
                  className="flex-1 py-1.5 rounded-lg bg-[#0c1836] border border-[#1d3568] hover:border-cyan-400/50 text-[10px] font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-30 flex items-center justify-center gap-1"
                >
                  <ChevronLeft className="w-3 h-3" /> Prev
                </button>
                <button
                  type="button"
                  onClick={handleNextFrame}
                  disabled={frames.findIndex(f => f.id === selectedFrame.id) === frames.length - 1}
                  className="flex-1 py-1.5 rounded-lg bg-[#0c1836] border border-[#1d3568] hover:border-cyan-400/50 text-[10px] font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-30 flex items-center justify-center gap-1"
                >
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* Real Detections State (Requirements 13 & 14) */}
              {/* Do NOT fabricate detections. Show "No detections available". */}
              <div className="space-y-2 pt-2 border-t border-[#101e3d]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-300">Detections</span>
                  <span className="text-[9px] text-amber-400/80 font-mono">Ready for AI</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#060c1c] border border-[#121f3d] text-center space-y-1.5">
                  <p className="text-[10px] font-semibold text-slate-300">No detections available</p>
                  <p className="text-[9px] text-slate-500 leading-relaxed">
                    AI detection models (vehicles, people, fire, smoke, damage) will populate here once connected.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 space-y-2 text-center">
              <Film className="w-6 h-6 text-slate-600" />
              <p className="text-[10px] text-slate-400">
                {frames.length > 0
                  ? 'Click a frame to view details'
                  : 'No frames available'}
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
