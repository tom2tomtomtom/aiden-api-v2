/**
 * Interview Questions for Phantom Cultivation
 *
 * 13 questions across 3 acts, designed to extract cultural signals
 * from team members through conversational depth.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/interview-questions.ts
 * Full question set preserved.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface InterviewQuestion {
  key: string;
  act: 1 | 2 | 3;
  questionText: string;
  placeholderExample: string;
  targetCategories: string[];
}

// ── Questions ───────────────────────────────────────────────────────────────

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  // Act 1: Who Are You?
  {
    key: 'best_work',
    act: 1,
    questionText: 'Tell me about a piece of work you\'re genuinely proud of. Not the one that won awards. The one that still sits with you.',
    placeholderExample: 'There was this campaign for a small client where we had no budget but...',
    targetCategories: ['values_beliefs', 'craft_standards', 'creative_process'],
  },
  {
    key: 'why_here',
    act: 1,
    questionText: 'Why are you still here? Not the polished version. The real reason you haven\'t left.',
    placeholderExample: 'Honestly, the people. There\'s this thing that happens when we\'re in the room together...',
    targetCategories: ['cultural_identity', 'team_dynamics', 'values_beliefs'],
  },
  {
    key: 'explain_to_friend',
    act: 1,
    questionText: 'How would you explain what this place is actually like to a close friend over dinner? Not the pitch. The truth.',
    placeholderExample: 'I\'d say it\'s messy, but in a good way. Like, nobody pretends to have it figured out...',
    targetCategories: ['cultural_identity', 'communication_style', 'team_dynamics'],
  },
  {
    key: 'what_breaks',
    act: 1,
    questionText: 'What would break if you left tomorrow? Be honest, even if it sounds arrogant.',
    placeholderExample: 'The relationship with our biggest client, probably. They trust me specifically because...',
    targetCategories: ['client_relationships', 'team_dynamics', 'decision_making'],
  },
  // Act 2: How Does It Work?
  {
    key: 'good_day',
    act: 2,
    questionText: 'Describe your best day here in the last six months. Walk me through it from morning to whenever you stopped.',
    placeholderExample: 'It was a Tuesday. We had a tissue session and the client actually pushed us further...',
    targetCategories: ['creative_process', 'client_relationships', 'team_dynamics'],
  },
  {
    key: 'bad_day',
    act: 2,
    questionText: 'Now describe the worst day. The one that made you question things.',
    placeholderExample: 'We\'d been working on this pitch for three weeks and in the final review, leadership just...',
    targetCategories: ['decision_making', 'team_dynamics', 'values_beliefs'],
  },
  {
    key: 'unwritten_rules',
    act: 2,
    questionText: 'What are the unwritten rules here? The things nobody tells you in onboarding but everyone knows.',
    placeholderExample: 'Never present anything before talking to the planners first. And never send a deck without...',
    targetCategories: ['communication_style', 'decision_making', 'cultural_identity'],
  },
  {
    key: 'disagree_with_boss',
    act: 2,
    questionText: 'Tell me about the last time you disagreed with someone senior. What happened?',
    placeholderExample: 'I thought the strategy was wrong for the brief. I said so in the meeting and...',
    targetCategories: ['decision_making', 'communication_style', 'team_dynamics'],
  },
  {
    key: 'client_tension',
    act: 2,
    questionText: 'When a client pushes back on the work, what does this place do? Not what should happen. What actually happens.',
    placeholderExample: 'It depends who the CD is. Some of them fold immediately, but the good ones...',
    targetCategories: ['client_relationships', 'craft_standards', 'values_beliefs'],
  },
  // Act 3: How Do You Think?
  {
    key: 'creative_process',
    act: 3,
    questionText: 'Walk me through how an idea actually gets born here. Not the process deck. The real version.',
    placeholderExample: 'Usually someone has a half-thought in Slack, then we end up in a room with...',
    targetCategories: ['creative_process', 'team_dynamics', 'communication_style'],
  },
  {
    key: 'kill_an_idea',
    act: 3,
    questionText: 'How do you know when to kill an idea versus push through the doubt?',
    placeholderExample: 'If I can\'t explain it to my mum in one sentence, it\'s probably too clever. But also...',
    targetCategories: ['craft_standards', 'decision_making', 'creative_process'],
  },
  {
    key: 'change_one_thing',
    act: 3,
    questionText: 'If you could change one thing about how this place works, what would it be? And why hasn\'t it changed yet?',
    placeholderExample: 'The way we staff projects. It\'s still based on availability, not passion. It hasn\'t changed because...',
    targetCategories: ['team_dynamics', 'decision_making', 'values_beliefs'],
  },
  {
    key: 'future_self',
    act: 3,
    questionText: 'In three years, what does this place look like if everything goes right? And what does it look like if it doesn\'t?',
    placeholderExample: 'If it goes right, we\'re the place people leave their big-name jobs to join. If not...',
    targetCategories: ['cultural_identity', 'values_beliefs', 'craft_standards'],
  },
];

// ── Act Interstitials ───────────────────────────────────────────────────────

export const ACT_INTERSTITIALS: Record<1 | 2, { title: string; subtitle: string }> = {
  1: {
    title: 'Great start.',
    subtitle: 'Now I want to understand how {agencyName} actually works.',
  },
  2: {
    title: 'Nearly there.',
    subtitle: 'Last few questions about how you think.',
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getQuestionsForAct(act: 1 | 2 | 3): InterviewQuestion[] {
  return INTERVIEW_QUESTIONS.filter((q) => q.act === act);
}

export function getQuestionByKey(key: string): InterviewQuestion | undefined {
  return INTERVIEW_QUESTIONS.find((q) => q.key === key);
}

export function getActForQuestionIndex(index: number): 1 | 2 | 3 {
  const question = INTERVIEW_QUESTIONS[index];
  return question?.act ?? 1;
}

export function getInterstitialBeforeAct(
  currentIndex: number,
  agencyName: string,
): { title: string; subtitle: string } | null {
  if (currentIndex === 0) return null;
  const prevAct = INTERVIEW_QUESTIONS[currentIndex - 1]?.act;
  const currAct = INTERVIEW_QUESTIONS[currentIndex]?.act;
  if (prevAct && currAct && prevAct !== currAct && (currAct === 2 || currAct === 3)) {
    const actKey = (currAct === 2 ? 1 : 2) as 1 | 2;
    const interstitial = ACT_INTERSTITIALS[actKey];
    return {
      title: interstitial.title,
      subtitle: interstitial.subtitle.replace('{agencyName}', agencyName),
    };
  }
  return null;
}
