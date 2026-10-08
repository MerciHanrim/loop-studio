import { describe, expect, it } from 'vitest'
import { BADGE_DX, BADGE_DY, BADGE_H, badgeText, badgeWidth, badgeX, labelUnderToken, overlaps, TOKEN_R, tokenAndBadgeBoxes } from './playbackBadge'
import { MAX_PLAYBACK_TOKENS_TOTAL } from './playback-caps'

// issue #330 PR 1 — the `+N` badge beside the round token and the own-label rule.

describe('the +N badge', () => {
  it('is always signed, from +1, with at most one decimal', () => {
    expect(badgeText(1)).toBe('+1')
    expect(badgeText(3)).toBe('+3')
    expect(badgeText(4.8)).toBe('+4.8')
    expect(badgeText(2.25)).toBe('+2.3')
    expect(badgeText(120)).toBe('+120')
  })

  it('sits beside the token: right of it while travelling, left of the target end under reduced motion', () => {
    const [tok, right] = tokenAndBadgeBoxes(100, 50, '+3')
    expect(tok).toEqual({ x0: 100 - TOKEN_R, y0: 50 - TOKEN_R, x1: 100 + TOKEN_R, y1: 50 + TOKEN_R })
    expect(right.x0).toBe(100 + BADGE_DX)
    expect(right.x1 - right.x0).toBe(badgeWidth('+3'))
    expect(right.y1 - right.y0).toBe(BADGE_H)
    expect((right.y0 + right.y1) / 2).toBe(50 + BADGE_DY)
    const [, left] = tokenAndBadgeBoxes(100, 50, '+3', 'left')
    expect(left.x1).toBe(100 - BADGE_DX)
    expect(badgeX('+3', 'left')).toBe(-BADGE_DX - badgeWidth('+3'))
    // the badge never covers the token itself
    expect(overlaps(tok, right)).toBe(false)
    expect(overlaps(tok, left)).toBe(false)
  })

  it('grows with its text', () => {
    expect(badgeWidth('+120')).toBeGreaterThan(badgeWidth('+1'))
  })
})

describe("the connection's own label dims only while the token or its badge covers it", () => {
  const label = { x: 200, y: 100, w: 24, h: 16 }
  it('under the token', () => {
    expect(labelUnderToken(label, 200, 100, '+1')).toBe(true)
  })
  it('under the badge only', () => {
    // the badge's box reaches the label while the token is left of and below it
    expect(labelUnderToken(label, 180, 112, '+1')).toBe(true)
  })
  it('not while both are clear of it', () => {
    expect(labelUnderToken(label, 120, 100, '+1')).toBe(false)
    expect(labelUnderToken(label, 200, 160, '+1')).toBe(false)
  })
  it('never without a measured label', () => {
    expect(labelUnderToken(null, 200, 100, '+1')).toBe(false)
    expect(labelUnderToken({ ...label, w: 0 }, 200, 100, '+1')).toBe(false)
  })
})

describe('the step cap', () => {
  it('is 24 token-and-badge pairs (it was 60 travelling cues)', () => {
    expect(MAX_PLAYBACK_TOKENS_TOTAL).toBe(24)
  })
})
