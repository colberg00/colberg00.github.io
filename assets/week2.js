/* ============================================================
   Case No. 02 — Built, Not Born
   FIELD TOOLKIT // NETWORK SYNTHESIZER v1.0

   Loads the same week1 TSVs to get the real Marvel network's
   stats, then lets the visitor grow three synthetic networks
   (preferential attachment, uniform growth, static random) at
   the same scale and compare which one actually looks like it.
   Pure vanilla JS + D3 (loaded globally as `d3`).
   ============================================================ */
(function () {
  "use strict";

  const NODES_URL = "../week1_nodes.tsv";
  const EDGES_URL = "../week1_edges.tsv";

  // ---------------------------------------------------------------
  // Shared graph utilities (undirected only — this case file never
  // needs direction)
  // ---------------------------------------------------------------
  function parseTSV(text, cols) {
    return text
      .split(/\r?\n/)
      .filter((l) => l.length && !l.startsWith("#"))
      .slice(1)
      .map((line) => {
        const parts = line.split("\t");
        const obj = {};
        cols.forEach((c, i) => (obj[c] = parts[i]));
        return obj;
      });
  }

  function buildUndirected(nodeIds, edgePairs) {
    const adj = new Map(nodeIds.map((id) => [id, new Set()]));
    edgePairs.forEach(([a, b]) => {
      if (!adj.has(a) || !adj.has(b) || a === b) return;
      adj.get(a).add(b);
      adj.get(b).add(a);
    });
    return adj;
  }

  function connectedComponents(nodeIds, adj) {
    const seen = new Set();
    const comps = [];
    for (const id of nodeIds) {
      if (seen.has(id)) continue;
      const queue = [id];
      seen.add(id);
      const comp = [id];
      while (queue.length) {
        const cur = queue.shift();
        for (const nb of adj.get(cur)) {
          if (!seen.has(nb)) {
            seen.add(nb);
            queue.push(nb);
            comp.push(nb);
          }
        }
      }
      comps.push(comp);
    }
    comps.sort((a, b) => b.length - a.length);
    return comps;
  }

  function bfsFrom(root, adj) {
    const dist = new Map([[root, 0]]);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of adj.get(cur)) {
        if (!dist.has(nb)) {
          dist.set(nb, dist.get(cur) + 1);
          queue.push(nb);
        }
      }
    }
    return dist;
  }

  // full stats block used for both the real network and every
  // synthetic run: n, m, avg degree, max degree, avg clustering,
  // transitivity, giant-component fraction, avg path length (giant only)
  function computeStats(nodeIds, adj) {
    const n = nodeIds.length;
    let m2 = 0;
    let maxDegree = 0;
    let leaderId = null;
    nodeIds.forEach((id) => {
      const k = adj.get(id).size;
      m2 += k;
      if (k > maxDegree) {
        maxDegree = k;
        leaderId = id;
      }
    });
    const m = m2 / 2;
    const avgDegree = n ? m2 / n : 0;

    let sumC = 0;
    let triangleSum = 0;
    let tripleSum = 0;
    nodeIds.forEach((id) => {
      const nb = Array.from(adj.get(id));
      const k = nb.length;
      if (k >= 2) {
        let links = 0;
        for (let i = 0; i < nb.length; i++) {
          const ai = adj.get(nb[i]);
          for (let j = i + 1; j < nb.length; j++) {
            if (ai.has(nb[j])) links++;
          }
        }
        const possible = (k * (k - 1)) / 2;
        sumC += links / possible;
        triangleSum += links;
        tripleSum += possible;
      }
    });
    const avgClustering = n ? sumC / n : 0;
    const transitivity = tripleSum ? triangleSum / tripleSum : 0;

    const comps = connectedComponents(nodeIds, adj);
    const giant = comps[0] || [];
    const giantFraction = n ? giant.length / n : 0;

    let pathSum = 0;
    let pathPairs = 0;
    giant.forEach((id) => {
      const dist = bfsFrom(id, adj);
      dist.forEach((d) => {
        if (d > 0) {
          pathSum += d;
          pathPairs++;
        }
      });
    });
    const avgPathLength = pathPairs ? pathSum / pathPairs : 0;

    return {
      n,
      m,
      avgDegree,
      maxDegree,
      leaderId,
      avgClustering,
      transitivity,
      giantFraction,
      giantSize: giant.length,
      avgPathLength,
    };
  }

  function degreeDistribution(nodeIds, adj) {
    const counts = new Map();
    nodeIds.forEach((id) => {
      const k = adj.get(id).size;
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return counts;
  }

  // rough power-law-ish slope: OLS fit of log(count) ~ log(degree) over degree>0
  function roughSlope(countsMap) {
    const pts = Array.from(countsMap, ([k, c]) => [Math.log(k), Math.log(c)]).filter(
      ([k]) => isFinite(k) && k > 0
    );
    if (pts.length < 3) return null;
    const nP = pts.length;
    const sx = pts.reduce((s, p) => s + p[0], 0);
    const sy = pts.reduce((s, p) => s + p[1], 0);
    const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0);
    const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
    const denom = nP * sxx - sx * sx;
    if (!denom) return null;
    return (nP * sxy - sx * sy) / denom;
  }

  // ---------------------------------------------------------------
  // Synthesizers — every generator returns { finalAdj, nodeIds, timeline }
  // where timeline is a list of frames the animator can step through:
  // { addNodes:[ids], addEdges:[[a,b],...] }
  // ---------------------------------------------------------------
  function pickDistinct(pool, count, exclude, pickFn) {
    const out = new Set();
    let guard = 0;
    while (out.size < count && guard < 20000) {
      guard++;
      const cand = pickFn(pool);
      if (cand !== exclude && !out.has(cand)) out.add(cand);
    }
    return Array.from(out);
  }

  function generateGrowth(n, m, preferential) {
    m = Math.max(1, m);
    const seedCount = Math.min(n, m + 1);
    const adj = new Map();
    const stubs = []; // repeated-id list, weighted by degree (used only if preferential)
    const nodeIds = [];
    const timeline = [];

    const seedIds = [];
    for (let i = 0; i < seedCount; i++) {
      seedIds.push(i);
      nodeIds.push(i);
      adj.set(i, new Set());
    }
    const seedEdges = [];
    for (let i = 0; i < seedCount; i++) {
      for (let j = i + 1; j < seedCount; j++) {
        adj.get(i).add(j);
        adj.get(j).add(i);
        seedEdges.push([i, j]);
        stubs.push(i, j);
      }
    }
    timeline.push({ addNodes: seedIds.slice(), addEdges: seedEdges });

    for (let v = seedCount; v < n; v++) {
      adj.set(v, new Set());
      const targetCount = Math.min(m, v);
      const targets = preferential
        ? pickDistinct(stubs, targetCount, v, (pool) => pool[Math.floor(Math.random() * pool.length)])
        : pickDistinct(nodeIds, targetCount, v, (pool) => pool[Math.floor(Math.random() * pool.length)]);

      const edges = [];
      targets.forEach((t) => {
        adj.get(v).add(t);
        adj.get(t).add(v);
        edges.push([v, t]);
        if (preferential) stubs.push(v, t);
      });
      nodeIds.push(v);
      timeline.push({ addNodes: [v], addEdges: edges });
    }

    return { finalAdj: adj, nodeIds, timeline };
  }

  function generateStaticRandom(n, p) {
    const adj = new Map();
    const nodeIds = [];
    for (let i = 0; i < n; i++) {
      nodeIds.push(i);
      adj.set(i, new Set());
    }
    const edges = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.random() < p) {
          adj.get(i).add(j);
          adj.get(j).add(i);
          edges.push([i, j]);
        }
      }
    }
    // Fisher–Yates shuffle so the "reveal" order isn't sorted by id
    for (let i = edges.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [edges[i], edges[j]] = [edges[j], edges[i]];
    }
    const CHUNKS = Math.max(1, Math.min(60, edges.length || 1));
    const chunkSize = Math.ceil(edges.length / CHUNKS) || 1;
    const timeline = [{ addNodes: nodeIds.slice(), addEdges: [] }];
    for (let i = 0; i < edges.length; i += chunkSize) {
      timeline.push({ addNodes: [], addEdges: edges.slice(i, i + chunkSize) });
    }
    return { finalAdj: adj, nodeIds, timeline };
  }

  // ---------------------------------------------------------------
  // Terminal log helper
  // ---------------------------------------------------------------
  function makeLogger(el) {
    return function log(text, cls) {
      const line = document.createElement("div");
      line.className = "tline" + (cls ? " " + cls : "");
      line.textContent = text;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    };
  }

  // ---------------------------------------------------------------
  // Flash-update a stat tile, Yu-Gi-Oh life-point style
  // ---------------------------------------------------------------
  function flashStat(el, text, direction) {
    el.textContent = text;
    el.classList.remove("flash-up", "flash-down", "flash-flat");
    void el.offsetWidth; // force reflow so the animation can restart
    el.classList.add(direction === 1 ? "flash-up" : direction === -1 ? "flash-down" : "flash-flat");
  }

  // ---------------------------------------------------------------
  // Live growth visualization (small force graph, terminal-styled)
  // ---------------------------------------------------------------
  function createLiveGraph(container) {
    const w = 560,
      h = 320;
    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);
    const linkLayer = svg.append("g");
    const nodeLayer = svg.append("g");

    let nodes = [];
    let links = [];
    let leaderId = null;

    const sim = d3
      .forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(-14))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("link", d3.forceLink(links).id((d) => d.id).distance(16).strength(0.35))
      .force("collide", d3.forceCollide().radius((d) => d.r + 1))
      .alphaDecay(0.02)
      .on("tick", ticked);

    function ticked() {
      linkLayer
        .selectAll("line")
        .data(links, (d) => d.source.id + "-" + d.target.id)
        .join("line")
        .attr("stroke", "#2f6b46")
        .attr("stroke-opacity", 0.55)
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);

      nodeLayer
        .selectAll("circle")
        .data(nodes, (d) => d.id)
        .join("circle")
        .attr("r", (d) => (d.id === leaderId ? d.r + 2.5 : d.r))
        .attr("fill", (d) => (d.id === leaderId ? "#ffcf5c" : "#4ffb84"))
        .attr("stroke", (d) => (d.id === leaderId ? "#ffcf5c" : "none"))
        .attr("stroke-width", 1.4)
        .attr("stroke-opacity", 0.6)
        .attr("cx", (d) => d.x)
        .attr("cy", (d) => d.y);
    }

    function reset() {
      nodes = [];
      links = [];
      leaderId = null;
      sim.nodes(nodes);
      sim.force("link").links(links);
      nodeLayer.selectAll("circle").remove();
      linkLayer.selectAll("line").remove();
    }

    function degreeOf(id) {
      const n = nodes.find((x) => x.id === id);
      return n ? n._deg : 0;
    }

    function applyFrame(frame) {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      frame.addNodes.forEach((id) => {
        const n = { id, _deg: 0, x: w / 2 + (Math.random() - 0.5) * 40, y: h / 2 + (Math.random() - 0.5) * 40 };
        nodes.push(n);
        byId.set(id, n);
      });
      frame.addEdges.forEach(([a, b]) => {
        links.push({ source: a, target: b });
        const na = byId.get(a);
        const nb = byId.get(b);
        if (na) na._deg++;
        if (nb) nb._deg++;
      });
      nodes.forEach((n) => (n.r = Math.max(2, Math.min(13, 2 + Math.sqrt(n._deg) * 1.4))));

      let maxDeg = -1;
      nodes.forEach((n) => {
        if (n._deg > maxDeg) {
          maxDeg = n._deg;
          leaderId = n.id;
        }
      });

      sim.nodes(nodes);
      sim.force("link").links(links);
      sim.alpha(Math.max(sim.alpha(), 0.5)).restart();
    }

    return { reset, applyFrame, degreeOf, get leaderId() { return leaderId; } };
  }

  // ---------------------------------------------------------------
  // Charts (paper-styled, reused for the printout finale)
  // ---------------------------------------------------------------
  function svgRoot(el, w, h) {
    el.innerHTML = "";
    return d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);
  }

  const SERIES_COLOR = {
    marvel: "#9c2b21",
    preferential: "#4a7c3f",
    uniform: "#2f5e6b",
    random: "#8a7a62",
    scaleup: "#a9822f",
  };
  const SERIES_LABEL = {
    marvel: "MARVEL_303 (real)",
    preferential: "Preferential attachment",
    uniform: "Uniform growth",
    random: "Static random",
    scaleup: "Preferential, n=5,000",
  };

  function drawMultiLogLog(el, seriesMap) {
    const w = 620,
      h = 340,
      m = { top: 16, right: 16, bottom: 42, left: 46 };
    const svg = svgRoot(el, w, h);
    const keys = Object.keys(seriesMap);
    if (!keys.length) {
      svg
        .append("text")
        .attr("x", w / 2)
        .attr("y", h / 2)
        .attr("text-anchor", "middle")
        .attr("font-family", "Courier Prime, monospace")
        .attr("font-size", 12)
        .attr("fill", "#8a7a62")
        .text("Run the toolkit above to populate this chart.");
      return;
    }
    let maxDeg = 1,
      maxCount = 1;
    const allPts = {};
    keys.forEach((k) => {
      const pts = Array.from(seriesMap[k], ([degree, count]) => ({ degree, count })).filter((p) => p.degree > 0);
      allPts[k] = pts;
      pts.forEach((p) => {
        if (p.degree > maxDeg) maxDeg = p.degree;
        if (p.count > maxCount) maxCount = p.count;
      });
    });

    const x = d3.scaleLog().domain([1, maxDeg]).range([m.left, w - m.right]);
    const y = d3.scaleLog().domain([1, maxCount]).range([h - m.bottom, m.top]);

    svg
      .append("g")
      .attr("transform", `translate(0,${h - m.bottom})`)
      .call(d3.axisBottom(x).ticks(5, "~s"))
      .call((g) => g.selectAll("text").attr("font-size", 10).attr("font-family", "Courier Prime, monospace"))
      .append("text")
      .attr("x", (w - m.left - m.right) / 2 + m.left)
      .attr("y", 34)
      .attr("fill", "#2b2622")
      .attr("font-size", 11)
      .attr("text-anchor", "middle")
      .text("degree (log scale)");

    svg
      .append("g")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5, "~s"))
      .call((g) => g.selectAll("text").attr("font-size", 10).attr("font-family", "Courier Prime, monospace"));

    keys.forEach((k) => {
      svg
        .selectAll(`circle.pt-${k}`)
        .data(allPts[k])
        .join("circle")
        .attr("class", `pt-${k}`)
        .attr("cx", (p) => x(p.degree))
        .attr("cy", (p) => y(p.count))
        .attr("r", 3.2)
        .attr("fill", SERIES_COLOR[k])
        .attr("fill-opacity", 0.85)
        .append("title")
        .text(() => SERIES_LABEL[k]);
    });

    const legend = svg.append("g").attr("font-family", "Courier Prime, monospace").attr("font-size", 10.5);
    keys.forEach((k, i) => {
      const row = legend.append("g").attr("transform", `translate(${m.left + 4},${m.top + i * 15})`);
      row.append("circle").attr("r", 4).attr("cx", 4).attr("cy", -3).attr("fill", SERIES_COLOR[k]);
      row.append("text").attr("x", 12).attr("fill", "#2b2622").text(SERIES_LABEL[k]);
    });
  }

  function drawMiniHist(el, degreesArr, color) {
    const w = 260,
      h = 170,
      m = { top: 8, right: 8, bottom: 24, left: 30 };
    const svg = svgRoot(el, w, h);
    if (!degreesArr || !degreesArr.length) {
      svg
        .append("text")
        .attr("x", w / 2)
        .attr("y", h / 2)
        .attr("text-anchor", "middle")
        .attr("font-family", "Courier Prime, monospace")
        .attr("font-size", 10)
        .attr("fill", "#8a7a62")
        .text("no data yet");
      return;
    }
    const maxDeg = d3.max(degreesArr) || 1;
    const binWidth = Math.max(1, Math.ceil((maxDeg + 1) / 12));
    const nBins = Math.floor(maxDeg / binWidth) + 1;
    const bins = Array.from({ length: nBins }, (_, i) => ({ lo: i * binWidth, count: 0 }));
    degreesArr.forEach((d) => bins[Math.min(nBins - 1, Math.floor(d / binWidth))].count++);

    const x = d3.scaleBand().domain(bins.map((b) => b.lo)).range([m.left, w - m.right]).padding(0.12);
    const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.count)]).nice().range([h - m.bottom, m.top]);

    svg
      .append("g")
      .attr("transform", `translate(0,${h - m.bottom})`)
      .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % 3 === 0)))
      .call((g) => g.selectAll("text").attr("font-size", 8).attr("font-family", "Courier Prime, monospace"));
    svg
      .append("g")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(4))
      .call((g) => g.selectAll("text").attr("font-size", 8).attr("font-family", "Courier Prime, monospace"));
    svg
      .selectAll("rect")
      .data(bins)
      .join("rect")
      .attr("x", (b) => x(b.lo))
      .attr("y", (b) => y(b.count))
      .attr("width", x.bandwidth())
      .attr("height", (b) => h - m.bottom - y(b.count))
      .attr("fill", color);
  }

  // ---------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------
  async function init() {
    const [nodesTxt, edgesTxt] = await Promise.all([
      fetch(NODES_URL).then((r) => r.text()),
      fetch(EDGES_URL).then((r) => r.text()),
    ]);
    const nodeRows = parseTSV(nodesTxt, ["node_id", "name", "wikidata_id", "url", "description"]);
    const edgeRows = parseTSV(edgesTxt, ["source", "target"]);
    const nodeIds = nodeRows.map((r) => r.node_id);
    const edgePairs = edgeRows.map((r) => [r.source, r.target]);
    const adj = buildUndirected(nodeIds, edgePairs);
    const marvelStats = computeStats(nodeIds, adj);
    const marvelDegrees = degreeDistribution(nodeIds, adj);
    const marvelDegArr = nodeIds.map((id) => adj.get(id).size);
    const marvelSlope = roughSlope(marvelDegrees);

    renderBriefing(marvelStats);

    const N = marvelStats.n;
    const m = Math.max(1, Math.round(marvelStats.m / N));
    const p = marvelStats.m / ((N * (N - 1)) / 2);

    const state = {
      N,
      m,
      p,
      marvelStats,
      marvelDegrees,
      marvelDegArr,
      marvelSlope,
      runs: {}, // mode -> {stats, degrees, degArr}
      scaleup: null, // {stats, degrees}
      currentMode: "preferential",
      running: false,
      skip: false,
    };

    setupToolkit(state);
    renderComparison(state);
    renderCharts(state);
    renderFindings(state);
  }

  function renderBriefing(s) {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set("stat-nodes", s.n);
    set("stat-edges", Math.round(s.m));
    set("stat-avgk", s.avgDegree.toFixed(1));
    set("stat-clustering", s.avgClustering.toFixed(2));
    set("stat-pathlen", s.avgPathLength.toFixed(2));
    set("stat-maxdeg", s.maxDegree);
  }

  // ---------------------------------------------------------------
  // Toolkit terminal controller
  // ---------------------------------------------------------------
  function setupToolkit(state) {
    const els = {
      modeBtns: Array.from(document.querySelectorAll(".mode-btn")),
      executeBtn: document.getElementById("execute-btn"),
      skipBtn: document.getElementById("skip-btn"),
      scaleupBtn: document.getElementById("scaleup-btn"),
      log: document.getElementById("term-log"),
      graph: document.getElementById("term-graph"),
      trackPref: document.getElementById("track-preferential"),
      trackUniform: document.getElementById("track-uniform"),
      trackRandom: document.getElementById("track-random"),
      tNodes: document.getElementById("tstat-nodes"),
      tEdges: document.getElementById("tstat-edges"),
      tMaxDeg: document.getElementById("tstat-maxdeg"),
      tAvgC: document.getElementById("tstat-avgc"),
      tGiant: document.getElementById("tstat-giant"),
      tLeader: document.getElementById("tstat-leader"),
    };
    const log = makeLogger(els.log);
    const liveGraph = createLiveGraph(els.graph);

    els.modeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.running) return;
        state.currentMode = btn.dataset.mode;
        els.modeBtns.forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
    els.modeBtns.find((b) => b.dataset.mode === state.currentMode)?.classList.add("active");

    els.executeBtn.addEventListener("click", () => runMode(state.currentMode));
    els.scaleupBtn.addEventListener("click", () => runScaleUp());
    els.skipBtn.addEventListener("click", () => {
      state.skip = true;
    });

    const MODE_META = {
      preferential: {
        label: "PREFERENTIAL ATTACHMENT",
        blurb: "growth + rich-get-richer — new files attach to existing ones in proportion to how many links they already have.",
        trackEl: () => els.trackPref,
      },
      uniform: {
        label: "UNIFORM GROWTH",
        blurb: "growth without preference — new files attach to existing ones picked uniformly at random.",
        trackEl: () => els.trackUniform,
      },
      random: {
        label: "STATIC RANDOM",
        blurb: "no growth phase — all files exist from the start, links assigned by fixed probability p, Erdős–Rényi style.",
        trackEl: () => els.trackRandom,
      },
    };

    function setRunningUI(isRunning) {
      state.running = isRunning;
      els.executeBtn.disabled = isRunning;
      els.modeBtns.forEach((b) => (b.disabled = isRunning));
      els.skipBtn.hidden = !isRunning;
      state.skip = false;
    }

    async function runMode(mode) {
      if (state.running) return;
      setRunningUI(true);
      liveGraph.reset();
      els.log.innerHTML = "";
      const meta = MODE_META[mode];
      log(`> booting NETWORK-SYNTH engine...`);
      log(`> mode: ${meta.label}`);
      log(`> ${meta.blurb}`);
      log(`> target roster size: ${state.N} case files`);

      let gen;
      if (mode === "preferential") gen = generateGrowth(state.N, state.m, true);
      else if (mode === "uniform") gen = generateGrowth(state.N, state.m, false);
      else gen = generateStaticRandom(state.N, state.p);

      if (mode === "random") {
        log(`> no growth process detected for this mode.`);
        log(`> assigning links at p=${state.p.toFixed(4)} across all ${state.N} files simultaneously...`);
      } else {
        log(`> seeding initial clique (${Math.min(state.N, state.m + 1)} files, fully linked)...`);
      }

      await playTimeline(gen.timeline, liveGraph, els, log, state, mode);

      const finalStats = computeStats(gen.nodeIds, gen.finalAdj);
      const finalDegrees = degreeDistribution(gen.nodeIds, gen.finalAdj);
      const finalDegArr = gen.nodeIds.map((id) => gen.finalAdj.get(id).size);
      state.runs[mode] = { stats: finalStats, degrees: finalDegrees, degArr: finalDegArr };

      log(`> growth complete. n=${finalStats.n}, m=${Math.round(finalStats.m)}.`);
      log(`> writing results to case comparison ledger...`, "tline-done");

      meta.trackEl().classList.add("done");
      meta.trackEl().textContent = `[x] ${meta.label}`;

      els.scaleupBtn.hidden = mode !== "preferential" && !state.runs.preferential;
      setRunningUI(false);

      renderComparison(state);
      renderCharts(state);
      renderFindings(state);
    }

    async function playTimeline(timeline, liveGraph, els, log, state, mode) {
      let logEvery = Math.max(1, Math.floor(timeline.length / 12));
      let checkpointEvery = Math.max(1, Math.floor(timeline.length / 18));
      const snapshotAdj = new Map();
      const snapshotIds = [];

      for (let i = 0; i < timeline.length; i++) {
        if (state.skip) {
          // fast-forward the rest without per-frame delay
          for (let j = i; j < timeline.length; j++) applySnapshot(timeline[j]);
          liveGraph.applyFrame({ addNodes: [], addEdges: [] });
          updateStatTiles(true);
          break;
        }
        applySnapshot(timeline[i]);
        liveGraph.applyFrame(timeline[i]);

        if (i % logEvery === 0 && timeline[i].addNodes.length > 1) {
          log(`> seed clique established — ${timeline[i].addNodes.length} files, ${timeline[i].addEdges.length} link(s).`);
        } else if (i % logEvery === 0 && timeline[i].addNodes.length === 1) {
          log(`> file #${String(timeline[i].addNodes[0]).padStart(3, "0")} intake — ${timeline[i].addEdges.length} link(s) formed.`);
        }
        if (i % checkpointEvery === 0 || i === timeline.length - 1) {
          updateStatTiles(false);
        }
        await wait(mode === "random" ? 55 : 45);
      }

      function applySnapshot(frame) {
        frame.addNodes.forEach((id) => {
          snapshotIds.push(id);
          snapshotAdj.set(id, new Set());
        });
        frame.addEdges.forEach(([a, b]) => {
          snapshotAdj.get(a).add(b);
          snapshotAdj.get(b).add(a);
        });
      }

      function updateStatTiles(isFinal) {
        const s = computeStats(snapshotIds, snapshotAdj);
        const prev = state._lastTileStats || {};
        flashStat(els.tNodes, s.n, cmp(s.n, prev.n));
        flashStat(els.tEdges, Math.round(s.m), cmp(s.m, prev.m));
        flashStat(els.tMaxDeg, s.maxDegree, cmp(s.maxDegree, prev.maxDegree));
        flashStat(els.tAvgC, s.avgClustering.toFixed(3), cmp(s.avgClustering, prev.avgClustering));
        flashStat(els.tGiant, Math.round(s.giantFraction * 100) + "%", cmp(s.giantFraction, prev.giantFraction));
        const leaderTxt = s.leaderId != null ? `FILE-${String(s.leaderId).padStart(3, "0")} (deg ${s.maxDegree})` : "—";
        flashStat(els.tLeader, leaderTxt, 0);
        state._lastTileStats = s;
      }

      function cmp(a, b) {
        if (b === undefined) return 0;
        if (a > b) return 1;
        if (a < b) return -1;
        return 0;
      }
    }

    function wait(ms) {
      return new Promise((res) => setTimeout(res, ms));
    }

    async function runScaleUp() {
      if (state.running || !state.runs.preferential) return;
      setRunningUI(true);
      log(`> FAST-FORWARD requested: growing a fresh preferential-attachment network to n=5,000...`);
      await wait(30);
      const gen = generateGrowth(5000, state.m, true);
      const finalAdj = gen.finalAdj;
      const degrees = gen.nodeIds.map((id) => finalAdj.get(id).size);
      const maxDeg = d3.max(degrees);
      const minDeg = d3.min(degrees);
      const degCounts = degreeDistribution(gen.nodeIds, finalAdj);
      const slope = roughSlope(degCounts);
      state.scaleup = { degrees: degCounts, maxDeg, minDeg, slope };
      log(`> n=5,000 complete. max degree=${maxDeg}, min degree=${minDeg}.`);
      log(`> log-log slope ≈ ${slope !== null ? slope.toFixed(2) : "n/a"} (power law γ ≈ ${slope !== null ? (1 - slope).toFixed(2) : "n/a"})`, "tline-done");
      setRunningUI(false);
      renderCharts(state);
      renderFindings(state);
    }
  }

  // ---------------------------------------------------------------
  // Analysis: comparison table
  // ---------------------------------------------------------------
  function renderComparison(state) {
    const tbody = document.getElementById("comparison-tbody");
    if (!tbody) return;
    const rows = [
      { key: "marvel", label: "MARVEL_303 (real)", stats: state.marvelStats },
      { key: "preferential", label: "Preferential attachment", stats: state.runs.preferential?.stats },
      { key: "uniform", label: "Uniform growth", stats: state.runs.uniform?.stats },
      { key: "random", label: "Static random", stats: state.runs.random?.stats },
    ];
    tbody.innerHTML = rows
      .map((r) => {
        if (!r.stats) {
          return `<tr class="empty-row"><td>${r.label}</td><td colspan="6">[ NO DATA — run this case in the toolkit above ]</td></tr>`;
        }
        const s = r.stats;
        return `<tr>
          <td>${r.label}</td>
          <td>${s.n}</td>
          <td>${Math.round(s.m)}</td>
          <td>${s.avgDegree.toFixed(1)}</td>
          <td>${s.avgClustering.toFixed(3)}</td>
          <td>${s.avgPathLength.toFixed(2)}</td>
          <td>${s.maxDegree}</td>
        </tr>`;
      })
      .join("");
  }

  // ---------------------------------------------------------------
  // Analysis: charts
  // ---------------------------------------------------------------
  function renderCharts(state) {
    const seriesMap = { marvel: state.marvelDegrees };
    if (state.runs.preferential) seriesMap.preferential = state.runs.preferential.degrees;
    if (state.runs.uniform) seriesMap.uniform = state.runs.uniform.degrees;
    if (state.runs.random) seriesMap.random = state.runs.random.degrees;
    if (state.scaleup) seriesMap.scaleup = state.scaleup.degrees;

    const loglogEl = document.getElementById("chart-loglog-multi");
    if (loglogEl) drawMultiLogLog(loglogEl, seriesMap);

    const grid = [
      ["hist-marvel", state.marvelDegArr, SERIES_COLOR.marvel],
      ["hist-preferential", state.runs.preferential?.degArr, SERIES_COLOR.preferential],
      ["hist-uniform", state.runs.uniform?.degArr, SERIES_COLOR.uniform],
      ["hist-random", state.runs.random?.degArr, SERIES_COLOR.random],
    ];
    grid.forEach(([id, arr, color]) => {
      const el = document.getElementById(id);
      if (el) drawMiniHist(el, arr, color);
    });
  }

  // ---------------------------------------------------------------
  // Analysis: dynamic findings text
  // ---------------------------------------------------------------
  function renderFindings(state) {
    const set = (id, html) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };

    const pref = state.runs.preferential?.stats;
    const uni = state.runs.uniform?.stats;
    const rnd = state.runs.random?.stats;
    const mv = state.marvelStats;

    if (pref && uni) {
      set(
        "finding-recipe",
        `<strong>Finding:</strong> after growing both networks to the same ${state.N} files with the same
        number of links per new file, preferential attachment produces a max degree of <b>${pref.maxDegree}</b>
        while uniform growth only reaches <b>${uni.maxDegree}</b> &mdash; growth alone isn't enough to build a hub
        the size of Marvel's biggest (<b>${mv.maxDegree}</b>). It's the <em>preference</em> for already-popular
        files, not the growth process itself, that manufactures a hub.`
      );
    } else {
      set(
        "finding-recipe",
        `Run <b>PREFERENTIAL</b> and <b>UNIFORM</b> in the toolkit above to compare how much of a hub each recipe produces.`
      );
    }

    if (pref && uni && rnd) {
      const ranked = [
        { name: "Preferential attachment", c: pref.avgClustering },
        { name: "Uniform growth", c: uni.avgClustering },
        { name: "Static random", c: rnd.avgClustering },
      ].sort((a, b) => b.c - a.c);
      set(
        "finding-clustering",
        `<strong>Finding:</strong> Marvel's real clustering coefficient is <b>${mv.avgClustering.toFixed(3)}</b>.
        Of the three synthetic recipes, <b>${ranked[0].name}</b> comes closest at
        <b>${ranked[0].c.toFixed(3)}</b> &mdash; none of the three simple models fully reproduce it, which is
        exactly why the null-model tests later this week matter: "close" needs a number attached to it, not
        just an eyeball comparison.`
      );
    } else {
      set(
        "finding-clustering",
        `Run all three case types above to see which recipe's clustering coefficient lands closest to Marvel's real ${mv.avgClustering.toFixed(3)}.`
      );
    }

    if (state.scaleup) {
      const su = state.scaleup;
      set(
        "finding-scaleup",
        `<strong>Finding:</strong> scaled up to n=5,000, preferential attachment's degree distribution has a
        log&ndash;log slope of roughly <b>${su.slope !== null ? su.slope.toFixed(2) : "n/a"}</b>
        (power-law exponent &gamma; &asymp; <b>${su.slope !== null ? (1 - su.slope).toFixed(2) : "n/a"}</b>),
        with max degree <b>${su.maxDeg}</b> against a minimum of <b>${su.minDeg}</b> &mdash; in the right
        neighborhood of the &gamma;&asymp;3 that Barabási&ndash;Albert theory predicts. Marvel's own
        undirected-degree slope, at only ${mv.n} nodes, is a much noisier <b>${
          state.marvelSlope !== null ? state.marvelSlope.toFixed(2) : "n/a"
        }</b> &mdash; a reminder that eyeballing a slope from a few hundred points is exactly the kind of
        power-law claim that needs a proper fit, not a ruler held up to a log&ndash;log plot.`
      );
    } else {
      set(
        "finding-scaleup",
        `Run <b>PREFERENTIAL</b> above at least once, then hit <b>FAST-FORWARD TO n=5,000</b> to see whether the slope firms up at scale.`
      );
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
