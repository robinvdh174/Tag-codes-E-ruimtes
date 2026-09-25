#!/usr/bin/env python3
"""Leest een indelingstekening (AutoCAD-PDF uit Meridian) van een verdeler
uit en print een JS-object om in verdelers.js te plakken.

Gebruik:
    pip install pymupdf
    python3 tools/verdeler_uit_pdf.py tekening.pdf --ruimte 3KV

Werkt op vector-PDF's (tekst selecteerbaar), niet op scans/foto's.
Werkwijze: de veldkoppen (=21B4+02, ...) van de onderste tabel bepalen de
kolommen; elke tekstregel eronder gaat naar de dichtstbijzijnde kolom.
- Kolomvelden (verticale tekst): één uitgang, of meerdere (31A/31B).
- Ladevelden (horizontale tekst, bv. +03): elke lade = tag + omschrijving,
  afgesloten door een "TEK. E-..."-regel; het ladenummer staat links.
Controleer de uitvoer altijd tegen de tekening.
"""
import argparse
import json
import re

import pymupdf

TAG = re.compile(r"^=\S*\.\S+$")
TEK = re.compile(r"TEK\.\s*(E-\S+)")
HOR = (1.0, 0.0)


def lees(pdf, ruimte):
    page = pymupdf.open(pdf)[0]
    lines = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if t:
                lines.append((l["bbox"], t, tuple(round(v, 1) for v in l["dir"])))

    naam = next(t.strip() for _, t, _ in lines if re.fullmatch(r"\s*MCC \w+\s*", t))
    tekening = next((t for _, t, _ in lines if re.fullmatch(r"E-\d{3}-\d{4}", t)), "")

    hdr = [(bb, t) for bb, t, _ in lines if re.fullmatch(r"=\w+\+\d+", t)]
    ytab = max(bb[1] for bb, _ in hdr)
    kop = sorted([(bb, t) for bb, t in hdr if abs(bb[1] - ytab) < 5], key=lambda x: x[0][0])
    xs = [(bb[0] + bb[2]) / 2 for bb, _ in kop]
    # Onderrand: titelblok onderaan de tekening niet meenemen.
    ybodem = min((bb[1] for bb, t, _ in lines if t in ("Wijzigingen", "Map:")), default=1e9)

    kolommen = {t: [] for _, t in kop}
    for bb, t, d in lines:
        if bb[1] < ytab + 8 or bb[1] > ybodem - 5:
            continue
        cx = (bb[0] + bb[2]) / 2
        i = min(range(len(xs)), key=lambda k: abs(xs[k] - cx))
        if abs(xs[i] - cx) < 60:
            kolommen[kop[i][1]].append((bb, t, d))

    def uitgang(nr, items):
        tag = next((t for t in items if TAG.match(t)), "")
        schema = next((TEK.search(t).group(1) for t in items if TEK.search(t)), "")
        oms = " ".join(t for t in items
                       if t != tag and not TEK.search(t) and not re.fullmatch(r"=|0|\d+[AB]?", t))
        return {"nr": nr, "tag": tag.lstrip("="), "omschrijving": oms, "schema": schema}

    velden = []
    for veldkop, v in kolommen.items():
        veld = "+" + veldkop.split("+")[1]
        uit = []
        if any(d == HOR and TAG.match(t) for _, t, d in v):
            # Het rijnummer naast een TEK-regel is de onderrand van die lade
            # en dus meteen de bovenrand (= ladenummer) van de volgende.
            cur, nr, laatste = [], "", ""
            for bb, t, d in sorted(v, key=lambda x: x[0][1]):
                if re.fullmatch(r"\d+", t):
                    laatste = t
                    nr = nr or t
                    continue
                cur.append(t)
                if TEK.search(t):
                    uit.append(uitgang(nr, cur))
                    cur, nr = [], laatste
        else:
            subs = sorted([(bb, t) for bb, t, d in v if re.fullmatch(r"\d+[AB]", t)])
            vert = sorted([x for x in v if x[2] != HOR], key=lambda x: x[0][0])
            if len(subs) > 1:
                for i, (sb, st) in enumerate(subs):
                    lo = sb[0] - 10
                    hi = subs[i + 1][0][0] - 10 if i + 1 < len(subs) else 1e9
                    uit.append(uitgang(st, [t for bb, t, _ in vert if lo <= bb[0] < hi]))
            else:
                nr = next((t for _, t, d in v if d == HOR and re.fullmatch(r"\d+", t)), "")
                uit.append(uitgang(nr, [t for _, t, _ in vert]))
        velden.append({"veld": veld, "uitgangen": uit})

    return {"naam": naam, "ruimte": ruimte, "tekening": tekening, "velden": velden}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--ruimte", default="", help="E-ruimte zoals in de app, bv. 3KV")
    a = ap.parse_args()
    print(json.dumps(lees(a.pdf, a.ruimte), ensure_ascii=False, indent=2))
