import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Detection,
  SceneManifest,
  SceneStats,
  PointCloudData,
} from '../types/aerial';
import { parsePointCloud } from './parsers/colmap';

/**
 * Resolves the canonical API base URL.
 * Supports VITE_API_BASE_URL, VITE_API_URL, and relative /api/v1 for Vercel/proxies.
 */
export function getApiBaseUrl(): string {
  const envUrl =
    (typeof import.meta !== 'undefined' &&
      (import.meta.env?.VITE_API_BASE_URL || import.meta.env?.VITE_API_URL)) ||
    (typeof window !== 'undefined' ? '/api/v1' : 'http://localhost:8000/api/v1');

  const clean = String(envUrl).replace(/\/+$/, '');
  if (clean.endsWith('/api/v1') || clean.endsWith('/api')) {
    return clean;
  }
  return `${clean}/api/v1`;
}

export const API_BASE_URL = getApiBaseUrl();
export const BACKEND_ROOT_URL = API_BASE_URL.replace(/\/api(\/v1)?$/, '');

/**
 * Custom error class with HTTP status, machine-readable code, and user message.
 */
export class ApiError extends Error {
  public status: number;
  public code: string;
  public details?: any;

  constructor(message: string, status: number = 500, code: string = 'API_ERROR', details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type GlobalRequestInit = typeof globalThis extends { RequestInit: infer T } ? T : any;

export interface RequestOptions extends Partial<GlobalRequestInit> {
  timeoutMs?: number;
  retries?: number;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Robust HTTP client with configurable timeout, exponential backoff retries,
 * typed responses, and standardized error parsing.
 */
export async function apiClient<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 15000, retries = 2, params, headers: customHeaders, ...fetchOpts } = options;

  let url = endpoint.startsWith('http') || endpoint.startsWith('/') ? endpoint : `${API_BASE_URL}/${endpoint}`;
  if (!url.startsWith('http') && !url.startsWith('/')) {
    url = `${API_BASE_URL}/${url}`;
  }

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) searchParams.append(k, String(v));
    });
    const qs = searchParams.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const token = typeof window !== 'undefined' ? localStorage.getItem('aeromesh_auth_token') : null;
  const headers = new Headers(customHeaders);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json, text/plain, */*');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOpts,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        let errMessage = `HTTP ${response.status} ${response.statusText}`;
        let errDetails: any = null;
        let errCode = `HTTP_${response.status}`;

        if (contentType.includes('application/json')) {
          try {
            const json = await response.json();
            errMessage = json.detail || json.message || errMessage;
            errCode = json.error || errCode;
            errDetails = json;
          } catch (_err) {
            /* ignore JSON parse error */
          }
        } else {
          try {
            const text = await response.text();
            if (text) errMessage = text.slice(0, 300);
          } catch (_err) {
            /* ignore text parse error */
          }
        }

        // Retry on 502, 503, 504 server errors for idempotent GET
        const isGet = !fetchOpts.method || fetchOpts.method.toUpperCase() === 'GET';
        if (isGet && [502, 503, 504].includes(response.status) && attempt < retries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
          continue;
        }

        throw new ApiError(errMessage, response.status, errCode, errDetails);
      }

      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }
      return (await response.text()) as unknown as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        lastError = new ApiError(`Request to ${endpoint} timed out after ${timeoutMs}ms`, 408, 'TIMEOUT');
      } else if (err instanceof ApiError) {
        lastError = err;
        break; // Do not retry explicit 4xx errors
      } else {
        lastError = new ApiError(err.message || 'Network communication failure', 0, 'NETWORK_ERROR');
      }

      attempt++;
      if (attempt <= retries && (!fetchOpts.method || fetchOpts.method.toUpperCase() === 'GET')) {
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
      } else {
        break;
      }
    }
  }

  throw lastError || new ApiError('Unknown API request error', 500);
}

/**
 * Health check probe
 */
export async function checkHealth(): Promise<{ status: string; backend: string; processing_engine?: string }> {
  return apiClient<{ status: string; backend: string; processing_engine?: string }>('health');
}

/**
 * Fetch scene manifest from backend
 */
export async function fetchSceneManifest(sceneId: string): Promise<SceneManifest> {
  try {
    const res = await apiClient<SceneManifest>(`scenes/${encodeURIComponent(sceneId)}`);
    if (res && res.sceneId) return res;
  } catch (_e) {
    // fallback to missions endpoint
  }

  const mission = await apiClient<any>(`missions/${encodeURIComponent(sceneId)}`);
  const m = mission.mission || mission;
  const recon = m.reconstruction || {};
  return {
    sceneId: m.id || sceneId,
    name: m.name || 'Aerial Mission',
    sector: m.sector || m.location || 'Aerial Grid',
    cameraCount: recon.cameras_registered ?? m.frames ?? 0,
    sparsePointCount: recon.points_count ?? recon.point_count ?? 0,
    surfaceFaceCount: recon.faces_count ?? recon.face_count ?? 0,
    meanReprojError: recon.mean_reprojection_error ?? 0.0,
    scaleMode: recon.scale_status === 'METRIC_CALIBRATED' ? 'METRIC_CALIBRATED' : 'RELATIVE_SCALE',
    coordSystem: recon.coord_system || 'LOCAL_ARBITRARY',
    pointCloudUrl: `${API_BASE_URL}/missions/${encodeURIComponent(sceneId)}/reconstruction/pointcloud`,
    meshUrl: `${API_BASE_URL}/missions/${encodeURIComponent(sceneId)}/reconstruction/mesh`,
    updatedAt: m.updatedAt || m.createdAt,
  };
}

/**
 * Fetch scene detections from backend
 */
export async function fetchSceneDetections(sceneId: string): Promise<Detection[]> {
  try {
    const res = await apiClient<any>(`missions/${encodeURIComponent(sceneId)}/objects-3d`);
    const objects = Array.isArray(res) ? res : res.objects || [];
    if (objects.length > 0) {
      return objects.map((d: any, idx: number) => ({
        id: d.object_id || d.id || `OBJ_${idx + 1}`,
        cls: d.class_name || d.class || 'object',
        state: d.motion_state || (d.is_moving ? 'MOVING' : 'STATIC'),
        conf: Math.round((d.confidence ?? 0.85) * (d.confidence <= 1 ? 100 : 1)),
        pos: Array.isArray(d.position_3d) ? d.position_3d : [0, 0, 0],
        reproj: d.reprojection_error_px ?? d.mean_reprojection_error_px ?? 0.0,
        tone: (d.confidence < 0.7 ? 'amber' : idx % 2 === 0 ? 'cyan' : 'violet') as Detection['tone'],
        screenPos: d.screenPos,
      }));
    }
  } catch (_e) {
    /* ignore fallback */
  }

  try {
    const data = await apiClient<any>(`missions/${encodeURIComponent(sceneId)}/detections`);
    const rawList = Array.isArray(data) ? data : data.detections || [];
    return rawList.map((d: any, idx: number) => ({
      id: d.id || `T00${idx + 10}`,
      cls: d.class_name || d.class || d.cls || 'vehicle',
      state: d.state || 'STATIC',
      conf: Math.round((d.confidence ?? d.conf ?? 0.85) * (d.confidence <= 1 ? 100 : 1)),
      pos: Array.isArray(d.pos_3d) ? d.pos_3d : Array.isArray(d.pos) ? d.pos : [0, 0, 0],
      reproj: d.reprojection_error ?? 0.0,
      tone: (d.confidence < 0.7 ? 'amber' : idx % 2 === 0 ? 'cyan' : 'violet') as Detection['tone'],
      screenPos: d.screenPos,
    }));
  } catch (err: any) {
    console.warn(`[API] Could not fetch detections for mission ${sceneId}:`, err);
    return [];
  }
}

/**
 * Fetch point cloud data directly from backend storage streaming endpoint
 */
export async function fetchScenePoints(sceneId: string): Promise<PointCloudData> {
  const url = `${API_BASE_URL}/missions/${encodeURIComponent(sceneId)}/reconstruction/pointcloud`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new ApiError(`Reconstruction point cloud unavailable for ${sceneId} (HTTP ${response.status})`, response.status);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    const json = await response.json();
    if (json.positions && json.colors) {
      return {
        positions: new Float32Array(json.positions),
        colors: new Float32Array(json.colors),
        count: json.positions.length / 3,
      };
    }
  }

  const rawText = await response.text();
  const format = rawText.startsWith('ply') ? 'ply' : 'colmap';
  return parsePointCloud(rawText, format);
}

/**
 * Live scene telemetry polling hook
 */
export function useLiveSceneStats(sceneId: string, intervalMs: number = 3000) {
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [trackedObjectsCount, setTrackedObjectsCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchLive = useCallback(async () => {
    if (!sceneId) return;
    try {
      const data = await apiClient<any>(`missions/${encodeURIComponent(sceneId)}/object-summary`);
      if (isMountedRef.current && data) {
        setTrackedObjectsCount(data.total_objects ?? data.unique_objects ?? 0);
        setError(null);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Telemetry unavailable');
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
