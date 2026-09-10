import { useEffect, useRef, useState } from 'react';

/**
 * useTilt hook: mouse-driven perspective tilt with rAF throttling for silky 60fps
 */
export function useTilt<T extends HTMLElement = HTMLDivElement>(strength: number = 8) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let rafId: number | null = null;
    let pendingX = 0;
    let pendingY = 0;

    const applyTransform = () => {
      if (!el) return;
      el.style.transform = `perspective(1000px) rotateX(${(-pendingY * strength).toFixed(2)}deg) rotateY(${(pendingX * strength).toFixed(2)}deg) translateZ(8px)`;
      el.style.setProperty('--gx', `${((pendingX + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${((pendingY + 0.5) * 100).toFixed(1)}%`);
      rafId = null;
    };

    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      pendingX = (e.clientX - r.left) / r.width - 0.5;
      pendingY = (e.clientY - r.top) / r.height - 0.5;

      if (rafId === null) {
        rafId = requestAnimationFrame(applyTransform);
      }
    };

    const onLeave = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)';
    };

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [strength]);

  return ref;
}

/**
 * useCountUp hook: smooth easeOutCubic telemetry counting
 */
export function useCountUp(target: number, duration: number = 1100, start: boolean = false): number {
  const [val, setVal] = useState<number>(0);

  useEffect(() => {
    if (!start) return;

    let raf: number;
    const t0 = performance.now();

    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      // Cubic ease out
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setVal(target);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);

  return val;
}
