export type Tone = 'cyan' | 'violet' | 'amber';

export interface Detection {
  id: string;
  cls: string;
  state: 'STATIC' | 'MOVING' | string;
  conf: number;
  pos: [number, number, number];
  reproj: number;
  tone: Tone;
  screenPos?: { top: string; left: string };
  bbox2d?: [number, number, number, number];
}

export interface SceneStats {
  cameras: number;
  sparsePoints: number;
  surfaceFaces: number;
  meanReprojError: number;
}

export interface SceneManifest {
  sceneId: string;
  name: string;
  sector: string;
  cameraCount: number;
  sparsePointCount: number;
  surfaceFaceCount: number;
  meanReprojError: number;
  scaleMode: 'CALIBRATED' | 'UNREFERENCED_SCALE' | 'RELATIVE_SCALE';
  coordSystem: string;
  pointCloudUrl?: string;
  meshUrl?: string;
  updatedAt?: string;
}

export interface PointCloudData {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export interface Point3DParser {
  parse(raw: string | ArrayBuffer): PointCloudData;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number, number];
  };
  properties: {
    id: string;
    class: string;
    state: string;
    confidence: number;
    reprojection_error: number;
    tone: string;
    timestamp: string;
  };
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
  properties: {
    scene_id: string;
    exported_at: string;
    generator: string;
  };
}
