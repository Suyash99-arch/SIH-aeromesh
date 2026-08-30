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
      pointCloud:
        rawMission.assets?.pointCloud ||
        rawMission.reconstruction?.pointCloud ||
        "",
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
    return missionCache.get(missionId);
  }

  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}`);
    if (response.status === 404) {
      return (
        getSeededMission(missionId) ||
        normalizeMission({ id: missionId, name: "Mission Overview" })
      );
    }
    const data = await parseResponse(response);
    if (data.success) {
      const mission = normalizeMission(data.mission);
      missionCache.set(missionId, mission);
      return mission;
    }
    return (
      getSeededMission(missionId) ||
      normalizeMission({ id: missionId, name: "Mission Overview" })
    );
  } catch (error) {
    if (error instanceof TypeError) {
      console.warn("Backend unavailable; using local mission data.");
      const localMission =
        getSeededMission(missionId) ||
        normalizeMission({ id: missionId, name: "Mission Overview" });
      return { ...localMission, backendUnavailable: true };
    }
    return (
      getSeededMission(missionId) ||
      normalizeMission({ id: missionId, name: "Mission Overview" })
    );
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
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/missions/${missionId}/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (data.success) {
      missionCache.delete(missionId);
      const mission = await getMission(missionId);
      missionCache.set(missionId, mission);
      return data;
    }
    throw new Error(data.message || "Upload failed");
  } catch (error) {
    console.error("Upload error:", error);
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
    if (data.success) {
      missionCache.delete(missionId);
      const mission = await getMission(missionId);
      missionCache.set(missionId, mission);
      return data;
    }
    throw new Error(data.message || "Processing failed");
  } catch (error) {
    console.error("Processing error:", error);
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

export function clearCache() {
  missionCache.clear();
}

export function getCachedMissions() {
  return Array.from(missionCache.values());
}
