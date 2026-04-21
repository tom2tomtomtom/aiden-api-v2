/**
 * AIDEN Brain SDK - TypeScript models
 */

export interface PhantomFired {
  shorthand: string;
  score: number;
  source: 'base' | 'agency' | 'pack' | 'user';
}

export interface Collision {
  phantomA: string;
  phantomB: string;
  tension: string;
}

export interface ThinkingMode {
  mode: string;
  label: string;
  description: string;
}

export interface ChatResponse {
  content: string;
  conversationId: string;
  phantomsFired: PhantomFired[];
  collisions: Collision[];
  thinkingMode: ThinkingMode;
  maturityStage: string;
}

export interface ChatOptions {
  conversationId?: string;
  personalityMode?: 'collaborator' | 'challenger' | 'collaborative';
  model?: string;
  stream?: boolean;
}

export interface GenerationResult {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
}

export interface WorkflowState {
  workflowId: string;
  currentStep: string;
  stepsCompleted: string[];
  stepsRemaining: string[];
  outputs: Record<string, unknown>;
}

export interface UsageReport {
  totalRequests: number;
  totalTokens: number;
  periodStart: string;
  periodEnd: string;
  breakdown: Record<string, number>;
}

export interface FeedbackResponse {
  feedbackType: string;
  weightChanges: number;
  flaggedForReview: string[];
}

export type FeedbackType = 'positive' | 'negative' | 'used' | 'regenerated' | 'edited';

export interface PhantomInfo {
  shorthand: string;
  feelingSeed: string;
  influence: string;
  weight: number;
  qualityScore?: number;
}

export interface PhantomStats {
  totalPhantoms: number;
  avgWeight: number;
  topPhantoms: Array<{ shorthand: string; weight: number; qualityScore?: number }>;
  alliances: Array<{ phantomA: string; phantomB: string; strength: number; coActivations: number }>;
}

export interface AIDENBrainConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxPollAttempts?: number;
  pollInterval?: number;
}
