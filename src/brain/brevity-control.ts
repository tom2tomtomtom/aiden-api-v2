/**
 * Brevity Control
 *
 * Config-driven message complexity analysis and brevity phantom suppression.
 * Externalizes inline logic from phantom-activator.ts into a reusable module.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/brevity-control.ts
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const complexityConfig = require('../config/complexity-analyzer.json') as {
  complexKeywords: string[];
  analyticalPatterns: string[];
  thresholds: { simpleMaxWords: number; moderateMinWords: number; complexMinWords: number };
  brevityInfluences: string[];
  brevitySuppressionMultiplier: number;
};

// ── Types ─────────────────────────────────────────��───────────────────────────

export type MessageComplexity = 'simple' | 'moderate' | 'complex';

// ── analyzeMessageComplexity ───────────────���──────────────────────────────────

/**
 * Classify a user message into simple / moderate / complex.
 *
 * - complex: 8+ words, OR contains a complex keyword, OR matches an analytical pattern
 * - moderate: 4-7 words with no complex signals
 * - simple: 1-3 words with no complex signals
 */
export function analyzeMessageComplexity(message: string): MessageComplexity {
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  const messageLower = message.toLowerCase();

  const hasComplexKeyword = complexityConfig.complexKeywords.some((kw) => messageLower.includes(kw));
  const hasAnalyticalPattern = complexityConfig.analyticalPatterns.some((p) => messageLower.includes(p));

  if (wordCount >= complexityConfig.thresholds.complexMinWords || hasComplexKeyword || hasAnalyticalPattern) {
    return 'complex';
  }

  if (wordCount >= complexityConfig.thresholds.moderateMinWords) {
    return 'moderate';
  }

  return 'simple';
}

// ── isBrevityPhantom ───────��─────────────────────────���────────────────────���───

/**
 * Returns true if the given influence string matches a brevity influence.
 */
export function isBrevityPhantom(influence: string): boolean {
  return complexityConfig.brevityInfluences.some((inf) => influence.includes(inf));
}

// ── getBrevitySuppressionMultiplier ─────────��───────────────────────���────────

/**
 * Returns the activation score multiplier for a phantom.
 *
 * Brevity phantoms are suppressed (0.1x) when the user message is complex,
 * to avoid forcing terse replies on analytical questions.
 * Returns 1.0 in all other cases.
 */
export function getBrevitySuppressionMultiplier(
  influence: string,
  complexity: MessageComplexity,
): number {
  if (isBrevityPhantom(influence) && complexity === 'complex') {
    return complexityConfig.brevitySuppressionMultiplier;
  }
  return 1.0;
}
