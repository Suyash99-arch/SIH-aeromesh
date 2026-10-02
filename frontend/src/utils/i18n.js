// i18n Internationalization & Unit Formatting Engine (English + Hindi)
// WCAG AA Compliant Locale & Unit Conversion Utility

export const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "hi", name: "हिन्दी (Hindi)", flag: "🇮🇳" },
];

export const UNITS = [
  { id: "metric", label: "Metric (m, km², km/h)", sys: "SI" },
  { id: "imperial", label: "Imperial (ft, sq mi, mph)", sys: "US" },
];

export const TRANSLATIONS = {
  en: {
    // Navigation & Portal
    appTitle: "Hexa Spark",
    tagline: "Neural Aerial 3D Reconstruction & Spatial Object Intelligence",
    govPortal: "Government / Defense Portal",
    indivPortal: "Individual / Commercial Portal",
    guestMode: "Ephemeral Guest Mode",
    login: "Log In",
    logout: "Log Out",
    register: "Create Account",
    switchTheme: "Toggle Theme",
    lightMode: "Light Mode",
    darkMode: "Dark Mode",
    language: "Language",
    unitSystem: "Units",
    
    // Page Tabs & Sections
    navDashboard: "Mission Control",
    navReconstruction: "3D Reconstruction",
    navDetections: "AI Detections",
    navAnalysis: "Spatial Analysis",
    navReports: "Export & Reports",
    navSettings: "System Settings",

    // Mission Control & List
    newIncident: "New Flight Mission",
    uploadVideo: "Upload Flight Video",
    dropVideoHere: "Drag & drop drone video file (.mp4, .mov, .avi, .mkv, .webm)",
    selectVideoFile: "Select Video File",
    uploadingChunked: "Uploading video in resumable chunks...",
    processingETA: "Estimated Pipeline Processing Time",
    calculatingETA: "Calculating mathematically from resolution & hardware...",
    hardwareDetected: "Detected Compute Acceleration",
    allMissions: "All Missions",
    readyMissions: "Ready",
    processingMissions: "Processing",
    failedMissions: "Failed",
    searchMissions: "Search flight missions by name or sector...",
    storageUsage: "Storage Usage",
    deleteMission: "Delete Mission",
    confirmDelete: "Are you sure you want to permanently delete this mission and its 3D artifacts?",
    noMissionsFound: "No flight missions found matching your filter.",
    uploadFirstVideo: "Upload your first flight video to initiate automated 3D spatial reconstruction.",

    // 3D Reconstruction View
    pointCloud: "3D Point Cloud",
    denseMesh: "Dense Textured Mesh",
    spatialExtents: "Spatial Extents",
    bboxLength: "Length",
    bboxWidth: "Width",
    bboxHeight: "Height",
    bboxFootprint: "Footprint Area",
    bboxDistance: "Point-to-Point Distance",
    scaleStatus: "Scale Calibration Status",
    uncalibratedNotice: "Relative units (Uncalibrated). Calibrate against ground control points for metric scale.",
    export3DModel: "Export 3D Model",
    shareLink: "Generate Share Token",
    shareUrlCopied: "Share URL copied to clipboard!",
    shareExpires: "Expires in",
    days: "days",
    compareMissions: "Compare Missions Side-by-Side",
    selectBaseTarget: "Select two missions to calculate metric deltas and object movement.",

    // Object Detections & Tracking
    totalObjects: "Total Detections",
    vehiclesCount: "Vehicles Identified",
    peopleCount: "Personnel Counted",
    avgConfidence: "Mean AI Confidence",
    sahiTiledInference: "SAHI Tiled Inference",
    sahiDescription: "Small Object Aerial High-Resolution Tiling",
    trackedObjects: "3D Spatial Object Tracks",
    reprojectionError: "Reprojection Error",

    // Report & Exports
    exportPdfReport: "Download PDF Report",
    exportCsvObjects: "Export Objects CSV",
    exportJsonManifest: "Export JSON Manifest",
    exportEvidenceZip: "Download Evidence ZIP Package",

    // Accessibility & Status
    statusCompleted: "Completed",
    statusProcessing: "Processing Pipeline",
    statusFailed: "Execution Failed",
    statusCreated: "Mission Created",
    pausePipeline: "Pause",
    resumePipeline: "Resume",
    cancelPipeline: "Cancel",
    retryPipeline: "Retry Execution",
  },
  hi: {
    // Navigation & Portal
    appTitle: "हेक्सा स्पार्क",
    tagline: "न्यूरल एरियल 3D पुनर्निर्माण और स्थानिक ऑब्जेक्ट इंटेलिजेंस",
    govPortal: "सरकारी / रक्षा पोर्टल",
    indivPortal: "व्यक्तिगत / व्यावसायिक पोर्टल",
    guestMode: "अस्थायी अतिथि मोड",
    login: "लॉग इन करें",
    logout: "लॉग आउट करें",
    register: "खाता बनाएं",
    switchTheme: "थीम बदलें",
    lightMode: "लाइट मोड",
    darkMode: "डार्क मोड",
    language: "भाषा (Language)",
    unitSystem: "इकाइयां (Units)",
    
    // Page Tabs & Sections
    navDashboard: "मिशन नियंत्रण",
    navReconstruction: "3D पुनर्निर्माण",
    navDetections: "AI पहचान (Detections)",
    navAnalysis: "स्थानिक विश्लेषण",
    navReports: "निर्यात और रिपोर्ट",
    navSettings: "सिस्टम सेटिंग्स",

    // Mission Control & List
    newIncident: "नया उड़ान मिशन",
    uploadVideo: "उड़ान वीडियो अपलोड करें",
    dropVideoHere: "ड्रोन वीडियो फाइल खींचकर लाएं (.mp4, .mov, .avi, .mkv, .webm)",
    selectVideoFile: "वीडियो फ़ाइल चुनें",
    uploadingChunked: "रिज्यूमेबल चंक्स में वीडियो अपलोड हो रहा है...",
    processingETA: "अनुमानित पाइपलाइन प्रोसेसिंग समय",
    calculatingETA: "रिजोल्यूशन और हार्डवेयर से गणितीय रूप से गणना की जा रही है...",
    hardwareDetected: "पहचाना गया कंप्यूट त्वरण",
    allMissions: "सभी मिशन",
    readyMissions: "तैयार",
    processingMissions: "प्रसंस्करण में",
    failedMissions: "विफल",
    searchMissions: "नाम या सेक्टर द्वारा उड़ान मिशन खोजें...",
    storageUsage: "स्टोरेज उपयोग",
    deleteMission: "मिशन हटाएं",
    confirmDelete: "क्या आप निश्चित रूप से इस मिशन और इसके 3D कलाकृतियों को स्थायी रूप से हटाना चाहते हैं?",
    noMissionsFound: "आपके फ़िल्टर से मेल खाता हुआ कोई मिशन नहीं मिला।",
    uploadFirstVideo: "स्वचालित 3D स्थानिक पुनर्निर्माण शुरू करने के लिए अपना पहला वीडियो अपलोड करें।",

    // 3D Reconstruction View
    pointCloud: "3D पॉइंट क्लाउड",
    denseMesh: "डेंस टेक्सचर्ड मेश",
    spatialExtents: "स्थानिक विस्तार (Spatial Extents)",
    bboxLength: "लंबाई",
    bboxWidth: "चौड़ाई",
    bboxHeight: "ऊंचाई",
    bboxFootprint: "क्षेत्रफल (Footprint)",
    bboxDistance: "पॉइंट-टू-पॉइंट दूरी",
    scaleStatus: "स्केल अंशांकन स्थिति",
    uncalibratedNotice: "सापेक्ष इकाइयाँ (अनकैलिब्रेटेड)। मीट्रिक पैमाने के लिए ग्राउंड कंट्रोल पॉइंट्स के साथ अंशांकित करें।",
    export3DModel: "3D मॉडल निर्यात करें",
    shareLink: "शेयर टोकन जेनरेट करें",
    shareUrlCopied: "शेयर URL क्लिपबोर्ड पर कॉपी किया गया!",
    shareExpires: "समाप्ति समय",
    days: "दिन",
    compareMissions: "मिशनों की अगल-बगल तुलना करें",
    selectBaseTarget: "मीट्रिक डेल्टा और ऑब्जेक्ट मूवमेंट की गणना के लिए दो मिशन चुनें।",

    // Object Detections & Tracking
    totalObjects: "कुल पहचान",
    vehiclesCount: "पहचाने गए वाहन",
    peopleCount: "गिने गए कार्मिक",
    avgConfidence: "औसत AI सटीकता",
    sahiTiledInference: "SAHI टाइल्ड इनफरेंस",
    sahiDescription: "छोटे ऑब्जेक्ट एरियल हाई-रिज़ॉल्यूशन टाइलिंग",
    trackedObjects: "3D स्थानिक ऑब्जेक्ट ट्रैक्स",
    reprojectionError: "पुनर्प्रक्षेपण त्रुटि (Reprojection Error)",

    // Report & Exports
    exportPdfReport: "PDF रिपोर्ट डाउनलोड करें",
    exportCsvObjects: "ऑब्जेक्ट्स CSV निर्यात करें",
    exportJsonManifest: "JSON मैनिफेस्ट निर्यात करें",
    exportEvidenceZip: "साक्ष्य ZIP पैकेज डाउनलोड करें",

    // Accessibility & Status
    statusCompleted: "पूर्ण हुआ",
    statusProcessing: "प्रसंस्करण पाइपलाइन",
    statusFailed: "निष्पादन विफल",
    statusCreated: "मिशन बनाया गया",
    pausePipeline: "रोकें (Pause)",
    resumePipeline: "पुनः प्रारंभ करें",
    cancelPipeline: "रद्द करें",
    retryPipeline: "पुनः प्रयास करें",
  },
};

/**
 * Format length or distance into current active unit system (Metric vs Imperial)
 */
export function formatDistance(meters, unitSystem = "metric", lang = "en") {
  if (meters === null || meters === undefined || isNaN(meters)) return "—";
  if (unitSystem === "imperial") {
    const feet = meters * 3.28084;
    return `${feet.toLocaleString(lang === "hi" ? "hi-IN" : "en-US", { maximumFractionDigits: 2 })} ft`;
  }
  return `${meters.toLocaleString(lang === "hi" ? "hi-IN" : "en-US", { maximumFractionDigits: 2 })} m`;
}

/**
 * Format area into active unit system
 */
export function formatArea(sqMeters, unitSystem = "metric", lang = "en") {
  if (sqMeters === null || sqMeters === undefined || isNaN(sqMeters)) return "—";
  if (unitSystem === "imperial") {
    const sqFt = sqMeters * 10.7639;
    if (sqFt > 27878400) {
      const sqMi = sqMeters / 2589988.11;
      return `${sqMi.toLocaleString(lang === "hi" ? "hi-IN" : "en-US", { maximumFractionDigits: 2 })} sq mi`;
    }
    return `${sqFt.toLocaleString(lang === "hi" ? "hi-IN" : "en-US", { maximumFractionDigits: 2 })} sq ft`;
  }
  if (sqMeters > 1000000) {
    const sqKm = sqMeters / 1000000;
    return `${sqKm.toLocaleString(lang === "hi" ? "hi-IN" : "en-US", { maximumFractionDigits: 2 })} km²`;
  }
  return `${sqMeters.toLocaleString(lang === "hi" ? "hi-IN" : "en-US", { maximumFractionDigits: 2 })} m²`;
}

/**
 * Format timestamp in locale-aware format
 */
export function formatDateTime(isoString, lang = "en") {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return isoString;
  }
}
