/**
 * Phantom Management Endpoints
 *
 * GET /api/v1/phantoms - List active phantoms for tenant
 * GET /api/v1/phantoms/stats - Activation stats, collision frequency
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../../config/index.js';

const router = Router();

// ── List Active Phantoms ──────────────────────────────────────────────────────

router.get('/phantoms', async (req: Request, res: Response) => {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    res.json({ success: true, data: { phantoms: [], count: 0 } });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

    const { data, error } = await db
      .from('agency_phantoms')
      .select('id, shorthand, feeling_seed, influence, weight, quality_score, is_active, created_at')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('weight', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: 'Query failed' });
      return;
    }

    res.json({
      success: true,
      data: {
        phantoms: data || [],
        count: data?.length || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load phantoms' });
  }
});

// ── Phantom Stats ─────────────────────────────────────────────────────────────

router.get('/phantoms/stats', async (req: Request, res: Response) => {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    res.json({
      success: true,
      data: { total_phantoms: 0, avg_weight: 0, alliances: [], top_phantoms: [] },
    });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

    const [phantomsResult, alliancesResult] = await Promise.all([
      db.from('agency_phantoms')
        .select('shorthand, weight, quality_score')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('weight', { ascending: false })
        .limit(20),
      db.from('phantom_alliances')
        .select('phantom_a_id, phantom_b_id, alliance_strength, co_activation_count')
        .eq('tenant_id', tenantId)
        .gte('alliance_strength', 0.5)
        .order('alliance_strength', { ascending: false })
        .limit(10),
    ]);

    const phantoms = phantomsResult.data || [];
    const alliances = alliancesResult.data || [];

    const avgWeight = phantoms.length > 0
      ? phantoms.reduce((sum, p) => sum + Number(p.weight), 0) / phantoms.length
      : 0;

    res.json({
      success: true,
      data: {
        total_phantoms: phantoms.length,
        avg_weight: Math.round(avgWeight * 100) / 100,
        top_phantoms: phantoms.slice(0, 10).map(p => ({
          shorthand: p.shorthand,
          weight: p.weight,
          quality_score: p.quality_score,
        })),
        alliances: alliances.map(a => ({
          phantom_a: a.phantom_a_id,
          phantom_b: a.phantom_b_id,
          strength: a.alliance_strength,
          co_activations: a.co_activation_count,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

export default router;
