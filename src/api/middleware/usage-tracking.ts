/**
 * Usage Tracking Middleware - Fire-and-forget logging
 *
 * Logs every API request to the usage_logs table for billing and analytics.
 * Non-blocking: failures do not affect the response.
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config/index.js';

// ── In-memory buffer (batches writes) ────────────────────────��────────────────

interface UsageEntry {
  tenant_id: string;
  api_key_prefix: string;
  endpoint: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  status_code: number;
  created_at: string;
}

const buffer: UsageEntry[] = [];
const FLUSH_INTERVAL_MS = 10000; // Flush every 10s
const MAX_BUFFER_SIZE = 100;

// Start flush interval
let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlushing(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
}

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0, buffer.length);

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    // No DB configured, discard
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(config.supabaseUrl, config.supabaseServiceKey);
    await db.from('usage_logs').insert(batch);
  } catch (err) {
    console.warn('[UsageTracking] Failed to flush usage logs:', err instanceof Error ? err.message : err);
    // Put entries back if DB write failed (up to max)
    if (buffer.length < MAX_BUFFER_SIZE * 2) {
      buffer.unshift(...batch);
    }
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────────

export function usageTrackingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  startFlushing();

  // Hook into response finish event
  res.on('finish', () => {
    const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
    const prefix = (req as unknown as Record<string, unknown>).api_key_prefix as string;

    if (!tenantId || !prefix) return;

    const duration = Date.now() - startTime;

    const entry: UsageEntry = {
      tenant_id: tenantId,
      api_key_prefix: prefix,
      endpoint: req.path,
      model: (req.body?.model as string) || null,
      input_tokens: 0, // Updated post-response if available
      output_tokens: 0,
      cost_usd: 0,
      duration_ms: duration,
      status_code: res.statusCode,
      created_at: new Date().toISOString(),
    };

    buffer.push(entry);

    // Force flush if buffer is large
    if (buffer.length >= MAX_BUFFER_SIZE) {
      flushBuffer().catch(() => {});
    }
  });

  next();
}

// ── Cleanup ───────────────────────────────────��───────────────────────────────

export function stopUsageTracking(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushBuffer().catch(() => {});
}
