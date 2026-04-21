/**
 * Phantom Management Endpoints
 *
 * POST /api/v1/phantoms/cultivate - Trigger cultivation from documents
 * POST /api/v1/phantoms/interview - Submit interview responses
 * GET /api/v1/phantoms - List active phantoms for tenant
 * GET /api/v1/phantoms/stats - Activation stats, collision frequency
 * POST /api/v1/taste-test - Run cold start preference test
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
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

// ── Cultivate Phantoms ────────────────────────────────────────────────────────

const CultivateSchema = z.object({
  documents: z.array(z.object({
    title: z.string(),
    content: z.string().min(50),
    source_type: z.string().optional(),
  })).min(1).max(20),
});

router.post('/phantoms/cultivate', async (req: Request, res: Response) => {
  const parsed = CultivateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;

  // Import the phantom generator
  try {
    const { runDocumentPipeline } = await import('../../brain/phantom-generator.js');
    const { createPhantomLLM } = await import('../service-factory.js');
    const { documents } = parsed.data;

    const llm = createPhantomLLM();
    // Process each document through the pipeline
    const allPhantoms: Array<{ shorthand: string; feelingSeed: string; influence: string; qualityScore: number | null }> = [];
    for (const doc of documents) {
      const result = await runDocumentPipeline(doc.content, doc.source_type || 'document', tenantId, llm);
      for (const p of result.phantoms) {
        allPhantoms.push(p);
      }
    }

    res.json({
      success: true,
      data: {
        phantoms_generated: allPhantoms.length,
        phantoms: allPhantoms.map(p => ({
          shorthand: p.shorthand,
          feeling_seed: p.feelingSeed,
          influence: p.influence,
          quality_score: p.qualityScore,
        })),
      },
    });
  } catch (err) {
    console.error('[Phantoms] Cultivation error:', err);
    res.status(500).json({ success: false, error: 'Cultivation failed' });
  }
});

// ��─ Interview Responses ───────────────────────────────────────────────────────

const InterviewSchema = z.object({
  responses: z.array(z.object({
    question_id: z.number().int().min(1).max(13),
    answer: z.string().min(10),
  })).min(1).max(13),
  person_name: z.string().optional(),
});

router.post('/phantoms/interview', async (req: Request, res: Response) => {
  const parsed = InterviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;

  try {
    const { runInterviewPipeline } = await import('../../brain/phantom-generator.js');
    const { createPhantomLLM } = await import('../service-factory.js');
    const { responses, person_name } = parsed.data;

    const llm = createPhantomLLM();
    const interviewSets = [{
      memberName: person_name || 'Anonymous',
      memberRole: 'Team Member',
      responses: responses.map(r => ({
        questionKey: `q${r.question_id}`,
        questionText: `Question ${r.question_id}`,
        responseText: r.answer,
      })),
    }];
    const phantoms = await runInterviewPipeline(interviewSets, tenantId, llm);

    if (!phantoms || phantoms.length === 0) {
      res.status(422).json({
        success: false,
        error: 'Responses did not meet quality threshold. More specific answers needed.',
      });
      return;
    }

    const phantom = phantoms[0];
    res.json({
      success: true,
      data: {
        phantom: {
          shorthand: phantom.shorthand,
          feeling_seed: phantom.feelingSeed,
          influence: phantom.influence,
          quality_score: phantom.qualityScore,
          person_name,
        },
      },
    });
  } catch (err) {
    console.error('[Phantoms] Interview synthesis error:', err);
    res.status(500).json({ success: false, error: 'Interview synthesis failed' });
  }
});

// ── Taste Test ────────────────────────────────────────────────────────────────

const TasteTestSchema = z.object({
  answers: z.array(z.object({
    question_id: z.number().int().min(1).max(5),
    choice: z.enum(['a', 'b']),
    strength: z.number().min(1).max(5).optional().default(3),
  })).min(1).max(5),
});

router.post('/taste-test', async (req: Request, res: Response) => {
  const parsed = TasteTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const { processTasteTestAnswers, TASTE_TEST_QUESTIONS } = await import('../../brain/taste-test.js');
    const { answers } = parsed.data;

    // Map route schema to taste-test module schema
    const tasteAnswers = answers.map(a => ({
      questionId: `taste_${a.question_id}`,
      selected: a.choice,
    }));

    const seededPhantoms = processTasteTestAnswers(tasteAnswers);

    res.json({
      success: true,
      data: {
        seeded_phantoms: seededPhantoms.map(p => ({
          shorthand: p.shorthand,
          weight: p.weight,
          is_core_conviction: p.isCoreConviction,
        })),
        questions: TASTE_TEST_QUESTIONS,
        message: 'Phantom weights seeded based on your preferences.',
      },
    });
  } catch (err) {
    console.error('[Phantoms] Taste test error:', err);
    res.status(500).json({ success: false, error: 'Taste test failed' });
  }
});

export default router;
