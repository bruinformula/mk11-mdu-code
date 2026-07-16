/**
 * Draws a vertical scrub/playhead line at the current global time position.
 */
export function createScrubberPlugin(scrubRelativeTime) {
  return {
    id: 'globalScrubber',
    beforeDraw(chart) {
      if (scrubRelativeTime == null || isNaN(scrubRelativeTime)) return;
      const xScale = chart.scales?.x;
      const yScale = chart.scales?.y;
      if (!xScale || !yScale) return;
      const x = xScale.getPixelForValue(scrubRelativeTime);
      if (x < xScale.left || x > xScale.right) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 229, 255, 0.9)';
      ctx.font = 'bold 9px var(--font-sans)';
      ctx.textAlign = 'center';
      ctx.fillText('▶', x, yScale.top + 10);
      ctx.restore();
    },
  };
}
