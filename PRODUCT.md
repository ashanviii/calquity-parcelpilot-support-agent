# Product Note: ParcelPilot AI Support

## Which Additional Problem Was Addressed

I addressed **Problem 2: Trust and Reliability**.

The data pack is deliberately inconsistent — a deprecated policy contradicts the current
one, two customer agreements override the general rules in different ways, two accounts
have no agreement at all, and closed tickets contain answers that were wrong when they were
given. A confidently incorrect answer here is worse than no answer, so this is where the
work went.

**1. Precedence is enforced in retrieval, not just requested in the prompt**

Every passage carries authority metadata. Ranking multiplies the relevance score by source
reliability, halves it if the document is superseded, and boosts an agreement when it
belongs to the account asking. The order comes from the pack itself (Support Policy v3 §1):
signed agreement → current policy/SOP → product documentation.

**2. Unreliable sources are surfaced and labelled, not hidden**

Deprecated policy v2 and past ticket resolutions stay searchable, down-weighted, carrying a
context-only trust note. Hiding them would make the agent silently ignore a contradiction;
surfacing them lets it say *"a previous ticket told you X, that was wrong for your account,
here is the current position."*

The pack makes this concrete: TKT-450 told Northstar a INR 250 cancellation fee applied
after 30 minutes. Northstar's agreement waives that fee entirely. An agent that trusted
ticket history would repeat a two-month-old mistake to the customer it most affects.

**3. Facts and rules are computed separately**

`compute_case_facts` returns timing, fault and money figures but never decides the outcome.
The decision has to come from a retrieved document. This makes it structurally harder for
the model to skip precedence and answer from memory.

**4. Refusal is a designed path**

The SOP forbids promising a credit when carrier fault, pickup timing or customer fault is
unknown, so the fault flags are returned explicitly and the agent is instructed to say what
needs verifying rather than guess. Retrieval returning nothing produces "not covered by the
supplied documents, escalating" rather than an invented figure.

**5. The reasoning is inspectable**

Every answer shows which tools ran, with what arguments, and which documents were cited —
expandable in the UI. Reviewable reasoning is what makes a support tool trustworthy in
practice; an answer you cannot audit is one the team will not rely on.

**Not addressed: Problem 1 (Proactive Issue Detection).** Deliberately out of scope for this
submission — see *Recommended Future Builds* below, where it is the highest-priority next
build, and *What Was Intentionally Left Out*.

## Product Decisions & Reasoning

### 1. Dual-Context System (Customer + Staff)

**Decision:** Build both customer-facing and internal support modes.

**Why:**
- Customers need self-service for common questions
- Support team needs deeper investigation tools
- Single system serves both reduces maintenance
- Enables seamless escalation between modes

**Trade-off:** More complex role management, but delivers more value

### 2. Four Tools with Clear Separation

**Decision:** Document search, structured-data lookup, case-fact calculation, and
state-changing actions. The brief required three; calculation was split out from lookup so
that retrieving a record and reasoning about it stay separate concerns.

**Why:**
- Each tool has distinct responsibility
- Clear permission boundaries
- Tool visibility helps users understand reasoning
- Extensible pattern for new tools

**What Each Does:**
- **Search**: Non-destructive, read-only document lookup with authority weighting
- **Lookup**: Account-specific record retrieval with access control
- **Calculate**: Timing/fault/fee facts only — never the decision, which must come from a
  retrieved document
- **Actions**: Escalations requiring confirmation (audit trail)

### 3. Explicit Source Reliability Scoring

**Decision:** Three-tier reliability model (high/medium/low).

**Why:**
- Trust and reliability are ParcelPilot's #1 concern
- Different sources have different authority
- Policies change; contracts are binding
- Clearly surfacing uncertainty reduces confidently-wrong answers

**How It Works:**
- Current policies (v3) > Deprecated policies (v2)
- Signed agreements > General policies
- Recent docs > Historical information
- Conflicts explicitly flagged

### 4. Confirmation Required for State Changes

**Decision:** All escalations/actions require explicit user confirmation.

**Why:**
- Safety: Users control outcomes
- Transparency: Users see exactly what will happen
- Audit trail: Clear intent recording
- Reduces wrong actions from misunderstanding

**UX Impact:** One extra click, but feels more trustworthy

### 5. Account-Scoped Access Control

**Decision:** Customers can only see their own data; support sees all.

**Why:**
- Security requirement: Prevent data leaks
- Compliance: Customer data isolation
- Trust: Customers confident their data is private
- Support needs full context for investigation

**Implementation:** Enforced at tool layer, not model instructions

### 6. React Chat Interface with Tool Visibility

**Decision:** Show which tools were used to answer questions.

**Why:**
- Transparency: Users see system's reasoning
- Debugging: Easy to spot wrong tool usage
- Trust: "I found this in your contract" is more convincing than generic answer
- Product value: Tool visibility becomes feature, not implementation detail

## Product Features Not in Minimum Requirements

### Implemented in Base System

1. **Multi-step Query Support**
   - Single query decomposed into multiple tool calls
   - Example: "Can I cancel without fee?" calls order lookup → contract search → policy check

2. **Source Citation**
   - Every answer includes source documents
   - Reliability scores shown
   - Users know where information comes from

3. **Escalation Decision Logic**
   - System recommends escalation when:
     - Information conflicted
     - Requires judgment
     - Outside SLA to resolve
   - Clear explanation of why escalation needed

4. **Role-Based Interfaces**
   - Same chat surface, different capabilities: customers pick an account and get
     customer-appropriate suggested questions; staff get investigation-shaped ones and the
     confirm/reject controls for proposed actions
   - Switching persona clears the transcript, so a staff answer about one account cannot
     sit in context during a customer session
   - Same backend; the difference is enforced server-side, not by hiding UI

### Recommended Future Builds

#### Phase 2: Proactive Issue Detection (Priority 1)

**Why It Matters:**
- Reactive support only helps after problems occur
- Proactive detection reduces support load
- Identifies patterns humans miss
- Revenue protection (catch issues before escalation)

**What To Build:**
1. **Issue Clustering**
   - Group similar tickets/complaints
   - "Multiple late pickup reports from FedEx in region X"

2. **SLA Monitoring**
   - Track time-to-resolution by category
   - Alert when approaching SLA limits
   - Escalate high-severity tickets automatically

3. **Anomaly Detection**
   - Detect unusual patterns in orders
   - Shipments with repeated issues
   - Customers with higher complaint rates
   - Carrier performance degradation

4. **Trend Analysis**
   - Sudden spike in similar issues
   - New issue types emerging
   - Seasonal patterns

**Implementation Approach:**
- Build separate analytics pipeline
- Use time-series data (tickets/orders over time)
- ML-based anomaly detection
- Real-time alerting to operations team
- Integration with main chatbot for context

**Expected Impact:**
- 30% reduction in escalation time
- Early detection of systemic issues
- Improved customer satisfaction
- Revenue protection from systemic failures

#### Phase 3: Trust & Reliability Enhancements (Priority 2)

**Why It Matters:**
- Incorrect answers erode adoption
- Confidence-weighted responses build trust
- Clear uncertainty signals honesty
- Support team adoption drives user adoption

**What To Build:**
1. **Confidence Scoring**
   - Every answer includes confidence score
   - Low confidence → automatic escalation
   - "I'm 85% confident based on current policy"

2. **Policy Conflict Resolution**
   - Automatic detection when policies contradict
   - Clear explanation of why (v3 vs v2)
   - Contract override identification
   - Recommendation of source to follow

3. **Historical Learning**
   - Track which sources were most accurate
   - Learn when to trust which documents
   - Feedback loop: if answer was wrong, adjust reliability

4. **Explanation Engine**
   - Always explain "why" not just "what"
   - Show reasoning chain (like chain-of-thought)
   - Cite specific policy sections
   - Highlight assumptions made

5. **Peer Review Mode**
   - Support staff can rate answer quality
   - Feedback improves future responses
   - Flag answers for retraining
   - Public explanation of corrections

6. **Implementation Approach:**
   - Add confidence metadata to all responses
   - Implement BLEU/ROUGE scoring vs policy documents
   - Support staff rating system (database)
   - Retraining pipeline based on feedback
   - Visualization dashboard

#### Phase 4: Operational Intelligence (Priority 3)

**Why It Matters:**
- Operations team needs data-driven decisions
- ParcelPilot wants to understand support patterns
- Enables continuous improvement
- Identifies systemic issues early

**What To Build:**
1. **Analytics Dashboard**
   - Query volume, response times, escalation rates
   - Tool usage analytics
   - Customer satisfaction trends
   - Support team productivity metrics

2. **Reporting System**
   - Automated reports (daily/weekly)
   - Trend identification
   - SLA performance by customer/category
   - Revenue impact of issues

3. **Alerts & Automation**
   - High-severity issue alerts
   - Automatic escalation routing
   - Batch processing of related tickets
   - Customer outreach for affected shipments

4. **Feedback Loop**
   - Customer satisfaction surveys post-resolution
   - Support staff notes on resolution quality
   - Continuous improvement process
   - Model retraining based on outcomes

#### Phase 5: Omnichannel Expansion (Priority 4)

**Why It Matters:**
- Customers expect support on their preferred channel
- Current implementation is web-only
- Email/SMS/WhatsApp would increase adoption

**What To Build:**
1. **Email Interface**
   - Support ticket emails routed to agent
   - Responses sent via email
   - Full conversation history

2. **SMS Channel**
   - Quick status updates for urgent queries
   - Short-form responses
   - Escalation triggers support team

3. **WhatsApp/Messaging Apps**
   - Emerging preference in some markets
   - Rich messaging support
   - Integration with main system

4. **Synchronization**
   - Customer context maintained across channels
   - Conversation history unified
   - Escalations routed intelligently

## What Was Intentionally Left Out

### 1. Database Persistence
- Current: In-memory data structures
- Reason: Assessment focus is on agent logic, not database design
- Production: Would add PostgreSQL + Redis

### 2. Proactive Issue Detection (Problem 1)
- Current: not built
- Reason: I chose to go deep on Problem 2 rather than shallow on both. The pack holds
  4 accounts and 7 tickets — enough to *display* a dashboard, not enough for clustering or
  anomaly detection to mean anything. A recurring-issue view built on this volume would
  demo well and mislead.
- Next: the data model already supports it — see Phase 2 below

### 3. Vector Embeddings / Hybrid Retrieval
- Current: BM25 only
- Reason: ~25 passages across six short documents, with questions phrased in the documents'
  own vocabulary. Embeddings would add an API call on the request path and non-determinism
  to ranking, for recall the corpus does not need.
- Next: hybrid BM25 + embeddings once the corpus grows past a few dozen documents, or when
  question phrasing diverges from document wording

### 4. A Rule Engine for Conflict Resolution
- Current: precedence is applied through retrieval ranking plus explicit instruction, and
  the agent reasons over labelled sources
- Reason: this handles the conflicts present in the pack. A declarative rule engine is the
  right answer when precedence itself becomes contested or multi-dimensional.
- Next: encode precedence as data rather than ranking weights if contract variety grows

### 5. Customer Feedback Loop
- Current: No rating system
- Reason: Would require persistence layer
- Future: Add thumbs up/down, explicit ratings, feedback text

### 6. Advanced Anomaly Detection
- Current: not built
- Reason: needs historical volume this pack does not contain
- Future: implement once real ticket volume exists

### 7. Persistent Action Ledger
- Current: proposed and confirmed actions live in an in-memory map, so they are lost on
  restart
- Reason: the audit trail is the part that matters for the confirmation flow, and its shape
  is settled; the storage behind it is not interesting at this scale
- Production: append-only table, since this is the record of who authorised what

### 8. An Answer-Quality Evaluation Set
- Current: `verify.ts` covers mechanics — access control, ranking order, the arithmetic —
  but not whether the agent's *answers* are right
- Reason: the mechanics are what regress silently; answer quality was checked by hand
  against the pack's own examples
- Next: a scored set of question/expected-answer pairs, especially paraphrases that avoid
  the documents' vocabulary, since that is exactly where BM25 is weakest. Without it,
  there is no way to tell whether a prompt change helped or hurt.

## Metrics to Judge Product Success

**The one metric: corrected-answer rate.**

The share of AI answers a human had to correct on substance — a wrong fee, a missed contract
override, a stale policy, an invented figure.

Why this one, over the more obvious time-saved metric: the failure mode that kills this
product is a confidently wrong answer, not a slow one. Time savings is the outcome we want,
but it is a *lagging* consequence of trust. If corrected-answer rate is bad, the team stops
relying on the tool and time savings never arrive no matter how fast it is. If it is good,
time savings follow. It also fails loudly — one bad cancellation-fee answer to an enterprise
account is visible immediately, whereas a slow answer is merely annoying.

- **Target:** below 5%, measured on a sampled review of answers by the ops team
- **Measurement:** support staff flag corrections in the ticket; sample weekly
- **Watch alongside it:** the escalation rate. Driving corrections to zero by escalating
  everything is not a win, so the pair has to be read together.

**Business outcome it drives: Support Team Time Savings**

Average time for support staff to resolve a ticket with AI vs. without.

- **Target:** 30% reduction in median resolution time
- **Measurement:** Track via ticketing system timestamps
- **Breakdown by category:**
  - Simple policy questions: 70% reduction expected
  - Complex investigations: 20% reduction expected
  - Escalations: 10% reduction (handling/routing only)

**Secondary Metrics:**
1. **Customer Self-Service Rate**
   - % of issues resolved without human escalation
   - Target: 40%

2. **First-Response Accuracy**
   - % of AI responses that don't require human correction
   - Target: 85%

3. **Escalation Quality**
   - % of escalations that include complete context
   - Target: 95%

4. **Customer Satisfaction**
   - NPS or CSAT score
   - Target: +10 point improvement

5. **AI Cost Efficiency**
   - Cost per resolved query (GPT-4 tokens)
   - Keep below 50% of human time cost

## Conclusion

ParcelPilot AI Support is positioned as:

- **For Customers:** Self-service, trustworthy answers with clear sourcing
- **For Support Team:** Powerful investigation tool, reduces routine work
- **For Operations:** Proactive issue detection, continuous improvement

The minimum requirements deliver immediate value (30% time savings expected). The additional phases (2-5) layer in proactive detection, enhanced trust, and operational intelligence, building toward a complete AI-powered support ecosystem.

The system is conservative by design—when in doubt, it escalates. This builds trust and prevents the "confidently wrong answer" that would tank adoption.
