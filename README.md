# ROSTOV MANIAC — CS2 Player Card

Interactive bio-link / business-card webpage for Counter-Strike 2 player **ROSTOV MANIAC**
(Steam: [`euphoriaohilia`](https://steamcommunity.com/profile/76561198055425103), SteamID64
`76561198055425103`), themed around Ukrainian national identity (flag colors, Tryzub) and
CS2 HUD aesthetics.

Every number visible on the page is **fetched live from the public Leetify API** at page
load — there is no build step that bakes in stale snapshots. A bundled snapshot is only
used as a graceful fallback when the API is unreachable.

## Live data

The page calls two public Leetify endpoints on every load (CORS-enabled, no auth needed):

| Endpoint | Purpose |
| --- | --- |
| `GET https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=76561198055425103` | Ranks (Premier, Wingman, Leetify), per-skill scores (aim, positioning, HS-accuracy, counter-strafe, reaction), per-map Premier ranks 0–18, total matches and overall winrate |
| `GET https://api-public.cs-prod.leetify.com/v3/profile/matches?steam64_id=76561198055425103` | Last 100 matches (per-match kills, deaths, damage, headshots, rounds, score, outcome, map) — used to derive **K/D / HS% / ADR / Win Rate** over the last 25 matches and to render the **Last 10** form pills + the **last-100 aggregate** card |

The two requests are issued in parallel; results are cached in `sessionStorage` for 5
minutes so that page reloads inside the same tab feel instant.

### Where each datum on the page comes from

| UI element | Field |
| --- | --- |
| Hero — Premier rank chip | `ranks.premier` |
| Hero — Wingman card | `ranks.wingman` (`18` → `MAX`) |
| Hero — Leetify card | `ranks.leetify` |
| Hero — Matches card | `total_matches` |
| Hero — `@handle` | `name` |
| Hero — typewriter tagline | composed from the four fields above |
| Hero — Last 10 pills (W/L/T) | first 10 entries of `/v3/profile/matches` (outcome derived from `team_scores` vs `stats[].initial_team_number`) |
| STATS — K / D | sum of `total_kills` / sum of `total_deaths` over last 25 matches |
| STATS — HEADSHOTS % | sum of `total_hs_kills` / sum of `total_kills` over last 25 |
| STATS — ADR | sum of `total_damage` / sum of `rounds_count` over last 25 |
| STATS — WIN RATE | computed from per-match outcome over last 25 |
| STATS — PREMIER tile | `ranks.premier` |
| STATS — LEETIFY · RATING | `ranks.leetify` |
| Skill row — AIM | `rating.aim` |
| Skill row — POSITIONING | `rating.positioning` |
| Skill row — HS · ACCURACY | `stats.accuracy_head` |
| Skill row — COUNTER-STRAFE | `stats.counter_strafing_good_shots_ratio` |
| Skill row — REACTION | `stats.reaction_time_ms` |
| Skill row — WINGMAN · RANK | `ranks.wingman` |
| FORM (last 100) — MATCHES / WIN RATE / KILLS / DEATHS / DAMAGE / HEADSHOTS / ROUNDS | aggregated from all 100 entries of `/v3/profile/matches` |
| MAP POOL tiles | sorted from `ranks.competitive[*]` (top 8 by rank), CS2-rarity buckets derived from rank |
| Footer "synced HH:MM:SS EET" | timestamp of the live fetch |

### What was intentionally dropped (no reliable source from a static page)

A previous build of this page also displayed values pulled from CSStats.gg (career
all-time totals, HLTV-style rating) and from the Steam Web API (level, member-since
date) by hand-baking the numbers at build time. Those sources are **not reachable
from a browser-only deployment**:

- **csstats.gg** is fronted by a Cloudflare bot challenge that returns 403 without a
  full headless browser handshake. There is no public JSON API.
- **Steam Web API** does not send `Access-Control-Allow-Origin`, and any usable
  endpoint requires an API key that would be exposed if shipped to the browser.
- Public CORS proxies (allorigins, corsproxy.io, cors.sh, thingproxy, etc.) are
  unreliable / rate-limited / no longer free, so we do not depend on any of them.

To keep every visible number truly live, the page therefore:

- replaces the old "CAREER (csstats.gg · all-time totals)" block with a
  Leetify-driven "FORM (last 100 matches · aggregated)" block,
- drops the standalone "STEAM LEVEL" hero card and the "HLTV · RATING" KPI tile
  (both were CSStats / Steam-only),
- keeps the **Steam avatar URL** as a static asset (the URL contains a stable hash
  that only changes when the user replaces their avatar — a rare event).

If a live fetch fails (offline, API down, blocked), the page still renders using the
last known snapshot and shows an amber "LEETIFY · LAST KNOWN" suffix on the hero rank.

## Tech stack

- **HTML5** — semantic structure (`header`, `main`, `section`, `footer`, ARIA labels), inline SVG.
- **CSS3** — custom properties, CSS Grid + Flexbox, `clip-path` for CS2-style angular
  cards, conic / linear gradients for the rotating avatar ring and flag stripes,
  `@keyframes` animations (glitch text, pulsing Tryzub, sliding flag bars, shimmering
  name, animated stat bars, full-screen preloader), `backdrop-filter` blur on the HUD
  bars, `prefers-reduced-motion` support, and a fully fluid responsive system based on
  `clamp()`, viewport units (`vw`, `svh`) and **CSS container queries** on the card
  itself — no fixed-pixel breakpoints in the layout components.
- **Vanilla JavaScript (ES6)** — `fetch` against the Leetify Public API, derived-stat
  aggregation, `sessionStorage` cache, full-screen preloader with timed minimum
  display, typewriter effect for the tagline, `IntersectionObserver`-driven counter
  animations, `requestAnimationFrame` particle canvas (drifting blue / yellow motes),
  mouse-parallax on the Tryzub watermark, subtle 3D tilt on cards, Kyiv-time HUD
  clock, and a hidden Konami-code easter egg.
- **Inline SVG** — hand-built **Tryzub** coat of arms (`assets/tryzub.svg`) and all
  platform icons.
- **Google Fonts** — `Bebas Neue`, `Oswald`, and `JetBrains Mono` to match CS2 typography.

No build step, no dependencies, no framework — a single static page that pulls live
data on every visit.

## Project layout

```
rostov-maniac-bio/
├── index.html       # Markup + preloader scaffold + data-bind hooks
├── styles.css       # Visual system + preloader styles
├── data.js          # Live-data layer (Leetify API, caching, fallback)
├── script.js        # UI orchestration: preloader, binding, animations
├── README.md
└── assets/
    └── tryzub.svg
```

## How to view locally

The page is fully static — any HTTP server works. **Open via a real HTTP origin**
(not `file://`) — browsers reject `fetch` to https endpoints from `file://` URLs in
some configurations.

**Option A — Python (no install needed on most systems):**
```bash
cd rostov-maniac-bio
python3 -m http.server 8000
# open http://localhost:8000
```

**Option B — Node.js:**
```bash
cd rostov-maniac-bio
npx --yes serve .
# open the URL printed in the terminal (usually http://localhost:3000)
```

> Tested on the latest Chrome, Firefox, and Safari (desktop + mobile viewports).

## Features

- **Full-screen live-data preloader** themed in CS2 / UA colours: spinning Tryzub,
  pulsing flag, animated bar equaliser, status text reflecting the fetch progress.
- **Real-time numbers**: every KPI / chip / pill is bound to the Leetify response.
- **Fresh on every visit**, with a 5-minute `sessionStorage` cache so reloads in the
  same tab are instant.
- **Graceful fallback**: if Leetify is unreachable, the page renders the bundled
  snapshot and badges the rank suffix as "last known".
- Prominent **ROSTOV MANIAC** display name in CS2 HUD typography with subtle gradient
  and RGB-glitch flicker.
- Real **`@euphoriaohilia` / SteamID64 76561198055425103** identity strip linking to
  the Steam profile.
- Ukrainian palette (`#005BBB` / `#FFD500`) layered with CS2 navy and amber accents.
- **Tryzub** featured as: favicon, hero avatar centerpiece, preloader spinner, and a
  parallax-drifting watermark behind the entire page.
- CS2-style **HUD** top/bottom bars with live Kyiv clock, "live" indicator, ping bars,
  FPS counter, Ukrainian flag, and a footer "synced HH:MM:SS EET" timestamp.
- **STATS** block (Leetify-driven, recent form + skill scores).
- **FORM** block (Leetify-driven, last-100 aggregated totals).
- **Last 10** match-form pills (W / L / T) with per-pill tooltips showing map, score
  and date — every pill links to its Leetify match-details page.
- **Map pool panel** rendered from `ranks.competitive` — sorted by rank, top 8,
  styled like CS2 weapon-rarity cards.
- **Profile / analytics links** going to real URLs — Steam, Leetify, CSStats.gg,
  CSGOStats.gg, Tracker.gg, Steam CS2 inventory.
- **"Слава Україні!"** battle-cry banner with sliding flag stripes.
- Ambient particle canvas, scanline overlay, and a subtle grid — all respect
  `prefers-reduced-motion`.
- Fully responsive layout (single-column on mobile, multi-column on tablet / desktop).
