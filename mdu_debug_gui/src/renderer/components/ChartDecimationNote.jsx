import React from 'react';
import { getDownsampleInfo, CHART_TARGET_POINTS } from '../utils/datasetUtils';

export default function ChartDecimationNote({ data, targetPoints = CHART_TARGET_POINTS }) {
  const info = getDownsampleInfo(data, targetPoints);
  if (!info.decimated) return null;
  return (
    <p style={{
      fontSize: '0.75rem',
      color: 'var(--color-warning)',
      margin: '0 0 0.75rem 0',
      opacity: 0.9,
    }}>
      Chart shows {info.shown.toLocaleString()} of {info.total.toLocaleString()} samples (1/{info.step} decimation for performance).
    </p>
  );
}
