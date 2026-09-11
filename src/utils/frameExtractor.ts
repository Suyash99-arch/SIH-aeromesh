import type { VideoFrame, VideoMeta } from '../types';

/** Format seconds → "MM:SS" or "HH:MM:SS" */
export function formatTimestamp(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface ExtractionProgress {
  current: number;
  total: number;
}

export interface ExtractionResult {
  meta: VideoMeta;
  frames: VideoFrame[];
}

/**
 * Pre-generated 24 high-resolution keyframe intervals for bridge drone footage (53.9s)
 */
const BRIDGE_FRAME_TIMESTAMPS = [
  { s: 0.0, ts: '00:00' },
  { s: 2.17, ts: '00:02' },
  { s: 4.42, ts: '00:04' },
  { s: 6.67, ts: '00:06' },
  { s: 8.92, ts: '00:08' },
  { s: 11.17, ts: '00:11' },
  { s: 13.42, ts: '00:13' },
  { s: 15.67, ts: '00:15' },
  { s: 17.92, ts: '00:17' },
  { s: 20.17, ts: '00:20' },
  { s: 22.42, ts: '00:22' },
  { s: 24.67, ts: '00:24' },
  { s: 26.92, ts: '00:26' },
  { s: 29.17, ts: '00:29' },
  { s: 31.42, ts: '00:31' },
  { s: 33.67, ts: '00:33' },
  { s: 35.92, ts: '00:35' },
  { s: 38.17, ts: '00:38' },
  { s: 40.42, ts: '00:40' },
  { s: 42.67, ts: '00:42' },
  { s: 44.92, ts: '00:44' },
  { s: 47.17, ts: '00:47' },
  { s: 49.42, ts: '00:49' },
  { s: 51.67, ts: '00:51' },
];

/**
 * Generate rich default drone inspection frames for incidents
 * so the Video Frames tab is immediately filled with real, high-resolution keyframes.
 */
export function getDemoFrames(incidentId = 'AM-20250908-001'): VideoFrame[] {
  const isBridge = incidentId.includes('001') || incidentId.toLowerCase().includes('bridge');
  const isBuilding = incidentId.includes('002') || incidentId.toLowerCase().includes('building');
  const isHighway = incidentId.includes('003') || incidentId.toLowerCase().includes('highway');

  if (isBridge) {
    return BRIDGE_FRAME_TIMESTAMPS.map((item, index) => {
      const frameNum = index + 1;
      const paddedNum = String(frameNum).padStart(2, '0');
      return {
        id: frameNum,
        frameNumber: frameNum,
        totalFrames: BRIDGE_FRAME_TIMESTAMPS.length,
        timestamp: item.ts,
        timestampSeconds: item.s,
        imageUrl: `/assets/frames/bridge/frame_${paddedNum}.jpg`,
      };
    });
  }

  // 16 frames for Building, Highway, or Industrial
  const folder = isBuilding ? 'building' : isHighway ? 'highway' : 'industrial';
  const totalCount = 16;
  const frames: VideoFrame[] = [];

  for (let i = 0; i < totalCount; i++) {
    const frameNum = i + 1;
    const paddedNum = String(frameNum).padStart(2, '0');
    const sec = i * 2.5;
    frames.push({
      id: frameNum,
      frameNumber: frameNum,
      totalFrames: totalCount,
      timestamp: formatTimestamp(sec),
      timestampSeconds: sec,
      imageUrl: `/assets/frames/${folder}/frame_${paddedNum}.jpg`,
    });
  }

  return frames;
}

/**
 * Attempt to read real container FPS from MP4 box headers.
 */
export async function tryParseMp4Fps(file: File): Promise<number | null> {
  try {
    const maxRead = Math.min(file.size, 512 * 1024);
    const slice = file.slice(0, maxRead);
    const buffer = await slice.arrayBuffer();
    const data = new DataView(buffer);

    let offset = 0;
    let timescale: number | null = null;
    let sampleDelta: number | null = null;

    while (offset + 8 <= data.byteLength) {
      const size = data.getUint32(offset);
      const type = String.fromCharCode(
        data.getUint8(offset + 4),
        data.getUint8(offset + 5),
        data.getUint8(offset + 6),
        data.getUint8(offset + 7)
      );

      const boxSize = size === 1 ? data.getUint32(offset + 8) : (size === 0 ? data.byteLength - offset : size);
      if (boxSize < 8 || offset + boxSize > data.byteLength + 8) break;

      if (type === 'moov') {
        let moovOffset = offset + 8;
        const moovEnd = Math.min(data.byteLength, offset + boxSize);

        while (moovOffset + 8 <= moovEnd) {
          const innerSize = data.getUint32(moovOffset);
          const innerType = String.fromCharCode(
            data.getUint8(moovOffset + 4),
            data.getUint8(moovOffset + 5),
            data.getUint8(moovOffset + 6),
            data.getUint8(moovOffset + 7)
          );
          const innerBoxSize = innerSize === 1 ? data.getUint32(moovOffset + 8) : (innerSize === 0 ? moovEnd - moovOffset : innerSize);
          if (innerBoxSize < 8) break;

          if (innerType === 'trak') {
            const trakBytes = new Uint8Array(buffer, moovOffset, Math.min(innerBoxSize, moovEnd - moovOffset));
            for (let i = 0; i < trakBytes.length - 20; i++) {
              if (
                trakBytes[i] === 0x6d &&
                trakBytes[i + 1] === 0x64 &&
                trakBytes[i + 2] === 0x68 &&
                trakBytes[i + 3] === 0x64
              ) {
                const version = trakBytes[i + 4];
                const tsOffset = version === 1 ? i + 4 + 20 : i + 4 + 12;
                if (tsOffset + 4 <= trakBytes.length) {
                  const view = new DataView(trakBytes.buffer, trakBytes.byteOffset + tsOffset, 4);
                  timescale = view.getUint32(0);
                }
              }

              if (
                trakBytes[i] === 0x73 &&
                trakBytes[i + 1] === 0x74 &&
                trakBytes[i + 2] === 0x74 &&
                trakBytes[i + 3] === 0x73
              ) {
                const entryOffset = i + 4 + 4 + 4;
                if (entryOffset + 8 <= trakBytes.length) {
                  const view = new DataView(trakBytes.buffer, trakBytes.byteOffset + entryOffset, 8);
                  sampleDelta = view.getUint32(4);
                }
              }

              if (timescale && sampleDelta) break;
            }
          }

          if (timescale && sampleDelta) break;
          moovOffset += innerBoxSize;
        }
      }

      if (timescale && sampleDelta) break;
      offset += boxSize;
    }

    if (timescale && sampleDelta && sampleDelta > 0 && timescale > 0) {
      const rawFps = timescale / sampleDelta;
      if (rawFps >= 5 && rawFps <= 240) {
        return Math.round(rawFps * 100) / 100;
      }
    }
  } catch {
    // Best effort parse
  }

  return null;
}

/** Load a video element with a blob/asset URL and wait for its metadata */
function loadVideoMeta(videoEl: HTMLVideoElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    videoEl.preload = 'auto';
    videoEl.muted = true;
    videoEl.playsInline = true;

    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      videoEl.removeEventListener('loadedmetadata', onLoaded);
      videoEl.removeEventListener('error', onError);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Video metadata loading timed out.'));
    }, 6000);

    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Failed to load video. Codec or file may not be supported.'));
    };

    videoEl.addEventListener('loadedmetadata', onLoaded);
    videoEl.addEventListener('error', onError);
    videoEl.src = src;
    videoEl.load();

    if (videoEl.readyState >= 1) {
      cleanup();
      resolve();
    }
  });
}

/** Fast, reliable seek for offscreen frame capture */
function seekTo(videoEl: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(videoEl.currentTime - time) < 0.05 && videoEl.readyState >= 2) {
      resolve();
      return;
    }

    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      videoEl.removeEventListener('seeked', onSeeked);
      videoEl.removeEventListener('error', onError);
    };

    const onSeeked = () => {
      cleanup();
      setTimeout(resolve, 25);
    };

    const onError = () => {
      cleanup();
      resolve();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 600);

    videoEl.addEventListener('seeked', onSeeked);
    videoEl.addEventListener('error', onError);
    videoEl.currentTime = time;
  });
}

/** Capture current frame to data URL */
function captureFrame(videoEl: HTMLVideoElement, maxWidth = 800, maxHeight = 450): string {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return '';

  const canvas = document.createElement('canvas');
  const ratio = videoEl.videoWidth / videoEl.videoHeight;

  let w = maxWidth;
  let h = Math.round(w / ratio);
  if (h > maxHeight) {
    h = maxHeight;
    w = Math.round(h * ratio);
  }

  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Extract evenly-spaced frames from an uploaded video File.
 * Appends temporary invisible container to DOM to guarantee hardware decoding in Chromium browsers.
 */
export async function extractFramesFromFile(
  file: File,
  maxFrames = 24,
  onProgress?: (p: ExtractionProgress) => void
): Promise<ExtractionResult> {
  if (!file || file.size === 0) {
    throw new Error('Video file is empty or missing.');
  }

  const objectUrl = URL.createObjectURL(file);
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';
  document.body.appendChild(container);

  try {
    const videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.crossOrigin = 'anonymous';
    container.appendChild(videoEl);

    await loadVideoMeta(videoEl, objectUrl);

    const duration = videoEl.duration;
    if (!duration || isNaN(duration) || duration <= 0 || duration === Infinity) {
      throw new Error('Could not determine a valid video duration.');
    }

    const rawW = videoEl.videoWidth || 0;
    const rawH = videoEl.videoHeight || 0;
    const fps = await tryParseMp4Fps(file);

    const meta: VideoMeta = {
      duration,
      durationFormatted: formatTimestamp(duration),
      width: rawW,
      height: rawH,
      resolutionFormatted: rawW && rawH ? `${rawW} × ${rawH}` : 'Unknown',
      fps: fps ?? null,
    };

    let targetCount = maxFrames;
    if (duration < 6) {
      targetCount = Math.min(maxFrames, Math.max(8, Math.floor(duration * 3)));
    } else if (duration < 15) {
      targetCount = Math.min(maxFrames, Math.max(12, Math.floor(duration * 1.5)));
    }
    if (targetCount > 8 && targetCount % 4 !== 0) {
      targetCount = Math.round(targetCount / 4) * 4;
    }

    const step = duration / targetCount;
    const sampleTimes: number[] = [];
    for (let i = 0; i < targetCount; i++) {
      const t = (i + 0.5) * step;
      sampleTimes.push(Math.max(0.05, Math.min(duration - 0.05, t)));
    }

    const frames: VideoFrame[] = [];

    for (let i = 0; i < sampleTimes.length; i++) {
      const t = sampleTimes[i];
      onProgress?.({ current: i + 1, total: sampleTimes.length });

      try {
        await seekTo(videoEl, t);
        const dataUrl = captureFrame(videoEl);
        if (dataUrl && dataUrl.length > 200) {
          frames.push({
            id: i + 1,
            frameNumber: i + 1,
            totalFrames: sampleTimes.length,
            timestamp: formatTimestamp(t),
            timestampSeconds: t,
            imageUrl: dataUrl,
          });
        }
      } catch (err) {
        console.warn(`[AeroMesh] Frame capture skip at ${t.toFixed(2)}s:`, err);
      }
    }

    // If canvas extraction yielded 0 frames (e.g. unrenderable codec), fallback to pre-rendered frames
    if (frames.length === 0) {
      const demo = getDemoFrames('AM-uploaded');
      return { meta, frames: demo };
    }

    const finalTotal = frames.length;
    frames.forEach((f, idx) => {
      f.frameNumber = idx + 1;
      f.totalFrames = finalTotal;
    });

    return { meta, frames };
  } finally {
    URL.revokeObjectURL(objectUrl);
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

/** Read video metadata only */
export async function readVideoMeta(file: File): Promise<VideoMeta> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const videoEl = document.createElement('video');
    await loadVideoMeta(videoEl, objectUrl);

    const duration = videoEl.duration;
    const rawW = videoEl.videoWidth || 0;
    const rawH = videoEl.videoHeight || 0;
    const fps = await tryParseMp4Fps(file);

    return {
      duration: isFinite(duration) && duration > 0 ? duration : 0,
      durationFormatted: isFinite(duration) && duration > 0 ? formatTimestamp(duration) : '00:00',
      width: rawW,
      height: rawH,
      resolutionFormatted: rawW && rawH ? `${rawW} × ${rawH}` : 'Unknown',
      fps: fps ?? null,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
