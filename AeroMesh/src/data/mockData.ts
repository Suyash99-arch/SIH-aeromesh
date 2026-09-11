import type { Incident, CustomMarking, FilterState, IncidentStats } from '../types';

export const initialIncident: Incident = {
  id: 'AM-20250908-001',
  name: 'Bridge Structural Assessment',
  location: 'Sector 62, Noida, Uttar Pradesh',
  description: 'Bridge superstructure assessment and damage analysis using aerial drone footage.',
  date: '2025-09-08',
  time: '10:24 AM',
  status: 'Analysis Completed',
  thumbnailUrl: '/assets/drone_bridge_aerial.jpg',
  videoName: 'drone_bridge_survey.mp4',
  videoSize: '2.1 MB',
  videoObjectUrl: '/assets/drone_sample.mp4',
  videoDuration: '00:15',
  videoResolution: '1920 × 1080',
  videoFps: 12,
  stats: {
    totalPeople: 48,
    peopleDelta: 3,
    totalVehicles: 24,
    vehiclesDelta: 2,
    fireIncidents: {
      major: 1,
      minor: 1,
      hazardous: 1,
    },
    entryExitPoints: {
      total: 4,
      entry: 2,
      exit: 2,
    },
    damagedAreas: {
      total: 2,
      details: 'Bridge Section + Road',
    },
  },
  detectedConditions: {
    structuralDamage: true,
    fire: true,
    smoke: true,
    humanPresence: true,
    vehiclePresence: true,
    entryExit: true,
  },
  overallCondition: {
    level: 'CRITICAL',
    title: 'CRITICAL - Immediate attention recommended',
    description: 'The analysed scene indicates significant structural damage with active fire activity and multiple detected entities. The affected area should be inspected and secured immediately.',
  },
  keyObservations: [
    'Structural damage detected on the bridge section.',
    'Active fire detected near the roadway.',
    'Multiple vehicles identified in the affected zone.',
    'Human presence detected within the incident area.',
    'Multiple entry and exit points identified.',
  ],
};

export const historyIncidents: Incident[] = [
  initialIncident,
  {
    id: 'AM-20250905-002',
    name: 'Urban Building Inspection',
    location: 'Sector 18, Noida',
    description: 'Multi-angle drone thermography and facade structural crack detection.',
    date: '2025-09-05',
    time: '02:45 PM',
    status: 'Processing',
    thumbnailUrl: '/assets/building_exact_clean.png',
    videoName: 'urban_tower_scan.mp4',
    videoSize: '4.8 MB',
    videoObjectUrl: '/assets/drone_sample.mp4',
    videoDuration: '00:24',
    videoResolution: '1920 × 1080',
    videoFps: 24,
    stats: {
      totalPeople: 18,
      peopleDelta: 0,
      totalVehicles: 8,
      vehiclesDelta: 1,
      fireIncidents: { major: 0, minor: 0, hazardous: 0 },
      entryExitPoints: { total: 2, entry: 1, exit: 1 },
      damagedAreas: { total: 1, details: 'South Facade Column' },
    },
    detectedConditions: {
      structuralDamage: true,
      fire: false,
      smoke: false,
      humanPresence: true,
      vehiclePresence: true,
      entryExit: true,
    },
    overallCondition: {
      level: 'MODERATE',
      title: 'PROCESSING - Active Point Cloud Reconstruction',
      description: 'Neural photogrammetry pipeline currently processing 142 drone keyframes. Preliminary facade cracks isolated on upper levels.',
    },
    keyObservations: [
      'Processing 142 high-resolution drone keyframes.',
      'South facade elevation shows micro-fissure patterns.',
      'Zero active heat signatures or combustion detected.',
      'Controlled safety perimeter maintained at street level.',
    ],
  },
  {
    id: 'AM-20250901-003',
    name: 'Highway Damage Survey',
    location: 'NH-48, Haryana',
    description: 'Asphalt pavement integrity scan and vehicle collision reconstruction.',
    date: '2025-09-01',
    time: '11:18 AM',
    status: 'Failed',
    thumbnailUrl: '/assets/night_aerial_city.jpg',
    videoName: 'nh48_flyover.mp4',
    videoSize: '1.2 MB',
    videoObjectUrl: '/assets/drone_sample.mp4',
    videoDuration: '00:10',
    videoResolution: '1280 × 720',
    videoFps: 15,
    stats: {
      totalPeople: 0,
      peopleDelta: 0,
      totalVehicles: 15,
      vehiclesDelta: 0,
      fireIncidents: { major: 0, minor: 0, hazardous: 0 },
      entryExitPoints: { total: 0, entry: 0, exit: 0 },
      damagedAreas: { total: 3, details: 'Median Barrier + Lane 2' },
    },
    detectedConditions: {
      structuralDamage: true,
      fire: false,
      smoke: false,
      humanPresence: false,
      vehiclePresence: true,
      entryExit: false,
    },
    overallCondition: {
      level: 'UNKNOWN',
      title: 'FAILED - Telemetry Stream Packet Loss',
      description: 'Severe adverse weather conditions caused drone sensor link degradation during RTK GPS pass. Incomplete photogrammetry capture.',
    },
    keyObservations: [
      'GPS RTK lock lost during 4th survey pass.',
      'Pavement scan incomplete between km 42 and km 44.',
      'Partial vehicle obstacle mapping preserved in cache.',
    ],
  },
  {
    id: 'AM-20250827-004',
    name: 'Industrial Site Analysis',
    location: 'Greater Noida, Uttar Pradesh',
    description: 'Refinery perimeter thermal survey and chemical storage tank inspection.',
    date: '2025-08-27',
    time: '09:32 AM',
    status: 'Analysis Completed',
    thumbnailUrl: '/assets/drone_tech.jpg',
    videoName: 'industrial_complex.mp4',
    videoSize: '3.6 MB',
    videoObjectUrl: '/assets/drone_sample.mp4',
    videoDuration: '00:18',
    videoResolution: '1920 × 1080',
    videoFps: 30,
    stats: {
      totalPeople: 32,
      peopleDelta: 1,
      totalVehicles: 19,
      vehiclesDelta: 3,
      fireIncidents: { major: 0, minor: 1, hazardous: 0 },
      entryExitPoints: { total: 5, entry: 3, exit: 2 },
      damagedAreas: { total: 1, details: 'Cooling Tower Pipeline' },
    },
    detectedConditions: {
      structuralDamage: true,
      fire: true,
      smoke: true,
      humanPresence: true,
      vehiclePresence: true,
      entryExit: true,
    },
    overallCondition: {
      level: 'WARNING',
      title: 'WARNING - Minor Thermal Leak Contained',
      description: 'Secondary exhaust manifold valve exhibiting elevated temperature. Perimeter secure with active personnel clearance verified.',
    },
    keyObservations: [
      'Exhaust manifold thermal anomaly identified at Unit 4.',
      'Perimeter security corridor fully clear.',
      'Personnel evacuation protocol tested successfully.',
      'Cooling infrastructure integrity within operational parameters.',
    ],
  },
];

export const defaultMarkings: CustomMarking[] = [
  {
    id: 'mark-mountain',
    name: 'Mountain',
    type: 'Landmark',
    color: '#10b981',
    description: 'Northern ridge elevation',
    visible: true,
    position: [-5.0, 3.5, -7.5],
    iconType: 'mountain'
  },
  {
    id: 'mark-docheck',
    name: 'Docheck Point 1',
    type: 'Entry Point',
    color: '#f59e0b',
    description: 'Bridge western approach checkpoint',
    visible: true,
    position: [-4.2, 1.2, -1.8],
    iconType: 'pin'
  },
  {
    id: 'mark-fire',
    name: 'Fire Major',
    type: 'Hazard',
    color: '#ef4444',
    description: 'Vehicle fuel ignition on western deck',
    visible: true,
    position: [-2.0, 1.5, 0.2],
    iconType: 'fire'
  },
  {
    id: 'mark-rubble',
    name: 'Rubble Zone',
    type: 'Damage',
    color: '#ef4444',
    description: 'Collapsed superstructure debris on central span',
    visible: true,
    position: [0.2, 1.1, 1.1],
    iconType: 'warning'
  },
  {
    id: 'mark-shelter',
    name: 'Shelter Area',
    type: 'Temporary shelter',
    color: '#a855f7',
    description: 'Triage and casualty holding staging area',
    visible: true,
    position: [2.5, 0.9, 1.8],
    iconType: 'shelter'
  },
  {
    id: 'mark-entry-exit',
    name: 'Entry / Exit',
    type: 'Entry Point',
    color: '#10b981',
    description: 'Eastern clearance corridor',
    visible: true,
    position: [5.2, 0.5, 3.0],
    iconType: 'pin'
  },
  {
    id: 'mark-water',
    name: 'Water',
    type: 'Water',
    color: '#00d2ff',
    description: 'Waterway channel depth 14m',
    visible: true,
    position: [-2.8, -1.2, 4.2],
    iconType: 'water'
  },
  {
    id: 'mark-boat',
    name: 'Boat',
    type: 'Custom',
    color: '#00d2ff',
    description: 'Emergency rescue patrol vessel',
    visible: true,
    position: [-1.4, -1.0, 5.4],
    iconType: 'boat'
  }
];

export const defaultFilterState: FilterState = {
  reconstruction3D: true,
  entryExit: true,
  humans: false,
  vehicles: true,
  fireSmoke: true,
  damage: true,
  labels: true,
  customMarkings: {
    'Boat': true,
    'Water': true,
    'Mountain': true,
    'Docheck Point 1': true,
    'Rubble Zone': true,
    'Shelter Area': true,
  }
};

export const defaultIncidentStats: IncidentStats = {
  totalPeople: 48,
  peopleDelta: 3,
  totalVehicles: 24,
  vehiclesDelta: 2,
  fireIncidents: {
    major: 1,
    minor: 1,
    hazardous: 1
  },
  entryExitPoints: {
    total: 4,
    entry: 2,
    exit: 2
  },
  damagedAreas: {
    total: 2,
    details: 'Bridge Section + Road'
  }
};
