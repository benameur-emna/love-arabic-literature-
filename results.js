/* results.js — Results page (robust CSV parsing + interactive genre toggles + continuous scatter) */

document.addEventListener("DOMContentLoaded", async () => {
  const CSV_PATH = "data/BoC_v3_EXTENDED_scored.csv";

  // Genres shown on site
  const GENRES = ["BIO", "DEV", "PHI", "POE", "RHE", "THE"];

  // ✅ Keep your preferred palette
  const COLORS = {
    BIO: "#1E1916",  // ink (almost black)
    DEV: "#0E3A45",  // deep teal
    PHI: "#3E2A61",  // deep violet
    POE: "#7A2C2A",  // garnet
    RHE: "#C46A74",  // dusty rose
    THE: "#C39A6B",  // tan
  };

  // Map your CSV GenreCode to your 6 genres
  const GENRE_MAP = {
    b: "BIO",
    d: "DEV",
    n: "PHI",
    p: "POE",
    r: "RHE",
    k: "THE",
  };

  // ---------- helpers
  const norm = (s) => String(s ?? "").trim();
  const lower = (s) => norm(s).toLowerCase();

  function findColumn(columns, candidates) {
    const cols = columns.map((c) => ({ raw: c, low: lower(c) }));
    for (const cand of candidates) {
      const hit = cols.find((c) => c.low === cand.toLowerCase());
      if (hit) return hit.raw;
    }
    return null;
  }

  function findColumnFuzzy(columns, includesAny) {
    const cols = columns.map((c) => ({ raw: c, low: lower(c) }));
    for (const inc of includesAny) {
      const hit = cols.find((c) => c.low.includes(inc.toLowerCase()));
      if (hit) return hit.raw;
    }
    return null;
  }

  function coerceNumber(x) {
    const n = +String(x ?? "").replace(",", ".").trim();
    return Number.isFinite(n) ? n : null;
  }

  function showError(selector, msg) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.innerHTML = `<p style="padding:1rem">${msg}</p>`;
  }

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  // stable hash → stable jitter (so points don't move on refresh)
  function hashToUnit(str) {
    const s = String(str ?? "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // map to [0,1)
    return (h >>> 0) / 4294967296;
  }

  // ✅ genre normalization (handles GenreCode = 'p' etc)
  function normalizeGenre(raw) {
    if (!raw) return null;
    const s = norm(raw);

    // already full tag?
    const up = s.toUpperCase();
    if (GENRES.includes(up)) return up;

    // single-letter code
    const k = s.toLowerCase();
    if (GENRE_MAP[k]) return GENRE_MAP[k];

    // if GenreLabel like "POE - Poetic (...)"
    for (const g of GENRES) {
      if (up.startsWith(g)) return g;
    }
    return null;
  }

  // Your `date` column looks like century AH (1..15)
  function inferCenturyFromDate(v) {
    const n = coerceNumber(v);
    if (n == null) return null;

    // treat as century if small integer
    if (n >= 1 && n <= 30) return Math.round(n);

    // otherwise could be year AH (not your case here, but safe)
    if (n >= 50 && n <= 2000) {
      const c = Math.floor((n - 1) / 100) + 1;
      return c >= 1 && c <= 30 ? c : null;
    }
    return null;
  }

  // ---------- load CSV
  let raw;
  try {
    raw = await d3.csv(CSV_PATH);
  } catch (e) {
    console.error(e);
    showError("#chart-global", `Could not load CSV at <code>${CSV_PATH}</code>. Check path + server.`);
    showError("#chart-genre", `Could not load CSV at <code>${CSV_PATH}</code>.`);
    showError("#chart-scatter", `Could not load CSV at <code>${CSV_PATH}</code>.`);
    return;
  }

  if (!raw || !raw.columns) {
    showError("#chart-global", "CSV loaded but columns are missing.");
    return;
  }

  const columns = raw.columns;

  // ---------- detect key columns (match your header)
  const genreCol =
    findColumn(columns, ["GenreCode", "genrecode", "genre_code", "genre"]) ||
    findColumnFuzzy(columns, ["genre"]);

  const dateCol =
    findColumn(columns, ["date", "Date", "century", "Century", "century_ah"]) ||
    findColumnFuzzy(columns, ["date", "century"]);

  const loveCol =
    findColumn(columns, ["BoC_final_0_2", "boc_final_0_2"]) ||
    findColumnFuzzy(columns, ["boc_final_0_2", "boc_final"]);

  const titleCol =
    findColumn(columns, ["title_lat", "title", "Title"]) ||
    findColumnFuzzy(columns, ["title"]);

  const authorCol =
    findColumn(columns, ["author_lat", "author", "Author"]) ||
    findColumnFuzzy(columns, ["author"]);

  const uriCol =
    findColumn(columns, ["version_uri", "uri", "URI", "id", "ID"]) ||
    findColumnFuzzy(columns, ["uri", "id"]);

  if (!genreCol || !loveCol || !dateCol) {
    showError(
      "#chart-global",
      `Could not detect required columns.<br/>
      genre=<code>${genreCol || "none"}</code> · love=<code>${loveCol || "none"}</code> · date/century=<code>${dateCol || "none"}</code><br/>
      Columns: <code>${columns.join(", ")}</code>`
    );
    return;
  }

  // ---------- normalize rows
  const rows = [];
  for (const r of raw) {
    const genre = normalizeGenre(r[genreCol]) || normalizeGenre(r["GenreLabel"]);
    if (!genre) continue;

    const century = inferCenturyFromDate(r[dateCol]);
    if (!century) continue;

    const love = coerceNumber(r[loveCol]);
    if (love == null) continue;

    const loveClamped = Math.max(0, Math.min(2, love));

    const title = titleCol ? norm(r[titleCol]) : "";
    const author = authorCol ? norm(r[authorCol]) : "";
    const uri = uriCol ? norm(r[uriCol]) : "";

    // ✅ continuous time (approx): spread within century with STABLE jitter
    const baseYear = (century - 1) * 100;       // start of century
    const jitter = Math.floor(hashToUnit(uri || title || author) * 100); // 0..99 stable
    const yearApprox = baseYear + jitter + 1;   // 1..100 within century

    rows.push({
      genre,
      century,
      year: yearApprox,
      love: loveClamped,
      title,
      author,
      uri
    });
  }

  if (rows.length < 20) {
    showError(
      "#chart-global",
      `Data loaded but too few usable rows after parsing (${rows.length}).<br/>
      genreCol=<code>${genreCol}</code> · loveCol=<code>${loveCol}</code> · dateCol=<code>${dateCol}</code>`
    );
    return;
  }

  // ---------- aggregates (by century)
  const MIN_C = 2;    // keep your results page framing
  const MAX_C = 15;
  const centuries = d3.range(MIN_C, MAX_C + 1);

  const pooled = centuries
    .map((c) => {
      const vals = rows.filter((r) => r.century === c).map((r) => r.love);
      return { century: c, mean: vals.length ? d3.mean(vals) : null, n: vals.length };
    })
    .filter((d) => d.mean != null);

  const byGenre = [];
  for (const g of GENRES) {
    const series = centuries
      .map((c) => {
        const vals = rows.filter((r) => r.genre === g && r.century === c).map((r) => r.love);
        return { century: c, mean: vals.length ? d3.mean(vals) : null, n: vals.length };
      })
      .filter((d) => d.mean != null);
    byGenre.push({ genre: g, values: series });
  }

  // ---------- stats numbers (your current displayed ones)
  setText("q_century", "−0.1228 (p < 0.001)");
  setText("q_century2", "+0.0065 (p < 0.001)");
  setText("q_r2", "0.027");
  setText(
    "q_interp",
    "The positive quadratic term indicates curvature: after a long decline, the trend bends upward in later centuries."
  );

  setText("s_century", "−0.0527 (p < 0.001)");
  setText("s_post12", "+1.8875 (p < 0.001)");
  setText("s_cpost12", "−0.0955 (p = 0.007)");
  setText("s_r2", "0.041");
  setText(
    "s_interp",
    "The model detects a break, but the post-12 period does not form a clean recovery slope. This suggests a change in dynamics rather than a simple monotonic return."
  );

  // ---------- render charts
  drawGlobalLine("#chart-global", pooled);
  drawGenreLines("#chart-genre", byGenre);
  drawScatterContinuous("#chart-scatter", rows);
  renderSpotlights(rows);

  // ============================================================
  // Charts helpers
  // ============================================================

  function baseSvg(container, height = 420) {
    container.innerHTML = "";
    const width = Math.max(740, container.clientWidth || 740);
    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", "100%");
    return { svg, width, height };
  }

  function addTip(container) {
    return d3.select(container).append("div").attr("class", "viztip").style("opacity", 0);
  }

  function drawGlobalLine(selector, data) {
    const container = document.querySelector(selector);
    if (!container) return;

    const { svg, width, height } = baseSvg(container, 420);
    const margin = { top: 28, right: 24, bottom: 44, left: 54 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([MIN_C, MAX_C]).range([0, plotW]);
    const y = d3.scaleLinear().domain([0, 2]).range([plotH, 0]);

    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-plotW).tickFormat(""))
      .attr("opacity", 0.18);

    g.append("g")
      .attr("transform", `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(MAX_C - MIN_C).tickFormat(d3.format("d")));

    g.append("g").call(d3.axisLeft(y).ticks(5));

    const line = d3
      .line()
      .x((d) => x(d.century))
      .y((d) => y(d.mean))
      .curve(d3.curveMonotoneX);

    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", COLORS.POE)
      .attr("stroke-width", 2.6)
      .attr("opacity", 0.95)
      .attr("d", line);

    const tip = addTip(container);

    g.selectAll("circle")
      .data(data)
      .enter()
      .append("circle")
      .attr("cx", (d) => x(d.century))
      .attr("cy", (d) => y(d.mean))
      .attr("r", 3.2)
      .attr("fill", COLORS.POE)
      .attr("opacity", 0.0)
      .on("mouseenter", (event, d) => {
        d3.select(event.currentTarget).attr("opacity", 0.95);
        tip
          .style("opacity", 1)
          .html(
            `<strong>All genres</strong> · century ${d.century} AH<br/>mean Love Index: ${d.mean.toFixed(
              3
            )}<br/>n=${d.n}`
          )
          .style("left", `${event.offsetX + 12}px`)
          .style("top", `${event.offsetY - 8}px`);
      })
      .on("mousemove", (event) => {
        tip.style("left", `${event.offsetX + 12}px`).style("top", `${event.offsetY - 8}px`);
      })
      .on("mouseleave", (event) => {
        d3.select(event.currentTarget).attr("opacity", 0.0);
        tip.style("opacity", 0);
      });
  }

  function drawGenreLines(selector, seriesByGenre) {
    const container = document.querySelector(selector);
    if (!container) return;

    const { svg, width, height } = baseSvg(container, 440);
    const margin = { top: 28, right: 120, bottom: 44, left: 54 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([MIN_C, MAX_C]).range([0, plotW]);
    const y = d3.scaleLinear().domain([0, 2]).range([plotH, 0]);

    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-plotW).tickFormat(""))
      .attr("opacity", 0.18);

    g.append("g")
      .attr("transform", `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(MAX_C - MIN_C).tickFormat(d3.format("d")));

    g.append("g").call(d3.axisLeft(y).ticks(5));

    const line = d3
      .line()
      .x((d) => x(d.century))
      .y((d) => y(d.mean))
      .curve(d3.curveMonotoneX);

    const hidden = new Set();
    const tip = addTip(container);
    const paths = new Map();
    const pts = new Map();

    for (const s of seriesByGenre) {
      const k = s.genre;

      const p = g
        .append("path")
        .datum(s.values)
        .attr("fill", "none")
        .attr("stroke", COLORS[k] || "#999")
        .attr("stroke-width", 2.4)
        .attr("opacity", 0.92)
        .attr("d", line);

      paths.set(k, p);

      const circles = g
        .selectAll(`.pt-${k}`)
        .data(s.values)
        .enter()
        .append("circle")
        .attr("class", `pt pt-${k}`)
        .attr("cx", (d) => x(d.century))
        .attr("cy", (d) => y(d.mean))
        .attr("r", 3.0)
        .attr("fill", COLORS[k] || "#999")
        .attr("opacity", 0.0)
        .on("mouseenter", (event, d) => {
          if (hidden.has(k)) return;
          d3.select(event.currentTarget).attr("opacity", 0.95);
          tip
            .style("opacity", 1)
            .html(
              `<strong>${k}</strong> · century ${d.century} AH<br/>mean Love Index: ${d.mean.toFixed(
                3
              )}<br/>n=${d.n}`
            )
            .style("left", `${event.offsetX + 12}px`)
            .style("top", `${event.offsetY - 8}px`);
        })
        .on("mousemove", (event) => {
          tip.style("left", `${event.offsetX + 12}px`).style("top", `${event.offsetY - 8}px`);
        })
        .on("mouseleave", (event) => {
          d3.select(event.currentTarget).attr("opacity", 0.0);
          tip.style("opacity", 0);
        });

      pts.set(k, circles);
    }

    const lg = g.append("g").attr("transform", `translate(${plotW + 18}, 8)`);

    GENRES.forEach((k, i) => {
      const row = lg
        .append("g")
        .attr("transform", `translate(0, ${i * 20})`)
        .attr("class", "legend-clickable")
        .on("click", () => toggle(k, row));

      row
        .append("rect")
        .attr("width", 12)
        .attr("height", 12)
        .attr("rx", 3)
        .attr("y", -9)
        .attr("fill", COLORS[k] || "#999");

      row
        .append("text")
        .attr("x", 18)
        .attr("y", 0)
        .style("font-size", "12px")
        .style("font-weight", 800)
        .text(k);

      function toggle(genre, rowSel) {
        if (hidden.has(genre)) hidden.delete(genre);
        else hidden.add(genre);

        const isOff = hidden.has(genre);
        rowSel.classed("is-off", isOff);

        const path = paths.get(genre);
        const cir = pts.get(genre);
        if (path) path.attr("display", isOff ? "none" : null);
        if (cir) cir.attr("display", isOff ? "none" : null);
        tip.style("opacity", 0);
      }
    });
  }

  // ============================================================
  // ✅ Scatter — CONTINUOUS time axis (year approx)
  // ============================================================
  function drawScatterContinuous(selector, rows) {
    const container = document.querySelector(selector);
    if (!container) return;

    const { svg, width, height } = baseSvg(container, 520);
    const margin = { top: 22, right: 120, bottom: 44, left: 54 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const xMin = d3.min(rows, (d) => d.year);
    const xMax = d3.max(rows, (d) => d.year);

    const x = d3.scaleLinear().domain([xMin, xMax]).range([0, plotW]);
    const y = d3.scaleLinear().domain([0, 2]).range([plotH, 0]);

    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-plotW).tickFormat(""))
      .attr("opacity", 0.16);

    g.append("g")
      .attr("transform", `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(12).tickFormat(d3.format("d")));

    g.append("g").call(d3.axisLeft(y).ticks(5));

    const tip = addTip(container);
    const hidden = new Set();

    const dots = g
      .append("g")
      .selectAll("circle")
      .data(rows)
      .enter()
      .append("circle")
      .attr("cx", (d) => x(d.year))
      .attr("cy", (d) => y(d.love))
      .attr("r", 2.7)
      .attr("fill", (d) => COLORS[d.genre] || "#999")
      .attr("opacity", 0.70);

    dots
      .on("mouseenter", (event, d) => {
        if (hidden.has(d.genre)) return;
        d3.select(event.currentTarget).attr("r", 4.2).attr("opacity", 0.95);
        const title = d.title || "(title unavailable)";
        const author = d.author || "(author unavailable)";
        tip
          .style("opacity", 1)
          .html(
            `<strong>${title}</strong><br/>${author}<br/>
             <span style="opacity:.9">${d.genre} · ~${Math.round(d.year)} AH · Love Index: ${d.love.toFixed(
              3
            )}</span>`
          )
          .style("left", `${event.offsetX + 12}px`)
          .style("top", `${event.offsetY - 8}px`);
      })
      .on("mousemove", (event) => {
        tip.style("left", `${event.offsetX + 12}px`).style("top", `${event.offsetY - 8}px`);
      })
      .on("mouseleave", (event) => {
        d3.select(event.currentTarget).attr("r", 2.7).attr("opacity", 0.70);
        tip.style("opacity", 0);
      });

    // legend toggle
    const lg = g.append("g").attr("transform", `translate(${plotW + 18}, 8)`);

    GENRES.forEach((k, i) => {
      const row = lg
        .append("g")
        .attr("transform", `translate(0, ${i * 20})`)
        .attr("class", "legend-clickable")
        .on("click", () => toggle(k, row));

      row
        .append("rect")
        .attr("width", 12)
        .attr("height", 12)
        .attr("rx", 3)
        .attr("y", -9)
        .attr("fill", COLORS[k] || "#999");

      row
        .append("text")
        .attr("x", 18)
        .attr("y", 0)
        .style("font-size", "12px")
        .style("font-weight", 800)
        .text(k);

      function toggle(genre, rowSel) {
        if (hidden.has(genre)) hidden.delete(genre);
        else hidden.add(genre);

        const isOff = hidden.has(genre);
        rowSel.classed("is-off", isOff);

        dots.attr("display", (d) => (hidden.has(d.genre) ? "none" : null));
        tip.style("opacity", 0);
      }
    });
  }

  // ============================================================
  // Spotlights (top/bottom)
  // ============================================================
  function renderSpotlights(rows) {
    const topEl = document.getElementById("top-texts");
    const botEl = document.getElementById("bottom-texts");
    if (!topEl || !botEl) return;

    topEl.innerHTML = "";
    botEl.innerHTML = "";

    const sorted = [...rows].sort((a, b) => b.love - a.love);
    const top = sorted.slice(0, 5);
    const bottom = sorted.slice(-5).reverse();

    for (const d of top) topEl.appendChild(liText(d));
    for (const d of bottom) botEl.appendChild(liText(d));

    function liText(d) {
      const li = document.createElement("li");
      const t = d.title || "(title unavailable)";
      const a = d.author ? ` — ${d.author}` : "";
      li.innerHTML = `<strong>${t}</strong>${a}<br/><span class="note">${d.genre} · ~${Math.round(
        d.year
      )} AH · LoveIndex: ${d.love.toFixed(3)}</span>`;
      return li;
    }
  }
});
