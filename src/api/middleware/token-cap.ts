/**
 * Token Cap Middleware
 *
 * Enforces monthly_token_cap per tenant. At 100% of cap, returns 429.
 * Caps are set by license contract; there is no auto-billing or overage.
 * NULL cap on tenant = unlimited (pilot / trusted partner).
 */

import type { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../service-factory.js';

interface CachedTenant {
  cap: number | null;
  periodStart: Date;
  fetchedAt: number;
}

interface CachedUsage {
  tokens: number;
  fetchedAt: number;
}

const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;
const USAGE_CACHE_TTL_MS = 30 * 1000;

const tenantCache = new Map<string, CachedTenant>();
const usageCache = new Map<string, CachedUsage>();

export function currentPeriodStart(billingStart: Date, now: Date = new Date()): Date {
  if (billingStart > now) return billingStart;
  const d = new Date(billingStart);
  while (true) {
    const next = new Date(d);
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (next > now) return d;
    d.setTime(next.getTime());
  }
}

async function loadTenant(tenantId: string): Promise<CachedTenant | null> {
  const cached = tenantCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < TENANT_CACHE_TTL_MS) return cached;

  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('tenants')
    .select('monthly_token_cap, billing_period_start')
    .eq('id', tenantId)
    .single();

  if (error || !data) return null;

  const fresh: CachedTenant = {
    cap: (data.monthly_token_cap as number | null) ?? null,
    periodStart: currentPeriodStart(new Date(data.billing_period_start as string)),
    fetchedAt: now,
  };
  tenantCache.set(tenantId, fresh);
  return fresh;
}

async function loadUsage(tenantId: string, periodStart: Date): Promise<number | null> {
  const cacheKey = `${tenantId}:${periodStart.toISOString()}`;
  const cached = usageCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < USAGE_CACHE_TTL_MS) return cached.tokens;

  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db.rpc('get_monthly_token_usage', {
    p_tenant_id: tenantId,
    p_period_start: periodStart.toISOString(),
  });

  if (error) return null;
  const tokens = typeof data === 'number' ? data : 0;
  usageCache.set(cacheKey, { tokens, fetchedAt: now });
  return tokens;
}

export async function tokenCapMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string | undefined;
  if (!tenantId) {
    next();
    return;
  }

  const tenant = await loadTenant(tenantId);
  if (!tenant || tenant.cap === null) {
    next();
    return;
  }

  const usage = await loadUsage(tenantId, tenant.periodStart);
  if (usage === null) {
    next();
    return;
  }

  res.setHeader('X-Token-Cap-Monthly', tenant.cap);
  res.setHeader('X-Token-Cap-Used', usage);
  res.setHeader('X-Token-Cap-Period-Start', tenant.periodStart.toISOString());

  if (usage >= tenant.cap) {
    res.status(429).json({
      success: false,
      error: 'Monthly token cap reached',
      monthly_token_cap: tenant.cap,
      tokens_used: usage,
      period_start: tenant.periodStart.toISOString(),
      hint: 'Contact your AIDEN account manager to increase your cap.',
    });
    return;
  }

  next();
}

export function clearTokenCapCache(): void {
  tenantCache.clear();
  usageCache.clear();
}
