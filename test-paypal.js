import dotenv from 'dotenv';
import paypal from './paypal.js';

dotenv.config();

console.log('--- PayPal Sandbox Verification ---');
console.log('Mode:', process.env.PAYPAL_MODE || 'sandbox');
console.log('Client ID configured:', Boolean(process.env.PAYPAL_CLIENT_ID && !process.env.PAYPAL_CLIENT_ID.includes('your_')));

async function runTest() {
  if (!paypal.isSandboxConfigured()) {
    console.log('⚠️ PayPal Sandbox credentials missing or placeholder in .env.');
    console.log('Please add real PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env to run live sandbox test.');
    return;
  }

  try {
    console.log('Requesting OAuth2 access token from PayPal Sandbox...');
    const token = await paypal.getPayPalAccessToken();
    console.log('✅ SUCCESS! PayPal OAuth2 Access Token received:');
    console.log(token.substring(0, 20) + '...' + token.substring(token.length - 10));
    console.log('Ready for Invoicing, Payouts, and Webhooks!');
  } catch (err) {
    console.error('❌ PayPal Token Test Failed:', err.message);
  }
}

runTest();
