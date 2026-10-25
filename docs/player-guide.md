# Play Sign Saber

Sign Saber is an experimental desktop rhythm game: sweep through cyan blocks, crush magenta blocks, hold a point for beams and lean away from walls. Your figure stops at the hips. You can browse music and try the game without a camera.

Live gesture play is implemented, but a completed consenting-person calibration and a verified live scored hit are still open release checks. The no-camera trials below let you see the current game without implying that those checks have passed.

## Start the app

Use a current Node 22 release, the project's CI baseline. In a terminal at the repository root:

```powershell
cd app
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173) in current desktop Chrome or Edge with WebGL2 and hardware acceleration enabled. The menu needs no account, camera permission or model download. Keep the terminal open while playing.

For a prepared production build, run `npm run build`, then `npm run preview` from `app/` and open [127.0.0.1:4173](http://127.0.0.1:4173).

## First try, without a camera

1. Choose a song row in **Choose your music**. The eight-song local library has three difficulty charts per song. Wait for the chosen title, artist, duration and note count to appear in the action rail.
2. Choose **Easy**, **Normal** or **Hard**. Easy gives more approach time and fewer notes; Hard gives less approach time and denser patterns. The timing judgement windows stay the same.
3. Choose **Enable sound** with your mouse or keyboard. A hand gesture cannot unlock browser audio. **Preview** then lets you listen before starting; **Stop preview** stops it.
4. Choose **Watch auto-play** to watch the avatar perform planned motion and hit notes, or **Play level** to inspect the level with annotated still poses. These actions use synthetic or dataset input, as explained below.
5. After the pre-roll, the level plays to real results. **Play again** retries; **Songs** returns to music selection.

![The polished desktop music menu with geometric song sleeves, difficulty controls and Play level.](media/menu.png)

Desktop menu after choosing music and enabling sound (1440 × 900).

The library and action rails have **Previous / Next** pages. Selected music has a check and tinted row; the geometric sleeve is decoration, while the whole row selects the song. The action rail keeps **Play level** prominent, with **Preview**, **Set up camera** and **Watch auto-play** alongside it. Page forward for **Make 80-second cut**, **Sound & visuals**, camera options and credits. The centre stays clear of controls so the upper-body figure remains the focus. Play on a desktop laptop/monitor with a clear, comfortable space around you.

Mouse and keyboard remain available throughout: Tab moves focus, Enter/Space activates a focused button, and Esc or Space pauses during play. Choose **Resume** to continue or **Quit to music** to leave. Hiding the tab pauses play; returning does not resume it automatically.

### What the two trials show

**Watch auto-play** plans motion for the selected chart and sends synthetic landmarks through the real input and scoring path. The back-facing avatar follows that motion. Hits, combo and results come from that path. This synthetic-performer trial shows game logic and rendering; it uses no person, camera pixels or recognition model.

![The back-facing avatar during a synthetic-performer run, with score and hand feedback.](media/hero.gif)

Preserved real gameplay footage from **Watch auto-play**. It shows synthetic input; the current menu and results are pictured separately above and below.

**Play level** uses independent COCO upper-body still annotations. These poses have no recorded motion or hand-gesture labels, so missing gesture input produces genuine misses. It shows audio, level rendering and lifecycle behavior. Its score cannot measure a player's skill or tracking accuracy.

Neither trial establishes webcam accuracy, real-world latency, human comfort or musical chart quality. The motion proxy in results is also not a fitness or calorie measurement. Diagnostic exports retain the input source even though the current run screens use neutral labels. See the [dataset attribution](../app/public/assets/fixtures/ATTRIBUTION.txt) and [evidence rules](24-benchmark-and-evidence.md). A separate developer dataset-camera path feeds prepared images through inference; it is distinct from the menu's still-annotation trial and is not needed for these steps.

![Synthetic performer results with rank, score, judgement counts, Play again and Songs controls.](media/results.png)

Actual results from an 80-second arrangement using synthetic-performer input. The [media record](media/README.md) identifies the capture and run.

## The 80-second cut and your own audio

The first launch of either no-camera trial prepares an edited song and generates a fresh chart from its exact audio. Page to **Make 80-second cut** to prepare it separately: 10 seconds fading in, a 60-second highlight and 10 seconds fading out. The highlight uses an energy/onset heuristic; it is not verified chorus detection. Short supported files use proportionally shorter sections. The full source song remains in the library; select its song card again to reload it.

Page through the music rail to **Choose your own audio** to select a local MP3, WAV, OGG or M4A. Files must be 5 seconds to 5 minutes and no larger than 60 MiB; browser decoding and the decoded-memory limit can reject a file within those limits. Analysis runs locally. **Cancel analysis** leaves the menu usable. **Tempo unclear · mapped to onsets** means the chart follows detected onsets instead of claiming a confident beat grid.

## Optional camera setup

Prepare the local tracking files once while online, from `app/`:

```powershell
npm run models
```

If using production preview, rebuild after downloading them. Choose **Set up camera** on the main menu with mouse or keyboard and allow browser camera access. The same action is available under **Settings → Camera & live play**. No song needs to be selected first.

Frame your head, shoulders, hands and hips in a clear, comfortable space. Hold steady until the framing checklist is ready; setup confirms automatically after sustained readiness, or you can choose **Confirm camera & position**. Permission alone does not establish calibration. Choose music, enable sound and use **Play with camera** on the main menu or camera/live-play page. Hold steady again for the pre-play guide, or choose **Confirm ready** when ready. **Cancel** returns from camera setup; Esc cancels the pre-play guide/countdown and returns to music.

After tracking is ready, an open palm moves the menu pointer. Point deliberately to click once, then open your palm again before the next click. The permission dialog, sound enable and file picker still need mouse or keyboard.

## Moves and judgements

- **Moving hand → slash or smash.** Sweep through cyan slash blocks and strike magenta smash blocks as they reach the hit plane. Either hand shape can hit either block: the current forgiving contact rule needs movement of at least 0.3 m/s, not an open palm or fist classification. The judged contact zone is 2.5 times the visible block/palm footprint; blocks also approach more slowly than the original charts. Open-palm blade and fist feedback still show the intended moves, but there are no wrong-gesture Bad cuts for these contacts. A resting hand does not count as a hit.
- **Point and hold → beam.** Hold a confidently tracked point to charge (500 ms at the current default). A full charge automatically fires at the earliest available gold target. Charge resets after a shot.
- **Lean → dodge.** Lean right for a wall on the left, and left for a wall on the right. Keep your torso visible. There is no leg, jumping or ducking requirement in the current core game.

Timing uses the captured input sample, not the displayed frame. At the current `WINDOW_SCALE = 1`, the absolute early/late error is **Perfect: up to 60 ms**, **Great: over 60 through 120 ms**, and **Good: over 120 through 200 ms**. Slash/smash hits require contact inside those windows. Charged beams can fire outside the normal window and receive Good in the current mode. An unresolved note becomes **Miss** after its eligible window and bounded late-input allowance close. Difficulty changes chart density and approach time, not these windows. The current contact defaults are registered in [Architecture → Constants](02-architecture.md#constants), and the [scoring specification](07-hit-detection-and-scoring.md#6-judgement) explains timing and score.

The HUD shows score, combo, multiplier, accuracy, progress and each hand's gesture/beam charge. Missing hand data is labelled rather than replaced with pretend input. Results show judgement counts and best combo; accuracy is based on unmultiplied earned points, so it need not equal score divided by maximum score.

## Calm visuals and help

Page to **Settings → Sound & visuals** and toggle **Standard visuals** to **Calm visuals** for quieter visual effects. Calm reduces decorative motion and reactive intensity while retaining required cues and the same game rules. Your system's reduced-motion preference enables it and cannot be overridden by switching to Standard. Calm is not a claim that flashing, contrast or comfort acceptance has been completed.

For missing sound, unavailable tracks, camera errors or low frame rate, see [Troubleshooting](troubleshooting.md). Stop if movement hurts, and keep the space around you clear.

The menu is a real production capture of the refined interface; its source hashes, native actions and browser checks are in the [frontend receipt](evidence/2026-10-25-frontend-polish.json). The results capture is documented in the [media record](media/README.md). The gameplay still retains its original [capture record](evidence/2026-10-25-guide-capture-30572bb.json). These are actual app captures, with synthetic input where labelled; they are not live-camera, audible-sync, accessibility or GPU-performance evidence.
