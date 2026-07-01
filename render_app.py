"""
SignalPro FX v3.0  –  Render.com Web Service entry point
─────────────────────────────────────────────────────────
Render needs a long-running HTTP process.
This tiny Flask app exposes:
  GET  /         → health check (200 OK)
  GET  /run      → manually trigger a scan
  GET  /history  → last 20 signals as JSON

A background thread runs the scan every 60 minutes.
"""

import threading
import time
from datetime import datetime, timezone
from flask import Flask, jsonify

# Import strategy from the main module
from signalpro import main as run_scan, HISTORY_FILE

import json, os

app = Flask(__name__)
last_run: dict = {"time": None, "status": "not started"}


# ═══════════════════════════════════════
#  Background scanner thread
# ═══════════════════════════════════════
def background_loop() -> None:
    global last_run
    while True:
        try:
            print(f"\n[Scheduler] Running scan at "
                  f"{datetime.now(timezone.utc).strftime('%H:%M UTC')} …")
            run_scan()
            last_run = {
                "time":   datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                "status": "ok",
            }
        except Exception as e:
            last_run = {
                "time":   datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                "status": f"error: {e}",
            }
            print(f"[Scheduler] Error: {e}")
        time.sleep(3600)   # wait 1 hour


# ═══════════════════════════════════════
#  Routes
# ═══════════════════════════════════════
@app.get("/")
def health():
    return jsonify({
        "service":  "SignalPro FX v3.0",
        "status":   "running",
        "last_run": last_run,
        "time_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    })


@app.get("/run")
def manual_run():
    """Trigger an immediate scan (useful for testing)."""
    try:
        run_scan()
        return jsonify({"status": "ok", "message": "Scan complete."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.get("/history")
def history():
    """Return the last 20 signals from the audit log."""
    if not os.path.exists(HISTORY_FILE):
        return jsonify({"signals": []})
    try:
        with open(HISTORY_FILE) as f:
            data = json.load(f)
        return jsonify({"signals": data[-20:][::-1]})   # newest first
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ═══════════════════════════════════════
#  Start
# ═══════════════════════════════════════
if __name__ == "__main__":
    # Launch scanner in background before serving HTTP
    t = threading.Thread(target=background_loop, daemon=True)
    t.start()

    port = int(os.getenv("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
