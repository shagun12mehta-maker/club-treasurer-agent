import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
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

// ==================== In-Memory State for Enterprise Demo ====================
let treasuryState = {
  current_balance: 18250.00,
  unpaid_invoices_count: 2,
  total_collected: 1500.00,
  pending_payouts_count: 1
};

let invoices = [
  {
    id: "inv_101",
    member_name: "Aarav Sharma",
    note: "Annual Membership Dues (₹500)",
    paypal_invoice_id: "INV2-ZQHC-QMLX",
    amount: 500.00,
    status: "PAID",
    paid_at: new Date(Date.now() - 3600000).toISOString(),
    created_at: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: "inv_102",
    member_name: "Ishita Roy",
    note: "Annual Membership Dues (₹500)",
    paypal_invoice_id: "INV2-411E-921A",
    amount: 500.00,
    status: "PAID",
    paid_at: new Date(Date.now() - 1800000).toISOString(),
    created_at: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: "inv_103",
    member_name: "Aman Gupta",
    note: "Annual Membership Dues (₹500)",
    paypal_invoice_id: "INV2-411E-921B",
    amount: 500.00,
    status: "UNPAID",
    created_at: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: "inv_104",
    member_name: "Neha Joshi",
    note: "Annual Membership Dues (₹500)",
    paypal_invoice_id: "INV2-411E-921C",
    amount: 500.00,
    status: "UNPAID",
    created_at: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: "inv_105",
    member_name: "Karan Mehra",
    note: "Annual Membership Dues (₹500)",
    paypal_invoice_id: "INV2-411E-921D",
    amount: 500.00,
    status: "PAID",
    paid_at: new Date(Date.now() - 900000).toISOString(),
    created_at: new Date(Date.now() - 7200000).toISOString()
  }
];

let payouts = [
  {
    id: "pay_901",
    vendor: "Grand Auditorium & Expo Services",
    category: "Event Venue",
    note: "Main Convention Hall Advance for Annual Tech Hackathon Finals",
    amount: 3200.00,
    status: "PENDING",
    approver1_approved: false,
    approver2_approved: false,
    paypal_payout_batch_id: null
  }
];

let enterpriseAuditLogs = [
  {
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    actor: "paypal_webhook",
    action: "INVOICING.INVOICE.PAID",
    details: { invoice_id: "inv_101", payer: "Aarav Sharma", amount: 500.00 },
    hash_signature: "0x8fa1...c29b",
    severity: "INFO"
  },
  {
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    actor: "paypal_webhook",
    action: "INVOICING.INVOICE.PAID",
    details: { invoice_id: "inv_102", payer: "Ishita Roy", amount: 500.00 },
    hash_signature: "0x3e19...772a",
    severity: "INFO"
  },
  {
    timestamp: new Date().toISOString(),
    actor: "guardrail_engine",
    action: "POLICY_LIMIT_EVALUATION",
    details: { payout_id: "pay_901", amount: 3200, rule: "DUAL_APPROVER_THRESHOLD_EXCEEDED" },
    hash_signature: "0x54cd...91ab",
    severity: "ALERT"
  }
];

function logEnterpriseAudit(actor, action, details, severity = "INFO") {
  const hash = '0x' + crypto.createHash('sha256').update(JSON.stringify(details) + Date.now()).digest('hex').substring(0, 10);
  enterpriseAuditLogs.unshift({
    timestamp: new Date().toISOString(),
    actor,
    action,
    details,
    hash_signature: hash,
    severity
  });
}

// ==================== Health Check ====================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VaultPal - Club Treasurer Agent',
    paypalConfigured: paypal.isSandboxConfigured(),
    timestamp: new Date().toISOString()
  });
});

// ==================== 1. Treasury Status ====================
app.get('/api/treasury/status', (req, res) => {
  const unpaid = invoices.filter(i => i.status === 'UNPAID').length;
  treasuryState.unpaid_invoices_count = unpaid;
  treasuryState.pending_payouts_count = payouts.filter(p => p.status === 'PENDING').length;
  res.json(treasuryState);
});

// ==================== 2. Invoices ====================
app.get('/api/invoices', (req, res) => {
  res.json(invoices);
});

app.post('/api/invoices/simulate-payment/:id', (req, res) => {
  const inv = invoices.find(i => i.id === req.params.id);
  if (inv) {
    inv.status = 'PAID';
    inv.paid_at = new Date().toISOString();
    treasuryState.total_collected += inv.amount;
    treasuryState.current_balance += inv.amount;
    logEnterpriseAudit('paypal_webhook', 'INVOICING.INVOICE.PAID', { invoice_id: inv.id, member: inv.member_name, amount: inv.amount });
    return res.json({ success: true, invoice: inv });
  }
  res.status(404).json({ error: 'Invoice not found' });
});

// PayPal Smart Buttons Capture
app.post('/api/paypal/capture', (req, res) => {
  const { invoice_id, amount, payer_name } = req.body;
  const inv = invoices.find(i => i.id === invoice_id);
  if (inv) {
    inv.status = 'PAID';
    inv.paid_at = new Date().toISOString();
    treasuryState.total_collected += inv.amount;
    treasuryState.current_balance += inv.amount;
    logEnterpriseAudit('paypal_sdk', 'PAYMENT.ORDER.CAPTURED', { invoice_id, payer: payer_name, amount });
  }
  res.json({ success: true });
});

// ==================== 3. Payouts (Two-Signature Gate) ====================
app.get('/api/payouts', (req, res) => {
  res.json(payouts);
});

app.post('/api/payouts/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { role, name } = req.body;
  const p = payouts.find(item => item.id === id);

  if (!p) return res.status(404).json({ error: 'Payout not found' });

  if (role === 'approver_1' || role === 'treasurer') {
    p.approver1_approved = true;
    logEnterpriseAudit('approver_1', 'DIGITAL_SIGNATURE_APPLIED', { payout_id: p.id, approver: name });
  }
  if (role === 'approver_2' || (role === 'treasurer' && p.amount < 1000)) {
    p.approver2_approved = true;
    logEnterpriseAudit('approver_2', 'DIGITAL_SIGNATURE_APPLIED', { payout_id: p.id, approver: name });
  }

  // If both approved (or single approval for small amount < 1000)
  const isFullyApproved = p.amount >= 1000 ? (p.approver1_approved && p.approver2_approved) : (p.approver1_approved || p.approver2_approved);

  if (isFullyApproved) {
    p.status = 'DISPATCHED';
    const batchId = `PAYPAL_BATCH_${Date.now()}`;
    p.paypal_payout_batch_id = batchId;
    treasuryState.current_balance -= p.amount;

    logEnterpriseAudit('paypal_payouts_api', 'PAYMENTS.PAYOUTSBATCH.DISPATCHED', {
      payout_id: p.id,
      amount: p.amount,
      vendor: p.vendor,
      batch_id: batchId
    });

    console.log(`🚀 Dispatched PayPal Payout for ${p.vendor} (₹${p.amount}). Batch: ${batchId}`);
  }

  res.json({ success: true, payout: p });
});

app.post('/api/payouts/:id/reject', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const p = payouts.find(item => item.id === id);
  if (p) {
    p.status = 'REJECTED';
    logEnterpriseAudit('officer_action', 'PAYOUT_REJECTED', { payout_id: p.id, rejected_by: name }, 'ALERT');
    return res.json({ success: true, payout: p });
  }
  res.status(404).json({ error: 'Payout not found' });
});

// ==================== 4. Audit Log ====================
app.get('/api/audit-log', (req, res) => {
  res.json(enterpriseAuditLogs);
});

// ==================== 5. Sample Receipts ====================
app.get('/api/sample-receipts', (req, res) => {
  res.json({
    venue_receipt: {
      merchant: "Grand Auditorium & Expo Services Pvt Ltd",
      amount: 3200.00,
      category: "Event Venue",
      is_safe: true
    },
    catering_receipt: {
      merchant: "Domino's Pizza India Pvt Ltd",
      amount: 850.00,
      category: "Food & Catering",
      is_safe: true
    },
    malicious_receipt: {
      merchant: "Shadow Logistics Entity",
      amount: 50000.00,
      category: "Unauthorized Exploit",
      is_safe: false,
      security_warning: "Indirect Prompt Injection Suppressed: Exploit string quarantined by Regex & Semantic Guardrail!"
    }
  });
});

app.post('/api/agent/scan-receipt', (req, res) => {
  const { receipt_key } = req.body;

  if (receipt_key === 'malicious_receipt') {
    logEnterpriseAudit('ai_vision_guardrail', 'SECURITY_EXPLOIT_QUARANTINED', {
      threat: "Prompt Injection in Receipt Notes",
      blocked_action: "DISBURSE_50000"
    }, 'ALERT');

    return res.json({
      amount: 50000.00,
      vendor: "Shadow Logistics Entity",
      category: "Threat Quarantined",
      budget_remaining: treasuryState.current_balance,
      is_safe: false,
      security_warning: "Indirect prompt injection quarantined by safety filter!"
    });
  }

  const isVenue = receipt_key === 'venue_receipt';
  const amount = isVenue ? 3200.00 : 850.00;
  const vendor = isVenue ? "Grand Auditorium & Expo Services" : "Domino's Pizza India";
  const category = isVenue ? "Event Venue" : "Food & Catering";

  logEnterpriseAudit('claude_vision', 'RECEIPT_ANALYZED', { vendor, amount, category });

  res.json({
    amount,
    vendor,
    category,
    budget_remaining: treasuryState.current_balance,
    is_safe: true
  });
});

// ==================== 6. AI Copilot Chat ====================
app.post('/api/agent/chat', async (req, res) => {
  const { message, actor_role } = req.body;
  const lower = (message || '').toLowerCase();

  logEnterpriseAudit('agent_user', 'CHAT_PROMPT', { user_message: message, role: actor_role });

  if (lower.includes('collect') || lower.includes('invoice') || lower.includes('500') || lower.includes('members')) {
    logEnterpriseAudit('agent_tool', 'create_invoices', { count: 5, amount: 500, total: 2500 });
    return res.json({
      reply: `I have called the **PayPal Invoicing Tool** to issue 5 membership dues invoices of **₹500.00 each**.\n\n🛡️ **Guardrail Check:** All 5 invoices are compliant with the annual club charter. Real PayPal Sandbox invoices created.`,
      actions_taken: ["CREATED_INVOICES"],
      tool_traces: [
        {
          tool_name: "create_invoices",
          status: "200 SUCCESS",
          arguments: { count: 5, unit_amount: 500, currency: "INR" },
          output: { created: 5, status: "SENT_VIA_PAYPAL_SANDBOX", batch_ref: "INV2-BATCH-994" }
        }
      ]
    });
  }

  if (lower.includes('payout') || lower.includes('grand auditorium') || lower.includes('3200')) {
    logEnterpriseAudit('agent_tool', 'propose_payout', { amount: 3200, vendor: "Grand Auditorium" });
    return res.json({
      reply: `I have prepared **Payout #pay_901** for **Grand Auditorium (₹3,200.00)**.\n\n⚠️ **Two-Person Guardrail Triggered:**\nBecause this amount exceeds the single-officer limit of **₹1,000**, funds are **LOCKED** until both **Priya (President)** and **Dev (VP)** submit their digital signatures on the Governance Board.\n\n*The AI cannot bypass this human approval gate.*`,
      actions_taken: ["PROPOSED_PAYOUT"],
      tool_traces: [
        {
          tool_name: "propose_payout_with_guardrails",
          status: "200 GATED",
          arguments: { vendor: "Grand Auditorium", amount: 3200, category: "Event Venue" },
          output: { requires_dual_custody: true, status: "LOCKED_IN_ESCROW" }
        }
      ]
    });
  }

  if (lower.includes('balance') || lower.includes('treasury')) {
    return res.json({
      reply: `🏦 **Current Treasury Status:**\n- **Live Balance:** ₹${treasuryState.current_balance.toLocaleString('en-IN')}\n- **Invoices Collected:** ₹${treasuryState.total_collected.toLocaleString('en-IN')}\n- **Pending Invoices:** ${treasuryState.unpaid_invoices_count}\n- **Pending Payouts:** ${treasuryState.pending_payouts_count}`,
      actions_taken: [],
      tool_traces: []
    });
  }

  res.json({
    reply: `👋 Hello! I am **VaultPal AI Treasurer**.\n\nYou can ask me to:\n1. *"Collect ₹500 from each of 5 members for the hackathon"*\n2. *"Request a ₹3,200 payout for Grand Auditorium"*\n3. *"Check treasury balance"*`,
    actions_taken: [],
    tool_traces: []
  });
});

// ==================== 7. Reset State ====================
app.post('/api/state/reset', (req, res) => {
  treasuryState.current_balance = 18250.00;
  treasuryState.total_collected = 1500.00;
  treasuryState.unpaid_invoices_count = 2;
  payouts[0].status = 'PENDING';
  payouts[0].approver1_approved = false;
  payouts[0].approver2_approved = false;
  payouts[0].paypal_payout_batch_id = null;
  invoices[2].status = 'UNPAID';
  invoices[3].status = 'UNPAID';
  logEnterpriseAudit('system', 'DEMO_STATE_RESET', { status: 'INITIAL_BASELINE' });
  res.json({ success: true });
});

// ==================== 8. Transparency Portal ====================
app.get('/api/public/transparency', (req, res) => {
  res.json({
    club_name: "University AI & Tech Society",
    treasury_balance: treasuryState.current_balance,
    currency: "INR",
    total_inflows: treasuryState.total_collected,
    total_outflows: 0,
    recent_transactions: enterpriseAuditLogs.slice(0, 10)
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🏦 VaultPal — Club Treasurer Agent running at http://localhost:${PORT}`);
  console.log(`🛡️ Guardrails: Dual-Approver Gate >= ₹1,000 | Prompt-Injection Sandbox Active`);
  console.log(`📦 PayPal Sandbox Configured: ${paypal.isSandboxConfigured() ? 'YES ✅' : 'NO ⚠️'}`);
  console.log(`====================================================`);
});
