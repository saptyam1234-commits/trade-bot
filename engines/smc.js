// ═══════════════════════════════════════════════════════════════
//  SMC ENGINE — Smart Money Concepts
//  BOS | CHoCH | HH/HL/LL/LH | OB | Liquidity | FVG | SL Hunts
//  EMA: 5 | 10 | 20 | 30
//  Timeframes: 1H | 4H | 1D (Higher Timeframe Focus)
// ═══════════════════════════════════════════════════════════════

class SMCEngine {

  // ── EMA Calculator ──────────────────────────────────────────
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
      ema30: this.calcEMA(closes, 30),   // Fixed: 30 instead of 50
    };
  }

  // ── EMA Trend Structure ──────────────────────────────────────
  static emaStructure(closes) {
    const { ema5, ema10, ema20, ema30 } = this.calcAllEMAs(closes);
    const price = closes[closes.length - 1];

    // Bullish stack: price > ema5 > ema10 > ema20 > ema30
    const bullishStack  = ema5 > ema10 && ema10 > ema20 && ema20 > ema30;
    const bearishStack  = ema5 < ema10 && ema10 < ema20 && ema20 < ema30;
    const priceAboveAll = price > ema5  && price > ema20 && price > ema30;
    const priceBelowAll = price < ema5  && price < ema20 && price < ema30;

    // EMA dynamic support/resistance
    const priceNearEma20 = Math.abs(price - ema20) / price < 0.005; // within 0.5%
    const priceNearEma30 = Math.abs(price - ema30) / price < 0.005;

    let trend = "SIDEWAYS";
    let strength = 0;
    if (bullishStack && priceAboveAll)  { trend = "STRONG_BULLISH"; strength = 90; }
    else if (bullishStack)              { trend = "BULLISH";         strength = 70; }
    else if (bearishStack && priceBelowAll) { trend = "STRONG_BEARISH"; strength = 90; }
    else if (bearishStack)              { trend = "BEARISH";         strength = 70; }
    else                                { trend = "SIDEWAYS";        strength = 40; }

    return {
      ema5, ema10, ema20, ema30,
      trend, strength,
      priceNearEma20, priceNearEma30,
      dynamicSupport: Math.min(ema20, ema30),
      dynamicResistance: Math.max(ema20, ema30),
    };
  }

  // ── HH / HL / LL / LH Detection ──────────────────────────────
  static detectMarketStructure(highs, lows, closes, lookback = 5) {
    const { swingHighs, swingLows } = this.findSwings(highs, lows, lookback);

    const structure = [];
    let trend = "UNDEFINED";

    // Need at least 3 swings to determine structure
    if (swingHighs.length >= 2 && swingLows.length >= 2) {
      const sh1 = swingHighs[swingHighs.length - 2]; // previous swing high
      const sh2 = swingHighs[swingHighs.length - 1]; // latest swing high
      const sl1 = swingLows[swingLows.length - 2];   // previous swing low
      const sl2 = swingLows[swingLows.length - 1];   // latest swing low

      // HH — Higher High
      if (sh2.price > sh1.price) {
        structure.push({
          type: "HH",
          label: "Higher High",
          level: parseFloat(sh2.price.toFixed(2)),
          prev:  parseFloat(sh1.price.toFixed(2)),
          description: `HH at ${sh2.price.toFixed(2)} (prev: ${sh1.price.toFixed(2)}) — Bullish continuation`
        });
      }
      // LH — Lower High (bearish warning in uptrend)
      else if (sh2.price < sh1.price) {
        structure.push({
          type: "LH",
          label: "Lower High",
          level: parseFloat(sh2.price.toFixed(2)),
          prev:  parseFloat(sh1.price.toFixed(2)),
          description: `LH at ${sh2.price.toFixed(2)} (prev: ${sh1.price.toFixed(2)}) — Bearish pressure / CHoCH warning`
        });
      }

      // HL — Higher Low
      if (sl2.price > sl1.price) {
        structure.push({
          type: "HL",
          label: "Higher Low",
          level: parseFloat(sl2.price.toFixed(2)),
          prev:  parseFloat(sl1.price.toFixed(2)),
          description: `HL at ${sl2.price.toFixed(2)} (prev: ${sl1.price.toFixed(2)}) — Strong bullish structure`
        });
      }
      // LL — Lower Low
      else if (sl2.price < sl1.price) {
        structure.push({
          type: "LL",
          label: "Lower Low",
          level: parseFloat(sl2.price.toFixed(2)),
          prev:  parseFloat(sl1.price.toFixed(2)),
          description: `LL at ${sl2.price.toFixed(2)} (prev: ${sl1.price.toFixed(2)}) — Bearish continuation`
        });
      }

      // Determine overall market structure trend
      const hasHH = structure.some(s => s.type === "HH");
      const hasHL = structure.some(s => s.type === "HL");
      const hasLL = structure.some(s => s.type === "LL");
      const hasLH = structure.some(s => s.type === "LH");

      if (hasHH && hasHL)      trend = "UPTREND";       // HH + HL = Strong uptrend
      else if (hasLL && hasLH) trend = "DOWNTREND";     // LL + LH = Strong downtrend
      else if (hasHH && hasLH) trend = "DISTRIBUTION";  // HH + LH = Weakening uptrend
      else if (hasHL && hasLL) trend = "ACCUMULATION";  // HL + LL = Weakening downtrend
      else                     trend = "RANGING";
    }

    // Last 5 swings sequence for display
    const recentSwings = [];
    const allSwings = [
      ...swingHighs.map(s => ({ ...s, swingType: "HIGH" })),
      ...swingLows.map(s =>  ({ ...s, swingType: "LOW"  }))
    ].sort((a, b) => a.index - b.index).slice(-6);

    return { structure, trend, recentSwings: allSwings };
  }

  // ── Swing High/Low Detection ─────────────────────────────────
  static findSwings(highs, lows, lookback = 5) {
    const swingHighs = [];
    const swingLows = [];

    for (let i = lookback; i < highs.length - lookback; i++) {
      // Swing High: highest in lookback window
      const windowHighs = highs.slice(i - lookback, i + lookback + 1);
      if (highs[i] === Math.max(...windowHighs)) {
        swingHighs.push({ index: i, price: highs[i] });
      }
      // Swing Low: lowest in lookback window
      const windowLows = lows.slice(i - lookback, i + lookback + 1);
      if (lows[i] === Math.min(...windowLows)) {
        swingLows.push({ index: i, price: lows[i] });
      }
    }
    return { swingHighs, swingLows };
  }

  // ── BOS Detection (Break of Structure) ──────────────────────
  static detectBOS(highs, lows, closes) {
    const { swingHighs, swingLows } = this.findSwings(highs, lows);
    const results = [];
    const currentClose = closes[closes.length - 1];

    if (swingHighs.length >= 2) {
      const lastSwingHigh = swingHighs[swingHighs.length - 1];
      const prevSwingHigh = swingHighs[swingHighs.length - 2];

      // Bullish BOS: current close breaks above last swing high
      if (currentClose > lastSwingHigh.price && lastSwingHigh.price > prevSwingHigh.price) {
        results.push({
          type: "BOS_BULLISH",
          level: lastSwingHigh.price,
          description: `Bullish BOS — Price broke above swing high ${lastSwingHigh.price.toFixed(2)}`,
          strength: "HIGH"
        });
      }
    }

    if (swingLows.length >= 2) {
      const lastSwingLow = swingLows[swingLows.length - 1];
      const prevSwingLow = swingLows[swingLows.length - 2];

      // Bearish BOS: current close breaks below last swing low
      if (currentClose < lastSwingLow.price && lastSwingLow.price < prevSwingLow.price) {
        results.push({
          type: "BOS_BEARISH",
          level: lastSwingLow.price,
          description: `Bearish BOS — Price broke below swing low ${lastSwingLow.price.toFixed(2)}`,
          strength: "HIGH"
        });
      }
    }

    return results;
  }

  // ── CHoCH Detection (Change of Character) ───────────────────
  static detectCHoCH(highs, lows, closes) {
    const { swingHighs, swingLows } = this.findSwings(highs, lows);
    const results = [];
    const currentClose = closes[closes.length - 1];

    // Bullish CHoCH: In a downtrend, price breaks above previous swing high
    if (swingHighs.length >= 1 && swingLows.length >= 2) {
      const lastSwingHigh = swingHighs[swingHighs.length - 1];
      const lastLow = swingLows[swingLows.length - 1];
      const prevLow = swingLows[swingLows.length - 2];

      // Was making lower lows, now breaks swing high = CHoCH bullish
      if (lastLow.price < prevLow.price && currentClose > lastSwingHigh.price) {
        results.push({
          type: "CHOCH_BULLISH",
          level: lastSwingHigh.price,
          description: `Bullish CHoCH — Trend reversal signal! Lower lows stopped, broke ${lastSwingHigh.price.toFixed(2)}`,
          strength: "VERY_HIGH"
        });
      }
    }

    // Bearish CHoCH: In uptrend, price breaks below previous swing low
    if (swingLows.length >= 1 && swingHighs.length >= 2) {
      const lastSwingLow = swingLows[swingLows.length - 1];
      const lastHigh = swingHighs[swingHighs.length - 1];
      const prevHigh = swingHighs[swingHighs.length - 2];

      // Was making higher highs, now breaks swing low = CHoCH bearish
      if (lastHigh.price > prevHigh.price && currentClose < lastSwingLow.price) {
        results.push({
          type: "CHOCH_BEARISH",
          level: lastSwingLow.price,
          description: `Bearish CHoCH — Trend reversal! Higher highs stopped, broke ${lastSwingLow.price.toFixed(2)}`,
          strength: "VERY_HIGH"
        });
      }
    }

    return results;
  }

  // ── Order Block Detection ────────────────────────────────────
  static detectOrderBlocks(opens, highs, lows, closes, volumes) {
    const obs = [];
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

    for (let i = 3; i < closes.length - 2; i++) {
      const isStrongCandle = Math.abs(closes[i] - opens[i]) > Math.abs(closes[i-1] - opens[i-1]) * 1.5;
      const isHighVol = volumes[i] > avgVol * 1.3;

      // Bullish OB: Last bearish candle before strong bullish move
      if (closes[i] < opens[i] &&           // bearish candle
          closes[i+1] > opens[i+1] &&       // followed by bullish
          closes[i+2] > closes[i+1] &&      // continuation
          isHighVol) {
        obs.push({
          type: "OB_BULLISH",
          top: opens[i],      // top of bearish candle = OB top
          bottom: closes[i],  // bottom of bearish candle = OB bottom
          index: i,
          description: `Bullish OB at ${closes[i].toFixed(2)}–${opens[i].toFixed(2)}`,
          strength: isStrongCandle ? "STRONG" : "NORMAL"
        });
      }

      // Bearish OB: Last bullish candle before strong bearish move
      if (closes[i] > opens[i] &&           // bullish candle
          closes[i+1] < opens[i+1] &&       // followed by bearish
          closes[i+2] < closes[i+1] &&      // continuation
          isHighVol) {
        obs.push({
          type: "OB_BEARISH",
          top: closes[i],     // top of bullish candle
          bottom: opens[i],   // bottom of bullish candle
          index: i,
          description: `Bearish OB at ${opens[i].toFixed(2)}–${closes[i].toFixed(2)}`,
          strength: isStrongCandle ? "STRONG" : "NORMAL"
        });
      }
    }

    // Return last 3 most recent OBs
    return obs.slice(-3);
  }

  // ── Liquidity Sweep Detection ────────────────────────────────
  static detectLiquiditySweep(highs, lows, closes) {
    const sweeps = [];
    const { swingHighs, swingLows } = this.findSwings(highs, lows);
    const lookback = 5;

    for (let i = lookback; i < closes.length; i++) {
      // Sell-side liquidity sweep: Price dips below swing low then closes above
      for (const sl of swingLows) {
        if (sl.index < i - 1 &&
            lows[i] < sl.price &&       // wick below swing low
            closes[i] > sl.price) {     // but close above = sweep
          sweeps.push({
            type: "SWEEP_SELLSIDE",
            level: sl.price,
            index: i,
            description: `Sell-side liquidity swept at ${sl.price.toFixed(2)} — Possible LONG setup`,
            bias: "BULLISH"
          });
        }
      }

      // Buy-side liquidity sweep: Price spikes above swing high then closes below
      for (const sh of swingHighs) {
        if (sh.index < i - 1 &&
            highs[i] > sh.price &&      // wick above swing high
            closes[i] < sh.price) {     // but close below = sweep
          sweeps.push({
            type: "SWEEP_BUYSIDE",
            level: sh.price,
            index: i,
            description: `Buy-side liquidity swept at ${sh.price.toFixed(2)} — Possible SHORT setup`,
            bias: "BEARISH"
          });
        }
      }
    }

    return sweeps.slice(-3);
  }

  // ── Fair Value Gap (FVG) Detection ───────────────────────────
  static detectFVG(highs, lows) {
    const fvgs = [];

    for (let i = 1; i < lows.length - 1; i++) {
      // Bullish FVG: Gap between candle[i-1] high and candle[i+1] low
      if (lows[i+1] > highs[i-1]) {
        fvgs.push({
          type: "FVG_BULLISH",
          top: lows[i+1],
          bottom: highs[i-1],
          midpoint: (lows[i+1] + highs[i-1]) / 2,
          index: i,
          description: `Bullish FVG: ${highs[i-1].toFixed(2)}–${lows[i+1].toFixed(2)}`
        });
      }

      // Bearish FVG: Gap between candle[i+1] high and candle[i-1] low
      if (highs[i+1] < lows[i-1]) {
        fvgs.push({
          type: "FVG_BEARISH",
          top: lows[i-1],
          bottom: highs[i+1],
          midpoint: (lows[i-1] + highs[i+1]) / 2,
          index: i,
          description: `Bearish FVG: ${highs[i+1].toFixed(2)}–${lows[i-1].toFixed(2)}`
        });
      }
    }

    return fvgs.slice(-4);
  }

  // ── SL Hunt / Stop Hunt Detection ───────────────────────────
  static detectSLHunt(highs, lows, closes, opens) {
    const hunts = [];

    for (let i = 2; i < closes.length; i++) {
      const bodySize = Math.abs(closes[i] - opens[i]);
      const upperWick = highs[i] - Math.max(closes[i], opens[i]);
      const lowerWick = Math.min(closes[i], opens[i]) - lows[i];

      // Bearish SL hunt: Long upper wick (hunted buy stops above)
      if (upperWick > bodySize * 2 && upperWick > lowerWick * 2) {
        hunts.push({
          type: "SL_HUNT_BEARISH",
          level: highs[i],
          index: i,
          description: `Stop hunt detected at ${highs[i].toFixed(2)} — Buy-stops hunted, reversal likely`,
          bias: "BEARISH"
        });
      }

      // Bullish SL hunt: Long lower wick (hunted sell stops below)
      if (lowerWick > bodySize * 2 && lowerWick > upperWick * 2) {
        hunts.push({
          type: "SL_HUNT_BULLISH",
          level: lows[i],
          index: i,
          description: `Stop hunt detected at ${lows[i].toFixed(2)} — Sell-stops hunted, reversal likely`,
          bias: "BULLISH"
        });
      }
    }

    return hunts.slice(-3);
  }

  // ── Volume Analysis ──────────────────────────────────────────
  static analyzeVolume(volumes, closes) {
    const avg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const avg5  = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const current = volumes[volumes.length - 1];
    const ratio = (current / avg20).toFixed(2);

    // Climax volume check
    const maxVol = Math.max(...volumes.slice(-50));
    const isClimax = current > maxVol * 0.9;

    // Rising volume with rising price = bullish confirmation
    const priceUp = closes[closes.length - 1] > closes[closes.length - 6];
    const volRising = avg5 > avg20;

    let volumeSignal = "NORMAL";
    if (isClimax && priceUp) volumeSignal = "BUYING_CLIMAX";
    else if (isClimax && !priceUp) volumeSignal = "SELLING_CLIMAX";
    else if (volRising && priceUp) volumeSignal = "BULLISH_VOLUME";
    else if (volRising && !priceUp) volumeSignal = "BEARISH_VOLUME";
    else if (current < avg20 * 0.5) volumeSignal = "LOW_VOLUME_CAUTION";

    return { current, avg20: Math.round(avg20), ratio, volumeSignal, isClimax };
  }

  // ── Key Levels (Support/Resistance) ─────────────────────────
  static findKeyLevels(highs, lows, closes) {
    const { swingHighs, swingLows } = this.findSwings(highs, lows);
    const currentPrice = closes[closes.length - 1];

    // Find nearest levels above and below current price
    const resistanceLevels = swingHighs
      .filter(s => s.price > currentPrice)
      .sort((a, b) => a.price - b.price)
      .slice(0, 3)
      .map(s => s.price);

    const supportLevels = swingLows
      .filter(s => s.price < currentPrice)
      .sort((a, b) => b.price - a.price)
      .slice(0, 3)
      .map(s => s.price);

    const immediateResistance = resistanceLevels[0] || currentPrice * 1.02;
    const immediateSupport = supportLevels[0] || currentPrice * 0.98;

    return {
      immediateResistance: parseFloat(immediateResistance.toFixed(2)),
      immediateSupport: parseFloat(immediateSupport.toFixed(2)),
      resistanceLevels: resistanceLevels.map(p => parseFloat(p.toFixed(2))),
      supportLevels: supportLevels.map(p => parseFloat(p.toFixed(2)))
    };
  }

  // ── Risk Management Calculator ───────────────────────────────
  static calcRiskManagement(entryPrice, stopLoss, targetPrice, accountSize, riskPercent = 1) {
    const riskAmount = accountSize * (riskPercent / 100);
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    const rewardPerUnit = Math.abs(targetPrice - entryPrice);

    if (riskPerUnit === 0) return null;

    const positionSize = riskAmount / riskPerUnit;
    const rrRatio = (rewardPerUnit / riskPerUnit).toFixed(2);
    const maxLoss = riskAmount;
    const potentialProfit = positionSize * rewardPerUnit;

    return {
      positionSize: parseFloat(positionSize.toFixed(2)),
      riskAmount: parseFloat(riskAmount.toFixed(2)),
      potentialProfit: parseFloat(potentialProfit.toFixed(2)),
      rrRatio: parseFloat(rrRatio),
      riskPercent,
      isValidSetup: parseFloat(rrRatio) >= 2.0  // Minimum 1:2 RR
    };
  }

  // ── MASTER ANALYSIS — Full SMC Report ───────────────────────
  static fullAnalysis(data) {
    const { opens, highs, lows, closes, volumes } = data;

    const emaData        = this.emaStructure(closes);
    const marketStructure = this.detectMarketStructure(highs, lows, closes);
    const bos            = this.detectBOS(highs, lows, closes);
    const choch          = this.detectCHoCH(highs, lows, closes);
    const orderBlocks    = this.detectOrderBlocks(opens, highs, lows, closes, volumes);
    const liquidity      = this.detectLiquiditySweep(highs, lows, closes);
    const fvg            = this.detectFVG(highs, lows);
    const slHunts        = this.detectSLHunt(highs, lows, closes, opens);
    const volumeData     = this.analyzeVolume(volumes, closes);
    const keyLevels      = this.findKeyLevels(highs, lows, closes);

    const currentPrice = closes[closes.length - 1];

    // ── Bias Score ─────────────────────────────────────────────
    let bullScore = 0;
    let bearScore = 0;

    // EMA contribution
    if (emaData.trend === "STRONG_BULLISH") bullScore += 25;
    else if (emaData.trend === "BULLISH")   bullScore += 15;
    else if (emaData.trend === "STRONG_BEARISH") bearScore += 25;
    else if (emaData.trend === "BEARISH")   bearScore += 15;

    // HH/HL/LL/LH contribution — market structure is KEY
    const ms = marketStructure.structure;
    ms.forEach(s => {
      if (s.type === "HH") bullScore += 15;  // Higher High = bullish
      if (s.type === "HL") bullScore += 20;  // Higher Low = STRONG bullish (entry zone)
      if (s.type === "LL") bearScore += 15;  // Lower Low = bearish
      if (s.type === "LH") bearScore += 20;  // Lower High = STRONG bearish (entry zone)
    });

    // Market structure trend
    if (marketStructure.trend === "UPTREND")      bullScore += 15;
    if (marketStructure.trend === "DOWNTREND")    bearScore += 15;
    if (marketStructure.trend === "ACCUMULATION") bullScore += 8;
    if (marketStructure.trend === "DISTRIBUTION") bearScore += 8;

    // BOS/CHoCH
    bos.forEach(b   => b.type === "BOS_BULLISH"   ? bullScore += 15 : bearScore += 15);
    choch.forEach(c => c.type === "CHOCH_BULLISH"  ? bullScore += 20 : bearScore += 20);

    // Liquidity sweeps
    liquidity.forEach(l => l.bias === "BULLISH" ? bullScore += 12 : bearScore += 12);

    // SL Hunts
    slHunts.forEach(s => s.bias === "BULLISH" ? bullScore += 8 : bearScore += 8);

    // Volume
    if (volumeData.volumeSignal === "BULLISH_VOLUME") bullScore += 8;
    if (volumeData.volumeSignal === "BEARISH_VOLUME") bearScore += 8;

    const totalScore  = bullScore + bearScore || 1;
    const overallBias = bullScore > bearScore ? "BULLISH" : bearScore > bullScore ? "BEARISH" : "NEUTRAL";
    const confidence  = Math.round(Math.max(bullScore, bearScore) / totalScore * 100);

    // ── Suggested Levels (HTF focused) ────────────────────────
    let suggestedEntry, suggestedSL, suggestedTarget;

    // Use HL level as entry for longs, LH level as entry for shorts
    const hlLevel = ms.find(s => s.type === "HL");
    const lhLevel = ms.find(s => s.type === "LH");

    if (overallBias === "BULLISH") {
      const bullOB   = orderBlocks.filter(o => o.type === "OB_BULLISH").slice(-1)[0];
      // Best entry: at HL or Bullish OB or EMA20/30 support
      suggestedEntry  = hlLevel ? hlLevel.level : bullOB ? bullOB.bottom : emaData.dynamicSupport;
      suggestedSL     = keyLevels.immediateSupport * 0.995;
      suggestedTarget = keyLevels.immediateResistance;
    } else if (overallBias === "BEARISH") {
      const bearOB   = orderBlocks.filter(o => o.type === "OB_BEARISH").slice(-1)[0];
      // Best entry: at LH or Bearish OB or EMA20/30 resistance
      suggestedEntry  = lhLevel ? lhLevel.level : bearOB ? bearOB.top : emaData.dynamicResistance;
      suggestedSL     = keyLevels.immediateResistance * 1.005;
      suggestedTarget = keyLevels.immediateSupport;
    } else {
      suggestedEntry  = currentPrice;
      suggestedSL     = currentPrice * 0.99;
      suggestedTarget = currentPrice * 1.02;
    }

    return {
      currentPrice,
      overallBias,
      confidence,
      emaData,
      marketStructure,   // NEW: HH/HL/LL/LH
      bos,
      choch,
      orderBlocks,
      liquidity,
      fvg,
      slHunts,
      volumeData,
      keyLevels,
      suggestedEntry:  parseFloat((suggestedEntry  || currentPrice).toFixed(2)),
      suggestedSL:     parseFloat((suggestedSL     || currentPrice * 0.99).toFixed(2)),
      suggestedTarget: parseFloat((suggestedTarget || currentPrice * 1.02).toFixed(2)),
    };
  }
}

module.exports = SMCEngine;
