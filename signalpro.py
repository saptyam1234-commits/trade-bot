"""
SignalPro FX  v3.0  -  EMA Trend Pullback
Trend TF : 1 Day  |  Entry TF : 1 Hour
Pairs    : XAU/USD, EUR/USD, GBP/USD, USD/JPY
"""

import os
import json
import requests
from datetime import datetime, timezone

# ═══════════════════════════════════════
#  CONFIG
# ═══════════════════════════════════════
API_KEY  = os.getenv("TWELVE_DATA_API_KEY", "")
TG_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TG_CHAT  = os.getenv("TELEGRAM_CHANNEL", "")

PAIRS = [
    {"symbol": "XAU/USD", "name": "Gold",   "pip": 0.01},
    {"symbol": "EUR/USD", "name": "EURUSD", "pip": 0.0001},
    {"symbol": "GBP/USD", "name": "GBPUSD", "pip": 0.0001},
    {"symbol": "USD/JPY", "name": "USDJPY", "pip": 0.01},
]

SIGNAL_FILE  = "last_signals.json"
HISTORY_FILE = "signal_history.json"

ATR_PERIOD        = 14
ATR_SL_MULT       = 1.5
ATR_TP1_MULT      = 2.0
ATR_TP2_MULT      = 3.5
MIN_CANDLES       = 60
MAX_SL_PIPS       = 200
PULLBACK_BUFFER   = 0.5   # ATR multiplier — widens pullback zone

MIN_BODY_ATR      = 0.25
MAX_WICK_RATIO    = 0.40
MIN_BODY_RATIO    = 0.45


# ═══════════════════════════════════════
#  MARKET HOURS  Mon 00:00 - Fri 22:00 UTC
# ═══════════════════════════════════════
def is_market_open():
    now  = datetime.now(timezone.utc)
    day  = now.weekday()   # Mon=0 ... Sun=6
    hour = now.hour
    if day == 5:
        return False
    if day == 6 and hour < 21:
        return False
    if day == 4 and hour >= 22:
        return False
    return True


# ═══════════════════════════════════════
#  SIGNAL HISTORY
# ═══════════════════════════════════════
def append_history(signal):
    history = []
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE) as f:
                history = json.load(f)
        except Exception:
            history = []
    history.append(signal)
    history = history[-500:]
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)


# ═══════════════════════════════════════
#  DUPLICATE GUARD
# ═══════════════════════════════════════
def load_cache():
    if os.path.exists(SIGNAL_FILE):
        try:
            with open(SIGNAL_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_cache(data):
    with open(SIGNAL_FILE, "w") as f:
        json.dump(data, f, indent=2)


def is_duplicate(pair, direction, entry):
    cache = load_cache()
    if pair not in cache:
        return False
    last = cache[pair]
    return (
        last.get("direction") == direction and
        round(last.get("entry", 0), 4) == round(entry, 4)
    )


def record_signal(signal):
    cache = load_cache()
    cache[signal["pair"]] = {
        "direction": signal["direction"],
        "entry":     signal["entry"],
        "time":      signal["time"],
    }
    save_cache(cache)
    append_history(signal)


# ═══════════════════════════════════════
#  MARKET DATA
# ═══════════════════════════════════════
def get_candles(symbol, interval, count=150):
    url    = "https://api.twelvedata.com/time_series"
    params = {
        "symbol":     symbol,
        "interval":   interval,
        "outputsize": count,
        "apikey":     API_KEY,
    }
    try:
        r    = requests.get(url, params=params, timeout=15)
        data = r.json()
        if "values" not in data:
            print(f"    API error: {data.get('message', data)}")
            return None
        values = list(reversed(data["values"]))
        return {
            "close": [float(x["close"]) for x in values],
            "high":  [float(x["high"])  for x in values],
            "low":   [float(x["low"])   for x in values],
            "open":  [float(x["open"])  for x in values],
        }
    except Exception as e:
        print(f"    Request error: {e}")
        return None


# ═══════════════════════════════════════
#  INDICATORS
# ═══════════════════════════════════════
def ema(data, period):
    k      = 2 / (period + 1)
    result = [data[0]]
    for price in data[1:]:
        result.append(price * k + result[-1] * (1 - k))
    return result


def atr(high, low, close, period=ATR_PERIOD):
    tr_list = []
    for i in range(1, len(close)):
        tr = max(
            high[i] - low[i],
            abs(high[i] - close[i-1]),
            abs(low[i]  - close[i-1]),
        )
        tr_list.append(tr)
    if len(tr_list) < period:
        return 0.0
    return sum(tr_list[-period:]) / period


# ═══════════════════════════════════════
#  TREND
# ═══════════════════════════════════════
def get_trend(close):
    e5  = ema(close, 5)
    e10 = ema(close, 10)
    e20 = ema(close, 20)
    e30 = ema(close, 30)
    if e5[-1] > e10[-1] > e20[-1] > e30[-1] and close[-1] > e5[-1]:
        return "BUY"
    if e5[-1] < e10[-1] < e20[-1] < e30[-1] and close[-1] < e5[-1]:
        return "SELL"
    return None


def trend_strength(close, direction):
    e5  = ema(close, 5)
    e30 = ema(close, 30)
    price = close[-1]
    spread = abs(e5[-1] - e30[-1]) / price * 100
    spread_score = min(spread * 40, 50)
    recent = close[-5:]
    if direction == "BUY":
        confirm = sum(1 for i in range(1, len(recent)) if recent[i] > recent[i-1])
    else:
        confirm = sum(1 for i in range(1, len(recent)) if recent[i] < recent[i-1])
    confirm_score = (confirm / 4) * 50
    return round(min(spread_score + confirm_score, 100), 1)


# ═══════════════════════════════════════
#  SIGNAL SCORE
# ═══════════════════════════════════════
def signal_score(daily_trend, e5, e10, e20, e30, price, atr_val, pip):
    score = 60
    if daily_trend == "BUY":
        if e5[-1] > e10[-1] > e20[-1] > e30[-1]:
            score += 20
    else:
        if e5[-1] < e10[-1] < e20[-1] < e30[-1]:
            score += 20
    atr_pips = atr_val / pip
    if atr_pips < 30:
        score += 10
    elif atr_pips < 60:
        score += 5
    mid = (e10[-1] + e20[-1]) / 2
    if abs(price - mid) < atr_val * 0.3:
        score += 10
    return min(score, 100)


# ═══════════════════════════════════════
#  CANDLE FILTER
# ═══════════════════════════════════════
def candle_filter(o, h, l, c, atr_val, direction):
    body       = abs(c - o)
    candle_rng = h - l

    if candle_rng == 0:
        return False, "zero range"

    if body < atr_val * MIN_BODY_ATR:
        return False, f"body too small ({body:.5f})"

    body_ratio = body / candle_rng
    if body_ratio < MIN_BODY_RATIO:
        return False, f"weak body ({body_ratio:.2f})"

    if direction == "BUY":
        wick = (min(o, c) - l) / candle_rng
        if wick > MAX_WICK_RATIO:
            return False, f"long lower wick ({wick:.2f})"
    else:
        wick = (h - max(o, c)) / candle_rng
        if wick > MAX_WICK_RATIO:
            return False, f"long upper wick ({wick:.2f})"

    if direction == "BUY" and c <= o:
        return False, "not bullish"
    if direction == "SELL" and c >= o:
        return False, "not bearish"

    return True, "OK"


# ═══════════════════════════════════════
#  STRATEGY
# ═══════════════════════════════════════
def analyze(daily, hourly, pair):
    d_close = daily["close"]
    h_open  = hourly["open"]
    h_close = hourly["close"]
    h_high  = hourly["high"]
    h_low   = hourly["low"]

    if len(d_close) < MIN_CANDLES or len(h_close) < MIN_CANDLES:
        return None

    daily_trend = get_trend(d_close)
    if daily_trend is None:
        return None

    strength = trend_strength(d_close, daily_trend)

    e5  = ema(h_close, 5)
    e10 = ema(h_close, 10)
    e20 = ema(h_close, 20)
    e30 = ema(h_close, 30)

    atr_val = atr(h_high, h_low, h_close, ATR_PERIOD)
    if atr_val == 0:
        return None

    price  = h_close[-1]
    pip    = pair["pip"]
    buf    = atr_val * PULLBACK_BUFFER

    print(f"    Trend    : {daily_trend}  strength={strength}%")
    print(f"    Price    : {price:.5f}")
    print(f"    EMA      : {e5[-1]:.5f} / {e10[-1]:.5f} / {e20[-1]:.5f} / {e30[-1]:.5f}")

    # ─── BUY ───────────────────────────────────
    if daily_trend == "BUY":
        pullback = (e20[-1] - buf) <= price <= (e10[-1] + buf)
        print(f"    Pullback : {pullback}  zone={e20[-1]-buf:.5f}-{e10[-1]+buf:.5f}")

        if not pullback:
            return None

        cf_ok, cf_reason = candle_filter(
            h_open[-1], h_high[-1], h_low[-1], h_close[-1], atr_val, "BUY"
        )
        print(f"    Candle   : {cf_ok}  ({cf_reason})")
        if not cf_ok:
            return None

        sl        = min(price - atr_val * ATR_SL_MULT, min(h_low[-10:]))
        risk      = price - sl
        if risk <= 0 or risk / pip > MAX_SL_PIPS:
            return None

        score = signal_score(daily_trend, e5, e10, e20, e30, price, atr_val, pip)
        return {
            "pair":      pair["symbol"],
            "name":      pair["name"],
            "direction": "BUY",
            "entry":     round(price, 5),
            "sl":        round(sl, 5),
            "tp1":       round(price + risk * ATR_TP1_MULT, 5),
            "tp2":       round(price + risk * ATR_TP2_MULT, 5),
            "sl_pips":   round(risk / pip, 1),
            "atr_pips":  round(atr_val / pip, 1),
            "strength":  strength,
            "score":     score,
            "time":      datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        }

    # ─── SELL ──────────────────────────────────
    if daily_trend == "SELL":
        pullback = (e10[-1] - buf) <= price <= (e20[-1] + buf)
        print(f"    Pullback : {pullback}  zone={e10[-1]-buf:.5f}-{e20[-1]+buf:.5f}")

        if not pullback:
            return None

        cf_ok, cf_reason = candle_filter(
            h_open[-1], h_high[-1], h_low[-1], h_close[-1], atr_val, "SELL"
        )
        print(f"    Candle   : {cf_ok}  ({cf_reason})")
        if not cf_ok:
            return None

        sl        = max(price + atr_val * ATR_SL_MULT, max(h_high[-10:]))
        risk      = sl - price
        if risk <= 0 or risk / pip > MAX_SL_PIPS:
            return None

        score = signal_score(daily_trend, e5, e10, e20, e30, price, atr_val, pip)
        return {
            "pair":      pair["symbol"],
            "name":      pair["name"],
            "direction": "SELL",
            "entry":     round(price, 5),
            "sl":        round(sl, 5),
            "tp1":       round(price - risk * ATR_TP1_MULT, 5),
            "tp2":       round(price - risk * ATR_TP2_MULT, 5),
            "sl_pips":   round(risk / pip, 1),
            "atr_pips":  round(atr_val / pip, 1),
            "strength":  strength,
            "score":     score,
            "time":      datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        }

    return None


# ═══════════════════════════════════════
#  TELEGRAM
# ═══════════════════════════════════════
def send_telegram(signal):
    if not TG_TOKEN or not TG_CHAT:
        print("    Telegram config missing.")
        return

    arrow = "🟢" if signal["direction"] == "BUY" else "🔴"
    stars = "⭐" * (signal["score"] // 20)

    msg = (
        f"{arrow} *{signal['pair']}  {signal['direction']}*\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📅 Strategy  : EMA Trend Pullback\n"
        f"📈 Trend TF  : 1 Day\n"
        f"⏰ Entry TF  : 1 Hour\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📍 Entry     : `{signal['entry']}`\n"
        f"🎯 TP1       : `{signal['tp1']}`\n"
        f"🎯 TP2       : `{signal['tp2']}`\n"
        f"🛑 Stop Loss : `{signal['sl']}`\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📏 SL Pips   : {signal['sl_pips']}\n"
        f"〽️ ATR Pips  : {signal['atr_pips']}\n"
        f"📊 Trend     : {signal['strength']}%\n"
        f"💪 Score     : {signal['score']}%  {stars}\n"
        f"🕒 {signal['time']}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"⚠️ _Risk only 1-2% per trade._"
    )

    url = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
    try:
        resp = requests.post(
            url,
            json={"chat_id": TG_CHAT, "text": msg, "parse_mode": "Markdown"},
            timeout=15,
        )
        if not resp.ok:
            print(f"    Telegram error: {resp.text}")
    except Exception as e:
        print(f"    Telegram error: {e}")


# ═══════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════
def main():
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print("=" * 50)
    print("  SignalPro FX v3.0  -  EMA Pullback")
    print(f"  {now_str}")
    print("=" * 50)

    if not is_market_open():
        now = datetime.now(timezone.utc)
        day = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][now.weekday()]
        print(f"\n  Market closed ({day} {now.strftime('%H:%M')} UTC)\n")
        return

    if not API_KEY:
        print("\n  ERROR: TWELVE_DATA_API_KEY not set\n")
        return

    total = 0

    for pair in PAIRS:
        sym = pair["symbol"]
        print(f"\n  >> {sym}")

        daily  = get_candles(sym, "1day", 150)
        hourly = get_candles(sym, "1h",   150)

        if daily is None or hourly is None:
            print("    Data unavailable.")
            continue

        signal = analyze(daily, hourly, pair)

        if signal is None:
            print("    No setup.")
            continue

        if is_duplicate(signal["pair"], signal["direction"], signal["entry"]):
            print(f"    Duplicate - skipped.")
            continue

        print(f"    SIGNAL: {signal['direction']} @ {signal['entry']}  score={signal['score']}%")
        send_telegram(signal)
        record_signal(signal)
        total += 1

    print()
    print("=" * 50)
    print(f"  Done. Signals sent: {total}")
    print("=" * 50)


if __name__ == "__main__":
    main()
