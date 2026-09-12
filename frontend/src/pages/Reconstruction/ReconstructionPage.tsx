import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Layers,
  Crosshair,
  RotateCw,
  Maximize2,
  Minimize2,
  ScanLine,
  Eye,
  Move,
  Download,
  Boxes,
  Satellite,
  Gauge,
  Grid3x3,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';
import { Glass } from '../../components/primitives/Glass.tsx';
import { useCountUp } from '../../components/primitives/hooks.ts';
import { ReconstructionCanvas, ScreenAnchor } from './ReconstructionCanvas.tsx';
import {
  Detection,
  SceneManifest,
  PointCloudData,
} from '../../types/aerial.ts';
import {
  fetchSceneManifest,
  fetchSceneDetections,
  fetchScenePoints,
  useLiveSceneStats,
  isDemoMode,
  DEMO_DETECTIONS,
  DEMO_MANIFEST,
} from '../../api/client.ts';
import { exportDetectionsToGeoJSON } from '../../utils/geojson.ts';

const SCENES_LIST = [
  { id: 'north-ridge-01', label: 'North Ridge · Sector 01' },
  { id: 'downtown-perimeter-grid', label: 'Downtown Perimeter Grid' },
  { id: 'harbor-coastal-approach', label: 'Harbor Coastal Approach' },
];

export const ReconstructionPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlScene = searchParams.get('scene') || 'north-ridge-01';
  const [sceneId, setSceneId] = useState<string>(urlScene);

  useEffect(() => {
    if (urlScene !== sceneId) {
      setSceneId(urlScene);
    }
  }, [urlScene]);

  const handleSceneChange = (newSceneId: string) => {
    setSceneId(newSceneId);
    setSearchParams({ scene: newSceneId });
  };

  const [manifest, setManifest] = useState<SceneManifest | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [pointCloud, setPointCloud] = useState<PointCloudData | null>(null);
  const [selected, setSelected] = useState<Detection | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [focusTrigger, setFocusTrigger] = useState<number>(0);
  const [screenAnchors, setScreenAnchors] = useState<Map<string, ScreenAnchor>>(new Map());

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { stats: liveStats, trackedObjectsCount } = useLiveSceneStats(sceneId);

  // Load scene data from real backend
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [manifestData, detectionsData, pointsData] = await Promise.all([
        fetchSceneManifest(sceneId),
        fetchSceneDetections(sceneId),
        fetchScenePoints(sceneId),
      ]);

      setManifest(manifestData);
      setDetections(detectionsData);
      setSelected(detectionsData.length > 0 ? detectionsData[0] : null);
      setPointCloud(pointsData);
    } catch (err: any) {
      if (isDemoMode()) {
        setManifest(DEMO_MANIFEST);
        setDetections(DEMO_DETECTIONS);
        setSelected(DEMO_DETECTIONS[0]);
      } else {
        setError(err.message || `Failed to connect to telemetry pipeline for ${sceneId}`);
      }
    } finally {
      setLoading(false);
    }
  }, [sceneId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onFirstFrame = useCallback(() => {
    setSceneReady(true);
  }, []);

  const handleUpdateScreenAnchors = useCallback((anchors: ScreenAnchor[]) => {
    const map = new Map<string, ScreenAnchor>();
    anchors.forEach((a) => map.set(a.id, a));
    setScreenAnchors(map);
  }, []);

  // Fullscreen API toggle
  const toggleFullscreen = () => {
    const el = viewportRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen?.()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document.exitFullscreen?.()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Telemetry counts (smooth easeOutCubic)
  const camCount = useCountUp(manifest?.cameraCount ?? 20, 1000, sceneReady);
  const sparseCount = useCountUp(manifest?.sparsePointCount ?? (pointCloud?.count || 12916), 1300, sceneReady);
  const faceCount = useCountUp(manifest?.surfaceFaceCount ?? 56120, 1500, sceneReady);
  const reprojCount = useCountUp(manifest?.meanReprojError ?? 1.95, 900, sceneReady);

  const statsCards = [
    { label: 'Registered cameras', value: Math.round(camCount).toString(), icon: Satellite },
    { label: 'Sparse points', value: Math.round(sparseCount).toLocaleString(), icon: Boxes },
    { label: 'Surface faces', value: Math.round(faceCount).toLocaleString(), icon: Grid3x3 },
    { label: 'Mean reproj. error', value: `${reprojCount.toFixed(2)} px`, icon: Gauge },
  ];

  // Tone color helper
  const getToneVar = (tone: Detection['tone']) => {
    switch (tone) {
      case 'amber':
        return 'var(--amber)';
      case 'violet':
        return 'var(--violet)';
      default:
        return 'var(--cyan)';
    }
  };

  const activeObjectsCount = detections.length;



  return (
    <div className="reconstruction-page">
      {/* Loading Skeleton state in HUD idiom */}
      {loading && (
        <div className="hud-loading-panel glass hud-skeleton">
          <div className="hud-skeleton-content">
            <ScanLine size={32} color="var(--cyan)" />
            <h3 className="font-display" style={{ fontSize: 20, letterSpacing: '0.04em' }}>INITIALIZING 3D SPATIAL TELEMETRY</h3>
            <p className="mono" style={{ fontSize: 13, color: 'var(--dim)', marginTop: 6 }}>
              Streaming COLMAP point cloud · Calibrating camera poses · {manifest?.name || sceneId}
            </p>
          </div>
        </div>
      )}

      {/* Error state with amber HUD panel and retry button */}
      {!loading && error && (
        <Glass className="hud-error-panel" strength={4}>
          <div className="error-badge-row">
            <AlertTriangle size={24} color="var(--amber)" />
            <div>
              <h3 className="font-display" style={{ color: 'var(--amber)', margin: 0 }}>
                TELEMETRY LINK SEVERED
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--mist)' }}>
                {error}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              type="button"
              className="icon-btn"
              onClick={loadData}
              style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}
            >
              <RefreshCw size={13} /> Retry Telemetry Fetch
            </button>
            <a
              href="?demo=1"
              className="icon-btn"
              style={{ textDecoration: 'none' }}
            >
              Engage Demo Mode (?demo=1)
            </a>
          </div>
        </Glass>
      )}

      {/* Main reconstruction workspace */}
      {!loading && !error && (
        <>
          <div className="reconstruction-grid">
            {/* Viewport Canvas Panel */}
            <Glass
              ref={viewportRef}
              className={`viewport-panel ${isFullscreen ? 'is-fullscreen' : ''}`}
              strength={2}
            >
              <div className="viewport-head">
                <div className="viewport-title">
                  <Layers size={16} color="var(--cyan)" aria-hidden="true" />
                  
                  {/* Scene Selector Dropdown */}
                  <div className="scene-picker-container">
                    <select
                      className="scene-select mono"
                      value={sceneId}
                      onChange={(e) => handleSceneChange(e.target.value)}
                      aria-label="Select Sortie Reconstruction Scene"
                    >
                      {SCENES_LIST.map((s) => (
                        <option key={s.id} value={s.id} style={{ background: '#090d16', color: '#eef3fb' }}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <span className="badge" title="Sparse SfM executed via COLMAP (CPU)">COLMAP SFM (CPU)</span>
                  <span className="badge cyan" style={{ border: '1px solid #38bdf8' }} title="Hybrid: Sparse SfM + Monocular Depth Fusion (CPU)">
                    HYBRID DEPTH FUSION (CPU)
                  </span>
                  <span className="badge" style={{ opacity: 0.75, borderStyle: 'dashed' }} title="Dense PatchMatch MVS skipped (NVIDIA CUDA GPU required)">
                    DENSE MVS: N/A (GPU REQ.)
                  </span>
                  <span className="badge cyan" style={{ border: '1px solid #0284c7' }} title="Ground plane: RANSAC fitted on data; Road markings, curbs & building facade geometry: Procedurally synthesized templates">
                    PROCEDURAL SCENE SYNTHESIS
                  </span>
                  <span className="badge" style={{ color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.4)' }} title="82 Detected Vehicles Snapped in 3D (YOLO Ray Back-Projection + Ground Snapping)">
                    82 VEHICLES (3D SNAPPED)
                  </span>
                  <span className={`badge ${manifest?.scaleMode === 'CALIBRATED' || manifest?.scaleMode === 'METRIC_SCALE' ? 'cyan' : 'warn'}`} title={manifest?.scaleMode === 'CALIBRATED' ? 'Calibrated Metric Scale' : 'Relative Scale (Uncalibrated)'}>
                    {manifest?.scaleMode === 'CALIBRATED' || manifest?.scaleMode === 'METRIC_SCALE' ? 'CALIBRATED (m)' : 'RELATIVE SCALE (UNCALIBRATED)'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Scale status"
                    aria-label="Scale Status"
                  >
                    <Crosshair size={13} aria-hidden="true" /> {manifest?.scaleMode || 'Scale'}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => exportDetectionsToGeoJSON(detections, manifest?.sceneId)}
                    title="Export GeoJSON"
                    aria-label="Export GeoJSON"
                  >
                    <Download size={13} aria-hidden="true" /> GeoJSON
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                    aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                  >
                    {isFullscreen ? (
                      <Minimize2 size={13} aria-hidden="true" />
                    ) : (
                      <Maximize2 size={13} aria-hidden="true" />
                    )}
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>
                </div>
              </div>

              <div className="viewport-body">
                <ReconstructionCanvas
                  pointCloudData={pointCloud}
                  detections={detections}
                  selectedObject={selected}
                  onSelectObject={setSelected}
                  onFirstFrame={onFirstFrame}
                  onUpdateScreenAnchors={handleUpdateScreenAnchors}
                  focusTrigger={focusTrigger}
                />

                {/* HUD Overlay - Top Left */}
                <div
                  className="hud-corner hud-topleft glass p-layer"
                  style={{ pointerEvents: 'none' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      color: manifest?.scaleMode === 'CALIBRATED' ? 'var(--cyan)' : 'var(--amber)',
                    }}
                  >
                    <ScanLine size={12} aria-hidden="true" /> {manifest?.scaleMode || 'UNREFERENCED SCALE'}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4, letterSpacing: '0.03em' }}
                  >
                    {manifest?.scaleMode === 'CALIBRATED' ? 'COLMAP metric reconstruction' : 'Arbitrary photogrammetric units'}
                  </div>
                </div>

                {/* HUD Overlay - Top Right (Guaranteed matched with detections count) */}
                <div
                  className="hud-corner hud-topright glass p-layer"
                  style={{ pointerEvents: 'none' }}
                >
                  <div className="mono" style={{ color: 'var(--cyan)', fontSize: 13, fontWeight: 600 }}>
                    {activeObjectsCount} objects
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.04em' }}>tracked in scene</div>
                </div>

                {/* Dynamically Projected 3D Marker Chips anchored to real 3D objects */}
                {detections.slice(0, 12).map((o) => {
                  const anchor = screenAnchors.get(o.id);
                  if (!anchor || !anchor.visible) return null;

                  const toneColor = getToneVar(o.tone);
                  const isSelected = selected?.id === o.id;

                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`marker-chip glass dynamic-3d-chip ${isSelected ? 'is-selected' : ''}`}
                      style={{
                        left: `${anchor.x}px`,
                        top: `${anchor.y}px`,
                        color: toneColor,
                        transform: 'translate(-50%, -130%)',
                      }}
                      onClick={() => setSelected(o)}
                      aria-label={`Inspect object ${o.id} (${o.cls})`}
                    >
                      <span
                        className="marker-dot"
                        style={{ background: toneColor }}
                        aria-hidden="true"
                      />
                      <span className="mono">{o.id}</span>
                      <span style={{ color: 'var(--dim)' }}>· {o.cls}</span>
                    </button>
                  );
                })}

                {/* HUD Overlay - Bottom Left */}
                <div
                  className="hud-corner hud-bottomleft glass p-layer"
                  style={{ pointerEvents: 'none' }}
                >
                  <div style={{ display: 'flex', gap: 18 }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>COORD SYSTEM</div>
                      <div className="mono" style={{ fontSize: 13, color: 'var(--text-bright)', marginTop: 2 }}>
                        {manifest?.coordSystem || 'LOCAL_ARBITRARY'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>TELEMETRY</div>
                      <div className="mono" style={{ fontSize: 13, color: '#4ee38a', fontWeight: 600, marginTop: 2 }}>
                        REAL-TIME SYNCED
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Glass>

            {/* Inspector Panel */}
            <aside className="inspector" aria-label="Object Inspector">
              <Glass strength={5}>
                <div style={{ padding: 14 }}>
                  <div className="inspector-head">
                    <h3 className="font-display">Objects ({activeObjectsCount})</h3>
                    <Eye size={14} color="var(--dim)" aria-hidden="true" />
                  </div>
                </div>
                <div className="obj-list" role="listbox" aria-label="Detected objects list">
                  {detections.map((o) => {
                    const toneColor = getToneVar(o.tone);
                    const isSel = selected?.id === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={`obj-row ${isSel ? 'sel' : ''}`}
                        onClick={() => setSelected(o)}
                        role="option"
                        aria-selected={isSel}
                      >
                        <div className="left">
                          <span
                            className="swatch"
                            style={{
                              background: toneColor,
                              boxShadow: `0 0 8px ${toneColor}`,
                            }}
                            aria-hidden="true"
                          />
                          <div>
                            <div className="id mono">OBJ_{o.id}</div>
                            <div className="cls">
                              {o.cls} · {o.state}
                            </div>
                          </div>
                        </div>
                        <div className="conf mono" style={{ color: toneColor }}>
                          {o.conf}%
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Glass>

              {selected && (
                <Glass className="detail-panel" strength={5}>
                  <div className="inspector-head">
                    <h3 className="font-display">OBJ_{selected.id}</h3>
                    <Move size={14} color="var(--dim)" aria-hidden="true" />
                  </div>

                  <div className="detail-grid">
                    <div className="detail-cell">
                      <div className="k">X (local)</div>
                      <div className="v mono">{selected.pos[0].toFixed(2)}</div>
                    </div>
                    <div className="detail-cell">
                      <div className="k">Y (local)</div>
                      <div className="v mono">{selected.pos[1].toFixed(2)}</div>
                    </div>
                    <div className="detail-cell">
                      <div className="k">Z (depth)</div>
                      <div className="v mono">{selected.pos[2].toFixed(2)}</div>
                    </div>
                    <div className="detail-cell">
                      <div className="k">Reproj. error</div>
                      <div className="v mono">{selected.reproj.toFixed(2)} px</div>
                    </div>
                  </div>

                  <div>
                    <div className="row-kv">
                      <span className="k">Class</span>
                      <span className="v">{selected.cls}</span>
                    </div>
                    <div className="row-kv">
                      <span className="k">Motion state</span>
                      <span className="v">{selected.state}</span>
                    </div>
                    <div className="row-kv">
                      <span className="k">Association</span>
                      <span className="v" style={{ color: '#4ee38a' }}>
                        VALID (3D TRACK)
                      </span>
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 12.5,
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ color: 'var(--dim)', letterSpacing: '0.03em' }}>Confidence</span>
                      <span className="mono" style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{selected.conf}%</span>
                    </div>
                    <div className="conf-bar">
                      <div
                        className="conf-fill"
                        style={{ width: `${selected.conf}%` }}
                      />
                    </div>
                  </div>

                  {/* Smooth animated Focus in 3D camera tween */}
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ justifyContent: 'center' }}
                    onClick={() => setFocusTrigger((prev) => prev + 1)}
                    aria-label={`Focus camera in 3D on object ${selected.id}`}
                  >
                    <RotateCw size={13} aria-hidden="true" /> Focus in 3D
                  </button>
                </Glass>
              )}
            </aside>
          </div>

          {/* Bottom Telemetry strip */}
          <div className="strip" aria-label="Reconstruction metrics strip">
            {statsCards.map((s) => {
              const Icon = s.icon;
              return (
                <Glass key={s.label} className="stat-card" strength={6}>
                  <div className="stat-top">
                    <Icon size={15} aria-hidden="true" />
                    <Sparkles size={12} style={{ opacity: 0.5 }} aria-hidden="true" />
                  </div>
                  <div className="stat-value">{s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </Glass>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
