// ═══════════════════════════════════════════════════════════════
//  TRADESIGNAL AI — SMC SERVER v3.1
//  Binance WS (Crypto) + Twelve Data (Forex) + Yahoo (Indian)
//  Claude/Gemini AI + Telegram Bot + Auto Scan
// ═══════════════════════════════════════════════════════════════

require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const cron        = require("node-cron");
const SMCEngine   = require("./engines/smc");
const AIEngine    = require("./engines/ai");
const TelegramSignalBot = require("./bots/telegram");
const DataRouter  = require("./data/router");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Initialize data router with Twelve Data key ──────────────
const dataRouter = new DataRouter(process.env.TWELVE_DATA_KEY || "");

// ═══════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════

// ── Health Check ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "TradeSignal AI — SMC Server v3.1 ✅",
    dataSources: {
      crypto: "Binance WebSocket (Real-time FREE)",
      forex:  "Twelve Data API (Near real-time FREE)",
      indian: "Yahoo Finance (15min delay FREE)",
    },
    features: ["SMC Engine","BOS/CHoCH","HH/HL/LL/LH","Order Blocks","Liquidity","FVG","SL Hunts","EMA 5/10/20/30","Claude+Gemini","Telegram"],
    markets: ["NSE/BSE Indian Stocks","Forex","Crypto","Gold/Silver","Indices"]
  });
});

// ── Market Info Route ─────────────────────────────────────────
app.get("/market-info/:symbol", (req, res) => {
  const info = dataRouter.getMarketInfo(req.params.symbol);
  res.json(info);
});

// ── Main Analyze Route ────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const {
    symbol, timeframe = "1h",
    claudeKey, geminiKey,
    telegramToken, telegramChannel,
    accountSize = 10000,
    extraContext = "",
    sendToTelegram = false
  } = req.body;

  if (!symbol)                  return res.status(400).json({ error: "Symbol required" });
  if (!claudeKey && !geminiKey) return res.status(400).json({ error: "At least one AI API key required" });

  try {
    // 1. Fetch market data via smart router
    const marketData = await dataRouter.getData(symbol, timeframe);
    const marketInfo = dataRouter.getMarketInfo(symbol);

    // 2. SMC Analysis
    const smcData = SMCEngine.fullAnalysis(marketData);

    // 3. AI Analysis
    const aiSignal = await AIEngine.analyze({
      symbol, timeframe, smcData,
      claudeKey, geminiKey, extraContext
    });

    // 4. Risk Management
    const riskData = SMCEngine.calcRiskManagement(
      parseFloat(aiSignal.entry)    || smcData.suggestedEntry,
      parseFloat(aiSignal.stopLoss) || smcData.suggestedSL,
      parseFloat(aiSignal.target1)  || smcData.suggestedTarget,
      accountSize, 1
    );

    // 5. Send to Telegram if requested
    let telegramSent = false;
    if (sendToTelegram && telegramToken && telegramChannel) {
      try {
        const tgBot = new TelegramSignalBot(telegramToken, telegramChannel);
        if (aiSignal.confidence >= 65) {
          telegramSent = await tgBot.sendSignal(symbol, timeframe, aiSignal, smcData, riskData);
        }
      } catch(e) { console.error("Telegram error:", e.message); }
    }

    // 6. Return full response
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      timeframe,
      timestamp: new Date().toISOString(),
      currentPrice: smcData.currentPrice,
      livePrice: marketData.livePrice,
      dataSource: marketData.source,
      market: marketInfo,

      smc: {
        bias: smcData.overallBias,
        confidence: smcData.confidence,
        ema: smcData.emaData,
        marketStructure: smcData.marketStructure,
        bos: smcData.bos,
        choch: smcData.choch,
        orderBlocks: smcData.orderBlocks,
        liquidity: smcData.liquidity,
        fvg: smcData.fvg,
        slHunts: smcData.slHunts,
        volume: smcData.volumeData,
        keyLevels: smcData.keyLevels,
      },

      signal: aiSignal,
      risk: riskData,
      telegramSent,
      aiSource: aiSignal.aiSource
    });

  } catch(err) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Multi-Symbol Scan Route ───────────────────────────────────
app.post("/scan", async (req, res) => {
  const {
    symbols, timeframe = "1h",
    claudeKey, geminiKey,
    telegramToken, telegramChannel,
    minConfidence = 65,
    accountSize = 10000,
    sendToTelegram = false
  } = req.body;

  if (!symbols || !Array.isArray(symbols) || symbols.length === 0)
    return res.status(400).json({ error: "symbols array required" });
  if (symbols.length > 20)
    return res.status(400).json({ error: "Max 20 symbols per scan" });

  const results = [];
  const highConfSignals = [];

  for (const symbol of symbols) {
    try {
      const marketData = await dataRouter.getData(symbol, timeframe);
      const smcData    = SMCEngine.fullAnalysis(marketData);
      const aiSignal   = await AIEngine.analyze({
        symbol, timeframe, smcData, claudeKey, geminiKey
      });
      const riskData = SMCEngine.calcRiskManagement(
        parseFloat(aiSignal.entry)    || smcData.suggestedEntry,
        parseFloat(aiSignal.stopLoss) || smcData.suggestedSL,
        parseFloat(aiSignal.target1)  || smcData.suggestedTarget,
        accountSize, 1
      );

      const result = {
        symbol: symbol.toUpperCase(),
        timeframe,
        market: dataRouter.classify(symbol),
        dataSource: marketData.source,
        currentPrice: smcData.currentPrice,
        livePrice: marketData.livePrice,
        signal: aiSignal.signal,
        confidence: aiSignal.confidence,
        entry: aiSignal.entry,
        stopLoss: aiSignal.stopLoss,
        target1: aiSignal.target1,
        target2: aiSignal.target2,
        rrRatio: aiSignal.rrRatio,
        smcBias: smcData.overallBias,
        msTrend: smcData.marketStructure?.trend,
        emaTrend: smcData.emaData?.trend,
        aiSource: aiSignal.aiSource,
        riskValid: riskData?.isValidSetup,
        summary: aiSignal.summary
      };

      results.push(result);

      if (aiSignal.confidence >= minConfidence && ["BUY","SELL"].includes(aiSignal.signal)) {
        highConfSignals.push({ symbol, timeframe, signal: aiSignal, smcData, riskData });
      }

      await new Promise(r => setTimeout(r, 800));
    } catch(e) {
      results.push({ symbol: symbol.toUpperCase(), error: e.message });
    }
  }

  // Send to Telegram
  if (sendToTelegram && telegramToken && telegramChannel && highConfSignals.length > 0) {
    try {
      const tgBot = new TelegramSignalBot(telegramToken, telegramChannel);
      for (const s of highConfSignals.slice(0, 5)) {
        await tgBot.sendSignal(s.symbol, s.timeframe, s.signal, s.smcData, s.riskData);
        await new Promise(r => setTimeout(r, 1000));
      }
      await tgBot.sendScanSummary(results.filter(r => !r.error));
    } catch(e) { console.error("Telegram scan error:", e.message); }
  }

  res.json({
    success: true,
    scanned: results.length,
    highConfidenceSignals: highConfSignals.length,
    results: results.sort((a, b) => (b.confidence||0) - (a.confidence||0))
  });
});

// ── Live Price Route ──────────────────────────────────────────
app.get("/price/:symbol", async (req, res) => {
  try {
    const price = await dataRouter.getLivePrice(req.params.symbol);
    const info  = dataRouter.getMarketInfo(req.params.symbol);
    res.json({ symbol: req.params.symbol.toUpperCase(), price, ...info });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Telegram Test Route ───────────────────────────────────────
app.post("/telegram/test", async (req, res) => {
  const { telegramToken, telegramChannel } = req.body;
  if (!telegramToken || !telegramChannel)
    return res.status(400).json({ error: "telegramToken and telegramChannel required" });
  try {
    const bot = new TelegramSignalBot(telegramToken, telegramChannel);
    const ok  = await bot.testConnection();
    res.json({ success: ok, message: ok ? "Telegram connected! ✅" : "Failed" });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  AUTO SCAN — Every 4H (Mon-Fri)
// ═══════════════════════════════════════════════════════════════
cron.schedule("0 9,13,17,21 * * 1-5", async () => {
  const claudeKey  = process.env.CLAUDE_API_KEY;
  const geminiKey  = process.env.GEMINI_API_KEY;
  const tgToken    = process.env.TELEGRAM_TOKEN;
  const tgChannel  = process.env.TELEGRAM_CHANNEL;

  if ((!claudeKey && !geminiKey) || !tgToken || !tgChannel) return;

  console.log("🔄 Auto scan starting...");

  const watchlist = [
    // Indian
    "RELIANCE","TCS","HDFCBANK","NIFTY","BANKNIFTY",
    // Crypto (Binance WS)
    "BTC","ETH","SOL","BNB",
    // Forex (Twelve Data)
    "XAUUSD","EURUSD","GBPUSD"
  ];

  try {
    const tgBot  = new TelegramSignalBot(tgToken, tgChannel);
    const results = [];

    for (const symbol of watchlist) {
      try {
        const marketData = await dataRouter.getData(symbol, "4h");
        const smcData    = SMCEngine.fullAnalysis(marketData);
        const aiSignal   = await AIEngine.analyze({
          symbol, timeframe: "4h", smcData, claudeKey, geminiKey
        });

        results.push({
          symbol, signal: aiSignal.signal,
          confidence: aiSignal.confidence,
          entry: aiSignal.entry,
          stopLoss: aiSignal.stopLoss,
          target1: aiSignal.target1
        });

        if (aiSignal.confidence >= 70 && ["BUY","SELL"].includes(aiSignal.signal)) {
          const riskData = SMCEngine.calcRiskManagement(
            parseFloat(aiSignal.entry)    || smcData.suggestedEntry,
            parseFloat(aiSignal.stopLoss) || smcData.suggestedSL,
            parseFloat(aiSignal.target1)  || smcData.suggestedTarget,
            10000, 1
          );
          await tgBot.sendSignal(symbol, "4h", aiSignal, smcData, riskData);
        }

        await new Promise(r => setTimeout(r, 1200));
      } catch(e) {
        console.error(`Auto scan error [${symbol}]:`, e.message);
      }
    }

    await tgBot.sendScanSummary(results);
    console.log(`✅ Auto scan done. ${results.length} scanned.`);
  } catch(e) {
    console.error("Auto scan failed:", e.message);
  }
});

app.listen(PORT, () => {
  console.log(`
🚀 TradeSignal AI — SMC Server v3.1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Port: ${PORT}
📡 Crypto:  Binance WebSocket (REAL-TIME)
📊 Forex:   Twelve Data API (NEAR REAL-TIME)
🏦 Indian:  Yahoo Finance (15min delay)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ SMC: BOS | CHoCH | HH/HL/LL/LH | OB | Liquidity | FVG | SL Hunts
✅ EMA: 5 | 10 | 20 | 30
✅ AI: Claude (primary) + Gemini (backup)
✅ Telegram: Signal Bot Ready
✅ Auto Scan: Every 4H (Mon-Fri)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});

// ── Main Analyze Route ────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const {
    symbol, timeframe = "1d",
    claudeKey, geminiKey,
    telegramToken, telegramChannel,
    accountSize = 10000,
    extraContext = "",
    sendToTelegram = false
  } = req.body;

  if (!symbol)                      return res.status(400).json({ error: "Symbol required" });
  if (!claudeKey && !geminiKey)     return res.status(400).json({ error: "At least one AI API key required" });

  try {
    // 1. Fetch market data
    const marketData = await fetchMarketData(symbol, timeframe);

    // 2. SMC Analysis
    const smcData = SMCEngine.fullAnalysis(marketData);

    // 3. AI Analysis (Claude → Gemini fallback)
    const aiSignal = await AIEngine.analyze({
      symbol, timeframe, smcData,
      claudeKey, geminiKey, extraContext
    });

    // 4. Risk Management
    const riskData = SMCEngine.calcRiskManagement(
      parseFloat(aiSignal.entry) || smcData.suggestedEntry,
      parseFloat(aiSignal.stopLoss) || smcData.suggestedSL,
      parseFloat(aiSignal.target1) || smcData.suggestedTarget,
      accountSize, 1
    );

    // 5. Send to Telegram if requested
    let telegramSent = false;
    if (sendToTelegram && telegramToken && telegramChannel) {
      try {
        const tgBot = new TelegramSignalBot(telegramToken, telegramChannel);
        // Only send high confidence signals
        if (aiSignal.confidence >= 65) {
          telegramSent = await tgBot.sendSignal(symbol, timeframe, aiSignal, smcData, riskData);
        }
      } catch (e) {
        console.error("Telegram error:", e.message);
      }
    }

    // 6. Return full response
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      yahooSymbol: marketData.yahooSymbol,
      timeframe,
      timestamp: new Date().toISOString(),
      currentPrice: smcData.currentPrice,

      // SMC Data
      smc: {
        bias: smcData.overallBias,
        confidence: smcData.confidence,
        ema: smcData.emaData,
        marketStructure: smcData.marketStructure,   // HH/HL/LL/LH
        bos: smcData.bos,
        choch: smcData.choch,
        orderBlocks: smcData.orderBlocks,
        liquidity: smcData.liquidity,
        fvg: smcData.fvg,
        slHunts: smcData.slHunts,
        volume: smcData.volumeData,
        keyLevels: smcData.keyLevels,
      },

      // AI Signal
      signal: aiSignal,

      // Risk Management
      risk: riskData,

      // Meta
      telegramSent,
      aiSource: aiSignal.aiSource
    });

  } catch (err) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Multi-Symbol Scan Route ───────────────────────────────────
app.post("/scan", async (req, res) => {
  const {
    symbols, timeframe = "1d",
    claudeKey, geminiKey,
    telegramToken, telegramChannel,
    minConfidence = 65,
    accountSize = 10000,
    sendToTelegram = false
  } = req.body;

  if (!symbols || !Array.isArray(symbols) || symbols.length === 0)
    return res.status(400).json({ error: "symbols array required" });

  if (symbols.length > 20)
    return res.status(400).json({ error: "Max 20 symbols per scan" });

  const results = [];
  const signals = [];

  for (const symbol of symbols) {
    try {
      const marketData = await fetchMarketData(symbol, timeframe);
      const smcData    = SMCEngine.fullAnalysis(marketData);
      const aiSignal   = await AIEngine.analyze({
        symbol, timeframe, smcData, claudeKey, geminiKey
      });

      const riskData = SMCEngine.calcRiskManagement(
        parseFloat(aiSignal.entry) || smcData.suggestedEntry,
        parseFloat(aiSignal.stopLoss) || smcData.suggestedSL,
        parseFloat(aiSignal.target1) || smcData.suggestedTarget,
        accountSize, 1
      );

      const result = {
        symbol: symbol.toUpperCase(),
        timeframe,
        currentPrice: smcData.currentPrice,
        signal: aiSignal.signal,
        confidence: aiSignal.confidence,
        entry: aiSignal.entry,
        stopLoss: aiSignal.stopLoss,
        target1: aiSignal.target1,
        target2: aiSignal.target2,
        rrRatio: aiSignal.rrRatio,
        smcBias: smcData.overallBias,
        trend: smcData.emaData.trend,
        aiSource: aiSignal.aiSource,
        riskValid: riskData?.isValidSetup,
        summary: aiSignal.summary
      };

      results.push(result);

      // Collect high-confidence signals for Telegram
      if (aiSignal.confidence >= minConfidence &&
          ["BUY","SELL"].includes(aiSignal.signal)) {
        signals.push({ symbol, timeframe, signal: aiSignal, smcData, riskData });
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 800));

    } catch (e) {
      results.push({ symbol: symbol.toUpperCase(), error: e.message });
    }
  }

  // Send scan summary to Telegram
  if (sendToTelegram && telegramToken && telegramChannel && results.length > 0) {
    try {
      const tgBot = new TelegramSignalBot(telegramToken, telegramChannel);
      // Send individual high-confidence signals
      for (const s of signals.slice(0, 5)) {
        await tgBot.sendSignal(s.symbol, s.timeframe, s.signal, s.smcData, s.riskData);
        await new Promise(r => setTimeout(r, 1000));
      }
      // Send summary
      await tgBot.sendScanSummary(results.filter(r => !r.error));
    } catch (e) {
      console.error("Telegram scan error:", e.message);
    }
  }

  res.json({
    success: true,
    scanned: results.length,
    highConfidenceSignals: signals.length,
    results: results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
  });
});

// ── Telegram Test Route ───────────────────────────────────────
app.post("/telegram/test", async (req, res) => {
  const { telegramToken, telegramChannel } = req.body;
  if (!telegramToken || !telegramChannel)
    return res.status(400).json({ error: "telegramToken and telegramChannel required" });

  try {
    const bot = new TelegramSignalBot(telegramToken, telegramChannel);
    const ok = await bot.testConnection();
    res.json({ success: ok, message: ok ? "Telegram connected!" : "Failed" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  AUTO SCAN — Cron Job (every 4 hours on weekdays)
// ═══════════════════════════════════════════════════════════════
const DEFAULT_WATCHLIST = {
  indian: ["RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","SBIN","NIFTY","BANKNIFTY"],
  forex:  ["EURUSD=X","GBPUSD=X","XAUUSD"],
  crypto: ["BTC-USD","ETH-USD","SOL-USD"]
};

// Auto-scan every 4 hours (Mon-Fri) at market hours
cron.schedule("0 9,13,17,21 * * 1-5", async () => {
  const claudeKey   = process.env.CLAUDE_API_KEY;
  const geminiKey   = process.env.GEMINI_API_KEY;
  const tgToken     = process.env.TELEGRAM_TOKEN;
  const tgChannel   = process.env.TELEGRAM_CHANNEL;

  if (!claudeKey && !geminiKey) return;
  if (!tgToken || !tgChannel)   return;

  console.log("🔄 Auto scan starting...");

  const allSymbols = [
    ...DEFAULT_WATCHLIST.indian,
    ...DEFAULT_WATCHLIST.crypto
  ];

  try {
    const tgBot = new TelegramSignalBot(tgToken, tgChannel);
    const results = [];

    for (const symbol of allSymbols) {
      try {
        const marketData = await fetchMarketData(symbol, "4h");
        const smcData    = SMCEngine.fullAnalysis(marketData);
        const aiSignal   = await AIEngine.analyze({
          symbol, timeframe: "4h", smcData, claudeKey, geminiKey
        });

        results.push({
          symbol, signal: aiSignal.signal,
          confidence: aiSignal.confidence,
          entry: aiSignal.entry,
          stopLoss: aiSignal.stopLoss,
          target1: aiSignal.target1
        });

        // Send high confidence signals immediately
        if (aiSignal.confidence >= 70 && ["BUY","SELL"].includes(aiSignal.signal)) {
          const riskData = SMCEngine.calcRiskManagement(
            parseFloat(aiSignal.entry) || smcData.suggestedEntry,
            parseFloat(aiSignal.stopLoss) || smcData.suggestedSL,
            parseFloat(aiSignal.target1) || smcData.suggestedTarget,
            10000, 1
          );
          await tgBot.sendSignal(symbol, "4h", aiSignal, smcData, riskData);
        }

        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.error(`Auto scan error for ${symbol}:`, e.message);
      }
    }

    // Send summary
    await tgBot.sendScanSummary(results);
    console.log(`✅ Auto scan complete. ${results.length} symbols scanned.`);
  } catch (e) {
    console.error("Auto scan failed:", e.message);
  }
});

app.listen(PORT, () => {
  console.log(`
🚀 TradeSignal AI — SMC Server v3.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Port: ${PORT}
✅ SMC Engine: BOS | CHoCH | OB | Liquidity | FVG | SL Hunts
✅ EMA: 5 | 10 | 20 | 50
✅ Markets: Indian + Forex + Crypto + Commodities
✅ AI: Claude (primary) + Gemini (backup)
✅ Telegram: Signal Bot Ready
✅ Auto Scan: Every 4H (Mon-Fri)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});
