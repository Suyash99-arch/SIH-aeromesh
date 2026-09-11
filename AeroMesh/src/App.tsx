import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { IncidentProvider, useIncident } from './context/IncidentContext';
import { Navbar } from './components/Navbar';
import { HomePage } from './pages/HomePage';
import { AboutPage } from './pages/AboutPage';
import { NewAnalysisPage } from './pages/NewAnalysisPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { ProfilePage } from './pages/ProfilePage';
import { AnalysisReportPage } from './pages/AnalysisReportPage';
import { AnalysisReportModal } from './components/AnalysisReportModal';

function AppContent() {
  const { isReportModalOpen, reportIncident, closeReport } = useIncident();

  return (
    <div className="min-h-screen bg-[#050811] text-slate-100 flex flex-col font-sans">
      <Navbar />
      <div className="flex-1 flex flex-col">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/new-analysis" element={<NewAnalysisPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/report" element={<AnalysisReportPage />} />
          <Route path="/report/:id" element={<AnalysisReportPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/analysis/:id" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {/* Global Analysis Report Modal */}
      <AnalysisReportModal
        isOpen={isReportModalOpen}
        incident={reportIncident}
        onClose={closeReport}
      />
    </div>
  );
}

export function App() {
  return (
    <IncidentProvider>
      <Router>
        <AppContent />
      </Router>
    </IncidentProvider>
  );
}

export default App;
