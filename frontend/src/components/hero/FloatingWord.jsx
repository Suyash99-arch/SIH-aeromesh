import React, { useRef, useState } from 'react';
import './FloatingWord.css';

/**
 * FloatingWord micro-interaction component:
 * - Subtle idle floating animation (vertical float)
 * - Proximity / hover reaction: brief spark / glow burst + 3D tilt perspective rotation
 * - Restrained, premium aerospace aesthetic
 */
export default function FloatingWord({
  children,
  className = '',
  sparkColor = 'cyan', // 'cyan' | 'violet'
  as: Component = 'span',
}) {
  const ref = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  const [sparkActive, setSparkActive] = useState(false);
  const [transformStyle, setTransformStyle] = useState('');
  const timeoutRef = useRef(null);

  const handleMouseEnter = () => {
    setIsHovered(true);
    setSparkActive(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setSparkActive(false);
    }, 700);
  };

  const handleMouseMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    // Subtle 3D perspective rotation (max 7 deg)
    const rotX = (-y * 7).toFixed(2);
    const rotY = (x * 7).toFixed(2);
    setTransformStyle(`perspective(400px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(6px)`);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTransformStyle('');
  };

  return (
    <Component
      ref={ref}
      className={`floating-word-interactive ${isHovered ? 'hovered' : ''} ${
        sparkActive ? `spark-burst-${sparkColor}` : ''
      } ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: transformStyle || undefined,
      }}
    >
      <span className="floating-word-inner">{children}</span>
      {sparkActive && <span className="floating-spark-flare" aria-hidden="true" />}
    </Component>
  );
}
