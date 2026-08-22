# ParcelPilot AI Support System

An AI-powered customer support and operations system for ParcelPilot logistics platform. Built with TypeScript, Express, React, and LangChain (`@langchain/openai` tool calling).

## Features

✅ **Dual-context chatbot** - Customer-facing and internal staff support modes
✅ **3+ Specialized Tools**:
  - Document search/retrieval across policies and agreements
  - Structured data lookup with access control
  - State-changing actions (escalations, ticket updates)

✅ **Access Control** - Role-based data access for customers vs staff
✅ **Multi-step Reasoning** - Complex queries spanning multiple tools and sources
✅ **Confirmation Workflow** - User confirmation required for state changes
✅ **Source Reliability Tracking** - Distinguishes high/medium/low reliability sources

## Project Structure

```
parcelpilot-ai-support/
├── server.ts                 # Express API layer
├── data/                    # The supplied assessment pack (6 PDFs + workbook)
├── src/
│   ├── agent.ts             # The agent loop: model -> tool calls -> answer
│   ├── tools.ts             # document_search, data_lookup, compute_case_facts, create_escalation
│   ├── knowledge.ts         # PDF parsing + BM25 retrieval with authority weighting
│   ├── data.ts              # Workbook loading + derived timing/fee calculations
│   └── access.ts            # Access control, enforced at the tool layer
├── scripts/
│   └── verify.ts            # 35-check smoke test over the real pack
├── client/
│   ├── src/
│   │   ├── App.tsx          # React chat interface
│   │   ├── App.css          # Styling
│   │   ├── main.tsx         # Entry point
│   │   └── index.css        # Global styles
│   ├── index.html           # HTML template
│   ├── vite.config.ts       # Vite configuration
│   ├── tsconfig.json        # TypeScript config
│   └── package.json         # Dependencies
├── package.json             # Root dependencies
├── tsconfig.json            # TypeScript configuration
└── README.md                # This file
```

## Tech Stack

**Backend:**
- Node.js + Express
- TypeScript
- LangChain (`@langchain/openai`, `@langchain/core`) for model + tool binding
- OpenAI (default `gpt-4o`, set `OPENAI_MODEL` to change)
- PDF parsing (`pdf-parse`), Excel data handling (`xlsx`)

**Frontend:**
- React 18
- TypeScript
- Vite
- CSS3 with animations

## Setup Instructions

### Prerequisites

- Node.js 16+ and npm
- OpenAI API key
- Git

### Installation

1. **Clone the repository**
```bash
cd parcelpilot-ai-support
```

2. **Install dependencies**
```bash
npm install
cd client && npm install && cd ..
```

3. **Set up environment**
```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
```

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | yes | The key the agent calls with. The account needs available quota. |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o`. Plain `gpt-4` is not enabled on all keys. |
| `OPENAI_BASE_URL` | no | Point at Azure OpenAI, a gateway, or any OpenAI-compatible endpoint. |
| `PARCELPILOT_DATA_DIR` | no | Folder holding the assessment pack. Defaults to `./data`. |
| `PORT` | no | Defaults to 3001. |

4. **Data pack**

   The supplied pack (six PDFs + `ParcelPilot_Assessment_Data.xlsx`) ships in `data/` and is
   loaded on boot. Override the location with `PARCELPILOT_DATA_DIR` if you keep it elsewhere:

```bash
PARCELPILOT_DATA_DIR="../AI Agent Assessment - Candidate Pack" npm run dev
```

   There is no synthetic fallback. The assessment requires the system to answer only from the
   supplied pack, so a missing pack is a startup failure rather than something papered over.
   `GET /api/health` reports what was indexed and the dataset snapshot in use.

5. **Verify the wiring** (no API key needed)
```bash
npm run verify
```
   35 checks over the real pack: access control, retrieval authority ordering, the derived
   calculations, and the confirm-before-execute contract.

### Running Locally

**Development mode** (starts both server and client):
```bash
npm run dev
```

This runs:
- Backend server on `http://localhost:3001`
- Frontend client on `http://localhost:3000`

**Production build**:
```bash
npm run build
npm start
```

## Deploying

The app deploys as **one service on one URL** — the same Node process serves the API and
the built UI. That is not only convenience: proposed actions live in memory between the
message that proposes one and the request that confirms it, so the app must run as a single
long-lived instance. Splitting it across serverless functions breaks the confirmation flow.

### Render (blueprint included)

1. Push the repo to GitHub
2. Render → **New → Blueprint** → select the repo

`render.yaml` supplies the build and start commands, the health check, and a single
instance. Render prompts for `OPENAI_API_KEY`; it is marked `sync: false` so it never
enters the repo. The data pack ships in `data/`, so there is nothing else to upload.

Doing it manually instead:

| Setting | Value |
|---|---|
| Build command | `npm install && npm --prefix client install && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Env | `OPENAI_API_KEY`, `NODE_VERSION=20` |

### Before sharing a public link

- **Set a spend limit** on the OpenAI account. The URL is public and every message costs money.
- The app rate-limits `/api/chat` to 25 messages per IP per 10 minutes
  (`RATE_LIMIT_PER_WINDOW` to change). The check runs *before* the model call, so a flood
  costs nothing.
- `OPENAI_MODEL=gpt-4o-mini` cuts cost substantially if you expect heavy traffic, at some
  loss of multi-step reasoning quality.
- Render's free tier sleeps after 15 minutes idle, so the first visit takes ~50s. Load the
  URL yourself before sending it to anyone.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `503 agent_unavailable` — "no remaining quota" | The OpenAI account has no credit. Add billing; the code is fine. |
| `503 agent_unavailable` — "rejected the API key" | `OPENAI_API_KEY` is wrong or unset in `.env`. |
| `503` naming a model | `OPENAI_MODEL` is not enabled on your key. Try `gpt-4o` or `gpt-4o-mini`. |
| `[fatal] Data pack directory not found` | `data/` is missing. Restore it or set `PARCELPILOT_DATA_DIR`. |

## Usage

### Customer Mode
1. Select "Customer Mode" from the dropdown
2. Choose the account you are signed in as
3. Ask questions like:
   - "Can I cancel ORD-1001 without a cancellation fee? Explain why."
   - "A pickup is three hours late because of carrier fault. Should I get a service credit?"
   - "What's my first-response target for a P1 incident?"

### Support Staff Mode
1. Select "Support Staff Mode"
2. Full operational data across all accounts, plus the ability to propose escalations
3. Examples:
   - "Is ORD-2002 eligible for a failed-pickup service credit? Show your working."
   - "TKT-501 is a full outage for Northstar. Are we inside our response target?"
   - "A customer asks why their SwiftShip order still shows BOOKED after pickup."

### Source authority

The pack is deliberately inconsistent, and the system resolves it in the order stated in
Support Policy v3 §1:

| Rank | Source | Example |
|---|---|---|
| 1 | Signed customer agreement | Northstar may cancel a BOOKED shipment with **no fee**, whatever the SOP says |
| 2 | Current policy / SOP | Default is a INR 250 fee after 30 minutes |
| 3 | Current product documentation | Known issues, plan capabilities |
| — | Deprecated policy (v2) | Retrievable, flagged `superseded`, never answered from |
| — | Past ticket resolutions | Retrievable, flagged context-only; TKT-450's stored answer is wrong for Northstar |

All time-based reasoning is measured against the workbook's dataset snapshot
(`2026-08-16 11:00 Asia/Kolkata`), not the wall clock.

## API Endpoints

### POST `/api/chat`
Process a user query through the AI agent.

**Request:** (`history` is optional; it carries prior turns so follow-up questions work)
```json
{
  "message": "Can I cancel ORD-1001?",
  "context": {
    "userId": "user-123",
    "userType": "customer",
    "accountId": "ACCT-001"
  },
  "history": [{ "role": "user", "content": "..." }]
}
```

**Response:**
```json
{
  "answer": "Yes — under your Enterprise Agreement, Schedule B.3 ...",
  "toolsUsed": ["data_lookup", "document_search"],
  "trace": [
    { "tool": "data_lookup", "input": {...}, "ok": true, "summary": "order ORD-1001" }
  ],
  "sources": ["05_Northstar_Logistics_Enterprise_Agreement.pdf"],
  "proposedActions": [],
  "iterations": 2,
  "model": "gpt-4o",
  "context": {...}
}
```

`503 agent_unavailable` means the model could not be reached (bad key, no quota,
unavailable model); the `message` field says which.

### POST `/api/confirm-action`
Confirm or reject a state-changing action the agent proposed. Staff only. The `actionId`
must match a live pending action — it cannot be fabricated, and it cannot be replayed.

**Request:**
```json
{
  "actionId": "uuid-from-proposedActions",
  "context": { "userId": "s1", "userType": "support_staff" },
  "confirm": true
}
```

Returns `403` for a customer, `404` for an unknown action, `409` if already resolved.

### GET `/api/health`
Health check. Reports the model, whether a key is configured, and whether the knowledge
base and operational data came from the real pack or the bundled seed.

### GET `/api/accounts`
Account list used to populate the UI's account picker.

## Architecture Decisions

### Agent Design
- **Tool-based approach**: Agent selects from 3+ specialized tools based on query
- **Multi-step reasoning**: Complex queries decomposed into tool calls
- **Source ranking**: Results weighted by reliability and recency

### Access Control
- **Enforcement at tool layer**: Not reliant on model instructions alone
- **Role-based access**: Different capabilities for customer vs staff
- **Account scoping**: Customers can only access their own data

### Source Reliability
- **High reliability**: Current policies (v3+), signed agreements
- **Medium reliability**: Operations guides, recent docs
- **Low reliability**: Deprecated policies, historical information

### UI/UX Decisions
- **Clear tool visibility**: Users see which tools were used
- **Confirmation required**: State-changing actions require explicit approval
- **Role-based interface**: Different mode for customers vs staff

## Data Sources

The system uses the following documents from the assessment data pack:

1. **01_Support_Policy_v3_CURRENT.pdf** (High reliability)
   - Current support policies and procedures

2. **02_Support_Policy_v2_DEPRECATED.pdf** (Low reliability)
   - Deprecated policies for reference only

3. **03_Cancellation_and_Service_Credit_SOP_v4.pdf** (High reliability)
   - Cancellation procedures and service credit guidelines

4. **04_Product_Operations_Guide_and_Known_Issues.pdf** (Medium reliability)
   - Product information and known issues

5. **05_Northstar_Logistics_Enterprise_Agreement.pdf** (High reliability)
   - Northstar customer-specific contract terms

6. **06_LumenWorks_Service_Agreement.pdf** (High reliability)
   - LumenWorks customer-specific contract terms

7. **ParcelPilot_Assessment_Data.xlsx**
   - Account data
   - Order information
   - Ticket history

## Addressing Additional Requirements

### Proactive Issue Detection
This system includes infrastructure for:
- Flagging high-severity tickets near SLA
- Identifying unusual patterns in support activity
- Detecting recurring issues across multiple customers
- Future: ML-based anomaly detection

### Trust and Reliability
- Source reliability scores (high/medium/low)
- Explicit conflict handling for policy overrides
- Clear uncertainty messaging
- Escalation recommendations for complex cases

## Deployment Options

### Vercel/Netlify (Frontend)
```bash
cd client
npm run build
# Deploy the dist folder
```

### Railway/Render (Backend)
```bash
npm run build
npm start
```

Set `OPENAI_API_KEY` environment variable.

## Future Enhancements

1. **Vector embeddings** for semantic document search (Pinecone/Weaviate)
2. **Persistent chat history** with PostgreSQL
3. **Real-time notifications** for urgent issues
4. **Analytics dashboard** for support metrics
5. **Webhook integration** for automatic escalation routing
6. **Fine-tuned models** for domain-specific responses
7. **Multi-language support**
8. **Mobile app** with push notifications

## Testing

```bash
npm test
```

## Troubleshooting

**Port already in use:**
```bash
# Change PORT in .env or use different ports
PORT=3002 npm run dev:server
```

**CORS errors:**
- Ensure backend is running on port 3001
- Check CORS configuration in server.ts

**Missing data files:**
- Ensure data pack files are in the correct location
- Update paths in server.ts if needed

## Support

For issues or questions, please refer to the assessment guidelines or contact ParcelPilot team.

## License

Assessment project - CalQuity
