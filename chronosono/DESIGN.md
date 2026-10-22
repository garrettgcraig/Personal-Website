---
name: ChronoSono
description: A music timeline party game for phones, set as a jukebox title rack.
colors:
  ground: "#121110"
  ground-2: "#1c1a17"
  rule: "#3b3732"
  rule-strong: "#5c564d"
  paper: "#f4efe3"
  muted: "#b8b0a1"
  paper-ink: "#1a1714"
  paper-muted: "#574f45"
  red: "#c8202f"
  red-down: "#a51a26"
  mustard: "#f2b21b"
  good: "#5fcf94"
  good-field: "#17765c"
  bad: "#ff7466"
  d1950: "#c8202f"
  d1960: "#1f4fa8"
  d1970: "#d0671c"
  d1980: "#b8366c"
  d1990: "#1c8c6e"
  d2000: "#5a3f94"
  d2010: "#d9a21c"
  d2020: "#2a7fae"
typography:
  display:
    fontFamily: "League Gothic, Barlow Condensed, sans-serif"
    fontSize: "clamp(4rem, 21vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.88
    letterSpacing: "0.01em"
  headline:
    fontFamily: "League Gothic, Barlow Condensed, sans-serif"
    fontSize: "clamp(2.8rem, 13vw, 4rem)"
    fontWeight: 400
    lineHeight: 0.92
    letterSpacing: "0.01em"
  key:
    fontFamily: "League Gothic, Barlow Condensed, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "\"tnum\""
  title:
    fontFamily: "Barlow Condensed, Barlow, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.04em"
  strip-title:
    fontFamily: "Barlow Condensed, Barlow, sans-serif"
    fontSize: "1.12rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.01em"
  label:
    fontFamily: "Barlow Condensed, Barlow, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.04em"
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: "0px"
  control: "2px"
spacing:
  hair: "4px"
  xs: "6px"
  sm: "10px"
  md: "12px"
  lg: "18px"
  gutter: "20px"
  xl: "22px"
  xxl: "28px"
components:
  button:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0.5em 1.1em"
    height: "48px"
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0.5em 1.1em"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.red-down}"
  button-primary-disabled:
    backgroundColor: "{colors.ground-2}"
    textColor: "{colors.rule-strong}"
  button-big:
    padding: "0.5em 1.6em"
    height: "60px"
  button-small:
    padding: "0.3em 0.85em"
    height: "40px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0.35em 0.85em"
    height: "42px"
  chip-on:
    backgroundColor: "{colors.mustard}"
    textColor: "{colors.paper-ink}"
  input:
    backgroundColor: "{colors.ground-2}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5em 0.75em"
    height: "52px"
  code-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.none}"
    padding: "0.15em 0.5em"
    height: "64px"
  strip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    typography: "{typography.strip-title}"
    rounded: "{rounded.none}"
    padding: "8px 14px 9px 12px"
    height: "66px"
  strip-big:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.none}"
    padding: "14px 18px 18px"
  strip-mystery:
    backgroundColor: "{colors.ground-2}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
  slot-live:
    backgroundColor: "{colors.ground-2}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "50px"
  slot-live-hover:
    backgroundColor: "{colors.mustard}"
    textColor: "{colors.paper-ink}"
  score-on:
    backgroundColor: "{colors.mustard}"
    textColor: "{colors.paper-ink}"
    padding: "10px 12px"
  banner-warn:
    backgroundColor: "{colors.mustard}"
    textColor: "{colors.paper-ink}"
    padding: "10px 14px"
  banner-safe:
    backgroundColor: "{colors.good-field}"
    textColor: "{colors.paper}"
    padding: "10px 14px"
  toast:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    padding: "12px 16px"
---

# Design System: ChronoSono

## Overview

**Creative North Star: "The Jukebox Title Rack"**

Every song in ChronoSono is a printed paper title strip: cream stock, a flat band of ink across the top that names its decade, and the year set large in a condensed gothic as the selection key. A team's timeline is a rack of these strips stacked on black lacquer. The hidden song is the one strip still face down, a dark dashed blank with a mustard band and a question mark, and the reveal turns it over like a page in the rack.

The system is built for a dim living room and an arm's-length read. Contrast is high, type is tall and condensed, tap targets start at 40px and the important ones are 48px to 60px. Chrome is quiet: white-on-black labels, one-pixel rules between sections, lists that read as ruled ledgers rather than stacked cards. Color lives on paper (the decade bands) and in two signals: red for the brand and the main action, mustard for "this one, now."

Two things move: the logo on the home screen and the reveal flip. Everything else changes state in 120ms or less, and reduced motion stops all of it.

**Key Characteristics:**
- Black lacquer ground, cream paper strips, ink type on paper.
- One flat colored top band per decade, eight decades, never a gradient.
- League Gothic for years, codes, counts, and short commands; Barlow Condensed uppercase for labels; Barlow for sentences.
- Square surfaces; a 2px corner only on tappable controls.
- Depth by tone (ground, raised ground, paper), separated by one-pixel rules.
- A morphing logo: a clock running backward carried through record, cassette, CD, iPod, and app tile.

## Colors

A warm black and cream paper palette with two signal colors and eight printed decade inks that appear only as bands.

### Primary
- **Jukebox Red** (red): the brand color. Fills the primary button, the DJ phone's tap target, and the logo body; it is the top band on the room code (input and lobby display) and on the toast. Pressed and hover state darkens to **Red Down** (red-down). White text on it holds 5.7:1.

### Secondary
- **Selector Mustard** (mustard): means "selected, current, or focused." The focus ring, the selected chip and game mode, the active team's score cell, the warn banner, the resume bar, hover on a live slot, the challenge countdown, the band on the mystery strip, the outline on a newly kept strip, the year-range window, and the text caret. It is never a decoration.

### Tertiary
- **Decade Inks** (d1950 through d2020): eight flat printed inks, one per decade in the catalog. 1950s red, 1960s blue, 1970s orange, 1980s magenta, 1990s green, 2000s violet, 2010s gold, 2020s steel blue. Applied only as the top band of a paper strip (7px on rack strips, 12px on the reveal strip, 4px on mini lists) through a per-decade class that sets the band.

### Neutral
- **Black Lacquer** (ground): page ground and the browser theme color.
- **Raised Lacquer** (ground-2): text inputs, the year-range face, the mystery strip, live slots, and hover on ruled list rows.
- **Hairline** (rule): one-pixel rules between sections, list rows, and score cells.
- **Strong Hairline** (rule-strong): control borders, the mystery strip's dashed edge, disabled text.
- **Cream Paper** (paper): the strip stock and also the main text color on the dark ground.
- **Faded Label** (muted): secondary text on the ground: hints, blurbs, field labels, counts. 8.8:1 on ground.
- **Ink** (paper-ink): type on paper and on mustard.
- **Faded Ink** (paper-muted): the artist line on a strip. 7.0:1 on paper.

### Status
- **Good** (good) and **Bad** (bad): verdict text after the reveal and small inline states. Both clear 7:1 on ground.
- **Safe Field** (good-field): the "safe to turn the DJ phone over" banner, with paper text.

### Named Rules
**The Decade Ink Rule.** Decade color appears only as the flat top band of a paper strip, and every band sits beside its year in type. Color is never the only cue for a decade.

**The Mustard Means Now Rule.** Mustard marks the one selected, current, or focused thing on screen. If nothing is selected, there is no mustard.

**The Red Is the Brand Rule.** Red marks the brand (logo, room code) and the single primary action in a view. It is not used for errors; errors use bad.

## Typography

**Display Font:** League Gothic (with Barlow Condensed, sans-serif)
**Label Font:** Barlow Condensed (with Barlow, sans-serif), weights 600 and 700
**Body Font:** Barlow (with system-ui, sans-serif), weights 400 to 700

**Character:** A tall jukebox-key gothic for anything you read from across the table, a condensed grotesk in caps for labels, and a plain open sans for sentences.

### Hierarchy
- **Display** (League Gothic 400, clamp(4rem, 21vw, 6rem), 0.88, uppercase): the wordmark and game-over headline.
- **Headline** (League Gothic 400, clamp(2.8rem, 13vw, 4rem), 0.92, uppercase): the stage title that says whose turn it is and what to do; the team phone uses clamp(2.4rem, 11vw, 3.4rem). The verdict uses the same face at clamp(2.6rem, 11vw, 3.4rem).
- **Key** (League Gothic 400, 2.5rem, 1, tabular figures): years on rack strips. The same face carries the reveal year (clamp(5rem, 26vw, 6rem)), the room code (clamp(5rem, 30vw, 6rem), 0.08em tracking), the code input (2.4rem, 0.3em tracking), stepper values (2.4rem), year-range readouts, and the countdown (4.4rem).
- **Title** (Barlow Condensed 700, 1.2rem, 1.1, 0.04em, uppercase): section headings. Song titles on strips use 1.12rem at 0.01em; team names 1.08rem to 1.1rem.
- **Label** (Barlow Condensed 700, 1.05rem, 0.04em, uppercase): buttons, rail titles, disclosure summaries. Field labels use 600 at 0.98rem in sentence case.
- **Body** (Barlow 400, 17px, 1.5): sentences. Ledes cap at 46ch, hints at 60ch, blurbs at 52ch.
- **Body Small** (Barlow 400, 0.92rem to 0.95rem, 1.4): hints, artist lines, blurbs, counts.

### Named Rules
**The Gothic Key Rule.** League Gothic is for numbers, codes, names of the moment, and commands of a few words. It never sets a sentence.

**The Tabular Count Rule.** Every number that changes or lines up (years, codes, counts, scores, the countdown) uses tabular figures.

## Layout

A single centered column, 680px wide, with 20px side gutters and 24px top padding; 96px of bottom padding keeps content clear of the fixed dock. At 420px and below the gutter tightens to 16px. At 900px and up the home screen widens to 1040px and splits into two columns (1.1fr and 1fr, 64px apart), the masthead on the left with the logo beside the wordmark.

Sections are open, not boxed: each panel starts with a one-pixel top rule and 22px of space. Lists (modes, choices, roster, standings) are ruled ledgers with a bottom rule per row and no gaps. The score row is a hairline grid: cells on the ground separated by a 1px gap that shows the rule color, auto-fitting at 128px minimum. The rack is a flush vertical stack of strips; between strips sit 8px gaps that grow into 50px live slots when it is your turn to place.

The team phone pins its primary action in a fixed bottom dock with a top rule and safe-area padding; the primary button grows to fill it. The DJ phone centers one large square red target (up to 340px) in the viewport.

Spacing runs on small, close steps (4, 6, 10, 12, 14, 18, 22, 28px) rather than a strict multiple; 12px and 18px are the most common gaps between controls and blocks.

## Elevation & Depth

Flat. Depth is tonal: the lacquer ground, a raised lacquer for inputs and blanks, and cream paper for content that matters. One-pixel rules do the separating. The only lifted element is the toast, which floats over everything at the bottom of the screen.

### Shadow Vocabulary
- **Toast lift** (`box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55)`): the toast only, so it reads as floating above the dock.

### Named Rules
**The Flat Rack Rule.** Strips, panels, buttons, and cells sit flat on the ground. Separation comes from tone and hairlines, never from shadows or glows.

## Shapes

Square edges everywhere content lives: strips, panels, banners, score cells, the room code, the code input, and the square score tokens. Tappable controls (buttons, chips, text inputs, the DJ target) take a barely softened 2px corner. Borders are one pixel, solid on controls and rules, dashed on the mystery strip and on waiting banners to say "not yet." The thick top band is the system's signature edge: 7px on strips, the code input, and live slots; 10px on the lobby room code; 12px on the reveal strip; 5px on the toast; 4px on mini lists.

The logo is the one place for curves: a red body that morphs between a circle (record, CD), a wide rectangle (cassette), a tall rounded rectangle (iPod), and a rounded square (app tile), each carrying a cream clock face whose hands turn counterclockwise.

## Components

### Buttons
Tactile and plain, like labeled keys on a console.
- **Shape:** nearly square (2px), 48px minimum height.
- **Primary:** red fill, white uppercase condensed label; one per view. Hover and press darken to red-down; press nudges down 1px.
- **Default (outline):** transparent with a strong-hairline border and paper text; hover brightens the border to paper.
- **Sizes:** big (1.3rem, 60px) for Start, Lock in, and the DJ steps; small (0.92rem, 40px) for secondary actions in tight rows; round (48px square) for steppers.
- **Link:** underlined Barlow 500 with a 1px mustard underline that thickens to 2px on hover; for "Back," "Song didn't play?" and similar escapes.
- **Disabled:** text and border drop to the rule colors; a disabled primary loses its red.
- **Focus:** a 3px mustard outline offset 3px, for every focusable element.
- **On mustard or warn fields:** the primary button switches to an ink fill so it stays legible.

### Chips
- **Style:** transparent, strong-hairline border, condensed 600 label, 42px tall.
- **State:** selected chips fill mustard with ink text. Used for year-range presets.

### Inputs / Fields
- **Style:** raised lacquer fill, strong-hairline border, 2px corner, 52px tall, label above in condensed 600 muted text.
- **Focus:** border turns mustard plus a 1px mustard ring.
- **Room code input:** a paper slip with a 7px red top band, League Gothic at 2.4rem with 0.3em tracking, red caret; focus adds a 3px mustard ring.

### Title Strip (signature)
- **Rack strip:** paper, ink type, decade band on top, a 4.6rem year column in League Gothic beside the uppercase title and the faded-ink artist line; 66px minimum.
- **Reveal strip:** single column, 12px band, year at up to 6rem. When fresh it flips in from the top edge (rotateX from -96deg with a brief darkening, 620ms, cubic-bezier(0.16, 1, 0.3, 1)).
- **Mystery strip:** the hidden song in its slot: raised lacquer, mustard band, dashed hairline sides, a mustard "?" in the year column, "Year hidden until the reveal" as the artist line.
- **Newly kept:** a 3px mustard outline offset 3px.
- **Mini strip:** in other teams' timelines and the played list, a compact paper row with a 4px band and a 1.25rem gothic year.

### Slots
The gaps between strips. At rest an 8px spacer. When placing, a 50px raised-lacquer bar with a 7px strong-hairline band and an uppercase label; hover fills mustard. A challenged slot shows a mustard outline and the claiming team's name.

### Score Row
Hairline grid of team cells: uppercase team name, card count, and square tokens (10px, outlined when empty, filled when earned). The active team's cell fills mustard.

### Banners and Resume Bar
Full-width flat bars with 10px by 14px padding. Warn: mustard fill, ink text. Safe: good-field fill, paper text. Wait: muted text in a dashed hairline box. The home screen's resume bar is the same mustard treatment.

### Navigation
There is no nav bar. Each game screen opens with a game bar: the small static logo (34px) and small wordmark, a muted meta line, a hairline below. Leaving is a link-style or outline button, never a menu.

### Year Range Dial
A raised lacquer face (120px) of paper bars, one per year sized by song count, with years outside the range faded to 16%. The chosen range is a mustard-ruled window; two native range handles draw as 4px mustard lines that widen to 10px paper lines on focus. Ticks below in condensed muted figures.

### Logo
A 64-unit SVG at 88px on the home screen (104px wide, 72px narrow) and 34px static in game bars. Animated only on home, 15s per cycle: record, cassette, CD, iPod, app tile, back to record, with the minute hand turning backward every 3s and the hour hand every 36s. Under reduced motion it rests on the record.

## Do's and Don'ts

### Do:
- **Do** put every song on a paper strip with its decade band on top and its year in League Gothic beside it.
- **Do** keep decade color to the band; the year in type is the cue that does not rely on color.
- **Do** use mustard for exactly what is selected, current, or focused, and red for the brand and the one primary action.
- **Do** separate sections and list rows with one-pixel rules on the open ground instead of boxing them.
- **Do** keep tap targets at 48px or more for anything used mid-game (40px only for small secondary buttons).
- **Do** use tabular figures for every number that changes.
- **Do** keep motion to the logo and the reveal, with state transitions at 120ms, and honor reduced motion.

### Don't:
- **Don't** round surfaces; strips, panels, banners, and cells stay square, and controls stop at 2px.
- **Don't** use glows or soft gradients. Hard-stop gradients that draw a crisp line (the dial handles) are fine.
- **Don't** add shadows to strips, panels, or buttons; the toast is the only lifted element.
- **Don't** set sentences in League Gothic or in uppercase.
- **Don't** show a song title, artist, or year before the reveal; the mystery strip is the only representation of the current song.
- **Don't** use real brand logos in the mark or anywhere else.
