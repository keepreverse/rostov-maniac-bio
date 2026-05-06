/* ROSTOV MANIAC — live data layer
 *
 * Pulls fresh stats from Leetify Public API (CORS-enabled) and exposes
 * a single Promise via window.RostovData.load(). Falls back gracefully
 * to last-known snapshot if the network/API is unavailable so the
 * page never looks broken.
 *
 *   GET https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=…
 *   GET https://api-public.cs-prod.leetify.com/v3/profile/matches?steam64_id=…
 *
 * Steam (level / member-since) and CSStats.gg (career totals, HLTV
 * rating) are not reachable from a static page (no CORS / Cloudflare
 * challenge), so those fields are intentionally not modelled here —
 * the UI either drops them or repurposes them onto Leetify-derived
 * aggregates over the last 100 matches.
 */
(() => {
  "use strict";

  const STEAM_ID = "76561198055425103";
  const LEETIFY_BASE = "https://api-public.cs-prod.leetify.com";
  const CACHE_KEY = "rostov-maniac-live-v1";
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const FETCH_TIMEOUT_MS = 12_000;

  /* Last-known snapshot (Leetify pull, baked at build time).
   * Used as a graceful fallback if the live fetch fails. */
  const FALLBACK = {
    stale: true,
    name: "euphoriaohilia",
    totalMatches: 466,
    winratePct: 87,
    leetifyRating: 7.21,
    premier: 29592,
    wingman: 18,
    skills: {
      aim: 98.1,
      positioning: 73.2,
      hsAccuracyPct: 40.0,
      counterStrafePct: 83.5,
      reactionMs: 528,
    },
    last25: {
      kd: 2.19,
      hsPct: 60,
      adr: 113,
      winratePct: 87,
    },
    last100: {
      matches: 100,
      winratePct: 87,
      kills: 1850,
      deaths: 870,
      damage: 178000,
      headshots: 1110,
      rounds: 1580,
    },
    last10: [
      { outcome: "loss", map: "de_inferno",  score: [0, 8],  finishedAt: "2026-05-03T13:53:14.000Z", id: null },
      { outcome: "win",  map: "de_overpass", score: [8, 0],  finishedAt: "2026-05-03T13:30:10.000Z", id: null },
      { outcome: "win",  map: "cs_office",   score: [13, 1], finishedAt: "2026-05-03T13:09:03.000Z", id: null },
      { outcome: "win",  map: "cs_office",   score: [13, 4], finishedAt: "2026-05-03T12:21:02.000Z", id: null },
      { outcome: "win",  map: "cs_office",   score: [13, 5], finishedAt: "2026-05-03T11:51:14.000Z", id: null },
      { outcome: "win",  map: "de_overpass", score: [13, 4], finishedAt: "2026-05-02T16:27:02.000Z", id: null },
      { outcome: "win",  map: "de_inferno",  score: [13, 4], finishedAt: "2026-05-02T15:56:46.000Z", id: null },
      { outcome: "loss", map: "de_nuke",     score: [11, 13],finishedAt: "2026-05-02T15:16:40.000Z", id: null },
      { outcome: "win",  map: "cs_italy",    score: [3, 3],  finishedAt: "2026-05-02T14:30:00.000Z", id: null },
      { outcome: "win",  map: "de_overpass", score: [13, 6], finishedAt: "2026-05-02T13:50:00.000Z", id: null },
    ],
    mapPool: [
      { map: "de_train",    rank: 15 },
      { map: "de_dust2",    rank: 14 },
      { map: "de_mirage",   rank: 14 },
      { map: "de_overpass", rank: 14 },
      { map: "de_vertigo",  rank: 14 },
      { map: "cs_office",   rank: 14 },
      { map: "de_nuke",     rank: 10 },
      { map: "de_inferno",  rank: 10 },
    ],
    fetchedAt: null,
  };

  /* ---------- helpers ---------- */
  const fetchWithTimeout = (url, ms = FETCH_TIMEOUT_MS) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal, cache: "no-store" })
      .finally(() => clearTimeout(t));
  };

  const readCache = () => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.fetchedAt) return null;
      if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
      return parsed.data;
    } catch (_) { return null; }
  };

  const writeCache = (data) => {
    try {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ fetchedAt: Date.now(), data })
      );
    } catch (_) { /* storage may be full or disabled — ignore */ }
  };

  /* Aggregate per-match stats for the player's row in each match. */
  const aggregate = (matches) => {
    let kills = 0, deaths = 0, dmg = 0, rnd = 0, hs = 0, wins = 0, played = 0;
    for (const m of matches) {
      const s = (m.stats || []).find((x) => x.steam64_id === STEAM_ID);
      if (!s) continue;
      played += 1;
      kills  += s.total_kills    || 0;
      deaths += s.total_deaths   || 0;
      dmg    += s.total_damage   || 0;
      rnd    += s.rounds_count   || 0;
      hs     += s.total_hs_kills || 0;

      const ts = (m.team_scores || []);
      if (ts.length === 2 && s.initial_team_number != null) {
        const ours = ts.find((t) => t.team_number === s.initial_team_number);
        const theirs = ts.find((t) => t.team_number !== s.initial_team_number);
        if (ours && theirs && ours.score > theirs.score) wins += 1;
      }
    }
    const safe = (n, d = 1) => (d ? n / d : 0);
    return {
      matches: played,
      kills, deaths, damage: dmg, headshots: hs, rounds: rnd, wins,
      kd: deaths ? +(kills / deaths).toFixed(2) : kills,
      hsPct: kills ? Math.round((hs / kills) * 100) : 0,
      adr: rnd ? Math.round(dmg / rnd) : 0,
      winratePct: played ? Math.round((wins / played) * 100) : 0,
    };
  };

  const outcomeFromMatch = (m) => {
    const s = (m.stats || []).find((x) => x.steam64_id === STEAM_ID);
    const ts = (m.team_scores || []);
    if (s && ts.length === 2 && s.initial_team_number != null) {
      const ours = ts.find((t) => t.team_number === s.initial_team_number);
      const theirs = ts.find((t) => t.team_number !== s.initial_team_number);
      if (ours && theirs) {
        if (ours.score > theirs.score) return { outcome: "win",  score: [ours.score, theirs.score] };
        if (ours.score < theirs.score) return { outcome: "loss", score: [ours.score, theirs.score] };
        return { outcome: "tie", score: [ours.score, theirs.score] };
      }
    }
    return { outcome: "tie", score: [0, 0] };
  };

  const buildLast10 = (matches) =>
    matches.slice(0, 10).map((m) => {
      const o = outcomeFromMatch(m);
      return {
        id: m.data_source_match_id || m.id || null,
        outcome: o.outcome,
        score: o.score,
        map: m.map_name || "—",
        finishedAt: m.finished_at || null,
      };
    });

  const buildMapPool = (competitive) => {
    if (!Array.isArray(competitive)) return FALLBACK.mapPool;
    const ranked = competitive
      .filter((m) => m && m.rank > 0)
      .sort((a, b) => b.rank - a.rank);
    if (!ranked.length) return FALLBACK.mapPool;
    return ranked.slice(0, 8).map((m) => ({ map: m.map_name, rank: m.rank }));
  };

  const buildData = (profile, matches) => {
    const ranks = profile.ranks || {};
    const rating = profile.rating || {};
    const stats = profile.stats || {};
    const arr = Array.isArray(matches) ? matches : [];

    const last25Agg = aggregate(arr.slice(0, 25));
    const last100Agg = aggregate(arr.slice(0, 100));

    return {
      stale: false,
      name: profile.name || "euphoriaohilia",
      totalMatches: profile.total_matches || last100Agg.matches,
      winratePct: typeof profile.winrate === "number"
        ? Math.round(profile.winrate * 100)
        : last100Agg.winratePct,
      leetifyRating: typeof ranks.leetify === "number"
        ? +ranks.leetify.toFixed(2)
        : null,
      premier: ranks.premier ?? null,
      wingman: ranks.wingman ?? null,
      skills: {
        aim:               typeof rating.aim === "number"          ? +rating.aim.toFixed(1)         : null,
        positioning:       typeof rating.positioning === "number"  ? +rating.positioning.toFixed(1) : null,
        hsAccuracyPct:     typeof stats.accuracy_head === "number" ? +stats.accuracy_head.toFixed(1): null,
        counterStrafePct:  typeof stats.counter_strafing_good_shots_ratio === "number"
                              ? +stats.counter_strafing_good_shots_ratio.toFixed(1) : null,
        reactionMs:        typeof stats.reaction_time_ms === "number"
                              ? Math.round(stats.reaction_time_ms) : null,
      },
      last25: {
        kd: last25Agg.kd,
        hsPct: last25Agg.hsPct,
        adr: last25Agg.adr,
        winratePct: last25Agg.winratePct,
      },
      last100: {
        matches: last100Agg.matches,
        winratePct: last100Agg.winratePct,
        kills: last100Agg.kills,
        deaths: last100Agg.deaths,
        damage: last100Agg.damage,
        headshots: last100Agg.headshots,
        rounds: last100Agg.rounds,
      },
      last10: buildLast10(arr),
      mapPool: buildMapPool(ranks.competitive),
      fetchedAt: new Date().toISOString(),
    };
  };

  const load = async () => {
    const cached = readCache();
    if (cached) return cached;

    const [profileRes, matchesRes] = await Promise.all([
      fetchWithTimeout(`${LEETIFY_BASE}/v3/profile?steam64_id=${STEAM_ID}`),
      fetchWithTimeout(`${LEETIFY_BASE}/v3/profile/matches?steam64_id=${STEAM_ID}`),
    ]);
    if (!profileRes.ok) throw new Error(`profile ${profileRes.status}`);
    if (!matchesRes.ok) throw new Error(`matches ${matchesRes.status}`);
    const [profile, matches] = await Promise.all([
      profileRes.json(),
      matchesRes.json(),
    ]);
    const data = buildData(profile, matches);
    writeCache(data);
    return data;
  };

  window.RostovData = {
    STEAM_ID,
    FALLBACK,
    load,
  };
})();
