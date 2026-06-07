// ═══════════════════════════════════════════════════════════════
//  EMA ENGINE — Standalone Engine
//  EMA 5 | 10 | 20 | 30
//  Dynamic Support/Resistance
//  EMA Stack Trend Analysis
//  EMA Cross Signals
//  Price vs EMA Position
// ═══════════════════════════════════════════════════════════════

class EMAEngine {

  // ── Core EMA Calculator ──────────────────────────────────────
  static calcEMA(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return parseFloat(ema.toFixed(4));
  }

  // ── All EMAs (5, 10, 20, 30) ─────────────────────────────────
  static calcAllEMAs(closes) {
    return {
      ema5:  this.calcEMA(closes, 5),
      ema10: this.calcEMA(closes, 10),
      ema20: this.calcEMA(closes, 20),
      ema30: this.calcEMA(closes, 30),
    };
  }

  // ── EMA Stack — Trend Direction ──────────────────────────────
  // Bullish Stack: price > ema5 > ema10 > ema20 > ema30
  // Bearish Stack: price < ema5 < ema10 < ema20 < ema30
  static stackAnalysis(closes) {
    const { ema5, ema10, ema20, ema30 } = this.calcAllEMAs(closes);
    const price = closes[closes.length - 1];

    const bullishStack   = ema5 > ema10 && ema10 > ema20 && ema20 > ema30;
    const bearishStack   = ema5 < ema10 && ema10 < ema20 && ema20 < ema30;
    const priceAboveAll  = price > ema5  && price > ema20 && price > ema30;
    const priceBelowAll  = price < ema5  && price < ema20 && price < ema30;

    let trend = "SIDEWAYS";
    let strength = 0;
    if      (bullishStack && priceAboveAll)  { trend = "STRONG_BULLISH"; strength = 90; }
    else if (bullishStack)                   { trend = "BULLISH";         strength = 70; }
    else if (bearishStack && priceBelowAll)  { trend = "STRONG_BEARISH";  strength = 90; }
    else if (bearishStack)                   { trend = "BEARISH";         strength = 70; }
    else                                     { trend = "SIDEWAYS";        strength = 40; }

    return { ema5, ema10, ema20, ema30, trend, strength };
  }

  // ── EMA Cross Detection ──────────────────────────────────────
  // Golden Cross: ema5 crosses above ema20 = bullish signal
  // Death Cross:  ema5 crosses below ema20 = bearish signal
  static detectCross(closes) {
    if (closes.length < 25) return null;

    const crosses = [];

    // Check last 5 candles for crossovers
    for (let i = closes.length - 5; i < closes.length - 1; i++) {
      const prevEma5  = this.calcEMA(closes.slice(0, i),   5);
      const prevEma20 = this.calcEMA(closes.slice(0, i),   20);
      const currEma5  = this.calcEMA(closes.slice(0, i+1), 5);
      const currEma20 = this.calcEMA(closes.slice(0, i+1), 20);

      if (!prevEma5 || !prevEma20 || !currEma5 || !currEma20) continue;

      // Golden Cross: EMA5 crossed above EMA20
      if (prevEma5 < prevEma20 && currEma5 > currEma20) {
        crosses.push({
          type: "GOLDEN_CROSS",
          description: `EMA5 crossed above EMA20 — Bullish momentum`,
          bias: "BULLISH",
          candlesAgo: closes.length - 1 - i
        });
      }

      // Death Cross: EMA5 crossed below EMA20
      if (prevEma5 > prevEma20 && currEma5 < currEma20) {
        crosses.push({
          type: "DEATH_CROSS",
          description: `EMA5 crossed below EMA20 — Bearish momentum`,
          bias: "BEARISH",
          candlesAgo: closes.length - 1 - i
        });
      }

      // Fast cross: EMA5 vs EMA10
      if (prevEma5 < this.calcEMA(closes.slice(0,i),10) &&
          currEma5  > this.calcEMA(closes.slice(0,i+1),10)) {
        crosses.push({
          type: "FAST_CROSS_BULL",
          description: `EMA5 crossed above EMA10 — Short-term bullish`,
          bias: "BULLISH",
          candlesAgo: closes.length - 1 - i
        });
      }
    }

    return crosses.slice(-3);
  }

  // ── Dynamic Support/Resistance from EMAs ────────────────────
  static dynamicLevels(closes) {
    const { ema5, ema10, ema20, ema30 } = this.calcAllEMAs(closes);
    const price = closes[closes.length - 1];

    const levels = [ema5, ema10, ema20, ema30].filter(Boolean);

    // EMAs below price = dynamic support
    const supports    = levels.filter(e => e < price).sort((a,b) => b - a);
    // EMAs above price = dynamic resistance
    const resistances = levels.filter(e => e > price).sort((a,b) => a - b);

    const nearestSupport    = supports[0]    || null;
    const nearestResistance = resistances[0] || null;

    // Price proximity to EMAs (within 0.5% = near)
    const priceNearEma5  = ema5  && Math.abs(price - ema5)  / price < 0.005;
    const priceNearEma10 = ema10 && Math.abs(price - ema10) / price < 0.005;
    const priceNearEma20 = ema20 && Math.abs(price - ema20) / price < 0.005;
    const priceNearEma30 = ema30 && Math.abs(price - ema30) / price < 0.005;

    // Best EMA entry zone
    let entryZone = null;
    if (priceNearEma20) entryZone = { level: ema20, ema: "EMA20", type: "DYNAMIC_SUPPORT" };
    else if (priceNearEma30) entryZone = { level: ema30, ema: "EMA30", type: "DYNAMIC_SUPPORT" };
    else if (priceNearEma10) entryZone = { level: ema10, ema: "EMA10", type: "DYNAMIC_SUPPORT" };

    return {
      dynamicSupport:    nearestSupport    ? parseFloat(nearestSupport.toFixed(2))    : null,
      dynamicResistance: nearestResistance ? parseFloat(nearestResistance.toFixed(2)) : null,
      priceNearEma5,
      priceNearEma10,
      priceNearEma20,
      priceNearEma30,
      entryZone,
      supportLevels:    supports.map(e    => parseFloat(e.toFixed(2))),
      resistanceLevels: resistances.map(e => parseFloat(e.toFixed(2))),
    };
  }

  // ── Price vs EMA Position ────────────────────────────────────
  static pricePosition(closes) {
    const { ema5, ema10, ema20, ema30 } = this.calcAllEMAs(closes);
    const price = closes[closes.length - 1];

    return {
      aboveEma5:  price > ema5,
      aboveEma10: price > ema10,
      aboveEma20: price > ema20,
      aboveEma30: price > ema30,
      // Distance from each EMA in %
      distEma5:  ema5  ? parseFloat(((price - ema5)  / ema5  * 100).toFixed(2)) : null,
      distEma20: ema20 ? parseFloat(((price - ema20) / ema20 * 100).toFixed(2)) : null,
      distEma30: ema30 ? parseFloat(((price - ema30) / ema30 * 100).toFixed(2)) : null,
    };
  }

  // ── MASTER: Full EMA Analysis ────────────────────────────────
  static fullAnalysis(closes) {
    const stack    = this.stackAnalysis(closes);
    const crosses  = this.detectCross(closes);
    const levels   = this.dynamicLevels(closes);
    const position = this.pricePosition(closes);

    // EMA bias score
    let bullScore = 0, bearScore = 0;
    if (stack.trend === "STRONG_BULLISH") bullScore += 30;
    else if (stack.trend === "BULLISH")   bullScore += 20;
    else if (stack.trend === "STRONG_BEARISH") bearScore += 30;
    else if (stack.trend === "BEARISH")   bearScore += 20;

    if (position.aboveEma20 && position.aboveEma30) bullScore += 15;
    if (!position.aboveEma20 && !position.aboveEma30) bearScore += 15;

    crosses?.forEach(c => {
      if (c.bias === "BULLISH") bullScore += 10;
      else bearScore += 10;
    });

    const emaBias = bullScore > bearScore ? "BULLISH"
                  : bearScore > bullScore ? "BEARISH" : "NEUTRAL";

    return {
      // Core values
      ema5:  stack.ema5,
      ema10: stack.ema10,
      ema20: stack.ema20,
      ema30: stack.ema30,

      // Trend
      trend:    stack.trend,
      strength: stack.strength,
      emaBias,

      // Crosses
      crosses,

      // Dynamic levels
      dynamicSupport:    levels.dynamicSupport,
      dynamicResistance: levels.dynamicResistance,
      priceNearEma20:    levels.priceNearEma20,
      priceNearEma30:    levels.priceNearEma30,
      priceNearEma5:     levels.priceNearEma5,
      entryZone:         levels.entryZone,
      supportLevels:     levels.supportLevels,
      resistanceLevels:  levels.resistanceLevels,

      // Position
      position,
    };
  }
}

module.exports = EMAEngine;
