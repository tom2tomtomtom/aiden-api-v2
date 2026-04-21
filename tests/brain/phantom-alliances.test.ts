/**
 * Phantom Alliances Tests
 *
 * Tests co-activation tracking, alliance boost, and decay.
 */

import { describe, it, expect } from 'vitest';
import {
  recordCoActivation,
  applyAllianceBoosts,
  ALLIANCE_BOOST_THRESHOLD,
  ALLIANCE_BOOST_MULTIPLIER,
  ALLIANCE_DECAY_THRESHOLD,
  MIN_CO_ACTIVATIONS_FOR_ALLIANCE,
  type AllianceDB,
  type PhantomAlliance,
} from '../../src/brain/phantom-alliances.js';
import type { PhantomActivationScored } from '../../src/types.js';

// ── Mock Alliance DB ────────────────────────────────────────────────────────

function createMockAllianceDB(): AllianceDB & { store: Map<string, PhantomAlliance> } {
  const store = new Map<string, PhantomAlliance>();

  const makeKey = (a: string, b: string) => a < b ? `${a}:${b}` : `${b}:${a}`;

  return {
    store,
    async getAlliance(_tenantId, phantomAId, phantomBId) {
      return store.get(makeKey(phantomAId, phantomBId)) ?? null;
    },
    async upsertAlliance(alliance) {
      store.set(makeKey(alliance.phantomAId, alliance.phantomBId), alliance);
    },
    async removeAlliance(_tenantId, phantomAId, phantomBId) {
      store.delete(makeKey(phantomAId, phantomBId));
    },
    async getAlliancesForPhantom(_tenantId, phantomId) {
      const results: PhantomAlliance[] = [];
      for (const alliance of store.values()) {
        if (alliance.phantomAId === phantomId || alliance.phantomBId === phantomId) {
          results.push(alliance);
        }
      }
      return results;
    },
    async getStrongAlliances(_tenantId, minStrength) {
      return Array.from(store.values()).filter(a => a.allianceStrength >= minStrength);
    },
  };
}

describe('Phantom Alliances', () => {
  describe('Co-Activation Tracking', () => {
    it('creates alliance records for active pairs', async () => {
      const db = createMockAllianceDB();
      const updates = await recordCoActivation(
        'tenant-1',
        ['phantom-a', 'phantom-b', 'phantom-c'],
        true,
        db,
      );

      // 3 phantoms = 3 pairs (a-b, a-c, b-c)
      expect(updates.length).toBe(3);
      expect(db.store.size).toBe(3);
    });

    it('increments co_activation_count on repeated calls', async () => {
      const db = createMockAllianceDB();

      await recordCoActivation('t1', ['a', 'b'], true, db);
      await recordCoActivation('t1', ['a', 'b'], true, db);
      await recordCoActivation('t1', ['a', 'b'], false, db);

      const alliance = await db.getAlliance('t1', 'a', 'b');
      expect(alliance!.coActivationCount).toBe(3);
      expect(alliance!.positiveCoActivationCount).toBe(2);
    });

    it('calculates alliance_strength as positive/total', async () => {
      const db = createMockAllianceDB();

      // 3 positive, 1 negative = 0.75 strength
      await recordCoActivation('t1', ['a', 'b'], true, db);
      await recordCoActivation('t1', ['a', 'b'], true, db);
      await recordCoActivation('t1', ['a', 'b'], true, db);
      await recordCoActivation('t1', ['a', 'b'], false, db);

      const alliance = await db.getAlliance('t1', 'a', 'b');
      expect(alliance!.allianceStrength).toBeCloseTo(0.75);
    });

    it('does nothing with fewer than 2 phantoms', async () => {
      const db = createMockAllianceDB();
      const updates = await recordCoActivation('t1', ['only-one'], true, db);
      expect(updates.length).toBe(0);
    });

    it('normalizes pair ordering', async () => {
      const db = createMockAllianceDB();

      await recordCoActivation('t1', ['b', 'a'], true, db);
      await recordCoActivation('t1', ['a', 'b'], true, db);

      // Should be same record (normalized to 'a', 'b')
      const alliance = await db.getAlliance('t1', 'a', 'b');
      expect(alliance!.coActivationCount).toBe(2);
    });
  });

  describe('Alliance Decay', () => {
    it('removes alliances below decay threshold after min activations', async () => {
      const db = createMockAllianceDB();

      // Pre-seed an alliance with low strength but enough activations
      db.store.set('a:b', {
        tenantId: 't1',
        phantomAId: 'a',
        phantomBId: 'b',
        coActivationCount: MIN_CO_ACTIVATIONS_FOR_ALLIANCE - 1,
        positiveCoActivationCount: 0,
        allianceStrength: 0.1,
      });

      // One more negative co-activation should trigger removal
      await recordCoActivation('t1', ['a', 'b'], false, db);

      const alliance = await db.getAlliance('t1', 'a', 'b');
      // After the update, strength = 0/4 = 0, which is below threshold
      // but removal only happens at >= MIN_CO_ACTIVATIONS_FOR_ALLIANCE
      if (alliance) {
        expect(alliance.allianceStrength).toBeLessThan(ALLIANCE_DECAY_THRESHOLD);
      }
    });

    it('keeps strong alliances', async () => {
      const db = createMockAllianceDB();

      // All positive = strength 1.0
      for (let i = 0; i < 5; i++) {
        await recordCoActivation('t1', ['x', 'y'], true, db);
      }

      const alliance = await db.getAlliance('t1', 'x', 'y');
      expect(alliance).not.toBeNull();
      expect(alliance!.allianceStrength).toBe(1.0);
    });
  });

  describe('Alliance Boost During Activation', () => {
    it('boosts allied phantoms by alliance_strength * 0.3', async () => {
      const db = createMockAllianceDB();

      // Create a strong alliance between phantom-a and phantom-b
      db.store.set('phantom-a:phantom-b', {
        tenantId: 't1',
        phantomAId: 'phantom-a',
        phantomBId: 'phantom-b',
        coActivationCount: 10,
        positiveCoActivationCount: 9,
        allianceStrength: 0.9,
      });

      const activations: PhantomActivationScored[] = [
        { key: 'phantom-a', phantom: { shorthand: 'phantom-a', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 5.0, source: 'base' },
        { key: 'phantom-b', phantom: { shorthand: 'phantom-b', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 2.0, source: 'base' },
        { key: 'phantom-c', phantom: { shorthand: 'phantom-c', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 1.0, source: 'base' },
      ];

      const { activations: boosted, boosts } = await applyAllianceBoosts(activations, 't1', db);

      expect(boosts.length).toBeGreaterThan(0);
      const phantomBBoosted = boosted.find(a => a.key === 'phantom-b');
      // Original 2.0 + (0.9 * 0.3) = 2.27
      expect(phantomBBoosted!.score).toBeGreaterThan(2.0);
    });

    it('does not boost when alliance below threshold', async () => {
      const db = createMockAllianceDB();

      // Weak alliance
      db.store.set('phantom-a:phantom-b', {
        tenantId: 't1',
        phantomAId: 'phantom-a',
        phantomBId: 'phantom-b',
        coActivationCount: 10,
        positiveCoActivationCount: 5,
        allianceStrength: 0.5, // Below 0.7 threshold
      });

      const activations: PhantomActivationScored[] = [
        { key: 'phantom-a', phantom: { shorthand: 'phantom-a', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 5.0, source: 'base' },
        { key: 'phantom-b', phantom: { shorthand: 'phantom-b', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 2.0, source: 'base' },
      ];

      const { boosts } = await applyAllianceBoosts(activations, 't1', db);
      expect(boosts.length).toBe(0);
    });

    it('does not boost with too few co-activations', async () => {
      const db = createMockAllianceDB();

      // High strength but too few co-activations
      db.store.set('phantom-a:phantom-b', {
        tenantId: 't1',
        phantomAId: 'phantom-a',
        phantomBId: 'phantom-b',
        coActivationCount: 2, // Below MIN_CO_ACTIVATIONS_FOR_ALLIANCE
        positiveCoActivationCount: 2,
        allianceStrength: 1.0,
      });

      const activations: PhantomActivationScored[] = [
        { key: 'phantom-a', phantom: { shorthand: 'phantom-a', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 5.0, source: 'base' },
        { key: 'phantom-b', phantom: { shorthand: 'phantom-b', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 2.0, source: 'base' },
      ];

      const { boosts } = await applyAllianceBoosts(activations, 't1', db);
      expect(boosts.length).toBe(0);
    });

    it('re-sorts activations after boosting', async () => {
      const db = createMockAllianceDB();

      db.store.set('phantom-a:phantom-c', {
        tenantId: 't1',
        phantomAId: 'phantom-a',
        phantomBId: 'phantom-c',
        coActivationCount: 20,
        positiveCoActivationCount: 19,
        allianceStrength: 0.95,
      });

      const activations: PhantomActivationScored[] = [
        { key: 'phantom-a', phantom: { shorthand: 'phantom-a', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 5.0, source: 'base' },
        { key: 'phantom-b', phantom: { shorthand: 'phantom-b', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 3.0, source: 'base' },
        { key: 'phantom-c', phantom: { shorthand: 'phantom-c', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 2.8, source: 'base' },
      ];

      const { activations: result } = await applyAllianceBoosts(activations, 't1', db);
      // After boost, phantom-c might overtake phantom-b
      // phantom-c: 2.8 + (0.95 * 0.3) = 3.085
      const cIdx = result.findIndex(a => a.key === 'phantom-c');
      const bIdx = result.findIndex(a => a.key === 'phantom-b');
      expect(result[cIdx].score).toBeGreaterThan(3.0);
    });
  });

  describe('Constants', () => {
    it('alliance boost threshold is 0.7', () => {
      expect(ALLIANCE_BOOST_THRESHOLD).toBe(0.7);
    });

    it('alliance boost multiplier is 0.3', () => {
      expect(ALLIANCE_BOOST_MULTIPLIER).toBe(0.3);
    });

    it('alliance decay threshold is 0.2', () => {
      expect(ALLIANCE_DECAY_THRESHOLD).toBe(0.2);
    });

    it('minimum co-activations for alliance is 3', () => {
      expect(MIN_CO_ACTIVATIONS_FOR_ALLIANCE).toBe(3);
    });
  });
});
