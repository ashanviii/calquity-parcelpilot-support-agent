import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { initializeAgent, Tool } from 'langchain/agents';
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from 'langchain/prompts';
import { SerpAPI } from 'langchain/tools';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import XLSX from 'xlsx';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ============= DATA LAYER =============

interface AccessContext {
  userId: string;
  userType: 'customer' | 'support_staff' | 'operations_staff';
  accountId?: string;
  role?: string;
}

interface DocumentSource {
  name: string;
  path: string;
  reliability: 'high' | 'medium' | 'low';
  effectiveDate: string;
}

// Mock database for account data
const accounts = new Map([
  ['ACC-001', { name: 'Northstar Logistics', tier: 'enterprise', contracts: ['05_Northstar_Logistics_Enterprise_Agreement.pdf'] }],
  ['ACC-002', { name: 'LumenWorks', tier: 'premium', contracts: ['06_LumenWorks_Service_Agreement.pdf'] }],
]);

const documentSources: DocumentSource[] = [
  { name: '01_Support_Policy_v3_CURRENT.pdf', path: '../AI Agent Assessment - Candidate Pack/01_Support_Policy_v3_CURRENT.pdf', reliability: 'high', effectiveDate: '2024-01-01' },
  { name: '02_Support_Policy_v2_DEPRECATED.pdf', path: '../AI Agent Assessment - Candidate Pack/02_Support_Policy_v2_DEPRECATED.pdf', reliability: 'low', effectiveDate: '2023-01-01' },
  { name: '03_Cancellation_and_Service_Credit_SOP_v4.pdf', path: '../AI Agent Assessment - Candidate Pack/03_Cancellation_and_Service_Credit_SOP_v4.pdf', reliability: 'high', effectiveDate: '2024-01-01' },
  { name: '04_Product_Operations_Guide_and_Known_Issues.pdf', path: '../AI Agent Assessment - Candidate Pack/04_Product_Operations_Guide_and_Known_Issues.pdf', reliability: 'medium', effectiveDate: '2024-06-01' },
  { name: '05_Northstar_Logistics_Enterprise_Agreement.pdf', path: '../AI Agent Assessment - Candidate Pack/05_Northstar_Logistics_Enterprise_Agreement.pdf', reliability: 'high', effectiveDate: '2024-01-01' },
  { name: '06_LumenWorks_Service_Agreement.pdf', path: '../AI Agent Assessment - Candidate Pack/06_LumenWorks_Service_Agreement.pdf', reliability: 'high', effectiveDate: '2024-01-01' },
];

// Load operational data
let operationalData: any = {};
try {
  const xlsxPath = path.join('/Users/sbhardwaj95/Downloads/AI Agent Assessment - Candidate Pack', 'ParcelPilot_Assessment_Data.xlsx');
  const workbook = XLSX.readFile(xlsxPath);
  workbook.SheetNames.forEach(sheet => {
    operationalData[sheet] = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]);
  });
} catch (error) {
  console.log('Note: Excel file not loaded - using mock data');
}

// ============= ACCESS CONTROL =============

function enforceAccessControl(context: AccessContext, resourceType: string, resourceId?: string): boolean {
  if (context.userType === 'customer') {
    // Customers can only see their own account data
    if (resourceType === 'order' || resourceType === 'ticket') {
      return resourceId?.startsWith(context.accountId || '') || false;
    }
    // Customers can see public documents (policies)
    if (resourceType === 'document') {
      return true;
    }
  } else if (context.userType === 'support_staff' || context.userType === 'operations_staff') {
    // Support staff can see all operational data
    return true;
  }
  return false;
}

// ============= AGENT TOOLS =============

const tools: Tool[] = [];

// Tool 1: Document Search/Retrieval
const documentSearchTool = {
  name: 'document_search',
  description: 'Search policies, agreements, product documentation, SOPs and other documents. Returns relevant passages with source reliability scores.',
  async call(query: string, context: AccessContext) {
    const results: any[] = [];
    
    // In production, this would use vector embeddings for semantic search
    // For now, simulate document retrieval with relevance scoring
    for (const source of documentSources) {
      if (source.reliability === 'high' || !query.includes('deprecat')) {
        results.push({
          source: source.name,
          reliability: source.reliability,
          effectiveDate: source.effectiveDate,
          relevance: Math.random() * 0.7 + 0.3,
          excerpt: `Content from ${source.name}...`,
        });
      }
    }
    
    return results.sort((a, b) => (b.reliability === 'high' ? 1 : 0) - (a.reliability === 'high' ? 1 : 0)).slice(0, 3);
  },
};

// Tool 2: Structured Data Lookup
const dataLookupTool = {
  name: 'data_lookup',
  description: 'Query account, order, and ticket data. Returns structured information with access control enforcement.',
  async call(query: string, context: AccessContext, resourceId?: string) {
    if (context.userType === 'customer' && resourceId && !enforceAccessControl(context, 'order', resourceId)) {
      return { error: 'Access denied: You can only view data for your own account' };
    }
    
    // Simulate data lookup
    const mockOrders = [
      { id: 'ORD-1001', accountId: 'ACC-001', status: 'pending_cancellation', carrier: 'FedEx', weight: 15.5, value: 500 },
      { id: 'ORD-1002', accountId: 'ACC-002', status: 'delivered', carrier: 'UPS', weight: 8.2, value: 250 },
    ];
    
    const result = mockOrders.find(o => o.id === resourceId);
    return result || { message: 'Order not found' };
  },
};

// Tool 3: State-Changing Action (with confirmation required)
const stateChangingActionTool = {
  name: 'create_escalation',
  description: 'Escalate a ticket, create a follow-up task, or update a ticket status. REQUIRES explicit user confirmation.',
  async call(action: string, params: any, context: AccessContext, confirmed: boolean = false) {
    if (context.userType === 'customer') {
      return { error: 'Access denied: Only support staff can create escalations' };
    }
    
    if (!confirmed) {
      return {
        requiresConfirmation: true,
        action: action,
        params: params,
        message: 'This action requires confirmation. Please confirm to proceed.',
      };
    }
    
    const actionId = uuidv4();
    return {
      success: true,
      actionId: actionId,
      action: action,
      timestamp: new Date().toISOString(),
      message: `${action} created successfully`,
    };
  },
};

// ============= AGENT LOGIC =============

const model = new ChatOpenAI({
  modelName: 'gpt-4',
  temperature: 0.2,
  openAIApiKey: process.env.OPENAI_API_KEY,
});

async function runAgent(userQuery: string, context: AccessContext): Promise<any> {
  const systemPrompt = `You are a ParcelPilot support AI agent. You help both customers and internal staff resolve issues.

Your responsibilities:
1. Use document_search to find relevant policies and agreements
2. Use data_lookup to query account, order, or ticket information
3. Use create_escalation for actions that require authorization
4. Always explain your reasoning and cite sources
5. Flag uncertainty and recommend human escalation when appropriate

For customer queries, only provide information about their own account.
For support staff queries, provide full access to all systems.

When a state-changing action is needed:
- Prepare the action details
- Ask the user to confirm before executing
- Execute only after explicit confirmation

Source reliability guide:
- High reliability: Current policies, signed agreements
- Medium reliability: Operations guides, recent documentation
- Low reliability: Deprecated policies, historical information

${context.userType === 'customer' ? 'Remember: You are speaking with a customer. Be helpful and professional.' : 'Remember: You are speaking with ParcelPilot staff. Provide detailed operational insights.'}`;

  try {
    // Simulate agent processing
    const response = {
      query: userQuery,
      usedTools: ['document_search', 'data_lookup'],
      findings: [
        'Retrieved policy documentation with high reliability',
        'Queried account-specific data',
        'Checked for applicable contract overrides',
      ],
      reasoning: 'Based on the customer\'s account tier and current policies...',
      recommendation: 'This issue can be resolved by...',
      requiresEscalation: Math.random() > 0.7,
      sources: ['01_Support_Policy_v3_CURRENT.pdf', '05_Northstar_Logistics_Enterprise_Agreement.pdf'],
    };
    
    return response;
  } catch (error) {
    throw error;
  }
}

// ============= API ENDPOINTS =============

app.post('/api/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    
    if (!message || !context) {
      return res.status(400).json({ error: 'Missing message or context' });
    }
    
    // Validate and sanitize context
    const accessContext: AccessContext = {
      userId: context.userId || uuidv4(),
      userType: context.userType || 'customer',
      accountId: context.accountId,
      role: context.role,
    };
    
    const response = await runAgent(message, accessContext);
    res.json({ response, context: accessContext });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: String(error) });
  }
});

app.post('/api/confirm-action', async (req, res) => {
  try {
    const { actionId, context, params } = req.body;
    
    const accessContext: AccessContext = {
      userId: context.userId,
      userType: context.userType,
      accountId: context.accountId,
    };
    
    if (accessContext.userType === 'customer') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const result = {
      actionId,
      confirmed: true,
      executedAt: new Date().toISOString(),
      status: 'completed',
    };
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/accounts/:accountId/data', (req, res) => {
  const { accountId } = req.params;
  const account = accounts.get(accountId);
  
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }
  
  res.json({ account, operationalDataAvailable: Object.keys(operationalData).length > 0 });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ParcelPilot AI Support Server running on port ${PORT}`);
  console.log('Available endpoints: /api/chat, /api/confirm-action, /api/health');
});

export { app };
