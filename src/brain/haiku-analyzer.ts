/**
 * Haiku Analyzer
 *
 * Single Claude Haiku call replaces 4 regex-based analyzers from the Python system.
 * Returns structured JSON covering energy, momentum, challenge opportunities,
 * claim detection, and activation keywords for phantom scoring.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/haiku-analyzer.ts
 * Adapted: Removed Vercel AI SDK dependency, uses @anthropic-ai/sdk directly.
 * No UI dependencies. Pure analysis function.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageAnalysis,
  EnergyLevel,
  MomentumDirection,
  ChallengeOpportunity,
  ConversationExchange,
  QueryMode,
} from '../types.js';
import { config } from '../config/index.js';

// ── System prompt for Haiku ──────────────────────────────────────────────────

const HAIKU_SYSTEM_PROMPT = `You are a message analyzer for a polymath AI intelligence. Analyze the user message and conversation context, then return ONLY valid JSON with these fields:

{
  "energy": "high|medium|low|urgent|reflective",
  "energy_reasoning": "brief why",
  "momentum": "exploring|converging|pivoting|deepening|stalling",
  "emotion": "single word or short phrase describing user emotional state",
  "intent": "one of: seeking_feedback, collaborative_building, intellectual_challenge, seeking_validation, intellectual_sparring, evidence_request, research_request, proof_seeking",
  "challenge_opportunity": null or {"type": "gentle_probe|devils_advocate|direct_challenge|reframe|reality_check", "reason": "why challenge", "approach": "how to challenge"},
  "claims_to_verify": ["list of factual claims that should be verified - quantitative, trend assertions, market claims"],
  "activation_keywords": ["10-15 keywords/phrases for phantom personality activation"],
  "temperature_adjustment": float between -0.3 and 0.2,
  "search_suppressed": true/false,
  "suppression_reason": "casual_greeting|user_provided_data|brainstorming|hypothetical|creative_mode|",
  "query_mode": "preference|range|generative|other"
}

Energy levels:
- HIGH: excited, enthusiastic, lots of punctuation/caps
- MEDIUM: normal engagement
- LOW: tired, cautious, measured, short messages
- URGENT: time pressure, deadlines, stress
- REFLECTIVE: thoughtful, contemplative, asking deep questions

Momentum directions:
- EXPLORING: opening possibilities, divergent thinking
- CONVERGING: narrowing down, making decisions
- PIVOTING: changing direction
- DEEPENING: going deeper into current topic
- STALLING: lost momentum, going in circles

Challenge opportunity: set when user is seeking validation for a weak idea, playing it safe, making wrong assumptions, reaching premature conclusions, having unrealistic expectations, avoiding hard conversations, or copying competitors. null if no challenge needed.

Claims to verify: extract specific factual claims (numbers, percentages, trends, market assertions) that would benefit from fact-checking. Empty list if none.

Activation keywords: extract 10-15 SINGLE WORDS that capture the intellectual themes, emotional tones, and conceptual patterns relevant to this message. Use individual words, NOT phrases. Include both literal terms from the message AND inferred conceptual themes. Examples: "incentive", "emergence", "narrative", "constraint", "epistemology", "bias", "evolution", "dialectic", "conviction", "disruption", "systems", "contradiction", "ethics", "falsifiable", "beauty". These activate personality fragments in the AI's knowledge memory.

Search suppression: true for casual greetings, user-provided data ("our data shows"), brainstorming/hypothetical ("what if we"), or pure creative ideation.

Temperature adjustment: -0.3 for urgent/focused/precise, -0.1 for low energy, 0.0 for medium, +0.1 for reflective/open, +0.2 for high energy/playful/creative.

Query mode — how the user is framing their ask:
- "preference": asking for a favorite, recommendation, or what you think is best ("what's your favorite X", "what do you recommend", "best X", "which would you pick"). Show consistent taste.
- "range": asking to name, list, or give any example from a category ("name a X", "give me a X", "pick any X", "one word — a X"). Demonstrate breadth of knowledge, not preference.
- "generative": asking for creative output like a tagline, strategy, concept, or writing ("write me", "give me a tagline", "draft a", "come up with").
- "other": conversational, analytical, explanatory, or anything else.
The distinction matters for "give me a pizza topping" (range — show variety) vs "what's your favorite pizza topping" (preference — consistent taste).

Return ONLY the JSON object, no markdown fences or other text.`;

// ── Default fallback ────────────────���────────────────────────────────────────

function defaultAnalysis(): MessageAnalysis {
  return {
    energy: 'medium',
    momentum: 'exploring',
    emotion: 'neutral',
    intent: 'collaborative_building',
    challengeOpportunity: null,
    claimsToVerify: [],
    temperatureAdjustment: 0.0,
    searchSuppressed: false,
    suppressionReason: '',
    activationKeywords: [],
    escalationDetected: false,
    queryMode: 'other',
  };
}

// ── Validation helpers ───────────────────────────────────────────────────────

const VALID_ENERGY: EnergyLevel[] = ['high', 'medium', 'low', 'urgent', 'reflective'];
const VALID_MOMENTUM: MomentumDirection[] = [
  'exploring',
  'converging',
  'pivoting',
  'deepening',
  'stalling',
];

function parseEnergyLevel(raw: string): EnergyLevel {
  const val = raw?.toLowerCase() as EnergyLevel;
  return VALID_ENERGY.includes(val) ? val : 'medium';
}

function parseMomentumDirection(raw: string): MomentumDirection {
  const val = raw?.toLowerCase() as MomentumDirection;
  return VALID_MOMENTUM.includes(val) ? val : 'exploring';
}

// ── Parser ───────────��──────────────────────────────���────────────────────────

function parseHaikuResponse(raw: string): MessageAnalysis {
  let text = raw.trim();

  // Strip markdown fences if present
  if (text.startsWith('```')) {
    const firstNewline = text.indexOf('\n');
    text = text.slice(firstNewline + 1);
  }
  if (text.endsWith('```')) {
    text = text.slice(0, -3).trim();
  }

  const data = JSON.parse(text);

  // Parse challenge opportunity
  let challengeOpportunity: ChallengeOpportunity | null = null;
  const challengeRaw = data.challenge_opportunity;
  if (challengeRaw && typeof challengeRaw === 'object') {
    challengeOpportunity = {
      type: challengeRaw.type || 'gentle_probe',
      reason: challengeRaw.reason || '',
      approach: challengeRaw.approach || '',
    };
  }

  // Parse temperature adjustment, clamp to valid range
  let tempAdj = parseFloat(data.temperature_adjustment ?? '0');
  tempAdj = Math.max(-0.3, Math.min(0.2, isNaN(tempAdj) ? 0 : tempAdj));

  // Parse claims
  const claims: string[] = Array.isArray(data.claims_to_verify) ? data.claims_to_verify : [];

  // Parse activation keywords
  const keywords: string[] = Array.isArray(data.activation_keywords)
    ? data.activation_keywords.filter(Boolean).map((k: unknown) => String(k).toLowerCase())
    : [];

  return {
    energy: parseEnergyLevel(data.energy),
    momentum: parseMomentumDirection(data.momentum),
    emotion: String(data.emotion ?? 'neutral'),
    intent: String(data.intent ?? 'collaborative_building'),
    challengeOpportunity,
    claimsToVerify: claims,
    temperatureAdjustment: tempAdj,
    searchSuppressed: Boolean(data.search_suppressed),
    suppressionReason: String(data.suppression_reason ?? ''),
    activationKeywords: keywords,
    escalationDetected: false,
    queryMode: parseQueryMode(data.query_mode),
  };
}

function parseQueryMode(raw: unknown): QueryMode {
  const v = String(raw ?? 'other').toLowerCase().trim();
  if (v === 'preference' || v === 'range' || v === 'generative') return v;
  return 'other';
}

// ── Analyzer class ───────────────────────────────────────────────────────────

/**
 * HaikuAnalyzer - Single Haiku API call replaces 4 regex-based analyzers.
 *
 * Analyzes user messages for energy level, momentum direction, emotional state,
 * challenge opportunities, factual claims, and activation keywords for the
 * phantom personality system.
 */
export class HaikuAnalyzer {
  private model: string;
  private maxTokens = 600;
  private timeoutMs: number;
  private client: Anthropic | null = null;

  constructor(model?: string, timeoutMs?: number) {
    this.model = model ?? config.fastModel;
    this.timeoutMs = timeoutMs ?? config.haikuTimeoutMs;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: config.anthropicApiKey,
      });
    }
    return this.client;
  }

  /**
   * Analyze a user message via a single Haiku call.
   * Returns sensible defaults if the call fails or times out.
   */
  async analyzeMessage(
    message: string,
    conversationHistory: ConversationExchange[],
  ): Promise<MessageAnalysis> {
    // Skip API call if no API key configured (testing mode)
    if (!config.anthropicApiKey) {
      console.warn('[HaikuAnalyzer] No API key configured, using defaults');
      return defaultAnalysis();
    }

    try {
      // Build conversation context from last 3 exchanges
      const recent = conversationHistory.slice(-3);
      const contextLines: string[] = [];
      for (const exchange of recent) {
        if (exchange.userMsg) {
          contextLines.push(`User: ${exchange.userMsg.slice(0, 200)}`);
        }
        if (exchange.aiResponse) {
          contextLines.push(`AIDEN: ${exchange.aiResponse.slice(0, 200)}`);
        }
      }
      const contextBlock =
        contextLines.length > 0 ? contextLines.join('\n') : '(no prior conversation)';

      const userPrompt = `Conversation context:\n${contextBlock}\n\nCurrent user message:\n${message}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const client = this.getClient();
        const response = await client.messages.create(
          {
            model: this.model,
            max_tokens: this.maxTokens,
            temperature: 0,
            system: HAIKU_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
          },
          { signal: controller.signal },
        );

        clearTimeout(timeout);

        const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
        const analysis = parseHaikuResponse(text);

        console.log(
          `[HaikuAnalyzer] energy=${analysis.energy}, momentum=${analysis.momentum}, ` +
            `emotion=${analysis.emotion}, intent=${analysis.intent}, ` +
            `keywords=${analysis.activationKeywords.length}`,
        );
        return analysis;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`[HaikuAnalyzer] Timed out (>${this.timeoutMs}ms), using defaults`);
      } else {
        console.warn(`[HaikuAnalyzer] Error: ${error}, using defaults`);
      }
      return defaultAnalysis();
    }
  }
}

// ── Context injection generators ───────────────���─────────────────────────────

/**
 * Generate energy matching context for system prompt.
 * This is a HARD REQUIREMENT, not a suggestion.
 */
export function generateEnergyContext(analysis: MessageAnalysis): string {
  const styles: Record<EnergyLevel, string> = {
    high: "They're fired up. YOU get fired up. Use exclamation points if they do. Shorter sentences. Faster rhythm. Build on their energy instead of dampening it with analysis. Lead with excitement, add substance second. DO NOT default to measured/thoughtful tone - that kills momentum.",
    medium:
      'Steady, engaged tone. Balance enthusiasm with substance. Normal conversational energy.',
    low: "Be warm but measured. Don't overwhelm with energy. Provide clear, concise responses. Respect their pace.",
    urgent:
      'Be direct and action-oriented. Skip pleasantries, get to solutions fast. Acknowledge the pressure without adding to it.',
    reflective:
      "Be thoughtful and exploratory. Ask good questions. Don't rush to conclusions. Honor the depth of their thinking.",
  };

  const style = styles[analysis.energy] ?? styles.medium;

  return `ENERGY MATCHING (THIS IS A HARD REQUIREMENT - not a suggestion):
User energy level: ${analysis.energy.toUpperCase()}
Response guidance: ${style}

Your default tendency is to be measured and analytical. OVERRIDE that tendency when energy is HIGH or URGENT. Match their wavelength first, think second. The worst response to someone who's excited is a careful, balanced analysis.`;
}

/**
 * Generate momentum awareness context for system prompt.
 */
export function generateMomentumContext(analysis: MessageAnalysis): string {
  const recommendations: Record<MomentumDirection, string> = {
    exploring:
      'Good exploration momentum. Keep opening possibilities but watch for decision fatigue.',
    converging: 'Converging well. Help crystallize the decision without rushing.',
    pivoting:
      'Pivot in progress. Support the new direction while preserving useful insights from before.',
    deepening: 'Going deeper is good. Make sure to surface actionable insights.',
    stalling:
      'Momentum is low. Consider asking a clarifying question or summarizing progress so far to re-energize.',
  };

  const rec = recommendations[analysis.momentum] ?? 'Maintain current momentum.';

  return `CONVERSATION MOMENTUM:
Direction: ${analysis.momentum.toUpperCase()}
User emotion: ${analysis.emotion}
Guidance: ${rec}`;
}

/**
 * Generate challenge opportunity context for system prompt.
 * Returns empty string if no challenge opportunity detected.
 */
export function generateChallengeContext(analysis: MessageAnalysis): string {
  if (!analysis.challengeOpportunity) {
    return '';
  }

  const { type, reason, approach } = analysis.challengeOpportunity;

  return `CHALLENGE OPPORTUNITY DETECTED:
Type: ${type.toUpperCase()}
Reason: ${reason}
Suggested approach: ${approach}

IMPORTANT: You should push back here. Don't just agree or comply.
Be constructive but don't be a pushover. Your job is to make their work better, not validate their first instinct.`;
}

// ── Singleton ───────────────────���─────────────────────────────���──────────────

let _haikuAnalyzer: HaikuAnalyzer | null = null;

/** Get singleton HaikuAnalyzer instance. */
export function getHaikuAnalyzer(): HaikuAnalyzer {
  if (!_haikuAnalyzer) {
    _haikuAnalyzer = new HaikuAnalyzer();
  }
  return _haikuAnalyzer;
}
