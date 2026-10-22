# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Friends at home on a game night, mostly adults in their 20s and 30s, often in dim light with drinks and music playing. Two to four teams each hold one phone; one more phone is the DJ phone that plays the songs.

## Product Purpose

ChronoSono is a music timeline party game in the style of Hitster. A hidden song plays, and the active team places it on its timeline of songs by year. Other teams can challenge. The first team to the target number of cards wins. Success is a game night that runs on phones people already have, with no cards to buy and no one seeing the answer early.

## Positioning

The DJ phone plays each song by opening an ordinary Spotify track link after it is laid face down and tapped, so nobody sees the title. Team phones never receive the current song until the reveal. No Spotify API, no account, no app to install beyond Spotify on the DJ phone.

## Operating Context

- One phone creates a room and gets a four-letter code; others join by code or invite link.
- The DJ phone lies face down; two beeps arm a tap on the back, which opens the song in Spotify. Team phones say when it is safe to turn it over.
- The active team places the song, other teams have 15 seconds to challenge, then the card flips on every team phone.
- Played across a table, sometimes read from a short distance, while people talk over music.

## Capabilities and Constraints

- Static page at `/chronosono/` plus a Netlify function at `/chronosono/api/*` storing rooms in Netlify Blobs.
- Phones poll every one to two seconds; there is no real-time service.
- Catalog: 590 songs with title, artist, original year, and Spotify ID (581 playable).
- Game settings: year range, mode, cards to win.
- Hosted on garrettgcraig.com but has its own identity, separate from the personal site's look (like KnowKi).

## Brand Commitments

- Name: ChronoSono.
- Must not look like a generic AI-made page (rounded dark cards, soft glows, one bright accent).
- Not busy: nothing that gets in the way mid-game.
- Not childish or game-show styled.
- Legible in a dark room and from across a table.

## Evidence on Hand

Real song catalog in `chronosono/songs.js`. No players, testimonials, or usage numbers exist; do not invent any.

## Product Principles

1. The answer stays hidden until the reveal, on every screen.
2. The current turn and what to do next are readable at a glance from arm's length.
3. Phones people already own are enough; no setup beyond opening a link.
4. The game stays out of the way of the conversation and the music.

## Accessibility & Inclusion

High contrast and large tap targets for dim rooms. Colors that mark decades or results also need a text or shape cue.
