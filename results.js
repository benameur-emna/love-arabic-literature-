/* results.js — Results page (robust CSV parsing + interactive genre toggles) */
const GENRE_MAP = {
  b: "BIO", // Biography
  d: "DEV", // Devotional / religious
  n: "PHI", // Philosophy
  p: "POE", // Poetry
  r: "RHE", // Rhetoric / adab
  k: "THE", // Theology / kalam
};

function normalizeGenre(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // if already BIO/DEV/...
  if (["BIO","DEV","PHI","POE","RHE","THE"].includes(s.toUpperCase())) return s.toUpperCase();
  const key = s.toLowerCase();
  return GENRE_MAP[key] ?? null;
}

document.addEventListener("DOMContentLoaded", async () => {
  const CSV_PATH = "data/BoC_v3_EXTENDED_scored.csv";

  // Genres shown on site
  const GENRES = ["BIO", "DEV", "PHI", "POE", "RHE", "THE"];

  // Your preferred palette (kept as-is)
  const COLORS = {
    BIO: "#1E1916",  // ink (almost black)
    DEV: "#0E3A45",  // deep teal
    PHI: "#3E2A61",  // deep violet
    POE: "#7A2C2A",  // garnet
    RHE: "#C46A74",  // dusty rose (brighter)
    THE: "#C39A6B",   // (comment said green, but we keep your value)
  };

  // ---------------- helpers
  const norm = (s) => String(s ?? "").trim();
  const lower = (s) => norm(s).toLowerCase();

  function findColumn(columns, candidates) {
    const cols = columns.map((c) => ({ raw: c, low: lower(c) }));
    for (const cand of candidates) {
      const cLow = cand.toLowerCase();
      const hit = cols.find((c) => c.low === cLow);
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
    // extracts first number safely (handles "400 AH", "400/...", etc.)
    const m = String(x ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
    const n = m ? +m[0] : NaN;
    return Number.isFinite(n) ? n : null;
  }

  function toCenturyFromYear(y) {
    return Math.floor((y - 1) / 100) + 1;
  }

  // IMPORTANT: in your CSV, `date` is a century index (1,2,3,...)
  // but we still support year-like values if they appear.
  function inferCenturyFromValue(v) {
    if (v == null) return null;

    // If it's a small integer: treat as century already
    if (v >= 1 && v <= 30) return Math.round(v);

    // If it's a year (AH): convert to century
    if (v >= 50 && v <= 2000) {
      const c = toCenturyFromYear(v);
      if (c >= 1 && c <= 30) return c;
    }
    return null;
  }

  function inferGenre(row, genreCol) {
    const v = norm(row[genreCol]);
    if (!v) return null;

    // direct
    const u = v.toUpperCase();
    if (GENRES.includes(u)) return u;

    // map GenreCode (b/d/n/p/r/k)
    const mapped = normalizeGenre(v);
    if (mapped) return mapped;

    // fallback: "POE - Poetic (...)" is in GenreLabel; sometimes GenreCode isn't clean
    const found = GENRES.find((g) => u.includes(g));
    return found || null;
  }

  function showError(selector, msg) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.innerHTML = `<p style="padding:1rem">${msg}</p>`;
  }

  // ---------------- load CSV
  let raw;
  try {
    raw = await d3.csv(CSV_PATH);
  } catch (e) {
    console.error(e);
    showError("#chart-global", `Could not load CSV at <code>${CSV_PATH}</code>. Check path and server.`);
    showError("#chart-genre", `Could not load CSV at <code>${CSV_PATH}</code>.`);
    showError("#chart-scatter", `Could not load CSV at <code>${CSV_PATH}</code>.`);
    return;
  }

  if (!raw || !raw.columns) {
    showError("#chart-global", "CSV loaded but columns are missing.");
    return;
  }

  const columns = raw.columns;

  // ---------------- detect key columns (adapted to your headers)
  const genreCodeCol = findColumn(columns, ["GenreCode"]) || findColumnFuzzy(columns, ["genrecode"]);
  const genreLabelCol = findColumn(columns, ["GenreLabel"]) || findColumnFuzzy(columns, ["genrelabel"]);

  // your CSV uses `date` for century index
  const dateCol = findColumn(columns, ["date", "Date"]) || findColumnFuzzy(columns, ["date"]);

  const loveCol =
    findColumn(columns, ["BoC_final_0_2"]) ||
    findColumn(columns, ["boc_final_0_2", "loveindex", "LoveIndex", "love_index"]) ||
    findColumnFuzzy(columns, ["boc_final", "love", "index"]);

  const titleCol =
    findColumn(columns, ["title_lat", "title", "Title", "book_title", "work_title"]) ||
    findColumnFuzzy(columns, ["title"]);

  const authorCol =
    findColumn(columns, ["author_lat", "author", "Author", "author_name"]) ||
    findColumnFuzzy(columns, ["author"]);

  const uriCol =
    findColumn(columns, ["version_uri", "uri", "URI", "work_id", "id", "ID"]) ||
    findColumnFuzzy(columns, ["version_uri", "uri", "id"]);

  // pick a genre column to read
  const genreCol = genreCodeCol || genreLabelCol;

  if (!genreCol || !loveCol || !dateCol) {
    showError(
      "#chart-global",
      `Could not detect required columns.<br/>
      genre=<code>${genreCol || "none"}</code> · date=<code>${dateCol || "none"}</code> · love=<code>${loveCol || "none"}</code><br/>
      Columns: <code>${columns.join(", ")}</code>`
    );
    return;
  }

  // ---------------- normalize rows
  const rows = [];
  for (const r of raw) {
    const genre = inferGenre(r, genreCol);
    if (!genre) continue;

    const v = coerceNumber(r[dateCol]);
    const century = inferCenturyFromValue(v);
    if (!century) continue;

    // keep your window 1..15 (since your data clearly has century=1)
    if (century < 1 || century > 15) continue;

    const love = coerceNumber(r[loveCol]);
    if (love == null) continue;

    const loveClamped = Math.max(0, Math.min(2, love));
    const title = titleCol ? norm(r[titleCol]) : "";
    const author = authorCol ? norm(r[authorCol]) : "";
    const uri = uriCol ? norm(r[uriCol]) : "";

    rows.push({ genre, century, love: loveClamped, title, author, uri });
  }

  if (rows.length < 20) {
    showError(
      "#chart-global",
      `Data loaded but too few usable rows after parsing (${rows.length}).<br/>
      genreCol=<code>${genreCol}</code> · dateCol=<code>${dateCol}</code> · loveCol=<code>${loveCol}</code>`
    );
    return;
  }

  // ---------------- aggregates
  const centuries = d3.range(1, 16); // 1..15

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

  // ---------------- fill stats (still hard-coded like you had)
  setText("q_century", "−0.1228 (p < 0.001)");
  setText("q_century2", "+0.0065 (p < 0.001)");
  setText("q_r2", "0.027");
  setText("q_interp", "The positive quadratic term indicates curvature: after a long decline, the trend bends upward in later centuries.");

  setText("s_century", "−0.0527 (p < 0.001)");
  setText("s_post12", "+1.8875 (p < 0.001)");
  setText("s_cpost12", "−0.0955 (p = 0.007)");
  setText("s_r2", "0.041");
  setText("s_interp", "The model detects a break, but the post-12 period does not form a clean recovery slope. This suggests a change in dynamics rather than a simple monotonic return.");

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  // ---------------- render
  drawGlobalLine("#chart-global", pooled);
  drawGenreLines("#chart-genre", byGenre);
  drawScatter("#chart-scatter", rows);
  renderSpotlights(rows);

  // ============================================================
  // Charts
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

    const x = d3.scaleLinear().domain([1, 15]).range([0, plotW]);
    const y = d3.scaleLinear().domain([0, 2]).range([plotH, 0]);

    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-plotW).tickFormat(""))
      .attr("opacity", 0.18);

    g.append("g")
      .attr("transform", `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(15).tickFormat(d3.format("d")));

    g.append("g").call(d3.axisLeft(y).ticks(5));

    const line = d3
      .line()
      .x((d) => x(d.century))
      .y((d) => y(d.mean))
      .curve(d3.curveMonotoneX);

    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", COLORS.POE) // garnet
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

    const x = d3.scaleLinear().domain([1, 15]).range([0, plotW]);
    const y = d3.scaleLinear().domain([0, 2]).range([plotH, 0]);

    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-plotW).tickFormat(""))
      .attr("opacity", 0.18);

    g.append("g")
      .attr("transform", `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(15).tickFormat(d3.format("d")));

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

  function drawScatter(selector, rows) {
    const container = document.querySelector(selector);
    if (!container) return;

    const { svg, width, height } = baseSvg(container, 520);
    const margin = { top: 22, right: 120, bottom: 44, left: 54 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([1, 15]).range([0, plotW]);
    const y = d3.scaleLinear().domain([0, 2]).range([plotH, 0]);

    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-plotW).tickFormat(""))
      .attr("opacity", 0.16);

    g.append("g")
      .attr("transform", `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(15).tickFormat(d3.format("d")));
    g.append("g").call(d3.axisLeft(y).ticks(5));

    const tip = addTip(container);
    const hidden = new Set();

    const dots = g
      .append("g")
      .selectAll("circle")
      .data(rows)
      .enter()
      .append("circle")
      .attr("cx", (d) => x(d.century))
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
             <span style="opacity:.9">${d.genre} · century ${d.century} AH · Love Index: ${d.love.toFixed(
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
  // Spotlights
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
      li.innerHTML = `<strong>${t}</strong>${a}<br/><span class="note">${d.genre} · century ${d.century} AH · LoveIndex: ${d.love.toFixed(
        3
      )}</span>`;
      return li;
    }
  }
});
