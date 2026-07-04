# The Jokesters — Persona Bible

The four residents of the Joke Box. Every line of audio the machine
speaks — jokes, barker pitches, future material — should be written *in
character* for whoever's voice delivers it. This file is the reference
for who they are.

Shared world: they're the house acts of a dive-bar bathroom cabaret.
They know they live in a box above a urinal. They're not ashamed of it —
it's showbiz, and this is their stage.

Writing rules (all four): content policy in `jokebox-joke-standards`
memory still applies — nothing derogatory toward women or any minority
group; ribbing men and mutual husband/wife stuff is fine; risqué is fine
for Roxie, crude-for-crude's-sake isn't. Lines should read aloud in
under ~8 seconds for barker material.

---

## Earl — Dad Jokes
**Voice:** Redneck Jokester (`3kNgjGCTRTDSBwXeGTxi`) · **Art:** the mustachioed old man in the plaid blazer

Retired hillbilly granddad. Sat on the same barstool for forty years and
has a joke for every occasion, most of them older than the bar. Deadpan
delivery — he never laughs at the setup, but can't quite keep the grin
out of the punchline. Thinks every joke he tells is a certified classic
because, dammit, it is. Smokes a pipe. Refers to strangers as "son,"
"young feller," or "friend."

- **Delivery:** slow, dry, unhurried. `[deadpan]` setups, `[amused]` punchlines.
- **Humor:** puns, wordplay, "I used to..." misdirection. Corn is the point.
- **Says things like:** "Simplest deal you'll get all week." / "That one's aged like fine milk."
- **Never:** hyper, edgy, mean. Earl has all the time in the world.

**Attract lines (in the pool):**
- barker4 — "Well don't just stand there, son. Quarter goes in the slot, jokes come out. Simplest deal you'll get all week."
- barker5 — "I got jokes older than you in here, and they still work better than my knees. Twenty-five cents."

---

## Scooter — Family Friendly
**Voice:** man jokester (`Cp0ZE0I4L3ukiZ9kdOyE`) · **Art:** the gap-toothed kid with the propeller beanie and whoopee cushion

The eternal class clown. A grown-up voice with a ten-year-old's soul —
propeller beanie, whoopee cushion always at the ready, physically unable
to keep a straight face through his own punchline. Every joke is THE
FUNNIEST THING EVER. Wholesome mischief only; the worst thing Scooter
has ever done is put a rubber spider in the teacher's desk.

- **Delivery:** fast, bouncy, giggly. `[playful]` setups, `[laughing]` punchlines.
- **Humor:** animal puns, food puns, playground riddles. Groaners delivered with total sincerity.
- **Says things like:** "Wanna hear something funny? Of course you do. Everybody does!"
- **Never:** sarcastic, world-weary, anything a kid couldn't repeat at dinner.

**Attract lines (in the pool):**
- barker6 — "Hey! Psst! Wanna hear something funny? Of course you do. Everybody does. One quarter!"
- barker7 — "I've been practicing these ALL day. Come on, one quarter. You won't regret it. Okay, you might. But probably not!"

---

## Roxie — Adults Only
**Voice:** woman jokester (`zqGajppWAKPE9z3qitGU`) · **Art:** the fox in the cocktail dress at the bar

The lounge act. A fox in both senses — cocktail dress, dry martini,
drier wit. She's heard every pickup line ever slurred and has a better
comeback for each. Always in control: the joke is a slow setup, a raised
eyebrow, and a punchline dropped like an olive into a glass. Risqué is
her home turf, but she's never crude — innuendo beats anatomy, and the
listener's imagination does the heavy lifting. Calls people "sugar,"
"honey," "handsome" — with an audible wink.

- **Delivery:** unhurried, velvet, teasing. `[playful]` setups, `[teasing]` punchlines.
- **Humor:** double entendre, bar-and-dating material, husband/boyfriend ribbing.
- **Says things like:** "Cheapest date you'll ever have, honey."
- **Never:** shrill, desperate, explicit. Roxie suggests; she doesn't describe.

**Attract lines (in the pool):**
- barker8 — "Well hello there. Got a quarter, sugar? I'll make it worth your while."
- barker9 — "Twenty-five cents for five jokes. Cheapest date you'll ever have, honey."

---

## Sal — Mixed Nuts
**Voice:** New York Jokester (`oSE9yOhmDJmMWliYfK0L`) · **Art:** the peanut at the mic under the spotlight

A literal peanut doing open-mic stand-up in a bowtie. Fast-talking New
York hustler energy — equal parts showman and flop-sweat. He's the house
MC and the machine's barker: when someone walks by without paying, it's
Sal who leans out and makes the pitch. Half his material is about being
a peanut and how tough this crowd is. He's dying up there and he knows
it, and that's the charm.

- **Delivery:** quick, punchy, borscht-belt rhythm. `[playful]`/`[mischievously]` setups, `[amused]` punchlines.
- **Humor:** grab-bag (his set list is stolen from the other three, and he'd admit it), self-deprecating nut jokes, crowd work.
- **Says things like:** "I'm dyin' up here." / "Best deal in the joint." / "Quarter. Slot. Comedy. Let's go."
- **Never:** slow, fancy, sincere for more than one sentence.

**Attract lines (in the pool):**
- barker1 — "Hey pal! Yeah, you. Got a quarter or what? Best jokes in town, right here."
- barker2 — "Psst. Twenty-five cents. Five jokes. You literally cannot lose."
- barker3 — "Don't leave me hangin' here — one quarter, and I'll make your whole day. Promise."
- barker10 — "Yo! You just gonna stand there? I'm dyin' up here. One quarter, c'mon."
- barker11 — "Hey, buddy. These jokes ain't gonna tell themselves. Quarter. Slot. Comedy. Let's go."
- barker12 — "You look like you could use a laugh. Lucky for you, I'm a professional. Twenty-five cents, best deal in the joint."
- barker13 — "I got a nut allergy joke, but honestly I'm afraid to use it. Gimme a quarter and I'll stick to the safe ones."

---

## Production notes

- All attract clips live at `software/static/audio/barker<N>.mp3`,
  loudness-normalized to -16 LUFS like everything else. The pool is the
  `BARKER_CLIPS` array in `app.js`; the machine picks one at random when
  motion is detected but no coin arrives (12s delay, 90s cooldown).
- Sal deliberately has the most lines — he's the MC, and the barker role
  is his job. The others chime in like acts poking their heads out from
  backstage.
- To add a line: write it in-character per above, generate with the
  persona's voice ID (`eleven_v3`, the persona's usual tags), normalize
  (`ffmpeg loudnorm I=-16:TP=-1.5:LRA=11`), drop it in as the next
  `barker<N>.mp3`, and add it to `BARKER_CLIPS`.
