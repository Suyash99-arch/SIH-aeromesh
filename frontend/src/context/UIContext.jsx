import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { translate, formatNumber, formatDistance, formatArea, formatDateTime } from "../utils/i18n";

const UIContext = createContext();

export function UIProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem("hexaspark_lang") || localStorage.getItem("aeromesh_lang") || "en";
  });
  const [unitSystem, setUnitSystem] = useState(() => localStorage.getItem("hexaspark_units") || "metric");
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("hexaspark_theme") || localStorage.getItem("aeromesh_theme");
    if (saved) return saved;
    if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  });

  useEffect(() => {
    localStorage.setItem("hexaspark_lang", language);
    localStorage.setItem("aeromesh_lang", language);
    document.documentElement.setAttribute("lang", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("hexaspark_units", unitSystem);
  }, [unitSystem]);

  useEffect(() => {
    localStorage.setItem("hexaspark_theme", theme);
    localStorage.setItem("aeromesh_theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "light") {
      document.documentElement.classList.add("light-theme");
    } else {
      document.documentElement.classList.remove("light-theme");
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const t = useCallback((key, params, fallback) => {
    return translate(key, params, language, fallback);
  }, [language]);

  const fmtNum = useCallback((num, options) => formatNumber(num, language, options), [language]);
  const fmtDist = useCallback((meters) => formatDistance(meters, unitSystem, language), [unitSystem, language]);
  const fmtArea = useCallback((sqMeters) => formatArea(sqMeters, unitSystem, language), [unitSystem, language]);
  const fmtDate = useCallback((isoString) => formatDateTime(isoString, language), [language]);

  return (
    <UIContext.Provider
      value={{
        language,
        setLanguage,
        unitSystem,
        setUnitSystem,
        theme,
        toggleTheme,
        t,
        fmtNum,
        fmtDist,
        fmtArea,
        fmtDate,
      }}
    >
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) {
    throw new Error("useUI must be used within a UIProvider");
  }
  return ctx;
}
