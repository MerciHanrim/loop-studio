import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

// Review I2 (2026-11-22) — the two ICU argument checkers must not skip an
// argument OBJECT passed in a variable. Before, `t(key, params)` gave the ICU
// checker no rows at all and the isolate checker no arguments, so the revision
// chip's title, the frame announcements' held-key path and the import wizard's
// commit error passed values raw unseen. Each case below puts back the shape
// main 8876e879 had (or removes a declaration) in a stand-in copy of one file,
// through LOOP_CHECK_SOURCE_OVERRIDES; everything else is the real tree.

const root = resolve(import.meta.dirname, '..')
const ICU = resolve(root, 'scripts/check-icu-arguments.mjs')
const ISOLATE = resolve(root, 'scripts/check-isolate-arguments.mjs')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
/** run a checker with `files` (repo-relative path → text) standing in */
function run(script, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'loop-arg-vars-'))
  dirs.push(dir)
  const overrides = {}
  for (const [rel, text] of Object.entries(files)) {
    const file = join(dir, rel.replace(/[\\/]/g, '__'))
    writeFileSync(file, text)
    overrides[rel] = file
  }
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LOOP_CHECK_SOURCE_OVERRIDES: JSON.stringify(overrides) },
  })
}
/** `text` with `from` replaced by `to`, failing if `from` is not there */
function swap(text, from, to) {
  expect(text, 'the fixture really replaces something').toContain(from)
  return text.replace(from, to)
}

// ── the shapes main 8876e879 had ──
const CHIP = 'src/components/RevisionChip.tsx'
const chipOnMain = () =>
  swap(
    read(CHIP),
    read(CHIP).slice(read(CHIP).indexOf('  const title = dirty'), read(CHIP).indexOf('\n  return (')),
    "  const titleParams = { project: short(open.projectId), role: open.role, revision: open.revisionId }\n  const title = dirty ? t('revChip.titleDirty', titleParams) : t('revChip.title', titleParams)\n",
  )

const FRAME = 'src/components/frames/FrameLayer.tsx'
const frameOnMain = () => {
  const text = read(FRAME)
  const start = text.indexOf('  const announceLater = useCallback(')
  const end = text.indexOf('  }, [])', start) + '  }, [])'.length
  expect(start).toBeGreaterThan(0)
  return swap(
    text,
    text.slice(start, end),
    [
      '  const announceLater = useCallback(',
      "    (key: 'canvas.frame.a11y.moved' | 'canvas.frame.a11y.resized', params: Record<string, string | number>) => {",
      '      if (announceTimer.current) clearTimeout(announceTimer.current)',
      '      announceTimer.current = setTimeout(() => {',
      '        announceTimer.current = null',
      '        setAnnouncement(t(key, params))',
      '      }, ANNOUNCE_MS)',
      '    },',
      '    [t],',
      '  )',
    ].join('\n'),
  )
}

const WIZARD = 'src/components/dataImport/DataImportWizard.tsx'
const commitErrorOnMain = () => {
  const text = read(WIZARD)
  const start = text.indexOf('{t(COMMIT_ERROR_KEY[commitError.code], {')
  const end = text.indexOf('})}', start) + '})}'.length
  expect(start).toBeGreaterThan(0)
  return swap(text, text.slice(start, end), '{t(COMMIT_ERROR_KEY[commitError.code], commitError.detail as Record<string, string | number> | undefined)}')
}

const DISPOSITION = 'scripts/icu-argument-disposition.json'

// each case spawns a checker that builds a TypeScript program over src/ (about
// 2 s alone, several times that while the whole suite runs in parallel)
const SLOW = { timeout: 60_000 }

describe('check-icu-arguments: an argument object in a variable is read, or declared with a reason', SLOW, () => {
  it('the real tree passes', () => {
    const r = run(ICU)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  it("main's revision chip (a shared const params object) is READ, and its raw values are unclassified", () => {
    const r = run(ICU, { [CHIP]: chipOnMain() })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/UNCLASSIFIED {2}src\/components\/RevisionChip\.tsx:\d+ {2}revChip\.title \{project\}/)
    expect(r.stderr).toMatch(/UNCLASSIFIED {2}src\/components\/RevisionChip\.tsx:\d+ {2}revChip\.titleDirty \{revision\}/)
  })

  it("main's held-key frame announcement (a params PARAMETER) cannot be traced and fails", () => {
    const r = run(ICU, { [FRAME]: frameOnMain() })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/UNTRACEABLE {2}src\/components\/frames\/FrameLayer\.tsx:\d+ {2}<computed> key receives `params`/)
  })

  it("main's commit error (the detail object passed whole) cannot be traced and fails", () => {
    const r = run(ICU, { [WIZARD]: commitErrorOnMain() })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/UNTRACEABLE {2}src\/components\/dataImport\/DataImportWizard\.tsx:\d+ {2}<computed> COMMIT_ERROR_KEY\[commitError\.code\] receives `commitError\.detail as/)
  })

  it('a spread with no opaque entry fails, by site', () => {
    const d = JSON.parse(read(DISPOSITION))
    d.opaque = d.opaque.filter((o) => !o.file.endsWith('DataImportRefreshWizard.tsx'))
    d.totals.opaque = d.opaque.length
    const r = run(ICU, { [DISPOSITION]: JSON.stringify(d, null, 2) })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/UNTRACEABLE {2}src\/components\/dataImport\/DataImportRefreshWizard\.tsx:\d+ .* receives `\.\.\.\(issue\.detail \?\? \{\}\)`/)
  })

  it('an opaque entry without a reason fails', () => {
    const d = JSON.parse(read(DISPOSITION))
    d.opaque[0].reason = ' '
    const r = run(ICU, { [DISPOSITION]: JSON.stringify(d, null, 2) })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/opaque entry without a reason: src\/components\/dataImport\/DataImportWizard\.tsx::DataImportWizard>issueText/)
  })

  it('an opaque entry nothing matches is stale', () => {
    const d = JSON.parse(read(DISPOSITION))
    d.opaque.push({ ...d.opaque[0], expr: '...somethingElse' })
    d.totals.opaque = d.opaque.length
    const r = run(ICU, { [DISPOSITION]: JSON.stringify(d, null, 2) })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/stale opaque entry \(no such argument object\): .*::\.\.\.somethingElse/)
  })
})

describe('check-isolate-arguments: no argument object in a declared file is skipped', SLOW, () => {
  it('the real tree passes', () => {
    const r = run(ISOLATE)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  it("main's held-key frame announcement fails as an object the checker cannot read", () => {
    const r = run(ISOLATE, { [FRAME]: frameOnMain() })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/src\/components\/frames\/FrameLayer\.tsx:\d+: t\(key, params\) passes its arguments in an object this checker cannot read/)
  })

  it("main's revision chip is read through its const object, and its values are reported RAW", () => {
    const r = run(ISOLATE, { [CHIP]: chipOnMain() })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/revisionchip-title-values \/ project: passed RAW at src\/components\/RevisionChip\.tsx:\d+/)
  })

  it("the import wizard's isolated cell is TRACED: dropping the assignment fails", () => {
    const text = swap(
      read(WIZARD),
      'detail.value = isolateAuto(formatCellValueForDisplay(detail.value))',
      'detail.value = formatCellValueForDisplay(detail.value)',
    )
    const r = run(ISOLATE, { [WIZARD]: text })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/wizard-issue-value: expected 1 `detail\.value = isolateAuto\(…\)` assignment, found 0/)
  })
})
