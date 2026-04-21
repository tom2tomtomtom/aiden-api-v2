/**
 * Workflow Intent Detection
 *
 * Two-tier approach:
 * 1. State-driven defaults (what makes sense at current step)
 * 2. Keyword regex fallback for explicit intents
 *
 * Ported from: ~/aiden-api/app/workflow/intent.py
 */

import { WorkflowStep, ASYNC_STEPS, DECISION_STEPS } from './session.js';

// ── Intent Types ──────────────────────────────────────────────────────────────

export enum Intent {
  PROVIDE_BRIEF = 'provide_brief',
  ADVANCE = 'advance',
  SELECT = 'select',
  SET_FORMATS = 'set_formats',
  CHECK_STATUS = 'check_status',
  RESET = 'reset',
  HELP = 'help',
}

// ── Pattern matching ──────────────────────────────────────────────────────────

const PATTERNS: Array<[Intent, RegExp]> = [
  [Intent.RESET, /\b(reset|start\s*over|restart|clear)\b/i],
  [Intent.HELP, /\b(help|commands|what\s+can|how\s+do)\b/i],
  [Intent.ADVANCE, /\b(next|go|continue|proceed|advance|generate|run)\b/i],
  [Intent.CHECK_STATUS, /\b(status|done|ready|check|progress|finished|complete)\b/i],
];

const FORMAT_PATTERN = /\b(social|headlines|youtube|print|ooh|radio|tv|email|banner|digital|video|script)\b/i;
const SELECT_NUMBER = /^\s*(\d+)\s*$/;
const SELECT_EXPLICIT = /\b(?:pick|select|choose|option|number)\s*(\d+)\b/i;
const ORDINAL_MAP: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
};
const SELECT_ORDINAL = /\b(first|second|third|fourth|fifth)\b/i;

// ── Public API ────────────────────────────────────────────────────────────────

export function extractSelection(text: string): number | null {
  let m = SELECT_NUMBER.exec(text);
  if (m) return parseInt(m[1], 10);

  m = SELECT_EXPLICIT.exec(text);
  if (m) return parseInt(m[1], 10);

  m = SELECT_ORDINAL.exec(text);
  if (m) return ORDINAL_MAP[m[1].toLowerCase()] ?? null;

  return null;
}

export function detectIntent(step: WorkflowStep, message: string): Intent {
  const text = message.trim();

  // Tier 1: state-driven defaults
  if (step === WorkflowStep.INITIAL) {
    if (text.length > 30) return Intent.PROVIDE_BRIEF;
  }

  if (DECISION_STEPS.has(step)) {
    if (extractSelection(text) !== null) return Intent.SELECT;
  }

  if (step === WorkflowStep.BIG_IDEA_SELECTED) {
    if (FORMAT_PATTERN.test(text)) return Intent.SET_FORMATS;
  }

  // Tier 2: keyword matching
  for (const [intent, pattern] of PATTERNS) {
    if (pattern.test(text)) return intent;
  }

  // Fallback
  if (ASYNC_STEPS.has(step)) return Intent.CHECK_STATUS;
  if (step === WorkflowStep.INITIAL) return Intent.PROVIDE_BRIEF;

  return Intent.ADVANCE;
}
