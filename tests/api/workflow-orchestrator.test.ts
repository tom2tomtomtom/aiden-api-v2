import { describe, expect, it, vi } from 'vitest';

const capturedMessages: string[] = [];

vi.mock('../../src/brain/nuclear-brain.js', () => ({
  processMessage: vi.fn(async (input: { message: string }) => {
    capturedMessages.push(input.message);
    return { text: 'Mock Brain output.' };
  }),
}));

import { handleWorkflowMessage } from '../../src/api/workflow/orchestrator.js';
import { WorkflowStep, type WorkflowSession } from '../../src/api/workflow/session.js';

function makeSession(overrides: Partial<WorkflowSession> = {}): WorkflowSession {
  return {
    id: `wf-test-${Math.random().toString(36).slice(2)}`,
    tenant_id: 'tenant-test',
    step: WorkflowStep.INITIAL,
    campaign_id: 'campaign-test',
    brief_data: { raw_brief: 'Kinnon launch. Hero the Amelia weekender.' },
    strategy: null,
    territories: null,
    selected_territory: null,
    big_ideas: null,
    selected_big_idea: null,
    copy_suite: null,
    selected_formats: ['social'],
    active_job_id: null,
    messages: [],
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

describe('Workflow orchestrator', () => {
  it('stores the actual selected territory instead of the numeric placeholder', async () => {
    const session = makeSession({
      step: WorkflowStep.TERRITORIES_READY,
      territories: [
        '1. Quiet authority',
        'Kinnon behaves like the bag that has nothing to prove.',
        '',
        '2. Useful rebellion',
        'For people rejecting loud-logo luxury.',
      ].join('\n'),
    });

    await handleWorkflowMessage(session, '1');

    expect(session.selected_territory).toContain('Quiet authority');
    expect(session.selected_territory).toContain('nothing to prove');
    expect(session.selected_territory).not.toBe('Territory 1');
    expect((session as unknown as { selected_territory_index?: number }).selected_territory_index).toBe(1);
  });

  it('stores the actual selected big idea instead of the numeric placeholder', async () => {
    const session = makeSession({
      step: WorkflowStep.BIG_IDEA_READY,
      big_ideas: [
        '1. Carried well',
        'A world of composed travel moments where the bag quietly carries the day.',
        '',
        '2. Made for movement',
        'Every frame catches the bag already in use.',
      ].join('\n'),
    });

    await handleWorkflowMessage(session, '1');

    expect(session.selected_big_idea).toContain('Carried well');
    expect(session.selected_big_idea).toContain('carries the day');
    expect(session.selected_big_idea).not.toBe('Big Idea 1');
    expect((session as unknown as { selected_big_idea_index?: number }).selected_big_idea_index).toBe(1);
  });

  it('includes brief, strategy, and selected route in the big idea prompt', async () => {
    capturedMessages.length = 0;
    const session = makeSession({
      step: WorkflowStep.TERRITORY_SELECTED,
      strategy: 'Position Kinnon around quiet, practical confidence for Melbourne travellers.',
      selected_territory: 'Quiet authority. Kinnon has nothing to prove.',
    });

    await handleWorkflowMessage(session, 'next');

    await vi.waitFor(() => expect(capturedMessages.length).toBe(1));
    expect(capturedMessages[0]).toContain('Kinnon');
    expect(capturedMessages[0]).toContain('Amelia weekender');
    expect(capturedMessages[0]).toContain('quiet, practical confidence');
    expect(capturedMessages[0]).toContain('Quiet authority');
  });

  it('includes brief, strategy, selected route, and selected idea in the copy prompt', async () => {
    capturedMessages.length = 0;
    const session = makeSession({
      step: WorkflowStep.BIG_IDEA_SELECTED,
      strategy: 'Position Kinnon around quiet, practical confidence for Melbourne travellers.',
      selected_territory: 'Quiet authority. Kinnon has nothing to prove.',
      selected_big_idea: 'Carried well. The bag quietly carries the day.',
    });

    await handleWorkflowMessage(session, 'next');

    await vi.waitFor(() => expect(capturedMessages.length).toBe(1));
    expect(capturedMessages[0]).toContain('Kinnon');
    expect(capturedMessages[0]).toContain('Amelia weekender');
    expect(capturedMessages[0]).toContain('quiet, practical confidence');
    expect(capturedMessages[0]).toContain('Quiet authority');
    expect(capturedMessages[0]).toContain('Carried well');
  });
});
