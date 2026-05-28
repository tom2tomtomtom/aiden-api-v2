import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const anthropicCreateMock = vi.hoisted(() => vi.fn());
const anthropicConstructorMock = vi.hoisted(() =>
  vi.fn(() => ({
    messages: {
      create: anthropicCreateMock,
    },
  })),
);

vi.mock('@anthropic-ai/sdk', () => ({
  default: anthropicConstructorMock,
}));

const originalEnv = { ...process.env };

describe('LLMAdapter fallback handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.AIDEN_LLM_PROVIDER = 'anthropic';
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('preserves the primary provider error when the fallback has no credentials', async () => {
    const primaryError = new Error('Could not process image');
    anthropicCreateMock.mockRejectedValue(primaryError);

    const { LLMAdapter } = await import('../../src/brain/llm-adapter.js');
    const adapter = new LLMAdapter(
      {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5-20250929',
      },
      {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4-20250514',
      },
    );

    await expect(adapter.generateText({ prompt: 'Judge this image.' })).rejects.toThrow(
      'Could not process image',
    );
    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
  });
});
