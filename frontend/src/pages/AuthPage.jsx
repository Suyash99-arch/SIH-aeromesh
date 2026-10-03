import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  loginUser,
  registerUser,
  loginGuest,
  fetchDemoUsers,
} from "../api/missions";

export default function AuthPage({ onAuthenticated, onCancel, notice, initialPortal = "gov" }) {
  // Portals: "gov" (Government/Organization) | "indiv" (Individual)
  const [portal, setPortal] = useState(initialPortal);
  const [mode, setMode] = useState("login"); // "login" | "register"

  // Credentials
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);

  // Government / Org registration fields
  const [orgName, setOrgName] = useState("");
  const [department, setDepartment] = useState("");
  const [orgRole, setOrgRole] = useState("ADMIN");
  const [enableMfa, setEnableMfa] = useState(false);

  // Individual registration fields
  const [fullName, setFullName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
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
      setError("Please provide both email and password.");
      return;
    }
    setLoading(true);
    setError(null);

    const portalType = portal === "gov" ? "GOVERNMENT_ORG" : "INDIVIDUAL";
    const res = await loginUser(email, password, portalType, mfaCode || null);
    setLoading(false);

    if (res.mfa_required) {
      setMfaRequired(true);
      setError("Two-Factor Authentication required. Please enter your 6-digit OTP.");
      return;
    }

    if (res.success) {
      if (notice) notice(`Authenticated as ${res.user.full_name} (${res.user.role})`, "success");
      onAuthenticated(res.user);
    } else {
      setError(res.error || "Authentication failed. Please verify your credentials.");
    }
  };

  const handleRegisterSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (portal === "gov" && !orgName.trim()) {
      setError("Organization Name is required for Government / Organization registration.");
      return;
    }

    setLoading(true);
    setError(null);

    const payload = {
      email: email.trim().toLowerCase(),
      password,
      full_name: fullName.trim() || email.split("@")[0].replace(".", " ").toUpperCase(),
      portal_type: portal === "gov" ? "GOVERNMENT_ORG" : "INDIVIDUAL",
      organization_name: portal === "gov" ? orgName.trim() : null,
      department: portal === "gov" ? department.trim() : null,
      role: portal === "gov" ? orgRole : "OPERATOR",
      mfa_enabled: portal === "gov" ? enableMfa : false,
    };

    const res = await registerUser(payload);
    setLoading(false);

    if (res.success) {
      if (notice) notice(`Workspace initialized for ${res.user.full_name}!`, "success");
      onAuthenticated(res.user);
    } else {
      setError(res.error || "Registration failed. Please check your information.");
    }
  };

  const handleGuestEntry = async () => {
    setGuestLoading(true);
    setError(null);
    const res = await loginGuest();
    setGuestLoading(false);
    if (res.success) {
      if (notice) notice("Guest evaluation workspace active (2-hour session).", "info");
      onAuthenticated(res.user);
    } else {
      setError(res.error || "Could not launch guest sandbox.");
    }
  };

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

  const handleGoogleOAuth = async (idToken) => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok && data.success) {
        if (data.access_token) {
          localStorage.setItem("aeromesh_auth_token", data.access_token);
        }
        if (notice) notice("Signed in via Google Workspace.", "success");
        onAuthenticated(data.user);
      } else {
        setError(data.detail || "Google authentication failed.");
      }
    } catch (err) {
      setLoading(false);
      setError(err.message || "Failed to reach authentication server.");
    }
  };

  const fillDemoCredentials = (user) => {
    setEmail(user.email);
    setPassword(user.demo_password || "");
    if (user.portal_type === "GOVERNMENT_ORG") {
      setPortal("gov");
    } else {
      setPortal("indiv");
    }
    setMode("login");
    setMfaRequired(false);
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
        background: "radial-gradient(ellipse at 50% 15%, rgba(14, 165, 233, 0.12) 0%, rgba(9, 11, 19, 0.96) 65%, #030712 100%)",
        padding: "24px 16px",
        overflow: "hidden",
      }}
    >
      {/* Background ambient orbs */}
      <div
        style={{
          position: "absolute",
          width: "600px",
          height: "600px",
          borderRadius: "50%",
          background: portal === "gov"
            ? "radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, rgba(99, 102, 241, 0.08) 50%, transparent 70%)"
            : "radial-gradient(circle, rgba(168, 85, 247, 0.15) 0%, rgba(56, 189, 248, 0.08) 50%, transparent 70%)",
          filter: "blur(60px)",
          pointerEvents: "none",
          transition: "background 0.5s ease",
        }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: "520px",
          background: "rgba(15, 23, 42, 0.82)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          border: portal === "gov" ? "1px solid rgba(14, 165, 233, 0.35)" : "1px solid rgba(168, 85, 247, 0.35)",
          boxShadow: portal === "gov"
            ? "0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 40px rgba(14, 165, 233, 0.16)"
            : "0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 40px rgba(168, 85, 247, 0.16)",
          borderRadius: "20px",
          padding: "36px 32px",
          color: "#f8fafc",
          transition: "border 0.3s ease, box-shadow 0.3s ease",
        }}
      >
        {/* Top Header / Portal Selector */}
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "4px 14px",
              borderRadius: "20px",
              background: portal === "gov" ? "rgba(14, 165, 233, 0.12)" : "rgba(168, 85, 247, 0.12)",
              border: portal === "gov" ? "1px solid rgba(14, 165, 233, 0.4)" : "1px solid rgba(168, 85, 247, 0.4)",
              color: portal === "gov" ? "#38bdf8" : "#c084fc",
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: "10px",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: portal === "gov" ? "#38bdf8" : "#c084fc",
                boxShadow: portal === "gov" ? "0 0 8px #38bdf8" : "0 0 8px #c084fc",
              }}
            />
            {portal === "gov" ? "DEFENCE & ENTERPRISE GATEWAY" : "CIVILIAN & INDIVIDUAL PORTAL"}
          </div>

          <h1
            style={{
              margin: "0 0 6px",
              fontSize: "1.7rem",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              background: "linear-gradient(135deg, #ffffff 40%, #94a3b8 80%, #38bdf8 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {portal === "gov" ? "Government & Org Portal" : "Individual Creator Portal"}
          </h1>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#94a3b8" }}>
            {portal === "gov"
              ? "Multi-tenant sovereign workspace with role-based access & team auditing"
              : "Personal 3D drone reconstruction workspace & spatial analysis"}
          </p>
        </div>

        {/* Dual Portal Switcher Tabs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "6px",
            padding: "5px",
            background: "rgba(10, 15, 29, 0.8)",
            borderRadius: "12px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            marginBottom: "20px",
          }}
        >
          <button
            type="button"
            onClick={() => { setPortal("gov"); setError(null); setMfaRequired(false); }}
            style={{
              padding: "10px 12px",
              border: "none",
              borderRadius: "8px",
              font: "inherit",
              fontSize: "0.85rem",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s ease",
              background: portal === "gov" ? "rgba(14, 165, 233, 0.22)" : "transparent",
              color: portal === "gov" ? "#38bdf8" : "#94a3b8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: portal === "gov" ? "0 0 16px rgba(14, 165, 233, 0.25)" : "none",
            }}
          >
            <span>🏛️</span>
            <span>Government / Org</span>
          </button>
          <button
            type="button"
            onClick={() => { setPortal("indiv"); setError(null); setMfaRequired(false); }}
            style={{
              padding: "10px 12px",
              border: "none",
              borderRadius: "8px",
              font: "inherit",
              fontSize: "0.85rem",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s ease",
              background: portal === "indiv" ? "rgba(168, 85, 247, 0.22)" : "transparent",
              color: portal === "indiv" ? "#c084fc" : "#94a3b8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: portal === "indiv" ? "0 0 16px rgba(168, 85, 247, 0.25)" : "none",
            }}
          >
            <span>👤</span>
            <span>Individual Portal</span>
          </button>
        </div>

        {/* Sub-mode Switcher: Sign In vs Sign Up */}
        <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginBottom: "18px", fontSize: "0.85rem" }}>
          <button
            type="button"
            onClick={() => { setMode("login"); setError(null); }}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              color: mode === "login" ? "#ffffff" : "#64748b",
              fontWeight: mode === "login" ? 700 : 500,
              borderBottom: mode === "login" ? `2px solid ${portal === "gov" ? "#38bdf8" : "#c084fc"}` : "2px solid transparent",
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode("register"); setError(null); }}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              color: mode === "register" ? "#ffffff" : "#64748b",
              fontWeight: mode === "register" ? 700 : 500,
              borderBottom: mode === "register" ? `2px solid ${portal === "gov" ? "#38bdf8" : "#c084fc"}` : "2px solid transparent",
            }}
          >
            {portal === "gov" ? "Register Organization" : "Create Account"}
          </button>
        </div>

        {/* Error Alert Box */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                borderRadius: "8px",
                padding: "10px 14px",
                marginBottom: "16px",
                color: "#fca5a5",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>⚠️</span>
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form Container */}
        {mode === "login" ? (
          <form onSubmit={handleLoginSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}>
                Official Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={portal === "gov" ? "officer@defence.gov.internal" : "pilot@aerialstudio.io"}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "rgba(10, 15, 29, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "0.9rem",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  style={{
                    width: "100%",
                    padding: "10px 42px 10px 14px",
                    background: "rgba(10, 15, 29, 0.6)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "8px",
                    color: "#ffffff",
                    fontSize: "0.9rem",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "0.8rem",
                  }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Optional / Required MFA Field */}
            {(mfaRequired || portal === "gov") && (
              <div>
                <label style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}>
                  <span>Two-Factor Code (MFA / OTP)</span>
                  <span style={{ fontSize: "0.75rem", color: "#38bdf8" }}>{mfaRequired ? "Required" : "Optional"}</span>
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="6-digit security code (e.g. 123456)"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "rgba(10, 15, 29, 0.6)",
                    border: mfaRequired ? "1px solid rgba(56, 189, 248, 0.6)" : "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "8px",
                    color: "#ffffff",
                    fontSize: "0.9rem",
                    outline: "none",
                    boxSizing: "border-box",
                    letterSpacing: "0.15em",
                  }}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: "6px",
                padding: "12px",
                borderRadius: "8px",
                border: "none",
                background: portal === "gov"
                  ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                  : "linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "0.9rem",
                cursor: loading ? "wait" : "pointer",
                boxShadow: portal === "gov"
                  ? "0 4px 14px rgba(14, 165, 233, 0.35)"
                  : "0 4px 14px rgba(168, 85, 247, 0.35)",
                transition: "opacity 0.2s ease",
                opacity: loading ? 0.75 : 1,
              }}
            >
              {loading ? "Authenticating..." : portal === "gov" ? "Authorize & Enter Command" : "Enter Personal Workspace"}
            </button>

            {portal === "indiv" && Boolean(googleClientId) && (
              <button
                type="button"
                id="btn-google-oauth"
                onClick={() => {
                  if (window.google?.accounts?.id) {
                    window.google.accounts.id.prompt();
                  } else {
                    setError("Google Identity Services script is not initialized.");
                  }
                }}
                disabled={loading}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.18)",
                  background: "rgba(255, 255, 255, 0.05)",
                  color: "#f8fafc",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                <span>🌐</span>
                <span>Continue with Google</span>
              </button>
            )}
          </form>
        ) : (
          /* Registration Form */
          <form onSubmit={handleRegisterSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {portal === "gov" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                      Organization Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Ministry of Defence"
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        background: "rgba(10, 15, 29, 0.6)",
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        borderRadius: "8px",
                        color: "#ffffff",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                      Department
                    </label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="Air Surveillance Cell"
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        background: "rgba(10, 15, 29, 0.6)",
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        borderRadius: "8px",
                        color: "#ffffff",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                    Your Role within Organization
                  </label>
                  <select
                    value={orgRole}
                    onChange={(e) => setOrgRole(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "rgba(10, 15, 29, 0.8)",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "8px",
                      color: "#ffffff",
                      fontSize: "0.85rem",
                    }}
                  >
                    <option value="ADMIN">Organization Administrator (Full Access + Invites)</option>
                    <option value="ANALYST">Mission Analyst (Reconstruction + Measurements + Reports)</option>
                    <option value="VIEWER">Mission Viewer (Read-only Inspection)</option>
                  </select>
                </div>
              </>
            )}

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Dr. Rajesh Kumar"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  background: "rgba(10, 15, 29, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "0.85rem",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                Official Email *
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="rajesh.kumar@agency.gov"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  background: "rgba(10, 15, 29, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "0.85rem",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                  Password *
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 chars"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: "rgba(10, 15, 29, 0.6)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "8px",
                    color: "#ffffff",
                    fontSize: "0.85rem",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                  Confirm *
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: "rgba(10, 15, 29, 0.6)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "8px",
                    color: "#ffffff",
                    fontSize: "0.85rem",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            {portal === "gov" && (
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8rem", color: "#94a3b8", cursor: "pointer", marginTop: "2px" }}>
                <input
                  type="checkbox"
                  checked={enableMfa}
                  onChange={(e) => setEnableMfa(e.target.checked)}
                />
                <span>Enforce mandatory Two-Factor OTP verification for this account</span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: "6px",
                padding: "12px",
                borderRadius: "8px",
                border: "none",
                background: portal === "gov"
                  ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                  : "linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "0.9rem",
                cursor: loading ? "wait" : "pointer",
                boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",
              }}
            >
              {loading ? "Registering Account..." : portal === "gov" ? "Register Organization Workspace" : "Create Personal Account"}
            </button>
          </form>
        )}

        {/* Separator */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "20px 0 16px" }}>
          <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)" }} />
          <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>OR</span>
          <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)" }} />
        </div>

        {/* Ephemeral Guest Mode Banner */}
        <div
          style={{
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px dashed rgba(16, 185, 129, 0.4)",
            borderRadius: "12px",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", fontWeight: 700, color: "#10b981" }}>
              <span>⚡</span>
              <span>Instant Guest Evaluation Mode</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "2px" }}>
              Session-scoped temporary workspace · 2-hour TTL · No signup needed
            </div>
          </div>
          <button
            type="button"
            onClick={handleGuestEntry}
            disabled={guestLoading}
            style={{
              background: "rgba(16, 185, 129, 0.2)",
              border: "1px solid rgba(16, 185, 129, 0.5)",
              color: "#34d399",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: guestLoading ? "wait" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {guestLoading ? "Starting..." : "Try It Now →"}
          </button>
        </div>

        {/* Demo Fast-Fill Section for Evaluators */}
        {demoUsers.length > 0 && (
          <div style={{ marginTop: "20px" }}>
            <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "8px", textAlign: "center" }}>
              Quick Evaluation Credentials:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center" }}>
              {demoUsers.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => fillDemoCredentials(u)}
                  style={{
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "6px",
                    padding: "4px 10px",
                    fontSize: "0.72rem",
                    color: "#94a3b8",
                    cursor: "pointer",
                  }}
                  title={u.description}
                >
                  {u.role}: {u.email.split("@")[0]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Back / Cancel button */}
        {onCancel && (
          <div style={{ textAlign: "center", marginTop: "16px" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "none",
                border: "none",
                color: "#64748b",
                fontSize: "0.8rem",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              ← Back to Home
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
