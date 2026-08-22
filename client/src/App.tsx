import { useState, useRef, useEffect } from 'react';
import './App.css';
import calquityLogo from './assets/calquity-logo.jpg';

/**
 * Requests go through the Vite dev proxy (see vite.config.ts), so the backend host is not
 * hardcoded here. Set VITE_API_BASE for a deployment where the API lives elsewhere.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

type UserType = 'customer' | 'support_staff';

interface ToolCallTrace {
  tool: string;
  input: unknown;
  ok: boolean;
  summary: string;
}

interface Citation {
  source: string;
  title: string;
  kind: string;
  reliability: 'high' | 'medium' | 'low';
  superseded: boolean;
  ownAgreement: boolean;
}

interface ProposedAction {
  actionId: string;
  action: string;
  summary: string;
  params: Record<string, unknown>;
  status: 'awaiting_confirmation' | 'executed' | 'rejected';
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  trace?: ToolCallTrace[];
  sources?: Citation[];
  actions?: ProposedAction[];
  isError?: boolean;
}

interface AccountOption {
  account_id: string;
  account_name: string;
  plan: string;
  hasAgreement: boolean;
}

/** Each example is chosen to show a different part of the reasoning, hence the hints. */
const EXAMPLES: Record<UserType, { q: string; hint: string }[]> = {
  customer: [
    {
      q: 'Can I cancel ORD-1001 without a cancellation fee? Explain why.',
      hint: 'Contract overrides the SOP default — and a past ticket got this wrong',
    },
    {
      q: 'A pickup is three hours late because of carrier fault. Should I get a service credit?',
      hint: 'Depends on your agreement: the threshold is not the same for every account',
    },
    {
      q: "What's my first-response target for a P1 incident?",
      hint: 'Current policy vs. the deprecated one vs. your signed terms',
    },
  ],
  support_staff: [
    {
      q: 'Is ORD-2002 eligible for a failed-pickup service credit? Show your working.',
      hint: 'Timing measured against the dataset snapshot, plus fault flags',
    },
    {
      q: 'TKT-501 is a full outage for Northstar. Are we inside our response target?',
      hint: 'Severity, contract SLA, and whether it is already breached',
    },
    {
      q: 'A customer asks why their SwiftShip order still shows BOOKED after pickup.',
      hint: 'Known issue KI-211 in the operations guide',
    },
  ],
};

function reliabilityLabel(c: Citation): { cls: string; text: string } {
  if (c.ownAgreement) return { cls: 'badge-governing', text: 'governing' };
  if (c.superseded) return { cls: 'badge-superseded', text: 'superseded' };
  if (c.kind === 'historical_ticket') return { cls: 'badge-low', text: 'context only' };
  return { cls: `badge-${c.reliability}`, text: c.reliability };
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userType, setUserType] = useState<UserType>('customer');
  const [accountId, setAccountId] = useState('ACCT-001');
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [snapshot, setSnapshot] = useState('');
  const [expandedTrace, setExpandedTrace] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    fetch(`${API_BASE}/api/accounts`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setAccounts(d.accounts ?? []);
        setSnapshot(d.snapshot ?? '');
      })
      .catch(() => setAccounts([]));
  }, []);

  // Switching persona starts a new session. The transcript is posted back to /api/chat as
  // `history` and replayed into the model verbatim, so carrying it across a switch would let
  // a staff answer about one account surface inside another account's customer session. The
  // tools stay locked down either way, but the prior text would still be sitting in context.
  useEffect(() => {
    setMessages([]);
    setExpandedTrace({});
  }, [userType, accountId]);

  const buildContext = () => ({
    userId: 'user-123',
    userType,
    accountId: userType === 'customer' ? accountId : undefined,
  });

  const send = async (text: string) => {
    const query = text.trim();
    if (!query || loading) return;

    const userMessage: Message = { id: `msg-${Date.now()}`, role: 'user', content: query };
    // Snapshot the history the model should see, excluding the turn we are about to send.
    const history = messages
      .filter((m) => !m.isError)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, context: buildContext(), history }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || `Server returned ${response.status}`);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-response`,
          role: 'assistant',
          content: data.answer || '(the model returned an empty answer)',
          toolsUsed: data.toolsUsed,
          trace: data.trace,
          sources: data.sources,
          actions: data.proposedActions,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-error`,
          role: 'assistant',
          isError: true,
          content: `Could not get an answer: ${(error as Error).message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const resolveAction = async (messageId: string, action: ProposedAction, confirm: boolean) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/confirm-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: action.actionId, context: buildContext(), confirm }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Server returned ${response.status}`);

      const newStatus: ProposedAction['status'] = confirm ? 'executed' : 'rejected';

      setMessages((prev) => [
        ...prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                actions: m.actions?.map((a) =>
                  a.actionId === action.actionId ? { ...a, status: newStatus } : a,
                ),
              }
            : m,
        ),
        {
          id: `msg-${Date.now()}-action`,
          role: 'assistant',
          content: confirm
            ? `${data.message}${data.effects?.length ? ` ${data.effects.join('; ')}.` : ''}`
            : 'Action cancelled. Nothing was changed.',
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-action-error`,
          role: 'assistant',
          isError: true,
          content: `Could not complete that action: ${(error as Error).message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const visibleAccounts: AccountOption[] =
    accounts.length > 0
      ? accounts
      : [
          {
            account_id: 'ACCT-001',
            account_name: 'Northstar Logistics',
            plan: 'Enterprise',
            hasAgreement: true,
          },
        ];

  const selectedAccount = visibleAccounts.find((a) => a.account_id === accountId);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img className="brand-mark" src={calquityLogo} alt="CalQuity" />
          <div className="brand-text">
            <h1>ParcelPilot Support</h1>
            {snapshot && <span className="snapshot">data as of {snapshot}</span>}
          </div>
        </div>

        <div className="user-context">
          <div className="mode-switch" role="group" aria-label="User context">
            <button
              type="button"
              className={userType === 'customer' ? 'is-active' : ''}
              onClick={() => setUserType('customer')}
              aria-pressed={userType === 'customer'}
              // An in-flight answer would land in the cleared transcript under the new
              // persona, so hold the switch until it settles.
              disabled={loading}
            >
              Customer
            </button>
            <button
              type="button"
              className={userType === 'support_staff' ? 'is-active' : ''}
              onClick={() => setUserType('support_staff')}
              aria-pressed={userType === 'support_staff'}
              disabled={loading}
            >
              Support staff
            </button>
          </div>

          {userType === 'customer' && (
            <select
              className="account-select"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              aria-label="Signed in as account"
              disabled={loading}
            >
              {visibleAccounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.account_name} · {a.plan}
                </option>
              ))}
            </select>
          )}

          {userType === 'customer' &&
            (selectedAccount?.hasAgreement ? (
              <span className="agreement-flag">agreement</span>
            ) : (
              <span className="agreement-flag is-none">no agreement</span>
            ))}
        </div>
      </header>

      <main className="chat-container">
        <div className="messages">
          <div className="messages-inner">
            {messages.length === 0 ? (
              <div className="welcome">
                <h2>
                  {userType === 'customer'
                    ? 'How can we help with your shipments?'
                    : 'Investigate an account, order or ticket'}
                </h2>
                <p className="welcome-sub">
                  {userType === 'customer'
                    ? 'Ask about cancellations, service credits, support SLAs or a specific order. Answers cite the policy or agreement they came from.'
                    : 'Full operational data across all accounts. The agent can propose escalations, credits and cancellations — each one waits for your confirmation.'}
                </p>

                <div className="examples-label">Try one</div>
                <ul className="example-list">
                  {EXAMPLES[userType].map((ex) => (
                    <li key={ex.q}>
                      <button type="button" className="example-btn" onClick={() => send(ex.q)}>
                        {ex.q}
                        <span className="example-hint">{ex.hint}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`message message-${msg.role}`}>
                  <div className={`message-content${msg.isError ? ' message-error' : ''}`}>
                    <div className="message-text">{msg.content}</div>

                    {msg.sources && msg.sources.length > 0 && (
                      <div className="sources">
                        <div className="sources-label">Sources</div>
                        {msg.sources.map((c) => {
                          const badge = reliabilityLabel(c);
                          return (
                            <div className="source-row" key={c.source}>
                              <span className="source-name">{c.title || c.source}</span>
                              <span className={`badge ${badge.cls}`}>{badge.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {msg.actions?.map((action) => (
                      <div key={action.actionId} className="action-card">
                        <div className="action-head">
                          Proposed action
                          <span className="action-kind">{action.action}</span>
                        </div>
                        <div className="action-summary">{action.summary}</div>

                        {action.status === 'awaiting_confirmation' ? (
                          <>
                            <div className="action-pending-note">
                              Nothing has happened yet — this runs only if you confirm.
                            </div>
                            <div className="action-buttons">
                              <button
                                className="confirm-btn"
                                disabled={loading}
                                onClick={() => resolveAction(msg.id, action, true)}
                              >
                                Confirm
                              </button>
                              <button
                                className="reject-btn"
                                disabled={loading}
                                onClick={() => resolveAction(msg.id, action, false)}
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className={`action-status action-${action.status}`}>
                            {action.status === 'executed' ? 'Executed' : 'Rejected'}
                          </div>
                        )}
                      </div>
                    ))}

                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="tools-used">
                        <button
                          type="button"
                          className="trace-toggle"
                          onClick={() =>
                            setExpandedTrace((p) => ({ ...p, [msg.id]: !p[msg.id] }))
                          }
                          aria-expanded={Boolean(expandedTrace[msg.id])}
                        >
                          <span
                            className={`trace-chevron${expandedTrace[msg.id] ? ' is-open' : ''}`}
                          >
                            ▶
                          </span>
                          {msg.trace?.length ?? 0} tool call
                          {(msg.trace?.length ?? 0) === 1 ? '' : 's'}
                          {msg.toolsUsed.map((t) => (
                            <span className="tool-pill" key={t}>
                              {t}
                            </span>
                          ))}
                        </button>

                        {expandedTrace[msg.id] && msg.trace && (
                          <ol className="trace-list">
                            {msg.trace.map((t, i) => (
                              <li
                                key={i}
                                className={`trace-item${t.ok ? '' : ' is-denied'}`}
                              >
                                <div className="trace-head">
                                  <span className="trace-tool">{t.tool}</span>
                                  <span className="trace-summary">{t.summary}</span>
                                </div>
                                <pre className="trace-args">{JSON.stringify(t.input)}</pre>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {loading && (
              <div className="message message-assistant">
                <div className="message-content">
                  <div className="loading">
                    <span className="dots">
                      <span />
                      <span />
                      <span />
                    </span>
                    Searching policies and account records
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <footer className="input-area">
          <div className="input-wrapper">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={
                userType === 'customer'
                  ? 'Ask about an order, a policy or a service credit…'
                  : 'Ask about any account, order or ticket…'
              }
              disabled={loading}
              autoFocus
            />
            <button className="send-btn" onClick={() => send(input)} disabled={loading || !input.trim()}>
              Send
            </button>
          </div>
          <div className="composer-hint">
            {userType === 'customer'
              ? `Answering as ${selectedAccount?.account_name ?? accountId} — you only see this account's data.`
              : 'Staff context — all accounts visible; actions require confirmation.'}
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
