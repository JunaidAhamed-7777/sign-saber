# Project submission

Complete this file during the hackathon and use it to prepare the submission through the method announced by the organisers.

## Project

- **Project name:** Sign Saber
- **Short description:** A controller-free, full-body 3D rhythm combat game in the browser. A webcam tracks the player's hands and body; they appear as a music-reactive neon silhouette and slash (open palm), smash (fist), laser (point-and-hold) and dodge (lean) through a beatmap generated on-device from any song. Who benefits: anyone with a laptop who wants a Beat Saber-style workout without a headset or controllers.
- **Code repository URL:** https://github.com/JunaidAhamed-7777/sign-saber
- **Final submitted implementation commit SHA:** TODO
- **Working demo URL or local demo steps:** TODO — see README §Run the project
- **Demo access requirements:** Chrome/Edge 120+, a webcam, camera permission. No accounts, no credentials. Optional YouTube feature needs the local companion service with `yt-dlp` + `ffmpeg`.

## Participants

Participate solo or in a team of up to 4. Remove unused rows.

| Participant name | GitHub handle | Contribution |
| --- | --- | --- |
| Junaid Ahamed | JunaidAhamed-7777 | TODO |
| TODO | TODO | TODO |

## Run and demonstrate

- **Prerequisites and versions:** Node 22 (≥ 20.19), Chrome/Edge 120+, webcam. Optional: `yt-dlp`, `ffmpeg`.
- **Install command:** `cd app && npm install && npm run models`
- **Required environment variable names:** none
- **Start command:** `cd app && npm run dev` → http://localhost:5173 (optional: `cd server && npm run server`)
- **Demo walkthrough:** TODO — follow docs/20-demo-and-judging.md §Demo script and record what was actually shown.
- **Checks performed and results:** TODO — `npm run check` output; manual QA checklist results from docs/17.
- **Known limitations or incomplete features:** TODO
- **Libraries, APIs, and public datasets used:** Three.js, postprocessing, MediaPipe Tasks Vision (hand + pose models), React, Zustand, Vite, yt-dlp (optional); CC0/CC-BY demo tracks listed in `app/public/assets/tracks/README.md`.
- **AI usage record:** [AI_USAGE.md](AI_USAGE.md)
- **Development change log:** [CHANGELOG.md](CHANGELOG.md)

## Submission checklist

- [ ] The project implementation started from scratch at the event.
- [ ] I participated solo or with no more than 4 team members in total.
- [ ] An AI coding assistant was used during development and its usage is documented.
- [ ] The code repository URL, short description, and working demo are provided.
- [ ] README setup and demo instructions match the submitted code.
- [ ] Actual checks and known limitations are documented.
- [ ] Meaningful changes are documented and committed throughout development.
- [ ] The final implementation is committed and pushed, and its SHA is recorded above.
- [ ] No credentials or private data are included in the repository or demo instructions.
- [ ] The organizers' announced submission method and timing have been followed.

Follow the organisers' announced submission method and deadline.
