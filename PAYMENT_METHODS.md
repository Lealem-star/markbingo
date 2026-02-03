# 💳 Payment Methods in Telegram Bot

## Overview
The bot supports **3 payment methods** for deposits. Users can deposit a minimum of **50 ETB**.

---

## Payment Options

### 1️⃣ **Telebirr** 📱
- **Agent Name**: Meseret Tebabal
- **Agent Number**: `0934551781`
- **Steps**:
  1. Open Telebirr app
  2. Select "Send Money"
  3. Enter agent number: `0934551781`
  4. Enter the deposit amount
  5. Send the SMS receipt to the bot

---

### 2️⃣ **Commercial Bank of Ethiopia** 🏦
- **Agent Name**: Lealem Meseret
- **Account Number**: `1000415847959`
- **Bank**: Commercial Bank of Ethiopia
- **Steps**:
  1. Dial `889` (Commercial Bank short code)
  2. Transfer to account: `1000415847959`
  3. Enter the deposit amount
  4. Complete the transaction
  5. Send the SMS receipt to the bot

---

### 3️⃣ **CBE Birr** 💳
- **Agent Name**: Lealem Meseret
- **Agent Number**: `0934551781`
- **Bank**: Commercial Bank of Ethiopia
- **Steps**:
  1. Open CBE Birr app or dial `847` (short code)
  2. Select "Send Money"
  3. Enter agent number: `0934551781`
  4. Enter the deposit amount
  5. Send the transaction
  6. Send the SMS receipt to the bot

---

## Important Notes

### Transfer Rules
- ✅ **From Telebirr → Agent Telebirr only**
- ✅ **From Commercial Bank → Agent Commercial Bank only**
- ✅ **From CBE Birr → Agent CBE Birr only**

**Users cannot mix payment methods** (e.g., cannot send from Telebirr to Commercial Bank account).

---

## Deposit Flow

1. User types `/deposit` or clicks "💰 Deposit"
2. Bot asks for deposit amount (minimum 50 ETB)
3. User enters amount (e.g., `100`)
4. Bot shows payment method options:
   - 📱 Telebirr
   - 🏦 Commercial Bank
   - 💳 CBE Birr
5. User selects preferred method
6. Bot shows detailed instructions with agent details
7. User completes payment and sends SMS receipt
8. Bot processes receipt automatically
9. Wallet is credited (after admin approval if needed)

---

## Support
For payment issues, users can contact: **@Funbingosupport1**

---

## Technical Details

### Bot Actions
- `deposit_telebirr_{amount}` - Telebirr deposit flow
- `deposit_commercial_{amount}` - Commercial Bank deposit flow
- `deposit_cbe_{amount}` - CBE Birr deposit flow
- `send_receipt_telebirr` - Submit Telebirr receipt
- `send_receipt_commercial` - Submit Commercial Bank receipt
- `send_receipt_cbe` - Submit CBE Birr receipt

### Receipt Processing
- Bot uses `parseReceipt()` function to extract amount from SMS
- Supports multiple SMS formats (ETB, Birr, Br., etc.)
- Automatically matches amount with deposit request
- Creates deposit verification record for admin approval

