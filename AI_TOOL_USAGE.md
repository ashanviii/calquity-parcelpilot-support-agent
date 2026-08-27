# AI Tool Usage Note

Two AI coding tools were used, at different stages and for different things.

## GitHub Copilot — initial scaffold

Used to stand up the project shape quickly: the Express server skeleton, the React chat
component and CSS, the build configuration (`tsconfig`, `vite.config`, `package.json`), and
the first drafts of the documentation.

Good for boilerplate and configuration. Less useful for the parts of this assessment that
actually carry the marks — source precedence, access-control enforcement, and the agent
loop — which needed decisions rather than completions.

## Claude Code (Opus 5) — implementation and review

Used for the substantive build, in a working session rather than as autocomplete:

- **Diagnosing the scaffold.** The first version, which I had scaffolded with Copilot, looked complete and was not: `runAgent()`
  built a system prompt, never sent it anywhere, and returned a hardcoded object, so every
  question produced the same reply. Verified by curling the running server with two
  unrelated questions and getting byte-identical responses.
- **Building the agent loop** (`src/agent.ts`) — model call, tool dispatch, feed results
  back, iterate to an answer.
- **Building the four tools, retrieval and data layers** — BM25 with authority weighting,
  workbook parsing against the dataset snapshot, and the derived timing/fee calculations.
- **Fixing access control.** The original check compared `resourceId.startsWith(accountId)`
  — `"ORD-1001"` against `"ACCT-001"` — which denied every legitimate customer lookup while
  appearing to be a security control.
- **Writing `scripts/verify.ts`** — 42 checks over the real pack covering access control,
  retrieval ordering, the calculations, and the confirm-before-execute contract.
- **Reviewing these notes against the code**, which is how the inaccuracies described below
  were found.

## What required human direction

- Interpreting the assessment and deciding scope — going deep on Problem 2 (Trust and
  Reliability) rather than shallow on both additional problems
- Product decisions: what the agent should refuse to answer, when to escalate, and that the
  calculation tool should return facts without deciding outcomes
- Judging which trade-offs were defensible (BM25 over embeddings at this corpus size) and
  which were shortcuts to remove

## A note on an earlier version of this file

The previous version of this note claimed ~85% of production code was AI-generated, 99%
type correctness, that access control was properly enforced, and that generated code passed
type checks. None of those were accurate: the project did not compile
(`initializeAgent` and `Tool` are not exported from `langchain/agents` in the installed
version), there were no tests, and the access-control check was inverted as described above.

