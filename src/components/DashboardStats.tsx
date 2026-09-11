import React from 'react';
import { Users, Car, Flame, ArrowLeftRight, AlertTriangle } from 'lucide-react';
import type { IncidentStats } from '../types';

interface DashboardStatsProps {
  stats: IncidentStats;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({ stats }) => {
  return (
    <div className="w-full bg-[#050c1e]/95 backdrop-blur-md border-t border-[#0f244a] p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.4)]">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        
        {/* Total People */}
        <div className="p-2.5 rounded-xl bg-[#091124] border border-[#14264d] flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-cyan-400 flex-shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-medium">Total People</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-extrabold text-white">{stats.totalPeople}</span>
              <span className="text-[10px] font-bold text-rose-400 flex items-center">
                ▲ +{stats.peopleDelta}
              </span>
            </div>
          </div>
        </div>

        {/* Total Vehicles */}
        <div className="p-2.5 rounded-xl bg-[#091124] border border-[#14264d] flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-cyan-400 flex-shrink-0">
            <Car className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-medium">Total Vehicles</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-extrabold text-white">{stats.totalVehicles}</span>
              <span className="text-[10px] font-bold text-rose-400 flex items-center">
                ▲ +{stats.vehiclesDelta}
              </span>
            </div>
          </div>
        </div>

        {/* Fire Incidents */}
        <div className="p-2.5 rounded-xl bg-[#091124] border border-[#14264d] flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-rose-600/30 border border-rose-500/40 flex items-center justify-center text-rose-400 flex-shrink-0">
            <Flame className="w-4 h-4" />
          </div>
          <div className="w-full">
            <p className="text-[10px] text-slate-400 font-medium">Fire Incidents</p>
            <div className="flex items-center gap-2 text-[10px] font-bold mt-0.5">
              <span className="text-rose-400">Major: {stats.fireIncidents.major}</span>
              <span className="text-amber-400">Minor: {stats.fireIncidents.minor}</span>
              <span className="text-purple-400">Hazardous: {stats.fireIncidents.hazardous}</span>
            </div>
          </div>
        </div>

        {/* Entry / Exit Points */}
        <div className="p-2.5 rounded-xl bg-[#091124] border border-[#14264d] flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-400 flex-shrink-0">
            <ArrowLeftRight className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-medium">Entry / Exit Points</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-extrabold text-white">{stats.entryExitPoints.total}</span>
              <span className="text-[10px] text-slate-400">
                ({stats.entryExitPoints.entry} Entry / {stats.entryExitPoints.exit} Exit)
              </span>
            </div>
          </div>
        </div>

        {/* Damaged Areas */}
        <div className="p-2.5 rounded-xl bg-[#091124] border border-[#14264d] flex items-center gap-3 col-span-2 md:col-span-1">
          <div className="w-9 h-9 rounded-full bg-rose-600/30 border border-rose-500/40 flex items-center justify-center text-rose-400 flex-shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-medium">Damaged Areas</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-extrabold text-white">{stats.damagedAreas.total}</span>
              <span className="text-[10px] text-slate-400 truncate max-w-[130px]">
                ({stats.damagedAreas.details})
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
