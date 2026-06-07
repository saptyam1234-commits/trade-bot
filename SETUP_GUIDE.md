# 🚀 TradeSignal AI — SMC Pro v3.0
## Complete Setup Guide (Hindi)

---

## 📦 Files Jo Milenge
- `smc-server/` — Backend server (Render pe deploy hoga)
- `smc-extension/` — Chrome Extension (TradingView pe chalega)

---

## STEP 1 — Telegram Bot Banao (Free)

1. Telegram mein **@BotFather** search karo
2. `/newbot` bhejo
3. Bot ka naam do (e.g. `MyTradeSignalBot`)
4. **Token milega** — copy karke rakho:
   ```
   123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
   ```
5. Apna **channel banao** (public ya private)
6. Bot ko channel ka **Admin** banao
7. Channel username note karo: `@mytradechannel`

---

## STEP 2 — Gemini API Key Lo (Free)

1. `aistudio.google.com` pe jao
2. **"Get API Key"** click karo
3. Key copy karo:
   ```
   AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

---

## STEP 3 — Server GitHub pe Upload Karo

1. `github.com` pe free account banao
2. **New Repository** banao — naam: `tradesignal-smc`
3. `smc-server/` ke andar ke saare files upload karo:
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `engines/smc.js`
   - `engines/ai.js`
   - `bots/telegram.js`
4. **.env.example** mat upload karna (secrets hain)

---

## STEP 4 — Render pe Deploy Karo (Free)

1. `render.com` pe jao — GitHub se login karo
2. **New → Web Service** click karo
3. Apna GitHub repo select karo
4. Settings:
   - **Name:** `tradesignal-smc-ai`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. **Environment Variables** mein ye daalo:

   | Key | Value |
   |-----|-------|
   | `CLAUDE_API_KEY` | `sk-ant-api03-...` |
   | `GEMINI_API_KEY` | `AIzaSy...` |
   | `TELEGRAM_TOKEN` | `123456:ABC...` |
   | `TELEGRAM_CHANNEL` | `@yourchannel` |

6. **Deploy** click karo
7. 2-3 minute mein URL milega:
   ```
   https://tradesignal-smc-ai.onrender.com
   ```
8. URL kholo — ye dikhna chahiye:
   ```json
   {"status": "TradeSignal AI — SMC Server v3.0 ✅"}
   ```

---

## STEP 5 — Chrome Extension Install Karo

1. `smc-extension/` folder ko computer mein rakho
2. Chrome mein: `chrome://extensions`
3. **Developer mode ON** karo (top-right)
4. **"Load unpacked"** → `smc-extension` folder select karo
5. Extension list mein **TradeSignal SMC Pro** dikhega ✅

---

## STEP 6 — Extension Setup Karo

Extension icon click karo → **⚙ Setup** mein:

| Field | Value |
|-------|-------|
| Server URL | `https://tradesignal-smc-ai.onrender.com` |
| Claude API Key | `sk-ant-api03-...` |
| Gemini API Key | `AIzaSy...` |
| Telegram Token | `123456:ABC...` |
| Telegram Channel | `@yourchannel` |
| Account Size | `10000` (ya apna amount) |

---

## ✅ Use Karo!

1. `tradingview.com` pe jao
2. Koi bhi stock/forex/crypto chart kholo
3. Extension icon click karo
4. Symbol auto-detect hoga
5. Timeframe choose karo
6. **⚡ SMC Analyze** click karo!

### Kya milega:
- 🔷 **BOS / CHoCH** — Market structure
- 🧱 **Order Blocks** — Institutional zones
- 💧 **Liquidity Sweeps** — Smart money moves
- ⬜ **FVG** — Fair Value Gaps
- 🎯 **SL Hunts** — Stop hunt detection
- 📊 **EMA 5/10/20/50** — Trend stack
- 📈 **Entry, Target 1, Target 2, Stop Loss**
- ⚖️ **R:R Ratio** — Setup validity
- 💼 **Risk Management** — Position size (1%)
- 📱 **Telegram Signal** — Auto bhejega

---

## 🔄 Auto Scan

Server automatically **har 4 ghante** (Mon-Fri) scan karta hai:
- Indian stocks (RELIANCE, TCS, NIFTY, etc.)
- Crypto (BTC, ETH, SOL)
- High confidence signals Telegram pe bhejta hai

---

## ❓ Common Problems

**Server URL kaam nahi kar raha?**
→ Render free plan mein 15 min baad sleep hota hai. Pehli request slow hoti hai — 30 sec wait karo.

**Symbol not found?**
→ Indian stocks ke liye `.NS` lagao: `RELIANCE.NS`
→ Crypto: `BTC-USD`, `ETH-USD`
→ Forex: `EURUSD=X`, `GBPUSD=X`
→ Gold: `GC=F`

**Telegram message nahi aa raha?**
→ Bot ko channel ka Admin banao
→ Channel mein ek message manually bhejo pehle

---

## 💰 Costs

| Service | Cost |
|---------|------|
| Render.com | **FREE** |
| Claude API | ~₹80 per 300 signals |
| Gemini API | **FREE** (backup) |
| Telegram Bot | **FREE** |
| Yahoo Finance | **FREE** |
| **TOTAL** | **Almost FREE** |

---

*⚠️ Disclaimer: Educational purpose only. Not financial advice. Funded account traders — always follow your prop firm rules and risk guidelines.*
