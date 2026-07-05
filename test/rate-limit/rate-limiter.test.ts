import { describe, expect, it } from 'bun:test'

import { FixedWindowRateLimiter } from '../../src/infrastructure/rate-limit/rate-limiter'

/**
 * US-023: fixed-window limiter core. Deterministic via an injected clock so no real time
 * passes. `check(key)` counts one hit and reports whether the key is still under the limit
 * plus how long until the window resets.
 */
describe('FixedWindowRateLimiter', () => {
  it('allows up to `max` hits then blocks within the same window', () => {
    let now = 1_000
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 3, now: () => now })
    expect(limiter.check('k').allowed).toBe(true) // 1
    expect(limiter.check('k').allowed).toBe(true) // 2
    expect(limiter.check('k').allowed).toBe(true) // 3
    const blocked = limiter.check('k') // 4
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBe(60)
  })

  it('resets after the window elapses', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter({ windowMs: 10_000, max: 1, now: () => now })
    expect(limiter.check('k').allowed).toBe(true)
    expect(limiter.check('k').allowed).toBe(false)
    now += 10_000 // window boundary reached
    expect(limiter.check('k').allowed).toBe(true)
  })

  it('reports a shrinking retryAfter as the window advances', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter({ windowMs: 30_000, max: 1, now: () => now })
    limiter.check('k')
    expect(limiter.check('k').retryAfterSeconds).toBe(30)
    now += 20_000
    expect(limiter.check('k').retryAfterSeconds).toBe(10)
  })

  it('isolates keys from each other', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 1, now: () => now })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true) // b unaffected by a
  })

  it('evicts stale keys so memory stays bounded', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter({ windowMs: 1_000, max: 5, now: () => now })
    for (let i = 0; i < 100; i += 1) limiter.check(`key-${i}`)
    expect(limiter.size).toBe(100)
    now += 1_000 // all windows now expired
    limiter.check('fresh') // triggers lazy sweep
    expect(limiter.size).toBe(1)
  })
})
