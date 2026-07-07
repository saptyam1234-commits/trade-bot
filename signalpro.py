"""
SignalPro FX  v4.0  -  EMA Trend Pullback
Trend TF : 1 Day  |  Entry TF : 1 Hour
Pairs    : XAU/USD, EUR/USD, GBP/USD, USD/JPY
Score    : EMA + MACD + Volume + Liquidity Sweep
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

ATR_PERIOD      = 14
ATR_SL_MULT     = 1.5
ATR_TP1_MULT    = 2.0
ATR_TP2_MULT    = 3.5
MIN_CANDLES     = 60
MAX_SL_PIPS     = 200
PULLBACK_BUFFER = 2.0

MIN_SCORE       = 40   # minimum score to send signal


# ═══════════════════════════════════════
#  MARKET HOURS
# ═══════════════════════════════════════
def is_market_open():
    now  = datetime.now(timezone.utc)
    day  = now.weekday()
    hour = now.hour
    if day == 5:                    return False
    if day == 6 and hour < 21:     return False
    if day == 4 and hour >= 22:    return False
    return True


# ═══════════════════════════════════════
#  HISTORY & DUPLICATE
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
            "close":  [float(x["close"])  for x in values],
            "high":   [float(x["high"])   for x in values],
            "low":    [float(x["low"])    for x in values],
            "open":   [float(x["open"])   for x in values],
            "volume": [float(x.get("volume", 0)) for x in values],
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


def macd(close, fast=12, slow=26, signal=9):
    """Returns (macd_line, signal_line, histogram) — last values"""
    ema_fast   = ema(close, fast)
    ema_slow   = ema(close, slow)
    macd_line  = [f - s for f, s in zip(ema_fast, ema_slow)]
    signal_line = ema(macd_line, signal)
    histogram  = [m - s for m, s in zip(macd_line, signal_line)]
    return macd_line[-1], signal_line[-1], histogram[-1]


def volume_score(volume):
    """
    Compare last candle volume vs 20-candle average.
    Returns 0-20 score.
    """
    if not volume or all(v == 0 for v in volume):
        return 10   # volume data nahi hai — neutral score
    avg_vol  = sum(volume[-20:]) / 20
    last_vol = volume[-1]
    if avg_vol == 0:
        return 10
    ratio = last_vol / avg_vol
    if ratio >= 2.0:   return 20   # 2x average = very high volume
    elif ratio >= 1.5: return 15   # 1.5x average = high volume
    elif ratio >= 1.0: return 10   # average volume
    elif ratio >= 0.7: return 5    # below average
    else:              return 0    # very low volume


def liquidity_sweep_score(high, low, close, direction, atr_val):
    """
    Check karo ki price ne recent high/low ko sweep kiya aur wapas aaya.
    BUY  : Price ne EMA ke neeche sweep kiya → wapas aaya
    SELL : Price ne EMA ke upar sweep kiya → wapas aaya
    Returns 0-20 score.
    """
    last_10_high = max(high[-11:-1])   # last 10 candles (excluding current)
    last_10_low  = min(low[-11:-1])

    current_low  = low[-1]
    current_high = high[-1]
    current_close = close[-1]

    if direction == "BUY":
        # Price ne low sweep kiya aur upar close hua
        swept = current_low < last_10_low
        recovered = current_close > last_10_low
        if swept and recovered:
            return 20   # Strong sweep + recovery
        elif swept:
            return 10   # Sweep hua lekin recovery nahi
        else:
            return 0    # Koi sweep nahi

    else:  # SELL
        # Price ne high sweep kiya aur neeche close hua
        swept = current_high > last_10_high
        recovered = current_close < last_10_high
        if swept and recovered:
            return 20
        elif swept:
            return 10
        else:
            return 0


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
#  SCORE SYSTEM  (0-100)
# ═══════════════════════════════════════
def calculate_score(
    daily_trend, d_strength,
    e5, e10, e20, e30,
    price, atr_val, pip,
    h_macd, h_signal, h_hist,
    volume, high, low, close,
    direction
):
    score = 0
    breakdown = {}

    # 1. Daily EMA stack (0-25 pts)
    if daily_trend == "BUY":
        ema_ok = e5[-1] > e10[-1] > e20[-1] > e30[-1]
    else:
        ema_ok = e5[-1] < e10[-1] < e20[-1] < e30[-1]
    ema_pts = 25 if ema_ok else 10
    score += ema_pts
    breakdown["EMA Stack"] = f"{ema_pts}/25"

    # 2. Daily trend strength (0-20 pts)
    strength_pts = int(d_strength / 100 * 20)
    score += strength_pts
    breakdown["Trend Strength"] = f"{strength_pts}/20"

    # 3. MACD confirmation (0-20 pts)
    if direction == "BUY":
        if h_macd > h_signal and h_hist > 0:
            macd_pts = 20   # MACD bullish + histogram positive
        elif h_macd > h_signal:
            macd_pts = 12   # MACD bullish only
        elif h_hist > 0:
            macd_pts = 8    # histogram positive only
        else:
            macd_pts = 0    # MACD bearish
    else:
        if h_macd < h_signal and h_hist < 0:
            macd_pts = 20
        elif h_macd < h_signal:
            macd_pts = 12
        elif h_hist < 0:
            macd_pts = 8
        else:
            macd_pts = 0
    score += macd_pts
    breakdown["MACD"] = f"{macd_pts}/20"

    # 4. Volume (0-20 pts)
    vol_pts = volume_score(volume)
    score += vol_pts
    breakdown["Volume"] = f"{vol_pts}/20"

    # 5. Liquidity sweep (0-15 pts)
    sweep_raw = liquidity_sweep_score(high, low, close, direction, atr_val)
    sweep_pts = int(sweep_raw * 15 / 20)
    score += sweep_pts
    breakdown["Liq Sweep"] = f"{sweep_pts}/15"

    return min(score, 100), breakdown


# ═══════════════════════════════════════
#  STRATEGY
# ═══════════════════════════════════════
def analyze(daily, hourly, pair):
    d_close  = daily["close"]
    h_open   = hourly["open"]
    h_close  = hourly["close"]
    h_high   = hourly["high"]
    h_low    = hourly["low"]
    h_volume = hourly["volume"]

    if len(d_close) < MIN_CANDLES or len(h_close) < MIN_CANDLES:
        return None

    daily_trend = get_trend(d_close)
    if daily_trend is None:
        return None

    d_strength = trend_strength(d_close, daily_trend)

    e5  = ema(h_close, 5)
    e10 = ema(h_close, 10)
    e20 = ema(h_close, 20)
    e30 = ema(h_close, 30)

    atr_val = atr(h_high, h_low, h_close, ATR_PERIOD)
    if atr_val == 0:
        return None

    h_macd, h_signal, h_hist = macd(h_close)

    price = h_close[-1]
    pip   = pair["pip"]
    buf   = atr_val * PULLBACK_BUFFER

    print(f"    Trend    : {daily_trend}  strength={d_strength}%")
    print(f"    Price    : {price:.5f}")
    print(f"    EMA      : {e5[-1]:.5f}/{e10[-1]:.5f}/{e20[-1]:.5f}/{e30[-1]:.5f}")
    print(f"    MACD     : {h_macd:.5f}  Signal={h_signal:.5f}  Hist={h_hist:.5f}")

    # ─── BUY ───────────────────────────────
    if daily_trend == "BUY":
        pullback = (e20[-1] - buf) <= price <= (e10[-1] + buf)
        print(f"    Pullback : {pullback}  zone={e20[-1]-buf:.5f}-{e10[-1]+buf:.5f}")

        if not pullback:
            return None

        score, breakdown = calculate_score(
            daily_trend, d_strength,
            e5, e10, e20, e30,
            price, atr_val, pip,
            h_macd, h_signal, h_hist,
            h_volume, h_high, h_low, h_close,
            "BUY"
        )
        print(f"    Score    : {score}%  {breakdown}")

        if score < MIN_SCORE:
            print(f"    Score too low ({score} < {MIN_SCORE}) — skipped.")
            return None

        sl   = min(price - atr_val * ATR_SL_MULT, min(h_low[-10:]))
        risk = price - sl
        if risk <= 0 or risk / pip > MAX_SL_PIPS:
            return None

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
            "strength":  d_strength,
            "score":     score,
            "breakdown": breakdown,
            "time":      datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        }

    # ─── SELL ──────────────────────────────
    if daily_trend == "SELL":
        pullback = (e10[-1] - buf) <= price <= (e20[-1] + buf)
        print(f"    Pullback : {pullback}  zone={e10[-1]-buf:.5f}-{e20[-1]+buf:.5f}")

        if not pullback:
            return None

        score, breakdown = calculate_score(
            daily_trend, d_strength,
            e5, e10, e20, e30,
            price, atr_val, pip,
            h_macd, h_signal, h_hist,
            h_volume, h_high, h_low, h_close,
            "SELL"
        )
        print(f"    Score    : {score}%  {breakdown}")

        if score < MIN_SCORE:
            print(f"    Score too low ({score} < {MIN_SCORE}) — skipped.")
            return None

        sl   = max(price + atr_val * ATR_SL_MULT, max(h_high[-10:]))
        risk = sl - price
        if risk <= 0 or risk / pip > MAX_SL_PIPS:
            return None

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
            "strength":  d_strength,
            "score":     score,
            "breakdown": breakdown,
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

    arrow  = "🟢" if signal["direction"] == "BUY" else "🔴"
    score  = signal["score"]
    stars  = "⭐" * (score // 20)
    bd     = signal["breakdown"]

    # Score bar visual
    filled = int(score / 10)
    bar    = "█" * filled + "░" * (10 - filled)

    msg = (
        f"{arrow} *{signal['pair']}  {signal['direction']}*\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📅 Strategy  : EMA Pullback v4.0\n"
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
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"💯 Score     : {score}%  {stars}\n"
        f"`{bar}` {score}/100\n"
        f"├ EMA Stack  : {bd.get('EMA Stack','')}\n"
        f"├ Trend      : {bd.get('Trend Strength','')}\n"
        f"├ MACD       : {bd.get('MACD','')}\n"
        f"├ Volume     : {bd.get('Volume','')}\n"
        f"└ Liq Sweep  : {bd.get('Liq Sweep','')}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"🕒 {signal['time']}\n"
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
    print("  SignalPro FX v4.0  -  EMA + MACD + Volume")
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
            print(f"    Duplicate — skipped.")
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
