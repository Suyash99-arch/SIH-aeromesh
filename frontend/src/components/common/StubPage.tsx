import React from 'react';
import { LucideIcon, Radio, Cpu, ShieldCheck, Terminal } from 'lucide-react';
import { Glass } from '../primitives/Glass.tsx';

export interface StubPageProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  statusBadge?: string;
  sector?: string;
  moduleCode?: string;
  telemetry: Array<{
    label: string;
    value: string;
    subtext: string;
  }>;
}

export const StubPage: React.FC<StubPageProps> = ({
  title,
  subtitle,
  icon: Icon,
  statusBadge = 'INITIALIZING PROTOCOL',
  sector = 'SECTOR 04 · AIRSPACE GRID',
  moduleCode = 'MOD-884',
  telemetry,
}) => {
  return (
    <div className="stub-page-layout">
      <Glass className="viewport-panel" strength={3}>
        <div className="viewport-head">
          <div className="viewport-title">
            <Icon size={16} color="var(--cyan)" aria-hidden="true" />
            <h2>{title}</h2>
            <span className="badge cyan">{sector}</span>
            <span className="badge warn">{statusBadge}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="mono" style={{ fontSize: 13, color: 'var(--dim)', letterSpacing: '0.05em' }}>
              CODE: {moduleCode}
            </span>
          </div>
        </div>

        <div className="stub-body">
          {/* Decorative HUD crosshairs & telemetry */}
          <div className="hud-corner hud-topleft glass">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--cyan)', fontSize: 13, fontWeight: 600 }}>
              <Radio size={14} /> TELEMETRY STREAM
            </div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
              UPLINK: 48.2 Mbps · LATENCY: 12ms
            </div>
          </div>

          <div className="hud-corner hud-topright glass">
            <div className="mono" style={{ color: 'var(--cyan)', fontSize: 13, fontWeight: 600 }}>
              SEC-ACTIVE
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.05em' }}>SYNCHRONIZED</div>
          </div>

          {/* Centerpiece HUD visual */}
          <div className="stub-center">
            <div className="stub-radar-ring">
              <div className="stub-radar-sweep" />
              <div className="stub-icon-glow">
                <Icon size={36} color="var(--cyan)" />
              </div>
            </div>
            <h3 className="font-display stub-headline">{title}</h3>
            <p className="stub-subtext">{subtitle}</p>

            <div className="stub-status-pill">
              <Cpu size={15} color="var(--cyan)" />
              <span className="mono" style={{ fontSize: 13, letterSpacing: '0.04em' }}>
                AIR-MESH DEPLOYMENT QUEUED FOR THIS NODE
              </span>
            </div>
          </div>

          <div className="hud-corner hud-bottomleft glass">
            <div style={{ display: 'flex', gap: 18 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>SYSTEM KERNEL</div>
                <div className="mono" style={{ fontSize: 13, color: 'var(--text-bright)', marginTop: 2 }}>AERO-OS v2.4.9</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>INTEGRITY</div>
                <div className="mono" style={{ fontSize: 13, color: '#4ee38a', fontWeight: 600, marginTop: 2 }}>VERIFIED</div>
              </div>
            </div>
          </div>
        </div>
      </Glass>

      {/* Telemetry Strip for Stub Page */}
      <div className="strip stub-strip">
        {telemetry.map((t) => (
          <Glass key={t.label} className="stat-card" strength={5}>
            <div className="stat-top">
              <span className="stat-label">{t.label}</span>
              <div className="glowing-icon-circle sm">
                <ShieldCheck size={15} />
              </div>
            </div>
            <div className="stat-value">{t.value}</div>
            <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 4 }}>{t.subtext}</div>
          </Glass>
        ))}
      </div>
    </div>
  );
};
