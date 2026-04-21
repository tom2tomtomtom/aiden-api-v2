/**
 * AIDEN Brain API v2 - Core Types
 *
 * All type definitions for the phantom personality system,
 * brain orchestration, and API interfaces.
 */

// ── Energy & Momentum ──────────────────────────────────────────────────────

export type EnergyLevel = 'high' | 'medium' | 'low' | 'urgent' | 'reflective';
export type MomentumDirection = 'exploring' | 'converging' | 'pivoting' | 'deepening' | 'stalling';

// ── Message Analysis (Haiku output) ────────────────────────────────────────

export interface ChallengeOpportunity {
  type: 'gentle_probe' | 'devils_advocate' | 'direct_challenge' | 'reframe' | 'reality_check';
  reason: string;
  approach: string;
}

export interface MessageAnalysis {
  energy: EnergyLevel;
  momentum: MomentumDirection;
  emotion: string;
  intent: string;
  challengeOpportunity: ChallengeOpportunity | null;
  claimsToVerify: string[];
  temperatureAdjustment: number;
  searchSuppressed: boolean;
  suppressionReason: string;
  activationKeywords: string[];
  escalationDetected: boolean;
}

// ── Phantom Types ──────────────────────────────────────────────────────────

export interface PhantomLike {
  shorthand: string;
  feelingSeed: string;
  phantomStory: string;
  influence: string;
  weight: number;
}

export interface Phantom extends PhantomLike {
  id?: string;
  category?: 'intellectual' | 'emotional' | 'creative' | 'strategic';
  wordTriggers?: string[];
  identityText?: string;
  isActive?: boolean;
  createdAt?: string;
  intentTriggers?: string[];
  emotionalContexts?: string[];
  conversationContexts?: string[];
  originContext?: string;
}

export interface AgencyPhantom extends PhantomLike {
  id: string;
  agencyId: string;
  originContext?: string;
  wordTriggers?: string[];
  identityText?: string;
  sourceType?: string;
  sourceId?: string;
  bornFromMemberId?: string;
  qualityScore?: number;
  sourcePerson?: string;
  sourceQuestion?: string;
  status?: 'approved' | 'pending' | 'rejected';
  activationCount?: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhantomPackItem extends PhantomLike {
  id: string;
  packId: string;
  originContext?: string;
  wordTriggers?: string[];
  identityText?: string;
}

export interface UserPhantomProxy extends PhantomLike {
  originContext: string;
  activationCount: number;
  identityText: string;
  userPhantomId: string;
  isAntiPhantom: boolean;
}

// ── Phantom Activation ─────────────────────────────────────────────────────

export interface PhantomActivationScored {
  key: string;
  phantom: PhantomLike;
  score: number;
  source: 'base' | 'agency' | 'pack' | 'user';
}

export interface PhantomActivationInline {
  phantomId: string;
  phantomType: 'base' | 'agency' | 'pack';
  shorthand: string;
  activationScore: number;
  influence: string;
}

// ── Phantom Collision ──────────────────────────────────────────────────────

export interface OpposingPair {
  sideAKeywords: string[];
  sideBKeywords: string[];
  tensionDescription: string;
}

export interface PhantomCollision {
  phantomA: string;
  phantomB: string;
  tensionDescription: string;
  injectionPrompt: string;
  scoreA: number;
  scoreB: number;
}

// ── Conversation ───────────────────────────────────────────────────────────

export interface ConversationExchange {
  userMsg: string;
  aiResponse: string;
}

export interface ConversationDynamicsLegacy {
  defenseMult: number;
  ideationMult: number;
  boldMult: number;
  numExchanges: number;
}

// ── Response Mode ──────────────────────────────────────────────────────────

export type ResponseMode = 'spark' | 'deep' | 'build' | 'sell' | 'copy' | 'default';

// ── Phantom Preferences ────────────────────────────────────────────────────

export interface PhantomPreferences {
  boost: Array<{ phantomShorthand: string; multiplier: number }>;
  suppress: Array<{ phantomShorthand: string; multiplier: number }>;
}

// ── Thinking Mode ──────────────────────────────────────────────────────────

export interface ThinkingModeProfile {
  mode: string;
  label: string;
  description: string;
}

// ── Brain Config ───────────────────────────────────────────────────────────

export interface NuclearBrainConfig {
  maxPhantoms: number;
  enableCollisionDetection: boolean;
  enableAutonomousBirth: boolean;
  enableConceptTracking: boolean;
  ragEnabled: boolean;
}

// ── Brain Response ─────────────────────────────────────────────────────────

export interface BrainResponse {
  text: string;
  metadata: BrainMetadata;
}

export interface BrainMetadata {
  analysis: MessageAnalysis;
  activatedPhantoms: PhantomActivationScored[];
  collisions: PhantomCollision[];
  thinkingMode: ThinkingModeProfile;
  conversationDynamics: ConversationDynamicsLegacy;
  maturity: string;
  isKill: boolean;
  isEscalation: boolean;
  isSensitive: boolean;
  personalityMode: string;
}

// ── Personality Mode ───────────────────────────────────────────────────────

export type PersonalityMode = 'collaborator' | 'challenger' | 'collaborative';

// ── External Dependencies (Dependency Injection) ───────────────────────────

/**
 * RAG retrieval function signature.
 * Injected at runtime to allow testing without a database.
 */
export type RAGRetriever = (query: string, topK?: number) => Promise<string[]>;

/**
 * Conversation history loader.
 */
export type HistoryLoader = (
  conversationId: string,
  limit?: number,
) => Promise<ConversationExchange[]>;

/**
 * Message persistence function.
 */
export type MessageSaver = (
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

/**
 * Phantom activation recorder.
 */
export type ActivationRecorder = (
  conversationId: string,
  activations: PhantomActivationScored[],
) => Promise<void>;

/**
 * Phantom pool provider. Returns all phantom pools for a given tenant/agency.
 */
export interface PhantomPoolProvider {
  loadPool(agencyId: string): Promise<{
    basePhantoms: Map<string, Phantom>;
    agencyPhantoms: AgencyPhantom[];
    packPhantoms: PhantomPackItem[];
  }>;
}

/**
 * Semantic search provider for RAG.
 */
export interface SemanticSearchProvider {
  search(options: {
    agencyId: string;
    workspaceId?: string;
    query: string;
    matchThreshold?: number;
    matchCount?: number;
    sources?: string[];
  }): Promise<Array<{ id: string; content: string; similarity: number; metadata?: Record<string, unknown> }>>;
}
