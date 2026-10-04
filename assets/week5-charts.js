/* Week 05 — every chart on the Scranton intranet, plus the Who Said It? game.
   Waits for week5.js to load week5_office.json (the dm5:data event), then
   draws into the fax sheets. Charts redraw at their container's real width on
   resize, so text stays 11px on a phone instead of shrinking with a viewBox. */
(function () {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const fmt = d3.format(",");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Categorical slots (validated: blue/orange pass CVD + contrast on the paper surface).
  const C = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", yellow: "#eda100" };
  const SLOTS = [C.blue, C.orange, C.aqua, C.yellow];
  const INK = "#1f2430", INK_SOFT = "#4a5161", PAPER = "#fffef9", NEUTRAL = "#b9b4a5";
  // Sequential: one hue, light to dark.
  const seqRamp = d3.interpolateRgb("#d9e2f1", "#1d3a6b");

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  // ------------------------------------------------------------------ tooltip
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.classList.add("on");
    moveTip(ev);
  }
  function moveTip(ev) {
    const pad = 14;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTip() { tip.classList.remove("on"); }
  // keyboard focus gets the same tooltip, anchored to the element
  function focusTip(html, el) {
    const r = el.getBoundingClientRect();
    showTip(html, { clientX: r.right, clientY: r.top });
  }

  // ------------------------------------------------------------------ helpers
  function svgIn(sel, w, h) {
    const box = d3.select(sel);
    box.selectAll("*").remove();
    return box.append("svg").attr("width", w).attr("height", h).attr("viewBox", `0 0 ${w} ${h}`);
  }
  const widthOf = (sel) => Math.max(280, $(sel).clientWidth);

  function rank(a) {
    const idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Array(a.length);
    for (let k = 0; k < idx.length;) {
      let m = k;
      while (m + 1 < idx.length && a[idx[m + 1]] === a[idx[k]]) m++;
      const avg = (k + m) / 2;
      for (let t = k; t <= m; t++) r[idx[t]] = avg;
      k = m + 1;
    }
    return r;
  }
  function pearson(x, y) {
    const n = x.length, mx = d3.mean(x), my = d3.mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxy / Math.sqrt(sxx * syy);
  }
  const spearman = (x, y) => pearson(rank(x), rank(y));
  // powers of ten inside a log scale's domain, so log grids stay sparse
  const decades = (sc) => { const [a, b] = sc.domain(); const out = []; for (let v = Math.pow(10, Math.ceil(Math.log10(a))); v <= b; v *= 10) out.push(v); return out; };
  const fmtRho = (x) => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
  // "How to read this" box: rows of [swatch html, explanation html], then free text
  const sw = (c) => `<span class="sw" style="background:${c}"></span>`;
  const ln = (c) => `<span class="ln" style="background:${c}"></span>`;
  const bar = (c) => `<span class="bar" style="background:${c}"></span>`;
  function howto(sel, rows, text) {
    $(sel).innerHTML = `<div class="k">How to read this</div>` +
      rows.map(([s, t]) => `<div class="row"><span>${s}</span><span>${t}</span></div>`).join("") +
      (text ? `<p>${text}</p>` : "");
  }
  // The two Louvain communities, named from who is in them (see the Org Chart key)
  const GROUP_NAMES = ["Michael&rsquo;s circle", "The rest of the floor &amp; the later seasons"];

  const redraws = [];
  let rTimer;
  window.addEventListener("resize", () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => redraws.forEach((f) => f()), 150);
  });
  function register(fn) { redraws.push(fn); fn(); }

  // ------------------------------------------------------------------ boot
  let booted = false;
  function boot(d) {
    if (booted) return;
    booted = true;
    const byName = new Map(d.characters.map((c) => [c.name, c]));
    register(() => zipf(d));
    orgChart(d, byName);
    pairTest(d);
    register(() => vocab(d));
    heaps(d);
    hr(d);
    register(() => colloc(d));
    trigrams(d);
    creed(d);
    register(() => ratings(d));
    game(d);
    $("#partial-rho").textContent = fmtRho(d.tests.content.partial_talk_given_episodes);
    explainer(d);
  }
  document.addEventListener("dm5:data", (e) => boot(e.detail));
  if (window.DM5 && window.DM5.data) boot(window.DM5.data);

  // ================================================================== CONTENT vs FUNCTION WORDS
  // Colours a real line word by word with the same lists the analysis uses.
  function explainer(d) {
    const stop = new Set(d.meta.stopwords), filler = new Set(d.meta.filler);
    const piped = Object.fromEntries(d.pipelines.map((p) => [p.name, p.tokens]));
    const spoken = piped["+ drop [stage directions]"], noStop = piped["+ drop stopwords"];
    if (spoken && noStop) $("#ex-fshare").textContent = `${Math.round((1 - noStop / spoken) * 100)}%`;

    // short, wordy lines with a healthy mix of both kinds read best
    const pool = d.game.quotes.filter((q) => {
      const t = q.text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
      const f = t.filter((w) => stop.has(w)).length;
      return t.length >= 10 && t.length <= 22 && f >= 4 && t.length - f >= 4;
    });
    let i = Math.floor(Math.random() * pool.length);
    function show() {
      const q = pool[i % pool.length];
      let nC = 0, nF = 0;
      // keep the original punctuation and casing; split into word / non-word
      // runs first and escape each run, so entities never get coloured
      const html = q.text.split(/([A-Za-z]+(?:['’][A-Za-z]+)?)/).map((part, k) => {
        if (k % 2 === 0) return esc(part);
        const w = part.toLowerCase().replace("’", "'");
        if (stop.has(w)) { nF++; return `<span class="w f">${esc(part)}</span>`; }
        if (filler.has(w)) return `<span class="w s">${esc(part)}</span>`;
        nC++;
        return `<span class="w c">${esc(part)}</span>`;
      }).join("");
      $("#ex-quote").innerHTML = html;
      $("#ex-who").textContent = `— ${q.speaker}, S${q.season} E${q.episode} “${q.title}”`;
      $("#ex-share").textContent = `This line: ${nC} content words, ${nF} stopwords.`;
    }
    $("#ex-next").addEventListener("click", () => { i++; show(); });
    show();
  }

  // ================================================================== ZIPF
  function zipf(d) {
    const W = widthOf("#chart-zipf"), H = Math.min(340, Math.max(240, W * 0.5));
    const m = { t: 24, r: 16, b: 36, l: 52 };
    const svg = svgIn("#chart-zipf", W, H);
    const pts = d.zipf.points;
    const x = d3.scaleLog().domain([1, d3.max(pts, (p) => p[0])]).range([m.l, W - m.r]);
    const y = d3.scaleLog().domain([1, d3.max(pts, (p) => p[1]) * 1.3]).range([H - m.b, m.t]);
    const word = new Map(d.zipf.top.map((t, i) => [i + 1, t[0]]));

    svg.append("g").attr("class", "grid").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(decades(x)).tickSize(-(H - m.t - m.b)).tickFormat(""));
    svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).tickValues(decades(y)).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(decades(x)).tickFormat(d3.format("~s")));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(decades(y)).tickFormat(d3.format("~s")));
    svg.append("text").attr("x", W - m.r).attr("y", H - 4).attr("text-anchor", "end").text("rank (1 = most common word)");
    svg.append("text").attr("x", 4).attr("y", 12).text("times used");

    // fitted power law through the median-ish middle of the curve
    const slope = d.zipf.slope;
    const mid = pts.filter((p) => p[0] >= 10 && p[0] <= 5000);
    const b = d3.mean(mid, (p) => Math.log10(p[1]) - slope * Math.log10(p[0]));
    const f = (r) => Math.pow(10, b + slope * Math.log10(r));
    svg.append("line").attr("x1", x(10)).attr("x2", x(5000)).attr("y1", y(f(10))).attr("y2", y(f(5000)))
      .attr("stroke", C.orange).attr("stroke-width", 2).attr("stroke-linecap", "round");
    svg.append("text").attr("class", "lbl halo").attr("x", x(300)).attr("y", y(f(300)) - 10)
      .text(`fitted slope ${slope.toFixed(2)}`);

    svg.append("g").selectAll("circle").data(pts).join("circle")
      .attr("cx", (p) => x(p[0])).attr("cy", (p) => y(p[1])).attr("r", 4)
      .attr("fill", C.blue).attr("stroke", PAPER).attr("stroke-width", 2)
      .on("mousemove", (ev, p) => showTip(`${word.has(p[0]) ? `<b>&ldquo;${esc(word.get(p[0]))}&rdquo;</b><br>` : ""}rank ${fmt(p[0])} &middot; used ${fmt(p[1])}&times;`, ev))
      .on("mouseleave", hideTip);

    howto("#howto-zipf", [
      [sw(C.blue), "<b>Blue dots</b>: words. A dot&rsquo;s position is its rank (1 = most used word) and how many times it is said in the whole show."],
      [ln(C.orange), `<b>Orange line</b>: the best-fitting power law, frequency &prop; rank<sup>${slope.toFixed(2)}</sup>. That&rsquo;s Zipf&rsquo;s law.`],
    ], `Read it as: the 10th most common word is said about ${Math.pow(2, -slope).toFixed(1)}&times; as often as the 20th. A handful of words (&ldquo;i&rdquo;, &ldquo;you&rdquo;, &ldquo;the&rdquo;) do most of the talking; the long tail on the right is thousands of words said only once or twice.`);

    // name the top few words directly
    [0, 1, 2].forEach((i) => {
      const t = d.zipf.top[i];
      svg.append("text").attr("class", "lbl halo").attr("x", x(i + 1)).attr("y", y(t[1]) + (i % 2 ? 18 : -9))
        .attr("text-anchor", "middle").text(`“${t[0]}”`);
    });
  }

  // ================================================================== ORG CHART
  function orgChart(d, byName) {
    const chars = d.characters;
    const names = chars.map((c) => c.name);
    const edges = d.pairs.filter((p) => p.turns > 0);
    // Static layout, computed once in a unit box; d3-force's initial positions
    // are deterministic, so the chart looks the same on every visit.
    const nodes = chars.map((c) => ({ id: c.name }));
    const links = edges.map((p) => ({ source: p.a, target: p.b, w: Math.log1p(p.turns) }));
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((n) => n.id).distance((l) => 220 - l.w * 18).strength((l) => 0.02 + l.w / 60))
      .force("charge", d3.forceManyBody().strength(-420))
      .force("center", d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide(44))
      .stop();
    for (let i = 0; i < 500; i++) sim.tick();
    const ext = { x: d3.extent(nodes, (n) => n.x), y: d3.extent(nodes, (n) => n.y) };
    const pos = new Map(nodes.map((n) => [n.id, [(n.x - ext.x[0]) / (ext.x[1] - ext.x[0]), (n.y - ext.y[0]) / (ext.y[1] - ext.y[0])]]));

    // communities, named after their three biggest talkers
    const comms = d3.groups(chars, (c) => c.community).sort((a, b) => a[0] - b[0]);
    const commColor = (k) => SLOTS[k] || NEUTRAL;
    const r = d3.scaleSqrt().domain([0, d3.max(chars, (c) => c.tokens)]).range([5, 24]);

    let edgeMode = "content", minTurns = 80, selected = null;

    function draw() {
      const W = widthOf("#chart-network"), H = Math.max(360, Math.min(560, W * 0.72));
      const m = 46;
      const px = (n) => m + pos.get(n)[0] * (W - 2 * m);
      const py = (n) => m * 0.7 + pos.get(n)[1] * (H - 1.4 * m);
      const svg = svgIn("#chart-network", W, H);
      const vals = edges.map((p) => p[edgeMode]);
      const col = d3.scaleSequential(seqRamp).domain(d3.extent(vals));
      const wid = d3.scaleSqrt().domain([0, d3.max(edges, (p) => p.turns)]).range([0.6, 9]);
      const shown = edges.filter((p) => p.turns >= minTurns).sort((a, b) => a[edgeMode] - b[edgeMode]);

      const eg = svg.append("g");
      eg.selectAll("line").data(shown).join("line")
        .attr("class", "edge")
        .attr("x1", (p) => px(p.a)).attr("y1", (p) => py(p.a)).attr("x2", (p) => px(p.b)).attr("y2", (p) => py(p.b))
        .attr("stroke", (p) => col(p[edgeMode])).attr("stroke-width", (p) => wid(p.turns)).attr("stroke-opacity", 0.85);

      const ng = svg.append("g").selectAll("g").data(chars).join("g")
        .attr("class", (c) => "node" + (c.name === selected ? " sel" : ""))
        .attr("transform", (c) => `translate(${px(c.name)},${py(c.name)})`)
        .attr("tabindex", 0).attr("role", "button").attr("aria-label", (c) => `${c.name}: open employee file`);
      ng.append("circle").attr("r", (c) => r(c.tokens)).attr("fill", (c) => commColor(c.community));
      ng.append("text").attr("class", "lbl halo").attr("text-anchor", "middle")
        .attr("y", (c) => r(c.tokens) + 12).text((c) => c.name);

      const focusOn = (name) => {
        const nb = new Set([name]);
        shown.forEach((p) => { if (p.a === name) nb.add(p.b); if (p.b === name) nb.add(p.a); });
        eg.selectAll("line").attr("stroke-opacity", (p) => (p.a === name || p.b === name ? 1 : 0.08));
        ng.attr("opacity", (c) => (nb.has(c.name) ? 1 : 0.25));
      };
      const unfocus = () => {
        if (selected) return focusOn(selected);
        eg.selectAll("line").attr("stroke-opacity", 0.85);
        ng.attr("opacity", 1);
      };
      const tipHtml = (c) => `<b>${esc(c.name)}</b> &middot; ${GROUP_NAMES[c.community] || ""}<br>${fmt(c.tokens)} words spoken<br>Most typical words: ${c.distinctive.slice(0, 4).map((w) => esc(w.w)).join(", ")}`;
      ng.on("mouseenter", (ev, c) => { focusOn(c.name); showTip(tipHtml(c), ev); })
        .on("mousemove", moveTip)
        .on("mouseleave", () => { hideTip(); unfocus(); })
        .on("focus", (ev, c) => { focusOn(c.name); focusTip(tipHtml(c), ev.currentTarget); })
        .on("blur", () => { hideTip(); unfocus(); })
        .on("click", (ev, c) => select(c.name))
        .on("keydown", (ev, c) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(c.name); } });
      if (selected) focusOn(selected);

      // key: what the two colours are, then edges
      const [lo, hi] = d3.extent(vals);
      const groupRow = ([k, cs]) => {
        const who = cs.slice().sort((a, b) => b.tokens - a.tokens);
        const late = d3.sum(cs, (c) => c.late_share * c.lines) / d3.sum(cs, (c) => c.lines);
        return [sw(commColor(k)), `<b>${GROUP_NAMES[k] || "Group " + (k + 1)}</b> (Louvain group ${k + 1}, ${cs.length} people): ${who.map((c) => esc(c.name)).join(", ")}. ` +
          `${Math.round(late * 100)}% of their lines are from seasons 8&ndash;9, after Michael leaves.`];
      };
      howto("#legend-network", [
        ...comms.map(groupRow),
        [`<span class="ramp" style="width:16px;background:linear-gradient(90deg,${seqRamp(0)},${seqRamp(1)})"></span>`,
          `<b>Line colour</b>: how alike the two people&rsquo;s ${edgeMode === "content" ? "<i>topics</i> (content words, stopwords removed)" : "<i>style</i> (stopwords only)"} are, from ${lo.toFixed(edgeMode === "style" ? 3 : 2)} (pale) to ${hi.toFixed(edgeMode === "style" ? 3 : 2)} (dark navy). <b>Line width</b>: how often they answer each other. <b>Dot size</b>: how much they talk.`],
      ], `The colours come from <b>Louvain community detection</b>: an algorithm that splits the network into groups who talk more among themselves than to outsiders, using only who-answers-whom (never the words). It found two groups, and ${Math.round(d.within_group_turn_share * 100)}% of all turns happen inside one of them. We named the groups after reading who ended up in each. Hover a person to light up their ties; click for their file.`);
    }

    function select(name) {
      selected = selected === name ? null : name;
      draw();
      badge(selected);
    }

    function badge(name) {
      const el = $("#badge");
      if (!name) { el.innerHTML = '<div class="badge-empty">Click a person on the org chart to pull their employee file.</div>'; return; }
      const c = byName.get(name);
      const mine = d.pairs.filter((p) => p.a === name || p.b === name).map((p) => ({ o: p.a === name ? p.b : p.a, ...p }));
      const talk = mine.slice().sort((a, b) => b.turns - a.turns).slice(0, 3);
      const like = mine.slice().sort((a, b) => b.content - a.content).slice(0, 3);
      const vocabRank = chars.slice().sort((a, b) => b.types_2000 - a.types_2000).findIndex((x) => x.name === name) + 1;
      el.innerHTML = `
        <div class="badge-top">
          <div class="badge-photo" style="background:${commColor(c.community)}">${esc(name.slice(0, 2).toUpperCase())}</div>
          <div><div class="badge-co">${GROUP_NAMES[c.community] || "Dunder Mifflin"}</div><div class="badge-name">${esc(name)}</div></div>
        </div>
        <dl>
          <dt>Lines</dt><dd>${fmt(c.lines)}</dd>
          <dt>Words spoken</dt><dd>${fmt(c.tokens)}</dd>
          <dt>Episodes</dt><dd>${c.episodes}</dd>
          <dt>Vocabulary rank</dt><dd>#${vocabRank} of ${chars.length}</dd>
          <dt>Words per line</dt><dd>${c.words_per_line.toFixed(1)}</dd>
        </dl>
        <h4>Most typical words</h4>
        <div class="badge-words">${c.distinctive.slice(0, 8).map((w) => `<span>${esc(w.w)}</span>`).join("")}</div>
        <h4>Talks most with</h4>
        <ol>${talk.map((p) => `<li>${esc(p.o)} <span style="color:var(--ink-faint)">(${fmt(p.turns)} turns)</span></li>`).join("")}</ol>
        <h4>Sounds most like</h4>
        <ol>${like.map((p) => `<li>${esc(p.o)} <span style="color:var(--ink-faint)">(${p.content.toFixed(3)})</span></li>`).join("")}</ol>`;
    }

    $("#min-turns").addEventListener("input", (e) => {
      minTurns = +e.target.value;
      $("#min-turns-out").textContent = minTurns;
      draw();
    });
    $$("[data-edge]").forEach((b) => b.addEventListener("click", () => {
      edgeMode = b.dataset.edge;
      $$("[data-edge]").forEach((x) => x.classList.toggle("active", x === b));
      draw();
    }));
    register(draw);
  }

  // ================================================================== PAIR TEST
  function pairTest(d) {
    const names = d.characters.map((c) => c.name);
    const n = names.length;
    const ix = new Map(names.map((nm, i) => [nm, i]));
    const pairs = d.pairs;
    const ia = pairs.map((p) => ix.get(p.a)), ib = pairs.map((p) => ix.get(p.b));
    const lift = pairs.map((p) => p.lift);
    const mats = {};
    ["content", "style"].forEach((k) => {
      const M = Array.from({ length: n }, () => new Float64Array(n));
      pairs.forEach((p, i) => { M[ia[i]][ib[i]] = M[ib[i]][ia[i]] = p[k]; });
      mats[k] = M;
    });
    const liftRanks = rank(lift);
    const rhoOf = (ys) => pearson(liftRanks, rank(ys));
    const observed = { content: rhoOf(pairs.map((p) => p.content)), style: rhoOf(pairs.map((p) => p.style)) };

    const HL = [["Michael", "Dwight"], ["Jim", "Pam"], ["Angela", "Oscar"]];
    const isHL = (p) => HL.some(([a, b]) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

    let mode = "content";
    let yNow = pairs.map((p) => p[mode]);
    let nulls = [];
    let running = false;

    function drawScatter(animate) {
      const W = widthOf("#chart-scatter"), H = Math.max(280, Math.min(380, W * 0.75));
      const m = { t: 22, r: 14, b: 38, l: 50 };
      let svg = d3.select("#chart-scatter svg");
      const fresh = svg.empty() || +svg.attr("width") !== W || svg.attr("data-mode") !== mode;
      // pairs who never answer each other (lift 0) get their own column at the far left
      const xs = pairs.map((p) => (p.lift > 0 ? p.lift : 0.03));
      const x = d3.scaleLog().domain([0.03, d3.max(xs) * 1.1]).range([m.l + 6, W - m.r]).clamp(true);
      const all = pairs.map((p) => p[mode]);
      const pad = (d3.max(all) - d3.min(all)) * 0.06;
      const y = d3.scaleLinear().domain([d3.min(all) - pad, d3.max(all) + pad]).range([H - m.b, m.t]).nice();
      if (fresh) {
        svg = svgIn("#chart-scatter", W, H).attr("data-mode", mode);
        svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
        svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues([0.03, 0.1, 1, 10].filter((v) => v <= x.domain()[1])).tickFormat((v) => (v === 0.03 ? "never" : d3.format("~g")(v))));
        svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5, mode === "style" ? ".3f" : ".2f"));
        svg.append("text").attr("x", W - m.r).attr("y", H - 4).attr("text-anchor", "end").text("talk lift (log; 1 = as often as chance)");
        svg.append("text").attr("x", 4).attr("y", 12).text(mode === "content" ? "topic similarity (stopwords removed)" : "style similarity (stopwords only)");
        svg.append("line").attr("x1", x(1)).attr("x2", x(1)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", "#cfc9b8");
        svg.append("g").attr("class", "dots");
        svg.append("g").attr("class", "hl");
      }
      const order = pairs.map((p, i) => i).sort((i, j) => isHL(pairs[i]) - isHL(pairs[j]));
      const dots = svg.select(".dots").selectAll("circle").data(order, (i) => i).join("circle")
        .attr("cx", (i) => x(xs[i])).attr("r", (i) => (isHL(pairs[i]) ? 5.5 : 4))
        .attr("fill", (i) => (isHL(pairs[i]) ? C.orange : C.blue)).attr("fill-opacity", (i) => (isHL(pairs[i]) ? 1 : 0.75))
        .attr("stroke", PAPER).attr("stroke-width", 2)
        .on("mousemove", (ev, i) => {
          const p = pairs[i];
          showTip(`<b>${esc(p.a)} &amp; ${esc(p.b)}</b><br>${fmt(p.turns)} turns &middot; lift ${p.lift.toFixed(2)}<br>topic sim ${p.content.toFixed(3)} &middot; style sim ${p.style.toFixed(3)}`, ev);
        })
        .on("mouseleave", hideTip);
      (animate && !reduceMotion ? dots.transition().duration(animate) : dots).attr("cy", (i) => y(yNow[i]));

      // highlighted pairs sit close together; nudge their labels apart vertically
      const hl = running ? [] : order.filter((i) => isHL(pairs[i])).map((i) => ({ i, y: y(yNow[i]) + 4 })).sort((a, b) => a.y - b.y);
      for (let k = 1; k < hl.length; k++) if (hl[k].y - hl[k - 1].y < 13) hl[k].y = hl[k - 1].y + 13;
      const left = (i) => x(xs[i]) > W * 0.6;
      svg.select(".hl").selectAll("text").data(hl, (h) => h.i).join("text")
        .attr("class", "lbl halo").attr("y", (h) => h.y)
        .attr("text-anchor", (h) => (left(h.i) ? "end" : "start"))
        .attr("x", (h) => (left(h.i) ? x(xs[h.i]) - 9 : x(xs[h.i]) + 9))
        .text((h) => `${pairs[h.i].a}–${pairs[h.i].b}`);

      $("#scatter-title").textContent = `Talk lift vs. ${mode === "content" ? "topic" : "style"} similarity · Spearman ρ = ${fmtRho(observed[mode])}`;
      const never = pairs.filter((p) => !(p.lift > 0)).length;
      howto("#howto-scatter", [
        [sw(C.blue), "<b>Blue dots</b>: one pair of characters each (351 pairs in all)."],
        [sw(C.orange), "<b>Orange dots</b>: three famous pairs, named so you can find them: Michael&ndash;Dwight (the most talkative pair), Jim&ndash;Pam and Angela&ndash;Oscar."],
        ['<span class="ln" style="background:#cfc9b8;width:3px;height:14px"></span>', `<b>Grey line</b>: lift = 1, where a pair talks exactly as often as chance predicts. Right of it = they seek each other out. The &ldquo;never&rdquo; column on the far left holds the ${never} pairs who never answer each other.`],
      ], mode === "content"
        ? "If talking partners share topics, the cloud should tilt up to the right. It does, gently, and the shuffle test on the right shows it isn&rsquo;t luck."
        : `Similarity on stopwords alone is almost the same for every pair (all between ${d3.min(pairs, (p) => p.style).toFixed(2)} and ${d3.max(pairs, (p) => p.style).toFixed(2)}): everyone uses &ldquo;the&rdquo;, &ldquo;I&rdquo; and &ldquo;you&rdquo; at similar rates, and the cloud doesn&rsquo;t tilt.`);
    }

    function drawNull() {
      const W = widthOf("#chart-null"), H = Math.max(280, Math.min(380, W * 0.75));
      const m = { t: 26, r: 14, b: 38, l: 40 };
      const svg = svgIn("#chart-null", W, H);
      const x = d3.scaleLinear().domain([-0.4, 0.4]).range([m.l, W - m.r]);
      const bins = d3.bin().domain(x.domain()).thresholds(d3.range(-0.4, 0.4001, 0.02))(nulls);
      const y = d3.scaleLinear().domain([0, Math.max(10, d3.max(bins, (b) => b.length) || 0)]).range([H - m.b, m.t]).nice();
      svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5));
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4));
      svg.append("text").attr("x", W - m.r).attr("y", H - 4).attr("text-anchor", "end").text("ρ after shuffling the name tags");
      svg.append("g").selectAll("path").data(bins).join("path")
        .attr("fill", NEUTRAL)
        .attr("d", (b) => {
          const x0 = x(b.x0) + 1, x1 = x(b.x1) - 1, y0 = y(0), y1 = y(b.length), rr = Math.min(3, (x1 - x0) / 2, y0 - y1);
          if (!b.length) return "";
          return `M${x0},${y0}V${y1 + rr}Q${x0},${y1} ${x0 + rr},${y1}H${x1 - rr}Q${x1},${y1} ${x1},${y1 + rr}V${y0}Z`;
        });
      const ob = observed[mode];
      howto("#howto-null", [
        [bar(NEUTRAL), "<b>Grey bars</b>: the &rho; you get after randomly swapping which name goes with which vocabulary. This is the &ldquo;no real connection&rdquo; world."],
        [`<span class="ln" style="background:${INK};width:3px;height:14px"></span>`, `<b>Black line</b>: the real &rho; = ${fmtRho(ob)}.`],
      ], "If the black line sits far to the right of almost all the grey bars, random name tags can&rsquo;t produce the real pattern.");
      svg.append("line").attr("x1", x(ob)).attr("x2", x(ob)).attr("y1", m.t - 6).attr("y2", H - m.b).attr("stroke", INK).attr("stroke-width", 2);
      svg.append("text").attr("class", "lbl strong halo").attr("x", x(ob)).attr("y", m.t - 9)
        .attr("text-anchor", ob > 0.25 ? "end" : "middle").text(`real ρ = ${fmtRho(ob)}`);
      if (!nulls.length) {
        svg.append("text").attr("x", x(-0.1)).attr("y", H / 2).attr("text-anchor", "middle").text("Press “Shuffle the name tags”");
      }
    }

    function caption() {
      const ob = observed[mode];
      if (!nulls.length) {
        $("#shuffle-cap").innerHTML = "Shuffling which name goes with which vocabulary keeps both networks intact but breaks any link between them. If the real &rho; sits far out in the tail of the shuffled ones, the link is real.";
        return;
      }
      const k = nulls.filter((v) => v >= ob).length;
      const p = (k + 1) / (nulls.length + 1);
      $("#shuffle-cap").innerHTML = `${fmt(nulls.length)} shuffles: ${k} of them reached the real &rho; of ${fmtRho(ob)}, so <b>p &asymp; ${p < 0.001 ? "&lt; 0.001" : p.toFixed(3)}</b>. ` +
        (p < 0.05 ? "The real arrangement beats almost every random one: people who talk together really do share topics." : "Random name tags do this well all the time, so there&rsquo;s no link here.");
    }

    function shuffle() {
      if (running) return;
      running = true;
      nulls = [];
      const btn = $("#shuffle-btn");
      btn.disabled = true;
      const M = mats[mode];
      const total = 1000, perFrame = reduceMotion ? 1000 : 40;
      const perm = d3.range(n);
      const step = () => {
        let ys;
        for (let k = 0; k < perFrame && nulls.length < total; k++) {
          d3.shuffle(perm);
          ys = pairs.map((p, i) => M[perm[ia[i]]][perm[ib[i]]]);
          nulls.push(rhoOf(ys));
        }
        yNow = ys;
        drawScatter(0);
        drawNull();
        btn.textContent = `Shuffling… ${nulls.length} / ${total}`;
        if (nulls.length < total) requestAnimationFrame(step);
        else {
          running = false;
          btn.disabled = false;
          btn.innerHTML = "&#128256; Shuffle again &times;1,000";
          yNow = pairs.map((p) => p[mode]);
          drawScatter(700);
          caption();
          if (window.DM5) window.DM5.addBucks(2);
        }
      };
      requestAnimationFrame(step);
    }

    $$("[data-sim]").forEach((b) => b.addEventListener("click", () => {
      if (running) return;
      mode = b.dataset.sim;
      $$("[data-sim]").forEach((x) => x.classList.toggle("active", x === b));
      yNow = pairs.map((p) => p[mode]);
      nulls = [];
      drawScatter(0);
      drawNull();
      caption();
    }));
    $("#shuffle-btn").addEventListener("click", shuffle);
    register(() => { drawScatter(0); drawNull(); });
  }

  // ================================================================== VOCAB LEDGER
  function vocab(d) {
    const rows = d.characters.slice().sort((a, b) => a.types_2000 - b.types_2000);
    const W = widthOf("#chart-vocab");
    const rowH = 19, m = { t: 26, b: 30, l: 74 };
    const H = m.t + rows.length * rowH + m.b;
    const svg = svgIn("#chart-vocab", W, H);
    const gap = 26, split = m.l + (W - m.l - gap) * 0.62;
    const x1 = d3.scaleLinear().domain([d3.min(rows, (c) => c.types_2000) - 15, d3.max(rows, (c) => c.types_2000) + 15]).range([m.l, split]).nice();
    const x2 = d3.scaleLinear().domain([0, d3.max(rows, (c) => c.words_per_line)]).range([split + gap, W - 22]).nice();
    const y = (i) => m.t + i * rowH + rowH / 2;
    const HL = new Set(["Kevin", "Michael"]);

    svg.append("text").attr("x", m.l).attr("y", 12).attr("class", "lbl strong").text("distinct words per 2,000 tokens");
    svg.append("text").attr("x", split + gap).attr("y", 12).attr("class", "lbl strong").text("words per line");
    svg.append("g").attr("class", "grid").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x1).ticks(4).tickSize(-(rows.length * rowH)).tickFormat(""));
    svg.append("g").attr("class", "grid").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x2).ticks(3).tickSize(-(rows.length * rowH)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x1).ticks(4));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x2).ticks(3));

    const g = svg.append("g").selectAll("g").data(rows).join("g").attr("transform", (c, i) => `translate(0,${y(i)})`);
    g.append("rect").attr("x", 0).attr("width", W).attr("y", -rowH / 2).attr("height", rowH).attr("fill", "transparent");
    g.append("text").attr("x", m.l - 8).attr("dy", "0.35em").attr("text-anchor", "end")
      .attr("class", (c) => "lbl" + (HL.has(c.name) ? " strong" : "")).text((c) => c.name);
    g.append("line").attr("x1", m.l).attr("x2", (c) => x1(c.types_2000)).attr("stroke", "#e4dfd2");
    g.append("circle").attr("cx", (c) => x1(c.types_2000)).attr("r", 5)
      .attr("fill", (c) => (HL.has(c.name) ? C.orange : C.blue)).attr("stroke", PAPER).attr("stroke-width", 2);
    const bh = 11;
    g.append("path").attr("fill", (c) => (HL.has(c.name) ? C.orange : C.blue))
      .attr("d", (c) => {
        const x0 = x2(0), xe = x2(c.words_per_line), rr = Math.min(4, xe - x0);
        return `M${x0},${-bh / 2}H${xe - rr}Q${xe},${-bh / 2} ${xe},${-bh / 2 + rr}V${bh / 2 - rr}Q${xe},${bh / 2} ${xe - rr},${bh / 2}H${x0}Z`;
      });
    g.filter((c) => HL.has(c.name)).append("text").attr("class", "lbl strong").attr("x", (c) => x2(c.words_per_line) + 4).attr("dy", "0.35em")
      .text((c) => c.words_per_line.toFixed(1));
    g.filter((c) => HL.has(c.name)).append("text").attr("class", "lbl strong halo").attr("x", (c) => x1(c.types_2000) + 9).attr("dy", "0.35em")
      .text((c) => Math.round(c.types_2000));
    const vr = (n) => d.characters.slice().sort((a, b) => b.types_2000 - a.types_2000).findIndex((c) => c.name === n) + 1;
    const lr = (n) => d.characters.slice().sort((a, b) => b.words_per_line - a.words_per_line).findIndex((c) => c.name === n) + 1;
    const N = d.characters.length;
    howto("#howto-vocab", [
      [sw(C.orange), `<b>Orange: the two people on trial.</b> <b>Kevin</b>, because of his famous &ldquo;few word do trick&rdquo; line, and <b>Michael</b>, the boss who talks the most, for comparison.`],
      [sw(C.blue), "<b>Blue</b>: everyone else in the core cast, for reference."],
      ["", "<b>Left</b>: further right = a bigger vocabulary. <b>Right</b>: longer bar = longer lines."],
    ], `<b>The verdict:</b> Kevin does say few words per line (#${lr("Kevin")} of ${N} for line length), but his vocabulary is mid-table (#${vr("Kevin")} of ${N}). Michael is the real &ldquo;few words&rdquo; man: he has one of the <i>smallest</i> vocabularies (#${vr("Michael")} of ${N}) and yet the #${lr("Michael")} longest lines. He says a lot, using the same words over and over.`);
    g.on("mousemove", (ev, c) => showTip(`<b>${esc(c.name)}</b><br>${c.types_2000.toFixed(0)} distinct words per 2,000 tokens<br>${c.words_per_line.toFixed(1)} words per line &middot; ${fmt(c.tokens)} words in total`, ev))
      .on("mouseleave", hideTip);
  }

  function heaps(d) {
    const chars = d.characters;
    const colorOf = new Map();
    ["Michael", "Dwight", "Kevin", "Creed"].forEach((n, i) => colorOf.set(n, SLOTS[i]));
    const box = $("#heaps-chips");
    box.innerHTML = chars.map((c) => `<button type="button" class="chip-btn" data-name="${esc(c.name)}" aria-pressed="false">${esc(c.name)}</button>`).join("");
    const sync = () => $$(".chip-btn", box).forEach((b) => {
      const on = colorOf.has(b.dataset.name);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on);
      b.style.boxShadow = on ? `inset 4px 0 0 ${colorOf.get(b.dataset.name)}` : "";
    });
    box.addEventListener("click", (e) => {
      const b = e.target.closest(".chip-btn");
      if (!b) return;
      const n = b.dataset.name;
      if (colorOf.has(n)) { if (colorOf.size > 1) colorOf.delete(n); }
      else {
        if (colorOf.size >= 4) { window.DM5 && window.DM5.toast("Accounting", "Four at a time, please. Oscar can only audit so many ledgers.", "\u{1F9EE}", 3500); return; }
        const used = new Set(colorOf.values());
        colorOf.set(n, SLOTS.find((s) => !used.has(s)));  // keeps everyone else's colour
      }
      sync();
      draw();
    });

    function draw() {
      const W = widthOf("#chart-heaps"), H = Math.min(340, Math.max(240, W * 0.5));
      const m = { t: 24, r: 70, b: 36, l: 52 };
      const svg = svgIn("#chart-heaps", W, H);
      const sel = chars.filter((c) => colorOf.has(c.name));
      const x = d3.scaleLog().domain([10, d3.max(chars, (c) => c.tokens)]).range([m.l, W - m.r]);
      const y = d3.scaleLog().domain([10, d3.max(chars, (c) => c.heaps[c.heaps.length - 1][1]) * 1.1]).range([H - m.b, m.t]);
      svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(decades(y)).tickSize(-(W - m.l - m.r)).tickFormat(""));
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(decades(x)).tickFormat(d3.format("~s")));
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(decades(y)).tickFormat(d3.format("~s")));
      svg.append("text").attr("x", W - m.r).attr("y", H - 4).attr("text-anchor", "end").text("words spoken so far");
      svg.append("text").attr("x", 4).attr("y", 12).text("distinct words");
      const line = d3.line().x((p) => x(p[0])).y((p) => y(p[1]));
      sel.forEach((c) => {
        const pts = c.heaps.filter((p) => p[0] >= 10);
        svg.append("path").attr("d", line(pts)).attr("fill", "none").attr("stroke", colorOf.get(c.name))
          .attr("stroke-width", 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
        const end = pts[pts.length - 1];
        svg.append("circle").attr("cx", x(end[0])).attr("cy", y(end[1])).attr("r", 4).attr("fill", colorOf.get(c.name)).attr("stroke", PAPER).attr("stroke-width", 2)
          .on("mousemove", (ev) => showTip(`<b>${esc(c.name)}</b><br>${fmt(end[1])} distinct words in ${fmt(end[0])} spoken`, ev)).on("mouseleave", hideTip);
        svg.append("text").attr("class", "lbl halo").attr("x", x(end[0]) + 7).attr("y", y(end[1]) + 4).text(c.name);
      });
      howto("#legend-heaps", sel.map((c) => [ln(colorOf.get(c.name)), `<b>${esc(c.name)}</b>: ${fmt(c.heaps[c.heaps.length - 1][1])} distinct words after ${fmt(c.tokens)} spoken`]),
        "Each line follows one character through the show: every time they speak, the line moves right, and it moves up only when they use a word they&rsquo;ve never said before. All lines bend the same way, which is Heaps&rsquo; law: vocabulary keeps growing, but more and more slowly. A line that sits higher is adding new words faster. Pick up to four names above; colours stay with the person.");
    }
    sync();
    register(draw);
  }

  // ================================================================== HR
  function hr(d) {
    const files = d.twss;
    const counts = d3.rollups(files, (v) => v.length, (f) => f.speaker).sort((a, b) => b[1] - a[1]);
    let filter = null;

    function list() {
      const items = files.filter((f) => !filter || f.speaker === filter);
      $("#cabinet-label").textContent = filter ? `Complaints against ${filter} (${items.length})` : `All complaints (${items.length})`;
      $("#cabinet-reset").hidden = !filter;
      $("#twss-list").innerHTML = items.map((f, i) => {
        const line = esc(f.line).replace(/(that(?:&#39;|')?s what s?he said)/i, "<mark>$1</mark>");
        return `<li><span class="stamp">FILED</span>
          <div class="ep">Complaint #${String(i + 1).padStart(3, "0")} &middot; S${f.season} E${f.episode} &middot; ${esc(f.title)}</div>
          ${f.setup ? `<div class="setup"><b>${esc(f.setup_speaker)}:</b> ${esc(f.setup)}</div>` : ""}
          <div><b>${esc(f.speaker)}:</b> ${line}</div></li>`;
      }).join("");
    }

    function chart() {
      const W = widthOf("#chart-twss");
      const rowH = 24, m = { t: 4, r: 34, b: 6, l: 122 };
      const H = m.t + counts.length * rowH + m.b;
      const svg = svgIn("#chart-twss", W, H);
      const x = d3.scaleLinear().domain([0, counts[0][1]]).range([m.l, W - m.r]);
      const g = svg.selectAll("g").data(counts).join("g").attr("transform", (c, i) => `translate(0,${m.t + i * rowH + rowH / 2})`)
        .style("cursor", "pointer").attr("tabindex", 0).attr("role", "button")
        .attr("aria-label", (c) => `Show the ${c[1]} complaints against ${c[0]}`);
      g.append("rect").attr("x", 0).attr("width", W).attr("y", -rowH / 2).attr("height", rowH).attr("fill", "transparent");
      g.append("text").attr("class", (c) => "lbl" + (c[0] === filter ? " strong" : "")).attr("x", m.l - 8).attr("dy", "0.35em").attr("text-anchor", "end").text((c) => c[0]);
      const bh = 14;
      g.append("path").attr("fill", (c) => (!filter || c[0] === filter ? C.blue : NEUTRAL)).attr("d", (c) => {
        const x0 = x(0), xe = x(c[1]), rr = Math.min(4, xe - x0);
        return `M${x0},${-bh / 2}H${xe - rr}Q${xe},${-bh / 2} ${xe},${-bh / 2 + rr}V${bh / 2 - rr}Q${xe},${bh / 2} ${xe - rr},${bh / 2}H${x0}Z`;
      });
      g.append("text").attr("class", "lbl").attr("x", (c) => x(c[1]) + 5).attr("dy", "0.35em").text((c) => c[1]);
      howto("#howto-twss", [[bar(C.blue), `<b>Bar length</b>: how many times each person says &ldquo;that&rsquo;s what she said&rdquo; (or &ldquo;he said&rdquo;).`]].concat(
        filter ? [[bar(NEUTRAL), `<b>Grey</b>: hidden by your filter. Click ${esc(filter)}&rsquo;s bar again to show everyone.`]] : []),
        "Click a bar to open only that person&rsquo;s files in the cabinet.");
      const pick = (c) => { filter = filter === c[0] ? null : c[0]; chart(); list(); };
      g.on("click", (ev, c) => pick(c)).on("keydown", (ev, c) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(c); } });
    }
    $("#cabinet-reset").addEventListener("click", () => { filter = null; chart(); list(); });
    register(chart);
    list();
  }

  // ================================================================== SALES
  function colloc(d) {
    const rows = d.collocations.slice(0, 15);
    const W = widthOf("#chart-colloc");
    const narrow = W < 520;
    const rowH = 24, m = { t: 4, r: narrow ? 46 : 150, b: 26, l: 124 };
    const H = m.t + rows.length * rowH + m.b;
    const svg = svgIn("#chart-colloc", W, H);
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.g2)]).range([m.l, W - m.r]).nice();
    svg.append("g").attr("class", "grid").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4).tickSize(-(rows.length * rowH)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4, "~s"));
    const g = svg.append("g").selectAll("g").data(rows).join("g").attr("transform", (r, i) => `translate(0,${m.t + i * rowH + rowH / 2})`);
    g.append("rect").attr("x", 0).attr("width", W).attr("y", -rowH / 2).attr("height", rowH).attr("fill", "transparent");
    g.append("text").attr("class", "lbl").attr("x", m.l - 8).attr("dy", "0.35em").attr("text-anchor", "end").style("font-family", "var(--mono)").text((r) => r.phrase);
    const bh = 14;
    g.append("path").attr("fill", C.blue).attr("d", (r) => {
      const x0 = x(0), xe = x(r.g2), rr = Math.min(4, xe - x0);
      return `M${x0},${-bh / 2}H${xe - rr}Q${xe},${-bh / 2} ${xe},${-bh / 2 + rr}V${bh / 2 - rr}Q${xe},${bh / 2} ${xe - rr},${bh / 2}H${x0}Z`;
    });
    g.append("text").attr("x", (r) => x(r.g2) + 5).attr("dy", "0.35em")
      .text((r) => (narrow ? `×${r.n}` : `×${r.n} · mostly ${r.top_speakers[0][0]}`));
    g.on("mousemove", (ev, r) => showTip(`<b>&ldquo;${esc(r.phrase)}&rdquo;</b><br>said ${fmt(r.n)} times &middot; G&sup2; ${fmt(Math.round(r.g2))}<br>${r.top_speakers.map(([s, k]) => `${esc(s)} (${k})`).join(", ")}`, ev))
      .on("mouseleave", hideTip);
  }

  function trigrams(d) {
    $("#trigram-chips").innerHTML = d.trigrams.slice(0, 18).map((t) => `<span>${esc(t.phrase)}<b>${fmt(t.n)}</b></span>`).join("");
  }

  // ================================================================== CREED
  function creed(d) {
    const rows = d.characters.slice().sort((a, b) => a.mean_content_sim - b.mean_content_sim);
    const lo = rows[0].mean_content_sim, hi = rows[rows.length - 1].mean_content_sim;
    const creedIdx = rows.findIndex((c) => c.name === "Creed");
    const show = rows.slice(0, 6);
    if (creedIdx >= 6) show.push(rows[creedIdx]);
    $("#weird-list").innerHTML = show.map((c) => {
      const i = rows.indexOf(c);
      const w = 20 + 140 * (1 - (c.mean_content_sim - lo) / (hi - lo));
      return `<li value="${i + 1}" class="${c.name === "Creed" ? "creed" : ""}">${esc(c.name.padEnd(8, " "))}<span class="bar" style="width:${w.toFixed(0)}px"></span>${c.distinctive.slice(0, 3).map((x) => esc(x.w)).join(", ")}</li>`;
    }).join("");
    const vocabRank = d.characters.slice().sort((a, b) => b.types_2000 - a.types_2000).findIndex((c) => c.name === "Creed") + 1;
    $("#creed-note").innerHTML = `The longer the yellow bar, the less a character&rsquo;s topics overlap with everyone else&rsquo;s. Creed is only #${creedIdx + 1} of ${rows.length} for weird <i>topics</i>, but he has the #${vocabRank} <i>richest vocabulary</i> in the building. He doesn&rsquo;t talk about strange things; he uses a lot of strange words to do it.`;
  }

  // ================================================================== RATINGS
  function ratings(d) {
    const eps = d.episodes.filter((e) => e.rating != null).map((e, i) => ({ ...e, i: i + 1, has: e.michael_share > 0 }));
    const withM = eps.filter((e) => e.has), without = eps.filter((e) => !e.has);
    const rAll = pearson(eps.map((e) => e.michael_share), eps.map((e) => e.rating));
    const rWith = pearson(withM.map((e) => e.michael_share), withM.map((e) => e.rating));
    $("#rating-r").textContent = `r = ${rAll.toFixed(2)}`;
    $("#ratings-note").innerHTML = `<b>It&rsquo;s not how much Michael talks; it&rsquo;s whether he&rsquo;s there.</b> Episodes with Michael average <b>${d3.mean(withM, (e) => e.rating).toFixed(2)}</b>, episodes without him <b>${d3.mean(without, (e) => e.rating).toFixed(2)}</b>. Among his own ${withM.length} episodes, a bigger share of the dialogue goes with no change in rating at all (r = ${rWith.toFixed(2)}). The all-episodes correlation is really a before/after comparison of the show with and without him.`;

    // --- timeline
    {
      const W = widthOf("#chart-ratings"), H = Math.min(320, Math.max(240, W * 0.5));
      const m = { t: 22, r: 12, b: 30, l: 36 };
      const svg = svgIn("#chart-ratings", W, H);
      const x = d3.scaleLinear().domain([0.5, eps.length + 0.5]).range([m.l, W - m.r]);
      const y = d3.scaleLinear().domain([6.5, 10]).range([H - m.b, m.t]);
      const seasons = d3.groups(eps, (e) => e.season);
      svg.append("g").selectAll("rect").data(seasons).join("rect")
        .attr("x", ([, v]) => x(v[0].i - 0.5)).attr("width", ([, v]) => x(v[v.length - 1].i + 0.5) - x(v[0].i - 0.5))
        .attr("y", m.t).attr("height", H - m.t - m.b).attr("fill", ([s]) => (s % 2 ? "#f3efe4" : "transparent"));
      svg.append("g").selectAll("text").data(seasons).join("text")
        .attr("x", ([, v]) => (x(v[0].i - 0.5) + x(v[v.length - 1].i + 0.5)) / 2).attr("y", m.t - 7).attr("text-anchor", "middle")
        .text(([s]) => (W < 420 ? s : `S${s}`));
      svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5));
      svg.append("text").attr("x", W - m.r).attr("y", H - 8).attr("text-anchor", "end").text("episodes in airing order →");
      svg.append("g").selectAll("circle").data(eps).join("circle")
        .attr("cx", (e) => x(e.i)).attr("cy", (e) => y(e.rating)).attr("r", 4)
        .attr("fill", (e) => (e.has ? C.blue : C.orange)).attr("stroke", PAPER).attr("stroke-width", 1.5)
        .on("mousemove", (ev, e) => showTip(`<b>${esc(e.title)}</b><br>S${e.season} E${e.episode} &middot; IMDb ${e.rating}<br>Michael speaks ${(e.michael_share * 100).toFixed(0)}% of the words`, ev))
        .on("mouseleave", hideTip);
      const bye = eps.find((e) => /Goodbye, Michael/i.test(e.title));
      const fin = eps.find((e) => /Finale/i.test(e.title));
      [[bye, "Goodbye, Michael"], [fin, "Finale"]].forEach(([e, t]) => {
        if (!e) return;
        svg.append("text").attr("class", "lbl strong halo").attr("x", x(e.i) - 6).attr("y", y(e.rating) + 4).attr("text-anchor", "end").text(t);
      });
    }
    howto("#legend-ratings", [
      [sw(C.blue), `<b>Blue</b>: Michael speaks in the episode (${withM.length} episodes).`],
      [sw(C.orange), `<b>Orange</b>: Michael doesn&rsquo;t appear (${without.length} episodes), all of them after &ldquo;Goodbye, Michael&rdquo; in season 7.`],
    ], "Each dot is one episode, left to right in airing order; the shaded bands are seasons. The ratings drop when the dots turn orange. That drop, not Michael&rsquo;s amount of talking, is what produces the all-episodes correlation.");

    // --- within-Michael scatter
    {
      const W = widthOf("#chart-ratings2"), H = Math.min(320, Math.max(240, W * 0.8));
      const m = { t: 14, r: 12, b: 36, l: 36 };
      const svg = svgIn("#chart-ratings2", W, H);
      const x = d3.scaleLinear().domain([0, d3.max(withM, (e) => e.michael_share)]).range([m.l, W - m.r]).nice();
      const y = d3.scaleLinear().domain([6.5, 10]).range([H - m.b, m.t]);
      svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4, "%"));
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5));
      svg.append("text").attr("x", W - m.r).attr("y", H - 4).attr("text-anchor", "end").text("Michael’s share of the words");
      svg.append("g").selectAll("circle").data(withM).join("circle")
        .attr("cx", (e) => x(e.michael_share)).attr("cy", (e) => y(e.rating)).attr("r", 4)
        .attr("fill", C.blue).attr("fill-opacity", 0.8).attr("stroke", PAPER).attr("stroke-width", 1.5)
        .on("mousemove", (ev, e) => showTip(`<b>${esc(e.title)}</b><br>IMDb ${e.rating} &middot; Michael ${(e.michael_share * 100).toFixed(0)}%`, ev))
        .on("mouseleave", hideTip);
      svg.append("text").attr("class", "lbl strong halo").attr("x", W - m.r).attr("y", m.t + 10).attr("text-anchor", "end").text(`r = ${rWith.toFixed(2)}`);
      howto("#howto-ratings2", [[sw(C.blue), "<b>Blue dots</b>: only the episodes with Michael in them."]],
        "Further right = Michael speaks more of the episode. No upward trend: once he&rsquo;s in the episode, more Michael doesn&rsquo;t mean a better rating.");
    }
  }

  // ================================================================== GAME
  function game(d) {
    const G = d.game;
    const cast = G.cast;
    const norms = Object.fromEntries(cast.map((s) => [s, Math.sqrt(Object.values(G.profiles[s]).reduce((a, v) => a + v * v, 0))]));
    const tokenize = (t) => (t.toLowerCase().replace(/’/g, "'").match(/[a-z]+(?:'[a-z]+)?/g) || []);
    function botGuess(text) {
      const toks = tokenize(text);
      const scores = cast.map((s) => {
        const p = G.profiles[s];
        let sc = 0;
        const hits = [];
        toks.forEach((t) => { if (p[t]) { sc += p[t]; hits.push([t, p[t]]); } });
        return { s, score: sc / norms[s], hits };
      }).sort((a, b) => b.score - a.score);
      return scores;
    }

    $("#bot-acc").textContent = Math.round(G.bot_accuracy * 100) + "%";
    $("#bot-chance").textContent = Math.round(100 / cast.length) + "%";
    $("#cast-grid").innerHTML = cast.map((s) => `<button type="button" class="cast-btn" data-who="${esc(s)}"><span class="ini" style="background:var(--navy)">${esc(s.slice(0, 2).toUpperCase())}</span>${esc(s)}</button>`).join("");

    const ROUNDS = 10;
    let deck = [], round = 0, you = 0, bot = 0, current = null;
    const QUIPS_BOT_WINS = ["FALSE. You are wrong. I am right. — D.S.", "Identity theft is not a joke. Neither is your score.", "I am faster than 80% of all snakes. And better at this."];
    const QUIPS_YOU_WIN = ["Dwight has requested a recount.", "Dwight is filing a complaint with Toby.", "Dwight claims the quote was rigged by Jim."];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];

    function newGame() {
      deck = d3.shuffle(G.quotes.slice()).slice(0, ROUNDS);
      round = 0; you = 0; bot = 0;
      next();
    }
    function next() {
      if (round >= ROUNDS) return finish();
      current = deck[round];
      round++;
      $("#game-round").textContent = `Round ${round} of ${ROUNDS}`;
      $("#score-you").textContent = you;
      $("#score-bot").textContent = bot;
      $("#quote").innerHTML = `&ldquo;${esc(current.text)}&rdquo;`;
      $("#game-result").innerHTML = "";
      $("#game-next").hidden = true;
      $$(".cast-btn").forEach((b) => { b.disabled = false; b.classList.remove("right", "wrong", "bot"); });
    }
    function guess(who) {
      if (!current || $("#game-next").hidden === false) return;
      const scores = botGuess(current.text);
      const botPick = scores[0].score > 0 ? scores[0].s : pick(cast);
      const youRight = who === current.speaker, botRight = botPick === current.speaker;
      if (youRight) { you++; window.DM5 && window.DM5.addBucks(10); }
      if (botRight) bot++;
      $("#score-you").textContent = you;
      $("#score-bot").textContent = bot;
      $$(".cast-btn").forEach((b) => {
        b.disabled = true;
        if (b.dataset.who === current.speaker) b.classList.add("right");
        else if (b.dataset.who === who) b.classList.add("wrong");
        if (b.dataset.who === botPick) b.classList.add("bot");
      });
      $("#quote").innerHTML = `&ldquo;${esc(current.text)}&rdquo;<span class="ep">&mdash; ${esc(current.speaker)}, S${current.season} E${current.episode} &ldquo;${esc(current.title)}&rdquo;</span>`;
      const top = scores[0];
      const clues = top.hits.sort((a, b) => b[1] - a[1]).slice(0, 3).map((h) => `&ldquo;${esc(h[0])}&rdquo;`);
      const why = top.score > 0
        ? `Dwight guessed <b>${esc(botPick)}</b> because of ${clues.join(", ")}.`
        : `None of these words are in Dwight&rsquo;s files, so he guessed <b>${esc(botPick)}</b> at random.`;
      const verdict = youRight && !botRight ? pick(QUIPS_YOU_WIN) : !youRight && botRight ? pick(QUIPS_BOT_WINS) : youRight ? "You both got it. Dwight insists he was first." : "Neither of you got it. Dwight blames the transcript.";
      $("#game-result").innerHTML = `${youRight ? "&#9989; Correct! +10 Schrute Bucks." : `&#10060; It was <b>${esc(current.speaker)}</b>.`} ${why} <i>${verdict}</i> <span style="color:var(--ink-faint)">(Dashed outline = Dwight&rsquo;s pick.)</span>`;
      const nb = $("#game-next");
      nb.hidden = false;
      nb.textContent = round >= ROUNDS ? "See final score →" : "Next quote →";
      nb.focus();
    }
    function finish() {
      const msg = you > bot ? `You beat the bot ${you}–${bot}. Dwight demands a rematch.` : you < bot ? `Dwight wins ${bot}–${you}. He will be insufferable about this.` : `A ${you}–${bot} tie. Dwight claims victory anyway.`;
      $("#quote").innerHTML = `<b>Final score.</b> ${msg}`;
      $("#game-result").innerHTML = "";
      $$(".cast-btn").forEach((b) => { b.disabled = true; b.classList.remove("right", "wrong", "bot"); });
      const nb = $("#game-next");
      nb.hidden = false;
      nb.textContent = "Play again →";
      current = null;
      round = ROUNDS + 1;
      if (window.DM5) window.DM5.toast("Break Room", msg, "\u{1F3AE}", 6000);
    }
    $("#cast-grid").addEventListener("click", (e) => { const b = e.target.closest(".cast-btn"); if (b && !b.disabled) guess(b.dataset.who); });
    $("#game-next").addEventListener("click", () => { if (round > ROUNDS) newGame(); else next(); });
    newGame();
  }
})();
