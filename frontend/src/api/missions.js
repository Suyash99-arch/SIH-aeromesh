/**
 * Shared mission state management
 * Single source of truth for all mission data
 */

import { missions as seededMissions } from "../data/missions";

// API base URL
const API_BASE = "http://localhost:8000/api";

const fallbackMission = {
  id: "sector-04",
  name: "Disaster Response",
  sector: "Sector 04",
  status: "ready",
  priority: "medium",
  type: "Single-Pass Aerial Reconstruction",
  drone: "AERO-X4",
  coverage: "0.00 km²",
  duration: "00:00",
  frames: 0,
  progress: 0,
  confidence: 0,
  objects: {
    total: 0,
    people: 0,
    vehicles: 0,
    structures: 0,
    hazards: 0,
  },
  telemetry: {
    altitude: "0 m",
    speed: "0 m/s",
    heading: "0°",
    gps: "WAITING",
    accuracy: "N/A",
    satellites: "0",
    battery: "0%",
    signal: "NONE",
    position: "N/A",
  },
  quality: {
    sharpness: 0,
    blur: 0,
    compression: 0,
    lighting: 0,
    gps: 0,
    sensor: 0,
    occlusion: 0,
    affected: "0 frames",
  },
  reconstruction: {
    kind: "single-pass",
    points: "0",
    texture: "0%",
    visible: 0,
    partial: 0,
    occluded: 0,
  },
  measurements: {
    distance: "0 m",
    area: "0 m²",
    height: "0 m",
    length: "0 m",
    width: "0 m",
    confidence: "0%",
    uncertainty: "N/A",
  },
  findings: [],
  recommendations: ["Upload a drone video to start automatic analysis."],
};

export const BACKEND_URL = API_BASE.replace(/\/api$/, "");

export function resolveAssetUrl(url) {
  if (!url) return "";
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  ) {
    return url;
  }
  if (url.startsWith("/")) {
    return `${BACKEND_URL}${url}`;
  }
  return `${BACKEND_URL}/${url}`;
}

function normalizeMission(rawMission = {}) {
  const videoUrl = rawMission.video?.url || rawMission.videoUrl || "";
  const mission = {
    ...fallbackMission,
    ...rawMission,
    objects: { ...fallbackMission.objects, ...(rawMission.objects || {}) },
    telemetry: {
      ...fallbackMission.telemetry,
      ...(rawMission.telemetry || {}),
    },
    quality: { ...fallbackMission.quality, ...(rawMission.quality || {}) },
    reconstruction: {
      ...fallbackMission.reconstruction,
      ...(rawMission.reconstruction || {}),
    },
    measurements: {
      ...fallbackMission.measurements,
      ...(rawMission.measurements || {}),
    },
    findings: Array.isArray(rawMission.findings) ? rawMission.findings : [],
    recommendations: Array.isArray(rawMission.recommendations)
      ? rawMission.recommendations
      : fallbackMission.recommendations,
    assets: {
      ...(rawMission.assets || {}),
      video: videoUrl || rawMission.assets?.video || "",
      pointCloud: resolveAssetUrl(
        rawMission.assets?.pointCloud ||
        rawMission.reconstruction?.point_cloud_url ||
        rawMission.reconstruction?.pointCloud ||
        ""
      ),
      mesh: resolveAssetUrl(
        rawMission.assets?.mesh ||
        rawMission.reconstruction?.mesh_url ||
        ""
      ),
    },
  };

  if (!mission.sector && mission.location) {
    mission.sector = mission.location;
  }

  if (!mission.type && mission.missionType) {
    mission.type = mission.missionType;
  }

  return mission;
}

// Mission state cache
const missionCache = new Map();

const getSeededMission = (missionId) =>
  seededMissions.find((mission) => mission.id === missionId);

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const data = await response.json();
      throw new Error(data.detail || data.message || "Request failed");
    }

    const text = await response.text();
    throw new Error(text || "Request failed");
  }

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

export async function createMission({ name, missionType, location, operator }) {
  try {
    const params = new URLSearchParams({
      name,
      mission_type: missionType,
      location: location || "",
      operator: operator || "",
    });

    const response = await fetch(`${API_BASE}/missions?${params}`, {
      method: "POST",
    });

    const data = await parseResponse(response);
    if (data.success) {
      const mission = normalizeMission(data.mission);
      missionCache.set(mission.id, mission);
      return mission;
    }
    throw new Error(data.message || "Failed to create mission");
  } catch (error) {
    console.error("Create mission error:", error);
    if (error instanceof TypeError) {
      throw new Error(
        "Backend is unavailable. Start the FastAPI server on localhost:8000.",
        { cause: error },
      );
    }
    throw new Error("Failed to create mission", { cause: error });
  }
}

export async function getMission(missionId) {
  if (missionCache.has(missionId)) {
    const cached = missionCache.get(missionId);
    console.log(`[Mission] Cache hit for mission ${missionId}`);
    return cached;
  }

  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}`);

    if (response.status === 404) {
      // Mission not found on backend
      // IMPORTANT: Only return seeded mission if missionId exactly matches a seeded mission ID
      const seeded = getSeededMission(missionId);
      if (seeded) {
        console.log(
          `[Mission] API returned 404 but found seeded mission ${missionId}`,
        );
        return normalizeMission(seeded);
      }
      // Real mission not found - return error state, NOT another mission
      console.warn(
        `[Mission] Mission ${missionId} not found on backend or in seeded data`,
      );
      return {
        id: missionId,
        name: `Mission Not Found: ${missionId}`,
        status: "unavailable",
        error: "MISSION_NOT_FOUND",
        backendUnavailable: false,
        hasError: true,
      };
    }

    const data = await parseResponse(response);
    if (data.success) {
      const mission = normalizeMission(data.mission);
      missionCache.set(missionId, mission);
      console.log(`[Mission] Loaded mission ${missionId} from API`, {
        video: mission.video?.url || "no video",
      });
      return mission;
    }

    // API returned success: false - treat as error
    console.error(
      `[Mission] API returned success: false for mission ${missionId}`,
    );
    return {
      id: missionId,
      name: `Error Loading Mission: ${missionId}`,
      status: "unavailable",
      error: "API_ERROR",
      backendUnavailable: false,
      hasError: true,
    };
  } catch (error) {
    if (error instanceof TypeError) {
      // Backend is unavailable (network error)
      console.warn(
        `[Mission] Backend unavailable for mission ${missionId} (network error)`,
      );

      // Only fall back to seeded data if missionId exactly matches a seeded mission
      const seeded = getSeededMission(missionId);
      if (seeded) {
        console.warn(
          `[Mission] Using seeded mission ${missionId} due to backend unavailability`,
        );
        return { ...normalizeMission(seeded), backendUnavailable: true };
      }

      // Real mission requested but backend is down
      return {
        id: missionId,
        name: `Backend Unavailable`,
        status: "unavailable",
        error: "BACKEND_UNAVAILABLE",
        backendUnavailable: true,
        hasError: true,
        detail:
          "Backend server is not responding. Start the FastAPI server on localhost:8000.",
      };
    }

    // Other error
    console.error(
      `[Mission] Unexpected error fetching mission ${missionId}:`,
      error,
    );
    return {
      id: missionId,
      name: `Error Loading Mission`,
      status: "unavailable",
      error: "UNKNOWN_ERROR",
      backendUnavailable: false,
      hasError: true,
      detail: error.message,
    };
  }
}

export async function listMissions() {
  try {
    const response = await fetch(`${API_BASE}/missions`);
    const data = await parseResponse(response);
    if (data.success) {
      const missions = (data.missions || []).map(normalizeMission);
      missions.forEach((m) => missionCache.set(m.id, m));
      return missions;
    }
    return [];
  } catch (error) {
    console.error("List missions error:", error);
    return [];
  }
}

export async function uploadVideo(missionId, file) {
  try {
    console.log(`[Upload] Starting video upload for mission ${missionId}`);
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/missions/${missionId}/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (data.success) {
      console.log(
        `[Upload] Video uploaded successfully for mission ${missionId}`,
        { size: data.video?.size_mb, fps: data.video?.fps },
      );
      missionCache.delete(missionId);
      const mission = await getMission(missionId);
      missionCache.set(missionId, mission);
      return data;
    }
    console.error(`[Upload] Upload failed for mission ${missionId}:`, data);
    throw new Error(data.message || "Upload failed");
  } catch (error) {
    console.error(`[Upload] Upload error for mission ${missionId}:`, error);
    throw error;
  }
}

export async function processVideo(
  missionId,
  frameSampling = 2,
  inferenceResolution = 640,
  detectionConfidence = 0.35,
  reconstructionQuality = "medium",
) {
  try {
    console.log(`[Process] Starting processing for mission ${missionId}`, {
      frameSampling,
      detectionConfidence,
    });

    const params = new URLSearchParams({
      frame_sampling: frameSampling,
      inference_resolution: inferenceResolution,
      detection_confidence: detectionConfidence,
      reconstruction_quality: reconstructionQuality,
    });

    const response = await fetch(
      `${API_BASE}/missions/${missionId}/process?${params}`,
      {
        method: "POST",
      },
    );

    const data = await response.json();

    // Handle special error states from backend
    if (data.status === "UNAVAILABLE") {
      console.error(
        `[Process] Video unavailable for mission ${missionId}:`,
        data.error,
      );
      throw new Error(
        `Video unavailable (${data.error}): ${data.detail || "Unknown reason"}`,
      );
    }

    if (data.success) {
      console.log(`[Process] Processing completed for mission ${missionId}`, {
        tracks: data.detections?.uniqueTracks || 0,
        status: data.processing?.status,
      });
      missionCache.delete(missionId);
      const mission = await getMission(missionId);
      missionCache.set(missionId, mission);
      return data;
    }

    console.error(
      `[Process] Processing failed for mission ${missionId}:`,
      data,
    );
    throw new Error(data.message || "Processing failed");
  } catch (error) {
    console.error(
      `[Process] Processing error for mission ${missionId}:`,
      error,
    );
    throw error;
  }
}

export async function generateReconstruction(missionId) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/reconstruct`,
      {
        method: "POST",
      },
    );

    const data = await response.json();
    if (data.success) {
      missionCache.delete(missionId);
      const mission = await getMission(missionId);
      missionCache.set(missionId, mission);
      return data.reconstruction;
    }
    throw new Error(data.message || "Reconstruction failed");
  } catch (error) {
    console.error("Reconstruction error:", error);
    throw error;
  }
}

export async function generateReport(missionId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/report`);
    const data = await response.json();
    if (data.success) {
      return data.report;
    }
    throw new Error(data.message || "Report generation failed");
  } catch (error) {
    console.error("Report error:", error);
    throw error;
  }
}

export function getReportPdfUrl(missionId) {
  return `${API_BASE}/missions/${missionId}/report/pdf`;
}

export function getExportCsvUrl(missionId) {
  return `${API_BASE}/missions/${missionId}/export/csv`;
}

export function getExportJsonUrl(missionId) {
  return `${API_BASE}/missions/${missionId}/export/json`;
}

export function getExportGeoJsonUrl(missionId) {
  return `${API_BASE}/missions/${missionId}/export/geojson`;
}

export function getExportPackageUrl(missionId) {
  return `${API_BASE}/missions/${missionId}/export/package`;
}

export async function fetchGeoJsonStatus(missionId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/export/geojson`);
    return await response.json();
  } catch (error) {
    console.error("GeoJSON status error:", error);
    return { available: false, reason: "GeoJSON query failed" };
  }
}

export function clearCache() {
  missionCache.clear();
}

export function getCachedMissions() {
  return Array.from(missionCache.values());
}

export async function fetchCalibrations(missionId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/calibrations`);
    return await response.json();
  } catch (error) {
    console.error("fetchCalibrations error:", error);
    return { success: false, scale_status: "RELATIVE_SCALE", calibrations: [] };
  }
}

export async function calibrateReferenceDistance(missionId, payload) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/calibrations/reference-distance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error("calibrateReferenceDistance error:", error);
    throw error;
  }
}

export async function deactivateCalibrations(missionId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/calibrations/deactivate`, {
      method: "POST",
    });
    return await response.json();
  } catch (error) {
    console.error("deactivateCalibrations error:", error);
    throw error;
  }
}

export async function measureDistance3D(missionId, payload) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/measurements/distance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error("measureDistance3D error:", error);
    throw error;
  }
}

export async function measurePolygon3D(missionId, payload) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/measurements/polygon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error("measurePolygon3D error:", error);
    throw error;
  }
}

export async function measureElevation3D(missionId, payload) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/measurements/elevation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error("measureElevation3D error:", error);
    throw error;
  }
}

export async function measureObject3D(missionId, objectId, payload = {}) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/measurements/object/${objectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error("measureObject3D error:", error);
    throw error;
  }
}

export async function measureVolume3D(missionId, payload = {}) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/measurements/volume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error("measureVolume3D error:", error);
    throw error;
  }
}

export async function fetchSemanticScene(missionId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/semantic-scene`);
    return await response.json();
  } catch (error) {
    console.error("fetchSemanticScene error:", error);
    return { success: false, semantic_scene: null };
  }
}

export async function fetchObjects3D(missionId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/objects-3d`);
    return await response.json();
  } catch (error) {
    console.error("fetchObjects3D error:", error);
    return { success: false, objects: [] };
  }
}

export async function fetchObjectEvidence(missionId, objectId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/objects/${objectId}/evidence`);
    return await response.json();
  } catch (error) {
    console.error("fetchObjectEvidence error:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchReconstruction(missionId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/reconstruction`);
    return await response.json();
  } catch (error) {
    console.error("fetchReconstruction error:", error);
    return { success: false, reconstruction: null };
  }
}

// ============================================================
// AUTHENTICATION & SECURITY HELPERS (PHASE 10)
// ============================================================

export function getAuthToken() {
  return localStorage.getItem("aeromesh_auth_token");
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem("aeromesh_auth_token", token);
  } else {
    localStorage.removeItem("aeromesh_auth_token");
  }
}

export function clearAuthToken() {
  localStorage.removeItem("aeromesh_auth_token");
  localStorage.removeItem("aeromesh_current_user");
}

export function getStoredUser() {
  try {
    const item = localStorage.getItem("aeromesh_current_user");
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) {
    localStorage.setItem("aeromesh_current_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("aeromesh_current_user");
  }
}

export function getAuthHeaders(customHeaders = {}) {
  const headers = { ...customHeaders };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export async function loginUser(email, password) {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (response.ok && data.access_token) {
      setAuthToken(data.access_token);
      setStoredUser(data.user);
      return { success: true, user: data.user, token: data.access_token };
    }
    return { success: false, error: data.detail || "Authentication failed" };
  } catch (error) {
    console.error("loginUser error:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchCurrentUser() {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      clearAuthToken();
      return null;
    }
    const data = await response.json();
    if (data.user) {
      setStoredUser(data.user);
      return data.user;
    }
    return null;
  } catch (error) {
    console.error("fetchCurrentUser error:", error);
    return null;
  }
}

export async function fetchDemoUsers() {
  try {
    const response = await fetch(`${API_BASE}/auth/demo-users`);
    const data = await response.json();
    return data.users || [];
  } catch (error) {
    console.error("fetchDemoUsers error:", error);
    return [];
  }
}


