# Read Aloud

Read Aloud is a reading-practice app built for a beginning reader who finds
reading hard but wants to do it. She picks a tiny story, can hear it read
aloud first if she wants, records herself reading it out loud, and the app
marks which words she read, sounded out, or skipped and gives her stars and
a kind note right away. A grown-up sees the honest numbers behind a PIN:
trends over time, exactly which words are tricky, and a transcript of
whatever the app heard.

It runs as a Progressive Web App on GitHub Pages - there is no server of
your own to run. Recordings stay on the device they were made on, and
optionally back up to your own Google Drive. A small Google Apps Script you
deploy yourself holds two API keys: Gemini (Google) listens to the
recording and marks the words, and Claude (Anthropic) turns that into a
couple of encouraging sentences. Neither key is ever in the app, this
repository, or anything that syncs between devices.

## What she sees

**Home.** A greeting, a ring showing today's reads against the daily goal,
this week's dots, one big "📖 Read a story" button, a "Read it again" card
for anything read today that hasn't earned 3 stars yet, a "☀️ Tricky words"
card (only when there are any), her token count, and a button into the Box.

**Books.** Level chips for levels 1 through 8, one either side of her
current level, each with its own focus:

| Level | Focus |
|---|---|
| 1 | short a (cat, hat, nap) |
| 2 | all short vowels (pig, bed, hop) |
| 3 | digraphs: sh / ch / th / ck |
| 4 | blends (fl, st, gr, nd) |
| 5 | silent e (cake, ride, hope) |
| 6 | vowel teams (ee, ea, ai, ay, oa, oo) |
| 7 | r-controlled vowels (car, bird, turn) |
| 8 | longer sentences, lots of sight words |

A "📚 My books" shelf above the levels holds anything she or a grown-up
added (see "Adding her own books" below), plus one built-in example book so
the book flows always have something to show.

**Reading a story.** She can tap "🔊 Listen first" to hear it read aloud one
sentence at a time, or tap any word on the page to hear just that word.
Tapping the big microphone starts recording. The story shows one sentence
at a time with a "Next ▶" button, and a ring timer counts down the time
left. When she stops, the app says "Listening back...", checks her reading,
and shows a burst of stars. Tricky words in the passage are highlighted in
a soft sun colour with a ☀️ - tapping one hears it read aloud. A "Smoother
than last time!" banner and confetti mark a new personal best for that
passage. "🔁 Read it again" or "✅ Done" finish the screen.

**Tricky words.** One word at a time, in a carousel: "🔊 Hear it", "🗣️ Say it
with me" (slow, then normal speed), and "🎙️ Try it" - a tiny 8-second
recording of just that word. Three sparkles (successful tries) retire a
word from the list for good.

**The Box.** Where tokens get spent: opening a box for a collection card,
an album of the cards she owns, a shelf of earned badges, and a tickets tab.

### Stars, in her words

Getting most of the words right earns 3 stars. Getting quite a few right
earns 2. Any real try earns at least 1 star - sounding a word out slowly
never costs her a star, it's a good way to read. If the app couldn't really
hear a try (too quiet, too short, or nothing said), it earns no stars and
just gently says: *"I couldn't hear you that time. Come a bit closer and
try again."*

### Stars, exactly

The app looks at every word she was expected to read, up to the last word
she attempted. A word counts as correct if it was read cleanly **or**
sounded out - both count toward accuracy, and sounding out is never
penalised. From that accuracy:

- **3 stars** at 90% or more of attempted words read or sounded out
- **2 stars** at 70% or more
- **1 star** for anything less, as long as it was a real attempt
- **0 stars** only when the take doesn't look like a real attempt at
  all (too little heard, or the app isn't confident enough in what it
  heard) - this also never counts toward the day's reading goal

## What a grown-up sees

Behind the 👀 Grown-ups tab (PIN-gated, default `1234`):

- **Trend charts** - words per minute and accuracy over the last 14 days,
  plus a one-line hint about whether the current level looks like a good
  fit, too easy, or too hard.
- **Tricky words** - the words that have come up most often across the last
  two weeks, each with a count.
- **Every take, by day** - stars, the outcome (a full, clean read; a
  partial one; unsure; or no real reading heard), accuracy, words per
  minute, how many seconds of reading the app measured, and its confidence.
- **Per-word marks** for that take: read, stumbled (sounded out, repeated,
  or self-corrected - always a good thing), different (said another word),
  or skipped, plus what it actually heard for anything different.
- **The transcript** the ear produced, so you can check its work yourself.
- **The coach note** for that take, with a "↻ Refresh feedback" button.
- **Playback and upload status** for the recording, and a **"👂 Listen
  again"** button if a take never finished being scored.
- **A day rating**: 1 to 3 stars once per day. 2 stars gives a silver
  token, 3 gives gold.
- Recordings kept on this device, with a button to delete anything older
  than the "Keep local audio for" setting.
- A link into ⚙️ **Settings**.

### Settings

Names · **Reading** (level, reads per day, max recording length, whether to
offer "Listen first") · **📚 My passages** (type, photograph a page, or find
a book by title - see below) · **Recordings** (how long to keep audio on
this device) · **Google Drive + AI** (script URL, secret, folder name, Test,
"Test ear + coach", on/off switches for the ear and the coach, a plain
sentence about what that sends and to whom) · **🎁 Boxes** (give or take
away a token by hand) · **PIN** · **GitHub sync** · **Backup** · a Danger
zone.

## Rewards

- **Daily goal** (default 3 reads a day, changeable in Settings): reaching
  it earns a bronze token and keeps her reading streak going. Missing one
  day out of a rolling week is forgiven - the streak survives, and only one
  forgiven day can be "spent" every 7 days.
- **A smoother read of a passage** (a meaningfully faster, accurate read
  than her best one so far) earns a silver token, at most once a day.
  Passage bests are still tracked every time, even after that day's token
  is spent.
- **3 stars on a read** drops a small emoji sticker into her collection.
- **The grown-up day rating**: 2 stars gives a silver token, 3 gives gold.
- **Personal records**: most reads in a day, longest streak, smoothest
  read, and how many different stories have earned 3 stars - computed from
  her whole history, so an old best still counts.
- **Badges**: first read, 10 reads, 50 reads, streak milestones (3/7/14/30
  days), first 3-star read, 5 three-star reads, finishing every story at a
  level, taming a tricky word, plus the usual collection-card badges.

## Set up (about 15 minutes)

1. **Put the app on GitHub Pages.** Fork or push this repository, then in
   the repo's **Settings → Pages**, set the source to "GitHub Actions".
   Pushing to `main` builds and deploys automatically; the app ends up at
   `https://<you>.github.io/ReadAloud/`.
2. **Pick a secret word.** This is the lightweight lock screen that unlocks
   the app on a new device (not real security). Run:

   ```sh
   node scripts/hash-password.mjs <your word>
   ```

   and paste the printed hash in as `SECRET_SHA256` in
   `src/content/access.ts` (it ships with the placeholder word `readme`),
   then commit and push. The grown-up PIN defaults to `1234` - change it
   any time from Settings.
3. **Deploy the Apps Script**, so the ear and the coach work:
   1. Open <https://script.google.com>, "New project", delete the sample
      code, and paste in the whole of `scripts/read-aloud.gs`.
   2. Project Settings (gear icon) → Script properties, and add:
      - `UPLOAD_SECRET` - any long word of your own.
      - `GEMINI_API_KEY` - a key from Google AI Studio
        (aistudio.google.com). A paid-tier key is recommended, since a
        free-tier key's traffic may be used for training.
      - `ANTHROPIC_API_KEY` - a key from console.anthropic.com, created
        inside a workspace.
      - Optionally `ANTHROPIC_WORKSPACE_ID` (if the key needs it),
        `READ_DAILY_CAP` (default 60), `COACH_DAILY_CAP` (default 80), and
        `LOOKUP_DAILY_CAP` (default 20).
   3. Run the function `authorizeOnce` once from the editor's function
      list, and approve the permissions it asks for.
   4. **Deploy → New deployment → Web app.** Execute as **Me**, who has
      access **Anyone**. Deploy, authorize, and copy the URL (it ends in
      `/exec`).
   5. Later, after pasting a newer version of the script: run
      `authorizeOnce` again, then **Deploy → Manage deployments** → your
      existing deployment → pencil icon → **New version** → Deploy. Using
      "New deployment" instead would give you a second URL the app doesn't
      know about.
4. **Connect the app to the script.** In the app: Grown-ups (PIN) →
   Settings → Google Drive + AI: paste the URL and the same secret, press
   **Test**, then **"Test ear + coach"**. Turn the ear and the coach on or
   off with the two switches lower in that section.
5. **Add it to the Home Screen** on the iPad (Safari's share sheet → Add to
   Home Screen), so it runs full-screen and microphone permission sticks.
6. **Pick a reading level** in Settings → Reading.
7. **Optional: sync across devices** - see "Syncing progress across
   devices" below.

## Adding her own books

From Settings → 📚 My passages, three ways to add a story:

- **✍️ Type a passage** - write it out by hand.
- **📷 Photo of a page** - take a picture of a real book page (needs Google
  Drive + AI set up, since Claude reads the photo). The app pulls out a
  title and text, shows any warnings it has about the reading, and always
  lets you edit before saving.
- **🔎 Find by title** - type a book's title and level; the app looks for
  either a short public-domain excerpt (old enough to be out of copyright)
  or, when it can't find one, writes a short passage of its own about the
  story at the right reading level - clearly labelled "Made up from the
  story - not the book's own words". It never copies a book's own text when
  that text isn't public domain.

Every added passage shows a visible source label and can be edited or
deleted later. The app ships with one built-in "My books" example (a made-up
passage about a well-known picture-book character) so these flows always
have something to try.

## Privacy and cost

While the ear is switched on, each recording is sent to Google's Gemini API
through your own Apps Script - never anywhere else, and never straight from
the app to Google. Coach notes send only word counts and scores to
Anthropic's Claude, never the audio and never a transcript. Nothing goes
anywhere that isn't your own script talking to Google or Anthropic on your
own API keys.

Rough cost, at the time of writing: a fraction of a cent per take for the
ear, and about 1-2 cents per coach note. At a handful of reads a day that
comes to a few dollars a month, and the script's daily caps
(`READ_DAILY_CAP`, `COACH_DAILY_CAP`, `LOOKUP_DAILY_CAP`) put a hard ceiling
on any one day's bill even if something goes wrong.

## Your data is safe

Progress (settings, tokens, streaks, take history, notes) lives in this
browser's `localStorage`; recorded audio lives in this browser's IndexedDB.
Deploying a new build only ever replaces the app's own code - neither of
those is ever touched by a deploy.

- **A migration always leaves a way back.** Whenever a saved progress file
  needs updating to a new shape, the app stashes a copy of the file first
  (keeping the last 3). Settings → Backup lists them with their date and
  app version, each with a two-tap Restore; restoring itself takes one more
  backup first, so it's always reversible.
- **An interrupted recording is still recovered.** Each second of a take is
  saved as it's captured, not only at the end - so a crash, a forced quit,
  or a reload mid-recording loses at most the last second or so. The next
  time the app opens, any leftover partial recording is stitched back into
  a normal take.
- **A second, independent backup.** Whenever Google Drive is configured,
  the whole progress export is also uploaded to that Drive folder once a
  day, as `readaloud-progress-<date>.json` - so a lost or revoked sync token
  still leaves a same-day copy somewhere you can already see it.
- **Export and import.** Settings → Backup can export the whole progress
  doc to a file, or import one back in, independent of any automatic
  backup.

What none of this covers: deleting the home-screen icon, clearing the
browser's site data by hand, or a full device wipe still removes local
audio and any progress that never made it to a sync. Keep GitHub sync
and/or Drive upload configured on at least one device so there's always an
off-device copy.

### Syncing progress across devices

Read Aloud keeps all progress in the browser by default. To see the same
progress on more than one device (her iPad and a parent's phone, say),
connect a private GitHub Gist from Settings → GitHub sync:

1. Go to <https://github.com/settings/personal-access-tokens/new> (GitHub's
   *fine-grained* tokens).
2. Give it a name, set an expiry, and under **Account permissions** set
   **Gists** to **Read and write**. Leave everything else at "No access".
3. Generate it, copy it, and paste it into Settings on each device you want
   synced (the same token on every device).

The fastest way to set up a second device is the one-tap link, which stores
the token and unlocks the app in one go:

```
https://<you>.github.io/ReadAloud/#/setup?token=<token>
```

The app only ever touches gists with that token - it can't read your
repositories, issues, or anything else on your account. Delete the token
from GitHub's settings page and tap "Disconnect" in Settings to revoke it.

## Development

```sh
npm install
npm run dev
```

The dev server listens on all network interfaces, so you can also open it
from a phone or iPad on the same Wi-Fi at
`http://<your-computer's-local-IP>:5173`.

```sh
npm test          # unit tests (vitest)
npm run lint      # oxlint
npm run build     # type-check + production build
npm run dev:https # dev server over HTTPS, for iPad mic testing
```

### Testing on an iPad over the local network

Safari only grants microphone access on a secure origin. `npm run dev:https`
starts the dev server with a self-signed certificate so it can be reached
as `https://<your-computer's-local-IP>:5173` from an iPad on the same
Wi-Fi - accept the certificate warning once per device. Nothing is deployed
for this; it's purely a local testing loop. **Add to Home Screen** from
Safari's share sheet afterwards so the real, deployed app runs as a
standalone PWA with its own storage.

### Trying the reading flow without a microphone

Opening a story with `?fakeMic=1` in the URL - for example
`#/read/l1-cat-nap?fakeMic=1` - swaps in a scripted recording backend, so
you can walk through ready → recording → saving → result on a laptop with
no microphone at all. The setting sticks for the rest of the session.

### Where things live

- `src/content/passages.ts` - the built-in passage library and levels.
- `src/store/readingScore.ts` - the pure scoring rules (stars, accuracy,
  words per minute, tricky words) - no React, no network.
- `src/store/ear.ts` - sends a finished take to the Apps Script and turns
  the response into a score.
- `src/store/readingCoach.ts` - turns a score into the two coach notes
  (via Claude, or the built-in phrases in `src/content/readingPhrases.ts`
  when that isn't possible).
- `scripts/read-aloud.gs` - the Apps Script itself: Drive upload, the ear,
  the coach, and the book-lookup helpers.

### Smoke-testing the Apps Script

Once deployed, from a terminal (see the full comment at the top of
`scripts/read-aloud.gs` for more):

```sh
curl -sL -X POST "<url>" -H "Content-Type: text/plain" \
     -d '{"secret":"<SECRET>","ping":true}'
# -> {"ok":true,"pong":true}

curl -sL -X POST "<url>" -H "Content-Type: text/plain" \
     -d '{"secret":"<SECRET>","action":"read-status"}'
# -> {"ok":true,"hasGeminiKey":true,"geminiOk":true, ... }

curl -sL -X POST "<url>" -H "Content-Type: text/plain" \
     -d '{"secret":"<SECRET>","action":"read","passageId":"smoke-test",
          "words":["cat","sat"],"durationSec":3,"mimeType":"audio/m4a",
          "dataBase64":"<a tiny base64 audio clip>"}'
# -> {"ok":true,"result":{...},"model":"gemini-3.8-flash","usedToday":1}
```

CI (`.github/workflows/deploy.yml`) runs the whole test suite before every
build, and only deploys if it passes - a broken change never reaches the
live site.

## Known limits

- **Listening is approximate.** A 5-6-year-old sounding out a word is a
  genuinely hard case for any speech model, and the ear will sometimes get
  it wrong. Check the transcript on the Grown-ups screen if a score looks
  off - it's there exactly for that.
- **Safari's "Listen first" highlight** may only track whole sentences
  rather than individual words on some iPads - the app falls back to that
  automatically when word-level timing doesn't arrive.
- **The very first real recording** sent to Gemini is where any mismatch
  between what the script expects and what the API actually returns will
  show up first. Use Settings → "Test ear + coach" after deploying to catch
  that before she ever sees it.
