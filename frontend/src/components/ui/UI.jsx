import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import Icon from "./Icon";

export function CountUp({ value, duration = 700, formatter = (v) => v }) {
  const prefersReducedMotion = useReducedMotion();
  const numericValue = Number(value) || 0;
  const decimals = Number.isInteger(numericValue) ? 0 : 2;
  const [display, setDisplay] = useState(
    prefersReducedMotion ? numericValue : 0,
  );

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplay(numericValue);
      return undefined;
    }

    let rafId = 0;
    let startTime = null;

    const tick = (time) => {
      if (startTime === null) startTime = time;
      const progress = Math.min((time - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Number((numericValue * eased).toFixed(decimals));
      setDisplay(next);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [decimals, duration, numericValue, prefersReducedMotion]);

  return <>{formatter(display)}</>;
}

export function Button({
  children,
  icon,
  variant = "secondary",
  className = "",
  ...props
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={`button ${variant} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} size={15} />} {children}
    </motion.button>
  );
}

export function Status({ children, tone = "success" }) {
  return (
    <span className={`status ${tone}`}>
      <i />
      {children}
    </span>
  );
}

export function Panel({ children, className = "", ...props }) {
  return (
    <motion.section
      className={`panel ${className}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      {...props}
    >
      {children}
    </motion.section>
  );
}

export function Progress({ value, duration = 800 }) {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [width, setWidth] = useState(prefersReducedMotion ? value : 0);

  useEffect(() => {
    if (prefersReducedMotion) {
      setWidth(value);
      return undefined;
    }

    const frame = requestAnimationFrame(() => setWidth(value));
    return () => cancelAnimationFrame(frame);
  }, [prefersReducedMotion, value]);

  return (
    <div className="progress">
      <span
        style={{
          width: `${width}%`,
          transition: prefersReducedMotion
            ? "none"
            : `width ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      />
    </div>
  );
}

export function Metric({ icon, label, value, detail, tone = "cyan" }) {
  return (
    <Panel className="metric">
      <div className={`metric-icon ${tone}`}>
        <Icon name={icon} />
      </div>
      <div>
        <span className="eyebrow">{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <svg className="spark" viewBox="0 0 80 24" aria-hidden="true">
        <path d="M1 20 L12 16 L22 18 L33 9 L45 13 L56 5 L68 10 L79 2" />
      </svg>
    </Panel>
  );
}

export function Pipeline({ progress = 72 }) {
  const steps = [
    ["01", "Frame extraction", "Complete"],
    ["02", "Visual odometry", "Complete"],
    ["03", "3D reconstruction", `${progress}%`, "active"],
    ["04", "AI scene analysis", "Waiting"],
  ];

  return (
    <div className="pipeline">
      {steps.map(([n, t, s, active]) => (
        <div className={`pipeline-step ${active || ""}`} key={n}>
          <span>{n}</span>
          <strong>{t}</strong>
          <small>
            {s === "Complete" ? "✓ " : "● "}
            {s}
          </small>
        </div>
      ))}
    </div>
  );
}
