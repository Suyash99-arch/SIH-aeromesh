import React, { useRef, useEffect, useState, useCallback } from 'react';
import Icon from '../ui/Icon';

const REAL_PIPELINE_STAGES = [
  { id: 1, tag: 'INGEST', name: '1. Video Ingestion & Container Validation' },
  { id: 2, tag: 'KEYFRAME', name: '2. Dynamic Keyframes & Laplacian Blur Gate' },
  { id: 3, tag: 'YOLO11', name: '3. YOLO11 Neural Multi-Class Detection' },
  { id: 4, tag: 'TRACK', name: '4. ByteTrack Trajectory Association' },
  { id: 5, tag: 'SfM', name: '5. PyCOLMAP Sparse Structure-from-Motion' },
  { id: 6, tag: 'SCALE', name: '6. Photogrammetric Scale & GIS Calibration' },
  { id: 7, tag: 'FUSION', name: '7. 3D Spatial Fusion & Triangulation' },
  { id: 8, tag: 'EXPORT', name: '8. Certified Deliverables & GeoJSON Export' },
];

export default function NarrativePipelineSequence() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 1
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);

  const durationMs = 6800; // Under 7 seconds for snappy presentation
  const animStateRef = useRef({
    startTime: null,
    rafId: null,
    inView: false,
    hasAutoStarted: false,
    isPaused: false,
    pauseStartTime: null,
    totalPausedMs: 0,
  });

  const replay = useCallback(() => {
    animStateRef.current.startTime = performance.now();
    animStateRef.current.totalPausedMs = 0;
    animStateRef.current.pauseStartTime = null;
    animStateRef.current.isPaused = false;
    setIsPaused(false);
    setIsPlaying(true);
    setProgress(0);
    setActiveStageIdx(0);
  }, []);

  const togglePause = useCallback(() => {
    const now = performance.now();
    if (animStateRef.current.isPaused) {
      // Resume
      if (animStateRef.current.pauseStartTime) {
        animStateRef.current.totalPausedMs += (now - animStateRef.current.pauseStartTime);
        animStateRef.current.pauseStartTime = null;
      }
      animStateRef.current.isPaused = false;
      setIsPaused(false);
      setIsPlaying(true);
    } else {
      // Pause
      animStateRef.current.pauseStartTime = now;
      animStateRef.current.isPaused = true;
      setIsPaused(true);
    }
  }, []);

  const skipForward = useCallback(() => {
    const now = performance.now();
    setActiveStageIdx((prev) => {
      const nextIdx = Math.min(7, prev + 1);
      const targetP = Math.min(1, (nextIdx + 0.1) / 8);
      setProgress(targetP);

      const totalPaused = animStateRef.current.totalPausedMs +
        (animStateRef.current.isPaused && animStateRef.current.pauseStartTime ? (now - animStateRef.current.pauseStartTime) : 0);
      animStateRef.current.startTime = now - totalPaused - targetP * durationMs;

      return nextIdx;
    });
  }, [durationMs]);

  // IntersectionObserver to trigger on scroll into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          animStateRef.current.inView = true;
          if (!animStateRef.current.hasAutoStarted) {
            animStateRef.current.hasAutoStarted = true;
            replay();
          }
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [replay]);

  // Canvas 60fps render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    // Precomputed synthetic 3D points for SfM & Mesh stages
    const points3D = [];
    for (let i = 0; i < 90; i++) {
      const px = (Math.random() - 0.5) * 280;
      const py = (Math.random() - 0.5) * 120 + Math.sin(i * 0.4) * 30;
      const pz = (Math.random() - 0.5) * 80;
      points3D.push({ x: px, y: py, z: pz, id: i });
    }

    const render = (now) => {
      if (!animStateRef.current.startTime) {
        animStateRef.current.startTime = now;
      }

      const totalPaused = animStateRef.current.totalPausedMs +
        (animStateRef.current.isPaused && animStateRef.current.pauseStartTime ? (now - animStateRef.current.pauseStartTime) : 0);

      let p = (now - animStateRef.current.startTime - totalPaused) / durationMs;
      if (p > 1) {
        p = 1;
        setIsPlaying(false);
        setHasPlayedOnce(true);
      }

      setProgress(p);

      // Determine active stage (0..7)
      const stageIdx = Math.min(7, Math.floor(p * 8));
      setActiveStageIdx(stageIdx);

      // Clear Canvas
      ctx.clearRect(0, 0, width, height);

      // Background subtle grid
      ctx.strokeStyle = 'rgba(79, 216, 255, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const cx = width * 0.5;
      const cy = height * 0.52;

      // =========================================================================
      // PHASE 1: STAGE 1 & 2 - DRONE FLIGHT & DYNAMIC KEYFRAME EXTRACTION (0.0 to 0.28)
      // =========================================================================
      const p1 = Math.min(1, p / 0.28);
      // Drone position flying from left to center-right
      const droneX = width * 0.14 + p1 * (width * 0.45);
      const droneY = height * 0.26 + Math.sin(p1 * Math.PI * 4) * 8;

      // Flight Waypoint Trajectory (dashed line)
      ctx.strokeStyle = 'rgba(79, 216, 255, 0.35)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(width * 0.1, height * 0.26);
      ctx.lineTo(width * 0.65, height * 0.26);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Drone Icon (Hexacopter stylized geometry)
      ctx.save();
      ctx.translate(droneX, droneY);
      // Drone Body Glow
      ctx.shadowColor = '#4fd8ff';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#4fd8ff';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();

      // Rotor arms & rotating blades
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.5;
      const rotorDist = 16;
      const rotorAngles = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
      rotorAngles.forEach((ang) => {
        const rx = Math.cos(ang) * rotorDist;
        const ry = Math.sin(ang) * rotorDist;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(rx, ry);
        ctx.stroke();

        // Spinning rotor tip
        ctx.fillStyle = 'rgba(79, 216, 255, 0.5)';
        ctx.beginPath();
        ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // Camera Nadir Sensor Cone projecting to ground
      ctx.fillStyle = 'rgba(79, 216, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(droneX, droneY + 5);
      ctx.lineTo(droneX - 45, height * 0.88);
      ctx.lineTo(droneX + 45, height * 0.88);
      ctx.closePath();
      ctx.fill();

      // Peeling Frame Thumbnails dropping from camera to analysis deck
      if (p1 > 0.15) {
        const frameCount = 4;
        for (let i = 0; i < frameCount; i++) {
          const frameProgress = (p1 - 0.15 * (i + 1)) * 2.2;
          if (frameProgress > 0 && frameProgress < 1.4) {
            const dropX = droneX - 30 - i * 35;
            const dropY = droneY + 25 + Math.min(1, frameProgress) * 70;
            const alpha = Math.max(0, 1 - frameProgress * 0.4);

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = 'rgba(14, 26, 46, 0.85)';
            ctx.strokeStyle = '#4fd8ff';
            ctx.lineWidth = 1;
            ctx.strokeRect(dropX - 16, dropY - 10, 32, 20);
            ctx.fillRect(dropX - 16, dropY - 10, 32, 20);

            // Shimmering keyframe scanline
            ctx.fillStyle = 'rgba(79, 216, 255, 0.4)';
            ctx.fillRect(dropX - 14, dropY - 2, 28, 2);

            // Laplacian Tag
            ctx.fillStyle = '#9bb0cc';
            ctx.font = '600 7px JetBrains Mono, monospace';
            ctx.fillText(`KF_0${i + 1}`, dropX - 12, dropY + 6);
            ctx.restore();
          }
        }
      }

      // =========================================================================
      // PHASE 2: STAGE 3 & 4 - YOLO11 DETECTION BOXES & TRACK TRAILS (0.24 to 0.52)
      // =========================================================================
      if (p > 0.22) {
        const p2 = Math.min(1, (p - 0.22) / 0.3);
        const cardX = width * 0.28;
        const cardY = cy - 40;
        const cardW = Math.min(220, width * 0.38);
        const cardH = 130;

        // Bounding Box 1: [car 94%]
        const b1X = cardX + 20;
        const b1Y = cardY + 25;
        const b1W = 60 * Math.min(1, p2 * 2.5);
        const b1H = 34 * Math.min(1, p2 * 2.5);

        ctx.strokeStyle = '#4fd8ff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b1X, b1Y, b1W, b1H);
        ctx.fillStyle = 'rgba(79, 216, 255, 0.12)';
        ctx.fillRect(b1X, b1Y, b1W, b1H);

        // ByteTrack Trajectory Trail
        if (p2 > 0.3) {
          ctx.strokeStyle = 'rgba(79, 216, 255, 0.7)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(b1X - 25, b1Y + b1H * 0.5);
          ctx.lineTo(b1X, b1Y + b1H * 0.5);
          ctx.stroke();

          // Pill tag
          ctx.fillStyle = '#4fd8ff';
          ctx.fillRect(b1X, b1Y - 12, 54, 12);
          ctx.fillStyle = '#05070c';
          ctx.font = '700 8px JetBrains Mono, monospace';
          ctx.fillText('car 94% T1', b1X + 3, b1Y - 3);
        }

        // Bounding Box 2: [truck 88%]
        const b2X = cardX + 105;
        const b2Y = cardY + 50;
        const b2W = 75 * Math.min(1, p2 * 2);
        const b2H = 42 * Math.min(1, p2 * 2);

        ctx.strokeStyle = '#8b7bff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b2X, b2Y, b2W, b2H);
        ctx.fillStyle = 'rgba(139, 123, 255, 0.12)';
        ctx.fillRect(b2X, b2Y, b2W, b2H);

        if (p2 > 0.4) {
          ctx.fillStyle = '#8b7bff';
          ctx.fillRect(b2X, b2Y - 12, 60, 12);
          ctx.fillStyle = '#05070c';
          ctx.font = '700 8px JetBrains Mono, monospace';
          ctx.fillText('truck 88% T2', b2X + 3, b2Y - 3);
        }
      }

      // =========================================================================
      // PHASE 3: STAGE 5 & 6 - SPARSE SfM POINT CLOUD & SCALE (0.48 to 0.78)
      // =========================================================================
      if (p > 0.46) {
        const p3 = Math.min(1, (p - 0.46) / 0.32);
        const sfmCenterX = width * 0.68;
        const sfmCenterY = cy;

        // Rotating camera bundle stations (pyramids / frustums)
        const rotAngle = p * 1.8;
        const visiblePtsCount = Math.floor(points3D.length * p3);

        // Draw accumulating 3D sparse points
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#4fd8ff';
        for (let i = 0; i < visiblePtsCount; i++) {
          const pt = points3D[i];
          const rx = pt.x * Math.cos(rotAngle) - pt.z * Math.sin(rotAngle);
          const rz = pt.x * Math.sin(rotAngle) + pt.z * Math.cos(rotAngle);
          const scrX = sfmCenterX + rx;
          const scrY = sfmCenterY + pt.y;

          ctx.fillStyle = i % 3 === 0 ? '#8b7bff' : '#4fd8ff';
          ctx.beginPath();
          ctx.arc(scrX, scrY, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;

        // Epipolar Ray Rays connecting camera stations to points
        if (p3 > 0.25) {
          ctx.strokeStyle = 'rgba(79, 216, 255, 0.16)';
          ctx.lineWidth = 0.8;
          for (let j = 0; j < Math.min(14, visiblePtsCount); j += 2) {
            const pA = points3D[j];
            const pB = points3D[(j + 4) % points3D.length];
            ctx.beginPath();
            ctx.moveTo(sfmCenterX + pA.x, sfmCenterY + pA.y);
            ctx.lineTo(sfmCenterX + pB.x, sfmCenterY + pB.y);
            ctx.stroke();
          }
        }

        // Scale Metric Ruler locked in
        if (p3 > 0.6) {
          ctx.strokeStyle = '#4ee38a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sfmCenterX - 60, height * 0.8);
          ctx.lineTo(sfmCenterX + 60, height * 0.8);
          ctx.moveTo(sfmCenterX - 60, height * 0.8 - 5);
          ctx.lineTo(sfmCenterX - 60, height * 0.8 + 5);
          ctx.moveTo(sfmCenterX + 60, height * 0.8 - 5);
          ctx.lineTo(sfmCenterX + 60, height * 0.8 + 5);
          ctx.stroke();

          ctx.fillStyle = '#4ee38a';
          ctx.font = '700 9px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('METRIC CALIBRATED · 10.0m BASELINE', sfmCenterX, height * 0.8 + 16);
          ctx.textAlign = 'left';
        }
      }

      // =========================================================================
      // PHASE 4: STAGE 7 & 8 - 3D WIREFRAME MESH RESOLUTION & FINAL DELIVERY (0.76 to 1.0)
      // =========================================================================
      if (p > 0.76) {
        const p4 = Math.min(1, (p - 0.76) / 0.24);
        const meshCenterX = width * 0.68;
        const meshCenterY = cy;

        // Triangulate between neighboring points to show wireframe mesh resolving
        ctx.strokeStyle = `rgba(79, 216, 255, ${0.15 + p4 * 0.55})`;
        ctx.lineWidth = 1.2;

        const maxMeshEdges = Math.floor(45 * p4);
        for (let i = 0; i < maxMeshEdges; i++) {
          const idxA = (i * 2) % points3D.length;
          const idxB = (i * 2 + 1) % points3D.length;
          const idxC = (i * 2 + 2) % points3D.length;

          const ang = p * 2.5;
          const pA = points3D[idxA];
          const pB = points3D[idxB];
          const pC = points3D[idxC];

          const ax = meshCenterX + (pA.x * Math.cos(ang) - pA.z * Math.sin(ang));
          const ay = meshCenterY + pA.y;
          const bx = meshCenterX + (pB.x * Math.cos(ang) - pB.z * Math.sin(ang));
          const by = meshCenterY + pB.y;
          const cxPt = meshCenterX + (pC.x * Math.cos(ang) - pC.z * Math.sin(ang));
          const cyPt = meshCenterY + pC.y;

          // Wireframe Triangle
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.lineTo(cxPt, cyPt);
          ctx.closePath();
          ctx.stroke();

          // Holographic Facet Fill
          ctx.fillStyle = 'rgba(79, 216, 255, 0.04)';
          ctx.fill();
        }
      }

      animStateRef.current.rafId = requestAnimationFrame(render);
    };

    animStateRef.current.rafId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      if (animStateRef.current.rafId) {
        cancelAnimationFrame(animStateRef.current.rafId);
      }
    };
  }, [durationMs]);

  return (
    <div ref={containerRef} className="narrative-pipeline-card glass">
      <div className="glass-sheen" aria-hidden="true" />

      {/* Card Header with Real Stage Count & Playback Controls */}
      <div className="pipeline-narrative-header">
        <div className="narrative-title-wrap">
          <div className="glowing-icon-circle">
            <Icon name="Layers" size={20} />
          </div>
          <div>
            <div className="narrative-badge">
              <span className="pulse-dot-cyan" />
              <span>REAL-TIME 8-STAGE PHOTOGRAMMETRIC ENGINE</span>
            </div>
            <h3 className="narrative-heading">Autonomous Pipeline in Motion</h3>
          </div>
        </div>

        {/* Narrative Playback Controls: Pause/Play, Skip Forward, Replay */}
        <div className="narrative-header-actions">
          <button
            type="button"
            className="narrative-ctrl-btn"
            onClick={togglePause}
            aria-label={isPaused ? 'Resume pipeline sequence' : 'Pause pipeline sequence'}
            title={isPaused ? 'Resume sequence' : 'Pause sequence'}
          >
            <Icon name={isPaused ? 'Play' : 'Pause'} size={14} />
            <span>{isPaused ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            type="button"
            className="narrative-ctrl-btn"
            onClick={skipForward}
            aria-label="Skip to next pipeline stage"
            title="Step forward to next stage"
            disabled={activeStageIdx >= 7 && progress >= 1}
          >
            <Icon name="ChevronRight" size={14} />
            <span>Forward</span>
          </button>

          <button
            type="button"
            className="narrative-replay-btn"
            onClick={replay}
            aria-label="Replay pipeline sequence"
            title="Restart pipeline from stage 1"
          >
            <Icon name="RotateCcw" size={14} />
            <span>Replay</span>
          </button>
        </div>
      </div>

      {/* 60FPS Narrative Canvas Viewport + Completion Overlay Badge */}
      <div className="narrative-canvas-container">
        <canvas ref={canvasRef} className="narrative-canvas" />

        {/* Guaranteed Non-Overflowing Completion Badge */}
        {progress >= 0.88 && (
          <div className="narrative-completion-badge-wrap" id="narrative-completion-badge">
            <div className="narrative-completion-badge">
              <div className="completion-badge-icon">✓</div>
              <div className="completion-badge-body">
                <span className="completion-badge-title">8/8 PIPELINE STAGES VERIFIED</span>
                <span className="completion-badge-sub">3D Model · GeoJSON · PDF Engineering Handoff Ready</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stage Progress Bar & Indicators */}
      <div className="narrative-stages-dock">
        <div className="narrative-stages-strip">
          {REAL_PIPELINE_STAGES.map((stg, idx) => {
            const isPassed = idx < activeStageIdx;
            const isCurrent = idx === activeStageIdx;
            return (
              <div
                key={stg.id}
                className={`narrative-stage-item ${isPassed ? 'passed' : ''} ${
                  isCurrent ? 'current' : ''
                }`}
                onClick={() => {
                  // Direct jump to clicked stage
                  const targetP = (idx + 0.1) / 8;
                  const now = performance.now();
                  const totalPaused = animStateRef.current.totalPausedMs +
                    (animStateRef.current.isPaused && animStateRef.current.pauseStartTime ? (now - animStateRef.current.pauseStartTime) : 0);
                  animStateRef.current.startTime = now - totalPaused - targetP * durationMs;
                  setProgress(targetP);
                  setActiveStageIdx(idx);
                }}
                style={{ cursor: 'pointer' }}
                title={`Jump to stage ${stg.id}: ${stg.name}`}
              >
                <div className="stage-step-bubble">
                  {isPassed ? '✓' : stg.id}
                </div>
                <div className="stage-step-info">
                  <span className="stage-step-tag">{stg.tag}</span>
                  <span className="stage-step-name">{stg.name}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Continuous Progress Fill */}
        <div className="narrative-progress-track">
          <div
            className="narrative-progress-fill"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
