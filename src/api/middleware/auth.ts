/**
 * Auth Middleware - API Key validation
 *
 * Reads X-API-Key header, looks up the key in DB (SHA-256 hash comparison),
 * and sets tenant_id on the request.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config/index.js';

// ── In-memory key cache (for development/testing) ─────────────────────────────

interface CachedKey {
  prefix: string;
  hash: string;
  tenant_id: string;
  rate_limit_per_minute: number;
  rate_limit_per_day: number;
  is_active: boolean;
}

// In production, keys are loaded from Supabase. This is the fallback.
const keyCache = new Map<string, CachedKey>();

// ── Key hashing ────────────────────────────────────────────────��──────────────

export function hashApiKey(key: string): string {
  const salt = config.apiKeySalt || '';
  return crypto.createHash('sha256').update(`${salt}${key}`).digest('hex');
}

export function extractPrefix(key: string): string {
  // Keys look like: aiden_sk_abc123_rest_of_key
  // Prefix is: aiden_sk_abc123
  const parts = key.split('_');
  if (parts.length >= 3) {
    return parts.slice(0, 3).join('_');
  }
  return key.slice(0, 16);
}

// ── Middleware ────���───────────────────���────────────────────────��───────────────

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    res.status(401).json({
      success: false,
      error: 'Missing API key. Include X-API-Key header.',
    });
    return;
  }

  // Look up key
  const prefix = extractPrefix(apiKey);
  const keyHash = hashApiKey(apiKey);

  // Try cache first, then DB lookup
  const cached = keyCache.get(prefix);

  if (cached) {
    // Timing-safe comparison
    const hashBuffer = Buffer.from(keyHash, 'hex');
    const storedBuffer = Buffer.from(cached.hash, 'hex');

    if (hashBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedBuffer)) {
      res.status(401).json({ success: false, error: 'Invalid API key' });
      return;
    }

    if (!cached.is_active) {
      res.status(403).json({ success: false, error: 'API key is deactivated' });
      return;
    }

    // Set tenant context on request
    (req as unknown as Record<string, unknown>).tenant_id = cached.tenant_id;
    (req as unknown as Record<string, unknown>).api_key_prefix = prefix;
    (req as unknown as Record<string, unknown>).rate_limit_per_minute = cached.rate_limit_per_minute;
    (req as unknown as Record<string, unknown>).rate_limit_per_day = cached.rate_limit_per_day;
    next();
    return;
  }

  // If no cache hit, attempt Supabase lookup
  lookupKeyFromDB(prefix, keyHash)
    .then((keyData) => {
      if (!keyData) {
        res.status(401).json({ success: false, error: 'Invalid API key' });
        return;
      }

      if (!keyData.is_active) {
        res.status(403).json({ success: false, error: 'API key is deactivated' });
        return;
      }

      // Cache for future requests
      keyCache.set(prefix, keyData);

      (req as unknown as Record<string, unknown>).tenant_id = keyData.tenant_id;
      (req as unknown as Record<string, unknown>).api_key_prefix = prefix;
      (req as unknown as Record<string, unknown>).rate_limit_per_minute = keyData.rate_limit_per_minute;
      (req as unknown as Record<string, unknown>).rate_limit_per_day = keyData.rate_limit_per_day;
      next();
    })
    .catch((err) => {
      console.error('[Auth] DB lookup failed:', err);
      res.status(500).json({ success: false, error: 'Auth service error' });
    });
}

// ── Admin auth (X-Admin-Secret header) ───────────────────��────────────────────

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const adminSecret = req.headers['x-admin-secret'] as string | undefined;
  const expectedSecret = process.env.ADMIN_SECRET;

  if (!expectedSecret || !adminSecret) {
    res.status(401).json({ success: false, error: 'Admin authentication required' });
    return;
  }

  const providedBuf = Buffer.from(adminSecret);
  const expectedBuf = Buffer.from(expectedSecret);

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    res.status(401).json({ success: false, error: 'Invalid admin credentials' });
    return;
  }

  next();
}

// ── DB lookup ──────────────��─────────────────────────���────────────────────────

async function lookupKeyFromDB(prefix: string, keyHash: string): Promise<CachedKey | null> {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    // No DB configured; reject all keys
    return null;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

    const { data, error } = await db
      .from('api_keys')
      .select('key_prefix, key_hash, tenant_id, rate_limit_per_minute, rate_limit_per_day, is_active')
      .eq('key_prefix', prefix)
      .single();

    if (error || !data) return null;

    // Timing-safe comparison of stored hash
    const storedHash = data.key_hash as string;
    const hashBuffer = Buffer.from(keyHash, 'hex');
    const storedBuffer = Buffer.from(storedHash, 'hex');

    if (hashBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedBuffer)) {
      return null;
    }

    return {
      prefix: data.key_prefix,
      hash: data.key_hash,
      tenant_id: data.tenant_id,
      rate_limit_per_minute: data.rate_limit_per_minute,
      rate_limit_per_day: data.rate_limit_per_day,
      is_active: data.is_active,
    };
  } catch {
    return null;
  }
}

// ── Key registration (for testing/seeding) ───────────────────────���────────────

export function registerKey(key: string, tenantId: string, opts?: Partial<CachedKey>): void {
  const prefix = extractPrefix(key);
  const hash = hashApiKey(key);
  keyCache.set(prefix, {
    prefix,
    hash,
    tenant_id: tenantId,
    rate_limit_per_minute: opts?.rate_limit_per_minute ?? 60,
    rate_limit_per_day: opts?.rate_limit_per_day ?? 1000,
    is_active: opts?.is_active ?? true,
  });
}
