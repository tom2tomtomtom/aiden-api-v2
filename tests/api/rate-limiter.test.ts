/**
 * Rate Limiter Tests
 *
 * Tests sliding window, per-minute/per-day limits using in-memory fallback.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rateLimiterMiddleware } from '../../src/api/middleware/rate-limiter.js';
import type { Request, Response, NextFunction } from 'express';

// ── Mock Redis (returns null to force in-memory fallback) ────────────────────

vi.mock('../../src/api/service-factory.js', () => ({
  getRedis: async () => null,
}));

// ── Mock Express objects ─────────────────────────────────────────────────────

function mockReq(prefix: string, perMinute = 60, perDay = 1000): Request {
  return {
    headers: {},
    api_key_prefix: prefix,
    rate_limit_per_minute: perMinute,
    rate_limit_per_day: perDay,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown; headers: Record<string, unknown> } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, unknown>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    setHeader(name: string, value: unknown) {
      res.headers[name] = value;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, unknown> };
}

describe('Rate Limiter Middleware', () => {
  beforeEach(() => {
    // Reset timers for clean state
    vi.useFakeTimers();
  });

  it('allows requests under the minute limit', async () => {
    const req = mockReq('test_prefix_1', 5, 1000);
    const res = mockRes();
    let nextCalled = false;

    await rateLimiterMiddleware(req, res, (() => { nextCalled = true; }) as NextFunction);

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('blocks requests over the minute limit', async () => {
    const prefix = 'test_prefix_2';
    const limit = 3;

    for (let i = 0; i < limit; i++) {
      const req = mockReq(prefix, limit, 1000);
      const res = mockRes();
      await rateLimiterMiddleware(req, res, (() => {}) as NextFunction);
    }

    // This should be blocked
    const req = mockReq(prefix, limit, 1000);
    const res = mockRes();
    let nextCalled = false;
    await rateLimiterMiddleware(req, res, (() => { nextCalled = true; }) as NextFunction);

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect((res.body as Record<string, unknown>).window).toBe('minute');
  });

  it('blocks requests over the day limit', async () => {
    const prefix = 'test_prefix_3';
    const dayLimit = 2;

    for (let i = 0; i < dayLimit; i++) {
      const req = mockReq(prefix, 100, dayLimit);
      const res = mockRes();
      await rateLimiterMiddleware(req, res, (() => {}) as NextFunction);
    }

    // This should be blocked by day limit
    const req = mockReq(prefix, 100, dayLimit);
    const res = mockRes();
    let nextCalled = false;
    await rateLimiterMiddleware(req, res, (() => { nextCalled = true; }) as NextFunction);

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect((res.body as Record<string, unknown>).window).toBe('day');
  });

  it('passes through when no prefix set', async () => {
    const req = { headers: {} } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;

    await rateLimiterMiddleware(req, res, (() => { nextCalled = true; }) as NextFunction);

    expect(nextCalled).toBe(true);
  });

  it('sets rate limit headers', async () => {
    const req = mockReq('test_prefix_4', 60, 1000);
    const res = mockRes();

    await rateLimiterMiddleware(req, res, (() => {}) as NextFunction);

    expect(res.headers['X-RateLimit-Limit-Minute']).toBe(60);
    expect(res.headers['X-RateLimit-Remaining-Minute']).toBe(59);
  });

  it('resets after window expires', async () => {
    const prefix = 'test_prefix_5';
    const limit = 2;

    // Use up the limit
    for (let i = 0; i < limit; i++) {
      const req = mockReq(prefix, limit, 1000);
      const res = mockRes();
      await rateLimiterMiddleware(req, res, (() => {}) as NextFunction);
    }

    // Advance time past the minute window
    vi.advanceTimersByTime(61000);

    // Should work again
    const req = mockReq(prefix, limit, 1000);
    const res = mockRes();
    let nextCalled = false;
    await rateLimiterMiddleware(req, res, (() => { nextCalled = true; }) as NextFunction);

    expect(nextCalled).toBe(true);
  });

  it('includes retry_after_seconds in 429 response', async () => {
    const prefix = 'test_prefix_6';
    const limit = 1;

    // Use up limit
    const req1 = mockReq(prefix, limit, 1000);
    const res1 = mockRes();
    await rateLimiterMiddleware(req1, res1, (() => {}) as NextFunction);

    // Trigger rate limit
    const req2 = mockReq(prefix, limit, 1000);
    const res2 = mockRes();
    await rateLimiterMiddleware(req2, res2, (() => {}) as NextFunction);

    expect(res2.statusCode).toBe(429);
    expect((res2.body as Record<string, unknown>).retry_after_seconds).toBeDefined();
    expect((res2.body as Record<string, unknown>).retry_after_seconds).toBeGreaterThan(0);
  });
});
