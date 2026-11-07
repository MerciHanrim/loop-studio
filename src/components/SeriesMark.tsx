/** a series' key: a square of its colour, or a short stretch of its line when the line
 *  carries a pattern, so the legend shows what the chart draws */
export function SeriesMark({ color, dash, className }: { color: string; dash?: string; className?: string }) {
  if (!dash) return <span className={className ? `timeline__mark ${className}` : 'timeline__mark'} style={{ background: color }} aria-hidden="true" />
  return (
    <svg className="timeline__mark timeline__mark--line" data-dash={dash} viewBox="0 0 18 8" aria-hidden="true">
      <line x1="0" y1="4" x2="18" y2="4" style={{ stroke: color, strokeDasharray: dash }} />
    </svg>
  )
}
