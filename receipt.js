import dotenv from 'dotenv';
dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Parses receipt image (Base64 or image URL) using Claude Vision.
 * Falls back to mock parser if ANTHROPIC_API_KEY is not set.
 */
export async function scanReceiptWithAI({ imageBase64, mediaType = 'image/jpeg', mockFallback = true }) {
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.includes('your_')) {
    if (mockFallback) {
      console.log('ℹ️ Anthropic API Key not set — using demo mock receipt scanner');
      return getMockReceiptResult();
    }
    throw new Error('ANTHROPIC_API_KEY not configured in .env');
  }

  const prompt = `You are an expert club treasurer AI. Analyze this receipt or expense voucher image and extract the structured financial data.
Return ONLY a valid JSON object with no markdown wrapper, comments, or backticks:
{
  "merchant": "Name of store, vendor, or restaurant",
  "date": "YYYY-MM-DD (or current date if missing)",
  "items": [
    { "name": "Item description", "quantity": 1, "price": 10.00 }
  ],
  "subtotal": 10.00,
  "tax": 0.80,
  "total": 10.80,
  "currency": "USD",
  "category": "Food & Catering | Hardware & Supplies | Printing | Software & Hosting | Event Venue",
  "confidenceScore": 0.95,
  "notes": "Brief 1-sentence summary of what this expense was for"
}`;

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
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude Vision API failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const textContent = data.content?.[0]?.text || '{}';

  try {
    const cleaned = textContent.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse Claude Vision JSON response:', textContent);
    return getMockReceiptResult();
  }
}

function getMockReceiptResult() {
  return {
    merchant: "Campus Pizza & Bakery",
    date: new Date().toISOString().split('T')[0],
    items: [
      { name: "Large Margherita Pizza", quantity: 2, price: 32.00 },
      { name: "Garlic Breadsticks", quantity: 1, price: 6.50 },
      { name: "Soda Cans (Pack of 6)", quantity: 1, price: 7.50 }
    ],
    subtotal: 46.00,
    tax: 3.68,
    total: 49.68,
    currency: "USD",
    category: "Food & Catering",
    confidenceScore: 0.98,
    notes: "Food supplies for Club Weekly Hack Night"
  };
}

export default {
  scanReceiptWithAI
};
