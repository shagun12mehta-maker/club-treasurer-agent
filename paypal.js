import dotenv from 'dotenv';
dotenv.config();

const PAYPAL_BASE_URL = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;

let cachedToken = null;
let tokenExpiryTime = 0;

export function isSandboxConfigured() {
  return Boolean(
    CLIENT_ID &&
    CLIENT_SECRET &&
    !CLIENT_ID.includes('your_') &&
    !CLIENT_SECRET.includes('your_')
  );
}

/**
 * Generates an OAuth2 access token for PayPal API calls.
 */
export async function getPayPalAccessToken() {
  if (!isSandboxConfigured()) {
    throw new Error('PayPal Sandbox credentials not configured in .env (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
  }

  // Return cached token if valid for at least another 60 seconds
  if (cachedToken && Date.now() < tokenExpiryTime - 60000) {
    return cachedToken;
  }

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClubTreasurerAgent/1.0'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal OAuth authentication failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiryTime = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

/**
 * Disburses funds to an individual member/vendor via PayPal Payouts API.
 */
export async function disbursePayout({
  recipientEmail,
  amount,
  currency = 'USD',
  note = 'Club Treasurer Reimbursement',
  senderBatchId
}) {
  const token = await getPayPalAccessToken();

  const payload = {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: 'Club Treasury Payment / Reimbursement',
      email_message: note
    },
    items: [
      {
        recipient_type: 'EMAIL',
        amount: {
          value: parseFloat(amount).toFixed(2),
          currency
        },
        note,
        sender_item_id: `item_${senderBatchId}`,
        receiver: recipientEmail
      }
    ]
  };

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClubTreasurerAgent/1.0'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`PayPal Payout failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return {
    success: true,
    batchId: data.batch_header?.payout_batch_id,
    batchStatus: data.batch_header?.batch_status,
    senderBatchId: data.batch_header?.sender_batch_header?.sender_batch_id
  };
}

/**
 * Creates and sends a PayPal Invoice to collect membership dues or event fees.
 */
export async function createAndSendInvoice({
  recipientEmail,
  recipientName = 'Club Member',
  itemTitle = 'Club Annual Membership Dues',
  amount,
  currency = 'USD',
  note = 'Thank you for supporting the club!'
}) {
  const token = await getPayPalAccessToken();

  // Step 1: Create draft invoice
  const draftPayload = {
    detail: {
      currency_code: currency,
      note,
      payment_term: {
        term_type: 'NET_10'
      }
    },
    invoicer: {
      name: {
        given_name: 'Club',
        surname: 'Treasurer'
      }
    },
    primary_recipients: [
      {
        billing_info: {
          name: {
            given_name: recipientName
          },
          email_address: recipientEmail
        }
      }
    ],
    items: [
      {
        name: itemTitle,
        quantity: '1',
        unit_amount: {
          currency_code: currency,
          value: parseFloat(amount).toFixed(2)
        }
      }
    ]
  };

  const createRes = await fetch(`${PAYPAL_BASE_URL}/v2/invoicing/invoices`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClubTreasurerAgent/1.0'
    },
    body: JSON.stringify(draftPayload)
  });

  const createData = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`PayPal Invoice creation failed: ${JSON.stringify(createData)}`);
  }

  const invoiceId = createData.id || createData.href?.split('/').pop();

  // Step 2: Send invoice
  const sendRes = await fetch(`${PAYPAL_BASE_URL}/v2/invoicing/invoices/${invoiceId}/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClubTreasurerAgent/1.0'
    },
    body: JSON.stringify({ send_to_invoicer: true })
  });

  return {
    success: true,
    invoiceId,
    status: sendRes.ok ? 'SENT' : 'DRAFT',
    invoiceHref: createData.href
  };
}

/**
 * Verifies PayPal Webhook signature for security compliance.
 */
export async function verifyWebhookSignature({
  transmissionId,
  transmissionTime,
  certUrl,
  authAlgo,
  transmissionSig,
  webhookEvent
}) {
  const token = await getPayPalAccessToken();

  const payload = {
    transmission_id: transmissionId,
    transmission_time: transmissionTime,
    cert_url: certUrl,
    auth_algo: authAlgo,
    transmission_sig: transmissionSig,
    webhook_id: WEBHOOK_ID || 'MOCK_WEBHOOK_ID',
    webhook_event: webhookEvent
  };

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) return false;
  const data = await response.json();
  return data.verification_status === 'SUCCESS';
}

export default {
  isSandboxConfigured,
  getPayPalAccessToken,
  disbursePayout,
  createAndSendInvoice,
  verifyWebhookSignature
};
