/**
 * Feedback Loop Tests
 *
 * Tests all feedback types and weight adjustments.
 */

import { describe, it, expect } from 'vitest';
import {
  processFeedback,
  POSITIVE_BOOST_BASE,
  NEGATIVE_PENALTY,
  USED_BOOST,
  NEGATIVE_FLAG_THRESHOLD,
  type FeedbackDB,
  type FeedbackRecord,
  type PhantomSnapshot,
} from '../../src/brain/feedback-loop.js';

// ── Mock DB ─────────────────────────────────────────────────────────────────

function createMockFeedbackDB(initialWeights: Record<string, number> = {}): FeedbackDB {
  const weights = new Map(Object.entries(initialWeights));
  const feedbackStore: FeedbackRecord[] = [];
  let negativeCount = 0;

  return {
    async storeFeedback(record) {
      feedbackStore.push(record);
    },
    async getPhantomWeight(_tenantId, phantomId) {
      return weights.get(phantomId) ?? null;
    },
    async updatePhantomWeight(_tenantId, phantomId, newWeight) {
      weights.set(phantomId, newWeight);
    },
    async getRecentNegatives() {
      return negativeCount++;
    },
    async getPhantomFeedbackStats() {
      return null;
    },
    async getAggregateStats() {
      return [];
    },
  };
}

function makeRecord(
  feedbackType: FeedbackRecord['feedbackType'],
  phantoms: PhantomSnapshot[] = [{ id: 'p1', score: 5.0, weight: 3.0 }],
): FeedbackRecord {
  return {
    tenantId: 'tenant-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    phantomsActive: phantoms,
    feedbackType,
    createdAt: new Date().toISOString(),
  };
}

describe('Feedback Loop', () => {
  describe('Positive Feedback', () => {
    it('boosts phantom weights proportional to activation score', async () => {
      const db = createMockFeedbackDB({ p1: 3.0, p2: 3.0 });
      const phantoms: PhantomSnapshot[] = [
        { id: 'p1', score: 5.0, weight: 3.0 },
        { id: 'p2', score: 2.5, weight: 3.0 },
      ];

      const result = await processFeedback(makeRecord('positive', phantoms), db);

      expect(result.weightChanges.length).toBe(2);
      // p1 has max score, gets full boost: 0.08 * (5/5) = 0.08
      const p1Change = result.weightChanges.find(c => c.phantomId === 'p1');
      expect(p1Change!.delta).toBeCloseTo(POSITIVE_BOOST_BASE * 1.0);
      expect(p1Change!.newWeight).toBeCloseTo(3.08);

      // p2 has half the score: 0.08 * (2.5/5) = 0.04
      const p2Change = result.weightChanges.find(c => c.phantomId === 'p2');
      expect(p2Change!.delta).toBeCloseTo(POSITIVE_BOOST_BASE * 0.5);
      expect(p2Change!.newWeight).toBeCloseTo(3.04);
    });
  });

  describe('Negative Feedback', () => {
    it('applies flat penalty of -0.03', async () => {
      const db = createMockFeedbackDB({ p1: 3.0 });

      const result = await processFeedback(makeRecord('negative'), db);

      expect(result.weightChanges.length).toBe(1);
      expect(result.weightChanges[0].delta).toBe(NEGATIVE_PENALTY);
      expect(result.weightChanges[0].newWeight).toBeCloseTo(2.97);
    });

    it('flags for review after 3+ negatives in 30 days', async () => {
      // Mock returns increasing negative count
      let callCount = 0;
      const db: FeedbackDB = {
        async storeFeedback() {},
        async getPhantomWeight() { return 3.0; },
        async updatePhantomWeight() {},
        async getRecentNegatives() { return callCount++ >= 0 ? NEGATIVE_FLAG_THRESHOLD - 1 : 0; },
        async getPhantomFeedbackStats() { return null; },
        async getAggregateStats() { return []; },
      };

      const result = await processFeedback(makeRecord('negative'), db);
      expect(result.flaggedForReview.length).toBe(1);
      expect(result.flaggedForReview[0]).toBe('p1');
    });
  });

  describe('Used Feedback (Strongest Signal)', () => {
    it('applies +0.12 boost', async () => {
      const db = createMockFeedbackDB({ p1: 3.0 });

      const result = await processFeedback(makeRecord('used'), db);

      expect(result.weightChanges.length).toBe(1);
      expect(result.weightChanges[0].delta).toBe(USED_BOOST);
      expect(result.weightChanges[0].newWeight).toBeCloseTo(3.12);
    });
  });

  describe('Regenerated Feedback', () => {
    it('applies same penalty as negative (-0.03)', async () => {
      const db = createMockFeedbackDB({ p1: 3.0 });

      const result = await processFeedback(makeRecord('regenerated'), db);

      expect(result.weightChanges.length).toBe(1);
      expect(result.weightChanges[0].delta).toBe(NEGATIVE_PENALTY);
    });
  });

  describe('Edited Feedback', () => {
    it('applies no weight changes (neutral)', async () => {
      const db = createMockFeedbackDB({ p1: 3.0 });

      const result = await processFeedback(makeRecord('edited'), db);

      expect(result.weightChanges.length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty phantom list', async () => {
      const db = createMockFeedbackDB();
      const result = await processFeedback(makeRecord('positive', []), db);
      expect(result.weightChanges.length).toBe(0);
    });

    it('skips phantoms not found in DB', async () => {
      const db = createMockFeedbackDB({}); // No weights stored
      const result = await processFeedback(makeRecord('positive'), db);
      expect(result.weightChanges.length).toBe(0);
    });

    it('clamps weight to max 10.0', async () => {
      const db = createMockFeedbackDB({ p1: 9.95 });
      const result = await processFeedback(makeRecord('used'), db);
      expect(result.weightChanges[0].newWeight).toBeLessThanOrEqual(10.0);
    });

    it('clamps weight to min 0.0', async () => {
      const db = createMockFeedbackDB({ p1: 0.01 });
      const result = await processFeedback(makeRecord('negative'), db);
      expect(result.weightChanges[0].newWeight).toBeGreaterThanOrEqual(0.0);
    });
  });

  describe('Constants', () => {
    it('positive boost base is 0.08', () => {
      expect(POSITIVE_BOOST_BASE).toBe(0.08);
    });

    it('negative penalty is -0.03', () => {
      expect(NEGATIVE_PENALTY).toBe(-0.03);
    });

    it('used boost is 0.12', () => {
      expect(USED_BOOST).toBe(0.12);
    });

    it('flag threshold is 3', () => {
      expect(NEGATIVE_FLAG_THRESHOLD).toBe(3);
    });
  });
});
