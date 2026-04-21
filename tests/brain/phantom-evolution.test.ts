/**
 * Phantom Evolution Tests
 *
 * Tests birth, decay, anti-phantom, and sycophancy guardrail
 * (core phantoms never below 2.0).
 */

import { describe, it, expect } from 'vitest';
import {
  PhantomEvolutionEngine,
  CORE_CONVICTION_PHANTOMS,
  MIN_WEIGHT_FLOOR,
  WEIGHT_DELTAS,
  BIRTH_SIGNALS,
  DECAY_ARCHIVE_THRESHOLD,
  type UserPhantom,
  type PhantomBirthLLM,
} from '../../src/brain/phantom-evolution.js';

// Mock LLM for testing
const mockLLM: PhantomBirthLLM = {
  async generate({ prompt }) {
    if (prompt.includes('Distill this')) {
      return JSON.stringify({
        feeling_seed: 'test breakthrough feeling',
        phantom_story: 'A test phantom born from a breakthrough',
        influence: 'PUSH_FOR_EXCELLENCE',
        shorthand: 'test_born_phantom',
      });
    }
    if (prompt.includes('rejected')) {
      return JSON.stringify({
        feeling_seed: 'corporate speak is empty',
        phantom_story: 'Rejected formal corporate tone',
        influence: 'AVOID_CORPORATE_JARGON',
        shorthand: 'anti_corporate_tone',
      });
    }
    return '{}';
  },
};

function createTestPhantom(overrides: Partial<UserPhantom> = {}): UserPhantom {
  return {
    id: 'test-1',
    feelingSeed: 'test feeling',
    phantomStory: 'test story',
    influence: 'TEST_INFLUENCE',
    shorthand: 'test_phantom',
    weight: 3.0,
    isAntiPhantom: false,
    isCoreConviction: false,
    minWeightFloor: null,
    decayRate: 0.01,
    ...overrides,
  };
}

describe('Phantom Evolution Engine', () => {
  const engine = new PhantomEvolutionEngine(mockLLM);

  describe('Weight Changes', () => {
    it('applies positive weight deltas', async () => {
      const phantom = createTestPhantom({ weight: 3.0 });
      const getPhantom = async () => phantom;
      let savedWeight = 0;
      const updateWeight = async (_id: string, w: number) => { savedWeight = w; };

      const changes = await engine.applyWeightChanges(
        ['test_key'],
        'positive_reaction',
        getPhantom,
        updateWeight,
      );

      expect(changes.length).toBe(1);
      expect(changes[0].delta).toBe(WEIGHT_DELTAS.positive_reaction);
      expect(savedWeight).toBeCloseTo(3.0 + 0.1);
    });

    it('applies negative weight deltas', async () => {
      const phantom = createTestPhantom({ weight: 3.0 });
      const getPhantom = async () => phantom;
      let savedWeight = 0;
      const updateWeight = async (_id: string, w: number) => { savedWeight = w; };

      const changes = await engine.applyWeightChanges(
        ['test_key'],
        'explicit_rejection',
        getPhantom,
        updateWeight,
      );

      expect(changes.length).toBe(1);
      expect(changes[0].delta).toBe(-0.5);
      expect(savedWeight).toBeCloseTo(2.5);
    });

    it('clamps weight between 0 and 10', async () => {
      const phantom = createTestPhantom({ weight: 9.9 });
      const getPhantom = async () => phantom;
      let savedWeight = 0;
      const updateWeight = async (_id: string, w: number) => { savedWeight = w; };

      await engine.applyWeightChanges(
        ['test_key'],
        'board_star',
        getPhantom,
        updateWeight,
      );

      expect(savedWeight).toBeLessThanOrEqual(10.0);
    });
  });

  describe('Sycophancy Guardrail', () => {
    it('core conviction phantoms never drop below MIN_WEIGHT_FLOOR (2.0)', async () => {
      const corePhantom = createTestPhantom({
        weight: 2.1,
        isCoreConviction: true,
        minWeightFloor: MIN_WEIGHT_FLOOR,
      });
      const getPhantom = async () => corePhantom;
      let savedWeight = 0;
      const updateWeight = async (_id: string, w: number) => { savedWeight = w; };

      await engine.applyWeightChanges(
        ['core_key'],
        'explicit_rejection',
        getPhantom,
        updateWeight,
      );

      // -0.5 would take it to 1.6, but floor enforces 2.0
      expect(savedWeight).toBeGreaterThanOrEqual(MIN_WEIGHT_FLOOR);
    });

    it('core conviction phantoms can grow above floor', async () => {
      const corePhantom = createTestPhantom({
        weight: 3.0,
        isCoreConviction: true,
        minWeightFloor: MIN_WEIGHT_FLOOR,
      });
      const getPhantom = async () => corePhantom;
      let savedWeight = 0;
      const updateWeight = async (_id: string, w: number) => { savedWeight = w; };

      await engine.applyWeightChanges(
        ['core_key'],
        'board_star',
        getPhantom,
        updateWeight,
      );

      expect(savedWeight).toBeGreaterThan(3.0);
    });

    it('CORE_CONVICTION_PHANTOMS set has correct entries', () => {
      expect(CORE_CONVICTION_PHANTOMS.has('creative_stubborn')).toBe(true);
      expect(CORE_CONVICTION_PHANTOMS.has('challenge_defend')).toBe(true);
      expect(CORE_CONVICTION_PHANTOMS.has('question_premise')).toBe(true);
      expect(CORE_CONVICTION_PHANTOMS.size).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Phantom Birth', () => {
    it('births a phantom on strong positive signal', async () => {
      let createdPhantom: Partial<UserPhantom> | null = null;
      const createPhantom = async (data: Partial<UserPhantom>) => {
        createdPhantom = data;
        return { ...createTestPhantom(), ...data } as UserPhantom;
      };

      const result = await engine.attemptPhantomBirth(
        'This is absolutely brilliant',
        'Thank you, here is my creative take...',
        'conv-123',
        createPhantom,
      );

      expect(result).not.toBeNull();
      expect(result!.shorthand).toBe('test_born_phantom');
      expect(result!.originType).toBe('born');
      expect(result!.weight).toBe(3.0);
      expect(result!.isAntiPhantom).toBe(false);
    });

    it('birth signals include board_star and board_pin', () => {
      expect(BIRTH_SIGNALS.has('board_star')).toBe(true);
      expect(BIRTH_SIGNALS.has('board_pin')).toBe(true);
      expect(BIRTH_SIGNALS.has('autonomous_birth')).toBe(true);
    });
  });

  describe('Anti-Phantom Creation', () => {
    it('creates anti-phantom on explicit rejection', async () => {
      let createdPhantom: Partial<UserPhantom> | null = null;
      const createPhantom = async (data: Partial<UserPhantom>) => {
        createdPhantom = data;
        return { ...createTestPhantom(), ...data } as UserPhantom;
      };

      const result = await engine.createAntiPhantom(
        'Never give me corporate speak like that again',
        'Here is a formal business recommendation...',
        'conv-456',
        createPhantom,
      );

      expect(result).not.toBeNull();
      expect(result!.isAntiPhantom).toBe(true);
      expect(result!.originType).toBe('anti');
    });
  });

  describe('Decay', () => {
    it('decays inactive phantoms by decay rate', async () => {
      const phantoms = [
        createTestPhantom({ id: 'p1', weight: 3.0, decayRate: 0.05 }),
      ];
      const weights: Record<string, number> = {};
      const updateWeight = async (id: string, w: number) => { weights[id] = w; };
      const archivePhantom = async (_id: string) => {};

      const summary = await engine.decayInactivePhantoms(phantoms, updateWeight, archivePhantom);
      expect(summary.decayed.length).toBe(1);
      expect(weights['p1']).toBeCloseTo(2.95);
    });

    it('archives phantoms below threshold', async () => {
      const phantoms = [
        createTestPhantom({ id: 'p1', weight: 0.4, decayRate: 0.05 }),
      ];
      const archived: string[] = [];
      const updateWeight = async () => {};
      const archivePhantom = async (id: string) => { archived.push(id); };

      const summary = await engine.decayInactivePhantoms(phantoms, updateWeight, archivePhantom);
      expect(summary.archived.length).toBe(1);
      expect(archived).toContain('p1');
    });

    it('does not archive core conviction phantoms', async () => {
      const phantoms = [
        createTestPhantom({
          id: 'core1',
          weight: 2.1,
          decayRate: 0.2,
          isCoreConviction: true,
          minWeightFloor: MIN_WEIGHT_FLOOR,
        }),
      ];
      const archived: string[] = [];
      const weights: Record<string, number> = {};
      const updateWeight = async (id: string, w: number) => { weights[id] = w; };
      const archivePhantom = async (id: string) => { archived.push(id); };

      await engine.decayInactivePhantoms(phantoms, updateWeight, archivePhantom);
      expect(archived).not.toContain('core1');
      // Weight should be clamped to floor
      expect(weights['core1']).toBeGreaterThanOrEqual(MIN_WEIGHT_FLOOR);
    });
  });
});
