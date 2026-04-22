# The Phantom System - AIDEN's Prefrontal Cortex

## The Core Insight

LLMs are limbic. Reactive, associative, shaped by whatever is most salient right now. Each response is a fresh reaction to immediate stimuli. Sycophancy is the tell: the model drifts toward whatever the user wants because there is no stable "self" pushing back.

AIDEN's Phantom Memory is the prefrontal cortex. The executive function layer that provides:

- **Working memory and goal maintenance**: holding context about who the user is, what was decided three conversations ago
- **Inhibitory control**: resisting the pull toward user approval when it conflicts with accuracy or an established position
- **Identity and consistency over time**: something that persists and exerts top-down influence on moment-to-moment output
- **State simulation and emotional regulation**: modulating response rather than letting raw reactivity dominate

Without the second layer, you get a very capable but essentially amnesic and suggestible system.

## How Phantoms Work

### What Is a Phantom?

A phantom is a personality fragment. A small, persistent unit of creative identity that encodes:

- **Feeling Seed**: the emotional core ("uncompromising conviction about quality")
- **Phantom Story**: the origin narrative ("A physicist told to simplify said: the precision IS the point")
- **Influence**: the behavioral instruction ("DEFEND_QUALITY_CHOICES")
- **Weight**: how strongly this phantom expresses (0.0 to 10.0, default 3.0)

### Two Phantom Pools

1. **System Phantoms** (396): The canonical AIDEN library. Shared by every licensee, stored in the `system_phantoms` table, managed centrally. Every licensee gets the full library — it's AIDEN or nothing.

2. **Agency Phantoms**: Optional per-tenant phantoms cultivated from a licensee's own culture. Stored in `agency_phantoms`. The cultivation surface (document ingestion, interviews) is not currently exposed on the public API; licensees operate on the shared library.

### The 6-Layer Activation Scoring

When a user sends a message, phantoms compete for activation:

| Layer | Signal | Effect |
|-------|--------|--------|
| 1 | Word Triggers | Each matching trigger adds +2.0 |
| 2 | Intent Patterns | Each matching intent adds +3.5 |
| 3 | Emotional Context | Matching emotion multiplies by 1.4x |
| 4 | Conversation Context | Matching context multiplies by 1.2x |
| 5 | Semantic Intent | (Future: embedding-based) |
| 6 | Semantic Boost | (Future: embedding-based) |

Every phantom with a positive score activates and shapes the response — no hard cap.

### Conversation Dynamics Curve

Phantoms behave differently depending on how deep the conversation is:

| Exchanges | Defense | Ideation | Bold |
|-----------|---------|----------|------|
| 1-3 | 0.25x | 1.3x | 1.0x |
| 4-5 | 0.5x | 1.15x | 1.0x |
| 6-8 | 0.75x | 1.0x | 1.2x |
| 9+ | 1.0x | 1.0x | 1.3x |

Early conversations favour ideation. Deep conversations favour boldness and allow defense.

### Collision Detection

When two phantoms with opposing influences both activate strongly (above 0.85 threshold), a "collision" is detected. This creates creative tension that AIDEN voices explicitly:

4 opposing pairs:
1. Minimalism vs Depth
2. Conservative vs Bold
3. Brief vs Comprehensive
4. Agree vs Challenge

Collisions are not bugs. They are the most interesting output. "Part of me wants to strip this down to its essence, but another part knows this brief demands layered complexity. Here is how I would hold both..."

## The Moat Features

### Feedback Loop

Every interaction teaches the system what works. When a user gives positive feedback:
- Active phantoms get a weight boost proportional to their activation score (+0.08)
- "Used" (copied without editing) is the strongest signal (+0.12)
- Negative feedback applies a small penalty (-0.03)
- 3+ negatives in 30 days flags a phantom for review

### Quality Scoring

Phantoms earn their place through a continuous quality score (0-10):
- Activation frequency: how often does it fire?
- Positive feedback rate: when it fires, does it produce good output?
- Collision contribution: does it participate in productive creative tensions?
- Stability: is it growing or decaying?

Phantoms scoring below 2.0 for 4 consecutive weeks get archived. Core conviction phantoms are protected.

### Phantom Alliances

Phantoms that consistently co-activate and produce good output develop relationships. When "challenger-instinct" and "cultural-radar" frequently fire together and receive positive feedback, an alliance forms. Alliance strength above 0.7 means: if one fires, the other gets a 0.3x boost.

This creates emergent creative habits unique to each agency's AIDEN.

## The Sycophancy Guardrail

10 core conviction phantoms (creative_stubborn, challenge_defend, question_premise, etc.) can grow stronger but NEVER decay below weight 2.0. This ensures AIDEN always retains structural capacity to push back, even after extensive user interaction that might otherwise train the system to agree.

## The Neuroscience Mapping

The prefrontal cortex is not one thing:

- **Dorsolateral PFC** (working memory and planning) maps to: phantom activation scoring, conversation maturity tracker, cross-conversation recall
- **Ventromedial PFC** (value and social cognition) maps to: conviction tiers (gentle/firm/hard), sycophancy guardrail, core conviction weight floors
- **Orbitofrontal PFC** (reward evaluation) maps to: phantom evolution (engagement grows weight, neglect decays), anti-phantom creation, feedback loop

## The Summary

"LLMs are limbic. We added the prefrontal cortex."

The LLM provides fluency and pattern recognition. Phantom Memory provides persistence, identity, and the ability to push back. Without it, you get a capable but amnesic and suggestible system. That is the sycophancy problem everyone complains about. AIDEN solves it structurally.
