# Set Replay — DJ Set Analyzer

Set Replay takes a recording of a live DJ set apart, track by track and mix by
mix, and replays it in a locally hosted web app. It answers the questions you'd
ask after a night out:

- What was played, and when?
- How did the DJ get from one track to the next?
- Did the mixes stay in key?
- Where were the drops, and where did the energy peak?

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
2. [Quick start](#quick-start)
3. [Hosting it on your site](#hosting-it-on-your-site)
4. [Command-line options](#command-line-options)
5. [Architecture](#architecture)
6. [The analysis pipeline, step by step](#the-analysis-pipeline-step-by-step)
7. [The browser engine](#the-browser-engine)
8. [The data format](#the-data-format)
9. [The web app](#the-web-app)
10. [Accuracy and limits](#accuracy-and-limits)
11. [Costs and licences](#costs-and-licences)
12. [Troubleshooting](#troubleshooting)
13. [Project layout](#project-layout)
14. [Credits](#credits)

---

## What you get

**The landing page** (`index.html`) has these parts:

- **Drop zone:** a large panel that is itself a waveform of a demo set. Drop
  one or more recordings (or click to choose them) and press **Analyse**.
  Each file shows its progress, and **Stop** cancels the run. When a single
  set finishes, it opens automatically. Dropping a saved `.setreplay.json`
  imports that analysis instead.
- **Your sets:** everything analysed in this browser, with key-coloured
  strips. Hover a card to delete it.
- **Teaser:** a preview built from real demo output: the ribbon, cycling mix
  cards and the Camelot path. Below it are the demo sets, *How it works* and a
  short FAQ.

**The set page** (`set.html`) is the replay. Pick a set from the row at the
top; its colour swatches are the set's track keys in order. Then:

| Part of the page | What it shows | What you can do |
| --- | --- | --- |
| **Header** | The set title, length, track count, BPM, the share of harmonic mixes, and a short generated summary of the set | Double-click the title to rename the set (saved in this browser) |
| **Set ribbon** | The whole set as a 3-band waveform (lows, mids, highs). Each track is tinted by its **key's colour on the Camelot wheel**. Colours cross-fade through every mix; hatching marks mix windows and ▼ marks drops. Recording outside the set (e.g. the phone left running afterwards) is greyed out | Click to play from that moment; hover for track, key, BPM and mix details; zoom with pinch, ⌘/Ctrl-scroll or `+`/`−`; drag to pan; use the overview strip above to jump or drag the window |
| **Now playing** | Cover art, live BPM, key and key name, energy (1 to 10), a 4-step beat pulse, a live spectrum analyser, the top styles, Shazam / Apple Music links, and what comes next | Double-click an **ID** track's title to name it yourself |
| **Setlist** | Every track: start time, art, title and artist, Camelot key, BPM, energy sparkline, and a progress bar while it plays. Between tracks, a transition row gives the mix type, length in bars, harmonic relation, tempo change and swap time | Click a track to play it; click a transition row to open it in the inspector; *Copy tracklist* puts `time  Artist – Title` lines on the clipboard |
| **Mix inspector** | A zoomed waveform of one transition. Markers show where the next track came in, the swap point and where the mix ended. Below are the low-end curve and a beat grid counted in bars from the swap, plus key, tempo and energy changes, the low-end dip, how much sound the tracks share, and a one-sentence description | **Hear this mix** jumps to 6 s before it; **Loop it** repeats it; *Previous / Next* step through the mixes. While playing, the inspector follows the live mix |
| **Harmonic path** | A Camelot wheel. Each track is a dot on its key, and the dots are joined in the order played (solid once played, dotted ahead) | Click a dot to play that track |
| **Energy** | The energy arc of the set, filled per track in its key colour, with drops and the peak marked | Hover for values; click to seek |
| **Sound** | How strongly the style model hears the set's top six Discogs styles over time | Click to seek |
| **Mood** | Danceability, party, aggressive, happy and vocal scores over time | Click to seek |

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Seek 5 s (`Shift`: 30 s) |
| `N` / `P` | Next / previous track |
| `M` | Hear the next mix |
| `+` / `−` | Zoom the ribbon |
| `F` | Follow playback when zoomed |
| `?` | Show the shortcuts |

---

## Quick start

**The website, locally:** any static server works. For example:

```bash
cd dj-set-analyzer
./run.sh            # → http://localhost:8778 (also serves the Python output)
# or: python3 -m http.server 8000 --directory web
```

Open the page, drop a recording in, and press **Analyse**. A 34-minute set
takes about a minute on an Apple M4.

**The Python pipeline** needs macOS or Linux, **Python 3.12**, and **ffmpeg**
on your `PATH` (`brew install ffmpeg python@3.12`).

```bash
cd dj-set-analyzer
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt

# analyse every recording in this folder
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

## Hosting it on your site

`web/` is the entire website: plain files, with no build step, no backend and
no environment variables. Copy the folder anywhere. It works at a domain root
or in a sub-folder (e.g. `yoursite.com/set-replay/`), because every path is
relative.

1. **Copy `web/`** to your host, minus the local-only `web/data/` folder
   (git-ignored), which holds the Python pipeline's output. The parts are:

   | Path | Size |
   | --- | --- |
   | `models/` | ~20 MB (the ONNX models, served to browsers) |
   | `demo/` | ~0.8 MB |
   | Code and pages | ~0.2 MB |

2. **Hosts that work:** any static host: GitHub Pages, Netlify, Cloudflare
   Pages, Vercel, an S3 bucket, or your existing web server. No special
   headers are required. The engine runs single-threaded WebAssembly inside
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
     `web/js/engine/config.js`.
   - The Archivo font loads from Google Fonts.
   - Demo cover art is hotlinked from Shazam's image CDN.

   To serve the libraries yourself, copy them and set
   `window.SET_REPLAY_ASSETS = { essentiaWasm, essentiaCore, ort, ortWasmPath, models }`
   in a script before `js/landing.js` runs.
5. **Demos.** Analyse sets with the Python pipeline, then run:

   ```bash
   venv/bin/python tools/make_demos.py recording-9:worship-part-1 recording-10:worship-part-2
   ```

   That writes `web/demo/`. Demos ship without audio unless you add
   `--audio worship-part-1=https://…/part1.m4a` (a file on your own host or
   CDN). Without audio, a demo is fully explorable but silent.

There's nothing to run or pay for on the server side. Visitors' computers do
the analysis, and their sets live in their browser's IndexedDB.

---

## Command-line options

`venv/bin/python analyzer/analyze.py [files…] [options]`

| Option | What it does |
| --- | --- |
| `--all` | Analyse every audio file in the project folder |
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

The resolved curve is median-filtered, and the beat grid is filled in at the
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

The result is renormalised. This sharpens the styles a great deal on noisy
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
  offline afterwards.

### 7. Where the set is (`setlist.music_span`)

Phones often keep recording after the music stops. RMS is taken per 10 s
window, and a window counts as music if it's within 20 dB of the set's loud
level (its 90th percentile).

- **End:** the first point where the next 2 minutes are at most 20% music
  **and** less than 20% of everything after it is music. A breakdown or a short
  pause mid-set doesn't qualify.
- **Start:** the mirror-image rule.

Track segmentation, energy scaling, drops, Shazam probing and averages all
use this span. The page greys out the rest.

### 8. Novelty: where the music changes (`setlist.novelty`)

EffNet embeddings are averaged into 2 s bins and L2-normalised. A cosine
self-similarity matrix is built from them, and a **Foote checkerboard kernel**
(±24 s with Gaussian taper) slides along its diagonal. The result is a novelty
curve, normalised to its 99.5th percentile, that peaks where the music changes
character, which is usually a track change.

### 9. Segmentation into tracks (`setlist.segment`)

1. **Shazam runs.** Consecutive probes that match the same song form a run:
   one played track.
   - Titles are normalised first, so *Extended Mix*, *Original Mix*,
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

For each pair of neighbouring tracks:

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
| Into breakdown | Low end afterwards is more than 12 dB below before (the mix lands in the new track's stripped-back section) |
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
| `pipeline.js` | Decodes with `OfflineAudioContext` (mono 16 kHz); plans 2-minute ranges; runs a pool of module Web Workers (cores − 1, at most 6); merges; builds the payload. It supports cancelling (`AbortSignal`) and turns out-of-memory decode failures into readable errors |
| `worker.js` | Loads Essentia.js, ONNX Runtime Web and the models once per worker, then extracts features for ranges |
| `extract.js` | The per-range features. Each lives on a fixed global grid (band frames, tempo windows, key windows, 54 s beat chunks, EffNet patches), and a worker only computes grid items that start inside its range, so the parallel ranges join exactly. The beat tracker assumes 44.1 kHz, so its 60 s chunks are upsampled on the fly |
| `mel.js` | A pure-JS twin of Essentia's `TensorflowInputMusiCNN` (Hann → FFT → 96 Slaney mel bands, unit-area triangles, on the power spectrum → `log10(1 + 10000·x)`). It matches Essentia.js to a max error of 6e-5 and is about 30× faster than one WASM call per frame |
| `music.js`, `setlist.js`, `payload.js` | Line-for-line ports of `music.py`, `setlist.py` and `analyze.build_payload` |
| `dsp.js` | FFT, percentiles, smoothing, median filter and interpolation |
| `config.js` | Asset URLs (jsDelivr libraries, self-hosted models) |

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
logic in seconds. Results on Recording 9 with identification off: the browser
engine and Python both give 18 tracks with identical start times.

**Speed** (Chrome, Apple M4, 6 workers): a 34-minute set takes about 55 s from
drop to result, of which decoding is about 9 s. Long sets scale linearly.

---

## The data format

`web/data/sets.json`: one entry per analysed set, naturally sorted (9 before 10):

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
| `curves.wave` | `low`, `mid`, `high` as 0–99 integers at `wave_fps` (8): per-band normalised over the set, with a 1.4 contrast curve |
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
| `index.html` | The landing page. Analyses dropped files in place and saves them to IndexedDB (`js/store.js`: one record per set, holding the payload and the original `File` as a Blob) |
| `set.html?id=<id>` | A set from this browser's library, played from its stored Blob |
| `set.html?demo=<slug>` | A bundled demo from `demo/<slug>.json`. Without audio it runs on a virtual clock, so clicking still moves the playhead |
| `set.html#<slug>` | The local Python server's output (`data/sets.json` + `/audio/<file>`) |

Local sets offer three extra actions: **Download the analysis (JSON)**,
which includes your track names; **Add the recording**, for imported
analyses; and **Delete from this browser**.

### Local server (`web/serve.py`)

A threaded `http.server` on `127.0.0.1` only, for development and the Python
pipeline:

- serves `web/` with `Cache-Control: no-store`, so re-analysed data shows up on
  reload
- serves `/audio/<file>` from the project folder, with **HTTP Range** support,
  so the browser can seek instantly in long recordings (including `.m4a` files
  whose index is at the end of the file)
- accepts only plain names of audio files in the project root; there's no path
  traversal

### Viewer (`web/js/app.js`, about 1,300 lines of vanilla JS, an ES module)

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
  - Track colours are precomputed per track. `colorAt(t)` interpolates between
    two tracks' colours inside a mix window, which produces the cross-fades.
- **Camelot wheel:** inline SVG with 24 ring segments (major keys outer, minor
  inner, 12 at the top). Track dots fan out within their key's segment.
  Connections between keys far apart on the wheel bend towards the centre, so
  the path reads as a journey.
- **Playback sync:** a `requestAnimationFrame` loop updates the playheads,
  current track, live mix selection, loop-a-mix, follow-scroll, beat pulse
  (from the beat grid), live BPM (from the tempo curve) and the spectrum.
  - The spectrum uses a Web Audio `AnalyserNode` that is created on the first
    play, since browsers require a user gesture.
  - When paused, views update on `seeked` / `timeupdate` instead.
- **Your edits:** renamed IDs and set titles are saved in `localStorage`
  under `djsa:<slug>`. They never touch the analysis files.

### Design system

- **Colour carries data.** The only accent colours come from the music.
  `color.js` maps Camelot number *n* to hue `18° + (n−1)·30°` on a perceptual
  **OKLCH** wheel:
  - minor (A) keys are deeper, major (B) keys lighter
  - each key has four tones: deep, base, pale and ink, used for the low, mid
    and high waveform layers and for text
  - harmonic neighbours therefore get neighbouring hues, and a key clash looks
    like a jump in colour
- **Base palette:** a booth-dark violet graphite (`#16151E` page, `#201E2B`
  panels), paper-white ink (`#EFECF5`), and muted greys for secondary text.
- **Type:** a single family, **Archivo**, whose *width* axis does the
  expressive work:
  - 125% expanded, black weight, for the set title (rave-flyer energy)
  - 112% for section headings
  - 62–80% condensed with tabular figures for BPM, times and data, like a CDJ
    readout
- **Responsive:**
  - below 1080 px the now-playing panel stacks above the setlist
  - below 720 px the gutter shrinks to 16 px and secondary columns hide
  - reduced-motion settings are respected
  - focus outlines are visible on every control

---

## Accuracy and limits

- **Room recordings are hard.** These sets are phone captures with crowd noise
  and reverb, and Shazam matched about a third of the probes. A track heard
  only once is flagged *possible match*. The match is real, but the track may
  only have played briefly, or it may be a near-miss.
- **Styles are relative.** On room audio the style model leans towards
  *Hardcore / Ambient / Experimental*, even after tempo re-weighting. Read
  styles as "this track sounds harder than the last", not as definitive genre
  tags. Shazam's own genre (often just "Dance" or "Electronic") is kept in
  `meta.genre`.
- **Timing precision varies.** Swap points (±a few seconds) and BPM are the
  most reliable numbers. Mix-in and mix-out are estimates, and transition
  types are heuristics built from the low end and loudness.
- **Keys** use the EDM profile and a vote over windows. The share of the vote
  appears when you hover a key chip; low shares mean the key is uncertain.
- **Phrase position is unknown.** Bars are counted from the swap because
  downbeat (bar-start) detection on room recordings isn't reliable enough to
  show bar 1.

---

## Costs and licences

- **Hosting:** free on any static host. There's no server compute: visitors'
  browsers do the analysis.
- **Bandwidth:** each visitor downloads about 20 MB of models (cached for a
  year) and about 16 MB of engine WebAssembly from jsDelivr (free CDN).
- **Licences:**
  - The Python and JS code here is yours.
  - **Essentia.js is AGPL-3.0**, so publishing the site means keeping its
    source available (this repo).
  - **The Discogs-EffNet models are CC BY-NC-SA 4.0**: attribution,
    non-commercial use only, and share-alike. For a commercial site, get a
    licence from the MTG (`web/models/LICENSE.md`).
  - ONNX Runtime Web is MIT.
- **Track names:** song names need a fingerprint database, and none runs
  inside a browser. Shazam has no CORS-enabled or official public API, so
  the hosted site leaves tracks as nameable **ID**s. The Python pipeline
  still names them, and its output can be shown as demos. A hosted option
  would need a small proxy (for example, a free-tier Cloudflare Worker) in
  front of an identification service whose terms allow it. Weigh the terms
  and the cost before adding one.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `shazam not responding (likely rate-limited)` | Shazam throttles bursts. The run continues with what's cached; re-run in an hour or so and only the missing probes are sent |
| "No analysed sets yet" | Run `analyzer/analyze.py --all`, then reload |
| Audio won't play in a background tab | Chrome defers media loading in hidden tabs. Bring the tab to the front, then press play |
| Old data after re-analysing | Hard-reload. The server already sends `no-store`, but an open page keeps its set list until it's reloaded |
| A set's title won't change | A name set by double-clicking in the browser overrides the analyzer's title. Clear it by double-clicking and deleting the text |
| Wrong tempo octave | Re-run with `--bpm-range` (e.g. `160-190` for drum & bass, `118-135` for house) |
| The website behaves like an older version after a deploy | Stale cached JS. Serve HTML/JS/CSS with `Cache-Control: no-cache` (see `web/_headers`), then hard-reload |
| "too long for this browser's memory" | Decoding needs about 64 KB of memory per second of audio, plus working space. Use a desktop browser, close other tabs, or split very long recordings |
| A set from the website is missing on another computer | Sets live in the browser that analysed them. Download the analysis (JSON) and drop it onto the landing page elsewhere, then use *Add the recording* |

---

## Project layout

```
dj-set-analyzer/
├── Recording 9.m4a, Recording 10.m4a   # the sets (git-ignored)
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
│   ├── js/app.js      # viewer
│   ├── js/landing.js  # drop, queue, library, teaser
│   ├── js/store.js    # IndexedDB library
│   ├── js/mini.js     # small renderers for the landing page
│   ├── js/color.js    # Camelot → OKLCH colour
│   ├── js/engine/     # the browser engine (see "The browser engine")
│   ├── models/        # ONNX models served to browsers (CC BY-NC-SA 4.0)
│   ├── demo/          # bundled demo sets (tools/make_demos.py)
│   ├── _headers       # cache rules for Netlify / Cloudflare Pages
│   ├── serve.py       # local dev server with ranged audio
│   └── data/          # Python output for the local server (git-ignored)
├── tools/
│   ├── engine-check.mjs  # run the browser engine under Node, compare with Python
│   └── make_demos.py     # Python output → web/demo/
├── requirements.txt
└── run.sh             # starts the server (default port 8778)
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
