#!/usr/bin/env python3
"""Builds the precomputed text/network data behind Week 05 (The Office).

Headline question: do characters who talk to each other also *sound* alike?

The corpus is the fan transcript of The Office (US) packaged by the `schrute`
project (github.com/bradlindblad/schrute). We re-parse its raw one-cell-per-line
file ourselves instead of using the tidy table, because the tidy table splits
every line on ':' and silently truncates ~300 lines like "at 11:30".
IMDb ratings come from TidyTuesday 2020-03-17.

Raw downloads land in data-raw/week5/ (git-ignored: it's a copy of copyrighted
scripts, so only derived numbers and short quotes are committed).

Run:
    python tools/build_week5_analysis.py

Writes:
    week5_office.json   everything the page draws, in one file
"""
import csv
import json
import math
import random
import re
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw" / "week5"
OUT = ROOT / "week5_office.json"

SOURCES = {
    "transcript.csv": "https://raw.githubusercontent.com/bradlindblad/schrute/master/python/office_transcript.csv",
    "directors_writers.csv": "https://raw.githubusercontent.com/bradlindblad/schrute/master/data-raw/office_directors_writers.csv",
    "imdb_crosswalk.csv": "https://raw.githubusercontent.com/bradlindblad/schrute/master/data-raw/imdb-theoffice-episode-crosswalk.csv",
    "ratings.csv": "https://raw.githubusercontent.com/rfordatascience/tidytuesday/master/data/2020/2020-03-17/office_ratings.csv",
}

# NLTK's English stopword list, inlined because the local nltk/scipy install
# is broken and we only need the list.
STOPWORDS = set("""i me my myself we our ours ourselves you you're you've you'll you'd your
yours yourself yourselves he him his himself she she's her hers herself it it's its itself
they them their theirs themselves what which who whom this that that'll these those am is are
was were be been being have has had having do does did doing a an the and but if or because as
until while of at by for with about against between into through during before after above
below to from up down in out on off over under again further then once here there when where
why how all any both each few more most other some such no nor not only own same so than too
very s t can will just don don't should should've now d ll m o re ve y ain aren aren't couldn
couldn't didn didn't doesn doesn't hadn hadn't hasn hasn't haven haven't isn isn't ma mightn
mightn't mustn mustn't needn needn't shan shan't shouldn shouldn't wasn wasn't weren weren't
won won't wouldn wouldn't""".split())
# Spoken-transcript filler the written-English list doesn't know about.
FILLER = set("""oh okay ok yeah yes uh um hey well right like know just gonna get got go
going really think mean good im i'm you're that's it's don't can't didn't what's there's
let's he's she's we're they're i'll i've i'd we'll alright all no""".split())

MIN_TOKENS = 2000        # "core cast" threshold for the similarity analysis
SAMPLE_TOKENS = 2000     # equal-size samples, so big talkers don't look richer
N_DRAWS = 30
SEED = 2005              # year of the pilot


def fetch():
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        p = RAW / name
        if not p.exists():
            print(f"downloading {name}")
            urllib.request.urlretrieve(url, p)


# --------------------------------------------------------------------------- parsing

ALIASES = {"Micheal": "Michael", "Michel": "Michael", "Mihael": "Michael", "Michae": "Michael",
           "Dwigt": "Dwight", "Dwight.": "Dwight", "Jim.": "Jim", "Pam.": "Pam",
           "Daryl": "Darryl", "Phylis": "Phyllis", "Phyliss": "Phyllis", "Stanely": "Stanley",
           "Anglea": "Angela", "Angels": "Angela", "Meridith": "Meredith", "Carroll": "Carol",
           "Deangelo": "DeAngelo", "David Wallace": "David", "Todd Packer": "Packer",
           "Robert California": "Robert", "Nellie Bertram": "Nellie", "Jo Bennett": "Jo",
           "Holly Flax": "Holly", "Toby Flenderson": "Toby", "Ryan Howard": "Ryan"}
EPISODE_RE = re.compile(r"^(\d\d)x(\d\d)(?:/\d\d)? - (.*)$")  # 03x10/11 = a two-parter
DIRECTION_RE = re.compile(r"\[[^\]]*\]")
TOKEN_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")


def clean_name(n):
    n = re.sub(r"\s+", " ", n.strip().strip(".")).strip()
    n = n[:1].upper() + n[1:]
    return ALIASES.get(n, n)


def tokenize(s):
    return TOKEN_RE.findall(s.lower().replace("’", "'"))


def load_lines():
    with open(RAW / "transcript.csv", encoding="utf-8") as f:
        cells = [c for row in csv.reader(f) for c in row if c.strip()]
    lines, skipped_directions = [], 0
    for c in cells:
        ep, _, body = c.partition(";")
        m = EPISODE_RE.match(ep.strip())
        if not m or re.search(r"Webisode|Deleted|Gag Reel", ep):
            continue
        season, episode, title = int(m[1]), int(m[2]), m[3].strip()
        speaker, sep, text_wd = body.partition(":")
        if not sep or not speaker.strip() or len(speaker) > 40:
            skipped_directions += 1   # a bare [stage direction] cell
            continue
        text_wd = text_wd.strip()
        text = re.sub(r"\s+", " ", DIRECTION_RE.sub(" ", text_wd)).strip()
        lines.append(dict(season=season, episode=episode, title=title,
                          speaker=clean_name(speaker), text=text, raw=text_wd))
    return lines, skipped_directions


# --------------------------------------------------------------------------- helpers

def zipf_points(counter, n_pts=60):
    f = np.array(sorted(counter.values(), reverse=True), dtype=float)
    r = np.arange(1, len(f) + 1)
    idx = np.unique(np.round(np.logspace(0, math.log10(len(f)), n_pts)).astype(int) - 1)
    m = (r >= 10) & (r <= 5000) & (r <= len(f))
    slope = float(np.polyfit(np.log10(r[m]), np.log10(f[m]), 1)[0])
    return [[int(r[i]), int(f[i])] for i in idx], round(slope, 3)


def cosine_matrix(M):
    norms = np.linalg.norm(M, axis=1, keepdims=True)
    norms[norms == 0] = 1
    X = M / norms
    return X @ X.T


def upper(M):
    i, j = np.triu_indices(M.shape[0], 1)
    return M[i, j]


def spearman(a, b):
    ra = np.argsort(np.argsort(a)).astype(float)
    rb = np.argsort(np.argsort(b)).astype(float)
    return float(np.corrcoef(ra, rb)[0, 1])


def mantel(A, B, n_perm=1999, rng=None, method=spearman):
    """Correlation between two symmetric matrices, p-value by shuffling node labels."""
    obs = method(upper(A), upper(B))
    n, hits = A.shape[0], 0
    for _ in range(n_perm):
        p = rng.permutation(n)
        if method(upper(A), upper(B[np.ix_(p, p)])) >= obs:
            hits += 1
    return obs, (hits + 1) / (n_perm + 1)


def log_odds_dirichlet(counts_i, counts_all, top=12, min_count=5):
    """Monroe, Colaresi & Quinn (2008): words most distinctive of one speaker vs the rest."""
    n_i, n_all = sum(counts_i.values()), sum(counts_all.values())
    a0 = n_all  # informative prior = the whole corpus
    out = []
    for w, yi in counts_i.items():
        if yi < min_count:
            continue
        aw = counts_all[w]
        yj = aw - yi
        nj = n_all - n_i
        d = (math.log((yi + aw) / (n_i + a0 - yi - aw))
             - math.log((yj + aw) / (nj + a0 - yj - aw)))
        var = 1 / (yi + aw) + 1 / (yj + aw)
        out.append((d / math.sqrt(var), w, yi))
    out.sort(reverse=True)
    return [{"w": w, "z": round(z, 1), "n": n} for z, w, n in out[:top]]


def g2(k11, k12, k21, k22):
    """Dunning log-likelihood for a 2x2 contingency table."""
    def h(*ks):
        n = sum(ks)
        return sum(k * math.log(k / n) for k in ks if k > 0)
    return 2 * (h(k11, k12, k21, k22) - h(k11 + k12, k21 + k22) - h(k11 + k21, k12 + k22))


PIPELINE_STEPS = ["lowercase", "strip_punct", "drop_directions", "drop_stopwords", "drop_filler"]
WORD_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")


def pipeline_variants(lines):
    """Every on/off combination of the five preprocessing steps, for the page's toggles.

    Key = five 0/1 characters in PIPELINE_STEPS order. Steps are applied literally,
    so their interactions show up: the stopword list is lowercase, so without the
    lowercase step "The" and "I" survive stopword removal; without stripping
    punctuation, "the," isn't "the" either.
    """
    out = {}
    for mask in range(32):
        on = {s: bool(mask >> (4 - i) & 1) for i, s in enumerate(PIPELINE_STEPS)}
        c = Counter()
        for ln in lines:
            t = ln["text"] if on["drop_directions"] else ln["raw"]
            t = t.replace("’", "'")
            if on["lowercase"]:
                t = t.lower()
            toks = WORD_RE.findall(t) if on["strip_punct"] else t.split()
            if on["drop_stopwords"]:
                toks = [w for w in toks if w not in STOPWORDS]
            if on["drop_filler"]:
                toks = [w for w in toks if w not in FILLER]
            c.update(toks)
        ranked = c.most_common()
        f = np.array([n for _, n in ranked], dtype=float)
        r = np.arange(1, len(f) + 1)
        m = (r >= 10) & (r <= 5000)
        slope = float(np.polyfit(np.log10(r[m]), np.log10(f[m]), 1)[0])
        idx = np.unique(np.round(np.logspace(0, math.log10(len(f)), 60)).astype(int) - 1)
        key = "".join("1" if on[s] else "0" for s in PIPELINE_STEPS)
        out[key] = {"tokens": int(f.sum()), "types": len(ranked), "slope": round(slope, 3),
                    "points": [[int(i + 1), int(ranked[i][1]), ranked[i][0]] for i in idx],
                    "top": [[w, n] for w, n in ranked[:10]]}
    return out


# --------------------------------------------------------------------------- main

def main():
    fetch()
    rng = np.random.default_rng(SEED)
    random.seed(SEED)

    lines, skipped = load_lines()
    for ln in lines:
        ln["toks"] = tokenize(ln["text"])
    episodes = sorted({(l["season"], l["episode"]) for l in lines})
    print(f"lines {len(lines)}  episodes {len(episodes)}  bare stage directions skipped {skipped}")

    # ---------------------------------------------------------- tokenization choices
    raw_text = " ".join(l["raw"] for l in lines)
    pipelines = []
    def add_pipe(name, toks):
        pipelines.append({"name": name, "tokens": len(toks), "types": len(set(toks))})
    add_pipe("split on spaces", raw_text.split())
    add_pipe("+ lowercase", raw_text.lower().split())
    add_pipe("+ strip punctuation", tokenize(raw_text))
    spoken = [t for l in lines for t in l["toks"]]
    add_pipe("+ drop [stage directions]", spoken)
    add_pipe("+ drop stopwords", [t for t in spoken if t not in STOPWORDS])
    add_pipe("+ drop spoken filler", [t for t in spoken if t not in STOPWORDS | FILLER])

    corpus = Counter(spoken)
    zipf_all, zipf_slope = zipf_points(corpus)
    top_words = [[w, c] for w, c in corpus.most_common(25)]
    share_top10 = sum(c for _, c in corpus.most_common(10)) / len(spoken)

    # ---------------------------------------------------------- per speaker
    by_spk = defaultdict(list)
    for l in lines:
        by_spk[l["speaker"]].append(l)
    spk_tokens = {s: [t for l in ls for t in l["toks"]] for s, ls in by_spk.items()}
    core = sorted([s for s, t in spk_tokens.items() if len(t) >= MIN_TOKENS],
                  key=lambda s: -len(spk_tokens[s]))
    print(f"speakers {len(by_spk)}  core cast (>= {MIN_TOKENS} tokens): {len(core)}")
    idx = {s: i for i, s in enumerate(core)}

    # ---------------------------------------------------------- talk network
    # Edge = B speaks right after A, in the same episode. The transcript has no
    # scene breaks, so this is a "conversation turn" proxy, not co-presence.
    turns = Counter()
    ep_lines = defaultdict(list)
    for l in lines:
        ep_lines[(l["season"], l["episode"])].append(l["speaker"])
    for spk_seq in ep_lines.values():
        for a, b in zip(spk_seq, spk_seq[1:]):
            if a != b:
                turns[frozenset((a, b))] += 1
    G = nx.Graph()
    for pair, w in turns.items():
        a, b = tuple(pair)
        G.add_edge(a, b, weight=w)
    full_net = {"nodes": G.number_of_nodes(), "edges": G.number_of_edges()}

    n = len(core)
    T = np.zeros((n, n))
    for pair, w in turns.items():
        a, b = tuple(pair)
        if a in idx and b in idx:
            T[idx[a], idx[b]] = T[idx[b], idx[a]] = w
    # Michael is in ~a quarter of all turns, so raw counts mostly measure "is one
    # of you Michael". Lift = observed / expected under random mixing.
    strength = T.sum(1)
    total = T.sum() / 2
    expected = np.outer(strength, strength) / (2 * total)
    LIFT = np.where(expected > 0, T / np.where(expected > 0, expected, 1), 0)
    np.fill_diagonal(LIFT, 0)

    # shared episodes, a "same storyline" control
    spk_eps = defaultdict(set)
    for l in lines:
        spk_eps[l["speaker"]].add((l["season"], l["episode"]))
    EP = np.zeros((n, n))
    for a in core:
        for b in core:
            if a != b:
                ea, eb = spk_eps[a], spk_eps[b]
                EP[idx[a], idx[b]] = len(ea & eb) / len(ea | eb)

    # ---------------------------------------------------------- how they sound
    vocab_content = [w for w, c in corpus.items() if c >= 5 and w not in STOPWORDS | FILLER]
    vocab_style = sorted(STOPWORDS & set(corpus))
    vocab_all = [w for w, c in corpus.items() if c >= 5]
    vi = {k: {w: i for i, w in enumerate(v)} for k, v in
          [("content", vocab_content), ("style", vocab_style), ("raw", vocab_all)]}

    def bow(tokens, kind):
        v = np.zeros(len(vi[kind]))
        m = vi[kind]
        for t in tokens:
            j = m.get(t)
            if j is not None:
                v[j] += 1
        return v

    def sim_matrices(sample):
        """Returns cosine matrices for raw counts, function words, and TF-IDF content words."""
        toks = {s: sample(s) for s in core}
        out = {}
        for kind in ("raw", "style", "content"):
            M = np.array([bow(toks[s], kind) for s in core])
            if kind == "content":
                df = (M > 0).sum(0)
                M = M * np.log(n / np.maximum(df, 1))
            if kind == "style":
                M = M / np.maximum(M.sum(1, keepdims=True), 1)
            out[kind] = cosine_matrix(M)
        return out

    full = sim_matrices(lambda s: spk_tokens[s])
    # Equal-size samples: big talkers have smoother profiles, which inflates
    # their similarity to everyone. Average over N_DRAWS samples of random lines
    # (random, not contiguous: a contiguous run is one episode's storyline).
    def line_sample(s):
        ls = by_spk[s][:]
        random.shuffle(ls)
        out = []
        for l in ls:
            out.extend(l["toks"])
            if len(out) >= SAMPLE_TOKENS:
                break
        return out[:SAMPLE_TOKENS]
    acc = {k: np.zeros((n, n)) for k in full}
    for _ in range(N_DRAWS):
        for k, M in sim_matrices(line_sample).items():
            acc[k] += M / N_DRAWS
    for k in acc:
        np.fill_diagonal(acc[k], 0)
        np.fill_diagonal(full[k], 0)

    # ---------------------------------------------------------- the headline test
    LOGT = np.log1p(T)
    tests = {}
    for kind in ("raw", "style", "content"):
        rho, p = mantel(LIFT, acc[kind], rng=rng)
        rho_t, p_t = mantel(LOGT, acc[kind], rng=rng)
        rho_ep, p_ep = mantel(EP, acc[kind], rng=rng)
        tests[kind] = {"rho_lift": round(rho, 3), "p_lift": round(p, 4),
                       "rho_turns": round(rho_t, 3), "p_turns": round(p_t, 4),
                       "rho_episodes": round(rho_ep, 3), "p_episodes": round(p_ep, 4)}
    # partial: does talk still predict sounding alike after removing shared episodes?
    def resid(y, x):
        x1 = np.column_stack([np.ones_like(x), x])
        beta, *_ = np.linalg.lstsq(x1, y, rcond=None)
        return y - x1 @ beta
    def rank(v):
        return np.argsort(np.argsort(v)).astype(float)
    lift_u, ep_u = rank(upper(LIFT)), rank(upper(EP))
    for kind in ("style", "content"):
        s_u = rank(upper(acc[kind]))
        tests[kind]["partial_talk_given_episodes"] = round(
            float(np.corrcoef(resid(lift_u, ep_u), resid(s_u, ep_u))[0, 1]), 3)
    print(json.dumps(tests, indent=1))

    pairs = []
    for a in range(n):
        for b in range(a + 1, n):
            pairs.append({"a": core[a], "b": core[b], "turns": int(T[a, b]),
                          "lift": round(float(LIFT[a, b]), 3),
                          "shared_eps": round(float(EP[a, b]), 3),
                          "content": round(float(acc["content"][a, b]), 4),
                          "style": round(float(acc["style"][a, b]), 4),
                          "raw": round(float(acc["raw"][a, b]), 4)})

    # ---------------------------------------------------------- per-character cards
    comm = nx.algorithms.community.louvain_communities(
        G.subgraph(core), weight="weight", seed=SEED)
    comm_of = {s: i for i, c in enumerate(sorted(comm, key=len, reverse=True)) for s in c}

    # vocabulary richness at equal size ("Kevin's law")
    def types_in_sample(s, k):
        vals = []
        for _ in range(N_DRAWS):
            toks = spk_tokens[s]
            start = random.randrange(max(1, len(toks) - k))
            vals.append(len(set(toks[start:start + k])))
        return float(np.mean(vals))
    content_centroid = acc["content"].mean(1)
    characters = []
    for s in core:
        t = spk_tokens[s]
        heaps = []
        seen = set()
        for i, w in enumerate(t, 1):
            seen.add(w)
            if i in {int(x) for x in np.logspace(1, math.log10(len(t)), 40)} or i == len(t):
                heaps.append([i, len(seen)])
        mean_len = float(np.mean([len(l["toks"]) for l in by_spk[s] if l["toks"]]))
        characters.append({
            "name": s, "tokens": len(t), "lines": len(by_spk[s]),
            "episodes": len(spk_eps[s]), "community": comm_of.get(s, -1),
            "degree_full": G.degree(s), "strength": int(strength[idx[s]]),
            "types_2000": round(types_in_sample(s, SAMPLE_TOKENS), 1),
            "words_per_line": round(mean_len, 2),
            # share of their lines from seasons 8-9 (after Michael leaves), to tell the eras apart
            "late_share": round(sum(l["season"] >= 8 for l in by_spk[s]) / len(by_spk[s]), 3),
            "mean_content_sim": round(float(content_centroid[idx[s]] * n / (n - 1)), 4),
            "distinctive": log_odds_dirichlet(
                Counter(w for w in t if w not in STOPWORDS), corpus),
            "heaps": heaps,
        })

    # ---------------------------------------------------------- catchphrases
    def ngrams(toks, k):
        return zip(*[toks[i:] for i in range(k)])
    big = Counter(g for l in lines for g in ngrams(l["toks"], 2))
    N2 = sum(big.values())
    first, second = Counter(), Counter()
    for (a, b), c in big.items():
        first[a] += c
        second[b] += c
    colloc = []
    for (a, b), c in big.items():
        if c < 15 or a in STOPWORDS or b in STOPWORDS:
            continue
        colloc.append((g2(c, first[a] - c, second[b] - c, N2 - first[a] - second[b] + c),
                       f"{a} {b}", c))
    colloc.sort(reverse=True)
    tri = Counter(g for l in lines for g in ngrams(l["toks"], 3))
    def who_says(phrase):
        k = len(phrase.split())
        c = Counter()
        for l in lines:
            if any(" ".join(g) == phrase for g in ngrams(l["toks"], k)):
                c[l["speaker"]] += 1
        return c.most_common(3)
    collocations = [{"phrase": p, "n": c, "g2": round(s, 1), "top_speakers": who_says(p)}
                    for s, p, c in colloc[:30]]
    trigrams = [{"phrase": " ".join(g), "n": c}
                for g, c in tri.most_common(400)
                if sum(w in STOPWORDS | FILLER for w in g) <= 1][:25]

    # ---------------------------------------------------------- concordance: TWSS
    twss = []
    ep_full = defaultdict(list)
    for l in lines:
        ep_full[(l["season"], l["episode"])].append(l)
    for key, ls in ep_full.items():
        for i, l in enumerate(ls):
            m = re.search(r"that'?s what s?he said", l["text"], re.I)
            if m:
                setup = ls[i - 1] if i else None
                twss.append({"season": key[0], "episode": key[1], "title": l["title"],
                             "speaker": l["speaker"], "line": l["text"],
                             "setup_speaker": setup["speaker"] if setup else None,
                             "setup": setup["text"] if setup else None})
    twss.sort(key=lambda r: (r["season"], r["episode"]))

    # ---------------------------------------------------------- episodes & ratings
    xw = {}
    with open(RAW / "imdb_crosswalk.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            xw[(int(r["season"]), int(r["episode_schrute"]))] = int(r["episode_imdb"])
    rating = {}
    with open(RAW / "ratings.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rating[(int(r["season"]), int(r["episode"]))] = float(r["imdb_rating"])
    ep_rows = []
    for key in episodes:
        ls = ep_full[key]
        toks = Counter(s for l in ls for s in [l["speaker"]] for _ in l["toks"])
        ntok = sum(toks.values())
        r = rating.get((key[0], xw.get(key, key[1])))
        ep_rows.append({"season": key[0], "episode": key[1], "title": ls[0]["title"],
                        "rating": r, "tokens": ntok, "lines": len(ls),
                        "michael_share": round(toks["Michael"] / ntok, 3) if ntok else 0})

    # ---------------------------------------------------------- game: Who Said It?
    # Pool lines are held OUT of the bot's character profiles, so the bot has
    # never seen the quote it is guessing.
    game_cast = [s for s in core if len(spk_tokens[s]) >= 5000][:12]
    pool = []
    for s in game_cast:
        cands = [l for l in by_spk[s] if 10 <= len(l["toks"]) <= 32 and "[" not in l["text"]]
        random.shuffle(cands)
        pool.extend(cands[:40])
    pool_ids = {id(l) for l in pool}
    prof_counts = {s: Counter(t for l in by_spk[s] if id(l) not in pool_ids
                              for t in l["toks"] if t not in STOPWORDS) for s in game_cast}
    df_game = Counter(w for c in prof_counts.values() for w in c)
    profiles = {}
    for s, c in prof_counts.items():
        tot = sum(c.values())
        weights = {w: (k / tot) * math.log(len(game_cast) / df_game[w]) for w, k in c.items()
                   if k >= 3 and df_game[w] < len(game_cast)}
        top = sorted(weights.items(), key=lambda x: -x[1])[:600]
        profiles[s] = {w: round(v * 1e4, 3) for w, v in top}
    game_quotes = [{"speaker": l["speaker"], "text": l["text"], "season": l["season"],
                    "episode": l["episode"], "title": l["title"]} for l in pool]
    # How good is the bot? Cosine between the quote's words and each profile.
    norms = {s: math.sqrt(sum(v * v for v in p.values())) for s, p in profiles.items()}
    bot_hits = 0
    for l in pool:
        sc = {s: sum(profiles[s].get(t, 0) for t in l["toks"]) / norms[s] for s in game_cast}
        bot_hits += max(sc, key=sc.get) == l["speaker"]
    bot_accuracy = bot_hits / len(pool)
    print(f"bot accuracy {bot_accuracy:.3f}  (chance {1 / len(game_cast):.3f})")

    # ---------------------------------------------------------- write
    out = {
        "meta": {"lines": len(lines), "episodes": len(episodes), "speakers": len(by_spk),
                 "tokens": len(spoken), "types": len(corpus), "core_threshold": MIN_TOKENS,
                 "sample_tokens": SAMPLE_TOKENS, "draws": N_DRAWS,
                 "full_network": full_net, "share_top10_types": round(share_top10, 3),
                 # word lists, so the page can colour a line by content vs function words
                 "stopwords": sorted(STOPWORDS), "filler": sorted(FILLER - STOPWORDS)},
        "pipelines": pipelines,
        "pipeline_steps": PIPELINE_STEPS,
        "pipeline_variants": pipeline_variants(lines),
        "zipf": {"points": zipf_all, "slope": zipf_slope, "top": top_words},
        "characters": characters,
        "pairs": pairs,
        "within_group_turn_share": round(float(sum(T[idx[a], idx[b]] for a in core for b in core
                                                   if a < b and comm_of.get(a) == comm_of.get(b)) / total), 3),
        "tests": tests,
        "collocations": collocations,
        "trigrams": trigrams,
        "twss": twss,
        "episodes": ep_rows,
        "game": {"cast": game_cast, "quotes": game_quotes, "profiles": profiles,
                 "bot_accuracy": round(bot_accuracy, 3)},
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT.name}  {OUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
