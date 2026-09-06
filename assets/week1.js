/* ============================================================
   Case No. 01 — The Marvel Manhunt
   Loads week1_nodes.tsv / week1_edges.tsv, builds the network,
   runs the hot/cold guessing game, and renders the analysis
   figures. Pure vanilla JS + D3 (loaded globally as `d3`).
   ============================================================ */
(function () {
  "use strict";

  const NODES_URL = "../week1_nodes.tsv";
  const EDGES_URL = "../week1_edges.tsv";

  // ---------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------
  function parseTSV(text, cols) {
    return text
      .split(/\r?\n/)
      .filter((l) => l.length && !l.startsWith("#"))
      .slice(1) // drop the header row
      .map((line) => {
        const parts = line.split("\t");
        const obj = {};
        cols.forEach((c, i) => (obj[c] = parts[i]));
        return obj;
      });
  }

  // ---------------------------------------------------------------
  // Graph construction
  // ---------------------------------------------------------------
  function buildGraph(nodes, edges) {
    const byId = new Map(nodes.map((n) => [n.node_id, n]));
    const undirAdj = new Map(nodes.map((n) => [n.node_id, new Set()]));
    const outAdj = new Map(nodes.map((n) => [n.node_id, new Set()]));
    const inAdj = new Map(nodes.map((n) => [n.node_id, new Set()]));
    const linkSet = new Map(); // "a|b" (sorted) -> {source, target}

    edges.forEach((e) => {
      if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) return;
      undirAdj.get(e.source).add(e.target);
      undirAdj.get(e.target).add(e.source);
      outAdj.get(e.source).add(e.target);
      inAdj.get(e.target).add(e.source);
      const key = [e.source, e.target].sort().join("|");
      if (!linkSet.has(key)) linkSet.set(key, { source: e.source, target: e.target });
    });

    return { byId, undirAdj, outAdj, inAdj, undirLinks: Array.from(linkSet.values()) };
  }

  function connectedComponents(nodes, undirAdj) {
    const seen = new Set();
    const comps = [];
    for (const n of nodes) {
      const id = n.node_id;
      if (seen.has(id)) continue;
      const queue = [id];
      seen.add(id);
      const comp = [id];
      while (queue.length) {
        const cur = queue.shift();
        for (const nb of undirAdj.get(cur)) {
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

  function bfsFrom(root, undirAdj) {
    const dist = new Map([[root, 0]]);
    const parent = new Map([[root, null]]);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of undirAdj.get(cur)) {
        if (!dist.has(nb)) {
          dist.set(nb, dist.get(cur) + 1);
          parent.set(nb, cur);
          queue.push(nb);
        }
      }
    }
    return { dist, parent };
  }

  function dailySeedIndex(n) {
    const d = new Date();
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h % n;
  }

  // ---------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------
  async function init() {
    const [nodesTxt, edgesTxt] = await Promise.all([
      fetch(NODES_URL).then((r) => r.text()),
      fetch(EDGES_URL).then((r) => r.text()),
    ]);

    const nodes = parseTSV(nodesTxt, ["node_id", "name", "wikidata_id", "url", "description"]);
    const edges = parseTSV(edgesTxt, ["source", "target"]);
    const graph = buildGraph(nodes, edges);
    const { byId, undirAdj, outAdj, inAdj, undirLinks } = graph;

    const comps = connectedComponents(nodes, undirAdj);
    const giant = comps[0];
    const giantSet = new Set(giant);
    const smallClusters = comps.filter((c) => c.length > 1 && c !== giant);
    const isolates = comps.filter((c) => c.length === 1).map((c) => c[0]);

    const degree = new Map(nodes.map((n) => [n.node_id, undirAdj.get(n.node_id).size]));
    const indeg = new Map(nodes.map((n) => [n.node_id, inAdj.get(n.node_id).size]));
    const outdeg = new Map(nodes.map((n) => [n.node_id, outAdj.get(n.node_id).size]));

    // exact-enough diameter: BFS from every giant node (277 nodes — trivial at this scale)
    let diameter = 0;
    let eccByNode = new Map();
    giant.forEach((id) => {
      const { dist } = bfsFrom(id, undirAdj);
      let ecc = 0;
      dist.forEach((v) => {
        if (v > ecc) ecc = v;
      });
      eccByNode.set(id, ecc);
      if (ecc > diameter) diameter = ecc;
    });

    renderBriefing({ nodes, edges, giant, isolates, diameter });
    renderCharts({ nodes, degree, indeg, outdeg, byId });
    renderFindings({ nodes, degree, indeg, outdeg, byId, giant, smallClusters, isolates });
    renderNetworkFigure({ nodes, undirLinks, degree, giantSet, smallClusters, isolates, byId });
    renderColdCases({ smallClusters, isolates, byId });
    setupGame({ giant, byId, undirAdj, eccByNode, undirLinks, degree });
  }

  // ---------------------------------------------------------------
  // Briefing stats
  // ---------------------------------------------------------------
  function renderBriefing({ nodes, edges, giant, isolates, diameter }) {
    document.getElementById("stat-nodes").textContent = nodes.length;
    document.getElementById("stat-edges").textContent = edges.length;
    document.getElementById("stat-giant").textContent =
      Math.round((giant.length / nodes.length) * 1000) / 10 + "%";
    document.getElementById("stat-isolates").textContent = isolates.length;
    document.getElementById("stat-diameter").textContent = diameter;
  }

  // ---------------------------------------------------------------
  // Charts: linear + log-log degree distribution
  // ---------------------------------------------------------------
  function renderCharts({ degree }) {
    const degrees = Array.from(degree.values());
    const maxDeg = d3.max(degrees);

    // ---- linear histogram, binned in groups of 5 ----
    const binWidth = 5;
    const nBins = Math.floor(maxDeg / binWidth) + 1;
    const bins = Array.from({ length: nBins }, (_, i) => ({
      lo: i * binWidth,
      hi: i * binWidth + binWidth - 1,
      count: 0,
    }));
    degrees.forEach((d) => bins[Math.floor(d / binWidth)].count++);

    drawBarChart("#chart-linear", bins);

    // ---- log-log scatter, raw degree counts ----
    const counts = d3.rollup(
      degrees.filter((d) => d > 0),
      (v) => v.length,
      (d) => d
    );
    const points = Array.from(counts, ([degree, count]) => ({ degree, count })).sort(
      (a, b) => a.degree - b.degree
    );
    drawLogLogChart("#chart-loglog", points);
  }

  function svgRoot(sel, w, h) {
    const el = document.querySelector(sel);
    el.innerHTML = "";
    return d3
      .select(el)
      .append("svg")
      .attr("viewBox", `0 0 ${w} ${h}`)
      .attr("width", w)
      .attr("height", h);
  }

  function drawBarChart(sel, bins) {
    const w = 460,
      h = 300,
      m = { top: 12, right: 14, bottom: 40, left: 42 };
    const svg = svgRoot(sel, w, h);
    const x = d3
      .scaleBand()
      .domain(bins.map((b) => b.lo))
      .range([m.left, w - m.right])
      .padding(0.15);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(bins, (b) => b.count)])
      .nice()
      .range([h - m.bottom, m.top]);

    svg
      .append("g")
      .attr("transform", `translate(0,${h - m.bottom})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(x.domain().filter((_, i) => i % 3 === 0))
          .tickFormat((d) => d)
      )
      .call((g) => g.selectAll("text").attr("font-size", 10).attr("font-family", "Courier Prime, monospace"))
      .append("text")
      .attr("x", (w - m.left - m.right) / 2 + m.left)
      .attr("y", 34)
      .attr("fill", "#2b2622")
      .attr("font-size", 11)
      .attr("text-anchor", "middle")
      .text("degree (binned, width 5)");

    svg
      .append("g")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(5))
      .call((g) => g.selectAll("text").attr("font-size", 10).attr("font-family", "Courier Prime, monospace"));

    svg
      .selectAll("rect.bar")
      .data(bins)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (b) => x(b.lo))
      .attr("y", (b) => y(b.count))
      .attr("width", x.bandwidth())
      .attr("height", (b) => h - m.bottom - y(b.count))
      .attr("fill", "#9c2b21")
      .append("title")
      .text((b) => `degree ${b.lo}–${b.hi}: ${b.count} characters`);
  }

  function drawLogLogChart(sel, points) {
    const w = 460,
      h = 300,
      m = { top: 12, right: 14, bottom: 40, left: 42 };
    const svg = svgRoot(sel, w, h);
    const x = d3
      .scaleLog()
      .domain([1, d3.max(points, (p) => p.degree)])
      .range([m.left, w - m.right]);
    const y = d3
      .scaleLog()
      .domain([1, d3.max(points, (p) => p.count)])
      .range([h - m.bottom, m.top]);

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

    svg
      .selectAll("circle.pt")
      .data(points)
      .join("circle")
      .attr("class", "pt")
      .attr("cx", (p) => x(p.degree))
      .attr("cy", (p) => y(p.count))
      .attr("r", 3.5)
      .attr("fill", "#7a1f17")
      .append("title")
      .text((p) => `degree ${p.degree}: ${p.count} characters`);
  }

  // ---------------------------------------------------------------
  // Rank lists
  // ---------------------------------------------------------------
  function renderFindings({ nodes, degree, indeg, outdeg, byId, giant, smallClusters, isolates }) {
    const sortedByDeg = [...nodes].sort((a, b) => degree.get(b.node_id) - degree.get(a.node_id));
    const top1 = sortedByDeg[0];
    const top2 = sortedByDeg[1];

    document.getElementById("finding-hub").innerHTML = `<strong>Finding:</strong> the single biggest hub is
      <b>${top1.name}</b> with ${degree.get(top1.node_id)} total links &mdash;
      ${(degree.get(top1.node_id) / degree.get(top2.node_id)).toFixed(1)}&times; the
      runner-up, <b>${top2.name}</b> (${degree.get(top2.node_id)}). On the linear plot this hub is invisible,
      a single bar lost far off to the right; on the log&ndash;log plot it's the point that makes the
      heavy tail obvious. That shape &mdash; a few extreme hubs, everyone else clustered near the
      bottom &mdash; is the signature of a scale-free-like network rather than a random one, where
      degrees would cluster tightly around the average.`;

    const gaps = nodes
      .filter((n) => indeg.get(n.node_id) + outdeg.get(n.node_id) >= 5)
      .map((n) => ({ n, gap: indeg.get(n.node_id) - outdeg.get(n.node_id) }));
    gaps.sort((a, b) => b.gap - a.gap);
    const celeb = gaps[0];
    gaps.sort((a, b) => a.gap - b.gap);
    const connector = gaps[0];

    document.getElementById("finding-asymmetry").innerHTML = `<strong>Finding:</strong>
      <b>${celeb.n.name}</b> is the network's biggest "celebrity": ${indeg.get(celeb.n.node_id)}
      in-links but only ${outdeg.get(celeb.n.node_id)} out-links &mdash; everyone mentions them, they
      mention almost no one. At the opposite extreme, <b>${connector.n.name}</b> links out to
      ${outdeg.get(connector.n.node_id)} other characters while only ${indeg.get(connector.n.node_id)}
      link back &mdash; a "connector" whose article is a hub of outgoing references rather than a
      destination.`;

    document.getElementById("finding-surprise").innerHTML =
      smallClusters.length
        ? `<strong>Most surprising structural fact:</strong> ${smallClusters[0].length} characters
          (${smallClusters[0].map((id) => byId.get(id).name).join(", ")}) wiki-link to <em>each other</em>
          but to absolutely no one else in the category &mdash; a fully self-contained clique floating
          outside the main Marvel universe. Combined with ${isolates.length} total isolates, that's
          ${(smallClusters.reduce((s, c) => s + c.length, 0) + isolates.length)} of ${nodes.length}
          characters (${Math.round(((smallClusters.reduce((s, c) => s + c.length, 0) + isolates.length) / nodes.length) * 1000) / 10}%)
          that the game above can never place as a target.`
        : "";

    document.getElementById("giant-fraction-text").innerHTML = `<b>${Math.round(
      (giant.length / nodes.length) * 1000
    ) / 10}%</b> of all characters (${giant.length} of ${nodes.length}) belong to one giant connected
      component &mdash; click around the evidence board below and you'll eventually reach almost
      everyone from almost anyone.`;

    // top-10 lists
    const byIn = [...nodes].sort((a, b) => indeg.get(b.node_id) - indeg.get(a.node_id)).slice(0, 10);
    const byOut = [...nodes].sort((a, b) => outdeg.get(b.node_id) - outdeg.get(a.node_id)).slice(0, 10);
    const maxIn = indeg.get(byIn[0].node_id);
    const maxOut = outdeg.get(byOut[0].node_id);

    document.getElementById("top-in-list").innerHTML = byIn
      .map(
        (n) => `<li><span>${n.name}</span>
          <span class="bar"><span style="width:${(indeg.get(n.node_id) / maxIn) * 100}%"></span></span>
          <span>${indeg.get(n.node_id)}</span></li>`
      )
      .join("");

    document.getElementById("top-out-list").innerHTML = byOut
      .map(
        (n) => `<li><span>${n.name}</span>
          <span class="bar"><span style="width:${(outdeg.get(n.node_id) / maxOut) * 100}%"></span></span>
          <span>${outdeg.get(n.node_id)}</span></li>`
      )
      .join("");
  }

  function renderColdCases({ smallClusters, isolates, byId }) {
    const names = [];
    smallClusters.forEach((c) => c.forEach((id) => names.push(byId.get(id).name)));
    isolates.forEach((id) => names.push(byId.get(id).name));
    names.sort();
    document.getElementById("cold-cases-list").innerHTML = names.map((n) => `<span>${n}</span>`).join("");
  }

  // ---------------------------------------------------------------
  // Network figure (force-directed, D3)
  // ---------------------------------------------------------------
  function renderNetworkFigure({ nodes, undirLinks, degree, giantSet, smallClusters, isolates, byId }) {
    const w = 820,
      h = 560;
    const el = document.getElementById("network-fig");
    el.innerHTML = "";

    const smallSet = new Set(smallClusters.flat());
    const isoSet = new Set(isolates);

    const colorFor = (id) => (isoSet.has(id) ? "#8a7a62" : smallSet.has(id) ? "#2f5e6b" : "#9c2b21");
    const groupFor = (id) => (isoSet.has(id) ? "iso" : smallSet.has(id) ? "small" : "giant");
    const nodeData = nodes.map((n) => ({
      id: n.node_id,
      name: n.name,
      r: Math.max(2.5, Math.min(16, 2.5 + Math.sqrt(degree.get(n.node_id)) * 1.6)),
      color: colorFor(n.node_id),
      group: groupFor(n.node_id),
    }));
    const linkData = undirLinks.map((l) => ({ source: l.source, target: l.target }));

    // pull each group toward its own corner so the disconnected clique and the
    // true isolates visibly drift away from the giant component instead of
    // collapsing into the same shared center of mass.
    const zoneTarget = {
      giant: [w * 0.4, h * 0.53],
      small: [w * 0.87, h * 0.78],
      iso: [w * 0.87, h * 0.16],
    };

    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);

    svg
      .append("text")
      .attr("x", zoneTarget.small[0])
      .attr("y", zoneTarget.small[1] + 60)
      .attr("text-anchor", "middle")
      .attr("font-family", "Special Elite, monospace")
      .attr("font-size", 11)
      .attr("fill", "#2f5e6b")
      .text("SEALED CLIQUE");

    svg
      .append("text")
      .attr("x", zoneTarget.iso[0])
      .attr("y", zoneTarget.iso[1] - 55)
      .attr("text-anchor", "middle")
      .attr("font-family", "Special Elite, monospace")
      .attr("font-size", 11)
      .attr("fill", "#8a7a62")
      .text("TRUE ISOLATES");

    const zoomLayer = svg.append("g");
    svg.call(
      d3
        .zoom()
        .scaleExtent([0.3, 6])
        .on("zoom", (event) => zoomLayer.attr("transform", event.transform))
    );

    const linkSel = zoomLayer
      .append("g")
      .attr("stroke", "#b7a377")
      .attr("stroke-opacity", 0.5)
      .selectAll("line")
      .data(linkData)
      .join("line")
      .attr("stroke-width", 1);

    const nodeSel = zoomLayer
      .append("g")
      .attr("stroke", "#2b2622")
      .attr("stroke-width", 0.6)
      .selectAll("circle")
      .data(nodeData)
      .join("circle")
      .attr("r", (d) => d.r)
      .attr("fill", (d) => d.color)
      .style("cursor", "pointer")
      .call(drag());

    nodeSel.append("title").text((d) => `${d.name} (degree ${degree.get(d.id)})`);

    const neighborOf = new Map(nodeData.map((n) => [n.id, new Set()]));
    linkData.forEach((l) => {
      neighborOf.get(l.source).add(l.target);
      neighborOf.get(l.target).add(l.source);
    });

    nodeSel.on("click", (event, d) => {
      event.stopPropagation();
      const nb = neighborOf.get(d.id);
      nodeSel.attr("opacity", (o) => (o.id === d.id || nb.has(o.id) ? 1 : 0.12));
      linkSel.attr("stroke-opacity", (l) => (l.source.id === d.id || l.target.id === d.id ? 0.9 : 0.05));
    });
    svg.on("click", () => {
      nodeSel.attr("opacity", 1);
      linkSel.attr("stroke-opacity", 0.5);
    });

    const sim = d3
      .forceSimulation(nodeData)
      .force(
        "link",
        d3
          .forceLink(linkData)
          .id((d) => d.id)
          .distance(24)
          .strength(0.25)
      )
      .force("charge", d3.forceManyBody().strength(-26))
      .force("x", d3.forceX((d) => zoneTarget[d.group][0]).strength((d) => (d.group === "giant" ? 0.045 : 0.12)))
      .force("y", d3.forceY((d) => zoneTarget[d.group][1]).strength((d) => (d.group === "giant" ? 0.045 : 0.12)))
      .force("collide", d3.forceCollide().radius((d) => d.r + 1.5))
      .on("tick", () => {
        linkSel
          .attr("x1", (l) => l.source.x)
          .attr("y1", (l) => l.source.y)
          .attr("x2", (l) => l.target.x)
          .attr("y2", (l) => l.target.y);
        nodeSel.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      });

    function drag() {
      return d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        });
    }
  }

  // ---------------------------------------------------------------
  // Investigation map — a small force graph, embedded in the game
  // panel, that highlights the last guess and everyone exactly as
  // far from it as the target is.
  // ---------------------------------------------------------------
  function createInvestigationMap(container, nodeData, linkData) {
    const w = 720,
      h = 460;
    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);

    const zoomLayer = svg.append("g");
    svg.call(
      d3
        .zoom()
        .scaleExtent([0.3, 10])
        .on("zoom", (event) => zoomLayer.attr("transform", event.transform))
    );

    const linkSel = zoomLayer
      .append("g")
      .attr("stroke", "#b7a377")
      .attr("stroke-opacity", 0.3)
      .selectAll("line")
      .data(linkData)
      .join("line")
      .attr("stroke-width", 1);

    const nodeSel = zoomLayer
      .append("g")
      .attr("stroke", "#2b2622")
      .attr("stroke-width", 0.6)
      .selectAll("circle")
      .data(nodeData)
      .join("circle")
      .attr("r", (d) => d.r)
      .attr("fill", "#cbbd94");

    // labels are always on — this map exists to help a human read character
    // names off the graph, not to hide them behind a hover
    const labelSel = zoomLayer
      .append("g")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 6.5)
      .attr("fill", "#4a4034")
      .style("pointer-events", "none")
      .selectAll("text")
      .data(nodeData)
      .join("text")
      .attr("dy", "0.32em")
      .text((d) => d.name);

    const sim = d3
      .forceSimulation(nodeData)
      .force(
        "link",
        d3.forceLink(linkData).id((d) => d.id).distance(26).strength(0.22)
      )
      .force("charge", d3.forceManyBody().strength(-30))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collide", d3.forceCollide().radius((d) => d.r + 12))
      .on("tick", () => {
        linkSel
          .attr("x1", (l) => l.source.x)
          .attr("y1", (l) => l.source.y)
          .attr("x2", (l) => l.target.x)
          .attr("y2", (l) => l.target.y);
        nodeSel.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
        labelSel.attr("x", (d) => d.x + d.r + 2).attr("y", (d) => d.y);
      });

    function highlight({ guessId, ringIds, guessedIds }) {
      const ring = new Set(ringIds || []);
      const fillFor = (d) => {
        if (d.id === guessId) return "#9c2b21";
        if (ring.has(d.id)) return "#d1a530";
        if (guessedIds && guessedIds.has(d.id)) return "#8a7a62";
        return "#cbbd94";
      };
      const opacityFor = (d) => (guessId == null ? 1 : d.id === guessId || ring.has(d.id) ? 1 : 0.35);

      nodeSel
        .attr("fill", fillFor)
        .attr("r", (d) => (d.id === guessId ? d.r + 3 : ring.has(d.id) ? d.r + 1.5 : d.r))
        .attr("opacity", opacityFor);

      labelSel
        .attr("fill", (d) => (d.id === guessId ? "#9c2b21" : ring.has(d.id) ? "#8a6a1f" : "#4a4034"))
        .attr("font-weight", (d) => (d.id === guessId || ring.has(d.id) ? "bold" : "normal"))
        .attr("opacity", opacityFor);
    }

    return { highlight };
  }

  // ---------------------------------------------------------------
  // The manhunt game
  // ---------------------------------------------------------------
  function setupGame({ giant, byId, undirAdj, eccByNode, undirLinks, degree }) {
    const candidates = giant
      .map((id) => byId.get(id))
      .sort((a, b) => a.name.localeCompare(b.name));

    const nameToId = new Map(candidates.map((n) => [n.name.toLowerCase(), n.node_id]));

    const els = {
      input: document.getElementById("game-input"),
      suggestions: document.getElementById("game-suggestions"),
      guessBtn: document.getElementById("game-guess-btn"),
      hintBtn: document.getElementById("game-hint-btn"),
      newBtn: document.getElementById("game-new-btn"),
      error: document.getElementById("game-error"),
      log: document.getElementById("game-log"),
      bestLead: document.getElementById("best-lead"),
      mapWrap: document.getElementById("map-wrap"),
      candidatesLabel: document.getElementById("candidates-label"),
      candidatesList: document.getElementById("candidates-list"),
      winPanel: document.getElementById("win-panel"),
      winName: document.getElementById("win-name"),
      winDesc: document.getElementById("win-desc"),
      winTally: document.getElementById("win-tally"),
      winPath: document.getElementById("win-path"),
      shareBtn: document.getElementById("share-btn"),
      playAgainBtn: document.getElementById("play-again-btn"),
      dateLabel: document.getElementById("game-date"),
    };

    // giant-component-only subgraph for the investigation map (the only
    // characters that can ever be a guess or a target)
    const giantSet = new Set(giant);
    const mapNodeData = giant.map((id) => ({
      id,
      name: byId.get(id).name,
      r: Math.max(3, Math.min(14, 3 + Math.sqrt(degree.get(id)) * 1.5)),
    }));
    const mapLinkData = undirLinks
      .filter((l) => giantSet.has(l.source) && giantSet.has(l.target))
      .map((l) => ({ source: l.source, target: l.target }));
    const map = createInvestigationMap(document.getElementById("investigation-map"), mapNodeData, mapLinkData);

    [els.input, els.guessBtn, els.hintBtn, els.newBtn].forEach((e) => (e.disabled = false));

    const state = {
      targetId: null,
      bfs: null,
      maxDist: 1,
      guesses: [], // {id, name, dist}
      guessedIds: new Set(),
      hints: 0,
      selectedId: null,
      dailyMode: true,
    };

    function pickTarget(random) {
      const idx = random ? Math.floor(Math.random() * candidates.length) : dailySeedIndex(candidates.length);
      state.dailyMode = !random;
      state.targetId = candidates[idx].node_id;
      state.bfs = bfsFrom(state.targetId, undirAdj);
      state.maxDist = eccByNode.get(state.targetId) || Math.max(1, ...state.bfs.dist.values());
      state.guesses = [];
      state.guessedIds = new Set();
      state.hints = 0;
      state.selectedId = null;
      els.log.innerHTML = "";
      els.bestLead.style.display = "none";
      els.mapWrap.classList.remove("show");
      els.candidatesList.innerHTML = "";
      els.candidatesLabel.textContent = "";
      map.highlight({ guessId: null, ringIds: [], guessedIds: state.guessedIds });
      els.winPanel.classList.remove("show");
      els.error.textContent = "";
      els.input.value = "";
      els.input.disabled = false;
      els.guessBtn.disabled = false;
      els.hintBtn.disabled = false;
      els.input.focus();
      els.dateLabel.textContent = random
        ? "Random case"
        : "Today's case — " + new Date().toDateString();
    }

    function tempInfo(dist) {
      const t = state.maxDist > 0 ? dist / state.maxDist : 0;
      const hot = d3.color("#d84a2b");
      const cold = d3.color("#24425a");
      const color = d3.interpolateRgb(hot, cold)(t);
      let label;
      if (dist === 0) label = "FOUND!";
      else if (t <= 0.18) label = "Blazing";
      else if (t <= 0.38) label = "Hot";
      else if (t <= 0.58) label = "Warm";
      else if (t <= 0.78) label = "Cool";
      else if (t <= 0.92) label = "Cold";
      else label = "Freezing";
      return { color, label };
    }

    function renderSuggestions(query) {
      els.suggestions.innerHTML = "";
      if (!query) return;
      const q = query.toLowerCase();
      const matches = candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
      matches.forEach((m) => {
        const li = document.createElement("li");
        li.textContent = m.name;
        li.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          els.input.value = m.name;
          els.suggestions.innerHTML = "";
        });
        els.suggestions.appendChild(li);
      });
    }

    els.input.addEventListener("input", () => renderSuggestions(els.input.value));
    els.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        submitGuess();
      }
    });
    els.guessBtn.addEventListener("click", submitGuess);
    document.addEventListener("click", (ev) => {
      if (!els.suggestions.contains(ev.target) && ev.target !== els.input) els.suggestions.innerHTML = "";
    });

    function submitGuess() {
      const raw = els.input.value.trim();
      if (!raw) return;
      const id = nameToId.get(raw.toLowerCase());
      if (!id) {
        els.error.textContent = `"${raw}" isn't in the active case files — pick a name from the list.`;
        return;
      }
      if (state.guessedIds.has(id)) {
        els.error.textContent = "You've already questioned them.";
        return;
      }
      els.error.textContent = "";
      const dist = state.bfs.dist.get(id);
      const prevDist = state.guesses.length ? state.guesses[state.guesses.length - 1].dist : null;
      state.guesses.push({ id, name: byId.get(id).name, dist });
      state.guessedIds.add(id);
      els.suggestions.innerHTML = "";
      els.input.value = "";

      addLogRow(byId.get(id).name, dist, prevDist, state.guesses.length);
      updateBestLead();

      if (dist === 0) {
        winGame();
      } else {
        updateInvestigationMap(id, dist);
      }
    }

    function updateInvestigationMap(guessId, dist) {
      const { dist: distFromGuess } = bfsFrom(guessId, undirAdj);
      const ring = [];
      distFromGuess.forEach((d, nodeId) => {
        if (d === dist && nodeId !== guessId) ring.push(nodeId);
      });
      map.highlight({ guessId, ringIds: ring, guessedIds: state.guessedIds });
      els.mapWrap.classList.add("show");

      const unguessedRing = ring.filter((rid) => !state.guessedIds.has(rid));
      els.candidatesLabel.innerHTML = unguessedRing.length
        ? `${unguessedRing.length} character${unguessedRing.length === 1 ? "" : "s"} are exactly
          <b>${dist}</b> step${dist === 1 ? "" : "s"} from <b>${byId.get(guessId).name}</b> &mdash;
          the target is one of them:`
        : `Every character at that distance from ${byId.get(guessId).name} has already been questioned &mdash; try a different lead.`;

      els.candidatesList.innerHTML = "";
      unguessedRing
        .map((rid) => byId.get(rid))
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((n) => {
          const chip = document.createElement("span");
          chip.className = "candidate-chip";
          chip.textContent = n.name;
          chip.addEventListener("click", () => {
            els.input.value = n.name;
            submitGuess();
          });
          els.candidatesList.appendChild(chip);
        });
    }

    function addLogRow(name, dist, prevDist, idx) {
      const { color, label } = tempInfo(dist);
      let trend = "•";
      if (prevDist !== null) {
        if (dist < prevDist) trend = "▲";
        else if (dist > prevDist) trend = "▼";
      }
      const li = document.createElement("li");
      li.className = "log-row";
      li.innerHTML = `<span class="idx">${idx}.</span>
        <span>${name}</span>
        <span class="trend">${trend}</span>
        <span class="temp-badge" style="background:${color}">${dist === 0 ? "FOUND!" : label + " · " + dist}</span>`;
      els.log.prepend(li);
    }

    function updateBestLead() {
      const best = state.guesses.reduce((a, b) => (b.dist < a.dist ? b : a), state.guesses[0]);
      els.bestLead.style.display = "block";
      els.bestLead.innerHTML = `Closest lead so far: <b>${best.name}</b> at distance <b>${best.dist}</b>. ${
        best.dist === 0 ? "" : "Try characters likely to be near them in the wiki-link graph."
      }`;
    }

    els.hintBtn.addEventListener("click", () => {
      const nb = Array.from(undirAdj.get(state.targetId)).filter((id) => !state.guessedIds.has(id));
      if (!nb.length) {
        els.error.textContent = "No fresh leads left to follow.";
        return;
      }
      state.hints++;
      const pick = nb[Math.floor(Math.random() * nb.length)];
      els.error.textContent = "";
      els.bestLead.style.display = "block";
      const prevHtml = els.bestLead.innerHTML;
      els.bestLead.innerHTML = `<b>Lead:</b> an informant mentions <b>${byId.get(pick).name}</b> is directly connected to the target. (${state.hints} lead${state.hints > 1 ? "s" : ""} used.)`;
    });

    els.newBtn.addEventListener("click", () => pickTarget(true));
    els.playAgainBtn.addEventListener("click", () => pickTarget(true));

    function winGame() {
      els.input.disabled = true;
      els.guessBtn.disabled = true;
      els.hintBtn.disabled = true;
      const target = byId.get(state.targetId);
      els.winName.textContent = target.name;
      els.winDesc.textContent = target.description || "";
      els.winTally.textContent = `Solved in ${state.guesses.length} question${state.guesses.length === 1 ? "" : "s"}, ${state.hints} lead${state.hints === 1 ? "" : "s"} used.`;

      // reconstruct shortest path from the FIRST guess back to the target
      const first = state.guesses[0];
      const chain = [];
      let cur = first.id;
      const seenGuard = new Set();
      while (cur !== null && cur !== undefined && !seenGuard.has(cur)) {
        seenGuard.add(cur);
        chain.push(byId.get(cur).name);
        cur = state.bfs.parent.get(cur);
      }
      els.winPath.innerHTML = chain
        .map((n, i) => `<span class="node">${n}</span>` + (i < chain.length - 1 ? '<span class="arrow">&rarr;</span>' : ""))
        .join("");

      els.winPanel.classList.add("show");
      els.winPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    els.shareBtn.addEventListener("click", () => {
      const squares = state.guesses
        .map((g) => {
          const t = state.maxDist > 0 ? g.dist / state.maxDist : 0;
          if (g.dist === 0) return "🟩";
          if (t <= 0.35) return "🟧";
          if (t <= 0.7) return "🟨";
          return "🟦";
        })
        .join("");
      const text = `THE WIKI-LINK FILES — Case No. 01\n${squares}\nSolved in ${state.guesses.length} questions, ${state.hints} leads.`;
      navigator.clipboard?.writeText(text).then(
        () => {
          els.shareBtn.textContent = "Copied!";
          setTimeout(() => (els.shareBtn.textContent = "Copy case summary"), 1500);
        },
        () => {}
      );
    });

    pickTarget(false);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
