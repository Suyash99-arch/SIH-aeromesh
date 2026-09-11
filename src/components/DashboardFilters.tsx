import React, { useState } from 'react';
import { Filter, Box, LogIn, Users, Car, Flame, AlertTriangle, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import type { FilterState, CustomMarking } from '../types';

interface DashboardFiltersProps {
  filters: FilterState;
  onToggleFilter: (key: keyof Omit<FilterState, 'customMarkings'>, val: boolean) => void;
  onToggleCustomMarking: (name: string, val: boolean) => void;
  onReset: () => void;
  markings: CustomMarking[];
}

export const DashboardFilters: React.FC<DashboardFiltersProps> = ({
  filters,
  onToggleFilter,
  onToggleCustomMarking,
  onReset,
  markings
}) => {
  const [isCustomExpanded, setIsCustomExpanded] = useState<boolean>(true);

  return (
    <div className="w-64 h-full bg-[#050c1f]/95 backdrop-blur-md border-r border-[#0f244a] p-3.5 flex flex-col justify-between overflow-y-auto">
      <div className="space-y-4">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-[#132244]">
          <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <span>View Filters</span>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold transition-colors"
          >
            Reset
          </button>
        </div>

        {/* Primary Layer Toggles (Screenshot 4) */}
        <div className="space-y-2.5">
          
          {/* 3D Reconstruction */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2.5 text-xs text-slate-200">
              <Box className="w-4 h-4 text-cyan-400" />
              <span>3D Reconstruction</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={filters.reconstruction3D}
                onChange={(e) => onToggleFilter('reconstruction3D', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#132142] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
            </label>
          </div>

          {/* Entry / Exit Points */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2.5 text-xs text-slate-200">
              <LogIn className="w-4 h-4 text-emerald-400" />
              <span>Entry / Exit Points</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={filters.entryExit}
                onChange={(e) => onToggleFilter('entryExit', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#132142] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
            </label>
          </div>

          {/* Humans */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2.5 text-xs text-slate-200">
              <Users className="w-4 h-4 text-blue-400" />
              <span>Humans</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={filters.humans}
                onChange={(e) => onToggleFilter('humans', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#132142] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
            </label>
          </div>

          {/* Vehicles */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2.5 text-xs text-slate-200">
              <Car className="w-4 h-4 text-cyan-400" />
              <span>Vehicles</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={filters.vehicles}
                onChange={(e) => onToggleFilter('vehicles', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#132142] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
            </label>
          </div>

          {/* Fire & Smoke */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2.5 text-xs text-slate-200">
              <Flame className="w-4 h-4 text-rose-500" />
              <span>Fire & Smoke</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={filters.fireSmoke}
                onChange={(e) => onToggleFilter('fireSmoke', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#132142] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
            </label>
          </div>

          {/* Damage */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2.5 text-xs text-slate-200">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Damage</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={filters.damage}
                onChange={(e) => onToggleFilter('damage', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#132142] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
            </label>
          </div>

        </div>

        {/* Custom Markings Collapsible Section */}
        <div className="pt-2 border-t border-[#132244]">
          <button
            type="button"
            onClick={() => setIsCustomExpanded(!isCustomExpanded)}
            className="w-full flex items-center justify-between py-1 text-xs font-bold text-slate-300 hover:text-white"
          >
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              <span>Custom Markings</span>
            </div>
            {isCustomExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {isCustomExpanded && (
            <div className="mt-2 space-y-2 pl-1">
              {markings.map((m) => {
                const isChecked = filters.customMarkings[m.name] !== false && m.visible !== false;
                return (
                  <div key={m.id} className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2 text-[11px] text-slate-300 truncate max-w-[130px]">
                      <span 
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: m.color }}
                      />
                      <span className="truncate">{m.name}</span>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => onToggleCustomMarking(m.name, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-[#132142] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* Labels Visibility Sub-toggle */}
      <div className="pt-3 border-t border-[#132244] flex items-center justify-between text-xs text-slate-400">
        <span>Show Labels</span>
        <input
          type="checkbox"
          checked={filters.labels}
          onChange={(e) => onToggleFilter('labels', e.target.checked)}
          className="w-4 h-4 rounded bg-[#0b1428] border-[#1a2c56] text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
        />
      </div>

    </div>
  );
};
