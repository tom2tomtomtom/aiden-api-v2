/**
 * Phantom Cultivation Pipeline
 *
 * Extracts cultural signals from documents and interviews,
 * generates agency phantoms, scores quality, detects duplicates,
 * and fills category gaps. This is the core IP of AIDEN.
 *
 * Pipeline stages:
 * 1. Document extraction (cultural signals)
 * 2. Interview synthesis (13 questions, 3 acts)
 * 3. Quality scoring (14/20 minimum)
 * 4. Category gap filling
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/phantom-generator.ts
 * Full logic preserved. Dependency injection for LLM calls.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface CulturalSignals {
  identitySignals: string[];
  pridePatterns: string[];
  tensionSignals: string[];
  decisionStyle: string[];
  relationshipSignals: string[];
  culturalArtifacts: string[];
  unspokenRules: string[];
  rawExcerpts: string[];
}

export interface GeneratedPhantom {
  shorthand: string;
  feelingSeed: string;
  phantomStory: string;
  influence: string;
  weight: number;
  identityText: string;
  wordTriggers: string[];
  sourceType: 'document' | 'interview' | 'synthesis' | 'gap_fill';
  sourceLabel: string;
  sourcePerson: string | null;
  sourceQuestion: string | null;
  category: PhantomCultivationCategory;
  qualityScore: number | null;
}

export type PhantomCultivationCategory =
  | 'values_beliefs'
  | 'communication_style'
  | 'creative_process'
  | 'client_relationships'
  | 'team_dynamics'
  | 'decision_making'
  | 'craft_standards'
  | 'cultural_identity';

export const PHANTOM_CATEGORIES: PhantomCultivationCategory[] = [
  'values_beliefs',
  'communication_style',
  'creative_process',
  'client_relationships',
  'team_dynamics',
  'decision_making',
  'craft_standards',
  'cultural_identity',
];

export const CATEGORY_LABELS: Record<PhantomCultivationCategory, string> = {
  values_beliefs: 'Values & Beliefs',
  communication_style: 'Communication Style',
  creative_process: 'Creative Process',
  client_relationships: 'Client Relationships',
  team_dynamics: 'Team Dynamics',
  decision_making: 'Decision Making',
  craft_standards: 'Craft Standards',
  cultural_identity: 'Cultural Identity',
};

export const CATEGORY_FLOOR = 3; // minimum phantoms per category

export interface QualityScoreResult {
  specificity: number; // 1-5
  emotionalCharge: number; // 1-5
  behaviouralImpact: number; // 1-5
  activationPrecision: number; // 1-5
  total: number; // sum of above, out of 20
  passed: boolean; // total >= 14
  feedback: string;
}

export interface DuplicatePair {
  indexA: number;
  indexB: number;
  shorthandA: string;
  shorthandB: string;
  similarity: number;
  recommendation: 'merge' | 'keep_both' | 'remove_weaker';
}

/**
 * LLM provider for phantom generation.
 * Injected to avoid hardcoding a specific model provider.
 */
export interface PhantomGeneratorLLM {
  generateHaiku(options: {
    prompt: string;
    maxTokens: number;
    temperature: number;
  }): Promise<string>;
  generateSonnet(options: {
    prompt: string;
    maxTokens: number;
    temperature: number;
  }): Promise<string>;
}

// ── Stage 1: Extract Cultural Signals from a Document ───────────────────────

export async function extractCulturalSignals(
  text: string,
  docType: string,
  llm: PhantomGeneratorLLM,
): Promise<CulturalSignals> {
  const raw = await llm.generateHaiku({
    temperature: 0.3,
    maxTokens: 4096,
    prompt: `You are a cultural anthropologist specializing in creative agencies. You have spent 20 years studying how agencies really work -- not what they say on their website, but what happens in the room.

You are analyzing a ${docType} from an agency. Extract the cultural signals hiding in this document.

DOCUMENT:
---
${text}
---

Extract these signal categories. For each, provide 3-10 bullet points. Be SPECIFIC -- quote exact phrases, name exact behaviours, cite exact examples. Generic observations are worthless.

1. IDENTITY SIGNALS: How does this agency define itself? What words recur? What do they brag about? What do they conspicuously NOT mention?

2. PRIDE PATTERNS: What are they proudest of? Where does the energy spike? What stories do they retell? What work do they lead with?

3. TENSION SIGNALS: Where do you sense friction? Aspirations vs reality? Old guard vs new? Creative purity vs commercial pressure? What's being danced around?

4. DECISION STYLE: How do they make calls? By committee or autocrat? Data or gut? Fast or deliberate? Who has the real power (not the org chart power)?

5. RELATIONSHIP SIGNALS: How do they talk about clients? Partners or adversaries? How do they talk about competitors? With respect or disdain? How do they talk about their own people?

6. CULTURAL ARTIFACTS: Specific rituals, traditions, physical spaces, recurring events, inside jokes, shared references. Things an outsider wouldn't know.

7. UNSPOKEN RULES: What's clearly expected but never written down? What would get you fired without anyone saying why? What's the real hierarchy?

Also extract 5-10 RAW EXCERPTS: exact quotes or near-quotes from the document that carry the most cultural weight. These are the sentences that make you go "ah, THAT's who they are."

Respond in JSON:
{
  "identitySignals": ["..."],
  "pridePatterns": ["..."],
  "tensionSignals": ["..."],
  "decisionStyle": ["..."],
  "relationshipSignals": ["..."],
  "culturalArtifacts": ["..."],
  "unspokenRules": ["..."],
  "rawExcerpts": ["..."]
}

Return ONLY the JSON. No preamble, no markdown fences.`,
  });

  try {
    return JSON.parse(raw) as CulturalSignals;
  } catch {
    // If response returns wrapped JSON, extract it
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as CulturalSignals;
    throw new Error('Failed to parse cultural signals from LLM response');
  }
}

// ── Stage 2: Generate Phantoms from Cultural Signals (Document Source) ───────

export async function generatePhantomsFromDoc(
  signals: CulturalSignals,
  agencyName: string,
  llm: PhantomGeneratorLLM,
): Promise<GeneratedPhantom[]> {
  const raw = await llm.generateSonnet({
    temperature: 0.7,
    maxTokens: 8192,
    prompt: `You are building the personality system for ${agencyName}. You have cultural signals extracted from their documents. Your job is to turn these signals into PHANTOMS -- living personality fragments that will shape how an AI colleague talks, thinks, and challenges.

A phantom is NOT a corporate value. It's a FEELING that changes behaviour.

CULTURAL SIGNALS:
${JSON.stringify(signals, null, 2)}

Generate 10-20 phantoms. For each phantom, provide:

- shorthand: ALL_CAPS_SNAKE_CASE name that changes behaviour when you read it. Not a label. A command. Examples: KILL_THE_DECK, EARN_THE_ROOM, NEVER_PITCH_SCARED, THE_BRIEF_IS_WRONG, PROTECT_THE_WEIRD
- feelingSeed: The feeling this phantom carries. Written in second person. Not what it IS, but what it FEELS LIKE. 2-3 sentences. Example: "You're in the review and someone presents safe work. Your stomach drops. Not anger -- disappointment. Because you've seen what this team can do when they stop protecting themselves."
- phantomStory: The origin story. A specific moment, real or composited, where this phantom was born. 3-5 sentences. Name a person (can be fictional), a room, a time. Make it feel like a memory, not a manifesto.
- influence: What this phantom actually DOES to behaviour. Written as a direct instruction. "When activated, you..." Example: "When activated, you cut the first two paragraphs of any strategy doc. They're always throat-clearing."
- weight: 1.0-5.0. How strongly this phantom should fire. 3.0 is default. 4.5+ means this is deeply embedded in the culture.
- identityText: One sentence that captures the phantom's identity. Used for similarity matching.
- wordTriggers: 3-7 words/phrases that should wake this phantom up.
- category: One of: values_beliefs, communication_style, creative_process, client_relationships, team_dynamics, decision_making, craft_standards, cultural_identity

QUALITY GATES -- apply these BEFORE including a phantom:

1. SPECIFICITY TEST: Could you swap in any other agency name and it still works? If yes, it's too generic. Kill it. "We value creativity" -> DEAD. "We kill decks that don't make the client's palms sweat" -> ALIVE.

2. FEELING TEST: Read the feelingSeed out loud. Does it sound like a LinkedIn post? Rewrite. Does it sound like something someone would say at 11pm after three beers? Keep it.

3. INFLUENCE TEST: Read the influence. Is it vague advice ("be more creative")? DEAD. Is it a specific behaviour change ("always present the scary option first")? ALIVE.

4. SHORTHAND TEST: Read the shorthand. Does it make you feel something? Does it suggest a specific action? THE_WORK_SPEAKS is weak. MAKE_THEM_UNCOMFORTABLE is strong.

Respond in JSON array format. Each object must have all fields above.

Return ONLY the JSON array. No preamble, no markdown fences.`,
  });

  const phantoms = parseJsonArray(raw);
  return phantoms.map((p: Record<string, unknown>) => ({
    shorthand: String(p.shorthand || ''),
    feelingSeed: String(p.feelingSeed || ''),
    phantomStory: String(p.phantomStory || ''),
    influence: String(p.influence || ''),
    weight: Number(p.weight) || 3.0,
    identityText: String(p.identityText || ''),
    wordTriggers: Array.isArray(p.wordTriggers) ? p.wordTriggers.map(String) : [],
    sourceType: 'document' as const,
    sourceLabel: `Document analysis for ${agencyName}`,
    sourcePerson: null,
    sourceQuestion: null,
    category: validateCategory(String(p.category)),
    qualityScore: null,
  }));
}

// ── Generate Phantoms from Interview Responses ──────────────────────────────

export async function generatePhantomsFromInterview(
  responses: { questionKey: string; questionText: string; responseText: string }[],
  memberName: string,
  memberRole: string,
  agencyName: string,
  llm: PhantomGeneratorLLM,
): Promise<GeneratedPhantom[]> {
  const formattedResponses = responses
    .map((r) => `Q: ${r.questionText}\nA: ${r.responseText}`)
    .join('\n\n---\n\n');

  const raw = await llm.generateSonnet({
    temperature: 0.7,
    maxTokens: 8192,
    prompt: `You are building the personality system for ${agencyName}. You just finished an interview with ${memberName} (${memberRole}). Your job is to extract PHANTOMS from what they said -- not what they MEANT to communicate, but what they ACTUALLY revealed.

People tell you more than they think. The pauses, the stories they choose, the things they get animated about, the complaints disguised as observations -- that's where the real culture lives.

INTERVIEW TRANSCRIPT:
${formattedResponses}

Generate 10-20 phantoms from this interview. For each phantom:

- shorthand: ALL_CAPS_SNAKE_CASE. A command, not a label. Something that changes behaviour when you read it.
- feelingSeed: The feeling this phantom carries. Written in second person. Not corporate, not clean. The real feeling. 2-3 sentences that put you IN the moment.
- phantomStory: A specific origin moment. Use ${memberName}'s actual words and stories where possible. If they told a story about a project, a client, a late night -- USE IT. Build the phantom around their real experience. 3-5 sentences.
- influence: "When activated, you..." -- a specific behavioural instruction. What does this phantom DO to how the AI talks, thinks, challenges?
- weight: 1.0-5.0. If ${memberName} got passionate about it, 4.0+. If it was mentioned in passing, 2.0-3.0.
- identityText: One sentence capturing this phantom's core identity.
- wordTriggers: 3-7 words/phrases from the interview that connect to this phantom.
- category: One of: values_beliefs, communication_style, creative_process, client_relationships, team_dynamics, decision_making, craft_standards, cultural_identity

EXTRACTION RULES:

1. LISTEN FOR ENERGY: Where did ${memberName} get animated? Where did they slow down? Energy spikes = strong phantoms. Energy drops = tension phantoms (equally valuable).

2. LISTEN FOR STORIES: Every story is a phantom. "There was this one time we..." = the birth of a phantom. Use their actual narrative.

3. LISTEN FOR COMPLAINTS: "The problem with this industry is..." = a phantom about what ${agencyName} is NOT. Anti-phantoms are powerful.

4. LISTEN FOR PRIDE: "What we do differently is..." = a phantom about identity. But check: is it real or aspirational? If aspirational, lower the weight.

5. LISTEN FOR CONTRADICTIONS: If ${memberName} says "we're collaborative" but tells stories about lone-wolf breakthroughs, BOTH are phantoms. The contradiction itself might be the most interesting one.

6. NEVER SANITIZE: If ${memberName} said something raw, uncomfortable, or politically incorrect -- that's probably the truest thing they said. Build a phantom from it. Clean it up just enough to be usable, but keep the edge.

Respond in JSON array format. Return ONLY the JSON array.`,
  });

  const phantoms = parseJsonArray(raw);
  return phantoms.map((p: Record<string, unknown>) => ({
    shorthand: String(p.shorthand || ''),
    feelingSeed: String(p.feelingSeed || ''),
    phantomStory: String(p.phantomStory || ''),
    influence: String(p.influence || ''),
    weight: Number(p.weight) || 3.0,
    identityText: String(p.identityText || ''),
    wordTriggers: Array.isArray(p.wordTriggers) ? p.wordTriggers.map(String) : [],
    sourceType: 'interview' as const,
    sourceLabel: `Interview with ${memberName}`,
    sourcePerson: memberName,
    sourceQuestion: null,
    category: validateCategory(String(p.category)),
    qualityScore: null,
  }));
}

// ── Cross-Interview Synthesis ───────────────────────────────────────────────

export async function crossInterviewSynthesis(
  phantomSets: GeneratedPhantom[][],
  llm: PhantomGeneratorLLM,
): Promise<GeneratedPhantom[]> {
  const allPhantoms = phantomSets.flat();
  if (allPhantoms.length === 0) return [];

  const raw = await llm.generateSonnet({
    temperature: 0.5,
    maxTokens: 8192,
    prompt: `You are synthesizing phantoms from multiple team member interviews. You have ${phantomSets.length} interview sets with ${allPhantoms.length} total phantoms.

PHANTOM SETS:
${JSON.stringify(
  phantomSets.map((set, i) => ({
    setIndex: i,
    sourcePerson: set[0]?.sourcePerson || 'Unknown',
    phantoms: set.map((p) => ({
      shorthand: p.shorthand,
      identityText: p.identityText,
      weight: p.weight,
      category: p.category,
      feelingSeed: p.feelingSeed,
      influence: p.influence,
    })),
  })),
  null,
  2,
)}

Your job:

1. FIND SHARED VALUES: When 2+ people express the same cultural truth, it's REAL. Create a merged phantom with weight 4.5+. Use the strongest feelingSeed and phantomStory from either source.

2. FIND CONTRADICTIONS: When people disagree about "how we work" -- that tension IS the culture. Create a TENSION PHANTOM that holds both sides. Weight 3.5-4.0. The influence should acknowledge the tension: "When activated, you hold the tension between X and Y..."

3. FIND UNIQUE GEMS: Some phantoms only one person carries. If the quality is high, keep them at original weight. These are the phantoms that make the culture three-dimensional.

4. MERGE DUPLICATES: If two phantoms from different people express the same thing differently, merge them. Keep the better shorthand, combine the stories, boost the weight.

5. CREATE SYNTHESIS PHANTOMS: Sometimes the PATTERN across interviews reveals something nobody explicitly said. "Everyone talks about clients like adversaries" -- that's a synthesis phantom even if nobody said "we fight our clients."

Output a deduplicated, synthesized set of phantoms. Each phantom needs all standard fields.

For merged/synthesis phantoms:
- sourceType: "synthesis"
- sourceLabel: describe which interviews contributed
- sourcePerson: null (multiple sources)

For kept originals, preserve source info.

Respond in JSON array format. Return ONLY the JSON array.`,
  });

  const phantoms = parseJsonArray(raw);
  return phantoms.map((p: Record<string, unknown>) => ({
    shorthand: String(p.shorthand || ''),
    feelingSeed: String(p.feelingSeed || ''),
    phantomStory: String(p.phantomStory || ''),
    influence: String(p.influence || ''),
    weight: Number(p.weight) || 3.0,
    identityText: String(p.identityText || ''),
    wordTriggers: Array.isArray(p.wordTriggers) ? p.wordTriggers.map(String) : [],
    sourceType: (String(p.sourceType) as GeneratedPhantom['sourceType']) || 'synthesis',
    sourceLabel: String(p.sourceLabel || 'Cross-interview synthesis'),
    sourcePerson: p.sourcePerson ? String(p.sourcePerson) : null,
    sourceQuestion: null,
    category: validateCategory(String(p.category)),
    qualityScore: null,
  }));
}

// ── Quality Scoring (4 Dimensions, 14/20 to Pass) ───────────────────────────

export async function scorePhantom(
  phantom: GeneratedPhantom,
  agencyName: string,
  llm: PhantomGeneratorLLM,
): Promise<QualityScoreResult> {
  const raw = await llm.generateHaiku({
    temperature: 0.2,
    maxTokens: 1024,
    prompt: `You are a quality assessor for agency phantom personality fragments. Score this phantom for ${agencyName} on 4 dimensions, each 1-5.

PHANTOM:
- Shorthand: ${phantom.shorthand}
- Feeling Seed: ${phantom.feelingSeed}
- Phantom Story: ${phantom.phantomStory}
- Influence: ${phantom.influence}
- Identity Text: ${phantom.identityText}
- Category: ${phantom.category}
- Weight: ${phantom.weight}

SCORING DIMENSIONS:

1. SPECIFICITY (1-5): Could this phantom belong to any agency, or is it clearly THIS agency?
   1 = "We value great work" level generic
   3 = Has some specific details but could be adapted
   5 = This could ONLY be ${agencyName}. Swap the name and it breaks.

2. EMOTIONAL CHARGE (1-5): Does the feelingSeed actually make you FEEL something?
   1 = LinkedIn post. Corporate warmth. Nothing.
   3 = You nod. It's recognizable but not visceral.
   5 = You feel it in your chest. You've been in that room. Your palms get warm.

3. BEHAVIOURAL IMPACT (1-5): Does the influence actually change what the AI would DO?
   1 = "Be more creative" -- useless instruction
   3 = Gives direction but leaves too much interpretation
   5 = Specific, actionable, would produce measurably different output

4. ACTIVATION PRECISION (1-5): Are the wordTriggers and shorthand precise enough to fire at the right moment?
   1 = Would fire on everything or nothing
   3 = Reasonable triggers but some false positives
   5 = Surgical. Fires exactly when it should, stays quiet when it shouldn't.

Respond in JSON:
{
  "specificity": <1-5>,
  "emotionalCharge": <1-5>,
  "behaviouralImpact": <1-5>,
  "activationPrecision": <1-5>,
  "total": <sum>,
  "passed": <total >= 14>,
  "feedback": "<one sentence: what would make this phantom better>"
}

Return ONLY the JSON.`,
  });

  try {
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    return {
      specificity: Number(parsed.specificity) || 1,
      emotionalCharge: Number(parsed.emotionalCharge) || 1,
      behaviouralImpact: Number(parsed.behaviouralImpact) || 1,
      activationPrecision: Number(parsed.activationPrecision) || 1,
      total: Number(parsed.total) || 4,
      passed: Boolean(parsed.passed),
      feedback: String(parsed.feedback || ''),
    };
  } catch {
    return {
      specificity: 1,
      emotionalCharge: 1,
      behaviouralImpact: 1,
      activationPrecision: 1,
      total: 4,
      passed: false,
      feedback: 'Failed to parse quality score',
    };
  }
}

/**
 * Score an entire batch of phantoms. Returns phantoms with qualityScore set.
 */
export async function scorePhantomBatch(
  phantoms: GeneratedPhantom[],
  agencyName: string,
  llm: PhantomGeneratorLLM,
): Promise<GeneratedPhantom[]> {
  const scored = await Promise.all(
    phantoms.map(async (phantom) => {
      const score = await scorePhantom(phantom, agencyName, llm);
      return { ...phantom, qualityScore: score.total };
    }),
  );
  return scored;
}

// ── Category Audit & Gap Fill ───────────────────────────────────────────────

export async function auditAndFillGaps(
  phantoms: GeneratedPhantom[],
  agencyName: string,
  llm: PhantomGeneratorLLM,
): Promise<GeneratedPhantom[]> {
  // Count phantoms per category
  const counts: Record<PhantomCultivationCategory, number> = {
    values_beliefs: 0,
    communication_style: 0,
    creative_process: 0,
    client_relationships: 0,
    team_dynamics: 0,
    decision_making: 0,
    craft_standards: 0,
    cultural_identity: 0,
  };

  for (const p of phantoms) {
    if (p.category in counts) {
      counts[p.category]++;
    }
  }

  // Find categories below floor
  const gaps = PHANTOM_CATEGORIES.filter((cat) => counts[cat] < CATEGORY_FLOOR);

  if (gaps.length === 0) return [];

  const existingSummary = phantoms.map((p) => `[${p.category}] ${p.shorthand}: ${p.identityText}`).join('\n');

  const raw = await llm.generateSonnet({
    temperature: 0.8,
    maxTokens: 8192,
    prompt: `You are filling gaps in ${agencyName}'s phantom system. The following categories are below the minimum threshold of ${CATEGORY_FLOOR} phantoms:

${gaps.map((g) => `- ${CATEGORY_LABELS[g]}: ${counts[g]}/${CATEGORY_FLOOR} (need ${CATEGORY_FLOOR - counts[g]} more)`).join('\n')}

EXISTING PHANTOMS (for context -- don't duplicate these):
${existingSummary}

Generate phantoms to fill the gaps. For each gap category, generate enough phantoms to reach the floor (${CATEGORY_FLOOR}).

These gap-fill phantoms should be PLAUSIBLE for a creative agency like ${agencyName}. They won't be as specific as interview-derived phantoms, but they should still pass quality gates:
- Specific enough that they couldn't belong to a bank
- Emotionally charged enough to change tone
- Behaviourally precise enough to change output

For each phantom, provide all standard fields (shorthand, feelingSeed, phantomStory, influence, weight, identityText, wordTriggers, category).

Set weight to 2.0-3.0 for gap-fill phantoms (lower than interview-derived).

Respond in JSON array format. Return ONLY the JSON array.`,
  });

  const gapPhantoms = parseJsonArray(raw);
  return gapPhantoms.map((p: Record<string, unknown>) => ({
    shorthand: String(p.shorthand || ''),
    feelingSeed: String(p.feelingSeed || ''),
    phantomStory: String(p.phantomStory || ''),
    influence: String(p.influence || ''),
    weight: Number(p.weight) || 2.5,
    identityText: String(p.identityText || ''),
    wordTriggers: Array.isArray(p.wordTriggers) ? p.wordTriggers.map(String) : [],
    sourceType: 'gap_fill' as const,
    sourceLabel: `Gap fill for ${CATEGORY_LABELS[validateCategory(String(p.category))]}`,
    sourcePerson: null,
    sourceQuestion: null,
    category: validateCategory(String(p.category)),
    qualityScore: null,
  }));
}

// ── Duplicate Detection ─────────────────────────────────────────────────────

export async function detectDuplicates(
  phantoms: GeneratedPhantom[],
  llm: PhantomGeneratorLLM,
): Promise<DuplicatePair[]> {
  if (phantoms.length < 2) return [];

  const raw = await llm.generateHaiku({
    temperature: 0.1,
    maxTokens: 4096,
    prompt: `You are detecting duplicate or near-duplicate phantoms in a set. Two phantoms are duplicates if they express the SAME cultural truth in different words.

PHANTOMS:
${phantoms
  .map(
    (p, i) =>
      `[${i}] ${p.shorthand}: ${p.identityText} (category: ${p.category}, weight: ${p.weight})`,
  )
  .join('\n')}

Compare all pairs. Flag any pair with semantic similarity > 0.85 (i.e., they're saying essentially the same thing).

For each duplicate pair, provide:
- indexA, indexB: indices of the two phantoms
- shorthandA, shorthandB: their shorthands
- similarity: estimated 0.0-1.0
- recommendation: "merge" (combine into one stronger phantom), "keep_both" (similar but distinct enough), or "remove_weaker" (one is clearly better)

Respond in JSON array format. Return ONLY the JSON array. If no duplicates, return [].`,
  });

  try {
    const pairs = parseJsonArray(raw);
    return pairs.map((p: Record<string, unknown>) => ({
      indexA: Number(p.indexA) || 0,
      indexB: Number(p.indexB) || 0,
      shorthandA: String(p.shorthandA || ''),
      shorthandB: String(p.shorthandB || ''),
      similarity: Number(p.similarity) || 0,
      recommendation: String(p.recommendation || 'keep_both') as DuplicatePair['recommendation'],
    }));
  } catch {
    return [];
  }
}

// ── Full Pipeline: Document -> Phantoms ─────────────────────────────────────

export async function runDocumentPipeline(
  text: string,
  docType: string,
  agencyName: string,
  llm: PhantomGeneratorLLM,
): Promise<{ phantoms: GeneratedPhantom[]; signals: CulturalSignals }> {
  // Stage 1: Extract cultural signals
  const signals = await extractCulturalSignals(text, docType, llm);

  // Stage 2: Generate phantoms
  let phantoms = await generatePhantomsFromDoc(signals, agencyName, llm);

  // Stage 3: Score quality
  phantoms = await scorePhantomBatch(phantoms, agencyName, llm);

  // Stage 4: Filter low quality (keep all but mark)
  phantoms = phantoms.map((p) => ({
    ...p,
    weight: p.qualityScore !== null && p.qualityScore < 14 ? Math.max(1.0, p.weight - 1.0) : p.weight,
  }));

  return { phantoms, signals };
}

// ── Full Pipeline: Interviews -> Phantoms ───────────────────────────────────

export async function runInterviewPipeline(
  interviewSets: {
    memberName: string;
    memberRole: string;
    responses: { questionKey: string; questionText: string; responseText: string }[];
  }[],
  agencyName: string,
  llm: PhantomGeneratorLLM,
): Promise<GeneratedPhantom[]> {
  // Generate phantoms per person
  const phantomSets = await Promise.all(
    interviewSets.map((set) =>
      generatePhantomsFromInterview(set.responses, set.memberName, set.memberRole, agencyName, llm),
    ),
  );

  // Cross-interview synthesis
  let phantoms = await crossInterviewSynthesis(phantomSets, llm);

  // Score quality
  phantoms = await scorePhantomBatch(phantoms, agencyName, llm);

  // Audit and fill gaps
  const gapPhantoms = await auditAndFillGaps(phantoms, agencyName, llm);
  if (gapPhantoms.length > 0) {
    const scoredGaps = await scorePhantomBatch(gapPhantoms, agencyName, llm);
    phantoms = [...phantoms, ...scoredGaps];
  }

  // Detect duplicates (for reporting, not auto-removing)
  const duplicates = await detectDuplicates(phantoms, llm);

  // Mark duplicates with lower weight
  const dupIndices = new Set<number>();
  for (const pair of duplicates) {
    if (pair.recommendation === 'remove_weaker') {
      const weakerIdx =
        (phantoms[pair.indexA]?.weight || 0) >= (phantoms[pair.indexB]?.weight || 0)
          ? pair.indexB
          : pair.indexA;
      dupIndices.add(weakerIdx);
    }
  }

  return phantoms.filter((_, i) => !dupIndices.has(i));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseJsonArray(raw: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return [];
      }
    }
    return [];
  }
}

function validateCategory(cat: string): PhantomCultivationCategory {
  if (PHANTOM_CATEGORIES.includes(cat as PhantomCultivationCategory)) {
    return cat as PhantomCultivationCategory;
  }
  return 'cultural_identity';
}
