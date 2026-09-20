/* ============================================================
   Case No. 03 — Person of Interest
   AGENCY TOOLKIT // ALIBI-CHECK v1.0

   Four centrality measures name four different "most important"
   characters, and most of those names turn out to be nothing but
   degree in disguise. This file computes the measures on the real
   Marvel wiki-link network, then runs the degree-preserving
   shuffle test live in the browser so every suspect can be asked
   the only question that matters: is your position more than your
   number of links?

   Pure vanilla JS + D3 (loaded globally as `d3`). The compute core
   is exposed as window.WLF3 so it can be checked against the
   week 3 notebook without a browser UI.
   ============================================================ */
(function () {
  "use strict";

  const NODES_URL = "../week1_nodes.tsv";
  const EDGES_URL = "../week1_edges.tsv";

  const SHUFFLES = 200; // degree-preserving shuffles per alibi check
  const SWAPS_PER_LINK = 10; // Maslov–Sneppen rule of thumb

  // ---------------------------------------------------------------
  // Parsing and graph building
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

  // Everything below works on integer node indices: the centrality loops run
  // over every node from every node, so Map/string lookups would dominate.
  function indexNodes(ids) {
    const index = new Map();
    ids.forEach((id, i) => index.set(id, i));
    return index;
  }

  function undirectedAdj(n, edges) {
    const adj = Array.from({ length: n }, () => []);
    const seen = new Set();
    edges.forEach(([a, b]) => {
      if (a === b) return;
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) return; // a reciprocated pair is one undirected link
      seen.add(key);
      adj[a].push(b);
      adj[b].push(a);
    });
    return adj;
  }

  function directedAdj(n, edges) {
    const out = Array.from({ length: n }, () => []);
    const inn = Array.from({ length: n }, () => []);
    edges.forEach(([a, b]) => {
      if (a === b) return;
      out[a].push(b);
      inn[b].push(a);
    });
    return { out, inn };
  }

  function components(adj) {
    const n = adj.length;
    const comp = new Int32Array(n).fill(-1);
    const comps = [];
    for (let s = 0; s < n; s++) {
      if (comp[s] !== -1) continue;
      const members = [s];
      comp[s] = comps.length;
      for (let qi = 0; qi < members.length; qi++) {
        const v = members[qi];
        for (const w of adj[v]) {
          if (comp[w] === -1) {
            comp[w] = comps.length;
            members.push(w);
          }
        }
      }
      comps.push(members);
    }
    comps.sort((a, b) => b.length - a.length);
    return comps;
  }

  // Distances from one node. Returns -1 for anything unreachable.
  function bfs(adj, source) {
    const dist = new Int32Array(adj.length).fill(-1);
    dist[source] = 0;
    const queue = [source];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      for (const w of adj[v]) {
        if (dist[w] === -1) {
          dist[w] = dist[v] + 1;
          queue.push(w);
        }
      }
    }
    return dist;
  }

  // ---------------------------------------------------------------
  // Centrality
  // ---------------------------------------------------------------
  // Brandes' algorithm: one BFS per source, counting shortest paths on the way
  // out and accumulating each node's share of them on the way back. Since the
  // BFS already has every distance, closeness and harmonic centrality come out
  // of the same sweep for free — which matters here, because the alibi check
  // runs this 200 times.
  //
  // `directed` switches the normalisation: an undirected network counts every
  // pair twice (once from each end), a directed one doesn't. Both match
  // networkx's *_centrality(normalized=True).
  function centralities(adj, opts) {
    opts = opts || {};
    const directed = !!opts.directed;
    const n = adj.length;
    const betweenness = new Float64Array(n);
    const closeness = new Float64Array(n);
    const harmonic = new Float64Array(n);

    const sigma = new Float64Array(n);
    const delta = new Float64Array(n);
    const dist = new Int32Array(n);
    const queue = new Int32Array(n);
    const stack = new Int32Array(n);
    const preds = Array.from({ length: n }, () => []);

    for (let s = 0; s < n; s++) {
      sigma.fill(0);
      delta.fill(0);
      dist.fill(-1);
      for (let i = 0; i < n; i++) preds[i].length = 0;

      sigma[s] = 1;
      dist[s] = 0;
      let head = 0;
      let tail = 0;
      let top = 0;
      queue[tail++] = s;

      let reached = 0;
      let distSum = 0;
      let inverseSum = 0;

      while (head < tail) {
        const v = queue[head++];
        stack[top++] = v;
        if (v !== s) {
          reached++;
          distSum += dist[v];
          inverseSum += 1 / dist[v];
        }
        for (const w of adj[v]) {
          if (dist[w] === -1) {
            dist[w] = dist[v] + 1;
            queue[tail++] = w;
          }
          if (dist[w] === dist[v] + 1) {
            sigma[w] += sigma[v];
            preds[w].push(v);
          }
        }
      }

      // Wasserman–Faust closeness: on a connected network this is the plain
      // (n-1)/sum(d), and when part of the network is unreachable it scales by
      // the share that is reachable, so a node stuck in a fragment doesn't look
      // central. Shuffled networks come apart sometimes, so we need it.
      if (distSum > 0) closeness[s] = (reached / distSum) * (reached / (n - 1));
      harmonic[s] = n > 1 ? inverseSum / (n - 1) : 0;

      while (top > 0) {
        const w = stack[--top];
        for (const v of preds[w]) {
          delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
        }
        if (w !== s) betweenness[w] += delta[w];
      }
    }

    const pairs = directed ? (n - 1) * (n - 2) : ((n - 1) * (n - 2)) / 2;
    const halve = directed ? 1 : 0.5;
    for (let i = 0; i < n; i++) betweenness[i] = pairs > 0 ? (betweenness[i] * halve) / pairs : 0;
    return { betweenness, closeness, harmonic };
  }

  // PageRank on the directed network. Pages with no out-links would otherwise
  // leak their score out of the system every iteration, so their score is
  // spread over all nodes, which is what networkx does by default.
  function pagerank(outAdj, innAdj, alpha, tol, maxIter) {
    alpha = alpha === undefined ? 0.85 : alpha;
    tol = tol || 1e-13;
    maxIter = maxIter || 1000;
    const n = outAdj.length;
    const outDeg = outAdj.map((l) => l.length);
    let x = new Float64Array(n).fill(1 / n);
    const next = new Float64Array(n);
    for (let iter = 0; iter < maxIter; iter++) {
      let dangling = 0;
      for (let i = 0; i < n; i++) if (outDeg[i] === 0) dangling += x[i];
      let diff = 0;
      for (let i = 0; i < n; i++) {
        let incoming = 0;
        for (const j of innAdj[i]) incoming += x[j] / outDeg[j];
        next[i] = alpha * (incoming + dangling / n) + (1 - alpha) / n;
      }
      for (let i = 0; i < n; i++) {
        diff += Math.abs(next[i] - x[i]);
        x[i] = next[i];
      }
      if (diff < tol) break;
    }
    return x;
  }

  // Pearson correlation between the degrees at the two ends of every link,
  // each link counted from both ends.
  function degreeAssortativity(adj) {
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    let count = 0;
    for (let v = 0; v < adj.length; v++) {
      const kv = adj[v].length;
      for (const w of adj[v]) {
        const kw = adj[w].length;
        sx += kv;
        sy += kw;
        sxy += kv * kw;
        sxx += kv * kv;
        syy += kw * kw;
        count++;
      }
    }
    if (!count) return NaN;
    const num = sxy / count - (sx / count) * (sy / count);
    const den = Math.sqrt(sxx / count - (sx / count) ** 2) * Math.sqrt(syy / count - (sy / count) ** 2);
    return den === 0 ? NaN : num / den;
  }

  // ---------------------------------------------------------------
  // The null model — degree-preserving double edge swap, carried over
  // from Case No. 02 and rewritten on integer indices for speed.
  // Pick two links, cross their endpoints, reject anything that would
  // make a self-loop or a duplicate. Every node keeps its degree; who
  // links to whom is scrambled.
  // ---------------------------------------------------------------
  function edgeList(adj) {
    const edges = [];
    for (let v = 0; v < adj.length; v++) {
      for (const w of adj[v]) if (v < w) edges.push([v, w]);
    }
    return edges;
  }

  function shuffledAdj(adj, swapAttempts) {
    const n = adj.length;
    const sets = adj.map((l) => new Set(l));
    const edges = edgeList(adj);
    const m = edges.length;
    let done = 0;
    let guard = 0;
    const maxGuard = swapAttempts * 20;
    while (done < swapAttempts && guard < maxGuard && m > 1) {
      guard++;
      const i = (Math.random() * m) | 0;
      const j = (Math.random() * m) | 0;
      if (i === j) continue;
      let [a, b] = edges[i];
      let [c, d] = edges[j];
      if (Math.random() < 0.5) {
        const t = c;
        c = d;
        d = t;
      }
      if (a === c || a === d || b === c || b === d) continue;
      if (sets[a].has(d) || sets[c].has(b)) continue;
      sets[a].delete(b);
      sets[b].delete(a);
      sets[c].delete(d);
      sets[d].delete(c);
      sets[a].add(d);
      sets[d].add(a);
      sets[c].add(b);
      sets[b].add(c);
      edges[i] = [a, d];
      edges[j] = [c, b];
      done++;
    }
    return sets.map((s) => Array.from(s));
  }

  // ---------------------------------------------------------------
  // Small statistics helpers
  // ---------------------------------------------------------------
  function meanSd(values) {
    const n = values.length;
    if (!n) return { mean: NaN, sd: NaN };
    let sum = 0;
    for (const v of values) sum += v;
    const mean = sum / n;
    let sq = 0;
    for (const v of values) sq += (v - mean) ** 2;
    return { mean, sd: Math.sqrt(sq / n) };
  }

  function ranksDescending(values) {
    const order = d3.range(values.length).sort((a, b) => values[b] - values[a]);
    const rank = new Int32Array(values.length);
    order.forEach((idx, i) => (rank[idx] = i + 1));
    return rank;
  }

  // ---------------------------------------------------------------
  // Presentation helpers
  // ---------------------------------------------------------------
  const PAPER = "#ece2c8";
  const INK = "#2b2622";
  const INK_SOFT = "#5b4f3f";
  const INK_FAINT = "#8a7a62";
  const RED = "#9c2b21";
  const BLUE = "#2f5e6b";
  const LINE = "#b7a377";
  const TERM_GREEN = "#7CFFB2";
  const TERM_DIM = "#4f9d5f";

  function shortName(id) {
    return id.replace(/_\((character|characters|comics|Marvel_Comics)\)$/, "").replace(/_/g, " ");
  }

  function svgRoot(el, w, h) {
    el.innerHTML = "";
    return d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);
  }

  function placeholder(el, w, h, text, dark) {
    svgRoot(el, w, h)
      .append("text")
      .attr("x", w / 2)
      .attr("y", h / 2)
      .attr("text-anchor", "middle")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 12)
      .attr("fill", dark ? TERM_DIM : INK_FAINT)
      .text(text);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setHTML(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }

  function axisStyle(g) {
    g.selectAll("text").attr("font-family", "Courier Prime, monospace").attr("font-size", 10).attr("fill", INK_SOFT);
    g.selectAll("path, line").attr("stroke", LINE);
  }

  // ---------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------
  // Scatter labels collide and run off the right edge if you just drop them
  // next to their dot. This nudges overlapping labels down a line at a time and
  // flips the ones near the right edge to sit left of their point instead.
  function placeLabels(points, rightEdge) {
    const placed = points
      .map((p) => ({ ...p, ly: p.y, anchor: p.x > rightEdge - 90 ? "end" : "start" }))
      .sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < placed.length; i++) {
      if (placed[i].ly - placed[i - 1].ly < 11) placed[i].ly = placed[i - 1].ly + 11;
    }
    return placed;
  }

  // Betweenness against degree, log–log. The dashed line is a least-squares
  // fit through every character with non-zero betweenness; the ringed names
  // are the ones furthest from it, which is where the brokers live.
  function drawBetweennessScatter(el, state, selected) {
    const w = 640;
    const h = 420;
    const m = { top: 18, right: 18, bottom: 44, left: 62 };
    const svg = svgRoot(el, w, h);
    const pts = state.cast.filter((c) => c.betweenness > 0);

    const x = d3
      .scaleLog()
      .domain([0.9, d3.max(pts, (p) => p.degree) * 1.25])
      .range([m.left, w - m.right]);
    const y = d3
      .scaleLog()
      .domain([d3.min(pts, (p) => p.betweenness) * 0.7, d3.max(pts, (p) => p.betweenness) * 1.6])
      .range([h - m.bottom, m.top]);

    svg.append("g").attr("transform", `translate(0,${h - m.bottom})`).call(d3.axisBottom(x).ticks(6, "~s")).call(axisStyle);
    svg.append("g").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(6, "~e")).call(axisStyle);

    svg
      .append("text")
      .attr("x", (w + m.left) / 2)
      .attr("y", h - 8)
      .attr("text-anchor", "middle")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 11)
      .attr("fill", INK_SOFT)
      .text("degree (number of wiki-links)");
    svg
      .append("text")
      .attr("transform", `translate(14,${(h - m.bottom + m.top) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 11)
      .attr("fill", INK_SOFT)
      .text("betweenness (share of shortest paths)");

    // least-squares fit in log space
    const lx = pts.map((p) => Math.log10(p.degree));
    const ly = pts.map((p) => Math.log10(p.betweenness));
    const mx = d3.mean(lx);
    const my = d3.mean(ly);
    let num = 0;
    let den = 0;
    lx.forEach((v, i) => {
      num += (v - mx) * (ly[i] - my);
      den += (v - mx) ** 2;
    });
    const slope = num / den;
    const intercept = my - slope * mx;
    const xs = [x.domain()[0], x.domain()[1]];
    svg
      .append("path")
      .attr("d", d3.line()((xs.map((v) => [x(v), y(Math.pow(10, intercept + slope * Math.log10(v)))]))))
      .attr("fill", "none")
      .attr("stroke", INK_FAINT)
      .attr("stroke-dasharray", "5 4");

    svg
      .append("g")
      .selectAll("circle")
      .data(pts)
      .join("circle")
      .attr("cx", (p) => x(p.degree))
      .attr("cy", (p) => y(p.betweenness))
      .attr("r", (p) => (p.id === selected ? 6 : 3.2))
      .attr("fill", (p) => (p.id === selected ? RED : BLUE))
      .attr("fill-opacity", (p) => (p.id === selected ? 1 : 0.55));

    // label the biggest residuals in both directions, plus whoever is selected
    const resid = pts.map((p, i) => ({ p, r: ly[i] - (intercept + slope * lx[i]) }));
    resid.sort((a, b) => b.r - a.r);
    const labelled = new Set(resid.slice(0, 6).concat(resid.slice(-3)).map((d) => d.p.id));
    labelled.add(state.byId.get("Spider-Man").id);
    if (selected) labelled.add(selected);

    const labels = placeLabels(
      pts.filter((p) => labelled.has(p.id)).map((p) => ({ id: p.id, x: x(p.degree), y: y(p.betweenness) + 3 })),
      w - m.right
    );
    svg
      .append("g")
      .selectAll("text")
      .data(labels)
      .join("text")
      .attr("x", (p) => p.x + (p.anchor === "end" ? -7 : 7))
      .attr("y", (p) => p.ly)
      .attr("text-anchor", (p) => p.anchor)
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 10)
      .attr("fill", (p) => (p.id === selected ? RED : INK))
      .text((p) => shortName(p.id));

    svg
      .append("text")
      .attr("x", m.left + 4)
      .attr("y", h - m.bottom - 6)
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 10)
      .attr("fill", INK_FAINT)
      .text(`${state.cast.length - pts.length} characters have betweenness 0 and cannot be drawn on a log axis`);
  }

  // The null distribution for one character, with the real value marked.
  function drawNullHist(el, values, real, label) {
    const w = 460;
    const h = 260;
    const m = { top: 18, right: 16, bottom: 40, left: 40 };
    if (!values || !values.length) {
      placeholder(el, w, h, "run the alibi check to build the null", true);
      return;
    }
    const svg = svgRoot(el, w, h);
    const lo = Math.min(d3.min(values), real);
    const hi = Math.max(d3.max(values), real);
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
    const x = d3.scaleLinear().domain([lo - pad, hi + pad]).range([m.left, w - m.right]);
    const bins = d3.bin().domain(x.domain()).thresholds(26)(values);
    const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.length) || 1]).range([h - m.bottom, m.top]);

    svg
      .append("g")
      .attr("transform", `translate(0,${h - m.bottom})`)
      .call(d3.axisBottom(x).ticks(5))
      .call((g) => {
        g.selectAll("text").attr("font-family", "Courier Prime, monospace").attr("font-size", 9).attr("fill", TERM_DIM);
        g.selectAll("path, line").attr("stroke", "#1f3826");
      });

    svg
      .append("g")
      .selectAll("rect")
      .data(bins)
      .join("rect")
      .attr("x", (b) => x(b.x0) + 1)
      .attr("y", (b) => y(b.length))
      .attr("width", (b) => Math.max(1, x(b.x1) - x(b.x0) - 1.5))
      .attr("height", (b) => h - m.bottom - y(b.length))
      .attr("fill", TERM_DIM)
      .attr("fill-opacity", 0.75);

    const rx = Math.min(Math.max(x(real), m.left), w - m.right);
    svg
      .append("line")
      .attr("x1", rx)
      .attr("x2", rx)
      .attr("y1", m.top - 4)
      .attr("y2", h - m.bottom)
      .attr("stroke", "#ffe6a6")
      .attr("stroke-width", 2);
    svg
      .append("text")
      .attr("x", rx)
      .attr("y", m.top - 7)
      .attr("text-anchor", real > d3.mean(values) ? "end" : "start")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 10)
      .attr("fill", "#ffe6a6")
      .text("real");
    svg
      .append("text")
      .attr("x", m.left)
      .attr("y", h - 8)
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 10)
      .attr("fill", TERM_DIM)
      .text(label);
  }

  // z against degree for the whole cast, after a run.
  function drawZScatter(el, state, measure, selected) {
    const w = 640;
    const h = 380;
    const m = { top: 20, right: 18, bottom: 44, left: 52 };
    const stats = state.nullStats && state.nullStats[measure];
    if (!stats) {
      placeholder(el, w, h, "run the alibi check above to fill this board");
      return;
    }
    const svg = svgRoot(el, w, h);
    const pts = state.cast
      .map((c, i) => ({ id: c.id, degree: c.degree, z: stats.z[i] }))
      .filter((p) => Number.isFinite(p.z));

    const x = d3.scaleLog().domain([0.9, d3.max(pts, (p) => p.degree) * 1.25]).range([m.left, w - m.right]);
    const zMax = Math.max(3, d3.max(pts, (p) => Math.abs(p.z)));
    const y = d3.scaleLinear().domain([-zMax * 1.1, zMax * 1.1]).range([h - m.bottom, m.top]);

    svg.append("g").attr("transform", `translate(0,${h - m.bottom})`).call(d3.axisBottom(x).ticks(6, "~s")).call(axisStyle);
    svg.append("g").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(7)).call(axisStyle);

    [-2, 2].forEach((z) => {
      svg
        .append("line")
        .attr("x1", m.left)
        .attr("x2", w - m.right)
        .attr("y1", y(z))
        .attr("y2", y(z))
        .attr("stroke", INK_FAINT)
        .attr("stroke-dasharray", "3 4");
    });
    svg
      .append("line")
      .attr("x1", m.left)
      .attr("x2", w - m.right)
      .attr("y1", y(0))
      .attr("y2", y(0))
      .attr("stroke", LINE);

    svg
      .append("g")
      .selectAll("circle")
      .data(pts)
      .join("circle")
      .attr("cx", (p) => x(p.degree))
      .attr("cy", (p) => y(p.z))
      .attr("r", (p) => (p.id === selected ? 6 : 3.2))
      .attr("fill", (p) => (p.id === selected ? RED : p.z >= 2 ? "#3d5c3f" : p.z <= -2 ? RED : BLUE))
      .attr("fill-opacity", (p) => (p.id === selected ? 1 : 0.6));

    const sorted = pts.slice().sort((a, b) => b.z - a.z);
    const labelled = new Set(sorted.slice(0, 6).concat(sorted.slice(-4)).map((p) => p.id));
    if (selected) labelled.add(selected);
    const zLabels = placeLabels(
      pts.filter((p) => labelled.has(p.id)).map((p) => ({ id: p.id, x: x(p.degree), y: y(p.z) + 3 })),
      w - m.right
    );
    svg
      .append("g")
      .selectAll("text")
      .data(zLabels)
      .join("text")
      .attr("x", (p) => p.x + (p.anchor === "end" ? -7 : 7))
      .attr("y", (p) => p.ly)
      .attr("text-anchor", (p) => p.anchor)
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 10)
      .attr("fill", (p) => (p.id === selected ? RED : INK))
      .text((p) => shortName(p.id));

    svg
      .append("text")
      .attr("x", (w + m.left) / 2)
      .attr("y", h - 8)
      .attr("text-anchor", "middle")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 11)
      .attr("fill", INK_SOFT)
      .text("degree");
    svg
      .append("text")
      .attr("transform", `translate(14,${(h - m.bottom + m.top) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 11)
      .attr("fill", INK_SOFT)
      .text(`z-score vs ${SHUFFLES} shuffles`);
  }

  // Giant component as characters are removed in a chosen order.
  function drawRemoval(el, series) {
    const w = 640;
    const h = 360;
    const m = { top: 18, right: 130, bottom: 44, left: 52 };
    const svg = svgRoot(el, w, h);
    const keys = Object.keys(series);
    const maxRemoved = d3.max(keys, (k) => series[k].length - 1);
    const x = d3.scaleLinear().domain([0, maxRemoved]).range([m.left, w - m.right]);
    const y = d3.scaleLinear().domain([0, 1]).range([h - m.bottom, m.top]);

    svg.append("g").attr("transform", `translate(0,${h - m.bottom})`).call(d3.axisBottom(x).ticks(7)).call(axisStyle);
    svg.append("g").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(6, "%")).call(axisStyle);

    const colors = {
      betweenness: RED,
      degree: BLUE,
      pagerank: "#6b4f14",
      random: INK_FAINT,
    };
    const labels = {
      betweenness: "by betweenness",
      degree: "by degree",
      pagerank: "by PageRank",
      random: "at random",
    };

    keys.forEach((k) => {
      svg
        .append("path")
        .attr("fill", "none")
        .attr("stroke", colors[k] || INK)
        .attr("stroke-width", 1.8)
        .attr("d", d3.line().x((d, i) => x(i)).y((d) => y(d))(series[k]));
    });

    const legend = svg.append("g").attr("transform", `translate(${w - m.right + 12},${m.top + 6})`);
    keys.forEach((k, i) => {
      legend.append("line").attr("x1", 0).attr("x2", 16).attr("y1", i * 18).attr("y2", i * 18).attr("stroke", colors[k] || INK).attr("stroke-width", 2);
      legend
        .append("text")
        .attr("x", 21)
        .attr("y", i * 18 + 3.5)
        .attr("font-family", "Courier Prime, monospace")
        .attr("font-size", 10)
        .attr("fill", INK_SOFT)
        .text(labels[k] || k);
    });

    svg
      .append("text")
      .attr("x", (w - m.right + m.left) / 2)
      .attr("y", h - 8)
      .attr("text-anchor", "middle")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 11)
      .attr("fill", INK_SOFT)
      .text("characters removed");
    svg
      .append("text")
      .attr("transform", `translate(14,${(h - m.bottom + m.top) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 11)
      .attr("fill", INK_SOFT)
      .text("giant component, share of survivors");
  }

  // ---------------------------------------------------------------
  // Load-time computation
  // ---------------------------------------------------------------
  function buildState(nodeRows, edgeRows) {
    const ids = nodeRows.map((r) => r.node_id);
    const index = indexNodes(ids);
    const nameById = new Map(nodeRows.map((r) => [r.node_id, r.name || shortName(r.node_id)]));
    const descById = new Map(nodeRows.map((r) => [r.node_id, r.description || ""]));
    const rawEdges = edgeRows
      .map((r) => [index.get(r.source), index.get(r.target)])
      .filter(([a, b]) => a !== undefined && b !== undefined);

    const full = undirectedAdj(ids.length, rawEdges);
    const dir = directedAdj(ids.length, rawEdges);
    const comps = components(full);
    const giantIds = comps[0].map((i) => ids[i]).sort();

    // The whole week runs on the giant component, re-indexed 0..276.
    const gcIndex = indexNodes(giantIds);
    const gcEdges = [];
    rawEdges.forEach(([a, b]) => {
      const ga = gcIndex.get(ids[a]);
      const gb = gcIndex.get(ids[b]);
      if (ga !== undefined && gb !== undefined) gcEdges.push([ga, gb]);
    });
    const gcAdj = undirectedAdj(giantIds.length, gcEdges);
    const gcDir = directedAdj(giantIds.length, gcEdges);

    const cent = centralities(gcAdj);
    const dirCent = centralities(gcDir.out, { directed: true });
    const pr = pagerank(dir.out, dir.inn, 0.85);

    const cast = giantIds.map((id, i) => ({
      id,
      name: nameById.get(id) || shortName(id),
      description: descById.get(id) || "",
      degree: gcAdj[i].length,
      inDegree: gcDir.inn[i].length,
      outDegree: gcDir.out[i].length,
      betweenness: cent.betweenness[i],
      closeness: cent.closeness[i],
      harmonic: cent.harmonic[i],
      betweennessDir: dirCent.betweenness[i],
      pagerank: pr[index.get(id)],
      neighbours: gcAdj[i].map((j) => giantIds[j]),
    }));

    const state = {
      ids,
      index,
      nameById,
      full,
      dir,
      comps,
      giantIds,
      gcIndex,
      gcAdj,
      gcDir,
      cast,
      byId: new Map(cast.map((c) => [c.id, c])),
      byName: new Map(cast.map((c) => [c.name.toLowerCase(), c])),
      ranks: {},
      nullStats: null,
      nullSamples: null,
      selected: "Spider-Man",
      zMeasure: "betweenness",
    };

    ["degree", "closeness", "harmonic", "betweenness", "betweennessDir", "pagerank"].forEach((key) => {
      state.ranks[key] = ranksDescending(cast.map((c) => c[key]));
    });
    cast.forEach((c, i) => {
      c.rank = {};
      Object.keys(state.ranks).forEach((key) => (c.rank[key] = state.ranks[key][i]));
    });

    // Numbers for the briefing strip.
    const distances = [];
    let diameter = 0;
    for (let s = 0; s < gcAdj.length; s++) {
      const d = bfs(gcAdj, s);
      for (let t = 0; t < d.length; t++) {
        if (t !== s && d[t] > 0) {
          distances.push(d[t]);
          if (d[t] > diameter) diameter = d[t];
        }
      }
    }
    state.summary = {
      n: ids.length,
      m: edgeRows.length,
      gcNodes: giantIds.length,
      gcLinks: edgeList(gcAdj).length,
      avgDistance: d3.mean(distances),
      diameter,
      assortativity: degreeAssortativity(gcAdj),
      topFourOverlap: null,
    };

    // How many characters make all four top tens? The four measures here are the
    // ones the page puts in its table: harmonic is left out because on a
    // connected network it ranks almost identically to closeness.
    const tops = ["degree", "closeness", "betweenness", "pagerank"].map(
      (key) => new Set(cast.slice().sort((a, b) => b[key] - a[key]).slice(0, 10).map((c) => c.id))
    );
    state.summary.topFourOverlap = [...tops[0]].filter((id) => tops.every((t) => t.has(id))).length;
    state.topTens = { degree: tops[0], closeness: tops[1], betweenness: tops[2], pagerank: tops[3] };

    return state;
  }

  // ---------------------------------------------------------------
  // The alibi check
  // ---------------------------------------------------------------
  // Per-character summary of a null: where the shuffles put a character, how
  // far the real value sits from that in standard deviations, and how many
  // shuffles matched or beat it (the empirical p-value's numerator). A
  // character whose null never moves — degree 1, betweenness 0 every time —
  // gets z = NaN rather than a divide-by-zero.
  function summariseNull(cast, samples, measures) {
    const n = cast.length;
    const stats = {};
    measures.forEach((measure) => {
      const mean = new Float64Array(n);
      const sd = new Float64Array(n);
      const z = new Float64Array(n);
      const atLeast = new Int32Array(n);
      cast.forEach((c, i) => {
        const values = Array.from(samples[measure][i]);
        const ms = meanSd(values);
        mean[i] = ms.mean;
        sd[i] = ms.sd;
        z[i] = ms.sd > 0 ? (c[measure] - ms.mean) / ms.sd : NaN;
        let count = 0;
        for (const v of values) if (v >= c[measure]) count++;
        atLeast[i] = count;
      });
      stats[measure] = { mean, sd, z, atLeast };
    });
    return stats;
  }

  function verdictFor(state, id) {
    const c = state.byId.get(id);
    const i = state.gcIndex.get(id);
    if (!state.nullStats) return null;
    const stats = state.nullStats.betweenness;
    const z = stats.z[i];
    if (!Number.isFinite(z)) {
      return {
        code: "no-case",
        title: "NO CASE TO ANSWER",
        text: `${shortName(id)} has ${c.degree} link${c.degree === 1 ? "" : "s"}, so their betweenness is 0 in the real network and 0 in every shuffle. There is nothing to compare.`,
      };
    }
    const ratio = stats.mean[i] > 0 ? c.betweenness / stats.mean[i] : Infinity;
    if (z >= 2) {
      return {
        code: "broker",
        title: "BROKER — position beyond degree",
        text: `${ratio.toFixed(1)}× the betweenness a character with ${c.degree} links gets in the shuffles, ${z.toFixed(1)} standard deviations out. ${stats.atLeast[i]} of ${SHUFFLES} shuffles reached it.`,
      };
    }
    if (z <= -2) {
      return {
        code: "sheltered",
        title: "SHELTERED — less than their degree buys",
        text: `Only ${ratio.toFixed(2)}× the shuffled betweenness, ${z.toFixed(1)} standard deviations below it. Their neighbours are linked to each other, so shortest paths go around them.`,
      };
    }
    return {
      code: "alibi",
      title: "ALIBI — it was just their degree",
      text: `Real betweenness ${c.betweenness.toFixed(4)} against ${stats.mean[i].toFixed(4)} ± ${stats.sd[i].toFixed(4)} in the shuffles (z = ${z.toFixed(2)}). Any character with ${c.degree} links scores about this in any network with this degree sequence.`,
    };
  }

  function renderSuspect(state) {
    const c = state.byId.get(state.selected);
    setText("suspect-name", shortName(c.id));
    setText("suspect-degree", c.degree);
    setHTML(
      "suspect-file",
      `<span class="susp-k">in ${c.inDegree} / out ${c.outDegree}</span> &middot; ${c.description ? c.description.slice(0, 150) : "no description on file"}`
    );
    setText("rank-degree", `#${c.rank.degree}`);
    setText("rank-closeness", `#${c.rank.closeness}`);
    setText("rank-harmonic", `#${c.rank.harmonic}`);
    setText("rank-betweenness", `#${c.rank.betweenness}`);
    setText("rank-pagerank", `#${c.rank.pagerank}`);

    const box = document.getElementById("verdict");
    const verdict = verdictFor(state, c.id);
    if (!verdict) {
      box.className = "verdict pending";
      box.innerHTML = `<span class="v-title">NO ALIBI ON FILE</span><span class="v-text">Run the check to shuffle the network ${SHUFFLES} times and see what ${c.degree} links are worth on their own.</span>`;
    } else {
      box.className = `verdict ${verdict.code}`;
      box.innerHTML = `<span class="v-title">${verdict.title}</span><span class="v-text">${verdict.text}</span>`;
    }

    const i = state.gcIndex.get(c.id);
    drawNullHist(
      document.getElementById("null-hist"),
      state.nullSamples ? state.nullSamples.betweenness[i] : null,
      c.betweenness,
      `betweenness of ${shortName(c.id)} in ${SHUFFLES} shuffles`
    );
    drawBetweennessScatter(document.getElementById("chart-scatter"), state, c.id);
    drawZScatter(document.getElementById("chart-z"), state, state.zMeasure, c.id);
  }

  function logLine(text, cls) {
    const log = document.getElementById("check-log");
    if (!log) return;
    const div = document.createElement("div");
    div.className = cls ? `tline ${cls}` : "tline";
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  async function runAlibiCheck(state) {
    if (state.running) return;
    state.running = true;
    const btn = document.getElementById("run-check");
    btn.disabled = true;
    btn.textContent = "RUNNING…";
    document.getElementById("check-log").innerHTML = "";

    const n = state.gcAdj.length;
    const swaps = SWAPS_PER_LINK * state.summary.gcLinks;
    logLine(`> loading MARVEL_303.dat — giant component, ${n} files, ${state.summary.gcLinks} links`);
    logLine(`> null model: degree-preserving double edge swap, ${swaps.toLocaleString()} swaps per shuffle`);
    logLine("> every character keeps their exact number of links; only who-links-to-whom changes");

    const samples = {
      betweenness: Array.from({ length: n }, () => new Float64Array(SHUFFLES)),
      closeness: Array.from({ length: n }, () => new Float64Array(SHUFFLES)),
    };
    const rValues = [];
    const selectedIdx = state.gcIndex.get(state.selected);
    const t0 = performance.now();

    for (let s = 0; s < SHUFFLES; s++) {
      const shuffled = shuffledAdj(state.gcAdj, swaps);
      const c = centralities(shuffled);
      for (let i = 0; i < n; i++) {
        samples.betweenness[i][s] = c.betweenness[i];
        samples.closeness[i][s] = c.closeness[i];
      }
      rValues.push(degreeAssortativity(shuffled));

      if (s % 4 === 3 || s === SHUFFLES - 1) {
        drawNullHist(
          document.getElementById("null-hist"),
          samples.betweenness[selectedIdx].slice(0, s + 1),
          state.byId.get(state.selected).betweenness,
          `betweenness of ${shortName(state.selected)} in ${s + 1} shuffles`
        );
        setText("check-progress", `${s + 1} / ${SHUFFLES}`);
        await frame();
      }
      if (s === 0 || s % 50 === 49) {
        const v = samples.betweenness[selectedIdx][s];
        logLine(`  shuffle ${String(s + 1).padStart(3)} — ${shortName(state.selected)} scores ${v.toFixed(4)}`);
      }
    }

    const stats = summariseNull(state.cast, samples, ["betweenness", "closeness"]);
    const rStats = meanSd(rValues);
    state.nullSamples = samples;
    state.nullStats = stats;
    state.rNull = rStats;

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    logLine(`> ${SHUFFLES} shuffles in ${elapsed}s — null distributions ready for all ${n} characters`, "tline-done");

    const zb = stats.betweenness.z;
    const brokers = state.cast
      .map((c, i) => ({ c, z: zb[i] }))
      .filter((d) => Number.isFinite(d.z))
      .sort((a, b) => b.z - a.z);
    logLine(
      `> brokers: ${brokers.slice(0, 4).map((d) => `${shortName(d.c.id)} (z=${d.z.toFixed(1)})`).join(", ")}`,
      "tline-done"
    );
    logLine(
      `> sheltered: ${brokers.slice(-3).reverse().map((d) => `${shortName(d.c.id)} (z=${d.z.toFixed(1)})`).join(", ")}`,
      "tline-done"
    );

    renderFindings(state, brokers);
    renderSuspect(state);
    btn.disabled = false;
    btn.textContent = "RUN ALIBI CHECK AGAIN";
    state.running = false;
  }

  function renderFindings(state, brokers) {
    const spider = state.byId.get("Spider-Man");
    const si = state.gcIndex.get("Spider-Man");
    const zb = state.nullStats.betweenness;
    const zc = state.nullStats.closeness;

    setHTML(
      "finding-alibi",
      `<strong>The biggest number in the case file is not a finding.</strong> Spider-Man carries
       ${(spider.betweenness * 100).toFixed(1)}% of all shortest paths, far more than anyone else — and the shuffled
       networks give a character with his 106 links ${(zb.mean[si] * 100).toFixed(1)}% ± ${(zb.sd[si] * 100).toFixed(1)}%,
       so he sits ${zb.z[si].toFixed(1)} standard deviations from the null. His control of the network is bought
       entirely with link count. Ask the same question of the whole cast and only
       ${state.cast.filter((c, i) => Math.abs(zb.z[i]) > 2).length} of ${state.cast.length} characters answer it
       differently.`
    );

    // Split the brokers by size. A character with two links can post an enormous
    // z-score simply because their null almost never moves, so they are a
    // different kind of finding from a well-connected character who out-brokers
    // their link count, and the two get their own sentences.
    const top = brokers.filter((d) => d.c.degree >= 10).slice(0, 3);
    const gatekeepers = brokers.filter((d) => d.c.degree < 10).slice(0, 3);
    const bottom = brokers.slice(-2).reverse();
    setHTML(
      "finding-brokers",
      `<strong>The real brokers are mid-table.</strong> ${top
        .map(
          (d) =>
            `${shortName(d.c.id)} (degree ${d.c.degree}, rank #${d.c.rank.degree} by links but #${d.c.rank.betweenness} by betweenness, z = ${d.z.toFixed(1)})`
        )
        .join(", ")}. Below them sit the gatekeepers — ${gatekeepers
        .map((d) => `${shortName(d.c.id)} (${d.c.degree} links)`)
        .join(", ")} — who have few links but hold the only route to somewhere, and whose z-scores read as
        "off the scale" rather than as precise numbers, because their shuffled betweenness is almost always zero.
        At the other end, ${bottom
        .map((d) => `${shortName(d.c.id)} (z = ${d.z.toFixed(1)})`)
        .join(" and ")} have fewer paths through them than their links predict: their neighbourhoods are
        already sewn together, so traffic has a way around.`
    );

    const zcFinite = state.cast.map((c, i) => zc.z[i]).filter(Number.isFinite);
    const ratios = state.cast
      .map((c, i) => (zc.mean[i] > 0 ? c.closeness / zc.mean[i] : NaN))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    setHTML(
      "finding-closeness",
      `<strong>Closeness cannot be surprising.</strong> Shuffle the network and every character's real closeness
       stays within ${ratios[0].toFixed(2)}–${ratios[ratios.length - 1].toFixed(2)} times its shuffled value, because closeness
       averages the distance to all ${state.cast.length - 1} other characters and those distances are 2, 3 or 4 no
       matter how the links are arranged. ${zcFinite.filter((z) => Math.abs(z) > 2).length} characters still clear
       |z| > 2, but only because the null barely moves — the effect sizes are a few percent. Betweenness is the
       measure with room to be surprising; closeness is nailed down by the degree sequence.`
    );

    setHTML(
      "finding-mixing",
      `<strong>And the network's disassortativity is not a finding either.</strong> Marvel's degree assortativity is
       ${state.summary.assortativity.toFixed(3)}; the same ${SHUFFLES} shuffles give
       ${state.rNull.mean.toFixed(3)} ± ${state.rNull.sd.toFixed(3)}, i.e. z =
       ${((state.summary.assortativity - state.rNull.mean) / state.rNull.sd).toFixed(1)}. Hubs link to small
       characters here because there are not enough other hubs to go around, which is true of any heavy-tailed
       network, not a fact about Marvel.`
    );
  }

  // ---------------------------------------------------------------
  // Gadget 2 — the chain tracer
  // ---------------------------------------------------------------
  function tracePath(state, fromId, toId, directed) {
    const adj = directed ? state.dir.out : state.full;
    const from = state.index.get(fromId);
    const to = state.index.get(toId);
    if (from === undefined || to === undefined) return null;
    const prev = new Int32Array(adj.length).fill(-1);
    const seen = new Uint8Array(adj.length);
    seen[from] = 1;
    const queue = [from];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      if (v === to) break;
      for (const w of adj[v]) {
        if (!seen[w]) {
          seen[w] = 1;
          prev[w] = v;
          queue.push(w);
        }
      }
    }
    if (!seen[to]) return { reachable: false, reached: queue.length };
    const path = [];
    for (let v = to; v !== -1; v = prev[v]) path.push(state.ids[v]);
    path.reverse();
    return { reachable: true, path, reached: queue.length };
  }

  function renderChain(state) {
    const input = document.getElementById("trace-input");
    const out = document.getElementById("trace-result");
    const typed = (input.value || "").trim().toLowerCase();
    const match =
      state.byName.get(typed) ||
      state.cast.find((c) => c.name.toLowerCase() === typed) ||
      state.cast.find((c) => shortName(c.id).toLowerCase() === typed) ||
      state.cast.find((c) => c.name.toLowerCase().startsWith(typed) && typed.length > 2);
    if (!match) {
      out.innerHTML = `<p class="trace-miss">No file matches “${input.value}”. Try one of the names in the list.</p>`;
      return;
    }
    const directed = state.traceDirected;
    const there = tracePath(state, match.id, "Spider-Man", directed);
    const back = tracePath(state, "Spider-Man", match.id, directed);

    function chainHTML(result, fromLabel, toLabel) {
      if (!result || !result.reachable) {
        return `<div class="chain-row broken"><span class="chain-label">${fromLabel} → ${toLabel}</span>
                <span class="chain-body">no route following the arrows — the trail is one-way</span></div>`;
      }
      const hops = result.path.length - 1;
      const body = result.path
        .map((id, i) => `<span class="hop${i === 0 || i === result.path.length - 1 ? " end" : ""}">${shortName(id)}</span>`)
        .join('<span class="arrow">→</span>');
      return `<div class="chain-row"><span class="chain-label">${fromLabel} → ${toLabel} <em>(${hops} hop${hops === 1 ? "" : "s"})</em></span>
              <span class="chain-body">${body}</span></div>`;
    }

    const name = shortName(match.id);
    let html = chainHTML(there, name, "Spider-Man");
    if (directed) html += chainHTML(back, "Spider-Man", name);
    if (directed && there && there.reachable && back && back.reachable && there.path.length !== back.path.length) {
      html += `<p class="trace-note">Same pair, different lengths: a wiki-link only points one way, so the
               distance out and the distance home are different numbers.</p>`;
    }
    if (!directed) {
      html += `<p class="trace-note">Ignoring the arrows, every character in the giant component is within three
               steps of Spider-Man. Turn the arrows on to see how much of that is real.</p>`;
    }
    out.innerHTML = html;
  }

  // ---------------------------------------------------------------
  // Gadget 3 — pull the thread
  // ---------------------------------------------------------------
  function giantFractionAfterRemoval(state, order, steps) {
    const n = state.gcAdj.length;
    const removed = new Uint8Array(n);
    const series = [];
    for (let step = 0; step <= steps; step++) {
      if (step > 0) removed[order[step - 1]] = 1;
      const seen = new Uint8Array(n);
      let best = 0;
      let alive = 0;
      for (let i = 0; i < n; i++) if (!removed[i]) alive++;
      for (let s = 0; s < n; s++) {
        if (removed[s] || seen[s]) continue;
        let size = 0;
        const queue = [s];
        seen[s] = 1;
        for (let qi = 0; qi < queue.length; qi++) {
          const v = queue[qi];
          size++;
          for (const w of state.gcAdj[v]) {
            if (!removed[w] && !seen[w]) {
              seen[w] = 1;
              queue.push(w);
            }
          }
        }
        if (size > best) best = size;
      }
      series.push(alive ? best / alive : 0);
    }
    return series;
  }

  // A small seeded generator so the "at random" curve is the same for every
  // reader — a random baseline that changes on reload is not a baseline.
  function seededShuffle(values, seed) {
    const arr = values.slice();
    let s = seed;
    const rand = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function renderRemoval(state) {
    const steps = 150; // far enough for the targeted orders to actually break the network
    const byIdx = (key) =>
      d3
        .range(state.cast.length)
        .sort((a, b) => state.cast[b][key] - state.cast[a][key])
        .slice(0, steps);
    const series = {
      betweenness: giantFractionAfterRemoval(state, byIdx("betweenness"), steps),
      degree: giantFractionAfterRemoval(state, byIdx("degree"), steps),
      pagerank: giantFractionAfterRemoval(state, byIdx("pagerank"), steps),
      random: giantFractionAfterRemoval(state, seededShuffle(d3.range(state.cast.length), 20260920).slice(0, steps), steps),
    };
    drawRemoval(document.getElementById("chart-removal"), series);

    const worst = d3
      .range(state.cast.length)
      .map((i) => ({ i, frac: giantFractionAfterRemoval(state, [i], 1)[1] }))
      .sort((a, b) => a.frac - b.frac)[0];
    const half = series.betweenness.findIndex((v) => v < 0.5);
    const gap = d3.max(series.degree.map((v, i) => Math.abs(v - series.betweenness[i])));
    const at = Math.min(120, steps);
    setHTML(
      "finding-removal",
      `<strong>No single character holds this network together, and no single measure aims the attack better.</strong>
       The most damaging removal in the entire cast — ${shortName(state.cast[worst.i].id)}, who else — still leaves
       ${(worst.frac * 100).toFixed(1)}% of the survivors in one piece. It takes a campaign: the giant component
       holds above 80% for the first 60 removals, and only past ${half} does it fall below half, collapsing to
       ${(series.betweenness[steps] * 100).toFixed(0)}% by ${steps} while random removals still leave
       ${(series.random[steps] * 100).toFixed(0)}% intact. That is the familiar picture — heavy-tailed networks
       shrug off accidents and come apart under a targeted attack. Two details are ours rather than the textbook's.
       Betweenness and degree never separate by more than ${(gap * 100).toFixed(0)} percentage points, so the
       measure built to find brokers is no better at choosing whom to remove than simply counting links — because
       it is mostly link count. And PageRank is the worst plan of the three: after ${at} removals it still leaves
       ${(series.pagerank[at] * 100).toFixed(0)}% standing against betweenness's
       ${(series.betweenness[at] * 100).toFixed(0)}%, because it ranks prestige in the directed network, which is
       not the same thing as holding an undirected one together.`
    );
  }

  // ---------------------------------------------------------------
  // Static tables
  // ---------------------------------------------------------------
  function renderTopTens(state) {
    const measures = [
      ["degree", "Degree — popularity"],
      ["closeness", "Closeness — reach"],
      ["betweenness", "Betweenness — control"],
      ["pagerank", "PageRank — prestige"],
    ];
    const lists = measures.map(([key]) => state.cast.slice().sort((a, b) => b[key] - a[key]).slice(0, 10));
    const allFour = lists[0].filter((c) => lists.every((l) => l.some((x) => x.id === c.id))).map((c) => c.id);
    let html = "<thead><tr><th>#</th>" + measures.map(([, label]) => `<th>${label}</th>`).join("") + "</tr></thead><tbody>";
    for (let i = 0; i < 10; i++) {
      html += `<tr><td>${i + 1}</td>`;
      lists.forEach((list) => {
        const c = list[i];
        const cls = allFour.includes(c.id) ? "" : ' class="odd-one"';
        html += `<td${cls}>${shortName(c.id)}</td>`;
      });
      html += "</tr>";
    }
    html += "</tbody>";
    document.getElementById("toptens").innerHTML = html;
    setText("toptens-overlap", allFour.length);
  }

  function renderDirection(state) {
    const moves = state.cast
      .filter((c) => c.rank.betweenness <= 40)
      .map((c) => ({ c, change: c.rank.betweenness - c.rank.betweennessDir }))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 8)
      .sort((a, b) => b.change - a.change);
    let html =
      "<thead><tr><th>Character</th><th>in</th><th>out</th><th>rank, arrows off</th><th>rank, arrows on</th><th>move</th></tr></thead><tbody>";
    moves.forEach(({ c, change }) => {
      const sign = change > 0 ? "up" : change < 0 ? "down" : "flat";
      html += `<tr><td>${shortName(c.id)}</td><td>${c.inDegree}</td><td>${c.outDegree}</td>
               <td>#${c.rank.betweenness}</td><td>#${c.rank.betweennessDir}</td>
               <td class="move-${sign}">${change > 0 ? "+" : ""}${change}</td></tr>`;
    });
    html += "</tbody>";
    document.getElementById("direction-table").innerHTML = html;

    const herc = state.byId.get("Hercules_(Marvel_Comics)");
    const spider = state.byId.get("Spider-Man");
    setHTML(
      "finding-direction",
      `<strong>Being linked to is not the same as passing traffic on.</strong> A directed path has to arrive through
       an in-link and leave through an out-link, so a character only brokers if their own page links out too.
       Spider-Man is linked from ${spider.inDegree} pages but links to ${spider.outDegree}, all inside his own
       corner, and he falls from #${spider.rank.betweenness} to #${spider.rank.betweennessDir}. Hercules, with
       ${herc.inDegree} in and ${herc.outDegree} out spread across the Avengers, the cosmic characters and Asgard,
       climbs from #${herc.rank.betweenness} to #${herc.rank.betweennessDir}.`
    );
  }

  function renderBriefing(state) {
    const s = state.summary;
    setText("stat-nodes", s.n);
    setText("stat-links", s.m.toLocaleString());
    setText("stat-gc", s.gcNodes);
    setText("stat-dist", s.avgDistance.toFixed(2));
    setText("stat-diameter", s.diameter);
    setText("stat-overlap", s.topFourOverlap);
  }

  // ---------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------
  function setupSuspectPicker(state) {
    const input = document.getElementById("suspect-input");
    const list = document.getElementById("suspect-options");
    list.innerHTML = state.cast
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<option value="${c.name.replace(/"/g, "&quot;")}"></option>`)
      .join("");

    function select(id) {
      if (!state.byId.has(id)) return;
      state.selected = id;
      input.value = state.byId.get(id).name;
      renderSuspect(state);
    }

    document.getElementById("suspect-go").addEventListener("click", () => {
      const typed = (input.value || "").trim().toLowerCase();
      const match =
        state.byName.get(typed) ||
        state.cast.find((c) => shortName(c.id).toLowerCase() === typed) ||
        state.cast.find((c) => c.name.toLowerCase().startsWith(typed) && typed.length > 2);
      if (match) select(match.id);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("suspect-go").click();
    });
    document.querySelectorAll("[data-suspect]").forEach((btn) => {
      btn.addEventListener("click", () => select(btn.getAttribute("data-suspect")));
    });
    select(state.selected);
  }

  function setupTracer(state) {
    state.traceDirected = false;
    const input = document.getElementById("trace-input");
    document.getElementById("trace-options").innerHTML = state.cast
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<option value="${c.name.replace(/"/g, "&quot;")}"></option>`)
      .join("");
    input.value = "Beta Ray Bill";
    document.getElementById("trace-go").addEventListener("click", () => renderChain(state));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") renderChain(state);
    });
    document.querySelectorAll("[data-arrows]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.traceDirected = btn.getAttribute("data-arrows") === "on";
        document.querySelectorAll("[data-arrows]").forEach((b) => b.classList.toggle("active", b === btn));
        renderChain(state);
      });
    });
    renderChain(state);
  }

  function setupZToggle(state) {
    document.querySelectorAll("[data-zmeasure]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.zMeasure = btn.getAttribute("data-zmeasure");
        document.querySelectorAll("[data-zmeasure]").forEach((b) => b.classList.toggle("active", b === btn));
        drawZScatter(document.getElementById("chart-z"), state, state.zMeasure, state.selected);
      });
    });
  }

  async function init() {
    const [nodesTxt, edgesTxt] = await Promise.all([
      fetch(NODES_URL).then((r) => r.text()),
      fetch(EDGES_URL).then((r) => r.text()),
    ]);
    const nodeRows = parseTSV(nodesTxt, ["node_id", "name", "wikidata_id", "url", "description"]);
    const edgeRows = parseTSV(edgesTxt, ["source", "target"], false);
    const state = buildState(nodeRows, edgeRows);
    window.WLF3_STATE = state;

    renderBriefing(state);
    renderTopTens(state);
    renderDirection(state);
    renderRemoval(state);
    setupSuspectPicker(state);
    setupTracer(state);
    setupZToggle(state);
    document.getElementById("run-check").addEventListener("click", () => runAlibiCheck(state));
  }

  // The rendering layer, exposed for the same harness: it drives these against
  // a small null so a broken finding or a missing element fails a check rather
  // than a reader's browser.
  window.WLF3_UI = {
    renderSuspect,
    renderFindings,
    renderTopTens,
    renderDirection,
    renderRemoval,
    drawBetweennessScatter,
    drawZScatter,
    drawNullHist,
    verdictFor,
  };

  // The compute core, exposed so the numbers on this page can be checked
  // against the week 3 notebook (see tools/verify-week3.html in the repo).
  window.WLF3 = {
    parseTSV,
    indexNodes,
    undirectedAdj,
    directedAdj,
    components,
    bfs,
    centralities,
    pagerank,
    degreeAssortativity,
    shuffledAdj,
    edgeList,
    summariseNull,
    meanSd,
    buildState,
    tracePath,
    giantFractionAfterRemoval,
  };

  if (document.getElementById("run-check")) {
    init().catch((err) => {
      console.error(err);
      const log = document.getElementById("check-log");
      if (log) log.textContent = `> failed to load the case file: ${err.message}`;
    });
  }
})();
