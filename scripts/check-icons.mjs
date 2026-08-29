// Slice-1 icon check (docs/pwa.md §P9 D1, review criteria 1-2). Runs in `checks`.
//
//   node scripts/check-icons.mjs
//
// - every icon the manifest object references exists in public/
// - each is a real PNG of exactly the declared pixel size
// - icon-512 and icon-maskable-512 are DIFFERENT images (not one file with two
//   `purpose` values) — a byte compare
// - the maskable icon has an opaque field (a maskable icon must not be
//   transparent) while the plain 512 is transparent at the corner

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { resolve } from 'node:path'
import { manifest } from '../src/pwa/manifest.ts'

const root = resolve(import.meta.dirname, '..')
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  process.exitCode = 1
}
const ok = (m) => console.log(`  ok    ${m}`)

/** parse an 8-bit RGBA PNG → { w, h, at(x,y) } */
function readPng(buf) {
  if (buf.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('not a PNG')
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error('not 8-bit RGBA')
  let o = 8
  let idat = Buffer.alloc(0)
  while (o < buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    if (type === 'IDAT') idat = Buffer.concat([idat, buf.subarray(o + 8, o + 8 + len)])
    o += 12 + len
  }
  const raw = inflateSync(idat)
  const stride = w * 4
  return {
    w,
    h,
    at(x, y) {
      const row = y * (stride + 1) + 1 // +1 skips the per-row filter byte
      return [raw[row + x * 4], raw[row + x * 4 + 1], raw[row + x * 4 + 2], raw[row + x * 4 + 3]]
    },
  }
}

const files = {}
for (const icon of manifest.icons) {
  const path = resolve(root, 'public', icon.src)
  let buf
  try {
    buf = readFileSync(path)
  } catch {
    fail(`missing icon file: public/${icon.src}`)
    continue
  }
  files[icon.src] = buf
  let png
  try {
    png = readPng(buf)
  } catch (e) {
    fail(`public/${icon.src}: ${e.message}`)
    continue
  }
  if (`${png.w}x${png.h}` !== icon.sizes) {
    fail(`public/${icon.src}: ${png.w}x${png.h}, manifest says ${icon.sizes}`)
  } else {
    ok(`${icon.src} — ${png.w}x${png.h} PNG, purpose "${icon.purpose}"`)
  }
}

const plain512 = manifest.icons.find((i) => i.purpose === 'any' && i.sizes === '512x512')
const maskable = manifest.icons.find((i) => i.purpose === 'maskable')
if (plain512 && maskable && files[plain512.src] && files[maskable.src]) {
  if (files[plain512.src].equals(files[maskable.src])) {
    fail('icon-512 and icon-maskable-512 are the SAME file — the maskable icon must be composed separately')
  } else {
    ok('plain 512 and maskable 512 are different images')
  }
  const p = readPng(files[plain512.src])
  const m = readPng(files[maskable.src])
  if (p.at(3, 3)[3] !== 0) fail('plain 512 corner is not transparent (should be edge-to-edge / transparent)')
  else ok('plain 512 corner is transparent')
  if (m.at(3, 3)[3] !== 255) fail('maskable 512 corner is not opaque (a maskable icon must fill its field)')
  else ok('maskable 512 has an opaque field')
  // the mark must actually be inside the safe zone: a ring pixel present at
  // ~62% scale (≈119 px from the 256 centre) and clean field near the edge
  const ring = m.at(256 + 119, 256)
  const edge = m.at(20, 256)
  const isField = (px) => px[0] === 240 && px[1] === 239 && px[2] === 234
  if (isField(ring)) fail('maskable: no mark near r≈62% — is it drawn in the safe zone?')
  else ok('maskable: mark visible inside the safe zone')
  if (!isField(edge)) fail('maskable: the mark reaches the icon edge — safe zone too large')
  else ok('maskable: field is clean at the edge (safe zone respected)')
}

if (process.exitCode) {
  console.error('\nicon check FAILED')
  process.exit(1)
}
console.log('\nicon check passed')
