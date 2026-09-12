import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Compass,
  Box,
  Radio,
  Plane,
  Shield,
  Clock,
  ArrowRight,
  BatteryCharging,
  Wifi,
  Eye,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { Glass } from '../../components/primitives/Glass.tsx';

export const MissionCommandPage: React.FC = () => {
  const navigate = useNavigate();

  const missions = [
    {
      id: 'north-ridge-01',
      title: 'North Ridge · Sector 01',
      status: 'RECONSTRUCTION READY',
      drone: 'AEROMESH V4 · UNIT ALPHA',
      battery: '88%',
      signal: '98%',
      cameras: 20,
      points: '5,252 pts',
      error: '0.55 px',
      highlight: true,
    },
    {
      id: 'downtown-perimeter-grid',
      title: 'Downtown Perimeter Grid',
      status: 'VIDEO CAPTURE COMPLETE',
      drone: 'AEROMESH V4 · UNIT BETA',
      battery: '64%',
      signal: '92%',
      cameras: 20,
      points: '4,466 pts',
      error: '0.55 px',
      highlight: false,
    },
    {
      id: 'harbor-coastal-approach',
      title: 'Harbor Coastal Approach',
      status: 'RECONSTRUCTION READY',
      drone: 'AEROMESH V3 · UNIT GAMMA',
      battery: '94%',
      signal: '99%',
      cameras: 20,
      points: '2,357 pts',
      error: '0.49 px',
      highlight: false,
    },
  ];

  return (
    <div className="mission-command-layout">
      {/* Unified Cockpit Command Card */}
      <Glass className="cockpit-connected-card" strength={3}>
        <div className="viewport-head">
          <div className="viewport-title">
            <Compass size={16} color="var(--cyan)" aria-hidden="true" />
            <h2>Mission Command & Aerial Sortie Operations</h2>
            <span className="badge cyan">ACTIVE AIRSPACE</span>
            <span className="badge">AUTONOMOUS FLIGHT MESH</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="icon-btn primary-action"
              onClick={() => navigate('/reconstruction?scene=north-ridge-01')}
            >
              <Box size={14} aria-hidden="true" /> Launch 3D Reconstruction
            </button>
          </div>
        </div>

        <div className="cockpit-body">
          <div className="cockpit-hero">
            <div className="hero-eyebrow">
              <span className="badge cyan">PRIMARY SORTIE TARGET</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>
                LAT 37.7749° N · LON 122.4194° W
              </span>
            </div>
            <h1 className="font-display hero-title">North Ridge · Sector 01</h1>
            <p className="hero-desc">
              High-density photogrammetric aerial pass complete. 20 registered multi-angle camera stations.
              Sparse 3D point cloud reconstructed with 0.55 px mean reprojection error and 85 spatial object tracks.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="icon-btn primary-action"
                onClick={() => navigate('/reconstruction?scene=north-ridge-01')}
              >
                <Eye size={14} aria-hidden="true" /> Open 3D Viewport <ArrowRight size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => navigate('/reconstruction?scene=downtown-perimeter-grid')}
              >
                Open Downtown Grid
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => navigate('/reconstruction?scene=harbor-coastal-approach')}
              >
                Open Harbor Approach
              </button>
            </div>
          </div>

          <div className="cockpit-telemetry-dock">
            <div className="dock-header font-display">AIRFRAME TELEMETRY DOCK</div>
            <div className="row-kv">
              <span className="k">Drone Airframe</span>
              <span className="v mono">AEROMESH-01</span>
            </div>
            <div className="row-kv">
              <span className="k">Flight Mode</span>
              <span className="v mono" style={{ color: 'var(--cyan)' }}>
                AUTONOMOUS ORBIT
              </span>
            </div>
            <div className="row-kv">
              <span className="k">Telemetry Uplink</span>
              <span className="v mono" style={{ color: 'var(--status-active)' }}>
                CONNECTED (5.8 GHz)
              </span>
            </div>
            <div className="row-kv">
              <span className="k">Scale Calibration</span>
              <span className="v mono" style={{ color: 'var(--amber)' }}>
                RELATIVE SCALE
              </span>
            </div>
          </div>
        </div>
      </Glass>

      {/* Sortie Section with Integrated Header */}
      <div className="sortie-section">
        <div className="section-eyebrow-row">
          <span className="section-label">
            Active Sortie Sorts & 3D Reconstruction Targets
          </span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>
            3 SECTORS OPERATIONAL
          </span>
        </div>

        <div className="mission-grid">
          {missions.map((m) => (
            <Glass
              key={m.id}
              className={`mission-card ${m.highlight ? 'featured' : ''}`}
              strength={3}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/reconstruction?scene=${m.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/reconstruction?scene=${m.id}`);
                }
              }}
              aria-label={`Open 3D reconstruction for ${m.title}`}
            >
              <div className="mission-card-head">
                <div>
                  <div className="m-title font-display">{m.title}</div>
                  <div className="m-drone mono">{m.drone}</div>
                </div>
                <span className={`badge ${m.highlight ? 'cyan' : ''}`}>{m.status}</span>
              </div>

              <div className="mission-card-stats">
                <div className="m-stat">
                  <span className="k">BATTERY</span>
                  <span className="v mono">
                    <BatteryCharging
                      size={13}
                      color="var(--status-active)"
                      style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }}
                    />
                    {m.battery}
                  </span>
                </div>
                <div className="m-stat">
                  <span className="k">UPLINK</span>
                  <span className="v mono">
                    <Wifi
                      size={13}
                      color="var(--cyan)"
                      style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }}
                    />
                    {m.signal}
                  </span>
                </div>
                <div className="m-stat">
                  <span className="k">CAMERAS</span>
                  <span className="v mono">{m.cameras} STATIONS</span>
                </div>
                <div className="m-stat">
                  <span className="k">POINT CLOUD</span>
                  <span className="v mono">{m.points}</span>
                </div>
              </div>

              <div className="mission-card-foot">
                <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)', fontWeight: 600 }}>
                  OPEN 3D RECONSTRUCTION
                </span>
                <ChevronRight size={14} color="var(--cyan)" />
              </div>
            </Glass>
          ))}
        </div>
      </div>

      {/* Global Telemetry Strip */}
      <div className="strip" aria-label="Global sortie telemetry metrics">
        <Glass className="stat-card" strength={4}>
          <div className="stat-top">
            <span className="stat-label">Active Airframes</span>
            <div className="glowing-icon-circle sm">
              <Plane size={15} aria-hidden="true" />
            </div>
          </div>
          <div className="stat-value">3 AIRFRAMES</div>
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>2 in flight · 1 on pad</div>
        </Glass>
        <Glass className="stat-card" strength={4}>
          <div className="stat-top">
            <span className="stat-label">Total Missions</span>
            <div className="glowing-icon-circle sm">
              <Shield size={15} aria-hidden="true" />
            </div>
          </div>
          <div className="stat-value">48 SORTIES</div>
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>100% mission safety index</div>
        </Glass>
        <Glass className="stat-card" strength={4}>
          <div className="stat-top">
            <span className="stat-label">Flight Hours</span>
            <div className="glowing-icon-circle sm">
              <Clock size={15} aria-hidden="true" />
            </div>
          </div>
          <div className="stat-value">128.4 HRS</div>
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>Zero loss of telemetry</div>
        </Glass>
        <Glass className="stat-card" strength={4}>
          <div className="stat-top">
            <span className="stat-label">Spatial Nodes</span>
            <div className="glowing-icon-circle sm">
              <Radio size={15} aria-hidden="true" />
            </div>
          </div>
          <div className="stat-value">6 NODES</div>
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>Decentralized mesh sync</div>
        </Glass>
      </div>
    </div>
  );
};
