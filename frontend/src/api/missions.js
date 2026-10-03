/**
 * Shared mission state management
 * Single source of truth for all mission data
 */

import { missions as seededMissions } from "../data/missions";
import { formatApiError } from "../utils/errorUtils.js";
export { formatApiError };

export function getApiBase() {
  const envUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta.env?.VITE_API_BASE_URL || import.meta.env?.VITE_API_URL)) ||
    (typeof window !== "undefined" ? "/api/v1" : "http://localhost:8000/api/v1");
  const clean = String(envUrl).replace(/\/+$/, "");
  if (clean.endsWith("/api/v1")) {
    return clean;
  }
  if (clean.endsWith("/api")) {
    return `${clean}/v1`;
  }
  return `${clean}/api/v1`;
}

export const API_BASE = getApiBase();
export const BACKEND_URL = API_BASE.replace(/\/api(\/v1)?$/, "");

const fallbackMission = {
  id: "",
  name: "Active Mission",
  sector: "Aerial Sector",
  status: "ready",
  priority: "medium",
  type: "Single-Pass Aerial Reconstruction",
  drone: "AERO-X4",
  coverage: "0.00 km²",
  duration: "—",
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
  telemetry: null,
  quality: null,
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
  recommendations: ["Upload an aerial video to initiate photogrammetric reconstruction."],
};

export function resolveAssetUrl(url) {
  if (!url || typeof url !== "string") return "";
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

export async function fetchArtifactsStatus(missionId) {
  if (!missionId) return null;
  try {
    const res = await fetch(`${API_BASE}/missions/${missionId}/artifacts`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeMission(rawMission = {}) {
  const mId = rawMission.id || rawMission.mission_id || "";
  const baseDefaults = fallbackMission;
  const videoUrl = rawMission.video?.url || rawMission.videoUrl || "";

  let duration = rawMission.duration;
  const durationSec =
    rawMission.video?.duration_seconds ??
    rawMission.video?.durationSeconds ??
    rawMission.durationSeconds;
  if (!duration || duration === "00:00" || duration === "—") {
    if (typeof durationSec === "number" && durationSec > 0) {
      const mins = Math.floor(durationSec / 60);
      const secs = Math.round(durationSec % 60);
      duration = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    } else {
      duration = baseDefaults.duration || "—";
    }
  }

  const frames =
    rawMission.frames ||
    rawMission.video?.total_frames ||
    rawMission.video?.totalFrames ||
    0;

  const mission = {
    ...baseDefaults,
    ...rawMission,
    id: mId,
    frames,
    duration,
    objects: { ...baseDefaults.objects, ...(rawMission.objects || {}) },
    telemetry: (rawMission.telemetry && Object.keys(rawMission.telemetry).length > 0)
      ? rawMission.telemetry
      : null,
    quality: (rawMission.quality && Object.keys(rawMission.quality).length > 0)
      ? rawMission.quality
      : ((rawMission.frameQuality?.summary || rawMission.frameQuality?.average) && Object.keys(rawMission.frameQuality?.summary || rawMission.frameQuality?.average || {}).length > 0)
      ? {
          sharpness: Math.round((rawMission.frameQuality.summary || rawMission.frameQuality.average).sharpness || 0),
          brightness: Math.round((rawMission.frameQuality.summary || rawMission.frameQuality.average).lighting || (rawMission.frameQuality.summary || rawMission.frameQuality.average).brightness || 0),
          contrast: Math.round((rawMission.frameQuality.summary || rawMission.frameQuality.average).compression || (rawMission.frameQuality.summary || rawMission.frameQuality.average).contrast || 0),
          overall: Math.round((rawMission.frameQuality.summary || rawMission.frameQuality.average).overall || 0),
          motion_blur: Math.round((rawMission.frameQuality.summary || rawMission.frameQuality.average).motion_blur || 0),
          samples: rawMission.frameQuality?.samples || rawMission.frameQuality?.timeseries || [],
        }
      : null,
    reconstruction: {
      ...baseDefaults.reconstruction,
      ...(rawMission.reconstruction || {}),
      camera_poses: rawMission.camera_poses || rawMission.reconstruction?.camera_poses || [],
      mean_reprojection_error:
        rawMission.mean_reprojection_error ??
        rawMission.reconstruction?.mean_reprojection_error ??
        rawMission.sparse_reconstruction?.mean_reprojection_error_px ??
        null,
    },
    measurements: {
      ...baseDefaults.measurements,
      ...(rawMission.measurements || {}),
    },
    findings: Array.isArray(rawMission.findings)
      ? rawMission.findings
      : (baseDefaults.findings || []),
    recommendations: Array.isArray(rawMission.recommendations)
      ? rawMission.recommendations
      : (baseDefaults.recommendations || fallbackMission.recommendations),
    assets: {
      ...(baseDefaults.assets || {}),
      ...(rawMission.assets || {}),
      video: resolveAssetUrl(videoUrl || rawMission.assets?.video || ""),
      pointCloud: resolveAssetUrl(
        rawMission.reconstruction?.point_cloud_url ||
          rawMission.assets?.pointCloud ||
          "",
      ),
      mesh: resolveAssetUrl(
        rawMission.reconstruction?.mesh_url ||
          rawMission.assets?.mesh ||
          "",
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
      throw new Error(formatApiError(data));
    }

    const text = await response.text();
    throw new Error(formatApiError(text));
  }

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

export async function listMissions() {
  try {
    const response = await fetch(`${API_BASE}/missions`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      console.warn(`[API] listMissions returned HTTP ${response.status}`);
      return [];
    }
    const data = await response.json();
    const rawItems = Array.isArray(data)
      ? data
      : Array.isArray(data?.missions)
      ? data.missions
      : typeof data === "object" && data !== null
      ? Object.values(data.missions || data)
      : [];

    missionCache.clear();
    const normalized = rawItems.map((m) => normalizeMission(m));
    normalized.forEach((m) => {
      if (m && m.id) missionCache.set(m.id, m);
    });
    return normalized;
  } catch (error) {
    console.warn("[API] listMissions network error:", error);
    return [];
  }
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
      headers: getAuthHeaders(),
    });

    const data = await parseResponse(response);
    if (data.success) {
      const mission = normalizeMission(data.mission);
      missionCache.set(mission.id, mission);
      return mission;
    }
    throw new Error(formatApiError(data) || "Failed to create mission");
  } catch (error) {
    console.error("Create mission error:", error);
    if (error instanceof TypeError) {
      throw new Error(
        "Backend is unavailable. Start the FastAPI server on localhost:8000.",
        { cause: error },
      );
    }
    throw new Error(formatApiError(error) || "Failed to create mission", { cause: error });
  }
}

export async function getMission(missionId, forceRefresh = false) {
  if (!forceRefresh && missionCache.has(missionId)) {
    const cached = missionCache.get(missionId);
    if (cached && cached.status !== "processing") {
      console.log(`[Mission] Cache hit for mission ${missionId}`);
      return cached;
    }
  }

  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}`, {
      headers: getAuthHeaders(),
    });

    if (response.status === 404) {
      console.warn(`[Mission] Mission ${missionId} not found on backend`);
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
        video: mission.assets?.video || "no video",
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

export async function uploadVideo(missionId, file) {
  try {
    console.log(`[Upload] Starting video upload for mission ${missionId}`);
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/missions/${missionId}/upload`, {
      method: "POST",
      headers: getAuthHeaders(),
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
    throw new Error(formatApiError(data) || "Upload failed");
  } catch (error) {
    console.error(`[Upload] Upload error for mission ${missionId}:`, error);
    throw error;
  }
}

export async function uploadVideoChunk(missionId, file, onProgress, signal) {
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = `upl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  let startTime = Date.now();

  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) {
      throw new Error("Upload cancelled by user");
    }

    const start = i * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const chunkBlob = file.slice(start, end);

    const formData = new FormData();
    formData.append("chunk", chunkBlob, file.name);

    const url = `${API_BASE}/missions/${missionId}/upload/chunk?chunk_index=${i}&total_chunks=${totalChunks}&upload_id=${uploadId}&filename=${encodeURIComponent(file.name)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
      signal,
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(formatApiError(data) || `Chunk ${i + 1} upload failed`);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const uploadedBytes = end;
    const speedMBps = elapsed > 0 ? (uploadedBytes / (1024 * 1024)) / elapsed : 0;

    if (onProgress) {
      onProgress({
        progress: Math.round((uploadedBytes / file.size) * 100),
        uploadedBytes,
        totalBytes: file.size,
        speedMBps: speedMBps.toFixed(2),
        chunkIndex: i + 1,
        totalChunks,
      });
    }

    if (i === totalChunks - 1) {
      missionCache.delete(missionId);
      return data;
    }
  }
}

export async function deleteMission(missionId) {
  const response = await fetch(`${API_BASE}/missions/${missionId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(formatApiError(data) || "Failed to delete mission");
  }
  missionCache.delete(missionId);
  return data;
}

export async function compareMissions(baseId, targetId) {
  const response = await fetch(`${API_BASE}/missions/compare?base_id=${baseId}&target_id=${targetId}`, {
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(formatApiError(data) || "Failed to compare missions");
  }
  return data;
}

export async function pauseMission(missionId) {
  const response = await fetch(`${API_BASE}/missions/${missionId}/pause`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  return response.json();
}

export async function resumeMission(missionId) {
  const response = await fetch(`${API_BASE}/missions/${missionId}/resume`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  return response.json();
}

export async function cancelMission(missionId) {
  const response = await fetch(`${API_BASE}/missions/${missionId}/cancel`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  return response.json();
}

export async function retryMission(missionId) {
  const response = await fetch(`${API_BASE}/missions/${missionId}/retry`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  return response.json();
}

export async function createShareLink(missionId, days = 7) {
  const response = await fetch(`${API_BASE}/missions/${missionId}/share?days=${days}`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  return response.json();
}

export async function getProcessingStatus(missionId) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/processing-status`,
      {
        headers: getAuthHeaders(),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (err) {
    console.warn(`[ProcessStatus] Error fetching status for ${missionId}:`, err);
    return null;
  }
}

export async function processVideo(
  missionId,
  optionsOrFrameSampling = 2,
  ...rest
) {
  try {
    let options = {};
    if (typeof optionsOrFrameSampling === "object" && optionsOrFrameSampling !== null) {
      options = optionsOrFrameSampling;
    } else {
      options = {
        frameSampling: optionsOrFrameSampling,
        inferenceResolution: rest[0],
        detectionConfidence: rest[1],
        reconstructionQuality: rest[2],
        sceneProfile: rest[3],
      };
    }

    const payload = {
      frame_sampling:
        typeof options.frameSampling === "number"
          ? options.frameSampling
          : (typeof options.frame_sampling === "number" ? options.frame_sampling : 2.0),
      inference_resolution:
        Number(options.inferenceResolution || options.inference_resolution) || 640,
      detection_confidence:
        typeof options.detectionConfidence === "number"
          ? options.detectionConfidence
          : (typeof options.detection_confidence === "number" ? options.detection_confidence : 0.35),
      reconstruction_quality:
        String(options.reconstructionQuality || options.reconstruction_quality || "medium").toLowerCase(),
      scene_profile:
        String(options.sceneProfile || options.scene_profile || "road").toLowerCase(),
    };

    console.log(`[Process] Starting pipeline processing for mission ${missionId}`, payload);

    const response = await fetch(
      `${API_BASE}/missions/${missionId}/process`,
      {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    let data;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { message: text };
    }

    if (!response.ok) {
      const errorMsg = formatApiError(data);
      console.error(
        `[Process] Processing failed for mission ${missionId} (HTTP ${response.status}):`,
        errorMsg,
      );
      throw new Error(errorMsg);
    }

    // Handle special error states from backend
    if (data.status === "UNAVAILABLE" || data.status === "FAILED") {
      const errorMsg = formatApiError(data);
      console.error(
        `[Process] Video/pipeline unavailable for mission ${missionId}:`,
        errorMsg,
      );
      throw new Error(errorMsg);
    }

    if (data.success) {
      console.log(`[Process] Pipeline initiated for mission ${missionId}:`, data);
      missionCache.delete(missionId);

      // Persist active job in localStorage for resume-after-reload capability
      try {
        const stored = JSON.parse(localStorage.getItem("aeromesh_active_jobs") || "{}");
        stored[missionId] = {
          jobId: data.job_id || data.job?.id,
          missionId,
          startedAt: new Date().toISOString(),
          status: data.status || data.job?.status || "PROCESSING",
        };
        localStorage.setItem("aeromesh_active_jobs", JSON.stringify(stored));
      } catch (storageErr) {
        console.warn("[Process] LocalStorage persistence error:", storageErr);
      }

      return data;
    }

    const finalError = formatApiError(data) || "Processing failed";
    console.error(
      `[Process] Processing failed for mission ${missionId}:`,
      finalError,
    );
    throw new Error(finalError);
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
        headers: getAuthHeaders(),
      },
    );

    const data = await response.json();
    if (data.success) {
      missionCache.delete(missionId);
      const mission = await getMission(missionId);
      missionCache.set(missionId, mission);
      return data.reconstruction;
    }
    throw new Error(formatApiError(data) || "Reconstruction failed");
  } catch (error) {
    console.error("Reconstruction error:", error);
    throw error;
  }
}

export async function generateReport(missionId) {
  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}/report`, {
      headers: getAuthHeaders(),
    });
    const data = await response.json();
    if (data.success) {
      return data.report;
    }
    throw new Error(formatApiError(data) || "Report generation failed");
  } catch (error) {
    console.error("Report error:", error);
    throw error;
  }
}

export function getReportPdfUrl(missionId) {
  return `${API_BASE}/missions/${missionId}/report/pdf`;
}

export async function downloadReportPdf(missionId) {
  try {
    const url = `${API_BASE}/missions/${missionId}/report/pdf`;
    const headers = getAuthHeaders();
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.detail) {
          errorDetail =
            typeof errJson.detail === "string"
              ? errJson.detail
              : JSON.stringify(errJson.detail);
        }
      } catch {
        // Not JSON
      }
      throw new Error(`PDF download failed (${errorDetail})`);
    }

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const filename = `aeromesh_${missionId}_report.pdf`;

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
    }, 1000);

    return { success: true, filename };
  } catch (error) {
    console.error("downloadReportPdf error:", error);
    throw error;
  }
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
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/export/geojson`,
    );
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
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/calibrations`,
      {
        headers: getAuthHeaders(),
      },
    );
    return await response.json();
  } catch (error) {
    console.error("fetchCalibrations error:", error);
    return { success: false, scale_status: "RELATIVE_SCALE", calibrations: [] };
  }
}

export async function calibrateReferenceDistance(missionId, payload) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/calibrations/reference-distance`,
      {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    return await response.json();
  } catch (error) {
    console.error("calibrateReferenceDistance error:", error);
    throw error;
  }
}

export async function deactivateCalibrations(missionId) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/calibrations/deactivate`,
      {
        method: "POST",
        headers: getAuthHeaders(),
      },
    );
    return await response.json();
  } catch (error) {
    console.error("deactivateCalibrations error:", error);
    throw error;
  }
}

export async function measureDistance3D(missionId, payload) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/measurements/distance`,
      {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    return await response.json();
  } catch (error) {
    console.error("measureDistance3D error:", error);
    throw error;
  }
}

export async function measurePolygon3D(missionId, payload) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/measurements/polygon`,
      {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    return await response.json();
  } catch (error) {
    console.error("measurePolygon3D error:", error);
    throw error;
  }
}

export async function measureElevation3D(missionId, payload) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/measurements/elevation`,
      {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    return await response.json();
  } catch (error) {
    console.error("measureElevation3D error:", error);
    throw error;
  }
}

export async function measureObject3D(missionId, objectId, payload = {}) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/measurements/object/${objectId}`,
      {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    return await response.json();
  } catch (error) {
    console.error("measureObject3D error:", error);
    throw error;
  }
}

export async function measureVolume3D(missionId, payload = {}) {
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/measurements/volume`,
      {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    return await response.json();
  } catch (error) {
    console.error("measureVolume3D error:", error);
    throw error;
  }
}

export async function fetchSemanticScene(missionId) {
  if (!missionId) return { success: false, semantic_scene: null };
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/semantic-scene?_t=${Date.now()}`,
      {
        headers: getAuthHeaders(),
        cache: "no-store",
      },
    );
    if (!response.ok) return { success: false, semantic_scene: null };
    return await response.json();
  } catch (error) {
    console.warn("[API] fetchSemanticScene fallback:", error);
    return { success: false, semantic_scene: null };
  }
}

export async function fetchObjects3D(missionId) {
  if (!missionId) return { success: false, objects: [] };
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/objects-3d?_t=${Date.now()}`,
      {
        headers: getAuthHeaders(),
        cache: "no-store",
      },
    );
    if (!response.ok) return { success: false, objects: [] };
    return await response.json();
  } catch (error) {
    console.warn("[API] fetchObjects3D fallback:", error);
    return { success: false, objects: [] };
  }
}

export async function fetchObjectEvidence(missionId, objectId) {
  if (!missionId || !objectId) return { success: false, error: "Missing missionId or objectId" };
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/objects/${objectId}/evidence?_t=${Date.now()}`,
      {
        headers: getAuthHeaders(),
        cache: "no-store",
      },
    );
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    return await response.json();
  } catch (error) {
    console.warn("[API] fetchObjectEvidence fallback:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchReconstruction(missionId) {
  if (!missionId) return { success: false, reconstruction: null };
  try {
    const response = await fetch(
      `${API_BASE}/missions/${missionId}/reconstruction?_t=${Date.now()}`,
      {
        headers: getAuthHeaders(),
        cache: "no-store",
      },
    );
    if (!response.ok) return { success: false, reconstruction: null };
    const data = await response.json();
    return data;
  } catch (error) {
    console.warn("[API] fetchReconstruction fallback:", error);
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
  localStorage.removeItem("aeromesh_active_mission_id");
  missionCache.clear();
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

export async function registerUser(optionsOrEmail, maybePassword, maybeFullName = "", maybeRole = "OPERATOR") {
  try {
    const payload = typeof optionsOrEmail === "object" && optionsOrEmail !== null
      ? optionsOrEmail
      : {
          email: optionsOrEmail,
          password: maybePassword,
          full_name: maybeFullName,
          role: maybeRole,
          portal_type: "INDIVIDUAL",
        };

    const response = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (response.ok && data.access_token) {
      setAuthToken(data.access_token);
      setStoredUser(data.user);
      return { success: true, user: data.user, token: data.access_token };
    }
    return { success: false, error: data.detail || "Registration failed" };
  } catch (error) {
    console.error("registerUser error:", error);
    return { success: false, error: error.message };
  }
}

export async function loginUser(email, password, portalType = null, mfaCode = null) {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email,
        password,
        portal_type: portalType,
        mfa_code: mfaCode,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      if (data.mfa_required) {
        return {
          success: false,
          mfa_required: true,
          email: data.email,
          message: data.message,
        };
      }
      if (data.access_token) {
        setAuthToken(data.access_token);
        setStoredUser(data.user);
        return { success: true, user: data.user, token: data.access_token };
      }
    }
    return { success: false, error: data.detail || "Authentication failed" };
  } catch (error) {
    console.error("loginUser error:", error);
    return { success: false, error: error.message };
  }
}

export async function loginGuest() {
  try {
    const response = await fetch(`${API_BASE}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const data = await response.json();
    if (response.ok && data.access_token) {
      setAuthToken(data.access_token);
      setStoredUser(data.user);
      return { success: true, user: data.user, token: data.access_token };
    }
    return { success: false, error: data.detail || "Guest session initialization failed" };
  } catch (error) {
    console.error("loginGuest error:", error);
    return { success: false, error: error.message };
  }
}

export async function refreshSession() {
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const data = await response.json();
    if (response.ok && data.access_token) {
      setAuthToken(data.access_token);
      setStoredUser(data.user);
      return { success: true, user: data.user, token: data.access_token };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

export async function logoutUser() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.warn("logoutUser network error:", err);
  } finally {
    clearAuthToken();
  }
}

export async function inviteTeamMember(inviteData) {
  try {
    const response = await fetch(`${API_BASE}/auth/invite`, {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify(inviteData),
    });
    const data = await response.json();
    if (response.ok && data.success) {
      return { success: true, data };
    }
    return { success: false, error: data.detail || "Team invite failed" };
  } catch (error) {
    console.error("inviteTeamMember error:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchAuditLog() {
  try {
    const response = await fetch(`${API_BASE}/auth/audit-log`, {
      headers: getAuthHeaders(),
      credentials: "include",
    });
    const data = await response.json();
    return data.events || [];
  } catch (error) {
    console.error("fetchAuditLog error:", error);
    return [];
  }
}

export async function fetchCurrentUser() {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders(),
      credentials: "include",
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

export async function getComputeDevice() {
  try {
    const response = await fetch(`${API_BASE}/system/compute-device`, {
      headers: getAuthHeaders(),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.device) {
        return data.device;
      }
    }
  } catch (error) {
    console.warn("[ComputeDevice] Error fetching compute device info:", error);
  }
  return {
    execution_device: "cpu",
    cuda_available: false,
    device_name: "Intel(R) UHD Graphics",
    vram_mb: 0,
    compute_path: "CPU inference — Intel(R) UHD Graphics detected, no CUDA device",
    compute_budget: "Host RAM & CPU (0 MB VRAM)",
    budget_detail: "PyCOLMAP + YOLO11 (CPU multi-threading)",
  };
}

export async function estimatePipelineEtaApi(params = {}) {
  try {
    const response = await fetch(`${API_BASE}/system/estimate-eta`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        size_bytes: params.sizeBytes || params.size_bytes || 0,
        duration_seconds: params.durationSeconds || params.duration_seconds || 10,
        width: params.width || 1920,
        height: params.height || 1080,
        fps: params.fps || 30.0,
        frame_sampling: params.frameSampling || params.frame_sampling || 2.0,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.eta) {
        return data.eta;
      }
      return data;
    }
  } catch (error) {
    console.warn("[ETA] Error fetching dynamic ETA from backend:", error);
  }
  return null;
}



export async function fetchMissionMarkings(missionId) {
  if (!missionId) return [];
  try {
    const res = await fetch(`${API_BASE}/missions/${missionId}/markings`, {
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      return data.markings || [];
    }
  } catch (err) {
    console.warn('[API] Error fetching markings:', err);
  }
  return [];
}

export async function createMissionMarking(missionId, markingData) {
  if (!missionId) return null;
  try {
    const res = await fetch(`${API_BASE}/missions/${missionId}/markings`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(markingData),
    });
    if (res.ok) {
      const data = await res.json();
      return data.marking;
    }
  } catch (err) {
    console.warn('[API] Error creating marking:', err);
  }
  return null;
}

export async function deleteMissionMarking(missionId, markingId) {
  if (!missionId || !markingId) return false;
  try {
    const res = await fetch(`${API_BASE}/missions/${missionId}/markings/${markingId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Error deleting marking:', err);
    return false;
  }
}

export async function fetchMissionKeyframes(missionId) {
  if (!missionId) return [];
  try {
    const res = await fetch(`${API_BASE}/missions/${missionId}/keyframes`, {
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      return data.frames || [];
    }
  } catch (err) {
    console.warn('[API] Error fetching keyframes:', err);
  }
  return [];
}

