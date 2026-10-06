import { useState, useEffect } from "react";
import AuthModal from "../auth/AuthModal";
import { API_BASE, getAuthHeaders, getStoredUser, fetchCurrentUser } from "../../api/missions";
import UIControlsToolbar from "./UIControlsToolbar";
import { useUI } from "../../context/UIContext";

/** Poll /api/v1/health every 30s; returns { ok, label } */
function useHealthStatus(language) {
  const [health, setHealth] = useState({ ok: null, label: "…" });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, {
          method: "GET",
          headers: getAuthHeaders(),
        });
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          const isHealthy = json?.status === "healthy" || json?.ok === true || json?.backend === "ready";
          const label = language === "hi"
            ? (isHealthy ? "सिस्टम सक्रिय" : "सिस्टम बाधित")
            : (isHealthy ? "SYSTEMS OPERATIONAL" : `SYSTEMS ${json?.status?.toUpperCase() || "DEGRADED"}`);
          setHealth({ ok: isHealthy, label });
        } else {
          setHealth({ ok: false, label: language === "hi" ? `बैकएंड त्रुटि ${res.status}` : `BACKEND ${res.status}` });
        }
      } catch {
        if (!cancelled) setHealth({ ok: false, label: language === "hi" ? "बैकएंड अनुपलब्ध" : "BACKEND UNREACHABLE" });
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [language]);

  return health;
}

export default function Topbar({
  title,
  notice,
  mission,
  onOpenMissions,
  currentUser,
  onOpenProfile,
  onOpenAuth,
}) {
  const { t, language } = useUI();
  const health = useHealthStatus(language);

  const isGuest = Boolean(currentUser?.is_guest || currentUser?.portal_type === "GUEST" || currentUser?.role === "GUEST");

  const getRoleBadgeStyle = (role) => {
    if (isGuest || role === "GUEST") {
      return { background: "rgba(251, 191, 36, 0.2)", color: "#fbbf24", border: "1px solid rgba(251, 191, 36, 0.4)" };
    }
    switch (role) {
      case "ADMIN":
        return { background: "rgba(168, 85, 247, 0.2)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.4)" };
      case "ANALYST":
        return { background: "rgba(14, 165, 233, 0.2)", color: "#38bdf8", border: "1px solid rgba(14, 165, 233, 0.4)" };
      default:
        return { background: "rgba(34, 197, 94, 0.2)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.4)" };
    }
  };

  // Derive initials from full_name only; never fall back to fake names
  const initials = isGuest
    ? "G"
    : currentUser?.full_name
    ? currentUser.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : currentUser?.email
    ? currentUser.email.slice(0, 2).toUpperCase()
    : "?";

  const displayName = isGuest
    ? "Guest"
    : (currentUser?.full_name || currentUser?.email || t("auth.login"));
  const displayRole = isGuest ? "GUEST" : (currentUser?.role || "");

  const handleOperatorClick = () => {
    if (currentUser) {
      if (onOpenProfile) onOpenProfile();
    } else {
      if (onOpenAuth) onOpenAuth();
    }
  };

  const healthColor = health.ok === true ? "#4ade80" : health.ok === false ? "#f87171" : "#fbbf24";

  return (
    <header className="topbar">
      <div className="crumbs">
        <span style={{ cursor: "pointer" }} onClick={onOpenMissions} title={t("dashboard.allMissions")}>
          {t("nav.dashboard")}
        </span>
        <i>/</i>
        <button
          type="button"
          onClick={onOpenMissions}
          title={t("selector.title")}
          style={{
            background: "transparent", border: "none", color: "var(--color-primary-400, #38bdf8)",
            cursor: "pointer", fontWeight: 600, padding: 0, font: "inherit",
            display: "inline-flex", alignItems: "center", gap: "6px",
          }}
        >
          <span>{mission?.name || t("nav.activeMission")}</span>
          {mission?.status === "processing" && (
            <span style={{
              fontSize: "0.65rem", padding: "1px 5px",
              background: "rgba(14, 165, 233, 0.25)", border: "1px solid rgba(14, 165, 233, 0.5)",
              color: "#38bdf8", borderRadius: "3px",
            }}>
              {t("stages.PROCESSING")} {mission.progress ? `${mission.progress}%` : ""}
            </span>
          )}
        </button>
        <i>/</i>
        <strong>{title}</strong>
      </div>

      <div className="top-actions" style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <UIControlsToolbar />

        {/* Health badge — driven by /api/v1/health, never hardcoded */}
        <span
          className="systems"
          title={`Backend health: ${health.label}`}
          style={{ color: healthColor, display: "flex", alignItems: "center", gap: "5px" }}
        >
          <i
            style={{
              width: "7px", height: "7px", borderRadius: "50%",
              background: healthColor, display: "inline-block", flexShrink: 0,
            }}
          />
          {health.label}
        </span>

        <button
          id="topbar-operator-btn"
          className="operator"
          onClick={handleOperatorClick}
          type="button"
          title={currentUser ? "Click to view profile and session" : "Click to log in"}
          style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
        >
          <span className="operator-avatar">{initials}</span>
          <span className="operator-name">{displayName}</span>
          {currentUser ? (
            displayRole ? (
              <span style={{
                ...getRoleBadgeStyle(displayRole),
                fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px",
                borderRadius: "4px", marginLeft: "4px", textTransform: "uppercase", letterSpacing: "0.04em",
              }}>
                {displayRole}
              </span>
            ) : null
          ) : (
            <span style={{
              background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px",
              borderRadius: "4px", marginLeft: "4px",
            }}>
              {t("auth.login")}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
