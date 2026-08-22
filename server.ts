import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

import { normalizeContext, canPerformAction, canReadRecord } from './src/access.js';
import { KnowledgeBase } from './src/knowledge.js';
import { loadOperationalData } from './src/data.js';
import { pendingActions } from './src/tools.js';
import {
  runAgent,
  AgentUnavailableError,
  describeUpstreamError,
  type AgentTurn,
} from './src/agent.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

/**
 * The data pack. Defaults to ./data, which holds the supplied pack; override with
 * PARCELPILOT_DATA_DIR to point somewhere else. The system has no synthetic fallback —
 * the assessment requires it to answer only from the supplied pack, so a missing pack is
 * a startup failure rather than something to paper over.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

function resolveDataDir(): string {
  if (process.env.PARCELPILOT_DATA_DIR) return path.resolve(process.env.PARCELPILOT_DATA_DIR);
  // ./data when running from source (tsx), ../data when running the build from dist/.
  for (const candidate of [path.join(HERE, 'data'), path.join(HERE, '..', 'data')]) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return path.resolve(path.join(HERE, 'data'));
}

const DATA_DIR = resolveDataDir();

if (!fs.existsSync(DATA_DIR)) {
  console.error(
    `[fatal] Data pack directory not found: ${DATA_DIR}\n` +
      'Set PARCELPILOT_DATA_DIR to the folder containing the assessment pack PDFs and ' +
      'ParcelPilot_Assessment_Data.xlsx.',
  );
  process.exit(1);
}

const db = loadOperationalData(DATA_DIR);
const kb = await KnowledgeBase.load(DATA_DIR, db.tickets);

/**
 * A hosted demo is a public URL spending real money on every message. This caps how fast
 * any single caller can burn the key; without it one script turns the demo into a 503 for
 * everyone who looks at it afterwards.
 */
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = Number(process.env.RATE_LIMIT_PER_WINDOW) || 25;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude bound; this is a demo, not a gateway
  return recent.length > RATE_MAX;
}

// ============= API =============

app.post('/api/chat', async (req, res) => {
  try {
    const { message, context, history } = req.body ?? {};

    if (typeof message !== 'string' || message.trim().length === 0) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'A "message" string is required.' });
    }

    const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? 'unknown').split(',')[0].trim();
    if (rateLimited(ip)) {
      return res.status(429).json({
        error: 'rate_limited',
        message: `Demo limit reached (${RATE_MAX} messages per 10 minutes). Try again shortly.`,
      });
    }

    const ctx = normalizeContext(context, uuidv4());
    if (ctx.userType === 'customer') {
      if (!ctx.accountId) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'Customer sessions must supply an accountId.',
        });
      }
      // A customer session must name a real account, or every scoped lookup silently
      // returns nothing and the agent looks broken rather than restricted.
      if (!db.accounts.some((a) => a.account_id === ctx.accountId)) {
        return res.status(400).json({
          error: 'bad_request',
          message: `Unknown accountId "${ctx.accountId}".`,
        });
      }
    }

    const turns: AgentTurn[] = Array.isArray(history)
      ? history
          .filter(
            (h: any) =>
              (h?.role === 'user' || h?.role === 'assistant') && typeof h.content === 'string',
          )
          .map((h: any) => ({ role: h.role, content: h.content }))
      : [];

    const result = await runAgent(message, ctx, kb, db, turns);

    res.json({
      answer: result.answer,
      toolsUsed: result.toolsUsed,
      trace: result.trace,
      sources: result.sources,
      proposedActions: result.proposedActions,
      iterations: result.iterations,
      model: result.model,
      context: ctx,
    });
  } catch (err) {
    const upstream = err instanceof AgentUnavailableError ? err : describeUpstreamError(err);
    if (upstream) {
      console.error('[chat] agent unavailable:', upstream.message);
      return res.status(503).json({ error: 'agent_unavailable', message: upstream.message });
    }
    console.error('[chat] ', err);
    res.status(500).json({ error: 'internal_error', message: (err as Error).message });
  }
});

app.post('/api/confirm-action', async (req, res) => {
  try {
    const { actionId, context, confirm } = req.body ?? {};
    const ctx = normalizeContext(context, uuidv4());

    const allowed = canPerformAction(ctx);
    if (!allowed.allowed) {
      return res.status(403).json({ error: 'access_denied', message: allowed.reason });
    }

    const pending = typeof actionId === 'string' ? pendingActions.get(actionId) : undefined;
    if (!pending) {
      return res.status(404).json({ error: 'not_found', message: 'No such pending action.' });
    }
    if (pending.status !== 'awaiting_confirmation') {
      return res.status(409).json({
        error: 'already_resolved',
        message: `Action was already ${pending.status}.`,
        action: pending,
      });
    }

    if (confirm === false) {
      pending.status = 'rejected';
      return res.json({ action: pending, message: 'Action rejected; nothing was changed.' });
    }

    // Apply the effect so confirmation means something. Mocked locally, as the brief allows.
    const effects: string[] = [];
    const orderId = pending.params.orderId as string | undefined;
    const ticketId = pending.params.ticketId as string | undefined;

    if (pending.action === 'cancel_order' && orderId) {
      const order = db.orders.find((o) => o.order_id === orderId);
      if (order) {
        order.status = 'CANCELLED';
        effects.push(`${orderId} status set to CANCELLED`);
      }
    }
    if (pending.action === 'escalate_ticket' && ticketId) {
      const ticket = db.tickets.find((t) => t.ticket_id === ticketId);
      if (ticket) {
        ticket.status = 'escalated';
        effects.push(`${ticketId} marked escalated`);
      }
    }
    if (pending.action === 'issue_service_credit') {
      effects.push(
        `service credit of ${db.currency} ${pending.params.creditAmountInr ?? 0} queued for billing`,
      );
    }
    if (pending.action === 'create_followup_task') {
      effects.push('follow-up task created');
    }

    pending.status = 'executed';
    pending.executedAt = new Date().toISOString();

    res.json({ action: pending, effects, message: `${pending.action} executed.` });
  } catch (err) {
    console.error('[confirm-action] ', err);
    res.status(500).json({ error: 'internal_error', message: (err as Error).message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    openAiKeyConfigured: Boolean(
      process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('your_'),
    ),
    dataPack: {
      dir: DATA_DIR,
      documents: [...kb.docs.values()].filter((d) => d.kind !== 'historical_ticket').length,
      historicalTickets: [...kb.docs.values()].filter((d) => d.kind === 'historical_ticket')
        .length,
      passages: kb.chunks.length,
    },
    dataset: {
      snapshot: db.snapshotLabel,
      currency: db.currency,
      accounts: db.accounts.length,
      orders: db.orders.length,
      tickets: db.tickets.length,
    },
  });
});

/** Populates the UI's account picker from the pack rather than hardcoding accounts. */
app.get('/api/accounts', (_req, res) => {
  res.json({
    snapshot: db.snapshotLabel,
    accounts: db.accounts.map((a) => ({
      account_id: a.account_id,
      account_name: a.account_name,
      plan: a.plan,
      hasAgreement: Boolean(a.contract_file),
    })),
  });
});

app.get('/api/accounts/:accountId/data', (req, res) => {
  const ctx = normalizeContext(
    { userType: req.query.userType, accountId: req.query.accountId, userId: req.query.userId },
    'anonymous',
  );
  const { accountId } = req.params;
  const account = db.accounts.find((a) => a.account_id === accountId);

  const check = canReadRecord(ctx, account ? { accountId: account.account_id } : undefined);
  if (!check.allowed) {
    return res.status(403).json({ error: 'access_denied', message: check.reason });
  }
  if (!account) return res.status(404).json({ error: 'not_found' });

  res.json({
    account,
    orders: db.orders.filter((o) => o.account_id === accountId).length,
    tickets: db.tickets.filter((t) => t.account_id === accountId).length,
    documents: kb.listReadable(ctx).map((d) => d.name),
  });
});

/**
 * Serve the built client from the same process, so the deployed app is a single service on
 * a single URL. Registered after the API routes so it can never shadow them.
 */
function resolveClientDist(): string | null {
  for (const c of [
    path.join(HERE, '..', 'client', 'dist'), // running the build from dist/
    path.join(HERE, 'client', 'dist'), // running from source with tsx
  ]) {
    if (fs.existsSync(path.join(c, 'index.html'))) return path.resolve(c);
  }
  return null;
}

const CLIENT_DIST = resolveClientDist();

if (CLIENT_DIST) {
  app.use(express.static(CLIENT_DIST));
  // SPA fallback: anything that is not an API route returns index.html.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
  console.log(`[boot] serving UI from ${CLIENT_DIST}`);
} else {
  console.log('[boot] no client build found — run "npm run build:client" to serve the UI');
}

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`ParcelPilot AI Support Server running on port ${PORT}`);
  console.log('Endpoints: /api/chat, /api/confirm-action, /api/health, /api/accounts');
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('your_')) {
    console.warn('[warn] OPENAI_API_KEY is not set — /api/chat will return 503.');
  }
});

export { app, kb, db };
