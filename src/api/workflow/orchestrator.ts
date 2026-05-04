/**
 * Workflow Orchestrator - State machine for guided creative pipeline
 *
 * Manages the brief-to-copy-suite flow:
 * INITIAL > BRIEF_EXTRACTED > STRATEGY > TERRITORIES > TERRITORY_SELECTED >
 * BIG_IDEA > BIG_IDEA_SELECTED > COPY_SUITE > DONE
 *
 * Ported from: ~/aiden-api/app/workflow/orchestrator.py
 */

import crypto from 'node:crypto';
import { WorkflowStep, ASYNC_STEPS, type WorkflowSession, sessionStore } from './session.js';
import { Intent, detectIntent, extractSelection } from './intent.js';
import { jobStore } from '../jobs/store.js';
import { submitJob } from '../jobs/runner.js';
import { processMessage } from '../../brain/nuclear-brain.js';
import { createBrainServices } from '../service-factory.js';

// ── Response type ─────────────────────────────────────────────────────────────

interface WorkflowResponse {
  session_id: string;
  step: string;
  message: string;
  job_id?: string;
  poll_url?: string;
  complete?: boolean;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleWorkflowMessage(
  session: WorkflowSession,
  message: string,
): Promise<WorkflowResponse> {
  session.messages.push({ role: 'user', content: message });

  // Check if active job completed
  if (session.active_job_id && ASYNC_STEPS.has(session.step)) {
    await checkAndAdvance(session);
  }

  const intent = detectIntent(session.step, message);

  let response: WorkflowResponse;

  switch (intent) {
    case Intent.HELP:
      response = handleHelp(session);
      break;
    case Intent.RESET:
      response = handleReset(session);
      break;
    case Intent.CHECK_STATUS:
      response = await handleCheckStatus(session);
      break;
    case Intent.PROVIDE_BRIEF:
      response = await handleProvideBrief(session, message);
      break;
    case Intent.SELECT:
      response = handleSelect(session, message);
      break;
    case Intent.SET_FORMATS:
      response = handleSetFormats(session, message);
      break;
    case Intent.ADVANCE:
      response = await handleAdvance(session);
      break;
    default:
      response = {
        session_id: session.id,
        step: session.step,
        message: "I didn't understand that. Say 'help' for available commands.",
      };
  }

  session.messages.push({ role: 'assistant', content: response.message });
  await sessionStore.save(session);
  return response;
}

// ── Intent handlers ───────────────────────────────────────────────────────────

function handleHelp(session: WorkflowSession): WorkflowResponse {
  const commands = [
    'Paste your brief to start.',
    '"next" or "generate" to advance to the next step.',
    '"1", "2", "3" etc to select an option.',
    '"status" to check job progress.',
    '"reset" to start over.',
  ];
  return {
    session_id: session.id,
    step: session.step,
    message: `Current step: ${session.step}\n\nCommands:\n${commands.map(c => `- ${c}`).join('\n')}`,
  };
}

function handleReset(session: WorkflowSession): WorkflowResponse {
  session.step = WorkflowStep.INITIAL;
  session.brief_data = null;
  session.strategy = null;
  session.territories = null;
  session.selected_territory = null;
  session.selected_territory_index = null;
  session.big_ideas = null;
  session.selected_big_idea = null;
  session.selected_big_idea_index = null;
  session.copy_suite = null;
  session.active_job_id = null;
  session.messages = [];
  return {
    session_id: session.id,
    step: WorkflowStep.INITIAL,
    message: 'Session reset. Paste your brief to begin.',
  };
}

async function handleCheckStatus(session: WorkflowSession): Promise<WorkflowResponse> {
  if (!session.active_job_id) {
    return {
      session_id: session.id,
      step: session.step,
      message: 'No active job. Say "next" to advance.',
    };
  }

  const job = await jobStore.get(session.active_job_id, session.tenant_id);
  if (!job) {
    session.active_job_id = null;
    return {
      session_id: session.id,
      step: session.step,
      message: 'Job not found. Say "next" to retry.',
    };
  }

  if (job.status === 'completed') {
    applyJobResult(session, job.data);
    session.active_job_id = null;
    return {
      session_id: session.id,
      step: session.step,
      message: getStepReadyMessage(session),
    };
  }

  if (job.status === 'failed') {
    session.active_job_id = null;
    return {
      session_id: session.id,
      step: session.step,
      message: `Generation failed: ${job.error}. Say "next" to retry.`,
    };
  }

  return {
    session_id: session.id,
    step: session.step,
    message: `Still working... (status: ${job.status})`,
    job_id: session.active_job_id,
    poll_url: `/api/v1/jobs/${session.active_job_id}/status`,
  };
}

async function handleProvideBrief(session: WorkflowSession, message: string): Promise<WorkflowResponse> {
  // Extract brief data from the message using the brain
  session.brief_data = { raw_brief: message };
  session.step = WorkflowStep.BRIEF_EXTRACTED;
  return {
    session_id: session.id,
    step: session.step,
    message: 'Brief received. Say "next" to generate strategy.',
  };
}

function handleSelect(session: WorkflowSession, message: string): WorkflowResponse {
  const selection = extractSelection(message);
  if (selection === null) {
    return {
      session_id: session.id,
      step: session.step,
      message: 'Could not parse selection. Use a number (1, 2, 3...).',
    };
  }

  if (session.step === WorkflowStep.TERRITORIES_READY) {
    session.selected_territory = extractNumberedChoice(session.territories, selection) ?? `Territory ${selection}`;
    session.selected_territory_index = selection;
    session.step = WorkflowStep.TERRITORY_SELECTED;
    return {
      session_id: session.id,
      step: session.step,
      message: `Territory ${selection} selected. Say "next" to generate big ideas.`,
    };
  }

  if (session.step === WorkflowStep.BIG_IDEA_READY) {
    session.selected_big_idea = extractNumberedChoice(session.big_ideas, selection) ?? `Big Idea ${selection}`;
    session.selected_big_idea_index = selection;
    session.step = WorkflowStep.BIG_IDEA_SELECTED;
    return {
      session_id: session.id,
      step: session.step,
      message: `Big idea ${selection} selected. Say "next" to generate copy suite, or specify formats first (e.g. "social, youtube, print").`,
    };
  }

  return {
    session_id: session.id,
    step: session.step,
    message: 'Nothing to select at this step.',
  };
}

function handleSetFormats(session: WorkflowSession, message: string): WorkflowResponse {
  const formats = message.toLowerCase().match(/\b(social|headlines|youtube|print|ooh|radio|tv|email|banner|digital|video|script)\b/gi);
  if (formats && formats.length > 0) {
    session.selected_formats = [...new Set(formats.map(f => f.toLowerCase()))];
  }
  return {
    session_id: session.id,
    step: session.step,
    message: `Formats set: ${session.selected_formats.join(', ')}. Say "next" to generate.`,
  };
}

async function handleAdvance(session: WorkflowSession): Promise<WorkflowResponse> {
  const tenantId = session.tenant_id;
  const services = createBrainServices();

  switch (session.step) {
    case WorkflowStep.BRIEF_EXTRACTED:
    case WorkflowStep.STRATEGY_READY: {
      // Generate strategy or territories
      const isStrategy = session.step === WorkflowStep.BRIEF_EXTRACTED;
      const nextStep = isStrategy ? WorkflowStep.STRATEGY_GENERATING : WorkflowStep.TERRITORIES_GENERATING;
      session.step = nextStep;

      const jobId = `job-${crypto.randomUUID()}`;
      await jobStore.create({ id: jobId, tenant_id: tenantId, endpoint: 'workflow' });
      session.active_job_id = jobId;

      const prompt = isStrategy
        ? `Generate creative strategy for this brief: ${JSON.stringify(session.brief_data)}`
        : `Generate 3 creative territories based on this strategy: ${session.strategy}`;

      submitJob(jobId, async () => {
        const response = await processMessage(
          { message: prompt, conversationId: session.campaign_id, agencyId: tenantId, personalityMode: 'challenger' },
          services,
        );
        return { content: response.text };
      });

      return {
        session_id: session.id,
        step: session.step,
        message: `Generating ${isStrategy ? 'strategy' : 'territories'}...`,
        job_id: jobId,
        poll_url: `/api/v1/jobs/${jobId}/status`,
      };
    }

    case WorkflowStep.TERRITORY_SELECTED: {
      session.step = WorkflowStep.BIG_IDEA_GENERATING;
      const jobId = `job-${crypto.randomUUID()}`;
      await jobStore.create({ id: jobId, tenant_id: tenantId, endpoint: 'workflow' });
      session.active_job_id = jobId;

      submitJob(jobId, async () => {
        const response = await processMessage(
          {
            message: buildBigIdeaPrompt(session),
            conversationId: session.campaign_id,
            agencyId: tenantId,
            personalityMode: 'collaborator',
          },
          services,
        );
        return { content: response.text };
      });

      return {
        session_id: session.id,
        step: session.step,
        message: 'Generating big ideas...',
        job_id: jobId,
        poll_url: `/api/v1/jobs/${jobId}/status`,
      };
    }

    case WorkflowStep.BIG_IDEA_SELECTED: {
      session.step = WorkflowStep.COPY_SUITE_GENERATING;
      const jobId = `job-${crypto.randomUUID()}`;
      await jobStore.create({ id: jobId, tenant_id: tenantId, endpoint: 'workflow' });
      session.active_job_id = jobId;

      submitJob(jobId, async () => {
        const response = await processMessage(
          {
            message: buildCopySuitePrompt(session),
            conversationId: session.campaign_id,
            agencyId: tenantId,
            personalityMode: 'collaborator',
          },
          services,
        );
        return { content: response.text };
      });

      return {
        session_id: session.id,
        step: session.step,
        message: `Generating copy suite (${session.selected_formats.join(', ')})...`,
        job_id: jobId,
        poll_url: `/api/v1/jobs/${jobId}/status`,
      };
    }

    case WorkflowStep.COPY_SUITE_READY: {
      session.step = WorkflowStep.DONE;
      return {
        session_id: session.id,
        step: session.step,
        message: 'Pipeline complete. Your creative output is ready.',
        complete: true,
      };
    }

    default:
      return {
        session_id: session.id,
        step: session.step,
        message: `Cannot advance from step "${session.step}". Check status or provide input.`,
      };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function briefText(session: WorkflowSession): string {
  if (!session.brief_data) return '';
  const raw = session.brief_data.raw_brief;
  if (typeof raw === 'string') return raw;
  return JSON.stringify(session.brief_data);
}

function buildBigIdeaPrompt(session: WorkflowSession): string {
  return [
    'Generate 3 big ideas for the selected territory.',
    `Brief: ${briefText(session)}`,
    `Strategy: ${session.strategy || ''}`,
    `Selected territory: ${session.selected_territory || ''}`,
    session.territories ? `All territories considered: ${session.territories}` : '',
    'Keep the ideas specific to the brand, audience, product, and campaign objective in the brief.',
    'No preamble. No next-step offer. No "if you want". No recap of hidden working.',
    'Use exactly 3 numbered ideas. Keep each idea under 120 words.',
    'For each idea include: name, one-line idea, why it fits, likely visual behaviour.',
  ].filter(Boolean).join('\n');
}

function buildCopySuitePrompt(session: WorkflowSession): string {
  return [
    'Generate the copy handoff for the selected big idea.',
    `Brief: ${briefText(session)}`,
    `Strategy: ${session.strategy || ''}`,
    `Selected territory: ${session.selected_territory || ''}`,
    `Selected big idea: ${session.selected_big_idea || ''}`,
    `Formats: ${session.selected_formats.join(', ')}`,
    'Write copy that belongs to the selected idea and can be used directly in client-facing ad executions.',
    'Do not return a full copy deck, channel matrix, carousel library, YouTube suite, packaging suite, or optional next steps.',
    'Return one recommended execution only. If formats include multiple channels, choose the strongest execution that can adapt later.',
    'No preamble. No "Hell yes". No "let\'s make it real". No "if you want". No explanation of your process.',
    'Keep the whole response under 450 words.',
    'Use exactly these headings:',
    'Recommended execution',
    'What happens',
    'On-ad copy',
    'Headline:',
    'Body:',
    'CTA:',
    'Textless image direction',
    'Overlay notes',
    'Why this is the route',
  ].filter(Boolean).join('\n');
}

function numberedChoiceMatch(line: string): RegExpMatchArray | null {
  return line.match(/^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?(?:(?:option|route|territory|big idea|idea)\s*)?(\d+)\s*[\).:\-]\s*(.*)$/i);
}

function cleanChoiceText(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNumberedChoice(source: string | null, selection: number): string | null {
  if (!source) return null;
  const lines = source.split(/\r?\n/);
  let start = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const match = numberedChoiceMatch(lines[i] || '');
    if (match && Number(match[1]) === selection) {
      start = i;
      break;
    }
  }

  if (start === -1) return null;

  const selected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] || '';
    const match = numberedChoiceMatch(line);
    if (i !== start && match) break;
    selected.push(i === start && match ? match[2] || '' : line);
  }

  const text = cleanChoiceText(selected.join('\n'));
  return text || null;
}

async function checkAndAdvance(session: WorkflowSession): Promise<void> {
  if (!session.active_job_id) return;
  const job = await jobStore.get(session.active_job_id, session.tenant_id);
  if (!job) {
    session.active_job_id = null;
    return;
  }
  if (job.status === 'completed') {
    applyJobResult(session, job.data);
    session.active_job_id = null;
  }
}

function applyJobResult(session: WorkflowSession, data: unknown): void {
  const result = data as Record<string, unknown>;
  const content = (result?.content as string) || '';

  switch (session.step) {
    case WorkflowStep.STRATEGY_GENERATING:
      session.strategy = content;
      session.step = WorkflowStep.STRATEGY_READY;
      break;
    case WorkflowStep.TERRITORIES_GENERATING:
      session.territories = content;
      session.step = WorkflowStep.TERRITORIES_READY;
      break;
    case WorkflowStep.BIG_IDEA_GENERATING:
      session.big_ideas = content;
      session.step = WorkflowStep.BIG_IDEA_READY;
      break;
    case WorkflowStep.COPY_SUITE_GENERATING:
      session.copy_suite = content;
      session.step = WorkflowStep.COPY_SUITE_READY;
      break;
  }
}

function getStepReadyMessage(session: WorkflowSession): string {
  switch (session.step) {
    case WorkflowStep.STRATEGY_READY:
      return `Strategy ready:\n\n${session.strategy?.slice(0, 500)}...\n\nSay "next" to generate territories.`;
    case WorkflowStep.TERRITORIES_READY:
      return `Territories ready:\n\n${session.territories?.slice(0, 500)}...\n\nSelect one (1, 2, 3...).`;
    case WorkflowStep.BIG_IDEA_READY:
      return `Big ideas ready:\n\n${session.big_ideas?.slice(0, 500)}...\n\nSelect one (1, 2, 3...).`;
    case WorkflowStep.COPY_SUITE_READY:
      return `Copy suite ready:\n\n${session.copy_suite?.slice(0, 500)}...\n\nSay "next" to finish.`;
    default:
      return 'Ready. Say "next" to continue.';
  }
}
