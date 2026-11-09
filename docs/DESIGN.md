# Design language

## Direction

**Product.** A local-first personal AI environment for one person on one Windows machine.

**Character.** Precise, nocturnal, quietly warm. An instrument you sit down to, not a chatbot you
visit.

**World.** Night-time optical instruments and machined aluminium. Cold blue light through glass,
fine measurement marks, a workshop that stays open late. The richness lives in the dial and in the
typography; the chrome stays neutral so it can be used for hours.

**Moments.** The CAERA instrument on the welcome screen; the serif welcome line; the activity
timeline as a real instrument log.

**Signature.** A measurement language borrowed from the dial: 88 fine ticks, a one-pixel sweep arc,
and mono readouts with tabular figures. It appears on the instrument, the composer baseline and the
status captions — nowhere else.

## Palette

One tinted neutral ramp per theme, three text roles, one accent. Depth comes from surface steps and
hairlines; there are no coloured shadows, glows, gradient text or radial washes.

### Dark (default)

| Token | Value | Role |
| --- | --- | --- |
| `--c-void` | `#07080a` | Deepest recess |
| `--c-base` | `#0b0c0e` | Application ground |
| `--c-surface` | `#101316` | Panels |
| `--c-raised` | `#151a1e` | Inputs, active rows |
| `--c-elevated` | `#1a2025` | Hover, inline code |
| `--c-ink` | `#e7eef2` | Primary text |
| `--c-ink-2` | `#98a6b1` | Secondary text |
| `--c-ink-3` | `#6f7d89` | Meta, captions, icons |
| `--c-accent` | `#7ad3e8` | Ice blue: instrument, focus, active mark |
| `--c-secondary` | `#a99ae0` | Restrained violet: secondary activity |
| `--c-danger` | `#e1909c` | Errors |
| `--c-primary` | `#d8edf3` | Primary action surface |
| `--c-primary-ink` | `#06171b` | Text on the primary action |

### Light (designed separately)

Paper and ink rather than an inversion: a cool, slightly green-grey ground (`#f1f2ee`), white
surfaces, ink `#14191b`, and a deep teal accent (`#0a6c7c`) that carries enough contrast for text and
focus. The primary action inverts to near-black (`#12262b`) with light text. The instrument keeps its
tick language; the contour lines use teal rather than ice.

Hairlines are 8–18% ink. Borders are quiet. Shadows exist only on floating layers (modals, drawers,
toasts) and stay neutral.

## Typography

- **Instrument Sans** — interface and reading. Tight, technical, slightly narrow; carries 400/500
  weights and a variable axis.
- **Instrument Serif** — one display moment: the welcome line. Never used for body or labels.
- **Azeret Mono** — machine readouts, timestamps, keycaps, state captions, code. Tabular figures.

Fonts are bundled from `@fontsource` packages, not fetched from a CDN. A local-first app should run
without a network.

Scale: 9–10 mono meta, 11.5–12.5 secondary UI, 13–13.5 primary UI, 14 body, 15 section title, 40–46
welcome display. Line lengths stay under 72 characters for prose.

## Layout

A desktop application shell, full viewport height, three zones:

```
┌────────────┬──────────────────────────────────────┬──────────────┐
│ 268 / 68   │ 52px header                          │ 336 activity │
│ sidebar    │ conversation column, max 840         │ optional     │
│            │                                      │              │
│ history    │ messages                             │ live events  │
│ nav        │                                      │              │
│ status     │ composer, max 840                    │ stream state │
└────────────┴──────────────────────────────────────┴──────────────┘
```

The sidebar collapses to a 68px rail with icon-only navigation and recent conversation marks.
Below 1280px the activity panel becomes a drawer; below 1024px the sidebar does as well. The mobile
layout keeps the desktop proportions — a workspace that happens to be narrow, not a phone chatbot.

## Surfaces and radii

Controls 6–8px, inputs 8px, panels 10–12px, the composer a 12px shell with a 9px core (nested, with
a 1px gap and an inset highlight). Nothing is a pill except state chips and keycaps. No large
rounded cards.

## The instrument

An SVG dial at 240 units, drawn from four layers:

1. 88 fine ticks with every eighth mark brighter — a measurement scale, not a loading spinner.
2. A sweep arc whose length and rotation speed encode state.
3. Four closed contours built from two sine groups, with a slow drift. They read as interference
   or a topographic field rather than a glowing orb.
4. A lens core: a dashed inner ring, a hairline meridian and a single 2.2-unit dot.

Each state changes amplitude, lobe count, arc length, rotation speed, tone and readout:

| State | Tone | Behaviour | Source |
| --- | --- | --- | --- |
| Idle | ice | barely drifting contours | live, when online |
| Listening | ice | wider amplitude, fast arc, light scaled by input RMS | live while the microphone records |
| Transcribing | ice | slow breathing pulse | live while VoiceStudio transcription runs |
| Thinking | ice | tight fast sweep | live during a routed model request |
| Speaking | ice | widest contour, quick arc | live while VoiceStudio audio plays |
| Interrupted | ice | dimmed, desaturated field | live after a stopped turn or speech |
| Error | rose | contracted rings, short arc | live after a failed request |
| Offline | muted | almost still, dim scale | live when the node is down |

The field receives the microphone analyser's actual 0–1 RMS as a CSS custom property while
listening. The aura and frame react to that value; with silence, a denied permission or a missing
device the field stays quiet. No animation pretends that audio is present.

Motion is limited to rotation of the contour/arc groups (transform only), disabled by
`prefers-reduced-motion` and by the Appearance setting. The compact 24–30px variant drops the tick
ring and thickens strokes so it survives use in headers.

## Motion

One curve, `cubic-bezier(0.22, 0.61, 0.36, 1)`, at 120/180/320ms. Colour and surface changes are
fast; drawers and modals rise 4–12px. No looping decorative animation, no hover scaling on cards, no
shimmer. The dial is the only continuous motion, and it is state-driven.

## Copy

CAERA writes in complete, calm sentences and names the real state. It never says a feature works
when it does not. Buttons use verbs ("Connect a model", "Delete all"), and unavailable controls
explain what is missing and when it arrives. Errors say what failed and what to do, without
apologising.

## Accessibility

Visible keyboard focus on every interactive element; native `<select>` where a select is right;
`role="switch"`, `role="radiogroup"`, `role="dialog"` with focus trapping and restore; Escape closes
overlays; the composer supports Enter/Shift+Enter; status and activity messages are announced with
`aria-live`; the dial carries a textual label and never carries information that exists only in
colour.
