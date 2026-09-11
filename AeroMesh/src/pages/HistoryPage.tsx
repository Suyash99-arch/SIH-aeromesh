import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, MapPin, Calendar, CheckCircle2, SlidersHorizontal,
  FileText, Eye, Download, AlertCircle, ArrowRight
} from 'lucide-react';
import { useIncident } from '../context/IncidentContext';
import type { Incident } from '../types';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { historyIncidents, selectIncident, openReport, downloadReport } = useIncident();

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('All Locations');
  const [selectedStatus, setSelectedStatus] = useState('All Status');
  const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'name'>('latest');

  // Extract unique locations
  const locations = useMemo(() => {
    const locSet = new Set<string>();
    historyIncidents.forEach(inc => {
      // Get short or first part
      const loc = inc.location.split(',')[0].trim();
      locSet.add(loc);
    });
    return ['All Locations', ...Array.from(locSet)];
  }, [historyIncidents]);

  // Filter and sort incidents
  const filteredIncidents = useMemo(() => {
    return historyIncidents
      .filter(inc => {
        // Search query
        const q = searchQuery.toLowerCase().trim();
        const matchesQuery =
          !q ||
          inc.id.toLowerCase().includes(q) ||
          inc.name.toLowerCase().includes(q) ||
          inc.location.toLowerCase().includes(q);

        // Location filter
        const matchesLocation =
          selectedLocation === 'All Locations' ||
          inc.location.toLowerCase().includes(selectedLocation.toLowerCase());

        // Status filter
        const matchesStatus =
          selectedStatus === 'All Status' ||
          inc.status.toLowerCase() === selectedStatus.toLowerCase();

        return matchesQuery && matchesLocation && matchesStatus;
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'oldest') return a.date.localeCompare(b.date);
        return b.date.localeCompare(a.date); // default 'latest'
      });
  }, [historyIncidents, searchQuery, selectedLocation, selectedStatus, sortBy]);

  const handleViewAnalysis = (incident: Incident) => {
    selectIncident(incident.id);
    navigate('/dashboard');
  };

  const renderStatusBadge = (status: Incident['status']) => {
    if (status === 'Analysis Completed') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/50 text-emerald-400 text-xs font-semibold shadow-[0_0_12px_rgba(16,185,129,0.2)]">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#10b981]" />
          <span>Analysis Completed</span>
        </div>
      );
    }
    if (status === 'Processing' || status === 'In Progress') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/70 border border-amber-500/50 text-amber-400 text-xs font-semibold shadow-[0_0_12px_rgba(245,158,11,0.2)]">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_6px_#f59e0b]" />
          <span>Processing</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-950/70 border border-rose-500/50 text-rose-400 text-xs font-semibold shadow-[0_0_12px_rgba(244,63,94,0.2)]">
        <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse shadow-[0_0_6px_#f43f5e]" />
        <span>Failed</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30">
      
      {/* Background Wireframe Grid & Ambient Glows */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 right-1/4 w-[600px] h-[400px] bg-blue-600/10 rounded-full blur-[140px]" />
        <div className="absolute top-1/3 left-10 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[160px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#09142b_1px,transparent_1px),linear-gradient(to_bottom,#09142b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-30" />
      </div>

      {/* Main Container */}
      <div className="relative z-10 max-w-[1500px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 flex-1">
        
        {/* Header Hero Area with Drone City Visual (Matching Screenshot 1) */}
        <div className="relative rounded-2xl overflow-hidden p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          
          {/* Left Title */}
          <div className="space-y-1.5 max-w-xl">
            <span className="text-xs font-mono font-bold tracking-[0.25em] text-cyan-400 uppercase">
              History
            </span>
            <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-cyan-300 tracking-tight">
              History
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Review and explore your previous AeroMesh analyses.
            </p>
          </div>

          {/* Right Futuristic Cityscape Graphic */}
          <div className="relative w-full md:w-[480px] h-36 sm:h-44 rounded-xl overflow-hidden border border-[#142852]/60 shadow-[0_0_30px_rgba(0,210,255,0.15)] group">
            <img
              src="/assets/night_aerial_city.jpg"
              alt="AeroMesh Drone Fleet Reconnaissance"
              className="w-full h-full object-cover filter brightness-90 contrast-125"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#030712] via-transparent to-blue-950/40" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#030712] via-transparent to-transparent" />
            
            {/* Holographic Target Rings */}
            <div className="absolute top-4 right-6 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/60 border border-cyan-400/40 backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span className="text-[10px] font-mono text-cyan-300 font-semibold tracking-wider">
                DRONE NETWORK ACTIVE
              </span>
            </div>
          </div>

        </div>

        {/* Filter Bar (Matching Screenshot 1) */}
        <div className="p-3.5 rounded-2xl bg-[#081024]/90 border border-[#14264e] shadow-[0_0_25px_rgba(0,0,0,0.6)] backdrop-blur-md">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
            
            {/* Search Input (5 Cols) */}
            <div className="lg:col-span-4 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by Incident ID or Name"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0b1429] border border-[#182d5a] focus:border-cyan-400 text-xs text-white placeholder:text-slate-500 focus:outline-none transition-colors"
              />
            </div>

            {/* Location Filter (2 Cols) */}
            <div className="lg:col-span-2 relative">
              <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none" />
              <select
                value={selectedLocation}
                onChange={e => setSelectedLocation(e.target.value)}
                className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-[#0b1429] border border-[#182d5a] focus:border-cyan-400 text-xs text-slate-200 focus:outline-none appearance-none cursor-pointer transition-colors"
              >
                {locations.map(loc => (
                  <option key={loc} value={loc} className="bg-[#081024] text-slate-200">
                    {loc}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range Picker (2 Cols) */}
            <div className="lg:col-span-2 relative">
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none" />
              <input
                type="text"
                readOnly
                value="Select Date Range"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0b1429] border border-[#182d5a] text-xs text-slate-400 cursor-pointer"
                title="Date range filter"
              />
            </div>

            {/* Status Filter (2 Cols) */}
            <div className="lg:col-span-2 relative">
              <CheckCircle2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none" />
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-[#0b1429] border border-[#182d5a] focus:border-cyan-400 text-xs text-slate-200 focus:outline-none appearance-none cursor-pointer transition-colors"
              >
                <option value="All Status" className="bg-[#081024] text-slate-200">All Status</option>
                <option value="Analysis Completed" className="bg-[#081024] text-slate-200">Analysis Completed</option>
                <option value="Processing" className="bg-[#081024] text-slate-200">Processing</option>
                <option value="Failed" className="bg-[#081024] text-slate-200">Failed</option>
              </select>
            </div>

            {/* Sort by Dropdown (2 Cols) */}
            <div className="lg:col-span-2 relative">
              <SlidersHorizontal className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none" />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as 'latest' | 'oldest' | 'name')}
                className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-[#0b1429] border border-[#182d5a] focus:border-cyan-400 text-xs text-slate-200 focus:outline-none appearance-none cursor-pointer transition-colors"
              >
                <option value="latest" className="bg-[#081024] text-slate-200">Sort by Latest</option>
                <option value="oldest" className="bg-[#081024] text-slate-200">Sort by Oldest</option>
                <option value="name" className="bg-[#081024] text-slate-200">Sort by Name</option>
              </select>
            </div>

          </div>
        </div>

        {/* Incident Cards List (Matching Screenshot 1) */}
        <div className="space-y-3.5">
          {filteredIncidents.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-[#081024]/60 border border-[#14264e] space-y-3">
              <AlertCircle className="w-10 h-10 text-slate-500 mx-auto" />
              <h3 className="text-sm font-bold text-white">No analyses match your search</h3>
              <p className="text-xs text-slate-400">Try adjusting your keywords or clearing the filters.</p>
            </div>
          ) : (
            filteredIncidents.map(inc => (
              <div
                key={inc.id}
                className="group relative p-4 rounded-2xl bg-[#081024]/90 border border-[#14244a] hover:border-cyan-500/50 transition-all duration-300 shadow-[0_0_20px_rgba(0,0,0,0.5)] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 hover:shadow-[0_0_30px_rgba(0,210,255,0.12)]"
              >
                {/* Left: Thumbnail + Metadata */}
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  
                  {/* Thumbnail */}
                  <div className="relative w-36 sm:w-44 aspect-[16/10] rounded-xl overflow-hidden border border-[#162a56] bg-[#050b18] flex-shrink-0 group-hover:border-cyan-400/50 transition-colors">
                    <img
                      src={inc.thumbnailUrl || '/assets/drone_bridge_aerial.jpg'}
                      alt={inc.name}
                      className="w-full h-full object-cover filter brightness-95 group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  </div>

                  {/* Middle Info */}
                  <div className="space-y-1.5 min-w-0 flex-1">
                    
                    {/* ID */}
                    <div className="flex items-center gap-1.5 text-xs text-cyan-400 font-mono font-bold">
                      <FileText className="w-3.5 h-3.5" />
                      <span>{inc.id}</span>
                    </div>

                    {/* Title */}
                    <h2 className="text-base font-bold text-white tracking-tight truncate group-hover:text-cyan-300 transition-colors">
                      {inc.name}
                    </h2>

                    {/* Location & Date/Time */}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                      <div className="flex items-center gap-1.5 truncate max-w-[240px]">
                        <MapPin className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                        <span className="truncate">{inc.location}</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-slate-400">
                        <Calendar className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                        <span>{inc.date} • {inc.time}</span>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Center Status Badge */}
                <div className="flex-shrink-0 self-center lg:self-auto">
                  {renderStatusBadge(inc.status)}
                </div>

                {/* Right Action Buttons: View Analysis -> | Analyse Report | Download Report */}
                <div className="flex items-center gap-2.5 flex-wrap flex-shrink-0 w-full lg:w-auto justify-end pt-2 lg:pt-0 border-t lg:border-t-0 border-[#122245]">
                  
                  {/* View Analysis -> (Primary Glowing Button) */}
                  <button
                    type="button"
                    onClick={() => handleViewAnalysis(inc)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white text-xs font-bold shadow-[0_0_15px_rgba(0,210,255,0.4)] hover:shadow-[0_0_25px_rgba(0,210,255,0.6)] transition-all transform hover:-translate-y-0.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Analysis</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  {/* Analyse Report */}
                  <button
                    type="button"
                    onClick={() => openReport(inc)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0b1633] border border-[#1a3366] hover:border-cyan-400/60 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Analyse Report</span>
                  </button>

                  {/* Download Report */}
                  <button
                    type="button"
                    onClick={() => downloadReport(inc)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0b1633] border border-[#1a3366] hover:border-cyan-400/60 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Download Report</span>
                  </button>

                </div>

              </div>
            ))
          )}
        </div>

      </div>

      {/* Footer Tagline (Screenshot 1) */}
      <footer className="relative z-10 py-6 border-t border-[#0d1b36] mt-12 text-center">
        <div className="flex items-center justify-center gap-4 max-w-md mx-auto text-[11px] font-mono tracking-[0.2em] text-slate-500 uppercase">
          <span className="w-8 h-px bg-slate-800" />
          <span>AeroMesh — Better Vision · Smarter Tomorrow</span>
          <span className="w-8 h-px bg-slate-800" />
        </div>
      </footer>

    </div>
  );
};
