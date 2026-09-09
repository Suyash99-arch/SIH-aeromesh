import { useEffect } from 'react';

/**
 * AmbientCursorGlow Component
 * Renders a GPU-cheap, soft cyan-violet radial glow layer that smoothly trails
 * the user's cursor with easing/lag. Uses a single rAF loop that automatically
 * sleeps when idle, eliminating per-frame React re-renders and preventing GPU/paint
 * competition with 3D WebGL viewports.
 */
export default function AmbientCursorGlow() {
  useEffect(() => {
    let currentX = window.innerWidth * 0.5;
    let currentY = window.innerHeight * 0.4;
    let targetX = currentX;
    let targetY = currentY;
    let rafId = null;
    let isMoving = false;

    const updateCssVars = () => {
      document.documentElement.style.setProperty('--cursor-x', `${currentX.toFixed(1)}px`);
      document.documentElement.style.setProperty('--cursor-y', `${currentY.toFixed(1)}px`);
    };

    updateCssVars();

    const loop = () => {
      // Smooth lag / easing towards cursor target
      const dx = targetX - currentX;
      const dy = targetY - currentY;
      currentX += dx * 0.085;
      currentY += dy * 0.085;

      updateCssVars();

      // If close enough to target, stop loop to save CPU & GPU cycles
      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
        rafId = requestAnimationFrame(loop);
      } else {
        currentX = targetX;
        currentY = targetY;
        updateCssVars();
        rafId = null;
        isMoving = false;
      }
    };

    const handlePointerMove = (e) => {
      targetX = e.clientX;
      targetY = e.clientY;

      if (!isMoving) {
        isMoving = true;
        if (rafId === null) {
          rafId = requestAnimationFrame(loop);
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return <div className="ambient-cursor-glow" aria-hidden="true" />;
}
