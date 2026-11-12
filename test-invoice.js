import dotenv from 'dotenv';
import paypal from './paypal.js';

dotenv.config();

async function testInvoice() {
  console.log('--- Testing PayPal Invoicing API ---');
  try {
    const res = await paypal.createAndSendInvoice({
      recipientEmail: 'student-member@club.edu',
      recipientName: 'Rohan Sharma',
      itemTitle: 'Annual AI Club Membership Dues (Fall 2026)',
      amount: 25.00,
      note: 'Thank you for joining the Club!'
    });
    console.log('✅ INVOICE CREATED & SENT SUCCESSFULLY!');
    console.log('Invoice ID:', res.invoiceId);
    console.log('Status:', res.status);
    console.log('Invoice Href:', res.invoiceHref);
  } catch (err) {
    console.error('Invoice test result:', err.message);
  }
}

testInvoice();
