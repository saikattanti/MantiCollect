'use client';

import React, { useMemo } from 'react';
import { formatSpeed } from '@/lib/format.js';
import { Activity } from 'lucide-react';

/**
 * Lightweight SVG rolling download-speed graph (IDM-inspired).
 * Renders real speed samples across a ~60-second window with zero external chart dependencies.
 */
export default function SpeedGraph({
  history = [],
  currentSpeed = null,
  avgSpeed = null,
  height = 90,
  className = ''
}) {
  const points = useMemo(() => {
    if (!Array.isArray(history)) return [];
    return history.filter((p) => p && typeof p.speed === 'number');
  }, [history]);

  const maxSpeed = useMemo(() => {
    const recordedMax = points.reduce((m, p) => Math.max(m, p.speed || 0), 0);
    const curr = currentSpeed || 0;
    const peak = Math.max(recordedMax, curr);
    // Round up to a pleasant ceiling (minimum 100 KB/s to give perspective)
    return Math.max(peak, 100 * 1024);
  }, [points, currentSpeed]);

  if (points.length < 2 && (!currentSpeed || currentSpeed <= 0)) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-xl border border-line/60 bg-surface-2/30 px-4 py-3 text-center ${className}`}
        style={{ minHeight: height }}
      >
        <Activity className="text-t3/50" style={{ width: 18, height: 18 }} />
        <p className="mt-1.5 text-xs text-t3">Awaiting transfer speed measurements…</p>
      </div>
    );
  }

  const width = 360;
  const graphH = height - 32; // Reserve space for header readouts
  const padBottom = 6;
  const padTop = 6;
  const usableH = graphH - padTop - padBottom;

  // Generate SVG path points
  const coords = points.map((p, idx) => {
    const x = points.length === 1 ? width : (idx / (points.length - 1)) * width;
    const norm = Math.min(1, Math.max(0, p.speed / maxSpeed));
    const y = padTop + usableH * (1 - norm);
    return { x, y };
  });

  const lineD = coords.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`, '');
  const areaD = coords.length
    ? `${lineD} L ${coords[coords.length - 1].x.toFixed(1)},${padTop + usableH} L ${coords[0].x.toFixed(1)},${padTop + usableH} Z`
    : '';

  const latestPoint = coords.length ? coords[coords.length - 1] : null;

  return (
    <div className={`overflow-hidden rounded-xl border border-line/60 bg-surface-2/40 p-3 select-none ${className}`}>
      {/* Header bar with readouts */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-accent pulse-dot" aria-hidden />
          <span className="font-medium text-t1 tabular-nums">
            {formatSpeed(currentSpeed || (points.length ? points[points.length - 1].speed : 0)) || '0 B/s'}
          </span>
          <span className="text-[10px] text-t3">current</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-t3">
          {avgSpeed != null && avgSpeed > 0 && (
            <span>
              avg <strong className="font-semibold text-t2 tabular-nums">{formatSpeed(avgSpeed)}</strong>
            </span>
          )}
          <span>
            peak <strong className="font-semibold text-t2 tabular-nums">{formatSpeed(maxSpeed)}</strong>
          </span>
        </div>
      </div>

      {/* SVG graph area */}
      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${width} ${graphH}`}
          className="w-full overflow-visible"
          style={{ height: graphH }}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Download speed graph. Current: ${formatSpeed(currentSpeed || 0)}, Peak: ${formatSpeed(maxSpeed)}`}
        >
          <defs>
            <linearGradient id="speedAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mv-accent)" stopOpacity="0.32" />
              <stop offset="95%" stopColor="var(--mv-accent)" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="speedLineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--mv-accent-2)" />
              <stop offset="100%" stopColor="var(--mv-accent)" />
            </linearGradient>
          </defs>

          {/* Gridlines */}
          <line
            x1="0"
            y1={padTop}
            x2={width}
            y2={padTop}
            stroke="var(--mv-line)"
            strokeDasharray="3 3"
            strokeWidth="0.75"
          />
          <line
            x1="0"
            y1={padTop + usableH / 2}
            x2={width}
            y2={padTop + usableH / 2}
            stroke="var(--mv-line)"
            strokeDasharray="3 3"
            strokeWidth="0.5"
            strokeOpacity="0.6"
          />
          <line
            x1="0"
            y1={padTop + usableH}
            x2={width}
            y2={padTop + usableH}
            stroke="var(--mv-line)"
            strokeWidth="1"
          />

          {/* Area fill */}
          {areaD && <path d={areaD} fill="url(#speedAreaGrad)" />}

          {/* Stroke path */}
          {lineD && (
            <path
              d={lineD}
              fill="none"
              stroke="url(#speedLineGrad)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Current head dot */}
          {latestPoint && (
            <circle
              cx={latestPoint.x}
              cy={latestPoint.y}
              r="3.5"
              fill="var(--mv-accent)"
              stroke="#ffffff"
              strokeWidth="1.5"
              className="filter drop-shadow-xs"
            />
          )}
        </svg>

        {/* Timeline labels */}
        <div className="mt-1 flex items-center justify-between text-[10px] text-t3/80">
          <span>~60s ago</span>
          <span>30s</span>
          <span>Now</span>
        </div>
      </div>
    </div>
  );
}
