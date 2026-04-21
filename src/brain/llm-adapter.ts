/**
 * LLM Adapter - Multi-provider LLM access with failover
 *
 * Primary: Claude Sonnet via Anthropic direct
 * Fallback: Claude Sonnet via OpenRouter
 *
 * No Kimi. No Chinese models. Anthropic-first.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/llm-adapter.ts
 * Adapted: Uses @anthropic-ai/sdk directly instead of Vercel AI SDK.
 * Pure Node.js, no framework dependencies.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

// ── Provider configuration ───────────────────────────────────────────────────

export type LLMProvider = 'anthropic' | 'openrouter';

export interface LLMModelConfig {
  provider: LLMProvider;
  modelId: string;
  maxOutputTokens?: number;
  temperature?: number;
}

/** Default model configurations */
export const MODEL_CONFIGS = {
  /** Fast analysis model (Haiku) */
  fast: {
    provider: 'anthropic' as const,
    modelId: 'claude-haiku-4-5-20251001',
    maxOutputTokens: 600,
    temperature: 0,
  },
  /** Primary conversation model (Claude Sonnet via Anthropic) */
  primary: {
    provider: 'anthropic' as const,
    modelId: config.mainModel,
    maxOutputTokens: 4096,
    temperature: 0.7,
  },
  /** Deep thinking model for complex tasks */
  deep: {
    provider: 'anthropic' as const,
    modelId: config.mainModel,
    maxOutputTokens: 8192,
    temperature: 0.5,
  },
} as const;

// ── LLM Adapter class ─────────────────────────���──────────────────────────────

/**
 * Multi-provider LLM adapter with automatic failover.
 *
 * Provides a unified interface for text generation across
 * Anthropic direct and OpenRouter fallback.
 */
export class LLMAdapter {
  private primaryConfig: LLMModelConfig;
  private fallbackConfig?: LLMModelConfig;
  private anthropicClient: Anthropic | null = null;
  private openRouterClient: Anthropic | null = null;

  constructor(primaryConfig: LLMModelConfig, fallbackConfig?: LLMModelConfig) {
    this.primaryConfig = primaryConfig;
    this.fallbackConfig = fallbackConfig;
  }

  private getAnthropicClient(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = new Anthropic({
        apiKey: config.anthropicApiKey,
      });
    }
    return this.anthropicClient;
  }

  private getOpenRouterClient(): Anthropic {
    if (!this.openRouterClient) {
      this.openRouterClient = new Anthropic({
        apiKey: config.openRouterApiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      });
    }
    return this.openRouterClient;
  }

  private getClientForProvider(provider: LLMProvider): Anthropic {
    switch (provider) {
      case 'anthropic':
        return this.getAnthropicClient();
      case 'openrouter':
        return this.getOpenRouterClient();
      default:
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }

  /**
   * Generate text (non-streaming).
   * Attempts primary provider first, falls back if configured.
   */
  async generateText(options: {
    system?: string;
    prompt: string;
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxOutputTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const callConfig = this.primaryConfig;

    try {
      return await this.callProvider(callConfig, options);
    } catch (error) {
      // Attempt fallback if configured
      if (this.fallbackConfig) {
        console.warn(
          `[LLMAdapter] Primary provider failed (${callConfig.provider}/${callConfig.modelId}), ` +
            `falling back to ${this.fallbackConfig.provider}/${this.fallbackConfig.modelId}`,
        );
        return await this.callProvider(this.fallbackConfig, options);
      }
      throw error;
    }
  }

  /**
   * Stream text response.
   * Returns an async generator yielding text chunks.
   */
  async *streamText(options: {
    system?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxOutputTokens?: number;
    temperature?: number;
  }): AsyncGenerator<string, void, unknown> {
    const callConfig = this.primaryConfig;
    const client = this.getClientForProvider(callConfig.provider);

    const stream = client.messages.stream({
      model: callConfig.modelId,
      max_tokens: options.maxOutputTokens ?? callConfig.maxOutputTokens ?? 4096,
      temperature: options.temperature ?? callConfig.temperature ?? 0.7,
      system: options.system,
      messages: options.messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  private async callProvider(
    providerConfig: LLMModelConfig,
    options: {
      system?: string;
      prompt: string;
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
      maxOutputTokens?: number;
      temperature?: number;
    },
  ): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const client = this.getClientForProvider(providerConfig.provider);

    // Build messages array
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> =
      options.messages ? [...options.messages] : [{ role: 'user', content: options.prompt }];

    // If we have history messages but also a prompt, ensure the prompt is the last user message
    if (options.messages && options.messages.length > 0) {
      // Messages already include the user's prompt (last message)
    } else if (!options.messages) {
      // Simple prompt-only call
    }

    const response = await client.messages.create({
      model: providerConfig.modelId,
      max_tokens: options.maxOutputTokens ?? providerConfig.maxOutputTokens ?? 4096,
      temperature: options.temperature ?? providerConfig.temperature ?? 0.7,
      system: options.system,
      messages,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      },
    };
  }
}

// ── Factory functions ────────���───────────────────────────────────────────────

/**
 * Create an LLM adapter for fast analysis (Haiku).
 */
export function createFastAdapter(): LLMAdapter {
  return new LLMAdapter(MODEL_CONFIGS.fast);
}

/**
 * Create an LLM adapter for primary conversation.
 * Falls back to OpenRouter with Claude Sonnet.
 */
export function createPrimaryAdapter(): LLMAdapter {
  const fallback: LLMModelConfig = {
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4-20250514',
    maxOutputTokens: 4096,
    temperature: 0.7,
  };

  return new LLMAdapter(MODEL_CONFIGS.primary, fallback);
}

/**
 * Create an LLM adapter for deep thinking tasks.
 */
export function createDeepAdapter(): LLMAdapter {
  return new LLMAdapter(MODEL_CONFIGS.deep);
}
