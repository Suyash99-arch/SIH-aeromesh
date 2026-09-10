import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Compass,
  Box,
  Activity,
  Radar,
  ScanLine,
  Sparkles,
  LucideIcon,
} from 'lucide-react';
import { Glass } from '../primitives/Glass.tsx';

export interface NavRoute {
  path: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export const NAV_ROUTES: NavRoute[] = [
  { path: '/', label: 'Mission command', icon: Compass },
  { path: '/reconstruction', label: '3D reconstruction', icon: Box },
  { path: '/scene-intelligence', label: 'Scene intelligence', icon: Activity },
  { path: '/geospatial', label: 'Geospatial', icon: Radar },
  { path: '/measurements', label: 'Measurements', icon: ScanLine },
  { path: '/findings', label: 'AI findings', icon: Sparkles, badge: 6 },
];

export const Rail: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleNav = (path: string) => {
    if (location.pathname !== path) {
      navigate(path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleNav(path);
    }
  };

  return (
    <Glass
      className="rail"
      strength={3}
      aria-label="Main Navigation"
      role="navigation"
    >
      {NAV_ROUTES.map((route) => {
        const Icon = route.icon;
        const isActive =
          route.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(route.path);

        return (
          <button
            key={route.path}
            type="button"
            className={`rail-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNav(route.path)}
            onKeyDown={(e) => handleKeyDown(e, route.path)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={route.label}
          >
            <Icon size={18} aria-hidden="true" />
            <span className="lbl">{route.label}</span>
            {route.badge !== undefined && (
              <span className="rail-badge" aria-label={`${route.badge} notifications`}>
                {route.badge}
              </span>
            )}
          </button>
        );
      })}
    </Glass>
  );
};
