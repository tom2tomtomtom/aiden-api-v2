/**
 * Feedback Endpoint
 *
 * POST /api/v1/feedback - Submit feedback for a message
 *
 * Processes user feedback (positive, negative, used, regenerated, edited)
 * and adjusts phantom weights accordingly via the feedback loop.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { processFeedback, type FeedbackDB, type FeedbackRecord, type PhantomSnapshot } from '../../brain/feedback-loop.js';
import { recordCoActivation, type AllianceDB } from '../../brain/phantom-alliances.js';

const router = Router();

// ── Request validation ────────────────────────────────────────────────────────

const FeedbackRequestSchema = z.object({
  message_id: z.string().min(1, 'message_id is required'),
  conversation_id: z.string().min(1, 'conversation_id is required'),
  feedback_type: z.enum(['positive', 'negative', 'used', 'regenerated', 'edited']),
  edited_content: z.string().optional(),
});

// ── In-memory mock DB for development ────────────────────────────────────────

const feedbackStore: FeedbackRecord[] = [];
const phantomWeights = new Map<string, number>();

const mockFeedbackDB: FeedbackDB = {
  async storeFeedback(record) {
    feedbackStore.push(record);
  },
  async getPhantomWeight(_tenantId, phantomId) {
    return phantomWeights.get(phantomId) ?? null;
  },
  async updatePhantomWeight(_tenantId, phantomId, newWeight) {
    phantomWeights.set(phantomId, newWeight);
  },
  async getRecentNegatives(_tenantId, phantomId, _days) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return feedbackStore.filter(
      r => r.phantomsActive.some(p => p.id === phantomId) &&
        (r.feedbackType === 'negative' || r.feedbackType === 'regenerated') &&
        (r.createdAt ?? '') >= cutoff,
    ).length;
  },
  async getPhantomFeedbackStats(_tenantId, _phantomId) {
    return null;
  },
  async getAggregateStats(_tenantId) {
    return [];
  },
};

const mockAllianceDB: AllianceDB = {
  async getAlliance() { return null; },
  async upsertAlliance() {},
  async removeAlliance() {},
  async getAlliancesForPhantom() { return []; },
  async getStrongAlliances() { return []; },
};

// ── Route handler ─────────────────────────────────────────────────────────────

router.post('/feedback', async (req: Request, res: Response) => {
  const parsed = FeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { message_id, conversation_id, feedback_type, edited_content } = parsed.data;
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string || 'default';

  // In production, phantoms_active would be loaded from the stored message metadata.
  // For now, accept them in the request body as an optional field.
  const phantomsActive: PhantomSnapshot[] = (req.body.phantoms_active || []).map(
    (p: { id: string; score: number; weight: number }) => ({
      id: p.id,
      score: p.score || 0,
      weight: p.weight || 3.0,
    }),
  );

  try {
    const record: FeedbackRecord = {
      tenantId,
      conversationId: conversation_id,
      messageId: message_id,
      phantomsActive,
      feedbackType: feedback_type,
      editedContent: edited_content,
      createdAt: new Date().toISOString(),
    };

    // Process feedback (weight adjustments)
    const result = await processFeedback(record, mockFeedbackDB);

    // Record co-activations for alliance tracking
    const isPositive = feedback_type === 'positive' || feedback_type === 'used';
    const activeIds = phantomsActive.map(p => p.id);
    if (activeIds.length >= 2) {
      await recordCoActivation(tenantId, activeIds, isPositive, mockAllianceDB);
    }

    res.json({
      success: true,
      data: {
        feedback_type,
        weight_changes: result.weightChanges.length,
        flagged_for_review: result.flaggedForReview,
      },
    });
  } catch (error) {
    console.error('[Feedback] Error processing feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process feedback',
    });
  }
});

export default router;
