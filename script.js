/* ROSTOV MANIAC — UI orchestration, live-data binding & ambient effects.
 *
 * Boot sequence:
 *   1. Show the preloader and run baseline ambient effects (clock, particles,
 *      tryzub parallax) so the loading screen is itself "alive".
 *   2. Call window.RostovData.load() which returns a promise of fresh data
 *      from the Leetify API (with sessionStorage caching). On error we render
 *      the bundled snapshot so the page never feels broken.
 *   3. Bind the data into the DOM via [data-bind="…"] / [data-bind-bar="…"]
 *      attributes and (re)build the dynamic lists (last-10 form, map pool).
 *   4. Hide the preloader, fade the card in, kick off the typewriter and
 *      counter animations.
 */
(() => {
  "use strict";

  /* ====================================================================
     1) Baseline effects that should run regardless of API state
     ==================================================================== */

  /* HUD clock (Kyiv time) — cached formatter avoids toLocaleString overhead */
  const clockEl = document.getElementById("hudClock");
  const clockFmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "Europe/Kyiv", hour12: false,
  });
  const tickClock = () => {
    clockEl.textContent = clockFmt.format(new Date()) + " EET";
  };
  if (clockEl) { tickClock(); setInterval(tickClock, 1000); }

  /* Mouse parallax on Tryzub watermark — idles when mouse is stationary */
  const tryzub = document.querySelector(".bg-tryzub");
  if (tryzub && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let tx = 0, ty = 0, cx = 0, cy = 0;
    let parallaxRunning = false;
    const startParallax = () => {
      if (parallaxRunning) return;
      parallaxRunning = true;
      const loop = () => {
        cx += (tx - cx) * 0.05;
        cy += (ty - cy) * 0.05;
        tryzub.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
        if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) {
          requestAnimationFrame(loop);
        } else {
          cx = tx; cy = ty;
          parallaxRunning = false;
        }
      };
      requestAnimationFrame(loop);
    };
    window.addEventListener("mousemove", (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 24;
      ty = (e.clientY / window.innerHeight - 0.5) * 24;
      startParallax();
    }, { passive: true });
  }

  /* Particle field — offscreen sprite cache eliminates per-frame shadowBlur */
  const canvas = document.getElementById("particles");
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext("2d");
    let w, h, particles, dpr;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const TWO_PI = Math.PI * 2;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    /* Pre-render glow sprites to offscreen canvases (one per color). */
    const COLORS = ["rgba(255,213,0,0.85)", "rgba(0,91,187,0.85)", "rgba(255,255,255,0.6)"];
    const SPRITE_R = 10;
    const spriteCache = COLORS.map((c) => {
      const s = document.createElement("canvas");
      const sz = (SPRITE_R + 8) * 2;
      s.width = sz; s.height = sz;
      const sc = s.getContext("2d");
      sc.shadowBlur = 8;
      sc.shadowColor = c;
      sc.fillStyle = c;
      sc.beginPath();
      sc.arc(sz / 2, sz / 2, SPRITE_R, 0, TWO_PI);
      sc.fill();
      return s;
    });

    const count = reduce ? 0 : Math.min(120, Math.floor((w * h) / 16000));

    particles = Array.from({ length: count }, () => {
      const ci = Math.floor(Math.random() * COLORS.length);
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.4,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -(Math.random() * 0.5 + 0.1),
        ci,
        a: Math.random() * TWO_PI,
        s: 0.005 + Math.random() * 0.01,
      };
    });

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.a += p.s;
        p.x += p.vx + Math.sin(p.a) * 0.15;
        p.y += p.vy;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        const sprite = spriteCache[p.ci];
        const scale = p.r / SPRITE_R;
        const sz = sprite.width * scale;
        ctx.drawImage(sprite, p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      requestAnimationFrame(draw);
    };
    if (count > 0) draw();

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    });
  }

  /* Subtle tilt — bound after render too, so we re-bind on dynamic tiles */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const bindTilt = (root = document) => {
    if (reduceMotion) return;
    const targets = root.querySelectorAll(".weapon, .link, .stat");
    targets.forEach((el) => {
      if (el.dataset.tiltBound === "1") return;
      el.dataset.tiltBound = "1";
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `translateY(-2px) rotateX(${(-py * 4).toFixed(2)}deg) rotateY(${(px * 4).toFixed(2)}deg)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  };

  /* Konami easter egg */
  const seq = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
  let kIdx = 0;
  window.addEventListener("keydown", (e) => {
    kIdx = e.key === seq[kIdx] ? kIdx + 1 : 0;
    if (kIdx === seq.length) {
      kIdx = 0;
      document.body.animate(
        [
          { filter: "hue-rotate(0deg)" },
          { filter: "hue-rotate(35deg) saturate(1.3)" },
          { filter: "hue-rotate(0deg)" },
        ],
        { duration: 1200, iterations: 3 }
      );
    }
  });

  /* ====================================================================
     2) Data binding + dynamic rendering
     ==================================================================== */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* Pre-cache data-bind / data-bind-bar DOM lookups for hot paths. */
  const _bindCache = new Map();
  const _barCache = new Map();
  const getBindEls = (key) => {
    let els = _bindCache.get(key);
    if (!els) { els = $$(`[data-bind="${key}"]`); _bindCache.set(key, els); }
    return els;
  };
  const getBarEls = (key) => {
    let els = _barCache.get(key);
    if (!els) { els = $$(`[data-bind-bar="${key}"]`); _barCache.set(key, els); }
    return els;
  };

  const fmt = {
    int: (n) => Math.round(Number(n)).toLocaleString("en-US"),
    intpct: (n) => `${Math.round(Number(n))}%`,
    intms: (n) => `${Math.round(Number(n))} ms`,
    dec1: (n) => Number(n).toFixed(1),
    dec1pct: (n) => `${Number(n).toFixed(1)}%`,
    dec2: (n) => Number(n).toFixed(2),
  };

  /* CS2-style rarity buckets keyed off the Premier rank value (0–18). */
  const rankToTier = (rank) => {
    if (rank >= 17) return { rarity: "covert",     label: "GLOBAL", star: "★ ELITE",    floatLabel: "tier · global elite" };
    if (rank >= 15) return { rarity: "covert",     label: "SUPREME", star: "★ COMP",    floatLabel: "tier · supreme" };
    if (rank >= 13) return { rarity: "classified", label: "SUPREME", star: "★ COMP",    floatLabel: "tier · supreme mfc" };
    if (rank >= 11) return { rarity: "restricted", label: "LEM",     star: "COMP",       floatLabel: "tier · legendary" };
    if (rank >= 9)  return { rarity: "knife",      label: "★ DMG",   star: "COMP",       floatLabel: "tier · dmg" };
    if (rank >= 6)  return { rarity: "knife",      label: "MG",      star: "COMP",       floatLabel: "tier · master guardian" };
    if (rank >= 3)  return { rarity: "knife",      label: "GN",      star: "COMP",       floatLabel: "tier · gold nova" };
    return { rarity: "knife", label: "SILVER", star: "COMP", floatLabel: "tier · silver" };
  };

  const dateLabel = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short",
      });
    } catch (_) { return ""; }
  };

  /* Bar widths normalised against sensible per-stat max values, so the
   * progress bars feel meaningful regardless of the absolute number. */
  const BAR_MAX = {
    kd: 3.0,
    hsPct: 100,
    adr: 150,
    premier: 35000,
    winratePct: 100,
    leetifyRating: 10,
  };
  const setBar = (key, value) => {
    if (value == null || isNaN(value)) return;
    const max = BAR_MAX[key] || 100;
    const pct = Math.max(2, Math.min(100, (Number(value) / max) * 100));
    const pctStr = `${pct.toFixed(1)}%`;
    getBarEls(key).forEach((el) => {
      el.style.setProperty("--p", pctStr);
    });
  };

  const NUMERIC_FMTS = new Set(["int", "intpct", "intms", "dec1", "dec1pct", "dec2"]);
  const setText = (key, raw, formatter = "raw") => {
    const v = (raw == null) ? "—" : (fmt[formatter] ? fmt[formatter](raw) : String(raw));
    const isNumeric = typeof raw === "number" && NUMERIC_FMTS.has(formatter);
    getBindEls(key).forEach((el) => {
      // Counter animations key off [data-counter]; convert numeric values
      // when the formatter is one of the numeric ones.
      if (isNumeric) {
        el.dataset.counter = String(raw);
        el.dataset.fmtMode = formatter;
      }
      el.textContent = v;
    });
  };

  const renderLast10 = (last10) => {
    const list = $('[data-bind="last10"]');
    if (!list) return;
    list.innerHTML = "";
    const frag = document.createDocumentFragment();
    let wins = 0, losses = 0, ties = 0;
    last10.forEach((m) => {
      if (m.outcome === "win") wins += 1;
      else if (m.outcome === "loss") losses += 1;
      else ties += 1;
      const li = document.createElement("li");
      const a = document.createElement("a");
      const cls = m.outcome === "win" ? "form-pill--win"
                 : m.outcome === "loss" ? "form-pill--loss"
                 : "form-pill--tie";
      a.className = `form-pill ${cls}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = m.outcome === "win" ? "W" : m.outcome === "loss" ? "L" : "T";
      a.title = `${m.outcome[0].toUpperCase() + m.outcome.slice(1)} · ${m.map} · ${m.score?.[0] ?? "-"}:${m.score?.[1] ?? "-"} · ${dateLabel(m.finishedAt)}`;
      // CSStats accepts the `data_source_match_id` (CSGO-XXX) hash and the
      // matchmaking match GUID as scoreboard URLs. Linking to Leetify's
      // match page is the safest universal fallback.
      a.href = m.id
        ? `https://leetify.com/app/match-details/${encodeURIComponent(m.id)}`
        : `https://leetify.com/app/profile/76561198055425103#match-history`;
      li.appendChild(a);
      frag.appendChild(li);
    });
    list.appendChild(frag);
    const summaryEl = $('[data-bind="last10Summary"]');
    if (summaryEl) {
      summaryEl.textContent = ties > 0
        ? `${wins}W · ${losses}L · ${ties}T`
        : `${wins}W · ${losses}L`;
    }
  };

  const renderMapPool = (mapPool) => {
    const grid = $('[data-bind="mapPool"]');
    if (!grid) return;
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    const RANK_MAX = 18;
    const sorted = [...mapPool].sort((a, b) => b.rank - a.rank);
    const top = sorted[0];
    sorted.slice(0, 8).forEach((m) => {
      const tier = rankToTier(m.rank);
      const isBest = top && m.map === top.map;
      const a = document.createElement("a");
      a.className = "weapon";
      a.dataset.source = "leetify";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.href = "https://leetify.com/app/profile/76561198055425103#maps";
      a.setAttribute("aria-label", `${m.map}, rank ${m.rank} of ${RANK_MAX}`);

      const pct = Math.max(4, Math.min(100, (m.rank / RANK_MAX) * 100));
      a.innerHTML = `
        <header class="weapon__head">
          <span class="weapon__rarity weapon__rarity--${tier.rarity}">${tier.label}</span>
          <span class="weapon__stat">${isBest ? "★ BEST MAP" : tier.star}</span>
        </header>
        <h3 class="weapon__name">${m.map.toUpperCase()}</h3>
        <p class="weapon__skin">Rank ${m.rank} / ${RANK_MAX}</p>
        <div class="weapon__bar"><i style="--p: ${pct.toFixed(1)}%"></i></div>
        <span class="weapon__float">${tier.floatLabel}</span>
      `;
      frag.appendChild(a);
    });
    grid.appendChild(frag);
    bindTilt(grid);
  };

  /* Build the animated tagline used by the typewriter effect. */
  const buildTagline = (data) => {
    const parts = ["// CS2"];
    if (data.wingman === 18) parts.push("Wingman MAX");
    else if (data.wingman != null) parts.push(`Wingman ${data.wingman}/18`);
    if (data.totalMatches != null) parts.push(`${fmt.int(data.totalMatches)} matches`);
    if (data.winratePct != null) parts.push(`${data.winratePct}% Premier WR`);
    if (data.leetifyRating != null) parts.push(`Leetify ${fmt.dec2(data.leetifyRating)}`);
    parts.push("Слава Україні!");
    return parts.join(" · ");
  };

  const updatedLabel = (iso, stale) => {
    if (stale) return "snapshot · live api unavailable";
    if (!iso) return "synced just now";
    try {
      const d = new Date(iso);
      const time = d.toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Kyiv"
      });
      return `synced ${time} EET`;
    } catch (_) { return "synced"; }
  };

  const bindData = (data) => {
    /* Hero / chrome */
    setText("name", data.name);
    setText("premier", data.premier, "int");
    setText("totalMatches", data.totalMatches, "int");
    setText("leetifyRating", data.leetifyRating, "dec2");
    setText("wingmanLabel", data.wingman === 18 ? "18 · MAX" : (data.wingman != null ? `${data.wingman} / 18` : "—"));
    setText("rankSuffix", data.stale
      ? "CS RATING · LEETIFY · LAST KNOWN"
      : "CS RATING · LIVE FROM LEETIFY");

    /* STATS grid (last 25) */
    setText("kd", data.last25.kd, "dec2"); setBar("kd", data.last25.kd);
    setText("hsPct", data.last25.hsPct, "int"); setBar("hsPct", data.last25.hsPct);
    setText("adr", data.last25.adr, "int"); setBar("adr", data.last25.adr);
    setText("winratePct", data.last25.winratePct, "int"); setBar("winratePct", data.last25.winratePct);
    setBar("premier", data.premier);
    setBar("leetifyRating", data.leetifyRating);

    /* Skills row */
    setText("aim", data.skills.aim, "dec1");
    setText("positioning", data.skills.positioning, "dec1");
    setText("hsAccuracyPct", data.skills.hsAccuracyPct, "dec1pct");
    setText("counterStrafePct", data.skills.counterStrafePct, "dec1pct");
    setText("reactionMs", data.skills.reactionMs, "intms");

    /* Last 100 aggregate row */
    setText("last100Matches", data.last100.matches, "int");
    setText("last100MatchesLabel", data.last100.matches);
    setText("last100WinratePct", data.last100.winratePct, "intpct");
    setText("last100Kills", data.last100.kills, "int");
    setText("last100Deaths", data.last100.deaths, "int");
    setText("last100Damage", data.last100.damage, "int");
    setText("last100Headshots", data.last100.headshots, "int");
    setText("last100Rounds", data.last100.rounds, "int");

    /* Profile-link helper text */
    const handleParts = [];
    if (data.leetifyRating != null) handleParts.push(`rating ${fmt.dec2(data.leetifyRating)}`);
    if (data.last25.kd != null) handleParts.push(`K/D ${fmt.dec2(data.last25.kd)}`);
    if (data.winratePct != null) handleParts.push(`${data.winratePct}% Premier WR`);
    setText("leetifyLinkHandle", handleParts.join(" · ") || "live stats");

    /* Updated label in the footer */
    setText("updatedAt", updatedLabel(data.fetchedAt, data.stale));

    /* Dynamic lists */
    renderLast10(data.last10);
    renderMapPool(data.mapPool);

    /* Tagline */
    const typer = document.querySelector(".typewriter");
    if (typer) typer.dataset.text = buildTagline(data);
  };

  /* ====================================================================
     3) Counter & typewriter animations (run after data is bound)
     ==================================================================== */

  const animateCounter = (el) => {
    const end = parseFloat(el.dataset.counter);
    if (isNaN(end)) return;
    const formatter = el.dataset.fmtMode;
    const duration = 1400;
    const startT = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - startT) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = end * eased;
      if (formatter && fmt[formatter]) {
        el.textContent = fmt[formatter](v);
      } else {
        // Fallback for legacy [data-counter][data-decimals] shape
        const decimals = parseInt(el.dataset.decimals || "0", 10);
        el.textContent = decimals
          ? v.toFixed(decimals)
          : Math.round(v).toLocaleString("en-US");
      }
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = formatter && fmt[formatter] ? fmt[formatter](end) : end.toLocaleString("en-US");
    };
    requestAnimationFrame(tick);
  };

  const runCounters = () => {
    const counters = document.querySelectorAll("[data-counter]");
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            animateCounter(e.target);
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.4 });
      counters.forEach((c) => io.observe(c));
    } else {
      counters.forEach(animateCounter);
    }
  };

  const runTypewriter = () => {
    const typer = document.querySelector(".typewriter");
    if (!typer) return;
    const full = typer.dataset.text || typer.textContent || "";
    typer.textContent = "";
    let i = 0;
    const step = () => {
      if (i <= full.length) {
        typer.textContent = full.slice(0, i++);
        setTimeout(step, 55 + Math.random() * 40);
      }
    };
    setTimeout(step, 350);
  };

  /* ====================================================================
     4) Boot — show preloader, fetch data, render, hide preloader
     ==================================================================== */

  const setStatus = (msg) => {
    const el = document.getElementById("preloaderStatus");
    if (el) el.textContent = msg;
  };

  const hidePreloader = () => {
    const pre = document.getElementById("preloader");
    if (!pre) return;
    pre.classList.add("preloader--hidden");
    document.body.classList.remove("is-loading");
    document.body.classList.add("is-ready");
    // Remove from the DOM after the transition so it can never trap focus.
    setTimeout(() => pre.remove(), 700);
  };

  const boot = async () => {
    setStatus("connecting · leetify api");
    let data = null;
    try {
      const promise = window.RostovData.load();
      // Show a soft progress message after a short delay so users know
      // we're really doing something.
      setTimeout(() => setStatus("aggregating last 100 matches…"), 600);
      data = await promise;
      setStatus("rendering live stats");
    } catch (err) {
      console.warn("[ROSTOV] Live data unavailable, using snapshot:", err);
      data = { ...window.RostovData.FALLBACK, stale: true };
      setStatus("offline · using last snapshot");
    }

    bindData(data);
    bindTilt();

    // Tiny pause so users can perceive the loader before it fades.
    const minLoaderMs = 450;
    const elapsed = performance.now() - bootStart;
    setTimeout(() => {
      hidePreloader();
      // Animations look best when started after the card has appeared.
      requestAnimationFrame(() => {
        runTypewriter();
        runCounters();
      });
    }, Math.max(0, minLoaderMs - elapsed));
  };

  const bootStart = performance.now();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
