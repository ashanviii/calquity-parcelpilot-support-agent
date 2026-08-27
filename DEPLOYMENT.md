# Deployment Guide: ParcelPilot AI Support

The app deploys as **one service on one URL**. The same Node process serves the API and the
built React UI.

This is a constraint rather than a convenience. Proposed actions live in an in-memory map
between the message that proposes one and the request that confirms it, so the app must run
as a single long-lived instance. Splitting the frontend onto a CDN and the backend across
serverless functions breaks the confirmation flow: a confirm request could land on an
instance that never saw the proposal. Making the action ledger persistent is what would
unlock horizontal scaling, and it is the first thing listed in the Product Note's future
work.

---

## Local Development

### Quick start

```bash
chmod +x quick-start.sh
./quick-start.sh
npm run dev
```

Then open http://localhost:3000.

### Manual setup

```bash
npm install
cd client && npm install && cd ..

cp .env.example .env
# add your OPENAI_API_KEY

npm run dev
```

- Frontend (Vite dev server): http://localhost:3000
- Backend API: http://localhost:3001

### Verifying without an API key

```bash
npm run verify
```

Runs the checks in `scripts/verify.ts` against the real data pack — access control,
retrieval authority ordering, the derived calculations, and the confirm-before-execute
contract. No model call, so no key needed. Exits non-zero on failure.

### Production build, locally

```bash
npm run build     # compiles the server to dist/ and builds the client
npm start         # serves both from a single process
```

---

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | yes | The key the agent calls with. The account needs available quota. |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o`. Plain `gpt-4` is not enabled on all keys. |
| `OPENAI_BASE_URL` | no | Point at Azure OpenAI, a gateway, or any OpenAI-compatible endpoint. |
| `PARCELPILOT_DATA_DIR` | no | Folder holding the assessment pack. Defaults to `./data`. |
| `PORT` | no | Defaults to 3001. |
| `RATE_LIMIT_PER_WINDOW` | no | Messages per IP per 10 minutes on `/api/chat`. Defaults to 25. |

The `.env` file is gitignored. `.env.example` carries placeholders only.

### The data pack

The supplied pack — six PDFs plus `ParcelPilot_Assessment_Data.xlsx` — ships in `data/` and
is parsed at startup. There is no synthetic fallback: if the pack is missing, the server
**fails to boot** rather than starting with placeholder content. A support agent that
invents a policy when its sources are unavailable is worse than one that does not start.

---

## Deploying to Render

`render.yaml` is a blueprint, so most of this is automatic.

1. Push the repo to GitHub
2. Render → **New → Blueprint** → select the repo
3. Render prompts for `OPENAI_API_KEY` (marked `sync: false`, so it never enters the repo)

The blueprint supplies the build and start commands, the health check path, and the free
plan's single instance. The data pack is committed, so there is nothing else to upload.

### Doing it manually instead

| Setting | Value |
|---|---|
| Build command | `npm install && npm --prefix client install && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Environment | `OPENAI_API_KEY`, `NODE_VERSION=20` |

Do not set `numInstances` in `render.yaml`. Scaling is a paid feature and the free plan
rejects the field, which fails the whole blueprint. Free is a single instance anyway, which
is what the in-memory action ledger needs.

### Before sharing a public link

- **Set a spend limit** on the OpenAI account. The URL is public and every message costs
  money.
- Confirm the rate limit is in force: `/api/chat` allows 25 messages per IP per 10-minute
  window by default.

---

## Health Check

```bash
curl https://<your-app>/api/health
```

Reports the model in use, whether a key is configured, and whether the knowledge base and
operational data were loaded from the real pack. Useful as the first thing to check when
the app is up but answers look wrong — a health check that says the pack loaded but the
agent still cannot answer points at the key or the quota, not the data.

---

## Troubleshooting

**`503 agent_unavailable`** — the model could not be reached. The `message` field says which
of: missing or rejected key, exhausted quota, rate limit, or a model not enabled on the key.
`src/agent.ts` maps these deliberately, because a bare `internal_error` on an unpaid account
sends people hunting through their own code.

**Server exits at startup with a data-pack error** — the pack is not where the server is
looking. Set `PARCELPILOT_DATA_DIR` to the folder holding the PDFs and the workbook.

**Port already in use** — `PORT=3002 npm run dev:server`.

**CORS errors in local dev** — the backend must be running on 3001. In the deployed build
there is no cross-origin request at all, since one process serves both.

**Confirming an action returns 404** — pending actions are in memory and are lost on
restart. If the server restarted between the proposal and the confirmation, the `actionId`
no longer exists. This is the known limitation described at the top of this file.

---

## What Is Not Implemented

Listed here so the guide is not mistaken for a description of the current system.

**Persistence.** No database. Documents, records and the action ledger are all in memory. In
production the ledger would move to an append-only table first, since it is the record of
who authorised what.

**Structured logging and tracing.** Currently `console.log`. Would move to Pino with
OpenTelemetry spans around each tool call — the trace object the UI already renders is most
of what a span would carry.

**Metrics.** The ones worth having, in order: corrected-answer rate (see the Product Note),
escalation rate, tool error rates, token spend per conversation, and p95 latency.

**Caching, autoscaling, CDN.** All premature at this size, and the first two are blocked on
persistence anyway.

**Docker.** There is no Dockerfile in this repo. The Render blueprint uses the native Node
runtime.