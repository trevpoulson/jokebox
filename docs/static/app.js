// Joke Box kiosk UI
// State machine: asleep -> idle -> menu -> joke (x5, fully automatic) -> done -> idle
//   asleep: screen off/blank, low power. Woken by motion OR a coin
//           (the coin acceptor & motion sensor both stay powered even
//           while the screen sleeps).
//   idle:   "Insert Quarter" shown. Goes back to asleep if no motion
//           is seen for a while (nobody's actually standing there).
//   joke:   fully hands-off after the category tap — setup line reads,
//           a beat of silence, punchline reveals, canned laughter,
//           then a short progress bar before the next joke.
// Events arrive over SSE from /api/events, fired either by the dev
// "simulate" buttons (Mac testing) or by the Pi's gpio_listener.py
// reading the real coin acceptor / PIR motion sensor.

const screens = {
  asleep: document.getElementById("screen-asleep"),
  idle: document.getElementById("screen-idle"),
  menu: document.getElementById("screen-menu"),
  joke: document.getElementById("screen-joke"),
  done: document.getElementById("screen-done"),
};

const setupEl = document.getElementById("joke-setup");
const punchlineEl = document.getElementById("joke-punchline");
const progressEl = document.getElementById("joke-progress");
const progressFill = document.getElementById("progress-fill");
const ratingRowEl = document.getElementById("rating-row");
const rateButtons = document.querySelectorAll(".rate-btn");

let jokesData = null;
let ratingsData = {}; // "<category>:<index>" -> {meh, smirk, laugh}, refetched each session
let recentData = {};  // "<category>" -> [recently played indices], server-persisted
let appSettings = { volume: 1.0, free_play: false, attract_interval: 10 };
let currentCategory = null;
let currentIndex = 0;      // the joke's real index within its category (for audio/rating lookups)
let sessionIndices = [];   // the (weighted-random) subset of indices picked for this playthrough
let sessionPos = 0;        // position within sessionIndices
let hasVotedThisJoke = false;
let credits = 0;           // extra quarters banked while a session is already running
let sleepTimer = null;
let watchdogTimer = null;
let lastBarkerAt = 0;      // last barker pitch — the attract loop waits a full
                           // interval from this before the next one
let sessionToken = 0; // bumped whenever we leave the joke screen, so any
                       // in-flight async joke sequence knows to stop

const SLEEP_AFTER_NO_MOTION_MS = 20000; // idle screen: go back to sleep after 20s of no motion (tune up for the real device)
const PUNCHLINE_PAUSE_MS = 900;         // dramatic beat between setup and punchline
const GAP_MS = 3200;                    // progress bar duration between jokes (covers the laugh clip)
const DONE_DISPLAY_MS = 4500;           // how long "Thanks!" shows before returning to idle
const JOKE_SESSION_WATCHDOG_MS = 90000; // safety net: force back to idle if something hangs mid-session
const SESSION_JOKE_COUNT = 5;           // jokes played per quarter — matches the original "five jokes" design
const MIN_VOTES_BEFORE_WEIGHTING = 3;   // a joke needs this many votes before ratings affect its odds —
                                        // one bad tap shouldn't demote a joke it just got unlucky once
const CLIENT_RECENT_MEMORY = 50;        // jokes/category remembered IN THE BROWSER to avoid repeats

// Client-side recently-played memory (localStorage). This is what stops
// repeats on the static demo (no server to persist to) AND closes a race
// on the real kiosk: the server's joke-played POST is fire-and-forget, so
// a quick next session could read a stale recent list — this list is
// updated synchronously as each joke plays, with no network round-trip.
const CLIENT_RECENT_KEY = "jb_recent";
function loadClientRecent() {
  try { return JSON.parse(localStorage.getItem(CLIENT_RECENT_KEY)) || {}; }
  catch (e) { return {}; }
}
function pushClientRecent(category, index) {
  const all = loadClientRecent();
  const list = (all[category] || []).filter((i) => i !== index);
  list.push(index);
  all[category] = list.slice(-CLIENT_RECENT_MEMORY);
  try { localStorage.setItem(CLIENT_RECENT_KEY, JSON.stringify(all)); } catch (e) {}
}
// Attract-mode cadence lives in appSettings.attract_interval (seconds,
// admin-configurable, default 10, 0 = off) — see the attract loop below.

// STATIC_DEMO is set by the GitHub Pages build (see scripts/build-demo.sh):
// no server, no sensors — the demo never sleeps and barks on a timer
// instead of reacting to motion.
const STATIC_DEMO = !!window.STATIC_DEMO;
const SAD_CLAP_WEIGHT_CUTOFF = 0.5;     // jokes rated this badly sometimes get the slow clap instead
// The attract-mode pool — all four personas take turns making the pitch
// (Sal the peanut has the most lines; he's the MC). Who says what is
// documented in PERSONAS.md at the project root.
const BARKER_CLIPS = Array.from({ length: 13 }, (_, i) => `static/audio/barker${i + 1}.mp3`);
const LAUGH_CLIPS = ["static/audio/laugh.mp3", "static/audio/laugh2.mp3", "static/audio/laugh3.mp3"];
const SAD_CLAP_CLIP = "static/audio/sadclap.mp3";
const CLINK_CLIP = "static/audio/clink.mp3"; // quarter hitting the coin box
// The canonical response to a dad joke isn't laughter — it's the groan.
// Earl's punchlines mostly earn groans, playful boos, or a rimshot.
const DAD_REACTION_CLIPS = [
  "static/audio/groan1.mp3",
  "static/audio/groan2.mp3",
  "static/audio/boo.mp3",
  "static/audio/rimshot.mp3",
];

// Turns a joke's vote counts into a selection weight. Below the vote
// threshold every joke is neutral (weight 1) so a joke doesn't get
// buried after a single meh. Once it has enough votes, laughs raise
// the weight, mehs lower it — but never to zero, so a poorly-rated
// joke still shows up occasionally rather than disappearing outright.
function jokeWeight(counts) {
  if (!counts) return 1.0;
  const total = (counts.meh || 0) + (counts.smirk || 0) + (counts.laugh || 0);
  if (total < MIN_VOTES_BEFORE_WEIGHTING) return 1.0;
  const raw = ((counts.laugh || 0) * 2 + (counts.smirk || 0) * 1 - (counts.meh || 0) * 1.5) / total;
  return Math.min(3.0, Math.max(0.2, 1.0 + raw));
}

// Weighted random sample without replacement — picks `k` distinct
// indices from `items`, favoring higher weights, roulette-wheel style.
function weightedSample(items, weights, k) {
  const pool = items.map((it, i) => ({ it, w: weights[i] }));
  const picked = [];
  while (picked.length < k && pool.length > 0) {
    const totalWeight = pool.reduce((sum, p) => sum + p.w, 0);
    let r = Math.random() * totalWeight;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= pool[i].w;
      if (r <= 0) break;
    }
    picked.push(pool[i].it);
    pool.splice(i, 1);
  }
  return picked;
}

// Laughter plays via the Web Audio API rather than a plain <audio>
// element. A coin insert has no browser "user gesture" behind it at all
// (it's a real hardware event on the Pi), and even the punchline
// laughter — several `await`s downstream of the category tap — can
// outlive how long Safari/Chrome consider that original tap "fresh".
// Web Audio sidesteps this: unlock the AudioContext once on the first
// tap anywhere on the page, and every start() after that plays
// regardless of what triggered it, gesture or not.
let audioCtx = null;
let masterGain = null; // admin-set volume applies here, upstream of every clip
const clipCache = new Map(); // url -> decoded AudioBuffer, so replays/preloads don't re-fetch

function jokeClipUrl(categoryId, index, part) {
  const n = String(index + 1).padStart(2, "0"); // files are 01_setup.mp3, 01_punchline.mp3, ...
  return `static/audio/jokes/${categoryId}/${n}_${part}.mp3`;
}

function loadClip(url) {
  if (clipCache.has(url)) return clipCache.get(url);
  const promise = fetch(url)
    .then((res) => res.arrayBuffer())
    .then((buf) => audioCtx.decodeAudioData(buf));
  clipCache.set(url, promise);
  return promise;
}

function initAudio() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = appSettings.volume;
  masterGain.connect(audioCtx.destination);
  [...LAUGH_CLIPS, ...BARKER_CLIPS, ...DAD_REACTION_CLIPS, SAD_CLAP_CLIP, CLINK_CLIP].forEach((u) =>
    loadClip(u).catch((e) => console.warn("sfx failed to load", u, e))
  );
}

function applyVolume() {
  if (masterGain) masterGain.gain.value = appSettings.volume;
}

// Fetches/decodes every joke clip up front so playback during the actual
// sequence has zero latency — the files are small (190 clips, a few MB
// total), and startCategory() shouldn't be waiting on network round-trips
// mid-joke.
function preloadJokeAudio() {
  if (!jokesData) return;
  const urls = [];
  for (const [catId, cat] of Object.entries(jokesData)) {
    cat.jokes.forEach((_, i) => {
      urls.push(jokeClipUrl(catId, i, "setup"));
      urls.push(jokeClipUrl(catId, i, "punchline"));
    });
  }
  urls.forEach((u) => loadClip(u).catch((e) => console.warn("joke clip failed to preload", u, e)));
}

let audioUnlocked = false;

function unlockAudio() {
  if (!audioCtx) return;
  if (audioCtx.state !== "running") audioCtx.resume();
  // Safari only truly unlocks audio after a buffer is *played* from inside
  // a user gesture — resume() alone isn't enough. Playing one silent sample
  // here is the canonical fix; every later start() then works, even ones
  // triggered by timers or network events (like a real coin insert).
  if (!audioUnlocked) {
    try {
      const silent = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = silent;
      src.connect(audioCtx.destination);
      src.start(0);
      audioUnlocked = true;
    } catch (e) {
      // leave audioUnlocked false so the next gesture retries
    }
  }
}

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
  // barkers only pitch on the idle screen — leaving it for any reason
  // (coin in, category tap, sleep) fades an in-progress pitch out fast
  if (name !== "idle") stopBarker();
  // the asleep screen should black out the whole window, letterbox included
  document.body.classList.toggle("asleep", name === "asleep");
  // report sleep state so pi_display.py can cut the physical backlight —
  // a black web page alone doesn't save any power
  fetch("api/screen-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asleep: name === "asleep" }),
  }).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let currentSource = null; // the currently-playing joke clip (not laughter — that's fine to let finish)

function stopCurrentPlayback() {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch (e) {
      // already stopped/ended — fine to ignore
    }
    currentSource = null;
  }
}

function playBuffer(buffer) {
  if (audioCtx.state !== "running") audioCtx.resume();
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(masterGain);
  src.start(0);
  return src;
}

// fire-and-forget play of a cached one-shot clip (laughs, sad clap)
function playOneShot(url) {
  if (!audioCtx) return;
  loadClip(url).then((buffer) => playBuffer(buffer)).catch(() => {});
}

// Barker pitches get their own gain node so an in-progress line can be
// faded out fast the moment someone drops a coin — nothing kills the
// mood like being talked over by your own barker.
let currentBarker = null; // {src, gain} of the pitch playing right now

function playBarker(url) {
  if (!audioCtx) return;
  loadClip(url)
    .then((buffer) => {
      stopBarker(0); // never two pitches at once
      if (audioCtx.state !== "running") audioCtx.resume();
      const gain = audioCtx.createGain();
      gain.connect(masterGain);
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.start(0);
      const handle = { src, gain };
      currentBarker = handle;
      src.onended = () => {
        if (currentBarker === handle) currentBarker = null;
      };
    })
    .catch(() => {});
}

function stopBarker(fadeMs = 200) {
  if (!currentBarker) return;
  const { src, gain } = currentBarker;
  currentBarker = null;
  try {
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    src.stop(now + fadeMs / 1000 + 0.02);
  } catch (e) {
    try { src.stop(); } catch (e2) { /* already ended */ }
  }
}

// Reaction after a punchline. Most categories get a laugh track; dad
// jokes mostly earn what dad jokes deserve — groans, playful boos, and
// the occasional rimshot (tongue-in-cheek, laughs still sneak in). A
// joke with a genuinely bad rating sometimes gets the lone slow clap.
function playReaction(category, counts) {
  const badlyRated = jokeWeight(counts) <= SAD_CLAP_WEIGHT_CUTOFF;
  if (badlyRated && Math.random() < 0.5) {
    playOneShot(SAD_CLAP_CLIP);
    return;
  }
  if (category === "dad" && Math.random() < 0.75) {
    playOneShot(DAD_REACTION_CLIPS[Math.floor(Math.random() * DAD_REACTION_CLIPS.length)]);
    return;
  }
  playOneShot(LAUGH_CLIPS[Math.floor(Math.random() * LAUGH_CLIPS.length)]);
}

function playLaughter() {
  playOneShot(LAUGH_CLIPS[0]);
}

// Resolves once the recorded clip finishes playing. Falls back to a
// generous timeout (well past the clip's own duration) so a missing
// file or a browser onended quirk can never hang the whole sequence —
// the joke would just silently skip to the next line/screen instead.
async function playClipAsync(url) {
  let buffer;
  try {
    buffer = await loadClip(url);
  } catch (e) {
    console.warn("joke clip missing, skipping", url, e);
    return;
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const src = playBuffer(buffer);
    currentSource = src;
    src.onended = () => {
      if (currentSource === src) currentSource = null;
      finish();
    };
    setTimeout(finish, buffer.duration * 1000 + 2000);
  });
}

function runGapBar(durationMs) {
  progressFill.style.transition = "none";
  progressFill.style.width = "0%";
  void progressFill.offsetWidth; // force reflow so the reset actually applies
  progressFill.style.transition = `width ${durationMs}ms linear`;
  requestAnimationFrame(() => {
    progressFill.style.width = "100%";
  });
  return sleep(durationMs);
}

function armSleepTimer() {
  if (STATIC_DEMO) return; // the demo has no motion sensor to wake it — stay lit
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    if (screens.idle.classList.contains("active")) showScreen("asleep");
  }, SLEEP_AFTER_NO_MOTION_MS);
}

function goIdle() {
  clearTimeout(watchdogTimer);
  sessionToken++; // invalidate any in-flight joke sequence
  stopCurrentPlayback(); // cut off audio immediately rather than letting it finish
  showScreen("idle");
  lastBarkerAt = Date.now(); // attract loop waits a full interval from here
  armSleepTimer();
}

async function loadJokes() {
  const res = await fetch("api/jokes");
  jokesData = await res.json();
}

async function loadSessionContext() {
  try {
    const res = await fetch("api/session-context");
    const ctx = await res.json();
    ratingsData = ctx.ratings || {};
    recentData = ctx.recent || {};
    appSettings = { ...appSettings, ...(ctx.settings || {}) };
    applyVolume();
  } catch (e) {
    console.warn("failed to load session context, using neutral defaults", e);
    ratingsData = {};
    recentData = {};
  }
}

async function startCategory(categoryId) {
  clearTimeout(sleepTimer);
  currentCategory = categoryId;
  sessionToken++;
  const myToken = sessionToken;

  await loadSessionContext(); // fresh votes/recents/settings before picking jokes
  if (myToken !== sessionToken) return;

  const cat = jokesData[currentCategory];
  const allIndices = cat.jokes.map((_, i) => i);
  // Admin can pull individual jokes from rotation. If somehow every joke
  // in a category is disabled, fall back to all of them rather than
  // dead-ending the kiosk (the admin page says to disable the category
  // for that).
  const disabled = new Set(appSettings.disabled_jokes || []);
  let base = allIndices.filter((i) => !disabled.has(`${currentCategory}:${i}`));
  if (base.length === 0) base = allIndices;
  // Exclude recently-played jokes so back-to-back customers don't hear
  // repeats — but only when the category still has enough left to fill
  // a session after excluding them.
  // Union of the server's recent list and the browser's own — the client
  // list is authoritative on the demo and closes the fire-and-forget race
  // on the kiosk (see pushClientRecent).
  const clientRecent = loadClientRecent()[currentCategory] || [];
  const recent = new Set([...(recentData[currentCategory] || []), ...clientRecent]);
  let pool = base.filter((i) => !recent.has(i));
  if (pool.length < SESSION_JOKE_COUNT) pool = base;
  const weights = pool.map((i) => jokeWeight(ratingsData[`${currentCategory}:${i}`]));
  sessionIndices = weightedSample(pool, weights, Math.min(SESSION_JOKE_COUNT, pool.length));
  sessionPos = 0;

  fetch("api/session-start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: currentCategory }),
  }).catch(() => {});

  clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    if (myToken === sessionToken) goIdle();
  }, JOKE_SESSION_WATCHDOG_MS);

  showScreen("joke");
  await playJokeSequence(myToken);
}

function resetRatingButtons() {
  hasVotedThisJoke = false;
  ratingRowEl.classList.remove("visible");
  rateButtons.forEach((btn) => {
    btn.classList.remove("voted");
    btn.disabled = false;
  });
}

async function playJokeSequence(myToken) {
  const cat = jokesData[currentCategory];

  for (sessionPos = 0; sessionPos < sessionIndices.length; sessionPos++) {
    if (myToken !== sessionToken) return; // user/system left this session

    currentIndex = sessionIndices[sessionPos];
    const joke = cat.jokes[currentIndex];
    setupEl.textContent = joke.setup;
    // Hide instantly (no fade-out) BEFORE swapping the text — otherwise
    // the 0.35s opacity transition briefly shows the NEW punchline fading away.
    punchlineEl.style.transition = "none";
    punchlineEl.classList.remove("visible");
    punchlineEl.textContent = joke.punchline;
    void punchlineEl.offsetWidth;        // flush styles so the hide applies now
    punchlineEl.style.transition = "";   // restore the fade for the reveal
    progressEl.textContent = `${sessionPos + 1} / ${sessionIndices.length}`;
    progressFill.style.transition = "none";
    progressFill.style.width = "0%";
    resetRatingButtons();

    pushClientRecent(currentCategory, currentIndex); // synchronous, works offline
    fetch("api/joke-played", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: currentCategory, index: currentIndex }),
    }).catch(() => {});

    await playClipAsync(jokeClipUrl(currentCategory, currentIndex, "setup"));
    if (myToken !== sessionToken) return;

    await sleep(PUNCHLINE_PAUSE_MS);
    if (myToken !== sessionToken) return;

    punchlineEl.classList.add("visible");
    ratingRowEl.classList.add("visible"); // rate after hearing the whole joke, not before
    await playClipAsync(jokeClipUrl(currentCategory, currentIndex, "punchline"));
    if (myToken !== sessionToken) return;

    playReaction(currentCategory, ratingsData[`${currentCategory}:${currentIndex}`]);
    await runGapBar(GAP_MS);
    if (myToken !== sessionToken) return;
  }

  clearTimeout(watchdogTimer);
  showScreen("done");
  await sleep(DONE_DISPLAY_MS);
  if (myToken !== sessionToken) return;
  // a banked quarter buys the next round immediately — right back to
  // the joke selection screen
  if (credits > 0) {
    credits--;
    updateCreditsUI();
    playLaughter();
    showScreen("menu");
  } else {
    goIdle();
  }
}

function rateCurrentJoke(rating) {
  if (hasVotedThisJoke) return;
  hasVotedThisJoke = true;
  rateButtons.forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.rating === rating) btn.classList.add("voted");
  });
  fetch("api/rate-joke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: currentCategory, index: currentIndex, rating }),
  }).catch((e) => console.warn("failed to submit rating", e));
}

rateButtons.forEach((btn) => {
  btn.addEventListener("click", () => rateCurrentJoke(btn.dataset.rating));
});

// keeps the on-screen ticket in sync with banked quarters
function updateCreditsUI() {
  const el = document.getElementById("credit-counter");
  if (!el) return;
  el.textContent = `CREDITS × ${credits}`;
  el.classList.toggle("visible", credits > 0);
}

function onCoinInserted() {
  clearTimeout(sleepTimer);
  playOneShot(CLINK_CLIP); // satisfying clink, every single time
  // From idle/asleep, this quarter starts a round directly — straight to
  // the menu (the acceptor stays powered even while the screen sleeps).
  if (screens.idle.classList.contains("active") || screens.asleep.classList.contains("active")) {
    playLaughter();
    showScreen("menu");
    return;
  }
  // Anywhere else (menu, mid-jokes, thanks screen) the quarter banks a
  // credit for another round instead of interrupting anything.
  credits++;
  updateCreditsUI();
}

function onMotionDetected() {
  // Motion only matters if we're currently asleep — if someone's
  // already at the idle/menu/joke screens this just no-ops. The attract
  // loop below takes over once the idle screen is up.
  if (!screens.asleep.classList.contains("active")) return;
  goIdle();
}

function connectEvents() {
  if (STATIC_DEMO) return; // no server to stream from
  const source = new EventSource("api/events");
  source.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "coin_inserted") onCoinInserted();
    if (data.type === "motion_detected") onMotionDetected();
  };
  source.onerror = () => {
    // browser auto-reconnects EventSource; nothing to do here
  };
}

document.getElementById("category-grid").addEventListener("click", (e) => {
  const btn = e.target.closest(".category-btn");
  if (btn) startCategory(btn.dataset.category);
});

// Until the real coin acceptor is wired up, tapping the bouncing 25¢
// coin on the idle screen stands in for inserting a quarter. Gated on
// dev mode so flipping DEV_MODE off for the real device kills it —
// production coins must come from the acceptor via gpio_listener.py.
const coinBadge = document.getElementById("coin-badge");
if (coinBadge && document.body.dataset.dev === "1") {
  coinBadge.addEventListener("click", () => {
    if (STATIC_DEMO) {
      onCoinInserted();
    } else {
      fetch("api/coin-insert", { method: "POST" }).catch(() => {});
    }
  });
}

// Invisible dev shortcuts (dev builds only, needs a keyboard):
//   m = simulate motion   s = stop jokes / back to idle   a = open admin
// The visible dev bar is gone; the coin badge handles quarters.
if (document.body.dataset.dev === "1") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "m") {
      if (STATIC_DEMO) onMotionDetected();
      else fetch("api/motion-detected", { method: "POST" }).catch(() => {});
    }
    if (e.key === "s") goIdle();
    if (e.key === "a" && !STATIC_DEMO) window.open("admin", "_blank");
  });
}

// Any interaction on the idle screen also counts as "someone's still
// there" so it doesn't fall asleep mid-read of the coin slot, etc.
// Every click also tries to unlock/resume the audio context — cheap
// no-op once it's already running, but this is what lets a coin
// insert later in the session (no gesture of its own) still play its
// laugh, since the context was unlocked by an earlier real tap.
document.addEventListener("click", (e) => {
  unlockAudio();
  // taps on the staff key or PIN pad are admin business — they shouldn't
  // trigger free-play or fight the pad's own sleep handling
  if (e.target.closest("#pin-overlay, #admin-key")) return;
  if (screens.idle.classList.contains("active")) {
    armSleepTimer();
    // free-play mode: no coin needed, tapping the idle screen opens the menu
    if (appSettings.free_play) {
      clearTimeout(sleepTimer);
      showScreen("menu");
    }
  }
});

// ---- staff PIN pad → admin page ----
const pinOverlay = document.getElementById("pin-overlay");
const adminKey = document.getElementById("admin-key");
let pinEntry = "";

function renderPinDots() {
  document.querySelectorAll(".pin-dots span").forEach((d, i) => {
    d.classList.toggle("filled", i < pinEntry.length);
  });
}

function openPinPad() {
  pinEntry = "";
  renderPinDots();
  pinOverlay.classList.remove("hidden");
  clearTimeout(sleepTimer); // don't fall asleep mid-entry
}

function closePinPad() {
  pinOverlay.classList.add("hidden");
  if (screens.idle.classList.contains("active")) armSleepTimer();
}

async function submitPin() {
  try {
    const res = await fetch("api/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinEntry }),
    });
    if ((await res.json()).ok) {
      window.location.href = "admin";
      return;
    }
  } catch (e) {
    // server unreachable — treat like a wrong PIN
  }
  const card = pinOverlay.querySelector(".pin-card");
  card.classList.add("shake");
  setTimeout(() => {
    card.classList.remove("shake");
    pinEntry = "";
    renderPinDots();
  }, 450);
}

if (adminKey) {
  if (STATIC_DEMO) {
    adminKey.style.display = "none"; // no admin page exists in the demo
  } else {
    adminKey.addEventListener("click", openPinPad);
  }
}

if (pinOverlay) {
  pinOverlay.addEventListener("click", (e) => {
    if (e.target === pinOverlay) { closePinPad(); return; } // tap the scrim to bail
    const btn = e.target.closest(".pin-btn");
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === "close") {
      closePinPad();
    } else if (key === "clear") {
      pinEntry = "";
      renderPinDots();
    } else if (pinEntry.length < 4) {
      pinEntry += key;
      renderPinDots();
      if (pinEntry.length === 4) submitPin();
    }
  });
}
// pointerdown fires before click and on the touch itself — Safari is
// happiest when the unlock happens inside the earliest gesture event
document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("touchstart", unlockAudio, { passive: true });

// Safari can restore this page from its back-forward cache (e.g. after a
// staff trip to /admin and back) with a dead AudioContext — jokes then
// advance on schedule but play silently. A bfcache-restored page reloads
// itself fresh so audio always starts from a working state.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) window.location.reload();
});
// belt and braces: whenever the tab becomes visible again, nudge the
// audio engine back awake
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) unlockAudio();
});

// (No JS scaling — the layout is fluid: the stylesheet ties the root
// font-size to the viewport and sizes everything in rem, so the design
// re-flows crisply at any screen size.)

// Attract mode: while the idle screen is up, a barker makes the pitch
// every `attract_interval` seconds (House Settings in /admin; default 10,
// 0 turns it off). One loop serves both the kiosk and the standalone
// demo. Presence gating: on the real device the idle screen is itself
// motion-gated (asleep until the PIR fires), so idle == someone's there;
// in a browser, only bark while the tab is focused and visible — a
// background tab shouldn't be pitching to nobody.
setInterval(() => {
  const secs = Number(appSettings.attract_interval);
  if (!secs || secs <= 0) return;
  if (!screens.idle.classList.contains("active")) return;
  if (document.hidden || !document.hasFocus()) return;
  if (Date.now() - lastBarkerAt < secs * 1000) return;
  lastBarkerAt = Date.now();
  playBarker(BARKER_CLIPS[Math.floor(Math.random() * BARKER_CLIPS.length)]);
}, 1000);

initAudio(); // starts loading/decoding sfx clips immediately; doesn't need a gesture
loadSessionContext(); // volume + free-play settings, applied as soon as they arrive
const bootedAt = Date.now();
loadJokes().then(() => {
  preloadJokeAudio();
  goIdle();
  connectEvents();
  // Splash: keep the logo up at least a beat (it IS the loading screen,
  // but jokes.json loads fast on localhost), then FLY the big splash logo
  // down into the idle screen's logo — same image, so when the flight
  // lands the two are pixel-identical and the swap is invisible.
  const splash = document.getElementById("splash");
  if (splash) {
    const minShowMs = 1200;
    setTimeout(() => {
      const img = splash.querySelector("img");
      const target = document.getElementById("idle-logo");
      if (img && target) {
        img.style.animation = "none"; // stop the pulse mid-cycle for a clean flight
        // Only ONE logo on screen during the flight: the idle screen's own
        // copy stays hidden until the splash copy lands on top of it.
        target.style.visibility = "hidden";
        const a = img.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
        const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
        img.style.transition = "transform 0.65s cubic-bezier(0.4, 0, 0.2, 1)";
        img.style.transform = `translate(${dx}px, ${dy}px) scale(${b.height / a.height})`;
      }
      splash.style.background = "transparent"; // idle screen shows through during the flight
      setTimeout(() => {
        if (target) target.style.visibility = ""; // swap: idle copy takes over...
        splash.remove();                          // ...the instant the flyer vanishes
      }, 700);
    }, Math.max(0, minShowMs - (Date.now() - bootedAt)));
  }
});
