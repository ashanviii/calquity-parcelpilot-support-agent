import React, { useState, useRef, useEffect } from 'react';
import './App.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  requiresConfirmation?: boolean;
  actionId?: string;
}

interface AccessContext {
  userId: string;
  userType: 'customer' | 'support_staff' | 'operations_staff';
  accountId?: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userType, setUserType] = useState<'customer' | 'support_staff'>('customer');
  const [accountId, setAccountId] = useState('ACC-001');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          context: {
            userId: 'user-123',
            userType: userType,
            accountId: userType === 'customer' ? accountId : undefined,
          },
        }),
      });

      const data = await response.json();
      
      const assistantMessage: Message = {
        id: `msg-${Date.now()}-response`,
        role: 'assistant',
        content: data.response?.recommendation || data.response?.message || 'Processing complete',
        toolsUsed: data.response?.usedTools,
        requiresConfirmation: data.response?.requiresEscalation,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: 'Error: Could not connect to server. Make sure the backend is running on port 3001.',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = async (actionId: string) => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/confirm-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId,
          context: {
            userId: 'user-123',
            userType: userType,
            accountId: userType === 'customer' ? accountId : undefined,
          },
          params: {},
        }),
      });

      const data = await response.json();
      const confirmMessage: Message = {
        id: `msg-${Date.now()}-confirm`,
        role: 'assistant',
        content: `Action confirmed and executed. Status: ${data.status}. Executed at: ${data.executedAt}`,
      };
      setMessages(prev => [...prev, confirmMessage]);
    } catch (error) {
      console.error('Confirmation error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🚚 ParcelPilot AI Support</h1>
        <div className="user-context">
          <select value={userType} onChange={(e) => setUserType(e.target.value as any)}>
            <option value="customer">Customer Mode</option>
            <option value="support_staff">Support Staff Mode</option>
          </select>
          {userType === 'customer' && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="ACC-001">Northstar Logistics (ACC-001)</option>
              <option value="ACC-002">LumenWorks (ACC-002)</option>
            </select>
          )}
          <div className="user-badge">{userType === 'customer' ? '👤 Customer' : '👨‍💼 Support Staff'}</div>
        </div>
      </header>

      <main className="chat-container">
        <div className="messages">
          {messages.length === 0 ? (
            <div className="welcome">
              <h2>Welcome to ParcelPilot Support</h2>
              <p>Ask questions about your shipments, policies, cancellations, or service credits.</p>
              <div className="example-queries">
                <p><strong>Example questions:</strong></p>
                <ul>
                  <li>"Can I cancel order ORD-1001?"</li>
                  <li>"What's my account's SLA for support?"</li>
                  <li>"Should I get a service credit for a late pickup?"</li>
                </ul>
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`message message-${msg.role}`}>
                <div className="message-content">
                  <div className="message-text">{msg.content}</div>
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="tools-used">
                      <strong>Tools used:</strong> {msg.toolsUsed.join(', ')}
                    </div>
                  )}
                  {msg.requiresConfirmation && msg.actionId && (
                    <div className="confirmation-prompt">
                      <button
                        onClick={() => handleConfirmAction(msg.actionId!)}
                        className="confirm-btn"
                        disabled={loading}
                      >
                        ✓ Confirm Action
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="message message-assistant">
              <div className="message-content">
                <div className="loading">Processing your request...</div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <footer className="input-area">
          <div className="input-wrapper">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about your shipment, policies, or support..."
              disabled={loading}
              autoFocus
            />
            <button onClick={handleSendMessage} disabled={loading || !input.trim()}>
              {loading ? '...' : 'Send'}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
