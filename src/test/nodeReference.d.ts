// The two Node modules the protected-share reference implementation uses in
// `src/model/shareProtected.test.ts`, declared by hand and only as far as that
// test needs them.
//
// Why not `@types/node`: adding it to the app's type program would make
// `Buffer`, `process` and every other Node global type-check in PRODUCT code,
// where none of them exists. These declarations add two importable module
// names and nothing global; `npm run check:share-crypto` forbids a `node:`
// import outside a test file.

declare module 'node:crypto' {
  interface GcmCipher {
    setAAD(aad: Uint8Array): this
    update(data: Uint8Array): Uint8Array
    final(): Uint8Array
    getAuthTag(): Uint8Array
  }
  interface GcmDecipher {
    setAAD(aad: Uint8Array): this
    setAuthTag(tag: Uint8Array): this
    update(data: Uint8Array): Uint8Array
    final(): Uint8Array
  }
  export function pbkdf2Sync(password: Uint8Array, salt: Uint8Array, iterations: number, keylen: number, digest: 'sha256'): Uint8Array
  export function randomBytes(size: number): Uint8Array
  export function createCipheriv(algorithm: 'aes-256-gcm', key: Uint8Array, iv: Uint8Array, options: { authTagLength: 16 }): GcmCipher
  export function createDecipheriv(algorithm: 'aes-256-gcm', key: Uint8Array, iv: Uint8Array, options: { authTagLength: 16 }): GcmDecipher
}

declare module 'node:zlib' {
  export function deflateSync(data: Uint8Array): Uint8Array
  export function inflateSync(data: Uint8Array): Uint8Array
}
