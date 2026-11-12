import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial Database State
const INITIAL_STATE = {
  treasury: {
    name: 'University AI & Tech Club Treasury',
    currency: 'USD',
    initialBudget: 5000.00,
    currentBalance: 5000.00
  },
  knownPayees: [
    { email: 'treasurer-officer@club.edu', name: 'Club Treasurer Officer', firstPaidAt: '2026-01-10T10:00:00Z', totalPaid: 150.00 },
    { email: 'president@club.edu', name: 'Club President', firstPaidAt: '2026-01-15T12:00:00Z', totalPaid: 210.00 },
    { email: 'campus-print@vendor.com', name: 'Campus Print & Poster Shop', firstPaidAt: '2026-02-01T09:30:00Z', totalPaid: 85.50 }
  ],
  proposals: [],
  auditLogs: []
};

// Load or initialize DB
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading db.json, resetting to initial state:', err);
  }
  saveDB(INITIAL_STATE);
  return { ...INITIAL_STATE };
}

function saveDB(state) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving db.json:', err);
  }
}

let db = loadDB();

// Log system bootstrap
if (db.auditLogs.length === 0) {
  addAuditLog('SYSTEM_BOOTSTRAP', 'System', 'Club Treasurer Agent ledger initialized with $5,000 budget.');
}

// ==================== Audit Log ====================
export function addAuditLog(action, actor, details, metadata = {}) {
  const log = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    action,
    actor,
    details,
    metadata
  };
  db.auditLogs.unshift(log); // Most recent first
  saveDB(db);
  return log;
}

export function getAuditLogs(limit = 50) {
  return db.auditLogs.slice(0, limit);
}

// ==================== Treasury ====================
export function getTreasury() {
  return { ...db.treasury };
}

export function updateTreasuryBalance(amountDelta, reason) {
  db.treasury.currentBalance = parseFloat((db.treasury.currentBalance + amountDelta).toFixed(2));
  addAuditLog('TREASURY_BALANCE_UPDATE', 'System', `${reason}: Delta ${amountDelta > 0 ? '+' : ''}$${amountDelta}. New balance: $${db.treasury.currentBalance}`);
  saveDB(db);
  return db.treasury;
}

// ==================== Payees ====================
export function isKnownPayee(email) {
  const normalized = (email || '').toLowerCase().trim();
  return db.knownPayees.some(p => p.email.toLowerCase().trim() === normalized);
}

export function addKnownPayee(email, name = 'Club Member / Vendor') {
  const normalized = (email || '').toLowerCase().trim();
  const existing = db.knownPayees.find(p => p.email.toLowerCase().trim() === normalized);
  if (!existing) {
    db.knownPayees.push({
      email: normalized,
      name,
      firstPaidAt: new Date().toISOString(),
      totalPaid: 0
    });
    addAuditLog('PAYEE_ADDED', 'System', `New payee added to known list: ${normalized} (${name})`);
    saveDB(db);
  }
}

// ==================== Duplicate Receipts ====================
export function findDuplicateProposal(merchant, date, amount) {
  const normalizedMerchant = (merchant || '').toLowerCase().trim();
  const targetAmount = parseFloat(amount);

  return db.proposals.find(p => {
    if (p.status === 'REJECTED') return false;
    const sameAmount = Math.abs(p.amount - targetAmount) < 0.01;
    const pMerchant = (p.receiptData?.merchant || '').toLowerCase().trim();
    const sameMerchant = normalizedMerchant && pMerchant && (pMerchant.includes(normalizedMerchant) || normalizedMerchant.includes(pMerchant));
    const sameDate = p.receiptData?.date && date && p.receiptData.date === date;
    return sameAmount && (sameMerchant || sameDate);
  });
}

// ==================== Proposals ====================
export function createProposal({
  title,
  description,
  amount,
  currency = 'USD',
  recipientEmail,
  requester,
  category = 'General Expense',
  receiptData = null,
  flags = [],
  requiredApprovals = 1
}) {
  const newProposal = {
    id: `prop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title,
    description: description || '',
    amount: parseFloat(amount),
    currency,
    recipientEmail: (recipientEmail || '').toLowerCase().trim(),
    requester: requester || 'Club Member',
    category,
    receiptData,
    flags,
    requiredApprovals,
    approvals: [],
    status: 'PENDING_APPROVAL', // PENDING_APPROVAL | APPROVED | REJECTED | PAID | FAILED
    payoutBatchId: null,
    paypalTransactionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.proposals.unshift(newProposal);
  addAuditLog(
    'PROPOSAL_CREATED',
    'AI Agent',
    `Proposed payout of $${newProposal.amount} to ${newProposal.recipientEmail} for "${newProposal.title}". Requires ${requiredApprovals} approval(s).`,
    { proposalId: newProposal.id, flags }
  );
  saveDB(db);
  return newProposal;
}

export function getProposals(filter = {}) {
  let list = [...db.proposals];
  if (filter.status) {
    list = list.filter(p => p.status === filter.status);
  }
  return list;
}

export function getProposalById(id) {
  return db.proposals.find(p => p.id === id) || null;
}

export function approveProposal(id, officerName) {
  const proposal = getProposalById(id);
  if (!proposal) throw new Error(`Proposal with ID ${id} not found`);
  if (proposal.status !== 'PENDING_APPROVAL') {
    throw new Error(`Proposal is already ${proposal.status}`);
  }

  // Prevent duplicate approval by same officer
  if (proposal.approvals.some(a => a.officer === officerName)) {
    throw new Error(`Officer "${officerName}" has already approved this proposal.`);
  }

  proposal.approvals.push({
    officer: officerName,
    timestamp: new Date().toISOString()
  });

  addAuditLog(
    'PROPOSAL_APPROVED_BY_OFFICER',
    officerName,
    `Officer ${officerName} approved proposal ${proposal.id} ($${proposal.amount}). (${proposal.approvals.length}/${proposal.requiredApprovals} approvals).`
  );

  if (proposal.approvals.length >= proposal.requiredApprovals) {
    proposal.status = 'APPROVED';
    addAuditLog('PROPOSAL_FULLY_APPROVED', 'System', `Proposal ${proposal.id} is now fully APPROVED and ready for PayPal execution.`);
  }

  proposal.updatedAt = new Date().toISOString();
  saveDB(db);
  return proposal;
}

export function rejectProposal(id, officerName, reason) {
  const proposal = getProposalById(id);
  if (!proposal) throw new Error(`Proposal with ID ${id} not found`);

  proposal.status = 'REJECTED';
  proposal.rejectionReason = reason || 'Rejected by officer';
  proposal.rejectedBy = officerName;
  proposal.updatedAt = new Date().toISOString();

  addAuditLog(
    'PROPOSAL_REJECTED',
    officerName,
    `Proposal ${proposal.id} was rejected by ${officerName}. Reason: ${proposal.rejectionReason}`
  );
  saveDB(db);
  return proposal;
}

export function markProposalPaid(id, { payoutBatchId, paypalTransactionId }) {
  const proposal = getProposalById(id);
  if (!proposal) throw new Error(`Proposal with ID ${id} not found`);

  proposal.status = 'PAID';
  proposal.payoutBatchId = payoutBatchId || null;
  proposal.paypalTransactionId = paypalTransactionId || null;
  proposal.paidAt = new Date().toISOString();
  proposal.updatedAt = new Date().toISOString();

  // Deduct from club treasury
  updateTreasuryBalance(-proposal.amount, `Payout to ${proposal.recipientEmail} (${proposal.title})`);

  // Record payee in known list
  addKnownPayee(proposal.recipientEmail, proposal.requester);

  addAuditLog(
    'PAYOUT_EXECUTED',
    'PayPal Sandbox API',
    `Disbursed $${proposal.amount} via PayPal Payouts to ${proposal.recipientEmail}. Batch ID: ${payoutBatchId}`,
    { proposalId: proposal.id, payoutBatchId, paypalTransactionId }
  );

  saveDB(db);
  return proposal;
}

export default {
  getTreasury,
  updateTreasuryBalance,
  isKnownPayee,
  addKnownPayee,
  findDuplicateProposal,
  createProposal,
  getProposals,
  getProposalById,
  approveProposal,
  rejectProposal,
  markProposalPaid,
  addAuditLog,
  getAuditLogs
};
