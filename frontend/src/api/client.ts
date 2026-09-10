import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Detection,
  SceneManifest,
  SceneStats,
  PointCloudData,
} from '../types/aerial.ts';
import { parsePointCloud, generateDemoPointCloud } from './parsers/colmap.ts';

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const BASE_URL = RAW_BASE.endsWith('/api') ? RAW_BASE.slice(0, -4) : RAW_BASE;

export const DEMO_DETECTIONS: Detection[] = [
  {
    id: 'T0032',
    cls: 'van',
    state: 'STATIC',
    conf: 63,
    pos: [-1.48, -0.28, 14.49],
    reproj: 13.36,
    tone: 'amber',
    screenPos: { top: '30%', left: '22%' },
  },
  {
    id: 'T0011',
    cls: 'car',
    state: 'MOVING',
    conf: 94,
    pos: [2.05, 0.11, 7.16],
    reproj: 1.95,
    tone: 'cyan',
    screenPos: { top: '58%', left: '68%' },
  },
  {
    id: 'T0044',
    cls: 'bus',
    state: 'STATIC',
    conf: 88,
    pos: [-4.62, -0.05, 9.82],
    reproj: 3.41,
    tone: 'cyan',
    screenPos: { top: '42%', left: '48%' },
  },
  {
    id: 'T0058',
    cls: 'van',
    state: 'STATIC',
    conf: 71,
    pos: [0.94, -0.31, 4.28],
    reproj: 8.02,
    tone: 'violet',
    screenPos: { top: '70%', left: '30%' },
  },
];

export const DEMO_MANIFEST: SceneManifest = {
  sceneId: 'north-ridge-01',
  name: 'North Ridge · Sector 01',
  sector: 'Sector 01 - Downtown Perimeter',
  cameraCount: 20,
  sparsePointCount: 12916,
  surfaceFaceCount: 56120,
  meanReprojError: 1.95,
  scaleMode: 'UNREFERENCED_SCALE',
  coordSystem: 'LOCAL_ARBITRARY',
  pointCloudUrl: '/api/scenes/north-ridge-01/points',
  meshUrl: '/api/scenes/north-ridge-01/mesh',
  updatedAt: new Date().toISOString(),
};

/**
 * Check whether explicit demo mode is requested via URL (?demo=1)
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('demo') === '1' || params.get('demo') === 'true';
}

/**
 * Fetch scene manifest
 */
export async function fetchSceneManifest(sceneId: string): Promise<SceneManifest> {
  if (isDemoMode()) {
    return DEMO_MANIFEST;
  }

  // Primary endpoint: /api/scenes/:sceneId
  // Secondary fallback endpoint: /api/missions/:sceneId
  try {
    const res = await fetch(`${BASE_URL}/api/scenes/${encodeURIComponent(sceneId)}`);
    if (res.ok) {
      return (await res.json()) as SceneManifest;
    }
  } catch (_e) {
    // try fallback to existing missions endpoint
  }

  const altRes = await fetch(`${BASE_URL}/api/missions/${encodeURIComponent(sceneId)}`);
  if (!altRes.ok) {
    throw new Error(`Failed to load scene manifest for "${sceneId}": HTTP ${altRes.status}`);
  }
  const mission = await altRes.json();
  const recon = mission.reconstruction || {};
  return {
    sceneId: mission.id || sceneId,
    name: mission.name || 'Aerial Mission',
    sector: mission.sector || 'Aerial Grid',
    cameraCount: recon.cameras_registered ?? mission.frames_count ?? 20,
    sparsePointCount: recon.points_count ?? 12916,
    surfaceFaceCount: recon.faces_count ?? 56120,
    meanReprojError: recon.mean_reprojection_error ?? 1.95,
    scaleMode: recon.scale_calibrated ? 'CALIBRATED' : 'UNREFERENCED_SCALE',
    coordSystem: 'LOCAL_ARBITRARY',
    pointCloudUrl: recon.point_cloud_url || `/api/scenes/${sceneId}/points`,
    meshUrl: recon.mesh_url,
    updatedAt: mission.updated_at,
  };
}

/**
 * Fetch scene detections
 */
export async function fetchSceneDetections(sceneId: string): Promise<Detection[]> {
  if (isDemoMode()) {
    return DEMO_DETECTIONS;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/scenes/${encodeURIComponent(sceneId)}/detections`);
    if (res.ok) {
      return (await res.json()) as Detection[];
    }
  } catch (_e) {
    // fallback to missions detection
  }

  const altRes = await fetch(`${BASE_URL}/api/missions/${encodeURIComponent(sceneId)}/detections`);
  if (!altRes.ok) {
    throw new Error(`Failed to load detections for scene "${sceneId}": HTTP ${altRes.status}`);
  }
  const data = await altRes.json();
  const rawList = Array.isArray(data) ? data : data.detections || [];
  
  if (rawList.length === 0) {
    return [];
  }

  return rawList.map((d: any, idx: number) => ({
    id: d.id || `T00${idx + 10}`,
    cls: d.class_name || d.class || d.cls || 'vehicle',
    state: d.state || (d.velocity && Math.hypot(d.velocity[0], d.velocity[1]) > 0.5 ? 'MOVING' : 'STATIC'),
    conf: Math.round((d.confidence ?? d.conf ?? 0.85) * (d.confidence <= 1 ? 100 : 1)),
    pos: Array.isArray(d.pos_3d) ? d.pos_3d : Array.isArray(d.pos) ? d.pos : [0, 0, 0],
    reproj: d.reprojection_error ?? d.reproj ?? 2.0,
    tone: (d.confidence < 0.7 ? 'amber' : idx % 2 === 0 ? 'cyan' : 'violet') as Detection['tone'],
    screenPos: d.screenPos,
  }));
}

/**
 * Fetch sparse point cloud
 */
export async function fetchScenePoints(sceneId: string): Promise<PointCloudData> {
  if (isDemoMode()) {
    return generateDemoPointCloud();
  }

  let res = await fetch(`${BASE_URL}/api/scenes/${encodeURIComponent(sceneId)}/points`);
  if (!res.ok) {
    res = await fetch(`${BASE_URL}/api/missions/${encodeURIComponent(sceneId)}/reconstruction/pointcloud`);
  }

  if (!res.ok) {
    throw new Error(`Failed to load point cloud for scene "${sceneId}": HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    const json = await res.json();
    if (json.positions && json.colors) {
      return {
        positions: new Float32Array(json.positions),
        colors: new Float32Array(json.colors),
        count: json.positions.length / 3,
      };
    }
  }

  const rawText = await res.text();
  const format = rawText.startsWith('ply') ? 'ply' : 'colmap';
  return parsePointCloud(rawText, format);
}

/**
 * Hook for live telemetry polling / WS updates
 */
export function useLiveSceneStats(sceneId: string, intervalMs: number = 3000) {
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [trackedObjectsCount, setTrackedObjectsCount] = useState<number>(49);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchLive = useCallback(async () => {
    if (isDemoMode()) {
      setStats({
        cameras: 20,
        sparsePoints: 12916,
        surfaceFaces: 56120,
        meanReprojError: 1.95,
      });
      setTrackedObjectsCount(49);
      return;
    }

    try {
      const res = await fetch(`${BASE_URL}/api/scenes/${encodeURIComponent(sceneId)}/stats/live`);
      if (res.ok) {
        const data = await res.json();
        if (isMountedRef.current) {
          setStats(data.stats);
          if (data.trackedObjectsCount !== undefined) {
            setTrackedObjectsCount(data.trackedObjectsCount);
          }
          setError(null);
        }
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Telemetry connection offline');
      }
    }
  }, [sceneId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchLive();
    const timer = setInterval(fetchLive, intervalMs);
    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchLive, intervalMs]);

  return { stats, trackedObjectsCount, error, refresh: fetchLive };
}
