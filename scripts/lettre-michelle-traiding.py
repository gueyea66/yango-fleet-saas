# -*- coding: utf-8 -*-
"""Génère la lettre d'agrément Michelle Traiding en .docx et en .html (→ PDF)."""
import html, subprocess, pathlib

EXP = ["MICHELLE TRAIDING",
       "Sicap Liberté 3, n° 36/A — Dakar, Sénégal",
       "Tél. : +221 77 285 88 29"]
DATE = "Dakar, le 24 septembre 2026"
DEST = ["FONSTAB", "À l'attention de Madame l'Administratrice",
        "Sphères ministérielles Ousmane Tanor Dieng", "Bâtiment C — Diamniadio, Sénégal"]
OBJET = "Objet : demande d'agrément — organisation et logistique d'événements"

CORPS = [
  "Madame l'Administratrice,",
  "Michelle Traiding est une entreprise de prestations de services établie à Dakar. "
  "Nous prenons en charge l'organisation matérielle des manifestations professionnelles, "
  "de la préparation jusqu'au repli.",
]
RUB1 = ("NOS PRESTATIONS", [
  "Coordination de la manifestation : calendrier, prestataires, budget, présence sur place le jour J.",
  "Déplacements : mise à disposition de véhicules, navettes des participants, acheminement du matériel.",
  "Sur site : montage des espaces d'accueil, mobilier et signalétique, pauses et restauration, "
  "repli et remise en état des lieux.",
  "Achats liés à l'événement : fournitures, supports imprimés, dotations remises aux participants.",
])
RUB2 = ("NOS ENGAGEMENTS", [
  "Un devis chiffré ligne par ligne avant tout démarrage.",
  "Un responsable unique, joignable pendant toute la durée de la mission.",
  "Un compte rendu et les justificatifs de dépenses remis à la clôture.",
])
FIN = [
  "Michelle Traiding est immatriculée au registre du commerce sous le numéro SN DKR 2026 A 3767 "
  "et dispose du NINEA 012793768. Nos activités déclarées couvrent les prestations de services, "
  "le transport routier, la location de véhicules et le commerce général.",
  "Nous sollicitons à ce titre votre agrément et restons disponibles pour un entretien.",
  "Pièces jointes : accusé d'immatriculation au RCCM, avis NINEA.",
  "Veuillez agréer, Madame l'Administratrice, l'expression de notre considération distinguée.",
]
SIGN = ["Mamadou Siradio DIALLO", "Gérant"]
PIED = ("MICHELLE TRAIDING — RCCM SN DKR 2026 A 3767 — NINEA 012793768 — "
        "Sicap Liberté 3, n° 36/A, Dakar — Tél. : +221 77 285 88 29")

BASE = pathlib.Path(__file__).resolve().parents[1] / "docs"
NOM = "lettre-agrement-fonstab-michelle-traiding"

# ---------------------------------------------------------------- HTML → PDF
def bloc_rub(titre, items):
    lis = "\n".join(f"      <li>{html.escape(i)}</li>" for i in items)
    return f'    <p class="rub">{titre}</p>\n    <ul>\n{lis}\n    </ul>\n'

doc = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Michelle Traiding — Demande d'agrément</title>
<style>
  @page {{ size: A4; margin: 16mm 23mm 12mm 23mm; }}
  body {{ font-family: Arial, Helvetica, sans-serif; font-size: 10.6pt; line-height: 1.38; color: #000; margin: 0; }}
  .exp {{ margin-bottom: 9mm; }}
  .exp .nom {{ font-weight: bold; letter-spacing: .04em; }}
  .date {{ text-align: right; margin-bottom: 7mm; }}
  .dest {{ margin-bottom: 7mm; }}
  .dest .nom {{ font-weight: bold; }}
  .objet {{ margin-bottom: 6mm; font-weight: bold; }}
  p {{ margin: 0 0 3mm; text-align: justify; }}
  p.rub {{ font-weight: bold; font-size: 9.6pt; letter-spacing: .1em; margin: 5mm 0 2mm; }}
  ul {{ margin: 0 0 4mm; padding-left: 5mm; list-style: none; }}
  li {{ margin-bottom: 1.1mm; text-align: justify; }}
  li::before {{ content: "— "; }}
  .sign {{ margin-top: 7mm; }}
  .sign .nom {{ font-weight: bold; margin-top: 11mm; }}
  .pied {{ margin-top: 8mm; padding-top: 2.5mm; border-top: .75pt solid #999;
           font-size: 7.6pt; color: #444; text-align: center; }}
</style>
</head>
<body>
  <div class="exp">
    <div class="nom">{html.escape(EXP[0])}</div>
    {html.escape(EXP[1])}<br />
    {html.escape(EXP[2])}
  </div>

  <div class="date">{html.escape(DATE)}</div>

  <div class="dest">
    <span class="nom">{html.escape(DEST[0])}</span><br />
    {html.escape(DEST[1])}<br />
    {html.escape(DEST[2])}<br />
    {html.escape(DEST[3])}
  </div>

  <div class="objet">{html.escape(OBJET)}</div>

""" + "".join(f"  <p>{html.escape(p)}</p>\n\n" for p in CORPS) \
    + bloc_rub(*RUB1) + "\n" + bloc_rub(*RUB2) + "\n" \
    + "".join(f"  <p>{html.escape(p)}</p>\n\n" for p in FIN) + f"""  <div class="sign">
    <div class="nom">{html.escape(SIGN[0])}</div>
    <div>{html.escape(SIGN[1])}</div>
  </div>

  <div class="pied">{html.escape(PIED)}</div>
</body>
</html>
"""
(BASE / f"{NOM}.html").write_text(doc, encoding="utf-8")

chrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
subprocess.run([chrome, "--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
                f"--print-to-pdf={BASE / (NOM + '.pdf')}", f"file://{BASE / (NOM + '.html')}"],
               capture_output=True)

# ---------------------------------------------------------------- DOCX
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

d = Document()
sec = d.sections[0]
sec.top_margin, sec.bottom_margin = Cm(2.2), Cm(1.8)
sec.left_margin = sec.right_margin = Cm(2.4)
st = d.styles["Normal"]
st.font.name, st.font.size = "Arial", Pt(10.5)
st.paragraph_format.space_after = Pt(10)
st.paragraph_format.line_spacing = 1.08

def para(txt, bold=False, align=None, space_after=10, caps_small=False):
    p = d.add_paragraph()
    r = p.add_run(txt); r.bold = bold
    if caps_small: r.font.size = Pt(9.5)
    p.paragraph_format.space_after = Pt(space_after)
    if align: p.alignment = align
    return p

para(EXP[0], bold=True, space_after=0)
para(EXP[1], space_after=0)
para(EXP[2], space_after=26)
para(DATE, align=WD_ALIGN_PARAGRAPH.RIGHT, space_after=18)
para(DEST[0], bold=True, space_after=0)
for l in DEST[1:]: para(l, space_after=0)
d.paragraphs[-1].paragraph_format.space_after = Pt(20)
para(OBJET, bold=True, space_after=16)
for p in CORPS: para(p, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
for titre, items in (RUB1, RUB2):
    para(titre, bold=True, space_after=4, caps_small=True)
    for i in items: para("— " + i, align=WD_ALIGN_PARAGRAPH.JUSTIFY, space_after=4)
    d.paragraphs[-1].paragraph_format.space_after = Pt(12)
for p in FIN: para(p, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
para("", space_after=24)
para(SIGN[0], bold=True, space_after=0)
para(SIGN[1], space_after=24)
pied = para(PIED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0)
r = pied.runs[0]; r.font.size = Pt(7.5); r.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

d.save(BASE / f"{NOM}.docx")
print("ok")
