document.addEventListener("DOMContentLoaded", () => {
  const details = Array.from(document.querySelectorAll(".acc details"));
  details.forEach((d) => {
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      details.forEach((other) => {
        if (other !== d) other.open = false;
      });
    });
  });

  const DEFAULT_WEIGHTS = {
    anchor: 1.00,
    desire: 0.80,
    human: 0.60,
    spirit: 0.50,
    modern: 0.45,
    beauty: 0.40,
    family: 0.35,
    metaphor: 0.35,
    ethic: 0.30,
  };

  const ORDER = [
    ["anchor", "explicit love markers"],
    ["desire", "sensual / erotic dimension"],
    ["human", "interpersonal attachment"],
    ["spirit", "devotional / mystical love"],
    ["modern", "contemporary relational vocabulary"],
    ["beauty", "aesthetics of beauty/grace"],
    ["family", "familial/friendly affection"],
    ["metaphor", "poetic imagery & metaphors"],
    ["ethic", "moral/virtue framing"],
  ];

  const grid = document.getElementById("weightsGrid");
  const eqStr = document.getElementById("eqStr");
  const resetBtn = document.getElementById("resetWeights");

  if (!grid || !eqStr) return;

  let weights = { ...DEFAULT_WEIGHTS };

  function fmt(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function sumWeights() {
    return Object.values(weights).reduce((a, b) => a + b, 0);
  }

  function renderFormula() {
    const S = sumWeights();
    const terms = ORDER.map(([k]) => `${fmt(weights[k])}·${k}`).join(" + ");
    eqStr.textContent = `LoveIndex = (${terms}) / ${fmt(S)}`;
  }

  function renderUI() {
    grid.innerHTML = "";

    ORDER.forEach(([k, desc]) => {
      const row = document.createElement("div");
      row.className = "wrow";

      const left = document.createElement("div");
      left.className = "wleft";
      left.innerHTML = `<div class="wkey">${k}</div><div class="wdesc">${desc}</div>`;

      const right = document.createElement("div");
      right.className = "wright";

      const val = document.createElement("div");
      val.className = "wval";
      val.id = `wval_${k}`;
      val.textContent = fmt(weights[k]);

      const input = document.createElement("input");
      input.type = "range";
      input.min = "0.00";
      input.max = "1.25";
      input.step = "0.05";
      input.value = String(weights[k]);
      input.className = "wslider";
      input.setAttribute("aria-label", `Weight for ${k}`);

      input.addEventListener("input", () => {
        weights[k] = parseFloat(input.value);
        val.textContent = fmt(weights[k]);
        renderFormula();
      });

      right.appendChild(input);
      right.appendChild(val);

      row.appendChild(left);
      row.appendChild(right);
      grid.appendChild(row);
    });

    renderFormula();
  }

  resetBtn?.addEventListener("click", () => {
    weights = { ...DEFAULT_WEIGHTS };
    renderUI();
  });

  renderUI();
});
