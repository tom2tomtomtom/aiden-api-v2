/**
 * Prompt caching helper tests.
 *
 * Asserts that the system-prompt wrapper produces the right Anthropic
 * content-block shape with cache_control: ephemeral, and that an undefined
 * system stays undefined (so we don't accidentally send empty messages).
 */
import { describe, it, expect } from 'vitest';
import { toCacheableSystem } from '../../src/brain/llm-adapter.js';

describe('toCacheableSystem', () => {
  it('wraps a non-empty system string with ephemeral cache control', () => {
    const wrapped = toCacheableSystem('You are AIDEN.');
    expect(wrapped).toEqual([
      {
        type: 'text',
        text: 'You are AIDEN.',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('returns undefined when given undefined so empty system is not sent', () => {
    expect(toCacheableSystem(undefined)).toBeUndefined();
  });

  it('returns undefined for empty strings (no point caching nothing)', () => {
    expect(toCacheableSystem('')).toBeUndefined();
  });

  it('preserves the full prompt body inside the cacheable block', () => {
    const body = 'A'.repeat(8000);
    const wrapped = toCacheableSystem(body);
    expect(wrapped?.[0]?.text).toBe(body);
    expect(wrapped?.[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });
});
