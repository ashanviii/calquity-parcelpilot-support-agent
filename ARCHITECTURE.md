# Architecture Note: ParcelPilot AI Support System

## System Overview

The ParcelPilot AI Support System is a multi-context chatbot designed to serve both customer-facing and internal operational use cases. Built on a modern stack of TypeScript, Node.js/Express, React, and LangChain, it provides intelligent query resolution with explicit access control and source reliability management.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (React)                             │
│  - Chat Interface                                                │
│  - User Context Selection (Customer/Staff/Operations)            │
│  - Tool Visibility & Action Confirmation                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP/REST
┌──────────────────────────▼──────────────────────────────────────┐
│                 Backend API (Express)                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Agent Orchestration (LangChain)             │   │
│  │  - Query Understanding                                   │   │
│  │  - Multi-step Tool Orchestration                         │   │
│  │  - Confidence & Escalation Decisions                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                        │
│        ┌─────────────────┼─────────────────┐                    │
│        │                 │                 │                    │
│        ▼                 ▼                 ▼                    │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐       │
│  │  Document   │  │  Structured │  │  State-Changing  │       │
│  │  Search     │  │  Data       │  │  Actions         │       │
│  │  Tool       │  │  Lookup     │  │  Tool            │       │
│  └──────┬──────┘  └──────┬──────┘  └────────┬─────────┘       │
└─────────┼──────────────────┼────────────────┼────────────────────┘
          │                  │                │
        ┌─▼──────────┐   ┌──▼────────────┐   │
        │ Documents  │   │ Operational   │   └──► Access Control
        │            │   │ Data          │        Layer
        │ PDFs       │   │               │
        │ (reliability│   │ - Accounts    │
        │  scored)   │   │ - Orders      │
        └────────────┘   │ - Tickets     │
                         └───────────────┘
```

## Agent Design

### Core Components

#### 1. Query Understanding Layer
- Parses user input to determine:
  - Query type (informational, action-based, escalation)
  - Required context (account, order, ticket)
  - Confidence level needed
  - Applicable policies/agreements

#### 2. Tool Selection Logic
Agent selects from three main tool categories:

**Tool 1: Document Search/Retrieval**
- Searches across all source documents
- Returns results ranked by:
  - Relevance to query
  - Source reliability (high/medium/low)
  - Document freshness
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

**Tool 3: State-Changing Actions**
- Creates escalations, updates tickets, generates tasks
- Always requires explicit user confirmation
- Actions include:
  - Escalating to human support
  - Updating ticket status
  - Creating follow-up tasks
  - Scheduling callbacks
- Example: "Escalate for manager review" + user confirms

#### 3. Multi-Step Orchestration
Complex queries decompose into sequential tool calls:

Example: "Can Northstar cancel ORD-1001 without a fee?"
1. **Data Lookup**: Retrieve order ORD-1001
   - Get order details, account, carrier info
2. **Document Search**: Find Northstar's contract
   - Look for account-specific cancellation terms
3. **Document Search**: Find general cancellation policy
   - Reference current SOP (v4)
4. **Reasoning**: Compare contract vs policy
   - Northstar enterprise agreement may override general policy
5. **Response**: Provide clear answer with source citations

### Source Reliability System

Three-tier reliability model informs answer confidence:

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

Conflicts are resolved by:
1. Preferring current over deprecated
2. Preferring contract-specific over general policy
3. Preferring authority hierarchy (agreement > policy > procedures)
4. Flagging ambiguities for escalation

### Confidence & Escalation Logic

Agent escalates when:
- Query requires judgment outside system authority
- Conflicting information from multiple sources
- Information is outdated or uncertain
- Requires financial/legal decision (credits, refunds)
- Customer requests human contact
- Unusual patterns or edge cases

## Access Control Architecture

### Enforcement Strategy

Access control is enforced at the **tool layer**, not model instructions:

```typescript
// Pseudocode
function enforceAccessControl(user: User, resource: Resource) {
  if (user.type === 'customer') {
    // Only allow access to own account data
    if (resource.accountId !== user.accountId) {
      throw AccessDeniedError();
    }
  } else if (user.type === 'support_staff') {
    // Support staff can access all operational data
    return true;
  }
  // Other roles handled similarly
}
```

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
- ✓ Update tickets and orders
- ✓ View all customer information

**Operations Staff Context**
- ✓ Similar to support staff
- ✓ Plus: Access to analytics, patterns
- ✓ Can create system-level tasks

### Mock Authentication

For this implementation:
- Users authenticated by userId + userType
- Account context passed in request
- In production: Would integrate with OAuth/SAML
- Session management: Would use JWT tokens

## Data Handling

### Document Processing

1. **Loading**: PDF parsing at startup
   - Extracts text, structure
   - Identifies sections and headers
2. **Indexing**: Semantic chunking
   - Creates searchable passages
   - Preserves context windows
3. **Retrieval**: Vector similarity search
   - Current: Simulated with keyword matching
   - Future: Pinecone/Weaviate vector store
4. **Ranking**: Reliability-weighted results
   - High-reliability docs ranked first
   - Recent dates preferred

### Structured Data

1. **Excel Import**: ParcelPilot_Assessment_Data.xlsx
   - Account master data
   - Order information with timestamps
   - Ticket resolution history
   - SLA definitions

2. **Normalization**:
   - Consistent ID formats
   - Timezone handling
   - Reference data validation

3. **Caching**: 
   - In-memory for demo
   - Would use Redis in production

## Technical Trade-offs

### Decision: LangChain over Custom Agent Loop

**Why LangChain:**
- Production-ready agent framework
- Handles tool selection automatically
- Built-in chain-of-thought reasoning
- Easy model swapping (GPT-4, Claude, etc.)
- Extensive tool library

**Alternative Considered:**
- Custom agent loop with function calling
- Gives more control but more code
- More brittle, harder to debug
- Abandoned in favor of robustness

### Decision: Simulated Data in Demo

**Why Simulated:**
- Faster development and testing
- Works without Excel library complications
- Consistent test scenarios
- Easy to add more mock data

**Production Version:**
- Load actual Excel data
- Real database queries
- API integration with order systems

### Decision: React Frontend with Vite

**Why Vite:**
- Fast hot reload for development
- Small production bundle
- Native ESM support
- TypeScript out of the box

**Why React:**
- Component reusability
- Large ecosystem (UI libraries, etc.)
- Developer familiar with patterns

**Alternative:**
- Vue, Svelte for smaller bundles
- But React offers faster hiring/scaling

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

### Production (Recommended)

```
┌───────────────────────────────────────┐
│ Vercel / Netlify / S3                 │
│ (React Build)                         │
│ Domain: https://parcelpilot-ai.com    │
└─────────────────┬─────────────────────┘
                  │
                  │ HTTPS
                  ▼
┌───────────────────────────────────────┐
│ Railway / Render / AWS Lambda         │
│ (Express Server)                      │
│ Domain: https://api.parcelpilot.com   │
│ Env: OPENAI_API_KEY, DATABASE_URL     │
└───────────────────────────────────────┘
```

## Security Considerations

1. **API Keys**: 
   - OPENAI_API_KEY in environment only
   - Never committed to version control

2. **Data Access**:
   - Access control enforced per request
   - No privilege escalation possible

3. **Input Validation**:
   - User queries sanitized
   - Parameter validation on all API calls

4. **Rate Limiting**:
   - Should implement in production
   - Prevent abuse of API

5. **Logging**:
   - Query logs for audit trail
   - Sensitive data excluded from logs

## Monitoring & Observability

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

## Conclusion

This architecture balances production-readiness with assessment requirements:

✅ Enforces access control at tool layer  
✅ Tracks source reliability explicitly  
✅ Supports complex multi-step queries  
✅ Requires confirmation for actions  
✅ Easy to extend with new tools  
✅ Clear separation of concerns  
✅ Scalable to production deployment  

Future iterations would add vector embeddings, persistent data stores, and more sophisticated agent reasoning, but the foundation supports these enhancements.
