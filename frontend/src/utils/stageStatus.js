export const STAGE_STATUS_KEYS = Object.freeze({
  AVAILABLE: "stages.AVAILABLE",
  CALIBRATION: "stages.CALIBRATION",
  CANCELED: "stages.CANCELED",
  CANCELLED: "stages.CANCELLED",
  COMPLETE: "stages.COMPLETE",
  COMPLETED: "stages.COMPLETED",
  COMPLETED_MONOCULAR: "stages.COMPLETED_MONOCULAR",
  CREATED: "stages.CREATED",
  DENSE_RECONSTRUCTED: "stages.DENSE_RECONSTRUCTED",
  DETECTING_OBJECTS: "stages.DETECTING_OBJECTS",
  DETECTION: "stages.DETECTION",
  DETECT_TRACK: "stages.DETECT_TRACK",
  DISABLED: "stages.DISABLED",
  DRAFT: "stages.DRAFT",
  EXTRACTION: "stages.EXTRACTION",
  EXTRACTING_FRAMES: "stages.EXTRACTING_FRAMES",
  EXTRACT_FRAMES: "stages.EXTRACT_FRAMES",
  FAILED: "stages.FAILED",
  FUSING_3D: "stages.FUSING_3D",
  GENERATING_MESH: "stages.GENERATING_MESH",
  INGEST: "stages.INGEST",
  INTERRUPTED: "stages.INTERRUPTED",
  MESH_GENERATED: "stages.MESH_GENERATED",
  MESHING: "stages.MESHING",
  NOT_RUN: "stages.NOT_RUN",
  PARTIAL: "stages.PARTIAL",
  PENDING: "stages.PENDING",
  PREFLIGHT: "stages.PREFLIGHT",
  PROCESSING: "stages.PROCESSING",
  PROCESSING_COMPLETE: "stages.PROCESSING_COMPLETE",
  QUEUED: "stages.QUEUED",
  READY: "stages.READY",
  RECONSTRUCTION: "stages.RECONSTRUCTION",
  RECONSTRUCTION_READY: "stages.RECONSTRUCTION_READY",
  RECONSTRUCTION_FAILED: "stages.RECONSTRUCTION_FAILED",
  RECONSTRUCTED: "stages.RECONSTRUCTED",
  RECONSTRUCTING: "stages.RECONSTRUCTING",
  REPORTING: "stages.REPORTING",
  RUNNING: "stages.RUNNING",
  SKIPPED_NO_GPU: "stages.SKIPPED_NO_GPU",
  SFM: "stages.SFM",
  SPATIAL_FUSION: "stages.SPATIAL_FUSION",
  SUCCESS: "stages.SUCCESS",
  SURFACE_MESH: "stages.SURFACE_MESH",
  TRACKING: "stages.TRACKING",
  UNAVAILABLE: "stages.UNAVAILABLE",
  UPLOADED: "stages.UPLOADED",
  VALIDATING: "stages.VALIDATING",
  VIDEO_UPLOADED: "stages.VIDEO_UPLOADED",
  WAITING: "stages.WAITING",
});

export function getStageStatusLabel(status, translate, {
  development = Boolean(import.meta.env?.DEV),
  warn = (...args) => console.warn(...args),
} = {}) {
  const rawStatus = String(status || "READY").trim();
  const normalizedStatus = rawStatus.toUpperCase().replace(/[\s-]+/gu, "_");
  const key = Object.hasOwn(STAGE_STATUS_KEYS, normalizedStatus)
    ? STAGE_STATUS_KEYS[normalizedStatus]
    : null;
  if (key && typeof translate === "function") {
    const translated = translate(key);
    if (translated && translated !== key) return translated;
  }

  if (development) warn(`[i18n] Missing stage status translation for "${normalizedStatus}"`);
  return rawStatus
    .replace(/[_-]+/gu, " ")
    .toLowerCase()
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}
