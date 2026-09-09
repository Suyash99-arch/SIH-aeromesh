import React, { forwardRef, useImperativeHandle } from 'react';
import { useTilt } from './hooks.ts';

export interface GlassProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  strength?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  tiltEnabled?: boolean;
}

export const Glass = forwardRef<HTMLDivElement, GlassProps>(
  (
    {
      className = '',
      strength = 8,
      style,
      children,
      tiltEnabled = true,
      ...rest
    },
    forwardedRef
  ) => {
    const tiltRef = useTilt<HTMLDivElement>(tiltEnabled ? strength : 0);

    useImperativeHandle(forwardedRef, () => tiltRef.current as HTMLDivElement);

    return (
      <div
        ref={tiltRef}
        className={`glass ${className}`}
        style={style}
        {...rest}
      >
        <div className="glass-sheen" aria-hidden="true" />
        {children}
      </div>
    );
  }
);

Glass.displayName = 'Glass';
