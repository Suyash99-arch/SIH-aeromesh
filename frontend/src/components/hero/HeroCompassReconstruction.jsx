import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useTilt } from '../primitives/hooks.ts';
import Icon from '../ui/Icon';

/**
 * HeroCompassReconstruction Component
 * Staged inside concentric ring guides with N / S / E / W compass ticks.
 * Features an auto-rotating photogrammetric 3D wireframe mesh & point-cloud
 * sitting at the center, combined with useTilt for subtle cursor parallax.
 */
export default function HeroCompassReconstruction() {
  const tiltRef = useTilt(8);
  const mountRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Setup Three.js Scene, Camera, Renderer
    const width = container.clientWidth || 440;
    const height = container.clientHeight || 440;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 5.5, 9.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    // 2. Build 3D Photogrammetric Wireframe & Point Cloud Model
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Create contoured terrain / site geometry
    const planeGeo = new THREE.PlaneGeometry(6.4, 6.4, 24, 24);
    const pos = planeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // Realistic terrain contours with central structure elevation
      const d = Math.sqrt(x * x + y * y);
      const zVal =
        Math.sin(x * 1.2) * 0.35 +
        Math.cos(y * 1.2) * 0.3 +
        Math.exp(-d * 0.9) * 1.6 +
        Math.sin(x * 3.5 + y * 2.5) * 0.12;
      pos.setZ(i, zVal);
    }
    planeGeo.computeVertexNormals();

    // Wireframe Mesh
    const wireframeMat = new THREE.MeshStandardMaterial({
      color: 0x38d7ff,
      wireframe: true,
      transparent: true,
      opacity: 0.72,
      roughness: 0.4,
      metalness: 0.3,
    });
    const terrainWire = new THREE.Mesh(planeGeo, wireframeMat);
    terrainWire.rotation.x = -Math.PI * 0.46;
    modelGroup.add(terrainWire);

    // Translucent Solid Facets beneath wireframe for holographic depth
    const solidMat = new THREE.MeshStandardMaterial({
      color: 0x0e1b2f,
      transparent: true,
      opacity: 0.45,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    const terrainSolid = new THREE.Mesh(planeGeo, solidMat);
    terrainSolid.rotation.x = -Math.PI * 0.46;
    modelGroup.add(terrainSolid);

    // Inlier Photogrammetric Point Cloud (COLMAP style)
    const ptCount = 680;
    const ptPositions = new Float32Array(ptCount * 3);
    const ptColors = new Float32Array(ptCount * 3);
    const c1 = new THREE.Color('#4fd8ff');
    const c2 = new THREE.Color('#8b7bff');

    for (let i = 0; i < ptCount; i++) {
      const u = (Math.random() - 0.5) * 6.2;
      const v = (Math.random() - 0.5) * 6.2;
      const dist = Math.sqrt(u * u + v * v);
      const h =
        Math.sin(u * 1.2) * 0.35 +
        Math.cos(v * 1.2) * 0.3 +
        Math.exp(-dist * 0.9) * 1.6 +
        (Math.random() - 0.5) * 0.25;

      ptPositions[i * 3] = u;
      ptPositions[i * 3 + 1] = v;
      ptPositions[i * 3 + 2] = h + 0.05;

      const mix = Math.random();
      const mixedColor = c1.clone().lerp(c2, mix);
      ptColors[i * 3] = mixedColor.r;
      ptColors[i * 3 + 1] = mixedColor.g;
      ptColors[i * 3 + 2] = mixedColor.b;
    }

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(ptPositions, 3));
    pointsGeo.setAttribute('color', new THREE.BufferAttribute(ptColors, 3));

    const pointsMat = new THREE.PointsMaterial({
      size: 0.085,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: true,
    });

    const pointCloud = new THREE.Points(pointsGeo, pointsMat);
    pointCloud.rotation.x = -Math.PI * 0.46;
    modelGroup.add(pointCloud);

    // Aerial Orbit Frustum Cone & Camera Station Indicator
    const droneMarker = new THREE.Group();
    droneMarker.position.set(2.4, 2.2, 2.4);

    const frustumGeo = new THREE.ConeGeometry(0.75, 1.6, 4, 1, true);
    const frustumMat = new THREE.MeshBasicMaterial({
      color: 0x4fd8ff,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    const frustumMesh = new THREE.Mesh(frustumGeo, frustumMat);
    frustumMesh.rotation.x = Math.PI;
    frustumMesh.rotation.z = Math.PI * 0.25;
    droneMarker.add(frustumMesh);

    const sphereGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x8b7bff });
    droneMarker.add(new THREE.Mesh(sphereGeo, sphereMat));
    modelGroup.add(droneMarker);

    // Subtle ambient & directional lights
    const ambLight = new THREE.AmbientLight(0x4fd8ff, 0.8);
    scene.add(ambLight);
    const dirLight = new THREE.DirectionalLight(0x8b7bff, 1.4);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    // 3. 60FPS Animation Loop with Continuous Slow Rotation
    let rafId = null;
    const timer = new THREE.Timer();

    const animate = () => {
      timer.update();
      const elapsed = timer.getElapsed();
      // Continuous slow rotation around Y-axis
      modelGroup.rotation.y = elapsed * 0.28;
      // Gentle pitch & roll breathing
      modelGroup.rotation.x = Math.sin(elapsed * 0.6) * 0.06;
      modelGroup.position.y = Math.sin(elapsed * 0.8) * 0.08 - 0.2;

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };
    window.addEventListener('resize', handleResize);

    // Cleanup GPU resources on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
      planeGeo.dispose();
      wireframeMat.dispose();
      solidMat.dispose();
      pointsGeo.dispose();
      pointsMat.dispose();
      frustumGeo.dispose();
      frustumMat.dispose();
      sphereGeo.dispose();
      sphereMat.dispose();
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div ref={tiltRef} className="hero-compass-card glass">
      <div className="glass-sheen" aria-hidden="true" />

      {/* Cardinal Compass Ring Overlay */}
      <div className="compass-staging-rings" aria-hidden="true">
        {/* Outer Ring with Cardinal Directions */}
        <div className="compass-ring compass-ring-outer" />
        <div className="compass-ring compass-ring-mid" />
        <div className="compass-ring compass-ring-inner" />
        <div className="compass-crosshair-h" />
        <div className="compass-crosshair-v" />

        {/* Cardinal Direction Labels */}
        <div className="compass-label compass-n">
          <span className="compass-tick-icon">▲</span>
          <span className="compass-text">N</span>
          <span className="compass-deg">000°</span>
        </div>
        <div className="compass-label compass-s">
          <span className="compass-text">S</span>
          <span className="compass-deg">180°</span>
        </div>
        <div className="compass-label compass-e">
          <span className="compass-text">E</span>
          <span className="compass-deg">090°</span>
        </div>
        <div className="compass-label compass-w">
          <span className="compass-text">W</span>
          <span className="compass-deg">270°</span>
        </div>

        {/* Intermediate degree ticks */}
        <div className="compass-degree-tick tick-30">030°</div>
        <div className="compass-degree-tick tick-60">060°</div>
        <div className="compass-degree-tick tick-120">120°</div>
        <div className="compass-degree-tick tick-150">150°</div>
        <div className="compass-degree-tick tick-210">210°</div>
        <div className="compass-degree-tick tick-240">240°</div>
        <div className="compass-degree-tick tick-300">300°</div>
        <div className="compass-degree-tick tick-330">330°</div>
      </div>

      {/* Top Telemetry Header inside Card */}
      <div className="hero-compass-header">
        <div className="hero-compass-title">
          <div className="glowing-icon-circle sm">
            <Icon name="Radar" size={16} />
          </div>
          <div>
            <div className="hero-compass-name">AERIAL PHOTOGRAMMETRIC MESH</div>
            <div className="hero-compass-sub">AUTONOMOUS 6-DoF ORBIT · REAL-TIME RECONSTRUCTION</div>
          </div>
        </div>
        <div className="hero-compass-badge">
          <span className="pulse-dot-cyan" />
          <span>3D RECONSTRUCTION LIVE</span>
        </div>
      </div>

      {/* Central 3D Canvas WebGL Container */}
      <div className="hero-canvas-viewport" ref={mountRef} />

      {/* Bottom Telemetry Dock */}
      <div className="hero-compass-footer">
        <div className="compass-meta-cell">
          <span className="compass-meta-label">REPROJECTION ERROR</span>
          <strong className="compass-meta-val">0.55 px</strong>
        </div>
        <div className="compass-meta-cell">
          <span className="compass-meta-label">INLIER 3D POINTS</span>
          <strong className="compass-meta-val">12,916 pts</strong>
        </div>
        <div className="compass-meta-cell">
          <span className="compass-meta-label">CAMERA STATIONS</span>
          <strong className="compass-meta-val">20 / 20 FIXED</strong>
        </div>
        <div className="compass-meta-cell">
          <span className="compass-meta-label">SCALE CALIBRATION</span>
          <strong className="compass-meta-val" style={{ color: 'var(--cyan)' }}>
            METRIC GSD 1.00m
          </strong>
        </div>
      </div>
    </div>
  );
}
