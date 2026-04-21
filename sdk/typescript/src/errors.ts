/**
 * AIDEN Brain SDK - Error types
 */

export class AIDENBrainError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'AIDENBrainError';
    this.statusCode = statusCode;
  }
}

export class AuthenticationError extends AIDENBrainError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends AIDENBrainError {
  retryAfter: number;
  window: string;

  constructor(retryAfter = 60, window = 'minute') {
    super(`Rate limit exceeded (${window}). Retry after ${retryAfter}s.`, 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.window = window;
  }
}

export class InsufficientTokensError extends AIDENBrainError {
  constructor(message = 'Insufficient tokens') {
    super(message, 402);
    this.name = 'InsufficientTokensError';
  }
}

export class ValidationError extends AIDENBrainError {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400);
    this.name = 'ValidationError';
    this.details = details;
  }
}
