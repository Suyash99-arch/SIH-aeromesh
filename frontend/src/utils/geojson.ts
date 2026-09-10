import { Detection, GeoJSONFeatureCollection } from '../types/aerial.ts';

export function exportDetectionsToGeoJSON(
  detections: Detection[],
  sceneId: string = 'north-ridge-01'
): void {
  const geojson: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    properties: {
      scene_id: sceneId,
      exported_at: new Date().toISOString(),
      generator: 'Hexa Spark Aerial Intelligence v2.0',
    },
    features: detections.map((d) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        // [X, Y, Z] coordinate representation in local frame
        coordinates: [d.pos[0], d.pos[1], d.pos[2]],
      },
      properties: {
        id: d.id,
        class: d.cls,
        state: d.state,
        confidence: d.conf,
        reprojection_error: d.reproj,
        tone: d.tone,
        timestamp: new Date().toISOString(),
      },
    })),
  };

  const blob = new Blob([JSON.stringify(geojson, null, 2)], {
    type: 'application/geo+json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `hexa-spark-${sceneId}-detections.geojson`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
