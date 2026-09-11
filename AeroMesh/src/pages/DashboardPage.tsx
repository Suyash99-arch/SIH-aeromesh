import React, { useState } from 'react';
import { Box, Film } from 'lucide-react';
import { useIncident } from '../context/IncidentContext';
import { BridgeViewer } from '../components/BridgeViewer';
import { DashboardFilters } from '../components/DashboardFilters';
import { CustomMarkingPanel } from '../components/CustomMarkingPanel';
import { DashboardStats } from '../components/DashboardStats';
import { VideoFramesTab } from '../components/VideoFramesTab';

type DashboardTab = '3d' | 'frames';

export const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('3d');
  const {
    markings,
    addMarking,
    deleteMarking,
    toggleMarkingVisibility,
    filters,
    setFilter,
    setCustomMarkingFilter,
    resetFilters,
    stats
  } = useIncident();

  return (
    <div className="h-[calc(100vh-64px)] w-full bg-[#050811] text-slate-100 flex flex-col overflow-hidden">
      <div className="h-11 bg-[#060a16] border-b border-[#121f3d] px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('3d')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === '3d'
                ? 'bg-[#0f1d3c] border border-cyan-400/60 text-cyan-300 shadow-[0_0_12px_rgba(0,210,255,0.25)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#0a1226]'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>3D Model View</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('frames')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'frames'
                ? 'bg-[#0f1d3c] border border-cyan-400/60 text-cyan-300 shadow-[0_0_12px_rgba(0,210,255,0.25)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#0a1226]'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Video Frames</span>
          </button>
        </div>
        <div className="text-[11px] text-slate-500 font-mono hidden sm:block">
          AeroMesh Vision Engine v2.4 · 3D Reconstruction Ready
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {activeTab === '3d' ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 flex min-h-0">
              <DashboardFilters
                filters={filters}
                onToggleFilter={setFilter}
                onToggleCustomMarking={setCustomMarkingFilter}
                onReset={resetFilters}
                markings={markings}
              />

              <div className="flex-1 min-w-0 h-full relative p-2 bg-[#050811]">
                <BridgeViewer filters={filters} markings={markings} />
              </div>

              <CustomMarkingPanel
                markings={markings}
                onAddMarking={addMarking}
                onDeleteMarking={deleteMarking}
                onToggleVisibility={toggleMarkingVisibility}
              />
            </div>
            <div className="flex-shrink-0">
              <DashboardStats stats={stats} />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden">
            <VideoFramesTab />
          </div>
        )}
      </div>
    </div>
  );
};
