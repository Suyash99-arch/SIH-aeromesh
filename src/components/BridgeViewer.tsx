import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FilterState, CustomMarking } from '../types';
import { Crosshair, Plus, Minus, Compass, Maximize2, Flame, AlertTriangle, Home, MapPin, Anchor, Mountain as MountainIcon, Droplets } from 'lucide-react';

interface BridgeViewerProps {
  filters: FilterState;
  markings: CustomMarking[];
  onRecenter?: () => void;
}

export const BridgeViewer: React.FC<BridgeViewerProps> = ({ filters, markings }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [compassAngle, setCompassAngle] = useState<number>(0);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Screen projected coordinates for markers
  const [screenMarkers, setScreenMarkers] = useState<{
    id: string;
    name: string;
    type: string;
    color: string;
    visible: boolean;
    x: number;
    y: number;
    zDist: number;
    iconType?: string;
  }[]>([]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030713);
    scene.fog = new THREE.FogExp2(0x030713, 0.015);

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 400);
    camera.position.set(18, 16, 22);
    cameraRef.current = camera;

    // 3. Renderer Setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 4. Orbit Controls (Smooth Auto-Rotate + Manual Drag & Zoom)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 3.8, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.75;
    controls.minDistance = 6;
    controls.maxDistance = 55;
    controls.maxPolarAngle = Math.PI / 2 - 0.04; // Keep camera above ground
    controls.minPolarAngle = 0.1;
    controls.update();
    controlsRef.current = controls;

    // 5. Lighting
    // Ambient fill
    const ambientLight = new THREE.AmbientLight(0x0a224a, 3.0);
    scene.add(ambientLight);

    // Key Directional Light (Crisp Blue-White)
    const mainDirLight = new THREE.DirectionalLight(0x50c8ff, 3.2);
    mainDirLight.position.set(22, 35, 18);
    mainDirLight.castShadow = true;
    mainDirLight.shadow.mapSize.width = 2048;
    mainDirLight.shadow.mapSize.height = 2048;
    mainDirLight.shadow.bias = -0.0005;
    scene.add(mainDirLight);

    // Rim/Back Light (Cyan)
    const rimLight = new THREE.DirectionalLight(0x00e5ff, 2.4);
    rimLight.position.set(-20, 18, -22);
    scene.add(rimLight);

    // Subtle Warm/Cyan Underlight
    const underLight = new THREE.DirectionalLight(0x004488, 1.2);
    underLight.position.set(0, -10, 0);
    scene.add(underLight);

    // Ground Plinth Under-Glow Point Light
    const plinthGlow = new THREE.PointLight(0x00d2ff, 5.5, 25);
    plinthGlow.position.set(0, 0.4, 0);
    scene.add(plinthGlow);

    // Rooftop Accent Light
    const roofLight = new THREE.PointLight(0x00f5ff, 6.0, 16);
    roofLight.position.set(0, 8.5, 0);
    scene.add(roofLight);

    // 6. Master Groups
    const rootModelGroup = new THREE.Group();
    scene.add(rootModelGroup);

    // ==========================================
    // MATERIALS PALETTE (High-End Cyber Architectural)
    // ==========================================
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0a326a,
      metalness: 0.15,
      roughness: 0.05,
      transmission: 0.62,
      transparent: true,
      opacity: 0.88,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      reflectivity: 0.95,
      ior: 1.5,
    });

    const floorSlabMaterial = new THREE.MeshStandardMaterial({
      color: 0x0c1b36,
      roughness: 0.35,
      metalness: 0.7,
    });

    const darkTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0x061124,
      roughness: 0.5,
      metalness: 0.8,
    });

    const interiorCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0x0070bb,
      transparent: true,
      opacity: 0.32,
    });

    const interiorLightMaterial = new THREE.MeshBasicMaterial({
      color: 0x62d9ff,
      transparent: true,
      opacity: 0.75,
    });

    const glowingEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x00e1ff,
      transparent: true,
      opacity: 0.85,
    });

    const secondaryEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x0088cc,
      transparent: true,
      opacity: 0.5,
    });

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x030712,
      roughness: 0.95,
      metalness: 0.2,
    });

    const plinthMaterial = new THREE.MeshStandardMaterial({
      color: 0x081329,
      roughness: 0.4,
      metalness: 0.6,
    });

    // Helper: Add Mesh with Crisp Glowing Wireframe Edges
    const addMeshWithGlowEdges = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      pos: [number, number, number],
      parent: THREE.Object3D,
      edgeMat: THREE.LineBasicMaterial = glowingEdgeMaterial
    ) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
      edges.position.copy(mesh.position);
      parent.add(edges);

      return mesh;
    };

    // ==========================================
    // 1. GROUND MATRIX & PLINTH ISLAND
    // ==========================================
    // Infinite dark floor
    const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMaterial);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // Deep Grid Helper
    const grid = new THREE.GridHelper(60, 40, 0x0e2852, 0x051024);
    grid.position.y = 0.01;
    scene.add(grid);

    // Elevated Building Plinth Platform (Square Tiered Base)
    const plinthBase = new THREE.Group();
    rootModelGroup.add(plinthBase);

    // Tier 1 (Outer lower plinth)
    addMeshWithGlowEdges(new THREE.BoxGeometry(15.5, 0.25, 15.5), plinthMaterial, [0, 0.125, 0], plinthBase, secondaryEdgeMaterial);
    // Tier 2 (Inner main courtyard deck)
    addMeshWithGlowEdges(new THREE.BoxGeometry(13.5, 0.25, 13.5), new THREE.MeshStandardMaterial({ color: 0x091938, roughness: 0.6, metalness: 0.5 }), [0, 0.35, 0], plinthBase, glowingEdgeMaterial);

    // Beveled Glowing Neon Curb Strip on Island
    const curbGeo = new THREE.BoxGeometry(13.6, 0.06, 13.6);
    const curbEdges = new THREE.LineSegments(new THREE.EdgesGeometry(curbGeo), new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.95 }));
    curbEdges.position.set(0, 0.48, 0);
    plinthBase.add(curbEdges);

    // ==========================================
    // 2. DETAILED ARCHITECTURAL 3D BUILDING
    // ==========================================
    const buildingGroup = new THREE.Group();
    buildingGroup.position.set(0, 0.48, 0);
    rootModelGroup.add(buildingGroup);

    const floorHeight = 1.15;
    const numMainFloors = 6;
    const numWingFloors = 4;

    // Wing A: Main Tower Block (6.4w x 4.8d)
    const mainWidth = 6.4;
    const mainDepth = 4.8;
    const mainOffset: [number, number] = [-0.6, 0.4];

    // Wing B: Connected Stepped Side Wing (3.8w x 3.6d)
    const wingWidth = 3.8;
    const wingDepth = 3.6;
    const wingOffset: [number, number] = [2.8, -1.0];

    // Build Floor-by-Floor for Main Tower
    for (let f = 0; f < numMainFloors; f++) {
      const slabY = f * floorHeight;
      const glassY = slabY + floorHeight / 2;
      const isTopFloors = f >= 4;

      // Setback width for top 2 floors (Architectural terrace)
      const currentWidth = isTopFloors ? mainWidth - 1.2 : mainWidth;
      const currentDepth = isTopFloors ? mainDepth - 0.8 : mainDepth;
      const curOffsetX = isTopFloors ? mainOffset[0] - 0.6 : mainOffset[0];
      const curOffsetZ = isTopFloors ? mainOffset[1] - 0.4 : mainOffset[1];

      // 1. Concrete / Metallic Floor Slab with Cantilever Overhang
      const slabGeo = new THREE.BoxGeometry(currentWidth + 0.35, 0.12, currentDepth + 0.35);
      addMeshWithGlowEdges(slabGeo, floorSlabMaterial, [curOffsetX, slabY + 0.06, curOffsetZ], buildingGroup, glowingEdgeMaterial);

      // 2. Glass Curtain Wall Volume
      const glassGeo = new THREE.BoxGeometry(currentWidth, floorHeight - 0.12, currentDepth);
      addMeshWithGlowEdges(glassGeo, glassMaterial, [curOffsetX, glassY, curOffsetZ], buildingGroup, secondaryEdgeMaterial);

      // 3. Interior Glowing Volume & Floor Plate
      const interiorGeo = new THREE.BoxGeometry(currentWidth * 0.85, floorHeight - 0.2, currentDepth * 0.85);
      const interiorMesh = new THREE.Mesh(interiorGeo, interiorCoreMaterial);
      interiorMesh.position.set(curOffsetX, glassY, curOffsetZ);
      buildingGroup.add(interiorMesh);

      // 4. Vertical Architectural Mullions / Structural Fins
      const mullionCountX = Math.floor(currentWidth / 1.1);
      for (let i = 0; i <= mullionCountX; i++) {
        const mx = curOffsetX - currentWidth / 2 + (currentWidth / mullionCountX) * i;
        // Front & Back Mullions
        const finGeo = new THREE.BoxGeometry(0.06, floorHeight - 0.12, 0.1);
        const finFront = new THREE.Mesh(finGeo, darkTrimMaterial);
        finFront.position.set(mx, glassY, curOffsetZ + currentDepth / 2 + 0.02);
        buildingGroup.add(finFront);
        const finBack = finFront.clone();
        finBack.position.z = curOffsetZ - currentDepth / 2 - 0.02;
        buildingGroup.add(finBack);
      }

      const mullionCountZ = Math.floor(currentDepth / 1.1);
      for (let j = 0; j <= mullionCountZ; j++) {
        const mz = curOffsetZ - currentDepth / 2 + (currentDepth / mullionCountZ) * j;
        // Left & Right Mullions
        const finGeo = new THREE.BoxGeometry(0.1, floorHeight - 0.12, 0.06);
        const finLeft = new THREE.Mesh(finGeo, darkTrimMaterial);
        finLeft.position.set(curOffsetX - currentWidth / 2 - 0.02, glassY, mz);
        buildingGroup.add(finLeft);
        const finRight = finLeft.clone();
        finRight.position.x = curOffsetX + currentWidth / 2 + 0.02;
        buildingGroup.add(finRight);
      }

      // 5. Internal Office Lights (Illuminated Window Ribbons)
      [-currentWidth * 0.25, 0, currentWidth * 0.25].forEach((lx) => {
        const lightRibbon = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.28), interiorLightMaterial);
        lightRibbon.position.set(curOffsetX + lx, glassY + 0.05, curOffsetZ + currentDepth / 2 + 0.01);
        buildingGroup.add(lightRibbon);
      });

      // 6. Terrace Balcony Railing on Setback (Floor 4)
      if (f === 4) {
        const railingGeo = new THREE.BoxGeometry(mainWidth + 0.35, 0.35, 0.04);
        const railing = new THREE.Mesh(railingGeo, glassMaterial);
        railing.position.set(mainOffset[0], slabY + 0.25, mainOffset[1] + mainDepth / 2 + 0.15);
        buildingGroup.add(railing);
      }
    }

    // Build Side Connected Wing (4 Floors)
    for (let f = 0; f < numWingFloors; f++) {
      const slabY = f * floorHeight;
      const glassY = slabY + floorHeight / 2;

      // Slab
      const slabGeo = new THREE.BoxGeometry(wingWidth + 0.3, 0.12, wingDepth + 0.3);
      addMeshWithGlowEdges(slabGeo, floorSlabMaterial, [wingOffset[0], slabY + 0.06, wingOffset[1]], buildingGroup, glowingEdgeMaterial);

      // Glass
      const glassGeo = new THREE.BoxGeometry(wingWidth, floorHeight - 0.12, wingDepth);
      addMeshWithGlowEdges(glassGeo, glassMaterial, [wingOffset[0], glassY, wingOffset[1]], buildingGroup, secondaryEdgeMaterial);

      // Interior
      const interiorGeo = new THREE.BoxGeometry(wingWidth * 0.8, floorHeight - 0.2, wingDepth * 0.8);
      const interiorMesh = new THREE.Mesh(interiorGeo, interiorCoreMaterial);
      interiorMesh.position.set(wingOffset[0], glassY, wingOffset[1]);
      buildingGroup.add(interiorMesh);

      // Window Light Bands
      const lightRibbon = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), interiorLightMaterial);
      lightRibbon.position.set(wingOffset[0], glassY + 0.05, wingOffset[1] + wingDepth / 2 + 0.01);
      buildingGroup.add(lightRibbon);
    }

    // Wing Rooftop Terrace (Floor 4 Top)
    const wingRoofY = numWingFloors * floorHeight;
    addMeshWithGlowEdges(new THREE.BoxGeometry(wingWidth + 0.3, 0.15, wingDepth + 0.3), floorSlabMaterial, [wingOffset[0], wingRoofY + 0.075, wingOffset[1]], buildingGroup);
    // Pergola / Trellis Lattice on Wing Roof
    const pergolaBeamGeo = new THREE.BoxGeometry(wingWidth, 0.08, 0.08);
    for (let p = -1.2; p <= 1.2; p += 0.6) {
      const beam = new THREE.Mesh(pergolaBeamGeo, darkTrimMaterial);
      beam.position.set(wingOffset[0], wingRoofY + 0.75, wingOffset[1] + p);
      buildingGroup.add(beam);
    }

    // Main Tower Rooftop Architecture (Roof Floor 6)
    const mainRoofY = numMainFloors * floorHeight;
    const topW = mainWidth - 1.2;
    const topD = mainDepth - 0.8;
    const topX = mainOffset[0] - 0.6;
    const topZ = mainOffset[1] - 0.4;

    // Roof Parapet / Slab
    addMeshWithGlowEdges(new THREE.BoxGeometry(topW + 0.3, 0.2, topD + 0.3), floorSlabMaterial, [topX, mainRoofY + 0.1, topZ], buildingGroup, glowingEdgeMaterial);

    // Mechanical Penthouse Enclosure (Elevator Core + HVAC)
    addMeshWithGlowEdges(new THREE.BoxGeometry(2.4, 1.2, 1.8), darkTrimMaterial, [topX - 0.5, mainRoofY + 0.7, topZ + 0.2], buildingGroup, glowingEdgeMaterial);

    // Rooftop HVAC Chiller Units
    addMeshWithGlowEdges(new THREE.BoxGeometry(1.1, 0.6, 0.9), new THREE.MeshStandardMaterial({ color: 0x0e2448, roughness: 0.4, metalness: 0.7 }), [topX + 1.1, mainRoofY + 0.4, topZ - 0.4], buildingGroup, secondaryEdgeMaterial);
    addMeshWithGlowEdges(new THREE.BoxGeometry(0.8, 0.5, 0.7), new THREE.MeshStandardMaterial({ color: 0x0e2448, roughness: 0.4, metalness: 0.7 }), [topX + 1.1, mainRoofY + 0.35, topZ + 0.6], buildingGroup, secondaryEdgeMaterial);

    // Communication Antenna Mast & Strobe Beacon
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.07, 2.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x4ad0ff, metalness: 0.9, roughness: 0.1 })
    );
    mast.position.set(topX - 0.5, mainRoofY + 2.45, topZ + 0.2);
    buildingGroup.add(mast);

    // Flashing Cyan Aircraft Strobe Beacon
    const beaconLight = new THREE.PointLight(0x00ffff, 8, 12);
    beaconLight.position.set(topX - 0.5, mainRoofY + 3.7, topZ + 0.2);
    buildingGroup.add(beaconLight);

    const beaconSphere = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    beaconSphere.position.copy(beaconLight.position);
    buildingGroup.add(beaconSphere);

    // Ground Floor Entrance Canopy & Glazed Lobby Portal
    const canopyGeo = new THREE.BoxGeometry(2.6, 0.08, 1.2);
    addMeshWithGlowEdges(canopyGeo, floorSlabMaterial, [mainOffset[0], 0.75, mainOffset[1] + mainDepth / 2 + 0.65], buildingGroup, glowingEdgeMaterial);
    // Canopy Support Pillars
    [-1.1, 1.1].forEach((px) => {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 8), darkTrimMaterial);
      pillar.position.set(mainOffset[0] + px, 0.375, mainOffset[1] + mainDepth / 2 + 1.15);
      buildingGroup.add(pillar);
    });

    // ==========================================
    // 3. CYBERNETIC LANDSCAPING (Trees & Planters)
    // ==========================================
    const treePositions: [number, number][] = [
      [-5.6, 4.8], [-5.6, -4.8], [5.6, 4.8], [5.6, -4.8],
      [-5.6, 0], [5.6, 0], [0, 5.8], [0, -5.8],
      [-4.5, 5.5], [4.5, -5.5], [-2.8, -5.4], [3.2, 5.4],
    ];

    treePositions.forEach(([tx, tz]) => {
      // Tree Trunk
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 0.65, 6),
        new THREE.MeshStandardMaterial({ color: 0x08152c, roughness: 0.8 })
      );
      trunk.position.set(tx, 0.65, tz);
      rootModelGroup.add(trunk);

      // Crystalline Translucent Foliage
      const foliageGeo = new THREE.DodecahedronGeometry(0.48, 1);
      const foliageMat = new THREE.MeshPhysicalMaterial({
        color: 0x0a4078,
        metalness: 0.2,
        roughness: 0.1,
        transmission: 0.5,
        transparent: true,
        opacity: 0.85,
        clearcoat: 1.0,
      });
      const foliage = new THREE.Mesh(foliageGeo, foliageMat);
      foliage.position.set(tx, 1.15, tz);
      rootModelGroup.add(foliage);

      // Wireframe Outline on Tree
      const treeWire = new THREE.LineSegments(
        new THREE.WireframeGeometry(foliageGeo),
        new THREE.LineBasicMaterial({ color: 0x00d8ff, transparent: true, opacity: 0.45 })
      );
      treeWire.position.copy(foliage.position);
      rootModelGroup.add(treeWire);

      // Internal Tree Glow Dot
      const glowSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x00b4d8, transparent: true, opacity: 0.55 })
      );
      glowSphere.position.copy(foliage.position);
      rootModelGroup.add(glowSphere);
    });

    // ==========================================
    // 4. HOLOGRAPHIC ORBIT COMPASS RINGS & LABELS
    // ==========================================
    const orbitGroup = new THREE.Group();
    orbitGroup.position.y = 0.08;
    scene.add(orbitGroup);

    // Concentric Orbit Rings
    const rings = [
      { r: 9.6, op: 0.75, col: 0x00d2ff, lw: 0.05 },
      { r: 12.0, op: 0.35, col: 0x0077cc, lw: 0.04 },
      { r: 14.5, op: 0.2, col: 0x004499, lw: 0.03 },
    ];

    rings.forEach(({ r, op, col, lw }) => {
      const geo = new THREE.RingGeometry(r - lw, r, 128);
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: op,
      });
      const ringMesh = new THREE.Mesh(geo, mat);
      ringMesh.rotation.x = -Math.PI / 2;
      orbitGroup.add(ringMesh);
    });

    // Compass Radial Ticks
    const tickMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const isMajor = i % 12 === 0;
      const r0 = 9.4;
      const r1 = isMajor ? 10.1 : 9.8;
      const pts = [
        new THREE.Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0),
        new THREE.Vector3(Math.cos(a) * r1, 0, Math.sin(a) * r1),
      ];
      orbitGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), tickMat));
    }

    // Directional Sprite Labels (N / A, S, E, W) matching screenshot
    const createDirectionalSprite = (label: string, isPrimary: boolean) => {
      const cv = document.createElement('canvas');
      cv.width = 128;
      cv.height = 128;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = isPrimary ? '#00f0ff' : '#4fa8db';
      ctx.font = 'bold 76px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (isPrimary) {
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 12;
      }
      ctx.fillText(label, 64, 64);

      const spriteMat = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(cv),
        transparent: true,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(1.6, 1.6, 1);
      return sprite;
    };

    const dist = 10.6;
    const labelA = createDirectionalSprite('A', true);
    labelA.position.set(0, 0.6, -dist);
    orbitGroup.add(labelA);

    const labelS = createDirectionalSprite('S', false);
    labelS.position.set(0, 0.6, dist);
    orbitGroup.add(labelS);

    const labelE = createDirectionalSprite('E', false);
    labelE.position.set(dist, 0.6, 0);
    orbitGroup.add(labelE);

    const labelW = createDirectionalSprite('W', false);
    labelW.position.set(-dist, 0.6, 0);
    orbitGroup.add(labelW);

    // Orbiting Drone / Satellite Indicator
    const droneMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ffff })
    );
    scene.add(droneMesh);

    // Compatible legacy meshes for filters
    const rubbleMesh = new THREE.Mesh(new THREE.SphereGeometry(0.001), new THREE.MeshBasicMaterial());
    scene.add(rubbleMesh);
    const carGroup = new THREE.Group();
    scene.add(carGroup);

    // ==========================================
    // 5. ANIMATION LOOP & PROJECTION
    // ==========================================
    let animId: number;
    let droneAngle = 0;
    const tempVec = new THREE.Vector3();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const time = performance.now() * 0.001;

      // Update OrbitControls (handles auto-rotation, damping, user drag, and zoom)
      controls.update();

      // Synchronize Compass Needle with Camera Azimuth Angle
      const camAzimuth = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
      setCompassAngle(THREE.MathUtils.radToDeg(camAzimuth));

      // Orbiting Drone Animation
      droneAngle += 0.015;
      droneMesh.position.set(
        Math.cos(droneAngle) * 12.5,
        0.4 + Math.sin(droneAngle * 0.6) * 0.25,
        Math.sin(droneAngle) * 12.5
      );

      // Pulse Lighting
      beaconLight.intensity = 6 + Math.sin(time * 5.0) * 3.5;
      roofLight.intensity = 5 + Math.sin(time * 1.8) * 1.5;
      plinthGlow.intensity = 5 + Math.sin(time * 2.2) * 1.2;

      // Project Markings onto 2D Screen Space
      const currentWidth = container.clientWidth;
      const currentHeight = container.clientHeight;

      const projected = markings.map((m) => {
        let isVis = m.visible;
        if (m.type === 'Hazard' && !filters.fireSmoke) isVis = false;
        if (m.type === 'Damage' && !filters.damage) isVis = false;
        if (m.type === 'Entry Point' && !filters.entryExit) isVis = false;
        if (filters.customMarkings[m.name] === false) isVis = false;
        if (!filters.labels) isVis = false;

        tempVec.set(m.position[0], m.position[1], m.position[2]);
        tempVec.project(camera);

        return {
          id: m.id,
          name: m.name,
          type: m.type,
          color: m.color,
          visible: isVis && tempVec.z < 1,
          x: ((tempVec.x + 1) * currentWidth) / 2,
          y: ((-tempVec.y + 1) * currentHeight) / 2,
          zDist: tempVec.z,
          iconType: m.iconType,
        };
      });

      setScreenMarkers(projected);

      // Layer Filter toggles
      carGroup.visible = filters.vehicles;
      beaconSphere.visible = filters.fireSmoke;
      rubbleMesh.visible = filters.damage;
      rootModelGroup.visible = filters.reconstruction3D;

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [filters, markings]);

  const getMarkerIcon = (type?: string, name?: string) => {
    if (type === 'fire' || name?.includes('Fire')) return <Flame className="w-3.5 h-3.5 text-white" />;
    if (type === 'warning' || name?.includes('Rubble')) return <AlertTriangle className="w-3.5 h-3.5 text-white" />;
    if (type === 'shelter' || name?.includes('Shelter')) return <Home className="w-3.5 h-3.5 text-white" />;
    if (type === 'mountain' || name?.includes('Mountain')) return <MountainIcon className="w-3.5 h-3.5 text-white" />;
    if (type === 'water' || name?.includes('Water')) return <Droplets className="w-3.5 h-3.5 text-white" />;
    if (type === 'boat' || name?.includes('Boat')) return <Anchor className="w-3.5 h-3.5 text-white" />;
    return <MapPin className="w-3.5 h-3.5 text-white" />;
  };

  return (
    <div
      className="w-full h-full relative select-none overflow-hidden rounded-xl border border-[#0e2247]/80 shadow-[0_0_40px_rgba(0,180,255,0.08)]"
      style={{
        background: 'radial-gradient(ellipse at 50% 35%, #071738 0%, #030814 65%, #01040a 100%)',
      }}
    >
      {/* Three.js Canvas Mount */}
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        title="Click & Drag to Rotate 360° | Scroll to Zoom"
      />

      {/* Floating 3D Spatial Callout Pins & Labels */}
      <div className="absolute inset-0 pointer-events-none">
        {screenMarkers.map((marker) => {
          if (!marker.visible) return null;
          return (
            <div
              key={marker.id}
              className="absolute transform -translate-x-1/2 -translate-y-full transition-transform duration-75 pointer-events-auto"
              style={{ left: `${marker.x}px`, top: `${marker.y}px` }}
            >
              {/* Callout Box */}
              <div
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold shadow-[0_8px_24px_rgba(0,0,0,0.85)] backdrop-blur-md border animate-float"
                style={{
                  backgroundColor: 'rgba(5, 12, 28, 0.94)',
                  borderColor: marker.color,
                  boxShadow: `0 0 16px -2px ${marker.color}50`,
                }}
              >
                {/* Colored Icon Badge */}
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 shadow-sm"
                  style={{ backgroundColor: marker.color }}
                >
                  {getMarkerIcon(marker.iconType, marker.name)}
                </div>
                <span className="whitespace-nowrap tracking-wide text-white text-[11px] sm:text-xs">
                  {marker.name}
                </span>
              </div>

              {/* Pin Stem & Ground Anchor */}
              <div className="flex flex-col items-center">
                <div className="w-[2px] h-5" style={{ backgroundColor: marker.color }} />
                <div
                  className="w-2.5 h-2.5 rounded-full border-2 bg-[#030611] shadow-[0_0_10px_currentColor]"
                  style={{ borderColor: marker.color, color: marker.color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 360 Realtime 3D Live Badge */}
      <div className="absolute top-3 right-20 pointer-events-none z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#050f24]/90 border border-cyan-500/40 text-[11px] text-cyan-300 font-mono backdrop-blur-md shadow-[0_0_15px_rgba(0,210,255,0.2)]">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#00e5ff]" />
        <span className="font-semibold">360° Realtime 3D</span>
      </div>

      {/* Camera-coupled Compass Rose (Top-Right) */}
      <div className="absolute top-3 right-3 pointer-events-none select-none z-10">
        <div className="relative w-14 h-14 rounded-full bg-[#050e24]/95 border border-cyan-500/50 shadow-[0_0_20px_rgba(0,210,255,0.3)] flex items-center justify-center backdrop-blur-md">
          {/* Cardinal Points */}
          <span className="absolute top-1 text-[9px] font-extrabold text-cyan-400">N</span>
          <span className="absolute bottom-1 text-[9px] font-extrabold text-slate-400">S</span>
          <span className="absolute right-1 text-[9px] font-extrabold text-slate-400">E</span>
          <span className="absolute left-1 text-[9px] font-extrabold text-slate-400">W</span>

          {/* Rotating Compass Needle */}
          <div
            className="w-full h-full flex items-center justify-center transition-transform duration-75"
            style={{ transform: `rotate(${-compassAngle}deg)` }}
          >
            {/* North Red Pointer */}
            <div className="w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-b-[15px] border-b-rose-500 absolute top-2" />
            {/* South White Pointer */}
            <div className="w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-t-[15px] border-t-slate-300 absolute bottom-2" />
            {/* Center Pivot Dot */}
            <div className="w-2 h-2 rounded-full bg-cyan-400 border border-white z-10 shadow-[0_0_6px_#00d2ff]" />
          </div>
        </div>
      </div>

      {/* Viewport Overlay Controls (Left Bar) */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-20">
        {/* Recenter */}
        <button
          type="button"
          onClick={() => {
            if (controlsRef.current && cameraRef.current) {
              controlsRef.current.target.set(0, 3.8, 0);
              cameraRef.current.position.set(18, 16, 22);
              controlsRef.current.update();
            }
          }}
          className="w-8 h-8 rounded-lg bg-[#071126]/90 hover:bg-[#0c1e42] border border-[#142954] hover:border-cyan-400 text-slate-300 hover:text-cyan-400 flex items-center justify-center transition-all shadow-lg"
          title="Recenter View"
        >
          <Crosshair className="w-4 h-4" />
        </button>

        {/* Zoom In */}
        <button
          type="button"
          onClick={() => {
            if (controlsRef.current && cameraRef.current) {
              const cam = cameraRef.current;
              const dir = new THREE.Vector3().subVectors(cam.position, controlsRef.current.target).multiplyScalar(0.82);
              cam.position.copy(controlsRef.current.target).add(dir);
              controlsRef.current.update();
            }
          }}
          className="w-8 h-8 rounded-lg bg-[#071126]/90 hover:bg-[#0c1e42] border border-[#142954] hover:border-cyan-400 text-slate-300 hover:text-cyan-400 flex items-center justify-center transition-all shadow-lg"
          title="Zoom In"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Zoom Out */}
        <button
          type="button"
          onClick={() => {
            if (controlsRef.current && cameraRef.current) {
              const cam = cameraRef.current;
              const dir = new THREE.Vector3().subVectors(cam.position, controlsRef.current.target).multiplyScalar(1.22);
              cam.position.copy(controlsRef.current.target).add(dir);
              controlsRef.current.update();
            }
          }}
          className="w-8 h-8 rounded-lg bg-[#071126]/90 hover:bg-[#0c1e42] border border-[#142954] hover:border-cyan-400 text-slate-300 hover:text-cyan-400 flex items-center justify-center transition-all shadow-lg"
          title="Zoom Out"
        >
          <Minus className="w-4 h-4" />
        </button>

        {/* Compass / Orientation Reset */}
        <button
          type="button"
          onClick={() => {
            if (controlsRef.current && cameraRef.current) {
              controlsRef.current.target.set(0, 3.8, 0);
              cameraRef.current.position.set(0, 16, 28);
              controlsRef.current.update();
            }
          }}
          className="w-8 h-8 rounded-lg bg-[#071126]/90 hover:bg-[#0c1e42] border border-[#142954] hover:border-cyan-400 text-slate-300 hover:text-cyan-400 flex items-center justify-center transition-all shadow-lg"
          title="North Orientation View"
        >
          <Compass className="w-4 h-4" />
        </button>

        {/* Fullscreen */}
        <button
          type="button"
          onClick={() => {
            if (!document.fullscreenElement) {
              mountRef.current?.requestFullscreen?.();
            } else {
              document.exitFullscreen?.();
            }
          }}
          className="w-8 h-8 rounded-lg bg-[#071126]/90 hover:bg-[#0c1e42] border border-[#142954] hover:border-cyan-400 text-slate-300 hover:text-cyan-400 flex items-center justify-center transition-all shadow-lg"
          title="Toggle Fullscreen"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Subtle Atmospheric Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(1, 4, 10, 0.65) 100%)',
        }}
      />
    </div>
  );
};
