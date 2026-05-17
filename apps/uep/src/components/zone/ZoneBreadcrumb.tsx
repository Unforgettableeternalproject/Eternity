import React from 'react';
import './ZoneBreadcrumb.css';

export interface BreadcrumbSegment {
  label: string;
  onClick?: () => void;
}

interface ZoneBreadcrumbProps {
  segments: BreadcrumbSegment[];
  color?: string;
  bordered?: boolean;
  className?: string;
}

export function ZoneBreadcrumb({
  segments,
  color,
  bordered,
  className,
}: ZoneBreadcrumbProps) {
  return (
    <div
      className={`zone-breadcrumb${bordered ? ' zone-breadcrumb--bordered' : ''}${className ? ` ${className}` : ''}`}
      style={color ? { color } : undefined}
    >
      <span className="zone-breadcrumb-line" />
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          {seg.onClick ? (
            <button type="button" onClick={seg.onClick}>
              {seg.label}
            </button>
          ) : (
            <span>{seg.label}</span>
          )}
          {i < segments.length - 1 && (
            <span className="zone-breadcrumb-sep">·</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
