# Joke Box — Roadmap & Gap Analysis

What's missing between "works great on Trev's Mac" and "hangs above a urinal
making Dad money." Ordered roughly by how much they matter.

> **Status update (2026-07-04):** items 1–3 and 5–9 below are BUILT (screen-sleep
> hook via `pi_display.py` + `/api/screen-state`, self-hosted fonts, deploy kit
> in `deploy/`, `/admin` dashboard, recently-played memory, attract-mode barker,
> coin credits + free play, admin volume control), plus item 11 (laugh variety +
> sad clap). Remaining: hardware bring-up (4), Mixed Nuts auto-curation (10),
> joke refresh cadence (12).

## Critical before real deployment

1. **True screen sleep.** The "asleep" state is a black web page — the
   backlight is still burning. On battery this erases most of the motion
   sensor's benefit. Fix: a Pi-side endpoint (add to `gpio_listener.py` or a
   tiny helper) that actually cuts the display (`vcgencmd display_power 0` or
   the backlight sysfs control) when the app goes to sleep, and restores it on
   motion/coin. The app already has the right events; the hardware just needs
   to listen to them.
2. **Self-hosted fonts.** The vintage theme loads three Google Fonts over the
   network. A bar bathroom probably has no wifi — offline, the whole look
   degrades to fallback fonts. Download the three woff2 files
   (Alfa Slab One, Rye, Special Elite) into `static/fonts/` and swap the
   `@import` for local `@font-face` rules before deployment.
3. **Pi deployment kit.** Nothing is scripted yet: systemd units for
   `server.py` + `gpio_listener.py` (with `Restart=always` as a crash
   watchdog), Chromium autostart in kiosk mode with
   `--kiosk --autoplay-policy=no-user-gesture-required`, `DEV_MODE = False`.
   One setup doc + three unit files, roughly.
4. **Hardware bring-up.** `gpio_listener.py` is written but has never touched
   real hardware. Coin-pulse detection and PIR sensitivity both need bench
   testing before the enclosure gets sealed.

## High value, not blocking

5. **Admin/stats page.** A `/admin` route (behind nothing fancy — it's a
   bathroom appliance) showing: each joke's ratings table sorted by score, plays
   per category, total quarters inserted ("Dad has earned $12.50"). The data
   for ratings already exists in `ratings.json`; coin counting needs one
   counter added to the coin-insert endpoint.
6. **Recently-played memory.** The weighted picker can hand two back-to-back
   customers overlapping jokes. Persist the last ~15 played per category and
   exclude them from the next session's sample (fall back gracefully when the
   pool is small).
7. **Attract mode.** When the PIR sees motion but no coin arrives within ~10s,
   play a short barker line in the New York Jokester voice ("Hey pal — got a
   quarter or what?"). Cheap to generate, very on-theme, probably doubles
   revenue from foot traffic.
8. **Coin credit ledger.** Two quarters inserted quickly = should queue a
   second session (or extend to 10 jokes), not vanish. Also a free-play
   toggle for parties.

## Nice to have

9. **Volume control / quiet hours** — admin-set volume; bathrooms are echoey.
10. **Auto-curation of Mixed Nuts** — periodically rebuild the Mixed Nuts
    lineup from the top-rated jokes across the other three categories, so the
    grab-bag becomes a genuine "greatest hits" over time.
11. **More laugh-track variety** — 3-4 laugh clips, picked at random, plus a
    rare "single sad clap" for jokes trending meh. Comedy gold.
12. **Joke pack refresh cadence** — the JOKE-BANK.md pipeline works; decide
    how often new jokes rotate in (e.g., swap the 5 lowest-rated quarterly).

---

# Category Art — Midjourney brief

The four menu cells currently show hand-drawn SVG placeholders. The app
auto-upgrades: drop a PNG named `cat-<id>.png` into `software/static/img/`
and it replaces the placeholder instantly (the `<img>` tries PNG first,
falls back to SVG). No code changes needed.

**Files:** `cat-dad.png`, `cat-family.png`, `cat-dirty.png`, `cat-mixed.png`
**Aspect:** cells render at ~340×112 — generate at `--ar 3:1` and crop
horizontally centered. Keep the main character centered; edges get trimmed.

**Shared style suffix for all four prompts** (append to each):

> , 1970s underground comix style, hand-inked bold outlines, flat retro
> color palette of mustard yellow avocado green rust red burnt orange on
> aged cream paper, halftone dot shading, vintage print misregistration,
> slightly sleazy dive bar poster art, no text --ar 3:1 --v 6

**Per-category prompts:**

- **cat-dad.png** — "middle-aged cartoon man with enormous mustache and
  smoking pipe, winking, wearing a loud plaid blazer, mid-laugh at his own
  joke"
- **cat-family.png** — "goofy grinning cartoon kid in a propeller beanie
  holding a whoopee cushion, wholesome mischief"
- **cat-dirty.png** — "sultry retro cartoon fox lady in a cocktail dress
  leaning on a bar with a martini, cheeky wink, suggestive but tasteful,
  Vargas-pinup-meets-underground-comix"
- **cat-mixed.png** — "anthropomorphic peanut character in a bowtie doing
  stand-up comedy at a microphone under a spotlight, vaudeville energy"

Tip: since Midjourney can't reliably keep a consistent style across separate
generations, generate all four in one session and reuse the seed
(`--seed N`) from the first result you like, or use style reference
(`--sref`) pointing at the first accepted image.
