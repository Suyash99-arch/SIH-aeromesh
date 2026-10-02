import React from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { NAV_ROUTES } from './Rail.tsx';

export const TopBar: React.FC = () => {
  const location = useLocation();

  const currentRoute =
    NAV_ROUTES.find((r) =>
      r.path === '/' ? location.pathname === '/' : location.pathname.startsWith(r.path)
    ) || NAV_ROUTES[0];

  return (
    <header className="topbar" role="banner">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-text">
            <div className="name font-display">HEXA SPARK</div>
            <div className="sub">AERIAL INTELLIGENCE</div>
          </div>
        </div>

        <nav aria-label="Breadcrumbs" className="crumb">
          <span>Mission Control</span>
          <ChevronRight size={13} aria-hidden="true" />
          <b aria-current="page">{currentRoute.label}</b>
        </nav>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="status-pill" role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          <span>ALL SYSTEMS OPERATIONAL</span>
        </div>
      </div>
    </header>
  );
};
