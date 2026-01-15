/* data.js — DATA page charts (robust column detection + interactive legend) */

document.addEventListener("DOMContentLoaded", async () => {
  const CSV_PATH = "data/BoC_v3_EXTENDED_scored.csv";

  // ---- Genres (fixed order)
  const GENRES = ["BIO", "DEV", "PHI", "POE", "RHE", "THE"];
  const GENRE_LABEL = {
    BIO: "BIO",
    DEV: "DEV",
    PHI: "PHI",
    POE: "POE",
    RHE: "RHE",
    THE: "THE",
  };

  // ---- High-contrast palette (fits your DA)
  const COLORS = {
    BIO: "#1E1916",  // ink (almost black)
    DEV: "#0E3A45",  // deep teal
    PHI: "#3E2A61",  // deep violet
    POE: "#7A2C2A",  // garnet
    RHE: "#C46A74",  // dusty rose (brighter)
    THE: "#C39A6B",  // patinated gold
  };

  // ---- Helpers
  const norm = (s) => String(s || "").trim();
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
    const n = +String(x ?? "").replace(",", ".").trim();
    return Number.isFinite(n) ? n : null;
  }

  function toCenturyFromYear(y) {
    // assumes AH year; if you already have AH centuries, we won't use this
    return Math.floor((y - 1) / 100) + 1;
  }

  function inferGenreValue(row, genreCol) {
    const v = norm(row[genreCol]);
    if (!v) return null;
    const upper = v.toUpperCase();

    // direct match or embedded code
    const found = GENRES.find(
      (g) =>
        upper === g ||
        upper.startsWith(g) ||
        upper.includes(` ${g}`) ||
        upper.includes(`${g} `)
    );
    return found || (GENRES.includes(upper) ? upper : null);
  }

  function inferCenturyValue(row, centuryCol) {
    if (!centuryCol) return null;
    const v = coerceNumber(row[centuryCol]);
    if (!v) return null;

    // If it's already 2..15, keep
    if (v >= 2 && v <= 20) return Math.round(v);

    // If it's AH year like 350, convert to century
    if (v >= 50 && v <= 2000) {
      const c = toCenturyFromYear(v);
      if (c >= 1 && c <= 30) return c;
    }
    return null;
  }

  function niceLogTicks(maxVal) {
    const base = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    return base.filter((t) => t <= maxVal);
  }

  // ---- Load CSV
  let raw;
  try {
    raw = await d3.csv(CSV_PATH);
  } catch (e) {
    console.error(e);
    const el1 = document.getElementById("chart-lines");
    const el2 = document.getElementById("chart-pie");
    if (el1) el1.innerHTML = `<p style="padding:1rem">Could not load CSV at <code>${CSV_PATH}</code>. Check file path + server.</p>`;
    if (el2) el2.innerHTML = `<p style="padding:1rem">Could not load CSV at <code>${CSV_PATH}</code>.</p>`;
    return;
  }

  if (!raw || !raw.columns) {
    console.warn("CSV loaded but has no columns?");
    return;
  }

  const columns = raw.columns;

  // ---- Detect columns
  const genreCol =
    findColumn(columns, ["genre", "Genre", "GenreLabel", "genrelabel", "GenreCode", "genre_code", "genre_abbr"]) ||
    findColumnFuzzy(columns, ["genre"]);

  // century might be directly present
  let centuryCol =
    findColumn(columns, ["century", "Century", "century_ah", "Century_AH", "ah_century", "centuryAH", "century_hijri"]) ||
    findColumnFuzzy(columns, ["century"]);

  // else compute from year-like column
  const yearCol =
    findColumn(columns, ["year", "Year", "date", "Date", "year_ah", "ah_year", "hijri_year"]) ||
    findColumnFuzzy(columns, ["year", "date", "hijri", "ah"]);

  if (!genreCol) {
    document.getElementById("chart-lines").innerHTML =
      `<p style="padding:1rem">Could not detect a <strong>genre</strong> column. Columns found: <code>${columns.join(", ")}</code></p>`;
    return;
  }

  // ---- Build normalized rows {genre, century}
  const rows = [];
  for (const r of raw) {
    const g = inferGenreValue(r, genreCol);
    if (!g) continue;

    let c = inferCenturyValue(r, centuryCol);

    if (!c && yearCol) {
      const y = coerceNumber(r[yearCol]);
      if (y) {
        // convert AH year -> century
        const cy = toCenturyFromYear(y);
        if (cy) c = cy;
      }
    }

    if (!c) continue;
    if (c < 2 || c > 15) continue; // focus current release (2..15 AH)

    rows.push({ genre: g, century: c });
  }

  if (rows.length < 10) {
    document.getElementById("chart-lines").innerHTML =
      `<p style="padding:1rem">
        Data loaded, but I couldn't build enough (century, genre) points.
        <br/>Detected genre column: <code>${genreCol}</code>
        <br/>Detected century column: <code>${centuryCol || "none"}</code>
        <br/>Detected year/date column: <code>${yearCol || "none"}</code>
        <br/>CSV columns: <code>${columns.join(", ")}</code>
      </p>`;
    return;
  }

  // ---- Counts per genre (for table + pie)
  const countsByGenre = new Map(GENRES.map((g) => [g, 0]));
  for (const r of rows) countsByGenre.set(r.genre, (countsByGenre.get(r.genre) || 0) + 1);

  // fill table cells
  for (const g of GENRES) {
    const cell = document.getElementById(`c_${g}`);
    if (cell) cell.textContent = String(countsByGenre.get(g) || 0);
  }

  // ---- Aggregate by century x genre
  const centuries = d3.range(2, 16); // 2..15
  const dataByCentury = centuries.map((c) => {
    const obj = { century: c };
    for (const g of GENRES) obj[g] = 0;
    return obj;
  });

  const idx = new Map(centuries.map((c, i) => [c, i]));
  for (const r of rows) {
    const i = idx.get(r.century);
    if (i == null) continue;
    dataByCentury[i][r.genre] += 1;
  }

  // ---- Draw charts
  drawLineChart("#chart-lines", dataByCentury, GENRES, COLORS);
  drawPie("#chart-pie", "#pie-legend", countsByGenre, COLORS);

  // =========================
  // Chart functions
  // =========================

  function drawLineChart(selector, series, genres, colors) {
    const container = document.querySelector(selector);
    if (!container) return;
    container.innerHTML = "";

    const margin = { top: 28, right: 110, bottom: 44, left: 54 };
    const width = Math.max(740, container.clientWidth || 740);
    const height = 420;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", "100%");

    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain(d3.extent(series, (d) => d.century))
      .range([0, plotW]);

    const maxVal = d3.max(series, (d) => d3.max(genres, (k) => d[k])) || 1;

    const y = d3
      .scaleLog()
      .domain([1, Math.max(2, maxVal)])
      .range([plotH, 0])
      .clamp(true);

    // grid
    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).tickValues(niceLogTicks(maxVal)).tickSize(-plotW).tickFormat(""))
      .attr("opacity", 0.22);

    // axes
    g.append("g")
      .attr("transform", `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(14).tickFormat(d3.format("d")));

    g.append("g").call(
      d3
        .axisLeft(y)
        .tickValues(niceLogTicks(maxVal))
        .tickFormat((d) => (d >= 1000 ? `${d / 1000}k` : d))
    );

    // axis labels
    g.append("text")
      .attr("x", 0)
      .attr("y", -10)
      .attr("fill", "currentColor")
      .style("font-weight", 600)
      .style("font-size", "12px")
      .text("Texts (log scale)");

    g.append("text")
      .attr("x", plotW)
      .attr("y", plotH + 36)
      .attr("text-anchor", "end")
      .attr("fill", "currentColor")
      .style("font-weight", 600)
      .style("font-size", "12px")
      .text("Century (AH)");

    // tooltip
    const tip = d3
      .select(container)
      .append("div")
      .attr("class", "viztip")
      .style("opacity", 0);

    // line generator
    const line = d3
      .line()
      .x((d) => x(d.century))
      .y((d) => y(Math.max(1, d.value)))
      .curve(d3.curveMonotoneX);

    // -------- interactive legend state
    const visible = Object.fromEntries(genres.map((gg) => [gg, true]));

    function applyVisibility() {
      genres.forEach((k) => {
        const on = visible[k];

        g.selectAll(`.line-${k}`)
          .transition()
          .duration(180)
          .attr("opacity", on ? 0.95 : 0.06);

        // points should only be interactive when visible
        g.selectAll(`.pt-${k}`)
          .style("pointer-events", on ? "auto" : "none");
      });

      // legend styling
      genres.forEach((k) => {
        g.selectAll(`.legend-dot-${k}`)
          .transition()
          .duration(180)
          .attr("opacity", visible[k] ? 1 : 0.25);

        g.selectAll(`.legend-label-${k}`)
          .transition()
          .duration(180)
          .style("opacity", visible[k] ? 1 : 0.35);
      });
    }

    // draw each genre
    for (const k of genres) {
      const values = series.map((d) => ({ century: d.century, value: d[k] || 0 }));

      g.append("path")
        .datum(values)
        .attr("class", `line line-${k}`)
        .attr("fill", "none")
        .attr("stroke", colors[k] || "#999")
        .attr("stroke-width", 2.5)
        .attr("opacity", 0.95)
        .attr("d", line);

      // hover points (invisible until hover)
      g.selectAll(`.pt-${k}`)
        .data(values)
        .enter()
        .append("circle")
        .attr("class", `pt pt-${k}`)
        .attr("cx", (d) => x(d.century))
        .attr("cy", (d) => y(Math.max(1, d.value)))
        .attr("r", 3.3)
        .attr("fill", colors[k] || "#999")
        .attr("opacity", 0.0)
        .on("mouseenter", (event, d) => {
          if (!visible[k]) return;
          d3.select(event.currentTarget).attr("opacity", 0.95);
          tip
            .style("opacity", 1)
            .html(`<strong>${GENRE_LABEL[k] || k}</strong> · century ${d.century} AH<br/>texts: ${d.value}`)
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

    // -------- legend (clickable + dblclick solo)
    const lg = g.append("g").attr("transform", `translate(${plotW + 18}, 10)`);

    genres.forEach((k, i) => {
      const row = lg
        .append("g")
        .attr("class", `legend-row legend-${k}`)
        .attr("transform", `translate(0, ${i * 20})`)
        .style("cursor", "pointer");

      row.append("circle")
        .attr("r", 5.6)
        .attr("fill", colors[k] || "#999")
        .attr("class", `legend-dot legend-dot-${k}`);

      row.append("text")
        .attr("x", 14)
        .attr("y", 4)
        .style("font-size", "12px")
        .style("font-weight", 700)
        .text(GENRE_LABEL[k] || k)
        .attr("class", `legend-label legend-label-${k}`);

      // click = toggle
      row.on("click", () => {
        visible[k] = !visible[k];
        applyVisibility();
      });

      // double click = solo / reset
      row.on("dblclick", () => {
        const currentlySolo = genres.every((gg) => (gg === k ? visible[gg] : !visible[gg]));
        if (currentlySolo) {
          genres.forEach((gg) => (visible[gg] = true));
        } else {
          genres.forEach((gg) => (visible[gg] = gg === k));
        }
        applyVisibility();
      });
    });

    // initial state
    applyVisibility();
  }

  function drawPie(chartSel, legendSel, countsMap, colors) {
    const chart = document.querySelector(chartSel);
    if (!chart) return;
    chart.innerHTML = "";

    const legend = document.querySelector(legendSel);
    if (legend) legend.innerHTML = "";

    const entries = GENRES.map((k) => ({ key: k, value: countsMap.get(k) || 0 })).filter((d) => d.value > 0);
    const total = d3.sum(entries, (d) => d.value) || 1;

    const w = 340;
    const h = 340;
    const r = Math.min(w, h) / 2 - 10;

    const svg = d3
      .select(chart)
      .append("svg")
      .attr("viewBox", `0 0 ${w} ${h}`)
      .attr("width", "100%")
      .attr("height", "100%");

    const g = svg.append("g").attr("transform", `translate(${w / 2},${h / 2})`);

    const pie = d3.pie().sort(null).value((d) => d.value);
    const arc = d3.arc().innerRadius(Math.round(r * 0.45)).outerRadius(r);
    const arcHover = d3.arc().innerRadius(Math.round(r * 0.45)).outerRadius(r + 6);

    const tip = d3
      .select(chart)
      .append("div")
      .attr("class", "viztip")
      .style("opacity", 0);

    g.selectAll("path")
      .data(pie(entries))
      .enter()
      .append("path")
      .attr("d", arc)
      .attr("fill", (d) => colors[d.data.key] || "#999")
      .attr("stroke", "rgba(246,241,231,0.65)")
      .attr("stroke-width", 1)
      .on("mouseenter", function (event, d) {
        d3.select(this).attr("d", arcHover);
        const pct = ((d.data.value / total) * 100).toFixed(1);
        tip
          .style("opacity", 1)
          .html(`<strong>${d.data.key}</strong><br/>${d.data.value} texts · ${pct}%`)
          .style("left", `${event.offsetX + 12}px`)
          .style("top", `${event.offsetY - 8}px`);
      })
      .on("mousemove", (event) => {
        tip.style("left", `${event.offsetX + 12}px`).style("top", `${event.offsetY - 8}px`);
      })
      .on("mouseleave", function () {
        d3.select(this).attr("d", arc);
        tip.style("opacity", 0);
      });

    // center label
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("y", -2)
      .style("font-weight", 700)
      .style("font-size", "14px")
      .text("Genres");

    g.append("text")
      .attr("text-anchor", "middle")
      .attr("y", 16)
      .style("font-size", "12px")
      .style("opacity", 0.9)
      .text(`${total} texts`);

    // legend list
    if (legend) {
      for (const e of entries) {
        const pct = ((e.value / total) * 100).toFixed(1);
        const li = document.createElement("li");
        li.innerHTML = `
          <span class="swatch" style="background:${colors[e.key] || "#999"}"></span>
          <span class="lab"><strong>${e.key}</strong> <span class="muted">${pct}%</span></span>
        `;
        legend.appendChild(li);
      }
    }
  }
});
