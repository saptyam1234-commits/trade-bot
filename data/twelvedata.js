// ═══════════════════════════════════════════════════════════════
//  TWELVE DATA ENGINE — Forex, Gold, Commodities
//  FREE tier: 800 req/day, 8 req/min
//  Perfect for: 1H, 4H, 1D timeframes
//  Symbols: EURUSD, GBPUSD, XAUUSD, USDJPY, etc.
// ═══════════════════════════════════════════════════════════════

const https = require("https");

class TwelveDataEngine {
  constructor(apiKey) {
    this.apiKey   = apiKey;
    this.cache    = {};       // symbol+tf → { data, timestamp }
    this.cacheTTL = 60000;    // 1 min cache to save API quota
  }

  // ── Timeframe map ────────────────────────────────────────────
  toTwelveTf(tf) {
    const map = { "5m":"5min","15m":"15min","1h":"1h","4h":"4h","1d":"1day","1w":"1week" };
    return map[tf] || "1h";
  }

  // ── Symbol normalizer for Twelve Data ────────────────────────
  normalizeSymbol(symbol) {
    const s = symbol.toUpperCase().replace("=X","").replace("/","");

    // Gold/Silver/Oil
    if (s === "XAUUSD" || s === "GOLD")   return "XAU/USD";
    if (s === "XAGUSD" || s === "SILVER") return "XAG/USD";
    if (s === "USOIL"  || s === "CL=F")   return "WTI/USD";

    // Forex pairs — add slash
    const forexBases = ["EUR","GBP","AUD","NZD","CAD","CHF","JPY","SGD","HKD","NOK","SEK"];
    for (const base of forexBases) {
      if (s.startsWith(base) && s.length >= 6) {
        return `${s.slice(0,3)}/${s.slice(3,6)}`;
      }
    }

    // Indices
    if (s === "SPX" || s === "SP500") return "SPX";
    if (s === "NDX" || s === "NASDAQ") return "NDX";
    if (s === "DJI" || s === "DOW")   return "DJI";

    return s;
  }

  // ── HTTP request helper ───────────────────────────────────────
  httpGet(path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: "api.twelvedata.com",
        path, method: "GET",
        headers: { "User-Agent": "TradeSignalAI/3.0" }
      };
      const req = https.request(options, res => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error("JSON parse error")); }
        });
      });
      req.on("error", reject);
      req.setTimeout(12000, () => { req.destroy(); reject(new Error("Twelve Data timeout")); });
      req.end();
    });
  }

  // ── Fetch OHLCV time series ───────────────────────────────────
  async getOHLCV(symbol, tf, outputSize = 300) {
    const cacheKey = `${symbol}_${tf}`;
    const now = Date.now();

    // Return cached if fresh
    if (this.cache[cacheKey] && (now - this.cache[cacheKey].timestamp) < this.cacheTTL) {
      return { ...this.cache[cacheKey].data, source: "twelve_cache" };
    }

    if (!this.apiKey) throw new Error("Twelve Data API key not configured");

    const sym   = this.normalizeSymbol(symbol);
    const twTf  = this.toTwelveTf(tf);
    const path  = `/time_series?symbol=${encodeURIComponent(sym)}&interval=${twTf}&outputsize=${outputSize}&apikey=${this.apiKey}&format=JSON`;

    const json = await this.httpGet(path);

    if (json.status === "error" || !json.values) {
      throw new Error(`Twelve Data error for ${symbol}: ${json.message || "No data"}`);
    }

    // Twelve Data returns newest first — reverse
    const values = [...json.values].reverse();

    const opens   = values.map(v => parseFloat(v.open));
    const highs   = values.map(v => parseFloat(v.high));
    const lows    = values.map(v => parseFloat(v.low));
    const closes  = values.map(v => parseFloat(v.close));
    const volumes = values.map(v => parseFloat(v.volume || 0));
    const timestamps = values.map(v => v.datetime);

    const result = {
      opens, highs, lows, closes, volumes, timestamps,
      livePrice: closes[closes.length - 1],
      source: "twelve_data"
    };

    // Cache it
    this.cache[cacheKey] = { data: result, timestamp: now };
    return result;
  }

  // ── Get live quote (single price) ────────────────────────────
  async getLivePrice(symbol) {
    const cacheKey = `price_${symbol}`;
    const now = Date.now();
    if (this.cache[cacheKey] && (now - this.cache[cacheKey].timestamp) < 30000) {
      return this.cache[cacheKey].price;
    }

    const sym  = this.normalizeSymbol(symbol);
    const path = `/price?symbol=${encodeURIComponent(sym)}&apikey=${this.apiKey}`;
    const json = await this.httpGet(path);

    if (json.price) {
      const price = parseFloat(json.price);
      this.cache[cacheKey] = { price, timestamp: now };
      return price;
    }
    return null;
  }
}

module.exports = TwelveDataEngine;
