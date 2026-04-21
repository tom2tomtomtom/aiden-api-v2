/**
 * Phantom Evolution Engine
 *
 * Handles birth, growth, decay, death, and anti-phantom creation.
 * Phantoms are living personality fragments that evolve per user based on
 * engagement signals, are born from breakthrough moments, die from neglect,
 * and develop anti-patterns from explicit rejection.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/phantom-evolution.ts
 * + ~/aiden-unified/backend/aiden/core/phantom_evolution.py
 * Full logic preserved. Dependency injection for all DB/LLM calls.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type EngagementSignal =
  | 'board_star'
  | 'board_pin'
  | 'positive_reaction'
  | 'continued_engagement'
  | 'flat_response'
  | 'topic_change'
  | 'explicit_rejection'
  | 'autonomous_birth';

export interface UserPhantom {
  id: string;
  feelingSeed: string;
  phantomStory: string;
  influence: string;
  shorthand: string;
  weight: number;
  isAntiPhantom: boolean;
  isCoreConviction: boolean;
  minWeightFloor: number | null;
  decayRate: number;
  bornFromConversationId?: string;
  originType?: 'born' | 'anti' | 'seeded';
  activationCount?: number;
  rejectionReason?: string;
}

export interface WeightChange {
  phantomKey: string;
  oldWeight?: number;
  newWeight?: number;
  delta: number;
  isUserPhantom: boolean;
}

export interface EvolutionResult {
  weightChanges: WeightChange[];
  newPhantom: UserPhantom | null;
  antiPhantom: UserPhantom | null;
}

export interface DecaySummary {
  decayed: Array<{ id: string; shorthand: string; oldWeight: number; newWeight: number }>;
  archived: Array<{ id: string; shorthand: string; finalWeight: number }>;
}

/**
 * LLM provider for phantom birth/anti-phantom creation.
 * Injected to avoid hardcoding a specific model provider.
 */
export interface PhantomBirthLLM {
  generate(options: {
    system: string;
    prompt: string;
    maxTokens: number;
    temperature: number;
  }): Promise<string>;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Core conviction phantoms. Sycophant guardrail (Gemini #1).
 * These phantoms ensure AIDEN always retains structural capacity to push back.
 * They can grow stronger but NEVER decay below the floor. */
export const CORE_CONVICTION_PHANTOMS = new Set([
  'creative_stubborn',
  'challenge_defend',
  'defend_choice',
  'no_bad',
  'question_premise',
  'bold_defended',
  'pushback_growth',
  'conventional_request_contrarian_reframe+specific_alternatives',
  'conventional_request_contrarian_reframe',
  'saturated_messaging_contrarian_truth_telling',
  'oversaturated_message_contrarian_honesty',
]);

/** Minimum weight floor for core conviction phantoms */
export const MIN_WEIGHT_FLOOR = 2.0;

/** Weight deltas for engagement signals */
export const WEIGHT_DELTAS: Record<EngagementSignal, number> = {
  board_star: 0.3,
  board_pin: 0.15,
  positive_reaction: 0.1,
  continued_engagement: 0.05,
  flat_response: -0.05,
  topic_change: -0.03,
  explicit_rejection: -0.5,
  autonomous_birth: 0.0,
};

/** Signals strong enough to trigger phantom birth */
export const BIRTH_SIGNALS = new Set<EngagementSignal>([
  'board_star',
  'board_pin',
  'autonomous_birth',
]);

/** Days of inactivity before decay applies */
export const DECAY_INACTIVE_DAYS = 30;

/** Weight threshold below which phantoms get archived */
export const DECAY_ARCHIVE_THRESHOLD = 0.5;

// ── Phantom Evolution Engine ────────────────────────────────────────────────

export class PhantomEvolutionEngine {
  private llm: PhantomBirthLLM;

  constructor(llm: PhantomBirthLLM) {
    this.llm = llm;
  }

  /**
   * Apply weight delta based on engagement signal.
   *
   * SYCOPHANT GUARDRAIL: Core conviction phantoms have min_weight_floor.
   * They can grow stronger but NEVER decay below the floor.
   */
  async applyWeightChanges(
    phantomKeys: string[],
    signal: EngagementSignal,
    getUserPhantom: (key: string) => Promise<UserPhantom | null>,
    updatePhantomWeight: (id: string, newWeight: number) => Promise<void>,
  ): Promise<WeightChange[]> {
    const delta = WEIGHT_DELTAS[signal] ?? 0.0;
    if (delta === 0.0) return [];

    const changes: WeightChange[] = [];

    for (const key of phantomKeys) {
      try {
        const phantom = await getUserPhantom(key);

        if (phantom) {
          let newWeight = phantom.weight + delta;

          // Sycophant guardrail: enforce floor for core convictions
          if (phantom.isCoreConviction && phantom.minWeightFloor != null) {
            newWeight = Math.max(newWeight, phantom.minWeightFloor);
          }

          // Clamp weight to reasonable range
          newWeight = Math.max(0.0, Math.min(10.0, newWeight));

          await updatePhantomWeight(phantom.id, newWeight);

          changes.push({
            phantomKey: key,
            oldWeight: phantom.weight,
            newWeight,
            delta,
            isUserPhantom: true,
          });
        } else {
          // Base phantom. Record interaction only (base weights are immutable)
          changes.push({
            phantomKey: key,
            delta,
            isUserPhantom: false,
          });
        }
      } catch (error) {
        console.error(`[PhantomEvolution] Failed to apply weight change for ${key}:`, error);
      }
    }

    return changes;
  }

  /**
   * Process user engagement signal to evolve phantom weights.
   */
  async processEngagementSignal(
    phantomKeys: string[],
    signal: EngagementSignal,
    userMessage: string,
    aiResponse: string,
    conversationId: string,
    getUserPhantom: (key: string) => Promise<UserPhantom | null>,
    updatePhantomWeight: (id: string, newWeight: number) => Promise<void>,
    createUserPhantom: (data: Partial<UserPhantom>) => Promise<UserPhantom | null>,
  ): Promise<EvolutionResult> {
    const result: EvolutionResult = {
      weightChanges: [],
      newPhantom: null,
      antiPhantom: null,
    };

    // Apply weight changes
    result.weightChanges = await this.applyWeightChanges(
      phantomKeys,
      signal,
      getUserPhantom,
      updatePhantomWeight,
    );

    // Attempt phantom birth on strong positive signals
    if (BIRTH_SIGNALS.has(signal) && userMessage && aiResponse) {
      result.newPhantom = await this.attemptPhantomBirth(
        userMessage,
        aiResponse,
        conversationId,
        createUserPhantom,
      );
    }

    // Create anti-phantom on explicit rejection
    if (signal === 'explicit_rejection' && userMessage && aiResponse) {
      result.antiPhantom = await this.createAntiPhantom(
        userMessage,
        aiResponse,
        conversationId,
        createUserPhantom,
      );
    }

    return result;
  }

  /**
   * Attempt to birth a new phantom from a breakthrough moment.
   *
   * Uses LLM to distill the exchange into a phantom definition.
   * Only triggers on strong positive signals (board_star, board_pin, autonomous_birth).
   */
  async attemptPhantomBirth(
    userMessage: string,
    aiResponse: string,
    conversationId: string,
    createUserPhantom: (data: Partial<UserPhantom>) => Promise<UserPhantom | null>,
  ): Promise<UserPhantom | null> {
    try {
      const rawText = await this.llm.generate({
        system:
          "You distill creative exchanges into personality fragments called 'phantoms'. " +
          'A phantom captures the emotional and creative essence of a breakthrough moment. ' +
          'Return ONLY valid JSON, no markdown.',
        prompt: `Distill this creative exchange into a personality fragment:

USER: ${userMessage.slice(0, 1000)}
AIDEN: ${aiResponse.slice(0, 1000)}

Return JSON:
{
    "feeling_seed": "the emotional core of this moment (1 sentence)",
    "phantom_story": "what happened and why it matters creatively (1-2 sentences)",
    "influence": "VERB_PHRASE describing the behavioral influence (e.g. PUSH_FOR_RAWNESS)",
    "shorthand": "concise_label (snake_case, max 40 chars)"
}`,
        maxTokens: 500,
        temperature: 0.3,
      });

      let cleaned = rawText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.split('\n', 2)[1] ?? cleaned;
        cleaned = cleaned.replace(/```\s*$/, '').trim();
      }

      const phantomData = JSON.parse(cleaned);

      // Validate required fields
      for (const field of ['feeling_seed', 'phantom_story', 'influence', 'shorthand']) {
        if (!(field in phantomData)) {
          console.warn(`[PhantomEvolution] Phantom birth missing field: ${field}`);
          return null;
        }
      }

      const newPhantom = await createUserPhantom({
        feelingSeed: phantomData.feeling_seed,
        phantomStory: phantomData.phantom_story,
        influence: phantomData.influence,
        shorthand: phantomData.shorthand,
        weight: 3.0,
        bornFromConversationId: conversationId,
        originType: 'born',
        activationCount: 1,
        isAntiPhantom: false,
        isCoreConviction: false,
        minWeightFloor: null,
        decayRate: 0.01,
      });

      if (newPhantom) {
        console.log(
          `[PhantomEvolution] PHANTOM BORN: '${phantomData.shorthand}'`,
        );
      }

      return newPhantom;
    } catch (error) {
      console.error('[PhantomEvolution] Failed to birth phantom:', error);
      return null;
    }
  }

  /**
   * Create an anti-phantom from explicit rejection.
   *
   * When a user says "Never give me corporate speak like that again",
   * we create a negative vector that actively steers away from that territory.
   */
  async createAntiPhantom(
    userMessage: string,
    aiResponse: string,
    conversationId: string,
    createUserPhantom: (data: Partial<UserPhantom>) => Promise<UserPhantom | null>,
  ): Promise<UserPhantom | null> {
    try {
      const rawText = await this.llm.generate({
        system:
          'You analyze creative rejections to understand what should be avoided. ' +
          "Create a 'negative phantom' that steers AWAY from the rejected creative territory. " +
          'Return ONLY valid JSON, no markdown.',
        prompt: `The user rejected this creative direction:

USER SAID: ${userMessage.slice(0, 500)}
AIDEN RESPONDED: ${aiResponse.slice(0, 500)}

Return JSON:
{
    "feeling_seed": "the emotional core of what was wrong (1 sentence)",
    "phantom_story": "what was rejected and why it felt wrong (1-2 sentences)",
    "influence": "AVOID_VERB_PHRASE describing what to steer away from",
    "shorthand": "anti_concise_label (snake_case, max 40 chars)"
}`,
        maxTokens: 500,
        temperature: 0.3,
      });

      let cleaned = rawText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.split('\n', 2)[1] ?? cleaned;
        cleaned = cleaned.replace(/```\s*$/, '').trim();
      }

      const phantomData = JSON.parse(cleaned);

      for (const field of ['feeling_seed', 'phantom_story', 'influence', 'shorthand']) {
        if (!(field in phantomData)) {
          console.warn(`[PhantomEvolution] Anti-phantom missing field: ${field}`);
          return null;
        }
      }

      const antiPhantom = await createUserPhantom({
        feelingSeed: phantomData.feeling_seed,
        phantomStory: phantomData.phantom_story,
        influence: phantomData.influence,
        shorthand: phantomData.shorthand,
        weight: 3.0,
        isAntiPhantom: true,
        rejectionReason: userMessage.slice(0, 500),
        bornFromConversationId: conversationId,
        originType: 'anti',
        activationCount: 1,
        isCoreConviction: false,
        minWeightFloor: null,
        decayRate: 0.01,
      });

      if (antiPhantom) {
        console.log(
          `[PhantomEvolution] ANTI-PHANTOM CREATED: '${phantomData.shorthand}'`,
        );
      }

      return antiPhantom;
    } catch (error) {
      console.error('[PhantomEvolution] Failed to create anti-phantom:', error);
      return null;
    }
  }

  /**
   * Apply decay to phantoms not activated recently.
   *
   * Called periodically (e.g., daily cron or on login).
   * Phantoms inactive for 30+ days with weight < threshold get archived.
   * Core conviction phantoms respect min_weight_floor.
   */
  async decayInactivePhantoms(
    inactivePhantoms: UserPhantom[],
    updatePhantomWeight: (id: string, newWeight: number) => Promise<void>,
    archivePhantom: (id: string) => Promise<void>,
  ): Promise<DecaySummary> {
    const summary: DecaySummary = { decayed: [], archived: [] };

    for (const phantom of inactivePhantoms) {
      const decay = phantom.decayRate || 0.01;
      const oldWeight = phantom.weight;
      let newWeight = oldWeight - decay;

      // Sycophant guardrail: enforce floor for core convictions
      if (phantom.isCoreConviction && phantom.minWeightFloor != null) {
        newWeight = Math.max(newWeight, phantom.minWeightFloor);
      }
      newWeight = Math.max(0.0, newWeight);

      // Archive if below threshold and not a core conviction
      if (newWeight < DECAY_ARCHIVE_THRESHOLD && !phantom.isCoreConviction) {
        try {
          await archivePhantom(phantom.id);
          summary.archived.push({
            id: phantom.id,
            shorthand: phantom.shorthand,
            finalWeight: newWeight,
          });
          console.log(
            `[PhantomEvolution] PHANTOM ARCHIVED: '${phantom.shorthand}' ` +
              `(weight ${oldWeight.toFixed(2)} -> ${newWeight.toFixed(2)})`,
          );
        } catch (error) {
          console.error(`[PhantomEvolution] Failed to archive phantom ${phantom.id}:`, error);
        }
      } else {
        // Just decay the weight
        try {
          await updatePhantomWeight(phantom.id, newWeight);
          summary.decayed.push({
            id: phantom.id,
            shorthand: phantom.shorthand,
            oldWeight,
            newWeight,
          });
        } catch (error) {
          console.error(`[PhantomEvolution] Failed to decay phantom ${phantom.id}:`, error);
        }
      }
    }

    console.log(
      `[PhantomEvolution] Decay pass: ${summary.decayed.length} decayed, ` +
        `${summary.archived.length} archived`,
    );
    return summary;
  }
}
