import React from 'react';
import { Shield, Activity, Cpu } from 'lucide-react';
import { useIncident } from '../context/IncidentContext';

export const ProfilePage: React.FC = () => {
  const { incident } = useIncident();

  return (
    <div className="min-h-screen bg-[#050811] text-slate-100 p-6 lg:p-10">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Profile Header */}
        <div className="p-6 rounded-2xl bg-[#080e1e] border border-[#142345] shadow-glass flex flex-col sm:flex-row items-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-600 via-cyan-500 to-indigo-600 p-0.5 shadow-[0_0_25px_rgba(0,210,255,0.4)]">
            <div className="w-full h-full rounded-2xl bg-[#080e1e] flex items-center justify-center text-3xl font-extrabold text-cyan-400">
              K
            </div>
          </div>

          <div className="space-y-1.5 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-3">
              <h1 className="text-2xl font-bold text-white">Keshav</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-600/20 border border-cyan-400/40 text-cyan-400 text-xs font-semibold">
                Lead Geospatial Analyst
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Analyst ID: AM-OP-892 · Aerospace Rapid Response Unit
            </p>
            <p className="text-xs text-slate-300">
              Responsible for drone telemetry verification and automated 3D mesh incident reviews.
            </p>
          </div>
        </div>

        {/* Credentials & System Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-[#080e1e] border border-[#142345] shadow-glass flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-cyan-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Security Clearance</p>
              <p className="text-sm font-bold text-white">Tier 1 Recon</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#080e1e] border border-[#142345] shadow-glass flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Recent Incident</p>
              <p className="text-sm font-bold text-emerald-400 font-mono">{incident.id}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#080e1e] border border-[#142345] shadow-glass flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">GPU Acceleration</p>
              <p className="text-sm font-bold text-white">Active (WebGL 2.0)</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
