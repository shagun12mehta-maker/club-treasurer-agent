import db from './db.js';
import rules from './rules.js';
import paypal from './paypal.js';

/**
 * Anthropic Tool Definitions for Claude Tool-Calling Agent
 */
export const AGENT_TOOLS = [
  {
    name: 'check_treasury_balance',
    description: 'Check the current financial balance, currency, and general health of the club treasury.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'propose_payout_reimbursement',
    description: 'Proposes a reimbursement or vendor payout from the club treasury. AI NEVER directly disburses funds; it evaluates safety rules and submits a proposal for Human-in-the-Loop officer approval.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title describing the expense (e.g., "Hackathon Pizza Reimbursement")'
        },
        amount: {
          type: 'number',
          description: 'Total payout amount in USD (must be positive)'
        },
        recipientEmail: {
          type: 'string',
          description: 'PayPal email of the member or vendor to be paid'
        },
        requester: {
          type: 'string',
          description: 'Name of the club member who incurred the expense'
        },
        category: {
          type: 'string',
          description: 'Expense category (Food & Catering, Hardware, Supplies, Software, Venue, etc.)'
        },
        description: {
          type: 'string',
          description: 'Detailed explanation of the expense purpose and club benefit'
        },
        receiptData: {
          type: 'object',
          description: 'Structured receipt metadata if available (merchant, date, line items)'
        }
      },
      required: ['title', 'amount', 'recipientEmail', 'requester']
    }
  },
  {
    name: 'create_dues_invoice',
    description: 'Generates and sends a PayPal invoice to a club member for annual dues or event ticket fees.',
    input_schema: {
      type: 'object',
      properties: {
        recipientEmail: {
          type: 'string',
          description: 'PayPal email address of the student/member'
        },
        recipientName: {
          type: 'string',
          description: 'Full name of the member'
        },
        itemTitle: {
          type: 'string',
          description: 'Description of the fee (e.g., "Fall 2026 Club Membership Dues")'
        },
        amount: {
          type: 'number',
          description: 'Fee amount in USD'
        },
        note: {
          type: 'string',
          description: 'Optional friendly note for the member'
        }
      },
      required: ['recipientEmail', 'recipientName', 'amount']
    }
  },
  {
    name: 'get_pending_proposals',
    description: 'Retrieve all payout proposals currently awaiting human officer approval.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_audit_trail',
    description: 'View the immutable audit trail of recent treasury events, approvals, and payouts.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of logs to retrieve (default: 10)'
        }
      },
      required: []
    }
  }
];

/**
 * Execute Tool Functions
 */
export async function executeTool(toolName, args) {
  switch (toolName) {
    case 'check_treasury_balance': {
      const treasury = db.getTreasury();
      return {
        status: 'success',
        treasury
      };
    }

    case 'propose_payout_reimbursement': {
      const { title, amount, recipientEmail, requester, category, description, receiptData } = args;

      // Evaluate Safety Rules
      const ruleEvaluation = rules.evaluateProposalRules({
        amount,
        recipientEmail,
        receiptData
      });

      if (!ruleEvaluation.passed) {
        db.addAuditLog(
          'PROPOSAL_BLOCKED_BY_SAFETY_RULES',
          'Safety Policy Engine',
          `Blocked proposed payout of $${amount} to ${recipientEmail}: ${ruleEvaluation.autoRejectionReason}`,
          { flags: ruleEvaluation.flags }
        );

        return {
          status: 'blocked_by_safety_policy',
          reason: ruleEvaluation.autoRejectionReason,
          flags: ruleEvaluation.flags
        };
      }

      // Create proposal awaiting human signatures
      const proposal = db.createProposal({
        title,
        description,
        amount,
        recipientEmail,
        requester,
        category,
        receiptData,
        flags: ruleEvaluation.flags,
        requiredApprovals: ruleEvaluation.requiredApprovals
      });

      return {
        status: 'proposal_created',
        message: `Proposal #${proposal.id} created successfully. It requires ${proposal.requiredApprovals} human officer signature(s) before PayPal Payout can be executed.`,
        proposalId: proposal.id,
        amount: proposal.amount,
        requiredApprovals: proposal.requiredApprovals,
        flags: proposal.flags
      };
    }

    case 'create_dues_invoice': {
      const { recipientEmail, recipientName, itemTitle, amount, note } = args;

      if (!paypal.isSandboxConfigured()) {
        db.addAuditLog(
          'INVOICE_SIMULATED',
          'AI Agent',
          `Simulated invoice of $${amount} sent to ${recipientEmail} (${recipientName}) for "${itemTitle}".`
        );
        return {
          status: 'simulated_success',
          message: `Sandbox mode: Invoice of $${amount} created for ${recipientName} (${recipientEmail}).`,
          mockInvoiceId: `INV-${Date.now()}`
        };
      }

      const invoiceRes = await paypal.createAndSendInvoice({
        recipientEmail,
        recipientName,
        itemTitle: itemTitle || 'Club Membership Dues',
        amount,
        note
      });

      db.addAuditLog(
        'INVOICE_SENT',
        'PayPal Sandbox API',
        `Invoice #${invoiceRes.invoiceId} for $${amount} sent to ${recipientEmail}.`
      );

      return {
        status: 'success',
        invoiceId: invoiceRes.invoiceId,
        invoiceStatus: invoiceRes.status
      };
    }

    case 'get_pending_proposals': {
      const pending = db.getProposals({ status: 'PENDING_APPROVAL' });
      return {
        count: pending.length,
        proposals: pending
      };
    }

    case 'get_audit_trail': {
      const logs = db.getAuditLogs(args.limit || 10);
      return {
        count: logs.length,
        logs
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export default {
  AGENT_TOOLS,
  executeTool
};
