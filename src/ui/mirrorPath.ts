// Issue #298 — an SVG path mirrored across the vertical centre line, as DATA.
//
// docs/localization.md §L9.3 forbids mirroring an arrow with a transform: a
// transform flips the box, not the drawing, and a test cannot read it back. The
// four arrow icons that follow the reader (external link, submenu disclosure,
// undo, redo) therefore ship two drawings, and the second is derived from the
// first here, at module load, so the pair cannot drift apart: a mirrored path
// is the same geometry with every x replaced by `width - x`, every arc sweep
// turned the other way and every arc rotation negated.
//
// Only ABSOLUTE commands are accepted (M L H V C S Q T A Z). A relative command
// would need the current point to mirror correctly, and an icon authored for
// mirroring is short enough to write absolutely; a path with a lowercase
// command throws, so a mistake is a build-time error and not a wrong arrow.

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

/** `d` mirrored across x = width / 2 */
export function mirrorPathX(d: string, width = 16): string {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? []
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    const cmd = tokens[i++]!
    if (!/^[A-Za-z]$/.test(cmd)) throw new Error(`mirrorPathX: expected a command at "${cmd}" in "${d}"`)
    if (cmd !== cmd.toUpperCase()) throw new Error(`mirrorPathX: relative command "${cmd}" in "${d}"; write the path with absolute commands`)
    const n = ARGS[cmd]
    if (n === undefined) throw new Error(`mirrorPathX: unsupported command "${cmd}" in "${d}"`)
    out.push(cmd)
    if (n === 0) continue
    // a command may be followed by several argument groups (implicit repeats)
    let groups = 0
    while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!)) {
      const nums = tokens.slice(i, i + n).map(Number)
      if (nums.length !== n || nums.some((v) => Number.isNaN(v))) throw new Error(`mirrorPathX: "${cmd}" needs ${n} numbers in "${d}"`)
      i += n
      groups++
      switch (cmd) {
        case 'H':
          out.push(fmt(width - nums[0]!))
          break
        case 'V':
          out.push(fmt(nums[0]!))
          break
        case 'A':
          out.push(fmt(nums[0]!), fmt(nums[1]!), fmt(-nums[2]!), fmt(nums[3]!), fmt(nums[4]! ? 0 : 1), fmt(width - nums[5]!), fmt(nums[6]!))
          break
        default:
          for (let k = 0; k < n; k += 2) out.push(fmt(width - nums[k]!), fmt(nums[k + 1]!))
      }
    }
    if (groups === 0) throw new Error(`mirrorPathX: "${cmd}" has no arguments in "${d}"`)
  }
  return out.join(' ')
}
