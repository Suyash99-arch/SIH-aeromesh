import { useState, useEffect } from "react";
import AuthModal from "../auth/AuthModal";
import { getStoredUser, fetchCurrentUser } from "../../api/missions";

export default function Topbar({
  title,
  notice,
  mission,
  onOpenMissions,
  currentUser,
  onOpenProfile,
  onOpenAuth,
}) {
  const getRoleBadgeStyle = (role) => {
    switch (role) {
      case "ADMIN":
        return { background: "rgba(168, 85, 247, 0.2)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.4)" };
      case "ANALYST":
        return { background: "rgba(14, 165, 233, 0.2)", color: "#38bdf8", border: "1px solid rgba(14, 165, 233, 0.4)" };
      default:
        return { background: "rgba(34, 197, 94, 0.2)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.4)" };
    }
  };

  const initials = currentUser?.full_name
    ? currentUser.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "AM";

  const handleOperatorClick = () => {
    if (currentUser) {
      if (onOpenProfile) onOpenProfile();
    } else {
      if (onOpenAuth) onOpenAuth();
    }
  };

  return (
    <header className="topbar">
      <div className="crumbs">
        <span style={{ cursor: "pointer" }} onClick={onOpenMissions} title="View all missions">
          Mission Control
        </span>
        <i>/</i>
        <button
          type="button"
          onClick={onOpenMissions}
          title="Click to switch active mission"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-primary-400, #38bdf8)",
            cursor: "pointer",
            fontWeight: 600,
            padding: 0,
            font: "inherit",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>{mission?.name || "Active Mission"}</span>
          {mission?.status === "processing" && (
            <span
              style={{
                fontSize: "0.65rem",
                padding: "1px 5px",
                background: "rgba(14, 165, 233, 0.25)",
                border: "1px solid rgba(14, 165, 233, 0.5)",
                color: "#38bdf8",
                borderRadius: "3px",
              }}
            >
              PROCESSING {mission.progress ? `${mission.progress}%` : ""}
            </span>
          )}
        </button>
        <i>/</i>
        <strong>{title}</strong>
      </div>

      <div className="top-actions">
        <span className="systems">
          <i /> ALL SYSTEMS OPERATIONAL
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
          <span className="operator-name">{currentUser?.full_name || "Sign In"}</span>
          {currentUser?.role ? (
            <span style={{
              ...getRoleBadgeStyle(currentUser.role),
              fontSize: "0.68rem",
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: "4px",
              marginLeft: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}>
              {currentUser.role}
            </span>
          ) : (
            <span style={{
              background: "rgba(56, 189, 248, 0.15)",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              fontSize: "0.68rem",
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: "4px",
              marginLeft: "4px",
            }}>
              LOGIN
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
