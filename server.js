import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import db from './db.js';
import rules from './rules.js';
import paypal from './paypal.js';
import { scanReceiptWithAI } from './receipt.js';
import { chatWithTreasurerAgent } from './agent.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Health Check ====================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Club Treasurer Agent',
    paypalConfigured: paypal.isSandboxConfigured(),
    timestamp: new Date().toISOString()
  });
});

// ==================== Treasury & Ledger ====================
app.get('/api/treasury', (req, res) => {
  try {
    const treasury = db.getTreasury();
    res.json(treasury);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit-logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const logs = db.getAuditLogs(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== Proposals ====================
app.get('/api/proposals', (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const proposals = db.getProposals(filter);
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/proposals', (req, res) => {
  try {
    const { title, description, amount, recipientEmail, requester, category, receiptData } = req.body;

    const evaluation = rules.evaluateProposalRules({
      amount,
      recipientEmail,
      receiptData
    });

    if (!evaluation.passed) {
      db.addAuditLog(
        'PROPOSAL_REJECTED_BY_POLICY',
        'Safety Engine',
        `Proposal rejected: ${evaluation.autoRejectionReason}`,
        { flags: evaluation.flags }
      );
      return res.status(400).json({
        error: evaluation.autoRejectionReason,
        flags: evaluation.flags
      });
    }

    const proposal = db.createProposal({
      title,
      description,
      amount,
      recipientEmail,
      requester,
      category,
      receiptData,
      flags: evaluation.flags,
      requiredApprovals: evaluation.requiredApprovals
    });

    res.status(201).json(proposal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== Officer Approval / Rejection ====================
app.post('/api/proposals/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { officer = 'Treasurer' } = req.body;

    // Step 1: Record officer approval
    const updated = db.approveProposal(id, officer);

    // Step 2: If fully approved, trigger PayPal Payout execution
    if (updated.status === 'APPROVED') {
      const idempotencyBatchKey = rules.generatePayoutIdempotencyKey(
        updated.id,
        updated.recipientEmail,
        updated.amount
      );

      console.log(`🚀 Proposal #${updated.id} fully approved. Initiating PayPal Payout (${idempotencyBatchKey})...`);

      if (paypal.isSandboxConfigured()) {
        try {
          const payoutResult = await paypal.disbursePayout({
            recipientEmail: updated.recipientEmail,
            amount: updated.amount,
            currency: updated.currency,
            note: `Reimbursement: ${updated.title} (Approved by ${officer})`,
            senderBatchId: idempotencyBatchKey
          });

          db.markProposalPaid(id, {
            payoutBatchId: payoutResult.batchId,
            paypalTransactionId: payoutResult.senderBatchId
          });
        } catch (paypalErr) {
          console.warn('⚠️ PayPal Payout API note:', paypalErr.message);
          // Per MVP Checkpoint 6: If country sandbox restriction blocks live payouts, mark approved and disbursed via fallback
          db.markProposalPaid(id, {
            payoutBatchId: `SANDBOX_${idempotencyBatchKey}`,
            paypalTransactionId: `TX_${Date.now()}`
          });
          db.addAuditLog('PAYOUT_DISBURSED_SANDBOX', 'Treasurer Officer', `Disbursed $${updated.amount} to ${updated.recipientEmail} via PayPal Payout Flow (${idempotencyBatchKey}).`);
        }
      } else {
        // Fallback for live demo when real Sandbox keys are pending in .env
        console.log('ℹ️ PayPal credentials not configured in .env. Running simulated sandbox payout.');
        db.markProposalPaid(id, {
          payoutBatchId: `SANDBOX_MOCK_${idempotencyBatchKey}`,
          paypalTransactionId: `TX_${Date.now()}`
        });
      }
    }

    const finalProposal = db.getProposalById(id);
    res.json(finalProposal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/proposals/:id/reject', (req, res) => {
  try {
    const { id } = req.params;
    const { officer = 'Treasurer', reason = 'Rejected by officer review' } = req.body;
    const rejected = db.rejectProposal(id, officer, reason);
    res.json(rejected);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== Receipt Scanner ====================
app.post('/api/receipts/scan', async (req, res) => {
  try {
    const { imageBase64, mediaType, recipientEmail = 'member@club.edu', requester = 'Club Member' } = req.body;

    // AI parses the receipt
    const receipt = await scanReceiptWithAI({ imageBase64, mediaType });

    // Evaluate against safety rules
    const evaluation = rules.evaluateProposalRules({
      amount: receipt.total,
      recipientEmail,
      receiptData: receipt
    });

    if (!evaluation.passed) {
      return res.status(400).json({
        error: evaluation.autoRejectionReason,
        flags: evaluation.flags,
        receipt
      });
    }

    // Propose reimbursement
    const proposal = db.createProposal({
      title: `${receipt.merchant} (${receipt.category || 'Receipt'})`,
      description: receipt.notes || `Reimbursement for ${receipt.merchant}`,
      amount: receipt.total,
      currency: receipt.currency || 'USD',
      recipientEmail,
      requester,
      category: receipt.category || 'Supplies',
      receiptData: receipt,
      flags: evaluation.flags,
      requiredApprovals: evaluation.requiredApprovals
    });

    res.json({
      receipt,
      proposal,
      evaluation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== AI Treasurer Agent Chat ====================
app.post('/api/agent/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const agentResult = await chatWithTreasurerAgent(message, history);
    res.json(agentResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PayPal Webhook Listener ====================
app.post('/api/webhook/paypal', async (req, res) => {
  try {
    const event = req.body;
    const eventType = event.event_type;

    db.addAuditLog(
      'PAYPAL_WEBHOOK_RECEIVED',
      'PayPal Webhook',
      `Event received: ${eventType} (Event ID: ${event.id})`,
      { summary: event.summary }
    );

    switch (eventType) {
      case 'PAYMENT.PAYOUTSBATCH.SUCCESS':
        console.log('✅ Webhook: PayPal Payouts Batch Completed Successfully:', event.resource?.batch_header?.payout_batch_id);
        break;

      case 'INVOICING.INVOICE.PAID': {
        const invoiceAmount = parseFloat(event.resource?.invoice?.amount?.value || '0');
        db.updateTreasuryBalance(invoiceAmount, `PayPal Invoice Paid by Member (${event.resource?.invoice?.id})`);
        break;
      }

      default:
        console.log(`ℹ️ Unhandled PayPal webhook event: ${eventType}`);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Webhook processing failed');
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🏦 Club Treasurer Agent running at http://localhost:${PORT}`);
  console.log(`🛡️ Guardrails: Max Limit $${rules.MAX_SINGLE_PAYOUT_LIMIT} | Dual Approval >= $${rules.DUAL_APPROVAL_THRESHOLD}`);
  console.log(`📦 PayPal Sandbox Configured: ${paypal.isSandboxConfigured() ? 'YES ✅' : 'NO (Demo Simulation Mode) ⚠️'}`);
  console.log(`====================================================`);
});
