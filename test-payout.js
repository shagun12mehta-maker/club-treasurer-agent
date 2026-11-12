import dotenv from 'dotenv';
import paypal from './paypal.js';

dotenv.config();

async function testPayout() {
  console.log('--- Testing PayPal Payouts API ---');
  try {
    const batchId = `test_batch_${Date.now()}`;
    const res = await paypal.disbursePayout({
      recipientEmail: 'sb-member-test@personal.example.com',
      amount: 15.00,
      currency: 'USD',
      note: 'Reimbursement for hackathon supplies',
      senderBatchId: batchId
    });
    console.log('✅ PAYPAL PAYOUT EXECUTED SUCCESSFULLY!');
    console.log('Batch ID:', res.batchId);
    console.log('Batch Status:', res.batchStatus);
  } catch (err) {
    console.error('Payout test result:', err.message);
  }
}

testPayout();
