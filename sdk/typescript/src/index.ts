/**
 * @aiden/brain - TypeScript SDK for the AIDEN Brain API v2
 */

export { AIDENBrain } from './client.js';
export type {
  AIDENBrainConfig,
  ChatResponse,
  ChatOptions,
  PhantomFired,
  Collision,
  ThinkingMode,
  GenerationResult,
  WorkflowState,
  UsageReport,
  FeedbackResponse,
  FeedbackType,
  PhantomInfo,
  PhantomStats,
} from './models.js';
export {
  AIDENBrainError,
  AuthenticationError,
  RateLimitError,
  InsufficientTokensError,
  ValidationError,
} from './errors.js';
