import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHARE_MAX_BYTES, base64urlEncode } from './share'
import {
  PROTECTED_FORMAT_ID,
  PROTECTED_KDF_ITERATIONS,
  PROTECTED_MAX_PAYLOAD_CHARS,
  PROTECTED_MIN_PAYLOAD_CHARS,
  PROTECTED_PREFIX,
  ProtectedShareError,
  openProtectedBytes,
  passwordLength,
  passwordRule,
  protectedShareAvailable,
  readProtectedPayload,
  sealShareText,
} from './shareProtected'

// loop-share-protected/1 is checked against an INDEPENDENT implementation: the
// helpers below use node:crypto and node:zlib and their own base64url, and
// share no code with the product module. Each side must open what the other
// sealed, so the byte layout, the AAD, the iteration count and the NFC rule are
// pinned from the outside - and product code needs no way to be handed a salt
// or an IV.

const utf8 = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
function b64u(bytes: Uint8Array): string {
  let bin = ''
  for (const x of bytes) bin += String.fromCharCode(x)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

type Params = { aad?: string | null; iterations?: number }

function nodeSeal(plain: Uint8Array, password: string, salt: Uint8Array, iv: Uint8Array, p: Params = {}): string {
  const key = pbkdf2Sync(utf8(password.normalize('NFC')), salt, p.iterations ?? 600000, 32, 'sha256')
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  if (p.aad !== null) c.setAAD(utf8(p.aad ?? 'loop-share-protected/1'))
  const ct = cat(c.update(plain), c.final())
  return b64u(cat(salt, iv, ct, c.getAuthTag()))
}

function nodeOpen(payload: string, password: string): string {
  const b = unb64u(payload)
  const key = pbkdf2Sync(utf8(password.normalize('NFC')), b.subarray(0, 16), 600000, 32, 'sha256')
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(16, 28), { authTagLength: 16 })
  d.setAAD(utf8('loop-share-protected/1'))
  d.setAuthTag(b.subarray(b.length - 16))
  return text(inflateSync(cat(d.update(b.subarray(28, b.length - 16)), d.final())))
}

const JSON_TEXT = '{"schema":"loop-studio/graph","version":1,"nodes":[],"edges":[]}'
const PASSWORD = 'correct horse battery staple'
const seal = (doc: string, password = PASSWORD, p: Params = {}) =>
  nodeSeal(deflateSync(utf8(doc)), password, randomBytes(16), randomBytes(12), p)
const open = (payload: string, password = PASSWORD) => openProtectedBytes(readProtectedPayload(payload), password)

/** the error a promise rejects with */
async function failure(p: Promise<unknown>): Promise<ProtectedShareError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ProtectedShareError)
    return e as ProtectedShareError
  }
  throw new Error('expected a rejection')
}
/** everything about an error that could tell two causes apart */
const face = (e: ProtectedShareError) => ({
  name: e.name,
  message: e.message,
  reason: e.reason,
  cause: (e as { cause?: unknown }).cause,
  keys: Object.keys(e).sort(),
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the pinned constants', () => {
  it('prefix, identifier, iteration count and bounds', () => {
    expect(PROTECTED_PREFIX).toBe('p1=')
    expect(PROTECTED_FORMAT_ID).toBe('loop-share-protected/1')
    expect(PROTECTED_KDF_ITERATIONS).toBe(600000)
    expect(PROTECTED_MIN_PAYLOAD_CHARS).toBe(60)
    expect(PROTECTED_MAX_PAYLOAD_CHARS).toBe(SHARE_MAX_BYTES)
    expect(PROTECTED_MAX_PAYLOAD_CHARS).toBe(8192)
  })
})

describe('known answer (made with node:crypto, fixed salt and IV)', () => {
  // salt 00..0f, iv a0..ab, the password and JSON above, zlib default level
  const KAT =
    'AAECAwQFBgcICQoLDA0OD6ChoqOkpaanqKmqq9PyGNZRewug-mdGAFZfxHzXjsIb0FFAeYydCqMS_nEtA-vbA5mP6DAdST51g7zuZ6-6wrsnUiGAb8oALBa6Bcuaj-G48CwYYw5iJ6d5PPVB2iAd'

  it('the product opens the fixed vector', async () => {
    expect(await open(KAT)).toBe(JSON_TEXT)
  })

  it('the vector carries its salt and IV first, in the clear', () => {
    const b = readProtectedPayload(KAT)
    expect(hex(b.subarray(0, 16))).toBe('000102030405060708090a0b0c0d0e0f')
    expect(hex(b.subarray(16, 28))).toBe('a0a1a2a3a4a5a6a7a8a9aaab')
  })
})

describe('both directions against the independent implementation', () => {
  it('what the product seals, node:crypto opens', async () => {
    const { payload, bytes } = await sealShareText(JSON_TEXT, PASSWORD)
    expect(bytes).toBe(payload.length)
    expect(nodeOpen(payload, PASSWORD)).toBe(JSON_TEXT)
  })

  it('what node:crypto seals, the product opens', async () => {
    expect(await open(seal(JSON_TEXT))).toBe(JSON_TEXT)
  })

  it('Hangul, Thai, Cyrillic and emoji content survives in both directions', async () => {
    const doc = JSON.stringify({ label: '재고 창고 🔑', note: 'ระดับ 15 · уровень' })
    expect(nodeOpen((await sealShareText(doc, PASSWORD)).payload, PASSWORD)).toBe(doc)
    expect(await open(seal(doc))).toBe(doc)
  })

  it('the payload is unpadded base64url of salt + IV + ciphertext + tag: 44 bytes over the sealed text', async () => {
    const { payload } = await sealShareText(JSON_TEXT, PASSWORD)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    const sealed = unb64u(payload)
    expect(payload.length).toBe(Math.ceil((sealed.length * 4) / 3))
    // the same text sealed by the independent side differs only by its own deflate output
    const reference = unb64u(seal(JSON_TEXT))
    expect(reference.length - deflateSync(utf8(JSON_TEXT)).length).toBe(44)
    expect(sealed.length).toBeGreaterThan(44 + 8)
  })

  it('two links for the same document and password differ in salt, IV and ciphertext', async () => {
    const a = unb64u((await sealShareText(JSON_TEXT, PASSWORD)).payload)
    const b = unb64u((await sealShareText(JSON_TEXT, PASSWORD)).payload)
    expect(hex(a.subarray(0, 16))).not.toBe(hex(b.subarray(0, 16)))
    expect(hex(a.subarray(16, 28))).not.toBe(hex(b.subarray(16, 28)))
    expect(hex(a.subarray(28))).not.toBe(hex(b.subarray(28)))
  })
})

describe('the format is bound: other parameters do not open (mutations of the independent side)', () => {
  it.each([
    ['another format identifier as AAD', { aad: 'loop-share-protected/2' }],
    ['no AAD at all', { aad: null }],
    ['one iteration fewer', { iterations: 599999 }],
    ['the previous OWASP count', { iterations: 310000 }],
  ] as const)('%s => auth', async (_name, p) => {
    expect((await failure(open(seal(JSON_TEXT, PASSWORD, p)))).reason).toBe('auth')
  })
})

describe('a wrong password and every kind of damage are ONE error', () => {
  it('same name, message, reason, no cause, no extra field - and nothing on the console', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const good = seal(JSON_TEXT)
    const bytes = () => readProtectedPayload(good)
    const flip = (i: number) => {
      const b = bytes()
      b[i < 0 ? b.length + i : i] ^= 1
      return b
    }
    const cases: Record<string, () => Promise<unknown>> = {
      'wrong password': () => openProtectedBytes(bytes(), 'correct horse battery stapl3'),
      'password with a trailing space': () => openProtectedBytes(bytes(), PASSWORD + ' '),
      'salt bit': () => openProtectedBytes(flip(0), PASSWORD),
      'iv bit': () => openProtectedBytes(flip(16), PASSWORD),
      'ciphertext bit': () => openProtectedBytes(flip(30), PASSWORD),
      'tag bit': () => openProtectedBytes(flip(-1), PASSWORD),
      'one byte cut off': () => openProtectedBytes(bytes().subarray(0, bytes().length - 1), PASSWORD),
      // the browser reports THIS one with a different message; it must not show
      'cut below the tag length': () => openProtectedBytes(bytes().subarray(0, 28 + 5), PASSWORD),
      'empty password': () => openProtectedBytes(bytes(), ''),
      'a 129 code point password': () => openProtectedBytes(bytes(), 'x'.repeat(129)),
    }
    const faces: Record<string, ReturnType<typeof face>> = {}
    for (const [name, run] of Object.entries(cases)) faces[name] = face(await failure(run()))
    const first = faces['wrong password']
    expect(first).toEqual({ name: 'ProtectedShareError', message: 'auth', reason: 'auth', cause: undefined, keys: ['name', 'reason'] })
    for (const [name, f] of Object.entries(faces)) expect(f, name).toEqual(first)
    for (const l of logs) expect(l).not.toHaveBeenCalled()
  })
})

describe('the structure check runs before any password (no key is derived)', () => {
  it('59 characters is too short, 60 is the first length that reaches the password', async () => {
    const derive = vi.spyOn(crypto.subtle, 'deriveKey')
    const sixty = base64urlEncode(new Uint8Array(45))
    expect(sixty.length).toBe(60)
    expect(() => readProtectedPayload(sixty.slice(0, 59))).toThrow(ProtectedShareError)
    expect(readProtectedPayload(sixty).length).toBe(45)
    expect(derive).not.toHaveBeenCalled()
    expect((await failure(open(sixty))).reason).toBe('auth')
    expect(derive).toHaveBeenCalledTimes(1)
  })

  it('8,192 characters is inside the bound, 8,193 is not', () => {
    expect(readProtectedPayload('A'.repeat(8192)).length).toBe(6144)
    expect(() => readProtectedPayload('A'.repeat(8193))).toThrow(ProtectedShareError)
  })

  it.each([
    ['empty', ''],
    ['padding', 'A'.repeat(62) + '=='],
    ['a standard-base64 character', 'A'.repeat(63) + '+'],
    ['whitespace', 'A'.repeat(40) + ' ' + 'A'.repeat(40)],
    ['an impossible length', 'A'.repeat(61)],
  ])('%s => structure', (_name, payload) => {
    let reason: string | null = null
    try {
      readProtectedPayload(payload)
    } catch (e) {
      reason = (e as ProtectedShareError).reason
    }
    expect(reason).toBe('structure')
  })
})

describe('content that authenticates and is not a share payload', () => {
  it('sealed bytes that are not a zlib stream => content, not auth', async () => {
    const payload = nodeSeal(utf8('not a zlib stream at all'), PASSWORD, randomBytes(16), randomBytes(12))
    expect((await failure(open(payload))).reason).toBe('content')
  })

  it('a sealed decompression bomb is stopped at the 1 MiB cap => content', async () => {
    const bomb = nodeSeal(deflateSync(new Uint8Array(2 * 1024 * 1024)), PASSWORD, randomBytes(16), randomBytes(12))
    expect(bomb.length).toBeLessThan(PROTECTED_MAX_PAYLOAD_CHARS)
    expect((await failure(open(bomb))).reason).toBe('content')
  })
})

describe('the password rule', () => {
  it('counts code points after NFC: a jamo-typed syllable and an emoji are one each', () => {
    expect(passwordLength('비밀번호 🔑 열두 글자')).toBe(12)
    expect(passwordLength('비밀번호 🔑 열두 글자'.normalize('NFD'))).toBe(12)
    expect('비밀번호 🔑 열두 글자'.length).toBe(13) // UTF-16 units would disagree
    expect(passwordLength(' two  spaces ')).toBe(13) // whitespace counts
  })

  it('creating needs 12 to 128; sealing refuses anything else', async () => {
    expect(passwordRule('x'.repeat(11))).toBe('too-short')
    expect(passwordRule('x'.repeat(12))).toBe('ok')
    expect(passwordRule('x'.repeat(128))).toBe('ok')
    expect(passwordRule('x'.repeat(129))).toBe('too-long')
    expect((await failure(sealShareText(JSON_TEXT, 'x'.repeat(11)))).reason).toBe('password')
    expect((await failure(sealShareText(JSON_TEXT, 'x'.repeat(129)))).reason).toBe('password')
  })

  it('opening accepts a 1 code point password (a link from another conforming producer)', async () => {
    expect(await open(seal(JSON_TEXT, 'x'), 'x')).toBe(JSON_TEXT)
  })

  it('NFD and NFC spellings of one password are the same key', async () => {
    const nfc = '비밀번호열두글자이상입니다'
    const { payload } = await sealShareText(JSON_TEXT, nfc.normalize('NFD'))
    expect(await open(payload, nfc)).toBe(JSON_TEXT)
    expect(nodeOpen(payload, nfc)).toBe(JSON_TEXT)
  })

  it('leading and trailing whitespace is part of the password, never trimmed', async () => {
    const { payload } = await sealShareText(JSON_TEXT, ' twelve chars long ')
    expect(await open(payload, ' twelve chars long ')).toBe(JSON_TEXT)
    expect((await failure(open(payload, 'twelve chars long'))).reason).toBe('auth')
  })
})

describe('the key is handled with the least it needs', () => {
  it('never extractable; encrypt-only when sealing, decrypt-only when opening; 600,000 x SHA-256', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey')
    const deriveKey = vi.spyOn(crypto.subtle, 'deriveKey')
    const { payload } = await sealShareText(JSON_TEXT, PASSWORD)
    await open(payload)
    expect(importKey).toHaveBeenCalledTimes(2)
    for (const call of importKey.mock.calls) {
      expect(call[0]).toBe('raw')
      expect(call[2]).toBe('PBKDF2')
      expect(call[3]).toBe(false)
      expect(call[4]).toEqual(['deriveKey'])
    }
    expect(deriveKey).toHaveBeenCalledTimes(2)
    const [sealCall, openCall] = deriveKey.mock.calls
    for (const call of [sealCall, openCall]) {
      expect(call[0]).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 })
      expect(call[2]).toEqual({ name: 'AES-GCM', length: 256 })
      expect(call[3]).toBe(false)
    }
    expect(sealCall[4]).toEqual(['encrypt'])
    expect(openCall[4]).toEqual(['decrypt'])
  })
})

describe('without Web Crypto', () => {
  it('reports unavailable, and neither seals nor opens', async () => {
    const bytes = readProtectedPayload(seal(JSON_TEXT)) // the structure check itself needs no crypto
    vi.stubGlobal('crypto', {})
    expect(protectedShareAvailable()).toBe(false)
    expect((await failure(sealShareText(JSON_TEXT, PASSWORD))).reason).toBe('unavailable')
    expect((await failure(openProtectedBytes(bytes, PASSWORD))).reason).toBe('unavailable')
    vi.unstubAllGlobals()
    expect(protectedShareAvailable()).toBe(true)
  })
})
