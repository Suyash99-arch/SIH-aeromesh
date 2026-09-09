import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Detection, PointCloudData } from '../../types/aerial.ts';

export interface ScreenAnchor {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface ReconstructionCanvasProps {
  pointCloudData?: PointCloudData | null;
  detections?: Detection[];
  selectedObject?: Detection | null;
  onSelectObject?: (obj: Detection) => void;
  onFirstFrame?: () => void;
  onUpdateScreenAnchors?: (anchors: ScreenAnchor[]) => void;
  focusTrigger?: number;
}

/**
 * Module-level cached circular point texture.
 * Solid anti-aliased sensor dot with tight edge feathering to ensure
 * dense photogrammetric sensor dust rather than planetary orbs.
 */
let cachedGlowPointTexture: THREE.CanvasTexture | null = null;
function getGlowPointTexture(): THREE.CanvasTexture {
  if (cachedGlowPointTexture) return cachedGlowPointTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 32, 32);
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.72, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.92, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(16, 16, 16, 0, Math.PI * 2);
    ctx.fill();
  }
  cachedGlowPointTexture = new THREE.CanvasTexture(canvas);
  cachedGlowPointTexture.generateMipmaps = false;
  cachedGlowPointTexture.minFilter = THREE.LinearFilter;
  cachedGlowPointTexture.magFilter = THREE.LinearFilter;
  return cachedGlowPointTexture;
}

export const ReconstructionCanvas: React.FC<ReconstructionCanvasProps> = ({
  pointCloudData,
  detections = [],
  selectedObject = null,
  onSelectObject,
  onFirstFrame,
  onUpdateScreenAnchors,
  focusTrigger = 0,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const onSelectObjectRef = useRef(onSelectObject);
  onSelectObjectRef.current = onSelectObject;
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;
  const onUpdateScreenAnchorsRef = useRef(onUpdateScreenAnchors);
  onUpdateScreenAnchorsRef.current = onUpdateScreenAnchors;

  const focusObjRef = useRef<Detection | null>(null);
  focusObjRef.current = selectedObject;
  const prevFocusTriggerRef = useRef(focusTrigger);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let isDisposed = false;
    let rafId: number | null = null;

    // === THREE.JS CORE SETUP ===
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05070c, 0.012);

    const camera = new THREE.PerspectiveCamera(
      42,
      mount.clientWidth / Math.max(mount.clientHeight, 1),
      0.1,
      120
    );

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      depth: true,
    });
    // Cap pixel ratio at 1.5 to maintain crisp lines without fillrate choking on high-DPI laptop displays
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x05070c, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    // === RESTRAINED HALF-RESOLUTION SENSOR BLOOM (60fps Optimized) ===
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Half-resolution bloom pass eliminates GPU fragment fillrate bottlenecks
    const halfWidth = Math.max(1, Math.floor(mount.clientWidth / 2));
    const halfHeight = Math.max(1, Math.floor(mount.clientHeight / 2));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(halfWidth, halfHeight),
      0.18, // Subtle restrained sensor glow (prevents orb blowout)
      0.25, // Tight radius
      0.72  // Only bright accents bloom
    );
    composer.addPass(bloomPass);

    // === SCENE ACCENTS & GRID ===
    const grid = new THREE.GridHelper(26, 26, 0x24334a, 0x101724);
    grid.position.y = -0.9;
    scene.add(grid);

    // Bounding wireframe
    const icoGeo = new THREE.IcosahedronGeometry(2.2, 1);
    const icoWire = new THREE.WireframeGeometry(icoGeo);
    const icoMat = new THREE.LineBasicMaterial({
      color: '#8b7bff',
      transparent: true,
      opacity: 0.22,
    });
    const ico = new THREE.LineSegments(icoWire, icoMat);
    ico.position.y = 2.4;
    scene.add(ico);

    // Contact Selection Pulse Ring
    const pulseRingGeo = new THREE.RingGeometry(0.25, 0.38, 32);
    const pulseRingMat = new THREE.MeshBasicMaterial({
      color: '#4fd8ff',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
    });
    const pulseRing = new THREE.Mesh(pulseRingGeo, pulseRingMat);
    pulseRing.rotation.x = -Math.PI / 2;
    scene.add(pulseRing);

    // === CRISP PHOTOGRAMMETRIC POINT CLOUD ===
    const glowTexture = getGlowPointTexture();
    let pointsMesh: THREE.Points | null = null;
    let targetPositions: Float32Array | null = null;
    let animatedPositions: Float32Array | null = null;
    let pointsGeo: THREE.BufferGeometry | null = null;
    let pointsMat: THREE.PointsMaterial | null = null;

    if (pointCloudData && pointCloudData.count > 0) {
      targetPositions = pointCloudData.positions;
      animatedPositions = new Float32Array(targetPositions.length);

      // Start positions flattened for materializing transition
      for (let i = 0; i < targetPositions.length; i += 3) {
        animatedPositions[i] = targetPositions[i];
        animatedPositions[i + 1] = -0.9 + (targetPositions[i + 1] - -0.9) * 0.05;
        animatedPositions[i + 2] = targetPositions[i + 2];
      }

      pointsGeo = new THREE.BufferGeometry();
      pointsGeo.setAttribute('position', new THREE.BufferAttribute(animatedPositions, 3));
      pointsGeo.setAttribute('color', new THREE.BufferAttribute(pointCloudData.colors, 3));

      // Tight, crisp particle sizing with NormalBlending prevents additive blowout
      pointsMat = new THREE.PointsMaterial({
        size: 0.038,
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        map: glowTexture,
        alphaTest: 0.01,
        depthWrite: false,
        blending: THREE.NormalBlending,
        sizeAttenuation: true,
      });

      pointsMesh = new THREE.Points(pointsGeo, pointsMat);
      scene.add(pointsMesh);
    }

    // === 3D HIT TESTING VOLUMES FOR REAL 3D PICKING ===
    const hitVolumeGroup = new THREE.Group();
    scene.add(hitVolumeGroup);

    const hitMeshMap = new Map<string, THREE.Mesh>();
    const hitGeo = new THREE.SphereGeometry(0.65, 12, 10);

    detections.forEach((det) => {
      const toneColor = det.tone === 'amber' ? 0xffb454 : det.tone === 'violet' ? 0x8b7bff : 0x4fd8ff;
      const isSelected = selectedObject?.id === det.id;
      const hitMat = new THREE.MeshBasicMaterial({
        color: toneColor,
        wireframe: true,
        transparent: true,
        opacity: isSelected ? 0.35 : 0.0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(hitGeo, hitMat);
      mesh.position.set(det.pos[0], det.pos[1], det.pos[2]);
      if (isSelected) {
        mesh.scale.set(1.15, 1.15, 1.15);
      }
      mesh.userData = { detection: det };
      hitVolumeGroup.add(mesh);
      hitMeshMap.set(det.id, mesh);
    });

    // === CAMERA ORBIT, PAN, ZOOM, AND INERTIA STATE ===
    let azimuth = -0.3;
    let polar = 0.38;
    let radius = 12.5;
    const currentTarget = new THREE.Vector3(0, 0.8, 0);

    let vAzimuth = 0;
    let vPolar = 0;
    let vRadius = 0;
    const vTarget = new THREE.Vector3(0, 0, 0);

    let isTweeningCamera = false;
    let tweenProgress = 0;
    const tweenStartTarget = new THREE.Vector3();
    const tweenEndTarget = new THREE.Vector3();
    let tweenStartRadius = 12.5;
    let tweenEndRadius = 5.5;

    let loadProgress = 0;
    const loadDuration = 1000;
    const startTime = performance.now();

    let pulseScale = 1.0;
    let isPulsing = false;

    let lastInteractionTime = performance.now();
    let autoOrbitFactor = 0;

    // Raycaster throttled via rAF
    const raycaster = new THREE.Raycaster();
    const mouseNorm = new THREE.Vector2(-999, -999);
    let pendingRaycast = false;
    let hoveredObjectId: string | null = null;

    const activePointers = new Map<number, { x: number; y: number; button: number }>();
    let initialPinchDist = 0;

    // Throttled Raycast Execution
    const executeRaycast = () => {
      pendingRaycast = false;
      raycaster.setFromCamera(mouseNorm, camera);
      const hits = raycaster.intersectObjects(hitVolumeGroup.children);

      let newHoverId: string | null = null;
      if (hits.length > 0) {
        const topHit = hits[0].object as THREE.Mesh;
        newHoverId = topHit.userData.detection?.id || null;
      }

      if (newHoverId !== hoveredObjectId) {
        if (hoveredObjectId && hitMeshMap.has(hoveredObjectId)) {
          const oldMesh = hitMeshMap.get(hoveredObjectId)!;
          const isSelected = focusObjRef.current?.id === hoveredObjectId;
          oldMesh.scale.set(isSelected ? 1.15 : 1.0, isSelected ? 1.15 : 1.0, isSelected ? 1.15 : 1.0);
          (oldMesh.material as THREE.MeshBasicMaterial).opacity = isSelected ? 0.35 : 0.0;
        }

        if (newHoverId && hitMeshMap.has(newHoverId)) {
          const newMesh = hitMeshMap.get(newHoverId)!;
          newMesh.scale.set(1.25, 1.25, 1.25);
          (newMesh.material as THREE.MeshBasicMaterial).opacity = 0.65;
          mount.style.cursor = 'pointer';
        } else if (activePointers.size === 0) {
          mount.style.cursor = 'grab';
        }

        hoveredObjectId = newHoverId;
      }
    };

    const scheduleRaycast = (clientX: number, clientY: number) => {
      const rect = mount.getBoundingClientRect();
      mouseNorm.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouseNorm.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      pendingRaycast = true;
    };

    // Pointer Events
    const onPointerDown = (e: PointerEvent) => {
      lastInteractionTime = performance.now();
      autoOrbitFactor = 0;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });

      if (activePointers.size === 1) {
        mount.style.cursor = 'grabbing';
      } else if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        initialPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }

      if (mount.setPointerCapture) {
        try {
          mount.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      lastInteractionTime = performance.now();
      scheduleRaycast(e.clientX, e.clientY);

      if (!activePointers.has(e.pointerId)) return;

      const prev = activePointers.get(e.pointerId)!;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });

      if (activePointers.size === 1) {
        if (prev.button === 2 || e.shiftKey) {
          const right = new THREE.Vector3();
          const up = new THREE.Vector3(0, 1, 0);
          camera.getWorldDirection(right);
          right.cross(up).normalize();

          vTarget.addScaledVector(right, -dx * 0.005);
          vTarget.addScaledVector(up, dy * 0.005);
        } else {
          vAzimuth -= dx * 0.0042;
          vPolar += dy * 0.0042;
        }
      } else if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const distDiff = currentDist - initialPinchDist;
        vRadius -= distDiff * 0.009;
        initialPinchDist = currentDist;

        const avgDx = dx * 0.5;
        const right = new THREE.Vector3();
        camera.getWorldDirection(right);
        right.cross(new THREE.Vector3(0, 1, 0)).normalize();
        vTarget.addScaledVector(right, -avgDx * 0.004);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      lastInteractionTime = performance.now();
      const prev = activePointers.get(e.pointerId);
      activePointers.delete(e.pointerId);

      if (prev && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 5) {
        if (hoveredObjectId) {
          const det = detections.find((d) => d.id === hoveredObjectId);
          if (det) {
            onSelectObjectRef.current?.(det);
            pulseRing.position.set(det.pos[0], det.pos[1] - 0.2, det.pos[2]);
            pulseScale = 0.3;
            isPulsing = true;
          }
        }
      }

      if (activePointers.size === 0) {
        mount.style.cursor = hoveredObjectId ? 'pointer' : 'grab';
      }

      if (mount.releasePointerCapture) {
        try {
          mount.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInteractionTime = performance.now();
      autoOrbitFactor = 0;
      vRadius += e.deltaY * 0.006;
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    mount.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('wheel', onWheel, { passive: false });
    mount.addEventListener('contextmenu', onContextMenu);

    // ResizeObserver
    const ro = new ResizeObserver((entries) => {
      if (isDisposed || !mount) return;
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (width > 0 && height > 0) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
          composer.setSize(width, height);
          bloomPass.setSize(Math.floor(width / 2), Math.floor(height / 2));
        }
      }
    });
    ro.observe(mount);

    const triggerFocusOnSelected = (targetPos: [number, number, number]) => {
      isTweeningCamera = true;
      tweenProgress = 0;
      tweenStartTarget.copy(currentTarget);
      tweenEndTarget.set(targetPos[0], targetPos[1], targetPos[2]);
      tweenStartRadius = radius;
      tweenEndRadius = Math.max(3.8, Math.min(6.2, radius * 0.65));

      pulseRing.position.set(targetPos[0], targetPos[1] - 0.2, targetPos[2]);
      pulseScale = 0.3;
      isPulsing = true;
    };

    // Animation Loop
    let announced = false;
    let anchorFrameCounter = 0;
    const anchorVec = new THREE.Vector3();
    const animate = (time: number) => {
      if (isDisposed) return;

      // 1. Throttled Raycast Execution
      if (pendingRaycast) {
        executeRaycast();
      }

      // 2. Materializing Load-in Animation
      if (loadProgress < 1.0 && targetPositions && animatedPositions && pointsGeo && pointsMat) {
        const elapsed = time - startTime;
        loadProgress = Math.min(1.0, elapsed / loadDuration);
        const eased = 1 - Math.pow(1 - loadProgress, 3);

        for (let i = 0; i < targetPositions.length; i += 3) {
          const targetY = targetPositions[i + 1];
          const startY = -0.9 + (targetY - -0.9) * 0.05;
          animatedPositions[i + 1] = startY + (targetY - startY) * eased;
        }

        pointsGeo.attributes.position.needsUpdate = true;
      }

      // 3. Camera Tweening ("Focus in 3D")
      if (isTweeningCamera) {
        tweenProgress = Math.min(1.0, tweenProgress + 0.038);
        const t = tweenProgress * tweenProgress * (3 - 2 * tweenProgress);
        currentTarget.lerpVectors(tweenStartTarget, tweenEndTarget, t);
        radius = tweenStartRadius + (tweenEndRadius - tweenStartRadius) * t;

        if (tweenProgress >= 1.0) {
          isTweeningCamera = false;
        }
      }

      // 4. Ambient Auto-Orbit
      const idleTime = time - lastInteractionTime;
      if (idleTime > 3000 && !isTweeningCamera && activePointers.size === 0) {
        autoOrbitFactor = Math.min(1.0, autoOrbitFactor + 0.015);
      } else {
        autoOrbitFactor = Math.max(0.0, autoOrbitFactor - 0.05);
      }
      azimuth += 0.0018 * autoOrbitFactor;

      // 5. Inertia Physics
      azimuth += vAzimuth;
      polar = Math.max(0.06, Math.min(Math.PI / 2.05, polar + vPolar));
      radius = Math.max(2.8, Math.min(26.0, radius + vRadius));
      currentTarget.add(vTarget);

      vAzimuth *= 0.91;
      vPolar *= 0.91;
      vRadius *= 0.86;
      vTarget.multiplyScalar(0.86);

      // 6. Camera Transform
      const cy = Math.sin(polar) * radius;
      const hRadius = Math.cos(polar) * radius;
      const cx = Math.sin(azimuth) * hRadius;
      const cz = Math.cos(azimuth) * hRadius;

      camera.position.set(currentTarget.x + cx, currentTarget.y + cy, currentTarget.z + cz);
      camera.lookAt(currentTarget);

      // 7. Pulse Ring
      if (isPulsing) {
        pulseScale += 0.06;
        const opacity = Math.max(0, 1.0 - (pulseScale - 0.3) / 1.4);
        pulseRing.scale.set(pulseScale, pulseScale, pulseScale);
        (pulseRing.material as THREE.MeshBasicMaterial).opacity = opacity;
        if (opacity <= 0.02) {
          isPulsing = false;
          (pulseRing.material as THREE.MeshBasicMaterial).opacity = 0;
        }
      }

      // 8. Subtle Mesh Rotations
      if (pointsMesh) {
        pointsMesh.rotation.y += 0.0002;
      }
      ico.rotation.y -= 0.001;

      // 9. Render Composer (Restrained bloom)
      composer.render();

      // 10. Project 3D Screen Anchors for Marker Chips (throttled every 2 frames for active chips)
      anchorFrameCounter++;
      if (onUpdateScreenAnchorsRef.current && detections.length > 0 && anchorFrameCounter % 2 === 0) {
        const width = mount.clientWidth;
        const height = mount.clientHeight;
        const activeDetections = detections.slice(0, 16);

        const anchors: ScreenAnchor[] = activeDetections.map((d) => {
          anchorVec.set(d.pos[0], d.pos[1], d.pos[2]);
          anchorVec.project(camera);

          const screenX = ((anchorVec.x + 1) / 2) * width;
          const screenY = ((-anchorVec.y + 1) / 2) * height;
          const isFront = anchorVec.z < 1.0;

          return {
            id: d.id,
            x: screenX,
            y: screenY,
            visible: isFront && screenX >= -20 && screenX <= width + 20 && screenY >= -20 && screenY <= height + 20,
          };
        });

        onUpdateScreenAnchorsRef.current(anchors);
      }

      if (!announced) {
        announced = true;
        onFirstFrameRef.current?.();
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    if (focusTrigger !== prevFocusTriggerRef.current) {
      prevFocusTriggerRef.current = focusTrigger;
      if (focusObjRef.current) {
        triggerFocusOnSelected(focusObjRef.current.pos);
      }
    }

    // Strict Dispose
    return () => {
      isDisposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();

      mount.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('wheel', onWheel);
      mount.removeEventListener('contextmenu', onContextMenu);

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        }
      });

      composer.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [pointCloudData, detections, focusTrigger]);

  return (
    <div
      ref={mountRef}
      className="canvas-mount"
      role="region"
      aria-label="Interactive 3D Photogrammetry Viewport. Left-drag to orbit, right-drag to pan, scroll to zoom, click 3D objects to inspect."
      tabIndex={0}
    />
  );
};
