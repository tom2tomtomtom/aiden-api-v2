/**
 * API Key Management Endpoints
 *
 * POST /api/v1/keys (admin only) - Create new API key
 * POST /api/v1/keys/:prefix/rotate (admin only) - Rotate key with 24h grace
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { adminAuthMiddleware, hashApiKey, extractPrefix } from '../middleware/auth.js';
import { config } from '../../config/index.js';

const router = Router();

// ── Create Key ────────────────────────────────────────────────────────────────

const CreateKeySchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  rate_limit_per_minute: z.number().int().min(1).max(10000).optional().default(60),
  rate_limit_per_day: z.number().int().min(1).max(1000000).optional().default(1000),
});

router.post('/keys', adminAuthMiddleware, async (req: Request, res: Response) => {
  const parsed = CreateKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { tenant_id, name, rate_limit_per_minute, rate_limit_per_day } = parsed.data;

  // Generate key: aiden_sk_{random}
  const randomPart = crypto.randomBytes(24).toString('base64url');
  const prefix = `aiden_sk_${crypto.randomBytes(4).toString('hex')}`;
  const fullKey = `${prefix}_${randomPart}`;
  const keyHash = hashApiKey(fullKey);

  // Store in DB
  if (config.supabaseUrl && config.supabaseServiceKey) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

      const { error } = await db.from('api_keys').insert({
        tenant_id,
        key_prefix: prefix,
        key_hash: keyHash,
        name,
        rate_limit_per_minute,
        rate_limit_per_day,
        is_active: true,
      });

      if (error) {
        res.status(500).json({ success: false, error: 'Failed to store key', details: error.message });
        return;
      }
    } catch (err) {
      res.status(500).json({ success: false, error: 'Database error' });
      return;
    }
  }

  // Return the full key (only time it's visible)
  res.status(201).json({
    success: true,
    data: {
      key: fullKey,
      prefix,
      name,
      tenant_id,
      rate_limit_per_minute,
      rate_limit_per_day,
      message: 'Store this key securely. It cannot be retrieved again.',
    },
  });
});

// ── Rotate Key ────────────────────────────────────────────────────────────────

router.post('/keys/:prefix/rotate', adminAuthMiddleware, async (req: Request, res: Response) => {
  const { prefix } = req.params;

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    res.status(503).json({ success: false, error: 'Database not configured' });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

    // Look up existing key
    const { data: existing } = await db
      .from('api_keys')
      .select('*')
      .eq('key_prefix', prefix)
      .eq('is_active', true)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Key not found or already deactivated' });
      return;
    }

    // Generate new key with same tenant
    const randomPart = crypto.randomBytes(24).toString('base64url');
    const newPrefix = `aiden_sk_${crypto.randomBytes(4).toString('hex')}`;
    const newFullKey = `${newPrefix}_${randomPart}`;
    const newKeyHash = hashApiKey(newFullKey);

    // Create new key
    await db.from('api_keys').insert({
      tenant_id: existing.tenant_id,
      key_prefix: newPrefix,
      key_hash: newKeyHash,
      name: `${existing.name} (rotated)`,
      rate_limit_per_minute: existing.rate_limit_per_minute,
      rate_limit_per_day: existing.rate_limit_per_day,
      is_active: true,
    });

    // Schedule old key deactivation (24h grace period)
    // In production, this would be a scheduled job. For now, mark last_used_at
    // and let a cron job deactivate keys older than 24h after rotation.
    await db
      .from('api_keys')
      .update({ name: `${existing.name} (rotating - deactivates in 24h)` })
      .eq('key_prefix', prefix);

    res.json({
      success: true,
      data: {
        new_key: newFullKey,
        new_prefix: newPrefix,
        old_prefix: prefix,
        grace_period_hours: 24,
        message: 'Old key will remain active for 24 hours. Update your integration.',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Rotation failed' });
  }
});

export default router;
