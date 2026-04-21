/**
 * Token Cap Middleware Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

let tenantRow: { monthly_token_cap: number | null; billing_period_start: string } | null = null;
let usageValue: number = 0;

vi.mock('../../src/api/service-factory.js', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: tenantRow, error: tenantRow ? null : { message: 'not found' } }),
        }),
      }),
    }),
    rpc: async () => ({ data: usageValue, error: null }),
  }),
}));

const { tokenCapMiddleware, currentPeriodStart, clearTokenCapCache } = await import(
  '../../src/api/middleware/token-cap.js'
);

function mockReq(tenantId?: string): Request {
  return {
    headers: {},
    tenant_id: tenantId,
  } as unknown as Request;
}

function mockRes() {
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
  return res;
}

describe('currentPeriodStart', () => {
  it('returns the most recent monthly anniversary on or before now', () => {
    const billing = new Date('2026-01-15T00:00:00Z');
    const now = new Date('2026-04-22T10:00:00Z');
    const period = currentPeriodStart(billing, now);
    expect(period.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  it('returns billing start itself when billing is in the future', () => {
    const billing = new Date('2027-01-15T00:00:00Z');
    const now = new Date('2026-04-22T10:00:00Z');
    const period = currentPeriodStart(billing, now);
    expect(period.toISOString()).toBe(billing.toISOString());
  });

  it('returns billing start when now is within first period', () => {
    const billing = new Date('2026-04-01T00:00:00Z');
    const now = new Date('2026-04-22T10:00:00Z');
    const period = currentPeriodStart(billing, now);
    expect(period.toISOString()).toBe(billing.toISOString());
  });
});

describe('Token Cap Middleware', () => {
  beforeEach(() => {
    clearTokenCapCache();
    tenantRow = null;
    usageValue = 0;
  });

  it('skips when no tenant_id on request', async () => {
    const next = vi.fn();
    const res = mockRes();
    await tokenCapMiddleware(mockReq(), res as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('skips when tenant has NULL cap (unlimited)', async () => {
    tenantRow = { monthly_token_cap: null, billing_period_start: '2026-01-15T00:00:00Z' };
    usageValue = 9_999_999;
    const next = vi.fn();
    const res = mockRes();
    await tokenCapMiddleware(mockReq('t-unlimited'), res as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('allows request under cap and sets usage headers', async () => {
    tenantRow = { monthly_token_cap: 1_000_000, billing_period_start: '2026-01-15T00:00:00Z' };
    usageValue = 250_000;
    const next = vi.fn();
    const res = mockRes();
    await tokenCapMiddleware(mockReq('t-under'), res as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.headers['X-Token-Cap-Monthly']).toBe(1_000_000);
    expect(res.headers['X-Token-Cap-Used']).toBe(250_000);
  });

  it('blocks request at 100% cap with 429', async () => {
    tenantRow = { monthly_token_cap: 500_000, billing_period_start: '2026-01-15T00:00:00Z' };
    usageValue = 500_000;
    const next = vi.fn();
    const res = mockRes();
    await tokenCapMiddleware(mockReq('t-at-cap'), res as unknown as Response, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: string }).error).toBe('Monthly token cap reached');
  });

  it('blocks request over cap with 429', async () => {
    tenantRow = { monthly_token_cap: 500_000, billing_period_start: '2026-01-15T00:00:00Z' };
    usageValue = 750_000;
    const next = vi.fn();
    const res = mockRes();
    await tokenCapMiddleware(mockReq('t-over'), res as unknown as Response, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
  });
});
