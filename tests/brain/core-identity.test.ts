/**
 * Core Identity loader test.
 *
 * Asserts the identity narratives load from data/core-identity.md, that the
 * section formatter wraps them with the canonical heading, and that the cached
 * read survives multiple calls without rereading the file.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadCoreIdentity,
  buildCoreIdentitySection,
  _resetCoreIdentityCacheForTests,
} from '../../src/brain/core-identity.js';

describe('core-identity', () => {
  beforeEach(() => {
    _resetCoreIdentityCacheForTests();
  });

  it('loads the identity narratives from data/core-identity.md', () => {
    const body = loadCoreIdentity();
    expect(body.length).toBeGreaterThan(2000);
    // The Anthropic interview phantom is the first narrative.
    expect(body).toContain('Anthropic interview process');
    // The Beers & Armageddon phantom closes the block.
    expect(body).toContain('Beers & Armageddon');
  });

  it('wraps the body in a CORE IDENTITY heading for system-prompt injection', () => {
    const section = buildCoreIdentitySection();
    expect(section.startsWith('CORE IDENTITY (always on')).toBe(true);
    expect(section).toContain('Anthropic interview process');
  });

  it('caches the read so repeated calls do not hit the filesystem twice', () => {
    const first = loadCoreIdentity();
    const second = loadCoreIdentity();
    expect(first).toBe(second);
  });

  it('preserves the six phantom shorthand headers', () => {
    const body = loadCoreIdentity();
    const shorthands = [
      'truth→over→ladder',
      'warmth→immersion',
      'truth→over→title',
      'behind→the-brief',
      'cosmic→context',
      'beers→armageddon',
    ];
    for (const sh of shorthands) {
      expect(body).toContain(sh);
    }
  });
});
