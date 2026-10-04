// Issue #301 - the build step that writes THIRD_PARTY_NOTICES for one build
// flavour ('web', 'pwa' or 'portable') and fails the build when what is shipped
// differs from licenses/third-party-manifest.json.
//
// Where each fact comes from:
//   - packages: every chunk's module ids, read in `renderChunk` (before the
//     portable build's single-file inlining removes the chunks); a module in a
//     package directory names that package
//   - Vite's own `build.license` JSON, read and cross-checked, then removed from
//     the output so it is not deployed (it misses font files referenced from CSS
//     and is empty in the single-file build)
//   - fonts: `@fontsource/<name>` referenced from a CSS module's text (comments
//     stripped); in web / PWA also the emitted font files' original paths
//   - build-tool runtime: the virtual modules `\0vite/...` and `\0rolldown/...`
//     (licenses/registry.json `runtime`)
//   - the PWA service worker, which Workbox builds outside this graph: the
//     registry's `serviceWorker` list; `scripts/check-third-party-notices.mjs`
//     proves after the build that each one really is in sw.js / workbox-*.js
//
// THIRD_PARTY_NOTICES_UPDATE=1 writes this flavour's section of the manifest
// instead of comparing (`npm run licenses:update` runs all three builds).
import fs from 'node:fs'
import path from 'node:path'
import {
  LOCAL_PATH,
  NOTICES_FILE,
  checkEntries,
  diffSection,
  injectPortableTemplate,
  manifestSection,
  packageDirOf,
  readPackage,
  renderNotices,
} from './core.mjs'

export const VITE_LICENSE_JSON = '.vite/third-party-licenses.json'

export function thirdPartyNotices({ flavour, root = process.cwd() }) {
  const manifestPath = path.join(root, 'licenses', 'third-party-manifest.json')
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'licenses', 'registry.json'), 'utf8'))
  const update = process.env.THIRD_PARTY_NOTICES_UPDATE === '1'
  const packageDirs = new Set()
  const virtualModules = new Set()
  const fontPackages = new Set()
  const nm = (name) => path.join(root, 'node_modules', ...name.split('/'))

  return {
    name: 'loop-studio:third-party-notices',
    enforce: 'post',
    apply: 'build',
    buildStart() {
      packageDirs.clear()
      virtualModules.clear()
      fontPackages.clear()
    },
    transform: {
      // 'pre': see the CSS as written, before Vite turns it into a JS module
      // and rewrites its url()s
      order: 'pre',
      handler(code, id) {
        const file = id.split('?')[0].split(path.sep).join('/')
        if (!file.endsWith('.css') || file.includes('/node_modules/')) return null
        const text = code.replace(/\/\*[\s\S]*?\*\//g, '')
        for (const m of text.matchAll(/@fontsource\/[a-z0-9-]+/g)) fontPackages.add(m[0])
        return null
      },
    },
    renderChunk(_code, chunk) {
      for (const id of chunk.moduleIds) {
        if (id.startsWith('\0')) virtualModules.add(id.slice(1))
        else {
          const dir = packageDirOf(id)
          if (dir) packageDirs.add(dir)
        }
      }
      return null
    },
    generateBundle: {
      order: 'post',
      handler(_opts, bundle) {
        const problems = []
        // ---- Vite's own list: evidence, then out of the deploy
        const viteJson = bundle[VITE_LICENSE_JSON]
        let viteNames = null
        if (viteJson && viteJson.type === 'asset') {
          viteNames = JSON.parse(String(viteJson.source)).map((e) => `${e.name}@${e.version}`)
          delete bundle[VITE_LICENSE_JSON]
        } else if (flavour !== 'portable') problems.push(`Vite's build.license output (${VITE_LICENSE_JSON}) is missing`)

        // ---- fonts from emitted files (web / PWA)
        for (const f of Object.values(bundle)) {
          if (f.type !== 'asset' || !/\.(woff2?|ttf|otf)$/.test(f.fileName)) continue
          for (const o of f.originalFileNames ?? []) {
            const dir = packageDirOf(o.startsWith('/') || /^[A-Za-z]:/.test(o) ? o : path.join(root, o))
            // a font package reaches the build in one of two ways: our CSS names
            // its files in url(), or the package's own CSS module is imported
            if (!dir) problems.push(`${f.fileName}: a font file that does not come from a package (${o})`)
            else if (!fontPackages.has(dir.slice(dir.lastIndexOf('/node_modules/') + 14)) && !packageDirs.has(dir)) problems.push(`${f.fileName}: comes from ${dir}, which neither a CSS module of ours names nor the module graph contains`)
          }
        }

        // ---- the entries
        const entries = []
        const add = (dir, extra = {}) => {
          // registry `files`: [{ file, covers }] - each licence file pinned as
          // its own input, with what it covers (e.g. Rolldown's own MIT
          // licence and its THIRD-PARTY-LICENSE)
          const p = readPackage(dir, { files: extra.files?.map((f) => f.file) ?? null })
          if (entries.some((e) => e.name === p.name && e.version === p.version)) return
          const source = extra.source ?? (p.name.startsWith('@fontsource/') ? 'font files' : 'bundled code')
          const licenceFiles = p.licenceFiles.map((l) => ({ ...l, ...(extra.files ? { covers: extra.files.find((f) => f.file === l.file).covers } : {}) }))
          entries.push({ ...p, licenceFiles, source, copyright: extra.copyright ?? p.copyright, ...(extra.licenceSummary !== undefined ? { licenceSummary: extra.licenceSummary } : {}) })
        }
        // fonts first: a font package can also reach the graph through its CSS
        // module, and the first entry decides how it is described
        for (const name of [...fontPackages].sort()) add(nm(name), { source: 'font files' })
        for (const dir of [...packageDirs].sort()) add(dir)
        for (const r of registry.runtime) {
          if (!r.builds.includes(flavour)) continue
          if (!virtualModules.has(r.evidence.virtualModule)) {
            problems.push(`${r.name}: the registry lists it for ${flavour}, but \\0${r.evidence.virtualModule} is not in the bundle`)
            continue
          }
          add(nm(r.name), { files: r.files, source: r.source, licenceSummary: r.licenceSummary })
        }
        for (const v of virtualModules) {
          const known = registry.runtime.some((r) => r.evidence.virtualModule === v)
          if (!known && /^(vite|rolldown)\//.test(v) && v !== 'vite/modulepreload-polyfill.js') problems.push(`\\0${v}: a build-tool virtual module the registry does not cover`)
        }
        if (flavour === 'pwa') for (const s of registry.serviceWorker) add(nm(s.name), { source: s.source, copyright: s.copyright })

        // ---- Vite's list must be inside ours
        if (viteNames) {
          const ours = new Set(entries.map((e) => `${e.name}@${e.version}`))
          for (const n of viteNames) if (!ours.has(n)) problems.push(`${n}: in Vite's build.license output but not found by this plugin`)
        }

        problems.push(...checkEntries(entries, registry.reviews ?? {}))
        entries.sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1))
        const text = renderNotices(entries)
        const section = manifestSection(entries, text)
        if (LOCAL_PATH.test(text)) problems.push(`the notices text holds a local absolute path: '${text.match(LOCAL_PATH)[0].trim()}'`)
        if (LOCAL_PATH.test(JSON.stringify(section))) problems.push('the manifest section holds a local absolute path')

        const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { builds: {} }
        // the bundler shows only the first line of an error: print the whole list
        const fail = (head) => {
          console.error(`\n${head}\n  ${problems.join('\n  ')}\n`)
          this.error(`${head} (${problems.length} problem(s), listed above)`)
        }
        if (update) {
          if (problems.length) fail(`third-party notices (${flavour}): not updating the manifest`)
          manifest.builds[flavour] = section
          const ordered = { _about: 'Generated by `npm run licenses:update`; checked by every build. See licenses/README.md.', builds: Object.fromEntries(Object.keys(manifest.builds).sort().map((k) => [k, manifest.builds[k]])) }
          fs.writeFileSync(manifestPath, JSON.stringify(ordered, null, 2) + '\n')
        } else {
          problems.push(...diffSection(manifest.builds?.[flavour], section).map((d) => `manifest: ${d}`))
          if (problems.length) fail(`third-party notices (${flavour}) do not match licenses/third-party-manifest.json - run \`npm run licenses:update\` and review the diff`)
        }

        // ---- the notices themselves
        if (flavour === 'portable') {
          const html = Object.values(bundle).filter((f) => f.type === 'asset' && f.fileName.endsWith('.html'))
          if (html.length !== 1) this.error(`third-party notices (portable): expected one HTML file, found ${html.length}`)
          try {
            html[0].source = injectPortableTemplate(String(html[0].source), text)
          } catch (err) {
            this.error(`third-party notices (portable): ${err.message}`)
          }
        } else {
          this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: text })
        }
      },
    },
  }
}
