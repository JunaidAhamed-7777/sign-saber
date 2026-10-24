# Troubleshooting

Use current desktop Chrome or Edge on the locally served app. WebGL2 and hardware acceleration are required. The instructions below follow the current messages in [UI copy](../app/src/ui/strings.ts), [camera handling](../app/src/tracking/camera.ts) and [webcam acquisition](../app/src/tracking/cameraSource.ts); a supported browser target does not mean every camera/hardware combination has passed release QA.

## The app will not open

Start the server from `app/` with `npm run dev` and use [localhost:5173](http://localhost:5173), or run `npm run build` then `npm run preview` and use [127.0.0.1:4173](http://127.0.0.1:4173). Keep the terminal running. Do not open `index.html` directly from disk.

**“The arena could not start”** is the startup heading. Its hint is **“Open Chrome or Edge with WebGL2 and hardware acceleration enabled.”** Enable acceleration in browser settings, restart the browser and retry. Keep any detailed error for a bug report; a failed renderer is not a successful game boot.

## Camera access

Camera setup is in the menu's **Settings → Camera & live play** page. Camera failure does not prevent native-input song browsing or the no-camera trials.

- **“Camera permission was denied. Allow the camera in browser site settings, then retry. Music browsing still works.”** Allow camera access for this exact local origin, then use **Set up camera** again. The development and preview origins have separate permissions.
- **“No camera found. Connect a webcam and retry. Music browsing still works.”** Reconnect or enable your webcam, then retry setup.
- **“The camera is busy. Close other apps using it, then retry.”** Close video-call, recording or other browser sessions using the device, then retry.
- **“Camera needs a secure browser context. Open the locally served app in current Chrome or Edge.”** Use the local HTTP address above; an arbitrary insecure network address or a disk file is not the documented camera setup.
- **“Camera disconnected or permission was revoked. Set up camera again.”** Return to music, reconnect the device or restore permission, and calibrate again. Old calibration cannot substitute for the changed device.
- **“Camera framing changed. Set up camera again.”** Repeat setup after changing device resolution/framing.
- **“The camera is not delivering video frames. Reconnect it or retry camera setup.”** Reconnect the camera and retry. **“Tracking stopped producing frames. Retry camera setup.”** also requires setup again; preserve the detailed diagnostics if it repeats.

The generic setup message is **“Camera setup failed. You can still browse songs and retry setup.”** Some failures expose a more specific browser/worker error alongside it. Cancel leaves music browsing available; it does not fabricate a live figure.

## Missing tracking models or calibration

**“Prepare the local tracking assets, then retry setup.”** means the camera path cannot use its local assets. The worker can also report **“Tracking models could not load. The host may need to prepare the local camera assets; retry camera setup.”** From `app/`, while online, run:

```powershell
npm run models
```

For production preview, run `npm run build` again before restarting `npm run preview`; preview serves the prepared `dist/`, not new files in `public/`. Keep the downloaded files local rather than replacing them with arbitrary model versions. The [model preparation instructions](../README.md#optional-camera-path) describe the expected path.

**“Keep your shoulders and both hands in the guide until framing is ready.”** and **“Hold still with shoulders and both hands visible.”** mean calibration is not ready. Keep the head, shoulders, hands and hips visible and use **Confirm camera & position** only after readiness. A permission grant or visible preview is not completed calibration. **“Set up and calibrate the camera before starting.”** requires that same setup route; use a labelled no-camera trial if you only want to inspect the game.

## No sound or interrupted audio

**“Use Enable sound with your mouse or keyboard first.”** and **“Enable sound with the mouse or keyboard before starting.”** require a deliberate native button action. Hand navigation cannot grant browser audio permission. Choose **Enable sound**, then **Preview** or start the trial. Check the menu's volume control, tab/site mute, system output device and speaker/headphone volume.

**“Sound stopped. Enable sound before trying again.”** requires sound enable again. During a paused run, **“Audio output is unavailable. Reconnect the audio device and retry Resume.”** means restore the output device before choosing **Resume**. If you see **“Sound could not pause safely. Choose Songs to restart the track.”**, use **Songs** and start a fresh run.

Hiding the tab deliberately pauses play: **“Paused while the tab was hidden.”** Return and choose **Resume**. A hidden tab during the start countdown cancels that attempt; start again from the menu. If the app says **“Framing or sound changed. Restore the guide, then confirm again.”**, restore readiness before confirming.

## A song will not load

**“The local music library could not load. Retry, or choose your own audio.”** means the catalog failed. Use **Retry**. A selected card marked **“Could not load”** shows **“This track could not load.”** and its specific error; use **Retry track**, or choose another song.

For bundled music, restore the committed manifest/audio/chart files together and rebuild production preview. Do not hand-edit hash-pinned JSON to silence a mismatch. **“Packaged audio duration does not match its chart. Retry or choose another track.”** means the audio/chart pair failed validation. For a generated cut, **“The new chart does not match the edited audio. Choose the original track and retry.”** gives the recovery route: select the original card, then prepare the cut again.

For local uploads, check the file is 5 seconds to 5 minutes and at most 60 MiB. Browser format support and decoded-memory limits also apply. **“This browser could not decode that audio. Try MP3 or WAV.”** suggests converting to one of those formats. **“Cancel analysis”** cancels work without replacing your selection with a fake chart. **“Tempo unclear · mapped to onsets”** is an honest fallback label, not a load error.

## Slow or distracting visuals

In **Settings → Sound & visuals**, toggle **Standard visuals** to **Calm visuals**, close competing GPU/video tasks and reduce the browser window size. To request a fixed cosmetic tier, open [low](http://localhost:5173/?tier=low), [medium](http://localhost:5173/?tier=medium) or [high](http://localhost:5173/?tier=high); use the same query on your preview origin if applicable. Medium is the default. `?contrast=1` enables the implemented mask contrast setting for the camera figure.

Tiers change drawing scale and cosmetic budgets, not scoring or audio time. HDR bloom and tier antialiasing now run when renderable half-float targets are available; unsupported contexts use the direct rendering path. Automatic tier selection and the complete hand-trail/particle system remain unimplemented. Selecting High does not enable missing features or prove a frame-rate target. Calm follows the system's reduced-motion preference, so **“Calm visuals follow your system reduced-motion preference.”** explains why Standard cannot override it.

## Report a repeatable problem

Record the commit SHA (`git rev-parse HEAD`), browser/OS, local address and query flags, selected song/difficulty, exact message, input source (live camera, dataset or synthetic performer) and shortest steps to reproduce. Include whether a reload, **Songs** or setup retry recovers it. The **Credits & diagnostics** page can expose diagnostic export when stats are enabled with `?stats=1`; its message is **“Callback / CPU samples only. GPU timing and live verification unavailable.”** Do not describe those samples as physical latency or live recognition proof. Do not attach unconsented webcam footage, credentials or private audio.

For the complete first-run flow, see the [Player guide](player-guide.md). Contributor checks and evidence rules are in the [Contributor guide](contributor-guide.md).
