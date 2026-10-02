import React, { createContext, useContext, useState, useEffect } from "react";
import { TRANSLATIONS, formatDistance, formatArea, formatDateTime } from "../utils/i18n";

const UIContext = createContext();

export function UIProvider({ children }) {
  const [language, setLanguage] = useState(() => localStorage.getItem("hexaspark_lang") || "en");
  const [unitSystem, setUnitSystem] = useState(() => localStorage.getItem("hexaspark_units") || "metric");
  const [theme, setTheme] = useState(() => localStorage.getItem("hexaspark_theme") || "dark");

  useEffect(() => {
    localStorage.setItem("hexaspark_lang", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("hexaspark_units", unitSystem);
  }, [unitSystem]);

  useEffect(() => {
    localStorage.setItem("hexaspark_theme", theme);
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

  const t = (key) => {
    const dict = TRANSLATIONS[language] || TRANSLATIONS.en;
    return dict[key] || TRANSLATIONS.en[key] || key;
  };

  const fmtDist = (meters) => formatDistance(meters, unitSystem, language);
  const fmtArea = (sqMeters) => formatArea(sqMeters, unitSystem, language);
  const fmtDate = (isoString) => formatDateTime(isoString, language);

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
