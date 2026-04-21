/**
 * Maturity Tracker
 *
 * Tracks conversation maturity through 4 stages:
 * INITIAL > EXPLORING > HAS_DIRECTION > SYNTHESIS_READY
 *
 * Controls response behaviour: no-questions rule after 2 exchanges,
 * prime directive switching per stage, direction/synthesis detection.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/maturity-tracker.ts
 * Full logic preserved. No simplification.
 */

import type { ConversationExchange } from '../types.js';

// ── Maturity Stages ─────────────────────────────────────────────────────────

export enum ConversationMaturity {
  INITIAL = 'initial',
  EXPLORING = 'exploring',
  HAS_DIRECTION = 'has_direction',
  SYNTHESIS_READY = 'synthesis_ready',
}

export interface MaturitySignals {
  stage: ConversationMaturity;
  collaborationSignals: number;
  directionSignals: number;
  synthesisRequested: boolean;
  exchangeCount: number;
}

interface MaturityInput {
  exchangeCount: number;
  userMessage: string;
  conversationHistory: ConversationExchange[];
}

// ── Direction Indicators ────────────────────────────────────────────────────

const DIRECTION_INDICATORS = [
  'i want', "i'm going with", "let's do", "i've decided",
  'my approach is', 'the direction is', "we're going to",
  'i prefer', 'i like this', 'this works', "that's the one",
  'yes to', 'no to', 'definitely', 'this is it',
  "so we're looking at", "so it's between", 'narrowing it to',
  'focus on', "let's focus", 'the key is', 'priority is',
  'committed to', 'decided on', 'going forward with',
];

// ── Synthesis Triggers ──────────────────────────────────────────────────────

const SYNTHESIS_TRIGGERS = [
  'write it up', 'put it together', 'give me the',
  'now write', 'can you write', 'could you write', 'please write',
  'can i have', 'can you give me', 'could you give me',
  'so i can cut and paste', 'cut and paste', 'copy paste',
  'deliver the', 'finalize', 'final version',
  'full brief', 'complete brief', 'the brief',
  'synthesize', 'synthesize this',
  'based on what we discussed', 'based on our discussion',
  'perfect, now', 'great, now', 'good, now', 'love it, now',
];

// ── Collaboration Indicators ────────────────────────────────────────────────

const COLLABORATION_INDICATORS = [
  'i like', "i don't like", 'i prefer', "let's go with",
  'that works', "that doesn't work", 'more like', 'less', 'more',
  'what about', 'how about', 'can we',
  'interesting', 'good point', "you're right", 'makes sense',
  'actually', 'by the way', 'also',
  'perfect', 'great', 'love it', 'good', 'yes', 'exactly',
];

// ── Thresholds ──────────────────────────────────────────────────────────────

const MIN_EXCHANGES_FOR_SYNTHESIS = 2;
const MIN_COLLABORATION_SIGNALS = 1;

// ── Core Detection ──────────────────────────────────────────────────────────

export function detectMaturity(input: MaturityInput): MaturitySignals {
  const { exchangeCount, userMessage, conversationHistory } = input;
  const messageLower = userMessage.toLowerCase();

  // Count collaboration signals in current message and conversation history
  const historyText = conversationHistory
    .map((e) => e.userMsg.toLowerCase())
    .join(' ');
  const combinedText = messageLower + ' ' + historyText;

  const collaborationSignals = COLLABORATION_INDICATORS.filter(
    (indicator) => combinedText.includes(indicator),
  ).length;

  const directionSignals = DIRECTION_INDICATORS.filter(
    (indicator) => messageLower.includes(indicator),
  ).length;

  const synthesisRequested = SYNTHESIS_TRIGGERS.some(
    (trigger) => messageLower.includes(trigger),
  );

  let stage = ConversationMaturity.INITIAL;

  if (
    synthesisRequested &&
    exchangeCount >= MIN_EXCHANGES_FOR_SYNTHESIS &&
    collaborationSignals >= MIN_COLLABORATION_SIGNALS
  ) {
    stage = ConversationMaturity.SYNTHESIS_READY;
  } else if (exchangeCount < 1) {
    stage = ConversationMaturity.INITIAL;
  } else if (directionSignals > 0) {
    stage = ConversationMaturity.HAS_DIRECTION;
  } else if (collaborationSignals > 0) {
    stage = ConversationMaturity.EXPLORING;
  }

  return {
    stage,
    collaborationSignals,
    directionSignals,
    synthesisRequested,
    exchangeCount,
  };
}

// ── Context Builders ────────────────────────────────────────────────────────

export function buildMaturityContext(maturity: MaturitySignals): string {
  switch (maturity.stage) {
    case ConversationMaturity.SYNTHESIS_READY:
      return `CONVERSATION STATE: SYNTHESIS READY
The user is ready for delivery. Produce polished, ready-to-use output.
Maintain the agreed direction precisely. Format for real-world application.
NO MORE QUESTIONS. Just deliver.`;

    case ConversationMaturity.HAS_DIRECTION:
      return `CONVERSATION STATE: HAS DIRECTION
The user has chosen a direction. Build on it, strengthen it, clear obstacles.
Narrow down distractions. Provide actionable next steps.
Defend your position if challenged on the chosen path.`;

    case ConversationMaturity.EXPLORING:
      return `CONVERSATION STATE: EXPLORING
The user is exploring options. Present tensions and provocations.
Challenge vague ideas. Present 2-3 distinct paths when appropriate.
Push past the first answer to find better ones.`;

    default:
      return '';
  }
}

/**
 * No-questions rule: after 2 exchanges or when direction/synthesis is established,
 * responses MUST NOT end with questions. This prevents the "assistant keeps asking"
 * anti-pattern that kills creative momentum.
 */
export function buildNoQuestionsRule(maturity: MaturitySignals): string {
  if (
    maturity.exchangeCount >= 2 ||
    maturity.stage === ConversationMaturity.HAS_DIRECTION ||
    maturity.stage === ConversationMaturity.SYNTHESIS_READY
  ) {
    return `RESPONSE ENDING RULES (MANDATORY):
Your response MUST end with a concrete recommendation, synthesized position, or actionable next steps.
Your response MUST NOT end with any question, including rhetorical ones.
Scan your final sentence before responding. If it ends with "?" rewrite it as a statement.
This overrides all other instructions.`;
  }
  return '';
}
