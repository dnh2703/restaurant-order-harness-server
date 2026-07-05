import { describe, expect, it } from 'bun:test'

import { FixedWindowRateLimiter } from '../../src/infrastructure/rate-limit/rate-limiter'
import { evaluateRateLimit } from '../../src/presentation/http/plugins/rate-limit'

/**
 * US-023: a request can be limited by more than one key (login is limited per-IP AND
 * per-account). evaluateRateLimit counts every key and blocks if ANY is over its limit,
 * reporting the longest retry-after.
 */
describe('evaluateRateLimit', () => {
  it('allows when all keys are under the limit', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 5, now: () => now })
    expect(evaluateRateLimit(limiter, ['ip:a', 'acct:x']).allowed).toBe(true)
  })

  it('blocks when the account key trips even if the IP key is fine', () => {
    let now = 0
    // account limiter shared across two different IPs → account bucket fills first
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 2, now: () => now })
    evaluateRateLimit(limiter, ['ip:1', 'acct:victim']) // acct:victim = 1
    evaluateRateLimit(limiter, ['ip:2', 'acct:victim']) // acct:victim = 2
    const third = evaluateRateLimit(limiter, ['ip:3', 'acct:victim']) // acct:victim = 3 > 2
    expect(third.allowed).toBe(false)
    expect(third.retryAfterSeconds).toBe(60)
  })

  it('counts every key so a single call advances all of its buckets', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 1, now: () => now })
    const first = evaluateRateLimit(limiter, ['ip:a', 'acct:x'])
    expect(first.allowed).toBe(true)
    // ip:a already at 1; a different account from the same IP now trips the IP key.
    expect(evaluateRateLimit(limiter, ['ip:a', 'acct:y']).allowed).toBe(false)
  })
})
