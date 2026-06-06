// ═══════════════════════════════════════════════════════════════
//  TELEGRAM BOT — 2-Layer Signal Delivery
// ═══════════════════════════════════════════════════════════════

const TelegramBot = require("node-telegram-bot-api");

class TelegramSignalBot {
  constructor(token, channelId) {
    if (!token) throw new Error("Telegram bot token required");
    this.bot = new TelegramBot(token, { polling: false });
    this.channelId = channelId;
  }

  formatSignalMessage(symbol, timeframe, decision, smcData, riskData) {
    const verdict = decision.verdict?.toUpperCase() || "WAIT";
    const signal  = decision.signal?.toUpperCase()  || "NEUTRAL";

    const verdictEmoji = verdict === "TAKE" ? "✅" : verdict === "SKIP" ? "❌" : "⏳";
    const signalEmoji  = signal  === "BUY"  ? "🟢" : signal  === "SELL" ? "🔴" : "🟡";
    const qualityEmoji = {
      "A+": "💎", "A": "🥇", "B": "🥈", "C": "🥉", "INVALID": "🚫"
    }[decision.setupQuality] || "📊";

    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const l1  = decision.layer1 || {};
    const ms  = smcData.marketStructure || {};

    let msg = `${verdictEmoji} *${verdict} — ${symbol}* ${signalEmoji}
━━━━━━━━━━━━━━━━━━━━
📊 *Timeframe:* ${timeframe} | *Market:* ${l1.msTrend || "—"}
⏰ *IST:* ${now}
🤖 *AI:* ${decision.aiSource || "Claude"}

${signalEmoji} *SIGNAL: ${signal}*
${verdictEmoji} *VERDICT: ${verdict}* — ${decision.verdictReason || ""}
${qualityEmoji} *Setup Quality: ${decision.setupQuality || "—"}* | Confidence: ${decision.confidence}%
━━━━━━━━━━━━━━━━━━━━
💰 *Price:* ${smcData.currentPrice}

📍 *ENTRY:* \`${decision.entry}\`
🎯 *Target 1:* \`${decision.target1}\`
🎯 *Target 2:* \`${decision.target2}\`
🛑 *Stop Loss:* \`${decision.stopLoss}\`
⚖️ *R:R:* ${decision.rrRatio} | *Confluence:* ${decision.confluenceScore}/10

━━━━━━━━━━━━━━━━━━━━
✅ *WHY ENTER:*
${decision.entryReason || "—"}

⚠️ *RISK WARNING:*
${decision.riskWarning || "—"}

⏰ *BEST TIME TO ENTER:*
${decision.bestTimeToEnter || "—"}

━━━━━━━━━━━━━━━━━━━━
🏦 *SMC STRUCTURE*
📈 HTF Trend: *${ms.trend || "—"}*
`;

    // HH/HL/LL/LH
    const msItems = ms.structure || [];
    if (msItems.length > 0) {
      msItems.forEach(s => {
        const em = s.type==="HH"?"📈":s.type==="HL"?"🟢":s.type==="LL"?"📉":"🔴";
        msg += `${em} *${s.type}* — ${s.level}\n`;
      });
    }

    // EMA Stack
    const ema = smcData.emaData || {};
    msg += `\n📊 EMA: 5=${ema.ema5} | 10=${ema.ema10} | 20=${ema.ema20} | 30=${ema.ema30}\n`;

    // BOS/CHoCH
    if (smcData.bos?.length > 0)   msg += `🔷 *BOS:* ${smcData.bos[0].description}\n`;
    if (smcData.choch?.length > 0)  msg += `🔄 *CHoCH:* ${smcData.choch[0].description}\n`;
    if (smcData.orderBlocks?.length > 0) {
      const ob = smcData.orderBlocks[smcData.orderBlocks.length-1];
      msg += `🧱 *OB:* ${ob.description}\n`;
    }
    if (smcData.liquidity?.length > 0)
      msg += `💧 *Liquidity:* ${smcData.liquidity[smcData.liquidity.length-1].description}\n`;
    if (smcData.fvg?.length > 0)
      msg += `⬜ *FVG:* ${smcData.fvg[smcData.fvg.length-1].description}\n`;
    if (smcData.slHunts?.length > 0)
      msg += `🎯 *SL Hunt:* ${smcData.slHunts[smcData.slHunts.length-1].description}\n`;

    // Volume
    const vol = smcData.volumeData || {};
    const volEm = vol.volumeSignal==="BULLISH_VOLUME"?"🔵":vol.volumeSignal==="BEARISH_VOLUME"?"🔴":"⚪";
    msg += `${volEm} *Volume:* ${vol.volumeSignal} (${vol.ratio}x avg)`;

    // Key SMC reason
    msg += `\n\n🔑 *SMC Key:* ${decision.smcKey || "—"}`;
    msg += `\n❌ *Invalidation:* ${decision.invalidation || "—"}`;

    // Confluences
    if (l1.confluences?.length > 0) {
      msg += `\n\n📋 *Confluences (${l1.confluenceCount}):* ${l1.confluences.join(" · ")}`;
    }

    // Risk Management
    if (riskData) {
      msg += `\n\n━━━━━━━━━━━━━━━━━━━━
💼 *RISK (1% — $${riskData.riskAmount})*
• Position: ${riskData.positionSize} units
• Profit Potential: $${riskData.potentialProfit}
• Valid Setup: ${riskData.isValidSetup ? "✅ YES (RR≥2)" : "❌ NO (Skip)"}`;
    }

    msg += `\n\n_⚠️ Educational only. Not financial advice._`;
    return msg;
  }

  async sendSignal(symbol, timeframe, decision, smcData, riskData = null) {
    const msg = this.formatSignalMessage(symbol, timeframe, decision, smcData, riskData);
    try {
      await this.bot.sendMessage(this.channelId, msg, {
        parse_mode: "Markdown",
        disable_web_page_preview: true
      });
      console.log(`✅ Telegram sent: ${symbol} ${decision.verdict} ${decision.signal}`);
      return true;
    } catch(e) {
      console.error("Telegram error:", e.message);
      return false;
    }
  }

  async sendScanSummary(results) {
    const takes  = results.filter(r => r.verdict === "TAKE");
    const skips  = results.filter(r => r.verdict === "SKIP");
    const waits  = results.filter(r => r.verdict === "WAIT" || !r.verdict);
    const now    = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    let msg = `🔍 *MARKET SCAN SUMMARY*
⏰ ${now}
━━━━━━━━━━━━━━━━━━━━
📊 Scanned: ${results.length} | ✅ TAKE: ${takes.length} | ❌ SKIP: ${skips.length} | ⏳ WAIT: ${waits.length}
`;

    if (takes.length > 0) {
      msg += `\n✅ *TOP TAKE SETUPS:*\n`;
      takes.slice(0, 5).forEach(r => {
        const em = r.signal==="BUY"?"🟢":"🔴";
        msg += `${em} *${r.symbol}* (${r.timeframe}) — ${r.setupQuality || "—"} | ${r.confidence}% | Entry:${r.entry} SL:${r.stopLoss} T1:${r.target1}\n`;
      });
    }

    if (waits.length > 0) {
      msg += `\n⏳ *WATCH LIST (WAIT):*\n`;
      waits.slice(0, 3).forEach(r => {
        msg += `• *${r.symbol}* — ${r.bestTimeToEnter || "Wait for confirmation"}\n`;
      });
    }

    msg += `\n_TradeSignal AI — SMC 2-Layer System v3.1_`;

    try {
      await this.bot.sendMessage(this.channelId, msg, { parse_mode: "Markdown" });
    } catch(e) {
      console.error("Telegram summary error:", e.message);
    }
  }

  async testConnection() {
    try {
      await this.bot.sendMessage(this.channelId,
        "✅ *TradeSignal AI — 2-Layer SMC System Connected!*\n\nLayer 1: Signal Engine 🔧\nLayer 2: Claude Decision Maker 🤖\n\nReady to trade! 🚀",
        { parse_mode: "Markdown" }
      );
      return true;
    } catch(e) {
      console.error("Telegram test failed:", e.message);
      return false;
    }
  }
}

module.exports = TelegramSignalBot;
