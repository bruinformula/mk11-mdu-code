import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export default function LoadSummaryBanner({ loadMeta, dropouts = [] }) {
  if (!loadMeta) return null;

  const staleCount = loadMeta.boardStaleCount ?? 0;

  return (
    <div
      className="glass-panel no-hover"
      style={{
        marginBottom: '1rem',
        padding: '0.75rem 1rem',
        borderLeft: loadMeta.decimated ? '3px solid var(--color-warning)' : '3px solid var(--color-info)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        alignItems: 'flex-start',
        fontSize: '0.8125rem',
      }}
    >
      {loadMeta.decimated ? (
        <AlertTriangle size={18} className="text-amber-400" style={{ flexShrink: 0, marginTop: 2 }} />
      ) : (
        <Info size={18} className="text-blue-400" style={{ flexShrink: 0, marginTop: 2 }} />
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <strong style={{ color: 'var(--text-primary)' }}>
          {loadMeta.fileName || 'Loaded run'}
          {' · '}
          {loadMeta.format || 'unknown format'}
        </strong>
        <span style={{ color: 'var(--text-secondary)' }}>
          {loadMeta.rowCountAfter?.toLocaleString()} rows loaded
          {loadMeta.decimated && (
            <> (decimated from {loadMeta.rowCountBefore?.toLocaleString()}, step {loadMeta.decimationStep})</>
          )}
          {loadMeta.durationSec != null && <> · {loadMeta.durationSec.toFixed(1)}s duration</>}
          {loadMeta.parseStats && (
            <> · {loadMeta.parseStats.framesOk} frames decoded
              {loadMeta.parseStats.framesFailed > 0 && (
                <>, {loadMeta.parseStats.framesFailed} failed</>
              )}
            </>
          )}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {dropouts.length} logger gap{dropouts.length !== 1 ? 's' : ''}
          {staleCount > 0 && <>, {staleCount} subsystem stale period{staleCount !== 1 ? 's' : ''}</>}
          {loadMeta.effectiveHz != null && <> · ~{loadMeta.effectiveHz.toFixed(1)} Hz effective</>}
        </span>
      </div>
    </div>
  );
}
