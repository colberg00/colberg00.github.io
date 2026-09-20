#!/usr/bin/env python3
"""Builds week3_attributes.tsv: a team and a debut decade for each character.

Both come from the infobox of the character's own Wikipedia article. `alliances`
lists the teams a character has belonged to, and `debut` names the comic and year
they first appeared in. The article text is the cache the week 3 notebook writes
to data/week3_marvel_wikitext.json; if it isn't there, run the notebook's
"Article text" cell first.

    python3 tools/build_week3_attributes.py

Writes week3_attributes.tsv next to the other data files. A character keeps the
first team on the list below that their infobox mentions, so a character who has
served with several teams is filed under the best known one; characters whose
infobox names none of them get an empty team and are left out of the team
analysis on the Case No. 03 page.
"""
import json
import re
import sys
from pathlib import Path

TEAMS = [
    "X-Men", "Avengers", "Fantastic Four", "Defenders", "X-Force", "X-Factor",
    "Alpha Flight", "Thunderbolts", "S.H.I.E.L.D.", "Guardians of the Galaxy",
    "Inhumans", "Eternals", "Heroes for Hire", "New Warriors", "Excalibur",
    "Asgard", "Invaders", "Midnight Sons",
]

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT.parent / "data" / "week3_marvel_wikitext.json"
NODES = ROOT / "week1_nodes.tsv"
OUT = ROOT / "week3_attributes.tsv"


def infobox_field(text, name):
    """The raw value of one infobox field, up to the next field or the end."""
    match = re.search(r"\|\s*%s\s*=(.*?)(?=\n\s*\||\n\}\})" % name, text, flags=re.S)
    return match.group(1) if match else ""


def team_of(text):
    alliances = infobox_field(text, "alliances")
    for team in TEAMS:
        if re.search(re.escape(team), alliances, flags=re.I):
            return team
    return ""


def decade_of(text):
    years = re.findall(r"\b(19[3-9]\d|20[0-2]\d)\b", infobox_field(text, "debut"))
    return str(int(years[0]) // 10 * 10) if years else ""


def main():
    if not CACHE.exists():
        sys.exit(f"missing {CACHE} — run the article-text cell of the week 3 notebook first")
    wikitext = json.loads(CACHE.read_text())
    # the node file opens with # comments, then a header row, then the characters
    lines = [l for l in NODES.read_text().splitlines() if l and not l.startswith("#")]
    node_ids = [l.split("\t")[0] for l in lines[1:]]

    rows, with_team, with_decade = [], 0, 0
    for node_id in node_ids:
        text = wikitext.get(node_id, "")
        team, decade = team_of(text), decade_of(text)
        with_team += bool(team)
        with_decade += bool(decade)
        rows.append(f"{node_id}\t{team}\t{decade}")

    header = [
        "# Team and debut decade per character, from the infobox of each Wikipedia article.",
        "# team: first match among " + ", ".join(TEAMS) + " in the article's `alliances` field.",
        "# decade: the first year in the `debut` field, rounded down.",
        "# Built by tools/build_week3_attributes.py.",
        "node_id\tteam\tdecade",
    ]
    OUT.write_text("\n".join(header + rows) + "\n")
    print(f"{OUT.name}: {len(rows)} characters, {with_team} with a team, {with_decade} with a decade")


if __name__ == "__main__":
    main()
