"""Importa o capítulo de magias do SRD 5.2.1 (pp. 107-175) para JSON e confere contra as listas de classe.

Requisitos: Python 3.10+ e `pdftotext` (poppler) no PATH.

Uso (a partir da raiz do repositório):
    python packages/rules-engine/srd-source/tools/import_spells.py [pdf] [saida.json]

Sem argumentos, lê `srd-source/SRD_CC_v5.2.1.pdf` e grava `src/srd/data/spells.json`.
Sai com código 1 se a conferência encontrar problemas (o JSON é gravado mesmo assim, para inspeção).
Ver docs/decisions/0007-importacao-das-magias.md.
"""
import json, re, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
PDF = sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent / "SRD_CC_v5.2.1.pdf")
OUT = sys.argv[2] if len(sys.argv) > 2 else str(HERE.parent.parent / "src" / "srd" / "data" / "spells.json")
SCHOOLS = ["Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"]
CLASSES = ["Bard", "Cleric", "Druid", "Paladin", "Ranger", "Sorcerer", "Warlock", "Wizard"]
LIST_PAGES = {"Bard": (33, 35), "Cleric": (38, 40), "Druid": (44, 46), "Paladin": (55, 56), "Ranger": (60, 61),
              "Sorcerer": (67, 69), "Warlock": (74, 76), "Wizard": (79, 82)}

def text(first, last, layout=False):
    args = ["pdftotext", "-q", "-enc", "UTF-8", "-f", str(first), "-l", str(last)] + (["-layout"] if layout else []) + [PDF, "-"]
    return subprocess.run(args, capture_output=True, check=True).stdout.decode("utf-8")

def clean(raw):
    """Remove rodapés e quebras de página/coluna e junta parágrafos partidos."""
    # Apóstrofo tipográfico vira ASCII (como no resto dos dados); travessões do PDF viram hífen.
    raw = raw.replace("\f", "\n").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    raw = raw.replace("­", "").replace("−", "-").replace("‑", "-").replace("–", "-").replace("—", "--").replace("�", "-")
    lines = []
    for line in raw.split("\n"):
        s = line.strip()
        if re.fullmatch(r"\d+( System Reference Document 5\.2(\.1)?)?", s) or s in ("System Reference Document 5.2.1", "Spell Descriptions"):
            continue
        lines.append(s)
    out = []
    for s in lines:
        if not s:
            continue
        if out:
            prev = out[-1]
            # Hifenização de fim de linha: "Callig-" + "rapher".
            if prev.endswith("-") and not prev.endswith("--") and s[:1].islower():
                out[-1] = prev[:-1] + s
                continue
            # Parágrafo partido por coluna/página: anterior sem pontuação final e atual começando em minúscula.
            if not re.search(r"[.:!?\")]$", prev) and s[:1].islower():
                out[-1] = prev + " " + s
                continue
        out.append(s)
    return out

HEADER = re.compile(r"^(?:Level ([1-9]) (" + "|".join(SCHOOLS) + r")|(" + "|".join(SCHOOLS) + r") Cantrip) \(([^)]+)\)$")
# O SRD às vezes escreve "Component:" no singular.
FIELDS = re.compile(r"^Casting Time: (.+?) Range: (.+?) Components?: (.+?) Duration: (.+)$")

def snake(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower().replace("'", "")).strip("_")

lines = clean(text(107, 175))
starts = [i for i, l in enumerate(lines) if HEADER.match(l)]
spells, problems = [], []
for n, h in enumerate(starts):
    name = lines[h - 1]
    m = HEADER.match(lines[h])
    level = int(m.group(1)) if m.group(1) else 0
    school = (m.group(2) or m.group(3)).lower()
    classes = [c.strip().lower() for c in m.group(4).split(",")]
    end = starts[n + 1] - 1 if n + 1 < len(starts) else len(lines)
    body = lines[h + 1:end]
    # Os campos podem vir partidos em várias linhas: junta até achar "Duration: ...".
    fields_text, k = "", 0
    while k < len(body):
        fields_text = (fields_text + " " + body[k]).strip()
        k += 1
        if "Duration:" in fields_text:
            break
    f = FIELDS.match(fields_text)
    if not f:
        problems.append(f"{name}: campos não reconhecidos: {fields_text[:120]}")
        continue
    casting, rng, comps, duration = (x.strip() for x in f.groups())
    ritual = casting.endswith(" or Ritual")
    if ritual:
        casting = casting[: -len(" or Ritual")]
    cm = re.fullmatch(r"(V)?(?:, )?(S)?(?:, )?(?:M \((.+)\))?", comps)
    if not cm or not (cm.group(1) or cm.group(2) or cm.group(3)):
        problems.append(f"{name}: componentes não reconhecidos: {comps}")
        continue
    components = {"verbal": bool(cm.group(1)), "somatic": bool(cm.group(2))}
    if cm.group(3):
        components["material"] = cm.group(3)
    concentration = duration.startswith("Concentration, ")
    unknown = [c for c in classes if c.capitalize() not in CLASSES]
    if unknown:
        problems.append(f"{name}: classes desconhecidas {unknown}")
    description = "\n".join(body[k:]).strip()
    if not description:
        problems.append(f"{name}: sem descrição")
    spell = {"id": snake(name), "name": name, "level": level, "school": school, "castingTime": casting, "range": rng,
             "components": components, "duration": duration}
    if concentration:
        spell["concentration"] = True
    if ritual:
        spell["ritual"] = True
    spell["classes"] = classes
    spell["description"] = description
    spells.append(spell)

# --- Conferência contra as listas de magias das classes -------------------------
# Nomes iguais a escolas ("Divination") colidem com a coluna School das tabelas: conferidos à mão.
SCHOOL_NAMES = set(SCHOOLS)
# Inconsistências do próprio SRD: a entrada da magia declara a classe, mas a lista da classe a omite.
# Seguimos a entrada da magia (mais específica).
KNOWN_SRD_GAPS = {("Bard", "Phantasmal Force"), ("Sorcerer", "Phantasmal Force"), ("Wizard", "Phantasmal Force"), ("Sorcerer", "Mind Spike")}
names = sorted({s["name"] for s in spells}, key=len, reverse=True)
by_name = {s["name"]: s for s in spells}
for cls, (first, last) in LIST_PAGES.items():
    raw = " ".join(clean(text(first, last)))
    start = raw.find(f"{cls} Spell List")
    stop = raw.find(f"{cls} Subclass:", start)
    section = raw[start:stop if stop > 0 else None]
    found = set()
    for nm in names:  # do mais longo para o mais curto: "Shield of Faith" antes de "Shield"
        pattern = re.compile(r"(?<![\w'])" + re.escape(nm) + r"(?![\w'])")
        if pattern.search(section):
            found.add(nm)
            section = pattern.sub(" ", section)
    declared = {s["name"] for s in spells if cls.lower() in s["classes"]}
    for nm in sorted(declared - found):
        if nm in SCHOOL_NAMES:
            continue
        if (cls, nm) in KNOWN_SRD_GAPS:
            print(f"   inconsistência conhecida do SRD: {cls} / {nm}")
            continue
        problems.append(f"{cls}: '{nm}' declara a classe mas não está na lista")
    for nm in sorted(found - declared):
        if nm in SCHOOL_NAMES:
            continue
        problems.append(f"{cls}: '{nm}' está na lista mas não declara a classe")

ids = [s["id"] for s in spells]
dups = {i for i in ids if ids.count(i) > 1}
if dups:
    problems.append(f"ids repetidos: {sorted(dups)}")

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(spells, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
per_level = {lv: sum(1 for s in spells if s["level"] == lv) for lv in range(10)}
per_class = {c: sum(1 for s in spells if c.lower() in s["classes"]) for c in CLASSES}
print("magias:", len(spells), "por nível:", per_level)
print("por classe:", per_class)
print("problemas:", len(problems))
for p in problems:
    print(" -", p)
sys.exit(1 if problems else 0)
