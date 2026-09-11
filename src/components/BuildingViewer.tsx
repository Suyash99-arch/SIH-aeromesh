import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RotateCw, ZoomIn } from 'lucide-react';

export const BuildingViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let width = container.clientWidth || 580;
    let height = container.clientHeight || 520;

    // --- 1. SCENE SETUP ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020a18, 0.024);

    // --- 2. CAMERA SETUP (Isometric Drone Perspective) ---
    let cameraDistance = 18.5;
    const minDistance = 11.0;
    const maxDistance = 27.0;
    const cameraTarget = new THREE.Vector3(0, 3.2, 0);

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    
    const updateCameraPos = () => {
      const dir = new THREE.Vector3(13, 10.5, 14.5).normalize();
      camera.position.copy(cameraTarget).addScaledVector(dir, cameraDistance);
      camera.lookAt(cameraTarget);
    };
    updateCameraPos();

    // --- 3. RENDERER SETUP ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // --- 4. LIGHTING SYSTEM ---
    // Deep ambient night glow
    const ambientLight = new THREE.AmbientLight(0x0a1c3d, 2.4);
    scene.add(ambientLight);

    // Main Key Light (Crisp moonlight with cyan cast)
    const keyLight = new THREE.DirectionalLight(0xa5f3fc, 3.8);
    keyLight.position.set(16, 26, 14);
    scene.add(keyLight);

    // Intense Electric Cyan Rim Light (Highlights building silhouettes)
    const rimLight = new THREE.DirectionalLight(0x00e5ff, 4.5);
    rimLight.position.set(-16, 18, -14);
    scene.add(rimLight);

    // Deep Royal Blue Fill Light (Preserves dark structural contrast)
    const blueFill = new THREE.DirectionalLight(0x1d4ed8, 2.2);
    blueFill.position.set(-10, -4, 12);
    scene.add(blueFill);

    // Upward Ground Reflection Light
    const groundBounce = new THREE.DirectionalLight(0x0284c7, 1.2);
    groundBounce.position.set(0, -10, 0);
    scene.add(groundBounce);

    // Dynamic Lobby Warm Interior Light
    const lobbyPointLight = new THREE.PointLight(0x7dd3fc, 3.5, 8);
    lobbyPointLight.position.set(-1.2, 1.2, 1.8);
    scene.add(lobbyPointLight);

    // Tower Core Interior Light
    const corePointLight = new THREE.PointLight(0x00d2ff, 3.2, 10);
    corePointLight.position.set(1.5, 4.5, 0.2);
    scene.add(corePointLight);

    // Rooftop Warning Beacon Light
    const beaconLight = new THREE.PointLight(0x00ffff, 4.0, 7);
    beaconLight.position.set(1.6, 9.8, 0.2);
    scene.add(beaconLight);

    // --- 5. ROOT ROTATING SCENE GROUP ---
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // --- 6. MATERIALS PALETTE ---
    // Premium Architectural Cyan Glass
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0099ff,
      metalness: 0.1,
      roughness: 0.08,
      transmission: 0.72,
      transparent: true,
      opacity: 0.85,
      reflectivity: 0.95,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });

    // Balcony Smoked Cyan Glass Railing
    const railingGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x00f0ff,
      metalness: 0.05,
      roughness: 0.1,
      transmission: 0.8,
      transparent: true,
      opacity: 0.65,
    });

    // Dark Architectural Structural Concrete / Composite
    const darkCompositeMat = new THREE.MeshStandardMaterial({
      color: 0x0a1426,
      roughness: 0.42,
      metalness: 0.65,
    });

    // Heavy Structural Floor Slabs
    const floorSlabMat = new THREE.MeshStandardMaterial({
      color: 0x0e1b33,
      roughness: 0.38,
      metalness: 0.7,
    });

    // Window Mullions & Metal Trim Frames
    const metalMullionMat = new THREE.MeshStandardMaterial({
      color: 0x081020,
      roughness: 0.25,
      metalness: 0.85,
    });

    // Metallic Rooftop Mechanical Equipment (Brushed steel)
    const equipmentMat = new THREE.MeshStandardMaterial({
      color: 0x122342,
      roughness: 0.3,
      metalness: 0.8,
    });

    // Asphalt Roadway
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x070c18,
      roughness: 0.88,
      metalness: 0.15,
    });

    // Sidewalk Paving / Plaza Stones
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x0f1c36,
      roughness: 0.55,
      metalness: 0.4,
    });

    // Electric Cyan Edge Lines
    const cyanLineMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.85,
    });

    // Varied Office Window Emissive Materials (Authentic inhabited building look)
    const windowEmissiveBright = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.75,
    });

    const windowEmissiveDim = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.45,
    });

    const windowEmissiveWarm = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.6,
    });

    // Vehicle Materials
    const carPaintBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.9, roughness: 0.2 });
    const carPaintSilver = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.95, roughness: 0.15 });
    const carPaintDark = new THREE.MeshStandardMaterial({ color: 0x030712, metalness: 0.8, roughness: 0.3 });
    const carTireMat = new THREE.MeshStandardMaterial({ color: 0x05070e, roughness: 0.9 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
    const taillightMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });

    // Road Markings (Crisp glowing white-cyan)
    const roadMarkingMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.8,
    });

    // --- 7. SURROUNDING FUTURISTIC SITE ENVIRONMENT ---
    const siteSize = 13.6;

    // A. Main Site Base Podium
    const basePlatformGeo = new THREE.BoxGeometry(siteSize, 0.45, siteSize);
    const basePlatform = new THREE.Mesh(basePlatformGeo, sidewalkMat);
    basePlatform.position.y = 0.225;
    rootGroup.add(basePlatform);

    const basePlatformEdges = new THREE.LineSegments(new THREE.EdgesGeometry(basePlatformGeo), cyanLineMat);
    basePlatformEdges.position.copy(basePlatform.position);
    rootGroup.add(basePlatformEdges);

    // B. Peripheral Asphalt Roads (L-shaped dual road network)
    // Roadway Along South & East Edges
    const roadThickness = 0.04;
    
    // South Road
    const southRoadGeo = new THREE.BoxGeometry(siteSize - 0.4, roadThickness, 2.2);
    const southRoad = new THREE.Mesh(southRoadGeo, roadMat);
    southRoad.position.set(0, 0.46, 5.3);
    rootGroup.add(southRoad);

    // East Road
    const eastRoadGeo = new THREE.BoxGeometry(2.2, roadThickness, siteSize - 2.8);
    const eastRoad = new THREE.Mesh(eastRoadGeo, roadMat);
    eastRoad.position.set(5.3, 0.46, -1.1);
    rootGroup.add(eastRoad);

    // Road Markings: Dashed Center Dividing Lines
    const dashGeo = new THREE.PlaneGeometry(0.7, 0.1);
    for (let x = -5.5; x <= 5.5; x += 1.3) {
      const dash = new THREE.Mesh(dashGeo, roadMarkingMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.49, 5.3);
      rootGroup.add(dash);
    }

    const eastDashGeo = new THREE.PlaneGeometry(0.1, 0.7);
    for (let z = -6.2; z <= 3.8; z += 1.3) {
      const dash = new THREE.Mesh(eastDashGeo, roadMarkingMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(5.3, 0.49, z);
      rootGroup.add(dash);
    }

    // Pedestrian Zebra Crosswalk at Intersection
    for (let i = 0; i < 5; i++) {
      const zebraBar = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.4), roadMarkingMat);
      zebraBar.rotation.x = -Math.PI / 2;
      zebraBar.position.set(3.8 + i * 0.32, 0.49, 5.3);
      rootGroup.add(zebraBar);
    }

    // Curbs separating roads from pedestrian sidewalk (slender bevels)
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x142747, roughness: 0.5 });
    const curbSouthGeo = new THREE.BoxGeometry(siteSize - 0.4, 0.08, 0.15);
    const curbSouth = new THREE.Mesh(curbSouthGeo, curbMat);
    curbSouth.position.set(0, 0.49, 4.15);
    rootGroup.add(curbSouth);

    const curbEastGeo = new THREE.BoxGeometry(0.15, 0.08, siteSize - 2.8);
    const curbEast = new THREE.Mesh(curbEastGeo, curbMat);
    curbEast.position.set(4.15, 0.49, -1.1);
    rootGroup.add(curbEast);

    // C. Parking Stalls & Marked Bays
    const parkingStallMat = new THREE.LineBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.75 });
    const stallOffsets = [-4.6, -3.2, -1.8];
    stallOffsets.forEach((sx) => {
      const pts = [
        new THREE.Vector3(sx - 0.6, 0.49, 4.0),
        new THREE.Vector3(sx - 0.6, 0.49, 2.5),
        new THREE.Vector3(sx + 0.6, 0.49, 2.5),
        new THREE.Vector3(sx + 0.6, 0.49, 4.0),
      ];
      const stallLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), parkingStallMat);
      rootGroup.add(stallLine);
    });

    // D. Parked Autonomous / Futuristic Vehicles
    const createVehicle = (x: number, z: number, rotationY: number, bodyMat: THREE.Material) => {
      const carGroup = new THREE.Group();
      carGroup.position.set(x, 0.5, z);
      carGroup.rotation.y = rotationY;

      // Chassis Lower Body
      const chassisGeo = new THREE.BoxGeometry(1.0, 0.22, 1.9);
      const chassis = new THREE.Mesh(chassisGeo, bodyMat);
      chassis.position.y = 0.18;
      carGroup.add(chassis);

      // Cabin / Greenhouse (Tinted dark glass)
      const cabinGeo = new THREE.BoxGeometry(0.85, 0.22, 1.05);
      const cabin = new THREE.Mesh(cabinGeo, glassMat);
      cabin.position.set(0, 0.38, -0.05);
      carGroup.add(cabin);

      // 4 Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12);
      const wheelOffsets = [
        [-0.48, 0.14, 0.58], [0.48, 0.14, 0.58],
        [-0.48, 0.14, -0.58], [0.48, 0.14, -0.58]
      ];
      wheelOffsets.forEach(([wx, wy, wz]) => {
        const wheel = new THREE.Mesh(wheelGeo, carTireMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, wy, wz);
        carGroup.add(wheel);
      });

      // Headlights (Front: -Z)
      const hlGeo = new THREE.BoxGeometry(0.18, 0.05, 0.04);
      const hlL = new THREE.Mesh(hlGeo, headlightMat);
      hlL.position.set(-0.35, 0.22, -0.96);
      carGroup.add(hlL);
      const hlR = hlL.clone();
      hlR.position.x = 0.35;
      carGroup.add(hlR);

      // Taillights (Rear: +Z)
      const tlL = new THREE.Mesh(hlGeo, taillightMat);
      tlL.position.set(-0.35, 0.22, 0.96);
      carGroup.add(tlL);
      const tlR = tlL.clone();
      tlR.position.x = 0.35;
      carGroup.add(tlR);

      rootGroup.add(carGroup);
    };

    // Place parked cars in stalls
    createVehicle(-4.6, 3.25, 0, carPaintBlue);
    createVehicle(-3.2, 3.25, 0, carPaintSilver);
    createVehicle(-1.8, 3.25, 0, carPaintDark);
    // Driving autonomous shuttle on East road
    createVehicle(5.3, -1.8, -Math.PI / 2, carPaintBlue);

    // E. Modern Street Lamps along Sidewalks
    const createStreetLamp = (x: number, z: number, rotY: number) => {
      const lampGroup = new THREE.Group();
      lampGroup.position.set(x, 0.48, z);
      lampGroup.rotation.y = rotY;

      // Vertical Pole
      const poleGeo = new THREE.CylinderGeometry(0.025, 0.035, 1.4, 8);
      const pole = new THREE.Mesh(poleGeo, metalMullionMat);
      pole.position.y = 0.7;
      lampGroup.add(pole);

      // Angled Luminaire Arm
      const armGeo = new THREE.BoxGeometry(0.04, 0.04, 0.35);
      const arm = new THREE.Mesh(armGeo, metalMullionMat);
      arm.position.set(0, 1.4, 0.15);
      lampGroup.add(arm);

      // Luminaire Glowing Head
      const headGeo = new THREE.BoxGeometry(0.06, 0.02, 0.2);
      const head = new THREE.Mesh(headGeo, windowEmissiveBright);
      head.position.set(0, 1.38, 0.22);
      lampGroup.add(head);

      rootGroup.add(lampGroup);
    };

    createStreetLamp(-5.2, 4.3, 0);
    createStreetLamp(0.5, 4.3, 0);
    createStreetLamp(4.3, 2.2, Math.PI / 2);
    createStreetLamp(4.3, -3.5, Math.PI / 2);

    // F. Architectural Digital-Twin Trees with Tiered Wireframe Canopies
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x091428, roughness: 0.8 });
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.4,
      wireframe: true,
    });

    const createArchitecturalTree = (tx: number, tz: number, scale: number = 1.0) => {
      const treeGroup = new THREE.Group();
      treeGroup.position.set(tx, 0.48, tz);
      treeGroup.scale.set(scale, scale, scale);

      // Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.65, 6);
      const trunk = new THREE.Mesh(trunkGeo, treeTrunkMat);
      trunk.position.y = 0.325;
      treeGroup.add(trunk);

      // Outer Faceted Wireframe Foliage
      const folGeo = new THREE.DodecahedronGeometry(0.48, 1);
      const folMesh = new THREE.Mesh(folGeo, foliageMat);
      folMesh.position.y = 0.95;
      treeGroup.add(folMesh);

      // Inner Glowing Core
      const coreGeo = new THREE.SphereGeometry(0.24, 8, 8);
      const coreMesh = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.65 }));
      coreMesh.position.y = 0.95;
      treeGroup.add(coreMesh);

      // Planter Ring at Base
      const ringGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.08, 8);
      const ringMesh = new THREE.Mesh(ringGeo, darkCompositeMat);
      ringMesh.position.y = 0.04;
      treeGroup.add(ringMesh);

      rootGroup.add(treeGroup);
    };

    // Plant trees around courtyard, walkways, and entrance plaza
    const treeCoords = [
      [-5.2, -5.0, 1.2], [-3.6, -5.2, 1.0], [-1.8, -5.2, 1.1],
      [-5.2, -2.5, 0.95], [-5.2, 0.5, 1.05],
      [3.2, 3.2, 1.0], [1.8, 3.2, 0.9],
      [3.2, -4.8, 1.15], [1.5, -5.0, 1.0]
    ];
    treeCoords.forEach(([tx, tz, sc]) => createArchitecturalTree(tx, tz, sc));

    // --- 8. MULTI-TIERED HIGH-DETAIL ARCHITECTURAL BUILDING COMPLEX ---
    // The building is designed with 3 interlocking wings of varying heights (6-10 floors),
    // clearly separated floor slabs, mullions, balconies, and rich rooftop infrastructure.

    const buildingCenter = new THREE.Group();
    buildingCenter.position.set(-0.2, 0.48, -0.4);
    rootGroup.add(buildingCenter);

    // =========================================================================
    // WING A: MAIN CURTAIN-WALL GLASS OFFICE TOWER (7 FLOORS)
    // =========================================================================
    const wingAWidth = 4.2;
    const wingADepth = 3.6;
    const wingAFloors = 7;
    const floorH = 0.88;
    const wingAX = -0.7;
    const wingAZ = 0.1;

    for (let f = 0; f < wingAFloors; f++) {
      const yBottom = f * floorH;
      const yMid = yBottom + floorH / 2;

      // 1. Structural Concrete Floor Slab with Beveled Edge
      const slabGeo = new THREE.BoxGeometry(wingAWidth + 0.3, 0.14, wingADepth + 0.3);
      const slab = new THREE.Mesh(slabGeo, floorSlabMat);
      slab.position.set(wingAX, yBottom + 0.07, wingAZ);
      buildingCenter.add(slab);

      const slabEdge = new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), cyanLineMat);
      slabEdge.position.copy(slab.position);
      buildingCenter.add(slabEdge);

      // 2. Glass Curtain Wall Envelope
      const glassGeo = new THREE.BoxGeometry(wingAWidth, floorH - 0.14, wingADepth);
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.position.set(wingAX, yMid, wingAZ);
      buildingCenter.add(glass);

      // 3. Vertical Window Mullions (Mullion grids across front and sides)
      const numMullionsX = 5;
      const stepX = wingAWidth / numMullionsX;
      for (let m = 0; m <= numMullionsX; m++) {
        const mx = wingAX - wingAWidth / 2 + m * stepX;
        const mullionGeo = new THREE.BoxGeometry(0.045, floorH - 0.14, 0.08);
        
        // Front mullion
        const mullionFront = new THREE.Mesh(mullionGeo, metalMullionMat);
        mullionFront.position.set(mx, yMid, wingAZ + wingADepth / 2);
        buildingCenter.add(mullionFront);

        // Rear mullion
        const mullionBack = new THREE.Mesh(mullionGeo, metalMullionMat);
        mullionBack.position.set(mx, yMid, wingAZ - wingADepth / 2);
        buildingCenter.add(mullionBack);
      }

      // 4. Interior Structural Columns
      const colGeo = new THREE.CylinderGeometry(0.08, 0.08, floorH - 0.14, 8);
      const colPositions = [
        [wingAX - 1.4, wingAZ - 1.1], [wingAX + 1.4, wingAZ - 1.1],
        [wingAX - 1.4, wingAZ + 1.1], [wingAX + 1.4, wingAZ + 1.1]
      ];
      colPositions.forEach(([cx, cz]) => {
        const col = new THREE.Mesh(colGeo, darkCompositeMat);
        col.position.set(cx, yMid, cz);
        buildingCenter.add(col);
      });

      // 5. Inhabited Interior Office Lights (Varied luminosity per room/floor)
      const roomGeo = new THREE.BoxGeometry(0.85, floorH - 0.22, 0.1);
      const offsetsX = [-1.4, -0.45, 0.5, 1.4];
      offsetsX.forEach((ox, idx) => {
        // Vary materials to mimic realistic offices
        const matPick = (f + idx) % 4 === 0 ? windowEmissiveWarm : (f + idx) % 3 === 0 ? windowEmissiveBright : windowEmissiveDim;
        const windowPane = new THREE.Mesh(roomGeo, matPick);
        windowPane.position.set(wingAX + ox, yMid, wingAZ + wingADepth / 2 - 0.08);
        buildingCenter.add(windowPane);
      });

      // 6. Architectural Balconies with Glass Railings on select floors (3, 5)
      if (f === 2 || f === 4) {
        const balcWidth = 1.8;
        const balcDepth = 0.65;
        const balcFloorGeo = new THREE.BoxGeometry(balcWidth, 0.1, balcDepth);
        const balcFloor = new THREE.Mesh(balcFloorGeo, floorSlabMat);
        balcFloor.position.set(wingAX - 1.0, yBottom + 0.05, wingAZ + wingADepth / 2 + balcDepth / 2);
        buildingCenter.add(balcFloor);

        // Glass Railing around balcony
        const railFrontGeo = new THREE.BoxGeometry(balcWidth, 0.38, 0.04);
        const railFront = new THREE.Mesh(railFrontGeo, railingGlassMat);
        railFront.position.set(wingAX - 1.0, yBottom + 0.28, wingAZ + wingADepth / 2 + balcDepth);
        buildingCenter.add(railFront);

        const railSideGeo = new THREE.BoxGeometry(0.04, 0.38, balcDepth);
        const railSide = new THREE.Mesh(railSideGeo, railingGlassMat);
        railSide.position.set(wingAX - 1.0 - balcWidth / 2, yBottom + 0.28, wingAZ + wingADepth / 2 + balcDepth / 2);
        buildingCenter.add(railSide);
      }
    }

    // =========================================================================
    // WING B: TALL ARCHITECTURAL SERVICE & EXECUTIVE TOWER (9 FLOORS)
    // =========================================================================
    // Interlocked with Wing A, taller, darker structural composite with glowing ribbon slots
    const wingBWidth = 2.4;
    const wingBDepth = 3.8;
    const wingBHeight = 9 * floorH;
    const wingBX = 1.8;
    const wingBZ = 0.2;

    const coreGeo = new THREE.BoxGeometry(wingBWidth, wingBHeight, wingBDepth);
    const coreMesh = new THREE.Mesh(coreGeo, darkCompositeMat);
    coreMesh.position.set(wingBX, wingBHeight / 2, wingBZ);
    buildingCenter.add(coreMesh);

    const coreEdges = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo), cyanLineMat);
    coreEdges.position.copy(coreMesh.position);
    buildingCenter.add(coreEdges);

    // Vertical LED Accent Channel running up the prominent corner crease
    const ledStripGeo = new THREE.BoxGeometry(0.06, wingBHeight, 0.06);
    const ledStrip = new THREE.Mesh(ledStripGeo, new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
    ledStrip.position.set(wingBX + wingBWidth / 2 + 0.02, wingBHeight / 2, wingBZ + wingBDepth / 2 + 0.02);
    buildingCenter.add(ledStrip);

    // Recessed Vertical Glass Ribbon Windows along Core Exterior
    for (let f = 0; f < 8; f++) {
      const wy = 0.6 + f * floorH;
      const slitGeo = new THREE.BoxGeometry(0.3, 0.52, 0.06);
      
      const slit1 = new THREE.Mesh(slitGeo, windowEmissiveBright);
      slit1.position.set(wingBX - 0.5, wy, wingBZ + wingBDepth / 2 + 0.02);
      buildingCenter.add(slit1);

      const slit2 = new THREE.Mesh(slitGeo, windowEmissiveWarm);
      slit2.position.set(wingBX + 0.5, wy, wingBZ + wingBDepth / 2 + 0.02);
      buildingCenter.add(slit2);
    }

    // =========================================================================
    // WING C: GROUND LEVEL GRAND LOBBY & ENTRANCE PORTAL (Floors 1-2)
    // =========================================================================
    const lobbyWidth = 2.8;
    const lobbyDepth = 1.6;
    const lobbyHeight = floorH * 1.6;
    const lobbyX = -0.8;
    const lobbyZ = wingAZ + wingADepth / 2 + lobbyDepth / 2;

    // Lobby Glass Box
    const lobbyGlassGeo = new THREE.BoxGeometry(lobbyWidth, lobbyHeight, lobbyDepth);
    const lobbyGlass = new THREE.Mesh(lobbyGlassGeo, glassMat);
    lobbyGlass.position.set(lobbyX, lobbyHeight / 2, lobbyZ);
    buildingCenter.add(lobbyGlass);

    // Lobby Roof Slab
    const lobbyRoofGeo = new THREE.BoxGeometry(lobbyWidth + 0.4, 0.12, lobbyDepth + 0.4);
    const lobbyRoof = new THREE.Mesh(lobbyRoofGeo, floorSlabMat);
    lobbyRoof.position.set(lobbyX, lobbyHeight + 0.06, lobbyZ);
    buildingCenter.add(lobbyRoof);

    const lobbyRoofEdge = new THREE.LineSegments(new THREE.EdgesGeometry(lobbyRoofGeo), cyanLineMat);
    lobbyRoofEdge.position.copy(lobbyRoof.position);
    buildingCenter.add(lobbyRoofEdge);

    // Cantilevered Glass Entrance Canopy extending forward
    const canopyGeo = new THREE.BoxGeometry(2.2, 0.06, 1.2);
    const canopy = new THREE.Mesh(canopyGeo, glassMat);
    canopy.position.set(lobbyX, 1.4, lobbyZ + lobbyDepth / 2 + 0.6);
    buildingCenter.add(canopy);

    const canopyEdge = new THREE.LineSegments(new THREE.EdgesGeometry(canopyGeo), cyanLineMat);
    canopyEdge.position.copy(canopy.position);
    buildingCenter.add(canopyEdge);

    // Canopy Support Struts (Diagonal steel cables)
    const strutGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6);
    [-0.9, 0.9].forEach((sx) => {
      const strut = new THREE.Mesh(strutGeo, metalMullionMat);
      strut.position.set(lobbyX + sx, 1.7, lobbyZ + lobbyDepth / 2 + 0.4);
      strut.rotation.x = Math.PI / 4;
      buildingCenter.add(strut);
    });

    // Revolving Entrance Portal Cylinder
    const portalGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.9, 12, 1, true);
    const portal = new THREE.Mesh(portalGeo, glassMat);
    portal.position.set(lobbyX, 0.45, lobbyZ + lobbyDepth / 2);
    buildingCenter.add(portal);

    // Entrance Plaza Steps
    for (let s = 0; s < 3; s++) {
      const stepGeo = new THREE.BoxGeometry(2.6 + s * 0.3, 0.05, 0.35);
      const step = new THREE.Mesh(stepGeo, sidewalkMat);
      step.position.set(lobbyX, (2 - s) * 0.05, lobbyZ + lobbyDepth / 2 + 1.1 + s * 0.25);
      buildingCenter.add(step);
    }

    // =========================================================================
    // ROOFTOP ARCHITECTURE & HIGH-TECH MECHANICAL EQUIPMENT
    // =========================================================================
    // 1. Elevator Overrun Penthouse on Core Tower
    const penthouseH = 1.1;
    const penthouseGeo = new THREE.BoxGeometry(1.8, penthouseH, 2.0);
    const penthouse = new THREE.Mesh(penthouseGeo, equipmentMat);
    penthouse.position.set(wingBX, wingBHeight + penthouseH / 2, wingBZ);
    buildingCenter.add(penthouse);

    const penthouseEdges = new THREE.LineSegments(new THREE.EdgesGeometry(penthouseGeo), cyanLineMat);
    penthouseEdges.position.copy(penthouse.position);
    buildingCenter.add(penthouseEdges);

    // Louvered Air Vents on Penthouse
    for (let v = 0; v < 4; v++) {
      const ventGeo = new THREE.BoxGeometry(0.9, 0.05, 0.04);
      const vent = new THREE.Mesh(ventGeo, new THREE.MeshBasicMaterial({ color: 0x0284c7 }));
      vent.position.set(wingBX, wingBHeight + 0.3 + v * 0.14, wingBZ + 1.02);
      buildingCenter.add(vent);
    }

    // 2. High-Tech Communication Lattice Mast & Antenna Spire
    const antennaBaseGeo = new THREE.CylinderGeometry(0.08, 0.14, 0.6, 8);
    const antennaBase = new THREE.Mesh(antennaBaseGeo, darkCompositeMat);
    antennaBase.position.set(wingBX, wingBHeight + penthouseH + 0.3, wingBZ);
    buildingCenter.add(antennaBase);

    const antennaNeedleGeo = new THREE.CylinderGeometry(0.02, 0.05, 1.8, 8);
    const antennaNeedle = new THREE.Mesh(antennaNeedleGeo, new THREE.MeshBasicMaterial({ color: 0x00ffff }));
    antennaNeedle.position.set(wingBX, wingBHeight + penthouseH + 1.4, wingBZ);
    buildingCenter.add(antennaNeedle);

    // Glowing Top Aviation Beacon Sphere
    const beaconGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const beaconMesh = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    beaconMesh.position.set(wingBX, wingBHeight + penthouseH + 2.3, wingBZ);
    buildingCenter.add(beaconMesh);

    // Directional Satellite Dish on Rooftop
    const dishGeo = new THREE.CylinderGeometry(0.42, 0.08, 0.18, 16);
    const dishMesh = new THREE.Mesh(dishGeo, equipmentMat);
    dishMesh.rotation.z = Math.PI / 3;
    dishMesh.rotation.x = Math.PI / 6;
    dishMesh.position.set(wingBX - 0.6, wingBHeight + 0.45, wingBZ - 0.6);
    buildingCenter.add(dishMesh);

    // 3. Dual HVAC Chiller Units with Circular Fans on Wing A Roof
    const roofAY = wingAFloors * floorH;

    // Wing A Rooftop Parapet Perimeter
    const parapetGeo = new THREE.BoxGeometry(wingAWidth + 0.1, 0.32, wingADepth + 0.1);
    const parapetEdges = new THREE.LineSegments(new THREE.EdgesGeometry(parapetGeo), cyanLineMat);
    parapetEdges.position.set(wingAX, roofAY + 0.16, wingAZ);
    buildingCenter.add(parapetEdges);

    // Dual HVAC Chiller Units
    [-0.7, 0.7].forEach((hx) => {
      const hvacGeo = new THREE.BoxGeometry(0.9, 0.55, 1.1);
      const hvac = new THREE.Mesh(hvacGeo, equipmentMat);
      hvac.position.set(wingAX + hx, roofAY + 0.28, wingAZ);
      buildingCenter.add(hvac);

      // Fan Grille on top of chiller
      const fanGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16);
      const fan = new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({ color: 0x0284c7, wireframe: true }));
      fan.position.set(wingAX + hx, roofAY + 0.58, wingAZ);
      buildingCenter.add(fan);
    });

    // Cylindrical Water Cooling Reservoir with Piping
    const tankGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.85, 16);
    const tank = new THREE.Mesh(tankGeo, darkCompositeMat);
    tank.position.set(wingAX - 1.2, roofAY + 0.43, wingAZ - 0.9);
    buildingCenter.add(tank);

    const tankBandGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.06, 16);
    const tankBand = new THREE.Mesh(tankBandGeo, new THREE.MeshBasicMaterial({ color: 0x00d2ff }));
    tankBand.position.copy(tank.position);
    buildingCenter.add(tankBand);

    // --- 9. HOLOGRAPHIC COMPASS & DRONE SCAN COORDINATE RINGS ---
    const ringGroup = new THREE.Group();
    scene.add(ringGroup);

    // Inner Navigation Ring (Radius 8.8)
    const ringRadius1 = 8.8;
    const ringGeo1 = new THREE.RingGeometry(ringRadius1 - 0.035, ringRadius1, 96);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
    });
    const ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
    ringMesh1.rotation.x = Math.PI / 2;
    ringMesh1.position.y = 0.06;
    ringGroup.add(ringMesh1);

    // Outer Orbit Ring (Radius 11.2, tilted slightly)
    const ringRadius2 = 11.2;
    const ringGeo2 = new THREE.RingGeometry(ringRadius2 - 0.025, ringRadius2, 96);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x0077ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    const ringMesh2 = new THREE.Mesh(ringGeo2, ringMat2);
    ringMesh2.rotation.x = Math.PI / 2.15;
    ringMesh2.position.y = 0.08;
    ringGroup.add(ringMesh2);

    // Compass Directional Sprites (N, S, E, W)
    const makeTextSprite = (text: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#00d2ff';
        ctx.font = 'bold 64px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 64);
      }
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(1.4, 1.4, 1);
      return sprite;
    };

    const north = makeTextSprite('N');
    north.position.set(0, 0.45, -ringRadius1);
    ringGroup.add(north);

    const south = makeTextSprite('S');
    south.position.set(0, 0.45, ringRadius1);
    ringGroup.add(south);

    const east = makeTextSprite('E');
    east.position.set(ringRadius1, 0.45, 0);
    ringGroup.add(east);

    const west = makeTextSprite('W');
    west.position.set(-ringRadius1, 0.45, 0);
    ringGroup.add(west);

    // Orbiting Drone Scanner Beacon
    const orbiterGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const orbiterMesh = new THREE.Mesh(orbiterGeo, new THREE.MeshBasicMaterial({ color: 0x00ffff }));
    ringGroup.add(orbiterMesh);

    // --- 10. SMOOTH INTERACTION: ROTATION, DRAG & MOUSE WHEEL ZOOM ---
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let mouseDeltaY = 0;
    let mouseDeltaX = 0;
    let targetMouseDeltaX = 0;

    const handleMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      mouseDeltaY += dx * 0.005;
      targetMouseDeltaX = Math.max(-0.4, Math.min(0.4, targetMouseDeltaX + dy * 0.0035));
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    // Zoom via Mouse Wheel
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomSpeed = 0.012;
      cameraDistance = Math.max(minDistance, Math.min(maxDistance, cameraDistance + e.deltaY * zoomSpeed));
      updateCameraPos();
    };

    // Touch support for mobile / touchscreens
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging = true;
        prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - prevMouse.x;
      const dy = e.touches[0].clientY - prevMouse.y;
      mouseDeltaY += dx * 0.005;
      targetMouseDeltaX = Math.max(-0.4, Math.min(0.4, targetMouseDeltaX + dy * 0.0035));
      prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const handleTouchEnd = () => {
      isDragging = false;
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    // --- 11. CONTINUOUS AUTOMATIC ROTATION & SHIMMER LOOP ---
    let animId: number;
    let autoAngle = 0;
    let orbiterAngle = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const time = performance.now() * 0.001;

      // Continuous slow automatic rotation
      autoAngle += 0.004;
      ringGroup.rotation.y += 0.0012;

      // Smooth pitch tilt damping
      mouseDeltaX += (targetMouseDeltaX - mouseDeltaX) * 0.08;

      // Apply rotation to digital twin root model
      rootGroup.rotation.y = autoAngle + mouseDeltaY;
      rootGroup.rotation.x = mouseDeltaX;

      // Orbiting drone scanner pulse
      orbiterAngle += 0.018;
      orbiterMesh.position.set(
        Math.cos(orbiterAngle) * ringRadius2,
        0.25 + Math.sin(orbiterAngle) * 0.35,
        Math.sin(orbiterAngle) * ringRadius2
      );

      // Subtle breathing illumination
      beaconLight.intensity = 3.2 + Math.sin(time * 4.5) * 1.8;
      corePointLight.intensity = 2.8 + Math.sin(time * 2.0) * 1.0;
      lobbyPointLight.intensity = 3.0 + Math.cos(time * 1.8) * 0.8;

      renderer.render(scene, camera);
    };

    animate();

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });

    resizeObserver.observe(container);

    // --- CLEANUP ---
    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);

      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[460px] cursor-grab active:cursor-grabbing select-none relative"
      title="AeroMesh 3D Digital Twin — Continuous Auto-Rotation | Drag to Orbit | Scroll to Zoom"
    >
      {/* Indicator Badges */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#061024]/85 border border-cyan-500/30 text-[10px] text-cyan-300 font-mono backdrop-blur-md shadow-[0_0_15px_rgba(0,210,255,0.2)]">
          <RotateCw className="w-3 h-3 animate-spin text-cyan-400" />
          <span>360° Realtime 3D</span>
        </div>
        <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-[#061024]/85 border border-[#1a315e] text-[10px] text-slate-400 font-mono backdrop-blur-md">
          <ZoomIn className="w-2.5 h-2.5 text-cyan-400" />
          <span>Scroll to Zoom</span>
        </div>
      </div>

      {/* Radial Depth Ambient Overlay */}
      <div className="absolute inset-0 pointer-events-none bg-radial-gradient from-transparent via-transparent to-[#020a18]/80" />
    </div>
  );
};
