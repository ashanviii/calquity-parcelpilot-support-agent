/**
 * Agent tools. Four distinct tools: document retrieval, structured-data lookup, a
 * calculation tool over that data, and a state-changing action that always requires
 * confirmation. Every tool re-checks access against the caller's context — nothing here
 * trusts the model to have respected the system prompt.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { canPerformAction, canReadRecord, isStaff, type AccessContext } from './access.js';
import {
  cancellationFacts,
  parsePackTime,
  pickupDelayFacts,
  ticketAgeFacts,
  type OperationalData,
} from './data.js';
import type { KnowledgeBase } from './knowledge.js';

export interface ToolCallTrace {
  tool: string;
  input: unknown;
  ok: boolean;
  summary: string;
}

export interface PendingAction {
  actionId: string;
  action: string;
  summary: string;
  params: Record<string, unknown>;
  requestedBy: string;
  requestedFor?: string;
  createdAt: string;
  status: 'awaiting_confirmation' | 'executed' | 'rejected';
  executedAt?: string;
}

/** In-memory action ledger. A real deployment would persist this for audit. */
export const pendingActions = new Map<string, PendingAction>();

/** What the UI needs to show *why* a source was trusted, not just that it was used. */
export interface Citation {
  source: string;
  title: string;
  kind: string;
  reliability: 'high' | 'medium' | 'low';
  superseded: boolean;
  /** Set when the source is the asking account's own signed agreement. */
  ownAgreement: boolean;
}

export interface Toolkit {
  tools: DynamicStructuredTool[];
  trace: ToolCallTrace[];
  citations: Map<string, Citation>;
  proposedActions: PendingAction[];
}

export function buildToolkit(
  ctx: AccessContext,
  kb: KnowledgeBase,
  db: OperationalData,
): Toolkit {
  const trace: ToolCallTrace[] = [];
  const citations = new Map<string, Citation>();
  const proposedActions: PendingAction[] = [];
  const snapshotMs = Date.parse(db.snapshotISO);

  const record = (tool: string, input: unknown, ok: boolean, summary: string) =>
    trace.push({ tool, input, ok, summary });

  const findAccount = (id?: string | null) =>
    db.accounts.find((a) => a.account_id === id);

  // ---------- 1. document search ----------

  const documentSearch = new DynamicStructuredTool({
    name: 'document_search',
    description:
      'Search the ParcelPilot document pack: support policies, the cancellation & service ' +
      'credit SOP, product documentation and known issues, signed customer agreements, and ' +
      'past ticket resolutions. Returns passages with source, reliability, effective date, ' +
      'a superseded flag and a trust note. Call this before stating ANY policy, fee, SLA ' +
      'target, credit amount or known issue. Results are filtered to what this user may read.',
    schema: z.object({
      query: z.string().describe('What you need to know, in natural language'),
      limit: z.number().int().min(1).max(10).optional().describe('Max passages (default 6)'),
    }),
    func: async ({ query, limit }) => {
      const hits = kb.search(query, ctx, limit ?? 6);
      for (const h of hits) {
        citations.set(h.source, {
          source: h.source,
          title: h.title,
          kind: h.kind,
          reliability: h.reliability,
          superseded: h.superseded,
          ownAgreement: h.kind === 'agreement' && h.accountId === ctx.accountId,
        });
      }
      record('document_search', { query, limit }, true, `${hits.length} passage(s)`);

      if (hits.length === 0) {
        return JSON.stringify({
          results: [],
          note:
            'Nothing matched. Do not invent a figure. Say the answer is not covered by the ' +
            'supplied documents and recommend escalation to the support team.',
        });
      }
      return JSON.stringify({
        results: hits,
        precedence:
          'Source precedence (Support Policy v3 §1): signed customer agreement > current ' +
          'support policy > current product documentation. Historical tickets and internal ' +
          'notes are context only and may contain incorrect past guidance.',
      });
    },
  });

  // ---------- 2. structured data lookup ----------

  const dataLookup = new DynamicStructuredTool({
    name: 'data_lookup',
    description:
      'Look up ParcelPilot account, order/shipment and ticket records from the operational ' +
      'dataset. Access control is enforced here: a customer only ever receives records ' +
      "belonging to their own account. Use this to establish facts before reasoning.",
    schema: z.object({
      resource: z.enum(['account', 'order', 'ticket']),
      id: z.string().optional().describe('Record id, e.g. ORD-1001, TKT-501, ACCT-001'),
      accountId: z.string().optional().describe('Filter by account (staff only)'),
      status: z.string().optional().describe('Filter by record status, e.g. BOOKED or open'),
    }),
    func: async (args) => {
      const { resource, id, accountId, status } = args;
      const scope = isStaff(ctx) ? accountId : ctx.accountId;

      const deny = (reason: string) => {
        record('data_lookup', args, false, `denied: ${reason}`);
        return JSON.stringify({ error: 'access_denied', reason });
      };
      const notFound = (what: string) => {
        record('data_lookup', args, true, `${what} not found`);
        return JSON.stringify({ error: 'not_found', resource, id });
      };

      if (resource === 'account') {
        if (id) {
          const acct = findAccount(id);
          const check = canReadRecord(ctx, acct ? { accountId: acct.account_id } : undefined);
          if (!check.allowed) return deny(check.reason);
          if (!acct) return notFound('account');
          record('data_lookup', args, true, `account ${acct.account_id}`);
          return JSON.stringify({ account: acct });
        }
        const list = db.accounts.filter((a) => isStaff(ctx) || a.account_id === ctx.accountId);
        record('data_lookup', args, true, `${list.length} account(s)`);
        return JSON.stringify({ accounts: list });
      }

      if (resource === 'order') {
        if (id) {
          const order = db.orders.find((o) => o.order_id === id);
          const check = canReadRecord(ctx, order ? { accountId: order.account_id } : undefined);
          if (!check.allowed) return deny(check.reason);
          if (!order) return notFound('order');
          record('data_lookup', args, true, `order ${order.order_id}`);
          return JSON.stringify({ order, account: findAccount(order.account_id) });
        }
        let list = db.orders.filter((o) => (scope ? o.account_id === scope : isStaff(ctx)));
        if (status) list = list.filter((o) => o.status.toLowerCase() === status.toLowerCase());
        record('data_lookup', args, true, `${list.length} order(s)`);
        return JSON.stringify({ orders: list, count: list.length });
      }

      if (id) {
        const ticket = db.tickets.find((t) => t.ticket_id === id);
        const check = canReadRecord(ctx, ticket ? { accountId: ticket.account_id } : undefined);
        if (!check.allowed) return deny(check.reason);
        if (!ticket) return notFound('ticket');
        record('data_lookup', args, true, `ticket ${ticket.ticket_id}`);
        return JSON.stringify({
          ticket,
          account: findAccount(ticket.account_id),
          historicalResolutionWarning: ticket.historical_resolution
            ? 'This ticket carries a past agent resolution. It is context only and may be wrong.'
            : undefined,
        });
      }

      let list = db.tickets.filter((t) => (scope ? t.account_id === scope : isStaff(ctx)));
      if (status) list = list.filter((t) => t.status.toLowerCase() === status.toLowerCase());
      record('data_lookup', args, true, `${list.length} ticket(s)`);
      return JSON.stringify({ tickets: list, count: list.length });
    },
  });

  // ---------- 3. calculation over structured data ----------

  const computeCaseFacts = new DynamicStructuredTool({
    name: 'compute_case_facts',
    description:
      'Compute the timing, fault and money facts a cancellation, service-credit or SLA ' +
      'decision depends on: minutes between booking and the cancellation request, hours a ' +
      'pickup is past its window, 10% of the shipment fee, how long a ticket has been open. ' +
      'All times are measured against the dataset snapshot, not the wall clock. This tool ' +
      'returns FACTS ONLY — it deliberately does not decide the fee, credit or SLA target, ' +
      'because those rules live in the documents and may be overridden by the customer ' +
      "agreement. Combine these numbers with document_search results yourself.",
    schema: z.object({
      orderId: z.string().optional().describe('Order to compute cancellation/pickup facts for'),
      ticketId: z.string().optional().describe('Ticket to compute age/SLA facts for'),
    }),
    func: async (args) => {
      const { orderId, ticketId } = args;
      if (!orderId && !ticketId) {
        record('compute_case_facts', args, false, 'no id supplied');
        return JSON.stringify({ error: 'bad_request', reason: 'Supply orderId or ticketId.' });
      }

      const out: Record<string, unknown> = {
        datasetSnapshot: db.snapshotLabel,
        currency: db.currency,
      };

      if (orderId) {
        const order = db.orders.find((o) => o.order_id === orderId);
        const check = canReadRecord(ctx, order ? { accountId: order.account_id } : undefined);
        if (!check.allowed) {
          record('compute_case_facts', args, false, `denied: ${check.reason}`);
          return JSON.stringify({ error: 'access_denied', reason: check.reason });
        }
        if (!order) {
          record('compute_case_facts', args, true, 'order not found');
          return JSON.stringify({ error: 'not_found', orderId });
        }
        const account = findAccount(order.account_id);
        out.order = {
          order_id: order.order_id,
          account_id: order.account_id,
          status: order.status,
          carrier: order.carrier,
          shipment_fee_inr: order.shipment_fee_inr,
        };
        out.account = account && {
          account_id: account.account_id,
          account_name: account.account_name,
          plan: account.plan,
          contract_file: account.contract_file,
        };
        out.cancellation = cancellationFacts(order, snapshotMs);
        out.pickupDelay = pickupDelayFacts(order, snapshotMs);
        out.nextStep = account?.contract_file
          ? `This account has a signed agreement (${account.contract_file}). Search it before applying any default rule — it may override the fee, threshold or credit.`
          : 'This account has no signed agreement in the pack, so the default policy and SOP apply.';
      }

      if (ticketId) {
        const ticket = db.tickets.find((t) => t.ticket_id === ticketId);
        const check = canReadRecord(ctx, ticket ? { accountId: ticket.account_id } : undefined);
        if (!check.allowed) {
          record('compute_case_facts', args, false, `denied: ${check.reason}`);
          return JSON.stringify({ error: 'access_denied', reason: check.reason });
        }
        if (!ticket) {
          record('compute_case_facts', args, true, 'ticket not found');
          return JSON.stringify({ error: 'not_found', ticketId });
        }
        const account = findAccount(ticket.account_id);
        out.ticket = ticketAgeFacts(ticket, snapshotMs);
        out.ticketDetail = { subject: ticket.subject, description: ticket.description };
        out.account = account && {
          account_id: account.account_id,
          account_name: account.account_name,
          plan: account.plan,
          contract_file: account.contract_file,
          premium_support: account.premium_support,
        };
        out.slaGuidance =
          'Decide the severity from the policy severity definitions, then read the ' +
          "first-response target for this account's plan — or from its signed agreement if " +
          'it has one. Compare that target against hoursOpenAtSnapshot to judge a breach.';
        if (ticket.historical_resolution) {
          out.historicalResolution = ticket.historical_resolution;
          out.historicalResolutionWarning =
            'Context only — the data pack states past resolutions may contain incorrect guidance.';
        }
      }

      record('compute_case_facts', args, true, [orderId, ticketId].filter(Boolean).join(' '));
      return JSON.stringify(out);
    },
  });

  // ---------- 4. state-changing action ----------

  const ESCALATION_ACTIONS = [
    'escalate_ticket',
    'issue_service_credit',
    'cancel_order',
    'create_followup_task',
  ] as const;

  const createEscalation = new DynamicStructuredTool({
    name: 'create_escalation',
    description:
      'Propose a state-changing action: escalate a ticket, issue a service credit, cancel an ' +
      'order, or create a follow-up task. This NEVER executes immediately — it returns an ' +
      'actionId and the user must confirm separately. Staff only.',
    schema: z.object({
      action: z.enum(ESCALATION_ACTIONS),
      summary: z
        .string()
        .describe('One sentence the user will see describing exactly what will happen'),
      orderId: z.string().optional(),
      ticketId: z.string().optional(),
      creditAmountInr: z.number().optional(),
      reason: z.string().optional().describe('Why this action is warranted, citing sources'),
    }),
    func: async (args) => {
      const check = canPerformAction(ctx);
      if (!check.allowed) {
        record('create_escalation', args, false, `denied: ${check.reason}`);
        return JSON.stringify({
          error: 'access_denied',
          reason: check.reason,
          guidance:
            'Tell the customer you cannot perform this yourself and that you are passing the ' +
            'request to the support team. Do not claim the action was taken.',
        });
      }

      const order = args.orderId ? db.orders.find((o) => o.order_id === args.orderId) : undefined;
      const ticket = args.ticketId
        ? db.tickets.find((t) => t.ticket_id === args.ticketId)
        : undefined;

      if ((args.orderId && !order) || (args.ticketId && !ticket)) {
        record('create_escalation', args, false, 'target record not found');
        return JSON.stringify({
          error: 'not_found',
          reason: `No record matching ${args.orderId ?? args.ticketId}. Do not propose an action against a record that does not exist.`,
        });
      }

      const pending: PendingAction = {
        actionId: uuidv4(),
        action: args.action,
        summary: args.summary,
        params: {
          orderId: args.orderId,
          ticketId: args.ticketId,
          creditAmountInr: args.creditAmountInr,
          reason: args.reason,
        },
        requestedBy: ctx.userId,
        requestedFor: order?.account_id ?? ticket?.account_id,
        createdAt: new Date().toISOString(),
        status: 'awaiting_confirmation',
      };

      pendingActions.set(pending.actionId, pending);
      proposedActions.push(pending);
      record('create_escalation', args, true, `proposed ${args.action} (${pending.actionId})`);

      // SOP v4 §3: any individual credit above INR 1,000 requires manager approval.
      const credit = args.creditAmountInr ?? 0;
      const approvalNote =
        credit > 1000
          ? `INR ${credit} exceeds the INR 1,000 threshold in SOP v4 §3 and requires manager approval before it can be issued.`
          : credit > 0
            ? `INR ${credit} is within the INR 1,000 agent threshold in SOP v4 §3.`
            : undefined;

      return JSON.stringify({
        requiresConfirmation: true,
        actionId: pending.actionId,
        action: pending.action,
        summary: pending.summary,
        approvalNote,
        instruction:
          'Nothing has happened yet. Tell the user exactly what will happen and that it is ' +
          'awaiting their confirmation.',
      });
    },
  });

  return {
    tools: [documentSearch, dataLookup, computeCaseFacts, createEscalation],
    trace,
    citations,
    proposedActions,
  };
}

/** Exposed for the server's health endpoint. */
export function snapshotOf(db: OperationalData): number | null {
  return parsePackTime(db.snapshotLabel);
}
