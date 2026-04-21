/**
 * AIDEN Brain SDK - TypeScript Client
 *
 * Native fetch, async/await. No dependencies.
 */

import type {
  AIDENBrainConfig,
  ChatResponse,
  ChatOptions,
  GenerationResult,
  WorkflowState,
  UsageReport,
  FeedbackResponse,
  FeedbackType,
  PhantomInfo,
  PhantomStats,
} from './models.js';

import {
  AIDENBrainError,
  AuthenticationError,
  RateLimitError,
  InsufficientTokensError,
  ValidationError,
} from './errors.js';

export class AIDENBrain {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private maxPollAttempts: number;
  private pollInterval: number;

  constructor(config: AIDENBrainConfig) {
    if (!config.apiKey || !config.apiKey.startsWith('aiden_sk_')) {
      throw new AuthenticationError("API key must start with 'aiden_sk_'");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://brain.aiden.services').replace(/\/$/, '');
    this.timeout = config.timeout || 60000;
    this.maxPollAttempts = config.maxPollAttempts || 30;
    this.pollInterval = config.pollInterval || 2000;
  }

  private async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error || `HTTP ${response.status}`;
        switch (response.status) {
          case 401: throw new AuthenticationError(errorMsg);
          case 429: throw new RateLimitError(data.retry_after_seconds || 60, data.window);
          case 402: throw new InsufficientTokensError(errorMsg);
          case 400: throw new ValidationError(errorMsg, data.details);
          default: throw new AIDENBrainError(errorMsg, response.status);
        }
      }

      return (data.data || data) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async pollJob(jobId: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < this.maxPollAttempts; i++) {
      const status = await this.request<{ status: string; error?: string }>('GET', `/jobs/${jobId}/status`);

      if (status.status === 'completed') {
        return this.request('GET', `/jobs/${jobId}/result`);
      }
      if (status.status === 'failed') {
        throw new AIDENBrainError(status.error || 'Job failed', 500);
      }

      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }

    throw new AIDENBrainError('Job timed out after max poll attempts');
  }

  // ── Chat ─────────────────────────────────────────────────────────────────

  async chat(message: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      message,
      personality_mode: options.personalityMode || 'collaborator',
      stream: false,
    };
    if (options.conversationId) body.conversation_id = options.conversationId;
    if (options.model) body.model = options.model;

    const data = await this.request<Record<string, unknown>>('POST', '/chat', body);

    return {
      content: data.content as string,
      conversationId: data.conversation_id as string,
      phantomsFired: (data.phantoms_fired as Array<Record<string, unknown>> || []).map(p => ({
        shorthand: p.shorthand as string,
        score: p.score as number,
        source: p.source as 'base' | 'agency' | 'pack' | 'user',
      })),
      collisions: (data.collisions as Array<Record<string, unknown>> || []).map(c => ({
        phantomA: c.phantomA as string,
        phantomB: c.phantomB as string,
        tension: c.tension as string,
      })),
      thinkingMode: data.thinking_mode as { mode: string; label: string; description: string },
      maturityStage: (data.maturity_stage as string) || 'initial',
    };
  }

  async *chatStream(message: string, options: ChatOptions = {}): AsyncGenerator<string, void, unknown> {
    const body: Record<string, unknown> = {
      message,
      personality_mode: options.personalityMode || 'collaborator',
      stream: true,
    };
    if (options.conversationId) body.conversation_id = options.conversationId;

    const url = `${this.baseUrl}/api/v1/chat`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new AIDENBrainError('Stream connection failed', response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'text') {
            yield event.data as string;
          } else if (event.type === 'done') {
            return;
          }
        }
      }
    }
  }

  // ── Structured Generation ────────────────────────────────────────────────

  async generateStrategy(brief: string, options: Record<string, unknown> = {}): Promise<GenerationResult> {
    const data = await this.request<Record<string, unknown>>('POST', '/generate/strategy', { brief, ...options });
    const jobId = data.job_id as string;
    if (jobId) {
      const result = await this.pollJob(jobId);
      return { jobId, status: 'completed', result };
    }
    return { jobId: 'sync', status: 'completed', result: data };
  }

  async generateTerritories(brief: string, options: Record<string, unknown> = {}): Promise<GenerationResult> {
    const data = await this.request<Record<string, unknown>>('POST', '/generate/territories', { brief, ...options });
    const jobId = data.job_id as string;
    if (jobId) {
      const result = await this.pollJob(jobId);
      return { jobId, status: 'completed', result };
    }
    return { jobId: 'sync', status: 'completed', result: data };
  }

  async generateBigIdea(brief: string, territories?: string[], options: Record<string, unknown> = {}): Promise<GenerationResult> {
    const body: Record<string, unknown> = { brief, ...options };
    if (territories) body.territories = territories;
    const data = await this.request<Record<string, unknown>>('POST', '/generate/big-idea', body);
    const jobId = data.job_id as string;
    if (jobId) {
      const result = await this.pollJob(jobId);
      return { jobId, status: 'completed', result };
    }
    return { jobId: 'sync', status: 'completed', result: data };
  }

  async generateCopySuite(brief: string, bigIdea?: string, options: Record<string, unknown> = {}): Promise<GenerationResult> {
    const body: Record<string, unknown> = { brief, ...options };
    if (bigIdea) body.big_idea = bigIdea;
    const data = await this.request<Record<string, unknown>>('POST', '/generate/copy-suite', body);
    const jobId = data.job_id as string;
    if (jobId) {
      const result = await this.pollJob(jobId);
      return { jobId, status: 'completed', result };
    }
    return { jobId: 'sync', status: 'completed', result: data };
  }

  // ── Workflow ─────────────────────────────────────────────────────────────

  async workflow(brief: string, options: Record<string, unknown> = {}): Promise<WorkflowState> {
    const data = await this.request<Record<string, unknown>>('POST', '/workflow', { brief, ...options });
    return {
      workflowId: (data.workflow_id as string) || '',
      currentStep: (data.current_step as string) || '',
      stepsCompleted: (data.steps_completed as string[]) || [],
      stepsRemaining: (data.steps_remaining as string[]) || [],
      outputs: (data.outputs as Record<string, unknown>) || {},
    };
  }

  // ── Usage ────────────────────────────────────────────────────────────────

  async getUsage(): Promise<UsageReport> {
    const data = await this.request<Record<string, unknown>>('GET', '/usage');
    return {
      totalRequests: (data.total_requests as number) || 0,
      totalTokens: (data.total_tokens as number) || 0,
      periodStart: (data.period_start as string) || '',
      periodEnd: (data.period_end as string) || '',
      breakdown: (data.breakdown as Record<string, number>) || {},
    };
  }

  // ── Feedback ─────────────────────────────────────────────────────────────

  async submitFeedback(
    messageId: string,
    conversationId: string,
    feedbackType: FeedbackType,
    editedContent?: string,
  ): Promise<FeedbackResponse> {
    const body: Record<string, unknown> = {
      message_id: messageId,
      conversation_id: conversationId,
      feedback_type: feedbackType,
    };
    if (editedContent) body.edited_content = editedContent;

    const data = await this.request<Record<string, unknown>>('POST', '/feedback', body);
    return {
      feedbackType: (data.feedback_type as string) || feedbackType,
      weightChanges: (data.weight_changes as number) || 0,
      flaggedForReview: (data.flagged_for_review as string[]) || [],
    };
  }

  // ── Phantom Management ───────────────────────────────────────────────────

  async listPhantoms(): Promise<PhantomInfo[]> {
    const data = await this.request<Record<string, unknown>>('GET', '/phantoms');
    return ((data.phantoms as Array<Record<string, unknown>>) || []).map(p => ({
      shorthand: p.shorthand as string,
      feelingSeed: (p.feeling_seed as string) || '',
      influence: (p.influence as string) || '',
      weight: (p.weight as number) || 3.0,
      qualityScore: p.quality_score as number | undefined,
    }));
  }

  async getPhantomStats(): Promise<PhantomStats> {
    const data = await this.request<Record<string, unknown>>('GET', '/phantoms/stats');
    return {
      totalPhantoms: (data.total_phantoms as number) || 0,
      avgWeight: (data.avg_weight as number) || 0,
      topPhantoms: (data.top_phantoms as Array<{ shorthand: string; weight: number; qualityScore?: number }>) || [],
      alliances: (data.alliances as Array<{ phantomA: string; phantomB: string; strength: number; coActivations: number }>) || [],
    };
  }
}
