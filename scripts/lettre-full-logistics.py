# -*- coding: utf-8 -*-
"""Génère la lettre d'agrément Full Logistics SARL en .docx et en .html (→ PDF)."""
import html, subprocess, pathlib

EXP = ["FULL LOGISTICS SARL",
       "Société à responsabilité limitée au capital de 100 000 F CFA",
       "HLM Mariste, Îlot Z, Villa n° 4 — Dakar, Sénégal",
       "Tél. : +221 77 645 65 17"]
DATE = "Dakar, le 24 septembre 2026"
DEST = ["FONSTAB", "Madame l'Administratrice",
        "Sphères ministérielles Ousmane Tanor Dieng", "Bâtiment C — Diamniadio, Sénégal"]
OBJET = "Objet : demande d'agrément — logistique des manifestations et transport de personnes"

INTRO = ["Madame l'Administratrice,",
  "Full Logistics est une société de logistique et de transport de personnes établie à Dakar. "
  "Nous mettons ces moyens au service des manifestations : réunions, ateliers, missions de "
  "terrain, cérémonies et voyages d'étude, à Dakar comme à l'intérieur du pays."]

BLOCS = [
  ("Déplacements.",
   "Véhicules avec chauffeur pour les délégations, navettes entre les hôtels et le lieu de la "
   "rencontre, rotations vers les sites visités. Le plan de transport est établi à partir de "
   "votre programme, et nous répondons des horaires."),
  ("Manutention et installation.",
   "Chargement, acheminement et mise en place du matériel : sonorisation, mobilier, stands, "
   "supports d'exposition, dotations à distribuer. Reprise et stockage une fois la manifestation "
   "terminée."),
  ("Accueil et séjour.",
   "Prise en charge des participants venus des régions ou de l'étranger : accueil à l'aéroport, "
   "réservations d'hôtel, restauration, programme d'accompagnement."),
]

FIN = [
  "Chaque mission donne lieu à un ordre de mission chiffré, à la désignation d'un coordonnateur "
  "et à un rapport de fin de prestation accompagné des justificatifs.",
  "Full Logistics SARL est immatriculée au registre du commerce sous le numéro SN DKR 2024 B 11455 "
  "et dispose du NINEA 011088152. Nos activités déclarées couvrent la manutention et le shipping, "
  "le transport routier, le transport de personnes et le tourisme.",
  "Nous sollicitons votre agrément à ce titre. Nos documents d'immatriculation sont joints à la "
  "présente.",
  "Dans l'attente d'une suite favorable, nous vous prions d'agréer, Madame l'Administratrice, "
  "l'expression de notre haute considération.",
]
SIGN = ["Babacar GUEYE", "Gérant"]
PIED = ("FULL LOGISTICS SARL — RCCM SN DKR 2024 B 11455 — NINEA 011088152 — "
        "HLM Mariste, Dakar — Tél. : +221 77 645 65 17")

BASE = pathlib.Path(__file__).resolve().parents[1] / "docs"
NOM = "lettre-agrement-fonstab-full-logistics"

# ---------------------------------------------------------------- HTML → PDF
blocs_html = "".join(
    f"  <p><b>{html.escape(t)}</b> {html.escape(c)}</p>\n\n" for t, c in BLOCS)

doc = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Full Logistics SARL — Demande d'agrément</title>
<style>
  @page {{ size: A4; margin: 17mm 23mm 13mm 23mm; }}
  body {{ font-family: Georgia, "Times New Roman", serif; font-size: 10.8pt; line-height: 1.42;
         color: #111; margin: 0; }}
  .exp {{ text-align: center; padding-bottom: 3mm; }}
  .exp .nom {{ font-size: 15pt; letter-spacing: .22em; font-variant: small-caps; font-weight: bold; }}
  .exp .legal {{ font-size: 8.2pt; color: #555; margin-top: 1.5mm; line-height: 1.5; }}
  .double {{ border-top: 1.6pt solid #111; border-bottom: .6pt solid #111; height: 1.2mm;
             margin-bottom: 9mm; }}
  .date {{ text-align: right; margin-bottom: 7mm; }}
  .dest {{ margin-bottom: 7mm; line-height: 1.4; }}
  .dest .nom {{ font-weight: bold; }}
  .objet {{ margin-bottom: 6mm; }}
  .objet b {{ font-variant: small-caps; letter-spacing: .03em; }}
  p {{ margin: 0 0 3.4mm; text-align: justify; }}
  .sign {{ margin-top: 8mm; }}
  .sign .nom {{ font-weight: bold; margin-top: 12mm; }}
  .sign .role {{ font-size: 9.6pt; color: #555; }}
  .pied {{ margin-top: 9mm; padding-top: 2.5mm; border-top: .5pt solid #bbb;
           font-size: 7.4pt; color: #666; text-align: center; font-family: Arial, sans-serif; }}
</style>
</head>
<body>
  <div class="exp">
    <div class="nom">{html.escape(EXP[0])}</div>
    <div class="legal">{html.escape(EXP[1])}<br />{html.escape(EXP[2])} &nbsp;—&nbsp; {html.escape(EXP[3])}</div>
  </div>
  <div class="double"></div>

  <div class="date">{html.escape(DATE)}</div>

  <div class="dest">
    <span class="nom">{html.escape(DEST[0])}</span><br />
    {html.escape(DEST[1])}<br />
    {html.escape(DEST[2])}<br />
    {html.escape(DEST[3])}
  </div>

  <div class="objet"><b>{html.escape(OBJET)}</b></div>

""" + "".join(f"  <p>{html.escape(p)}</p>\n\n" for p in INTRO) + blocs_html \
    + "".join(f"  <p>{html.escape(p)}</p>\n\n" for p in FIN) + f"""  <div class="sign">
    <div class="nom">{html.escape(SIGN[0])}</div>
    <div class="role">{html.escape(SIGN[1])}</div>
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
sec.top_margin, sec.bottom_margin = Cm(1.7), Cm(1.3)
sec.left_margin = sec.right_margin = Cm(2.3)
st = d.styles["Normal"]
st.font.name, st.font.size = "Georgia", Pt(10.5)
st.paragraph_format.space_after = Pt(9)
st.paragraph_format.line_spacing = 1.1

def para(txt="", bold=False, align=None, space_after=9, size=None, color=None):
    p = d.add_paragraph()
    if txt:
        r = p.add_run(txt); r.bold = bold
        if size: r.font.size = Pt(size)
        if color: r.font.color.rgb = color
    p.paragraph_format.space_after = Pt(space_after)
    if align: p.alignment = align
    return p

GRIS = RGBColor(0x55, 0x55, 0x55)
para(EXP[0], bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2, size=14)
para(EXP[1], align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0, size=8, color=GRIS)
para(f"{EXP[2]} — {EXP[3]}", align=WD_ALIGN_PARAGRAPH.CENTER, space_after=22, size=8, color=GRIS)
para(DATE, align=WD_ALIGN_PARAGRAPH.RIGHT, space_after=16)
para(DEST[0], bold=True, space_after=0)
for l in DEST[1:]: para(l, space_after=0)
d.paragraphs[-1].paragraph_format.space_after = Pt(18)
para(OBJET, bold=True, space_after=14)
for p in INTRO: para(p, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
for titre, corps in BLOCS:
    p = d.add_paragraph()
    r = p.add_run(titre + " "); r.bold = True
    p.add_run(corps)
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_after = Pt(9)
for p in FIN: para(p, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
para("", space_after=22)
para(SIGN[0], bold=True, space_after=0)
para(SIGN[1], space_after=20, size=9.5, color=GRIS)
para(PIED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0, size=7.5, color=RGBColor(0x66,0x66,0x66))
d.save(BASE / f"{NOM}.docx")
print("ok")
