/**
 * Rate Limiter Middleware - Redis sliding window
 *
 * Per-minute and per-day limits based on API key configuration.
 * Falls back to in-memory tracking when Redis is unavailable.
 */

import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../service-factory.js';

// ── In-memory fallback ────────────────────────────────────────────────────────

interface RateWindow {
  count: number;
  resetAt: number;
}

const memoryMinute = new Map<string, RateWindow>();
const memoryDay = new Map<string, RateWindow>();

function cleanupMemory(store: Map<string, RateWindow>): void {
  const now = Date.now();
  for (const [key, window] of store) {
    if (now > window.resetAt) {
      store.delete(key);
    }
  }
}

// ── Middleware ──────────────────────────────────────────���──────────────────────

export async function rateLimiterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const prefix = (req as unknown as Record<string, unknown>).api_key_prefix as string;
  if (!prefix) {
    next();
    return;
  }

  const limitPerMinute = ((req as unknown as Record<string, unknown>).rate_limit_per_minute as number) || 60;
  const limitPerDay = ((req as unknown as Record<string, unknown>).rate_limit_per_day as number) || 1000;

  const redis = await getRedis();

  if (redis) {
    // Redis sliding window implementation
    const minuteKey = `brain:rate:${prefix}:min`;
    const dayKey = `brain:rate:${prefix}:day`;

    const [minuteCount, dayCount] = await Promise.all([
      redis.incr(minuteKey),
      redis.incr(dayKey),
    ]);

    // Set expiry on first request
    if (minuteCount === 1) await redis.expire(minuteKey, 60);
    if (dayCount === 1) await redis.expire(dayKey, 86400);

    if (minuteCount > limitPerMinute) {
      const ttl = await redis.ttl(minuteKey);
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded (per-minute)',
        retry_after_seconds: ttl > 0 ? ttl : 60,
        limit: limitPerMinute,
        window: 'minute',
      });
      return;
    }

    if (dayCount > limitPerDay) {
      const ttl = await redis.ttl(dayKey);
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded (per-day)',
        retry_after_seconds: ttl > 0 ? ttl : 86400,
        limit: limitPerDay,
        window: 'day',
      });
      return;
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit-Minute', limitPerMinute);
    res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, limitPerMinute - minuteCount));
    res.setHeader('X-RateLimit-Limit-Day', limitPerDay);
    res.setHeader('X-RateLimit-Remaining-Day', Math.max(0, limitPerDay - dayCount));
  } else {
    // In-memory fallback
    const now = Date.now();
    cleanupMemory(memoryMinute);
    cleanupMemory(memoryDay);

    const minuteWindow = memoryMinute.get(prefix) || { count: 0, resetAt: now + 60000 };
    const dayWindow = memoryDay.get(prefix) || { count: 0, resetAt: now + 86400000 };

    if (now > minuteWindow.resetAt) {
      minuteWindow.count = 0;
      minuteWindow.resetAt = now + 60000;
    }
    if (now > dayWindow.resetAt) {
      dayWindow.count = 0;
      dayWindow.resetAt = now + 86400000;
    }

    minuteWindow.count++;
    dayWindow.count++;
    memoryMinute.set(prefix, minuteWindow);
    memoryDay.set(prefix, dayWindow);

    if (minuteWindow.count > limitPerMinute) {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded (per-minute)',
        retry_after_seconds: Math.ceil((minuteWindow.resetAt - now) / 1000),
        limit: limitPerMinute,
        window: 'minute',
      });
      return;
    }

    if (dayWindow.count > limitPerDay) {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded (per-day)',
        retry_after_seconds: Math.ceil((dayWindow.resetAt - now) / 1000),
        limit: limitPerDay,
        window: 'day',
      });
      return;
    }

    res.setHeader('X-RateLimit-Limit-Minute', limitPerMinute);
    res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, limitPerMinute - minuteWindow.count));
  }

  next();
}
