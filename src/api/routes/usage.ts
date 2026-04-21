/**
 * Usage Reporting Endpoints
 *
 * GET /api/v1/usage - Current + last month summary
 * GET /api/v1/usage/daily - Daily breakdown
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../../config/index.js';

const router = Router();

// ── Monthly Summary ───────────────────────────────────────────────────────────

router.get('/usage', async (req: Request, res: Response) => {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    res.json({
      success: true,
      data: {
        current_month: { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
        last_month: { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
      },
    });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    const [currentResult, lastResult] = await Promise.all([
      db.rpc('get_usage_summary', { p_tenant_id: tenantId, p_start: currentMonthStart, p_end: now.toISOString() }),
      db.rpc('get_usage_summary', { p_tenant_id: tenantId, p_start: lastMonthStart, p_end: currentMonthStart }),
    ]);

    res.json({
      success: true,
      data: {
        current_month: currentResult.data || { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
        last_month: lastResult.data || { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch usage data' });
  }
});

// ── Daily Breakdown ───────────────────────────────────────────────────────────

router.get('/usage/daily', async (req: Request, res: Response) => {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const days = Math.min(parseInt(req.query.days as string) || 30, 90);

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    res.json({ success: true, data: { days: [], period_days: days } });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { data, error } = await db
      .from('usage_logs')
      .select('created_at, input_tokens, output_tokens, cost_usd, endpoint')
      .eq('tenant_id', tenantId)
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: 'Query failed' });
      return;
    }

    // Group by day
    const dailyMap = new Map<string, { requests: number; input_tokens: number; output_tokens: number; cost_usd: number }>();

    for (const row of data || []) {
      const day = (row.created_at as string).slice(0, 10);
      const entry = dailyMap.get(day) || { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
      entry.requests++;
      entry.input_tokens += row.input_tokens || 0;
      entry.output_tokens += row.output_tokens || 0;
      entry.cost_usd += parseFloat(row.cost_usd) || 0;
      dailyMap.set(day, entry);
    }

    const days_data = Array.from(dailyMap.entries()).map(([date, stats]) => ({ date, ...stats }));

    res.json({
      success: true,
      data: { days: days_data, period_days: days },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch usage data' });
  }
});

export default router;
