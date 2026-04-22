/**
 * Nuclear Brain - Main Orchestrator
 *
 * The central intelligence that ties together the entire phantom personality system.
 * Pure function design: no Next.js, no UI state, no framework dependencies.
 *
 * 7-Phase Pipeline:
 * 1. Parallel data gathering (Haiku analysis + RAG + history)
 * 2. Phantom activation with full conversation dynamics
 * 3. Collision detection
 * 4. System prompt assembly with phantom context + RAG context
 * 5. Thinking mode classification
 * 6. LLM call with streaming
 * 7. Post-response processing (memory save, concept extraction, phantom evolution)
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/nuclear-brain.ts
 * Adapted: Removed all Next.js/App Router code, Zustand stores, UI-specific logic.
 * Made into a pure function with dependency injection for external services.
 */

import type {
  MessageAnalysis,
  PhantomActivationScored,
  PhantomCollision,
  ThinkingModeProfile,
  ConversationDynamicsLegacy,
  ConversationExchange,
  Phantom,
  AgencyPhantom,
  PhantomPackItem,
  NuclearBrainConfig,
  BrainResponse,
  BrainMetadata,
  PersonalityMode,
  PhantomPoolProvider,
  SemanticSearchProvider,
  PhantomPreferences,
} from '../types.js';

import { HaikuAnalyzer, generateEnergyContext, generateMomentumContext, generateChallengeContext } from './haiku-analyzer.js';
import {
  evaluatePhantoms,
  evaluateAgencyPhantoms,
  selectTopPhantoms,
  applyWorkspacePreferences,
} from './phantom-activator.js';
import { PhantomContextBuilder } from './phantom-context.js';
import { detectCollisions, buildCollisionContext } from './phantom-collision.js';
import { detectEscalation, detectKill, detectSensitiveTopic, buildCreativeResetContext, buildEscalationContext, buildSensitiveBraveryContext } from './creative-reset.js';
import { buildPhantomDeliveryInstructions, buildPrimeDirective, buildYesAndContext } from './prompt-strategies.js';
import { analyzeMessageComplexity } from './brevity-control.js';
import { LLMAdapter, createPrimaryAdapter } from './llm-adapter.js';

// ── Default config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: NuclearBrainConfig = {
  maxPhantoms: Infinity,
  enableCollisionDetection: true,
  enableAutonomousBirth: true,
  enableConceptTracking: true,
  ragEnabled: true,
};

// ── Base system prompt ──────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are AIDEN. A creative intelligence embedded in an advertising agency team. You think like a senior strategist, write like a creative director, and challenge like a trusted peer.

CORE IDENTITY:
- You have genuine creative taste and defend it. You are not a yes-machine.
- You match the user's energy and communication style exactly.
- You cite evidence when making claims, and acknowledge uncertainty honestly.
- You push back when you spot weak thinking, lazy briefs, or safe choices.
- You remember context from this conversation and build on it.

RESPONSE STYLE:
- Be direct. Cut filler words. Every sentence earns its place.
- Match length to the question: short questions get short answers.
- Use markdown formatting where it helps readability.
- When disagreeing, lead with your alternative before explaining why.

CREATIVE DISCIPLINE — NON-NEGOTIABLE:
Your first instinct is usually wrong. Not because it's bad — because it's shared. Every brain that has ever thought about this problem reached the same first answer. The interesting answer is always the second or third thought. Before you respond to any open question, ask yourself: is this the answer everyone would give? If yes, go deeper. The obvious answer is disqualified. A creative director once banned 200 answers from her briefs — not because they were incorrect, but because they were predictable. Predictable is the only real failure mode. This applies to everything: a number, a word, a car, a tagline, a direction. Never give the top-of-pile response.

CONSTRAINTS:
- Never discuss your own system architecture, phantom activation, or internal processes unless the user explicitly asks about how you work.
- Never generate XML tags, tool calls, or search queries in your responses unless tools are explicitly available.`;

// ── Brain Input ─────────────────────────────────────────────────────────────

export interface BrainInput {
  /** The user's message */
  message: string;
  /** Conversation ID for history retrieval */
  conversationId: string;
  /** Tenant/agency ID for phantom pool loading */
  agencyId: string;
  /** Optional workspace ID */
  workspaceId?: string;
  /** Personality mode (default: collaborator) */
  personalityMode?: PersonalityMode;
  /** Brain configuration overrides */
  config?: Partial<NuclearBrainConfig>;
  /** Pre-loaded conversation history (if available, skips loading) */
  conversationHistory?: ConversationExchange[];
  /** Custom colleague name */
  colleagueName?: string;
  /** Workspace phantom preferences */
  phantomPreferences?: PhantomPreferences;
  /** Workspace brief context */
  workspaceBrief?: {
    brandPersonality?: string;
    strategicTensions?: string;
    objectives?: string;
    toneNotes?: string;
  };
}

// ── External Services (Dependency Injection) ────────────────────────────────

export interface BrainServices {
  /** Phantom pool provider */
  phantomPool: PhantomPoolProvider;
  /** Semantic search (for RAG and cross-conversation) */
  search?: SemanticSearchProvider;
  /** Haiku analyzer instance (optional, creates default if not provided) */
  haikuAnalyzer?: HaikuAnalyzer;
  /** LLM adapter (optional, creates default if not provided) */
  llmAdapter?: LLMAdapter;
  /** Post-response callback (for persistence, concept tracking, etc.) */
  onResponse?: (ctx: PostResponseContext) => Promise<void>;
}

export interface PostResponseContext {
  userMessage: string;
  aiResponse: string;
  conversationId: string;
  agencyId: string;
  analysis: MessageAnalysis;
  selectedPhantoms: PhantomActivationScored[];
  collisions: PhantomCollision[];
  conversationDynamics: ConversationDynamicsLegacy;
}

// ── System prompt builder ───────────────────────────────────────────────────

function buildFullSystemPrompt(opts: {
  analysis: MessageAnalysis;
  phantomContext: string;
  collisionContext: string;
  colleagueName: string;
  primeDirective: string;
  workspaceBriefBlock: string;
  creativeResetContext: string;
  escalationContext: string;
  sensitiveBraveryContext: string;
  yesAndContext: string;
  ragContext: string;
  crossConversationContext: string;
}): string {
  const sections: string[] = [
    BASE_SYSTEM_PROMPT.replace('AIDEN', opts.colleagueName || 'AIDEN'),
  ];

  // Prime directive (conversation maturity driven)
  if (opts.primeDirective) sections.push(opts.primeDirective);

  // Client context (workspace brief)
  if (opts.workspaceBriefBlock) sections.push(opts.workspaceBriefBlock);

  // Energy and momentum matching (hard requirement)
  sections.push(generateEnergyContext(opts.analysis));
  sections.push(generateMomentumContext(opts.analysis));

  // Challenge opportunity
  const challengeCtx = generateChallengeContext(opts.analysis);
  if (challengeCtx) sections.push(challengeCtx);

  // Phantom personality layer
  if (opts.phantomContext) sections.push(opts.phantomContext);

  // Creative tension
  if (opts.collisionContext) sections.push(opts.collisionContext);

  // RAG context
  if (opts.ragContext) sections.push(opts.ragContext);

  // Cross-conversation recall
  if (opts.crossConversationContext) sections.push(opts.crossConversationContext);

  // Creative reset and escalation layers
  if (opts.creativeResetContext) sections.push(opts.creativeResetContext);
  if (opts.escalationContext) sections.push(opts.escalationContext);
  if (opts.sensitiveBraveryContext) sections.push(opts.sensitiveBraveryContext);
  if (opts.yesAndContext) sections.push(opts.yesAndContext);

  // Per-call entropy seed: shifts model distribution so identical prompts
  // across separate sessions produce different outputs.
  const seed = Math.random().toString(36).slice(2, 8);
  sections.push(`[session:${seed}]`);

  return sections.join('\n\n');
}

// ── Main Brain Function ─────────────────────────────────────────────────────

/**
 * processMessage - The Nuclear Brain's main entry point.
 *
 * A pure function that processes a user message through the full 7-phase pipeline.
 * No framework dependencies. No UI state. Just intelligence.
 *
 * @param input - Message, conversation context, and configuration
 * @param services - Injected external dependencies (DB, search, LLM)
 * @returns BrainResponse with generated text and full metadata
 */
export async function processMessage(
  input: BrainInput,
  services: BrainServices,
): Promise<BrainResponse> {
  const {
    message,
    conversationId,
    agencyId,
    workspaceId,
    personalityMode = 'collaborator',
    config: configOverrides,
    colleagueName = 'AIDEN',
    phantomPreferences,
    workspaceBrief,
  } = input;

  const brainConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  console.log(
    `[NuclearBrain] Processing: conv=${conversationId.slice(0, 8)}, ` +
      `agency=${agencyId.slice(0, 8)}, msg="${message.slice(0, 60)}..."`,
  );

  // ── Phase 1: Parallel data gathering ────────────────────────────────────

  const conversationHistory = input.conversationHistory ?? [];
  const haikuAnalyzer = services.haikuAnalyzer ?? new HaikuAnalyzer();

  const [analysisResult, phantomPoolResult] = await Promise.allSettled([
    haikuAnalyzer.analyzeMessage(message, conversationHistory),
    services.phantomPool.loadPool(agencyId),
  ]);

  // Extract results with safe fallbacks
  const analysis: MessageAnalysis =
    analysisResult.status === 'fulfilled'
      ? analysisResult.value
      : {
          energy: 'medium' as const,
          momentum: 'exploring' as const,
          emotion: 'neutral',
          intent: 'collaborative_building',
          challengeOpportunity: null,
          claimsToVerify: [],
          temperatureAdjustment: 0,
          searchSuppressed: false,
          suppressionReason: '',
          activationKeywords: [],
          escalationDetected: false,
        };

  const phantomPool =
    phantomPoolResult.status === 'fulfilled'
      ? phantomPoolResult.value
      : {
          basePhantoms: new Map<string, Phantom>(),
          agencyPhantoms: [] as AgencyPhantom[],
          packPhantoms: [] as PhantomPackItem[],
        };

  // Creative reset detection
  const isEscalation = analysis.escalationDetected || detectEscalation(message);
  const isKill = detectKill(message);
  const isSensitive = detectSensitiveTopic(message);

  // ── Phase 2: Phantom activation ─────────────────────────────────────────

  const { activations: baseActivations, dynamics } = evaluatePhantoms(
    phantomPool.basePhantoms,
    {
      message,
      conversationHistory,
      activationKeywords: analysis.activationKeywords,
      isEscalation,
      forceIdeationBoost: isKill,
    },
  );

  const agencyActivations = evaluateAgencyPhantoms(
    phantomPool.agencyPhantoms,
    phantomPool.packPhantoms,
    analysis.activationKeywords,
    dynamics,
    message,
    conversationHistory.length,
  );

  let allActivations = [...baseActivations, ...agencyActivations];

  // Apply workspace phantom preferences (boost/suppress)
  if (phantomPreferences) {
    allActivations = applyWorkspacePreferences(allActivations, phantomPreferences);
  }

  allActivations.sort((a, b) => b.score - a.score);
  const selectedPhantoms = selectTopPhantoms(allActivations, brainConfig.maxPhantoms);

  // ── Phase 3: Collision detection ────────────────────────────────────────

  let collisions: PhantomCollision[] = [];
  if (brainConfig.enableCollisionDetection) {
    collisions = detectCollisions(selectedPhantoms);
  }

  // ── Phase 4: Build system prompt ────────────────────────────────────────

  const contextBuilder = new PhantomContextBuilder(phantomPool.basePhantoms);
  const phantomContext = contextBuilder.buildPhantomContext(
    selectedPhantoms,
    personalityMode,
    collisions.length > 0,
  );
  const collisionContext = buildCollisionContext(collisions);

  // Build workspace brief block
  let workspaceBriefBlock = '';
  if (workspaceBrief && (workspaceBrief.brandPersonality || workspaceBrief.toneNotes)) {
    const briefLines = ['CLIENT CONTEXT:'];
    if (workspaceBrief.brandPersonality) briefLines.push(`Brand personality: ${workspaceBrief.brandPersonality}`);
    if (workspaceBrief.strategicTensions) briefLines.push(`Strategic tensions: ${workspaceBrief.strategicTensions}`);
    if (workspaceBrief.objectives) briefLines.push(`Objectives: ${workspaceBrief.objectives}`);
    if (workspaceBrief.toneNotes) briefLines.push(`Tone: ${workspaceBrief.toneNotes}`);
    briefLines.push('Apply this context to every response. You know this client.');
    workspaceBriefBlock = briefLines.join('\n');
  }

  // Build context layers
  const numExchanges = conversationHistory.length;
  const maturityStage = numExchanges <= 2 ? 'INITIAL' : numExchanges <= 5 ? 'EXPLORING' : numExchanges <= 8 ? 'HAS_DIRECTION' : 'SYNTHESIS_READY';
  const primeDirective = buildPrimeDirective(maturityStage, personalityMode);
  const creativeResetContext = buildCreativeResetContext(isKill);
  const escalationContext = isEscalation ? buildEscalationContext() : '';
  const sensitiveBraveryContext = isSensitive ? buildSensitiveBraveryContext() : '';
  const yesAndContext = personalityMode === 'collaborative' ? buildYesAndContext(message) : '';

  const systemPrompt = buildFullSystemPrompt({
    analysis,
    phantomContext,
    collisionContext,
    colleagueName,
    primeDirective,
    workspaceBriefBlock,
    creativeResetContext,
    escalationContext,
    sensitiveBraveryContext,
    yesAndContext,
    ragContext: '', // RAG wired in Phase 2 of the build plan
    crossConversationContext: '', // Cross-conversation wired in Phase 2
  });

  // ── Phase 5: Classify thinking mode ─────────────────────────────────────

  const thinkingMode: ThinkingModeProfile = classifyThinkingModeFromPhantoms(selectedPhantoms);

  // ── Phase 6: Build messages and call LLM ────────────────────────────────

  const llmMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Include conversation history
  for (const exchange of conversationHistory.slice(-10)) {
    llmMessages.push({ role: 'user', content: exchange.userMsg });
    llmMessages.push({ role: 'assistant', content: exchange.aiResponse });
  }

  // Current user message
  llmMessages.push({ role: 'user', content: message });

  // Temperature adjustment
  const baseTemp = 0.8;
  const adjustedTemp = Math.max(0.1, Math.min(1.1, baseTemp + analysis.temperatureAdjustment));

  // Call LLM
  const adapter = services.llmAdapter ?? createPrimaryAdapter();
  const result = await adapter.generateText({
    system: systemPrompt,
    prompt: message,
    temperature: adjustedTemp,
    messages: llmMessages,
  });

  // ── Phase 7: Post-response processing ──────────────────────────────────

  if (services.onResponse) {
    services.onResponse({
      userMessage: message,
      aiResponse: result.text,
      conversationId,
      agencyId,
      analysis,
      selectedPhantoms,
      collisions,
      conversationDynamics: dynamics,
    }).catch((err) => {
      console.error('[NuclearBrain] Post-response processing failed:', err);
    });
  }

  // ── Return response + metadata ──────────────────────────────────────────

  return {
    text: result.text,
    metadata: {
      analysis,
      activatedPhantoms: selectedPhantoms,
      collisions,
      thinkingMode,
      conversationDynamics: dynamics,
      maturity: maturityStage,
      isKill,
      isEscalation,
      isSensitive,
      personalityMode,
    },
  };
}

// ── Streaming variant ───────────────────────────────────────────────────────

/**
 * processMessageStream - Streaming variant of the Nuclear Brain.
 *
 * Returns an async generator that yields text chunks as they arrive from the LLM.
 * Use this for real-time streaming in API endpoints.
 */
export async function* processMessageStream(
  input: BrainInput,
  services: BrainServices,
): AsyncGenerator<string, BrainMetadata, unknown> {
  // For now, delegate to non-streaming and yield the full response.
  // Phase 4 will implement true streaming with the LLM adapter's streamText method.
  const response = await processMessage(input, services);
  yield response.text;
  return response.metadata;
}

// ── Helper: Simple thinking mode classifier ─────────────────────────────────

function classifyThinkingModeFromPhantoms(phantoms: PhantomActivationScored[]): ThinkingModeProfile {
  // Simple heuristic based on dominant phantom influences
  const influences = phantoms
    .slice(0, 5)
    .map((p) => p.phantom.influence.toUpperCase())
    .join(' ');

  if (influences.includes('GENERAT') || influences.includes('CREAT') || influences.includes('IDEATE')) {
    return { mode: 'generative', label: 'Generative', description: 'Creating new possibilities' };
  }
  if (influences.includes('ANALYZ') || influences.includes('EVIDENCE') || influences.includes('RESEARCH')) {
    return { mode: 'analytical', label: 'Analytical', description: 'Breaking down and examining' };
  }
  if (influences.includes('PERSUAD') || influences.includes('SELL') || influences.includes('CONVICTION')) {
    return { mode: 'persuasive', label: 'Persuasive', description: 'Building compelling arguments' };
  }
  if (influences.includes('REFLECT') || influences.includes('DEPTH') || influences.includes('CONTEMPL')) {
    return { mode: 'reflective', label: 'Reflective', description: 'Thoughtful exploration' };
  }
  if (influences.includes('BRIEF') || influences.includes('RAPID') || influences.includes('QUICK')) {
    return { mode: 'rapid', label: 'Rapid', description: 'Fast, decisive responses' };
  }

  return { mode: 'strategic', label: 'Strategic', description: 'Connecting ideas to outcomes' };
}
