// Small SVG charts for the dashboard. Hand-made to keep the bundle light; colours come
// from the theme, so they work in light and dark mode.
import { useState } from 'react';

// Vertical bars with a hover readout. `data` is [{ label, value, hint }].
export function BarChart({ data, height = 160, unit = '' }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 6;
  const width = 100 / data.length;
  const active = hover ?? data.length - 1;

  return (
    <div className="bar-chart">
      <p className="chart-readout">
        <b>{data[active]?.value ?? 0}</b> {unit}
        <span className="faint"> · {data[active]?.hint ?? data[active]?.label}</span>
      </p>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={`Bar chart of ${unit}`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="100" y1={height * f} y2={height * f} className="chart-grid" vectorEffect="non-scaling-stroke" />
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.value ? 3 : 1.5, (d.value / max) * (height - 8));
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * width} y="0" width={width} height={height} fill="transparent" />
              <rect
                x={i * width + gap / data.length}
                y={height - h}
                width={width - (2 * gap) / data.length}
                height={h}
                rx="1.2"
                className={`chart-bar ${i === active ? 'is-active' : ''} ${d.value ? '' : 'is-zero'}`}
              />
            </g>
          );
        })}
      </svg>
      <div className="chart-axis">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

// A ring split into segments. `segments` is [{ label, value, color }].
export function Donut({ segments, size = 148, thickness = 18, centerLabel }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={thickness} className="donut-track" />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const length = (s.value / total) * circumference;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${Math.max(0, length - 2)} ${circumference}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  className="donut-segment"
                >
                  <title>{`${s.label}: ${s.value}`}</title>
                </circle>
              );
              offset += length;
              return el;
            })}
        <text x="50%" y="48%" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="50%" y="62%" textAnchor="middle" className="donut-caption">
          {centerLabel}
        </text>
      </svg>
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="legend-dot" style={{ background: s.color }} />
            {s.label}
            <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Horizontal progress rows: [{ label, value, total, aside, tone }].
export function ProgressList({ rows, empty }) {
  if (!rows.length) return <p className="faint small">{empty}</p>;
  return (
    <ul className="progress-list">
      {rows.map((row) => {
        const pct = row.total ? Math.round((row.value / row.total) * 100) : 0;
        return (
          <li key={row.key ?? row.label}>
            <div className="progress-list-head">
              <span className="progress-list-label">{row.label}</span>
              <span className="faint small">{row.aside ?? `${pct}%`}</span>
            </div>
            <div className={`progress ${row.tone ?? ''}`}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
