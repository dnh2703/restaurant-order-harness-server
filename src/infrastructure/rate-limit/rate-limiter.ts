/**
 * In-memory fixed-window rate limiter (US-023 / decision 0023). Each key holds a window
 * start and a hit count; a hit past `max` within the window is blocked until the window
 * rolls over. Deterministic via an injectable `now` clock so it is unit-testable without
 * real time.
 *
 * Baseline store is per-process: counters are not shared across instances and reset on
 * restart. A shared store (e.g. Redis) is the documented upgrade for multi-instance
 * deployments (decision 0023 §Alt 3).
 */

export interface RateLimitResult {
  /** True if this hit is within the limit. */
  allowed: boolean
  /** Seconds until the current window resets (for a `Retry-After` header). */
  retryAfterSeconds: number
}

export interface RateLimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number
  /** Max hits allowed per key per window. */
  max: number
  /** Clock injection (tests). Defaults to `Date.now`. */
  now?: () => number
}

interface Window {
  start: number
  count: number
}

export class FixedWindowRateLimiter {
  private readonly windowMs: number
  private readonly max: number
  private readonly now: () => number
  private readonly windows = new Map<string, Window>()

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs
    this.max = options.max
    this.now = options.now ?? Date.now
  }

  /** Number of tracked keys (test/observability aid). */
  get size(): number {
    return this.windows.size
  }

  /** Count one hit against `key` and report whether it is within the limit. */
  check(key: string): RateLimitResult {
    const now = this.now()
    this.sweep(now)

    let window = this.windows.get(key)
    if (!window || now - window.start >= this.windowMs) {
      window = { start: now, count: 0 }
      this.windows.set(key, window)
    }
    window.count += 1

    const retryAfterSeconds = Math.ceil((window.start + this.windowMs - now) / 1000)
    return { allowed: window.count <= this.max, retryAfterSeconds }
  }

  /** Drop windows that have fully elapsed so memory stays bounded under many distinct keys. */
  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key)
    }
  }
}
