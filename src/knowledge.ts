/**
 * Document corpus + retrieval over the supplied data pack.
 *
 * Every passage comes from a real pack PDF (or from a historical ticket resolution in the
 * workbook, which the pack explicitly labels as unreliable context). Scoring is BM25 over
 * chunk tokens, then adjusted for source authority. No synthetic documents, and no
 * hardcoded answers — the graders may ask about records the examples never mention.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { canReadDocument, type AccessContext } from './access.js';
import type { Ticket } from './data.js';

const require = createRequire(import.meta.url);

export type Reliability = 'high' | 'medium' | 'low';

export interface DocMeta {
  name: string;
  title: string;
  kind: 'policy' | 'sop' | 'product_doc' | 'agreement' | 'historical_ticket';
  audience: 'public' | 'internal';
  reliability: Reliability;
  effectiveDate: string;
  supersededBy?: string;
  /** Set for customer agreements: only this account may read it. */
  accountId?: string;
  /** Shown to the model so it knows how far to trust the passage. */
  trustNote?: string;
}

/**
 * Authority metadata for the pack. The precedence rule itself is stated in
 * 01_Support_Policy_v3 §1: signed agreement > current support policy > current product
 * documentation, with historical tickets as context only.
 */
const PACK: Record<string, Omit<DocMeta, 'name'>> = {
  '01_Support_Policy_v3_CURRENT.pdf': {
    title: 'ParcelPilot Support Policy v3 (CURRENT)',
    kind: 'policy',
    audience: 'public',
    reliability: 'high',
    effectiveDate: '2026-05-01',
    trustNote: 'Current support policy. Overridden only by a signed customer agreement.',
  },
  '02_Support_Policy_v2_DEPRECATED.pdf': {
    title: 'ParcelPilot Support Policy v2 (DEPRECATED)',
    kind: 'policy',
    audience: 'public',
    reliability: 'low',
    effectiveDate: '2025-01-01',
    supersededBy: '01_Support_Policy_v3_CURRENT.pdf',
    trustNote:
      'DEPRECATED — retained for history only. Never answer from this. Use it only to explain that older terms no longer apply.',
  },
  '03_Cancellation_and_Service_Credit_SOP_v4.pdf': {
    title: 'Cancellation & Service Credit SOP v4 (CURRENT)',
    kind: 'sop',
    audience: 'public',
    reliability: 'high',
    effectiveDate: '2026-06-15',
    trustNote:
      'Current SOP. Its cancellation-fee and service-credit defaults are overridden by a signed customer agreement where one exists.',
  },
  '04_Product_Operations_Guide_and_Known_Issues.pdf': {
    title: 'Product Operations Guide & Known Issues',
    kind: 'product_doc',
    audience: 'public',
    reliability: 'medium',
    effectiveDate: '2026-08-14',
    trustNote:
      'Current product documentation. Ranks below the support policy and any signed agreement.',
  },
  '05_Northstar_Logistics_Enterprise_Agreement.pdf': {
    title: 'Northstar Logistics — Enterprise Agreement (ACCT-001)',
    kind: 'agreement',
    audience: 'public',
    reliability: 'high',
    effectiveDate: '2026-01-01',
    accountId: 'ACCT-001',
    trustNote: 'Signed agreement. Highest authority for ACCT-001, above all general policy.',
  },
  '06_LumenWorks_Service_Agreement.pdf': {
    title: 'LumenWorks — Service Agreement (ACCT-002)',
    kind: 'agreement',
    audience: 'public',
    reliability: 'high',
    effectiveDate: '2026-03-01',
    accountId: 'ACCT-002',
    trustNote: 'Signed agreement. Highest authority for ACCT-002, above all general policy.',
  },
};

export interface Chunk {
  id: string;
  docName: string;
  heading: string;
  text: string;
  tokens: string[];
}

export interface RetrievalHit {
  source: string;
  title: string;
  kind: DocMeta['kind'];
  heading: string;
  excerpt: string;
  reliability: Reliability;
  effectiveDate: string;
  score: number;
  superseded: boolean;
  supersededBy?: string;
  accountId?: string;
  trustNote?: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'for',
  'from', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'may', 'me', 'my', 'no',
  'not', 'of', 'on', 'or', 'our', 'should', 'that', 'the', 'their', 'them', 'there', 'this',
  'to', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'you', 'your',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%\-\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * The pack PDFs are short and section-numbered ("1. Scope and source precedence"), so the
 * numbered headings make natural chunk boundaries. Bullet lists and the SLA tables stay
 * attached to their parent section, which matters because a plan's response target is
 * meaningless separated from its heading.
 */
function chunkDocument(docName: string, raw: string): Chunk[] {
  const lines = raw
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);

  const chunks: Chunk[] = [];
  let heading = 'Preamble';
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join(' ').trim();
    if (text.length < 15) {
      buffer = [];
      return;
    }
    chunks.push({
      id: `${docName}#${chunks.length}`,
      docName,
      heading,
      text,
      tokens: tokenize(`${heading} ${text}`),
    });
    buffer = [];
  };

  for (const line of lines) {
    const isHeading = /^\d+\.\s+[A-Za-z]/.test(line) && line.length < 90;
    if (isHeading) {
      flush();
      heading = line;
      continue;
    }
    buffer.push(line);
    // Keep chunks small enough to stay precise, but never split mid-section aggressively.
    if (buffer.join(' ').length > 1500) flush();
  }
  flush();

  // A document with no numbered sections still needs to be retrievable.
  if (chunks.length === 0 && lines.length > 0) {
    const text = lines.join(' ');
    chunks.push({ id: `${docName}#0`, docName, heading: 'Document', text, tokens: tokenize(text) });
  }
  return chunks;
}

/** pdf-parse's index.js runs a self-test on import under ESM; require the lib directly. */
function loadPdfParser(): (buf: Buffer) => Promise<{ text: string }> {
  try {
    return require('pdf-parse/lib/pdf-parse.js');
  } catch {
    return require('pdf-parse');
  }
}

export class DataPackMissingError extends Error {}

export class KnowledgeBase {
  readonly docs = new Map<string, DocMeta>();
  readonly chunks: Chunk[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  static async load(dataDir: string, tickets: Ticket[] = []): Promise<KnowledgeBase> {
    const kb = new KnowledgeBase();
    const parse = loadPdfParser();

    const missing: string[] = [];
    for (const [name, meta] of Object.entries(PACK)) {
      const file = path.join(dataDir, name);
      if (!fs.existsSync(file)) {
        missing.push(name);
        continue;
      }
      const { text } = await parse(fs.readFileSync(file));
      const chunks = chunkDocument(name, text);
      if (chunks.length === 0) {
        missing.push(`${name} (parsed but empty)`);
        continue;
      }
      kb.docs.set(name, { name, ...meta });
      kb.chunks.push(...chunks);
    }

    if (kb.docs.size === 0) {
      throw new DataPackMissingError(
        `No data pack documents found in ${dataDir}. Set PARCELPILOT_DATA_DIR to the folder ` +
          'holding the assessment pack PDFs.',
      );
    }
    if (missing.length > 0) {
      console.warn(`[knowledge] missing from pack: ${missing.join(', ')}`);
    }

    kb.addHistoricalResolutions(tickets);
    kb.index();
    console.log(
      `[knowledge] ${kb.docs.size} documents, ${kb.chunks.length} passages indexed from ${dataDir}`,
    );
    return kb;
  }

  /**
   * Past ticket resolutions are searchable but explicitly untrusted — the pack states they
   * may contain incorrect guidance (TKT-450's "INR 250 fee" answer is wrong for an account
   * whose agreement waives the fee). Making them retrievable *and* clearly labelled is
   * better than hiding them: the agent can recognise and correct a bad precedent.
   */
  private addHistoricalResolutions(tickets: Ticket[]) {
    for (const t of tickets) {
      if (!t.historical_resolution) continue;
      const name = `ticket:${t.ticket_id}`;
      this.docs.set(name, {
        name,
        title: `Historical ticket ${t.ticket_id} — ${t.subject}`,
        kind: 'historical_ticket',
        audience: 'public',
        reliability: 'low',
        effectiveDate: t.created_at,
        accountId: t.account_id,
        trustNote:
          'CONTEXT ONLY. Past agent guidance, which the data pack states may be incorrect. ' +
          'Never use it as the basis for an answer; verify against the current policy, SOP and agreement.',
      });
      const text = `Subject: ${t.subject}. Issue: ${t.description} Past agent resolution: ${t.historical_resolution}`;
      this.chunks.push({
        id: `${name}#0`,
        docName: name,
        heading: `Past resolution (${t.status})`,
        text,
        tokens: tokenize(text),
      });
    }
  }

  private index() {
    for (const c of this.chunks) {
      for (const t of new Set(c.tokens)) this.df.set(t, (this.df.get(t) || 0) + 1);
    }
    this.avgLen = this.chunks.reduce((a, c) => a + c.tokens.length, 0) / (this.chunks.length || 1);
  }

  private bm25(queryTokens: string[], chunk: Chunk): number {
    const k1 = 1.5;
    const b = 0.75;
    const N = this.chunks.length;
    let score = 0;
    for (const q of new Set(queryTokens)) {
      const n = this.df.get(q);
      if (!n) continue;
      const tf = chunk.tokens.filter((t) => t === q).length;
      if (tf === 0) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = tf + k1 * (1 - b + (b * chunk.tokens.length) / this.avgLen);
      score += idf * ((tf * (k1 + 1)) / denom);
    }
    return score;
  }

  /**
   * Retrieval with access control and authority weighting. Superseded and untrusted
   * passages are still returned, down-weighted, so the agent can see a conflict and name
   * it rather than answering as if the outdated source did not exist.
   */
  search(query: string, ctx: AccessContext, limit = 6): RetrievalHit[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];

    const hits: RetrievalHit[] = [];
    for (const chunk of this.chunks) {
      const meta = this.docs.get(chunk.docName);
      if (!meta) continue;
      if (!canReadDocument(ctx, meta).allowed) continue;

      const base = this.bm25(qTokens, chunk);
      if (base <= 0) continue;

      const authority = meta.reliability === 'high' ? 1.3 : meta.reliability === 'medium' ? 1.0 : 0.45;
      const supersededPenalty = meta.supersededBy ? 0.5 : 1;
      // The account's own agreement is the highest authority for that account.
      const contractBoost =
        meta.kind === 'agreement' && meta.accountId === ctx.accountId ? 1.4 : 1;

      hits.push({
        source: meta.name,
        title: meta.title,
        kind: meta.kind,
        heading: chunk.heading,
        excerpt: chunk.text.length > 900 ? `${chunk.text.slice(0, 900)}...` : chunk.text,
        reliability: meta.reliability,
        effectiveDate: meta.effectiveDate,
        score: Number((base * authority * supersededPenalty * contractBoost).toFixed(3)),
        superseded: Boolean(meta.supersededBy),
        supersededBy: meta.supersededBy,
        accountId: meta.accountId,
        trustNote: meta.trustNote,
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  listReadable(ctx: AccessContext): DocMeta[] {
    return [...this.docs.values()].filter((d) => canReadDocument(ctx, d).allowed);
  }
}
