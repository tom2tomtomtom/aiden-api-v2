/**
 * Phantom Dedup
 *
 * Checks for semantically similar phantoms before creating new ones.
 * Prevents near-duplicates like "defend quality", "protect creative standards",
 * and "uncompromising about excellence" from becoming separate phantoms.
 *
 * Uses cosine similarity with 0.82 threshold.
 * Dependency injection for embedding and phantom retrieval.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/phantom-dedup.ts
 * Full logic preserved.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface DedupResult {
  isDuplicate: boolean;
  existingPhantom?: {
    id: string;
    shorthand: string;
    similarity: number;
  };
}

export interface PhantomForDedup {
  id: string;
  shorthand: string;
  identityText: string;
}

/**
 * Embedding provider for dedup similarity checks.
 */
export interface DedupEmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedTexts(texts: string[]): Promise<number[][]>;
}

/**
 * Phantom retrieval provider for loading existing phantoms.
 */
export interface PhantomRetrievalProvider {
  getActivePhantoms(agencyId: string): Promise<PhantomForDedup[]>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.82;

// ── Core Function ───────────────────────────────────────────────────────────

/**
 * Check if a semantically similar phantom already exists for this agency.
 *
 * Embeds the new phantom's identity text and compares against existing
 * agency phantoms using cosine similarity. Returns the closest match
 * if above threshold.
 *
 * @param agencyId - The agency to check within
 * @param identityText - The new phantom's combined identity text (feeling_seed + story + influence)
 * @param embeddingProvider - Injected embedding service
 * @param phantomProvider - Injected phantom retrieval service
 * @returns DedupResult indicating if a duplicate exists
 */
export async function checkPhantomDedup(
  agencyId: string,
  identityText: string,
  embeddingProvider: DedupEmbeddingProvider,
  phantomProvider: PhantomRetrievalProvider,
): Promise<DedupResult> {
  try {
    // Embed the new phantom's identity text
    const embedding = await embeddingProvider.embedQuery(identityText);

    // Load existing active agency phantoms
    const existingPhantoms = await phantomProvider.getActivePhantoms(agencyId);

    if (!existingPhantoms.length) {
      return { isDuplicate: false };
    }

    // Get identity texts to embed
    const existingTexts = existingPhantoms
      .map((p) => p.identityText)
      .filter(Boolean);

    if (existingTexts.length === 0) {
      return { isDuplicate: false };
    }

    // Batch embed existing identity texts
    const existingEmbeddings = await embeddingProvider.embedTexts(existingTexts);

    // Find the most similar existing phantom
    let bestSimilarity = 0;
    let bestMatch: { id: string; shorthand: string } | null = null;

    for (let i = 0; i < existingEmbeddings.length; i++) {
      const sim = cosineSimilarity(embedding, existingEmbeddings[i]);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = existingPhantoms[i];
      }
    }

    if (bestSimilarity >= SIMILARITY_THRESHOLD && bestMatch) {
      console.log(
        `[PhantomDedup] Duplicate detected: "${bestMatch.shorthand}" ` +
        `(similarity: ${bestSimilarity.toFixed(3)})`,
      );
      return {
        isDuplicate: true,
        existingPhantom: {
          id: bestMatch.id,
          shorthand: bestMatch.shorthand,
          similarity: bestSimilarity,
        },
      };
    }

    return { isDuplicate: false };
  } catch (err) {
    console.warn('[PhantomDedup] Dedup check failed, allowing creation:', err);
    return { isDuplicate: false }; // Fail open: allow creation if dedup fails
  }
}

// ── Cosine Similarity ───────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export { SIMILARITY_THRESHOLD };
