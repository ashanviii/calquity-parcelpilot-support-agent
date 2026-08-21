# ParcelPilot AI Support System

An AI-powered customer support and operations system for ParcelPilot logistics platform. Built with TypeScript, Express, React, and LangChain.

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
├── server.ts                 # Backend API with agent logic
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
- LangChain (AI agents framework)
- OpenAI GPT-4
- PDF parsing, Excel data handling

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
# Edit .env with your OpenAI API key
```

4. **Ensure data files are in place**
   - The system expects the data pack files in the parent directory:
     - `../AI Agent Assessment - Candidate Pack/*.pdf`
     - `../AI Agent Assessment - Candidate Pack/ParcelPilot_Assessment_Data.xlsx`

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

## Usage

### Customer Mode
1. Select "Customer Mode" from the dropdown
2. Choose your account (Northstar Logistics or LumenWorks)
3. Ask questions like:
   - "Can I cancel order ORD-1001?"
   - "What's my account's SLA?"
   - "Should I get a service credit for a late pickup?"

### Support Staff Mode
1. Select "Support Staff Mode"
2. Access full operational data and can create escalations
3. Examples:
   - Investigate customer issues
   - Create escalations for complex cases
   - View all order and ticket data

## API Endpoints

### POST `/api/chat`
Process a user query through the AI agent.

**Request:**
```json
{
  "message": "Can I cancel ORD-1001?",
  "context": {
    "userId": "user-123",
    "userType": "customer",
    "accountId": "ACC-001"
  }
}
```

**Response:**
```json
{
  "response": {
    "query": "...",
    "usedTools": ["document_search", "data_lookup"],
    "findings": [...],
    "reasoning": "...",
    "recommendation": "...",
    "requiresEscalation": false,
    "sources": [...]
  },
  "context": {...}
}
```

### POST `/api/confirm-action`
Confirm and execute a state-changing action.

**Request:**
```json
{
  "actionId": "action-uuid",
  "context": {...},
  "params": {}
}
```

### GET `/api/health`
Health check endpoint.

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
