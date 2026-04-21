/**
 * Creative Reset Detection
 *
 * Detects escalation signals (16 phrases, 1.5x bold boost),
 * kill/reset signals (13 phrases, 0.3x suppression + ideation reset),
 * and sensitive topic signals in user messages.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/creative-reset.ts
 * All indicator lists preserved exactly.
 */

// ── Indicator lists ──────────────────��───────────────────────────────────────

/** 16 escalation phrases that trigger 1.5x bold phantom boost */
const ESCALATION_INDICATORS: string[] = [
  'push it further',
  'push harder',
  'bolder',
  'make me nervous',
  'go further',
  'wilder',
  'edgier',
  'take more risks',
  'less safe',
  'more provocative',
  'be braver',
  'not bold enough',
  'too safe',
  'too tame',
  'shock me',
  'surprise me',
];

/** 13 kill phrases that trigger 0.3x suppression + ideation reset */
const KILL_INDICATORS: string[] = [
  'kill it',
  'start over',
  'scrap it',
  'from scratch',
  'completely new',
  'throw it away',
  'bin it',
  'start again',
  'nuke it',
  'back to square one',
  'forget that',
  'different direction entirely',
  'total reset',
];

const SENSITIVE_TOPIC_INDICATORS: string[] = [
  'funeral',
  'death',
  'dying',
  'grief',
  'mourning',
  'loss',
  'illness',
  'cancer',
  'terminal',
  'disability',
  'disabled',
  'mental health',
  'depression',
  'anxiety',
  'suicide',
  'abuse',
  'assault',
  'violence',
  'trauma',
  'addiction',
  'rehab',
  'recovery',
  'poverty',
  'homeless',
  'hunger',
  'war',
  'refugee',
  'displacement',
  'miscarriage',
  'infertility',
  'stillborn',
];

// ── Detection functions ──────────────────────────────────────────────────────

/**
 * Returns true if the message contains any escalation indicator phrase.
 * The user wants bolder, riskier, more provocative creative output.
 */
export function detectEscalation(message: string): boolean {
  const lower = message.toLowerCase();
  return ESCALATION_INDICATORS.some((indicator) => lower.includes(indicator));
}

/**
 * Returns true if the message contains any kill/reset indicator phrase.
 * The user wants to discard the current work and start completely fresh.
 */
export function detectKill(message: string): boolean {
  const lower = message.toLowerCase();
  return KILL_INDICATORS.some((indicator) => lower.includes(indicator));
}

/**
 * Returns true if the message references a sensitive topic.
 * Signals that the brief involves vulnerability, hardship, or human suffering.
 */
export function detectSensitiveTopic(message: string): boolean {
  const lower = message.toLowerCase();
  return SENSITIVE_TOPIC_INDICATORS.some((indicator) => lower.includes(indicator));
}

// ── Context builder functions ──────────��─────────────────────────────��────────

/**
 * Returns an empty string when isKill is false.
 * When isKill is true, returns a directive to start from an OPPOSITE premise,
 * not a variation of the previous idea.
 */
export function buildCreativeResetContext(isKill: boolean): string {
  if (!isKill) return '';

  return (
    'The user has asked you to completely reset. Do NOT iterate on the previous idea in any way. ' +
    'Start from an opposite premise. Invert the core assumption. ' +
    'If the last idea was warm, go cold. If it was loud, go quiet. ' +
    'Treat this as a blank page, not an iteration.'
  );
}

/**
 * Returns a context string granting permission to push past the comfort zone.
 * Use when escalation signals are detected.
 */
export function buildEscalationContext(): string {
  return (
    'The user is explicitly asking you to push past the comfort zone. ' +
    'You have permission to be genuinely risky, strange, or confrontational. ' +
    'Do not self-censor for safety or palatability. ' +
    'Bravery is required here. Make choices that create real tension.'
  );
}

/**
 * Returns a context string reinforcing that bravery is still required
 * even when the brief touches sensitive topics. Do not patronise.
 */
export function buildSensitiveBraveryContext(): string {
  return (
    'This brief touches on a sensitive topic. That does not mean you should soften your creative ambition. ' +
    'Bravery is still required. Treat the subject with honesty and craft, not platitudes. ' +
    'Do not patronise the audience or reduce real human experience to cliche. ' +
    'The most powerful creative work on difficult subjects is specific, surprising, and respectful without being timid.'
  );
}
