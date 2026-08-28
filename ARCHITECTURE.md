# Architecture Note: ParcelPilot AI Support System

## System Overview

The ParcelPilot AI Support System is a multi-context chatbot serving both customer-facing and internal operational use cases. It is built on TypeScript, Node.js/Express, React, and LangChain's OpenAI client and tool primitives, with a purpose-built agent loop on top. It answers only from the supplied data pack, enforces access control in the tool layer, and resolves conflicts between sources by documented precedence.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                             │
│  - Chat interface                                                   │
│  - Context selection (Customer / Support / Operations)              │
│  - Tool trace visibility & action confirmation                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP / REST
┌──────────────────────────────▼──────────────────────────────────────┐
│                       Backend API (Express)                         │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │      Agent Loop (custom, on LangChain tool primitives)        │  │
│  │  - Model picks tools; loop executes and feeds results back    │  │
│  │  - Multi-step orchestration, max 6 iterations                 │  │
│  │  - Escalation decisions                                       │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │ every tool call                  │
│  ┌───────────────────────────────▼───────────────────────────────┐  │
│  │           Access Control Layer  (src/access.ts)               │  │
│  │  canReadDocument · canReadRecord · canPerformAction           │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │                                  │
│      ┌──────────────┬────────────┴────────┬──────────────┐          │
│      ▼              ▼                     ▼              ▼          │
│ ┌──────────┐  ┌──────────┐  ┌──────────────────┐  ┌───────────────┐ │
│ │ Document │  │Structured│  │    Case Fact     │  │ State-Changing│ │
│ │  Search  │  │   Data   │  │   Calculation    │  │    Actions    │ │
│ │  (BM25)  │  │  Lookup  │  │  (timing / fee)  │  │  (confirmed)  │ │
│ └────┬─────┘  └────┬─────┘  └────────┬─────────┘  └───────┬───────┘ │
└──────┼─────────────┼─────────────────┼────────────────────┼─────────┘
       │             │                 │                    │
       ▼             ▼                 ▼                    ▼
┌─────────────┐ ┌──────────────┐ ┌──────────────┐  ┌────────────────┐
│  Documents  │ │ Operational  │ │   Snapshot   │  │ Action Ledger  │
│  6 pack PDFs│ │     Data     │ │    clock     │  │  (in memory)   │
│ + historical│ │ - Accounts   │ │  2026-08-16  │  │ proposed →     │
│   tickets   │ │ - Orders     │ │  11:00 IST   │  │ confirmed      │
│ (authority  │ │ - Tickets    │ │              │  │                │
│  scored)    │ │              │ │              │  │                │
└─────────────┘ └──────────────┘ └──────────────┘  └────────────────┘
```

## Agent Design

### Core Components

#### 1. Query Understanding

There is no separate parsing layer. Query understanding is the model's job: it receives the
system prompt, the last 10 turns of history, and four typed tool schemas, then decides which
tools to call and with what arguments. The system prompt supplies the domain constraints —
source precedence, when to escalate, and the rule that a fee or SLA target must come from a
retrieved document rather than from memory.

The deliberate choice here is what is *not* left to the model: access control, source
authority weighting, and the facts/rules split are all enforced in code, because a prompt
instruction is a request and a tool check is a guarantee.

#### 2. Tool Selection Logic
The agent selects from four tools. The brief requires at least three; calculation was split
out from lookup so that retrieving a record and reasoning about it stay separate concerns.

**Tool 1: Document Search/Retrieval**
- Searches across all source documents
- Returns results ranked by:
  - Relevance to query
  - Source reliability (high/medium/low)
  - Supersession (a superseded document is halved)
  - The asking account's own signed agreement, boosted above general policy
- Handles policy conflicts by weighing authority
- Example: Finding cancellation policy for specific account type

**Tool 2: Structured Data Lookup**
- Queries operational data with access control enforcement
- Supports:
  - Account information lookup
  - Order/shipment status
  - Historical ticket data
  - SLA calculations
- Access scoped by user type and account
- Example: Retrieving order details for ORD-1001

**Tool 3: Case Fact Calculation (`compute_case_facts`)**
- Computes the timing, fault and money facts a decision depends on:
  - Minutes between booking and the cancellation request
  - Hours a pickup is past the end of its window
  - 10% of the shipment fee; how long a ticket has been open
- Measured against the dataset snapshot, never the wall clock
- Deliberately returns **facts only**. It does not decide the fee, credit or SLA target,
  because those rules live in the documents and a signed agreement may override them.
  Forcing that split stops the agent from shortcutting source precedence.
- Example: ORD-1001 was cancelled 120 minutes after booking, no pickup recorded

**Tool 4: State-Changing Actions (`create_escalation`)**
- Proposes escalations, service credits, cancellations, follow-up tasks
- Always requires explicit user confirmation; never executes on the tool call
- Returns an `actionId`; a separate confirm endpoint executes it
- Staff only, enforced in the tool
- Example: "Escalate TKT-501 for manager review" + user confirms

#### 3. Multi-Step Orchestration
Complex queries decompose into sequential tool calls:

Example: "Can Northstar cancel ORD-1001 without a fee?"
1. **Compute Case Facts**: ORD-1001 is BOOKED, no pickup recorded, cancellation requested
   120 minutes after booking. Surfaces that the account has a contract file.
2. **Document Search**: Retrieves the Northstar agreement (§2), the current SOP (§1), and
   the closed ticket TKT-450 whose stored answer contradicts both.
3. **Reasoning**: The SOP default charges INR 250 after 30 minutes. The signed agreement
   waives the fee entirely before pickup, and outranks the SOP for this account.
4. **Response**: No fee, citing the agreement — and noting that TKT-450's past answer was
   wrong for this account, so it is not followed.

### Source Reliability System

Three-tier reliability model drives ranking and the trust note shown to the model:

**HIGH Reliability (Primary Authority)**
- Current policies (v3+)
- Signed customer agreements (dated, enforceable)
- Recent operational procedures
- Used for: Authoritative answers, binding commitments

**MEDIUM Reliability (Supporting Context)**
- Operations guides
- Recent product documentation
- Known issues database
- Used for: Context, technical details, explanations

**LOW Reliability (Reference Only)**
- Deprecated policies (v2)
- Historical ticket resolutions
- Superseded information
- Used for: Historical context only, never for new decisions

Conflicts are resolved by the precedence the pack itself states (Support Policy v3, §1):

1. The signed customer agreement, for that customer only
2. The current support policy and SOP
3. Current product documentation

Historical tickets and internal notes are context only. Deprecated and context-only
passages are still **returned** by retrieval, down-weighted and flagged, rather than hidden
— so the agent can name a conflict and correct a bad precedent instead of answering as if
the contradicting source did not exist. Ambiguities that remain are escalated.

All time-based reasoning is measured against the dataset snapshot stated in the workbook
README (`2026-08-16 11:00 Asia/Kolkata`), not the wall clock.

### Escalation Logic

Escalation is driven by the system prompt, not a computed score. The agent is instructed
to escalate when:
- Query requires judgment outside system authority
- Conflicting information from multiple sources
- Information is outdated or uncertain
- Requires financial/legal decision (credits, refunds)
- Customer requests human contact
- Unusual patterns or edge cases

## Access Control Architecture

### Enforcement Strategy

Access control is enforced at the **tool layer**, not model instructions:

Three functions in `src/access.ts` are the only enforcement points, and every tool calls
one of them before returning data:

```typescript
export function canReadRecord(
  ctx: AccessContext,
  record: { accountId?: string } | undefined,
): AccessDecision {
  if (isStaff(ctx)) return ALLOW;
  if (!ctx.accountId) return { allowed: false, reason: 'No account scope on this session.' };
  if (!record?.accountId) return { allowed: false, reason: 'Record is not account-scoped.' };
  if (record.accountId !== ctx.accountId) {
    return { allowed: false, reason: 'Record belongs to a different account.' };
  }
  return ALLOW;
}
```

- `canReadDocument` — customers see public policy plus their own account's contract;
  internal documents and other accounts' agreements are filtered out of retrieval before
  ranking, so an unauthorised passage never reaches the model's context at all.
- `canReadRecord` — record-level scoping, above.
- `canPerformAction` — state changes are staff-only.

A second control sits in `normalizeContext`: a customer's `accountId` is pinned to the one
they are authenticated as, and staff sessions have `accountId` dropped entirely. This is
what stops scope-widening through the tool arguments — a customer passing
`{ resource: 'order', accountId: 'ACCT-001' }` has that argument ignored, because `scope`
resolves from the context rather than the argument for non-staff callers. `verify.ts`
tests this case explicitly.

**A note on what this does not cover.** Authentication itself is mocked: the context
arrives in the request body, as the brief permits. In production the context would come
from a verified JWT claim. The enforcement *point* would not move — only its source — which
is the reason it lives in the tool layer rather than the transport.

### User Types & Permissions

**Customer Context**
- ✓ View own order information
- ✓ View own ticket history
- ✓ Access public policies
- ✓ Cannot see other customers' data
- ✓ Cannot create actions (only request escalation)

**Support Staff Context**
- ✓ View all operational data
- ✓ Access all documentation
- ✓ Create escalations
- ✓ View all customer information

**Operations Staff Context**
- ✓ Currently identical in permission to support staff
- The role exists as a distinct user type so operational tooling (see the Product Note)
  can be scoped to it later without reworking the access layer
  

### Mock Authentication

For this implementation:
- Users authenticated by userId + userType
- Account context passed in request
- In production: Would integrate with OAuth/SAML
- Session management: Would use JWT tokens

## Data Handling

### Document Processing

1. **Loading**: `pdf-parse` extracts text from the six pack PDFs at startup
   - A per-file registry supplies authority metadata: audience, reliability, effective
     date, supersession, and the account a contract belongs to
2. **Chunking**: split on numbered section headings (`1.`, `2.1`, `Schedule B.3`)
   - The pack documents are short and section-numbered, so headings are natural
     boundaries. Bullet lists and SLA tables stay attached to their parent heading — a
     plan's response target is meaningless separated from it.
3. **Retrieval**: BM25 over chunk tokens (TF weighting, IDF, length normalisation)
   - Lexical, not semantic. See the trade-off note below.
4. **Ranking**: BM25 score × authority multiplier
   - high 1.3 / medium 1.0 / low 0.45
   - × 0.5 if superseded; × 1.4 if the chunk is the asking account's own agreement
   - Past ticket resolutions are indexed as low-reliability sources with a context-only
     trust note, so they can be found and explicitly distrusted

### Structured Data

1. **Excel Import**: `ParcelPilot_Assessment_Data.xlsx`, read with `xlsx` at startup
   - `README` sheet: dataset snapshot time and currency
   - `accounts`, `orders`, `tickets` sheets, typed on load
   - Nothing about the example records is hardcoded; other records from the same pack
     work without code changes

2. **Normalization**:
   - Pack timestamps are Asia/Kolkata wall-clock with no offset, parsed at a fixed
     UTC+05:30 (no DST in that zone)
   - Booleans and empty cells coerced consistently
   - The snapshot from the README becomes the reference "now" for all time arithmetic

3. **Derived facts**:
   - Cancellation timing, pickup delay, fee percentages and ticket age are computed on
     demand from the loaded rows rather than stored

4. **Caching**:
   - Documents and rows are parsed once at startup and held in memory; the dataset is
     small and read-mostly. A production version would move to Postgres.

## Technical Trade-offs

### Decision: LangChain primitives, custom agent loop

LangChain provides the model client (`@langchain/openai`) and the typed tool definitions
(`DynamicStructuredTool` + zod schemas, which become the OpenAI function schemas).
Orchestration is a purpose-built loop in `src/agent.ts`.

**Why not LangChain's prebuilt agent executor:**
- The loop is ~40 lines: call the model, run any tool calls, append results, repeat.
- Owning it makes the failure modes explicit — the iteration cap, what happens when a tool
  throws, and exactly what gets appended to the message list.
- Every tool call is recorded to a trace that the UI renders, which the brief asks for.
  Threading that through an executor's callback system is more work, not less.

**Cost:** no free retry/parsing helpers; the loop handles its own errors.

### Decision: BM25 rather than vector embeddings

**Why:**
- The corpus is six short documents — roughly 25 passages. Embedding search solves a
  recall problem that does not exist at this size.
- The questions are keyword-dense in the same vocabulary the documents use
  ("cancellation fee", "pickup window", "P1", "service credit"), which is where lexical
  retrieval is strongest.
- No embedding API call on the request path, and results are deterministic — which makes
  the ranking testable, and it is tested.

**Cost:** paraphrases that share no vocabulary with the source will miss. At a larger
corpus, or with more varied phrasing, hybrid BM25 + embeddings would be the next step.

### Decision: No synthetic fallback for the data pack

The system loads the supplied pack at startup and **fails to boot** if it is missing,
rather than falling back to placeholder content. A support agent that silently invents a
policy when its sources are unavailable is worse than one that does not start.

### Decision: React Frontend with Vite

**Why Vite:**
- Fast hot reload for development
- Small production bundle
- Native ESM support
- TypeScript out of the box

**Why React:** 
- the interface needed expandable per-message tool traces and inline
confirm/reject controls whose state has to survive re-renders. Component state is the natural fit. The framework choice is not load-bearing here — any of React, Vue or Svelte would have worked.

### Decision: Confirmation Required for All Actions

**Why:**
- Safety: Prevents accidental escalations
- Transparency: User sees exactly what will happen
- Audit trail: Clear user intent recorded
- UX: Feels more trustworthy

**Cost:**
- Extra step in workflow
- Mitigated by clear preview

## Deployment Architecture

### Current (Local Development)

```
┌────────────────────┐
│  React Dev Server  │ localhost:3000
│  (Vite)            │
└─────────┬──────────┘
          │
          │ HTTP
          ▼
┌────────────────────┐
│  Express Server    │ localhost:3001
│  (Node.js)         │
└────────────────────┘
```

### Production (as deployed)

One service, one URL — the same Node process serves the API and the built UI.

```
                    ┌──────────────────────┐
                    │       RENDER         │
                    │    Single Service    │
                    ├──────────────────────┤
                    │                      │
        /api/* ────▶│   Express API        │
                    │                      │
          /* ──────▶│   React Static Build │
                    │                      │
                    ├──────────────────────┤
                    │ ENV:                 │
                    │ OPENAI_API_KEY       │
                    │                      │
                    │ Health:              │
                    │ /api/health          │
                    └──────────────────────┘
```

## Security Considerations

1. **API Keys**:
   - OPENAI_API_KEY in environment only
   - Never committed to version control

2. **Data Access**:
   - Access control enforced inside each tool, on every call
   - Customer scope is derived from session context, never from tool arguments
   - Authentication is mocked per the brief; a caller who can forge the request body can
     forge a role. Production would source the context from a verified JWT claim, without
     moving the enforcement point.

3. **Input Validation**:
   - Tool arguments are typed with zod schemas, which double as the OpenAI function schemas
   - `normalizeContext` coerces the request context into a shape the server is willing to
     act on, rather than trusting it
   - `/api/chat` rejects a missing or unknown `accountId` on a customer session

4. **Rate Limiting**:
   - Implemented: 25 messages per IP per 10-minute window on `/api/chat`
     (`RATE_LIMIT_PER_WINDOW`), which caps how fast a public demo URL can spend the API key
   - In-memory, so it resets on restart and does not coordinate across instances

5. **Logging**:
   - Query logs for audit trail
   - Sensitive data excluded from logs

## Monitoring & Observability

None of this is implemented. It is what I would instrument first, in this order.

### Metrics to Track

1. **Query Metrics**:
   - Queries/minute
   - Average response time
   - Cache hit rate

2. **Tool Usage**:
   - Which tools used most frequently
   - Tool error rates
   - Time per tool

3. **Quality Metrics**:
   - Escalation rate
   - User satisfaction
   - Confidence scores

4. **System Health**:
   - API error rates
   - Database query times
   - LLM token usage/cost

### Implementation

- Structured logging (Winston/Pino)
- OpenTelemetry for tracing
- Integration with monitoring service (DataDog, New Relic)

## Known Limitations

Stated plainly, because a support system's credibility depends on it being honest about
what it does not do.

- **No persistence.** Documents, records and the action ledger are all in memory. A restart
  loses the audit trail of who authorised what, which is the part that would matter first
  in production.
- **Actions are recorded, not applied.** A confirmed action is an auditable record of
  intent. It does not mutate the order or ticket row; the pack workbook is read-only here.
- **Single instance required.** A consequence of the above; see the deployment section.
- **Mocked authentication.** The request context is trusted. Enforcement is in the right
  place, but its input is not yet verified.
- **Lexical retrieval only.** A question phrased entirely outside the documents' vocabulary
  will miss. Acceptable at ~25 passages; the first thing to revisit as the corpus grows.
- **Conversation history is client-supplied** and replayed into the model. Forged history
  cannot unlock data, because every tool re-checks access on every call, but it could
  influence tone. Server-side session storage would close this.
- **No answer-quality evaluation set.** `verify.ts` tests the mechanics — access control,
  ranking order, arithmetic — but there is no scored set of question/expected-answer pairs
  measuring whether the agent actually resolves precedence correctly across many phrasings.
  This is the gap I would close first, because it is the only way to know whether a prompt
  change made things better or worse.


## Conclusion

The load-bearing decisions are: access control enforced in tools rather than instructions,
source precedence enforced in ranking rather than requested in the prompt, and a facts/rules
split that makes it structurally harder for the model to shortcut either. Everything above
in the limitations list is a known cost, chosen against the size of this data pack, and none
of it requires reworking those three decisions to fix.
