import React, { useMemo } from 'react';

export default function GlobalScrubber({ data, startTs, scrubIndex, setScrubIndex }) {
  const maxIndex = Math.max(0, (data?.length || 0) - 1);

  const relTime = useMemo(() => {
    if (!data || scrubIndex == null || scrubIndex < 0 || scrubIndex >= data.length) return 0;
    const ts = parseFloat(data[scrubIndex]?.ts);
    return isNaN(ts) ? 0 : ts - startTs;
  }, [data, scrubIndex, startTs]);

  const duration = useMemo(() => {
    if (!data || data.length < 2) return 0;
    const first = parseFloat(data[0].ts);
    const last = parseFloat(data[data.length - 1].ts);
    if (isNaN(first) || isNaN(last)) return 0;
    return Math.max(0, last - first);
  }, [data]);

  if (!data || data.length === 0) return null;

  return (
    <div className="glass-panel no-hover" style={{
      marginBottom: '1rem',
      padding: '0.75rem 1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        Global timeline
      </span>
      <input
        type="range"
        min={0}
        max={maxIndex}
        value={Math.min(scrubIndex ?? 0, maxIndex)}
        onChange={(e) => setScrubIndex(Number(e.target.value))}
        style={{ flex: 1, minWidth: '200px', accentColor: '#00e5ff' }}
      />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-primary)', minWidth: '120px' }}>
        {relTime.toFixed(2)}s / {duration.toFixed(2)}s
      </span>
    </div>
  );
}
