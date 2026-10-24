#!/usr/bin/env node
// Development diagnostic: gesture mix, density, on-screen load and synthetic-performer reachability
// of the installed bundled charts. Reads charts only; never writes assets.
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

register("./beatmap-typescript-loader.mjs", import.meta.url);
const { planPerformance } = await import("../app/src/performer/choreography.ts");
const { APPROACH_MS } = await import("../app/src/core/constants.ts");
const root = fileURLToPath(
  new URL("../app/public/assets/tracks/", import.meta.url),
);
for (const slug of ["pamgaea", "electro-cabello", "cipher"])
  for (const difficulty of ["easy", "normal", "hard"]) {
    const map = JSON.parse(
      await readFile(`${root}${slug}/${difficulty}.json`, "utf8"),
    );
    const count = (type) => map.notes.filter((n) => n.type === type).length;
    const within = (note, span) =>
      map.notes.filter((n) => n.t >= note.t && n.t < note.t + span).length;
    let visible = 0;
    for (const note of map.notes)
      visible = Math.max(visible, within(note, APPROACH_MS[difficulty]));
    const unplayable = planPerformance(map).unplayable.length;
    console.log(
      [
        slug.padEnd(16),
        difficulty.padEnd(6),
        `notes ${map.notes.length}`,
        `slash ${count("slash")} smash ${count("smash")} beam ${count("beam")}`,
        `walls ${map.obstacles.length}`,
        `nps ${((1000 * map.notes.length) / map.song.durationMs).toFixed(2)}`,
        `on-screen max ${visible}`,
        `unplayable ${unplayable} (${((100 * unplayable) / map.notes.length).toFixed(1)}%)`,
      ].join("  "),
    );
  }
