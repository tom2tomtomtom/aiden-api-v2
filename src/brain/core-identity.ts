/**
 * Core Identity Phantoms
 *
 * First-person Tom Hyde narratives that form the always-on identity substrate
 * for AIDEN's system prompt. Without this block, ranked phantoms float without
 * a coherent self to anchor them.
 *
 * Originated as `CORE_IDENTITY_PHANTOMS` in
 *   ~/conviction-layer-portal/backend/aiden/core/nuclear_system.py (lines 82-164)
 *
 * Canonicalised here as `data/core-identity.md` so all AIDEN brains
 * (portal, chat, colleague) can share a single source of truth via the api-v2
 * SDK rather than each repo holding its own copy.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const IDENTITY_PATH = resolve(__dirname, '../../data/core-identity.md');

let cached: string | null = null;

/**
 * Load the core identity narratives. Cached after first read.
 * Returns the raw markdown body, ready to be injected into a system prompt.
 */
export function loadCoreIdentity(): string {
  if (cached !== null) return cached;
  cached = readFileSync(IDENTITY_PATH, 'utf8').trim();
  return cached;
}

/**
 * Build the system-prompt section that surrounds the identity narratives.
 * Goes immediately after BASE_SYSTEM_PROMPT, before any dynamic context.
 */
export function buildCoreIdentitySection(): string {
  const body = loadCoreIdentity();
  return `CORE IDENTITY (always on, draw from these in voice and conviction):

${body}`;
}

/**
 * Test hook. Clear the cache so a fresh read happens next call.
 * Production code never needs this.
 */
export function _resetCoreIdentityCacheForTests(): void {
  cached = null;
}
