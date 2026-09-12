import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { loginUser, registerUser, fetchDemoUsers, getStoredUser } from "../api/missions";

export default function AuthPage({ onAuthenticated, onCancel, notice }) {
  const [tab, setTab] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  // Register state
  const [regFullName, setRegFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regRole, setRegRole] = useState("OPERATOR");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [demoUsers, setDemoUsers] = useState([]);

  useEffect(() => {
    fetchDemoUsers().then((users) => {
      if (users && users.length) setDemoUsers(users);
    });
  }, []);

  const handleLoginSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await loginUser(email, password);
    setLoading(false);
    if (res.success) {
      if (notice) notice(`Welcome back, ${res.user.full_name}!`, "success");
      onAuthenticated(res.user);
    } else {
      setError(res.error || "Authentication failed. Check your credentials.");
    }
  };

  const handleRegisterSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!regEmail || !regPassword) {
      setError("Email and password are required.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await registerUser(regEmail, regPassword, regFullName, regRole);
    setLoading(false);
    if (res.success) {
      if (notice) notice(`Account created! Welcome, ${res.user.full_name}`, "success");
      onAuthenticated(res.user);
    } else {
      setError(res.error || "Registration failed. Please check your inputs.");
    }
  };

  const fillDemoCredentials = (user) => {
    setEmail(user.email);
    setPassword(user.demo_password || (user.role === "ADMIN" ? "Admin123!" : user.role === "ANALYST" ? "Analyst123!" : "Operator123!"));
    setError(null);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background: "radial-gradient(ellipse at 50% 20%, rgba(30, 27, 75, 0.4) 0%, rgba(9, 11, 19, 0.95) 75%, #05070e 100%)",
        padding: "24px",
        overflow: "hidden",
      }}
    >
      {/* Background glowing rings / aesthetic elements */}
      <div
        style={{
          position: "absolute",
          width: "560px",
          height: "560px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(168, 85, 247, 0.12) 0%, rgba(56, 189, 248, 0.08) 40%, transparent 70%)",
          filter: "blur(40px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: "480px",
          background: "rgba(15, 23, 42, 0.75)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(56, 189, 248, 0.25)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(56, 189, 248, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
          borderRadius: "16px",
          padding: "36px 32px",
          color: "#f8fafc",
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "4px 12px",
              borderRadius: "20px",
              background: "rgba(56, 189, 248, 0.1)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              color: "#38bdf8",
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: "12px",
            }}
          >
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#38bdf8", boxShadow: "0 0 8px #38bdf8" }} />
            AeroMesh Sentinel Auth
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.75rem",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              background: "linear-gradient(135deg, #ffffff 30%, #94a3b8 70%, #38bdf8 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Tactical Operations Access
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "#94a3b8" }}>
            Secure End-to-End JWT Session Management
          </p>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px",
            padding: "4px",
            background: "rgba(10, 15, 29, 0.8)",
            borderRadius: "10px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            marginBottom: "24px",
          }}
        >
          <button
            type="button"
            onClick={() => { setTab("login"); setError(null); }}
            style={{
              padding: "10px",
              border: "none",
              borderRadius: "8px",
              font: "inherit",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              background: tab === "login" ? "rgba(56, 189, 248, 0.2)" : "transparent",
              color: tab === "login" ? "#38bdf8" : "#94a3b8",
              boxShadow: tab === "login" ? "0 0 15px rgba(56, 189, 248, 0.25)" : "none",
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setTab("register"); setError(null); }}
            style={{
              padding: "10px",
              border: "none",
              borderRadius: "8px",
              font: "inherit",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              background: tab === "register" ? "rgba(168, 85, 247, 0.2)" : "transparent",
              color: tab === "register" ? "#c084fc" : "#94a3b8",
              boxShadow: tab === "register" ? "0 0 15px rgba(168, 85, 247, 0.25)" : "none",
            }}
          >
            Create Account
          </button>
        </div>

        {/* Error Alert */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#fca5a5",
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "0.82rem",
                marginBottom: "18px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>⚠</span>
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* LOGIN FORM */}
        {tab === "login" ? (
          <form onSubmit={handleLoginSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  color: "#cbd5e1",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Operator Email
              </label>
              <input
                id="auth-login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@aeromesh.internal"
                required
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  background: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  color: "#f8fafc",
                  fontSize: "0.9rem",
                  boxSizing: "border-box",
                  outline: "none",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#38bdf8";
                  e.target.style.boxShadow = "0 0 12px rgba(56, 189, 248, 0.35)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "rgba(255, 255, 255, 0.12)";
                  e.target.style.boxShadow = "none";
                }}
              />
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    color: "#cbd5e1",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: "0.72rem",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="auth-login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  background: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  color: "#f8fafc",
                  fontSize: "0.9rem",
                  boxSizing: "border-box",
                  outline: "none",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#38bdf8";
                  e.target.style.boxShadow = "0 0 12px rgba(56, 189, 248, 0.35)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "rgba(255, 255, 255, 0.12)";
                  e.target.style.boxShadow = "none";
                }}
              />
            </div>

            <button
              id="auth-login-submit"
              type="submit"
              disabled={loading}
              style={{
                marginTop: "6px",
                padding: "12px",
                background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "0.9rem",
                fontWeight: 700,
                letterSpacing: "0.02em",
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: "0 4px 20px rgba(14, 165, 233, 0.4)",
                transition: "all 0.2s ease",
                opacity: loading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) e.target.style.boxShadow = "0 6px 25px rgba(14, 165, 233, 0.6)";
              }}
              onMouseLeave={(e) => {
                e.target.style.boxShadow = "0 4px 20px rgba(14, 165, 233, 0.4)";
              }}
            >
              {loading ? "Authenticating Session..." : "Authorize & Sign In"}
            </button>

            {/* 1-Click Evaluation Credentials */}
            <div style={{ marginTop: "12px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
                  Quick Fill Demo Credentials
                </span>
                <span style={{ fontSize: "0.68rem", color: "#38bdf8" }}>1-Click Ready</span>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(demoUsers.length ? demoUsers : [
                  { email: "admin@aeromesh.internal", role: "ADMIN", full_name: "Admin" },
                  { email: "analyst@aeromesh.internal", role: "ANALYST", full_name: "Analyst" },
                  { email: "operator@aeromesh.internal", role: "OPERATOR", full_name: "Operator" },
                ]).map((u) => (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => fillDemoCredentials(u)}
                    style={{
                      flex: "1 1 auto",
                      padding: "6px 10px",
                      background: "rgba(255, 255, 255, 0.04)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "6px",
                      color: "#cbd5e1",
                      fontSize: "0.72rem",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "2px",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(56, 189, 248, 0.15)";
                      e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.4)";
                      e.currentTarget.style.color = "#38bdf8";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                      e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
                      e.currentTarget.style.color = "#cbd5e1";
                    }}
                  >
                    <strong>{u.role}</strong>
                    <span style={{ fontSize: "0.65rem", opacity: 0.8 }}>{u.email.split("@")[0]}</span>
                  </button>
                ))}
              </div>
            </div>
          </form>
        ) : (
          /* REGISTER FORM */
          <form onSubmit={handleRegisterSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Full Name / Callsign
              </label>
              <input
                id="auth-register-name"
                type="text"
                value={regFullName}
                onChange={(e) => setRegFullName(e.target.value)}
                placeholder="Capt. J. Miller"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  color: "#f8fafc",
                  fontSize: "0.9rem",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Email Address
              </label>
              <input
                id="auth-register-email"
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder="operator.miller@aeromesh.internal"
                required
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  color: "#f8fafc",
                  fontSize: "0.9rem",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Assigned Operational Role
              </label>
              <select
                id="auth-register-role"
                value={regRole}
                onChange={(e) => setRegRole(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  color: "#f8fafc",
                  fontSize: "0.9rem",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              >
                <option value="OPERATOR">Drone Operator (Flight, Upload, Compute)</option>
                <option value="ANALYST">Mission Analyst (3D Inspection, Metrics, Reports)</option>
                <option value="ADMIN">System Administrator (Full Infrastructure Access)</option>
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Password
                </label>
                <input
                  id="auth-register-password"
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Min 6 chars"
                  required
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "rgba(15, 23, 42, 0.9)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "8px",
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Confirm
                </label>
                <input
                  id="auth-register-confirm-password"
                  type="password"
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                  placeholder="Repeat pass"
                  required
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "rgba(15, 23, 42, 0.9)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "8px",
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
              </div>
            </div>

            <button
              id="auth-register-submit"
              type="submit"
              disabled={loading}
              style={{
                marginTop: "8px",
                padding: "12px",
                background: "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "0.9rem",
                fontWeight: 700,
                letterSpacing: "0.02em",
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: "0 4px 20px rgba(168, 85, 247, 0.4)",
                transition: "all 0.2s ease",
                opacity: loading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) e.target.style.boxShadow = "0 6px 25px rgba(168, 85, 247, 0.6)";
              }}
              onMouseLeave={(e) => {
                e.target.style.boxShadow = "0 4px 20px rgba(168, 85, 247, 0.4)";
              }}
            >
              {loading ? "Registering User..." : "Create Verified Operator Account"}
            </button>
          </form>
        )}

        {/* Security / System Footer Note */}
        <div
          style={{
            marginTop: "22px",
            paddingTop: "14px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            fontSize: "0.72rem",
            color: "#64748b",
            textAlign: "center",
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
            <span>🔒 PBKDF2-HMAC-SHA256 Storage</span>
            <span>⏱ 12-Hour Session Expiry</span>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "none",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                marginTop: "6px",
                textDecoration: "underline",
                fontSize: "0.75rem",
              }}
            >
              Return to Public Platform Overview
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
