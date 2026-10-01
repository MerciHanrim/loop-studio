// Issue #296 — what a release-note list must satisfy. Pure: the build check
// (`scripts/check-change-declaration.mjs`) and the unit tests call the same
// function, so the rule is written once.
//
// It takes the list as plain data rather than importing it, so a test can hand
// it a broken list.

export type ReleaseNoteLike = {
  id: unknown
  version: unknown
  date: unknown
  items: unknown
}

/** locale code -> its whole catalog. When given, every item key must exist as a
 *  non-empty string in EVERY locale: there is no English fallback for a release
 *  note. */
export type Catalogs = Readonly<Record<string, Readonly<Record<string, string>>>>

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const ID = /^release:(.+)$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
export const MIN_ITEMS = 3
export const MAX_ITEMS = 5

/** `x.y.z` only. Returns null for anything else. */
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null
  const m = SEMVER.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** negative when a < b, 0 when equal, positive when a > b */
export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function isRealDate(s: string): boolean {
  const m = DATE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/**
 * Every problem with `notes`, as sentences. An empty array means the list is
 * valid. `packageVersion` is the app version the list ships with.
 */
export function validateReleaseNotes(
  notes: readonly ReleaseNoteLike[],
  opts: { packageVersion: string; catalogs?: Catalogs },
): string[] {
  const problems: string[] = []
  const pkg = parseVersion(opts.packageVersion)
  if (!pkg) problems.push(`the app version "${opts.packageVersion}" is not x.y.z`)

  const seen = new Set<string>()
  let previous: { version: [number, number, number]; date: string; id: string } | null = null

  notes.forEach((note, i) => {
    const where = typeof note.id === 'string' ? note.id : `entry ${i + 1}`
    const version = parseVersion(note.version)
    if (!version) problems.push(`${where}: the version ${JSON.stringify(note.version)} is not x.y.z`)

    if (typeof note.id !== 'string' || !ID.test(note.id)) {
      problems.push(`${where}: the id must be "release:<version>"`)
    } else {
      if (seen.has(note.id)) problems.push(`${where}: this id appears more than once`)
      seen.add(note.id)
      if (version && note.id !== `release:${note.version as string}`) {
        problems.push(`${where}: the id does not match its version ${note.version as string}`)
      }
    }

    if (typeof note.date !== 'string' || !isRealDate(note.date)) {
      problems.push(`${where}: the date ${JSON.stringify(note.date)} is not a real YYYY-MM-DD date`)
    }

    if (!Array.isArray(note.items)) {
      problems.push(`${where}: items must be a list of catalog keys`)
    } else {
      const items = note.items as unknown[]
      if (items.length < MIN_ITEMS || items.length > MAX_ITEMS) {
        problems.push(`${where}: ${items.length} item(s); an entry has ${MIN_ITEMS} to ${MAX_ITEMS}`)
      }
      const keys = new Set<string>()
      for (const key of items) {
        if (typeof key !== 'string' || key === '') {
          problems.push(`${where}: an item is not a catalog key`)
          continue
        }
        if (keys.has(key)) problems.push(`${where}: the item "${key}" is listed twice`)
        keys.add(key)
        for (const [locale, catalog] of Object.entries(opts.catalogs ?? {})) {
          const text = catalog[key]
          if (typeof text !== 'string' || text.trim() === '') {
            problems.push(`${where}: "${key}" has no text in "${locale}"`)
          }
        }
      }
    }

    // newest first, and never ahead of the app itself
    if (version) {
      if (i === 0 && pkg && compareVersions(version, pkg) > 0) {
        problems.push(`${where}: the newest entry is for ${note.version as string}, which is newer than the app version ${opts.packageVersion}`)
      }
      if (previous && compareVersions(version, previous.version) >= 0) {
        problems.push(`${where}: entries are newest first, but this one is not older than ${previous.id}`)
      }
      if (previous && previous.date !== '' && typeof note.date === 'string' && isRealDate(note.date) && note.date > previous.date) {
        problems.push(`${where}: its date ${note.date} is after the newer entry ${previous.id}`)
      }
      previous = { version, date: typeof note.date === 'string' && isRealDate(note.date) ? note.date : '', id: where }
    }
  })

  return problems
}
