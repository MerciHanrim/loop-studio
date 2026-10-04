// Protected share link - the sealed transport (SEMANTICS-P.md, loop-share-protected/1).
//
// A protected link is `#p1=<payload>`:
//
//   payload   = base64url( salt[16] | iv[12] | ciphertext | tag[16] )
//   plaintext = the zlib-deflated UTF-8 Graph JSON - exactly the bytes a plain
//               `g1` link base64url-encodes (compress first: ciphertext does not
//               compress, and the decompression-bomb cap still runs afterwards)
//   key       = PBKDF2-HMAC-SHA-256( UTF-8( NFC(password) ), salt, 600000 )
//               -> AES-256-GCM, never extractable, one usage only
//   AAD       = UTF-8 "loop-share-protected/1"
//
// There is no header byte: the `p1` prefix is the protocol header and the AAD
// binds it into the authentication, so a link re-labelled as another version or
// algorithm does not open. NOTHING in the link selects a parameter - the
// iteration count, the algorithm and the lengths are fixed by the format, and
// changing any of them needs a new prefix.
//
// This file is the ONLY place in product code that derives a key or encrypts
// or decrypts (`npm run check:share-crypto`). Web Crypto only - no cryptographic
// code is written or bundled here. It has no `console` call: the browser's own
// error message differs between a wrong password and data that is too short,
// so every failure leaves this module as a typed `ProtectedShareError` carrying
// a reason and nothing else.
//
// The password is an argument and is never kept: not in a module variable, not
// in a store, not in storage, not in the link.

import {
  PROTECTED_SHARE_PREFIX,
  SHARE_MAX_BYTES,
  SHARE_MAX_DECODED_BYTES,
  base64urlDecode,
  base64urlEncode,
  utf8Bytes,
  utf8Decode,
  zlibDeflate,
  zlibInflate,
} from './share'

/** fragment key: `p` = protected, `1` = payload format (SS P1). Defined beside
 *  the fragment classifier in `share.ts`; re-exported here as the format's own. */
export const PROTECTED_PREFIX = PROTECTED_SHARE_PREFIX
/** the format identifier; its UTF-8 bytes are the AES-GCM additional authenticated data */
export const PROTECTED_FORMAT_ID = 'loop-share-protected/1'
/** fixed by the format, never read from a link (SS P2) */
export const PROTECTED_KDF_ITERATIONS = 600000
export const PROTECTED_SALT_BYTES = 16
export const PROTECTED_IV_BYTES = 12
export const PROTECTED_TAG_BYTES = 16
/** salt + iv + tag + one byte of ciphertext, as base64url characters */
export const PROTECTED_MIN_PAYLOAD_CHARS = 60
/** the same outbound cap as a plain link, and the inbound bound checked before any prompt */
export const PROTECTED_MAX_PAYLOAD_CHARS = SHARE_MAX_BYTES
/** password length, in code points after NFC normalisation */
export const PROTECTED_PASSWORD_MIN = 12
export const PROTECTED_PASSWORD_MAX = 128

export type ProtectedFailure =
  | 'unavailable' // no Web Crypto here (not a secure context, or an old browser)
  | 'password' // creating only: the password breaks the 12..128 rule
  | 'structure' // not a well-formed `p1` payload - decided BEFORE any password is asked for
  | 'auth' // wrong password, failed authentication, damaged ciphertext: indistinguishable
  | 'content' // authenticated, but what was sealed is not a share payload

export class ProtectedShareError extends Error {
  reason: ProtectedFailure
  constructor(reason: ProtectedFailure) {
    super(reason)
    this.name = 'ProtectedShareError'
    this.reason = reason
  }
}

const HEAD_BYTES = PROTECTED_SALT_BYTES + PROTECTED_IV_BYTES
const AAD = utf8Bytes(PROTECTED_FORMAT_ID)

// TS lib variance: a `Uint8Array` view is a valid `BufferSource` at run time
// (same cast shape as `streamThrough` in `share.ts`).
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource

type CryptoLike = { subtle?: SubtleCrypto; getRandomValues?: Crypto['getRandomValues'] }

function webCrypto(): { subtle: SubtleCrypto; random: (n: number) => Uint8Array } | null {
  const c = (globalThis as { crypto?: CryptoLike }).crypto
  const subtle = c?.subtle
  if (!c || !subtle || typeof subtle.deriveKey !== 'function' || typeof c.getRandomValues !== 'function') return null
  const fill = c.getRandomValues.bind(c)
  return { subtle, random: (n) => fill(new Uint8Array(n)) }
}

/** Can this page create and open protected links at all? `false` outside a
 *  secure context (no `crypto.subtle`) - there is no fallback (SS P7). */
export function protectedShareAvailable(): boolean {
  return webCrypto() !== null
}

/** A password's length the way the rule counts it: code points after NFC, so a
 *  Hangul syllable typed as jamo and an emoji each count once (SS P3). */
export function passwordLength(password: string): number {
  return Array.from(password.normalize('NFC')).length
}

/** The creating rule: 12 to 128. Whitespace is part of the password. */
export function passwordRule(password: string): 'ok' | 'too-short' | 'too-long' {
  const n = passwordLength(password)
  if (n < PROTECTED_PASSWORD_MIN) return 'too-short'
  return n > PROTECTED_PASSWORD_MAX ? 'too-long' : 'ok'
}

async function deriveAesKey(
  subtle: SubtleCrypto,
  password: string,
  salt: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const material = await subtle.importKey('raw', bs(utf8Bytes(password.normalize('NFC'))), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bs(salt), iterations: PROTECTED_KDF_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

/**
 * `text` (a Graph JSON string) + password -> the `p1` payload and its length.
 * The caller enforces the outbound cap on `bytes`, exactly as for a plain link.
 * Throws `ProtectedShareError`: `unavailable` or `password`.
 */
export async function sealShareText(text: string, password: string): Promise<{ payload: string; bytes: number }> {
  const wc = webCrypto()
  if (!wc) throw new ProtectedShareError('unavailable')
  if (passwordRule(password) !== 'ok') throw new ProtectedShareError('password')
  const plain = await zlibDeflate(utf8Bytes(text))
  let sealed: Uint8Array
  const salt = wc.random(PROTECTED_SALT_BYTES)
  const iv = wc.random(PROTECTED_IV_BYTES)
  try {
    const key = await deriveAesKey(wc.subtle, password, salt, 'encrypt')
    sealed = new Uint8Array(
      await wc.subtle.encrypt({ name: 'AES-GCM', iv: bs(iv), additionalData: bs(AAD), tagLength: PROTECTED_TAG_BYTES * 8 }, key, bs(plain)),
    )
  } catch {
    throw new ProtectedShareError('unavailable')
  }
  const out = new Uint8Array(HEAD_BYTES + sealed.length)
  out.set(salt, 0)
  out.set(iv, PROTECTED_SALT_BYTES)
  out.set(sealed, HEAD_BYTES)
  const payload = base64urlEncode(out)
  return { payload, bytes: payload.length }
}

/**
 * The structure check that runs BEFORE any password is asked for (SS P6): the
 * length bounds and the strict base64url alphabet. Returns the decoded bytes -
 * the in-memory copy the caller keeps once the fragment is gone. Throws
 * `ProtectedShareError('structure')` and nothing else.
 */
export function readProtectedPayload(payload: string): Uint8Array {
  if (payload.length < PROTECTED_MIN_PAYLOAD_CHARS || payload.length > PROTECTED_MAX_PAYLOAD_CHARS) {
    throw new ProtectedShareError('structure')
  }
  let bytes: Uint8Array
  try {
    bytes = base64urlDecode(payload)
  } catch {
    throw new ProtectedShareError('structure')
  }
  if (bytes.length <= HEAD_BYTES + PROTECTED_TAG_BYTES) throw new ProtectedShareError('structure')
  return bytes
}

/**
 * Sealed bytes + password -> the decoded Graph JSON string (still un-parsed).
 *
 * `auth` covers every failure of the key derivation and the decryption with
 * ONE reason - a wrong password, a changed salt, IV, ciphertext or tag, and a
 * truncated link cannot be told apart, and whatever the browser reported is
 * dropped here. `content` means the tag verified (the password was right) and
 * the sealed bytes are not a bounded zlib stream.
 */
export async function openProtectedBytes(bytes: Uint8Array, password: string): Promise<string> {
  const wc = webCrypto()
  if (!wc) throw new ProtectedShareError('unavailable')
  let plain: Uint8Array
  try {
    const n = passwordLength(password)
    if (n < 1 || n > PROTECTED_PASSWORD_MAX) throw new ProtectedShareError('auth')
    const key = await deriveAesKey(wc.subtle, password, bytes.subarray(0, PROTECTED_SALT_BYTES), 'decrypt')
    plain = new Uint8Array(
      await wc.subtle.decrypt(
        { name: 'AES-GCM', iv: bs(bytes.subarray(PROTECTED_SALT_BYTES, HEAD_BYTES)), additionalData: bs(AAD), tagLength: PROTECTED_TAG_BYTES * 8 },
        key,
        bs(bytes.subarray(HEAD_BYTES)),
      ),
    )
  } catch {
    throw new ProtectedShareError('auth')
  }
  try {
    return utf8Decode(await zlibInflate(plain, SHARE_MAX_DECODED_BYTES))
  } catch {
    throw new ProtectedShareError('content')
  }
}
