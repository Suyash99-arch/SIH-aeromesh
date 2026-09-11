import React from 'react';
import { Link } from 'react-router-dom';
import { Play, ArrowRight, Clock, Box, Crosshair, BarChart3, ShieldCheck } from 'lucide-react';
import { BuildingViewer } from '../components/BuildingViewer';

export const HomePage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#020a18] text-slate-100 flex flex-col relative overflow-hidden">
      
      {/* Background Aerial Night City Blur with Dark Vignette */}
      <div className="absolute top-0 right-0 w-full lg:w-[65%] h-[680px] pointer-events-none overflow-hidden opacity-30 mix-blend-screen">
        <img
          src="/assets/night_aerial_city.jpg"
          alt="Aerial Night City Backdrop"
          className="w-full h-full object-cover object-center filter blur-[2px] transform scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#020a18] via-[#020a18]/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#020a18] via-transparent to-[#020a18]" />
      </div>

      {/* Enhanced Atmospheric Ambient Glows — richer, deeper colors */}
      <div className="absolute top-[15%] right-[20%] w-[600px] h-[600px] bg-blue-600/20 blur-[160px] rounded-full pointer-events-none" />
      <div className="absolute top-[10%] right-[35%] w-[400px] h-[400px] bg-cyan-500/15 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute top-40 left-8 w-[350px] h-[350px] bg-indigo-500/12 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[20%] right-[10%] w-[300px] h-[300px] bg-sky-400/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Hero Section */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-14 lg:pt-14 lg:pb-20 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          
          {/* Left Hero Content */}
          <div className="lg:col-span-6 z-10 flex flex-col justify-center space-y-6">
            
            {/* Tagline */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold tracking-[0.28em] uppercase">
                <span className="text-slate-400">FROM</span>{' '}
                <span className="text-cyan-400">SKY</span>{' '}
                <span className="text-slate-400">TO</span>{' '}
                <span className="text-cyan-400">STRUCTURE</span>
              </span>
            </div>

            {/* Brand Hero Title */}
            <h1 className="text-5xl sm:text-6xl xl:text-7xl font-extrabold tracking-tight">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-cyan-400 drop-shadow-[0_0_25px_rgba(0,210,255,0.4)]">
                AeroMesh
              </span>
            </h1>

            {/* Subtitle */}
            <h2 className="text-2xl sm:text-3xl xl:text-4xl font-bold tracking-normal leading-snug text-slate-100 italic">
              Turning Aerial Views into <br className="hidden sm:inline" />
              <span className="text-cyan-300 not-italic font-extrabold">Smarter Insights</span>
            </h2>

            {/* Paragraph */}
            <p className="text-slate-400 text-sm sm:text-base leading-relaxed max-w-lg font-normal">
              We bring buildings to life — with precision, clarity and
              a new perspective.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              {/* New Analysis Button */}
              <Link
                to="/new-analysis"
                className="group flex items-center gap-3 px-6 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold text-sm shadow-[0_0_30px_rgba(0,150,255,0.5)] hover:shadow-[0_0_45px_rgba(0,200,255,0.7)] transition-all duration-300 transform hover:-translate-y-0.5"
              >
                <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                  <Play className="w-2.5 h-2.5 fill-white text-white translate-x-0.5" />
                </div>
                <span>New Analysis</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>

              {/* History Button */}
              <Link
                to="/history"
                className="group flex items-center gap-3 px-6 py-3.5 rounded-xl bg-[#071028]/90 hover:bg-[#0c1a3a] border border-[#1a3060] hover:border-cyan-500/50 text-slate-300 hover:text-white font-semibold text-sm shadow-[0_4px_24px_rgba(0,0,0,0.5)] transition-all duration-300"
              >
                <Clock className="w-4 h-4 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                <span>History</span>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 group-hover:text-cyan-400 transition-all" />
              </Link>
            </div>

          </div>

          {/* Right — 3D Rotating Building */}
          <div className="lg:col-span-6 relative h-[440px] sm:h-[520px] lg:h-[580px] w-full flex items-center justify-center">
            <BuildingViewer />
          </div>

        </div>
      </section>

      {/* About Feature Preview Section */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 w-full border-t border-[#0c1a36]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          
          {/* Left Text */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold tracking-[0.25em] text-cyan-400 uppercase">
                ABOUT
              </span>
              <span className="w-12 h-[1px] bg-cyan-500/40" />
            </div>

            <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug">
              More Than Just a Model <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-sky-400">It's a Complete View</span>
            </h3>

            <p className="text-slate-400 text-xs sm:text-sm leading-relaxed pt-2">
              <strong className="text-slate-200 font-semibold">AeroMesh</strong> helps you transform a simple aerial video into a detailed, interactive 3D representation of your building or site. Explore, analyze and understand your space like never before — with a smooth, immersive and intuitive experience.
            </p>
          </div>

          {/* Right Feature Cards (2x2 Grid) */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Card 1: 3D Reconstruction */}
            <div className="p-5 rounded-2xl bg-[#061024]/90 border border-[#142040] hover:border-cyan-500/40 hover:bg-[#0a1830] transition-all duration-300 group flex items-start gap-4 shadow-glass backdrop-blur-sm">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600/25 to-cyan-500/15 border border-blue-500/25 flex items-center justify-center text-cyan-400 group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(0,180,255,0.35)] transition-all flex-shrink-0">
                <Box className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  3D Reconstruction
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Convert aerial footage into an accurate 3D model of your building or structure.
                </p>
              </div>
            </div>

            {/* Card 2: Explore in 360° */}
            <div className="p-5 rounded-2xl bg-[#061024]/90 border border-[#142040] hover:border-cyan-500/40 hover:bg-[#0a1830] transition-all duration-300 group flex items-start gap-4 shadow-glass backdrop-blur-sm">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600/25 to-cyan-500/15 border border-blue-500/25 flex items-center justify-center text-cyan-400 group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(0,180,255,0.35)] transition-all flex-shrink-0">
                <Crosshair className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  Explore in 360°
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Rotate, zoom and navigate your model from every angle with ease.
                </p>
              </div>
            </div>

            {/* Card 3: Detailed Analysis */}
            <div className="p-5 rounded-2xl bg-[#061024]/90 border border-[#142040] hover:border-cyan-500/40 hover:bg-[#0a1830] transition-all duration-300 group flex items-start gap-4 shadow-glass backdrop-blur-sm">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600/25 to-cyan-500/15 border border-blue-500/25 flex items-center justify-center text-cyan-400 group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(0,180,255,0.35)] transition-all flex-shrink-0">
                <BarChart3 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  Detailed Analysis
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Get valuable insights and measurements to make smarter decisions.
                </p>
              </div>
            </div>

            {/* Card 4: Future Ready */}
            <div className="p-5 rounded-2xl bg-[#061024]/90 border border-[#142040] hover:border-cyan-500/40 hover:bg-[#0a1830] transition-all duration-300 group flex items-start gap-4 shadow-glass backdrop-blur-sm">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600/25 to-cyan-500/15 border border-blue-500/25 flex items-center justify-center text-cyan-400 group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(0,180,255,0.35)] transition-all flex-shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  Future Ready
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  A smarter way to visualize, plan and manage your spaces.
                </p>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* Footer Branding Divider */}
      <footer className="mt-auto py-8 border-t border-[#0c1a36]">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-center">
          <div className="flex items-center gap-4 text-[11px] tracking-[0.28em] text-slate-500 uppercase font-semibold">
            <span className="w-16 sm:w-32 h-[1px] bg-gradient-to-r from-transparent to-[#1a315e]" />
            <span>AEROMESH — BETTER VISION · SMARTER TOMORROW</span>
            <span className="w-16 sm:w-32 h-[1px] bg-gradient-to-l from-transparent to-[#1a315e]" />
          </div>
        </div>
      </footer>

    </div>
  );
};
