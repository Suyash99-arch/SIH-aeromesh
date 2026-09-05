import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/pages.css";
import "./styles/sih.css";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import CreateMissionModal from "./components/missions/CreateMissionModal";
import HomePage from "./pages/HomePage";
import { pageTitles } from "./data/navigation";
import { getMission as getSeedMission } from "./data/missions";
import { getMission as getApiMission } from "./api/missions";
import {
  OverviewPage,
  MissionsPage,
  DronePage,
  ReconstructionPage,
  IntelligencePage,
  ChallengePage,
  SettingsPage,
} from "./pages/Pages";

const getInitialMissionId = () => {
  if (typeof window !== "undefined") {
    const param = new URLSearchParams(window.location.search).get("mission");
    if (param) return param;
  }
  return getSeedMission("north-ridge") ? "north-ridge" : "sector-04";
};

const DEFAULT_MISSION_ID = getInitialMissionId();

export default function App() {
  const [showHomepage, setShowHomepage] = useState(true);
  const [activePage, setActivePage] = useState("overview");
  const [missionId, setMissionId] = useState(DEFAULT_MISSION_ID);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("aeromesh-theme") || "dark",
  );
  const [showCreateMission, setShowCreateMission] = useState(false);
  const [mission, setMission] = useState(() =>
    getSeedMission(DEFAULT_MISSION_ID),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aeromesh-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let active = true;

    getApiMission(missionId).then((nextMission) => {
      if (!active) return;

      const fallbackMission =
        getSeedMission(missionId) || getSeedMission(DEFAULT_MISSION_ID);
      const resolvedMission =
        nextMission && !nextMission.hasError ? nextMission : fallbackMission;

      if (nextMission?.backendUnavailable) {
        setToast({
          message: "Backend unavailable. Showing local mission data.",
          type: "error",
        });
      }

      setMission(resolvedMission || fallbackMission);
    });

    return () => {
      active = false;
    };
  }, [missionId]);

  const notice = (message, type = "success") => setToast({ message, type });

  const navigate = (id) => {
    setActivePage(id);
    if (id !== "overview") {
      notice(`${pageTitles[id]} opened`, "info");
    }
  };

  const handleMissionCreated = (newMissionId) => {
    setMissionId(newMissionId);
    setActivePage("overview");
    setShowCreateMission(false);
    notice("Mission created successfully", "success");
  };

  const handleStartMission = () => {
    setShowHomepage(false);
    setShowCreateMission(true);
  };

  const handleNavigateDashboard = () => {
    setShowHomepage(false);
  };

  // If homepage is active, show only the homepage (no sidebar/topbar)
  if (showHomepage) {
    return (
      <>
        <HomePage
          onNavigateDashboard={handleNavigateDashboard}
          onStartMission={handleStartMission}
        />

        {showCreateMission && (
          <CreateMissionModal
            onClose={() => setShowCreateMission(false)}
            onMissionCreated={handleMissionCreated}
          />
        )}
      </>
    );
  }

  // Otherwise show the mission dashboard
  const shared = {
    mission,
    navigate,
    notice,
    setMission: setMissionId,
  };

  const page =
    activePage === "overview" ? (
      <OverviewPage {...shared} />
    ) : activePage === "missions" ? (
      <MissionsPage {...shared} />
    ) : activePage === "drone" ? (
      <DronePage {...shared} />
    ) : activePage === "reconstruction" ? (
      <ReconstructionPage {...shared} />
    ) : activePage === "challenge" ? (
      <ChallengePage {...shared} />
    ) : activePage === "settings" ? (
      <SettingsPage {...shared} />
    ) : (
      <IntelligencePage kind={activePage} {...shared} />
    );

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        navigate={navigate}
        notice={notice}
        mission={mission}
        setMission={setMissionId}
        onCreateMission={() => setShowCreateMission(true)}
      />

      <main className="main">
        <Topbar
          title={pageTitles[activePage]}
          theme={theme}
          setTheme={setTheme}
          notice={notice}
        />

        <div className="content">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activePage}-${missionId}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {page}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {showCreateMission && (
        <CreateMissionModal
          onClose={() => setShowCreateMission(false)}
          onMissionCreated={handleMissionCreated}
        />
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          <span>✓</span>
          {toast.message}
        </div>
      )}
    </div>
  );
}
