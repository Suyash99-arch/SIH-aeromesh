import React, { useState, useEffect } from 'react';
import { Zap, Crosshair, Box, ShieldCheck, Upload, Layers, Play } from 'lucide-react';

interface Stage {
  num: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}

export const AboutPage: React.FC = () => {
  // Smooth animated progressive state (0 to 100%)
  const [progress, setProgress] = useState<number>(0);

  useEffect(() => {
    let startTime = performance.now();
    const duration = 8000; // 8s progressive cycle

    let animId: number;
    const updateProgress = (currentTime: number) => {
      const elapsed = (currentTime - startTime) % duration;
      setProgress((elapsed / duration) * 100);
      animId = requestAnimationFrame(updateProgress);
    };

    animId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animId);
  }, []);

  const activeCheckpoint = Math.min(5, Math.floor(progress / 20) + 1);

  const stages: Stage[] = [
    {
      num: 1,
      title: 'Upload Video',
      description: 'Simply upload your one-shot drone video. No complex setup. Just get started.',
      icon: (
        <div className="relative w-full h-28 flex items-center justify-center">
          <div className="w-32 h-20 rounded-xl bg-gradient-to-b from-[#0e1d3d] to-[#070e20] border border-cyan-500/50 p-1.5 shadow-[0_0_25px_rgba(0,210,255,0.25)] flex flex-col items-center justify-center relative group">
            <div className="w-full h-full bg-black rounded-lg border border-[#172d5b] flex items-center justify-center relative overflow-hidden">
              <img
                src="/assets/drone_bridge_aerial.jpg"
                alt="Drone footage frame"
                className="w-full h-full object-cover opacity-60"
              />
              <div className="absolute w-7 h-7 rounded-full bg-blue-600/80 border border-cyan-400 flex items-center justify-center text-white shadow-[0_0_10px_#00d2ff]">
                <Play className="w-3 h-3 fill-white translate-x-0.5" />
              </div>
            </div>
            {/* Cloud upload pill in corner (Screenshot 2) */}
            <div className="absolute -bottom-3 -right-2 px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 border border-cyan-300 shadow-[0_0_12px_#00d2ff] flex items-center gap-1">
              <Upload className="w-3 h-3 text-white" />
            </div>
          </div>
        </div>
      )
    },
    {
      num: 2,
      title: 'Analyse Video',
      description: 'Our AI processes the video, understands the scene and extracts key information.',
      icon: (
        <div className="relative w-full h-28 flex items-center justify-center">
          <div className="w-32 h-20 rounded-xl bg-gradient-to-b from-[#0e1d3d] to-[#070e20] border border-blue-500/50 p-1.5 shadow-[0_0_25px_rgba(37,99,235,0.3)] flex flex-col items-center justify-center relative">
            <div className="w-full h-full bg-[#050b18] rounded-lg border border-[#172d5b] flex items-center justify-around px-2 relative overflow-hidden">
              {/* Audio / Visual waveform bars */}
              <div className="flex items-end gap-1 h-8">
                <span className="w-1 bg-cyan-400 h-4 animate-pulse" />
                <span className="w-1 bg-cyan-300 h-7 animate-pulse delay-75" />
                <span className="w-1 bg-blue-400 h-5 animate-pulse delay-150" />
                <span className="w-1 bg-sky-300 h-8 animate-pulse delay-200" />
                <span className="w-1 bg-cyan-500 h-3 animate-pulse delay-100" />
              </div>
              {/* AI Chip icon with glowing leads */}
              <div className="w-8 h-8 rounded-lg bg-blue-600/40 border border-cyan-400 shadow-[0_0_12px_#00d2ff] flex items-center justify-center text-cyan-300 font-mono font-bold text-xs">
                AI
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      num: 3,
      title: '3D Reconstruction',
      description: 'We convert the aerial footage into an accurate, high-quality 3D model of your environment.',
      icon: (
        <div className="relative w-full h-28 flex items-center justify-center">
          <div className="w-28 h-24 relative flex items-center justify-center">
            {/* Glowing 3D building block isometric */}
            <div className="w-18 h-18 rounded-lg border border-cyan-400 bg-gradient-to-tr from-blue-950 via-cyan-900/40 to-blue-600/30 rotate-45 shadow-[0_0_25px_rgba(0,210,255,0.45)] flex items-center justify-center">
              <div className="w-10 h-10 border border-cyan-300/80 rounded flex items-center justify-center">
                <Box className="w-6 h-6 text-cyan-300 -rotate-45" />
              </div>
            </div>
            {/* Floating grid plane */}
            <div className="absolute -bottom-1 w-24 h-4 border border-cyan-500/50 rounded-full opacity-70" />
          </div>
        </div>
      )
    },
    {
      num: 4,
      title: 'Entity Detection',
      description: 'We automatically detect and identify entities like buildings, vehicles, people and more.',
      icon: (
        <div className="relative w-full h-28 flex items-center justify-center">
          <div className="w-28 h-24 relative flex items-center justify-center">
            {/* Building with labeled badges matching Screenshot 2 */}
            <div className="w-16 h-16 rounded-lg bg-slate-900 border border-blue-500 flex items-center justify-center relative shadow-[0_0_20px_rgba(37,99,235,0.4)]">
              <Layers className="w-7 h-7 text-cyan-400" />
              {/* Tags matching Screenshot 2: Building, Tree, Tree, Vehicle, Person */}
              <span className="absolute -top-3.5 -left-4 text-[9px] bg-blue-600 text-white font-semibold px-1.5 py-0.5 rounded shadow-[0_0_6px_#2563eb]">Building</span>
              <span className="absolute -top-3.5 -right-3 text-[9px] bg-emerald-600 text-white font-semibold px-1.5 py-0.5 rounded shadow-[0_0_6px_#10b981]">Tree</span>
              <span className="absolute -bottom-3 -left-3 text-[9px] bg-amber-600 text-white font-semibold px-1.5 py-0.5 rounded shadow-[0_0_6px_#d97706]">Vehicle</span>
              <span className="absolute -bottom-3 -right-3 text-[9px] bg-rose-600 text-white font-semibold px-1.5 py-0.5 rounded shadow-[0_0_6px_#e11d48]">Person</span>
            </div>
          </div>
        </div>
      )
    },
    {
      num: 5,
      title: 'Export Report',
      description: 'Get a detailed, easy-to-read report with 3D models, detected entities and insights — ready to use and share.',
      icon: (
        <div className="relative w-full h-28 flex items-center justify-center">
          <div className="w-32 h-20 rounded-xl bg-gradient-to-b from-[#0e1d3d] to-[#070e20] border border-cyan-400/60 p-1.5 shadow-[0_0_25px_rgba(0,210,255,0.35)] flex flex-col items-center justify-center relative">
            <div className="w-full h-full bg-[#050b18] rounded-lg border border-[#172d5b] p-1.5 flex items-center justify-between">
              <div className="w-9 h-9 rounded-md bg-blue-950 border border-blue-500 flex items-center justify-center">
                <Box className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex flex-col gap-1 w-12">
                <div className="w-full h-1 bg-slate-700 rounded" />
                <div className="w-4/5 h-1 bg-cyan-400 rounded" />
                <div className="w-3/5 h-1 bg-blue-500 rounded" />
              </div>
            </div>
            {/* Top right cloud download */}
            <div className="absolute -top-2.5 -right-2 px-2 py-0.5 rounded-full bg-cyan-400 text-slate-950 font-bold text-[10px] shadow-[0_0_12px_#00d2ff] flex items-center gap-0.5">
              <span>↓</span>
            </div>
          </div>
        </div>
      )
    },
  ];

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col relative overflow-hidden">
      
      {/* Background radial glows */}
      <div className="absolute top-20 left-1/4 w-[600px] h-[450px] bg-blue-600/10 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute top-64 right-10 w-[450px] h-[450px] bg-cyan-500/10 blur-[130px] rounded-full pointer-events-none" />

      {/* Header & Drone Graphic Section */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-4 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left Text */}
          <div className="lg:col-span-8 space-y-4">
            <span className="text-xs font-bold tracking-[0.25em] text-cyan-400 uppercase">
              ABOUT AEROMESH
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
              From OneShot Drone Video <br />
              to <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-sky-200 to-blue-400 drop-shadow-[0_0_20px_rgba(0,210,255,0.4)]">3D Reality</span>
            </h1>

            <p className="text-slate-300 text-sm sm:text-base max-w-2xl font-normal leading-relaxed">
              AeroMesh transforms a single aerial video capture into a detailed 3D model and intelligently detects and identifies entities — giving you actionable insights, faster than ever.
            </p>
          </div>

          {/* Right Drone Illustration & Cursive Note (Screenshot 2) */}
          <div className="lg:col-span-4 relative flex flex-col items-center justify-center">
            
            {/* Drone Graphic with Glow */}
            <div className="relative w-44 h-32 flex items-center justify-center animate-float">
              <img
                src="/assets/drone_tech.jpg"
                alt="AeroMesh Drone"
                className="w-36 h-36 object-contain rounded-2xl drop-shadow-[0_0_25px_rgba(0,210,255,0.55)]"
              />
              {/* Drone underside scanning light */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-2 h-10 bg-gradient-to-b from-cyan-400 to-transparent blur-[2px]" />
            </div>

            {/* Handwritten Note matching Screenshot 2 */}
            <div className="text-cyan-300 font-mono italic text-sm tracking-wide flex items-center gap-1.5 mt-1">
              <span>One video. Endless possibilities.</span>
            </div>
          </div>

        </div>
      </section>

      {/* 5-Stage Animated Process Section (Screenshot 2) */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
        
        {/* Continuous Animated Energy Track */}
        <div className="relative w-full mb-8 hidden lg:block">
          {/* Base Dark Track */}
          <div className="w-full h-1.5 bg-[#0f1d3c] rounded-full overflow-hidden relative">
            {/* Travelling Active Light Beam */}
            <div 
              className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-sky-200 rounded-full shadow-[0_0_20px_#00d2ff] transition-all duration-100 ease-linear relative"
              style={{ width: `${progress}%` }}
            >
              <span className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-[0_0_12px_#ffffff,0_0_24px_#00d2ff] transform translate-x-1/2" />
            </div>
          </div>

          {/* 5 Indicator Checkpoints */}
          <div className="absolute -top-2 left-0 right-0 flex justify-between px-8 pointer-events-none">
            {[1, 2, 3, 4, 5].map((s) => {
              const isReached = activeCheckpoint >= s;
              return (
                <div 
                  key={s} 
                  className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isReached 
                      ? 'bg-cyan-400 border-2 border-white shadow-[0_0_14px_#00d2ff] scale-110' 
                      : 'bg-[#0f1d3c] border-2 border-[#1a2f5b]'
                  }`}
                >
                  {isReached && <span className="w-1.5 h-1.5 rounded-full bg-[#030712]" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* 5 Stage Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {stages.map((stage) => {
            const isActive = activeCheckpoint >= stage.num;
            const isCurrent = activeCheckpoint === stage.num;

            return (
              <div
                key={stage.num}
                className={`p-5 rounded-2xl transition-all duration-500 flex flex-col items-center text-center relative ${
                  isCurrent
                    ? 'bg-gradient-to-b from-[#0d1c3a] to-[#070f22] border border-cyan-400 shadow-[0_0_30px_rgba(0,210,255,0.4)] scale-[1.03]'
                    : isActive
                    ? 'bg-[#081024]/90 border border-blue-500/40 shadow-glass'
                    : 'bg-[#050b18]/80 border border-[#111e3b] opacity-80'
                }`}
              >
                {/* Visual Preview */}
                <div className="w-full mb-3">
                  {stage.icon}
                </div>

                {/* Stage Number & Title */}
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div 
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      isActive 
                        ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.6)]' 
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {stage.num}
                  </div>
                  <h3 className={`text-base font-bold transition-colors ${isActive ? 'text-white' : 'text-slate-300'}`}>
                    {stage.title}
                  </h3>
                </div>

                {/* Subtext */}
                <p className="text-xs text-slate-400 leading-relaxed">
                  {stage.description}
                </p>

                {/* Active Outline Pulse */}
                {isCurrent && (
                  <div className="absolute -inset-0.5 rounded-2xl border border-cyan-400/60 animate-pulse pointer-events-none" />
                )}
              </div>
            );
          })}
        </div>

      </section>

      {/* Why AeroMesh? Section (Screenshot 2) */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 w-full border-t border-[#0e1c3a]">
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-4 text-xs font-bold tracking-[0.25em] text-cyan-400 uppercase">
            <span className="w-14 h-[1px] bg-gradient-to-r from-transparent to-cyan-500" />
            <span>WHY AEROMESH?</span>
            <span className="w-14 h-[1px] bg-gradient-to-l from-transparent to-cyan-500" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* Card 1 */}
          <div className="p-5 rounded-2xl bg-[#081024]/90 border border-[#152549] hover:border-cyan-500/50 hover:bg-[#0c1836] transition-all duration-300 flex items-start gap-4 shadow-glass">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-cyan-400 flex-shrink-0 shadow-[0_0_12px_rgba(0,210,255,0.25)]">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm sm:text-base font-bold text-white mb-1">
                Faster Decisions
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Go from video to insights in minutes, not hours.
              </p>
            </div>
          </div>

          {/* Card 2 */}
          <div className="p-5 rounded-2xl bg-[#081024]/90 border border-[#152549] hover:border-cyan-500/50 hover:bg-[#0c1836] transition-all duration-300 flex items-start gap-4 shadow-glass">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-cyan-400 flex-shrink-0 shadow-[0_0_12px_rgba(0,210,255,0.25)]">
              <Crosshair className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm sm:text-base font-bold text-white mb-1">
                Higher Accuracy
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                AI-powered detection with precise results.
              </p>
            </div>
          </div>

          {/* Card 3 */}
          <div className="p-5 rounded-2xl bg-[#081024]/90 border border-[#152549] hover:border-cyan-500/50 hover:bg-[#0c1836] transition-all duration-300 flex items-start gap-4 shadow-glass">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-cyan-400 flex-shrink-0 shadow-[0_0_12px_rgba(0,210,255,0.25)]">
              <Box className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm sm:text-base font-bold text-white mb-1">
                Complete 3D Context
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                See your environment in full 3D detail.
              </p>
            </div>
          </div>

          {/* Card 4 */}
          <div className="p-5 rounded-2xl bg-[#081024]/90 border border-[#152549] hover:border-cyan-500/50 hover:bg-[#0c1836] transition-all duration-300 flex items-start gap-4 shadow-glass">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-cyan-400 flex-shrink-0 shadow-[0_0_12px_rgba(0,210,255,0.25)]">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm sm:text-base font-bold text-white mb-1">
                Built for Real-World Use
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                From security to construction, AeroMesh works where you do.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* Footer Divider (Screenshot 2) */}
      <footer className="mt-auto py-8 border-t border-[#0e1c3a]">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-center">
          <div className="flex items-center gap-4 text-[11px] tracking-[0.28em] text-slate-500 uppercase font-semibold">
            <span className="w-16 sm:w-32 h-[1px] bg-gradient-to-r from-transparent to-[#1a315e]" />
            <span>AEROMESH — SMARTER VISION · DEEPER INSIGHTS</span>
            <span className="w-16 sm:w-32 h-[1px] bg-gradient-to-l from-transparent to-[#1a315e]" />
          </div>
        </div>
      </footer>

    </div>
  );
};
