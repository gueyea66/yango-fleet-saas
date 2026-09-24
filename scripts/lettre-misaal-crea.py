# -*- coding: utf-8 -*-
"""Génère la lettre d'agrément Misaal Créa SARL en .docx et en .html (→ PDF)."""
import html, subprocess, pathlib

EXP = ["MISAAL CRÉA SARL",
       "Organisation de manifestations — production audiovisuelle",
       "HLM 4, Villa n° 1385 — Dakar, Sénégal",
       "Tél. : +221 77 645 90 48"]
DATE = "Dakar, le 24 septembre 2026"
DEST = ["FONSTAB", "Madame l'Administratrice",
        "Sphères ministérielles Ousmane Tanor Dieng", "Bâtiment C — Diamniadio, Sénégal"]
OBJET = "Objet : demande d'agrément — organisation et couverture de manifestations"

CORPS = [
  "Madame l'Administratrice,",
  "Misaal Créa est une société établie à Dakar depuis 2016. Nous organisons des manifestations "
  "professionnelles et institutionnelles — ateliers, séminaires, cérémonies, lancements, visites "
  "de terrain — et nous en assurons le traitement audiovisuel. Nous sollicitons votre agrément "
  "comme prestataire événementiel.",
  "Notre intervention commence à la conception : choix du lieu, déroulé minuté, habillage de la "
  "scène et de la salle. Le jour venu, nous installons le son, la lumière et les écrans, nous "
  "tenons le minutage des interventions et nous restons en salle jusqu'au démontage.",
  "Notre métier d'origine, la production vidéo, fait la différence sur le reste : caméras, "
  "matériel son et lumière et salle de montage nous appartiennent. Vous repartez donc de chaque "
  "manifestation avec un film de restitution, des séquences courtes pour vos supports, des "
  "photographies et l'enregistrement des interventions, sans passer par un second prestataire. "
  "La diffusion en direct est possible pour les participants qui ne peuvent se déplacer.",
  "Chaque manifestation fait l'objet d'un devis préalable, d'un interlocuteur unique jusqu'à la "
  "livraison, et d'une remise des images et du film dans les jours qui suivent.",
  "Misaal Créa SARL est immatriculée au registre du commerce sous le numéro SN DKR 2016 B 19405 "
  "et dispose du NINEA 006037908. Ses activités déclarées portent sur la production vidéo — "
  "cinéma et télévision — ainsi que sur la formation.",
  "Les documents d'immatriculation sont joints à la présente. Nous nous tenons prêts à vous "
  "présenter nos réalisations.",
  "Nous vous prions de croire, Madame l'Administratrice, à l'assurance de notre parfaite "
  "considération.",
]
SIGN = ["Le Gérant"]
PIED = ("MISAAL CRÉA SARL au capital de 100 000 F CFA — RCCM SN DKR 2016 B 19405 — "
        "NINEA 006037908 — HLM 4, Villa n° 1385, Dakar — Tél. : +221 77 645 90 48")

BASE = pathlib.Path(__file__).resolve().parents[1] / "docs"
NOM = "lettre-agrement-fonstab-misaal-crea"

# ---------------------------------------------------------------- HTML → PDF
doc = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Misaal Créa SARL — Demande d'agrément</title>
<style>
  @page {{ size: A4; margin: 16mm 23mm 12mm 23mm; }}
  body {{ font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.4pt;
         line-height: 1.45; color: #1a1a1a; margin: 0; }}
  .exp {{ text-align: right; margin-bottom: 10mm; }}
  .exp .nom {{ font-size: 13pt; font-weight: 600; letter-spacing: .06em; }}
  .exp .quoi {{ font-size: 8.6pt; color: #555; font-style: italic; margin-top: .8mm; }}
  .exp .adr {{ font-size: 8.6pt; color: #555; margin-top: 2.5mm; line-height: 1.55; }}
  .dest {{ margin-bottom: 8mm; line-height: 1.45; }}
  .dest .nom {{ font-weight: 600; }}
  .date {{ margin-bottom: 7mm; }}
  .objet {{ margin-bottom: 6mm; font-weight: 600; }}
  p {{ margin: 0 0 3.4mm; text-align: justify; }}
  .sign {{ margin-top: 8mm; }}
  .sign .role {{ font-weight: 600; }}
  .pied {{ margin-top: 9mm; padding-top: 2.5mm; border-top: .5pt solid #ccc;
           font-size: 7.3pt; color: #777; text-align: left; }}
</style>
</head>
<body>
  <div class="exp">
    <div class="nom">{html.escape(EXP[0])}</div>
    <div class="quoi">{html.escape(EXP[1])}</div>
    <div class="adr">{html.escape(EXP[2])}<br />{html.escape(EXP[3])}</div>
  </div>

  <div class="dest">
    <span class="nom">{html.escape(DEST[0])}</span><br />
    {html.escape(DEST[1])}<br />
    {html.escape(DEST[2])}<br />
    {html.escape(DEST[3])}
  </div>

  <div class="date">{html.escape(DATE)}</div>

  <div class="objet">{html.escape(OBJET)}</div>

""" + "".join(f"  <p>{html.escape(p)}</p>\n\n" for p in CORPS) + f"""  <div class="sign">
    <div class="role">{html.escape(SIGN[0])}</div>
  </div>

  <div class="pied">{html.escape(PIED)}</div>
</body>
</html>
"""
(BASE / f"{NOM}.html").write_text(doc, encoding="utf-8")
subprocess.run(["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "--headless", "--disable-gpu",
                "--no-sandbox", "--no-pdf-header-footer",
                f"--print-to-pdf={BASE / (NOM + '.pdf')}", f"file://{BASE / (NOM + '.html')}"],
               capture_output=True)

# ---------------------------------------------------------------- DOCX
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

d = Document()
sec = d.sections[0]
sec.top_margin, sec.bottom_margin = Cm(1.8), Cm(1.4)
sec.left_margin = sec.right_margin = Cm(2.4)
st = d.styles["Normal"]
st.font.name, st.font.size = "Calibri", Pt(11)
st.paragraph_format.space_after = Pt(10)
st.paragraph_format.line_spacing = 1.15
GRIS = RGBColor(0x55, 0x55, 0x55)

def para(txt="", bold=False, italic=False, align=None, space_after=10, size=None, color=None):
    p = d.add_paragraph()
    if txt:
        r = p.add_run(txt); r.bold = bold; r.italic = italic
        if size: r.font.size = Pt(size)
        if color: r.font.color.rgb = color
    p.paragraph_format.space_after = Pt(space_after)
    if align: p.alignment = align
    return p

R = WD_ALIGN_PARAGRAPH.RIGHT
para(EXP[0], bold=True, align=R, space_after=0, size=13)
para(EXP[1], italic=True, align=R, space_after=6, size=8.5, color=GRIS)
para(EXP[2], align=R, space_after=0, size=8.5, color=GRIS)
para(EXP[3], align=R, space_after=26, size=8.5, color=GRIS)
para(DEST[0], bold=True, space_after=0)
for l in DEST[1:]: para(l, space_after=0)
d.paragraphs[-1].paragraph_format.space_after = Pt(22)
para(DATE, space_after=18)
para(OBJET, bold=True, space_after=16)
for p in CORPS: para(p, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
para("", space_after=22)
para(SIGN[0], bold=True, space_after=22)
para(PIED, space_after=0, size=7.5, color=RGBColor(0x77,0x77,0x77))
d.save(BASE / f"{NOM}.docx")
print("ok")
