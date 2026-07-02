/**
 * LLM Adapter - Direct LLM access
 *
 * Primary: Claude Sonnet via Anthropic direct
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

export type LLMProvider = 'anthropic' | 'openai';

export interface LLMModelConfig {
  provider: LLMProvider;
  modelId: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export type LLMMessage = MessageParam;
export type LLMMessageContent = MessageParam['content'];
type OpenAIUserContentPart = Exclude<UserContent, string>[number];

/** A web-search citation attached to a span of generated text. */
export interface LLMCitation {
  /** 1-based footnote index, stable within a single response */
  index: number;
  url: string;
  title: string;
  cited_text?: string;
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

// ── Citation extraction ──────────────────────────────────────────────────────

/**
 * Join text blocks into a single string, appending inline `[[n]](url)`
 * markdown markers immediately after each cited span (the API splits text
 * into blocks at citation boundaries, so adjacency is exact). Sources are
 * deduped by URL and numbered in order of first appearance.
 */
function extractTextAndCitations(content: Anthropic.ContentBlock[]): {
  text: string;
  citations: LLMCitation[];
} {
  const citations: LLMCitation[] = [];
  const indexByUrl = new Map<string, number>();
  let text = '';

  for (const block of content) {
    if (block.type !== 'text') continue;
    text += block.text;

    const markers: string[] = [];
    for (const c of block.citations ?? []) {
      if (c.type !== 'web_search_result_location') continue;
      let index = indexByUrl.get(c.url);
      if (index === undefined) {
        index = citations.length + 1;
        indexByUrl.set(c.url, index);
        citations.push({
          index,
          url: c.url,
          title: c.title ?? c.url,
          ...(c.cited_text ? { cited_text: c.cited_text } : {}),
        });
      }
      const marker = `[[${index}]](${c.url})`;
      if (!markers.includes(marker)) markers.push(marker);
    }
    if (markers.length > 0) text += ` ${markers.join(' ')}`;
  }

  return { text, citations };
}

// ── LLM Adapter class ─────────────────────────���──────────────────────────────

/**
 * Direct provider adapter.
 *
 * Provides a unified interface for Anthropic direct and optional OpenAI calls.
 */
export class LLMAdapter {
  private primaryConfig: LLMModelConfig;
  private anthropicClient: Anthropic | null = null;
  private openAIProvider: OpenAIProvider | null = null;

  constructor(primaryConfig: LLMModelConfig) {
    this.primaryConfig = primaryConfig;
  }

  private getAnthropicClient(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = new Anthropic({
        apiKey: config.anthropicApiKey,
      });
    }
    return this.anthropicClient;
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
      default:
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }

  /**
   * Generate text (non-streaming).
   *
   * When `webSearch` is true (Anthropic provider only), the native
   * web_search server tool is attached so the model can search mid-generation.
   * Cited spans come back with inline `[[n]](url)` markers appended and the
   * deduped source list in `citations`.
   */
  async generateText(options: {
    system?: string;
    prompt: string;
    messages?: LLMMessage[];
    maxOutputTokens?: number;
    temperature?: number;
    webSearch?: boolean;
  }): Promise<{
    text: string;
    citations?: LLMCitation[];
    usage?: { promptTokens: number; completionTokens: number };
  }> {
    const callConfig = this.primaryConfig;
    return await this.callProvider(callConfig, options);
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
      webSearch?: boolean;
    },
  ): Promise<{
    text: string;
    citations?: LLMCitation[];
    usage?: { promptTokens: number; completionTokens: number };
  }> {
    // Build messages array
    let messages: LLMMessage[] =
      options.messages ? [...options.messages] : [{ role: 'user', content: options.prompt }];

    if (providerConfig.provider === 'openai') {
      return await this.callOpenAIProvider(providerConfig, options, messages);
    }

    const client = this.getAnthropicCompatibleClient(providerConfig.provider);

    const baseParams = {
      model: providerConfig.modelId,
      max_tokens: options.maxOutputTokens ?? providerConfig.maxOutputTokens ?? 4096,
      temperature: options.temperature ?? providerConfig.temperature ?? 0.7,
      system: toCacheableSystem(options.system),
      ...(options.webSearch
        ? { tools: [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 5 }] }
        : {}),
    };

    let response = await client.messages.create({ ...baseParams, messages });

    // Server tools pause the turn when they hit the server-side iteration
    // limit; re-send with the assistant content appended and it resumes.
    let continuations = 0;
    let promptTokens = response.usage.input_tokens;
    let completionTokens = response.usage.output_tokens;
    while (response.stop_reason === 'pause_turn' && continuations < 5) {
      messages = [...messages, { role: 'assistant', content: response.content }];
      response = await client.messages.create({ ...baseParams, messages });
      promptTokens += response.usage.input_tokens;
      completionTokens += response.usage.output_tokens;
      continuations++;
    }

    const { text, citations } = extractTextAndCitations(response.content);

    return {
      text,
      ...(citations.length > 0 ? { citations } : {}),
      usage: { promptTokens, completionTokens },
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
 * Uses the configured provider directly.
 */
export function createPrimaryAdapter(): LLMAdapter {
  return new LLMAdapter(MODEL_CONFIGS.primary);
}

/**
 * Create an LLM adapter for deep thinking tasks.
 */
export function createDeepAdapter(): LLMAdapter {
  return new LLMAdapter(MODEL_CONFIGS.deep);
}
