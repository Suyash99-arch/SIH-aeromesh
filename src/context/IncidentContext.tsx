import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { Incident, CustomMarking, FilterState, IncidentStats, VideoFrame, VideoMeta } from '../types';
import { initialIncident, historyIncidents as defaultHistory, defaultMarkings, defaultFilterState, defaultIncidentStats } from '../data/mockData';
import { extractFramesFromFile, getDemoFrames, type ExtractionProgress } from '../utils/frameExtractor';
import { downloadIncidentReport } from '../utils/reportGenerator';

// ─── Extraction State ────────────────────────────────────────────────────────
export type ExtractionStatus = 'idle' | 'extracting' | 'done' | 'error';

export interface ExtractionState {
  status: ExtractionStatus;
  progress: ExtractionProgress;
  error: string | null;
}

// ─── Context Shape ───────────────────────────────────────────────────────────
interface IncidentContextType {
  // Incident data
  incident: Incident;
  setIncident: React.Dispatch<React.SetStateAction<Incident>>;
  historyIncidents: Incident[];
  selectIncident: (id: string) => void;

  // Markings
  markings: CustomMarking[];
  addMarking: (marking: Omit<CustomMarking, 'id'>) => void;
  deleteMarking: (id: string) => void;
  toggleMarkingVisibility: (id: string) => void;

  // Filters
  filters: FilterState;
  setFilter: (key: keyof Omit<FilterState, 'customMarkings'>, val: boolean) => void;
  setCustomMarkingFilter: (name: string, val: boolean) => void;
  resetFilters: () => void;

  // Stats
  stats: IncidentStats;

  // ── Real Video File & Extraction ──────────────────────────────────────────
  /** The raw File object from the user's upload */
  videoFile: File | null;
  /** blob: or asset URL for the current video — usable as <video src={...}> */
  videoBlobUrl: string | null;
  /** Real video metadata read from the video element and container */
  videoMeta: VideoMeta | null;
  /** Set the uploaded file; triggers metadata read + real frame extraction */
  setVideoFile: (file: File | null) => Promise<void>;

  // ── Extracted Frames ──────────────────────────────────────────────────────
  frames: VideoFrame[];
  selectedFrame: VideoFrame | null;
  setSelectedFrame: (frame: VideoFrame | null) => void;
  reloadFrames: () => void;

  /** Extraction lifecycle state */
  extraction: ExtractionState;

  // ── Report Modal & Actions ────────────────────────────────────────────────
  isReportModalOpen: boolean;
  reportIncident: Incident;
  openReport: (incident?: Incident) => void;
  closeReport: () => void;
  downloadReport: (incident?: Incident) => void;

  // ── Incident helper ───────────────────────────────────────────────────────
  createNewIncident: (data: Partial<Incident>) => string;
}

// ─── Context ─────────────────────────────────────────────────────────────────
const IncidentContext = createContext<IncidentContextType | undefined>(undefined);

// Initial demo frames so frames load immediately on first visit
const initialDemoFrames = getDemoFrames(initialIncident.id);

// ─── Provider ────────────────────────────────────────────────────────────────
export const IncidentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [incident, setIncident] = useState<Incident>(initialIncident);
  const [historyList, setHistoryList] = useState<Incident[]>(defaultHistory);
  const [markings, setMarkings] = useState<CustomMarking[]>(defaultMarkings);
  const [filters, setFilters] = useState<FilterState>(defaultFilterState);
  const [stats, setStats] = useState<IncidentStats>(initialIncident.stats || defaultIncidentStats);

  // Video & frames ─────────────────────────────────────────────────────────
  const [videoFile, _setVideoFile] = useState<File | null>(null);
  // Default to the sample drone footage so video and frames load right away
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(initialIncident.videoObjectUrl || '/assets/drone_sample.mp4');
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>({
    duration: 53.9,
    durationFormatted: '00:53',
    width: 1920,
    height: 1080,
    resolutionFormatted: '1920 × 1080',
    fps: 12,
  });
  const [frames, setFrames] = useState<VideoFrame[]>(initialDemoFrames);
  const [selectedFrame, setSelectedFrame] = useState<VideoFrame | null>(initialDemoFrames[0] ?? null);
  const [extraction, setExtraction] = useState<ExtractionState>({
    status: 'done',
    progress: { current: initialDemoFrames.length, total: initialDemoFrames.length },
    error: null,
  });

  // Report Modal state
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [reportTarget, setReportTarget] = useState<Incident>(initialIncident);

  // Track active extraction aborts
  const extractionAbortRef = useRef<boolean>(false);

  /** Open the Analysis Report modal */
  const openReport = useCallback((inc?: Incident) => {
    setReportTarget(inc || incident);
    setIsReportModalOpen(true);
  }, [incident]);

  /** Close the Analysis Report modal */
  const closeReport = useCallback(() => {
    setIsReportModalOpen(false);
  }, []);

  /** Download report directly */
  const downloadReport = useCallback((inc?: Incident) => {
    downloadIncidentReport(inc || incident);
  }, [incident]);

  /** Select an incident from history */
  const selectIncident = useCallback((id: string) => {
    const found = historyList.find(item => item.id === id);
    if (!found) return;
    setIncident(found);
    if (found.stats) setStats(found.stats);

    // Load corresponding frames & video
    const newDemoFrames = getDemoFrames(found.id);
    setFrames(newDemoFrames);
    setSelectedFrame(newDemoFrames[0] ?? null);
    setVideoBlobUrl(found.videoObjectUrl || '/assets/drone_sample.mp4');
    setVideoMeta({
      duration: 53.9,
      durationFormatted: found.videoDuration || '00:53',
      width: 1920,
      height: 1080,
      resolutionFormatted: found.videoResolution || '1920 × 1080',
      fps: found.videoFps || 12,
    });
    setExtraction({
      status: 'done',
      progress: { current: newDemoFrames.length, total: newDemoFrames.length },
      error: null,
    });
  }, [historyList]);


  /**
   * Main setter: when the user picks a new video file (or clears it),
   * this cleans up the old blob URL, clears old frames, creates a new one,
   * and runs real frame extraction.
   */
  const setVideoFile = useCallback(async (file: File | null) => {
    extractionAbortRef.current = true;

    // Revoke old blob URL to free memory if it was a blob:
    setVideoBlobUrl(prev => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });

    setFrames([]);
    setSelectedFrame(null);
    setVideoMeta(null);
    _setVideoFile(null);

    if (!file) {
      // Revert to demo frames if cleared
      const demo = getDemoFrames(incident.id);
      setFrames(demo);
      setSelectedFrame(demo[0] ?? null);
      setVideoBlobUrl('/assets/drone_sample.mp4');
      setVideoMeta({
        duration: 15,
        durationFormatted: '00:15',
        width: 1920,
        height: 1080,
        resolutionFormatted: '1920 × 1080',
        fps: 12,
      });
      setExtraction({ status: 'done', progress: { current: demo.length, total: demo.length }, error: null });
      return;
    }

    if (file.size === 0) {
      setExtraction({
        status: 'error',
        progress: { current: 0, total: 0 },
        error: 'The selected video file is empty (0 bytes).',
      });
      return;
    }

    // Create fresh blob URL for the new file
    const blobUrl = URL.createObjectURL(file);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    setVideoBlobUrl(blobUrl);
    _setVideoFile(file);

    setIncident(prev => ({
      ...prev,
      videoName: file.name,
      videoSize: sizeMb,
      videoObjectUrl: blobUrl,
      videoDuration: undefined,
      videoResolution: undefined,
      videoFps: undefined,
    }));

    // Start extraction
    extractionAbortRef.current = false;
    setExtraction({ status: 'extracting', progress: { current: 0, total: 0 }, error: null });

    try {
      const result = await extractFramesFromFile(
        file,
        24,
        (progress) => {
          if (!extractionAbortRef.current) {
            setExtraction(prev => ({ ...prev, progress }));
          }
        }
      );

      if (extractionAbortRef.current) return;

      setVideoMeta(result.meta);
      setFrames(result.frames);
      setSelectedFrame(result.frames[0] ?? null);
      setExtraction({
        status: 'done',
        progress: { current: result.frames.length, total: result.frames.length },
        error: null,
      });

      setIncident(prev => ({
        ...prev,
        videoObjectUrl: blobUrl,
        videoDuration: result.meta.durationFormatted,
        videoResolution: result.meta.resolutionFormatted,
        videoFps: result.meta.fps ?? undefined,
      }));
    } catch (err) {
      if (extractionAbortRef.current) return;
      const msg = err instanceof Error ? err.message : 'Frame extraction failed';
      console.error('[AeroMesh] Frame extraction error:', err);
      // Fallback to demo frames so UI never remains blank on error
      const demo = getDemoFrames(incident.id);
      setFrames(demo);
      setSelectedFrame(demo[0] ?? null);
      setExtraction({ status: 'error', progress: { current: 0, total: 0 }, error: msg });
    }
  }, [incident.id]);

  /** Re-extract or reload frames for current incident */
  const reloadFrames = useCallback(() => {
    if (videoFile) {
      setVideoFile(videoFile);
    } else {
      const demo = getDemoFrames(incident.id);
      setFrames(demo);
      setSelectedFrame(demo[0] ?? null);
      setExtraction({
        status: 'done',
        progress: { current: demo.length, total: demo.length },
        error: null,
      });
    }
  }, [videoFile, incident.id, setVideoFile]);

  // ─── Markings ─────────────────────────────────────────────────────────────
  const addMarking = (newMarking: Omit<CustomMarking, 'id'>) => {
    const id = 'mark-' + Date.now();
    const created: CustomMarking = { ...newMarking, id };
    setMarkings(prev => [...prev, created]);
    setFilters(prev => ({
      ...prev,
      customMarkings: { ...prev.customMarkings, [created.name]: true },
    }));
  };

  const deleteMarking = (id: string) => {
    const target = markings.find(m => m.id === id);
    setMarkings(prev => prev.filter(m => m.id !== id));
    if (target) {
      setFilters(prev => {
        const next = { ...prev.customMarkings };
        delete next[target.name];
        return { ...prev, customMarkings: next };
      });
    }
  };

  const toggleMarkingVisibility = (id: string) => {
    setMarkings(prev =>
      prev.map(m => {
        if (m.id === id) {
          const updated = { ...m, visible: !m.visible };
          setFilters(f => ({
            ...f,
            customMarkings: { ...f.customMarkings, [m.name]: updated.visible },
          }));
          return updated;
        }
        return m;
      })
    );
  };

  // ─── Filters ──────────────────────────────────────────────────────────────
  const setFilter = (key: keyof Omit<FilterState, 'customMarkings'>, val: boolean) => {
    setFilters(prev => ({ ...prev, [key]: val }));
  };

  const setCustomMarkingFilter = (name: string, val: boolean) => {
    setFilters(prev => ({ ...prev, customMarkings: { ...prev.customMarkings, [name]: val } }));
    setMarkings(prev => prev.map(m => (m.name === name ? { ...m, visible: val } : m)));
  };

  const resetFilters = () => {
    setFilters(defaultFilterState);
    setMarkings(defaultMarkings);
  };

  // ─── Incident helper ──────────────────────────────────────────────────────
  const createNewIncident = (data: Partial<Incident>): string => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const randomSeq = String(Math.floor(Math.random() * 900) + 100);
    const newId = `AM-${yyyy}${mm}${dd}-${randomSeq}`;

    const newInc: Incident = {
      id: newId,
      name: data.name || 'Untitled Incident',
      location: data.location || 'Unknown Location',
      description: data.description || '',
      date: data.date || `${yyyy}-${mm}-${dd}`,
      time: data.time || '10:00 AM',
      status: 'Analysis Completed',
      thumbnailUrl: '/assets/drone_bridge_aerial.jpg',
      videoName: data.videoName,
      videoSize: data.videoSize,
      videoObjectUrl: data.videoObjectUrl,
      stats: defaultIncidentStats,
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
        description: 'The analysed scene indicates significant structural damage with active fire activity. Area should be secured.',
      },
      keyObservations: [
        'Structural damage detected by drone aerial survey.',
        'Human presence and vehicles isolated in sector.',
        'Reconnaissance data logged into AeroMesh records.',
      ],
    };

    setIncident(newInc);
    setHistoryList(prev => [newInc, ...prev]);
    return newId;
  };

  return (
    <IncidentContext.Provider
      value={{
        incident,
        setIncident,
        historyIncidents: historyList,
        selectIncident,
        markings,
        addMarking,
        deleteMarking,
        toggleMarkingVisibility,
        filters,
        setFilter,
        setCustomMarkingFilter,
        resetFilters,
        stats,
        videoFile,
        videoBlobUrl,
        videoMeta,
        setVideoFile,
        frames,
        selectedFrame,
        setSelectedFrame,
        reloadFrames,
        extraction,
        isReportModalOpen,
        reportIncident: reportTarget,
        openReport,
        closeReport,
        downloadReport,
        createNewIncident,
      }}
    >
      {children}
    </IncidentContext.Provider>
  );
};

export const useIncident = () => {
  const context = useContext(IncidentContext);
  if (!context) throw new Error('useIncident must be used within an IncidentProvider');
  return context;
};
