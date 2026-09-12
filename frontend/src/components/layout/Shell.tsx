import React, { useEffect, useState, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from './TopBar.tsx';
import { Rail, NAV_ROUTES } from './Rail.tsx';

export const Shell: React.FC = () => {
  const [ready, setReady] = useState(false);
  const location = useLocation();
  const parallaxRef = useRef<HTMLDivElement | null>(null);
  const rafParallaxRef = useRef<number | null>(null);

  // Announce route changes for accessibility
  const currentRoute =
    NAV_ROUTES.find((r) =>
      r.path === '/' ? location.pathname === '/' : location.pathname.startsWith(r.path)
    ) || NAV_ROUTES[0];

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 60);
    return () => clearTimeout(timer);
  }, []);

  // rAF throttled parallax mouse movement
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = parallaxRef.current;
    if (!el) return;

    if (rafParallaxRef.current !== null) return;

    const clientX = e.clientX;
    const clientY = e.clientY;

    rafParallaxRef.current = requestAnimationFrame(() => {
      if (el) {
        const r = el.getBoundingClientRect();
        const mx = (clientX - r.left) / r.width - 0.5;
        const my = (clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--mx', mx.toFixed(3));
        el.style.setProperty('--my', my.toFixed(3));
      }
      rafParallaxRef.current = null;
    });
  };

  useEffect(() => {
    return () => {
      if (rafParallaxRef.current !== null) {
        cancelAnimationFrame(rafParallaxRef.current);
      }
    };
  }, []);

  return (
    <div className={`aeromesh-root ${ready ? 'is-ready' : ''}`}>
      {/* Screen reader live region for route announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Navigated to {currentRoute.label}
      </div>

      <TopBar />

      <main
        id="main-content"
        className="layout-wrapper parallax"
        ref={parallaxRef}
        onMouseMove={handleMouseMove}
      >
        <div className="shell-grid">
          <Rail />
          <div className="content-area">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
};
