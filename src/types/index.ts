export interface DetectedConditions {
  structuralDamage: boolean;
  fire: boolean;
  smoke: boolean;
  humanPresence: boolean;
  vehiclePresence: boolean;
  entryExit: boolean;
}

export interface OverallCondition {
  level: 'CRITICAL' | 'WARNING' | 'MODERATE' | 'SAFE' | 'UNKNOWN';
  title: string;
  description: string;
}

export interface Incident {
  id: string;
  name: string;
  location: string;
  description: string;
  date: string;
  time: string;
  status: 'Pending' | 'In Progress' | 'Analysis Completed' | 'Processing' | 'Failed';
  thumbnailUrl?: string;
  videoName?: string;
  videoSize?: string;
  videoObjectUrl?: string;   // blob: or asset URL
  videoDuration?: string;    // real duration
  videoResolution?: string;  // real resolution
  videoFps?: number;         // real FPS if determinable
  stats?: IncidentStats;
  detectedConditions?: DetectedConditions;
  overallCondition?: OverallCondition;
  keyObservations?: string[];
}

export type MarkingType =
  | 'Entry Point'
  | 'Damage'
  | 'Temporary shelter'
  | 'Hazard'
  | 'Landmark'
  | 'Water'
  | 'Custom';

export interface CustomMarking {
  id: string;
  name: string;
  type: MarkingType;
  color: string;
  description?: string;
  visible: boolean;
  position: [number, number, number]; // 3D coordinates in scene
  iconType?: 'pin' | 'fire' | 'warning' | 'shelter' | 'boat' | 'mountain' | 'water';
}

export interface FilterState {
  reconstruction3D: boolean;
  entryExit: boolean;
  humans: boolean;
  vehicles: boolean;
  fireSmoke: boolean;
  damage: boolean;
  labels: boolean;
  customMarkings: Record<string, boolean>;
}

// Detections are intentionally null until the real AI backend returns data.
export interface VideoFrameDetections {
  vehicle: number | null;
  human: number | null;
  entryExit: number | null;
  smoke: number | null;
  fire: number | null;
  damage: number | null;
}

export interface VideoFrame {
  id: number;
  frameNumber: number;      // 1-based index within extracted frames
  totalFrames: number;      // total number of extracted frames for this video
  timestamp: string;        // formatted as "MM:SS" or "HH:MM:SS"
  timestampSeconds: number; // raw seconds for seeking
  imageUrl: string;         // data: URL from canvas extraction OR empty string
}

export interface IncidentStats {
  totalPeople: number;
  peopleDelta: number;
  totalVehicles: number;
  vehiclesDelta: number;
  fireIncidents: {
    major: number;
    minor: number;
    hazardous: number;
  };
  entryExitPoints: {
    total: number;
    entry: number;
    exit: number;
  };
  damagedAreas: {
    total: number;
    details: string;
  };
}

/** Real video metadata read from the <video> element and file container */
export interface VideoMeta {
  duration: number;        // seconds
  durationFormatted: string;
  width: number;
  height: number;
  resolutionFormatted: string;
  fps?: number | null;     // real FPS if parsed from container; null if not determinable
}
