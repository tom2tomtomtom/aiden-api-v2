/**
 * Phantom Context Builder
 *
 * Builds phantom context for system prompts using two-layer architecture:
 * Intellectual foreground (active expertise) + Emotional background (always-present lens).
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/phantom-context.ts
 * Key behaviors preserved:
 * - Intellectual/emotional layer separation based on originContext
 * - Baseline emotional phantom auto-injection when no emotional phantoms fire
 * - Collision mode triggers full stories; normal mode uses compressed format
 */

import type {
  PhantomActivationScored,
  PhantomLike,
  Phantom,
  ConversationExchange,
  PersonalityMode,
} from '../types.js';
import { buildPhantomDeliveryInstructions } from './prompt-strategies.js';

// ── Baseline emotional phantom keys ──────────────────────────────────────────

const BASELINE_EMOTIONAL_KEYS = ['trust_deepened', 'thinking_aloud', 'doubt_earned'];

/**
 * PhantomContextBuilder
 *
 * Builds the phantom personality block for system prompts.
 * Implements the two-layer system:
 * - Intellectual foreground: active expertise phantoms
 * - Emotional background: personality depth phantoms (always-present lens)
 */
export class PhantomContextBuilder {
  private phantomMap: Map<string, Phantom>;

  constructor(phantomMap: Map<string, Phantom>) {
    this.phantomMap = phantomMap;
  }

  /**
   * Build TWO-LAYER phantom context: Intellectual foreground + Emotional background.
   *
   * Phantoms with originContext === 'personality_depth' go to the emotional layer.
   * All others go to the intellectual layer. If no emotional phantoms fire,
   * a baseline emotional phantom is injected.
   */
  buildPhantomContext(
    activatedPhantoms: PhantomActivationScored[],
    mode: PersonalityMode = 'collaborator',
    hasCollisions: boolean = false,
  ): string {
    if (!activatedPhantoms.length) return '';

    const creativePhantoms: PhantomActivationScored[] = [];
    const emotionalPhantoms: PhantomActivationScored[] = [];

    for (const activation of activatedPhantoms) {
      const origin = this.getOriginContext(activation.phantom);
      if (origin === 'personality_depth') {
        emotionalPhantoms.push(activation);
      } else {
        creativePhantoms.push(activation);
      }
    }

    console.log(
      `[PhantomContext] INTELLECTUAL LAYER: ${creativePhantoms.length} phantoms, ` +
        `EMOTIONAL LAYER: ${emotionalPhantoms.length} phantoms`,
    );

    // Add baseline emotional phantom if none fired
    if (!emotionalPhantoms.length) {
      console.warn('[PhantomContext] NO EMOTIONAL PHANTOMS FIRED - Adding baseline');
      const baseline = this.addBaselineEmotionalPhantoms();
      emotionalPhantoms.push(...baseline);
    }

    const contextLines: string[] = [];

    if (hasCollisions) {
      // Full stories: conviction mode (collisions detected, need rich personality context)
      if (creativePhantoms.length) {
        contextLines.push('INTELLECTUAL FOREGROUND (active expertise):');
        for (const { phantom } of creativePhantoms) {
          contextLines.push(
            `- ${phantom.feelingSeed.toUpperCase()}: ${phantom.phantomStory}`,
          );
        }
      }

      if (emotionalPhantoms.length) {
        contextLines.push('\nEMOTIONAL BACKGROUND (always-present lens):');
        for (const { phantom } of emotionalPhantoms) {
          contextLines.push(
            `- ${phantom.feelingSeed.toUpperCase()}: ${phantom.phantomStory}`,
          );
        }
      }
    } else {
      // Compressed: normal mode (list stances + influences, skip stories)
      const stances = creativePhantoms.map(({ phantom }) => phantom.feelingSeed).join(', ');
      const emotionalLens = emotionalPhantoms.map(({ phantom }) => phantom.feelingSeed).join(', ');
      const influences = [...creativePhantoms, ...emotionalPhantoms]
        .map(({ phantom }) => phantom.influence)
        .filter(Boolean)
        .slice(0, 8)
        .join(', ');

      contextLines.push(`ACTIVE STANCE: [${stances}]`);
      if (emotionalLens) {
        contextLines.push(`EMOTIONAL LENS: [${emotionalLens}]`);
      }
      contextLines.push(`INFLUENCES: ${influences}`);
      contextLines.push(`PHANTOM COUNT: ${activatedPhantoms.length} active`);
    }

    contextLines.push('\n' + buildPhantomDeliveryInstructions(mode));

    return contextLines.join('\n');
  }

  /**
   * Add baseline emotional phantoms when none fired.
   * Searches for known baseline keys in the phantom map.
   */
  private addBaselineEmotionalPhantoms(): PhantomActivationScored[] {
    const result: PhantomActivationScored[] = [];

    for (const key of BASELINE_EMOTIONAL_KEYS) {
      const phantom = this.phantomMap.get(key);
      if (phantom) {
        result.push({ key, phantom, score: 2.0, source: 'base' });
        console.log(`[PhantomContext] Added baseline: ${phantom.shorthand}`);
        break; // Only add one baseline
      }
    }

    return result;
  }

  /**
   * Build conversation context for search system.
   * Formats recent exchanges for evidence retrieval.
   */
  buildConversationContextForSearch(conversationHistory: ConversationExchange[]): string {
    if (!conversationHistory.length) {
      return 'No conversation context available.';
    }

    const recentMessages = conversationHistory.slice(-6);
    const contextParts = ['CONVERSATION CONTEXT FOR EVIDENCE SEARCH:'];

    for (const exchange of recentMessages) {
      if (exchange.userMsg && exchange.aiResponse) {
        contextParts.push(`User: ${exchange.userMsg.slice(0, 300)}`);
        contextParts.push(`AIDEN: ${exchange.aiResponse.slice(0, 400)}`);
        contextParts.push('---');
      }
    }

    contextParts.push(
      'USER IS NOW ASKING FOR EVIDENCE TO BACK UP THE INSIGHTS/CLAIMS DISCUSSED ABOVE.',
    );
    return contextParts.join('\n');
  }

  /**
   * Get the origin context from a phantom, handling both Phantom and proxy types.
   */
  private getOriginContext(phantom: PhantomLike): string {
    return (phantom as Phantom).originContext ?? '';
  }
}
