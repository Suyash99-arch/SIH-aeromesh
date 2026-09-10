import { useState } from "react";
import { motion } from "framer-motion";
import { logoutUser } from "../api/missions";

export default function ProfilePage({ user, onLogout, navigate, notice }) {
  const [loggingOut, setLoggingOut] = useState(false);

  const handleSignOut = () => {
    setLoggingOut(true);
    logoutUser();
    if (notice) notice("Logged out successfully. Session revoked.", "info");
    if (onLogout) onLogout();
  };

  const getRoleBadgeStyle = (role) => {
    switch (role) {
      case "ADMIN":
        return {
          background: "rgba(168, 85, 247, 0.18)",
          color: "#c084fc",
          border: "1px solid rgba(168, 85, 247, 0.4)",
          boxShadow: "0 0 12px rgba(168, 85, 247, 0.2)",
        };
      case "ANALYST":
        return {
          background: "rgba(14, 165, 233, 0.18)",
          color: "#38bdf8",
          border: "1px solid rgba(14, 165, 233, 0.4)",
          boxShadow: "0 0 12px rgba(14, 165, 233, 0.2)",
        };
      default:
        return {
          background: "rgba(34, 197, 94, 0.18)",
          color: "#4ade80",
          border: "1px solid rgba(34, 197, 94, 0.4)",
          boxShadow: "0 0 12px rgba(34, 197, 94, 0.2)",
        };
    }
  };

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "OP";

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", padding: "16px" }}>
      {/* Profile Header Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        style={{
          background: "rgba(15, 23, 42, 0.7)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(56, 189, 248, 0.2)",
          borderRadius: "16px",
          padding: "32px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5), 0 0 25px rgba(56, 189, 248, 0.08)",
          marginBottom: "24px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Glow accent */}
        <div
          style={{
            position: "absolute",
            top: "-80px",
            right: "-80px",
            width: "240px",
            height: "240px",
            background: "radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, transparent 70%)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "24px", flexWrap: "wrap" }}>
          {/* Avatar */}
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #0284c7 0%, #6366f1 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.8rem",
              fontWeight: 800,
              color: "#ffffff",
              boxShadow: "0 0 20px rgba(56, 189, 248, 0.4), inset 0 2px 0 rgba(255,255,255,0.3)",
              border: "2px solid rgba(255, 255, 255, 0.15)",
              flexShrink: 0,
            }}
          >
            {initials}
          </div>

          <div style={{ flex: 1, minWidth: "240px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
              <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#f8fafc" }}>
                {user?.full_name || "Operational User"}
              </h2>
              <span
                style={{
                  ...getRoleBadgeStyle(user?.role || "OPERATOR"),
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "20px",
                  letterSpacing: "0.05em",
                }}
              >
                {user?.role || "OPERATOR"}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.72rem",
                  color: "#4ade80",
                  padding: "3px 8px",
                  background: "rgba(34, 197, 94, 0.1)",
                  borderRadius: "12px",
                  border: "1px solid rgba(34, 197, 94, 0.3)",
                }}
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ade80" }} />
                SESSION ACTIVE
              </span>
            </div>
            <p style={{ margin: "2px 0 0", color: "#94a3b8", fontSize: "0.9rem" }}>
              {user?.email || "No email provided"}
            </p>
            <div style={{ marginTop: "8px", fontSize: "0.75rem", color: "#64748b", fontFamily: "monospace" }}>
              USER ID: {user?.id || "N/A"}
            </div>
          </div>

          {/* Logout Action Button */}
          <button
            id="profile-logout-button"
            type="button"
            onClick={handleSignOut}
            disabled={loggingOut}
            style={{
              padding: "10px 18px",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              borderRadius: "8px",
              color: "#f87171",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.25)";
              e.currentTarget.style.boxShadow = "0 0 15px rgba(239, 68, 68, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <span>⏻</span>
            <span>{loggingOut ? "Signing Out..." : "Sign Out (Logout)"}</span>
          </button>
        </div>
      </motion.div>

      {/* Security & Token Lifecycle Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.05 }}
        style={{
          background: "rgba(15, 23, 42, 0.6)",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "14px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <h3
          style={{
            margin: "0 0 16px",
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "#e2e8f0",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>🛡</span>
          <span>Authentication & Session Architecture</span>
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
          }}
        >
          <div
            style={{
              background: "rgba(10, 15, 29, 0.6)",
              padding: "14px",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
              Session Lifetime
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#38bdf8", marginTop: "4px" }}>
              12 Hours (720 min)
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "#64748b" }}>
              Auto-restored on refresh via secure client token storage.
            </p>
          </div>

          <div
            style={{
              background: "rgba(10, 15, 29, 0.6)",
              padding: "14px",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
              Password Encryption
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#a855f7", marginTop: "4px" }}>
              PBKDF2-HMAC-SHA256
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "#64748b" }}>
              100,000 hash iterations with cryptographically random salt.
            </p>
          </div>

          <div
            style={{
              background: "rgba(10, 15, 29, 0.6)",
              padding: "14px",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
              Password Reset
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0", marginTop: "4px" }}>
              Not Configured
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "#64748b" }}>
              Self-service password reset is disabled on this operational deployment.
            </p>
          </div>

          <div
            style={{
              background: "rgba(10, 15, 29, 0.6)",
              padding: "14px",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
              Mission Scope Mode
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#4ade80", marginTop: "4px" }}>
              Global / Shared
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "#64748b" }}>
              Schema records owner_id on new uploads while keeping history shared.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Navigation Shortcuts */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => navigate("overview")}
          style={{
            padding: "10px 18px",
            background: "rgba(56, 189, 248, 0.12)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            borderRadius: "8px",
            color: "#38bdf8",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ← Return to Mission Command
        </button>
        <button
          type="button"
          onClick={() => navigate("missions")}
          style={{
            padding: "10px 18px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            color: "#e2e8f0",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Browse Mission History
        </button>
      </div>
    </div>
  );
}
