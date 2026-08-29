// Generate the PWA icon PNGs from the "Broken Orbit" mark (the same geometry as
// src/components/Logo.tsx). Run once, commit the output:
//
//   node scripts/gen-icons.mjs
//
// Output (public/icons/):
//   icon-192.png            192, purpose "any"     — transparent, edge-to-edge
//   icon-512.png            512, purpose "any"     — transparent, edge-to-edge
//   icon-maskable-512.png   512, purpose "maskable"— OPAQUE #f0efea field, the
//                                                    mark scaled into a central
//                                                    safe zone (OS clips ~10% all
//                                                    round to a circle/squircle)
//   apple-touch-icon.png    180                    — OPAQUE, mark ~72%, no
//                                                    transparency (iOS won't mask)
//
// Pure Node: 4x4 supersampled rasteriser + a tiny PNG encoder over zlib.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// -- palette (matches the app's --line-structure / accent) ----------------
const TRACK = [140, 136, 126] // #8c887e
const BEAD = [47, 116, 110] // #2f746e
const FIELD = [240, 239, 234] // #f0efea  (--surface-ground, light)

// -- mark geometry in a 0..1 square (from Logo.tsx / index.html favicon) --
const C = 0.5 // centre
const R = 6 / 16 // ring radius
const STROKE_HALF = 1.5 / 16 / 2 // ring half-stroke
const BEAD_R = 2 / 16
const BEAD_X = 12.24 / 16
const BEAD_Y = 3.76 / 16
// the drawn arc is everything EXCEPT the ~29deg..61deg wedge (gap centred ~45deg,
// the 1:30 position) — see Logo.tsx
const GAP_LO = 29
const GAP_HI = 61

/** one icon: size, background (null = transparent), mark scale about the centre */
function render(size, bg, scale) {
  const px = new Uint8Array(size * size * 4)
  const SS = 4 // supersamples per axis
  const inv = 1 / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let track = 0
      let bead = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // normalised sample point, then undo the mark scale about the centre
          const nx = (x + (sx + 0.5) / SS) * inv
          const ny = (y + (sy + 0.5) / SS) * inv
          const mx = C + (nx - C) / scale
          const my = C + (ny - C) / scale
          const dx = mx - C
          const dy = my - C
          const dist = Math.hypot(dx, dy)
          let ang = (Math.atan2(-dy, dx) * 180) / Math.PI
          if (ang < 0) ang += 360
          const inGap = ang >= GAP_LO && ang <= GAP_HI
          if (!inGap && Math.abs(dist - R) <= STROKE_HALF) track++
          if (Math.hypot(mx - BEAD_X, my - BEAD_Y) <= BEAD_R) bead++
        }
      }
      const n = SS * SS
      const tA = track / n
      const bA = bead / n
      const i = (y * size + x) * 4
      // start from the background
      let r = bg ? bg[0] : 0
      let g = bg ? bg[1] : 0
      let b = bg ? bg[2] : 0
      let a = bg ? 255 : 0
      // track over bg
      ;[r, g, b, a] = over([TRACK[0], TRACK[1], TRACK[2], Math.round(tA * 255)], [r, g, b, a])
      // bead over that
      ;[r, g, b, a] = over([BEAD[0], BEAD[1], BEAD[2], Math.round(bA * 255)], [r, g, b, a])
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = a
    }
  }
  return px
}

/** straight-alpha "src over dst" */
function over(src, dst) {
  const sa = src[3] / 255
  const da = dst[3] / 255
  const oa = sa + da * (1 - sa)
  if (oa === 0) return [0, 0, 0, 0]
  const ch = (i) => Math.round((src[i] * sa + dst[i] * da * (1 - sa)) / oa)
  return [ch(0), ch(1), ch(2), Math.round(oa * 255)]
}

// -- minimal PNG encoder (8-bit RGBA) ------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const t = Buffer.from(type, 'latin1')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10,11,12 = compression / filter / interlace = 0
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// -- write ------------------------------------------------------------------
const outDir = resolve(import.meta.dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const jobs = [
  ['icon-192.png', 192, null, 1],
  ['icon-512.png', 512, null, 1],
  ['icon-maskable-512.png', 512, FIELD, 0.62], // mark in the safe zone
  ['apple-touch-icon.png', 180, FIELD, 0.72],
]
for (const [name, size, bg, scale] of jobs) {
  const png = encodePng(size, render(size, bg, scale))
  writeFileSync(resolve(outDir, name), png)
  console.log(`  ${name.padEnd(24)} ${size}x${size}  ${png.length} bytes`)
}
console.log('done — public/icons/')
