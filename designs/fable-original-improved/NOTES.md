# Fable: original layout, improved

Static prototype for Jacob's 06:31Z ask: "more like the layout of the original one but slightly improved."
Built 2026-11-18 by Fable. Nothing was deployed, served, posted or pushed, and nothing was written outside this folder.

Open `index.html` directly. It is one file with no assets, like the original, so it could replace the live `index.html` once the contribute form is re-wired (see "Not done").

## What it is

The original page, section for section, with the same dark/teal look, the same hero line and the same copy voice. The changes are the six you listed, plus five small judgement calls flagged below.

Base: `original-base.html` is the untouched copy of `screenshots-original-20261118/humanityinfrastructure_com.html` (sha256 `a87ac462…a614`, matches `SHA256SUMS`). `index.html` was rewritten from it.

## Kept

- Section order: nav → hero → premise pillars → tools grid → quote → build list → living document → submit → join → footer.
- Palette (`#0c0f14` background, teal `#5fd3a8`, blue `#7aa2ff`, amber kickers), the teal-to-blue gradient on "birthright" and the primary buttons, the corner glows, the sticky blurred nav, the pill eyebrow, card radii, and the light/dark toggle with its `h3-theme` storage key.
- The system font stack. No webfont was added.
- All original copy: hero, lede, "superorganism" line, pillars, card descriptions, the Jack Park quote, the build-list entries, and the join headline.
- The three-column card grids, the filter chips, the live quest grid and the "Find your contribution" dialog.

## Improved, and why

1. **Type and spacing.** The original had 32 different font sizes. This has seven fixed steps (12, 13, 14, 15, 16, 18, 24 px) and three fluid display sizes. Spacing is on a 4 px grid, and sections are 56 to 72 px apart instead of a flat 64. Headings had the body's 1.6 line height, which left a wide gap in two-line headings; they are now 1.15 and balanced. Intro paragraphs are capped at about 70 characters per line (the submit section ran to roughly 150). Every emoji is now an inline SVG from one sprite, including the favicon and the theme toggle.
2. **Editor's notes.** Lastbook, SignuDoc and Paxi each carry an "Editor's note" block with a dashed "Draft" tag and the line "Placeholder. Jacob hasn't written this yet." The text is the draft from `resources.json`. It is agent-written, so it must be replaced before this ships.
3. **GitHub.** A bordered GitHub button sits in the nav at every width. Below 390 px it becomes icon-only with an accessible name. The footer has "Source on GitHub", and the submit section keeps its link.
4. **Newsletter.** "A short, occasional letter" sits under the join band with an email field. It is tagged "Mock" and says it does not send or save anything. Submitting only shows "Mock only: nothing was sent or saved."
5. **Links.** Details under "Links" below.
6. **Accessibility.** Details under "Checks" below.

## Before and after, by section

| Section | Before | After |
| --- | --- | --- |
| Nav | Emoji globe (a box on this host). All links vanished at 680 px. No GitHub link. | SVG globe. Brand reads "Humanity Infrastructure · The Codex", as on the live v0.5.1 page. GitHub button always visible. Links step down at 1100 px and 780 px without wrapping. Skip link added. |
| Hero | Forced line break gave a ragged four-line headline on phones. The italic line was 3.3:1 contrast. | Same words and sizes. Each sentence balances on its own. The italic line passes AA. Buttons are 48 px tall and full width on phones. |
| Premise pillars | Loose emoji, four columns that broke to 3 + 1 on tablets. | Icon tiles matching the tool cards. Four, two or one column, never an orphan. |
| Tools grid | 9 cards, each one big link. ListHub shown as "Live". "Free and open" above the grid. | Lastbook, SignuDoc and Paxi lead the grid as the featured row with license and platform badges, a maker line and the draft editor's note. Paxi reads "Free · Closed source · iPhone", "By Doug Feigelson, a friend of the maintainer", and links to community submission #2. The other seven cards are unchanged. ListHub is removed, with a one-line retirement note. The policy line replaces "Free and open". |
| Quote | Full-width text, about 110 characters per line. | Same box and accent bar. Larger type, capped at about 70 characters. |
| Build list | Emoji in chips and tags. Tags overlapped long titles. "Done" tags were unstyled. | Coloured dots instead of emoji. Chips show counts (60, 52, 5, 3) and report their pressed state. Tags sit in the card header row. All 34 `http://` links are now `https://`. |
| Quest grid | Old Supabase host, so it showed "Couldn't load". Links were relative. | Loads from `api.worldissuetracker.com` (16 quests when rendered). Every link resolves against `https://worldissuetracker.com` and cannot leave that host. Descriptions clamp to four lines instead of cutting mid-word at 150 characters. |
| Living document | Emoji headings. World Quest Guild pointed at a dead host. Eleven `http://` links. | SVG heading icons. World Quest Guild opens the Google Doc, with quests.world shown as the short link. All links `https://`. |
| Submit | Bare heading and full-width paragraphs. | Same words and buttons, set like the other sections with a kicker and a readable measure. |
| Join | CTA band only. "Join a guild" pointed at a dead host. | Same band and headline. "Join a guild" opens the Google Doc. The mock letter form sits directly below. |
| Footer | "Free & open source." Version row at 50% opacity. Relative `/v2` links. | The policy line, a GitHub link, readable contrast, absolute links. The version slot says this is an undeployed prototype. |

## Links

- 59 unique external URLs were requested today. 53 returned 200 and 6 redirected. None use `http://`.
- quests.world still redirects to a host that does not answer, so both mentions say "(being repaired)", as the live page does.
- Two build-list links were dead on both `http` and `https` (minimalisthomepages.com, openresearch.connekt.site). I removed the links and kept the entries. The live page did the same.
- Board links now use `https://worldissuetracker.com/tracker/missing-civ-infrastructure`, the address in `resources.json`.

## Judgement calls outside your six items

Each is small and easy to revert.

- A dashed "What else should be featured?" card closes the tools grid. Ten cards left one orphan in a three-column grid; this fills the row and reuses the submit section's own words.
- "Done" build items no longer show a "Claim" link. Their link reads "Visit".
- The quest intro said "updates here in real time". It loads once per page view, so it now says that.
- The submit section gained the kicker "Submit a resource", matching the nav label.
- The Cloudflare analytics beacon is not in this file, so opening the prototype sends no analytics.

## Not done

- **The contribute dialog is not connected.** It opens, traps focus and closes, but the analyze and save calls are removed, and it says so. Porting this file means putting those two handlers back.
- Section links are still hidden on phones, as in the original. Only the GitHub button and theme toggle show.
- The seven non-featured cards still show only "Live". The policy line was worded so that only featured listings promise a license.
- The "need" lines from the v0.5.1 shelves are not carried over, because the original layout has no shelves.
- The build list is still all 60 cards. With the quest grid now loading and the featured row added, the page is longer than the original capture: 12,293 px against 9,667 px at 1440 wide.

## Checks

Run with `node audit.mjs`; results are in `verification.json`.

- **Overflow:** no horizontal overflow at any width from 320 to 1440 px, checked at every pixel. The nav never wraps, the brand is never truncated and the GitHub link is always on screen.
- **Contrast:** 85 text styles per theme, computed against their real backgrounds. All pass AA in dark and light, including the open dialog, placeholders and field borders. The original's faint grey (`#5d6678`, about 3:1) became `#8791a5`. The light theme's accents were darkened for text.
- **Focus:** all 209 tab stops show a 2 px focus ring. The dialog takes focus, keeps it, closes on Escape and returns focus to its button.
- **Reduced motion:** the pulsing dot, smooth scrolling, hover lifts and transitions are all off.
- **Network:** the only request is the quest fetch. Submitting either form makes none.

Not verified: macOS and iOS rendering (this host is Linux, so the screenshots show Liberation Sans where a Mac shows San Francisco), and no screen reader was run.

## Files

- `index.html`: the prototype.
- `shot-desktop.png` (1440 wide, full page), `shot-mobile.png` (390 wide, full page), `shot-mobile@2x.png` (same, sharper).
- `compare-desktop.png`: the original top fold beside this one.
- `render.mjs`, `audit.mjs`, `verification.json`: how the screenshots and checks were produced.
- `original-base.html`: the untouched original.
- `_work/`: build intermediates for the comparison image and the one-off script that lifted the build-list data.
