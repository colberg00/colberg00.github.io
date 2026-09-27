#!/usr/bin/env python3
"""Builds the precomputed community/backbone data behind Case No. 04.

Everything that's cheap enough to run in a browser (the disparity filter
sweep, NMI between two already-loaded partitions) happens live in week4.js
instead. This script only does the three things that aren't:

  1. Infomap needs the compiled `infomap` package, no JS equivalent exists.
  2. Louvain (unweighted and weighted) is run here too so the two partitions
     ship pre-aligned and relabelled by size, instead of re-running Louvain
     twice client-side with all the seed-order fuss that implies.
  3. k-clique communities (k=3, k=4) are O(2^k)-ish over 11k edges; cheap
     once, worth avoiding on every page load.

Run:
    python3 tools/build_week4_analysis.py

Reads week4_philosophers_edges.tsv / week4_philosophers_nodes.tsv from the
repo root, writes:
    week4_communities.tsv       node_id, louvain_u, louvain_w, infomap
    week4_kclique_aristotle.json  k=3 and k=4 communities containing Aristotle
    week4_backbone_reference.json  disparity-filter sweep, for cross-checking
                                    the live in-browser computation
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import networkx as nx
from networkx.algorithms.community import k_clique_communities, louvain_communities

ROOT = Path(__file__).resolve().parent.parent
EDGES = ROOT / "week4_philosophers_edges.tsv"
NODES = ROOT / "week4_philosophers_nodes.tsv"


def read_tsv(path):
    with open(path, encoding="utf-8") as f:
        rows = [l for l in f if not l.startswith("#")]
    return list(csv.DictReader(rows, delimiter="\t"))


def main():
    node_rows = read_tsv(NODES)
    edge_rows = read_tsv(EDGES)
    print(f"nodes: {len(node_rows)}  directed edges: {len(edge_rows)}")

    # undirected, weight = sum of both directions (per the data release notes)
    Gw = nx.Graph()
    Gw.add_nodes_from(r["node_id"] for r in node_rows)
    for r in edge_rows:
        u, v, w = r["source"], r["target"], int(r["weight"])
        if Gw.has_edge(u, v):
            Gw[u][v]["weight"] += w
        else:
            Gw.add_edge(u, v, weight=w)

    Gu = nx.Graph()
    Gu.add_nodes_from(Gw.nodes())
    Gu.add_edges_from(Gw.edges())

    gc_nodes = max(nx.connected_components(Gu), key=len)
    print(f"giant component: {len(gc_nodes)} nodes")
    Gu_gc = Gu.subgraph(gc_nodes).copy()
    Gw_gc = Gw.subgraph(gc_nodes).copy()

    def relabel_by_size(communities):
        ordered = sorted(communities, key=len, reverse=True)
        label = {}
        for i, comm in enumerate(ordered):
            for n in comm:
                label[n] = i
        return label, ordered

    louvain_u, lu_order = relabel_by_size(
        louvain_communities(Gu_gc, weight=None, seed=42)
    )
    louvain_w, lw_order = relabel_by_size(
        louvain_communities(Gw_gc, weight="weight", seed=42)
    )
    print(f"louvain unweighted: {len(lu_order)} communities")
    print(f"louvain weighted:   {len(lw_order)} communities")

    try:
        from infomap import Infomap

        im = Infomap("--two-level --silent")
        node_index = {n: i for i, n in enumerate(Gu_gc.nodes())}
        index_node = {i: n for n, i in node_index.items()}
        for u, v in Gu_gc.edges():
            im.add_link(node_index[u], node_index[v])
        im.run()
        infomap_raw = defaultdict(list)
        for node in im.tree:
            if node.is_leaf:
                infomap_raw[node.module_id].append(index_node[node.node_id])
        infomap_label, im_order = relabel_by_size(infomap_raw.values())
        print(f"infomap: {len(im_order)} modules")
    except ImportError:
        print("infomap not installed, skipping", file=sys.stderr)
        infomap_label = {}

    with open(ROOT / "week4_communities.tsv", "w", encoding="utf-8", newline="") as f:
        f.write("# 02805 week 4 — precomputed community labels for the philosophers giant component\n")
        f.write(f"# {len(gc_nodes)} nodes. Louvain (networkx, seed=42) unweighted and weighted\n")
        f.write("# (undirected, weight = sum of both directions); Infomap (--two-level) on the\n")
        f.write("# unweighted graph. All three relabelled 0..k-1 by community size, largest first.\n")
        f.write("# Built by tools/build_week4_analysis.py.\n")
        f.write("node_id\tlouvain_u\tlouvain_w\tinfomap\n")
        for n in sorted(gc_nodes):
            f.write(f"{n}\t{louvain_u[n]}\t{louvain_w[n]}\t{infomap_label.get(n, '')}\n")

    # --- k-clique communities, focused on Aristotle -----------------------
    # k=3/4 over-percolate into one 800-1000+ node blob (exactly the failure
    # mode the week's essentials warn about); k=6/7 are where Aristotle's
    # memberships turn into distinct, legible schools of thought.
    name_of = {r["node_id"]: r["name"] for r in node_rows}
    aristotle_data = {}
    membership = {k: defaultdict(list) for k in (6, 7)}
    for k in (6, 7):
        comms = list(k_clique_communities(Gu_gc, k))
        for i, c in enumerate(comms):
            for n in c:
                membership[k][n].append(i)
        containing = sorted(
            (c for c in comms if "Aristotle" in c), key=len, reverse=True
        )
        member_nodes = set()
        for c in containing:
            member_nodes.update(c)
        ego_sub = Gu_gc.subgraph(member_nodes)
        aristotle_data[f"k{k}"] = {
            "total_communities": len(comms),
            "aristotle_in_n_communities": len(containing),
            "communities": [
                {
                    "size": len(c),
                    "members": sorted(c, key=lambda n: name_of[n]),
                }
                for c in containing
            ],
            "ego_subgraph": {
                "nodes": sorted(member_nodes),
                "edges": [[u, v] for u, v in ego_sub.edges()],
            },
        }
        print(f"k={k}: {len(comms)} clique-communities, Aristotle in {len(containing)}, sizes {[len(c) for c in containing]}, ego nodes {len(member_nodes)}")

    with open(ROOT / "week4_kclique_aristotle.json", "w", encoding="utf-8") as f:
        json.dump(aristotle_data, f, indent=1, ensure_ascii=False)

    # every philosopher's overlap count, k=6 and k=7 — powers a search box so
    # a reader isn't stuck taking our word for it that Aristotle stands out
    with open(ROOT / "week4_kclique_membership.tsv", "w", encoding="utf-8", newline="") as f:
        f.write("# 02805 week 4 — k-clique community membership counts, giant component only\n")
        f.write("# k6_n / k7_n: how many k-clique-communities (k=6, k=7) that node belongs to.\n")
        f.write("# Built by tools/build_week4_analysis.py.\n")
        f.write("node_id\tk6_n\tk7_n\n")
        for n in sorted(gc_nodes):
            f.write(f"{n}\t{len(membership[6].get(n, []))}\t{len(membership[7].get(n, []))}\n")
        top = sorted(gc_nodes, key=lambda n: len(membership[7].get(n, [])), reverse=True)[:10]
        print("top-10 by k=7 overlap:", [(name_of[n], len(membership[7].get(n, []))) for n in top])

    # --- disparity filter reference sweep, for cross-checking the JS ------
    strength = {n: sum(d["weight"] for _, _, d in Gw_gc.edges(n, data=True)) for n in Gw_gc.nodes()}
    degree = dict(Gw_gc.degree())

    def edge_alpha(u, v, w):
        # keep the edge if EITHER endpoint finds it significant (Serrano et al. 2009)
        best = 1.0
        for node, other_w, other_s, k in (
            (u, w, strength[u], degree[u]),
            (v, w, strength[v], degree[v]),
        ):
            if k <= 1:
                a = 0.0
            else:
                p = other_w / other_s
                a = (1 - p) ** (k - 1)
            best = min(best, a)
        return best

    alphas = {}
    for u, v, d in Gw_gc.edges(data=True):
        alphas[(u, v)] = edge_alpha(u, v, d["weight"])

    grid = [round(0.01 * i, 3) for i in range(1, 61)]
    sweep = []
    prev_gc = None
    critical = None
    for a in grid:
        kept = [(u, v) for (u, v), av in alphas.items() if av < a]
        H = nx.Graph()
        H.add_nodes_from(gc_nodes)
        H.add_edges_from(kept)
        gc_size = len(max(nx.connected_components(H), key=len)) if kept else 0
        sweep.append({"alpha": a, "edges": len(kept), "giant_component": gc_size})
        if prev_gc is not None and prev_gc > 0 and (prev_gc - gc_size) / prev_gc > 0.15 and critical is None:
            critical = a
        prev_gc = gc_size

    print(f"critical alpha (>15% giant-component drop): {critical}")

    with open(ROOT / "week4_backbone_reference.json", "w", encoding="utf-8") as f:
        json.dump({"sweep": sweep, "critical_alpha": critical}, f, indent=1)


if __name__ == "__main__":
    main()
