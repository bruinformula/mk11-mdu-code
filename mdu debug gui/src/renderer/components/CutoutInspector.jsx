import React, { useEffect, useState } from 'react';
import { X, Search } from 'lucide-react';

export default function CutoutInspector({ gap, startTs, filePath, onClose, onScrubToGap }) {
  const [loading, setLoading] = useState(false);
  const [frames, setFrames] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!gap || !filePath || !window.mduDebug?.parseTelemetryWindow) {
      setFrames([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const pad = 0.5;
    window.mduDebug.parseTelemetryWindow(filePath, gap.startTime - pad, gap.endTime + pad)
      .then((result) => {
        if (!cancelled) setFrames(result?.frames || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [gap, filePath]);

  if (!gap) return null;

  const relStart = gap.startTime - startTs;
  const relEnd = gap.endTime - startTs;
  const okCount = frames.filter((f) => f.decodeOk).length;
  const failCount = frames.length - okCount;

  return (
    <div className="glass-panel" style={{
      marginTop: '1rem',
      padding: '1rem',
      borderLeft: '3px solid var(--color-warning)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h3 className="section-title" style={{ marginBottom: '0.25rem', fontSize: '1rem' }}>
            <Search size={16} style={{ display: 'inline', marginRight: 6 }} />
            Cutout Inspector — {gap.label}
          </h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>
            {relStart.toFixed(2)}s – {relEnd.toFixed(2)}s ({gap.duration.toFixed(3)}s)
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {onScrubToGap && (
            <button type="button" className="button" style={{ fontSize: '0.75rem' }} onClick={() => onScrubToGap(gap)}>
              Jump timeline
            </button>
          )}
          <button type="button" className="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Parsing raw frames in window…</p>}
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem' }}>{error}</p>}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.8125rem', flexWrap: 'wrap' }}>
            <span>Frames in window: <strong>{frames.length}</strong></span>
            <span>Decoded OK: <strong style={{ color: 'var(--color-success)' }}>{okCount}</strong></span>
            <span>Failed: <strong style={{ color: failCount ? 'var(--color-danger)' : 'inherit' }}>{failCount}</strong></span>
          </div>
          {frames.length > 0 ? (
            <div className="table-wrapper" style={{ maxHeight: '200px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time (s)</th>
                    <th>ID</th>
                    <th>Data</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {frames.slice(0, 100).map((f, i) => (
                    <tr key={i}>
                      <td>{((f.tsMs / 1000) - startTs).toFixed(3)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{f.idHex || f.idDec}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{f.dataHex}</td>
                      <td style={{ color: f.decodeOk ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {f.decodeOk ? 'OK' : 'FAIL'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {frames.length > 100 && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  Showing first 100 of {frames.length} frames
                </p>
              )}
            </div>
          ) : (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              No raw frames in this window (pre-parsed CSV or empty gap).
            </p>
          )}
        </>
      )}
    </div>
  );
}
