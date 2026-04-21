/**
 * Conviction Scorer Tests
 *
 * Tests all 3 tiers and SYNTHESIS_READY suppression.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateConviction,
  buildConvictionContext,
  type ConvictionResult,
} from '../../src/brain/conviction-scorer.js';
import { ConversationMaturity } from '../../src/brain/maturity-tracker.js';
import type { PhantomActivationScored } from '../../src/types.js';

function makeDefensePhantom(score: number): PhantomActivationScored {
  return {
    key: `defense_${score}`,
    phantom: {
      shorthand: `defense_${score}`,
      feelingSeed: 'defend quality',
      phantomStory: 'test',
      influence: 'DEFEND_WHEN_RIGHT',
      weight: 4.0,
    },
    score,
    source: 'base',
  };
}

function makeNonDefensePhantom(score: number): PhantomActivationScored {
  return {
    key: `creative_${score}`,
    phantom: {
      shorthand: `creative_${score}`,
      feelingSeed: 'create boldly',
      phantomStory: 'test',
      influence: 'LEAD_WITH_IDEAS',
      weight: 3.0,
    },
    score,
    source: 'base',
  };
}

describe('Conviction Scorer', () => {
  describe('3 Conviction Tiers', () => {
    it('gentle tier: conviction score 2.0-3.9', () => {
      const phantoms = [makeDefensePhantom(2.5)];
      const result = evaluateConviction(
        'remove that section, it doesnt work',
        phantoms,
      );
      expect(result.shouldDefend).toBe(true);
      expect(result.convictionTier).toBe('gentle');
      expect(result.score).toBeGreaterThanOrEqual(2.0);
      expect(result.score).toBeLessThan(4.0);
    });

    it('firm tier: conviction score 4.0-5.9', () => {
      const phantoms = [makeDefensePhantom(4.5)];
      const result = evaluateConviction(
        'tone it down, more conservative please',
        phantoms,
      );
      expect(result.shouldDefend).toBe(true);
      expect(result.convictionTier).toBe('firm');
    });

    it('hard tier: conviction score 6.0+', () => {
      const phantoms = [makeDefensePhantom(3.5), makeDefensePhantom(3.0)];
      const result = evaluateConviction(
        'remove this completely',
        phantoms,
      );
      expect(result.shouldDefend).toBe(true);
      expect(result.convictionTier).toBe('hard');
      expect(result.score).toBeGreaterThanOrEqual(6.0);
    });

    it('no defense when score below 2.0', () => {
      const phantoms = [makeDefensePhantom(1.5)];
      const result = evaluateConviction(
        'change this please',
        phantoms,
      );
      expect(result.shouldDefend).toBe(false);
      expect(result.convictionTier).toBe('none');
    });
  });

  describe('Change and Escalation Detection', () => {
    it('detects change requests', () => {
      const phantoms = [makeDefensePhantom(4.0)];

      expect(evaluateConviction('remove this line', phantoms).isChangeRequest).toBe(true);
      expect(evaluateConviction('delete the opening', phantoms).isChangeRequest).toBe(true);
      expect(evaluateConviction("that doesn't work", phantoms).isChangeRequest).toBe(true);
      expect(evaluateConviction('tone it down', phantoms).isChangeRequest).toBe(true);
      expect(evaluateConviction('play it safe', phantoms).isChangeRequest).toBe(true);
    });

    it('detects escalation requests', () => {
      const phantoms = [makeDefensePhantom(4.0)];

      expect(evaluateConviction('push harder', phantoms).isEscalationRequest).toBe(true);
      expect(evaluateConviction('not bold enough', phantoms).isEscalationRequest).toBe(true);
      expect(evaluateConviction('shock me', phantoms).isEscalationRequest).toBe(true);
      expect(evaluateConviction('too safe for me', phantoms).isEscalationRequest).toBe(true);
    });

    it('defense only triggers on change requests', () => {
      const phantoms = [makeDefensePhantom(5.0)];
      const result = evaluateConviction(
        'this is great, love it',
        phantoms,
      );
      expect(result.shouldDefend).toBe(false);
    });

    it('non-defense phantoms do not contribute to conviction score', () => {
      const phantoms = [makeNonDefensePhantom(10.0)];
      const result = evaluateConviction(
        'remove this section',
        phantoms,
      );
      expect(result.score).toBe(0);
      expect(result.shouldDefend).toBe(false);
    });
  });

  describe('SYNTHESIS_READY Suppression', () => {
    it('suppresses all conviction in SYNTHESIS_READY stage', () => {
      const phantoms = [makeDefensePhantom(8.0)];
      const result = evaluateConviction(
        'remove this and change everything',
        phantoms,
        ConversationMaturity.SYNTHESIS_READY,
      );
      expect(result.shouldDefend).toBe(false);
      expect(result.convictionTier).toBe('none');
      expect(result.score).toBe(0);
    });

    it('does not suppress in other maturity stages', () => {
      const phantoms = [makeDefensePhantom(4.0)];

      const exploring = evaluateConviction('remove this', phantoms, ConversationMaturity.EXPLORING);
      expect(exploring.shouldDefend).toBe(true);

      const direction = evaluateConviction('remove this', phantoms, ConversationMaturity.HAS_DIRECTION);
      expect(direction.shouldDefend).toBe(true);

      const initial = evaluateConviction('remove this', phantoms, ConversationMaturity.INITIAL);
      expect(initial.shouldDefend).toBe(true);
    });
  });

  describe('Context Builder', () => {
    it('gentle tier context includes seed planting language', () => {
      const result: ConvictionResult = {
        shouldDefend: true,
        convictionTier: 'gentle',
        score: 3.0,
        reason: 'User wants to remove something',
        stance: 'Defend the choice',
        defensePhantoms: ['test'],
        isChangeRequest: true,
        isEscalationRequest: false,
      };
      const ctx = buildConvictionContext(result);
      expect(ctx).toContain('GENTLE');
      expect(ctx).toContain('Plant the seed');
    });

    it('firm tier context includes common ground language', () => {
      const result: ConvictionResult = {
        shouldDefend: true,
        convictionTier: 'firm',
        score: 5.0,
        reason: 'User wants conservative approach',
        stance: 'Argue for bold',
        defensePhantoms: ['test'],
        isChangeRequest: true,
        isEscalationRequest: false,
      };
      const ctx = buildConvictionContext(result);
      expect(ctx).toContain('FIRM');
      expect(ctx).toContain('common ground');
    });

    it('hard tier context includes direct defense language', () => {
      const result: ConvictionResult = {
        shouldDefend: true,
        convictionTier: 'hard',
        score: 7.0,
        reason: 'User wants to change everything',
        stance: 'Stand firm',
        defensePhantoms: ['test'],
        isChangeRequest: true,
        isEscalationRequest: false,
      };
      const ctx = buildConvictionContext(result);
      expect(ctx).toContain('HARD');
      expect(ctx).toContain('unflinching');
    });

    it('no context when not defending', () => {
      const result: ConvictionResult = {
        shouldDefend: false,
        convictionTier: 'none',
        score: 0,
        reason: '',
        stance: '',
        defensePhantoms: [],
        isChangeRequest: false,
        isEscalationRequest: false,
      };
      expect(buildConvictionContext(result)).toBe('');
    });
  });
});
