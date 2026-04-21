/**
 * Phantom Dedup Tests
 *
 * Tests cosine similarity threshold (0.82).
 */

import { describe, it, expect } from 'vitest';
import {
  checkPhantomDedup,
  cosineSimilarity,
  SIMILARITY_THRESHOLD,
  type DedupEmbeddingProvider,
  type PhantomRetrievalProvider,
} from '../../src/brain/phantom-dedup.js';

describe('Phantom Dedup', () => {
  describe('Cosine Similarity', () => {
    it('returns 1.0 for identical vectors', () => {
      const v = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it('returns -1 for opposite vectors', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    it('handles zero vectors gracefully', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('calculates correctly for similar vectors', () => {
      const a = [1, 2, 3, 4];
      const b = [1.1, 2.1, 3.1, 4.1];
      const sim = cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.99);
    });
  });

  describe('Similarity Threshold', () => {
    it('threshold is 0.82', () => {
      expect(SIMILARITY_THRESHOLD).toBe(0.82);
    });
  });

  describe('Dedup Check', () => {
    it('detects duplicates above threshold', async () => {
      const mockEmbedding: DedupEmbeddingProvider = {
        async embedQuery() { return [1, 0, 0, 0]; },
        async embedTexts() { return [[0.99, 0.01, 0.01, 0.01]]; }, // Very similar
      };

      const mockPhantoms: PhantomRetrievalProvider = {
        async getActivePhantoms() {
          return [{ id: 'existing-1', shorthand: 'quality_defender', identityText: 'defend quality' }];
        },
      };

      const result = await checkPhantomDedup(
        'agency-1',
        'uncompromising about quality standards',
        mockEmbedding,
        mockPhantoms,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingPhantom?.shorthand).toBe('quality_defender');
    });

    it('allows creation below threshold', async () => {
      const mockEmbedding: DedupEmbeddingProvider = {
        async embedQuery() { return [1, 0, 0, 0]; },
        async embedTexts() { return [[0, 1, 0, 0]]; }, // Orthogonal = very different
      };

      const mockPhantoms: PhantomRetrievalProvider = {
        async getActivePhantoms() {
          return [{ id: 'existing-1', shorthand: 'other_phantom', identityText: 'something else' }];
        },
      };

      const result = await checkPhantomDedup(
        'agency-1',
        'completely different concept',
        mockEmbedding,
        mockPhantoms,
      );

      expect(result.isDuplicate).toBe(false);
    });

    it('allows creation when no existing phantoms', async () => {
      const mockEmbedding: DedupEmbeddingProvider = {
        async embedQuery() { return [1, 0, 0]; },
        async embedTexts() { return []; },
      };

      const mockPhantoms: PhantomRetrievalProvider = {
        async getActivePhantoms() { return []; },
      };

      const result = await checkPhantomDedup(
        'agency-1',
        'new phantom concept',
        mockEmbedding,
        mockPhantoms,
      );

      expect(result.isDuplicate).toBe(false);
    });

    it('fails open on error (allows creation)', async () => {
      const mockEmbedding: DedupEmbeddingProvider = {
        async embedQuery() { throw new Error('Embedding service down'); },
        async embedTexts() { throw new Error('Embedding service down'); },
      };

      const mockPhantoms: PhantomRetrievalProvider = {
        async getActivePhantoms() { return []; },
      };

      const result = await checkPhantomDedup(
        'agency-1',
        'test',
        mockEmbedding,
        mockPhantoms,
      );

      expect(result.isDuplicate).toBe(false);
    });
  });
});
