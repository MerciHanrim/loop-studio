// Types for the parts of `core.mjs` that TypeScript code imports (the e2e
// specs). The rest of the module is used from plain .mjs only.

/** SHA-256 of a string's UTF-8 bytes, as hex */
export declare const sha256: (text: string) => string
/** the id of the portable build's `<template>` holding the notices */
export declare const PORTABLE_TEMPLATE_ID: string
export declare const NOTICES_FILE: string
/** the `<template>` element holding the notices text, escaped; throws on U+0000 or CR */
export declare function portableTemplate(text: string): string
