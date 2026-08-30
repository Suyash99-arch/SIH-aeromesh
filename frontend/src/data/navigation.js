export const missionNavigation = [
  ["overview", "Mission Command", "LayoutDashboard"], ["missions", "Mission Switcher", "Crosshair", "03"],
  ["drone", "Flight Processing", "Radar"], ["reconstruction", "3D Reconstruction", "Box"],
];
export const intelligenceNavigation = [
  ["analytics", "Scene Intelligence", "ChartNoAxesCombined"], ["map", "Geospatial Intelligence", "Map"],
  ["measurements", "Measurements", "Ruler"], ["findings", "AI Findings", "BrainCircuit", "06"], ["reports", "Reports", "FileText"],
];
export const outputNavigation = [["challenge", "Challenge Coverage", "ShieldCheck"]];
export const systemNavigation = [["settings", "Settings", "Settings"]];
export const pageTitles = Object.fromEntries([...missionNavigation, ...intelligenceNavigation, ...outputNavigation, ...systemNavigation].map(([id, label]) => [id, label]));
