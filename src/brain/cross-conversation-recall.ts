/**
 * Cross-Conversation Recall
 *
 * Decides when to surface past conversation context automatically, and formats
 * retrieved results for injection into the system prompt.
 *
 * Smart triggering:
 * - Early conversation (<=2 exchanges): always recall
 * - Explicit phrase ("we talked about", "remember when", etc.)
 * - Pivoting momentum with 3+ exchanges
 *
 * Uses dependency injection for semantic search (no hardcoded Supabase).
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/cross-conversation-recall.ts
 * Full logic preserved.
 */

import type { MessageAnalysis, ConversationExchange } from '../types.js';

// ── Constants ──────────────��──────────────────────���───────────────────────────

const RECALL_PHRASES = [
  'we talked about',
  'we discussed',
  'remember when',
  'last time',
  'last session',
  'you said',
  'you mentioned',
  'previously',
  'earlier conversation',
  'before we',
] as const;

// ── RAG Result interface (for dependency injection) ──────────────────────────

export interface CrossConversationRAGResult {
  content: string;
  source: string;
  similarity?: number;
}

/**
 * Semantic search provider for cross-conversation recall.
 * Injected at runtime to decouple from database implementation.
 */
export interface CrossConversationSearchProvider {
  searchPastConversations(options: {
    query: string;
    userId?: string;
    workspaceId?: string;
    maxResults?: number;
    minSimilarity?: number;
  }): Promise<CrossConversationRAGResult[]>;
}

// ── Exports ──────────────────��──────────────────────────────��─────────────────

/**
 * Determine whether cross-conversation semantic search should run for this turn.
 *
 * Returns true if ANY of the following are true:
 * - History is 1 or 2 exchanges long (early in a new conversation, possibly continuing a prior topic).
 * - The user message contains an explicit recall phrase.
 * - Momentum is "pivoting" and there are at least 3 prior exchanges (topic shift signals prior context may be useful).
 *
 * Returns false only when history is empty (absolute first message, nothing to recall).
 */
export function shouldRecallCrossConversation(
  analysis: MessageAnalysis,
  conversationHistory: ConversationExchange[],
  userMessage: string,
): boolean {
  // Absolute first message: nothing in any session to recall.
  if (conversationHistory.length === 0) {
    return false;
  }

  // Early in a new conversation: may be continuing a previous session's topic.
  if (conversationHistory.length <= 2) {
    return true;
  }

  // Explicit recall phrase: user is directly referencing a past conversation.
  const lower = userMessage.toLowerCase();
  if (RECALL_PHRASES.some((phrase) => lower.includes(phrase))) {
    return true;
  }

  // Topic pivot with established context: likely switching to a thread from before.
  if (analysis.momentum === 'pivoting' && conversationHistory.length >= 3) {
    return true;
  }

  return false;
}

/**
 * Format past conversation RAG results into a system prompt block.
 *
 * Returns an empty string when there are no results, so callers can safely
 * concatenate without producing spurious whitespace.
 */
export function formatPastConversations(results: CrossConversationRAGResult[]): string {
  if (results.length === 0) {
    return '';
  }

  const lines: string[] = [
    'PAST CONVERSATION CONTEXT (automatic recall):',
    'You have discussed related topics before:',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`[${i + 1}] ${r.content} (source: ${r.source})`);
  }

  lines.push('');
  lines.push('Reference these naturally if relevant. Do not force connections.');

  return lines.join('\n');
}
