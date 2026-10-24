# 14 — UI / UX

**Current user scope (2026-10-25):** retain and show only the head, arms/hands and torso through the hips. Legs are excluded from live/setup/frozen/results figures, the placeholder, replay exports and game input. The upstream pretrained pose task may internally infer a full pose; indices 25–32 are zeroed at the application boundary. Only actual visible head/hips/shoulders plus hand readiness can establish calibration. No new training result is implied by filtering outputs.


The UI is a React 19 DOM overlay drawn above the Three.js canvas ([ADR-002](03-decisions.md#adr-002--threejs-imperative-for-rendering-react-only-for-dom-ui)). It never touches the scene graph; it reads a Zustand store that a thin adapter fills from game events ([ADR-011](03-decisions.md#adr-011--zustand-for-ui-state-typed-event-bus-for-game-events)). Every screen below maps one-to-one to a state in [04 — State Machine](04-state-machine.md).

Pillar reminder: **P1 Readable at a glance** governs every decision here. If a judge standing 2.5 m from the laptop cannot read it, it is wrong.

The React screens and shared menu are implemented experimental UI, not stubs. This document retains the target behaviour and acceptance requirements; a wireframe or feature table is not proof that every detail has shipped. [25 — Menu & Hand Navigation](25-menu-and-hand-navigation.md) owns the hand-pointer protocol and geometry; this document owns screen composition, controls and feedback. The [roadmap](../ROADMAP.md) records the user's current work order and the still-open release gates.

**Current implementation — 2026-10-25:** the music menu opens without camera permission/models, shows a labelled head-to-hips illustration and exposes three local credited songs, explicit audio enable/preview, difficulty, upload, paged rails and Settings. **Try level with dataset** is the primary action; it can automatically prepare a real 10 s fade-in / 60 s heuristic highlight / 10 s fade-out arrangement and a freshly generated chart. **Make 80-second cut** exposes that preparation separately. A visible dataset banner identifies independent static COCO annotations; actual trial results are produced without invented hand gestures or hits. The full source songs remain available. The [recorded browser trial](evidence/2026-10-25-dataset-trial.md) is level/audio/lifecycle evidence, not live tracking proof.

Camera setup and **Live camera play** remain reachable in secondary Settings pages, independently of song choice. The original requirement for a prominent first-launch **Set up camera** action is deferred under the dataset-first steering; acceptance for that requirement is not passed. The live path retains fresh-hand/matching-calibration guards. A labelled camera preview and Cancel have been exercised; completed consenting-person calibration, live scored hits and live hand-menu coverage remain open.

The current HUD has score/combo/accuracy, peripheral gesture labels/glyphs, beam charge arcs/percentages, one recent judgement and song progress. Missing/stale/dataset hand data stays unavailable. Expanded details below—numeric tweening, multiplier/milestone treatment, projected multi-pop queues, drop markers, measured tracking-rate display and the full wave/coaching UI—remain target work unless separately evidenced. Standing-distance, complete zoom/layout, human comfort and P4/P5 acceptance are not implied by the implementation.

## Design language

| Principle | Rule |
| --- | --- |
| **Dark void** | The DOM background is always transparent; the 3D void (`--void`) is the only background. Panels are translucent glass so the silhouette and grid stay visible behind menus. |
| **Neon accents, sparingly** | One accent colour per element. Accents are reserved for interactive or live data (score, combo, Start). Decorative chrome is `--muted`. |
| **Quiet panels** | Use a dark, nearly opaque panel and a subtle structural border. One short accent rule identifies the selected track or primary action. Blur is optional in menus only and disabled on low tier; no glowing border around every panel. The player and destruction supply the spectacle. |
| **The player owns the centre** | Reserve the central figure stage on SELECT, CALIBRATION, PAUSED and RESULTS. Before camera setup/calibration, show a clearly labelled illustrative human placeholder and a prominent Set Up Camera action. Once setup is valid, the live silhouette takes its place. Put interactive panels in side rails; status above and coaching below. No library grid, modal, loading card or Start button covers the player's face/torso. |
| **Distinct display type** | Use Orbitron for the title, rank and selected display numbers; Rajdhani for controls, metadata and coaching. Reserve uppercase/letter spacing for short labels so instructions remain readable at a distance. |
| **Beat-aware, restrained** | The combo ring or song progress may respond to `--beat` (§Motion). Score, accuracy and safety/coaching text stay spatially stable. Avoid pulsing the whole interface. |
| **No raw webcam pixels, ever** | The DOM never renders the `<video>` element visibly. The live player uses the silhouette; the unconfigured-camera placeholder and saved results pose are explicitly labelled as illustration or highlight, never fabricated tracking ([01](01-vision.md)). |

### Shared menu composition

Every app-owned menu uses one `MenuShell`: left controls/selection rail, protected central figure stage, right details/actions rail, top status strip and bottom instruction strip. The renderer fits the visible figure into the stage rather than leaving a full-width figure behind opaque panels. Stage bounds and hand target geometry follow [25](25-menu-and-hand-navigation.md); do not independently resize the hit-test coordinate space when a card loads. SELECT browsing shows an illustrative human placeholder while the camera is not set up or calibration is invalid; after valid setup it shows the live silhouette. An explicitly labelled live positioning preview is allowed in the separate camera-setup mode before calibration passes. Live CALIBRATION uses live input, PAUSED a labelled frozen pose, and RESULTS a labelled owned 2.5D highlight. The separate dataset source uses labelled annotation skeletons/saved dataset moments; it never impersonates a calibrated live figure.

The initial library contains at least three attributed bundled starter tracks from [09](09-beatmap-format.md), selectable without an upload, account, network request or companion service after asset preparation. Give the library a bounded visible page and large **Previous / Next** buttons for growth; no tiny scroll thumb, carousel drag or hover-only arrow is required for hand operation. Preserve the selected track when changing pages and disable the boundary action with a readable reason.

Use large separated targets with the minimum dimensions/gaps in [25](25-menu-and-hand-navigation.md), stable positions and a full label. Hand hover, armed/point confirmation, pressed, selected, keyboard focus, disabled and busy states are distinct. Selection changes a track/difficulty; only the separate live Start action begins live calibration. Dataset trial is a distinct labelled source-specific action. No preview audio or state-changing action starts merely because a hand passes over a control.

At smaller supported laptop viewports or 200% zoom, reduce the number of visible library rows and paginate long detail/stat groups inside their rails. Keep the figure stage and the primary/Back actions visible rather than overlaying the centre. Mouse users may scroll the rail, while large Previous/Next or More/Back buttons expose the same content to hands and keyboard. The app remains a desktop product; reflow does not imply mobile tracking support.

## Typography

Fonts are bundled as pinned TrueType Orbitron and Rajdhani files in `app/public/assets/fonts/`, with exact hashes and OFL notices in the [font registry](../app/public/assets/fonts/README.md) ([ADR-013](03-decisions.md#adr-013--everything-the-demo-needs-is-bundled-and-works-offline)). Runtime uses `font-display: swap`; preserve readable system fallbacks so a missing font never hides Retry, camera permission guidance or Start. Reserve label/number widths to prevent layout jumps. Offline checks include failed-font behaviour, not only the happy path; subset/preload optimization is not established by the existing packaged files.

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

Visual palette/font roles are maintained in [DESIGN.md](../DESIGN.md); the excerpt below mirrors that source. The runtime adapter is `app/src/ui/theme.css`'s `:root` palette. Components should use tokens rather than introducing independent colours. UI behavior remains in this document and [25](25-menu-and-hand-navigation.md), with menu timings/geometry in [02](02-architecture.md#constants).

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
| `BOOT` | `Boot` | Full-screen, opaque void until the renderer is ready |
| `SELECT` | `Select` | Side rails around placeholder or calibrated live figure; camera-setup mode uses a labelled positioning preview |
| `CALIBRATION` | `Calibration` | Side checklist/actions, central silhouette/outline, countdown in status strip; dataset pre-roll is explicitly source-labelled |
| `PLAYING` | `Hud` | Edge-anchored, no panels in the play area |
| `PAUSED` | `Paused` | Side recovery/actions around a labelled frozen central pose |
| `RESULTS` | `Results` | Side stats/actions around a labelled central 2.5D highlight or saved dataset moment |

`App.tsx` switches on `useStore(s => s.state)` and renders the current screen (or the explicitly opened credits surface). Its current diagnostics surface exposes scoped evidence export; the expanded `DebugOverlay` below remains target work, not an existing component.

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
│   │  REQUIRED ASSETS COULD NOT LOAD                      │    │
│   │  Retry the failed asset stage.                      │    │
│   │                                     [ RETRY ]        │    │
│   └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

- Progress is the aggregated weighted value from [04 §BOOT](04-state-machine.md#boot). The stage label shows the asset currently loading (`strings.boot.stage.*`).
- The logo pulses at 72 BPM (no song yet) using `--beat` driven by a fixed period.
- Error cards use `--danger` border glow and the exact copy in §Strings. The Retry button re-runs only the failed stage.
- Missing assets and an unsupported renderer need distinct actionable BOOT states from [04](04-state-machine.md). Camera denial/busy/unavailable belongs to the later SELECT setup subflow, not this loading screen. Before that flow requests access, explain “Camera images stay on this device; only a silhouette appears in the game.” Never keep a fabricated loading percentage moving after failure. Stage progress is determinate only when the loader knows its denominator; model initialisation uses a named indeterminate stage.
- BOOT does not require camera permission or body calibration to open the menu. After required renderer/assets are ready, SELECT is usable by mouse/keyboard with the human placeholder and Set Up Camera action. Camera failure never strands the user at an opaque boot screen. Request camera access only through the explicit setup flow; request any browser audio unlock through an actual mouse/key action. Browser permission prompts, audio unlock, fullscreen and native file dialogs can require trusted input; camera-recognised gestures cannot grant that privilege. Expose a hand cursor only when tracking is actually usable, never from a simulated placeholder.

### SELECT

The wireframe below is the original live-onboarding reference. The implemented ready page instead prioritizes **Try level with dataset**, audio enable/preview and **Make 80-second cut**; camera setup/live Start are secondary Settings actions. This changed priority does not pass the original prominent-camera acceptance criterion.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  SIGN SABER                                  CAMERA NOT SET UP / INPUT MODE  │
│                                                                              │
│  ┌─ STARTER MUSIC ────┐                       ┌─ SELECTED TRACK ───────────┐ │
│  │ [ TRACK A       ] │                       │ Title · artist · duration │ │
│  │ [ TRACK B       ] │    HUMAN PLACEHOLDER │ Difficulties / attribution │ │
│  │ [ TRACK C       ] │    until camera +    │ [ EASY ] [ NORMAL ] [ HARD ]│ │
│  │                   │    calibration ready│ [     SET UP CAMERA      ] │ │
│  │ [ PREV ] [ NEXT ]│    then LIVE FIGURE  │ [ PREVIEW ] [ STOP ]       │ │
│  │ Page 1 / 1       │                       │ [        START         ]   │ │
│  │                   │                       │                             │ │
│  │ [ UPLOAD FILE   ]│                       │ [ STANDARD ] [ CALM ]      │ │
│  │ Mouse / keyboard │                       │ [ VOLUME − ] [ VOLUME + ]  │ │
│  │ for file picker  │                       │ [ RIGHT HAND ] [ LEFT HAND ]│ │
│  └───────────────────┘                       └─────────────────────────────┘ │
│  Set up camera to enable hands. Then OPEN PALM to move, POINT to click.       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Camera/input status** (top-right): show Not Set Up, Setting Up, Calibration Required, Ready or the actual recovery state. `TRACKING OK`/Ready is not inferred from the placeholder or merely granted permission; valid live tracking and the setup/calibration guards must pass. During labelled setup, raw tracking may be reported as “Camera connected — finish calibration” with its measured rate. Missing/stale input clearly disables the hand cursor without blocking mouse/keyboard browsing.
- **Library cards**: at least three bundled starter tracks; cover when available, real title/artist, verified duration, confidence-appropriate tempo and available difficulties. The left rail shows a bounded page of large full-row buttons. Keyboard arrows move library focus; Enter selects that focused card. Open-palm hover plus a point selects the same track through the shared action path. Keep selected state distinct from hover/focus and preserve it through page changes.
- **Upload zone**: drag & drop or click. During generation the zone becomes a progress bar with the label `strings.select.generating` and a percentage from the beatmap worker. On completion it shows BPM and note count; on tempo-fallback it shows the badge `strings.select.tempoFallback` in `--gold`.
- **YouTube field**: optional secondary rail detail, never a central overlay or required starter step. Enable only when the companion service health check succeeded in the last `YT_HEALTH_INTERVAL_MS` ([23](23-youtube-companion-service.md)); otherwise show disabled offline copy. Text entry remains keyboard input. Enter submits the field once; a spinner replaces the submit icon while resolving. Opening these details keeps a large Back/Close target in the same rail.
- **Difficulty**: segmented control, default Normal, persisted in `localStorage`.
- **Live Start**: disabled (`--muted` 40 %) until `validateBeatmap` returns no errors and state-machine readiness permits calibration; its visible explanation names the unmet requirement. Mouse click, focused Enter/Space or a valid point-click fires the same guarded `select:start` transition once. Selecting a song does not also Start it. A held pointing pose cannot click through to calibration confirmation. The current Settings location does not change these guards.
- Upload accepts only supported, decodable local audio within [08](08-beatmap-generation.md)'s limits; an extension alone is not validation. Show file name, elapsed work and the active stage. Percentages must come from completed work units; decode and unknown-duration stages use indeterminate progress. Cancel returns to Select and invalidates the job token so a late worker result cannot overwrite a newer selection. Preserve the previous valid selection after an invalid upload, clearly identifying which track Start would launch.
- If bundled tracks are missing, omit fake cards, show an actionable asset/setup failure and keep mouse/keyboard upload recovery. Fewer than the required starter tracks fails release acceptance; an upload field does not satisfy that requirement. TRACK A/B/C in the wireframe are structural placeholders for the licensed manifest, not song metadata or committed assets. An empty/quiet upload explains why no playable notes were found. A tempo-fallback badge is paired with its limitation rather than a precise BPM presented as detected truth.
- Place a persistent, readable explanation beside disabled Start; disabled native controls cannot be relied on to expose a hover/focus tooltip. Show Standard/Calm intensity, volume and camera status before starting. Readiness remains the state machine's decision; live play cannot bypass calibration. Dataset readiness has the explicit separate contract below.
- Preview is explicit and reversible: mouse/key/point activation of Preview starts the selected clip only after browser audio unlock; Stop and a changed selection stop it. No hover-preview. Use discrete volume −/+ and named intensity buttons for hands, while retaining accessible keyboard/native-pointer alternatives; hand operation never requires precise dragging. A visible control switches the active menu hand; tracking loss never silently transfers control to a bystander's or the other hand.

#### Dataset trial within SELECT

**Try level with dataset** becomes eligible only with a validated selected chart, decoded audio, running user-enabled sound and a usable renderer, with no active transition/loading conflict. It requests no camera, model or calibration. Its first start automatically creates the arrangement and regenerates the map from the exact new WAV; a selection change or cancelled/stale request cannot start an old result. The [track registry](../app/public/assets/tracks/README.md#dynamic-arrangements) specifies the continuous-window heuristic, fades, hashes and short-track fallback.

The level visibly identifies its independent static annotations. There are no finger/gesture labels, temporal-motion recording, masks or metric depth; the hand HUD says unavailable. Run the real scoring/lifecycle path and retain actual misses/results rather than inventing hits or player performance. Dataset pre-roll does not ask the user to pass live calibration. Its Pause/Resume/Retry bypass only missing live input, retain audio/lifecycle guards and preserve the source label. See [25](25-menu-and-hand-navigation.md#dataset-trial-exception); this exception cannot set camera readiness or relax live Start/Resume/Retry guards.

#### Camera setup within SELECT

The original live-onboarding requirement is a prominent **Set Up Camera** action before configuration, retained as Reconfigure Camera afterward. The implemented dataset-first menu exposes it through Settings; that original prominence acceptance remains deferred. It opens the `camera-setup` subflow within SELECT rather than pretending a song is already ready. It works without a selected song or playable audio: enable/request the camera, verify the chosen device and a real tracking sample, check mirroring and comfortable reach/body calibration, then return to browsing. A separate explicit audio-enable step appears only where the browser requires it.

While `mode === 'browse'` and calibration is invalid, the centre keeps a static, clearly illustrative human placeholder with the setup explanation. It does not mirror motion, show TRACKING OK, feed hit detection, or contribute latency/recognition evidence. In `mode === 'camera-setup'`, replace it with a clearly labelled **Live setup preview — not calibrated** only when real frames exist, so the player can position themselves. Before frames or after a denied/unavailable camera, retain the placeholder and actionable instructions in the side rails. Calm uses a static illustration without fake ambient hand movement.

Setup success stores camera/calibration validity through the state machine; only then does the regular menu show the live neon figure. A changed device/crop, lost validity or a revoked permission restores the placeholder/status and requires reconfiguration. Error/Cancel returns to usable song browsing, retaining selection and native input. Live Start stays disabled until a validated selected map/audio and current camera/tracking/calibration readiness all pass; its explanation names the unmet condition. A hand pointer may assist the labelled setup after reliable tracking exists because its 2D mapping does not depend on completed body calibration, but no simulated or stale frame can activate an action.

### CALIBRATION

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CALIBRATION                                    READY / COUNTDOWN STATUS     │
│  ┌─ GET IN POSITION ─┐                       ┌─ ACTIONS ───────────────────┐ │
│  │ Shoulders + hands│                       │ [ CONFIRM READY          ] │ │
│  │ visible          │    LIVE SILHOUETTE    │ Wave or point-click after   │ │
│  │                  │    inside a thin     │ readiness checks pass.      │ │
│  │ Wave or confirm  │    target outline    │                             │ │
│  │                  │    in the centre    │ [ STANDARD ] [ CALM ]      │ │
│  │ Get ready        │                       │ [          BACK          ] │ │
│  └──────────────────┘                       └─────────────────────────────┘ │
│  Show both hands. Clear space around you and use comfortable movements.      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The three steps are exactly the three conditions in [04 §CALIBRATION](04-state-machine.md#calibration). A step's tick turns `--cyan` only after its condition has held for `CALIB_PRESENCE_MS`; a regressed condition turns it back to `◌` with a 160 ms fade.
- **Wave meter**: a 24-sample sparkline of the active hand's mirrored-image x plus a reversal counter `n / WAVE_REVERSALS`. Fills as reversals accumulate within `WAVE_WINDOW_MS`.
- **Coaching line** (Body L, centre-bottom) shows exactly one string at a time, priority order: no body → one hand missing → too close → too far → unstable tracking → steady. Strings in §Strings. Low model/mask confidence indicates uncertain tracking, not a measured light level; suggest facing the light or clearing the background without asserting darkness. Use the existing presence/confidence rules from [05](05-tracking-pipeline.md), not an invented luminance sensor.
- **Dashed target frame**: a rectangle on the silhouette layer spanning the `CALIB_SHOULDER_MIN`…`CALIB_SHOULDER_MAX` sweet spot, so the player sees where to stand.
- Keep checklist and Confirm Ready/Back in the side rails. The centre contains the player and thin non-interactive alignment cues only; countdown digits belong to the status strip, never over the face. The menu pointer works before body calibration because [25](25-menu-and-hand-navigation.md) maps its own normalized menu space. Point-clicking Confirm Ready is the same explicit confirmation as its mouse/key activation, subject to all readiness guards. Entering CALIBRATION clears the previous point latch; Start cannot also confirm readiness.
- **Countdown**: Follow [15 §Start](15-audio-playback-sync.md#21-start): confident tempo gets beat-aligned digits/clicks; `lowTempoConfidence` gets a neutral countdown without a musical metronome. Drive digits from the output-aligned negative `SongClock`, including any ready stage needed to give early notes their full approach. Calm removes the 1.4 → 1.0 scale accent. Retry (`calibrationCached = true`) skips confirmation only when the same calibration remains valid; readiness checks and the full countdown still apply.
- `‹ BACK` fires `calib:back`.
- Show “Clear space around you. Use comfortable movements; stop if uncomfortable.” before the countdown. A wave is a convenient confirmation, not the only control: Confirm Ready accepts mouse, keyboard or a fresh open → point click with the same live presence/stability guards. During armed pre-roll, disable ordinary menu actions and keep only the explicit Back/cancel route from [25](25-menu-and-hand-navigation.md); entering PLAYING hides the menu cursor and clears its latch/charge history. Explain any supported seated/reduced-reach profile before it changes the playable lane range; do not silently change difficulty or scoring mid-song.

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

The implemented `Hud` uses `DisplayState.hud.left/right`, `leftPresent/rightPresent` and `leftCharge/rightCharge` for its peripheral indicators. It ignores every retained gesture/charge field when presence is false, floors the visible percentage so 99.9% does not claim full charge, and pairs gesture colour with text/glyphs. Absent symbols dim while **Unavailable / No hand data** text stays readable; no fake zero-to-full animation or per-frame live-region announcement is used. Dataset hands remain unavailable. These display assertions do not establish live recognizer accuracy or the pending expanded HUD features in the table.

#### Projecting hit positions to screen

The renderer owns a projection helper that writes numeric screen coordinates into caller-owned scratch storage. Convert event `Vec3` data into its retained Three.js vector internally; `impactPos` is plain data and has no `.clone()` method. Project through the same camera matrix used for the displayed frame, convert NDC to CSS pixels, and include the canvas rectangle's page offset. Misses use the note position supplied by the read-only scene adapter. UI positions pops using `transform: translate3d(x, y, 0)`; it neither mutates the camera nor creates a separate world mapping. Reproject or retire active pops coherently on resize.

### PAUSED

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PAUSED                                        RECOVERY / COUNTDOWN STATUS   │
│  ┌─ SESSION ─────────┐                       ┌─ ACTIONS ───────────────────┐ │
│  │ Reason and       │                       │ [        RESUME          ] │ │
│  │ recovery guidance│    FROZEN PLAYER     │ [         SONGS          ] │ │
│  │                  │    POSE IN CENTRE   │ [ STANDARD ] [ CALM ]      │ │
│  │ Tracking status  │    visibly labelled │ [ VOLUME − ] [ VOLUME + ]  │ │
│  └──────────────────┘                       └─────────────────────────────┘ │
│  Mouse / keyboard always work. Hand control returns when tracking is usable. │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Reason text per `pauseReason` in the store: `tracking` → `strings.paused.trackingLost`; `manual` → `strings.paused.manual`; `hidden` → `strings.paused.hidden`; `audio`/`fatal` → the actionable audio or subsystem recovery message from [04](04-state-machine.md).
- When the reason is `tracking` and `BodyState.present` returns, the countdown line appears (`RESUME_COUNTDOWN_MS`) and the buttons stay available.
- Buttons MUST be reachable by mouse and keyboard (Tab/Enter, `Space` resumes, `Esc` resumes, `Q` quits) because the player may be out of frame. When fresh tracking exists, a newly armed open → point menu action can activate the same Resume/Songs/appearance controls. The frozen body is labelled; the menu cursor is live input, not proof that gameplay has resumed.
- Resume requests still pass [04](04-state-machine.md)'s readiness checks; a button must not resume into missing required hands or a suspended audio context. Only a tracking-loss pause may auto-resume. A hidden-tab/manual pause waits for the player's action, and failed audio resume leaves a clear “Enable audio to continue” action. Quit, Standard/Calm intensity and volume stay available. Fatal errors show recovery guidance rather than a countdown.

### RESULTS

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  RESULTS · ACTUAL TRACK TITLE · NORMAL                                      │
│                                                                              │
│  ┌─ THIS RUN ────────┐                       ┌─ NEXT ──────────────────────┐ │
│  │ Rank / score     │    OWNED 2.5D        │ [         RETRY          ] │ │
│  │ Accuracy / combo │    PLAYER HIGHLIGHT  │ [         SONGS          ] │ │
│  │                  │    IN THE CENTRE    │                             │ │
│  │ Judgement counts │    Actual captured  │ Motion estimate · for fun   │ │
│  │ [ MORE ] [ BACK ]│    timestamp        │ [     ABOUT ESTIMATE     ] │ │
│  └──────────────────┘                       └─────────────────────────────┘ │
│  Open palm to move the cursor. Point to choose Retry or Songs.               │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Rank letter** enters first: scale 2.5 → 1.0 with ease-out-quint over 500 ms, colour by rank (SS/S `--gold`, A `--cyan`, B/C `--text`, D `--muted`), with the `combo` SFX on SS/S.
- Then stats rows, then judgement bars, then kinetic energy, then buttons — 120 ms stagger each. Bars animate width from 0 over 400 ms; widths are proportional to the largest count.
- **Highlight viewport**: reserve the central figure stage in the existing canvas; `highlight.ts` composites an owned snapshot there ([13 §8](13-rendering-environment-camera-postfx.md#8-highlight-capture-renderhighlightts)). It is a labelled stylised 2.5D memory, not reconstructed volumetric video. Caption the actual captured time, and omit the snapshot if no valid capture exists rather than substituting a different person/run. Keep side stats/actions readable and available. Do not require GPU readback into a second DOM canvas.
- **Motion estimate explanation**: an explicit About Estimate button exposes `strings.results.kineticTooltip` in its side rail with a large Back/Close control. Hover/focus may add a tooltip, but the explanation is also available by a point-click and never covers the central player.
- Mark the motion estimate “for fun” next to the value, not only in a tooltip. Webcam landmark speed and assumed effective mass are insufficient to measure metabolic calories; kJ/kcal are explicitly a modelled estimate and excluded from judging evidence about fitness. The wireframe's energy values are illustrative and must be replaced by real session output, never hard-coded. Count all note outcomes once so the judgement bars sum to the chart total.
- `Retry` → `results:retry`; `Songs` → `results:songs`. Enter = Retry, Esc = Songs.

## Input handling

Mouse, keyboard and **open-palm → point** menu navigation are `[CORE]`. The palm controls a visible cursor; a deliberate pointing transition activates its eligible target once. Hover is never a click and there is no dwell-to-select requirement. [25](25-menu-and-hand-navigation.md) is authoritative for coordinates, timing, state/layout epochs, target registration and cancellation; UI components must not create screen-local gesture logic.

### Hand navigation and modality handover

- Use the explicitly chosen right/left menu hand; a missing hand becomes unavailable rather than silently granting control to the other hand. Large Right Hand/Left Hand buttons change the choice through the same shared action path. A hand change cancels the pending target and requires a new open-palm arm.
- The pointer uses mirrored palm-centroid input in the menu viewport, independently of camera shake, 3D perspective, `HandCursor.tip`, gameplay blade/beam and body calibration. Its frozen last-open anchor prevents a pointing finger from jumping to a neighbouring button. Geometry and any comfortable-reach remapping come from [25](25-menu-and-hand-navigation.md).
- Display idle/hover/armed/confirming/latched feedback and a brief accepted-action acknowledgement without moving controls. A confirmed point clicks the armed registered target only if it is still enabled, in the current screen/layout epoch and within the movement guard. Holding point cannot repeat; return to a stable open palm before another action. The ring describes arming/point confirmation, never a timed hover click.
- Tracking loss, stale input, uncertain identity, state/layout changes, a native mouse/key action or loss of the target cancels the pending click. A camera reappearing in a pointing pose must not activate anything. Native input wins immediately, with the documented handover cooldown before hands can re-arm. No simultaneous mouse/hand duplicate dispatch.
- All modalities invoke the same canonical semantic action and readiness guards. Native `<button>`/`<a>` controls keep their usual keyboard behavior; registered menu targets add gesture access without clickable `div` substitutes or fake trusted browser events. Recheck disabled, busy and native-only flags at dispatch; these states cannot be bypassed by a gesture.
- The driver runs only on app-owned menu controls in the states allowed by [25](25-menu-and-hand-navigation.md). It is disabled during PLAYING and cannot charge/fire gameplay beams. The menu-to-game transition clears the menu latch and gameplay gesture history so the Start click is not an opening beam shot.
- First camera permission/audio unlock, browser fullscreen, OS file picker and keyboard text entry remain native-input boundaries. Mark Upload and URL entry clearly; show “Use the mouse or keyboard for this step” rather than attempting privileged synthetic clicks. After bootstrap, bundled-song selection, paging, difficulty, preview/stop, Start, confirmation, Resume, Songs and Retry are hand operable. Hand control being unavailable never blocks mouse/keyboard recovery.

### Keyboard shortcuts

| Key | State | Action |
| --- | --- | --- |
| `Enter` / `Space` | `SELECT` | Activate the focused control; a focused library card selects, and only focused Start starts calibration |
| `← → ↑ ↓` | `SELECT` | Move library focus |
| `1` / `2` / `3` | `SELECT` | Difficulty Easy / Normal / Hard |
| `Esc` | `CALIBRATION` | Back |
| `Esc` / `Space` | `PLAYING` | Pause (`pause:request`) |
| `Esc` | `PAUSED` | Resume (`pause:resume`); Space/Enter activate the focused control normally |
| `Q` | `PAUSED` | Quit to Select (`pause:quit`) |
| `Enter` / `Space` | `RESULTS` | Activate the focused control; initially focus Retry |
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
- **Equivalent controls.** Every app-owned menu action is reachable by mouse, keyboard and the configured hand after setup, with the same selection/readiness rules. Use large separate buttons instead of hand-only dragging, tiny switches or hover-only affordances. Native browser/OS actions are clearly marked mouse/keyboard steps rather than falsely advertised as hand operable.
- **Keyboard operability** for every button; `aria-live="polite"` on coaching, meaningful camera/input status changes and the pause reason. Do not announce cursor coordinates or per-frame confirmation progress.
- **Flashing review** covers the combined scene and DOM, including destruction, beam-ready cues and drop transitions. Avoid deliberate strobing; verify the applicable flash thresholds under [WCAG 2.2 flashing guidance](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html). Calm removes transient flashes. A tiny pulse and a full-screen high-contrast flash have different risks; a DOM-only frequency rule is insufficient.
- **Assistive technology.** Menu headings have a coherent hierarchy; native buttons/inputs have labels and validation descriptions. Mark generation busy, announce completed/error stages once, and keep per-hit score pops out of live regions. Tooltips open on focus as well as hover. Tab order follows the screen's reading order.
- **Viewport resilience.** Test the supported laptop viewport, 720p, 1080p, 16:10 and 200 % browser zoom. Keep the central figure stage clear and use bounded pages/large navigation in the side rails so no hand-required control depends on a thin scrollbar. The PLAYING play rectangle still uses actual projected bounds. Do not claim mobile support from a narrow-window layout check.

## Strings

All user-facing copy lives in `ui/strings.ts` as a single frozen object. Components never contain literal UI text. Exact strings:

| Key | String |
| --- | --- |
| `app.title` | `SIGN SABER` |
| `camera.stage.wasm` | `Loading tracking engine` |
| `camera.stage.hands` | `Loading hand model` |
| `camera.stage.pose` | `Loading pose model` |
| `boot.stage.assets` | `LOADING ASSETS` |
| `camera.stage.connecting` | `WAKING THE CAMERA` |
| `camera.error.denied.title` | `CAMERA ACCESS DENIED` |
| `camera.error.denied.body` | `Allow camera access in the address bar, then Retry Setup. You can still browse music.` |
| `boot.error.noWebgl.title` | `WEBGL2 NOT AVAILABLE` |
| `boot.error.noWebgl.body` | `Open in Chrome or Edge with hardware acceleration on.` |
| `camera.error.models.title` | `Tracking models unavailable` |
| `camera.error.models.body` | `Tracking models could not load. Prepare the local model assets, then retry camera setup. You can still browse songs.` |
| `boot.error.retry` | `RETRY` |
| `camera.setup` / `.reconfigure` | `Set up camera` / `Reconfigure camera` |
| `camera.notSetUp` | `Camera not set up — use the mouse or keyboard to begin.` |
| `camera.placeholder` | `Illustrative figure — set up and calibrate your camera to see yourself.` |
| `camera.setupPreview` | `Live setup preview — not calibrated` |
| `camera.calibrationRequired` | `Camera connected — finish calibration.` |
| `camera.ready` | `Camera and calibration ready` |
| `camera.cancel` / `.back` | `CANCEL SETUP` / `BACK TO MUSIC` |
| `camera.enableAudio` | `ENABLE SOUND` |
| `menu.instructions` | `Open palm to move. Point to click. Open again before the next click.` |
| `menu.nativeOnly` | `Use the mouse or keyboard for this step.` |
| `menu.hand.right` / `.left` | `RIGHT HAND` / `LEFT HAND` |
| `menu.handUnavailable` | `Selected hand not visible. Show it or use the mouse or keyboard.` |
| `menu.pointReady` | `Point to choose {label}` |
| `menu.rearm` | `Open your palm before the next click.` |
| `menu.previous` / `.next` / `.page` | `PREVIOUS` / `NEXT` / `Page {page} of {total}` |
| `menu.volumeDown` / `.volumeUp` | `VOLUME −` / `VOLUME +` |
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
| `select.startNeedsCamera` | `Set up and calibrate the camera before starting.` |
| `select.startNeedsAudio` | `Enable sound with the mouse or keyboard before starting.` |
| `select.preview` / `.stopPreview` | `PREVIEW` / `STOP PREVIEW` |
| `select.trackingOk` | `TRACKING OK` |
| `select.trackingNone` | `STEP INTO FRAME` |
| `calib.title` | `CALIBRATION` |
| `calib.back` | `BACK` |
| `calib.step.position` | `Shoulders and both hands visible` |
| `calib.step.wave` | `Wave to confirm` |
| `calib.step.ready` | `Get ready` |
| `calib.confirm` | `CONFIRM READY` |
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
| `results.aboutEstimate` | `ABOUT ESTIMATE` |
| `results.peakCombo` | `PEAK COMBO · {time}` |
| `results.retry` / `.songs` | `RETRY` / `SONGS` |

Interpolation uses `{name}` placeholders and a 10-line `t(key, vars)` helper; no i18n library.

Retain `calib.coach.lowLight` as the existing key while correcting its meaning to uncertain tracking. The strings list also needs implemented keys for camera privacy, unsupported/busy camera, upload Cancel, empty/silent audio, Standard/Calm, audio-unlock recovery, safe-space guidance and unexpected-state recovery. Add them with those flows, not hard-coded JSX. Technical setup commands belong in developer documentation, not the default player-facing failure card.

## Store

`state/store.ts` (Zustand) exports the implemented `DisplayState`, `useStore` and `display`. It holds **display state only**; the game core and guarded `GameRuntime` remain authoritative. The current main fields are `state`, `epoch`, `camera`, `pointer`, `map`, `generation`, `arrangement`, `hud`, `results`, `calm` and the source label `replay`. `replay` alone does not distinguish dataset stills from logic replay; runtime source-specific labels/evidence must do so.

The expanded `UiStore` below is a **target view-model design**, not a second existing export or a claim that every listed field/component is implemented. Its richer pop, tracking-rate, wave, debug and multiplier details remain pending. Shared `TrackingFrame`, `HandCursor`, `CameraSetupState`, `MenuPointerState`, events and constants retain their normative owners in [02](02-architecture.md); display-model evolution must not create a competing recognizer or bypass those contracts.

```ts
export interface UiStore {
  // machine
  machineState: 'BOOT' | 'SELECT' | 'CALIBRATION' | 'PLAYING' | 'PAUSED' | 'RESULTS';
  pauseReason: 'tracking' | 'manual' | 'hidden' | 'audio' | 'fatal' | null;

  // boot
  bootProgress: number;                        // 0..1
  bootStage: keyof typeof strings.boot.stage | null;
  bootError: { kind: 'noWebgl' | 'assets'; message: string } | null;

  // camera setup is a SELECT subflow; these canonical types are defined in [02]/[25]
  cameraSetup: CameraSetupState;
  menuPointer: MenuPointerState | null;       // display summary, never a second recognition state machine
  menuInput: { enabled: boolean; hand: 'left' | 'right'; nativeActionRequired: boolean };

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

The implemented adapter lives in `core/runtime.ts`; there is no separate `state/adapter.ts` module in the current layout. It subscribes to lifecycle/game events once and copies display summaries via `display`. For the target expanded view model, retain this mapping:

- `state:change` → current `DisplayState.state`/`epoch`/`pauseReason` immediately (the expanded example calls the state field `machineState`).
- Camera setup events (`camera:setup`, `camera:ready`, `camera:error`, `camera:cancel`) → mirror the authoritative `CameraSetupState`; update placeholder/live-preview presentation and required native-input guidance without clearing the selected song. A rendered placeholder cannot set tracking/camera readiness.
- Menu-controller output → `menuPointer`/`menuInput` summaries at display cadence. Draw pointer position/progress through a lightweight visual adapter from the newest authoritative controller snapshot at render cadence; do not rerender the entire menu or throttle accepted commands behind text updates. The pointer overlay uses viewport CSS coordinates, `pointer-events: none` and no independent hit-test logic. `ui/menuTargets.ts` owns current registered geometry; the shared action adapter revalidates targets before dispatch.
- `song:progress`, `combo:change`, tracking updates, and every terminal judgement (`note:hit`, `note:miss`, `note:badcut`, `obstacle:hit`, `obstacle:dodged`) → mirror updated authoritative aggregates into a pending patch and flush at most every 50 ms (`UI_TEXT_HZ` = 20) via a single `set`. Live accuracy uses resolved objects as its denominator; use `null` and show an em dash before the first resolved object. RESULTS uses final `SessionStats.accuracy` over the whole map, as defined in [07](07-hit-detection-and-scoring.md).
- `note:hit` / `note:miss` / `note:badcut` / `obstacle:dodged` → `pushPop` immediately (after projection); enforce one terminal pop/outcome per note ID. Bad-cut visual despawn is not a second miss.
- `session:end` → `results` immediately.

Keep component subscriptions narrow as the richer HUD is split into independent views. The current `Hud` selects the display-rate `hud` aggregate; it is not a measured per-field-render optimization. Lists use stable ids as keys. Projected multi-pop queues and their target `pushPop` API above remain planned rather than an existing event-rendering path.

Subscribe once per adapter lifetime and return an unsubscribe/dispose function; React development remounts must not double event handlers or score pops. Keep high-rate hand/charge geometry in the renderer; the DOM store uses display-rate summaries. Clear session-specific pending patches, generation tokens and pops on Quit/Retry; asynchronous results from a disposed session must not mutate the next screen. The renderer receives appearance preferences through a read-only adapter without UI writes to game state.

## Components

| Component | Responsibility |
| --- | --- |
| `App` | Chooses the screen by `DisplayState.state`; owns current status, pointer, credits and scoped diagnostics/export surfaces. |
| `screens/Boot` | Startup/error guidance and real retry; fine-grained weighted loading presentation remains target work. |
| `screens/Select` | Composes `MenuShell`, bounded local library, native upload, difficulty, preview, dataset trial/arrangement and camera-setup subflow. |
| `screens/Calibration` | Live readiness confirmation/Back and source-labelled pre-roll; the expanded wave/checklist visualization remains pending. |
| `screens/Hud` | Score/combo/accuracy, local `HandIndicator` ×2, recent judgement and elapsed/total progress. |
| `screens/Paused` | Source-aware guarded Resume/Songs and countdown around the labelled frozen pose. |
| `screens/Results` | Actual rank/counts/statistics, source-appropriate motion/proxy explanation and guarded Retry/Songs around a labelled saved moment. |
| `components/MenuShell` | Exports shared `MenuShell`, `Figure`, `RailPager`, `Button` and `StatusMessage`; owns stable rail/compact composition and secondary Settings pages. |
| `ui/menuTargets.ts` | Registers semantic targets, geometry, allowed surface/epoch, native-only and disabled guards for shared actions. |
| `strings.ts` | Shared player copy; the full catalogue above is a target, not proof that every proposed nested key exists. |
| `theme.css` | Tokens, fonts, panel/button base styles, reduced-motion rules. |

The earlier proposed standalone `Numeric`, `MultiplierRing`, `JudgementPops`, `WaveMeter`, `Tooltip`, `DebugOverlay` and world-to-screen pop helper are not current UI modules. Their behaviours remain acceptance/design work above; do not import phantom component paths or claim those details from the existing aggregate HUD.

## Acceptance criteria

These remain release requirements, not a declaration of passes. The dataset-first action priority deliberately defers criterion 2's original camera prominence. Dataset results do not satisfy live calibration/hand checks; the separate source exception is documented in [25](25-menu-and-hand-navigation.md#dataset-trial-exception).

1. Every machine state renders exactly one screen component; an unknown state shows a recoverable failure with Retry/Return to songs guidance and records the error. It never becomes a blank screen or fabricated success.
2. No visible raw `<video>` element exists. Before valid camera setup/calibration, SELECT browsing shows a labelled illustrative human placeholder and prominent Set Up Camera action; a labelled live setup preview is confined to setup. Valid setup replaces the placeholder with the live neon figure; saved/frozen figures are labelled accurately.
3. All UI text comes from `ui/strings.ts`; a grep for `>[A-Z]{3,}<` in `ui/**/*.tsx` finds no literal uppercase copy.
4. HUD numbers are ≥ 28 px at 1920×1080, use tabular numerals, and tween rather than jump.
5. The play area rectangle contains no DOM element other than judgement pops.
6. Judgement pops appear within one frame of the event at the projected impact position, within 8 px of the projected block centre in the debug overlay check.
7. Store text updates are flushed at ≤ 20 Hz (verified by counting `set` calls over 5 s in dev; ≤ 100 + pops).
8. Live Start is disabled until the selected map/audio and current camera/tracking/calibration readiness all pass; disabled native or hand activation does nothing. The visible reason identifies the unmet condition. Dataset start has its separate labelled readiness guard and cannot weaken the live guard.
9. Calibration ticks turn on only after `CALIB_PRESENCE_MS`; the coaching line shows the highest-priority string and updates within 200 ms of the condition changing.
10. SELECT, eligible CALIBRATION actions, PAUSED and RESULTS are operable by mouse alone, keyboard alone, and the selected hand after setup. Native permission/audio/file/text boundaries show the required real-input action. PLAYING never treats a Point/Beam gesture as a menu click.
11. RESULTS shows real `SessionStats`, a clearly labelled motion estimate, and the valid owned highlight if available; Enter retries and Esc returns to Select. Missing snapshots never hide real stats.
12. With `prefers-reduced-motion: reduce`, Calm disables decorative DOM and scene motion/flash paths; deterministic replay yields the same judgements and score as Standard.
13. Every interactive element has a visible focus ring and is reachable by Tab.
14. Fonts load from the local bundle offline after installation; failed font requests retain readable controls without layout-breaking shifts.
15. Invalid/oversized/empty audio, Cancel, repeated selection and late worker completion preserve the correct selection and leave no stuck loading state.
16. Keyboard shortcuts respect text entry; pause/retry/focus work at 200 % zoom; camera/audio/model failures each show a useful recovery action.
17. Ten start/pause/quit/retry cycles leave event subscriptions, pending async jobs and UI updates bounded; replay diagnostics visibly identify REPLAY.
18. The protected figure stage stays free of opaque/intercepting menu panels at the supported laptop viewport/zoom sizes. Side-rail pagination keeps every action reachable; no central overlay or hand-only drag is needed to choose a starter song or start/retry/return.
19. At least three attributed bundled starter tracks appear with real manifest metadata, support explicit preview/stop and can begin play without upload/network/companion after asset preparation. Missing assets produce an honest error and fail release acceptance.
20. A point transition activates the last armed open-palm target once. Held pointing, entering a new screen while pointing, jitter beyond the guard, target movement, stale/lost tracking and native-input handover never create a repeated or wrong-target click. Replay and live checks cover both chosen hands.
21. Camera-denied, no-camera and uncalibrated cases still open the usable music menu with a placeholder. Setup can run without any song/audio selected; Cancel/error preserves browsing. Only real tracking/valid calibration enables the corresponding live status and live Start guard.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
