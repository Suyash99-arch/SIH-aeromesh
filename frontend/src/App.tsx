import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/layout/Shell.tsx';
import { MissionCommandPage } from './pages/MissionCommand/MissionCommandPage.tsx';
import { ReconstructionPage } from './pages/Reconstruction/ReconstructionPage.tsx';
import { SceneIntelligencePage } from './pages/SceneIntelligence/SceneIntelligencePage.tsx';
import { GeospatialPage } from './pages/Geospatial/GeospatialPage.tsx';
import { MeasurementsPage } from './pages/Measurements/MeasurementsPage.tsx';
import { AIFindingsPage } from './pages/AIFindings/AIFindingsPage.tsx';
import './styles/theme.css';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Shell />}>
          <Route index element={<MissionCommandPage />} />
          <Route path="reconstruction" element={<ReconstructionPage />} />
          <Route path="scene-intelligence" element={<SceneIntelligencePage />} />
          <Route path="geospatial" element={<GeospatialPage />} />
          <Route path="measurements" element={<MeasurementsPage />} />
          <Route path="findings" element={<AIFindingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
