import { useSimStore } from '../store/simStore'

/**
 * L1 "Broken Orbit" — a near-complete circular track with a ~32° gap at the
 * 1:30 position and a signal bead sitting in the gap. The bead advances 30°
 * around the orbit on each simulation step (Reset returns it to the gap); it
 * never spins on its own. Track · Bead · Vessel — this is the Track opened out.
 */
export function Logo({ size = 16 }: { size?: number }) {
  const step = useSimStore((s) => s.stepIndex)
  const deg = 45 - step * 30 // gap centre sits at 45° (1:30); advance clockwise
  const rad = (deg * Math.PI) / 180
  const cx = 8 + 6 * Math.cos(rad)
  const cy = 8 - 6 * Math.sin(rad)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="logo"
      aria-hidden="true"
      focusable="false"
    >
      <path className="logo__track" d="M10.91 2.75 A6 6 0 1 0 13.25 5.09" />
      <circle className="logo__bead" cx={cx.toFixed(3)} cy={cy.toFixed(3)} r="2" />
    </svg>
  )
}
