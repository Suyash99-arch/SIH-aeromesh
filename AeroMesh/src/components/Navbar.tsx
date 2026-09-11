import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, ChevronDown, FileText, Download, User, Home as HomeIcon, Sparkles } from 'lucide-react';
import { useIncident } from '../context/IncidentContext';

export const Navbar: React.FC = () => {
  const location = useLocation();
  const { incident, openReport, downloadReport } = useIncident();
  const path = location.pathname;

  const isDashboard = path === '/dashboard' || path.startsWith('/analysis');
  const isNewAnalysis = path === '/new-analysis';

  return (
    <header className="sticky top-0 z-50 w-full bg-[#030712]/95 backdrop-blur-md border-b border-[#0f1d38]">
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo (Matching Screenshot 1 & 2) */}
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 group">
            {/* 3D Isometric Faceted Cube Logo */}
            <div className="relative w-8 h-8 flex items-center justify-center">
              <svg className="w-8 h-8 drop-shadow-[0_0_12px_rgba(0,210,255,0.7)]" viewBox="0 0 32 32" fill="none">
                <path d="M16 2L29 9.5V22.5L16 30L3 22.5V9.5L16 2Z" fill="#0c1a38" stroke="#00d2ff" strokeWidth="1.5" />
                <path d="M16 2L29 9.5L16 17L3 9.5L16 2Z" fill="#1e40af" fillOpacity="0.85" />
                <path d="M16 17V30L3 22.5V9.5L16 17Z" fill="#0284c7" fillOpacity="0.9" />
                <path d="M16 17L29 9.5V22.5L16 30V17Z" fill="#0369a1" fillOpacity="0.75" />
                <line x1="16" y1="17" x2="16" y2="30" stroke="#00d2ff" strokeWidth="1.5" />
                <line x1="16" y1="17" x2="29" y2="9.5" stroke="#38bdf8" strokeWidth="1.5" />
                <line x1="16" y1="17" x2="3" y2="9.5" stroke="#38bdf8" strokeWidth="1.5" />
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight text-white font-sans">
              Aero<span className="text-cyan-400 font-extrabold italic">Mesh</span>
            </span>
          </Link>

          {/* Dashboard Left Meta: Incident ID and Status Pill (Screenshot 2) */}
          {isDashboard && (
            <div className="flex items-center gap-3 pl-2">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#081229] border border-[#162a56] text-xs">
                <span className="text-slate-400">Incident ID:</span>
                <span className="text-cyan-400 font-mono font-semibold">{incident.id}</span>
              </div>

              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/50 text-emerald-400 text-xs font-semibold shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#10b981]" />
                <span>{incident.status}</span>
              </div>
            </div>
          )}
        </div>

        {/* Center Navigation Links: Home, About, Profile */}
        {!isDashboard && !isNewAnalysis && (
          <nav className="flex items-center gap-8">
            {/* Home */}
            <Link
              to="/"
              className={`relative py-2 text-sm font-semibold transition-colors flex items-center gap-1.5 ${
                path === '/' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <HomeIcon className="w-4 h-4" />
              <span>Home</span>
              {path === '/' && (
                <div className="absolute bottom-[-16px] left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#00d2ff,0_0_24px_#2563eb]" />
              )}
            </Link>

            {/* About */}
            <Link
              to="/about"
              className={`relative py-2 text-sm font-semibold transition-colors flex items-center gap-1.5 ${
                path === '/about' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>About</span>
              {path === '/about' && (
                <div className="absolute bottom-[-16px] left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#00d2ff,0_0_24px_#2563eb]" />
              )}
            </Link>

            {/* Profile */}
            <Link
              to="/profile"
              className={`relative py-2 text-sm font-semibold transition-colors flex items-center gap-1.5 ${
                path === '/profile' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <User className="w-4 h-4" />
              <span>Profile</span>
              {path === '/profile' && (
                <div className="absolute bottom-[-16px] left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#00d2ff,0_0_24px_#2563eb]" />
              )}
            </Link>
          </nav>
        )}

        {/* Center Navigation Links for New Analysis Page */}
        {isNewAnalysis && (
          <nav className="flex items-center gap-6">
            <Link
              to="/"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            >
              <HomeIcon className="w-3.5 h-3.5" />
              <span>Home</span>
            </Link>

            <Link
              to="/new-analysis"
              className="relative flex items-center gap-1.5 text-xs font-semibold text-white py-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>New Analysis</span>
              <div className="absolute bottom-[-16px] left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#00d2ff]" />
            </Link>

            <Link
              to="/profile"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            >
              <User className="w-3.5 h-3.5" />
              <span>Profile</span>
            </Link>
          </nav>
        )}

        {/* Right Section: Actions & User Avatar */}
        <div className="flex items-center gap-3">
          {isDashboard ? (
            /* Screenshot 2 Header: Analysis Report & Download Report Functional Buttons */
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => openReport()}
                className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-200 bg-[#0a142c] hover:bg-[#0f1e40] border border-[#1d3568] hover:border-cyan-400/60 rounded-lg transition-all shadow-[0_0_10px_rgba(0,0,0,0.5)] cursor-pointer"
                title="View Analysis Report"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>Analysis Report</span>
              </button>

              <button
                type="button"
                onClick={() => downloadReport()}
                className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 rounded-lg shadow-[0_0_15px_rgba(0,210,255,0.4)] hover:shadow-[0_0_25px_rgba(0,210,255,0.6)] transition-all cursor-pointer"
                title="Download Analysis Report"
              >
                <Download className="w-3.5 h-3.5 text-white" />
                <span>Download Report</span>
              </button>

              <Link
                to="/profile"
                className="w-8 h-8 rounded-full bg-[#0a142c] border border-[#1a2d59] hover:border-cyan-400/50 flex items-center justify-center text-slate-300 ml-1 transition-colors"
                title="User Profile"
              >
                <User className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            /* Screenshot 1 Header: Bell and Keshav User Pill */
            <div className="flex items-center gap-3">
              <button 
                type="button" 
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-[#0c1630] transition-colors relative"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              </button>

              <Link
                to="/profile"
                className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-full bg-[#0a142c] border border-[#1a2d59] hover:border-cyan-500/40 transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-blue-600/40 border border-cyan-400/50 flex items-center justify-center text-cyan-300 font-bold text-xs">
                  <User className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-semibold text-slate-200">Keshav</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </Link>
            </div>
          )}
        </div>

      </div>
    </header>
  );
};
