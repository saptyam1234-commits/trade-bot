// ═══════════════════════════════════════════════════════════════
//  BINANCE WEBSOCKET ENGINE — Real-time Crypto Data
//  100% FREE — No API key needed
//  Supports: BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX, etc.
// ═══════════════════════════════════════════════════════════════

const https = require("https");
const { EventEmitter } = require("events");

// Try to load ws, fallback gracefully
let WebSocket;
try { WebSocket = require("ws"); } catch { WebSocket = null; }

class BinanceEngine extends EventEmitter {
  constructor() {
    super();
    this.candles    = {};   // symbol+tf → OHLCV array
    this.ticker     = {};   // symbol → live price
    this.sockets    = {};   // active WS connections
    this.ready      = {};   // symbol+tf → bool
  }

  // ── Symbol normalizer ────────────────────────────────────────
  toBinanceSymbol(symbol) {
    const s = symbol.toUpperCase().replace("-", "").replace("_", "");
    if (s.endsWith("USDT") || s.endsWith("USD")) return s.replace("USD","USDT");
    const bases = ["BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX",
                   "DOT","MATIC","LTC","LINK","UNI","ATOM","FIL","NEAR",
                   "APT","ARB","OP","SUI","TON","PEPE","SHIB","WIF"];
    if (bases.includes(s)) return s + "USDT";
    return s.includes("USDT") ? s : s + "USDT";
  }

  // ── Timeframe map ────────────────────────────────────────────
  toBinanceTf(tf) {
    const map = { "5m":"5m","15m":"15m","1h":"1h","4h":"4h","1d":"1d","1w":"1w" };
    return map[tf] || "1h";
  }

  // ── Fetch historical klines via REST ─────────────────────────
  fetchKlines(symbol, tf, limit = 200) {
    return new Promise((resolve, reject) => {
      const bSym = this.toBinanceSymbol(symbol);
      const bTf  = this.toBinanceTf(tf);
      const path = `/api/v3/klines?symbol=${bSym}&interval=${bTf}&limit=${limit}`;

      const options = {
        hostname: "api.binance.com",
        path, method: "GET",
        headers: { "User-Agent": "TradeSignalAI/3.0" }
      };

      const req = https.request(options, res => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const raw = JSON.parse(data);
            if (!Array.isArray(raw)) {
              return reject(new Error(`Binance error: ${JSON.stringify(raw)}`));
            }
            // Binance kline: [openTime, open, high, low, close, volume, ...]
            const candles = raw.map(k => ({
              time:   k[0],
              open:   parseFloat(k[1]),
              high:   parseFloat(k[2]),
              low:    parseFloat(k[3]),
              close:  parseFloat(k[4]),
              volume: parseFloat(k[5]),
            }));
            resolve(candles);
          } catch(e) { reject(e); }
        });
      });
      req.on("error", reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error("Binance timeout")); });
      req.end();
    });
  }

  // ── Live WebSocket stream for 1 symbol+tf ───────────────────
  subscribeStream(symbol, tf) {
    if (!WebSocket) return; // ws not installed, REST-only mode
    const key    = `${symbol}_${tf}`;
    const bSym   = this.toBinanceSymbol(symbol).toLowerCase();
    const bTf    = this.toBinanceTf(tf);
    const stream = `${bSym}@kline_${bTf}`;
    const wsUrl  = `wss://stream.binance.com:9443/ws/${stream}`;

    if (this.sockets[key]) return; // already subscribed

    const ws = new WebSocket(wsUrl);
    this.sockets[key] = ws;

    ws.on("open", () => {
      console.log(`✅ Binance WS connected: ${stream}`);
    });

    ws.on("message", raw => {
      try {
        const msg = JSON.parse(raw);
        const k   = msg.k;
        if (!k) return;

        const candle = {
          time:   k.t,
          open:   parseFloat(k.o),
          high:   parseFloat(k.h),
          low:    parseFloat(k.l),
          close:  parseFloat(k.c),
          volume: parseFloat(k.v),
          closed: k.x,   // true = candle closed
        };

        // Update live ticker
        this.ticker[symbol] = candle.close;

        // Update candle array
        if (this.candles[key]?.length > 0) {
          const arr = this.candles[key];
          if (arr[arr.length-1].time === candle.time) {
            arr[arr.length-1] = candle; // update current candle
          } else if (candle.closed) {
            arr.push(candle);
            if (arr.length > 500) arr.shift(); // keep last 500
          }
        }

        // Emit live update
        this.emit("candle", { symbol, tf, candle, livePrice: candle.close });

        // Emit on candle close for analysis trigger
        if (candle.closed) {
          this.emit("candleClose", { symbol, tf, candles: this.candles[key] });
        }
      } catch {}
    });

    ws.on("error", err => {
      console.error(`Binance WS error [${key}]:`, err.message);
    });

    ws.on("close", () => {
      console.warn(`Binance WS closed [${key}] — reconnecting in 5s`);
      delete this.sockets[key];
      setTimeout(() => this.subscribeStream(symbol, tf), 5000);
    });
  }

  // ── Get OHLCV data for analysis ──────────────────────────────
  async getOHLCV(symbol, tf) {
    const key = `${symbol}_${tf}`;

    // If we have cached candles (from WS), return them
    if (this.candles[key]?.length >= 50) {
      const arr = this.candles[key];
      return {
        opens:   arr.map(c => c.open),
        highs:   arr.map(c => c.high),
        lows:    arr.map(c => c.low),
        closes:  arr.map(c => c.close),
        volumes: arr.map(c => c.volume),
        livePrice: this.ticker[symbol] || arr[arr.length-1].close,
        source: "binance_ws"
      };
    }

    // Fetch via REST
    console.log(`Fetching Binance REST: ${symbol} ${tf}`);
    const candles = await this.fetchKlines(symbol, tf, 300);
    this.candles[key] = candles;
    this.ticker[symbol] = candles[candles.length-1].close;

    // Start WS subscription for future live updates
    this.subscribeStream(symbol, tf);

    return {
      opens:   candles.map(c => c.open),
      highs:   candles.map(c => c.high),
      lows:    candles.map(c => c.low),
      closes:  candles.map(c => c.close),
      volumes: candles.map(c => c.volume),
      livePrice: candles[candles.length-1].close,
      source: "binance_rest"
    };
  }

  // ── Live price ───────────────────────────────────────────────
  getLivePrice(symbol) {
    return this.ticker[symbol] || null;
  }

  // ── Close all WS connections ─────────────────────────────────
  closeAll() {
    Object.values(this.sockets).forEach(ws => ws.close());
    this.sockets = {};
  }
}

// Singleton
const binanceEngine = new BinanceEngine();
module.exports = binanceEngine;
