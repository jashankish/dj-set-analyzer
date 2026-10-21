# Set Replay — DJ Set Analyzer

Set Replay takes a recording of a live DJ set apart, track by track and mix by
mix, and replays it in a locally hosted web app. It answers the questions you'd
ask after a night out:

- What was played, and when?
- How did the DJ get from one track to the next?
- Did the mixes stay in key?
- Where were the drops, and where did the energy peak?
- What would a playlist with this set's sound be? (It writes the prompt for
  Spotify's Prompted Playlist, and can save the set's tracks to Spotify.)

There are two ways to run it, and both produce the same JSON:

- **The website (`web/`): a static site where analysis runs in the visitor's
  browser.** Essentia.js (WebAssembly) and ONNX Runtime Web do all the work on
  the visitor's own machine; nothing is uploaded. Hosting it is free on any
  static host, with no server compute at all. Visitors drop recordings onto
  the landing page, and their sets stay in their browser.
- **The Python pipeline (`analyzer/`)** runs on your own machine. It adds
  track names from Shazam (no account or API key) and is the reference the
  browser engine is checked against. Its output can also become demos on the
  website.

---

## Contents

1. [What you get](#what-you-get)
2. [Run it yourself](#run-it-yourself)
3. [Hosting details](#hosting-details)
4. [Naming tracks with the helper](#naming-tracks-with-the-helper)
5. [Spotify: the set as a playlist prompt](#spotify-the-set-as-a-playlist-prompt)
6. [Command-line options](#command-line-options)
7. [Architecture](#architecture)
8. [The analysis pipeline, step by step](#the-analysis-pipeline-step-by-step)
9. [The browser engine](#the-browser-engine)
10. [The data format](#the-data-format)
11. [The web app](#the-web-app)
12. [Accuracy and limits](#accuracy-and-limits)
13. [Costs and licenses](#costs-and-licenses)
14. [Troubleshooting](#troubleshooting)
15. [Project layout](#project-layout)
16. [Credits](#credits)
17. [License](#license)

---

## What you get

**The landing page** (`index.html`) has these parts:

- **Drop zone:** a large panel that is itself a waveform of a demo set. Drop
  one or more recordings (or click to choose them) and press **Analyze**.
  A **video** of a set works too (MP4 or MOV, what phones record): only its
  soundtrack is taken out and analyzed, and only that audio is kept for
  playback, so an hour of 1080p video (5–8 GB) costs about 60 MB of storage.
  Each file shows its progress, and **Stop** cancels the run. When a single
  set finishes, it opens automatically. Dropping a saved `.setreplay.json`
  imports that analysis instead. On phones and low-memory devices, sets
  over an hour carry a note that a laptop works best.
- **Naming bar:** under the drop zone. Without the naming helper it reads
  *Tracks will show as IDs. Want them named?* and opens the setup pop-up.
  With the helper connected, it becomes a *Name tracks with Shazam* checkbox.
- **Your sets:** everything analyzed in this browser, with key-colored
  strips. Hover a card to delete it. Deleting also removes the saved
  recording, so it takes a second click ("Click again to delete"). The
  heading shows how much browser storage the library uses (each set keeps
  its recording, so typically 40–150 MB), and it suggests deleting old sets
  once usage passes 80% of what the browser allows.
- **Teaser:** a preview built from real demo output: the ribbon, cycling mix
  cards and the Camelot path. Under it, **And there's more on every set**:
  nine cards (the playlist prompt, highlights, the review, how it was mixed,
  chapters and drops, the mood map, track by track, comparing sets,
  tracklists and the set card), each linking straight to that section of a
  demo (`set.html?demo=…#vibe`). The animated ribbons are drawn once and cached,
  so each frame only moves the playhead (~0.01 ms rather than ~6 ms). They
  pause when scrolled out of view and while an analysis runs. Below it are the demo sets, *How it works* and a
  short FAQ.

**The set page** (`set.html`) is the replay. Pick a set from the row at the
top; its color swatches are the set's track keys in order. Then:

| Part of the page | What it shows | What you can do |
| --- | --- | --- |
| **Header** | The set title, length, track count, BPM, the share of harmonic mixes, and a short generated summary of the set (including its chapters) | Double-click the title to rename the set (saved in this browser). **Set card** (or `K`) opens a shareable 1080 × 1350 image of the set: title and facts, the energy arc in key colors with its chapters, the vibe radar, mixing style, home key, mood route, keyword chips and the short playlist prompt. **Download PNG**, or **Share…** where the browser can share files (phones). It uses your title and the whole-set chips you left on, and carries the review score |
| **Section bar** | A slim bar under the header that sticks to the top while you scroll: one chip per section on the page (Highlights, Review, Setlist, The mix, How it was mixed, Journey, Mood map, Compare, Spotify; hidden sections are left out), the one you're reading highlighted | Click a chip to scroll to that section; on a phone the bar scrolls sideways and keeps the current chip in view |
| **Set ribbon** | The whole set as a 3-band waveform (lows, mids, highs). Each track is tinted by its **key's color on the Camelot wheel**. Colors cross-fade through every mix; hatching marks mix windows and ▼ marks drops. Recording outside the set (e.g. the phone left running afterward) is grayed out | Click to play from that moment; hover for track, key, BPM and mix details; zoom with pinch, ⌘/Ctrl-scroll or `+`/`−`; drag to pan; use the overview strip above to jump or drag the window |
| **Highlights** | A guided tour of the set, under the waveform: up to 10 moments picked from the page's own analyses (where each chapter starts, the three biggest drops, the energy peak, the longest blend, the boldest key move, the biggest lift, the biggest mood swing, the track most like the whole set, and the curveball), each with its time, kind and a one-line reason, plus the length of the reel | Click a card to hear that moment; **Play the highlights** plays them back to back (15–30 s each, a few minutes in all), outlining the playing card with a progress bar; press it again, or seek anywhere else, to stop |
| **The review** | The set in words: three short paragraphs (what it is: genres, tempo, mood and the artists it leans on; the journey: chapters, mood route, drop style, where it returns to an earlier sound; the craft: mixing style, longest blend, roughest hand-over), an overall score and a one-line verdict, and a scorecard out of 10 with a reason for each: **Mixing** (mean smoothness), **Harmony** (mixes in compatible keys, bolder moves counted half), **Flow** (how alike neighboring tracks sound), **Dynamics** (how far the energy travels, 10th to 90th percentile of track energy, and how often drops land) and **Variety** (keys visited, how different the tracks are). The scores describe the set rather than judge taste | **Copy the review** puts the title, score, verdict and paragraphs on the clipboard |
| **Now playing** | Cover art, live BPM, key and key name, energy (1 to 10), a 4-step beat pulse, a live spectrum analyzer, the top styles, Shazam / Apple Music / Spotify links, and what comes next | Double-click an **ID** track's title to name it yourself |
| **Setlist** | Every track: start time, art, title and artist, Camelot key, BPM, energy sparkline, and a progress bar while it plays. Between tracks, a transition row gives the mix type, length in bars, harmonic relation, tempo change, swap time and smoothness (◦ out of 100) | Click a track to play it; click a transition row to open it in the inspector; *Copy tracklist* puts `time  Artist – Title` lines on the clipboard. Unnamed tracks keep their key and tempo, e.g. `ID – ID (4A, 177 BPM)`, the clues a DJ uses to track a song down. **More formats**: *YouTube chapters* (the first stamp pinned to 0:00 and stamps under 10 s apart merged, so YouTube turns a pasted description into chapters), *1001Tracklists* (`[mm:ss] Artist - Title`) and a *CUE sheet* download (players and DJ tools split the recording by it) |
| **Player** | Play/pause, previous/next track, now playing, a scrub bar drawn as the set's waveform, the time, and a **speed** button (0.5×, 0.75×, 1×, 1.25×; the key stays the same, so a blend can be slowed down to study it; remembered in this browser) | Click the speed to cycle it, or press `[` / `]` |
| **Mix inspector** | A zoomed waveform of one transition. Markers show where the next track came in, the swap point and where the mix ended. Below are the low-end curve and a beat grid counted in bars from the swap, plus key, tempo and energy changes, the low-end dip, how much sound the tracks share, the mix's **smoothness** out of 100, and a description that ends with what cost it points. Below 85, **How it could be smoother** gives a DJ's fixes: for a key clash the bridging keys (Camelot keys next to both) or, if none, the shortest in-key route around the wheel ("via 4A, 5A, 6A, 7A"), naming tracks from this set in those keys; riding the pitch for a tempo gap; cutting the outgoing lows when bass lines overlap; starting on a phrase; going through a breakdown when the energy lurches | **Hear this mix** jumps to 6 s before it; **Loop it** repeats it; *Previous / Next* step through the mixes. While playing, the inspector follows the live mix |
| **How it was mixed** | The DJ's **mixing style**, one of six archetypes (the long blender, the technician, the drop architect, the quick cutter, the key purist, the selector) with the evidence in a sentence; tiles for the median mix length, share in key, share of bass swaps, tempo moves, energy lifts vs. drops and mean **smoothness**; a **mix timeline** where every transition is a column (height = length in bars on a √ scale with 8/16/32-bar guides, a gradient from the outgoing to the incoming track's key color, dashed outline for a key clash); counts of **key moves** and **mix types**; and the set's **signature moments** (longest blend, deepest bass swap, biggest lift, boldest key move, biggest tempo move, smoothest and roughest mix). Last, **a smoother running order**: the same tracks re-sequenced to keep more mixes in key with the same energy arc, drawn as a slope chart (as played above, suggested below, key-colored blocks, white marks on key clashes, lines joining each track's two places, bright when it moved) with before/after counts and the biggest moves. **Keep the opener and closer** (on by default) holds the first and last tracks in place. **Save in this order to Spotify** makes a playlist of the named tracks in the suggested order | Hover a column for the mix; click a column or a moment to open it in the inspector and hear it. The column of the selected mix is outlined |
| **Harmonic path** | A Camelot wheel. Each track is a dot on its key, and the dots are joined in the order played (solid once played, dotted ahead). Under it, **time in key**: the set's home key and its share, then minutes in each key as key-colored bars (top six; the rest summed), with the playing key highlighted | Click a dot to play that track; click a key's bar to play the first track in that key |
| **Chapters** | The set split into its chapters (warm-up, build, peak, breather, second wind, cool-down…), as blocks sized by length and tinted by each chapter's main key. Each shows its time and tracks, tempo, energy (with a bar against the strongest chapter), drops, and its genres and mood in the same words its Spotify prompt uses. The playing chapter is outlined. Hidden when the set is one steady chapter | Click a chapter to play it; **Spotify prompt** scopes the prompt below to that chapter |
| **Energy** | The energy arc of the set, filled per track in its key color, with drops, the peak and the chapter boundaries marked | Hover for values; click to seek |
| **Drop anatomy** | Every drop overlaid on one chart, lined up at the moment it lands: the bass line (the low band, averaged over a second) from 32 s before to 16 s after, each in its track's key color, with the average drawn bold and the typical breakdown shaded. A sentence and the style (*quick switch-ups* under 10 s, *classic builds* under 18 s, else *long builds*): how often drops come, how long the breakdowns run (in seconds and bars), how far the bass is pulled and how hard it lands. While a drop plays it's highlighted, with a dot riding its curve | Hover a line for that drop; click it, or one of the **biggest drops**, to hear it from 12 s before |
| **Sound** | How strongly the style model hears the set's top six Discogs styles over time | Click to seek |
| **Mood** | Danceability, party, aggressive, happy and vocal scores over time | Click to seek |
| **Mood map** | Every track placed by **brightness** (the *happy* score plus a little for major keys) and **intensity** (energy with the *aggressive* and *party* scores), the valence × arousal map from music-emotion research. Dots are key-colored and sized by length, numbered, and joined in play order (solid up to the playing track, dotted after). The cross is the set's own median, so the corners (Euphoric, Intense, Warm, Brooding) mean "more than this set's usual": room recordings pull every score to the middle. Beside it: time in each corner, a sentence on the route ("It opens intense, moves through euphoric and ends warm"), and the biggest swing between two tracks | Hover a dot for the track; click a dot (or Enter on it) to play it; **Biggest swing** plays into that change |
| **Track roles** | Up to two tags on each setlist row and under Now playing for what the track does in the set, each with its reason as a tooltip: *Opener*, *Closer*, *Peak* (the most energetic track), *Lift* (energy up 1.5+ on the track before), *Breather* (1.5+ under the set's median, between higher tracks), *Core* and *Curveball* (the two tracks that sound most and least like the whole set), *Echo* (returns to an earlier track's sound) and *Key bridge* (a different key that mixes cleanly in and out, carrying the set between keys that don't mix directly). From `roles.js` | Hover a tag for why |
| **ID clues** | For each unnamed track, the trusted named track in the same set it sounds most like (from the Track by track matrix: at least 80% alike, ranked by how much more alike than that track is to the set in general, so no single "generic" track answers for every ID). Shown as "Unidentified · sounds like *Title*" in the setlist, as a line under Now playing ("Sounds most like Illuminate (Sub Focus & Wilkinson), 98% alike"), and added to the ID's clues in every tracklist format, e.g. `ID – ID (4A, 175 BPM, sounds like Sub Focus & Wilkinson – Illuminate)`: what you'd post when asking who made an ID | Click the Now playing line to hear the track it sounds like |
| **Track by track** | A similarity matrix: every track against every other, brighter where two tracks sound more alike (the style model hears the same styles in them, half; they sit close on the eight vibe axes, half), scaled to the set's own range, with the chapters boxed along the diagonal and the playing track's row and column outlined in its key color. Beside it: how alike the set's hand-overs are on average, its most consistent stretch (the longest run of hand-overs smoother than its median), where it comes back to an earlier sound (the most alike pair at least four tracks apart), and its hardest turn (the least alike neighbors) | Hover a cell for the pair; click a cell, or an insight, to play that track |
| **Compare with another set** | Shown when there's another set to compare with (another demo, another set in this browser, or another set on the local server). A **similarity score** out of 100 with a verdict (*close siblings* ≥ 85, *same world* ≥ 70, *related* ≥ 50, else *different nights*), broken into **sound** (cosine of the style shares, 35%), **feel** (the vibe axes, 30%), **tempo** (0 at 30+ BPM apart, 20%) and **shared artists** (15%); both vibe fingerprints overlaid (this set filled, the other dashed, each in its home key's color); the biggest differences in words ("Worship Part 1 is more vocal (62% vs 47%)"); genres and artists in common; and a **blend prompt**: both sets joined end to end and written up as one, for a playlist covering both | Pick the set from the menu (remembered per set); **Copy blend prompt**; **Save both sets to Spotify** (both sets' named tracks in one playlist, the blend keywords as its description) |
| **Take the vibe to Spotify** | Where to send it (Spotify, YouTube Music, Apple Music, Deezer or any AI chat). A *vibe fingerprint* radar (tempo, energy, danceable, party, aggressive, bright, vocal, minor key): the whole set filled in its main key's color, the playing track as a dashed outline that moves as the set plays, and the values in a table. Next to it, keyword chips by group (genre, tempo, mood, sound, artists, tracks to start from, labels, era, flow, things to avoid, length) and the prompt they make | Pick **Whole set** or a chapter to prompt for; hover an axis for set vs. track values; click chips to take keywords out (hover a genre chip for its evidence); switch between the full prompt and keywords only; add your own direction; **Copy prompt**, **Open Spotify** (copies too), **Save the set to Spotify** (see [Spotify](#spotify-the-set-as-a-playlist-prompt)). Your choices are remembered per set |

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause (when a button or link has focus, Space presses it instead) |
| `←` / `→` | Seek 5 s (`Shift`: 30 s) |
| `N` / `P` | Next / previous track |
| `M` | Hear the next mix |
| `+` / `−` | Zoom the ribbon |
| `F` | Follow playback when zoomed |
| `C` | Copy the Spotify prompt |
| `K` | Open the set card |
| `[` / `]` | Slower / faster: 0.5×, 0.75×, 1×, 1.25×, pitch kept (also the speed button in the player) |
| `?` | Show the shortcuts |

---

## Run it yourself

Set Replay is just a folder of web pages (`web/`). There's no server code, no
database and no account to create. All the analysis happens in the browser of
whoever opens the page.

### On your own computer (about 2 minutes)

You need **Python 3**, which is already installed on macOS and Linux
(on Windows, get it from [python.org](https://www.python.org/downloads/)),
and a recent Chrome, Edge, Firefox or Safari.

1. **Get the code.** Either clone it:

   ```bash
   git clone https://github.com/jashankish/dj-set-analyzer.git
   cd dj-set-analyzer
   ```

   or, without git, click **Code → Download ZIP** on GitHub, unzip it, and
   open a terminal in the unzipped folder.

2. **Start a local web server** for the `web` folder:

   ```bash
   python3 -m http.server 8000 --directory web
   ```

   (On Windows, type `py` instead of `python3`.)

3. **Open http://localhost:8000** in your browser.

4. **Drop a recording** of a DJ set onto the page (`.mp3`, `.m4a`, `.wav`,
   `.flac`, `.ogg`, `.aac` …) and press **Analyze**. The first time, the page
   downloads its analysis engine and models (about 35 MB), so it needs an
   internet connection; after that they're cached. A 34-minute set takes
   about a minute on a recent laptop.

5. **To stop the server**, press `Ctrl+C` in the terminal.

Your sets are saved in that browser, so they're still there next time you
start the server and open the page.

> **Why not just double-click `index.html`?** Browsers don't run this kind
> of page (JavaScript modules and web workers) from `file://`, so it has to
> come from a web server, even a local one like the command above.
>
> **Shortcut:** `./run.sh` does the same as step 2 on port 8778, and also
> shows sets you analyzed with the Python pipeline (below).

### On the internet, for free

Any service that hosts static files works. Pick one:

**Netlify** (easiest; no settings to type):

1. [Fork](https://github.com/jashankish/dj-set-analyzer/fork) this repository
   to your GitHub account.
2. Sign in to [Netlify](https://app.netlify.com), choose **Add new site →
   Import an existing project**, and pick your fork.
3. Press **Deploy**. The included `netlify.toml` tells Netlify how to build
   it, and a minute later the site is live at a `*.netlify.app` address.

**Cloudflare Pages:**

1. Fork this repository.
2. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages →
   Connect to Git** and pick your fork.
3. Set **Build command** to `bash tools/build-site.sh` and **Build output
   directory** to `dist/set-replay`, then press **Save and Deploy**.

**Any other web host** (your own server, shared hosting, an S3 bucket …):

1. Build the upload folder (needs `bash`, so macOS, Linux or WSL on Windows):

   ```bash
   bash tools/build-site.sh
   ```

2. Upload the **contents** of `dist/set-replay/` to your host, either to the
   top level of a site or to a sub-folder such as `/set-replay/`. Both work.

That's all: there's nothing to run or pay for on the server. For cache
headers, adding your own analytics tag, and running inside a larger site, see
[Hosting details](#hosting-details).

Two optional extras:

- **Track names.** Out of the box, tracks are labeled **ID** because
  browsers can't ask Shazam directly. To get real names, run the small
  [naming helper](#naming-tracks-with-the-helper) on your computer; the page
  explains how when you click *Name these IDs*.
- **The Python pipeline** (below) analyzes sets from the command line, adds
  Shazam names directly, and can turn your sets into demos for the landing
  page.

### Advanced: the Python pipeline

This needs macOS or Linux, **Python 3.12**, and **ffmpeg**
on your `PATH` (`brew install ffmpeg python@3.12`).

```bash
cd dj-set-analyzer
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt

# analyze every recording in this folder
# (the ONNX models download on the first run, ~19 MB, no account needed)
venv/bin/python analyzer/analyze.py --all

./run.sh            # → http://localhost:8778   (./run.sh 9000 for another port)
```

To add a set, drop the recording (`.m4a`, `.mp3`, `.wav`, `.aac`, `.ogg`,
`.flac`, `.aif[f]`) into this folder and run:

```bash
venv/bin/python analyzer/analyze.py "My Set.m4a" --title "Warehouse, 3am"
```

Then open `http://localhost:8778/set.html`. Timings on an Apple M4:

- **Audio analysis:** about 15 s for 34 minutes of audio, about 35 s for 94 minutes.
- **Shazam lookups:** about 1.5 s each, one clip every 24 s of music, so about
  10 minutes per hour of set. They're cached for good.

---

## Hosting details

`web/` is the entire website: plain files, with no build step, no backend and
no environment variables. Copy the folder anywhere. It works at a domain root
or in a sub-folder (e.g. `yoursite.com/set-replay/`), because every path is
relative.

1. **Build it:** `bash tools/build-site.sh` (add `--zip` for an upload-ready
   zip). This writes `dist/set-replay/`: the contents of `web/` without the
   dev-only files (`web/data/`, the Python output for the local server, and
   `serve.py`). Copy that folder to your host. The parts are:

   | Path | Size |
   | --- | --- |
   | `models/` | ~20 MB (the ONNX models, served to browsers) |
   | `demo/` | ~0.8 MB |
   | Code and pages | ~0.2 MB |

2. **Hosts that work:** any static host: your existing web server, Netlify,
   Cloudflare Pages, Vercel or an S3 bucket.
   - **Netlify:** connect the repo; `netlify.toml` runs the build, with no
     other settings needed.
   - **Cloudflare Pages:** build command `bash tools/build-site.sh`, output
     directory `dist/set-replay`.
   - **GitHub Pages:** publish `dist/set-replay/` (e.g. from an Actions
     workflow). It can't read `web/_headers`, so see the cache rules below.

   No special headers are required. The engine runs single-threaded WebAssembly inside
   several workers, so it doesn't need `SharedArrayBuffer` or cross-origin
   isolation.
3. **Cache rules.** `web/_headers` sets them for Netlify and Cloudflare Pages:
   - HTML, JS and CSS revalidate on every load (`no-cache`), so visitors pick
     up a new version straight away and never mix old and new modules
   - `models/` caches for a year

   On other hosts, set the equivalent headers. Without them, browsers can keep
   stale JavaScript for a while after a deploy.
4. **Third-party assets** (all free, with no keys):
   - Essentia.js and ONNX Runtime Web load from jsDelivr, pinned in
     `web/js/engine/config.js`. If jsDelivr is down or blocked, the engine
     falls back to unpkg automatically, and if both fail the visitor sees
     a clear "couldn't load the analysis engine" message.
   - The Archivo font loads from Google Fonts.
   - Demo cover art is hotlinked from Shazam's image CDN.

   To serve the libraries yourself, copy them and set
   `window.SET_REPLAY_ASSETS = { essentiaWasm, essentiaCore, ort, ortWasmPath, models }`
   in a script before `js/landing.js` runs. Each library entry may be one URL
   or a list tried in order; `ortWasmPath[i]` pairs with `ort[i]`.
5. **Demos.** Analyze sets with the Python pipeline, then run:

   ```bash
   venv/bin/python tools/make_demos.py recording-9:worship-part-1 recording-10:worship-part-2
   ```

   That writes `web/demo/`. Demos ship without audio unless you add
   `--audio worship-part-1=https://…/part1.m4a` (a file on your own host or
   CDN). Without audio, a demo is fully explorable but silent.

6. **Your site's own tags** (analytics, a consent banner, a theme script):
   the repo ships no tracking code. Put the HTML in a file and pass it at
   build time, and it's inserted before `</head>` on every page:

   ```bash
   bash tools/build-site.sh --head my-analytics.html
   # or, from another build script: SET_REPLAY_HEAD=my-analytics.html bash tools/build-site.sh
   ```

7. **Saving to Spotify (optional).** The prompt and *Open Spotify* work
   everywhere with no setup. *Save the set to Spotify* needs a Spotify app's
   Client ID: put yours on every page with the `--head` option above, e.g. a
   file containing
   `<meta name="set-replay-spotify-client-id" content="YOUR_CLIENT_ID">`, and
   add `https://yoursite.com/set-replay/set.html` as a Redirect URI in the
   Spotify dashboard. Without it, visitors can paste their own app's Client
   ID on the page. See [Spotify](#spotify-the-set-as-a-playlist-prompt).
8. **Link previews.** Shared in iMessage, Slack, WhatsApp or X, a link shows a
   card from the pages' Open Graph tags. The pages carry the title,
   description, site name, image size and alt text, a `summary_large_image`
   card and `apple-touch-icon.png` (the icon iOS shows next to a link; it
   ignores SVG icons). The card image is `og-image.png` (1200 × 630), but
   `og:image` and `og:url` must be **absolute** URLs, which only the host
   knows, so add them in your `--head` file:

   ```html
   <meta property="og:url" content="https://example.com/set-replay/" />
   <meta property="og:image" content="https://example.com/set-replay/og-image.png" />
   <meta name="twitter:image" content="https://example.com/set-replay/og-image.png" />
   ```

   Without them, previews show the title and description but no image. The
   images are drawn from demo 1 by `node tools/make-share-images.mjs` (re-run
   only to change the design).

### Inside a larger site

Set Replay can live in a sub-folder of an existing site (say
`example.com/set-replay/`) next to other apps. A few things make that safe:

- **Relative paths everywhere.** Copy `dist/set-replay/` into the parent
  site's output and it works at any depth. There are no environment variables
  to set.
- **Shared origin.** Apps in sub-folders of one domain share `localStorage`
  and IndexedDB. Set Replay's `localStorage` keys are all prefixed
  `set-replay:` (`js/prefs.js`; it also migrates keys from the old `djsa:`
  prefix), and its IndexedDB database is named `set-replay`.
- **Missing files.** Some hosts answer any unknown path with their homepage
  and HTTP 200 (a single-page-app fallback). Set Replay rejects an HTML
  response for a model file with a clear "missing from this deployment"
  error, and hides the demo teaser if its data is missing.
- **Caching.** The file names aren't content-hashed, and the ES modules
  import each other, so they can't be cache-busted from the HTML. If the
  parent site caches static files as `immutable`, exempt `set-replay/*`
  (serve it `no-cache`), except `set-replay/models/*`, which is versioned
  and safe to cache for a year.
- **No routing rules.** Pages are real files (`index.html`,
  `set.html?id=…`), so no history-API fallback is needed.
- **The naming helper from a public site.** Chrome asks the visitor before
  an https site may reach `127.0.0.1` (Local Network Access). On any host
  other than localhost, the naming pop-up tells visitors to choose Allow, and
  how to undo a Block.
- **Verify a deployment** with the full browser suite, in a fresh browser
  profile: `node tools/e2e.mjs --url https://example.com/set-replay/`. Against
  a remote host, Chromium starts with the Local Network Access check off,
  standing in for the visitor's Allow click.

There's nothing to run or pay for on the server side. Visitors' computers do
the analysis, and their sets live in their browser's IndexedDB.

---

## Naming tracks with the helper

On its own, the website leaves tracks as **ID**s: browsers aren't allowed to
call Shazam (it sends no CORS headers). The optional **naming helper** lets
visitors get real names anyway. It's a small program on their own computer
that does the Shazam lookups for the page.

**For visitors** (the site explains this in a pop-up: *Want them named?* on
the landing page, *Name these IDs* on a set):

1. Download `helper/set-replay-helper.py` from the site.
2. Run `python3 set-replay-helper.py` (Windows: `py set-replay-helper.py`).
   The first run builds a private environment in `~/.set-replay-helper` and
   installs `shazamio` (about a minute).
3. Leave it running. The page notices within a few seconds and shows *Naming
   helper connected*.

Pages only look for the helper (`http://127.0.0.1:8789`) after the visitor
has opened this pop-up once in that browser. Visitors who never ask for names
are never probed. Otherwise every page load would contact their computer,
log errors and, with Chrome's local-network-access prompts, could ask them
for a permission they have no reason to give.

After that, new analyses name tracks automatically; there's a *Name tracks
with Shazam* checkbox to switch it off. Sets already analyzed get a *Name
these IDs* button, which re-analyzes the stored recording with names and
replaces the set.

**How it works**

```
browser: analysis finishes → music span → a 12 s clip every 24 s (16 kHz WAV)
    └─ POST http://127.0.0.1:8789/identify ─► helper: shazamio fingerprints the clip
                                                └─► Shazam: match + offset
    ◄──────────── {track: {title, artist, art, …}, offset} ──────────┘
browser: probes → setlist.js anchors tracks on matches (same as the Python pipeline)
```

- **Privacy:** the recording stays on the visitor's computer. Clips go only
  to `127.0.0.1`, and only fingerprints go to Shazam, exactly as with the
  Python pipeline.
- **Helper endpoints:** `GET /health` and `POST /identify` (an audio file of
  up to 8 MB). Lookups are serialized and paced 0.6 s apart, with a 25 s
  timeout. The helper listens only on `127.0.0.1`.
- **Permissions:** it answers CORS and Chrome's *Private Network Access*
  preflight (`Access-Control-Allow-Private-Network: true`), so a public https
  page can reach it. To only accept your own site, run it with
  `--origin https://your-site.example`.
- **Another port:** if the helper runs with `--port 9000`, point the page at
  it with `localStorage.setItem("set-replay:helper-url", "http://127.0.0.1:9000")`
  in that browser. A site owner can set `window.SET_REPLAY_HELPER_URL` instead.
- **Python version:** shazamio's compiled core crashes on Python 3.14, so the
  helper builds its environment with Python 3.9–3.13. It uses the running
  interpreter if that one qualifies, otherwise `python3.12`/`3.13`/`3.11`/…
  from the PATH, or `py -3.12` on Windows. It checks the import in a separate
  process before starting. On Python 3.13 it also installs `audioop-lts`,
  which `pydub` needs.
- **Rate limits:** after 3 failed clips in a row, the browser stops asking.
  The set keeps the names it has, and an explanatory note is saved with it.
- **Timing:** expect about 3 s per lookup, so roughly 8 minutes of naming per
  hour of set on top of the analysis. On Recording 9 it named 10 tracks,
  matching the Python pipeline.

Browsers: Chrome, Edge and Firefox work. Safari may refuse to let an https
page talk to `127.0.0.1`, and the pop-up says so. The rest of the site runs
in all three engines, checked on every push.

---

## Spotify: the set as a playlist prompt

Spotify's **Prompted Playlist** (Premium; launched in New Zealand in December
2025 and in the US, Canada, the UK, Ireland, Australia and Sweden in early
2026; English only) builds a playlist from a typed description. The set page
writes that description for you, from what the analysis measured, in the
section **Take the vibe to Spotify**.

**Using it:** press **Copy prompt** (or `C`). In the Spotify app, tap
**Create** (+), then **Prompted Playlist**, and paste.

**Range: how far the playlist may wander.** *Close to the set* keeps the
song anchors and adds "Stay close to these artists and the artists around
them". *Balanced* (the default) is the prompt as described above.
*Discover* keeps the sound (genres, tempo, mood, flow, what to leave out)
but uses the artists only as a pointer, "in the spirit of … but mostly
other artists: lesser-known names and deeper cuts", and leaves the set's
own songs out. The keywords-only version and the Spotify playlist's
description follow the range, and in Discover the strength meter doesn't
count song anchors. The choice is remembered per set.

**How well the prompt pins the set down.** Above the prompt, a meter
(`vibe.promptStrength`) scores what it gives a playlist AI to go on, out of
100: artists 25 (full at three), genre 20, songs 20 (full at two), tempo 10,
mood 10, flow 10, things to avoid 5. Each part is one segment of the bar, and
the biggest gap becomes a tip, e.g. "only 1 artist: switch more of the set's
artists back on, or name more of its IDs". Under your own direction,
**Ideas** (`vibe.occasions`) suggest where the playlist fits, from the set's
character: *for a run* (energetic at 118+ BPM), *for the gym*, *for a
pre-party*, *for a late-night drive* (dark, minor-key), *to focus to*
(instrumental, gentle), *for the after-hours* (atmospheric)… One tap adds it
to the prompt, a second takes it out.

**Other services.** *Send to* picks where the prompt goes; each choice
changes the steps shown, the *Open* button and the copy message, and is
remembered in this browser:

| Send to | Where to paste | Notes |
| --- | --- | --- |
| Spotify | Create → Prompted Playlist | Premium. Only target with **Save the set to Spotify** |
| YouTube Music | Library → New → AI playlist | Premium, US and some other markets (launched February 2026) |
| Apple Music | Playlist Playground | In beta |
| Deezer | Playlist with AI | Beta, open to some subscribers |
| Any AI chat | Any assistant | The prompt is prefixed with a request for a numbered *Artist – Title* list of about N real tracks (N ≈ set length ÷ 3.5 min) | Switch off any
keyword chip that doesn't fit before copying, or add your own direction
("for a late-night drive"). *Keywords only* gives a one-line version under
300 characters, which also suits the older AI Playlist and other services'
prompt boxes.

**How the prompt is written** (`web/js/vibe.js`, pure functions, tested in
Node by `tools/analysis-test.mjs`):

- **Genres are weighed by agreement, not taken raw.** A phone in a loud room
  makes the style model hear drum & bass as "hardcore" or "gabber". Each
  style's share of the set is multiplied by how well the set's tempo fits it
  (the same tempo priors as step 4), discounted ×0.6 if it's a "harsh"
  style that room recordings over-report (unless Shazam backs it), and
  boosted by Shazam's genre for the named tracks. Up to three genres within
  45% of the best are switched on. Ambient and experimental are treated as
  texture ("atmospheric breakdowns", "experimental edges"), not genre.
- **Tempo:** a word (laid-back → driving → fast → high-tempo) plus "around
  175 BPM", or a range when the set moves.
- **Mood** from the duration-weighted model scores: aggressive → *punchy* or
  *hard-hitting*, happy → *euphoric*, or *dark* when the set is low on happy
  and mostly in minor keys, party → *clubby* or *rave-ready*, danceability
  → *relentlessly danceable*, minor-key share → *emotional*.
- **Sound:** vocal share (*big vocal hooks* / *vocal and instrumental cuts* /
  *mostly instrumental tracks*), textures, and *big drops* when drops come
  more than once every 2.5 minutes.
- **Artists** are the strongest steer for Spotify, so they're chosen with
  care. Each named track counts by how far its Shazam match can be trusted
  (repeat hits and confidence, ×0.35 when Shazam files it under a genre that
  rarely belongs in a DJ set, such as New Age or Soft Rock: those are
  usually room noise matched to library music). Lead artists count 1,
  co-artists 0.7, remixers 0.9, names in crowded credits 0.5. Names you
  type as `Artist – Title` count fully.
- **Tracks** to start from: the two (of three offered) named tracks that
  best combine a trusted match, a high **fit** (below) and playing time, as
  "Renaissance by Culture Shock". AI playlist makers steer hardest on song references, so these
  carry the set's taste better than any adjective.
- **Avoid**, measured from what the set is *not*, so the playlist doesn't
  drift: *tracks under N BPM* (N = the set's slowest tempo less ~6, when the
  tempo stays within 12 BPM), *cheesy chart-pop* (brightness ≤ 25%),
  *vocal-led pop* (vocals under 35%), *harsh, aggressive tracks*
  (aggression ≤ 15%). Hard styles the model heard but the evidence didn't
  back are offered too, switched off. The full prompt says "Leave out …",
  the short one "no …".
- **Labels** that recur (e.g. RAM Records, Positiva), the **era** of the
  trusted releases, and the **flow**: the energy arc over the set's thirds,
  phrased as an ordering instruction ("start strong, breathe in the middle,
  then build back up to a big finish"), and the **mood route** from the mood
  map: the dominant corner of each third, as "Let the mood move as the set
  does: open dark and driving, turn euphoric, and end warmer and calmer"
  (or "keep the mood … throughout"). It's relative to the set, so it
  describes the arc rather than an absolute level.

The **vibe fingerprint** radar shows the same numbers the words come from,
so you can see why the prompt says what it says. Under it, **Most like the
set** and **Curveballs** rank the tracks by **fit** (`vibe.trackFit`, out of
100): 60% feel, from the track's distance to the set's mean on the eight
axes measured in the set's own spread (so a steady set notices small
departures), and 40% sound, the cosine between the track's styles and the
set's. A curveball (fit under 70) says which axes it departs on most
("calmer, less danceable"). Both lists follow the *Prompt for* scope, and a
click plays the track.

**One chapter at a time.** A two-hour set often has a warm-up, a peak and a
come-down that would make three different playlists. Above the chips,
*Prompt for* switches the prompt (and the radar's fill, and what *Save*
exports) to one chapter. `phases.slicePayload()` cuts the set down to that
chapter's tracks, drops, styles and vocal share, and `vibe.js` writes the
prompt from that. A chapter with fewer than three named artists borrows the
whole set's leading artists (their chips say so), so Spotify still has names
to steer by. Each scope remembers its own switched-off chips.

**How chapters are found** (`web/js/phases.js`, also tested by
`tools/analysis-test.mjs`): each track is a point (energy, tempo), weighted by
its length. Dynamic programming finds, for 1 to 5 chapters, the split on
track boundaries with the least spread inside chapters, where no chapter may
be shorter than 2.5 minutes or 10% of the set. A chapter is kept only if it
removes at least 18% of the set's spread (plus 3% per extra chapter), so a
level set stays one chapter and both demos come out as *peak → cool-down*.
Names come from shape: the highest-energy chapter is the **Peak**, a lower
first chapter a **Warm-up** (else **Opening**), a lower last one a
**Cool-down** (else **Finale**), a dip between two higher chapters a
**Breather**, a climb before the peak a **Build**, a rise after it a
**Second wind**; a tempo change of 8+ BPM is added to the name ("Build ·
tempo up").

Saving lives in one function, `vibe-ui.spotifySave()`, used by this
section, the two-set blend (*Save both sets to Spotify*) and the suggested
running order (*Save in this order to Spotify*). Each passes what to resume
after Spotify's sign-in (`pending.action`: `save`, `blend` with the other
set's slug, or `order`); after the redirect, `takePending()` hands it back
to whichever section it belongs to, which finishes the save.

**Save the set to Spotify** creates a private playlist named
*&lt;set title&gt; · Set Replay* holding the set's named tracks, with the
keywords as its description. Each track is matched by ISRC first (Shazam
supplies it), then by title and lead artist; doubtful Shazam matches are
left out and listed. Spotify has no public API for Prompted Playlist itself,
so the page can't run the prompt for you. The saved playlist is the seed,
and the prompt is what you paste.

It signs in with OAuth 2 + PKCE entirely in the browser (`web/js/spotify.js`):
no secret, no server, scopes `playlist-modify-private playlist-modify-public`,
and the token lives in `sessionStorage` for the tab. It needs a Spotify
app's Client ID:

1. Create an app at <https://developer.spotify.com/dashboard> and tick
   *Web API*.
2. Add the page's address as a **Redirect URI**, exactly as the page shows
   it under *Use your own Spotify app*: `https://…/set.html`, or locally
   `http://127.0.0.1:8778/set.html`. Spotify rejects `localhost`, so open the
   local site at 127.0.0.1.
3. Either paste the Client ID on the page (kept in this browser's
   `localStorage`), or, as the host, ship it in a
   `<meta name="set-replay-spotify-client-id">` tag (see
   [Hosting details](#hosting-details)). Then the paste box is hidden.

Since February 2026, a Spotify app in *Development Mode* only works for its
owner (who needs Premium) and up to five users listed under *User
Management*. A public site therefore needs Extended Quota from Spotify, or
visitors bring their own app as above. Calls use the 2026 endpoints
(`POST /me/playlists`, `POST /playlists/{id}/items`, search with `limit` ≤ 10).

## Command-line options

`venv/bin/python analyzer/analyze.py [files…] [options]`

| Option | What it does |
| --- | --- |
| `--all` | Analyze every audio file in the project folder |
| `--title "…"` | Display title. It's saved to `output/<set>/meta.json` and reused on later runs, including `--all` |
| `--offline` | Send nothing to Shazam. Uses any probes already cached; otherwise tracks come from the audio alone (all shown as **ID**) |
| `--bpm-range 160-190` | Fold every tempo into this range, as DJ software does. Default: automatic, style-aware octave choice (see [Tempo](#4-tempo-and-the-octave-problem)) |
| `--step 24` | Seconds between Shazam probes. Smaller catches short tracks but takes longer |
| `--force` | Recompute the audio features instead of using `features.npz` |
| `--reprobe` | Delete the cached Shazam results for the set and ask again |

A set's **slug** (its ID in URLs and file names) comes from the file name:
`Recording 9.m4a` becomes `recording-9`, and the page URL becomes
`http://localhost:8778/#recording-9`.

---

## Architecture

```
                         ┌────────────────────────── analyzer/ (Python) ──────────────────────────┐
 Recording.m4a ─ffmpeg─► │ features.py   decode · 3-band energy · beats · tempo · key · EffNet     │
                         │ identify.py   Shazam probes (cached) · cover art                        │
                         │ music.py      Camelot · harmonic rules · style tempo priors · Viterbi    │
                         │ setlist.py    set span · novelty · segmentation · transitions · drops    │
                         │ analyze.py    CLI · checkpoints · summary · JSON export                  │
                         └──────────────┬──────────────────────────────────────────────────────────┘
                                        │ writes
             output/<set>/features.npz, shazam.json, meta.json      (checkpoints, git-ignored)
             web/data/sets/<set>.json, web/data/sets.json, web/data/art/*.jpg  (app data, git-ignored)
                                        │ reads
                         ┌──────────────▼──────────── web/ (static) ──────────────────────────────┐
                         │ index.html     landing: drop zone, queue, library, demos, teaser        │
                         │ set.html       the replay (viewer)                                      │
                         │ js/engine/     the browser engine (Web Workers, Essentia.js, ORT Web)    │
                         │ js/store.js    the visitor's library in IndexedDB                       │
                         │ js/app.js      viewer: canvases, SVG wheel, playback sync, shortcuts    │
                         │ js/sections/   one module per analysis section, given the app's ctx     │
                         │ js/roles.js    what each track does: Peak, Lift, Curveball, Key bridge… │
                         │ js/tracklist.js  tracklist as text, YouTube chapters, 1001TL, CUE sheet  │
                         │ js/vibe.js     set → vibe fingerprint, keyword chips, Spotify prompt     │
                         │ js/phases.js   chapters: optimal split on track energy + tempo, names   │
                         │ js/craft.js    mixing style archetype, key-move/type tallies, moments   │
                         │ js/moodmap.js  valence × arousal per track, corners, route sentence     │
                         │ js/card.js     the shareable set card: data (pure) + canvas painter     │
                         │ js/compare.js  similarity of two sets, differences, blended payload     │
                         │ js/drops.js    every drop's bass line aligned at the drop, style, stats  │
                         │ js/highlights.js  the set's best moments from every analysis; the reel  │
                         │ js/similarity.js  every pair of tracks: how alike; stretches, echoes     │
                         │ js/review.js   the set in words, plus a five-part scorecard             │
                         │ js/vibe-ui.js  radar, chips, copy; js/spotify.js PKCE + playlist save   │
                         │ js/color.js    Camelot key → OKLCH hue wheel → sRGB                     │
                         │ serve.py       local dev server (+ /audio/<file> with HTTP Range)       │
                         └─────────────────────────────────────────────────────────────────────────┘
```

In the browser, the same steps run without Python:

```
dropped file ─► decodeAudioData (16 kHz mono) ─► 2-minute ranges ─► worker pool
     (each worker: 3-band FFT · Percival · KeyExtractor · RhythmExtractor2013 · JS mel → EffNet)
  ─► merge ─► payload.js (port of setlist.py + build_payload) ─► IndexedDB ─► set.html?id=…
```

Design principles:

- **Analysis and display are fully decoupled.** The viewer only reads the set
  JSON. The browser engine and the Python pipeline both write that same
  schema, so either can feed it.
- **Visitors pay the compute.** Analysis runs on the visitor's machine, so
  hosting is free and their audio stays private.
- **Every expensive step is checkpointed.** Audio features land in
  `features.npz`, and each Shazam probe is written to `shazam.json` as it
  arrives. Re-running only redoes the cheap setlist stage (a few seconds), so
  tuning the segmentation needs no new lookups.
- **No build step, no front-end dependencies.** The page is vanilla JS, canvas
  and SVG. The only external fetch is the Archivo font from Google Fonts, which
  falls back to the system font offline.
- **DJ knowledge lives in one place** (`music.py`): key notation, mixing rules
  and style tempo ranges.

---

## The analysis pipeline, step by step

### 1. Decoding

ffmpeg decodes the recording to mono float32 twice:

- **44.1 kHz** for energy, beats, tempo and key (Essentia's rhythm algorithms
  assume 44.1 kHz).
- **16 kHz** for the Discogs-EffNet style model.

### 2. Three-band energy (`features.band_energy`)

A NumPy STFT (4096-point Hann window, hop = 1/8 s) sums power into three bands,
each in dB:

| Band | Range |
| --- | --- |
| Low | 20–150 Hz (kick and sub-bass) |
| Mid | 150 Hz – 2.5 kHz |
| High | 2.5–11 kHz (hats and air) |

Full-band RMS in dB comes from the same frames. This 8 fps data drives:

- the ribbon waveform
- bass-swap and breakdown detection
- drop detection
- the energy curve

### 3. Beats, tempo and key (Essentia)

- **Beats:** `RhythmExtractor2013` (degara method), run in 60 s chunks that
  overlap by 6 s so it follows tempo changes between tracks. At each seam, the
  beats come from whichever chunk holds them further from its edge.
- **Tempo:** `PercivalBpmEstimator` on 20 s windows every 10 s. This is the most
  stable estimator on room recordings. Raw values can be an octave off; see the
  next section.
- **Key:** `KeyExtractor` with the **`edma` profile** (built for electronic
  dance music) on 20 s windows every 10 s. Each window yields a key, a scale
  and a strength.

### 4. Tempo and the octave problem

Beat trackers often lock onto half-time: 175 BPM drum & bass reads as 87.5 BPM.
`music.resolve_octaves` settles this with a **Viterbi pass** over the tempo
windows. First the raw tempo is median-filtered over 5 windows, removing
one-off misreadings. Each window's candidates are then ×½, ×1 and ×2.

- **Scoring a candidate:** how well that tempo fits the styles the model hears
  in that window. `music.STYLE_TEMPO` gives about 80 Discogs styles a typical
  BPM range (Drum n Bass 165–180, Techno 125–140, Hip Hop 80–100, …). Styles
  that reverb tends to be mistaken for (Downtempo, Dub, Trip Hop) get a 0.3
  vote.
- **Tempo jumps:** cost 12 per octave of change in the *resolved* tempo.
  Because 87.5 × 2 and 175 × 1 are the same tempo, only a real change of speed
  costs anything, so a steady set gets one consistent octave.

Next, **tempo blips** are smoothed within the set's music span
(`fill_tempo_blips`). A DJ doesn't change tempo for a minute and then change
straight back, so up to 90 s of misreadings between two stretches at the same
tempo take that tempo. The misreadings can be a mix of different values, such
as 113, 195 and then 140 BPM inside a 174 BPM set. Then, at the start and end of the set,
up to 2 minutes of short scattered runs (fade-ins, fade-outs, crowd noise)
take the nearest established tempo.
This catches the browser engine's occasional 16 kHz misreadings (e.g. 140
instead of 174 for one stretch) and leaves real tempo changes alone. The
resolved curve is then median-filtered, and the beat grid is filled in at the
midpoints where it was tracked at half-time. Pass `--bpm-range lo-hi` to
replace all of this with simple folding into a range.

### 5. Styles, moods and embeddings (Discogs-EffNet, ONNX)

Essentia's `TensorflowInputMusiCNN` front-end (96-band log-mel, 512/256 at
16 kHz) is grouped into 128-frame patches with a 62-frame hop: one ~2 s patch
about every second. `discogs-effnet-bsdynamic-1.onnx` runs on ONNX Runtime, so
no TensorFlow is needed. Per patch it gives:

- **400 style activations**, e.g. `Electronic---Drum n Bass`
- a **1280-d embedding**, the model's description of the sound

Five small ONNX classifier heads read the embedding: danceability, party,
aggressive, happy, and voice vs instrumental. Each head's output class is
looked up by name, because their class orders differ.

When styles are shown, `music.fuse_styles` multiplies each activation by its
**tempo likelihood**:

- 1.0 inside the style's BPM range
- a Gaussian falloff (σ = 6 BPM, floor 0.03) outside it
- 0.15 for styles with no known range

The result is renormalized. This sharpens the styles a great deal on noisy
room audio.

### 6. Track identification (`identify.py`, Shazam via shazamio)

- **Probing:** a 12 s clip is cut every 24 s, but **only inside the music
  span** (step 7).
- **What's sent:** `shazamio_core` fingerprints the clip locally, and only the
  fingerprint is sent.
- **What's kept:** title, artist, Shazam ID, genre, album, label, release
  year, ISRC, cover art URL, Shazam and Apple Music links, and the **match
  offset** (where in the original track the clip falls).
- **Caching:** every probe, hit or miss, is stored in `output/<set>/shazam.json`
  as it arrives, so interrupted runs resume.
- **Failures:** each request has a 25 s timeout and 3 attempts with backoff.
  After **3 failed probes in a row** (Shazam rate-limiting), probing stops and
  the run continues with what's cached; re-run later to fill the gaps.
- **Cover art** is downloaded once into `web/data/art/`, so the app works
  offline afterward.

### 7. Where the set is (`setlist.music_span`)

Phones often keep recording after the music stops. RMS is taken per 10 s
window, and a window counts as music if it's within 20 dB of the set's loud
level (its 90th percentile).

- **End:** the first point where the next 2 minutes are at most 20% music
  **and** less than 20% of everything after it is music. A breakdown or a short
  pause mid-set doesn't qualify.
- **Start:** the mirror-image rule.

Track segmentation, energy scaling, drops, Shazam probing and averages all
use this span. The page grays out the rest.

### 8. Novelty: where the music changes (`setlist.novelty`)

EffNet embeddings are averaged into 2 s bins and L2-normalized. A cosine
self-similarity matrix is built from them, and a **Foote checkerboard kernel**
(±24 s with Gaussian taper) slides along its diagonal. The result is a novelty
curve, normalized to its 99.5th percentile, that peaks where the music changes
character, which is usually a track change.

### 9. Segmentation into tracks (`setlist.segment`)

1. **Shazam runs.** Consecutive probes that match the same song form a run:
   one played track.
   - Titles are normalized first, so *Extended Mix*, *Original Mix*,
     *Radio Edit* and *feat.* credits count as the same song.
   - A lone stray match inside another track (A x A) is dropped.
   - Each run's **start estimate** is the median of `probe time − match
     offset`, i.e. the moment the DJ brought that track in.
2. **Gaps.** The algorithm walks the gaps between anchors: the set start, each
   run, and the set end. The track count is always boundaries + 1.
   - **Between two named tracks:** exactly one swap boundary, at the strongest
     novelty peak *after the incoming track's start estimate* (a track can't
     take over before it started).
   - **A gap of 3 minutes or more** may also hold unnamed tracks, split on
     novelty peaks with prominence ≥ 0.25, each at least 60 s long.
   - **Before the first and after the last named track:** unnamed tracks only
     on clear novelty peaks. If the first named track started more than 45 s
     in, whatever played before it becomes an ID track ending at that start.
3. **No identification at all** (the browser, or `--offline` with an empty
   cache): tracks split only on novelty peaks with prominence ≥ 0.4, each at
   least 75 s long. These values were tuned against the Shazam-anchored
   setlists of the bundled sets. Recording 9 gives 18 tracks against the 13
   Shazam names, with most swap points within a few seconds.

### 10. Per-track measurements

Each track's span runs from its incoming swap to its outgoing swap. Measures
are taken over the span with 8 s trimmed from each end:

| Field | How |
| --- | --- |
| `bpm` | Median of the resolved tempo curve |
| `key` | Strength-weighted vote of the windowed keys → Camelot code, key name, and the share of the vote it won |
| `styles` | Mean EffNet activations, re-weighted by the track's BPM, top 4 |
| `moods` | Mean of each head's score |
| `energy` | 1–10, the track's mean of the set energy curve, scaled between the set's 2nd and 99.5th percentiles |
| `spark` | 48-point energy sparkline |
| `id_confidence` | Shazam hits ÷ probes inside the track. One hit below 25% is shown as *possible match* |
| `played_linear` | Whether the start estimates agree within 20 s, i.e. the track wasn't looped or jumped around |

The **energy curve** (1 Hz) is a weighted sum, smoothed over 8 s:
`0.5·loudness + 0.2·high-band brightness + 0.15·party + 0.15·aggressive`.

### 11. Transitions (`setlist.build`)

For each pair of neighboring tracks:

- **Swap:** the boundary from step 9.
- **Mix in:** the incoming track's Shazam start estimate, if it lies within
  150 s before the swap. Otherwise, the point where the novelty curve falls
  below half its peak, walking left (≤ 48 s).
- **Mix out:** the same half-peak walk to the right of the swap.
- **Bars:** `duration × BPM / 240`.

The **type** comes from the 2 s-smoothed low band and loudness in three
windows: 24–8 s before the swap, ±6 s around it, and 8–24 s after it. The
first rule that matches wins:

| Type | Rule |
| --- | --- |
| Cut | Mix shorter than 8 s |
| Into breakdown | Low end afterward is more than 12 dB below before (the mix lands in the new track's stripped-back section) |
| Drop swap | Low end before is more than 12 dB below after (the new track's drop arrives at the swap) |
| Breakdown drop | The low end stays more than 10 dB down for at least 6 s within ±16 s of the swap |
| Bass swap | A brief low-end dip of at least 8 dB at the swap (one bassline out, the other in) |
| Double drop | Loudness at the swap is more than 2.5 dB above both sides |
| Long blend | 32 bars or more |
| Blend | Anything else |

Each transition also records:

- **Harmonic relation** (`music.harmonic_relation`):
  - **compatible:** same key, ±1 on the wheel ("energy up/down"), or the
    relative major/minor
  - **partial:** two steps, +7 ("energy boost"), or a mood shift
  - **clash:** anything else
- **BPM delta**, **energy delta** and **loudness delta**.
- **Low-end dip** and **breakdown length**.
- **Style continuity:** the overlap of the two tracks' style mixes.
- **Sharpness:** the novelty value at the swap.

### 12. Drops (`setlist.find_drops`)

A drop is recorded when the 1 s low band falls more than 8 dB below its 60 s
rolling median for at least 6 s, then returns to within 3 dB of it. Each drop
records:

- the drop time and the breakdown's start
- its length and depth
- its impact: how hard the bass comes back

### 13. Summary and export (`analyze.py`)

The set summary includes:

- track and identified counts
- duration-weighted average BPM and its range
- transition count, average length and bars, and counts by type
- harmonic percentage and the longest blend
- drop count and peak-energy time
- vocal share and overall style shares
- the set span

These, with the tracks, transitions, drops and curves, are written as compact
JSON (next section). `web/data/sets.json` is rebuilt after every run.

---

## The browser engine

`web/js/engine/` reproduces the Python pipeline in the browser:

| File | Role |
| --- | --- |
| `pipeline.js` | Decodes with `OfflineAudioContext` (mono 16 kHz). Browsers that refuse a 16 kHz context (older Safari allows only 22.05 kHz and up) decode at 44.1 kHz instead, and `resample()` brings it to 16 kHz: a 16-tap windowed-sinc filter with an anti-aliasing cutoff, about 0.2 s per 10 minutes of audio. On Recording 9 that path gives the same tempo and nearly identical track starts. It then plans 2-minute ranges. It downloads the models **once** on the main thread, showing "Downloading the analysis models · 12 of 21 MB", and hands the bytes to every worker. The landing page starts this download as soon as files are dropped, before Analyze is pressed, and the analysis reuses it; any caller can follow its progress. It starts one worker first, so the WebAssembly libraries are cached before the rest of the pool (cores − 1, at most 6) starts; on a first visit the downloads therefore don't multiply by the number of workers. It then merges the ranges and builds the payload, supports canceling (`AbortSignal`), and turns out-of-memory decode failures into readable errors. A worker that crashes mid-run (WebKit has shown WebAssembly "Out of bounds memory access" now and then) is replaced by a fresh one and its range runs once more; only a second crash on the same range fails the analysis, with a clear message. Each range's audio is posted as a copy so it's still there for that retry, and is released once the range is done. A worker that sends nothing for 3 minutes while busy (WebKit can end a worker without any error event) is treated the same way: replaced, and its range retried once; a second stall on that range fails the analysis instead of hanging. The pool is rebuilt for the next file |
| `demux.js` | Takes the soundtrack out of a video without loading the video. MP4 and MOV are ISO media files whose `moov` box indexes every chunk of every track, so it walks the top-level boxes with small `Blob.slice()` reads, reads only `moov`, finds the AAC sound track (`hdlr` = `soun`, sample entry `mp4a`), works out each audio chunk's place and length from `stsc`/`stsz`/`stco` (or `co64`), and writes a new audio-only `.m4a` (`ftyp` + a `moov` holding just that track with its chunk offsets rewritten + an `mdat` of those chunks). No re-encoding, so the audio packets are identical; a 5-minute 1080p MOV (587 MB) gives a 5 MB M4A in ~70 ms. QuickTime describes AAC with a version 1 or 2 sound entry (the `esds` inside a `wave` box), which WebKit won't decode, so that entry is rewritten into the ISO version 0 form. Anything else (WebM, fragmented MP4, PCM sound) returns `null` and the whole file is decoded as before, with a clear message if it's over 1.5 GB. `analyzeFile()` calls it for any video and hands the M4A back through `onAudio`, which the landing page stores instead of the video |
| `worker.js` | Loads Essentia.js, ONNX Runtime Web and the models once per worker, then extracts features for ranges |
| `payload-worker.js` | Builds the set JSON (setlist, transitions, curves) off the main thread, about 0.2 s for a 34-minute set on a laptop and longer on phones, so the page never freezes at the end. The big arrays are transferred, not copied. If no worker can be created, the main thread does it |
| `extract.js` | The per-range features. Each lives on a fixed global grid (band frames, tempo windows, key windows, 54 s beat chunks, EffNet patches), and a worker only computes grid items that start inside its range, so the parallel ranges join exactly. The beat tracker assumes 44.1 kHz, so its 60 s chunks are upsampled on the fly |
| `mel.js` | A pure-JS twin of Essentia's `TensorflowInputMusiCNN` (Hann → FFT → 96 Slaney mel bands, unit-area triangles, on the power spectrum → `log10(1 + 10000·x)`). It matches Essentia.js to a max error of 6e-5 and is about 30× faster than one WASM call per frame |
| `music.js`, `setlist.js`, `payload.js` | Line-for-line ports of `music.py`, `setlist.py` and `analyze.build_payload` |
| `dsp.js` | FFT, percentiles, smoothing, median filter and interpolation |
| `config.js` | Asset URLs (jsDelivr, then unpkg as a fallback, via `importFirst`; self-hosted models), the 16 kHz working sample rate and the classifier heads. Pages import only this and `naming.js` up front; the analysis modules load when an analysis starts |
| `naming.js` | Optional naming through the helper: finds it (`/health`), cuts the 12 s clips, encodes WAV, and collects probes |

The engine works at 16 kHz rather than the Python pipeline's 44.1 kHz. That
keeps a 2-hour set to about 450 MB of decoded audio, and the high band tops
out at 8 kHz. Every threshold downstream is relative, so the two engines
agree.

**Verifying it.** `tools/engine-check.mjs` runs the exact browser engine under
Node and prints its setlist next to the Python output:

```bash
mkdir -p .engine-deps && cd .engine-deps \
  && npm pack essentia.js@0.1.3 onnxruntime-web@1.30.0 \
  && mkdir ess ort && tar xzf essentia.js-0.1.3.tgz -C ess && tar xzf onnxruntime-web-1.30.0.tgz -C ort && cd ..
node tools/engine-check.mjs "Recording 9.m4a" --cache /tmp/r9.v8
```

`--cache` saves the extracted features, so you can iterate on the setlist
logic in seconds.

**Self-test without recordings.** `node tools/selftest.mjs` (same
`.engine-deps` folder) builds a 3-minute synthetic set with a known answer:
house at 128 BPM over A minor, then 140 BPM over D minor with a different
timbre. It runs the exact browser engine and checks tempo (127.1 / 138.9),
key (8A / 7A), that a track change is found near 90 s, and that every part
of the output is present. It takes about 6 s and is deterministic.
**Python pipeline self-test.** `venv/bin/python tools/selftest_py.py` runs
the Python pipeline's own stages on the same synthetic set and makes the same
checks: tempo 127.6 / 139.7, keys 8A / 7A, and a change at 91 s. It keeps the
two engines in agreement. Its first run found that a reused
`PercivalBpmEstimator` keeps returning its first answer, which had frozen the
Python tempo curve. That is now fixed, with a fresh estimator per window.

**Whole-site test in a real browser.** `bash tools/build-site.sh && node
tools/e2e.mjs [--chrome]` serves the packaged site from a sub-folder, gives
the landing page's file input the same synthetic set, presses Analyze and
waits for the result page. Its 27 checks cover:
- the story, the track change, the 127–139 BPM tempo range and keys 8A → 7A
- *Copy tracklist* lists each ID with its key and tempo
- Play really plays and shows the pause icon, and Space pauses
- a transition row opens the mix inspector
- *Download the analysis* gives a `.setreplay.json` that imports back into
  the library
- Delete needs two clicks
- no page errors
- **on a phone** (390 × 844, touch): no sideways scroll on the landing or
  replay page, no cut-off ribbon labels, and tapping the ribbon moves the
  playhead
- **naming through the helper**, using a stand-in helper with known answers
  (clips before 90 s are "Track A", later ones "Track B"): the naming bar
  connects, the helper is asked once per probe, the tracks carry those
  names, the swap lands near 90 s, and there are no errors It uses Playwright's Chromium, or your installed
Chrome with `--chrome` (always a fresh temporary profile), and takes about
7 s.

**GitHub Actions** (`.github/workflows/selftest.yml`) runs all three on every
push to `main`, together with a JS syntax check, a Python compile check and the
site build. The browser test runs in **Chromium, Firefox and WebKit**
(Safari's engine) in parallel. All three pass the full flow, except that the
clipboard check runs only in Chromium, where a test can grant clipboard
access. That matrix found and fixed three real issues:
- Firefox: an unhandled `storage.persist()` promise
- Firefox: an unhandled `AudioContext.resume()` promise
- WebKit: no Blob storage in private sessions

Each run takes a few minutes. Results on Recording 9 (one of the bundled
demo sets) with identification off: the browser engine and Python both give
18 tracks with identical start times.

**Speed** (Chrome, Apple M4, 6 workers): about 2 minutes per hour of
recording, from drop to result. Dropping both bundled recordings together
(34 and 94 minutes) took 254 s, analyzed in turn. Long sets scale linearly.

---

## The data format

`web/data/sets.json`: one entry per analyzed set, naturally sorted (9 before 10):

```json
[{ "slug": "recording-9", "title": "Worship Part 1", "file": "Recording 9.m4a",
   "duration": 2061.27, "tracks": 13, "identified": 10, "bpm_avg": 175.2,
   "keys": ["10A", "4B", "1A", …], "analyzed_at": "2026-10-19T00:41:12" }]
```

`web/data/sets/<slug>.json`: everything the page needs for one set:

| Key | Contents |
| --- | --- |
| `slug`, `title`, `file`, `duration`, `analyzed_at`, `source` | Identity. `source` is `browser`, `demo` or absent (Python). In local-server mode, `file` is the recording served at `/audio/<file>`; in the browser, `slug` is the IndexedDB id |
| `summary` | Set-level numbers (step 13), including `set_start`, `set_end` and `set_length` |
| `tracks[]` | `n, start, end, title, artist, identified, meta{id, album, label, released, isrc, art, art_local, shazam_url, apple_url, genre}, id_confidence, shazam_hits, start_est, played_linear, bpm, key{camelot, name, confidence}, styles[{style, genre, p}], moods{…}, energy, loudness_db, spark[]` |
| `transitions[]` | `from, to, mix_in, swap, mix_out, duration, bars, type, bpm_from, bpm_to, bpm_delta, key_from, key_to, harmonic{label, compatible}, energy_delta, loudness_delta_db, low_dip_db, low_before_db, low_after_db, breakdown_s, style_continuity, sharpness` |
| `drops[]` | `t, breakdown_start, breakdown_s, depth_db, impact_db` |
| `beats[]` | Resolved beat times (s) |
| `curves.wave` | `low`, `mid`, `high` as 0–99 integers at `wave_fps` (8): per-band normalized over the set, with a 1.4 contrast curve |
| `curves.energy` | 1 Hz, 0–1 |
| `curves.bpm` | `t`, resolved `v`, `raw` (every 10 s) |
| `curves.novelty` | Every 2 s |
| `curves.moods` | Every 10 s, one array per head |
| `curves.styles` | Every 30 s; `names` = the set's top 6 styles + `Other`, and `v` = tempo-weighted shares |
| `curves.keys` | Windowed Camelot codes and strengths |
| `probes[]` | Every Shazam probe: `t, dur, id`, or `null` for no match (empty from the browser engine) |
| `credits` | Which tools produced which fields |

Checkpoints in `output/<slug>/`:

| File | Contents |
| --- | --- |
| `features.npz` | Bands, beats, raw tempo windows, keys, EffNet activations (float32) and embeddings (float16), head scores |
| `shazam.json` | Probe cache keyed by clip start time |
| `meta.json` | Remembered `--title` |

---

## The web app

### Pages and data sources

| URL | Loads |
| --- | --- |
| `index.html` | The landing page. Analyzes dropped files in place and saves them to IndexedDB (`js/store.js`: one record per set, holding the payload and the original `File` as a Blob) |
| `set.html?id=<id>` | A set from this browser's library, played from its stored Blob |
| `set.html?demo=<slug>` | A bundled demo from `demo/<slug>.json`. Without audio it runs on a virtual clock, so clicking still moves the playhead |
| `set.html#<slug>` | The local Python server's output (`data/sets.json` + `/audio/<file>`) |

Local sets offer three extra actions: **Download the analysis (JSON)**,
which includes your track names; **Add the recording**, for imported
analyses; and **Delete from this browser**.

### Local server (`web/serve.py`)

A threaded `http.server` on `127.0.0.1` only, for development and the Python
pipeline:

- serves `web/` with `Cache-Control: no-store`, so re-analyzed data shows up on
  reload
- serves `/audio/<file>` from the project folder, with **HTTP Range** support,
  so the browser can seek instantly in long recordings (including `.m4a` files
  whose index is at the end of the file)
- accepts only plain names of audio files in the project root; there's no path
  traversal

### Viewer (`web/js/app.js` and `web/js/sections/`, vanilla JS ES modules)

`app.js` (~1,600 lines) holds the state, loading, the ribbon, deck, setlist,
mix inspector, wheel, energy and style rows, playback and keyboard. The
analysis sections live in `web/js/sections/`, one module each (`craft-ui.js`,
`moodmap-ui.js`, `compare-ui.js`, `card-ui.js`, `chapters-ui.js`, `nav.js`,
`review-ui.js`, `simx-ui.js`, `highlights-ui.js`, `drops-ui.js`). Each
exports a factory, e.g. `moodMapSection(ctx)`, that takes the app's shared
state and helpers (`ctx`: `S`, `$`, `tracks`, `keyColor`, `fmt`, `seek`,
`showTip`, …, built at the end of `app.js`) and returns the functions the rest
of the page calls (`renderMoodMap`, `updateMoodMap`). The analyses themselves
stay in the pure, DOM-free modules (`vibe.js`, `craft.js`, `moodmap.js`, …)
that `tools/analysis-test.mjs` runs in Node.


- **State:** one `S` object holds the loaded set, the ribbon view window
  `{t0, t1}`, the current track, the selected mix, and the follow and loop
  flags.
- **Loading:** `boot()` picks the source from the URL (`?id=`, `?demo=` or the
  local server). `openPayload()` renders every view and points the `<audio>`
  at the stored Blob, the demo audio, or `/audio/<file>`. `now()` reads either
  the audio clock or the virtual clock.
- **Drawing:**
  - The ribbon, overview, scrub bar, mix inspector, energy chart, sparklines
    and style and mood rows are `<canvas>`, drawn at device pixel ratio.
  - Waveforms take the per-pixel maximum of each band over the frames that
    pixel covers. That keeps a 94-minute set at 8 fps fast at any zoom level.
  - Track colors are precomputed per track. `colorAt(t)` interpolates between
    two tracks' colors inside a mix window, which produces the cross-fades.
- **Camelot wheel:** inline SVG with 24 ring segments (major keys outer, minor
  inner, 12 at the top). Track dots fan out within their key's segment.
  Connections between keys far apart on the wheel bend toward the center, so
  the path reads as a journey.
- **Playback sync:** a `requestAnimationFrame` loop updates the playheads,
  current track, live mix selection, loop-a-mix, follow-scroll, beat pulse
  (from the beat grid), live BPM (from the tempo curve) and the spectrum.
  - The spectrum uses a Web Audio `AnalyserNode` that is created on the first
    play, since browsers require a user gesture.
  - When paused, views update on `seeked` / `timeupdate` instead.
- **Compare:** `renderCompare()` lists the other sets of the current source
  (`S.sets`); `loadPayload()` fetches the chosen one the same way the page
  loaded this one (IndexedDB, `demo/`, or `data/sets/`). `compare.js`'s
  `compareSets()` scores it, and `mergePayloads()` joins the two (tracks
  renumbered, the second set's times, drops and energy shifted after the
  first, summary re-weighted by length) so `vibe.js` writes the blend prompt
  with no special case. The choice is kept under
  `set-replay:compare:<slug>`.
- **Set card:** `card.js` splits into `cardData()` (pure: gathers the
  card's words and numbers from `vibe.js`, `craft.js`, `moodmap.js` and
  `phases.js`) and `drawCard()` (paints a 1080 × 1350 canvas). `openCard()`
  waits for the Archivo weights (`document.fonts.load`) so the canvas uses
  the page's typeface, then draws; Download uses `canvas.toBlob`, Share uses
  `navigator.share({ files })` when `navigator.canShare` allows it.
- **Links to a section:** `set.html?…#<section id>` (e.g. `#vibe`, `#rv`)
  opens the set at that section once it has drawn (`deepLink()`); every
  section has `scroll-margin-top`, so the browser's own jump and the bar's
  both stop below the sticky bar. The local server's `#<slug>` links are left
  alone, since only section ids are matched.
- **Section bar:** `renderNav()` builds the chips from the visible sections;
  `spyNav()` (on scroll, once per frame) marks the last section whose top has
  passed 30% of the way down the screen, or the last section at the bottom of
  the page. A click smooth-scrolls (instantly under reduced motion) and, once
  the scroll stops, nudges the section into place if anything above it changed
  height on the way.
- **Lazy work:** the running-order search (`reorder()`, ~0.2 s for 80 tracks)
  is the page's one heavy analysis, so it runs only when its section comes
  within 600 px of the screen (`lazy()`, IntersectionObserver +
  `requestIdleCallback`), holding about its final height meanwhile. Everything
  else builds in ~10 ms for a 19-track set.
- **Highlights:** `highlights.js`'s `highlights(D, name)` scores candidate
  moments (biggest drop 90, longest blend 75, the peak 70, …), keeps the
  strongest that are at least 25 s apart (10 at most) and sorts them by time.
  The reel is `S.reel = { i }`: `tick()` moves to the next moment when the
  current one's listening time is up, and stops the reel when playback leaves
  the moment (the listener seeked), so the reel never fights the listener.
- **Drop anatomy:** `drops.js`'s `dropAnatomy()` samples `curves.wave.low`
  every half second around each drop (`PRE` 32 s, `POST` 16 s);
  `renderDrops()` / `drawDrops()` paint it on a canvas, and `tick()` redraws
  it when playback enters a drop's window, to move the dot.
- **Mood map:** `renderMoodMap()` draws `moodmap.js`'s `moodMap()` as
  inline SVG (a 400 × 400 viewBox, domains padded to the data); each dot is a
  focusable `<g role="button">`. `setTrack()` calls `updateMoodMap()`,
  which splits the route polyline at the playing track and rings its dot.
  The route sentence takes the dominant corner (by time) of each third of
  the set; "swings widely" / "small steps" come from the mean step length
  between consecutive tracks on the normalized map.
- **How it was mixed:** `renderCraft()` draws from `craft.js`'s
  `craftProfile()`. The timeline is HTML (one `<button>` per mix, height in a
  CSS variable), so each column is focusable and clickable; `selectMix()`
  calls `markCraft()` to outline the selected one. Archetype scores, from the
  transitions alone: *blender* = median bars and share of 32+-bar mixes;
  *technician* = share of bass swaps (type or a low-end dip of 8 dB+), in-key
  share and a steady tempo; *drop architect* = share of breakdown/drop mixes;
  *quick cutter* = cuts and short mixes; *key purist* = in-key share above 60%
  with no clashes; *selector* = clashes, tempo moves and little shared sound.
  A runner-up within 80% of the winner is named too.
  **Smoothness** (`craft.mixScore`, 0–100) adds five parts: key 30
  (compatible 30, a bolder move 18, a clash 4), tempo 25 (full within
  0.5 BPM, nothing at 6+ apart), low end 20 (full when one bass line gives
  way: a bass swap, a drop or breakdown type, or a low-end dip of 6 dB+;
  cuts 14; otherwise scaled by the dip), phrasing 15 (on 4-bar phrases
  under 16 bars, 8-bar ones above, with 10% slack because bar counts from a
  room recording drift) and energy 10 (no lurch over 1.5, unless the type is
  a deliberate drop). Labels: *seamless* 85+, *clean* 70+, *rough edges*
  55+, else *bumpy*. Each lost point comes with a reason, and `mixTips()`
  turns the reasons into fixes; `bridgeKeys()` finds keys compatible with
  both sides, else a breadth-first shortest path over in-key moves.
  `reorder()` scores an order by, per neighboring pair, the key move (0
  clean, 0.4 bolder, 1 clash) plus half the tempo step (in 6-BPM units), and,
  per position, 0.06 × the gap between the track's energy and the energy the
  original set had there, so the warm-up / peak / cool-down arc survives. It
  improves the played order by moving or swapping tracks until no move helps
  (deterministic, ~5 ms for 19 tracks). With `pinEnds` (the default) the
  first and last tracks never move; without it, the search also starts from
  the pinned answer and keeps the cheaper result, so freeing the ends never
  comes out worse. Demo 2 goes from 4 clashes to 0; demo 1 from 8 clean mixes
  to 10.
- **Chapters:** `openPayload()` runs `findPhases()` once into `S.phases`;
  `renderPhases()` builds the strip (CSS grid with `fr` columns in seconds),
  `drawEnergy()` adds the dashed boundaries, `setTrack()` outlines the
  playing chapter, and `story()` names the chapters in the header.
- **The vibe section** (`js/vibe-ui.js`): `openPayload()` calls
  `mountVibe()`, which builds the profile with `vibe.js` and draws the radar
  as inline SVG; `setTrack()` calls `vibeTrack()` so the dashed outline
  follows playback, and a rename calls `vibeNames()` (a name typed as
  `Artist – Title` adds an artist). `boot()` first awaits `vibeAuthReturn()`:
  when Spotify's sign-in sends the visitor back with `?code=…`, it swaps the
  code for a token and restores the set's original URL before routing.
  Chip choices live under `set-replay:vibe:<slug>`.
- **Your edits:** renamed IDs and set titles are saved in `localStorage`
  under `set-replay:<slug>`. They never touch the analysis files.

### Design system

- **Color carries data.** The only accent colors come from the music.
  `color.js` maps Camelot number *n* to hue `18° + (n−1)·30°` on a perceptual
  **OKLCH** wheel:
  - minor (A) keys are deeper, major (B) keys lighter
  - each key has four tones: deep, base, pale and ink, used for the low, mid
    and high waveform layers and for text
  - harmonic neighbors therefore get neighboring hues, and a key clash looks
    like a jump in color
- **Base palette:** a booth-dark violet graphite (`#16151E` page, `#201E2B`
  panels), paper-white ink (`#EFECF5`), and muted grays for secondary text.
- **Type:** a single family, **Archivo**, whose *width* axis does the
  expressive work:
  - 125% expanded, black weight, for the set title (rave-flyer energy)
  - 112% for section headings
  - 62–80% condensed with tabular figures for BPM, times and data, like a CDJ
    readout
- **Responsive:**
  - below 1080 px the now-playing panel stacks above the setlist
  - below 720 px the gutter shrinks to 16 px and secondary columns hide;
    ribbon labels on narrow tracks drop their padding so the track number
    stays whole (checked at 390 px with no horizontal scroll)
  - reduced-motion settings are respected
  - focus outlines are visible on every control
  - text meets WCAG AA contrast (4.5:1) on every surface: the faintest grey,
    `--faint` `#928DA6`, is the lightest that still reads at 4.5:1 on the
    page, panels and raised chips
  - `tools/a11y.mjs` runs axe-core (WCAG 2.1 A and AA) over the landing page
    and a demo's set page at desktop and phone sizes, in CI; it reports no
    violations
  - every control has an accessible name (the drop zone included), and a
    polite live region announces when an analysis starts, finishes, stops or
    fails, without reading out each progress tick

---

## Accuracy and limits

- **Room recordings are hard.** These sets are phone captures with crowd noise
  and reverb, and Shazam matched about a third of the probes. A track heard
  only once is flagged *possible match*. The match is real, but the track may
  only have played briefly, or it may be a near-miss.
- **Styles are relative.** On room audio the style model leans toward
  *Hardcore / Ambient / Experimental*, even after tempo re-weighting. Read
  styles as "this track sounds harder than the last", not as definitive genre
  tags. Shazam's own genre (often just "Dance" or "Electronic") is kept in
  `meta.genre`.
- **Without names, track boundaries are rougher.** Audio-only segmentation
  finds about 60% of real track changes (F1 ≈ 0.6 within 20 s on the bundled
  sets). Wider or narrower novelty kernels, style activations and key-change
  signals didn't reliably beat it. `tools/tune_segmentation.py` re-runs that
  comparison against any Shazam-labeled sets, so the defaults can be revisited
  as more labeled sets come in. The naming helper anchors tracks properly.
- **Timing precision varies.** Swap points (±a few seconds) and BPM are the
  most reliable numbers. Mix-in and mix-out are estimates, and transition
  types are heuristics built from the low end and loudness.
- **Keys** use the EDM profile and a vote over windows. The share of the vote
  appears when you hover a key chip; low shares mean the key is uncertain.
- **Phrase position is unknown.** Bars are counted from the swap because
  downbeat (bar-start) detection on room recordings isn't reliable enough to
  show bar 1.

---

## Costs and licenses

- **Hosting:** free on any static host. There's no server compute: visitors'
  browsers do the analysis.
- **Bandwidth:** each visitor downloads about 21 MB of models from your host
  (once per visit, then cached for a year) and about 16 MB of engine
  WebAssembly from jsDelivr (a free CDN). Workers share one copy of each.
- **Licenses:**
  - **Set Replay's own code is AGPL-3.0** (`LICENSE`), matching Essentia
    and Essentia.js, which it builds on.
  - **Essentia (Python) and Essentia.js are AGPL-3.0**, so a public
    deployment must offer its source; linking to this repository (or your
    fork, if you change it) does that.
  - **The Discogs-EffNet models are CC BY-NC-SA 4.0**: attribution,
    non-commercial use only, and share-alike. For a commercial site, get a
    license from the MTG (`web/models/LICENSE.md`).
  - ONNX Runtime Web is MIT.
- **Track names:** browsers can't reach Shazam, so the site alone leaves
  nameable **ID**s. With the optional [naming helper](#naming-tracks-with-the-helper),
  each visitor's own computer asks Shazam, which costs nothing and creates no
  shared rate limits. It's still Shazam's unofficial API, the same gray area
  as `shazamio` itself, used for personal lookups. Automatic names for every
  visitor without a helper would need a paid recognition service (e.g.
  ACRCloud or AudD) behind a small relay.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `shazam not responding (likely rate-limited)` | Shazam throttles bursts. The run continues with what's cached; re-run in an hour or so and only the missing probes are sent |
| "No analyzed sets yet" | Run `analyzer/analyze.py --all`, then reload |
| Audio won't play in a background tab | Chrome defers media loading in hidden tabs. Bring the tab to the front, then press play |
| Old data after re-analyzing | Hard-reload. The server already sends `no-store`, but an open page keeps its set list until it's reloaded |
| A set's title won't change | A name set by double-clicking in the browser overrides the analyzer's title. Clear it by double-clicking and deleting the text |
| Wrong tempo octave | Re-run with `--bpm-range` (e.g. `160-190` for drum & bass, `118-135` for house) |
| The website behaves like an older version after a deploy | Stale cached JS. Serve HTML/JS/CSS with `Cache-Control: no-cache` (see `web/_headers`), then hard-reload |
| "too long for this browser's memory" | Decoding needs about 64 KB of memory per second of audio, plus working space. Use a desktop browser, close other tabs, or split very long recordings |
| The naming pop-up never says “Connected” | Check the helper window shows *running on http://127.0.0.1:8789*. Use Chrome, Edge or Firefox (Safari may block it). If you started it with `--origin`, the site's address must match exactly |
| Helper: “needs Python 3.9 to 3.13” | Install Python 3.12 from python.org and run the helper again. It finds `python3.12` by itself |
| “The analysis stopped responding” or “The analysis crashed” | A worker died twice on the same part of the recording (one crash is retried automatically), usually from running out of memory on a long set. Close other tabs and try again, or split the recording |
| Safari private browsing | WebKit won't store files in IndexedDB in private sessions, so Set Replay stores the recording as raw bytes instead, transparently. If even that fails, it saves the analysis without the recording and offers *Add the recording* |
| “Analyzed, but this browser won't store it” | The analysis finished but IndexedDB refused it (private browsing, blocked site data, or a full disk). Press **Download the analysis**. The page warns before you leave while that result is unsaved. Drop the file back in later, or in another browser, to reopen it, then use *Add the recording* |
| A set from the website is missing on another computer | Sets live in the browser that analyzed them. Download the analysis (JSON) and drop it onto the landing page elsewhere, then use *Add the recording* |

---

## Project layout

```
dj-set-analyzer/
├── *.m4a, *.mp3 …     # your recordings for the Python pipeline (git-ignored)
├── analyzer/
│   ├── analyze.py     # CLI, stages, checkpoints, summary, JSON export
│   ├── features.py    # decoding, 3-band energy, beats, tempo, key, EffNet, model download
│   ├── identify.py    # Shazam probing (cached, rate-limit aware), cover art
│   ├── music.py       # Camelot, harmonic rules, style tempo priors, style fusion, octave Viterbi
│   └── setlist.py     # set span, novelty, segmentation, per-track metrics, transitions, drops
├── models/            # Essentia ONNX models + metadata (auto-downloaded, git-ignored)
├── output/<slug>/     # features.npz, shazam.json, meta.json (git-ignored)
├── web/               # the website: deploy this folder
│   ├── index.html     # landing: drop zone, queue, library, demos
│   ├── set.html       # the replay
│   ├── css/styles.css, css/landing.css
│   ├── js/app.js      # viewer: state, ribbon, deck, setlist, mix inspector, wheel, playback
│   ├── js/sections/   # one module per analysis section (mixing, mood map, compare, card, chapters,
│   │                  #   section bar, review, track by track, highlights, drop anatomy)
│   ├── js/landing.js  # drop, queue, library, teaser
│   ├── js/store.js    # IndexedDB library
│   ├── js/prefs.js    # set-replay: localStorage key prefix (+ old-key migration)
│   ├── js/mini.js     # small renderers for the landing page (cached animated ribbon)
│   ├── js/color.js    # Camelot → OKLCH color
│   ├── js/naming-ui.js  # the "Want them named?" pop-up
│   ├── js/vibe.js     # the set's vibe → keyword chips + Spotify prompt (no DOM)
│   ├── js/phases.js   # the set's chapters (warm-up, peak, …) and per-chapter slices (no DOM)
│   ├── js/craft.js    # how it was mixed: style archetype, tallies, signature moments (no DOM)
│   ├── js/moodmap.js  # the mood map: brightness × intensity per track, route sentence (no DOM)
│   ├── js/card.js     # the set card: cardData() (no DOM) + drawCard() on a canvas
│   ├── js/compare.js  # compare two sets; merge them for a blend prompt (no DOM)
│   ├── js/drops.js    # drop anatomy: each drop's bass line around the drop (no DOM)
│   ├── js/highlights.js  # the highlights tour and reel: moments from every analysis (no DOM)
│   ├── js/tracklist.js   # tracklist as text, YouTube chapters, 1001Tracklists and a CUE sheet (no DOM)
│   ├── js/similarity.js  # track-by-track similarity matrix and what stands out in it (no DOM)
│   ├── js/review.js      # the written review and its scorecard, from every analysis (no DOM)
│   ├── js/roles.js       # what each track does in the set: Peak, Lift, Breather, Curveball, Key bridge… (no DOM)
│   ├── js/vibe-ui.js  # "Take the vibe to Spotify": radar, chips, prompt, actions
│   ├── js/spotify.js  # OAuth PKCE sign-in, track matching, playlist save
│   ├── js/engine/     # the browser engine (see "The browser engine")
│   ├── helper/set-replay-helper.py  # the optional naming helper visitors run
│   ├── models/        # ONNX models served to browsers (CC BY-NC-SA 4.0)
│   ├── demo/          # bundled demo sets (tools/make_demos.py)
│   ├── _headers       # cache rules for Netlify / Cloudflare Pages
│   ├── favicon.svg    # site icon (key-colored waveform)
│   ├── og-image.png   # the 1200 × 630 link-preview card (tools/make-share-images.mjs)
│   ├── apple-touch-icon.png  # the 180 × 180 icon iOS shows next to a shared link
│   ├── serve.py       # local dev server with ranged audio
│   └── data/          # Python output for the local server (git-ignored)
├── netlify.toml       # one-click Netlify deploy (runs tools/build-site.sh)
├── .github/workflows/selftest.yml  # CI: self-test, syntax, compile, build on every push
├── tools/
│   ├── synth.mjs         # the synthetic test set (128 BPM 8A, then 140 BPM 7A)
│   ├── selftest.mjs      # engine self-test on synthetic audio (known tempo/key/change)
│   ├── selftest_py.py    # the same checks for the Python pipeline
│   ├── e2e.mjs           # whole-site test in headless Chromium (drop → analyze → result)
│   ├── pool-test.mjs     # the worker pool retries a range after a worker crash or stall (stand-in Worker)
│   ├── demux-test.mjs    # the video soundtrack extractor on fixtures/set-replay-e2e.mov
│   ├── fixtures/set-replay-e2e.mov  # the synthetic test set as a 2.4 MB video (H.264 + AAC, QuickTime sound entry)
│   ├── analysis-test.mjs # the page analyses (prompt, chapters, mixing, mood map, card, compare) on the demos and edge cases
│   ├── build-site.sh     # package web/ for hosting → dist/set-replay/ (+ --zip, --head FILE)
│   ├── a11y.mjs          # axe-core accessibility check (WCAG 2.1 A/AA), landing + set page, desktop + phone
│   ├── make-share-images.mjs  # draws og-image.png and apple-touch-icon.png from a demo (Playwright)
│   ├── engine-check.mjs  # run the browser engine under Node, compare with Python
│   ├── make_demos.py     # Python output → web/demo/
│   └── tune_segmentation.py  # score audio-only segmentation vs Shazam-labeled sets
├── requirements.txt
├── run.sh             # starts the server (default port 8778)
└── LICENSE            # AGPL-3.0
```

---

## Credits

- [Essentia](https://essentia.upf.edu) and
  [Essentia.js](https://mtg.github.io/essentia.js/), and the
  [Discogs-EffNet models](https://essentia.upf.edu/models.html) by the Music
  Technology Group, Universitat Pompeu Fabra (Alonso-Jiménez, Serra & Bogdanov,
  ISMIR 2022)
- [ONNX Runtime](https://onnxruntime.ai)
- [shazamio](https://github.com/shazamio/ShazamIO) for track identification
- [ffmpeg](https://ffmpeg.org) for decoding
- [Archivo](https://fonts.google.com/specimen/Archivo) by Omnibus-Type

---

## License

Set Replay is free software under the **GNU Affero General Public License
v3.0** (see `LICENSE`). If you run a modified copy as a public website, the
AGPL asks you to offer its source to visitors: point the "source code" link
in the footer of `web/index.html` at your fork.

The bundled Discogs-EffNet models in `web/models/` are separately licensed
**CC BY-NC-SA 4.0** by the Music Technology Group (`web/models/LICENSE.md`),
so commercial use needs a license from the MTG.
