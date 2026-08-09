import React, { useMemo } from 'react';

const CORNERS = [
  { key: '0', label: 'FL', className: 'corner-fl', shock: 'sdu[0].shock', brake: 'sdu[0].brake', wrpm: 'sdu[0].wrpm', tires: ['sdu[0].tire[0]', 'sdu[0].tire[1]', 'sdu[0].tire[2]', 'sdu[0].tire[3]'] },
  { key: '1', label: 'FR', className: 'corner-fr', shock: 'sdu[1].shock', brake: 'sdu[1].brake', wrpm: 'sdu[1].wrpm', tires: ['sdu[1].tire[0]', 'sdu[1].tire[1]', 'sdu[1].tire[2]', 'sdu[1].tire[3]'] },
  { key: '2', label: 'RL', className: 'corner-rl', shock: 'sdu[2].shock', brake: 'sdu[2].brake', wrpm: 'sdu[2].wrpm', tires: ['sdu[2].tire[0]', 'sdu[2].tire[1]', 'sdu[2].tire[2]', 'sdu[2].tire[3]'] },
  { key: '3', label: 'RR', className: 'corner-rr', shock: 'sdu[3].shock', brake: 'sdu[3].brake', wrpm: 'sdu[3].wrpm', tires: ['sdu[3].tire[0]', 'sdu[3].tire[1]', 'sdu[3].tire[2]', 'sdu[3].tire[3]'] },
];

function fmt(val, digits = 1, suffix = '') {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

export default function CarDashboard({ data, scrubIndex = null }) {
  const snapshot = useMemo(() => {
    if (!data || data.length === 0) return null;
    const idx = scrubIndex != null && scrubIndex >= 0 && scrubIndex < data.length
      ? scrubIndex
      : data.length - 1;
    return data[idx];
  }, [data, scrubIndex]);

  if (!snapshot) return null;

  return (
    <div className="glass-panel" style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title">Live Vehicle Snapshot</h2>
      <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
        Corner readings at the current scrubber position (or latest sample).
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1.2fr 1fr',
        gridTemplateRows: 'auto auto auto',
        gap: '0.75rem',
        maxWidth: '720px',
        margin: '0 auto',
      }}>
        <CornerCard corner={CORNERS[0]} row={snapshot} style={{ gridColumn: 1, gridRow: 1 }} />
        <CornerCard corner={CORNERS[1]} row={snapshot} style={{ gridColumn: 3, gridRow: 1 }} />
        <div style={{
          gridColumn: 2,
          gridRow: '1 / 4',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          background: 'rgba(0,0,0,0.25)',
          borderRadius: '12px',
          border: '1px dashed var(--border-color)',
          minHeight: '180px',
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>CHASSIS</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', textAlign: 'center', lineHeight: 1.6 }}>
            <div>GPS {fmt(snapshot['gps.vel'], 1, ' m/s')}</div>
            <div>HDOP {fmt(snapshot['gps.hdop'], 2)} · Sats {fmt(snapshot['gps.sats'], 0)}</div>
          </div>
        </div>
        <CornerCard corner={CORNERS[2]} row={snapshot} style={{ gridColumn: 1, gridRow: 3 }} />
        <CornerCard corner={CORNERS[3]} row={snapshot} style={{ gridColumn: 3, gridRow: 3 }} />
      </div>
    </div>
  );
}

function CornerCard({ corner, row, style }) {
  const maxTire = corner.tires.reduce((max, key) => {
    const v = parseFloat(row[key]);
    return isNaN(v) ? max : Math.max(max, v);
  }, -Infinity);

  return (
    <div style={{
      ...style,
      padding: '0.75rem',
      background: 'rgba(0,0,0,0.2)',
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
    }}>
      <span className={`corner-label ${corner.className}`} style={{ marginBottom: '0.5rem', display: 'inline-block' }}>
        {corner.label}
      </span>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
        <div>Brake {fmt(row[corner.brake], 1, '°C')}</div>
        <div>Shock {fmt(row[corner.shock], 1, ' mm')}</div>
        <div>RPM {fmt(row[corner.wrpm], 0)}</div>
        <div>Tire max {maxTire === -Infinity ? '—' : `${maxTire.toFixed(1)}°C`}</div>
      </div>
    </div>
  );
}
