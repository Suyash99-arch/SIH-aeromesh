import { lazy, Suspense, useEffect, useState } from "react";
import "./styles/theme.css";
const Sidebar = lazy(() => import("./components/layout/Sidebar"));
const Topbar = lazy(() => import("./components/layout/Topbar"));
const CreateMissionModal = lazy(() => import("./components/missions/CreateMissionModal"));
const startsOnHome = typeof window !== "undefined" && !new URLSearchParams(window.location.search).has("page") && !new URLSearchParams(window.location.search).has("mission");
const homePageImport = startsOnHome ? import("./pages/HomePage") : null;
const HomePage = lazy(() => homePageImport || import("./pages/HomePage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
import { pageTitles } from "./data/navigation";
import {
  getMission as getApiMission,
  getStoredUser,
  fetchCurrentUser,
  clearAuthToken,
  listMissions,
  markAuthInitializationComplete,
} from "./api/missions";
const loadNamedPage = (name) => () => import("./pages/Pages").then((module) => ({ default: module[name] }));
const OverviewPage = lazy(loadNamedPage("OverviewPage"));
const MissionsPage = lazy(loadNamedPage("MissionsPage"));
const DronePage = lazy(loadNamedPage("DronePage"));
const ReconstructionPage = lazy(loadNamedPage("ReconstructionPage"));
const IntelligencePage = lazy(loadNamedPage("IntelligencePage"));
const ChallengePage = lazy(loadNamedPage("ChallengePage"));
const SettingsPage = lazy(loadNamedPage("SettingsPage"));
const ProcessingProgressPage = lazy(() => import("./pages/ProcessingProgressPage"));
import ErrorBoundary from "./components/common/ErrorBoundary";
import { useUI } from "./context/UIContext";

let dashboardStylesPromise;
const loadDashboardStyles = () => {
  dashboardStylesPromise ||= Promise.all([
    import("./App.css"),
    import("./styles/app.css"),
    import("./styles/pages.css"),
    import("./styles/sih.css"),
  ]);
  return dashboardStylesPromise;
};

import AmbientCursorGlow from "./components/layout/AmbientCursorGlow";
const CommandPalette = lazy(() => import("./components/layout/CommandPalette"));

function RouteLoadingSkeleton() {
  const bar = { display: "block", height: 14, borderRadius: 8, background: "var(--color-surface-overlay, rgba(148,163,184,.14))" };
  return (
    <div className="route-loading-skeleton" role="status" aria-label="Loading page" style={{ display: "grid", gap: 16, minHeight: 220, padding: 24, color: "var(--color-text-secondary, #9bb0cc)", background: "var(--color-canvas, #080d16)" }}>
      <span style={{ ...bar, width: "34%" }} />
      <span style={{ ...bar, width: "62%", height: 30 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <span style={{ ...bar, height: 112 }} /><span style={{ ...bar, height: 112 }} /><span style={{ ...bar, height: 112 }} />
      </div>
    </div>
  );
}

function ChunkLoadError({ onRetry }) {
  return <section className="chunk-load-error" role="alert" style={{ minHeight: 220, display: "grid", alignContent: "center", justifyItems: "start", gap: 12, padding: 24, color: "var(--color-text-primary, #e8f0f8)", background: "var(--color-surface, #101a2b)", border: "1px solid var(--color-border-default, rgba(148,163,184,.24))", borderRadius: 14 }}><h2 style={{ margin: 0 }}>This page could not be loaded</h2><p style={{ margin: 0, color: "var(--color-text-secondary, #9bb0cc)" }}>Check your connection, then try again.</p><button type="button" onClick={onRetry} style={{ minHeight: 40, padding: "0 18px", color: "#fff", background: "#075985", border: 0, borderRadius: 8, font: "600 14px var(--font-body, sans-serif)", cursor: "pointer" }}>Retry</button></section>;
}

const getInitialMissionId = () => {
  if (typeof window !== "undefined") {
    const param = new URLSearchParams(window.location.search).get("mission");
    if (param) return param;
  }
  return "";
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => getStoredUser() || null);
  const [authPortal, setAuthPortal] = useState("gov");

  const [showHomepage, setShowHomepage] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const m = params.get("mission");
      const p = params.get("page");
      if (p || m) return false;
    }
    return true;
  });
  const [dashboardStylesReady, setDashboardStylesReady] = useState(false);

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
    () => localStorage.getItem("aeromesh-theme") || "dark",
  );
  const [showCreateMission, setShowCreateMission] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [mission, setMission] = useState(null);
  const { t } = useUI();

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommandPalette((open) => !open);
      } else if (event.key === "Escape") {
        setShowCommandPalette(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const getPageTitle = (pageKey) => {
    const keyMap = {
      overview: "nav.overview",
      missions: "nav.missions",
      history: "nav.missions",
      pipeline: "nav.processing",
      "pipeline-motion": "nav.processing",
      processing: "nav.processing",
      drone: "nav.processing",
      reconstruction: "nav.reconstruction",
      analytics: "nav.sceneIntelligence",
      map: "nav.geospatial",
      reports: "nav.reports",
      profile: "nav.profile",
      settings: "nav.settings",
      auth: "auth.login",
      challenge: "challenge.title",
    };
    const key = keyMap[pageKey] || `nav.${pageKey}`;
    const translated = t(key);
    return (translated && translated !== key) ? translated : (pageTitles[pageKey] || "Mission Command");
  };

  // Synchronize missionId and activePage dynamically from URL
  useEffect(() => {
    const syncFromUrl = () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const m = params.get("mission");
      if (m && m !== missionId) {
        setMissionId(m);
      }
      const p = params.get("page");
      if (p && p !== activePage) {
        setActivePage(p);
        setShowHomepage(false);
      }
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  // If no mission is selected, load user's first available mission from the API
  useEffect(() => {
    if (!missionId) {
      listMissions()
        .then((missions) => {
          if (Array.isArray(missions) && missions.length > 0) {
            setMissionId(missions[0].id);
          }
        })
        .catch(() => {});
    }
  }, [missionId, currentUser]);

  // Auto-restore session from backend on mount or refresh
  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        if (user) {
          setCurrentUser(user);
          if (new URLSearchParams(window.location.search).get("page") === "auth") {
            setShowHomepage(false);
            setActivePage("overview");
          }
        } else if (getStoredUser()) {
          clearAuthToken();
          setCurrentUser(null);
        }
      })
      .catch(() => {})
      .finally(() => markAuthInitializationComplete());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aeromesh-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!showHomepage) {
      loadDashboardStyles()
        .catch((error) => console.error("Dashboard styles failed to load", error))
        .finally(() => setDashboardStylesReady(true));
    }
  }, [showHomepage]);

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
      } else if ((showHomepage || activePage === "overview") && url.searchParams.has("page")) {
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
    let backoffMs = 2000;
    let pollAttempts = 0;
    const maxPollAttempts = 12;

    const fetchMission = async (isPoll = false) => {
      if (!missionId) {
        setMission(null);
        return;
      }
      try {
        const nextMission = await getApiMission(missionId, isPoll);
        if (!active) return;

        if (nextMission && !nextMission.hasError) {
          setMission(nextMission);
        } else if (nextMission?.error === "AUTH_REQUIRED") {
          setMission(nextMission);
          return;
        } else {
          setMission(null);
          // If the mission was not found or forbidden, clear the stale URL param and mission ID
          if (nextMission?.hasError) {
            setMissionId("");
            if (typeof window !== "undefined") {
              const url = new URL(window.location.href);
              url.searchParams.delete("mission");
              window.history.replaceState({}, "", url.toString());
            }
          }
          return; // Stop polling if mission is unavailable / error
        }

        // Only poll if the mission is actively processing or queued
        const isLive = nextMission.status === "processing" || nextMission.status === "queued" || nextMission.status === "running";
        if (isLive && pollAttempts < maxPollAttempts) {
          pollTimer = setTimeout(() => {
            if (active) {
              pollAttempts += 1;
              backoffMs = Math.min(backoffMs * 1.7, 20_000);
              fetchMission(true);
            }
          }, backoffMs);
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

  useEffect(() => {
    const refreshMissionAfterUpload = (event) => {
      const id = event.detail?.id;
      if (!id || id !== missionId) return;
      if (event.detail?.mission && !event.detail.mission.hasError) {
        setMission(event.detail.mission);
        return;
      }
      getApiMission(id, true).then((updated) => {
        if (updated && !updated.hasError) setMission(updated);
      });
    };
    window.addEventListener("aeromesh:mission_updated", refreshMissionAfterUpload);
    return () => window.removeEventListener("aeromesh:mission_updated", refreshMissionAfterUpload);
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

  const handleMissionCreated = (newMissionId, { pipelineStarted = true } = {}) => {
    setMissionId(newMissionId);
    setActivePage("pipeline");
    setShowCreateMission(false);
    notice(pipelineStarted ? t("processing.pipelineStarted") : t("processing.lightweightUploadComplete"), "success");
  };

  const handleStartMission = () => {
    setShowHomepage(false);
    setShowCreateMission(true);
  };

  const handleNavigateDashboard = (targetPage = "overview") => {
    setCurrentUser(getStoredUser());
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
        initialPortal={authPortal}
        onAuthenticated={(user) => {
          setCurrentUser(user);
          setShowHomepage(false);
          setActivePage("overview");
        }}
        onCancel={() => {
          setShowHomepage(true);
          setActivePage("overview");
        }}
        notice={notice}
      />
    ) : activePage === "overview" ? (
      <OverviewPage {...shared} />
    ) : activePage === "missions" || activePage === "history" ? (
      <MissionsPage {...shared} />
    ) : activePage === "pipeline" || activePage === "processing" || activePage === "pipeline-motion" ? (
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

  const handleOpenAuth = (portalType = "gov") => {
    setAuthPortal(portalType);
    setShowHomepage(false);
    setActivePage("auth");
  };

  if (!showHomepage && !dashboardStylesReady) return <RouteLoadingSkeleton />;

  return (
    <div className="aeromesh-app-root">
      {/* Soft ambient cursor-follow glow layer */}
      <AmbientCursorGlow />

      <>
        {showHomepage ? (
          <div
            key="homepage-view"
            className="app-view-transition"
          >
            <ErrorBoundary
              sectionName="Homepage"
              fallback={({ error }) => <ChunkLoadError error={error} onRetry={() => window.location.reload()} />}
            >
              <Suspense fallback={<RouteLoadingSkeleton />}><HomePage
                currentUser={currentUser}
                onNavigateDashboard={handleNavigateDashboard}
                onStartMission={handleStartMission}
                onOpenAuth={handleOpenAuth}
                onOpenCommandPalette={() => setShowCommandPalette(true)}
              /></Suspense>
            </ErrorBoundary>
          </div>
        ) : activePage === "auth" ? (
          <div
            key="auth-view"
            className="app-view-transition"
          >
            <Suspense fallback={<RouteLoadingSkeleton />}><AuthPage
              initialPortal={authPortal}
              onAuthenticated={(user) => {
                setCurrentUser(user);
                setShowHomepage(false);
                setActivePage("overview");
              }}
              onCancel={() => {
                setShowHomepage(true);
                setActivePage("overview");
              }}
              notice={notice}
            /></Suspense>
          </div>
        ) : (
          <div
            key="dashboard-view"
            className="app-shell"
          >
            <Suspense fallback={<div className="sidebar-loading-skeleton" aria-hidden="true" />}><Sidebar
              activePage={activePage}
              navigate={navigate}
              notice={notice}
              mission={mission}
              setMission={setMissionId}
              onCreateMission={() => setShowCreateMission(true)}
              onNavigateHome={() => setShowHomepage(true)}
            /></Suspense>

            <main className="main">
              <Suspense fallback={<div className="topbar-loading-skeleton" aria-hidden="true" />}><Topbar
                title={getPageTitle(activePage)}
                theme={theme}
                setTheme={setTheme}
                notice={notice}
                mission={mission}
                onOpenMissions={() => navigate("missions")}
                currentUser={currentUser}
                onOpenProfile={() => navigate("profile")}
                onOpenAuth={() => setActivePage("auth")}
                onOpenCommandPalette={() => setShowCommandPalette(true)}
              /></Suspense>

              <div className="content">
                <div className="route-view-transition" key={activePage}>
                    <ErrorBoundary
                      key={`${activePage}-${mission?.id || missionId}`}
                      sectionName={pageTitles[activePage] || activePage}
                      fallback={({ error }) => <ChunkLoadError error={error} onRetry={() => window.location.reload()} />}
                    >
                      <Suspense fallback={<RouteLoadingSkeleton />} key={activePage}>
                        {page}
                      </Suspense>
                    </ErrorBoundary>
                </div>
              </div>
            </main>
          </div>
        )}
      </>

      {showCommandPalette && <Suspense fallback={null}><CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onNavigate={handleNavigateDashboard}
        onHome={() => { setShowHomepage(true); setActivePage("overview"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        onWorkflow={() => { setShowHomepage(true); setActivePage("overview"); window.setTimeout(() => document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" }), 80); }}
      /></Suspense>}

      {showCreateMission && (
        <Suspense fallback={<RouteLoadingSkeleton />}><CreateMissionModal
          onClose={() => setShowCreateMission(false)}
          onMissionCreated={handleMissionCreated}
          currentUser={currentUser}
          notice={notice}
        /></Suspense>
      )}

      {toast && (
        <div className={`toast ${toast.type}`} role={toast.type === "error" ? "alert" : "status"} aria-live={toast.type === "error" ? "assertive" : "polite"} aria-atomic="true">
          <span>✓</span>
          {toast.message}
        </div>
      )}
    </div>
  );
}
