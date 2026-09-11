import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Download, Printer, CheckCircle, MapPin, Calendar,
  Users, Car, Flame, CloudRain, AlertTriangle, ArrowRight,
  ArrowLeftRight, ShieldAlert, FileText, CheckCircle2
} from 'lucide-react';
import { useIncident } from '../context/IncidentContext';
import { downloadIncidentReport } from '../utils/reportGenerator';

export const AnalysisReportPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { incident: currentIncident, historyIncidents, selectIncident } = useIncident();

  // Find incident by ID from history, or fallback to currentIncident
  const incident = useMemo(() => {
    if (id) {
      const match = historyIncidents.find(item => item.id.toLowerCase() === id.toLowerCase());
      if (match) return match;
    }
    return currentIncident;
  }, [id, historyIncidents, currentIncident]);

  const stats = incident.stats || {
    totalPeople: 48,
    peopleDelta: 3,
    totalVehicles: 24,
    vehiclesDelta: 2,
    fireIncidents: { major: 1, minor: 1, hazardous: 1 },
    entryExitPoints: { total: 4, entry: 2, exit: 2 },
    damagedAreas: { total: 2, details: 'Bridge Section + Road' },
  };

  const detected = incident.detectedConditions || {
    structuralDamage: true,
    fire: true,
    smoke: true,
    humanPresence: true,
    vehiclePresence: true,
    entryExit: true,
  };

  const overall = incident.overallCondition || {
    level: 'CRITICAL',
    title: 'CRITICAL',
    description:
      'The analysed scene indicates significant structural damage with active fire activity and multiple detected entities. The affected area should be inspected and secured immediately.',
  };

  const observations = incident.keyObservations || [
    'Structural damage detected on the bridge section.',
    'Active fire detected near the roadway.',
    'Multiple vehicles identified in the affected zone.',
    'Human presence detected within the incident area.',
    'Multiple entry and exit points identified.',
  ];

  const handlePrint = () => {
    window.print();
  };

  const isCompleted = incident.status.toLowerCase().includes('completed');

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col py-8 px-4 sm:px-6 lg:px-8 selection:bg-cyan-500/30">
      
      {/* Top Navigation & Action Bar (Hidden on Print) */}
      <div className="max-w-5xl w-full mx-auto mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <Link
            to="/history"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#081229] border border-[#14264e] hover:border-cyan-400 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to History</span>
          </Link>

          <Link
            to="/dashboard"
            onClick={() => selectIncident(incident.id)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#081229] border border-[#14264e] hover:border-cyan-400 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
          >
            <span>View 3D Twin</span>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0b1633] border border-[#1a3366] hover:border-cyan-400/60 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-cyan-400" />
            <span>Print Report</span>
          </button>

          <button
            type="button"
            onClick={() => downloadIncidentReport(incident)}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white text-xs font-bold shadow-[0_0_20px_rgba(0,210,255,0.4)] hover:shadow-[0_0_25px_rgba(0,210,255,0.6)] transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      {/* Main Report Container (Matches Screenshot 2) */}
      <div className="max-w-5xl w-full mx-auto bg-[#060b18] border border-[#142854] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col print:border-none print:shadow-none print:bg-white print:text-black">
        
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between px-6 py-5 border-b border-[#122245] bg-[#070e20] gap-4 print:bg-slate-100 print:border-slate-300">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(0,210,255,0.25)] print:bg-slate-200 print:text-slate-800">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight print:text-black">
                Analysis Report
              </h1>
              <p className="text-xs text-slate-400 print:text-slate-600">
                Comprehensive incident analysis generated by AeroMesh
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold ${
                isCompleted
                  ? 'bg-emerald-950/70 border border-emerald-500/50 text-emerald-400 print:bg-emerald-100 print:text-emerald-800'
                  : 'bg-amber-950/70 border border-amber-500/50 text-amber-400 print:bg-amber-100 print:text-amber-800'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
              <span>{incident.status}</span>
            </div>

            <div className="text-xs font-mono text-slate-400 print:text-slate-600">
              Incident ID: <span className="text-cyan-400 font-bold print:text-blue-700">{incident.id}</span>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 sm:p-8 space-y-7">
          
          {/* Section 1: Incident Overview */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[11px] flex items-center justify-center">
                1
              </span>
              <h2 className="text-sm font-bold text-white tracking-wide print:text-black">
                Incident Overview
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Incident ID */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#091228] border border-[#142650] print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-[#0d1c40] flex items-center justify-center text-cyan-400 print:bg-slate-200 print:text-slate-800">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-400 print:text-slate-500">Incident ID</p>
                  <p className="text-xs font-bold text-white font-mono print:text-black">{incident.id}</p>
                </div>
              </div>

              {/* Incident Name */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#091228] border border-[#142650] print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-[#0d1c40] flex items-center justify-center text-cyan-400 print:bg-slate-200 print:text-slate-800">
                  <CheckCircle className="w-4 h-4" />
                </div>
                <div className="truncate">
                  <p className="text-[10px] uppercase font-semibold text-slate-400 print:text-slate-500">Incident Name</p>
                  <p className="text-xs font-bold text-white truncate print:text-black">{incident.name}</p>
                </div>
              </div>

              {/* Analysis Status */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#091228] border border-[#142650] print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 print:bg-emerald-100 print:text-emerald-800">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-400 print:text-slate-500">Analysis Status</p>
                  <p className="text-xs font-bold text-emerald-400 print:text-emerald-700">Completed</p>
                </div>
              </div>

              {/* Location */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#091228] border border-[#142650] sm:col-span-2 print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-[#0d1c40] flex items-center justify-center text-cyan-400 flex-shrink-0 print:bg-slate-200 print:text-slate-800">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="truncate">
                  <p className="text-[10px] uppercase font-semibold text-slate-400 print:text-slate-500">Location</p>
                  <p className="text-xs font-bold text-white truncate print:text-black">{incident.location}</p>
                </div>
              </div>

              {/* Date & Time */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#091228] border border-[#142650] print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-[#0d1c40] flex items-center justify-center text-cyan-400 print:bg-slate-200 print:text-slate-800">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-400 print:text-slate-500">Date &amp; Time</p>
                  <p className="text-xs font-bold text-white font-mono print:text-black">{incident.date} • {incident.time}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Entity Detection Summary */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[11px] flex items-center justify-center">
                2
              </span>
              <h2 className="text-sm font-bold text-white tracking-wide print:text-black">
                Entity Detection Summary
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              {/* People */}
              <div className="p-3.5 rounded-xl bg-[#091228] border border-[#142650] text-center space-y-1 print:bg-slate-50 print:border-slate-200">
                <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[11px] print:text-slate-600">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  <span>People</span>
                </div>
                <div className="text-xl font-bold text-white font-mono print:text-black">{stats.totalPeople}</div>
                <div className="text-[10px] text-emerald-400 font-bold print:text-emerald-700">↑ +{stats.peopleDelta}</div>
              </div>

              {/* Vehicles */}
              <div className="p-3.5 rounded-xl bg-[#091228] border border-[#142650] text-center space-y-1 print:bg-slate-50 print:border-slate-200">
                <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[11px] print:text-slate-600">
                  <Car className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Vehicles</span>
                </div>
                <div className="text-xl font-bold text-white font-mono print:text-black">{stats.totalVehicles}</div>
                <div className="text-[10px] text-emerald-400 font-bold print:text-emerald-700">↑ +{stats.vehiclesDelta}</div>
              </div>

              {/* Fire */}
              <div className="p-3.5 rounded-xl bg-[#091228] border border-[#142650] text-center space-y-1 print:bg-slate-50 print:border-slate-200">
                <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[11px] print:text-slate-600">
                  <Flame className="w-3.5 h-3.5 text-rose-400" />
                  <span>Fire Incidents</span>
                </div>
                <div className="text-xl font-bold text-white font-mono print:text-black">
                  {stats.fireIncidents.major + stats.fireIncidents.minor + stats.fireIncidents.hazardous}
                </div>
                <div className="text-[9px] text-rose-400 font-mono print:text-rose-700">
                  Maj: {stats.fireIncidents.major} | Min: {stats.fireIncidents.minor}
                </div>
              </div>

              {/* Smoke */}
              <div className="p-3.5 rounded-xl bg-[#091228] border border-[#142650] text-center space-y-1 print:bg-slate-50 print:border-slate-200">
                <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[11px] print:text-slate-600">
                  <CloudRain className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Smoke</span>
                </div>
                <div className="text-xl font-bold text-white font-mono print:text-black">5</div>
                <div className="text-[10px] text-emerald-400 font-bold print:text-emerald-700">↑ +1</div>
              </div>

              {/* Damaged Areas */}
              <div className="p-3.5 rounded-xl bg-[#091228] border border-[#142650] text-center space-y-1 print:bg-slate-50 print:border-slate-200">
                <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[11px] print:text-slate-600">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Damaged Areas</span>
                </div>
                <div className="text-xl font-bold text-white font-mono print:text-black">{stats.damagedAreas.total}</div>
                <div className="text-[9px] text-slate-400 truncate print:text-slate-600">{stats.damagedAreas.details}</div>
              </div>

              {/* Entry Points */}
              <div className="p-3.5 rounded-xl bg-[#091228] border border-[#142650] text-center space-y-1 print:bg-slate-50 print:border-slate-200">
                <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[11px] print:text-slate-600">
                  <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Entry Points</span>
                </div>
                <div className="text-xl font-bold text-white font-mono print:text-black">{stats.entryExitPoints.entry}</div>
                <div className="text-[9px] text-slate-400 print:text-slate-600">(Entry / Exit)</div>
              </div>

              {/* Exit Points */}
              <div className="p-3.5 rounded-xl bg-[#091228] border border-[#142650] text-center space-y-1 print:bg-slate-50 print:border-slate-200">
                <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[11px] print:text-slate-600">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Exit Points</span>
                </div>
                <div className="text-xl font-bold text-white font-mono print:text-black">{stats.entryExitPoints.exit}</div>
                <div className="text-[9px] text-slate-400 print:text-slate-600">(Entry / Exit)</div>
              </div>
            </div>
          </div>

          {/* Section 3: Detected Conditions */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[11px] flex items-center justify-center">
                3
              </span>
              <h2 className="text-sm font-bold text-white tracking-wide print:text-black">
                Detected Conditions
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="p-3 rounded-xl bg-[#091228] border border-[#142650] flex flex-col items-center justify-center text-center space-y-1.5 print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-cyan-400">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <p className="text-[11px] font-semibold text-slate-200 print:text-black">Structural Damage</p>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold print:text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {detected.structuralDamage ? 'Detected' : 'None'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#091228] border border-[#142650] flex flex-col items-center justify-center text-center space-y-1.5 print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-rose-400">
                  <Flame className="w-4 h-4" />
                </div>
                <p className="text-[11px] font-semibold text-slate-200 print:text-black">Fire</p>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold print:text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {detected.fire ? 'Detected' : 'None'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#091228] border border-[#142650] flex flex-col items-center justify-center text-center space-y-1.5 print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-cyan-400">
                  <CloudRain className="w-4 h-4" />
                </div>
                <p className="text-[11px] font-semibold text-slate-200 print:text-black">Smoke</p>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold print:text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {detected.smoke ? 'Detected' : 'None'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#091228] border border-[#142650] flex flex-col items-center justify-center text-center space-y-1.5 print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-cyan-400">
                  <Users className="w-4 h-4" />
                </div>
                <p className="text-[11px] font-semibold text-slate-200 print:text-black">Human Presence</p>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold print:text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {detected.humanPresence ? 'Detected' : 'None'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#091228] border border-[#142650] flex flex-col items-center justify-center text-center space-y-1.5 print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-cyan-400">
                  <Car className="w-4 h-4" />
                </div>
                <p className="text-[11px] font-semibold text-slate-200 print:text-black">Vehicle Presence</p>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold print:text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {detected.vehiclePresence ? 'Detected' : 'None'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#091228] border border-[#142650] flex flex-col items-center justify-center text-center space-y-1.5 print:bg-slate-50 print:border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-cyan-400">
                  <ArrowLeftRight className="w-4 h-4" />
                </div>
                <p className="text-[11px] font-semibold text-slate-200 print:text-black">Entry / Exit</p>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold print:text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {detected.entryExit ? 'Detected' : 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 4 & 5 Grid: Overall Condition & Key Observations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Section 4: Overall Condition */}
            <div className="p-5 rounded-xl bg-[#081024] border border-[#142650] space-y-3.5 print:bg-slate-50 print:border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[11px] flex items-center justify-center">
                  4
                </span>
                <h2 className="text-sm font-bold text-white tracking-wide print:text-black">
                  Overall Condition
                </h2>
              </div>

              {/* Critical Alert Card */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-rose-950/80 to-rose-900/40 border border-rose-500/50 flex items-center gap-3.5 shadow-[0_0_20px_rgba(244,63,94,0.15)] print:bg-rose-50 print:border-rose-300">
                <div className="w-10 h-10 rounded-xl bg-rose-900/60 border border-rose-400/60 flex items-center justify-center text-rose-300 flex-shrink-0 print:bg-rose-200 print:text-rose-800">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white tracking-wide print:text-rose-900">{overall.level}</h3>
                  <p className="text-[11px] text-rose-300 print:text-rose-700">Immediate attention recommended</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed print:text-slate-700">
                {overall.description}
              </p>
            </div>

            {/* Section 5: Key Observations */}
            <div className="p-5 rounded-xl bg-[#081024] border border-[#142650] space-y-3.5 print:bg-slate-50 print:border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[11px] flex items-center justify-center">
                  5
                </span>
                <h2 className="text-sm font-bold text-white tracking-wide print:text-black">
                  Key Observations
                </h2>
              </div>

              <ul className="space-y-2.5 text-xs text-slate-300 print:text-slate-700">
                {observations.map((obs, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#00d2ff] mt-1.5 flex-shrink-0 print:bg-blue-600" />
                    <span>{obs}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#122245] bg-[#070e20] flex items-center justify-between text-xs text-slate-500 print:bg-slate-100 print:border-slate-300">
          <span>AeroMesh Vision Engine v2.4 • Confidential Incident Record</span>
          <button
            type="button"
            onClick={() => downloadIncidentReport(incident)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white text-xs font-bold shadow-[0_0_15px_rgba(0,210,255,0.4)] transition-all print:hidden cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Report (PDF)</span>
          </button>
        </div>

      </div>

    </div>
  );
};
