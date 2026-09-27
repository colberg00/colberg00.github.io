/* ============================================================
   Case No. 04 — Conflicting Testimony
   AGENCY TOOLKIT // CROSS-EXAMINATION UNIT v1.0

   Four ways of asking the philosophers wiki-link network who its
   factions really are, and four not-quite-matching answers: Louvain
   against Infomap, one philosopher held by several traditions at
   once, weighted links against unweighted ones, and a backbone that
   comes apart one bridge at a time. Everything below runs live in
   the browser from the same TSVs; Infomap and the k-clique scan are
   the two steps too heavy to repeat on every page load, so those are
   precomputed by tools/build_week4_analysis.py and just loaded here.

   Pure vanilla JS + D3 (loaded globally as `d3`).
   ============================================================ */
(function () {
  "use strict";

  const NODES_URL = "../week4_philosophers_nodes.tsv";
  const EDGES_URL = "../week4_philosophers_edges.tsv";
  const COMMUNITIES_URL = "../week4_communities.tsv";
  const KCLIQUE_URL = "../week4_kclique_aristotle.json";
  const MEMBERSHIP_URL = "../week4_kclique_membership.tsv";

  // evidence-board palette — enough distinct pins for any community count
  // this page actually uses (Louvain tops out at 10, a k-clique ego view at 7)
  const PALETTE = [
    "#9c2b21", "#2f5e6b", "#a9822f", "#5c7a44", "#6b4c7a",
    "#b3663c", "#3c6b8a", "#8a4b6b", "#4a7a5c", "#7a5c2f",
    "#556b8a", "#8a2f4b",
  ];
  const NEUTRAL = "#b7a377";

  // ---------------------------------------------------------------
  // Loading & parsing
  // ---------------------------------------------------------------
  async function loadTSV(url) {
    const text = await d3.text(url);
    const cleaned = text
      .split(/\r?\n/)
      .filter((l) => l.length && !l.startsWith("#"))
      .join("\n");
    return d3.tsvParse(cleaned);
  }

  // ---------------------------------------------------------------
  // Graph building — undirected, weight = sum of both directions
  // ---------------------------------------------------------------
  function buildGraph(nodeRows, edgeRows) {
    const ids = nodeRows.map((d) => d.node_id);
    const index = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length;
    const wAdj = Array.from({ length: n }, () => new Map());
    edgeRows.forEach((r) => {
      const a = index.get(r.source);
      const b = index.get(r.target);
      if (a == null || b == null || a === b) return;
      const w = +r.weight;
      wAdj[a].set(b, (wAdj[a].get(b) || 0) + w);
      wAdj[b].set(a, (wAdj[b].get(a) || 0) + w);
    });
    const uAdj = wAdj.map((m) => Array.from(m.keys()));
    const strength = wAdj.map((m) => Array.from(m.values()).reduce((s, x) => s + x, 0));
    const degree = uAdj.map((a) => a.length);
    return { ids, index, wAdj, uAdj, strength, degree, n, nodeRows };
  }

  function components(uAdj) {
    const n = uAdj.length;
    const comp = new Int32Array(n).fill(-1);
    const comps = [];
    for (let s = 0; s < n; s++) {
      if (comp[s] !== -1) continue;
      const members = [s];
      comp[s] = comps.length;
      for (let qi = 0; qi < members.length; qi++) {
        const v = members[qi];
        for (const w of uAdj[v]) {
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

  // ---------------------------------------------------------------
  // Normalised mutual information: 2*I(A;B) / (H(A)+H(B))
  // ---------------------------------------------------------------
  function nmi(labelsA, labelsB) {
    const n = labelsA.length;
    const ca = new Map();
    const cb = new Map();
    const joint = new Map(); // a -> Map(b -> count)
    for (let i = 0; i < n; i++) {
      const a = labelsA[i];
      const b = labelsB[i];
      ca.set(a, (ca.get(a) || 0) + 1);
      cb.set(b, (cb.get(b) || 0) + 1);
      if (!joint.has(a)) joint.set(a, new Map());
      const m = joint.get(a);
      m.set(b, (m.get(b) || 0) + 1);
    }
    const H = (counter) => {
      let h = 0;
      for (const c of counter.values()) {
        const p = c / n;
        h -= p * Math.log(p);
      }
      return h;
    };
    const Ha = H(ca);
    const Hb = H(cb);
    let I = 0;
    for (const [a, m] of joint) {
      for (const [b, c] of m) {
        const pab = c / n;
        const pa = ca.get(a) / n;
        const pb = cb.get(b) / n;
        I += pab * Math.log(pab / (pa * pb));
      }
    }
    if (Ha + Hb === 0) return 1;
    return (2 * I) / (Ha + Hb);
  }

  // best-overlap alignment from partition A's labels onto partition B's —
  // "if this Louvain community were one Infomap module, which one?"
  function bestAlignment(labelsA, labelsB) {
    const overlap = new Map();
    for (let i = 0; i < labelsA.length; i++) {
      const a = labelsA[i];
      const b = labelsB[i];
      if (!overlap.has(a)) overlap.set(a, new Map());
      const m = overlap.get(a);
      m.set(b, (m.get(b) || 0) + 1);
    }
    const bestMap = new Map();
    for (const [a, m] of overlap) {
      let bestB = null;
      let bestC = -1;
      for (const [b, c] of m) {
        if (c > bestC) {
          bestC = c;
          bestB = b;
        }
      }
      bestMap.set(a, bestB);
    }
    return bestMap;
  }

  function flowCounts(labelsA, labelsB) {
    const m = new Map(); // "a|b" -> count
    for (let i = 0; i < labelsA.length; i++) {
      const key = labelsA[i] + "|" + labelsB[i];
      m.set(key, (m.get(key) || 0) + 1);
    }
    const flows = [];
    for (const [key, count] of m) {
      const [a, b] = key.split("|");
      flows.push({ a, b, count });
    }
    return flows;
  }

  // ---------------------------------------------------------------
  // Disparity filter (Serrano, Boguna & Vespignani 2009)
  // ---------------------------------------------------------------
  function edgeAlpha(g, u, v, w) {
    const ku = g.degree[u];
    const kv = g.degree[v];
    const au = ku <= 1 ? 0 : Math.pow(1 - w / g.strength[u], ku - 1);
    const av = kv <= 1 ? 0 : Math.pow(1 - w / g.strength[v], kv - 1);
    return Math.min(au, av); // significant (kept) at either end
  }

  function allEdgesWithAlpha(g) {
    const edges = [];
    for (let u = 0; u < g.n; u++) {
      for (const [v, w] of g.wAdj[u]) {
        if (v <= u) continue;
        edges.push({ u, v, w, alpha: edgeAlpha(g, u, v, w) });
      }
    }
    edges.sort((a, b) => a.alpha - b.alpha);
    return edges;
  }

  // one merge event per edge addition, in ascending-alpha (most significant
  // first) order — the union-find equivalent of building the backbone up
  // from nothing; reading it backwards is the backbone coming apart
  function backboneEvents(g, sortedEdges) {
    const parent = new Int32Array(g.n);
    const size = new Int32Array(g.n).fill(1);
    for (let i = 0; i < g.n; i++) parent[i] = i;
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    const events = [];
    for (const e of sortedEdges) {
      let ru = find(e.u);
      let rv = find(e.v);
      if (ru === rv) continue;
      const su = size[ru];
      const sv = size[rv];
      events.push({ ...e, minSize: Math.min(su, sv), sizeU: su, sizeV: sv });
      if (su < sv) { const t = ru; ru = rv; rv = t; }
      parent[rv] = ru;
      size[ru] += size[rv];
    }
    return events;
  }

  // backbone at threshold: keep edges with alpha < threshold (sortedEdges is ascending)
  function backboneAtAlpha(g, sortedEdges, threshold) {
    const parent = new Int32Array(g.n);
    const size = new Int32Array(g.n).fill(1);
    for (let i = 0; i < g.n; i++) parent[i] = i;
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    const kept = [];
    for (const e of sortedEdges) {
      if (e.alpha >= threshold) break;
      kept.push(e);
      let ru = find(e.u);
      let rv = find(e.v);
      if (ru === rv) continue;
      const su = size[ru];
      const sv = size[rv];
      if (su < sv) { const t = ru; ru = rv; rv = t; }
      parent[rv] = ru;
      size[ru] += size[rv];
    }
    let best = -1;
    let bestSize = 0;
    for (let i = 0; i < g.n; i++) {
      if (find(i) === i && size[i] > bestSize) {
        bestSize = size[i];
        best = i;
      }
    }
    const giantIdx = new Set();
    if (best !== -1) {
      for (let i = 0; i < g.n; i++) if (find(i) === best) giantIdx.add(i);
    }
    return { kept, giantSize: bestSize, giantIdx };
  }

  // ---------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------
  function svgRoot(el, w, h) {
    d3.select(el).selectAll("*").remove();
    return d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", "100%").attr("height", h);
  }
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  function setHTML(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }
  function fmtPct(x) {
    return (100 * x).toFixed(1) + "%";
  }
  function shortName(name) {
    return name.length > 26 ? name.slice(0, 24) + "…" : name;
  }

  // ---------------------------------------------------------------
  // Force-directed network (generic; used for the ego view and the backbone)
  // ---------------------------------------------------------------
  function drawNetwork(el, opts) {
    const width = opts.width || 640;
    const height = opts.height || 460;
    const svg = svgRoot(el, width, height);
    const zoomLayer = svg.append("g");
    svg.call(d3.zoom().scaleExtent([0.25, 8]).on("zoom", (e) => zoomLayer.attr("transform", e.transform)));

    const nodes = opts.nodes;
    const links = opts.links;

    const linkSel = zoomLayer
      .append("g")
      .attr("stroke", NEUTRAL)
      .attr("stroke-opacity", 0.4)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", (d) => d.width || 0.8);

    const nodeG = zoomLayer
      .append("g")
      .selectAll("g.wlf4-node")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "wlf4-node")
      .style("cursor", "pointer");

    nodeG.each(function (d) {
      const g = d3.select(this);
      const r = d.r || 6;
      const slices = d.slices && d.slices.length ? d.slices : [d.color || NEUTRAL];
      const arc = d3.arc().innerRadius(0).outerRadius(r);
      const pieData = d3.pie().sort(null)(slices.map(() => 1));
      g.selectAll("path")
        .data(pieData)
        .join("path")
        .attr("d", arc)
        .attr("fill", (p, i) => slices[i])
        .attr("stroke", d.stroke || "#2b2622")
        .attr("stroke-width", d.strokeWidth != null ? d.strokeWidth : 0.5);
      if (d.halo) {
        g.insert("circle", ":first-child")
          .attr("class", "wlf4-halo")
          .attr("r", r + 3)
          .attr("fill", "none")
          .attr("stroke", d.haloColor || "#a9822f")
          .attr("stroke-width", 1.4);
      }
    });

    nodeG.append("title").text((d) => d.title || d.name || d.id);

    let labelSel = null;
    if (opts.labelIds && opts.labelIds.size) {
      labelSel = zoomLayer
        .append("g")
        .attr("font-family", "Courier Prime, monospace")
        .attr("font-size", 9)
        .attr("fill", "var(--ink)")
        .style("pointer-events", "none")
        .selectAll("text")
        .data(nodes.filter((d) => opts.labelIds.has(d.id)))
        .join("text")
        .attr("dy", "0.32em")
        .text((d) => shortName(d.name || d.id));
    }

    const sim = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3.forceLink(links).id((d) => d.id).distance(opts.linkDistance || 22).strength(opts.linkStrength || 0.25)
      )
      .force("charge", d3.forceManyBody().strength(opts.charge || -30))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius((d) => (d.r || 6) + 2))
      .on("tick", () => {
        linkSel
          .attr("x1", (l) => l.source.x)
          .attr("y1", (l) => l.source.y)
          .attr("x2", (l) => l.target.x)
          .attr("y2", (l) => l.target.y);
        nodeG.attr("transform", (d) => `translate(${d.x},${d.y})`);
        if (labelSel) labelSel.attr("x", (d) => d.x + (d.r || 6) + 3).attr("y", (d) => d.y);
      });

    for (let i = 0; i < (opts.warmIterations || 120); i++) sim.tick();
    sim.alpha(0.6).restart();

    nodeG.call(
      d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.2).restart();
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
        })
    );

    if (opts.onNodeClick) nodeG.on("click", (event, d) => { event.stopPropagation(); opts.onNodeClick(d); });

    return { svg, sim, nodeG, linkSel };
  }

  // ---------------------------------------------------------------
  // Alluvial diagram — two columns of stacked bars joined by ribbons
  // ---------------------------------------------------------------
  function drawAlluvial(el, opts) {
    const width = opts.width || 640;
    const height = opts.height || 420;
    const margin = { top: 16, bottom: 16, left: 90, right: 90 };
    const innerH = height - margin.top - margin.bottom;
    const svg = svgRoot(el, width, height);

    const leftGroups = opts.leftGroups; // [{id,size,color,label}]
    const rightGroups = opts.rightGroups; // [{id,size,label}]
    const flows = opts.flows; // [{a,b,count}]
    const total = d3.sum(leftGroups, (d) => d.size);
    const scale = innerH / total;
    const barW = 16;
    const xL = margin.left;
    const xR = width - margin.right - barW;

    const leftY0 = new Map();
    let cursor = margin.top;
    leftGroups.forEach((g) => {
      leftY0.set(g.id, cursor);
      cursor += g.size * scale;
    });
    const rightY0 = new Map();
    cursor = margin.top;
    rightGroups.forEach((g) => {
      rightY0.set(g.id, cursor);
      cursor += g.size * scale;
    });

    // stack flows within each side, in the order of the other side's groups
    const rightOrder = new Map(rightGroups.map((g, i) => [g.id, i]));
    const leftOrder = new Map(leftGroups.map((g, i) => [g.id, i]));
    const byLeft = d3.group(flows, (f) => f.a);
    const leftCursor = new Map(leftGroups.map((g) => [g.id, leftY0.get(g.id)]));
    for (const [a, fs] of byLeft) {
      fs.sort((x, y) => rightOrder.get(x.b) - rightOrder.get(y.b));
      for (const f of fs) {
        f.ly0 = leftCursor.get(a);
        f.ly1 = f.ly0 + f.count * scale;
        leftCursor.set(a, f.ly1);
      }
    }
    const byRight = d3.group(flows, (f) => f.b);
    const rightCursor = new Map(rightGroups.map((g) => [g.id, rightY0.get(g.id)]));
    for (const [b, fs] of byRight) {
      fs.sort((x, y) => leftOrder.get(x.a) - leftOrder.get(y.a));
      for (const f of fs) {
        f.ry0 = rightCursor.get(b);
        f.ry1 = f.ry0 + f.count * scale;
        rightCursor.set(b, f.ry1);
      }
    }

    const g = svg.append("g");
    const ribbons = g.append("g").attr("fill-opacity", 0.55);
    const leftColor = new Map(leftGroups.map((d) => [d.id, d.color]));

    function ribbonPath(f) {
      const x0 = xL + barW;
      const x1 = xR;
      const xm = (x0 + x1) / 2;
      return `M${x0},${f.ly0} C${xm},${f.ly0} ${xm},${f.ry0} ${x1},${f.ry0} L${x1},${f.ry1} C${xm},${f.ry1} ${xm},${f.ly1} ${x0},${f.ly1} Z`;
    }

    const ribbonSel = ribbons
      .selectAll("path")
      .data(flows)
      .join("path")
      .attr("d", ribbonPath)
      .attr("fill", (d) => leftColor.get(d.a))
      .attr("stroke", "none")
      .style("cursor", "default");

    ribbonSel.append("title").text((d) => `${opts.leftName(d.a)} ↔ ${opts.rightName(d.b)}: ${d.count}`);
    ribbonSel
      .on("mouseenter", function () { d3.select(this).attr("fill-opacity", 0.9); })
      .on("mouseleave", function () { d3.select(this).attr("fill-opacity", 0.55); });

    g.append("g")
      .selectAll("rect")
      .data(leftGroups)
      .join("rect")
      .attr("x", xL)
      .attr("y", (d) => leftY0.get(d.id))
      .attr("width", barW)
      .attr("height", (d) => d.size * scale)
      .attr("fill", (d) => d.color)
      .attr("stroke", "#2b2622")
      .attr("stroke-width", 0.6)
      .append("title")
      .text((d) => `${d.label}: ${d.size}`);

    g.append("g")
      .selectAll("rect")
      .data(rightGroups)
      .join("rect")
      .attr("x", xR)
      .attr("y", (d) => rightY0.get(d.id))
      .attr("width", barW)
      .attr("height", (d) => d.size * scale)
      .attr("fill", opts.rightColor || "#8a7a62")
      .attr("stroke", "#2b2622")
      .attr("stroke-width", 0.6)
      .append("title")
      .text((d) => `${d.label}: ${d.size}`);

    g.append("g")
      .selectAll("text")
      .data(leftGroups.filter((d) => d.size * scale > 10))
      .join("text")
      .attr("x", xL - 6)
      .attr("y", (d) => leftY0.get(d.id) + (d.size * scale) / 2)
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .attr("font-family", "Courier Prime, monospace")
      .attr("font-size", 10)
      .attr("fill", "var(--ink)")
      .text((d) => d.label);

    if (opts.rightLabels) {
      g.append("g")
        .selectAll("text")
        .data(rightGroups.filter((d) => d.size * scale > 14))
        .join("text")
        .attr("x", xR + barW + 6)
        .attr("y", (d) => rightY0.get(d.id) + (d.size * scale) / 2)
        .attr("dy", "0.32em")
        .attr("font-family", "Courier Prime, monospace")
        .attr("font-size", 9)
        .attr("fill", "var(--ink-faint)")
        .text((d) => d.label);
    }

    g.append("text").attr("x", xL).attr("y", margin.top - 6).attr("font-family", "Special Elite, monospace").attr("font-size", 11).attr("fill", "var(--ink-faint)").text(opts.leftTitle || "");
    g.append("text").attr("x", xR).attr("y", margin.top - 6).attr("font-family", "Special Elite, monospace").attr("font-size", 11).attr("fill", "var(--ink-faint)").text(opts.rightTitle || "");
  }

  // ---------------------------------------------------------------
  // Data table (reused look from Case No. 03)
  // ---------------------------------------------------------------
  function renderTable(el, columns, rows) {
    const table = document.getElementById(el);
    if (!table) return;
    const thead = "<thead><tr>" + columns.map((c) => `<th>${c.label}</th>`).join("") + "</tr></thead>";
    const tbody =
      "<tbody>" +
      rows
        .map((r) => "<tr>" + columns.map((c) => `<td${c.cls ? ` class="${c.cls(r)}"` : ""}>${c.get(r)}</td>`).join("") + "</tr>")
        .join("") +
      "</tbody>";
    table.innerHTML = thead + tbody;
  }

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  const STATE = {};

  async function init() {
    const [nodeRows, edgeRows, commRows, kclique, memRows] = await Promise.all([
      loadTSV(NODES_URL),
      loadTSV(EDGES_URL),
      loadTSV(COMMUNITIES_URL),
      d3.json(KCLIQUE_URL),
      loadTSV(MEMBERSHIP_URL),
    ]);

    const g = buildGraph(nodeRows, edgeRows);
    const comps = components(g.uAdj);
    const giant = comps[0];
    const giantSet = new Set(giant);

    const nameOf = new Map(nodeRows.map((r) => [r.node_id, r.name]));
    const eraOf = new Map(nodeRows.map((r) => [r.node_id, r.era]));

    const commByNode = new Map(commRows.map((r) => [r.node_id, r]));
    const memByNode = new Map(memRows.map((r) => [r.node_id, r]));

    STATE.g = g;
    STATE.giant = giant;
    STATE.giantSet = giantSet;
    STATE.nameOf = nameOf;
    STATE.eraOf = eraOf;
    STATE.commByNode = commByNode;
    STATE.memByNode = memByNode;
    STATE.kclique = kclique;

    renderBriefing(g, giant, commRows);
    renderSection1(g, giant, commByNode, eraOf, nameOf);
    renderSection2(kclique, memRows, nameOf, eraOf);
    renderSection3(g, giant, commByNode, nameOf);
    renderSection4(g, giant, commByNode, nameOf);
  }

  // ---------------------------------------------------------------
  // Briefing stats
  // ---------------------------------------------------------------
  function renderBriefing(g, giant, commRows) {
    setText("stat-nodes", g.n.toLocaleString());
    const uniqueEdges = g.uAdj.reduce((s, a) => s + a.length, 0) / 2;
    setText("stat-edges", uniqueEdges.toLocaleString());
    setText("stat-gc", giant.length.toLocaleString());
    setText("stat-gc-pct", fmtPct(giant.length / g.n));
    const withInfo = commRows.filter((r) => r.infomap !== "");
    setText("stat-louvain-u", new Set(commRows.map((r) => r.louvain_u)).size);
    setText("stat-louvain-w", new Set(commRows.map((r) => r.louvain_w)).size);
    setText("stat-infomap", new Set(withInfo.map((r) => r.infomap)).size);
  }

  // ---------------------------------------------------------------
  // Section I — Louvain vs Infomap
  // ---------------------------------------------------------------
  function renderSection1(g, giant, commByNode, eraOf, nameOf) {
    const rows = giant.map((idx) => commByNode.get(g.ids[idx])).filter(Boolean);
    const ids = giant.filter((idx) => commByNode.has(g.ids[idx])).map((idx) => g.ids[idx]);
    const lu = rows.map((r) => r.louvain_u);
    const im = rows.map((r) => r.infomap);
    const era = ids.map((id) => eraOf.get(id));

    const v_lu_im = nmi(lu, im);
    const v_lu_era = nmi(lu, era);
    const v_im_era = nmi(im, era);

    setText("nmi-lu-im", v_lu_im.toFixed(3));
    setText("nmi-lu-era", v_lu_era.toFixed(3));
    setText("nmi-im-era", v_im_era.toFixed(3));

    // community size + ordering (already size-ranked 0..k-1 by the precompute script)
    const luIds = Array.from(new Set(lu)).sort((a, b) => +a - +b);
    const imIds = Array.from(new Set(im)).sort((a, b) => +a - +b);
    const luSize = new Map(luIds.map((id) => [id, lu.filter((x) => x === id).length]));
    const imSize = new Map(imIds.map((id) => [id, im.filter((x) => x === id).length]));

    const leftGroups = luIds.map((id, i) => ({ id, size: luSize.get(id), color: PALETTE[i % PALETTE.length], label: `L${+id + 1}` }));
    const rightGroups = imIds.map((id) => ({ id, size: imSize.get(id), label: `I${+id + 1}` }));
    const flows = flowCounts(lu, im);

    drawAlluvial("#chart-alluvial-1", {
      width: 680,
      height: 460,
      leftGroups,
      rightGroups,
      flows,
      leftTitle: "LOUVAIN",
      rightTitle: "INFOMAP",
      leftName: (id) => `Louvain group L${+id + 1} (${luSize.get(id)})`,
      rightName: (id) => `Infomap module I${+id + 1} (${imSize.get(id)})`,
      rightLabels: false,
    });

    // five highest-degree members of each Louvain community, for naming them
    const byCommunity = new Map();
    giant.forEach((idx) => {
      const id = g.ids[idx];
      const r = commByNode.get(id);
      if (!r) return;
      if (!byCommunity.has(r.louvain_u)) byCommunity.set(r.louvain_u, []);
      byCommunity.get(r.louvain_u).push({ id, name: nameOf.get(id), degree: g.degree[idx] });
    });
    const rowsOut = luIds.map((id) => {
      const members = byCommunity.get(id) || [];
      members.sort((a, b) => b.degree - a.degree);
      return { id, size: luSize.get(id), top: members.slice(0, 5).map((m) => m.name).join(", ") };
    });
    rowsOut.sort((a, b) => b.size - a.size);
    renderTable("louvain-naming", [
      { label: "Group", get: (r) => `L${+r.id + 1}`, cls: () => "" },
      { label: "Size", get: (r) => r.size },
      { label: "Five highest-degree members", get: (r) => r.top },
    ], rowsOut);

    setText(
      "finding-lu-im",
      `Louvain settles on ${luIds.length} broad factions; Infomap, run on the same undirected unweighted graph, ` +
        `splits the same 1,374 philosophers into ${imIds.length} much smaller modules. NMI between them is ${v_lu_im.toFixed(2)} — ` +
        `real agreement, not chance, but far from a rubber stamp. Against the one external check the data gives us for free, ` +
        `the century each philosopher is filed under, Louvain edges out Infomap (NMI ${v_lu_era.toFixed(2)} vs ${v_im_era.toFixed(2)}), ` +
        `though the gap is too small to call a verdict. What the alluvial figure actually shows is more useful than either number: ` +
        `most Louvain factions don't fragment evenly across Infomap's modules, they pour almost entirely into two or three of them, which ` +
        `is what real, nested structure looks like when a coarse method and a fine one both see it.`
    );
  }

  // ---------------------------------------------------------------
  // Section II — Aristotle and the k-clique communities
  // ---------------------------------------------------------------
  function renderSection2(kclique, memRows, nameOf, eraOf) {
    memRows.sort((a, b) => +b.k7_n - +a.k7_n);
    const top10 = memRows.slice(0, 10).map((r) => ({
      name: nameOf.get(r.node_id) || r.node_id,
      k6: r.k6_n,
      k7: r.k7_n,
      isAristotle: r.node_id === "Aristotle",
    }));
    renderTable("overlap-leaderboard", [
      { label: "Philosopher", get: (r) => (r.isAristotle ? `<strong>${r.name}</strong>` : r.name) },
      { label: "k=6 communities", get: (r) => r.k6 },
      { label: "k=7 communities", get: (r) => r.k7, cls: (r) => (r.isAristotle ? "odd-one" : "") },
    ], top10);

    const aristRank = memRows.findIndex((r) => r.node_id === "Aristotle") + 1;
    setText("aristotle-rank", aristRank);
    setText("aristotle-k7", kclique.k7.aristotle_in_n_communities);
    setText("aristotle-k6", kclique.k6.aristotle_in_n_communities);
    setText("leader-name", top10[0].name);
    setText("leader-k7", top10[0].k7);

    let currentK = "k7";
    function drawEgo(k) {
      currentK = k;
      const data = kclique[k];
      const communities = data.communities; // already sorted by size desc
      const colorOf = new Map();
      communities.forEach((c, i) => {
        c.members.forEach((m) => {
          if (!colorOf.has(m)) colorOf.set(m, []);
          colorOf.get(m).push(PALETTE[i % PALETTE.length]);
        });
      });
      const sub = data.ego_subgraph;
      const nodes = sub.nodes.map((id) => {
        const slices = colorOf.get(id) || [NEUTRAL];
        const isArist = id === "Aristotle";
        return {
          id,
          name: nameOf.get(id) || id,
          title: `${nameOf.get(id) || id} — ${slices.length} of ${communities.length} communities`,
          slices,
          r: isArist ? 14 : 4 + Math.min(slices.length, 6) * 1.6,
          halo: isArist,
          haloColor: "#a9822f",
          strokeWidth: isArist ? 1.6 : 0.5,
        };
      });
      const links = sub.edges.map(([a, b]) => ({ source: a, target: b }));
      const multiIds = new Set(
        nodes.filter((n) => n.slices.length >= 3 || n.id === "Aristotle").map((n) => n.id)
      );
      drawNetwork("#chart-ego", {
        width: 680,
        height: 480,
        nodes,
        links,
        labelIds: multiIds,
        linkDistance: 18,
        linkStrength: 0.2,
        charge: -22,
        warmIterations: 160,
      });
      setText("ego-caption", `k=${k.slice(1)} clique communities — ${sub.nodes.length} philosophers, Aristotle in ${communities.length} of them at once`);
    }
    drawEgo("k7");

    document.querySelectorAll("#ego-toggle .toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#ego-toggle .toggle-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        drawEgo(btn.dataset.k);
      });
    });

    // search tool
    const input = document.getElementById("overlap-input");
    const list = document.getElementById("overlap-options");
    const memMap = new Map(memRows.map((r) => [r.node_id, r]));
    if (list) {
      list.innerHTML = memRows.map((r) => `<option value="${(nameOf.get(r.node_id) || r.node_id).replace(/"/g, "&quot;")}">`).join("");
    }
    function lookup() {
      const q = (input.value || "").trim().toLowerCase();
      if (!q) return;
      let hit = memRows.find((r) => (nameOf.get(r.node_id) || "").toLowerCase() === q);
      if (!hit) hit = memRows.find((r) => (nameOf.get(r.node_id) || "").toLowerCase().includes(q));
      const out = document.getElementById("overlap-result");
      if (!hit) {
        out.textContent = `No philosopher matching "${input.value}" in the giant component.`;
        return;
      }
      const name = nameOf.get(hit.node_id) || hit.node_id;
      const rank = memRows.indexOf(hit) + 1;
      out.innerHTML = `<strong>${name}</strong> belongs to <strong>${hit.k7_n}</strong> k=7 clique-communities (<strong>${hit.k6_n}</strong> at k=6) — rank ${rank} of ${memRows.length} in the giant component.`;
    }
    document.getElementById("overlap-go")?.addEventListener("click", lookup);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
  }

  // ---------------------------------------------------------------
  // Section III — weighted vs unweighted Louvain
  // ---------------------------------------------------------------
  function renderSection3(g, giant, commByNode, nameOf) {
    const rows = giant.map((idx) => ({ idx, id: g.ids[idx], r: commByNode.get(g.ids[idx]) })).filter((x) => x.r);
    const lu = rows.map((x) => x.r.louvain_u);
    const lw = rows.map((x) => x.r.louvain_w);
    const v = nmi(lu, lw);
    setText("nmi-lu-lw", v.toFixed(3));

    const bestAtoB = bestAlignment(lu, lw);
    const movers = rows.filter((x) => bestAtoB.get(x.r.louvain_u) !== x.r.louvain_w);
    setText("stat-movers", movers.length);
    setText("stat-movers-pct", fmtPct(movers.length / rows.length));

    movers.sort((a, b) => g.strength[b.idx] - g.strength[a.idx]);
    const top = movers.slice(0, 12).map((x) => ({
      name: nameOf.get(x.id),
      from: `L${+x.r.louvain_u + 1}`,
      to: `W${+x.r.louvain_w + 1}`,
      strength: Math.round(g.strength[x.idx]),
    }));
    renderTable("movers-table", [
      { label: "Philosopher", get: (r) => r.name },
      { label: "Unweighted group", get: (r) => r.from },
      { label: "Weighted group", get: (r) => r.to, cls: () => "move-down" },
      { label: "Strength", get: (r) => r.strength },
    ], top);

    const luIds = Array.from(new Set(lu)).sort((a, b) => +a - +b);
    const lwIds = Array.from(new Set(lw)).sort((a, b) => +a - +b);
    const luSize = new Map(luIds.map((id) => [id, lu.filter((x) => x === id).length]));
    const lwSize = new Map(lwIds.map((id) => [id, lw.filter((x) => x === id).length]));
    const leftGroups = luIds.map((id, i) => ({ id, size: luSize.get(id), color: PALETTE[i % PALETTE.length], label: `L${+id + 1}` }));
    const rightGroups = lwIds.map((id) => ({ id, size: lwSize.get(id), label: `W${+id + 1}` }));
    const flows = flowCounts(lu, lw);
    drawAlluvial("#chart-alluvial-2", {
      width: 680,
      height: 380,
      leftGroups,
      rightGroups,
      flows,
      leftTitle: "UNWEIGHTED",
      rightTitle: "WEIGHTED",
      leftName: (id) => `Unweighted group L${+id + 1} (${luSize.get(id)})`,
      rightName: (id) => `Weighted group W${+id + 1} (${lwSize.get(id)})`,
      rightLabels: false,
    });
  }

  // ---------------------------------------------------------------
  // Section IV — the backbone
  // ---------------------------------------------------------------
  function renderSection4(g, giant, commByNode, nameOf) {
    const sortedEdges = allEdgesWithAlpha(g);
    const events = backboneEvents(g, sortedEdges);
    events.sort((a, b) => b.minSize - a.minSize);
    const top = events.slice(0, 6);
    STATE.backboneTop = top;
    STATE.backboneSorted = sortedEdges;

    renderTable("bridge-table", [
      { label: "Philosopher", get: (r) => nameOf.get(g.ids[r.u]) },
      { label: "Philosopher", get: (r) => nameOf.get(g.ids[r.v]) },
      { label: "α", get: (r) => r.alpha.toFixed(4) },
      { label: "Joins pieces of", get: (r) => `${r.sizeU} & ${r.sizeV}` },
    ], top);

    const headline = top[0];
    setText("bridge-a", nameOf.get(g.ids[headline.u]));
    setText("bridge-b", nameOf.get(g.ids[headline.v]));
    setText("bridge-alpha", headline.alpha.toFixed(3));
    setText("bridge-sizes", `${headline.sizeU} and ${headline.sizeV}`);

    const luColor = new Map();
    giant.forEach((idx) => {
      const r = commByNode.get(g.ids[idx]);
      if (r) luColor.set(idx, PALETTE[(+r.louvain_u) % PALETTE.length]);
    });

    function draw(threshold) {
      const { kept, giantSize, giantIdx } = backboneAtAlpha(g, sortedEdges, threshold);
      const involved = new Set();
      kept.forEach((e) => { involved.add(e.u); involved.add(e.v); });
      const nodes = Array.from(involved).map((idx) => ({
        id: idx,
        name: nameOf.get(g.ids[idx]),
        title: `${nameOf.get(g.ids[idx])} — strength ${Math.round(g.strength[idx])}`,
        r: giantIdx.has(idx) ? 3.2 : 2.4,
        slices: [luColor.get(idx) || NEUTRAL],
        strokeWidth: 0.3,
      }));
      const links = kept.map((e) => ({ source: e.u, target: e.v, width: 0.6 }));
      const topDegree = nodes.slice().sort((a, b) => g.degree[b.id] - g.degree[a.id]).slice(0, 8);
      drawNetwork("#chart-backbone", {
        width: 680,
        height: 440,
        nodes,
        links,
        labelIds: new Set(topDegree.map((d) => d.id)),
        linkDistance: 12,
        linkStrength: 0.3,
        charge: -14,
        warmIterations: 140,
      });
      setText("backbone-alpha-val", threshold.toFixed(3));
      setText("backbone-edges", kept.length.toLocaleString());
      setText("backbone-giant", giantSize.toLocaleString());
      setText("backbone-giant-pct", fmtPct(giantSize / giant.length));
    }

    draw(0.35);

    const slider = document.getElementById("alpha-slider");
    if (slider) {
      slider.addEventListener("input", () => draw(+slider.value));
    }
    document.querySelectorAll("#alpha-presets .toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#alpha-presets .toggle-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const a = +btn.dataset.alpha;
        if (slider) {
          slider.value = a;
          slider.dispatchEvent(new Event("input"));
        }
        draw(a);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => {
      console.error(err);
      const board = document.querySelector(".wlf-main");
      if (board) {
        const note = document.createElement("p");
        note.style.color = "var(--red)";
        note.textContent = "Case data failed to load: " + err.message;
        board.prepend(note);
      }
    });
  });
})();
