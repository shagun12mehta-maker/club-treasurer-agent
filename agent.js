import dotenv from 'dotenv';
import { AGENT_TOOLS, executeTool } from './tools.js';

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are the AI Club Treasurer Agent for a university tech/AI club.
Your core operating principle is: "AI proposes, Humans approve."
You help club members and officers manage club finances safely and transparently.

Capabilities:
1. Propose reimbursements and vendor payouts (Safety rules: spending caps, dual approvals for >=$75, duplicate receipt checks).
2. Create PayPal invoices for club dues and ticket fees.
3. Check treasury balances and query recent audit trails.

Guidelines:
- Always emphasize transparency, prudence, and student organization compliance.
- When proposing payouts, specify clearly that the payout is NOT immediately sent; it requires officer signatures.
- If a user asks for something outside rules (e.g. over $250 or without receipt/details), warn them kindly.`;

/**
 * Main Agent conversation handler with tool-calling loop.
 */
export async function chatWithTreasurerAgent(userMessage, conversationHistory = []) {
  const isRealKey = ANTHROPIC_API_KEY &&
    !ANTHROPIC_API_KEY.includes('your_') &&
    !ANTHROPIC_API_KEY.includes('mock_') &&
    ANTHROPIC_API_KEY.startsWith('sk-ant-');

  // If Anthropic key is not configured, fall back to mock agent handler
  if (!isRealKey) {
    return handleMockAgentTurn(userMessage);
  }

  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  try {
    let currentMessages = [...messages];
    let continueLoop = true;
    let finalAssistantReply = '';
    let executedTools = [];

    while (continueLoop) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: AGENT_TOOLS,
          messages: currentMessages
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API Error (${response.status}): ${errorText}`);
      }

      const responseData = await response.json();
      const content = responseData.content || [];
      const toolUseBlocks = content.filter(block => block.type === 'tool_use');

      // Append assistant message to context
      currentMessages.push({
        role: 'assistant',
        content
      });

      if (toolUseBlocks.length > 0) {
        const toolResultContents = [];

        for (const toolUse of toolUseBlocks) {
          const toolName = toolUse.name;
          const toolArgs = toolUse.input;

          console.log(`🤖 Agent calling tool: ${toolName}`, toolArgs);
          const result = await executeTool(toolName, toolArgs);
          executedTools.push({ toolName, args: toolArgs, result });

          toolResultContents.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        }

        // Send tool results back to Claude
        currentMessages.push({
          role: 'user',
          content: toolResultContents
        });
      } else {
        // No more tool calls; extract final text
        const textBlock = content.find(b => b.type === 'text');
        finalAssistantReply = textBlock?.text || 'Done.';
        continueLoop = false;
      }
    }

    return {
      reply: finalAssistantReply,
      executedTools,
      messages: currentMessages
    };

  } catch (err) {
    console.error('Claude Agent error, falling back to mock response:', err.message);
    return handleMockAgentTurn(userMessage);
  }
}

/**
 * Intelligent fallback when Anthropic API key is not present.
 */
async function handleMockAgentTurn(userMessage) {
  const lower = userMessage.toLowerCase();
  const executedTools = [];

  // Match: Reimbursement / Payout Proposal
  if (lower.includes('reimburse') || lower.includes('pay') || lower.includes('payout')) {
    const amountMatch = userMessage.match(/\$?(\d+(\.\d{1,2})?)/);
    const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 45.00;
    const recipientEmail = emailMatch ? emailMatch[0] : 'member@club.edu';
    const requester = 'Club Officer';

    const toolResult = await executeTool('propose_payout_reimbursement', {
      title: 'Expense Reimbursement via Agent',
      amount,
      recipientEmail,
      requester,
      category: 'Supplies & Catering',
      description: userMessage
    });

    executedTools.push({
      toolName: 'propose_payout_reimbursement',
      args: { amount, recipientEmail },
      result: toolResult
    });

    if (toolResult.status === 'blocked_by_safety_policy') {
      return {
        reply: `⚠️ **Proposal Blocked by Safety Guardrails**\n\nReason: ${toolResult.reason}\nFlags: ${toolResult.flags.join(', ')}`,
        executedTools
      };
    }

    return {
      reply: `I have reviewed your request and generated **Proposal #${toolResult.proposalId}** for **$${toolResult.amount.toFixed(2)}** to **${recipientEmail}**.\n\n🛡️ **Safety Guardrail Status:**\n- **Human Approvals Required:** ${toolResult.requiredApprovals} officer signature(s)\n- **Flags:** ${toolResult.flags.length > 0 ? toolResult.flags.join(', ') : 'None (clean)'}\n\n*Remember: Per club policy, funds will NOT be disbursed via PayPal until an officer signs off on the Dashboard.*`,
      executedTools
    };
  }

  // Match: Balance Check
  if (lower.includes('balance') || lower.includes('treasury') || lower.includes('funds')) {
    const balanceRes = await executeTool('check_treasury_balance', {});
    executedTools.push({ toolName: 'check_treasury_balance', args: {}, result: balanceRes });
    return {
      reply: `🏦 **Club Treasury Status**\n- **Account:** ${balanceRes.treasury.name}\n- **Current Balance:** $${balanceRes.treasury.currentBalance.toFixed(2)} ${balanceRes.treasury.currency}\n- **Initial Budget:** $${balanceRes.treasury.initialBudget.toFixed(2)}`,
      executedTools
    };
  }

  // Match: Invoicing
  if (lower.includes('invoice') || lower.includes('dues')) {
    const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const amountMatch = userMessage.match(/\$?(\d+(\.\d{1,2})?)/);
    const email = emailMatch ? emailMatch[0] : 'student@club.edu';
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 25.00;

    const invoiceRes = await executeTool('create_dues_invoice', {
      recipientEmail: email,
      recipientName: 'Club Member',
      itemTitle: 'Annual Club Membership Dues',
      amount,
      note: 'Thank you for joining the University AI Club!'
    });

    executedTools.push({ toolName: 'create_dues_invoice', args: { recipientEmail: email, amount }, result: invoiceRes });
    return {
      reply: `✉️ PayPal Membership Dues Invoice has been created and sent to **${email}** for **$${amount.toFixed(2)}**.`,
      executedTools
    };
  }

  // Default response
  return {
    reply: `👋 Hello! I am the **Club Treasurer Agent**. I help manage club finances with strict safety guardrails ("AI proposes, Humans approve").\n\nYou can ask me to:\n1. *"Reimburse $35 to john@club.edu for hackathon supplies"*\n2. *"Check our current treasury balance"*\n3. *"Send a $20 dues invoice to member@club.edu"*\n4. *"Show recent pending proposals"*`,
    executedTools
  };
}

export default {
  chatWithTreasurerAgent
};
