import dotenv from 'dotenv';
dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Parses receipt image (Base64 or image URL) using Claude Vision.
 * Falls back to mock parser if ANTHROPIC_API_KEY is not set.
 */
export async function scanReceiptWithAI({ imageBase64, mediaType = 'image/jpeg', mockFallback = true }) {
  const isRealKey = ANTHROPIC_API_KEY &&
    !ANTHROPIC_API_KEY.includes('your_') &&
    !ANTHROPIC_API_KEY.includes('mock_') &&
    ANTHROPIC_API_KEY.startsWith('sk-ant-');

  if (!isRealKey) {
    if (mockFallback) {
      console.log('ℹ️ Anthropic API Key not set/mock — using demo mock receipt scanner');
      return getMockReceiptResult();
    }
    throw new Error('Valid ANTHROPIC_API_KEY not configured in .env');
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

const MOCK_RECEIPTS = [
  {
    merchant: "Robotics & IoT Electronics Hub",
    date: new Date().toISOString().split('T')[0],
    items: [
      { name: "Arduino Uno R4 Starter Kit", quantity: 2, price: 54.00 },
      { name: "Ultrasonic Sensors Pack", quantity: 3, price: 18.00 },
      { name: "Jumper Wires & Breadboards", quantity: 1, price: 12.50 }
    ],
    subtotal: 104.50,
    tax: 11.00,
    total: 115.50,
    currency: "USD",
    category: "Hardware & Lab Supplies",
    confidenceScore: 0.99,
    notes: "Microcontroller parts for Club Hackathon Build Track"
  },
  {
    merchant: "Campus QuickPrint & Posters",
    date: new Date().toISOString().split('T')[0],
    items: [
      { name: "Club Hackathon A3 Posters (Qty 50)", quantity: 1, price: 25.00 },
      { name: "Laminating Pouches", quantity: 1, price: 8.50 }
    ],
    subtotal: 33.50,
    tax: 2.50,
    total: 36.00,
    currency: "USD",
    category: "Marketing & Supplies",
    confidenceScore: 0.97,
    notes: "Promotional banner and poster printing"
  },
  {
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
  }
];

let mockIndex = 0;

function getMockReceiptResult() {
  const receipt = MOCK_RECEIPTS[mockIndex % MOCK_RECEIPTS.length];
  mockIndex++;
  return { ...receipt, date: new Date().toISOString().split('T')[0] };
}

export default {
  scanReceiptWithAI
};
