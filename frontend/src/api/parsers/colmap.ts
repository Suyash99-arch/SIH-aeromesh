import * as THREE from 'three';
import { PointCloudData, Point3DParser } from '../../types/aerial.ts';

/**
 * COLMAP points3D.txt parser
 * Format:
 * # Comments...
 * POINT3D_ID X Y Z R G B ERROR TRACK[]
 */
export class ColmapTextParser implements Point3DParser {
  parse(raw: string | ArrayBuffer): PointCloudData {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const lines = text.split(/\r?\n/);

    const positions: number[] = [];
    const colors: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const tokens = line.split(/\s+/);
      if (tokens.length < 7) continue;

      const x = parseFloat(tokens[1]);
      const y = parseFloat(tokens[2]);
      const z = parseFloat(tokens[3]);

      const r = parseInt(tokens[4], 10) / 255;
      const g = parseInt(tokens[5], 10) / 255;
      const b = parseInt(tokens[6], 10) / 255;

      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        positions.push(x, y, z);
        colors.push(
          isNaN(r) ? 0.31 : r,
          isNaN(g) ? 0.85 : g,
          isNaN(b) ? 1.0 : b
        );
      }
    }

    return {
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      count: positions.length / 3,
    };
  }
}

/**
 * Standard PLY parser for point clouds (ASCII format support)
 */
export class SimplePlyParser implements Point3DParser {
  parse(raw: string | ArrayBuffer): PointCloudData {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const lines = text.split(/\r?\n/);

    const positions: number[] = [];
    const colors: number[] = [];
    let inHeader = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (inHeader) {
        if (line === 'end_header') {
          inHeader = false;
        }
        continue;
      }

      const tokens = line.split(/\s+/);
      if (tokens.length < 3) continue;

      const x = parseFloat(tokens[0]);
      const y = parseFloat(tokens[1]);
      const z = parseFloat(tokens[2]);

      let r = 0.31;
      let g = 0.85;
      let b = 1.0;

      if (tokens.length >= 6) {
        r = parseInt(tokens[3], 10) / 255;
        g = parseInt(tokens[4], 10) / 255;
        b = parseInt(tokens[5], 10) / 255;
      }

      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        positions.push(x, y, z);
        colors.push(r, g, b);
      }
    }

    return {
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      count: positions.length / 3,
    };
  }
}

/**
 * Generates synthetic procedural point cloud for explicit demo fallback (?demo=1)
 */
export function generateDemoPointCloud(): PointCloudData {
  const teal = new THREE.Color('#4fd8ff');
  const violet = new THREE.Color('#8b7bff');
  const amber = new THREE.Color('#ffb454');

  const positions: number[] = [];
  const colors: number[] = [];

  // Ground scatter
  for (let i = 0; i < 650; i++) {
    const x = (Math.random() - 0.5) * 15;
    const z = (Math.random() - 0.5) * 15;
    const y = (Math.random() - 0.5) * 0.5 - 0.4;
    positions.push(x, y, z);
    const c = teal.clone().lerp(violet, Math.random() * 0.35);
    colors.push(c.r, c.g, c.b);
  }

  // Object clusters
  const clusterCount = 16;
  for (let c = 0; c < clusterCount; c++) {
    const cx = (Math.random() - 0.5) * 11;
    const cz = (Math.random() - 0.5) * 11;
    const base = c % 6 === 0 ? amber : teal;
    const n = 18 + Math.floor(Math.random() * 22);
    for (let i = 0; i < n; i++) {
      positions.push(
        cx + (Math.random() - 0.5) * 0.7,
        Math.random() * 1.1 - 0.3,
        cz + (Math.random() - 0.5) * 0.7
      );
      const cc = base.clone().lerp(violet, Math.random() * 0.2);
      colors.push(cc.r, cc.g, cc.b);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 3,
  };
}

export function parsePointCloud(
  raw: string | ArrayBuffer,
  format: 'colmap' | 'ply' = 'colmap'
): PointCloudData {
  const parser: Point3DParser =
    format === 'ply' ? new SimplePlyParser() : new ColmapTextParser();
  return parser.parse(raw);
}
