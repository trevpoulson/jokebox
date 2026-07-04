# Running this locally

## Just to use it (you)

```bash
cd /Users/trevpoulson/Documents/Jokebox/software
./venv/bin/python server.py
```

Then open **http://localhost:5050** in any browser. Resize the window to
roughly 800×480 to match the real touchscreen, or just use it full-size —
the layout is fixed either way.

Click **"🪙 Simulate Quarter"** in the dev bar at the top to unlock the
joke menu (stands in for a real coin until the hardware arrives), or
**"🚶 Simulate Motion"** to wake the screen from its sleep state.

The screen starts idle, then goes fully to sleep (black) after 20
seconds with no motion — that's the same behavior the real device will
have with a PIR sensor watching for someone walking up, so the screen
isn't burning battery all day. A coin also wakes it directly to the
menu even from asleep, since the coin acceptor stays "listening"
independent of the screen.

Set `DEV_MODE = False` in `server.py` before this ever runs for real on
the Pi — that hides both simulate buttons so only real sensor input
works. `gpio_listener.py` is the Pi-side script that reads the real coin
acceptor and PIR sensor and calls the same two endpoints the dev buttons
call — it doesn't run (or need to run) on the Mac at all.

## Joke playback (fully hands-off after picking a category)

Once you tap a category, there's nothing left to touch — no Next or
Replay buttons required. Per joke: the setup line plays (real recorded
audio, not browser text-to-speech), a short beat of silence, then the
punchline reveals (in orange) and plays, followed by a burst of canned
laughter, then a short progress bar sweeps left-to-right before the next
joke starts automatically. A coin insert also plays a laugh right away,
before the category menu appears. Each session plays 5 jokes (see
"Ratings" below for how those 5 get picked), then shows "Thanks!" for a
few seconds and returns to idle on its own.

**"⏹ Stop Jokes"** in the dev bar cancels an in-progress sequence
immediately — cuts the currently-playing clip and returns to idle — for
quickly resetting between test runs.

### Joke audio (real voices, not browser TTS)

Every setup/punchline line has its own recorded clip —
`static/audio/jokes/<category>/<NN>_setup.mp3` and `<NN>_punchline.mp3`
(01 through 25 for Dad/Family/Adults Only, 01 through 20 for Mixed Nuts).
Generated with ElevenLabs (`eleven_v3`) using four custom voices from
Trev's voice library, one per category:

| Category | Voice | Voice ID |
|---|---|---|
| Dad Jokes | Redneck Jokester | `3kNgjGCTRTDSBwXeGTxi` |
| Family Friendly | man jokester | `Cp0ZE0I4L3ukiZ9kdOyE` |
| Adults Only | woman jokester | `zqGajppWAKPE9z3qitGU` |
| Mixed Nuts | New York Jokester | `oSE9yOhmDJmMWliYfK0L` |

All 190 clips were run through the `narration` skill's fidelity-check
script and loudness-normalized to a consistent level (`ffmpeg loudnorm`,
-16 LUFS) so volume doesn't jump around between jokes or voices. The app
preloads all of them on page load so there's no fetch delay mid-sequence,
and plays them via the Web Audio API (see below) rather than a plain
`<audio>` tag — same reasoning as the laugh track. See `JOKE-BANK.md` at
the project root for the full research/curation trail behind the joke
text itself.

To add or edit a joke: update the text in `jokes.json`, generate a
matching `<NN>_setup.mp3`/`<NN>_punchline.mp3` pair with the category's
voice ID above, run it through fidelity-check, normalize it the same way,
and drop it in the right `static/audio/jokes/<category>/` folder.

### Ratings — jokes earn (or lose) how often they're picked

Below the progress bar, once a punchline has played, three single-color
icon buttons appear — meh / smirk / cry-laughing — big and tappable.
Tapping one POSTs to `/api/rate-joke` and is saved to `ratings.json`
(persists across restarts; not committed to source control by design,
since it's real usage data, not project content).

Each session no longer plays every joke in a category — it picks
**5 per quarter** (`SESSION_JOKE_COUNT` in `app.js`), matching the
original "five jokes" concept, via a **weighted random sample**: jokes
with more laughs are more likely to get picked, jokes with more mehs
less likely. A joke needs at least 3 votes total
(`MIN_VOTES_BEFORE_WEIGHTING`) before its rating affects its odds at
all — one unlucky tap can't bury a joke. Even a heavily meh'd joke never
drops to zero chance of appearing (weight floors at 0.2), so it still
shows up occasionally rather than vanishing outright — the ask was
"show it less," not "remove it."

Voting is optional and doesn't block the sequence — if nobody taps
anything, the next joke starts on its own exactly as before. Only one
vote counts per joke-per-session (the buttons disable themselves once
tapped, until the next joke appears).

The canned laughter clip is `static/audio/laugh.mp3` — also
ElevenLabs-generated. Swap in a different clip anytime by replacing that
file (same filename, any length is fine).

**Audio unlocking, and why it matters for the real Pi:** browsers won't
play sound at all until the page has had *some* user interaction —
otherwise every site with an autoplaying video would blast audio the
moment it loads. The app unlocks audio on the very first tap anywhere
on the page and it then stays unlocked for the rest of that page
load, which is why a coin insert later in the session plays its laugh
fine even though a hardware coin event has no "tap" of its own.

The gap: on the real device, a coin could be the *very first* thing that
happens after the screen wakes — before anyone's touched the screen at
all. No browser-side trick can unlock audio with zero interaction ever
having happened. The fix for the actual kiosk deployment is a Chromium
launch flag that disables the restriction entirely:
`--autoplay-policy=no-user-gesture-required` (alongside the `--kiosk`
flag you'll already be using to launch fullscreen on the Pi). Make a
note of this for the Pi setup step — it's a one-line addition to
whatever launches Chromium on boot.

## Why Claude's preview tool runs a mirrored copy

Claude's browser-preview tool is sandboxed to the `~/Documents/Wuji`
folder and can't read files under `~/Documents/Jokebox` directly — this
is a macOS-level restriction, not something either of us configured. So
when Claude is iterating on the UI with live screenshots, it mirrors this
`software/` folder (minus `venv/`) into a scratch directory and runs the
server from there instead. Jokebox itself stays the source of truth —
the mirror is just a preview stand-in and gets discarded at the end of
the session. You'll never notice this when running it yourself with the
command above.
