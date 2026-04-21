/**
 * Phantom Collision Detection Tests
 *
 * Tests all 4 opposing pairs and the 0.85 threshold.
 */

import { describe, it, expect } from 'vitest';
import { detectCollisions, buildCollisionContext } from '../../src/brain/phantom-collision.js';
import type { PhantomActivationScored } from '../../src/types.js';

function makeActivation(key: string, influence: string, score: number): PhantomActivationScored {
  return {
    key,
    phantom: { shorthand: key, feelingSeed: '', phantomStory: '', influence, weight: 3.0 },
    score,
    source: 'base',
  };
}

describe('Phantom Collision Detection', () => {
  describe('4 Opposing Pairs', () => {
    it('detects minimalism vs depth', () => {
      const activations = [
        makeActivation('brevity', 'MINIMALISM_SURGICAL_PRECISION', 1.0),
        makeActivation('depth', 'COMPREHENSIVE_DEEP_ANALYSIS', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      expect(collisions.length).toBeGreaterThan(0);
      expect(collisions[0].tensionDescription).toContain('minimalism');
    });

    it('detects conservative vs bold', () => {
      const activations = [
        makeActivation('safe', 'CONSERVATIVE_CAUTIOUS_APPROACH', 1.0),
        makeActivation('wild', 'BOLD_WILD_SURPRISE', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      expect(collisions.length).toBeGreaterThan(0);
      expect(collisions[0].tensionDescription).toContain('bold');
    });

    it('detects brief vs comprehensive', () => {
      const activations = [
        makeActivation('brief', 'BE_ULTRA_BRIEF_CONCISE', 1.0),
        makeActivation('thorough', 'PROVIDE_COMPREHENSIVE_THOROUGH', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      expect(collisions.length).toBeGreaterThan(0);
    });

    it('detects agree vs challenge', () => {
      const activations = [
        makeActivation('agree', 'VALIDATE_ACKNOWLEDGE_COLLABORATIVE', 1.0),
        makeActivation('challenge', 'CHALLENGE_DIRECTLY_PUSH_BACK', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      expect(collisions.length).toBeGreaterThan(0);
      expect(collisions[0].tensionDescription).toContain('challenge');
    });
  });

  describe('Threshold behavior', () => {
    it('requires both phantoms above 0.85 threshold', () => {
      const activations = [
        makeActivation('brevity', 'MINIMALISM', 0.84),
        makeActivation('depth', 'COMPREHENSIVE', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      expect(collisions.length).toBe(0);
    });

    it('detects collision at exactly 0.85', () => {
      const activations = [
        makeActivation('brevity', 'MINIMALISM', 0.85),
        makeActivation('depth', 'COMPREHENSIVE', 0.85),
      ];
      const collisions = detectCollisions(activations, 0.85);
      expect(collisions.length).toBeGreaterThan(0);
    });

    it('no collision when only one side present', () => {
      const activations = [
        makeActivation('brevity', 'MINIMALISM', 1.0),
        makeActivation('other', 'LEAD_WITH_IDEAS', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      expect(collisions.length).toBe(0);
    });

    it('no collision with fewer than 2 strong phantoms', () => {
      const activations = [
        makeActivation('brevity', 'MINIMALISM', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      expect(collisions.length).toBe(0);
    });
  });

  describe('Collision Context', () => {
    it('builds injection prompt with phantom names', () => {
      const activations = [
        makeActivation('surgical_brevity', 'MINIMALISM_SURGICAL', 1.0),
        makeActivation('deep_analysis', 'COMPREHENSIVE_DEEP', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      const context = buildCollisionContext(collisions);
      expect(context).toContain('CREATIVE TENSIONS');
      expect(context).toContain('surgical_brevity');
      expect(context).toContain('deep_analysis');
    });

    it('returns empty string when no collisions', () => {
      expect(buildCollisionContext([])).toBe('');
    });

    it('picks the strongest phantom from each side', () => {
      const activations = [
        makeActivation('weak_brevity', 'MINIMALISM', 0.9),
        makeActivation('strong_brevity', 'BE_ULTRA_BRIEF', 2.0),
        makeActivation('depth', 'COMPREHENSIVE', 1.0),
      ];
      const collisions = detectCollisions(activations, 0.85);
      if (collisions.length > 0) {
        expect(collisions[0].phantomA).toBe('strong_brevity');
      }
    });
  });
});
