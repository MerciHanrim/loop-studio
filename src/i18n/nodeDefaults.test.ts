import { describe, expect, it } from 'vitest'
import type { NodeKind } from '../model/types'
import en from './locales/en'
import ja from './locales/ja'
import ko from './locales/ko'
import { NODE_DEFAULT_KEY, defaultNodeLabel } from './nodeDefaults'

// docs/localization.md §L3.4a — the default NAME a new node gets, per UI
// language. Distinct from `palette.<kind>.name` (KO 풀 vs 저장소).
const KINDS: NodeKind[] = [
  'pool',
  'source',
  'drain',
  'gate',
  'converter',
  'end',
  'parameter',
  'register',
]

describe('defaultNodeLabel', () => {
  it('every node kind has a key and a non-empty value in EN, KO and JA', () => {
    for (const k of KINDS) {
      expect(NODE_DEFAULT_KEY[k], `${k}: key`).toBe(`node.default.${k}`)
      expect(defaultNodeLabel(k, en), `${k}: en`).toBeTruthy()
      expect(defaultNodeLabel(k, ko), `${k}: ko`).toBeTruthy()
      expect(defaultNodeLabel(k, ja), `${k}: ja`).toBeTruthy()
    }
  })

  it('EN keeps the English names; KO and JA use their descriptive names', () => {
    expect(defaultNodeLabel('pool', en)).toBe('Pool')
    expect(defaultNodeLabel('source', en)).toBe('Source')
    expect(defaultNodeLabel('pool', ko)).toBe('저장소')
    expect(defaultNodeLabel('source', ko)).toBe('공급원')
    expect(defaultNodeLabel('drain', ko)).toBe('배출구')
    expect(defaultNodeLabel('pool', ja)).toBe('ストック')
    expect(defaultNodeLabel('source', ja)).toBe('供給源')
    expect(defaultNodeLabel('register', ja)).toBe('計算値')
    expect(defaultNodeLabel('end', ja)).toBe('終点')
  })

  it('the KO default name differs from the KO palette button label', () => {
    // palette button = 풀 / 소스 …; a placed node = 저장소 / 공급원 …
    expect(defaultNodeLabel('pool', ko)).not.toBe(ko['palette.pool.name'])
    expect(defaultNodeLabel('source', ko)).not.toBe(ko['palette.source.name'])
  })
})
