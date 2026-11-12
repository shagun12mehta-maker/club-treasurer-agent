import crypto from 'crypto';
import db from './db.js';

// Configuration Defaults
const MAX_SINGLE_PAYOUT_LIMIT = parseFloat(process.env.MAX_SINGLE_PAYOUT_LIMIT || '250.00');
const DUAL_APPROVAL_THRESHOLD = parseFloat(process.env.DUAL_APPROVAL_THRESHOLD || '75.00');

/**
 * Evaluates a proposed payout against club financial guardrails.
 * Returns { passed, requiredApprovals, flags, autoRejectionReason }
 */
export function evaluateProposalRules({
  amount,
  recipientEmail,
  receiptData = null
}) {
  const flags = [];
  let autoRejectionReason = null;
  const numAmount = parseFloat(amount);
  const treasury = db.getTreasury();

  // Rule 1: Amount must be positive and valid
  if (isNaN(numAmount) || numAmount <= 0) {
    return {
      passed: false,
      autoRejectionReason: 'Invalid payout amount. Must be greater than $0.00.',
      flags: ['CRITICAL_INVALID_AMOUNT'],
      requiredApprovals: 0
    };
  }

  // Rule 2: Hard Cap Limit
  if (numAmount > MAX_SINGLE_PAYOUT_LIMIT) {
    flags.push(`CRITICAL_EXCEEDS_HARD_LIMIT`);
    autoRejectionReason = `Requested amount ($${numAmount}) exceeds the club maximum payout limit ($${MAX_SINGLE_PAYOUT_LIMIT}). AI treasurer cannot disburse without special board charter amendment.`;
  }

  // Rule 3: Treasury Solvency
  if (numAmount > treasury.currentBalance) {
    flags.push('CRITICAL_INSUFFICIENT_TREASURY_FUNDS');
    autoRejectionReason = `Insufficient club funds. Current treasury balance is $${treasury.currentBalance}, but requested amount is $${numAmount}.`;
  }

  // Rule 4: New Payee Warning
  const isKnown = db.isKnownPayee(recipientEmail);
  if (!isKnown) {
    flags.push('WARNING_NEW_PAYEE');
  }

  // Rule 5: Duplicate Detection (Receipt / Amount matching)
  if (receiptData) {
    const duplicate = db.findDuplicateProposal(
      receiptData.merchant,
      receiptData.date,
      numAmount
    );
    if (duplicate) {
      flags.push('CRITICAL_DUPLICATE_RECEIPT');
      autoRejectionReason = `Duplicate receipt detected! Similar claim already submitted on ${duplicate.createdAt.split('T')[0]} (Proposal ${duplicate.id} for $${duplicate.amount} at ${duplicate.receiptData?.merchant || 'merchant'}).`;
    }
  }

  // Rule 6: Dual Approver Tier
  // Amounts >= $75 require 2 officers (e.g. Treasurer + President)
  const requiredApprovals = numAmount >= DUAL_APPROVAL_THRESHOLD ? 2 : 1;
  if (requiredApprovals === 2) {
    flags.push('DUAL_OFFICER_APPROVAL_REQUIRED');
  }

  return {
    passed: autoRejectionReason === null,
    autoRejectionReason,
    requiredApprovals,
    flags,
    maxLimit: MAX_SINGLE_PAYOUT_LIMIT,
    dualApprovalThreshold: DUAL_APPROVAL_THRESHOLD
  };
}

/**
 * Generates an idempotent sender_batch_id for PayPal Payouts.
 * Guarantees that a payout can never be executed twice by PayPal.
 */
export function generatePayoutIdempotencyKey(proposalId, recipientEmail, amount) {
  const raw = `payout_${proposalId}_${(recipientEmail || '').toLowerCase().trim()}_${parseFloat(amount).toFixed(2)}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
  return `batch_${hash}`;
}

export default {
  evaluateProposalRules,
  generatePayoutIdempotencyKey,
  MAX_SINGLE_PAYOUT_LIMIT,
  DUAL_APPROVAL_THRESHOLD
};
