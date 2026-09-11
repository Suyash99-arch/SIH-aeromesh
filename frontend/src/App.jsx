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
import AuthPage from "./pages/AuthPage";
import ProfilePage from "./pages/ProfilePage";
import { pageTitles } from "./data/navigation";
import { getMission as getSeedMission } from "./data/missions";
import {
  getMission as getApiMission,
  getStoredUser,
  fetchCurrentUser,
  clearAuthToken,
} from "./api/missions";
import {
  OverviewPage,
  MissionsPage,
  DronePage,
  ReconstructionPage,
  IntelligencePage,
  ChallengePage,
  SettingsPage,
} from "./pages/Pages";
import ProcessingProgressPage from "./pages/ProcessingProgressPage";
import ErrorBoundary from "./components/common/ErrorBoundary";

import AmbientCursorGlow from "./components/layout/AmbientCursorGlow";

const getInitialMissionId = () => {
  if (typeof window !== "undefined") {
    const param = new URLSearchParams(window.location.search).get("mission");
    if (param) return param;
  }
  return getSeedMission("north-ridge") ? "north-ridge" : "sector-04";
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => getStoredUser() || null);

  const [showHomepage, setShowHomepage] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const m = params.get("mission");
      const p = params.get("page");
      if (p || (m && m !== "north-ridge")) return false;
    }
    return true;
  });

  const [activePage, setActivePage] = useState(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("page");
      if (p) return p;
    }
    return "overview";
  });

  const [missionId, setMissionId] = useState(() => getInitialMissionId());
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("hexaspark-theme") || "dark",
  );
  const [showCreateMission, setShowCreateMission] = useState(false);
  const [mission, setMission] = useState(() =>
    getSeedMission(getInitialMissionId()) || null,
  );

  // Auto-restore session from backend on mount or refresh
  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        if (user) {
          setCurrentUser(user);
        } else if (getStoredUser()) {
          clearAuthToken();
          setCurrentUser(null);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("hexaspark-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      let changed = false;
      if (missionId && url.searchParams.get("mission") !== missionId) {
        url.searchParams.set("mission", missionId);
        changed = true;
      }
      if (!showHomepage && activePage && activePage !== "overview") {
        if (url.searchParams.get("page") !== activePage) {
          url.searchParams.set("page", activePage);
          changed = true;
        }
      } else if (showHomepage && url.searchParams.has("page")) {
        url.searchParams.delete("page");
        changed = true;
      }
      if (changed) {
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [missionId, activePage, showHomepage]);

  useEffect(() => {
    let active = true;
    let pollTimer = null;

    const fetchMission = async (isPoll = false) => {
      try {
        const nextMission = await getApiMission(missionId, isPoll);
        if (!active) return;

        const fallbackMission = getSeedMission(missionId) || null;
        const resolvedMission =
          nextMission && !nextMission.hasError ? nextMission : fallbackMission;

        if (!isPoll && nextMission?.backendUnavailable) {
          setToast({
            message: "Backend unavailable. Showing local mission data.",
            type: "error",
          });
        }

        setMission(resolvedMission || fallbackMission);

        // If the mission is actively processing or queued, poll every 2.5s
        if (resolvedMission?.status === "processing" || resolvedMission?.status === "queued") {
          pollTimer = setTimeout(() => {
            if (active) fetchMission(true);
          }, 2500);
        }
      } catch (err) {
        console.warn("[App] Error syncing mission:", err);
      }
    };

    fetchMission(false);

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [missionId]);

  const notice = (message, type = "success") => setToast({ message, type });

  const navigate = (id) => {
    if (id === "auth") {
      setActivePage("auth");
      return;
    }
    setActivePage(id);
    if (id !== "overview" && id !== "profile") {
      notice(`${pageTitles[id] || id} opened`, "info");
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    setCurrentUser(null);
    setShowHomepage(true);
    setActivePage("overview");
    notice("Logged out successfully. Session revoked.", "info");
  };

  const handleMissionCreated = (newMissionId) => {
    setMissionId(newMissionId);
    setActivePage("pipeline");
    setShowCreateMission(false);
    notice("Pipeline initiated! Streaming 8-stage progress...", "success");
  };

  const handleStartMission = () => {
    setShowHomepage(false);
    setShowCreateMission(true);
  };

  const handleNavigateDashboard = (targetPage = "overview") => {
    setShowHomepage(false);
    if (typeof targetPage === "string" && targetPage) {
      setActivePage(targetPage);
    }
  };

  const shared = {
    mission,
    navigate,
    notice,
    setMission: setMissionId,
    onCreateMission: () => {
      setShowCreateMission(true);
    },
  };

  const page =
    activePage === "profile" ? (
      <ProfilePage
        user={currentUser}
        onLogout={handleLogout}
        navigate={navigate}
        notice={notice}
      />
    ) : activePage === "auth" ? (
      <AuthPage
        onAuthenticated={(user) => {
          setCurrentUser(user);
          setActivePage("overview");
        }}
        onCancel={() => setShowHomepage(true)}
        notice={notice}
      />
    ) : activePage === "overview" ? (
      <OverviewPage {...shared} />
    ) : activePage === "missions" ? (
      <MissionsPage {...shared} />
    ) : activePage === "pipeline" || activePage === "processing" ? (
      <ProcessingProgressPage {...shared} />
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
    <div className="hexa-app-root">
      {/* Soft ambient cursor-follow glow layer */}
      <AmbientCursorGlow />

      <AnimatePresence mode="wait">
        {showHomepage ? (
          <motion.div
            key="homepage-view"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <ErrorBoundary
              sectionName="Homepage"
              fallbackTitle="Something went wrong displaying this section"
            >
              <HomePage
                currentUser={currentUser}
                onNavigateDashboard={handleNavigateDashboard}
                onStartMission={handleStartMission}
                onOpenAuth={() => {
                  setShowHomepage(false);
                  setActivePage("auth");
                }}
              />
            </ErrorBoundary>
          </motion.div>
        ) : activePage === "auth" ? (
          <motion.div
            key="auth-view"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <AuthPage
              onAuthenticated={(user) => {
                setCurrentUser(user);
                if (activePage === "auth") setActivePage("overview");
              }}
              onCancel={() => setShowHomepage(true)}
              notice={notice}
            />
          </motion.div>
        ) : (
          <motion.div
            key="dashboard-view"
            className="app-shell"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <Sidebar
              activePage={activePage}
              navigate={navigate}
              notice={notice}
              mission={mission}
              setMission={setMissionId}
              onCreateMission={() => setShowCreateMission(true)}
              onNavigateHome={() => setShowHomepage(true)}
            />

            <main className="main">
              <Topbar
                title={pageTitles[activePage] || "Tactical Command"}
                theme={theme}
                setTheme={setTheme}
                notice={notice}
                mission={mission}
                onOpenMissions={() => navigate("missions")}
                currentUser={currentUser}
                onOpenProfile={() => navigate("profile")}
                onOpenAuth={() => setActivePage("auth")}
              />

              <div className="content">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activePage}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <ErrorBoundary
                      key={`${activePage}-${mission?.id || missionId}`}
                      sectionName={pageTitles[activePage] || activePage}
                      fallbackTitle="Something went wrong displaying this section"
                    >
                      {page}
                    </ErrorBoundary>
                  </motion.div>
                </AnimatePresence>
              </div>
            </main>
          </motion.div>
        )}
      </AnimatePresence>

      {showCreateMission && (
        <CreateMissionModal
          onClose={() => setShowCreateMission(false)}
          onMissionCreated={handleMissionCreated}
          currentUser={currentUser}
          notice={notice}
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
