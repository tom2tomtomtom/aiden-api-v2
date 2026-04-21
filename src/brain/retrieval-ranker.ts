/**
 * Retrieval Ranker
 *
 * Re-ranks RAG results using metadata signals, expands context via
 * wiki-links, and suppresses results aligned with anti-phantoms.
 * Enforces a 2000-token budget cap on total RAG context.
 *
 * Ported from: ~/aiden-colleague/src/lib/rag/retrieval-ranker.ts
 * Full logic preserved. Dependency injection for DB calls.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface RAGResult {
  id: string;
  content: string;
  similarity: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface RankedRAGResult extends RAGResult {
  /** Adjusted score after metadata boosting */
  rankedScore: number;
}

export interface LinkedDocumentSummary {
  documentId: string;
  filename: string;
  summary: string;
  /** Number of matched results that link to this document */
  linkCount: number;
}

export interface RetrievalResult {
  /** Primary results, re-ranked by metadata */
  results: RankedRAGResult[];
  /** Summaries of documents linked from the top results */
  linkedContext: LinkedDocumentSummary[];
}

/**
 * RAG scope configuration for workspace-specific boosting.
 */
export interface RAGScope {
  tagBoosts?: string[];
  documentIds?: string[];
}

// ── Document link provider (dependency injection) ───────────────────────────

export interface DocumentLinkProvider {
  getLinkedDocuments(sourceDocumentIds: string[]): Promise<Array<{
    targetDocumentId: string;
    filename: string;
    summary: string;
  }>>;
}

// ── Embedding provider (dependency injection) ───────────────────────────────

export interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
}

// ── Metadata Re-Ranking ─────────────────────────────────────────────────────

/**
 * Apply metadata-based score multipliers to RAG results.
 *
 * Signals:
 * - status: active/growing = 1.2x, archived = 0.7x
 * - freshness: updated within 30 days = 1.1x, > 6 months = 0.9x
 * - tag overlap with phantom keywords = 1.3x per overlapping tag
 * - document type index + navigational intent = 1.5x
 * - workspace RAG scope tag boosts = 1.4x
 * - workspace RAG scope document ID match = 1.5x
 */
export function applyMetadataBoosts(
  results: RAGResult[],
  phantomKeywords: string[],
  isNavigational: boolean = false,
  ragScope?: RAGScope,
): RankedRAGResult[] {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;
  const phantomKeywordSet = new Set(phantomKeywords.map((k) => k.toLowerCase()));

  return results.map((result) => {
    let multiplier = 1.0;
    const meta = result.metadata ?? {};
    const frontmatter = (meta.frontmatter ?? {}) as Record<string, unknown>;

    // Status boost
    const status = (frontmatter.status as string)?.toLowerCase();
    if (status === 'active' || status === 'growing') {
      multiplier *= 1.2;
    } else if (status === 'archived') {
      multiplier *= 0.7;
    }

    // Freshness boost
    const updated = frontmatter.updated as string;
    if (updated) {
      const updatedTime = new Date(updated).getTime();
      if (!isNaN(updatedTime)) {
        const age = now - updatedTime;
        if (age < thirtyDaysMs) multiplier *= 1.1;
        else if (age > sixMonthsMs) multiplier *= 0.9;
      }
    }

    // Tag overlap with phantom keywords
    const tags = (frontmatter.tags ?? []) as string[];
    for (const tag of tags) {
      if (phantomKeywordSet.has(tag.toLowerCase())) {
        multiplier *= 1.3;
      }
    }

    // Index + navigational query boost
    const chunkType = meta.chunk_type as string;
    if (chunkType === 'index' && isNavigational) {
      multiplier *= 1.5;
    }

    // Workspace RAG scope boosts
    if (ragScope) {
      const scopeTagSet = new Set((ragScope.tagBoosts ?? []).map((t) => t.toLowerCase()));
      for (const tag of tags) {
        if (scopeTagSet.has(tag.toLowerCase())) {
          multiplier *= 1.4;
        }
      }
      const docId = meta.documentId as string;
      if (docId && ragScope.documentIds?.includes(docId)) {
        multiplier *= 1.5;
      }
    }

    return {
      ...result,
      rankedScore: result.similarity * multiplier,
    };
  }).sort((a, b) => b.rankedScore - a.rankedScore);
}

// ── Wiki-Link Expansion ─────────────────────────────────────────────────────

/**
 * Follow wiki-links from top results and fetch linked document summaries.
 * Returns summaries of connected documents for injection into the system prompt.
 *
 * @param topResults - The top N ranked results to expand from
 * @param linkProvider - Injected document link provider
 * @param maxLinks - Maximum linked documents to return (default 5)
 */
export async function expandWikiLinks(
  topResults: RankedRAGResult[],
  linkProvider: DocumentLinkProvider,
  maxLinks: number = 5,
): Promise<LinkedDocumentSummary[]> {
  if (topResults.length === 0) return [];

  // Collect document IDs from top results
  const documentIds = [
    ...new Set(
      topResults
        .map((r) => (r.metadata as Record<string, unknown>)?.documentId as string)
        .filter(Boolean),
    ),
  ];

  if (documentIds.length === 0) return [];

  // Find outgoing links from these documents
  const links = await linkProvider.getLinkedDocuments(documentIds);
  if (!links.length) return [];

  // Count how many source documents link to each target
  const linkCounts = new Map<string, { filename: string; summary: string; count: number }>();
  const resultDocIds = new Set(documentIds);

  for (const link of links) {
    // Exclude documents already in results
    if (resultDocIds.has(link.targetDocumentId)) continue;

    const existing = linkCounts.get(link.targetDocumentId);
    if (existing) {
      existing.count++;
    } else {
      linkCounts.set(link.targetDocumentId, {
        filename: link.filename,
        summary: link.summary,
        count: 1,
      });
    }
  }

  // Sort by link count (most linked = most relevant), take top N
  const summaries: LinkedDocumentSummary[] = Array.from(linkCounts.entries())
    .map(([docId, info]) => ({
      documentId: docId,
      filename: info.filename,
      summary: info.summary,
      linkCount: info.count,
    }))
    .sort((a, b) => b.linkCount - a.linkCount)
    .slice(0, maxLinks);

  return summaries;
}

// ── Anti-Phantom RAG Suppression ────────────────────────────────────────────

/**
 * Suppress RAG results that align with anti-phantom directions.
 * Uses keyword overlap as a lightweight similarity proxy.
 *
 * @param results - Ranked results to filter
 * @param antiPhantomTexts - Identity texts of active anti-phantoms
 * @returns Results with suppressed scores for anti-phantom-aligned content
 */
export function suppressAntiPhantomResults(
  results: RankedRAGResult[],
  antiPhantomTexts: string[],
): RankedRAGResult[] {
  if (antiPhantomTexts.length === 0) return results;

  // Combine anti-phantom texts and extract keywords
  const combinedAntiText = antiPhantomTexts.join(' ');
  const antiKeywords = new Set(
    combinedAntiText
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4),
  );

  if (antiKeywords.size === 0) return results;

  return results.map((result) => {
    const contentWords = new Set(
      result.content
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4),
    );

    let overlapCount = 0;
    for (const keyword of antiKeywords) {
      if (contentWords.has(keyword)) overlapCount++;
    }

    // If significant keyword overlap, penalise
    const overlapRatio = antiKeywords.size > 0 ? overlapCount / antiKeywords.size : 0;
    if (overlapRatio > 0.3) {
      return { ...result, rankedScore: result.rankedScore * 0.5 };
    }

    return result;
  }).sort((a, b) => b.rankedScore - a.rankedScore);
}

// ── Context Builders ────────────────────────────────────────────────────────

/**
 * Build the linked context block for the system prompt.
 */
export function buildLinkedContextBlock(
  linkedDocs: LinkedDocumentSummary[],
  tokenBudget: number = 500,
): string {
  if (linkedDocs.length === 0) return '';

  const lines: string[] = [
    'CONNECTED KNOWLEDGE:',
    'These documents are linked to the sources above:',
  ];

  let tokenEstimate = 20; // header tokens

  for (const doc of linkedDocs) {
    const line = `- "${doc.filename.replace('.md', '')}": ${doc.summary}`;
    const lineTokens = Math.ceil(line.length / 4);

    if (tokenEstimate + lineTokens > tokenBudget) break;

    lines.push(line);
    tokenEstimate += lineTokens;
  }

  return lines.join('\n');
}

/**
 * Build the primary RAG context block with 2000-token budget cap.
 * Includes ranked results and linked context within budget.
 */
export function buildRAGContextBlock(
  results: RankedRAGResult[],
  linkedDocs: LinkedDocumentSummary[],
  tokenBudget: number = 2000,
): string {
  if (results.length === 0) return '';

  const lines: string[] = ['RELEVANT KNOWLEDGE:'];
  let tokenEstimate = 10;

  // Primary results (allocate 75% of budget)
  const primaryBudget = Math.floor(tokenBudget * 0.75);

  for (const result of results) {
    const line = `[${result.source}] ${result.content}`;
    const lineTokens = Math.ceil(line.length / 4);

    if (tokenEstimate + lineTokens > primaryBudget) break;

    lines.push(line);
    tokenEstimate += lineTokens;
  }

  // Linked context (remaining budget)
  const remainingBudget = tokenBudget - tokenEstimate;
  const linkedBlock = buildLinkedContextBlock(linkedDocs, remainingBudget);
  if (linkedBlock) {
    lines.push('');
    lines.push(linkedBlock);
  }

  return lines.join('\n');
}
