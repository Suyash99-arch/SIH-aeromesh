/**
 * Mission Data Definitions
 * All missions are dynamically created by user video uploads and served from the backend.
 * Zero hardcoded demo missions.
 */

export const missions = [];

export const getMission = (id) => null;

export const pipelineStages = [
  ["Video", "drone"],
  ["Quality", "drone"],
  ["AI detection", "analytics"],
  ["Trajectory", "map"],
  ["3D model", "reconstruction"],
  ["Measurements", "measurements"],
  ["Intelligence", "findings"],
  ["Report", "reports"],
];
