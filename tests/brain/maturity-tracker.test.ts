/**
 * Maturity Tracker Tests
 *
 * Tests all 4 stage transitions and the no-questions rule.
 */

import { describe, it, expect } from 'vitest';
import {
  detectMaturity,
  buildMaturityContext,
  buildNoQuestionsRule,
  ConversationMaturity,
} from '../../src/brain/maturity-tracker.js';

describe('Maturity Tracker', () => {
  describe('4 Stage Transitions', () => {
    it('INITIAL: first exchange with no signals', () => {
      const result = detectMaturity({
        exchangeCount: 0,
        userMessage: 'hello',
        conversationHistory: [],
      });
      expect(result.stage).toBe(ConversationMaturity.INITIAL);
    });

    it('EXPLORING: collaboration signals detected', () => {
      const result = detectMaturity({
        exchangeCount: 2,
        userMessage: 'interesting, what about trying something else',
        conversationHistory: [
          { userMsg: 'i like that idea', aiResponse: 'glad you think so' },
        ],
      });
      expect(result.stage).toBe(ConversationMaturity.EXPLORING);
      expect(result.collaborationSignals).toBeGreaterThan(0);
    });

    it('HAS_DIRECTION: direction indicators present', () => {
      const result = detectMaturity({
        exchangeCount: 3,
        userMessage: "i've decided to go with the bold approach, let's do it",
        conversationHistory: [
          { userMsg: 'show me options', aiResponse: 'here are 3 approaches' },
        ],
      });
      expect(result.stage).toBe(ConversationMaturity.HAS_DIRECTION);
      expect(result.directionSignals).toBeGreaterThan(0);
    });

    it('SYNTHESIS_READY: synthesis triggers + exchanges + collaboration', () => {
      const result = detectMaturity({
        exchangeCount: 4,
        userMessage: 'write it up for me so i can cut and paste it',
        conversationHistory: [
          { userMsg: 'i like this direction', aiResponse: 'great' },
          { userMsg: 'perfect, now lets refine', aiResponse: 'sure' },
          { userMsg: 'good point', aiResponse: 'thanks' },
        ],
      });
      expect(result.stage).toBe(ConversationMaturity.SYNTHESIS_READY);
      expect(result.synthesisRequested).toBe(true);
    });
  });

  describe('Stage Transition Edge Cases', () => {
    it('synthesis needs minimum 2 exchanges', () => {
      const result = detectMaturity({
        exchangeCount: 1,
        userMessage: 'write it up for me',
        conversationHistory: [],
      });
      // Not enough exchanges for synthesis, falls through to direction check
      expect(result.stage).not.toBe(ConversationMaturity.SYNTHESIS_READY);
    });

    it('synthesis needs collaboration signals', () => {
      const result = detectMaturity({
        exchangeCount: 3,
        userMessage: 'write it up',
        conversationHistory: [
          { userMsg: 'xyz', aiResponse: 'abc' },
          { userMsg: 'def', aiResponse: 'ghi' },
        ],
      });
      // No collaboration signals in history
      if (result.collaborationSignals < 1) {
        expect(result.stage).not.toBe(ConversationMaturity.SYNTHESIS_READY);
      }
    });

    it('direction overrides exploring when both present', () => {
      const result = detectMaturity({
        exchangeCount: 3,
        userMessage: "i've decided this works, let's go with it",
        conversationHistory: [
          { userMsg: 'interesting idea', aiResponse: 'glad you like it' },
        ],
      });
      // Both direction and collaboration are present, but direction + synthesis might trigger
      expect(
        result.stage === ConversationMaturity.HAS_DIRECTION ||
        result.stage === ConversationMaturity.SYNTHESIS_READY,
      ).toBe(true);
    });
  });

  describe('No-Questions Rule', () => {
    it('no rule on first exchange', () => {
      const result = detectMaturity({
        exchangeCount: 0,
        userMessage: 'hello',
        conversationHistory: [],
      });
      const rule = buildNoQuestionsRule(result);
      expect(rule).toBe('');
    });

    it('rule active after 2 exchanges', () => {
      const result = detectMaturity({
        exchangeCount: 2,
        userMessage: 'tell me more',
        conversationHistory: [
          { userMsg: 'start', aiResponse: 'ok' },
        ],
      });
      const rule = buildNoQuestionsRule(result);
      expect(rule).toContain('MUST NOT end with any question');
    });

    it('rule active in HAS_DIRECTION regardless of exchange count', () => {
      const result = detectMaturity({
        exchangeCount: 1,
        userMessage: "i've decided to go bold",
        conversationHistory: [],
      });
      const rule = buildNoQuestionsRule(result);
      expect(rule).toContain('MUST NOT end with any question');
    });

    it('rule active in SYNTHESIS_READY', () => {
      const result = detectMaturity({
        exchangeCount: 4,
        userMessage: 'write it up, i like this',
        conversationHistory: [
          { userMsg: 'good', aiResponse: 'ok' },
          { userMsg: 'perfect', aiResponse: 'great' },
        ],
      });
      const rule = buildNoQuestionsRule(result);
      expect(rule).toContain('MUST NOT end with any question');
    });
  });

  describe('Context Builders', () => {
    it('SYNTHESIS_READY context mentions delivery', () => {
      const ctx = buildMaturityContext({
        stage: ConversationMaturity.SYNTHESIS_READY,
        collaborationSignals: 3,
        directionSignals: 1,
        synthesisRequested: true,
        exchangeCount: 5,
      });
      expect(ctx).toContain('SYNTHESIS READY');
      expect(ctx).toContain('delivery');
    });

    it('HAS_DIRECTION context mentions building on direction', () => {
      const ctx = buildMaturityContext({
        stage: ConversationMaturity.HAS_DIRECTION,
        collaborationSignals: 2,
        directionSignals: 1,
        synthesisRequested: false,
        exchangeCount: 4,
      });
      expect(ctx).toContain('HAS DIRECTION');
    });

    it('EXPLORING context mentions provocations', () => {
      const ctx = buildMaturityContext({
        stage: ConversationMaturity.EXPLORING,
        collaborationSignals: 1,
        directionSignals: 0,
        synthesisRequested: false,
        exchangeCount: 2,
      });
      expect(ctx).toContain('EXPLORING');
      expect(ctx).toContain('provocations');
    });

    it('INITIAL returns empty context', () => {
      const ctx = buildMaturityContext({
        stage: ConversationMaturity.INITIAL,
        collaborationSignals: 0,
        directionSignals: 0,
        synthesisRequested: false,
        exchangeCount: 0,
      });
      expect(ctx).toBe('');
    });
  });
});
