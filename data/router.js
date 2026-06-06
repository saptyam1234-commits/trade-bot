// ═══════════════════════════════════════════════════════════════
//  MASTER DATA ROUTER
//  Routes each symbol to the correct data source:
//
//  Crypto  → Binance WebSocket (real-time, FREE)
//  Forex   → Twelve Data API (FREE 800/day)
//  Gold    → Twelve Data API
//  Indian  → Yahoo Finance (15min delay, FREE)
//  Indices → Yahoo Finance
// ═══════════════════════════════════════════════════════════════

const binanceEngine  = require("./binance");
const TwelveDataEngine = require("./twelvedata");
const yahooFinance   = require("yahoo-finance2").default;

// ── Market classifier ────────────────────────────────────────
const CRYPTO_SYMBOLS = [
  "BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","DOT","MATIC",
  "LTC","LINK","UNI","ATOM","FIL","NEAR","APT","ARB","OP","SUI",
  "TON","PEPE","SHIB","WIF","JUP","BONK","TIA","INJ","SEI","MANTA"
];

const FOREX_SYMBOLS = [
  "EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","USDCHF","NZDUSD",
  "EURJPY","GBPJPY","EURGBP","AUDCAD","CADJPY","CHFJPY","AUDJPY",
  "XAUUSD","XAGUSD","GOLD","SILVER","WTI","USOIL",
  "EUR/USD","GBP/USD","USD/JPY","XAU/USD"
];

const INDEX_SYMBOLS = [
  "NIFTY","NIFTY50","BANKNIFTY","SENSEX","SPX","SP500","NDX","NASDAQ",
  "DJI","DOW","^NSEI","^NSEBANK","^BSESN","^GSPC","^IXIC","^DJI"
];

class DataRouter {
  constructor(twelveDataApiKey) {
    this.twelve = new TwelveDataEngine(twelveDataApiKey || "");
  }

  // ── Classify symbol ──────────────────────────────────────────
  classify(symbol) {
    const s = symbol.toUpperCase()
      .replace("-USD","").replace("USDT","").replace("=X","")
      .replace("/","").replace(".NS","").replace(".BO","");

    if (CRYPTO_SYMBOLS.includes(s) ||
        symbol.toUpperCase().endsWith("-USD") ||
        symbol.toUpperCase().endsWith("USDT")) return "CRYPTO";

    if (FOREX_SYMBOLS.some(f => s.includes(f) || symbol.toUpperCase().includes(f)))
      return "FOREX";

    if (INDEX_SYMBOLS.some(i => s === i || symbol.toUpperCase() === i))
      return "INDEX";

    return "INDIAN";  // Default: Indian stock
  }

  // ── Yahoo Finance fetch ──────────────────────────────────────
  async fetchYahoo(symbol, tf) {
    const tfMap = {
      "5m": { interval:"5m",  range:"5d"  },
      "15m":{ interval:"15m", range:"5d"  },
      "1h": { interval:"60m", range:"1mo" },
      "4h": { interval:"1d",  range:"3mo" },
      "1d": { interval:"1d",  range:"1y"  },
      "1w": { interval:"1wk", range:"2y"  },
    };
    const { interval, range } = tfMap[tf] || tfMap["1d"];

    // Convert symbol for Yahoo
    let ySym = symbol.toUpperCase();
    if (ySym === "NIFTY" || ySym === "NIFTY50") ySym = "^NSEI";
    else if (ySym === "BANKNIFTY")  ySym = "^NSEBANK";
    else if (ySym === "SENSEX")     ySym = "^BSESN";
    else if (!ySym.includes(".") && !ySym.startsWith("^")) ySym += ".NS";

    const result = await yahooFinance.chart(ySym, { interval, range, includePrePost: false });
    const quotes = (result.quotes || []).filter(q => q.open && q.close);

    if (quotes.length < 30) throw new Error(`Not enough data for ${symbol}`);

    return {
      opens:      quotes.map(q => q.open),
      highs:      quotes.map(q => q.high),
      lows:       quotes.map(q => q.low),
      closes:     quotes.map(q => q.close),
      volumes:    quotes.map(q => q.volume || 0),
      timestamps: quotes.map(q => q.date),
      livePrice:  quotes[quotes.length-1].close,
      source:     "yahoo_finance"
    };
  }

  // ── MAIN: Get market data ─────────────────────────────────────
  async getData(symbol, tf) {
    const market = this.classify(symbol);
    let data;

    try {
      switch (market) {
        case "CRYPTO":
          console.log(`📡 Binance WebSocket: ${symbol} ${tf}`);
          data = await binanceEngine.getOHLCV(symbol.replace("-USD","").replace("USDT",""), tf);
          break;

        case "FOREX":
          console.log(`📊 Twelve Data: ${symbol} ${tf}`);
          if (!this.twelve.apiKey) throw new Error("Twelve Data API key not set");
          data = await this.twelve.getOHLCV(symbol, tf);
          break;

        case "INDEX":
        case "INDIAN":
        default:
          console.log(`🏦 Yahoo Finance: ${symbol} ${tf}`);
          data = await this.fetchYahoo(symbol, tf);
          break;
      }
    } catch (err) {
      // Fallback to Yahoo for any failures
      console.warn(`Primary source failed for ${symbol}: ${err.message} → Yahoo fallback`);
      data = await this.fetchYahoo(symbol, tf);
    }

    // Validate minimum data
    if (!data || data.closes?.length < 30) {
      throw new Error(`Insufficient data for ${symbol} on ${tf}. Try a higher timeframe.`);
    }

    return {
      ...data,
      symbol: symbol.toUpperCase(),
      timeframe: tf,
      market,
      fetchedAt: new Date().toISOString()
    };
  }

  // ── Get live price only ──────────────────────────────────────
  async getLivePrice(symbol) {
    const market = this.classify(symbol);
    try {
      if (market === "CRYPTO") {
        const cleanSym = symbol.replace("-USD","").replace("USDT","").toUpperCase();
        return binanceEngine.getLivePrice(cleanSym);
      }
      if (market === "FOREX") {
        return await this.twelve.getLivePrice(symbol);
      }
    } catch {}
    return null;
  }

  // ── Subscribe to live WebSocket (crypto only) ────────────────
  subscribeWebSocket(symbol, tf, onCandle, onClose) {
    const market = this.classify(symbol);
    if (market !== "CRYPTO") return false;

    const cleanSym = symbol.replace("-USD","").replace("USDT","").toUpperCase();
    binanceEngine.subscribeStream(cleanSym, tf);
    if (onCandle) binanceEngine.on("candle", data => {
      if (data.symbol === cleanSym && data.tf === tf) onCandle(data);
    });
    if (onClose) binanceEngine.on("candleClose", data => {
      if (data.symbol === cleanSym && data.tf === tf) onClose(data);
    });
    return true;
  }

  // ── Market info helper ───────────────────────────────────────
  getMarketInfo(symbol) {
    const market = this.classify(symbol);
    return {
      market,
      dataSource: market === "CRYPTO" ? "Binance WebSocket (Real-time)"
                : market === "FOREX"  ? "Twelve Data API (Near real-time)"
                : "Yahoo Finance (15min delay)",
      isRealtime: market === "CRYPTO",
      isNearRealtime: market === "FOREX",
    };
  }
}

module.exports = DataRouter;
