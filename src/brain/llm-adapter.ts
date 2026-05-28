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
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import {
  generateText as generateAIText,
  streamText as streamAIText,
  type CoreMessage,
  type UserContent,
} from 'ai';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { config } from '../config/index.js';

// ── Provider configuration ───────────────────────────────────────────────────

export type LLMProvider = 'anthropic' | 'openrouter' | 'openai';

export interface LLMModelConfig {
  provider: LLMProvider;
  modelId: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export type LLMMessage = MessageParam;
export type LLMMessageContent = MessageParam['content'];
type OpenAIUserContentPart = Exclude<UserContent, string>[number];

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
    provider: config.llmProvider,
    modelId: config.llmProvider === 'openai' ? config.openaiModel : config.mainModel,
    maxOutputTokens: 4096,
    temperature: 0.7,
  },
  /** Deep thinking model for complex tasks */
  deep: {
    provider: config.llmProvider,
    modelId: config.llmProvider === 'openai' ? config.openaiModel : config.mainModel,
    maxOutputTokens: 8192,
    temperature: 0.5,
  },
} as const;

// ── Prompt-caching helper ─────────────────────────────────────────────────────

/**
 * Wrap a system-prompt string in an Anthropic content-block array carrying
 * `cache_control: { type: 'ephemeral' }` so the prefix is cached for 5 minutes.
 *
 * Why: CORE_IDENTITY + BASE_SYSTEM_PROMPT are static across turns. Caching
 * them drops the input-token cost on a cache hit to 10% of the normal rate,
 * which is roughly a 70% saving on a typical chat turn. The break-even is
 * three requests within the cache TTL, which any active conversation hits.
 *
 * Returns undefined when the input is undefined so callers don't accidentally
 * send an empty system message.
 */
export function toCacheableSystem(system: string | undefined): Anthropic.TextBlockParam[] | undefined {
  if (!system) return undefined;
  return [
    {
      type: 'text',
      text: system,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

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
  private openAIProvider: OpenAIProvider | null = null;

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

  private getOpenAIProvider(): OpenAIProvider {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required when using the OpenAI provider');
    }

    if (!this.openAIProvider) {
      this.openAIProvider = createOpenAI({
        apiKey: config.openaiApiKey,
      });
    }
    return this.openAIProvider;
  }

  private getAnthropicCompatibleClient(provider: Exclude<LLMProvider, 'openai'>): Anthropic {
    switch (provider) {
      case 'anthropic':
        return this.getAnthropicClient();
      case 'openrouter':
        return this.getOpenRouterClient();
      default:
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }

  private hasProviderCredentials(provider: LLMProvider): boolean {
    switch (provider) {
      case 'anthropic':
        return Boolean(config.anthropicApiKey);
      case 'openrouter':
        return Boolean(config.openRouterApiKey);
      case 'openai':
        return Boolean(config.openaiApiKey);
      default:
        return false;
    }
  }

  /**
   * Generate text (non-streaming).
   * Attempts primary provider first, falls back if configured.
   */
  async generateText(options: {
    system?: string;
    prompt: string;
    messages?: LLMMessage[];
    maxOutputTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const callConfig = this.primaryConfig;

    try {
      return await this.callProvider(callConfig, options);
    } catch (error) {
      // Attempt fallback if configured
      if (this.fallbackConfig) {
        if (!this.hasProviderCredentials(this.fallbackConfig.provider)) {
          console.warn(
            `[LLMAdapter] Primary provider failed (${callConfig.provider}/${callConfig.modelId}); ` +
              `fallback provider ${this.fallbackConfig.provider} is not configured`,
          );
          throw error;
        }

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
    messages: LLMMessage[];
    maxOutputTokens?: number;
    temperature?: number;
  }): AsyncGenerator<string, void, unknown> {
    const callConfig = this.primaryConfig;

    if (callConfig.provider === 'openai') {
      const openai = this.getOpenAIProvider();
      const stream = streamAIText({
        model: openai(callConfig.modelId),
        maxTokens: options.maxOutputTokens ?? callConfig.maxOutputTokens ?? 4096,
        temperature: options.temperature ?? callConfig.temperature ?? 0.7,
        system: options.system,
        messages: options.messages as CoreMessage[],
      });

      for await (const text of stream.textStream) {
        yield text;
      }
      return;
    }

    const client = this.getAnthropicCompatibleClient(callConfig.provider);

    const stream = client.messages.stream({
      model: callConfig.modelId,
      max_tokens: options.maxOutputTokens ?? callConfig.maxOutputTokens ?? 4096,
      temperature: options.temperature ?? callConfig.temperature ?? 0.7,
      system: toCacheableSystem(options.system),
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
      messages?: LLMMessage[];
      maxOutputTokens?: number;
      temperature?: number;
    },
  ): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    // Build messages array
    const messages: LLMMessage[] =
      options.messages ? [...options.messages] : [{ role: 'user', content: options.prompt }];

    if (providerConfig.provider === 'openai') {
      return await this.callOpenAIProvider(providerConfig, options, messages);
    }

    const client = this.getAnthropicCompatibleClient(providerConfig.provider);

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
      system: toCacheableSystem(options.system),
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

  private async callOpenAIProvider(
    providerConfig: LLMModelConfig,
    options: {
      system?: string;
      prompt: string;
      messages?: LLMMessage[];
      maxOutputTokens?: number;
      temperature?: number;
    },
    messages: LLMMessage[],
  ): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const openai = this.getOpenAIProvider();
    const prompt = options.messages ? { messages: this.toOpenAIMessages(messages) } : { prompt: options.prompt };

    const response = await generateAIText({
      model: openai(providerConfig.modelId),
      maxTokens: options.maxOutputTokens ?? providerConfig.maxOutputTokens ?? 4096,
      temperature: options.temperature ?? providerConfig.temperature ?? 0.7,
      system: options.system,
      ...prompt,
    });

    return {
      text: response.text,
      usage: {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
      },
    };
  }

  private toOpenAIMessages(messages: LLMMessage[]): CoreMessage[] {
    return messages.map((message) => {
      if (typeof message.content === 'string') {
        return { role: message.role, content: message.content } as CoreMessage;
      }

      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join(''),
        };
      }

      const content: OpenAIUserContentPart[] = message.content.flatMap((block): OpenAIUserContentPart[] => {
        if (block.type === 'text') {
          return [{ type: 'text' as const, text: block.text }];
        }

        if (block.type === 'image') {
          if (block.source.type === 'base64') {
            return [{
              type: 'image' as const,
              image: block.source.data,
              mimeType: block.source.media_type,
            }];
          }

          if (block.source.type === 'url') {
            return [{
              type: 'image' as const,
              image: new URL(block.source.url),
            }];
          }
        }

        return [];
      });

      return { role: 'user', content } as CoreMessage;
    });
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
