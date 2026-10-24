# 25 — Menu, Hand Navigation & Camera Setup

**Current user scope (2026-10-25):** retain and show only the head, arms/hands and torso through the hips. Legs are excluded from live/setup/frozen/results figures, the placeholder, replay exports and game input. The upstream pretrained pose task may internally infer a full pose; indices 25–32 are zeroed at the application boundary. Only actual visible head/hips/shoulders plus hand readiness can establish calibration. No new training result is implied by filtering outputs.


**[CORE] contract with an implemented experimental menu.** Three bundled songs, the labelled upper-body figure stage, shared native/hand action registry, open-palm → point controller and paged rails are implemented. Pure/replay assertions exercise menu guards; this does not establish successful live hand navigation or release acceptance. An open palm moves a cursor; changing to a pointing finger clicks the chosen control. Merely waiting over a button never clicks it.

**Current execution steering — 2026-10-25:** **Try level with dataset** is the primary ready-music action; camera setup and live Start are secondary Settings pages. This is a deliberate dataset-first implementation order, not a claim that the original prominent first-launch **Set up camera** requirement has passed. The live setup/hand algorithms below remain the required contract. The separately labelled [dataset exception](#dataset-trial-exception) never establishes camera/calibration readiness.

This document owns the menu input contract and camera-onboarding behavior. [14](14-ui-ux.md) owns screen composition, shared visual tokens and copy; [04](04-state-machine.md) owns lifecycle guards; [09](09-beatmap-format.md) and the [track registry](../app/public/assets/tracks/README.md) own the bundled music. [02](02-architecture.md#constants) owns the named defaults.

## Figure-first layout

The player is the centrepiece. On the supported laptop layout, reserve a clear central stage at least `MENU_STAGE_MIN_FRACTION` of viewport width. Place the track library in the left rail, selection/difficulty/setup/Start in the right rail, compact status at the top and a short control legend at the bottom. Frame the figure within the central stage; do not lay a library grid, upload panel, pause card or results table over its face and torso.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ SIGN SABER                 Camera status          Mouse / hand mode │
│ ┌─ SONGS ──────────┐                               ┌─ READY ───────┐ │
│ │ Starter track 1  │      CENTRAL PERSON STAGE      │ Selected song │ │
│ │ Starter track 2  │                               │ Easy Normal   │ │
│ │ Starter track 3  │      placeholder before        │ Preview/Stop  │ │
│ │ Previous / Next  │      setup; your neon          │ Set up camera │ │
│ └──────────────────┘      figure after setup        │ Start         │ │
│                                                    └───────────────┘ │
│                 Move an open palm. Point to click.                  │
└─────────────────────────────────────────────────────────────────────┘
```

The drawing is the live-onboarding reference composition, not a screenshot of the current dataset-first action priority. It names roles, not fake tracks or telemetry. Real titles/credits come from the installed manifest. The three-song starter pack appears immediately on a prepared build; users do not need an upload, URL, account or network to choose their first level. **Live Start** requires valid camera/calibration and audio readiness. The separately named dataset action has the source-specific guards below.

All gesture targets have at least `MENU_TARGET_MIN_PX` width and height and `MENU_TARGET_GAP_PX` separation, measured in CSS pixels. Use whole cards as track buttons, discrete difficulty/volume controls, and explicit Previous/Next controls for larger libraries. Hover can highlight or reveal persistent help; it never selects a song, starts a preview or changes difficulty. Preview and Stop are deliberate actions. Do not require a drag, tiny slider thumb or hover-only submenu for the bundled-song path.

When side rails cannot fit, use stable pages of controls above/below the central stage, with persistent Next/Back navigation. Preserve the figure's central horizontal position and a clear torso region. Keep focused controls visible under zoom; do not reduce targets below the minimum to fit more controls. Test 1280×720, 1920×1080, 16:10 and 200% zoom; record actual hand reach and layout limitations. A narrow-window check does not add mobile support.

CALIBRATION keeps coaching/actions beside the figure, positioning marks in the stage and countdown digits in the status strip. Restore gameplay projection before armed pre-roll; menu fitting never changes a scored input coordinate. PAUSED keeps Resume/Quit beside the frozen figure. RESULTS keeps statistics and Retry/Songs beside the central actual saved 2.5D highlight, or a clearly labelled static placeholder when no valid snapshot exists. Native browser dialogs are outside this app layout contract.

## Dataset trial exception

The current **Try level with dataset** action requires a validated selected map, decoded audio, a running user-enabled audio context and a usable renderer; it does not request camera permission, tracking models or body calibration. On its first start it prepares the 80-second arrangement and regenerates the chart from the edited WAV; **Make 80-second cut** exposes the same preparation separately. Changing selection or cancelling invalidates stale work. The full source songs remain in the library. See the [music registry](../app/public/assets/tracks/README.md#dynamic-arrangements) for the heuristic, short-file fallback and provenance.

The local fixture contains eight independent attributed COCO still annotations. Show the **DATASET TRIAL** banner and source labels, never a live-camera label. It is not a temporal recording or model inference. The adapter supplies no finger/gesture, mask or metric-depth evidence; the hand HUD stays unavailable and missing gesture input produces genuine misses. Synthetic success, interpolated gesture ground truth and invented calibrated-player measurements are prohibited. An actual saved dataset moment is labelled as such.

Dataset Pause/Resume and Retry retain the audio/lifecycle/async guards while bypassing unavailable live-hand/calibration checks only for the active dataset session. Returning to Songs clears that trial source. Live Start, live Resume and live Retry still require their actual matching calibration and fresh required inputs. Dataset input cannot arm the hand pointer or set `CameraSetupState.ready`. The [recorded browser trial](evidence/2026-10-25-dataset-trial.md) is scoped level/audio/results evidence, not live navigation, recognition or latency evidence.

## Camera setup and placeholder

### Before setup

BOOT reaches SELECT when the shell, renderer and bundled catalog are usable. Camera permission, model download/initialization and a successful tracking sample are **not** prerequisites for browsing. Show a stylized, clearly illustrative placeholder person in the central stage whenever the current camera/body calibration is absent or invalid. Use a static outline in Calm mode; optional decoration must not imply live motion, sensor readiness or a tracked person.

The original live-onboarding requirement is to show the literal action **Set up camera** prominently, with “Set up your camera to see yourself and use hand controls.” The implemented secondary Settings action is available without selecting a song, but does not satisfy that original prominence acceptance. Mouse and keyboard can browse tracks, choose a difficulty and explicitly preview music if audio has been enabled. Live Start explains its missing requirements; it cannot bypass setup. The dataset action is the explicit exception above, not a calibrated-camera shortcut.

The placeholder is a local visual asset or procedural outline. It supplies no `TrackingFrame`, mask, `BodyState`, score input or tracking-rate sample. Never show `TRACKING OK`, “calibrated,” a camera-rate number or a successful benchmark because the placeholder is animating.

### Setup subflow

Keep the existing top-level states. Camera setup is a SELECT subflow, with `camera:setup`, `camera:ready`, `camera:error` and `camera:cancel` handled as guarded SELECT self-transitions. It can run with no selected song, decoded audio or BPM.

1. The first setup uses a real button/key action, explains local camera processing and requests permission. Once tracking already exists, a guarded hand action may reopen app-owned setup/calibration controls; it cannot operate a browser permission prompt. Load/initialize tracking assets with honest setup progress; do not hold the initial menu behind them.
2. Check the actual device/crop, model/delegate and live input. The central stage may now show an explicitly labelled **Camera setup preview** with a guide outline, so the person can position themselves before calibration is complete. This preview exception never implies the browse menu is already calibrated.
3. Confirm mirror/hand identity, visible required joints and comfortable body/reach calibration. The menu's 2D hand-reach rectangle is independent of gameplay `BodyCalibration`; measure a comfortable rectangle here when possible. Never demand unsafe extension just to reach a corner button.
4. Store calibration with the camera/crop/player/mapping identity and return to browse. Replace the placeholder with the current live neon figure only while this calibration remains valid. Preplay CALIBRATION still rechecks presence and confirmation before its countdown.
5. Denial, busy/unavailable camera, model failure or cancelled setup leaves a usable mouse/keyboard menu and the placeholder with actionable guidance. Do not fabricate a live figure or silently substitute prerecorded input.

Track `CameraSetupState` separately from the game state:

```ts
interface CameraSetupState {
  state: 'not-set-up' | 'setting-up' | 'ready' | 'error';
  mode: 'browse' | 'camera-setup';
  calibrationValid: boolean;
  error: string | null; // useful sanitized recovery text
}
```

`ready` means the current camera and matching body calibration succeeded, not merely that permission was granted. In SELECT, revocation/device/crop changes invalidate calibration and restore the placeholder/Set up camera path. A brief occlusion hides the live figure and hand pointer rather than drawing stale input; retain the calibration only if its identity remains valid, and explain the framing problem. During PLAYING follow [04](04-state-machine.md)'s safe pause/recovery path. Explicit camera disable stops capture. A missing/invalid tracked pose is never replaced with a decorative pose in the live input stream.

## Hand pointer contract

### Scope and coordinates

Use hand navigation for app-owned controls in SELECT, the setup subflow, CALIBRATION, PAUSED and RESULTS. Disable it in BOOT before tracking exists and in PLAYING. During armed start/resume countdowns, only the persistent Back/Cancel action is allowlisted; every other target is excluded. Entering that subphase changes the surface epoch and requires fresh open-palm arming, so the held Start/Resume point cannot cancel immediately. Pointing during PLAYING remains beam input and cannot click a hidden menu.

`gestures/menuPointer.ts` consumes fresh filtered mirrored-image hand data and the existing Open/Point classifier. It does not require play-plane `HandCursor.pos`, `BodyCalibration`, a camera raycast or the rendered figure's transform. This permits setup controls to work once trustworthy hand tracking is available, before gameplay calibration is finished. It runs on capture/performance time, so a suspended audio clock cannot freeze Pause-menu controls.

Use the centroid of wrist and four MCP joints (landmark indices 0/5/9/13/17) as the palm anchor in every relevant pose. Mirror exactly once in the tracking pipeline. Given a valid independent 2D menu reach rectangle:

```text
u = clamp((palm.x − reach.left) / (reach.right − reach.left), 0, 1)
v = clamp((palm.y − reach.top)  / (reach.bottom − reach.top), 0, 1)
xCss = viewport.left + u · viewport.width
yCss = viewport.top  + v · viewport.height
```

The default `MENU_REACH_BOUNDS` is an initial central-camera rectangle, not a measured universal reach. Personalize it during setup without altering game scoring/difficulty. Reject non-finite/zero-area bounds. Positions use viewport **CSS pixels**, not drawing-buffer pixels; account for visual viewport/zoom consistently with registered DOM rectangles. The visible figure may be fitted to the central stage while the separate menu cursor covers the whole viewport. Camera shake, lane FOV and DPR cannot move menu hit targets.

Choose the controlling logical hand explicitly in setup (right by default, left available through mouse/key controls). Track its identity using [05](05-tracking-pipeline.md). Do not switch hands because the other one points or briefly has higher confidence. A hand-choice change cancels pending input and requires fresh open-palm rearming.

### Open to move, point to click

Use current classifier confidence and `MENU_GESTURE_CONFIDENCE_MIN`; a held display gesture with uncertain current evidence cannot click. Consume each accepted sample once, and reject stale input older than `MENU_TRACK_MAX_AGE_MS`.

1. **Hover:** a confident open palm moves the cursor. Hit-test the topmost enabled, app-owned target in the current surface. A blocked/native-only target shows its reason and cannot arm.
2. **Arm:** retain the same enabled target under an open palm for `MENU_OPEN_ARM_MS`. Show a short readiness ring and “Point to click.” This interval prepares the target; it does not activate it. Moving to another target restarts arming.
3. **Confirm:** freeze the last armed open-palm cursor/target anchor while the fingers change shape. A fresh, present hand may pass through an ambiguous non-point pose for up to `MENU_TRANSITION_GRACE_MS`, without moving beyond `MENU_POINT_MAX_MOVE_PX`; this preserves the candidate, never clicks it. Once a confident stable Point is accepted, confirm it for `MENU_POINT_CONFIRM_MS` using new capture samples. Do not jump to the extended fingertip. Cancel on transition timeout, excessive motion, stale/lost hand evidence, uncertainty during point confirmation, target movement/disable or a screen/layout epoch change.
4. **Activate once:** revalidate the target/epochs, dispatch its semantic app action once and enter `latched`. Provide one visual acknowledgement and optional existing UI SFX. Observe `MENU_CLICK_COOLDOWN_MS`.
5. **Rearm:** a held point never repeats. Require a fresh confident open-palm interval over a target after cooldown. A point already held on entry to another screen cannot activate that screen.

No target, no fresh samples or an uncertain hand means no activation. Two hands cannot issue competing clicks. Gesture click does not charge/fire a beam, spend score or mutate game state directly.

Expose the following reusable display summary; values retained by UI are copied, not pooled-object references:

```ts
interface MenuPointerState {
  hand: 'left' | 'right';
  visible: boolean;
  xCss: number;
  yCss: number;
  phase: 'unavailable' | 'idle' | 'hover' | 'armed' | 'confirming' | 'latched';
  targetId: string | null;
  progress: number; // 0..1 for the current arming/confirmation phase
}

interface MenuActivation {
  targetId: string;
  screenEpoch: number;
  layoutEpoch: number;
  hand: 'left' | 'right';
  tCapture: number;
}
```

Export these types once through the shared contract module; [02](02-architecture.md) indexes the contract. They are separate from scored game events. `MenuActivation` is an input request, not proof an action succeeded.

### Shared controls and cancellation

`ui/menuTargets.ts` registers actual semantic buttons/links and their target IDs, allowed states, CSS bounds, disabled/busy state and `nativeOnly` flag. Update geometry on layout/scroll/resize/zoom changes; reuse bounded snapshots rather than forcing DOM layout for every hand landmark. Unregister removed controls. Non-modal surfaces cannot click through a modal; hidden/offscreen/disabled targets are excluded.

Mouse click, keyboard activation and `MenuActivation` resolve through the same app command handler and state-machine guards. Use target IDs, not label-text selectors. Do not fake browser trust by dispatching synthetic `MouseEvent`s or calling `.click()` indiscriminately. Native input remains available even if tracking is lost.

Real pointer-down, wheel/scroll interaction or keyboard use cancels pending hand activation and gives native input priority for `MENU_HANDOVER_COOLDOWN_MS`. Return to hand control only after new open-palm rearming; do not transfer a partially completed click. Never move OS mouse position or repeatedly steal keyboard focus on hand hover. If focus moves after activation, use the same destination rule as the mouse/keyboard action.

Cancel/clear pending activation on tracking loss, camera disable, hand-identity change, setup cancellation, state/countdown change, window blur, hidden tab, target/layout mutation, navigation or native-input takeover. After any cancellation, an already-pointing hand remains disarmed until opened. Show tracking/setup guidance without silently clicking a fallback target.

## Browser-owned actions

Gesture recognition is application input; it does not create a trusted browser user activation. Some APIs require real activation, and script-dispatched events are not interchangeable with hardware input. See [user activation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/User_activation), [event trust](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted) and [file picker activation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/showPicker).

- Initial camera consent/device permissions and the first audio enable use real mouse/keyboard actions. Never open the camera before an explicit setup action or imply a camera can be controlled before it is enabled.
- App-owned track selection, difficulty, preview/stop (after audio unlock), Start, Back, calibration confirmation, Resume, Quit, Retry and Songs support hand input when their guards pass.
- File pickers, browser permission/device dialogs, fullscreen or other activation-gated actions remain native. Label them “Use mouse or keyboard”; a hand request may show instructions/focus the app control, but must not claim the OS dialog opened or was completed.
- Typing a URL/text, selecting an OS audio device and interacting outside the app use native input. The bundled-song path requires none of these after initial setup.
- If audio becomes blocked again, show a real Enable audio action and keep Start/resume guarded. Do not report a failed `resume()` as success because a hand click was recognized.

## Build order and acceptance

- **P0:** define pointer/setup types/constants, command/epoch guards, illustrative placeholder and non-blocking SELECT shell. Add pure replay cases before DOM integration.
- **P1:** mouse/keyboard choose the first starter song/excerpt; camera setup works without a song; implement Open → Point menu selection through a real target registry and complete the first playable session. Keep placeholder/live/setup-preview identities explicit.
- **P2:** three full bundled tracks, all difficulty maps, complete native/hand menu coverage, camera recovery, setup cancellation, no-repeat click and native takeover all work. Hand navigation is not `[STRETCH]`.
- **P3/P4:** test standing-distance readability, full menu reach, Calm/zoom layouts, gesture errors and added UI/input CPU cost on the integrated workload. Required measurements follow [24](24-benchmark-and-evidence.md).

Required checks include:

These are release acceptance checks, not implementation-status checkmarks. In particular, camera setup being reachable in Settings and a successful dataset trial do not pass the original first-launch prominence or live-play checks. Current scoped evidence/status is in [README](../README.md) and the [roadmap](../ROADMAP.md).

- [ ] First load with no camera permission reaches the music menu with a placeholder and **Set up camera**; it never shows fabricated tracking success. No calibration is needed to browse.
- [ ] Setup succeeds/cancels/fails independently of song choice; the live figure replaces the browse placeholder only after matching calibration succeeds. Reconfigure/revoke restores the correct state.
- [ ] A user selects a song/difficulty, starts, resumes and retries by mouse/key and by open-palm/point actions after setup. Outcomes and guards agree.
- [ ] Long hover activates nothing; pointing without prior open-palm arming activates nothing; one held point produces at most one action; tracking reacquisition/screen change cannot click through.
- [ ] Point extension does not jump the target. A short fresh transitional `none` pose can reach a confirmed Point within its grace period; a prolonged/uncertain transition cannot click. Stale samples, target motion, disabled controls, two hands, viewport changes and native takeover cancel safely.
- [ ] Identical menu fixtures at varied render cadences produce identical activation requests. Tests cover boundaries of every named arm/confirm/cooldown interval.
- [ ] Central figure space remains clear in every menu/setup/pause/results layout, with all core controls reachable and no hover-only help.
- [ ] A prepared offline build exposes all three songs and can complete one without upload/network; credits and track identity match the actual installed assets.
- [ ] Browser-owned actions request native input honestly; no synthetic event is represented as permission/audio/picker success.
- [ ] Dataset start/resume/retry remains clearly source-labelled, requires actual ready audio/chart data, never fabricates hand input and cannot weaken the separate live Start/calibration guards.
