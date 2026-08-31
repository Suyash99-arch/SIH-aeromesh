/**
 * Shared mission state management
 * Single source of truth for all mission data
 */

import { getMission as getSeedMission } from "../data/missions";

// API base URL
const API_BASE = "http://localhost:8000/api";

const fallbackMission = {
  id: "mission-overview",
  name: "Mission Overview",
  sector: "Awaiting upload",
  status: "ready",
  priority: "medium",
  type: "Single-Pass Aerial Reconstruction",
  drone: "AERO-X4",
  coverage: "UNKNOWN",
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
    confirmed_objects: 0,
    possible_objects: 0,
    rejected_objects: 0,
    static_objects: 0,
    dynamic_objects: 0,
  },
  telemetry: {
    altitude: "UNKNOWN",
    speed: "UNKNOWN",
    heading: "UNKNOWN",
    gps: "UNKNOWN",
    accuracy: "UNKNOWN",
    satellites: "0",
    battery: "UNKNOWN",
    signal: "UNKNOWN",
    position: "UNKNOWN",
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
    distance: "UNKNOWN",
    area: "UNKNOWN",
    height: "UNKNOWN",
    length: "UNKNOWN",
    width: "UNKNOWN",
    confidence: "0%",
    uncertainty: "UNKNOWN",
  },
  findings: [],
  recommendations: ["Upload a drone video to start automatic analysis."],
};

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSceneAnalysis(rawMission = {}) {
  const sceneAnalysis =
    rawMission.scene_analysis || rawMission.sceneAnalysis || {};
  const objects = rawMission.objects || {};
  const total = toSafeNumber(
    sceneAnalysis.total ?? objects.total ?? objects.confirmed_objects ?? 0,
    0,
  );
  const people = toSafeNumber(sceneAnalysis.people ?? objects.people ?? 0, 0);
  const vehicles = toSafeNumber(
    sceneAnalysis.vehicles ?? objects.vehicles ?? 0,
    0,
  );
  const structures = toSafeNumber(
    sceneAnalysis.structures ?? objects.structures ?? 0,
    0,
  );
  const hazards = toSafeNumber(
    sceneAnalysis.hazards ?? objects.hazards ?? 0,
    0,
  );

  return {
    total,
    people,
    vehicles,
    structures,
    hazards,
    confirmed_objects: toSafeNumber(
      sceneAnalysis.confirmed_objects ?? objects.confirmed_objects ?? 0,
      0,
    ),
    possible_objects: toSafeNumber(
      sceneAnalysis.possible_objects ?? objects.possible_objects ?? 0,
      0,
    ),
    rejected_objects: toSafeNumber(
      sceneAnalysis.rejected_objects ?? objects.rejected_objects ?? 0,
      0,
    ),
    static_objects: toSafeNumber(
      sceneAnalysis.static_objects ??
        objects.static_objects ??
        structures + hazards,
      0,
    ),
    dynamic_objects: toSafeNumber(
      sceneAnalysis.dynamic_objects ??
        objects.dynamic_objects ??
        people + vehicles,
      0,
    ),
    per_object_evidence: Array.isArray(sceneAnalysis.per_object_evidence)
      ? sceneAnalysis.per_object_evidence
      : [],
  };
}

function normalizeFindings(rawMission = {}, sceneAnalysis = {}) {
  const findings = Array.isArray(rawMission.findings)
    ? rawMission.findings
    : [];
  const explicitSceneAnalysis =
    rawMission.scene_analysis || rawMission.sceneAnalysis || null;
  const total = toSafeNumber(sceneAnalysis.total ?? 0, 0);

  if (!explicitSceneAnalysis && !findings.length) {
    return [];
  }

  if (total <= 0) {
    return [];
  }

  return findings.filter(Boolean);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function normalizeMission(rawMission = {}) {
  const videoUrl = rawMission.video?.url || rawMission.videoUrl || "";
  const sceneAnalysis = normalizeSceneAnalysis(rawMission);
  const findings = normalizeFindings(rawMission, sceneAnalysis);

  // Format duration from seconds if available
  const duration =
    rawMission.duration ||
    (rawMission.video?.duration_seconds
      ? formatDuration(rawMission.video.duration_seconds)
      : "00:00");

  // Use frames from video data if available
  const frames = rawMission.frames || rawMission.video?.total_frames || 0;

  const mission = {
    ...fallbackMission,
    ...rawMission,
    duration,
    frames,
    objects: {
      ...fallbackMission.objects,
      ...sceneAnalysis,
    },
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
    findings,
    recommendations: Array.isArray(rawMission.recommendations)
      ? rawMission.recommendations
      : fallbackMission.recommendations,
    scene_analysis: sceneAnalysis,
    assets: {
      ...(rawMission.assets || {}),
      video: videoUrl || rawMission.assets?.video || "",
      pointCloud:
        rawMission.assets?.pointCloud ||
        rawMission.reconstruction?.pointCloud ||
        "",
    },
  };

  if (!mission.sector && mission.location) mission.sector = mission.location;
  if (!mission.type && mission.missionType) mission.type = mission.missionType;

  return mission;
}

// Mission state cache
const missionCache = new Map();

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
  const seededMission = getSeedMission(missionId);
  if (missionCache.has(missionId)) {
    return missionCache.get(missionId);
  }

  if (seededMission && seededMission.id === missionId) {
    const mission = normalizeMission(seededMission);
    missionCache.set(missionId, mission);
    return mission;
  }

  try {
    const response = await fetch(`${API_BASE}/missions/${missionId}`);
    if (response.status === 404) {
      const fallbackMission = seededMission
        ? normalizeMission(seededMission)
        : normalizeMission({ id: missionId, name: "Mission Overview" });
      missionCache.set(missionId, fallbackMission);
      return fallbackMission;
    }
    const data = await parseResponse(response);
    if (data.success) {
      const mission = normalizeMission(data.mission);
      if (
        !mission.assets?.video &&
        !mission.reconstruction?.pointCloud &&
        seededMission
      ) {
        const seededFallback = normalizeMission(seededMission);
        missionCache.set(missionId, seededFallback);
        return seededFallback;
      }
      missionCache.set(missionId, mission);
      return mission;
    }
    const fallbackMission = seededMission
      ? normalizeMission(seededMission)
      : normalizeMission({ id: missionId, name: "Mission Overview" });
    missionCache.set(missionId, fallbackMission);
    return fallbackMission;
  } catch (error) {
    if (error instanceof TypeError) {
      console.warn(
        "Backend unavailable; using local demo mission data until the API is reachable.",
      );
      const fallbackMission = seededMission
        ? normalizeMission(seededMission)
        : normalizeMission({ id: missionId, name: "Mission Overview" });
      return {
        ...fallbackMission,
        backendUnavailable: true,
      };
    }
    const fallbackMission = seededMission
      ? normalizeMission(seededMission)
      : normalizeMission({ id: missionId, name: "Mission Overview" });
    return fallbackMission;
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
