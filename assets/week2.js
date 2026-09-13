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
  function parseTSV(text, cols, hasHeader = true) {
    const lines = text.split(/\r?\n/).filter((l) => l.length && !l.startsWith("#"));
    return (hasHeader ? lines.slice(1) : lines) // edges.tsv's header is commented out, so it has none left to drop
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

  // SERIES_COLOR above is tuned for light paper backgrounds (.chart-box,
  // .hist-cell). The Case Analysis panels draw on near-black terminal
  // backgrounds instead, so they need their own bright palette — reusing
  // SERIES_COLOR there made data and text alike unreadable against black.
  const TERM_SERIES_COLOR = {
    marvel: "#e35b52",
    preferential: "#6fce85",
    uniform: "#5ab4c9",
    random: "#c9a24a",
    scaleup: "#ffcf5c",
  };
  const TERM_AXIS = "#9fe8ae"; // axis titles + tick labels on dark terminal backgrounds
  const TERM_LEGEND = "#c8ffd6"; // legend / callout text on dark terminal backgrounds
  const TERM_MUTED = "#5f9c72"; // dim reference lines / placeholder text on dark terminal backgrounds

  // Theoretical PMF-based expected node counts (not CCDF): P(k) scaled by n,
  // for overlaying ER/BA fits on the raw or log-binned degree distribution.
  // The Poisson PMF rises then falls (peaks near k=avgDegree), so unlike a
  // CCDF this must be computed over the full range and filtered afterward —
  // breaking on the first sub-threshold k would cut it off before it starts.
  function erTheoreticalCounts(avgDegree, maxDeg, n, minCount) {
    const pts = [];
    let pmf = Math.exp(-avgDegree);
    for (let k = 1; k <= maxDeg; k++) {
      pmf = (pmf * avgDegree) / k;
      pts.push({ degree: k, count: n * pmf });
    }
    return pts.filter((p) => p.count >= minCount);
  }

  function baTheoreticalCounts(mAttach, maxDeg, n, minCount) {
    const pts = [];
    const k0 = Math.max(1, mAttach);
    for (let k = k0; k <= maxDeg; k++) {
      const pmf = (2 * k0 * (k0 + 1)) / (k * (k + 1) * (k + 2));
      pts.push({ degree: k, count: n * pmf });
    }
    return pts.filter((p) => p.count >= minCount);
  }

  // Aggregate a degree -> count map into log-spaced bins, each point placed
  // at the bin's geometric mean and its count divided by the bin width — the
  // standard "log-binned PDF" trick for reading a heavy tail through noise.
  function logBinnedCounts(countsMap, nBins, maxDeg) {
    const edges = d3.range(nBins + 1).map((i) => Math.pow(10, (Math.log10(maxDeg + 1) * i) / nBins));
    const binSums = new Array(nBins).fill(0);
    countsMap.forEach((count, degree) => {
      if (degree <= 0) return;
      let bin = nBins - 1;
      for (let i = 0; i < nBins; i++) {
        if (degree >= edges[i] && degree < edges[i + 1]) {
          bin = i;
          break;
        }
      }
      binSums[bin] += count;
    });
    const pts = [];
    for (let i = 0; i < nBins; i++) {
      if (binSums[i] <= 0) continue;
      const width = edges[i + 1] - edges[i];
      const mid = Math.sqrt(edges[i] * edges[i + 1]); // geometric mean of the bin's edges
      pts.push({ degree: mid, count: binSums[i] / width });
    }
    return pts;
  }

  function drawMultiLogLog(el, seriesMap, opts) {
    opts = opts || {};
    const binning = opts.binning === "binned" ? "binned" : "raw";
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

    // maxDeg from the raw degree keys regardless of display mode — needed to
    // pick log-bin edges even when we're about to bin the data.
    let maxDeg = 1;
    keys.forEach((k) => {
      seriesMap[k].forEach((count, degree) => {
        if (degree > maxDeg) maxDeg = degree;
      });
    });

    const allPts = {};
    keys.forEach((k) => {
      allPts[k] =
        binning === "binned"
          ? logBinnedCounts(seriesMap[k], 20, maxDeg)
          : Array.from(seriesMap[k], ([degree, count]) => ({ degree, count })).filter((p) => p.degree > 0);
    });

    let maxCount = 1,
      minCount = 1;
    keys.forEach((k) => {
      allPts[k].forEach((p) => {
        if (p.count > maxCount) maxCount = p.count;
        if (p.count < minCount) minCount = p.count;
      });
    });

    const fits = [];
    if (opts.fitParams) {
      const erPts = erTheoreticalCounts(opts.fitParams.avgDegree, maxDeg, opts.fitParams.n, minCount);
      if (erPts.length) fits.push({ color: "#33507a", label: `ER fit (Poisson, ⟨k⟩=${opts.fitParams.avgDegree.toFixed(1)})`, points: erPts });
      const baPts = baTheoreticalCounts(opts.fitParams.m, maxDeg, opts.fitParams.n, minCount);
      if (baPts.length) fits.push({ color: "#6b4f14", label: `BA fit (exact, m=${opts.fitParams.m})`, points: baPts });
    }

    const x = d3.scaleLog().domain([1, maxDeg]).range([m.left, w - m.right]);
    const y = d3.scaleLog().domain([minCount, maxCount]).range([h - m.bottom, m.top]);

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
      .text(binning === "binned" ? "degree (log scale) — log-binned" : "degree (log scale)");

    svg
      .append("g")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5, "~s"))
      .call((g) => g.selectAll("text").attr("font-size", 10).attr("font-family", "Courier Prime, monospace"));

    const lineGen = d3
      .line()
      .x((p) => x(p.degree))
      .y((p) => y(p.count));

    fits.forEach((f) => {
      svg.append("path").datum(f.points).attr("fill", "none").attr("stroke", f.color).attr("stroke-width", 1.6).attr("stroke-dasharray", "5,3").attr("d", lineGen);
    });

    keys.forEach((k) => {
      if (binning === "binned") {
        svg.append("path").datum(allPts[k]).attr("fill", "none").attr("stroke", SERIES_COLOR[k]).attr("stroke-width", 1.4).attr("d", lineGen);
      }
      svg
        .selectAll(`circle.pt-${k}`)
        .data(allPts[k])
        .join("circle")
        .attr("class", `pt-${k}`)
        .attr("cx", (p) => x(p.degree))
        .attr("cy", (p) => y(p.count))
        .attr("r", binning === "binned" ? 2.6 : 3.2)
        .attr("fill", SERIES_COLOR[k])
        .attr("fill-opacity", 0.85)
        .append("title")
        .text(() => SERIES_LABEL[k]);
    });

    const legend = svg.append("g").attr("font-family", "Courier Prime, monospace").attr("font-size", 10.5);
    let row = 0;
    keys.forEach((k) => {
      const g = legend.append("g").attr("transform", `translate(${m.left + 4},${m.top + row * 15})`);
      g.append("circle").attr("r", 4).attr("cx", 4).attr("cy", -3).attr("fill", SERIES_COLOR[k]);
      g.append("text").attr("x", 12).attr("fill", "#2b2622").text(SERIES_LABEL[k]);
      row++;
    });
    fits.forEach((f) => {
      const g = legend.append("g").attr("transform", `translate(${m.left + 4},${m.top + row * 15})`);
      g.append("line").attr("x1", 0).attr("x2", 8).attr("y1", -3).attr("y2", -3).attr("stroke", f.color).attr("stroke-width", 1.6).attr("stroke-dasharray", "4,2");
      g.append("text").attr("x", 12).attr("fill", "#2b2622").text(f.label);
      row++;
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
  // Case Analysis I — CCDF + local-slope classifier
  // ---------------------------------------------------------------
  function ccdfFromCounts(countsMap) {
    const degs = Array.from(countsMap.keys()).sort((a, b) => a - b);
    const total = Array.from(countsMap.values()).reduce((s, c) => s + c, 0);
    let cum = total;
    const pts = [];
    degs.forEach((k) => {
      if (k > 0) pts.push({ degree: k, ccdf: cum / total });
      cum -= countsMap.get(k);
    });
    return pts;
  }

  function olsSlopeXY(xs, ys) {
    const nP = xs.length;
    const sx = xs.reduce((s, v) => s + v, 0);
    const sy = ys.reduce((s, v) => s + v, 0);
    const sxx = xs.reduce((s, v) => s + v * v, 0);
    const sxy = xs.reduce((s, v, i) => s + v * ys[i], 0);
    const denom = nP * sxx - sx * sx;
    return denom ? (nP * sxy - sx * sy) / denom : null;
  }

  function localSlopeSeries(ccdfPts, windowSize) {
    windowSize = windowSize || 5;
    const logPts = ccdfPts
      .filter((p) => p.ccdf > 0)
      .map((p) => ({ degree: p.degree, x: Math.log(p.degree), y: Math.log(p.ccdf) }));
    const half = Math.floor(windowSize / 2);
    const out = [];
    for (let i = half; i < logPts.length - half; i++) {
      const win = logPts.slice(i - half, i + half + 1);
      const slope = olsSlopeXY(win.map((p) => p.x), win.map((p) => p.y));
      if (slope !== null) out.push({ degree: logPts[i].degree, slope });
    }
    return out;
  }

  // Poisson approximation to the ER / G(n,p) degree distribution, matched on
  // average degree only (n drops out of the Poisson limit) — P(K>=k).
  function erTheoreticalCcdf(avgDegree, maxDeg, minCcdf) {
    const pts = [];
    let ccdf = 1; // P(K>=0)
    let pmf = Math.exp(-avgDegree); // pmf(0)
    for (let k = 1; k <= maxDeg; k++) {
      ccdf -= pmf; // now P(K>=k)
      if (ccdf < minCcdf) break;
      pts.push({ degree: k, ccdf });
      pmf = (pmf * avgDegree) / k; // pmf(k)
    }
    return pts;
  }

  // Exact mean-field Barabási–Albert CCDF for attachment parameter m:
  // P(k) = 2m(m+1) / (k(k+1)(k+2)) for k>=m, which telescopes to
  // P(K>=k) = m(m+1) / (k(k+1)).
  function baTheoreticalCcdf(mAttach, maxDeg, minCcdf) {
    const pts = [];
    const k0 = Math.max(1, mAttach);
    for (let k = k0; k <= maxDeg; k++) {
      const ccdf = (k0 * (k0 + 1)) / (k * (k + 1));
      if (ccdf < minCcdf) break;
      pts.push({ degree: k, ccdf });
    }
    return pts;
  }

  function drawCCDF(el, seriesMap, fitParams) {
    const w = 300,
      h = 300,
      m = { top: 16, right: 12, bottom: 42, left: 44 };
    const svg = svgRoot(el, w, h);
    const keys = Object.keys(seriesMap);
    if (!keys.length) {
      svg
        .append("text")
        .attr("x", w / 2)
        .attr("y", h / 2)
        .attr("text-anchor", "middle")
        .attr("font-family", "Courier Prime, monospace")
        .attr("font-size", 11)
        .attr("fill", TERM_MUTED)
        .text("Run the scan below.");
      return;
    }
    let maxDeg = 1,
      minCcdf = 1;
    keys.forEach((k) => {
      seriesMap[k].forEach((p) => {
        if (p.degree > maxDeg) maxDeg = p.degree;
        if (p.ccdf < minCcdf) minCcdf = p.ccdf;
      });
    });
    const x = d3.scaleLog().domain([1, maxDeg]).range([m.left, w - m.right]);
    const y = d3.scaleLog().domain([minCcdf, 1]).range([h - m.bottom, m.top]);

    svg
      .append("g")
      .attr("transform", `translate(0,${h - m.bottom})`)
      .call(d3.axisBottom(x).ticks(4, "~s"))
      .call((g) => g.selectAll("text").attr("font-size", 9).attr("font-family", "Courier Prime, monospace").attr("fill", TERM_AXIS))
      .call((g) => g.selectAll("path,line").attr("stroke", TERM_AXIS))
      .append("text")
      .attr("x", (w - m.left - m.right) / 2 + m.left)
      .attr("y", 34)
      .attr("fill", TERM_AXIS)
      .attr("font-size", 10)
      .attr("text-anchor", "middle")
      .text("degree k (log)");

    svg
      .append("g")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(4, "~s"))
      .call((g) => g.selectAll("text").attr("font-size", 9).attr("font-family", "Courier Prime, monospace").attr("fill", TERM_AXIS))
      .call((g) => g.selectAll("path,line").attr("stroke", TERM_AXIS));

    const lineGen = d3
      .line()
      .x((p) => x(p.degree))
      .y((p) => y(p.ccdf));

    const fits = [];
    if (fitParams) {
      const erPts = erTheoreticalCcdf(fitParams.avgDegree, maxDeg, minCcdf);
      if (erPts.length) {
        fits.push({
          color: "#5b7fae",
          label: `ER fit (Poisson, ⟨k⟩=${fitParams.avgDegree.toFixed(1)})`,
          points: erPts,
        });
      }
      const baPts = baTheoreticalCcdf(fitParams.m, maxDeg, minCcdf);
      if (baPts.length) {
        fits.push({ color: "#c9a24a", label: `BA fit (exact, m=${fitParams.m})`, points: baPts });
      }
    }

    // theoretical fits underneath, dashed, no dots (continuous curves, not samples)
    fits.forEach((f) => {
      svg
        .append("path")
        .datum(f.points)
        .attr("fill", "none")
        .attr("stroke", f.color)
        .attr("stroke-width", 1.6)
        .attr("stroke-dasharray", "5,3")
        .attr("d", lineGen);
    });

    // empirical series: connecting line + dots on top
    keys.forEach((k) => {
      svg.append("path").datum(seriesMap[k]).attr("fill", "none").attr("stroke", TERM_SERIES_COLOR[k]).attr("stroke-width", 1.3).attr("d", lineGen);
      svg
        .selectAll(`circle.ccdf-${k}`)
        .data(seriesMap[k])
        .join("circle")
        .attr("class", `ccdf-${k}`)
        .attr("cx", (p) => x(p.degree))
        .attr("cy", (p) => y(p.ccdf))
        .attr("r", 2.6)
        .attr("fill", TERM_SERIES_COLOR[k])
        .attr("fill-opacity", 0.9)
        .append("title")
        .text(() => SERIES_LABEL[k]);
    });

    const legend = svg.append("g").attr("font-family", "Courier Prime, monospace").attr("font-size", 9.5);
    let row = 0;
    keys.forEach((k) => {
      const g = legend.append("g").attr("transform", `translate(${m.left + 2},${m.top + row * 13})`);
      g.append("circle").attr("r", 3.5).attr("cx", 4).attr("cy", -3).attr("fill", TERM_SERIES_COLOR[k]);
      g.append("text").attr("x", 10).attr("fill", TERM_LEGEND).text(SERIES_LABEL[k]);
      row++;
    });
    fits.forEach((f) => {
      const g = legend.append("g").attr("transform", `translate(${m.left + 2},${m.top + row * 13})`);
      g.append("line").attr("x1", 0).attr("x2", 8).attr("y1", -3).attr("y2", -3).attr("stroke", f.color).attr("stroke-width", 1.6).attr("stroke-dasharray", "4,2");
      g.append("text").attr("x", 12).attr("fill", TERM_LEGEND).text(f.label);
      row++;
    });
  }

  function drawLocalSlope(el, seriesMap) {
    const w = 300,
      h = 300,
      m = { top: 16, right: 12, bottom: 42, left: 34 };
    const svg = svgRoot(el, w, h);
    const keys = Object.keys(seriesMap).filter((k) => seriesMap[k].length);
    if (!keys.length) {
      svg
        .append("text")
        .attr("x", w / 2)
        .attr("y", h / 2)
        .attr("text-anchor", "middle")
        .attr("font-family", "Courier Prime, monospace")
        .attr("font-size", 11)
        .attr("fill", TERM_MUTED)
        .text("Run the scan below.");
      return;
    }
    let maxDeg = 1,
      minSlope = -2,
      maxSlope = 0;
    keys.forEach((k) => {
      seriesMap[k].forEach((p) => {
        if (p.degree > maxDeg) maxDeg = p.degree;
        if (p.slope < minSlope) minSlope = p.slope;
        if (p.slope > maxSlope) maxSlope = p.slope;
      });
    });
    const x = d3.scaleLog().domain([1, maxDeg]).range([m.left, w - m.right]);
    const y = d3
      .scaleLinear()
      .domain([minSlope - 0.3, maxSlope + 0.3])
      .range([h - m.bottom, m.top]);

    svg
      .append("g")
      .attr("transform", `translate(0,${h - m.bottom})`)
      .call(d3.axisBottom(x).ticks(4, "~s"))
      .call((g) => g.selectAll("text").attr("font-size", 9).attr("font-family", "Courier Prime, monospace").attr("fill", TERM_AXIS))
      .call((g) => g.selectAll("path,line").attr("stroke", TERM_AXIS))
      .append("text")
      .attr("x", (w - m.left - m.right) / 2 + m.left)
      .attr("y", 34)
      .attr("fill", TERM_AXIS)
      .attr("font-size", 10)
      .attr("text-anchor", "middle")
      .text("degree k (log)");

    svg
      .append("g")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5))
      .call((g) => g.selectAll("text").attr("font-size", 9).attr("font-family", "Courier Prime, monospace").attr("fill", TERM_AXIS))
      .call((g) => g.selectAll("path,line").attr("stroke", TERM_AXIS));

    svg
      .append("line")
      .attr("x1", m.left)
      .attr("x2", w - m.right)
      .attr("y1", y(-2))
      .attr("y2", y(-2))
      .attr("stroke", TERM_MUTED)
      .attr("stroke-dasharray", "4,3");
    svg
      .append("text")
      .attr("x", w - m.right)
      .attr("y", y(-2) - 4)
      .attr("text-anchor", "end")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 8.5)
      .attr("fill", TERM_LEGEND)
      .text("BA predicts −2");

    const line = d3
      .line()
      .x((p) => x(p.degree))
      .y((p) => y(p.slope));
    keys.forEach((k) => {
      svg
        .append("path")
        .datum(seriesMap[k])
        .attr("fill", "none")
        .attr("stroke", TERM_SERIES_COLOR[k])
        .attr("stroke-width", 2)
        .attr("d", line);
    });
  }

  // ---------------------------------------------------------------
  // Case Analysis II — friendship paradox
  // ---------------------------------------------------------------
  function friendshipStats(nodeIds, adj) {
    let sumK = 0,
      sumK2 = 0;
    nodeIds.forEach((id) => {
      const k = adj.get(id).size;
      sumK += k;
      sumK2 += k * k;
    });
    const avgDegree = nodeIds.length ? sumK / nodeIds.length : 0;
    const avgFriendDegree = sumK ? sumK2 / sumK : 0;

    const champions = [];
    const gaps = [];
    nodeIds.forEach((id) => {
      const nb = Array.from(adj.get(id));
      const k = nb.length;
      if (!k) return;
      const nbDegrees = nb.map((x) => adj.get(x).size);
      const maxNb = Math.max(...nbDegrees);
      if (k >= maxNb) champions.push(id);
      const friendAvg = nbDegrees.reduce((s, v) => s + v, 0) / k;
      gaps.push({ id, k, friendAvg, gap: friendAvg - k });
    });
    champions.sort((a, b) => adj.get(b).size - adj.get(a).size);
    gaps.sort((a, b) => b.gap - a.gap);

    const topHubs = nodeIds
      .map((id) => ({ id, k: adj.get(id).size }))
      .sort((a, b) => b.k - a.k)
      .slice(0, 5);

    return { avgDegree, avgFriendDegree, champions, gaps, topHubs };
  }

  function sampleFriendPairs(nodeIds, adj, count) {
    const eligible = nodeIds.filter((id) => adj.get(id).size > 0);
    const out = [];
    for (let i = 0; i < count && eligible.length; i++) {
      const id = eligible[Math.floor(Math.random() * eligible.length)];
      const nb = Array.from(adj.get(id));
      const friend = nb[Math.floor(Math.random() * nb.length)];
      out.push({ k: adj.get(id).size, friendK: adj.get(friend).size });
    }
    return out;
  }

  // Log-spaced density histograms of person-degree vs friend-degree, with a
  // dashed mean line for each — the "size-biased shift, visually" figure.
  function drawFriendHistograms(el, personDegs, friendDegs) {
    const w = 300,
      h = 300,
      m = { top: 16, right: 12, bottom: 42, left: 40 };
    const svg = svgRoot(el, w, h);
    if (!personDegs.length || !friendDegs.length) return;

    const maxDeg = Math.max(1, d3.max(personDegs.concat(friendDegs)));
    const nBins = 16;
    const edges = d3.range(nBins + 1).map((i) => Math.pow(10, (Math.log10(maxDeg + 1) * i) / nBins));

    function densityHist(arr) {
      const counts = new Array(nBins).fill(0);
      arr.forEach((v) => {
        let bin = nBins - 1;
        for (let i = 0; i < nBins; i++) {
          if (v >= edges[i] && v < edges[i + 1]) {
            bin = i;
            break;
          }
        }
        counts[bin]++;
      });
      return counts.map((c, i) => ({
        lo: edges[i],
        hi: edges[i + 1],
        density: c / arr.length / (edges[i + 1] - edges[i]),
      }));
    }

    const personHist = densityHist(personDegs);
    const friendHist = densityHist(friendDegs);
    const x = d3.scaleLog().domain([1, maxDeg + 1]).range([m.left, w - m.right]);
    const maxDensity = Math.max(d3.max(personHist, (b) => b.density), d3.max(friendHist, (b) => b.density)) || 1;
    const y = d3.scaleLinear().domain([0, maxDensity]).nice().range([h - m.bottom, m.top]);

    svg
      .append("g")
      .attr("transform", `translate(0,${h - m.bottom})`)
      .call(d3.axisBottom(x).ticks(4, "~s"))
      .call((g) => g.selectAll("text").attr("font-size", 9).attr("font-family", "Courier Prime, monospace").attr("fill", TERM_AXIS))
      .call((g) => g.selectAll("path,line").attr("stroke", TERM_AXIS))
      .append("text")
      .attr("x", (w - m.left - m.right) / 2 + m.left)
      .attr("y", 34)
      .attr("fill", TERM_AXIS)
      .attr("font-size", 10)
      .attr("text-anchor", "middle")
      .text("degree (log)");

    svg
      .append("g")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(4))
      .call((g) => g.selectAll("text").attr("font-size", 9).attr("font-family", "Courier Prime, monospace").attr("fill", TERM_AXIS))
      .call((g) => g.selectAll("path,line").attr("stroke", TERM_AXIS));

    const personColor = TERM_AXIS;
    const friendColor = TERM_SERIES_COLOR.marvel;

    function drawBars(hist, color) {
      svg
        .selectAll(null)
        .data(hist)
        .join("rect")
        .attr("x", (b) => x(Math.max(1, b.lo)))
        .attr("width", (b) => Math.max(0, x(b.hi) - x(Math.max(1, b.lo))))
        .attr("y", (b) => y(b.density))
        .attr("height", (b) => h - m.bottom - y(b.density))
        .attr("fill", color)
        .attr("fill-opacity", 0.55);
    }
    drawBars(personHist, personColor);
    drawBars(friendHist, friendColor);

    function meanLine(vals, color) {
      const mean = d3.mean(vals);
      svg
        .append("line")
        .attr("x1", x(mean))
        .attr("x2", x(mean))
        .attr("y1", m.top)
        .attr("y2", h - m.bottom)
        .attr("stroke", color)
        .attr("stroke-width", 1.8)
        .attr("stroke-dasharray", "5,3");
    }
    meanLine(personDegs, personColor);
    meanLine(friendDegs, friendColor);

    const legend = svg.append("g").attr("font-family", "Courier Prime, monospace").attr("font-size", 9);
    [
      { color: personColor, label: "person (uniform)" },
      { color: friendColor, label: "friend (size-biased)" },
    ].forEach((it, i) => {
      const row = legend.append("g").attr("transform", `translate(${m.left + 2},${m.top + i * 13})`);
      row.append("rect").attr("width", 8).attr("height", 8).attr("y", -8).attr("fill", it.color).attr("fill-opacity", 0.7);
      row.append("text").attr("x", 12).attr("fill", TERM_LEGEND).text(it.label);
    });
  }

  // ---------------------------------------------------------------
  // Case Analysis III — degree-preserving shuffle test
  // ---------------------------------------------------------------
  function edgeListFromAdj(nodeIds, adj) {
    const edges = [];
    const seen = new Set();
    nodeIds.forEach((a) => {
      adj.get(a).forEach((b) => {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([a, b]);
        }
      });
    });
    return edges;
  }

  function cloneAdj(adj) {
    const out = new Map();
    adj.forEach((set, k) => out.set(k, new Set(set)));
    return out;
  }

  // Degree-preserving double-edge-swap (Maslov–Sneppen rewiring): repeatedly
  // pick two edges with no shared endpoint and cross their targets, skipping
  // any swap that would create a self-loop or a parallel edge.
  function doubleEdgeSwapShuffle(nodeIds, adj, swapAttempts) {
    const g = cloneAdj(adj);
    const edges = edgeListFromAdj(nodeIds, g);
    let success = 0;
    let guard = 0;
    const maxGuard = swapAttempts * 20;
    while (success < swapAttempts && guard < maxGuard && edges.length > 1) {
      guard++;
      const i = Math.floor(Math.random() * edges.length);
      const j = Math.floor(Math.random() * edges.length);
      if (i === j) continue;
      const [a, b] = edges[i];
      const [c, d] = edges[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (Math.random() < 0.5) {
        if (g.get(a).has(d) || g.get(c).has(b)) continue;
        g.get(a).delete(b);
        g.get(b).delete(a);
        g.get(c).delete(d);
        g.get(d).delete(c);
        g.get(a).add(d);
        g.get(d).add(a);
        g.get(c).add(b);
        g.get(b).add(c);
        edges[i] = [a, d];
        edges[j] = [c, b];
      } else {
        if (g.get(a).has(c) || g.get(b).has(d)) continue;
        g.get(a).delete(b);
        g.get(b).delete(a);
        g.get(c).delete(d);
        g.get(d).delete(c);
        g.get(a).add(c);
        g.get(c).add(a);
        g.get(b).add(d);
        g.get(d).add(b);
        edges[i] = [a, c];
        edges[j] = [b, d];
      }
      success++;
    }
    return g;
  }

  function avgClusteringOnly(nodeIds, adj) {
    let sumC = 0;
    nodeIds.forEach((id) => {
      const nb = Array.from(adj.get(id));
      const k = nb.length;
      if (k < 2) return;
      let links = 0;
      for (let i = 0; i < k; i++) {
        const ai = adj.get(nb[i]);
        for (let j = i + 1; j < k; j++) {
          if (ai.has(nb[j])) links++;
        }
      }
      sumC += links / ((k * (k - 1)) / 2);
    });
    return nodeIds.length ? sumC / nodeIds.length : 0;
  }

  function triangleCount(nodeIds, adj) {
    let total = 0;
    nodeIds.forEach((id) => {
      const nb = Array.from(adj.get(id));
      const k = nb.length;
      for (let i = 0; i < k; i++) {
        const ai = adj.get(nb[i]);
        for (let j = i + 1; j < k; j++) {
          if (ai.has(nb[j])) total++;
        }
      }
    });
    return total / 3; // each triangle counted once at each of its 3 vertices
  }

  function componentCount(nodeIds, adj) {
    return connectedComponents(nodeIds, adj).length;
  }

  function hubShare(nodeIds, adj) {
    let maxDeg = 0;
    let sumDeg = 0;
    nodeIds.forEach((id) => {
      const k = adj.get(id).size;
      sumDeg += k;
      if (k > maxDeg) maxDeg = k;
    });
    return sumDeg ? maxDeg / sumDeg : 0;
  }

  function reciprocity(directedEdges) {
    const set = new Set(directedEdges.map(([a, b]) => `${a}→${b}`));
    let matches = 0;
    directedEdges.forEach(([a, b]) => {
      if (a !== b && set.has(`${b}→${a}`)) matches++;
    });
    return directedEdges.length ? matches / directedEdges.length : 0;
  }

  // Directed double-edge-swap (Maslov–Sneppen for digraphs): pick two directed
  // edges a->b and c->d with no shared endpoint, cross their targets to a->d
  // and c->b. This preserves every node's in-degree AND out-degree exactly.
  function directedEdgeSwapShuffle(directedEdges, swapAttempts) {
    const edges = directedEdges.map((e) => e.slice());
    const edgeSet = new Set(edges.map(([a, b]) => `${a}→${b}`));
    let success = 0;
    let guard = 0;
    const maxGuard = swapAttempts * 20;
    while (success < swapAttempts && guard < maxGuard && edges.length > 1) {
      guard++;
      const i = Math.floor(Math.random() * edges.length);
      const j = Math.floor(Math.random() * edges.length);
      if (i === j) continue;
      const [a, b] = edges[i];
      const [c, d] = edges[j];
      if (a === c || b === d || a === d || c === b) continue;
      const key1 = `${a}→${d}`;
      const key2 = `${c}→${b}`;
      if (edgeSet.has(key1) || edgeSet.has(key2)) continue;
      edgeSet.delete(`${a}→${b}`);
      edgeSet.delete(`${c}→${d}`);
      edgeSet.add(key1);
      edgeSet.add(key2);
      edges[i] = [a, d];
      edges[j] = [c, b];
      success++;
    }
    return edges;
  }

  // Registry driving the Case Analysis III variable picker. Each entry knows
  // how to compute itself on a (shuffled) graph, on the real graph, and how
  // to format its own value for display.
  const SHUFFLE_STATS = {
    clustering: {
      label: "CLUSTERING",
      axisLabel: "average clustering coefficient C",
      directed: false,
      format: (v) => v.toFixed(4),
      compute: (state, adj) => avgClusteringOnly(state.nodeIds, adj),
      real: (state) => state.marvelStats.avgClustering,
    },
    triangles: {
      label: "TRIANGLES",
      axisLabel: "number of triangles",
      directed: false,
      format: (v) => Math.round(v).toString(),
      compute: (state, adj) => triangleCount(state.nodeIds, adj),
      real: (state) => triangleCount(state.nodeIds, state.adj),
    },
    islands: {
      label: "ISLANDS",
      axisLabel: "number of connected components",
      directed: false,
      format: (v) => Math.round(v).toString(),
      compute: (state, adj) => componentCount(state.nodeIds, adj),
      real: (state) => componentCount(state.nodeIds, state.adj),
    },
    hubshare: {
      label: "HUB SHARE",
      axisLabel: "top hub's share of all edge-endpoints",
      directed: false,
      format: (v) => (v * 100).toFixed(2) + "%",
      compute: (state, adj) => hubShare(state.nodeIds, adj),
      real: (state) => hubShare(state.nodeIds, state.adj),
    },
    reciprocity: {
      label: "RECIPROCITY",
      axisLabel: "reciprocity (fraction of mutual links)",
      directed: true,
      format: (v) => v.toFixed(4),
      compute: (state, edges) => reciprocity(edges),
      real: (state) => reciprocity(state.directedEdges),
    },
  };

  function drawShuffleStrip(el, nullVals, realVal, axisLabel) {
    const w = 620,
      h = 190,
      m = { top: 34, right: 24, bottom: 36, left: 24 };
    const svg = svgRoot(el, w, h);
    const all = nullVals.concat([realVal]);
    const lo = Math.min(...all) * 0.92;
    const hi = Math.max(...all) * 1.08;
    const x = d3.scaleLinear().domain([lo, hi]).range([m.left, w - m.right]);

    svg
      .append("g")
      .attr("transform", `translate(0,${h - m.bottom})`)
      .call(d3.axisBottom(x).ticks(6))
      .call((g) => g.selectAll("text").attr("font-size", 10).attr("font-family", "Courier Prime, monospace").attr("fill", TERM_AXIS))
      .call((g) => g.selectAll("path,line").attr("stroke", TERM_AXIS))
      .append("text")
      .attr("x", (w - m.left - m.right) / 2 + m.left)
      .attr("y", 34)
      .attr("fill", TERM_AXIS)
      .attr("font-size", 11)
      .attr("text-anchor", "middle")
      .text(axisLabel || "value");

    const midY = (h - m.bottom + m.top) / 2 + 6;
    const jitter = d3.randomUniform(-16, 16);
    svg
      .selectAll("circle.null-pt")
      .data(nullVals)
      .join("circle")
      .attr("class", "null-pt")
      .attr("cx", (d) => x(d))
      .attr("cy", () => midY + jitter())
      .attr("r", 4)
      .attr("fill", TERM_SERIES_COLOR.random)
      .attr("fill-opacity", 0.85);

    svg
      .append("line")
      .attr("x1", x(realVal))
      .attr("x2", x(realVal))
      .attr("y1", m.top - 4)
      .attr("y2", h - m.bottom)
      .attr("stroke", TERM_SERIES_COLOR.marvel)
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4,3");
    svg.append("circle").attr("cx", x(realVal)).attr("cy", m.top - 4).attr("r", 5).attr("fill", TERM_SERIES_COLOR.marvel);
    svg
      .append("text")
      .attr("x", x(realVal))
      .attr("y", m.top - 10)
      .attr("text-anchor", "middle")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 10)
      .attr("fill", TERM_LEGEND)
      .text("real MARVEL_303");
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
    const edgeRows = parseTSV(edgesTxt, ["source", "target"], false);
    const nodeIds = nodeRows.map((r) => r.node_id);
    const edgePairs = edgeRows.map((r) => [r.source, r.target]);
    const nodeIdSet = new Set(nodeIds);
    const directedEdges = edgePairs.filter(([a, b]) => a !== b && nodeIdSet.has(a) && nodeIdSet.has(b));
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
      nodeIds,
      adj,
      directedEdges,
      nameById: new Map(nodeRows.map((r) => [r.node_id, r.name])),
      marvelStats,
      marvelDegrees,
      marvelDegArr,
      marvelSlope,
      runs: {}, // mode -> {stats, degrees, degArr}
      scaleup: null, // {stats, degrees}
      currentMode: "preferential",
      pdfBinning: "raw",
      running: false,
      skip: false,
    };

    setupToolkit(state);
    setupPdfToggle(state);
    renderComparison(state);
    renderCharts(state);
    renderFindings(state);

    setupClassifier(state);
    setupFriendshipAudit(state);
    setupShuffleTest(state);
  }

  function setupPdfToggle(state) {
    const btns = Array.from(document.querySelectorAll(".toggle-btn"));
    if (!btns.length) return;
    btns.forEach((b) => {
      b.addEventListener("click", () => {
        state.pdfBinning = b.dataset.binning;
        btns.forEach((x) => x.classList.toggle("active", x === b));
        renderCharts(state);
      });
    });
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
    if (loglogEl) {
      drawMultiLogLog(loglogEl, seriesMap, {
        binning: state.pdfBinning,
        fitParams: { avgDegree: state.marvelStats.avgDegree, m: state.m, n: state.marvelStats.n },
      });
    }

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

    if (pref) {
      const cRatio = pref.avgClustering ? mv.avgClustering / pref.avgClustering : Infinity;
      set(
        "finding-vs-real",
        `<strong>Grow your own Marvel &mdash; verdict:</strong> matched on n (${pref.n} vs ${mv.n}) and m
        (${Math.round(pref.m)} vs ${Math.round(mv.m)}). <strong>What it gets right:</strong> the average path
        length lands at <b>${pref.avgPathLength.toFixed(2)}</b>, essentially the same small-world distance as the
        real network's <b>${mv.avgPathLength.toFixed(2)}</b> &mdash; and it does produce a real hub (max degree
        <b>${pref.maxDegree}</b>, vs Marvel's <b>${mv.maxDegree}</b>).
        <strong>The most glaring miss:</strong> clustering. Real Marvel characters cluster at
        <b>${mv.avgClustering.toFixed(3)}</b> &mdash; a friend of your friend is often also your friend &mdash;
        while this run only reaches <b>${pref.avgClustering.toFixed(3)}</b>, off by
        <b>${cRatio.toFixed(1)}x</b>. Preferential attachment has no mechanism for triadic closure: new files
        link to whichever files are already popular, never to each other's existing neighbors, so triangles only
        form by coincidence. (Case Analysis III below tests exactly this gap and shows it isn't noise.)`
      );
    } else {
      set(
        "finding-vs-real",
        `Hit <b>EXECUTE</b> with <b>PREFERENTIAL</b> selected above to grow a Marvel-sized network and see the
        verdict here.`
      );
    }

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

  // ---------------------------------------------------------------
  // Case Analysis I controller
  // ---------------------------------------------------------------
  function setupClassifier(state) {
    const btn = document.getElementById("classifier-run-btn");
    if (!btn) return;
    const log = makeLogger(document.getElementById("classifier-log"));

    btn.addEventListener("click", () => {
      document.getElementById("classifier-log").innerHTML = "";
      log("> booting DEGREE-CLASSIFIER.exe...");
      log("> computing CCDF for MARVEL_303 (real)...");

      const seriesCcdf = { marvel: ccdfFromCounts(state.marvelDegrees) };
      const seriesSlope = { marvel: localSlopeSeries(seriesCcdf.marvel) };

      let compareKey = null;
      let compareCounts = null;
      if (state.scaleup) {
        compareKey = "scaleup";
        compareCounts = state.scaleup.degrees;
      } else if (state.runs.preferential) {
        compareKey = "preferential";
        compareCounts = state.runs.preferential.degrees;
      }

      if (compareCounts) {
        log(`> pulling comparison series: ${SERIES_LABEL[compareKey]}...`);
        seriesCcdf[compareKey] = ccdfFromCounts(compareCounts);
        seriesSlope[compareKey] = localSlopeSeries(seriesCcdf[compareKey]);
      }
      if (state.runs.random) {
        log("> pulling comparison series: Static random...");
        seriesCcdf.random = ccdfFromCounts(state.runs.random.degrees);
      }

      log(`> fitting ER (Poisson, ⟨k⟩=${state.marvelStats.avgDegree.toFixed(1)}) and BA (exact, m=${state.m}) curves matched to Marvel's own n and average degree...`, "tline-done");
      const fitParams = { avgDegree: state.marvelStats.avgDegree, m: state.m };
      drawCCDF(document.getElementById("chart-ccdf"), seriesCcdf, fitParams);
      drawLocalSlope(document.getElementById("chart-slope"), seriesSlope);

      const marvelSlopes = seriesSlope.marvel.map((p) => p.slope);
      const mMin = Math.min(...marvelSlopes);
      const mMax = Math.max(...marvelSlopes);
      log(`> Marvel local CCDF slope ranges from ${mMin.toFixed(2)} to ${mMax.toFixed(2)} across the curve.`, "tline-done");

      let compareText;
      if (compareCounts && seriesSlope[compareKey].length) {
        const cSlopes = seriesSlope[compareKey].map((p) => p.slope);
        const cMin = Math.min(...cSlopes);
        const cMax = Math.max(...cSlopes);
        log(`> ${SERIES_LABEL[compareKey]} local slope ranges from ${cMin.toFixed(2)} to ${cMax.toFixed(2)}.`, "tline-done");
        compareText = `By contrast, <b>${SERIES_LABEL[compareKey]}</b>'s local slope stays within
          <b>${cMin.toFixed(2)}</b> to <b>${cMax.toFixed(2)}</b> &mdash; a much narrower band, sitting close to the
          &minus;2 Barabási&ndash;Albert theory predicts for a CCDF. Marvel's swing
          (<b>${(mMax - mMin).toFixed(2)}</b> wide) is several times larger than that.`;
      } else {
        compareText = `Run <b>PREFERENTIAL</b> in the Field Toolkit above (ideally <b>FAST-FORWARD TO n=5,000</b>
          too) and re-run this scan for an <em>empirical</em> Barabási&ndash;Albert local-slope curve as well
          &mdash; the CCDF panel's dashed fit lines above don't need that, they're closed-form.`;
      }

      const maxDeg = state.marvelStats.maxDegree;
      const erCurve = erTheoreticalCcdf(fitParams.avgDegree, maxDeg, 0);
      const baCurve = baTheoreticalCcdf(fitParams.m, maxDeg, 0);
      const erAtMax = erCurve.length ? erCurve[erCurve.length - 1].ccdf : 0;
      const baAtMax = baCurve.length ? baCurve[baCurve.length - 1].ccdf : 0;
      const empiricalAtMax = 1 / state.marvelStats.n;

      document.getElementById("finding-classifier").innerHTML = `
        <strong>Finding:</strong> Marvel's degree distribution has a real heavy tail &mdash; its max degree
        (<b>${maxDeg}</b>) is far beyond anything a matched random graph produces, which already rules out "more
        random." The dashed fit lines make that precise: an ER/Poisson graph matched on Marvel's own average
        degree predicts essentially <em>zero</em> characters that popular (CCDF&nbsp;&asymp;&nbsp;<b>${erAtMax.toExponential(1)}</b>
        at k=${maxDeg}), while the exact Barabási&ndash;Albert formula (m=${state.m}) predicts
        <b>${baAtMax.toFixed(4)}</b> &mdash; much closer to, though still below, the observed
        <b>${empiricalAtMax.toFixed(4)}</b> (1 in ${state.marvelStats.n}). But Marvel's local CCDF slope never
        holds still the way BA's does: it swings from <b>${mMin.toFixed(2)}</b> to <b>${mMax.toFixed(2)}</b> as k
        increases, instead of settling near one value the way a clean power law would. ${compareText}
        <br><br>
        <strong>What we can't conclude:</strong> with only ${state.marvelStats.n} nodes, this instability is
        evidence against confidently calling Marvel scale-free &mdash; it is not proof that no power law is there.
        A noisy power law and "not a power law at all" can look identical at this sample size; telling them apart
        would need a proper tail fit (e.g. Clauset&ndash;Shalizi&ndash;Newman) with a confidence interval, not an
        eyeballed line, and realistically a much bigger network than 303 characters.`;
    });
  }

  // ---------------------------------------------------------------
  // Case Analysis II controller
  // ---------------------------------------------------------------
  function setupFriendshipAudit(state) {
    const btn = document.getElementById("fp-run-btn");
    if (!btn) return;
    const log = makeLogger(document.getElementById("fp-log"));
    const nameOf = (id) => state.nameById.get(id) || id;

    btn.addEventListener("click", () => {
      document.getElementById("fp-log").innerHTML = "";
      log("> booting FRIENDSHIP-AUDIT.exe...");
      log("> computing exact friend-degree ratio over the degree sequence...");

      const fs = friendshipStats(state.nodeIds, state.adj);
      const pairs = sampleFriendPairs(state.nodeIds, state.adj, 2000);
      drawFriendHistograms(
        document.getElementById("chart-fp-dist"),
        pairs.map((p) => p.k),
        pairs.map((p) => p.friendK)
      );

      flashStat(document.getElementById("fp-avgk"), fs.avgDegree.toFixed(2), 0);
      flashStat(document.getElementById("fp-avgfriend"), fs.avgFriendDegree.toFixed(2), 1);
      flashStat(document.getElementById("fp-ratio"), (fs.avgFriendDegree / fs.avgDegree).toFixed(2) + "x", 1);

      const champText = fs.champions.length
        ? fs.champions.map((id) => `${nameOf(id)} (deg ${state.adj.get(id).size})`).join(", ")
        : "none found";
      flashStat(document.getElementById("fp-champions"), champText, 0);

      log(`> sampled ${pairs.length} random (character, friend) pairs.`, "tline-done");
      log(`> ${fs.champions.length} character(s) are never out-popularity-ed by a direct connection.`, "tline-done");

      const topHubsTxt = fs.topHubs.map((h) => `${nameOf(h.id)} (${h.k})`).join(", ");
      const topGap = fs.gaps[0];
      const tiedCount = topGap ? fs.gaps.filter((g) => Math.abs(g.gap - topGap.gap) < 1e-9).length : 0;
      const topHubName = fs.topHubs.length ? nameOf(fs.topHubs[0].id) : "the top hub";

      let victimText = "";
      if (topGap) {
        victimText =
          tiedCount > 1
            ? `The single biggest paradox blowouts are a ${tiedCount}-way tie: characters with exactly one link
               each, and in every one of those cases that one link is to <b>${topHubName}</b> (e.g.
               ${nameOf(topGap.id)}, degree 1, whose only friend has degree ${topGap.friendAvg.toFixed(0)}).`
            : `The single biggest paradox blowout is <b>${nameOf(topGap.id)}</b> (degree ${topGap.k}, average
               friend degree ${topGap.friendAvg.toFixed(1)}).`;
      }

      document.getElementById("finding-fp").innerHTML = `
        <strong>Finding:</strong> the paradox holds hard here &mdash; the average character has
        <b>${fs.avgDegree.toFixed(1)}</b> links, but the average friend has
        <b>${fs.avgFriendDegree.toFixed(1)}</b> (a <b>${(fs.avgFriendDegree / fs.avgDegree).toFixed(2)}x</b>
        ratio). The popular friends driving it are exactly who you'd guess: ${topHubsTxt}. ${victimText}
        <br><br>
        <strong>Nobody out-popularity-ed:</strong> ${fs.champions.length} character(s) in MARVEL_303 are never
        the less-popular one in any of their own connections &mdash; ${champText}. One is the obvious global hub;
        any others simply keep to a small pocket of the network where nobody they know outranks them.`;
    });
  }

  // ---------------------------------------------------------------
  // Case Analysis III controller
  // ---------------------------------------------------------------
  function setupShuffleTest(state) {
    const btn = document.getElementById("shuffle-run-btn");
    if (!btn) return;
    const log = makeLogger(document.getElementById("shuffle-log"));
    const statBtns = Array.from(document.querySelectorAll(".stat-btn"));
    state.shuffleStat = state.shuffleStat || "clustering";

    statBtns.forEach((b) => {
      b.addEventListener("click", () => {
        if (btn.disabled) return;
        state.shuffleStat = b.dataset.stat;
        statBtns.forEach((x) => x.classList.toggle("active", x === b));
      });
    });

    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      statBtns.forEach((b) => (b.disabled = true));

      const meta = SHUFFLE_STATS[state.shuffleStat];
      document.getElementById("shuffle-log").innerHTML = "";
      log("> booting CHAIN-OF-CUSTODY.exe...");
      log(`> variable under test: ${meta.label}`);
      const realVal = meta.real(state);
      log(`> real value: ${meta.format(realVal)}`);
      log(`> running 20 degree-preserving ${meta.directed ? "directed " : ""}double-edge-swap shuffles...`);
      await new Promise((r) => setTimeout(r, 20));

      const nullVals = [];
      if (meta.directed) {
        const swapAttempts = Math.round(state.directedEdges.length * 10);
        for (let i = 0; i < 20; i++) {
          const shuffled = directedEdgeSwapShuffle(state.directedEdges, swapAttempts);
          nullVals.push(meta.compute(state, shuffled));
        }
      } else {
        const swapAttempts = Math.round(state.marvelStats.m * 10);
        for (let i = 0; i < 20; i++) {
          const shuffled = doubleEdgeSwapShuffle(state.nodeIds, state.adj, swapAttempts);
          nullVals.push(meta.compute(state, shuffled));
        }
      }

      const mean = nullVals.reduce((s, v) => s + v, 0) / nullVals.length;
      const variance = nullVals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / nullVals.length;
      const sd = Math.sqrt(variance);
      const z = sd ? (realVal - mean) / sd : null;

      drawShuffleStrip(document.getElementById("chart-shuffle"), nullVals, realVal, meta.axisLabel);

      flashStat(document.getElementById("sh-real"), meta.format(realVal), 0);
      flashStat(document.getElementById("sh-mean"), meta.format(mean), 0);
      flashStat(document.getElementById("sh-sd"), meta.format(sd), 0);
      flashStat(document.getElementById("sh-z"), z === null ? "n/a" : z.toFixed(1), 1);

      log(`> null mean=${meta.format(mean)}  sd=${meta.format(sd)}  z=${z === null ? "n/a" : z.toFixed(1)}`, "tline-done");

      let verdict;
      if (sd === 0) {
        log(`> verdict: ${meta.label} is invariant under this shuffle.`, "tline-done");
        verdict = `<b>${meta.label}</b> is <strong>invariant</strong> under this exact shuffle: all 20 shuffles
          produced the identical value <b>${meta.format(realVal)}</b>, because it's a pure function of the degree
          sequence itself &mdash; which a degree-preserving shuffle leaves untouched by construction. That's not a
          bug, it's the cleanest possible proof of what "degree-preserving" means.`;
      } else {
        const dies = Math.abs(z) > 3;
        log(`> verdict: ${meta.label} ${dies ? "does NOT survive" : "survives"} the shuffle.`, "tline-done");
        verdict = dies
          ? `<b>${meta.label}</b> <strong>dies</strong> under the shuffle (real
             <b>${meta.format(realVal)}</b> vs null mean <b>${meta.format(mean)}</b>, z&asymp;<b>${z.toFixed(1)}</b>)
             &mdash; the real value depends on the actual wiring, not just who has how many links.`
          : `<b>${meta.label}</b> roughly <strong>survives</strong> the shuffle (real
             <b>${meta.format(realVal)}</b> vs null mean <b>${meta.format(mean)}</b>, z&asymp;<b>${z.toFixed(1)}</b>,
             within noise) &mdash; the degree sequence alone is enough to explain it.`;
      }

      document.getElementById("finding-shuffle").innerHTML = `
        <strong>Finding:</strong> ${verdict} Compare that to everything computed in Case Analyses I and II above:
        every degree-based number there (the CCDF, the local slope, the friendship-paradox ratio) is also a pure
        function of the degree sequence, so it survives a degree-preserving shuffle by the same logic.`;
      btn.disabled = false;
      statBtns.forEach((b) => (b.disabled = false));
    });
  }

  window.addEventListener("DOMContentLoaded", init);
})();
