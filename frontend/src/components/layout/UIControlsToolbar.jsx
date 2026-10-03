import React from "react";
import { useUI } from "../../context/UIContext";
import { LANGUAGES, UNITS } from "../../utils/i18n";

export default function UIControlsToolbar({ className = "" }) {
  const { language, setLanguage, unitSystem, setUnitSystem, theme, toggleTheme, t } = useUI();

  return (
    <div
      className={`ui-controls-toolbar ${className}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "4px 8px",
        backdropFilter: "blur(12px)",
      }}
      role="region"
      aria-label="Interface Controls"
    >
      {/* Language Selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <label htmlFor="lang-select" className="sr-only" style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0,0,0,0)", border: 0 }}>
          {t("language")}
        </label>
        <select
          id="lang-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          aria-label={t("language")}
          style={{
            background: "rgba(0, 0, 0, 0.2)",
            color: "var(--mist)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "4px 8px",
            fontSize: "12px",
            fontWeight: "500",
            cursor: "pointer",
            outline: "none",
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} style={{ background: "var(--void)", color: "var(--mist)" }}>
              {l.flag} {l.name}
            </option>
          ))}
        </select>
      </div>

      {/* Unit System Selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <label htmlFor="unit-select" className="sr-only" style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0,0,0,0)", border: 0 }}>
          {t("unitSystem")}
        </label>
        <select
          id="unit-select"
          value={unitSystem}
          onChange={(e) => setUnitSystem(e.target.value)}
          aria-label={t("unitSystem")}
          style={{
            background: "rgba(0, 0, 0, 0.2)",
            color: "var(--mist)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "4px 8px",
            fontSize: "12px",
            fontWeight: "500",
            cursor: "pointer",
            outline: "none",
          }}
        >
          {UNITS.map((u) => (
            <option key={u.id} value={u.id} style={{ background: "var(--void)", color: "var(--mist)" }}>
              {u.label}
            </option>
          ))}
        </select>
      </div>

      {/* Theme Toggle Button */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? t("lightMode") : t("darkMode")}
        title={theme === "dark" ? t("lightMode") : t("darkMode")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 0, 0, 0.2)",
          color: "var(--cyan)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 8px",
          fontSize: "13px",
          fontWeight: "600",
          cursor: "pointer",
          transition: "all 0.2s ease",
        }}
      >
        {theme === "dark" ? `🌙 ${t("darkMode")}` : `☀️ ${t("lightMode")}`}
      </button>
    </div>
  );
}
