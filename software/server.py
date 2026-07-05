"""
Joke Box server — serves the kiosk UI and exposes two trigger endpoints
(coin insert, motion detected) that both the Mac dev "simulate" buttons
and (later) the real Raspberry Pi GPIO listeners call identically.

Run:
    ./venv/bin/python server.py

The frontend listens on /api/events via Server-Sent Events. Anything
that wants to signal "a coin went in" or "someone walked up" just POSTs
to /api/coin-insert or /api/motion-detected — on the Pi, those POSTs
come from gpio_listener.py instead of the browser dev buttons.
"""
import json
import queue
import threading
import time
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
JOKES_PATH = BASE_DIR / "jokes.json"
RATINGS_PATH = BASE_DIR / "ratings.json"
STATS_PATH = BASE_DIR / "stats.json"
SETTINGS_PATH = BASE_DIR / "settings.json"
_ratings_lock = threading.Lock()
_stats_lock = threading.Lock()
_settings_lock = threading.Lock()

# Whether the kiosk UI is currently on its black "asleep" screen. The Pi's
# display helper (pi_display.py) polls this and cuts the real backlight —
# a black web page alone doesn't save any power.
_screen_asleep = False

DEFAULT_SETTINGS = {
    "volume": 1.0,
    "free_play": False,
    "disabled_jokes": [],       # "<category>:<index>" keys pulled from rotation
    "disabled_categories": [],  # category ids hidden from the menu entirely
    "admin_pin": "0000",        # numeric PIN for the on-screen staff keypad
    "attract_interval": 10,     # seconds between barker pitches on the idle screen (0 = off)
}
RECENT_MEMORY = 50  # jokes per category excluded from re-selection until they age out
                    # (= the last 10 sessions at 5 jokes each; the frontend falls back
                    # to the full pool if a category is too small to honor this)

# root_path/instance_path are set explicitly because Flask's default
# lookup calls os.getcwd(), which can fail under some sandboxed
# launchers even though the app's own directory is perfectly readable.
app = Flask(__name__, root_path=str(BASE_DIR), instance_path=str(BASE_DIR / "instance"))
# Always revalidate static assets — the kiosk is a long-lived browser
# session on a LAN, and stale JS/CSS after an update causes broken
# half-old/half-new pages that are miserable to diagnose.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

# Set False before deploying to the Pi — hides the on-screen "simulate
# quarter" button so only real coin pulses can unlock the menu.
DEV_MODE = True

# Every connected browser tab gets its own event queue so SSE can push
# "a coin was inserted" to the page without the page having to poll.
_subscribers = []


def load_jokes():
    with open(JOKES_PATH) as f:
        return json.load(f)


def load_ratings():
    if not RATINGS_PATH.exists():
        return {}
    with open(RATINGS_PATH) as f:
        return json.load(f)


def save_ratings(ratings):
    with open(RATINGS_PATH, "w") as f:
        json.dump(ratings, f, indent=2)


def load_stats():
    if not STATS_PATH.exists():
        return {"coins": 0, "sessions": {}, "plays": {}, "recent": {}}
    with open(STATS_PATH) as f:
        return json.load(f)


def save_stats(stats):
    with open(STATS_PATH, "w") as f:
        json.dump(stats, f, indent=2)


def load_settings():
    if not SETTINGS_PATH.exists():
        return dict(DEFAULT_SETTINGS)
    with open(SETTINGS_PATH) as f:
        return {**DEFAULT_SETTINGS, **json.load(f)}


def save_settings(settings):
    with open(SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=2)


VALID_RATINGS = {"meh", "smirk", "laugh"}


@app.route("/")
def index():
    jokes = load_jokes()
    settings = load_settings()
    disabled_cats = set(settings.get("disabled_categories", []))
    categories = [
        {"id": k, "label": v["label"]}
        for k, v in jokes.items()
        if k not in disabled_cats
    ]
    return render_template(
        "index.html",
        categories=categories,
        dev_mode=DEV_MODE,
        free_play=settings.get("free_play", False),
    )


@app.route("/api/jokes")
def api_jokes():
    return jsonify(load_jokes())


@app.route("/api/ratings")
def api_ratings():
    """Vote counts keyed '<category>:<index>' -> {meh, smirk, laugh}.
    The frontend uses this to weight which jokes get picked each session."""
    return jsonify(load_ratings())


@app.route("/api/rate-joke", methods=["POST"])
def rate_joke():
    data = request.get_json(force=True, silent=True) or {}
    category = data.get("category")
    index = data.get("index")
    rating = data.get("rating")
    if not category or index is None or rating not in VALID_RATINGS:
        return jsonify({"ok": False, "error": "bad request"}), 400

    key = f"{category}:{index}"
    with _ratings_lock:
        ratings = load_ratings()
        entry = ratings.setdefault(key, {"meh": 0, "smirk": 0, "laugh": 0})
        entry[rating] = entry.get(rating, 0) + 1
        save_ratings(ratings)

    return jsonify({"ok": True})


@app.route("/api/session-context")
def session_context():
    """Everything the frontend needs when starting a session: vote counts
    (for weighting), recently-played indices (to avoid repeats), and
    settings (volume, free play)."""
    stats = load_stats()
    return jsonify({
        "ratings": load_ratings(),
        "recent": stats.get("recent", {}),
        "settings": load_settings(),
    })


@app.route("/api/session-start", methods=["POST"])
def session_start():
    data = request.get_json(force=True, silent=True) or {}
    category = data.get("category")
    if not category:
        return jsonify({"ok": False}), 400
    with _stats_lock:
        stats = load_stats()
        stats.setdefault("sessions", {})
        stats["sessions"][category] = stats["sessions"].get(category, 0) + 1
        save_stats(stats)
    return jsonify({"ok": True})


@app.route("/api/joke-played", methods=["POST"])
def joke_played():
    data = request.get_json(force=True, silent=True) or {}
    category = data.get("category")
    index = data.get("index")
    if not category or index is None:
        return jsonify({"ok": False}), 400
    key = f"{category}:{index}"
    with _stats_lock:
        stats = load_stats()
        stats.setdefault("plays", {})
        stats["plays"][key] = stats["plays"].get(key, 0) + 1
        recent = stats.setdefault("recent", {}).setdefault(category, [])
        if index in recent:
            recent.remove(index)
        recent.append(index)
        del recent[:-RECENT_MEMORY]
        save_stats(stats)
    return jsonify({"ok": True})


@app.route("/api/verify-pin", methods=["POST"])
def verify_pin():
    """The kiosk's on-screen staff keypad checks its entry here — the PIN
    lives in settings.json (admin_pin), never in the frontend code."""
    data = request.get_json(force=True, silent=True) or {}
    ok = str(data.get("pin", "")) == str(load_settings().get("admin_pin", "0000"))
    return jsonify({"ok": ok})


@app.route("/api/screen-state", methods=["GET", "POST"])
def screen_state():
    """The kiosk UI reports asleep/awake here; pi_display.py polls it and
    toggles the physical backlight to match."""
    global _screen_asleep
    if request.method == "POST":
        data = request.get_json(force=True, silent=True) or {}
        _screen_asleep = bool(data.get("asleep"))
        return jsonify({"ok": True})
    return jsonify({"asleep": _screen_asleep})


@app.route("/admin")
def admin():
    """Stats dashboard + settings. Unauthenticated by design — it's a
    bathroom appliance on a private network; don't expose this box to
    the internet."""
    jokes = load_jokes()
    ratings = load_ratings()
    stats = load_stats()
    settings = load_settings()

    disabled_jokes = set(settings.get("disabled_jokes", []))
    disabled_cats = set(settings.get("disabled_categories", []))
    rows = []
    for cat_id, cat in jokes.items():
        for i, joke in enumerate(cat["jokes"]):
            key = f"{cat_id}:{i}"
            counts = ratings.get(key, {})
            meh = counts.get("meh", 0)
            smirk = counts.get("smirk", 0)
            laugh = counts.get("laugh", 0)
            total = meh + smirk + laugh
            score = round((laugh * 2 + smirk - meh * 1.5) / total, 2) if total else None
            rows.append({
                "key": key,
                "category": cat["label"],
                "setup": joke["setup"],
                "plays": stats.get("plays", {}).get(key, 0),
                "meh": meh, "smirk": smirk, "laugh": laugh,
                "score": score,
                "enabled": key not in disabled_jokes,
            })
    # best first; unrated sink to the bottom, ordered by play count
    rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0), -r["plays"]))

    coins = stats.get("coins", 0)
    return render_template(
        "admin.html",
        rows=rows,
        coins=coins,
        earnings="{:.2f}".format(coins * 0.25),
        sessions=stats.get("sessions", {}),
        labels={k: v["label"] for k, v in jokes.items()},
        enabled_cats={k: (k not in disabled_cats) for k in jokes},
        settings=settings,
    )


@app.route("/admin/content", methods=["POST"])
def admin_content():
    """Save which categories and individual jokes are in rotation. The
    form sends a checkbox per enabled item; anything missing is disabled."""
    jokes = load_jokes()
    enabled_cats = request.form.getlist("cat")
    enabled_jokes = set(request.form.getlist("joke"))
    with _settings_lock:
        settings = load_settings()
        settings["disabled_categories"] = [k for k in jokes if k not in enabled_cats]
        settings["disabled_jokes"] = [
            f"{cat_id}:{i}"
            for cat_id, cat in jokes.items()
            for i in range(len(cat["jokes"]))
            if f"{cat_id}:{i}" not in enabled_jokes
        ]
        save_settings(settings)
    return '<meta http-equiv="refresh" content="0; url=/admin">'


@app.route("/admin/settings", methods=["POST"])
def admin_settings():
    with _settings_lock:
        settings = load_settings()
        try:
            settings["volume"] = min(1.0, max(0.0, float(request.form.get("volume", 1.0))))
        except ValueError:
            pass
        settings["free_play"] = request.form.get("free_play") == "on"
        try:
            settings["attract_interval"] = min(300, max(0, int(request.form.get("attract_interval", 10))))
        except ValueError:
            pass
        save_settings(settings)
    return '<meta http-equiv="refresh" content="0; url=/admin">'


def _broadcast(event_type):
    event = {"type": event_type, "ts": time.time()}
    for q in _subscribers:
        q.put(event)


@app.route("/api/coin-insert", methods=["POST"])
def coin_insert():
    """Called by the dev 'simulate quarter' button on Mac, or by
    gpio_listener.py on the Pi when a real coin pulse is detected."""
    with _stats_lock:
        stats = load_stats()
        stats["coins"] = stats.get("coins", 0) + 1
        save_stats(stats)
    _broadcast("coin_inserted")
    return jsonify({"ok": True})


@app.route("/api/motion-detected", methods=["POST"])
def motion_detected():
    """Called by the dev 'simulate motion' button on Mac, or by
    gpio_listener.py on the Pi when the PIR sensor triggers."""
    _broadcast("motion_detected")
    return jsonify({"ok": True})


@app.route("/api/events")
def events():
    """Server-Sent Events stream the frontend listens on."""
    q = queue.Queue()
    _subscribers.append(q)

    def stream():
        # Safari buffers the first ~2KB of an SSE stream before it will
        # dispatch any events — send a padding comment so real events
        # aren't stuck waiting behind it. A comment line starts with ":".
        yield ":" + (" " * 2048) + "\n\n"
        try:
            while True:
                try:
                    event = q.get(timeout=15)
                    yield f"data: {json.dumps(event)}\n\n"
                except queue.Empty:
                    # keepalive comment — stops Safari/some proxies from
                    # silently timing out an idle connection
                    yield ": keepalive\n\n"
        finally:
            _subscribers.remove(q)

    response = Response(stream(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True, use_reloader=False, threaded=True)
