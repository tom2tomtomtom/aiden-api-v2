/**
 * API Types - Express request extensions and shared types
 */

import type { Request } from 'express';

/**
 * Extract tenant context set by auth middleware.
 * Use this helper instead of casting req directly.
 */
export function getTenantId(req: Request): string {
  return (req as unknown as Record<string, unknown>).tenant_id as string || 'default';
}

export function getApiKeyPrefix(req: Request): string {
  return (req as unknown as Record<string, unknown>).api_key_prefix as string || '';
}

export function getRateLimitPerMinute(req: Request): number {
  return ((req as unknown as Record<string, unknown>).rate_limit_per_minute as number) || 60;
}

export function getRateLimitPerDay(req: Request): number {
  return ((req as unknown as Record<string, unknown>).rate_limit_per_day as number) || 1000;
}

export function setTenantContext(req: Request, ctx: {
  tenant_id: string;
  api_key_prefix: string;
  rate_limit_per_minute?: number;
  rate_limit_per_day?: number;
}): void {
  const r = req as unknown as Record<string, unknown>;
  r.tenant_id = ctx.tenant_id;
  r.api_key_prefix = ctx.api_key_prefix;
  if (ctx.rate_limit_per_minute) r.rate_limit_per_minute = ctx.rate_limit_per_minute;
  if (ctx.rate_limit_per_day) r.rate_limit_per_day = ctx.rate_limit_per_day;
}

export function getRawBody(req: Request): string {
  return (req as unknown as Record<string, unknown>).rawBody as string || JSON.stringify(req.body);
}
