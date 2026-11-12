# 🏦 Club Treasurer Agent
> **"AI Proposes, Humans Approve"** — An autonomous, safety-first financial co-pilot for student clubs and non-profit organizations, powered by Claude Tool-Calling, Vision AI, and the PayPal Sandbox API.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![PayPal](https://img.shields.io/badge/PayPal-Invoicing%20%7C%20Payouts%20%7C%20Webhooks-0070ba.svg)](https://developer.paypal.com)
[![Claude AI](https://img.shields.io/badge/Anthropic-Claude%203.5%20Sonnet-d97706.svg)](https://anthropic.com)

---

## 📌 Problem Statement
Student clubs and non-profits often struggle with financial mismanagement, slow reimbursements, and lack of ledger transparency. Handing direct bank or PayPal credentials to an autonomous AI agent introduces severe financial risk (prompt injection, erroneous payouts, duplicate payments).

**Club Treasurer Agent solves this by implementing strict Human-in-the-Loop governance:**
* The AI Agent acts as an intelligent financial analyst: scanning receipts, parsing intent, and checking policy limits.
* **The AI NEVER disburses funds autonomously.** It prepares a structured proposal that requires cryptographic/digital officer signatures (1 or 2 approvers depending on the amount) before the **PayPal Payouts API** is triggered.

---

## 🏗️ System Architecture

```
                                  [Club Member]
                                        │ (Submits Receipt / Chat Request)
                                        ▼
                            ┌────────────────────────┐
                            │  AI Treasurer Agent    │
                            │  (Claude Tool-Calling  │
                            │   & Vision Scanner)    │
                            └───────────┬────────────┘
                                        │
                                        ▼
                            ┌────────────────────────┐
                            │  Safety Policy Engine  │
                            │       (rules.js)       │
                            │ - $250 Hard Cap Limit  │
                            │ - Duplicate Detection  │
                            │ - Dual-Approval (>=$75)│
                            │ - Idempotency Keys     │
                            └───────────┬────────────┘
                                        │
                                        ▼
                            ┌────────────────────────┐
                            │     Ledger & Store     │ ◄─── Public Transparency
                            │        (db.js)         │      Audit Trail
                            └───────────┬────────────┘
                                        │ (Status: PENDING_APPROVAL)
                                        ▼
                            ┌────────────────────────┐
                            │ Human Officers Portal  │
                            │  - Treasurer Sign-off  │
                            │  - President Sign-off  │
                            └───────────┬────────────┘
                                        │ (Both Approved)
                                        ▼
                            ┌────────────────────────┐
                            │   PayPal Sandbox API   │
                            │  - Payouts (Disburse)  │
                            │  - Invoicing (Dues)    │
                            │  - Webhooks (Sync)     │
                            └────────────────────────┘
```

---

## 🛡️ Safety & Financial Governance Matrix

| Safety Guardrail | Implementation | Purpose |
|---|---|---|
| **Human-in-the-Loop** | Proposal State Machine (`PENDING_APPROVAL` &rarr; `APPROVED` &rarr; `PAID`) | AI cannot disburse funds without authorized officer click/sign-off. |
| **Dual-Officer Rule** | Amounts $\ge\$75.00$ require 2 signatures (Treasurer + President) | Prevents single-officer embezzlement or rogue authorizations. |
| **Hard Spending Cap** | Auto-rejects any single claim $> \$250.00$ | Limits maximum risk exposure per transaction. |
| **Duplicate Claim Defense**| Matches receipt merchant, date, and amount across proposals | Prevents double-claiming identical restaurant or store receipts. |
| **New Payee Alert** | Flags recipients not in `knownPayees` list | Extra scrutiny for first-time external vendor accounts. |
| **Idempotency Guarantee** | Deterministic SHA-256 `sender_batch_id` | Prevents double charges during network retries or re-clicks. |
| **Public Transparency Log**| Immutable audit trail of every scan, vote, and payout | Every member can inspect where club funds were allocated. |

---

## 🧰 Tools & Services Used
* **Claude 3.5 Sonnet (Anthropic):** Tool-calling agent (`check_treasury_balance`, `propose_payout_reimbursement`, `create_dues_invoice`) and Vision receipt scanning.
* **PayPal Sandbox APIs:**
  * **Payouts API (`/v1/payments/payouts`):** Instant automated disbursement upon full human approval.
  * **Invoicing API (`/v2/invoicing/invoices`):** Automated creation and dispatch of club dues.
  * **Webhooks (`CUSTOMER.DISPUTE.*`, `PAYMENT.PAYOUTSBATCH.*`):** Real-time ledger synchronization.
* **Backend:** Node.js, Express, ES Modules, crypto.
* **Hosting:** Render (Cloud deployment).

---

## 🚀 Quickstart & Local Setup

### 1. Clone the repository
```bash
git clone https://github.com/shagun12mehta-maker/club-treasurer-agent.git
cd club-treasurer-agent
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```

Edit `.env` and fill in your keys:
```env
PORT=3000
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_paypal_sandbox_client_secret
ANTHROPIC_API_KEY=your_anthropic_api_key
MAX_SINGLE_PAYOUT_LIMIT=250.00
DUAL_APPROVAL_THRESHOLD=75.00
```
*(Note: If PayPal keys are not provided, the application runs in a simulated sandbox mode so judges can still test the complete end-to-end flow!)*

### 4. Start the Application
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser to view the Treasurer Dashboard and AI Agent Chat.

---

## ☁️ Deployment on Render

1. Create a free account at [render.com](https://render.com).
2. Click **New + > Web Service** and link your public GitHub repository (`club-treasurer-agent`).
3. Set the following settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add your Environment Variables (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY`).
5. Click **Deploy**.

---

## 📄 License
This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
