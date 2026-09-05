import React, { useState } from "react";
import { loginUser, clearAuthToken } from "../../api/missions";

export default function AuthModal({ isOpen, onClose, currentUser, onUserChange, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleLogin = async (loginEmail, loginPass) => {
    setLoading(true);
    setError(null);
    const targetEmail = loginEmail || email;
    const targetPass = loginPass || password;

    const res = await loginUser(targetEmail, targetPass);
    setLoading(false);
    if (res.success) {
      onUserChange(res.user);
      if (notice) notice(`Authenticated as ${res.user.full_name} (${res.user.role})`, "success");
      onClose();
    } else {
      setError(res.error || "Authentication failed");
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    onUserChange(null);
    if (notice) notice("Logged out successfully", "info");
    onClose();
  };

  return (
    <div className="modal-backdrop" style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.75)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    }}>
      <div className="auth-modal-content" style={{
        background: "var(--bg-card, #121824)",
        border: "1px solid var(--border-color, #2a3548)",
        borderRadius: "12px",
        width: "90%",
        maxWidth: "480px",
        padding: "24px",
        boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
        color: "#fff",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
              AeroMesh Security & Access Control
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--text-muted, #94a3b8)" }}>
              Phase 10 Production Authentication & RBAC
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "1.4rem",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {currentUser && (
          <div style={{
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "20px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#10b981" }}>
                  Active Session: {currentUser.full_name}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#cbd5e1" }}>
                  {currentUser.email} • Role: <strong style={{ color: "#38bdf8" }}>{currentUser.role}</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  background: "rgba(239, 68, 68, 0.2)",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        )}

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#94a3b8", marginBottom: "8px" }}>
            1-Click Demo Evaluation Profiles
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleLogin("admin@aeromesh.internal", "Admin123!")}
              style={{
                background: "rgba(14, 165, 233, 0.15)",
                border: "1px solid rgba(14, 165, 233, 0.4)",
                color: "#38bdf8",
                borderRadius: "8px",
                padding: "10px 8px",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "0.82rem" }}>ADMIN</div>
              <div style={{ fontSize: "0.68rem", opacity: 0.8 }}>Full Control</div>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleLogin("analyst@aeromesh.internal", "Analyst123!")}
              style={{
                background: "rgba(168, 85, 247, 0.15)",
                border: "1px solid rgba(168, 85, 247, 0.4)",
                color: "#c084fc",
                borderRadius: "8px",
                padding: "10px 8px",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "0.82rem" }}>ANALYST</div>
              <div style={{ fontSize: "0.68rem", opacity: 0.8 }}>GIS & Reports</div>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleLogin("operator@aeromesh.internal", "Operator123!")}
              style={{
                background: "rgba(34, 197, 94, 0.15)",
                border: "1px solid rgba(34, 197, 94, 0.4)",
                color: "#4ade80",
                borderRadius: "8px",
                padding: "10px 8px",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "0.82rem" }}>OPERATOR</div>
              <div style={{ fontSize: "0.68rem", opacity: 0.8 }}>Flight Upload</div>
            </button>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border-color, #2a3548)", paddingTop: "16px", marginTop: "16px" }}>
          <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", color: "#94a3b8", marginBottom: "4px" }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@aeromesh.internal"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "#0b0f19",
                  border: "1px solid #334155",
                  color: "#fff",
                  fontSize: "0.88rem",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", color: "#94a3b8", marginBottom: "4px" }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "#0b0f19",
                  border: "1px solid #334155",
                  color: "#fff",
                  fontSize: "0.88rem",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {error && (
              <div style={{ color: "#ef4444", fontSize: "0.78rem", marginBottom: "12px" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                background: "var(--accent-blue, #2563eb)",
                color: "#fff",
                border: "none",
                fontWeight: 600,
                fontSize: "0.88rem",
                cursor: loading ? "wait" : "pointer",
                opacity: loading || !email || !password ? 0.6 : 1,
              }}
            >
              {loading ? "Authenticating..." : "Sign In with Credentials"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
