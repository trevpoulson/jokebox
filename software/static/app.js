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
let appSettings = { volume: 1.0, free_play: false };
let currentCategory = null;
let currentIndex = 0;      // the joke's real index within its category (for audio/rating lookups)
let sessionIndices = [];   // the (weighted-random) subset of indices picked for this playthrough
let sessionPos = 0;        // position within sessionIndices
let hasVotedThisJoke = false;
let credits = 0;           // extra quarters banked while a session is already running
let sleepTimer = null;
let watchdogTimer = null;
let attractTimer = null;   // barker timer: motion seen, but no coin yet
let lastBarkerAt = 0;      // cooldown so the barker doesn't heckle nonstop
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
const ATTRACT_DELAY_MS = 12000;         // motion seen but no coin → barker pipes up after this long
const ATTRACT_COOLDOWN_MS = 90000;      // minimum time between barker lines, so he doesn't heckle nonstop
const DEMO_ATTRACT_INTERVAL_MS = 10000; // standalone demo: barker pitches this often on the idle screen

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
  [...LAUGH_CLIPS, ...BARKER_CLIPS, SAD_CLAP_CLIP].forEach((u) =>
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

// fire-and-forget play of a cached one-shot clip (laughs, barker lines)
function playOneShot(url) {
  if (!audioCtx) return;
  loadClip(url).then((buffer) => playBuffer(buffer)).catch(() => {});
}

// Reaction after a punchline. Usually a randomly-picked laugh track, but a
// joke that's earned a genuinely bad rating sometimes gets the lone slow
// clap instead — the crowd has spoken.
function playReaction(counts) {
  const badlyRated = jokeWeight(counts) <= SAD_CLAP_WEIGHT_CUTOFF;
  if (badlyRated && Math.random() < 0.5) {
    playOneShot(SAD_CLAP_CLIP);
  } else {
    playOneShot(LAUGH_CLIPS[Math.floor(Math.random() * LAUGH_CLIPS.length)]);
  }
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
  clearTimeout(attractTimer);
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
  const recent = new Set(recentData[currentCategory] || []);
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
    punchlineEl.textContent = joke.punchline;
    punchlineEl.classList.remove("visible");
    progressEl.textContent = `${sessionPos + 1} / ${sessionIndices.length}`;
    progressFill.style.transition = "none";
    progressFill.style.width = "0%";
    resetRatingButtons();

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

    playReaction(ratingsData[`${currentCategory}:${currentIndex}`]);
    await runGapBar(GAP_MS);
    if (myToken !== sessionToken) return;
  }

  clearTimeout(watchdogTimer);
  showScreen("done");
  await sleep(DONE_DISPLAY_MS);
  if (myToken !== sessionToken) return;
  // a quarter banked mid-session buys the next round immediately
  if (credits > 0) {
    credits--;
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

function onCoinInserted() {
  clearTimeout(sleepTimer);
  clearTimeout(attractTimer);
  // A quarter dropped mid-session banks a credit for the next round
  // instead of interrupting the jokes already playing.
  if (screens.joke.classList.contains("active") || screens.done.classList.contains("active")) {
    credits++;
    return;
  }
  // Otherwise (asleep/idle/menu) it starts a round: straight to the
  // menu — the acceptor stays powered even while the screen sleeps.
  playLaughter();
  showScreen("menu");
}

function onMotionDetected() {
  // Motion only matters if we're currently asleep — if someone's
  // already at the idle/menu/joke screens this just no-ops.
  if (!screens.asleep.classList.contains("active")) return;
  goIdle();
  // Someone walked up but hasn't paid: after a beat, the barker makes
  // his pitch (with a long cooldown so he doesn't heckle the sink line).
  clearTimeout(attractTimer);
  attractTimer = setTimeout(() => {
    const idleOrMenu = screens.idle.classList.contains("active") || screens.menu.classList.contains("active");
    if (idleOrMenu && Date.now() - lastBarkerAt > ATTRACT_COOLDOWN_MS) {
      lastBarkerAt = Date.now();
      playOneShot(BARKER_CLIPS[Math.floor(Math.random() * BARKER_CLIPS.length)]);
    }
  }, ATTRACT_DELAY_MS);
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
document.addEventListener("click", () => {
  unlockAudio();
  if (screens.idle.classList.contains("active")) {
    armSleepTimer();
    // free-play mode: no coin needed, tapping the idle screen opens the menu
    if (appSettings.free_play) {
      clearTimeout(sleepTimer);
      showScreen("menu");
    }
  }
});
// pointerdown fires before click and on the touch itself — Safari is
// happiest when the unlock happens inside the earliest gesture event
document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("touchstart", unlockAudio, { passive: true });

// (No JS scaling — the layout is fluid: the stylesheet ties the root
// font-size to the viewport and sizes everything in rem, so the design
// re-flows crisply at any screen size.)

// Standalone demo: no motion sensor, so the barkers work the room on a
// timer instead — a random pitch every few seconds while the idle screen
// is up. (Silent until the first tap unlocks browser audio.)
if (STATIC_DEMO) {
  setInterval(() => {
    if (screens.idle.classList.contains("active")) {
      playOneShot(BARKER_CLIPS[Math.floor(Math.random() * BARKER_CLIPS.length)]);
    }
  }, DEMO_ATTRACT_INTERVAL_MS);
}

initAudio(); // starts loading/decoding sfx clips immediately; doesn't need a gesture
loadSessionContext(); // volume + free-play settings, applied as soon as they arrive
loadJokes().then(() => {
  preloadJokeAudio();
  goIdle();
  connectEvents();
});
