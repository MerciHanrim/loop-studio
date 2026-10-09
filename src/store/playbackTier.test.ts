import { describe, expect, it } from 'vitest'
import { PHONE_SPEEDS, TIER_FAST_MIN_MS, TIER_FULL_MIN_MS, tierOf } from './playbackTier'
import { MAX_PLAYBACK_TOKENS_PHONE, MAX_PLAYBACK_TOKENS_TOTAL } from '../components/edges/playback-caps'

// issue #330 PR 3 (v0.24.0), docs/simulation-playback.md §PB6.1

describe('the speed tiers', () => {
  it('have exact boundaries: ≥ 400 full, 200 … 399 fast, < 200 very fast', () => {
    expect(TIER_FULL_MIN_MS).toBe(400)
    expect(TIER_FAST_MIN_MS).toBe(200)
    expect(tierOf(2400)).toBe('full')
    expect(tierOf(400)).toBe('full')
    expect(tierOf(399)).toBe('fast')
    expect(tierOf(200)).toBe('fast')
    expect(tierOf(199)).toBe('veryFast')
    expect(tierOf(120)).toBe('veryFast')
  })

  it('put each of the phone’s four speeds in exactly one tier', () => {
    expect(PHONE_SPEEDS.map((s) => [s.key, s.ms, tierOf(s.ms)])).toEqual([
      ['slow', 1000, 'full'],
      ['normal', 600, 'full'],
      ['fast', 300, 'fast'],
      ['veryFast', 120, 'veryFast'],
    ])
  })
})

describe('the phone profile', () => {
  it('draws at most 12 token-and-badge pairs, half the desktop 24', () => {
    expect(MAX_PLAYBACK_TOKENS_PHONE).toBe(12)
    expect(MAX_PLAYBACK_TOKENS_TOTAL).toBe(24)
  })
})
