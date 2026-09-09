import type { Detection, SceneManifest, GeoJSONFeatureCollection } from "../types/aerial";

export interface ProcessingStage {
  id: string;
  name: string;
  step: number;
  page: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  progress: number;
  duration?: string;
  description?: string;
}

export interface ProcessingJobStatus {
  success: boolean;
  mission_id: string;
  job_id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | string;
  current_stage: string;
  progress_percent: number;
  message: string;
  error_message?: string | null;
  failed_stage?: string | null;
  stages: ProcessingStage[];
  completed_stages?: string[];
  reconstruction?: {
    camera_count: number;
    point_count: number;
    face_count: number;
    mean_reprojection_error?: number;
    has_pointcloud: boolean;
    has_mesh: boolean;
    point_cloud_url?: string;
    mesh_url?: string;
  };
  detections?: {
    uniqueTracks: number;
    totalDetections: number;
    byGroup?: Record<string, number>;
  };
}

export interface VideoMetadata {
  filename: string;
  storage_key?: string;
  duration_seconds?: number;
  total_frames?: number;
  fps?: number;
  resolution?: string | { width: number; height: number; w?: number; h?: number };
  size_mb?: number | string;
  codec?: string;
  ingested_at?: string;
}

export interface Object3D {
  id: string;
  track_id: string;
  class_name: string;
  position_3d: [number, number, number];
  dimensions_3d?: [number, number, number];
  volume_m3?: number;
  association_status: "VALID" | "LOW_CONFIDENCE" | "REJECTED";
  evidence_count: number;
  mean_reprojection_error?: number;
  best_frame_id?: string;
  best_bbox_2d?: [number, number, number, number];
  camera_distance_m?: number;
  reprojection_error?: number;
  velocity_vector?: [number, number, number];
}

export interface EvidenceOverlay {
  object_id: string;
  mission_id: string;
  frame_id: string;
  frame_url: string;
  overlay_url: string;
  crop_url?: string;
  detection_box: [number, number, number, number];
  class_name: string;
  confidence: number;
  camera_position?: [number, number, number];
  camera_rotation?: number[][];
}

export interface CalibrationData {
  id: string;
  mission_id: string;
  type: "reference_distance" | "object_size" | "ground_plane";
  reference_distance_m?: number;
  measured_units?: number;
  scale_factor: number;
  is_active: boolean;
  created_at: string;
}

export interface Measurement {
  id: string;
  mission_id: string;
  measurement_type: "distance" | "polygon" | "elevation" | "object" | "volume";
  measured_value: number;
  unit: string;
  confidence: number;
  uncertainty?: string;
  points_3d: number[][];
  label?: string;
  created_at: string;
}

export interface Mission {
  id: string;
  name: string;
  sector: string;
  status: "ready" | "processing" | "complete" | "failed" | "reconstruction_ready" | string;
  priority?: "low" | "medium" | "high" | "critical";
  type?: string;
  drone?: string;
  coverage?: string;
  duration?: string;
  frames?: number;
  progress?: number;
  confidence?: number;
  failed_stage?: string | null;
  error?: string | null;
  error_message?: string | null;
  video?: VideoMetadata;
  objects?: {
    total: number;
    valid?: number;
    low_confidence?: number;
    people?: number;
    vehicles?: number;
    structures?: number;
    hazards?: number;
    [key: string]: number | undefined;
  };
  objects_3d?: Object3D[];
  reconstruction?: {
    kind?: string;
    points?: string | number;
    point_count?: number;
    camera_count?: number;
    face_count?: number;
    texture?: string;
    visible?: number;
    partial?: number;
    occluded?: number;
    mesh_url?: string;
    point_cloud_url?: string;
  };
  telemetry?: {
    altitude?: string;
    speed?: string;
    heading?: string;
    gps?: string;
    accuracy?: string;
    satellites?: string;
    battery?: string;
    signal?: string;
    position?: string;
  };
  quality?: {
    sharpness?: number;
    blur?: number;
    compression?: number;
    lighting?: number;
    gps?: number;
    sensor?: number;
    occlusion?: number;
    affected?: string;
  };
  measurements?: {
    distance?: string;
    area?: string;
    height?: string;
    length?: string;
    width?: string;
    confidence?: string;
    uncertainty?: string;
    scale_status?: string;
  };
  scale_status?: string;
  findings?: Array<{
    id: string;
    title: string;
    severity: "critical" | "warning" | "info";
    description: string;
    timestamp?: string;
  }>;
  recommendations?: string[];
  hasError?: boolean;
  backendUnavailable?: boolean;
}

export const BACKEND_URL: string;

export function resolveAssetUrl(url: string | null | undefined): string;

export function listMissions(): Promise<Mission[]>;

export function getMission(missionId: string, isPoll?: boolean): Promise<Mission>;

export function createMission(formData: {
  name: string;
  sector?: string;
  location?: string;
  drone?: string;
  notes?: string;
}): Promise<Mission>;

export function uploadVideo(missionId: string, file: File): Promise<{
  success: boolean;
  filename: string;
  size_bytes: number;
  storage_key: string;
  video_metadata: VideoMetadata;
}>;

export function processVideo(
  missionId: string,
  frameSampling?: number,
  inferenceResolution?: number,
  detectionConfidence?: number,
  reconstructionQuality?: string,
  sceneProfile?: string | null
): Promise<{
  success: boolean;
  job_id: string;
  mission_id: string;
  status: string;
  stage: string;
  current_stage: string;
  progress_percent: number;
  message: string;
}>;

export function getProcessingStatus(missionId: string): Promise<ProcessingJobStatus>;

export function getReconstruction(missionId: string): Promise<any>;

export function getDetections(missionId: string): Promise<{
  detections: Detection[];
  count: number;
  classes?: Record<string, number>;
}>;

export function getTracks(missionId: string): Promise<any>;

export function getObjects3D(missionId: string): Promise<Object3D[]>;

export function getObjectEvidence(missionId: string, objectId: string): Promise<EvidenceOverlay>;

export function fetchCalibrations(missionId: string): Promise<CalibrationData[]>;

export function calibrateReferenceDistance(
  missionId: string,
  pointA: number[],
  pointB: number[],
  realWorldDistanceM: number
): Promise<CalibrationData>;

export function calibrateObjectSize(
  missionId: string,
  objectId: string,
  realWorldDimensionM: number,
  dimensionType?: string
): Promise<CalibrationData>;

export function deactivateCalibrations(missionId: string): Promise<{ success: boolean; active: boolean }>;

export function fetchMeasurements(missionId: string): Promise<Measurement[]>;

export function measureDistance3D(missionId: string, pointA: number[], pointB: number[]): Promise<Measurement>;

export function measurePolygon3D(missionId: string, polygonPoints: number[][]): Promise<Measurement>;

export function measureElevation3D(missionId: string, basePoint: number[], topPoint: number[]): Promise<Measurement>;

export function measureObject3D(missionId: string, objectId: string): Promise<Measurement>;

export function measureVolume3D(missionId: string, boundingPoints: number[][]): Promise<Measurement>;

export function generateReport(missionId: string): Promise<any>;

export function getReportPdfUrl(missionId: string): string;

export function downloadReportPdf(missionId: string): Promise<Blob>;

export function getExportCsvUrl(missionId: string): string;

export function getExportJsonUrl(missionId: string): string;

export function getExportPackageUrl(missionId: string): string;

export function fetchGeoJsonStatus(missionId: string): Promise<{
  available: boolean;
  url: string;
  feature_count?: number;
}>;

export function getStoredUser(): any;

export function loginUser(credentials: { email?: string; password?: string; username?: string }): Promise<any>;

export function clearAuthToken(): void;

export function fetchCurrentUser(): Promise<any>;

export interface ComputeDeviceInfo {
  execution_device: "cuda" | "cpu" | string;
  cuda_available: boolean;
  device_name: string;
  vram_mb: number;
  compute_path: string;
  estimated_duration: string;
  compute_budget: string;
  budget_detail: string;
}

export function getComputeDevice(): Promise<ComputeDeviceInfo>;
