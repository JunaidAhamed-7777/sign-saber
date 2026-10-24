---
version: alpha
name: Sign Saber
description: A standing rhythm arena whose menu frames the player between reachable control rails.
colors:
  background: "#05060D"
  panel: "rgba(11, 15, 26, 0.72)"
  primary: "#19F5FF"
  smash: "#FF2BD6"
  beam: "#FFC32B"
  danger: "#FF1E3C"
  text: "#E8F1FF"
  muted: "#8A97B8"
typography:
  display:
    fontFamily: "Orbitron, system-ui, sans-serif"
  body:
    fontFamily: "Rajdhani, system-ui, sans-serif"
omitted:
  - section: rounded
    reason: Shape behavior is specified in docs/14-ui-ux.md; no independent radius scale is introduced.
  - section: spacing
    reason: Menu dimensions and gaps use the shared constants registry in docs/02-architecture.md.
  - section: components
    reason: Shared component behavior is maintained in docs/14-ui-ux.md and docs/25-menu-and-hand-navigation.md.
---

# Sign Saber Design Context

## Overview

**Status: implemented experimental interface with a dataset-first trial.** The shared rails, upper-body placeholder, local content and Blender arena are rendered; release-level human/accessibility/performance verification remains open. This file preserves the visual direction; [14 — UI/UX](docs/14-ui-ux.md) and [25 — Menu & Hand Navigation](docs/25-menu-and-hand-navigation.md) remain the behavioral equivalents of a UX contract.

The reference is a rhythm arena's control booth: the person is the live instrument, framed by quiet controls. The audience stands in front of a laptop and needs to see themselves, choose music and understand an action from normal playing distance. This is a product interface with a theatrical player reveal, rather than a marketing landing page or a dense dashboard. The initial language is English; no Japan-market or multilingual support is claimed.

The figure is upper body only: head, arms/hands and torso ending at the hips; never draw legs in the placeholder, live/setup view, pause or results. The memorable move is the clear central human stage: an illustrative placeholder with **Set up camera** before setup, a labelled positioning preview during setup, and the player's neon figure after calibration. Keep song cards and controls out of that space. The first core library has three full songs; palm movement and deliberate point-click are first-class menu input after bootstrap.

Avoid full-screen menu panels over the player, tiny floating controls, unrelated decorative chrome, hover autoplay and fake tracked figures. Familiar buttons and explicit feedback carry the utility; the player and music carry the expression.

**Token mapping:** this frontmatter preserves the existing palette/font roles from the UI spec and is their visual source going forward. During P0, map it once to the planned `app/src/ui/theme.css`: background→`--void`, panel→`--panel`, primary→`--cyan`, smash→`--magenta`, beam→`--gold`, danger→`--danger`, text→`--text`, muted→`--muted`. The CSS excerpt in [14](docs/14-ui-ux.md#colour-tokens) mirrors this source. Runtime CSS now maps these tokens in ui/theme.css. Font scales/motion/components stay in docs14; behavioral/menu geometry values stay in [02](docs/02-architecture.md#constants). Change their owners and adapters together when implementation exists.

## Colors

Preserve the deep blue-black void and legible pale text. Cyan marks primary interaction/open hands, magenta identifies Smash, gold identifies Point/Beam and red identifies danger. Pair all semantic colour with glyphs/text. Quiet, dark side panels can become more opaque for readable instructions. Reserve glow for the player/gesture response; never put a luminous frame around every control. Contrast over the brightest allowed scene remains a future measured check.

## Typography

Orbitron is restrained display type for identity, rank and short numeric emphasis. Rajdhani carries controls, metadata and coaching, with system fallbacks and reserved layout space if local fonts fail. Use the size/weight roles in [14](docs/14-ui-ux.md#typography), tabular numerals and readable action labels. Fonts and their license files must be locally packaged before offline claims.

## Layout

Use one shared menu shell: top status, left song rail, clear central figure stage, right action rail and bottom control legend. Minimum target size, separation and stage width come from the menu registry, not screen-local numbers. For smaller/zoomed windows, paginate controls and reflow rails above/below the figure rather than cover its torso or shrink the targets. This layout does not add mobile gameplay support.

The central placeholder is plainly illustrative; setup preview is labelled; live/frozen/saved figures identify the state they represent. Pause/results reuse the same frame and action placement. Only short positioning marks/countdown digits belong in the central stage. Browser-owned dialogs are an explicit native-input exception.

## Elevation & Depth

The 3D arena supplies depth. DOM panels use quiet tonal layers and structural borders. Reduced quality/Calm can remove blur and decorative glow. A menu pointer and its armed target remain readable without covering labels or moving a hit target. Actual modal surfaces must isolate their targets and restore focus; ordinary setup/side-help panels do not masquerade as modals.

## Shapes

Use broad rectangular targets and whole-card song selection with visibly distinct hover, focus, armed, pressed, selected, disabled and busy states. The human silhouette is the expressive shape. Keep familiar button silhouettes; do not add an independent radius system or require precision dragging.

## Components

The shared menu target registry and semantic action handler serve mouse, keyboard and hand input. Open palm steers; a deliberate point confirms once; hover never clicks. Preserve target geometry during progress/feedback, show disabled reasons persistently and let native input interrupt hand input safely.

Song cards and the selected-track header carry a generated cover: deterministic procedural art from the track's own metadata, tinted by its library role, with no external image or separate rights record. Hand hover/armed/confirming/latched phases are drawn on the targeted control itself (gold readiness bar) as well as the pointer, without moving it.

The **Set up camera** action is available before song selection. A failed setup keeps the menu usable. Preview/Stop are explicit actions; audio does not start from selecting/hovering. Browser permission, audio unlock and system pickers require native actions where the browser demands them. Point-click never pretends to grant browser trust.

Calm respects reduced motion across both DOM and scene, keeps the placeholder static and preserves required status/gesture cues. Copy is direct: name the next action and the actual failure. Cursor coordinates/confirmation progress are not continually announced to assistive technology; meaningful status changes are.

## Do's and Don'ts

- **Do:** make the human figure and the selected music the immediate visual story.
- **Do:** retain a complete mouse/keyboard path while making app-owned controls hand operable after setup.
- **Do:** keep provenance and readiness honest: placeholder, setup preview and live input are distinct.
- **Don't:** cover the person with the song picker, pause card or results table.
- **Don't:** add dwell clicks, hover autoplay, repeated held-point activation or gesture-only recovery.
- **Don't:** claim visual, accessibility or camera verification before the implementation is exercised.
