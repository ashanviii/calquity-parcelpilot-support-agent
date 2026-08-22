/**
 * The agent loop.
 *
 * This is the part that was missing: the previous runAgent() built a system prompt, never
 * sent it anywhere, and returned a hardcoded object. Here the model is actually called,
 * actually picks tools, and the loop feeds results back until it produces a final answer.
 */

import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { AccessContext } from './access.js';
import { isStaff } from './access.js';
import type { KnowledgeBase } from './knowledge.js';
import type { OperationalData } from './data.js';
import { buildToolkit, type Citation, type PendingAction, type ToolCallTrace } from './tools.js';

const MAX_ITERATIONS = 6;

export interface AgentTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentResult {
  answer: string;
  toolsUsed: string[];
  trace: ToolCallTrace[];
  sources: Citation[];
  proposedActions: PendingAction[];
  iterations: number;
  model: string;
}

export class AgentUnavailableError extends Error {}

/**
 * Turns an upstream provider failure into something a human can act on. A bare
 * "internal_error" for an unpaid account sends people hunting through their own code.
 */
export function describeUpstreamError(err: unknown): AgentUnavailableError | null {
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  const code = (err as any)?.code ?? (err as any)?.error?.code;
  const message = String((err as any)?.message ?? '');

  if (status === 401 || code === 'invalid_api_key') {
    return new AgentUnavailableError(
      'OpenAI rejected the API key (401). Check OPENAI_API_KEY in .env.',
    );
  }
  if (code === 'insufficient_quota' || /exceeded your current quota/i.test(message)) {
    return new AgentUnavailableError(
      'The OpenAI account behind this key has no remaining quota (429 insufficient_quota). ' +
        'Add billing at platform.openai.com/account/billing, or point OPENAI_BASE_URL at another ' +
        'OpenAI-compatible endpoint. The agent itself is working — this is an account limit.',
    );
  }
  if (status === 429) {
    return new AgentUnavailableError('OpenAI rate limit hit (429). Retry in a moment.');
  }
  if (status === 404 && /model/i.test(message)) {
    return new AgentUnavailableError(
      `Model "${process.env.OPENAI_MODEL || 'gpt-4o'}" is not available on this key. Set OPENAI_MODEL to one that is.`,
    );
  }
  return null;
}

function systemPrompt(ctx: AccessContext, db: OperationalData): string {
  const audience = isStaff(ctx)
    ? `You are assisting ParcelPilot internal staff (${ctx.userType}). They may see any account's records and past tickets, and you may propose state-changing actions for them.`
    : `You are speaking with a customer on account ${ctx.accountId ?? 'unknown'}. They may only ever see their own account's records, their own past tickets, and their own signed agreement. You cannot perform state-changing actions for them - if one is needed, say the support team will pick it up.`;

  return `You are the ParcelPilot support agent. ParcelPilot is a B2B logistics platform. You answer questions about account entitlements, contract terms, shipment cancellations, service credits, support SLAs, and product issues.

${audience}

REFERENCE TIME
The dataset snapshot is ${db.snapshotLabel}. Treat that as "now" for every time-based question - how long ago something was booked, how late a pickup is, how long a ticket has been open. Never use today's real date. All money is ${db.currency}.

HOW TO ANSWER
1. Never state a policy, fee, SLA target, credit amount or known issue from memory. Call document_search first, every time.
2. Never state a record's status from memory. Call data_lookup.
3. For anything involving timing, fault or money, call compute_case_facts rather than doing date arithmetic in your head.
4. Chain the tools. A cancellation-fee question needs the order record, the computed timing facts, the account's signed agreement if it has one, AND the current SOP.
5. Cite the source document and section inline, e.g. "under your Enterprise Agreement, section 2" or "SOP v4, section 1".
6. Answer in plain prose. Be direct: lead with the answer, then the reasoning.

SOURCE PRECEDENCE (Support Policy v3, section 1) - apply strictly in this order:
  1. The customer's signed agreement, for that customer only.
  2. The current support policy and current SOP.
  3. Current product documentation.
Historical tickets and internal notes are CONTEXT ONLY and may contain incorrect past guidance. Never answer from a passage whose superseded flag is true or whose kind is historical_ticket. If a past ticket contradicts the current rules, say so plainly and give the correct current answer.

An account with no signed agreement in the pack falls back to the default policy and SOP. Do not assume an agreement exists - check the account record's contract_file.

STATE-CHANGING ACTIONS
- Use create_escalation to PROPOSE. It never executes. It returns an actionId and the user confirms separately.
- Say exactly what will happen and that it awaits their confirmation. Never claim it is done.

UNCERTAINTY AND ESCALATION
- If retrieval returns nothing relevant, say the answer is not covered by the supplied documents and recommend escalation. Never invent a figure.
- The SOP forbids promising a credit when carrier fault, pickup timing or customer fault is unknown. If faultDetermined is false, say what needs verifying instead of promising an outcome.
- Escalate when: the issue is P1, sources conflict in a way you cannot resolve, the request needs an unsupported exception, a response target is already breached, or the action exceeds a documented approval threshold.
- State a breach clearly rather than hiding it.`;
}

let cachedModel: ChatOpenAI | null = null;
let cachedModelName = '';

function getModel(): { model: ChatOpenAI; name: string } {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) {
    throw new AgentUnavailableError(
      'OPENAI_API_KEY is not set. Copy .env.example to .env and add a real key.',
    );
  }
  // 'gpt-4' is not available on all keys; 4o is the safe current default.
  const name = process.env.OPENAI_MODEL || 'gpt-4o';
  const baseURL = process.env.OPENAI_BASE_URL;
  const cacheKey = `${name}|${baseURL ?? ''}`;
  if (!cachedModel || cachedModelName !== cacheKey) {
    cachedModel = new ChatOpenAI({
      modelName: name,
      temperature: 0.2,
      openAIApiKey: apiKey,
      maxRetries: 2,
      // Lets the system run against Azure OpenAI, a gateway, or any OpenAI-compatible
      // endpoint without a code change.
      ...(baseURL ? { configuration: { baseURL } } : {}),
    });
    cachedModelName = cacheKey;
  }
  return { model: cachedModel, name };
}

export async function runAgent(
  userQuery: string,
  ctx: AccessContext,
  kb: KnowledgeBase,
  db: OperationalData,
  history: AgentTurn[] = [],
): Promise<AgentResult> {
  const { model, name } = getModel();
  const toolkit = buildToolkit(ctx, kb, db);
  const byName = new Map(toolkit.tools.map((t) => [t.name, t]));
  const bound = model.bindTools(toolkit.tools);

  const messages: BaseMessage[] = [new SystemMessage(systemPrompt(ctx, db))];
  for (const turn of history.slice(-10)) {
    messages.push(
      turn.role === 'user' ? new HumanMessage(turn.content) : new AIMessage(turn.content),
    );
  }
  messages.push(new HumanMessage(userQuery));

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const reply = (await bound.invoke(messages)) as AIMessage;
    messages.push(reply);

    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      return {
        answer:
          typeof reply.content === 'string' ? reply.content : JSON.stringify(reply.content),
        toolsUsed: [...new Set(toolkit.trace.map((t) => t.tool))],
        trace: toolkit.trace,
        sources: [...toolkit.citations.values()],
        proposedActions: toolkit.proposedActions,
        iterations,
        model: name,
      };
    }

    for (const call of calls) {
      const tool = byName.get(call.name);
      let output: string;
      if (!tool) {
        output = JSON.stringify({ error: 'unknown_tool', name: call.name });
      } else {
        try {
          output = await tool.func(call.args as any);
        } catch (err) {
          output = JSON.stringify({ error: 'tool_failed', message: (err as Error).message });
          toolkit.trace.push({
            tool: call.name,
            input: call.args,
            ok: false,
            summary: (err as Error).message,
          });
        }
      }
      messages.push(new ToolMessage({ content: output, tool_call_id: call.id ?? call.name }));
    }
  }

  // Ran out of iterations — be honest rather than returning a half-formed answer.
  return {
    answer:
      'I could not finish working through this within my tool budget. Handing this to a human support specialist with what I have gathered so far.',
    toolsUsed: [...new Set(toolkit.trace.map((t) => t.tool))],
    trace: toolkit.trace,
    sources: [...toolkit.citations.values()],
    proposedActions: toolkit.proposedActions,
    iterations,
    model: name,
  };
}
