import { useEffect, useState } from "react";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/pages.css";
import "./styles/sih.css";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import CreateMissionModal from "./components/missions/CreateMissionModal";
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

export default function App() {
  const [activePage, setActivePage] = useState("overview");
  const [missionId, setMissionId] = useState("sector-04");
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("aeromesh-theme") ||
      (matchMedia("(prefers-color-scheme:light)").matches ? "light" : "dark"),
  );
  const [showCreateMission, setShowCreateMission] = useState(false);
  const [mission, setMission] = useState(() => getSeedMission(missionId));

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
      if (nextMission?.backendUnavailable) {
        setToast({
          message: "Backend unavailable. Showing local mission data.",
          type: "error",
        });
      }
      setMission(nextMission || getSeedMission(missionId));
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

        <div className="content" key={`${activePage}-${missionId}`}>
          {page}
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
