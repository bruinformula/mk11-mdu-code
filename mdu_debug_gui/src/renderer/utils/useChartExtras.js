import { useMemo } from 'react';
import { createScrubberPlugin } from './scrubberPlugin';

export function useChartExtras(data, scrubRelativeTime, extraPlugins = []) {
  const scrubPlugin = useMemo(
    () => createScrubberPlugin(scrubRelativeTime),
    [scrubRelativeTime]
  );
  const plugins = useMemo(() => [...extraPlugins, scrubPlugin], [extraPlugins, scrubPlugin]);
  return { plugins };
}
