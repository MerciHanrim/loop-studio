import type { Plugin } from 'vite'

/** where Vite's own `build.license` JSON is written before this plugin reads and removes it */
export declare const VITE_LICENSE_JSON: string

/** Issue #301 - writes THIRD_PARTY_NOTICES for one build flavour and fails the build on a manifest mismatch. */
export declare function thirdPartyNotices(options: { flavour: 'web' | 'pwa' | 'portable'; root?: string }): Plugin

/** Issue #301 - the dev server's THIRD_PARTY_NOTICES.txt: the web build's text rebuilt from the manifest, from memory. */
export declare function thirdPartyNoticesDev(options?: { root?: string }): Plugin
