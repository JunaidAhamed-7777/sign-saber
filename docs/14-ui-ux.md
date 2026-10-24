# 14 — UI / UX

The UI is a React 19 DOM overlay drawn above the Three.js canvas ([ADR-002](03-decisions.md#adr-002--threejs-imperative-for-rendering-react-only-for-dom-ui)). It never touches the scene graph; it reads a Zustand store that a thin adapter fills from game events ([ADR-011](03-decisions.md#adr-011--zustand-for-ui-state-typed-event-bus-for-game-events)). Every screen below maps one-to-one to a state in [04 — State Machine](04-state-machine.md).

Pillar reminder: **P1 Readable at a glance** governs every decision here. If a judge standing 2.5 m from the laptop cannot read it, it is wrong.

This document specifies planned behaviour; the current React screens are stubs. Build the P1 full-song path first, complete the P2 recovery paths, and add P3 presentation only after both work ([roadmap](../ROADMAP.md)). Wireframes show illustrative content and do not assert that any demo track or score already exists.

## Design language

| Principle | Rule |
| --- | --- |
| **Dark void** | The DOM background is always transparent; the 3D void (`--void`) is the only background. Panels are translucent glass so the silhouette and grid stay visible behind menus. |
| **Neon accents, sparingly** | One accent colour per element. Accents are reserved for interactive or live data (score, combo, Start). Decorative chrome is `--muted`. |
| **Quiet panels** | Use a dark, nearly opaque panel and a subtle structural border. One short accent rule identifies the selected track or primary action. Blur is optional in menus only and disabled on low tier; no glowing border around every panel. The player and destruction supply the spectacle. |
| **Distinct display type** | Use Orbitron for the title, rank and selected display numbers; Rajdhani for controls, metadata and coaching. Reserve uppercase/letter spacing for short labels so instructions remain readable at a distance. |
| **Beat-aware, restrained** | The combo ring or song progress may respond to `--beat` (§Motion). Score, accuracy and safety/coaching text stay spatially stable. Avoid pulsing the whole interface. |
| **No raw webcam pixels, ever** | The DOM never renders the `<video>` element visibly. The silhouette is the only representation of the player (P1, [01](01-vision.md)). |

## Typography

Fonts are bundled as woff2 in `app/public/assets/fonts/`, with their licence/attribution files ([ADR-013](03-decisions.md#adr-013--everything-the-demo-needs-is-bundled-and-works-offline)). Preload the small required subset and use `font-display: swap` with metric-compatible fallbacks: a missing font must never hide Retry, camera permission guidance or Start. Reserve label/number widths to prevent layout jumps. Offline checks include failed-font behaviour, not only the happy path.

| Role | Family | Weight | Size (clamp) | Use |
| --- | --- | --- | --- | --- |
| Display XL | Orbitron | 900 | `clamp(72px, 12vw, 180px)` | Rank letter, countdown numerals |
| Display L | Orbitron | 700 | `clamp(40px, 5vw, 72px)` | Score, combo count, screen titles |
| Display M | Orbitron | 600 | `clamp(28px, 2.6vw, 40px)` | HUD numbers (accuracy, multiplier), buttons |
| Label | Orbitron | 500 | `clamp(13px, 1.1vw, 16px)` | Uppercase labels above numbers |
| Body L | Rajdhani | 600 | `clamp(20px, 1.8vw, 26px)` | Coaching copy, pause reason |
| Body | Rajdhani | 500 | `clamp(16px, 1.3vw, 20px)` | Descriptions, tooltips, library metadata |

Rules: HUD numbers MUST be ≥ 28 px at 1920×1080 (Display M minimum). Numbers use `font-variant-numeric: tabular-nums` so tweening digits do not jitter horizontally.

## Colour tokens

Declared once on `:root` in `ui/theme.css`. Components use tokens only; no literal hex in component files.

```css
:root {
  --void:    #05060D;
  --panel:   rgba(11, 15, 26, 0.72);
  --cyan:    #19F5FF;
  --magenta: #FF2BD6;
  --gold:    #FFC32B;
  --danger:  #FF1E3C;
  --text:    #E8F1FF;
  --muted:   #8A97B8;
  --beat:    0;            /* 0..1, set from JS every frame; see Motion */
}
```

### Semantic mapping

| Meaning | Token | Where |
| --- | --- | --- |
| Slash block / open-palm gesture | `--cyan` | Block glyph, gesture indicator, library "slash" count |
| Smash block / fist gesture | `--magenta` | Block glyph, gesture indicator |
| Beam block / point gesture | `--gold` | Block glyph, gesture indicator, charge arc |
| Obstacle / warning | `--danger` | Wall tint (3D), pause reason when tracking lost, error cards |
| Perfect | `--gold` | Judgement pop, results bar |
| Great | `--cyan` | Judgement pop, results bar |
| Good | `--text` (white) | Judgement pop, results bar |
| Miss | `--muted` | Judgement pop (small), results bar |
| Bad Cut | `--danger` | Judgement pop with glitch, results bar |
| Dodged | `--cyan` at 70 % | Small pop "DODGED +50" |
| Primary action (Start, Resume, Retry) | `--cyan` fill, `--void` text | Buttons |
| Secondary action (Back, Quit, Songs) | transparent fill, `--text` text, 1 px `--muted` border | Buttons |
| Disabled | `--muted` at 40 % | Start before a beatmap is validated |

Colour is never the only cue (§Accessibility): each block type also has a distinct glyph, each judgement also has distinct text and motion.

## Motion

| Principle | Rule |
| --- | --- |
| Stagger | Sibling elements enter 120 ms apart. |
| Easing | Enter: `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint). Exit: `cubic-bezier(0.64, 0, 0.78, 0)` over 160 ms. |
| Score counters | Displayed value tweens toward the store value with exponential damping (`display += (target − display) · (1 − e^(−dt/90 ms))`), rounding at the end; never jumps. |
| Beat variable | `--beat` is written every frame from the beat grid (`beatOffsetMs + k · 60000 / bpm`, [09](09-beatmap-format.md)): `--beat = 1 − fract((songTime − beatOffsetMs) / beatPeriod)` eased with `pow(x, 3)` so it snaps to 1 on the beat and decays. HUD elements use `transform: scale(calc(1 + var(--beat) * 0.03))` and glow `opacity: calc(0.5 + var(--beat) * 0.5)`. |
| Judgement pops | Appear at the projected hit position, rise 60 px over 600 ms while fading; Perfect adds a 1.15× overshoot; Bad Cut adds a 2-frame horizontal glitch (`clip-path` slices). |
| Combo milestones | At combo 10 / 25 / 50 / 100 the combo ring emits a radial flash (`box-shadow` 0 → 80 px) and the number does a 1.3× punch over 240 ms. |
| Reduced motion | `prefers-reduced-motion: reduce` initially selects Calm intensity. It disables stagger, beat scaling, milestone flashes, camera kinetics, glitch and transient scene flashes. The renderer implements the same preference ([13 §5.4](13-rendering-environment-camera-postfx.md#54-motion-preference)). |

## Screens

### Screen → state mapping

| Machine state | Screen component | Overlay type |
| --- | --- | --- |
| `BOOT` | `BootScreen` | Full-screen, opaque void until the renderer is ready |
| `SELECT` | `SelectScreen` | Panels over the attract scene |
| `CALIBRATION` | `CalibrationScreen` | Left panel + centre overlays over the silhouette |
| `PLAYING` | `Hud` | Edge-anchored, no panels in the play area |
| `PAUSED` | `PausedScreen` | Centre panel over the dimmed frozen frame |
| `RESULTS` | `ResultsScreen` | Two-column panel over the results scene |

`App.tsx` switches on `useStore(s => s.machineState)` and renders exactly one screen component; the `Hud` additionally renders `DebugOverlay` in development builds when enabled.

### BOOT

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│                      ╔══ SIGN SABER ══╗                      │
│                        (logo, Display L, cyan glow)          │
│                                                              │
│          ████████████████████░░░░░░░░░░░░░░░░  58 %          │
│          LOADING POSE MODEL                                  │
│                                                              │
│                                                              │
│   ┌──── on error ───────────────────────────────────────┐    │
│   │  ⚠  CAMERA ACCESS DENIED                             │    │
│   │  Allow camera access in the address bar, then Retry. │    │
│   │                                     [ RETRY ]        │    │
│   └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

- Progress is the aggregated weighted value from [04 §BOOT](04-state-machine.md#boot). The stage label shows the asset currently loading (`strings.boot.stage.*`).
- The logo pulses at 72 BPM (no song yet) using `--beat` driven by a fixed period.
- Error cards use `--danger` border glow and the exact copy in §Strings. The Retry button re-runs only the failed stage.
- Before requesting camera access, explain “Camera images stay on this device; only a silhouette appears in the game.” Permission denial, a camera already in use, an unsupported renderer, and missing assets need distinct actionable states from [04](04-state-machine.md). Never keep a fabricated loading percentage moving after failure. Stage progress is determinate only when the loader knows its denominator; inference/model initialisation uses a named indeterminate stage.

### SELECT

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  SIGN SABER                                            ● TRACKING OK  ⌁ 30 Hz │
│                                                                              │
│  ┌─ LIBRARY ──────────────────────────┐  ┌─ YOUR TRACK ─────────────────────┐ │
│  │ ┌────────┐ ┌────────┐ ┌────────┐   │  │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │ │
│  │ │ cover  │ │ cover  │ │ cover  │   │  │    DROP AN AUDIO FILE HERE       │ │
│  │ │ NEON   │ │ PULSE  │ │ ...    │   │  │    MP3 · WAV · OGG · M4A         │ │
│  │ │ DRIFT  │ │ GRID   │ │        │   │  │  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │ │
│  │ │128 BPM │ │140 BPM │ │        │   │  │                                  │ │
│  │ │ 3:02   │ │ 2:48   │ │        │   │  │  YOUTUBE URL                     │ │
│  │ └────────┘ └────────┘ └────────┘   │  │  [ https://…                 ] ↵ │ │
│  │                                    │  │  ⓘ Companion service offline —   │ │
│  │                                    │  │    upload a file instead.        │ │
│  └────────────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                              │
│  SELECTED  Neon Drift · CC0 Demo · 128.0 BPM · 412 notes                     │
│  DIFFICULTY  [ EASY ] [ NORMAL ] [ HARD ]                                    │
│                                                                              │
│                           ┏━━━━━━━━━━━━━━━━━━━━┓                             │
│                           ┃       START        ┃                             │
│                           ┗━━━━━━━━━━━━━━━━━━━━┛                             │
│        (live attract scene: grid + the player's silhouette behind panels)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Tracking pill** (top-right): `● TRACKING OK` in `--cyan` when `BodyState.present` or any `HandCursor.present` in the last 1 s; `○ STEP INTO FRAME` in `--muted` otherwise; shows the tracking rate from `TrackingFrame` arrival rate.
- **Library cards**: cover, title, artist, BPM, duration, available difficulties. Keyboard: arrow keys move focus, Enter selects.
- **Upload zone**: drag & drop or click. During generation the zone becomes a progress bar with the label `strings.select.generating` and a percentage from the beatmap worker. On completion it shows BPM and note count; on tempo-fallback it shows the badge `strings.select.tempoFallback` in `--gold`.
- **YouTube field**: enabled only when the companion service health check succeeded in the last 10 s ([23](23-youtube-companion-service.md)); otherwise disabled with the offline copy. Enter submits; a spinner replaces the ↵ while resolving.
- **Difficulty**: segmented control, default Normal, persisted in `localStorage`.
- **Start**: disabled (`--muted` 40 %) until `validateBeatmap` returns no errors; shows `strings.select.startDisabled` as a tooltip. Enter/Space on focus or click fires `select:start`.
- Upload accepts only supported, decodable local audio within [08](08-beatmap-generation.md)'s limits; an extension alone is not validation. Show file name, elapsed work and the active stage. Percentages must come from completed work units; decode and unknown-duration stages use indeterminate progress. Cancel returns to Select and invalidates the job token so a late worker result cannot overwrite a newer selection. Preserve the previous valid selection after an invalid upload, clearly identifying which track Start would launch.
- If no bundled tracks exist, omit the library cards and show the honest asset/setup failure rather than invented tracks. Wireframe titles such as Neon Drift are examples only. An empty/quiet upload explains why no playable notes were found. A tempo-fallback badge is paired with its limitation rather than a precise BPM presented as detected truth.
- Place a persistent, readable explanation beside disabled Start; disabled native controls cannot be relied on to expose a hover/focus tooltip. Show Standard/Calm intensity, volume and camera status before starting. Readiness remains the state machine's decision; the UI cannot bypass calibration.

### CALIBRATION

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ‹ BACK                                                       CALIBRATION    │
│                                                                              │
│  ┌─ GET IN POSITION ───────────────────────┐                                 │
│  │                                         │                                 │
│  │  ✔  Shoulders and both hands visible    │        (silhouette, live,       │
│  │                                         │         centred, with a         │
│  │  ◌  Wave to confirm                     │         dashed target frame)    │
│  │     ▁▃▅▇▅▃▁ ▁▃▅▇  ▮▮▯  2 / 3            │                                 │
│  │                                         │                                 │
│  │  ○  Get ready                           │                                 │
│  │                                         │                                 │
│  └─────────────────────────────────────────┘                                 │
│                                                                              │
│                    Too close — step back a little.                           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                   ┌───┐
                 countdown overlay │ 3 │  (Display XL, on each beat)
                                   └───┘
```

- The three steps are exactly the three conditions in [04 §CALIBRATION](04-state-machine.md#calibration). A step's tick turns `--cyan` only after its condition has held for `CALIB_PRESENCE_MS`; a regressed condition turns it back to `◌` with a 160 ms fade.
- **Wave meter**: a 24-sample sparkline of the active hand's mirrored-image x plus a reversal counter `n / WAVE_REVERSALS`. Fills as reversals accumulate within `WAVE_WINDOW_MS`.
- **Coaching line** (Body L, centre-bottom) shows exactly one string at a time, priority order: no body → one hand missing → too close → too far → unstable tracking → steady. Strings in §Strings. Low model/mask confidence indicates uncertain tracking, not a measured light level; suggest facing the light or clearing the background without asserting darkness. Use the existing presence/confidence rules from [05](05-tracking-pipeline.md), not an invented luminance sensor.
- **Dashed target frame**: a rectangle on the silhouette layer spanning the `CALIB_SHOULDER_MIN`…`CALIB_SHOULDER_MAX` sweet spot, so the player sees where to stand.
- **Countdown**: Follow [15 §Start](15-audio-playback-sync.md#21-start): confident tempo gets beat-aligned digits/clicks; `lowTempoConfidence` gets a neutral countdown without a musical metronome. Drive digits from the output-aligned negative `SongClock`, including any ready stage needed to give early notes their full approach. Calm removes the 1.4 → 1.0 scale accent. Retry (`calibrationCached = true`) skips confirmation only when the same calibration remains valid; readiness checks and the full countdown still apply.
- `‹ BACK` fires `calib:back`.
- Show “Clear space around you. Use comfortable movements; stop if uncomfortable.” before the countdown. A wave is a convenient confirmation, not the only control: provide an accessible keyboard/button confirmation that still requires the same live presence and stable calibration. Explain any supported seated/reduced-reach profile before it changes the playable lane range; do not silently change difficulty or scoring mid-song.

### PLAYING (HUD)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SCORE                     ╭───────╮                              ACCURACY    │
│ 128 450                   │  ×4   │  COMBO 37                     94.2 %     │
│                           ╰───────╯                                           │
│                                                                              │
│  ┌──────┐                                                        ┌──────┐    │
│  │  ✋  │ ← left gesture                               right → │  ☝︎  │    │
│  │ OPEN │    indicator                                 indicator │ ◔ 62%│    │
│  └──────┘                                                        └──────┘    │
│                                                                              │
│                              PERFECT  ← judgement pop at hit position        │
│                                                                              │
│                                                                              │
│ ● 30 Hz                                                                       │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━▼━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ 1:12                                            ▲ drop                 3:02  │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Element | Position | Source | Behaviour |
| --- | --- | --- | --- |
| Score | top-left | `score` | Display L, tabular, tweened. Label "SCORE" above. |
| Multiplier ring + combo | top-centre | `combo`, `multiplier` | Ring is an SVG arc showing progress to the next `MULTIPLIER_LADDER` threshold; the number inside is `×N`. Combo count beside it in Display M. On `combo:change` with `broke: true` the ring flashes `--danger` and the combo count drops with a 200 ms shake. |
| Accuracy | top-right | `accuracy` | Display M, one decimal, label above. |
| Gesture indicators | left and right edges, vertically centred | `handLeft`, `handRight` | Glyph for the current `Gesture` (✋ open, ✊ fist, ☝ point, ─ none) tinted with the type colour; label below. When `charge > 0` a `--gold` arc fills around the glyph with the percentage. Indicator dims to 30 % when `present` is false. |
| Judgement pop | at projected hit position | `note:hit`, `note:miss`, `note:badcut`, `obstacle:dodged` | Text + colour per §Semantic mapping; timing error shown as a small `−32 ms` / `+18 ms` under Great/Good. Max 6 live pops; oldest is dropped. |
| Combo milestones | centre, over the ring | `combo` crossing 10/25/50/100 | Flash + strings `hud.milestone.*`. |
| Tracking indicator | bottom-left | tracking rate, `present` | `● 30 Hz` in `--cyan`; turns `--gold` below 20 Hz and `--danger` when no hands for 500 ms (precursor to auto-pause). |
| Song progress | bottom, full width | `songTimeMs`, `durationMs`, `events` | Bar with elapsed/total; `▲` markers at every `drop` event so the player sees it coming; a `●` playhead. |
| Debug overlay (dev only, key `D`) | right column, monospace | loop + tracking stats | Frame interval p50/p95/p99, tracking Hz, inference and capture-to-render age, live notes, pool high-water/overflow, quality tier and drawing-buffer size. Label capture-to-render age as an estimate; actual motion-to-photon needs the external measurement in [16](16-performance-budget.md). Display input mode LIVE/REPLAY prominently in diagnostics and evidence. Includes read-only landmark/hit-volume toggles. |

The play area (the projected `PLAY_W × PLAY_H` rectangle) MUST stay free of HUD panels. Indicators sit outside it; the judgement pops are the only text inside.

#### Projecting hit positions to screen

The renderer owns a projection helper that writes numeric screen coordinates into caller-owned scratch storage. Convert event `Vec3` data into its retained Three.js vector internally; `impactPos` is plain data and has no `.clone()` method. Project through the same camera matrix used for the displayed frame, convert NDC to CSS pixels, and include the canvas rectangle's page offset. Misses use the note position supplied by the read-only scene adapter. UI positions pops using `transform: translate3d(x, y, 0)`; it neither mutates the camera nor creates a separate world mapping. Reproject or retire active pops coherently on resize.

### PAUSED

```
┌──────────────────────────────────────────────────────────────┐
│                      (frozen frame, dimmed 60 %)             │
│              ┌───────────────────────────────┐               │
│              │           PAUSED              │               │
│              │  Tracking lost — step back    │               │
│              │  into frame.                  │               │
│              │                               │               │
│              │   resuming in  3               │               │
│              │                               │               │
│              │   [ RESUME ]     [ QUIT ]      │               │
│              └───────────────────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

- Reason text per `pauseReason` in the store: `tracking` → `strings.paused.trackingLost`; `manual` → `strings.paused.manual`; `hidden` → `strings.paused.hidden`; `audio`/`fatal` → the actionable audio or subsystem recovery message from [04](04-state-machine.md).
- When the reason is `tracking` and `BodyState.present` returns, the countdown line appears (`RESUME_COUNTDOWN_MS`) and the buttons stay available.
- Buttons MUST be reachable by mouse and keyboard (Tab/Enter, `Space` resumes, `Esc` resumes, `Q` quits) because the player may be out of frame.
- Resume requests still pass [04](04-state-machine.md)'s readiness checks; a button must not resume into missing required hands or a suspended audio context. Only a tracking-loss pause may auto-resume. A hidden-tab/manual pause waits for the player's action, and failed audio resume leaves a clear “Enable audio to continue” action. Quit, Standard/Calm intensity and volume stay available. Fatal errors show recovery guidance rather than a countdown.

### RESULTS

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  RESULTS · NEON DRIFT · NORMAL                                               │
│                                                                              │
│  ┌──────────────────────────────┐   ┌──────────────────────────────────────┐ │
│  │                              │   │                                      │ │
│  │             S                │   │        (highlight viewport:          │ │
│  │        (Display XL)          │   │        2.5D silhouette + skeleton    │ │
│  │                              │   │         at peak combo, turntable)    │ │
│  │  SCORE        312 940        │   │                                      │ │
│  │  ACCURACY      91.4 %        │   │                                      │ │
│  │  MAX COMBO        86         │   │          PEAK COMBO · 1:48           │ │
│  │                              │   └──────────────────────────────────────┘ │
│  │  PERFECT  ████████████  212  │                                            │
│  │  GREAT    ███████       118  │   KINETIC ENERGY                            │
│  │  GOOD     ███            41  │   3.2 kJ  ·  ≈ 3.1 kcal  ⓘ                 │
│  │  MISS     ██             19  │                                            │
│  │  BAD CUT  █               6  │                                            │
│  │                              │                                            │
│  └──────────────────────────────┘        [ RETRY ]        [ SONGS ]          │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Rank letter** enters first: scale 2.5 → 1.0 with ease-out-quint over 500 ms, colour by rank (SS/S `--gold`, A `--cyan`, B/C `--text`, D `--muted`), with the `combo` SFX on SS/S.
- Then stats rows, then judgement bars, then kinetic energy, then buttons — 120 ms stagger each. Bars animate width from 0 over 400 ms; widths are proportional to the largest count.
- **Highlight viewport**: the UI reserves a rectangle in the existing canvas; `highlight.ts` composites an owned snapshot there ([13 §8](13-rendering-environment-camera-postfx.md#8-highlight-capture-renderhighlightts)). It is a stylised 2.5D memory, not reconstructed volumetric video. Caption the actual captured time, and omit the region if no valid snapshot exists. Do not require GPU readback into a second DOM canvas.
- **Kinetic energy tooltip** (`ⓘ`, hover/focus): `strings.results.kineticTooltip`.
- Mark the motion estimate “for fun” next to the value, not only in a tooltip. Webcam landmark speed and assumed effective mass are insufficient to measure metabolic calories; kJ/kcal are explicitly a modelled estimate and excluded from judging evidence about fitness. The wireframe's energy values are illustrative and must be replaced by real session output, never hard-coded. Count all note outcomes once so the judgement bars sum to the chart total.
- `Retry` → `results:retry`; `Songs` → `results:songs`. Enter = Retry, Esc = Songs.

## Input handling

Menus are operated with mouse and keyboard. Hands-free menu navigation is `[STRETCH]`: a palm cursor (the `HandCursor.pos` projected to screen) hovers DOM buttons and activates after a 900 ms dwell with a filling ring.

### Keyboard shortcuts

| Key | State | Action |
| --- | --- | --- |
| `Enter` / `Space` | `SELECT` | Start (if enabled) |
| `← → ↑ ↓` | `SELECT` | Move library focus |
| `1` / `2` / `3` | `SELECT` | Difficulty Easy / Normal / Hard |
| `Esc` | `CALIBRATION` | Back |
| `Esc` / `Space` | `PLAYING` | Pause (`pause:request`) |
| `Esc` / `Space` / `Enter` | `PAUSED` | Resume (`pause:resume`) |
| `Q` | `PAUSED` | Quit to Select (`pause:quit`) |
| `Enter` | `RESULTS` | Retry |
| `Esc` | `RESULTS` | Songs |
| `D` | any, dev build only | Toggle debug overlay |
| `T` | any, dev build only | Cycle quality tier ([16](16-performance-budget.md#quality-tiers)) |
| `F11` | any | Browser fullscreen (documented for the demo, [20](20-demo-and-judging.md)) |

Focus management: on an explicit screen transition move focus to its heading or primary available action; preserve focus while progress, tracking or scores update. A visible focus ring (`outline: 2px solid var(--cyan); outline-offset: 3px`) is mandatory. Bind global shortcuts only when the event target is not an input, textarea, select or contenteditable control; Enter in the YouTube field submits that field, never Start as well. Prevent double activation from both key handlers and a native button click. Quit/Retry must tear down the previous session before a second one can start.

## Accessibility

- **Colour is never the only cue.** Block types carry glyphs (3D) and the gesture indicators carry glyph + label; judgements carry text + colour + motion; rank carries a letter.
- **Contrast.** Target ≥ 4.5:1 for normal text, ≥ 3:1 for large text and essential non-text controls; aim for 7:1 on instructions. Measure composited panels over the brightest allowed scene frame, not only against the empty void. Use an opaque backing where transparency fails. No contrast measurement has been recorded yet.
- **Legible from 2.5 m.** HUD numbers ≥ 28 px at 1080p; coaching text ≥ 20 px; nothing the player must act on is below Body L during `CALIBRATION` or `PLAYING`.
- **Reduced motion** selects Calm across DOM and rendering; players may change the preference before Start or while Paused. The controls and required gesture cues remain readable.
- **Keyboard operability** for every button; `aria-live="polite"` on the coaching line and the pause reason so screen readers announce changes.
- **Flashing review** covers the combined scene and DOM, including destruction, beam-ready cues and drop transitions. Avoid deliberate strobing; verify the applicable flash thresholds under [WCAG 2.2 flashing guidance](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html). Calm removes transient flashes. A tiny pulse and a full-screen high-contrast flash have different risks; a DOM-only frequency rule is insufficient.
- **Assistive technology.** Menu headings have a coherent hierarchy; native buttons/inputs have labels and validation descriptions. Mark generation busy, announce completed/error stages once, and keep per-hit score pops out of live regions. Tooltips open on focus as well as hover. Tab order follows the screen's reading order.
- **Viewport resilience.** Test the supported laptop viewport, 720p, 1080p, 16:10 and 200 % browser zoom. Keep menu content scrollable and controls reachable; reserve the play rectangle using the actual projected bounds. Do not claim mobile support from a narrow-window layout check.

## Strings

All user-facing copy lives in `ui/strings.ts` as a single frozen object. Components never contain literal UI text. Exact strings:

| Key | String |
| --- | --- |
| `app.title` | `SIGN SABER` |
| `boot.stage.wasm` | `LOADING ENGINE` |
| `boot.stage.hands` | `LOADING HAND MODEL` |
| `boot.stage.pose` | `LOADING POSE MODEL` |
| `boot.stage.assets` | `LOADING ASSETS` |
| `boot.stage.camera` | `WAKING THE CAMERA` |
| `boot.error.cameraDenied.title` | `CAMERA ACCESS DENIED` |
| `boot.error.cameraDenied.body` | `Allow camera access in the address bar, then Retry.` |
| `boot.error.noWebgl.title` | `WEBGL2 NOT AVAILABLE` |
| `boot.error.noWebgl.body` | `Open in Chrome or Edge with hardware acceleration on.` |
| `boot.error.models.title` | `MODELS NOT FOUND` |
| `boot.error.models.body` | `Tracking models could not load. Check your connection, then Retry.` |
| `boot.error.retry` | `RETRY` |
| `select.library` | `LIBRARY` |
| `select.yourTrack` | `YOUR TRACK` |
| `select.dropHere` | `DROP AN AUDIO FILE HERE` |
| `select.formats` | `MP3 · WAV · OGG · M4A` |
| `select.youtubeLabel` | `YOUTUBE URL` |
| `select.youtubePlaceholder` | `https://youtube.com/watch?v=…` |
| `select.youtubeOffline` | `Companion service offline — upload a file instead.` |
| `select.youtubeResolving` | `Fetching audio…` |
| `select.generating` | `Listening… {percent} %` |
| `select.generated` | `{bpm} BPM · {notes} notes` |
| `select.tempoFallback` | `Tempo unclear — mapped to onsets` |
| `select.decodeError` | `Could not decode this file. Try MP3, WAV, OGG or M4A.` |
| `select.difficulty` | `DIFFICULTY` |
| `select.difficulty.easy` / `.normal` / `.hard` | `EASY` / `NORMAL` / `HARD` |
| `select.start` | `START` |
| `select.startDisabled` | `Pick or upload a track first.` |
| `select.trackingOk` | `TRACKING OK` |
| `select.trackingNone` | `STEP INTO FRAME` |
| `calib.title` | `CALIBRATION` |
| `calib.back` | `BACK` |
| `calib.step.position` | `Shoulders and both hands visible` |
| `calib.step.wave` | `Wave to confirm` |
| `calib.step.ready` | `Get ready` |
| `calib.coach.noBody` | `Step into the frame so I can see you.` |
| `calib.coach.oneHand` | `Show me both hands.` |
| `calib.coach.tooClose` | `Too close — step back a little.` |
| `calib.coach.tooFar` | `Too far — step closer.` |
| `calib.coach.lowLight` | `Tracking is uncertain. Face the light and keep your hands clear.` |
| `calib.coach.steady` | `Looking good. Hold still.` |
| `calib.coach.wave` | `Wave a hand to confirm.` |
| `calib.waveCount` | `{n} / {total}` |
| `hud.score` | `SCORE` |
| `hud.combo` | `COMBO` |
| `hud.accuracy` | `ACCURACY` |
| `hud.multiplier` | `×{n}` |
| `hud.gesture.open` / `.fist` / `.point` / `.none` | `OPEN` / `FIST` / `POINT` / `—` |
| `hud.judgement.perfect` / `.great` / `.good` / `.miss` / `.badcut` | `PERFECT` / `GREAT` / `GOOD` / `MISS` / `BAD CUT` |
| `hud.dodged` | `DODGED +{points}` |
| `hud.timing` | `{sign}{ms} ms` |
| `hud.milestone.10` / `.25` / `.50` / `.100` | `WARMING UP` / `ON FIRE` / `UNSTOPPABLE` / `LEGENDARY` |
| `hud.trackingRate` | `{hz} Hz` |
| `paused.title` | `PAUSED` |
| `paused.trackingLost` | `Tracking lost — step back into frame.` |
| `paused.manual` | `Take a breath.` |
| `paused.hidden` | `Paused while the tab was hidden.` |
| `paused.resumingIn` | `resuming in {n}` |
| `paused.resume` | `RESUME` |
| `paused.quit` | `QUIT` |
| `results.title` | `RESULTS` |
| `results.score` / `.accuracy` / `.maxCombo` | `SCORE` / `ACCURACY` / `MAX COMBO` |
| `results.kinetic` | `MOTION ESTIMATE · FOR FUN` |
| `results.kineticValue` | `≈ {kj} kJ · ≈ {kcal} kcal (modelled)` |
| `results.kineticTooltip` | `A playful model using tracked speeds and assumed body masses. Camera tracking cannot measure the energy or calories you actually used. This value is not a fitness measurement.` |
| `results.peakCombo` | `PEAK COMBO · {time}` |
| `results.retry` / `.songs` | `RETRY` / `SONGS` |

Interpolation uses `{name}` placeholders and a 10-line `t(key, vars)` helper; no i18n library.

Retain `calib.coach.lowLight` as the existing key while correcting its meaning to uncertain tracking. The strings list also needs implemented keys for camera privacy, unsupported/busy camera, upload Cancel, empty/silent audio, Standard/Calm, audio-unlock recovery, safe-space guidance and unexpected-state recovery. Add them with those flows, not hard-coded JSX. Technical setup commands belong in developer documentation, not the default player-facing failure card.

## Store

`state/store.ts` (Zustand). The store holds **display state only**; the game core is the source of truth and the adapter copies into the store.

```ts
export interface UiStore {
  // machine
  machineState: 'BOOT' | 'SELECT' | 'CALIBRATION' | 'PLAYING' | 'PAUSED' | 'RESULTS';
  pauseReason: 'tracking' | 'manual' | 'hidden' | 'audio' | 'fatal' | null;

  // boot
  bootProgress: number;                        // 0..1
  bootStage: keyof typeof strings.boot.stage | null;
  bootError: { kind: 'cameraDenied' | 'cameraUnavailable' | 'noWebgl' | 'models'; message: string } | null;

  // select
  library: LibraryEntry[];                     // bundled tracks
  selected: { beatmap: BeatmapV1 | null; file: File | null; valid: boolean; errors: string[] };
  difficulty: Difficulty;
  generation: { active: boolean; percent: number; tempoFallback: boolean; error: string | null };
  youtube: { online: boolean; resolving: boolean; error: string | null };

  // tracking (throttled 10 Hz)
  tracking: { present: boolean; hz: number; handsPresent: [boolean, boolean] };

  // calibration
  calib: { steps: [boolean, boolean, boolean]; coach: keyof typeof strings.calib.coach; waveCount: number; countdown: number | null };

  // hud (throttled ≤ 20 Hz for text; pops are event-driven)
  hud: {
    score: number; combo: number; multiplier: number; nextMultiplierAt: number; accuracy: number | null;
    songTimeMs: number; durationMs: number; dropMarkersMs: number[];
    handLeft: HandIndicator; handRight: HandIndicator;
    milestone: 10 | 25 | 50 | 100 | null;
  };
  pops: JudgementPop[];                        // ≤ 6, each { id, text, color, x, y, bornAt }

  // results
  results: SessionStats | null;

  // appearance only; persist the explicit choice locally, never recorded camera data
  visualPreferences: { intensity: 'standard' | 'calm' };

  // dev
  debug: { visible: boolean; drawLandmarks: boolean; drawHitVolumes: boolean; stats: DebugStats | null; tier: 'high' | 'medium' | 'low' };

  // actions (called only by the adapter and screens)
  set: (patch: Partial<UiStore>) => void;
  pushPop: (pop: JudgementPop) => void;
  expirePops: (now: number) => void;
}

export interface HandIndicator { present: boolean; gesture: Gesture; charge: number; }
```

### Adapter and throttling

`state/adapter.ts` subscribes to the event bus once:

- `state:change` → `machineState`, `pauseReason` immediately.
- `song:progress`, `combo:change`, tracking updates, and every terminal judgement (`note:hit`, `note:miss`, `note:badcut`, `obstacle:hit`, `obstacle:dodged`) → mirror updated authoritative aggregates into a pending patch and flush at most every 50 ms (`UI_TEXT_HZ` = 20) via a single `set`. Live accuracy uses resolved objects as its denominator; use `null` and show an em dash before the first resolved object. RESULTS uses final `SessionStats.accuracy` over the whole map, as defined in [07](07-hit-detection-and-scoring.md).
- `note:hit` / `note:miss` / `note:badcut` / `obstacle:dodged` → `pushPop` immediately (after projection); enforce one terminal pop/outcome per note ID. Bad-cut visual despawn is not a second miss.
- `session:end` → `results` immediately.

Components select narrowly (`useStore(s => s.hud.score)`) so a score change re-renders only the score element. Lists (library, pops) use stable ids as keys.

Subscribe once per adapter lifetime and return an unsubscribe/dispose function; React development remounts must not double event handlers or score pops. Keep high-rate hand/charge geometry in the renderer; the DOM store uses display-rate summaries. Clear session-specific pending patches, generation tokens and pops on Quit/Retry; asynchronous results from a disposed session must not mutate the next screen. The renderer receives appearance preferences through a read-only adapter without UI writes to game state.

## Components

| Component | Responsibility |
| --- | --- |
| `App` | Chooses the screen by `machineState`; mounts `DebugOverlay` in dev. |
| `screens/BootScreen` | Logo, progress, stage label, error card + retry. |
| `screens/SelectScreen` | Composes `LibraryGrid`, `UploadZone`, `YoutubeField`, `DifficultyControl`, `StartButton`, `TrackingPill`. |
| `screens/CalibrationScreen` | Checklist, `WaveMeter`, coaching line, countdown overlay, Back. |
| `screens/Hud` | Score, `MultiplierRing`, accuracy, `GestureIndicator` ×2, `JudgementPops`, `SongProgress`, tracking indicator, milestone flash. |
| `screens/PausedScreen` | Reason, resume countdown, Resume/Quit. |
| `screens/ResultsScreen` | Rank, stats grid, `JudgementBars`, kinetic energy + tooltip, highlight viewport box, Retry/Songs. |
| `components/Panel` | Glass panel with accent glow prop. |
| `components/Button` | Primary/secondary variants, focus ring, keyboard activation. |
| `components/Numeric` | Tweened tabular number (`value`, `decimals`, `suffix`). |
| `components/MultiplierRing` | SVG arc + centre label, flash on break. |
| `components/GestureIndicator` | Glyph, label, charge arc, dim when absent. |
| `components/JudgementPops` | Absolutely positioned pops; expires via `requestAnimationFrame` tick. |
| `components/SongProgress` | Elapsed/total, drop markers, playhead. |
| `components/WaveMeter` | Sparkline + reversal counter. |
| `components/Tooltip` | Hover/focus tooltip with `role="tooltip"`. |
| `components/DebugOverlay` | Monospace stats + toggles (dev only). |
| `project.ts` | World → screen projection helper. |
| `strings.ts` | All copy. |
| `theme.css` | Tokens, fonts, panel/button base styles, reduced-motion rules. |

## Acceptance criteria

1. Every machine state renders exactly one screen component; an unknown state shows a recoverable failure with Retry/Return to songs guidance and records the error. It never becomes a blank screen or fabricated success.
2. No visible `<video>` element exists in the DOM at any time; the only player representation is the 3D silhouette.
3. All UI text comes from `ui/strings.ts`; a grep for `>[A-Z]{3,}<` in `ui/**/*.tsx` finds no literal uppercase copy.
4. HUD numbers are ≥ 28 px at 1920×1080, use tabular numerals, and tween rather than jump.
5. The play area rectangle contains no DOM element other than judgement pops.
6. Judgement pops appear within one frame of the event at the projected impact position, within 8 px of the projected block centre in the debug overlay check.
7. Store text updates are flushed at ≤ 20 Hz (verified by counting `set` calls over 5 s in dev; ≤ 100 + pops).
8. Start is disabled until `validateBeatmap` passes; pressing Enter on a disabled Start does nothing.
9. Calibration ticks turn on only after `CALIB_PRESENCE_MS`; the coaching line shows the highest-priority string and updates within 200 ms of the condition changing.
10. PAUSED is fully operable with keyboard alone and with mouse alone.
11. RESULTS shows real `SessionStats`, a clearly labelled motion estimate, and the valid owned highlight if available; Enter retries and Esc returns to Select. Missing snapshots never hide real stats.
12. With `prefers-reduced-motion: reduce`, Calm disables decorative DOM and scene motion/flash paths; deterministic replay yields the same judgements and score as Standard.
13. Every interactive element has a visible focus ring and is reachable by Tab.
14. Fonts load from the local bundle offline after installation; failed font requests retain readable controls without layout-breaking shifts.
15. Invalid/oversized/empty audio, Cancel, repeated selection and late worker completion preserve the correct selection and leave no stuck loading state.
16. Keyboard shortcuts respect text entry; pause/retry/focus work at 200 % zoom; camera/audio/model failures each show a useful recovery action.
17. Ten start/pause/quit/retry cycles leave event subscriptions, pending async jobs and UI updates bounded; replay diagnostics visibly identify REPLAY.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
