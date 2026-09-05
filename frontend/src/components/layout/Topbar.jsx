import React, { useState, useEffect } from "react";
import Icon from "../ui/Icon";
import AuthModal from "../auth/AuthModal";
import { getStoredUser, fetchCurrentUser } from "../../api/missions";

export default function Topbar({ title, notice }) {
  const [currentUser, setCurrentUser] = useState(() => getStoredUser() || {
    id: "usr_admin_001",
    email: "admin@aeromesh.internal",
    full_name: "System Administrator",
    role: "ADMIN",
  });
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (user) setCurrentUser(user);
    });
  }, []);

  const getRoleBadgeStyle = (role) => {
    switch (role) {
      case "ADMIN":
        return { background: "rgba(14, 165, 233, 0.2)", color: "#38bdf8", border: "1px solid rgba(14, 165, 233, 0.4)" };
      case "ANALYST":
        return { background: "rgba(168, 85, 247, 0.2)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.4)" };
      default:
        return { background: "rgba(34, 197, 94, 0.2)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.4)" };
    }
  };

  const initials = currentUser?.full_name
    ? currentUser.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "AM";

  return (
    <header className="topbar">
      <div className="crumbs">
        <span>Mission Control</span>
        <i>/</i>
        <strong>{title}</strong>
      </div>

      <div className="top-actions">
        <span className="systems">
          <i /> ALL SYSTEMS OPERATIONAL
        </span>

        <button
          className="operator"
          onClick={() => setIsAuthOpen(true)}
          type="button"
          title="Click to manage authentication and user roles"
          style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
        >
          <span className="operator-avatar">{initials}</span>
          <span className="operator-name">{currentUser?.full_name || "Sign In"}</span>
          {currentUser?.role && (
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
          )}
        </button>
      </div>

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        currentUser={currentUser}
        onUserChange={(user) => setCurrentUser(user)}
        notice={notice}
      />
    </header>
  );
}
