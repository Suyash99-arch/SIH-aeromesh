import { motion, useReducedMotion } from "framer-motion";
import { useState, useEffect } from "react";
import Icon from "../ui/Icon";
import MissionSelectorPanel from "./MissionSelectorPanel";
import { useUI } from "../../context/UIContext";
import { API_BASE, getAuthHeaders } from "../../api/missions";
import {
  missionNavigation,
  intelligenceNavigation,
  outputNavigation,
  systemNavigation,
} from "../../data/navigation";

/** Checks /api/v1/ai-engine/status; returns live detector, reconstruction, compute, and tiling status */
function useEngineStatus() {
  const [status, setStatus] = useState({
    detector: null,
    reconstruction: null,
    compute: null,
    tiling: null,
    overall: null,
  });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/ai-engine/status`, {
          headers: getAuthHeaders(),
        });
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          const detReady = Boolean(json?.detector?.ready || json?.detector?.status === "READY" || json?.detector?.status === "LOADED");
          const reconReady = Boolean(json?.reconstruction?.ready || json?.reconstruction?.status === "READY" || json?.reconstruction?.status === "AVAILABLE");
          const overall = (detReady && reconReady) ? "ONLINE" : (detReady || reconReady) ? "PARTIAL" : "DEGRADED";
          setStatus({
            detector: json?.detector?.label || (detReady ? "YOLO Ready" : "Detector: not loaded"),
            detectorStatus: json?.detector?.status || "NOT_LOADED",
            reconstruction: json?.reconstruction?.label || (reconReady ? "pycolmap 4.1.1" : "Reconstruction Offline"),
            reconstructionStatus: json?.reconstruction?.status || "UNAVAILABLE",
            compute: json?.compute?.label || "CPU only",
            computeDevice: json?.compute?.device || "cpu",
            tiling: json?.tiling?.label || "2x2 Tiling",
            tilingStatus: json?.tiling?.status || "ACTIVE",
            overall,
          });
        } else {
          setStatus({
            detector: "Detector: not loaded",
            detectorStatus: "OFFLINE",
            reconstruction: "pycolmap Offline",
            reconstructionStatus: "OFFLINE",
            compute: "CPU only",
            computeDevice: "cpu",
            tiling: "Tiling Inactive",
            tilingStatus: "OFFLINE",
            overall: "OFFLINE",
          });
        }
      } catch {
        if (!cancelled) {
          setStatus({
            detector: "Detector: not loaded",
            detectorStatus: "OFFLINE",
            reconstruction: "pycolmap Offline",
            reconstructionStatus: "OFFLINE",
            compute: "CPU only",
            computeDevice: "cpu",
            tiling: "Tiling Inactive",
            tilingStatus: "OFFLINE",
            overall: "OFFLINE",
          });
        }
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return status;
}


function Nav({ title, items, activePage, navigate, t }) {
  const reduceMotion = useReducedMotion();

  const getNavLabel = (id, fallback) => {
    const keyMap = {
      overview: "nav.overview",
      missions: "nav.missions",
      drone: "nav.processing",
      reconstruction: "nav.reconstruction",
      analytics: "nav.sceneIntelligence",
      map: "nav.geospatial",
      reports: "nav.reports",
      profile: "nav.profile",
      settings: "nav.settings",
    };
    const key = keyMap[id] || `nav.${id}`;
    const translated = t(key);
    return (translated && translated !== key) ? translated : fallback;
  };

  return (
    <nav className="nav-group">
      <span className="nav-title">{title}</span>
      {items.map(([id, label, icon, count]) => {
        const isActive = activePage === id;

        return (
          <motion.button
            layout
            key={id}
            className={`nav-item ${isActive ? "active" : ""}`}
            onClick={() => navigate(id)}
            whileHover={reduceMotion ? undefined : { scale: 1.01 }}
            whileTap={reduceMotion ? undefined : { scale: 0.97, rotate: -3 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {isActive && !reduceMotion && (
              <motion.span
                layoutId="nav-active-pill"
                className="nav-active-pill"
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
              />
            )}
            <Icon name={icon} />
            <span>{getNavLabel(id, label)}</span>
            {count && <b>{count}</b>}
          </motion.button>
        );
      })}
    </nav>
  );
}

export default function Sidebar({
  activePage,
  navigate,
  notice,
  mission,
  setMission,
  onCreateMission,
  onNavigateHome,
}) {
  const { t, language } = useUI();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const engineStatus = useEngineStatus();

  const getDetectorLabel = () => {
    if (language !== "hi") return engineStatus.detector || t("sidebar.loading");
    if (engineStatus.detectorStatus === "READY") return "YOLO तैयार";
    return "संसूचक: लोड नहीं";
  };

  const getReconLabel = () => {
    if (language !== "hi") return engineStatus.reconstruction || t("sidebar.loading");
    if (engineStatus.reconstructionStatus === "READY") return "COLMAP तैयार";
    return "पुनर्निर्माण अनुपलब्ध";
  };

  const getComputeLabel = () => {
    if (language !== "hi") return engineStatus.compute || t("sidebar.cpuOnly");
    return engineStatus.computeDevice === "cuda" ? "CUDA सक्रिय" : "केवल CPU";
  };

  const getTilingLabel = () => {
    if (language !== "hi") return engineStatus.tiling || t("sidebar.tiled");
    return "2x2 टाइलिंग (15% ओवरलैप)";
  };

  const getOverallLabel = () => {
    if (language !== "hi") return engineStatus.overall || t("sidebar.checking");
    if (engineStatus.overall === "ONLINE") return "ऑनलाइन";
    if (engineStatus.overall === "PARTIAL") return "आंशिक";
    if (engineStatus.overall === "DEGRADED") return "सीमित";
    return "जांच जारी";
  };

  return (
    <>
      <aside className="sidebar">
        <div
          className="brand"
          onClick={onNavigateHome}
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer" }}
          title={t("app.platformSubtitle")}
        >
          <div>
            <Icon name="Radar" size={21} />
          </div>
          <section>
            <strong>AEROMESH</strong>
            <small>{t("sidebar.brandSubtitle")}</small>
          </section>
        </div>

        <button className="workspace" onClick={() => setSelectorOpen(true)}>
          <b>{mission?.name?.[0] || "A"}</b>
          <span>
            <small>{t("sidebar.activeMission")}</small>
            <strong>
              {mission?.name || t("sidebar.unknownMission")} ·{" "}
              {mission?.sector || t("sidebar.newMission")}
            </strong>
          </span>
        </button>

        <button
          className="nav-item create-mission-btn"
          onClick={onCreateMission}
          id="btn-sidebar-new-mission"
        >
          <Icon name="Plus" />
          <span>{t("sidebar.newMission")}</span>
        </button>

        <Nav
          title={t("sidebar.groupMission")}
          items={missionNavigation}
          {...{ activePage, navigate, t }}
        />
        <Nav
          title={t("sidebar.groupIntelligence")}
          items={intelligenceNavigation}
          {...{ activePage, navigate, t }}
        />
        <Nav
          title={t("sidebar.groupOutput")}
          items={outputNavigation}
          {...{ activePage, navigate, t }}
        />
        <div className="sidebar-spacer" />

        <div className="engine">
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <i /> {t("sidebar.aiEngine")}
            </span>
            <b style={{
              color: engineStatus.overall === "ONLINE" ? '#38bdf8' : engineStatus.overall === null ? '#fbbf24' : '#f87171',
              fontSize: '10px',
            }}>
              {getOverallLabel()}
            </b>
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t("sidebar.detection")}</span>
              <b style={{
                color: engineStatus.detectorStatus === 'READY' ? '#10b981' : '#f87171',
                fontSize: '9.5px',
                background: engineStatus.detectorStatus === 'READY' ? '#10b9811e' : '#f871711e',
                padding: '1px 5px',
                borderRadius: '4px',
              }}>
                {getDetectorLabel()}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t("sidebar.sfm")}</span>
              <b style={{
                color: engineStatus.reconstructionStatus === 'READY' ? '#10b981' : '#f87171',
                fontSize: '9.5px',
                background: engineStatus.reconstructionStatus === 'READY' ? '#10b9811e' : '#f871711e',
                padding: '1px 5px',
                borderRadius: '4px',
              }}>
                {getReconLabel()}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t("sidebar.hardware")}</span>
              <b style={{
                color: engineStatus.computeDevice === 'cuda' ? '#38bdf8' : '#e2e8f0',
                fontSize: '9.5px',
                background: 'rgba(255,255,255,0.06)',
                padding: '1px 5px',
                borderRadius: '4px',
              }}>
                {getComputeLabel()}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t("sidebar.inference")}</span>
              <b style={{
                color: '#38bdf8',
                fontSize: '9.5px',
                background: '#38bdf81e',
                padding: '1px 5px',
                borderRadius: '4px',
              }}>
                {getTilingLabel()}
              </b>
            </div>
          </div>
        </div>

        <Nav
          title={t("sidebar.groupSystem")}
          items={systemNavigation}
          {...{ activePage, navigate, t }}
        />
        <footer>
          AEROMESH v1.0 <i>•</i> SIH BUILD
        </footer>
      </aside>

      {selectorOpen && (
        <MissionSelectorPanel
          active={mission}
          setActive={setMission}
          notice={notice}
          onClose={() => setSelectorOpen(false)}
        />
      )}
    </>
  );
}
