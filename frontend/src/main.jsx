import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./App.css";
import ErrorBoundary from "./components/common/ErrorBoundary";
import { UIProvider } from "./context/UIContext";

ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <React.StrictMode>
    <ErrorBoundary sectionName="Application Shell" level="top">
      <UIProvider>
        <App />
      </UIProvider>
    </ErrorBoundary>
  </React.StrictMode>
);