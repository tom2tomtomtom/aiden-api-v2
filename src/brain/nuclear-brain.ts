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
  perturbPhantomWeights,
} from './phantom-activator.js';
import { PhantomContextBuilder } from './phantom-context.js';
import { detectCollisions, buildCollisionContext } from './phantom-collision.js';
import { detectEscalation, detectKill, detectSensitiveTopic, buildCreativeResetContext, buildEscalationContext, buildSensitiveBraveryContext } from './creative-reset.js';
import { buildPhantomDeliveryInstructions, buildPrimeDirective, buildYesAndContext } from './prompt-strategies.js';
import { getRangeMemoryStore, extractCategoryKeywords } from './range-memory.js';
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
  /**
   * Entropy level for phantom weight perturbation.
   * 0.0 = deterministic (compliance/repeatable), 0.5 = default creative variance,
   * 1.0 = maximum exploration. Defaults to 0.5.
   */
  entropy?: number;
  /** Entropy seed to replay a specific phantom cluster. Auto-generated if omitted. */
  entropySeed?: number;
  /** Recent range-mode answers for this tenant — injected as exclusion list for range queries. */
  recentRangeAnswers?: string[];
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

function buildQueryModeContext(
  mode: 'preference' | 'range' | 'generative' | 'other',
  recentRangeAnswers: string[] = [],
): string {
  if (mode === 'preference') {
    return `QUERY MODE: PREFERENCE
The user is asking for your favorite, your recommendation, or what you think is best. Answer with conviction. Defend your preference. You have taste — use it. Consistency across sessions is correct here; a creative director with a favorite pizza topping gives the same answer every time because they've earned that preference.`;
  }
  if (mode === 'range') {
    const base = `QUERY MODE: RANGE
The user is asking you to name, list, or give any example from a category — NOT for your preference. Demonstrate breadth of knowledge, not taste. A senior creative asked to "name a pizza topping" rattles off different answers across conversations to show they know the category.`;
    if (recentRangeAnswers.length > 0) {
      const list = recentRangeAnswers.map((a) => `"${a}"`).join(', ');
      return `${base}

RECENTLY USED for similar range queries — DO NOT REPEAT these:
${list}

Pick something genuinely different from the category. Range-display, not preference.`;
    }
    return `${base}

Pull from the full range of the category, not the same go-to answer. Range-display, not preference.`;
  }
  if (mode === 'generative') {
    return `QUERY MODE: GENERATIVE
The user wants creative output — a tagline, concept, piece of writing, or strategic angle. Bring the full depth of your phantom personality. This is where your conviction and range combine into actual creative work. Push past obvious answers.`;
  }
  return '';
}

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
  recentRangeAnswers?: string[];
}): string {
  const sections: string[] = [
    BASE_SYSTEM_PROMPT.replace('AIDEN', opts.colleagueName || 'AIDEN'),
  ];

  // Query mode shapes whether AIDEN holds taste or demonstrates range
  const queryModeBlock = buildQueryModeContext(opts.analysis.queryMode, opts.recentRangeAnswers ?? []);
  if (queryModeBlock) sections.push(queryModeBlock);

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
          queryMode: 'other' as const,
        };

  const phantomPool =
    phantomPoolResult.status === 'fulfilled'
      ? phantomPoolResult.value
      : {
          basePhantoms: new Map<string, Phantom>(),
          agencyPhantoms: [] as AgencyPhantom[],
          packPhantoms: [] as PhantomPackItem[],
        };

  // Range memory: for range queries, look up recent answers for this tenant
  // matching the category keywords, so the brain can avoid repeating them
  // across sessions (demonstrate breadth, not pick the same "interesting" default).
  let recentRangeAnswers: string[] = input.recentRangeAnswers ?? [];
  let rangeCategoryKeywords: string[] = [];
  if (!input.recentRangeAnswers && analysis.queryMode === 'range') {
    rangeCategoryKeywords = extractCategoryKeywords(message);
    try {
      recentRangeAnswers = await getRangeMemoryStore().getRecentAnswers(agencyId, rangeCategoryKeywords, 10);
    } catch (e) {
      console.error('[NuclearBrain] range memory lookup failed:', e);
      recentRangeAnswers = [];
    }
  }

  // Creative reset detection
  const isEscalation = analysis.escalationDetected || detectEscalation(message);
  const isKill = detectKill(message);
  const isSensitive = detectSensitiveTopic(message);

  // ── Phase 2: Phantom activation ─────────────────────────────────────────

  // Session entropy: perturb base weights before scoring so different sessions
  // activate different creative clusters from the same brief.
  const entropy = Math.max(0, Math.min(1, input.entropy ?? 0.5));
  const entropySeed = input.entropySeed ?? (Math.random() * 0xFFFFFFFF | 0);

  // basePhantoms is a Map — perturb values and rebuild
  const perturbedBaseArr = perturbPhantomWeights([...phantomPool.basePhantoms.values()], entropySeed, entropy);
  const perturbedBase = new Map(perturbedBaseArr.map((p) => [p.shorthand, p])) as Map<string, typeof perturbedBaseArr[0]>;
  const perturbedAgency = perturbPhantomWeights(phantomPool.agencyPhantoms ?? [], entropySeed, entropy);
  const perturbedPack = perturbPhantomWeights(phantomPool.packPhantoms ?? [], entropySeed, entropy);

  const { activations: baseActivations, dynamics } = evaluatePhantoms(
    perturbedBase,
    {
      message,
      conversationHistory,
      activationKeywords: analysis.activationKeywords,
      isEscalation,
      forceIdeationBoost: isKill,
    },
  );

  const agencyActivations = evaluateAgencyPhantoms(
    perturbedAgency,
    perturbedPack,
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
    recentRangeAnswers,
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

  // Diagnostic logging (remove after diagnosis)
  if (process.env.BRAIN_DEBUG === '1') {
    console.log('\n══════════════════════════════════════');
    console.log(`[BRAIN_DEBUG] Message: "${message}"`);
    console.log(`[BRAIN_DEBUG] EntropySeed: ${entropySeed} | Entropy: ${entropy}`);
    console.log(`[BRAIN_DEBUG] Temperature: ${adjustedTemp}`);
    console.log(`[BRAIN_DEBUG] Thinking mode: ${thinkingMode.mode}`);
    console.log(`[BRAIN_DEBUG] Top phantoms fired:`);
    selectedPhantoms.slice(0, 10).forEach(({ phantom, score }) => {
      console.log(`  • ${phantom.shorthand} (score: ${score.toFixed(2)}) — ${phantom.influence}`);
    });
    console.log(`[BRAIN_DEBUG] Conversation history: ${conversationHistory.length} exchanges`);
    console.log(`[BRAIN_DEBUG] System prompt length: ${systemPrompt.length} chars`);
    console.log('══════════════════════════════════════\n');
  }

  // Call LLM
  const adapter = services.llmAdapter ?? createPrimaryAdapter();
  const result = await adapter.generateText({
    system: systemPrompt,
    prompt: message,
    temperature: adjustedTemp,
    messages: llmMessages,
  });

  // ── Phase 7: Post-response processing ──────────────────────────────────

  // Persist range answer for cross-session memory (only when queryMode === 'range')
  if (analysis.queryMode === 'range' && rangeCategoryKeywords.length > 0 && result.text) {
    const cleanAnswer = result.text.trim().slice(0, 500);
    if (cleanAnswer.length > 0 && cleanAnswer.length < 300) {
      getRangeMemoryStore().save(agencyId, message, cleanAnswer, rangeCategoryKeywords).catch((e) => {
        console.error('[NuclearBrain] range memory save failed:', e);
      });
    }
  }

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
      entropySeed,
      entropy,
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
