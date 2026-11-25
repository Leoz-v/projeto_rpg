"""Importa o capítulo de magias do SRD 5.2.1 (pp. 107-175) para JSON e confere contra as listas de classe.

Requisitos: Python 3.10+ e `pdftotext` (poppler) no PATH.

Uso (a partir da raiz do repositório):
    python packages/rules-engine/srd-source/tools/import_spells.py [pdf] [saida.json]

Sem argumentos, lê `srd-source/SRD_CC_v5.2.1.pdf` e grava `src/srd/data/spells.json`.
Sai com código 1 se a conferência encontrar problemas (o JSON é gravado mesmo assim, para inspeção).
Ver docs/decisions/0007-importacao-das-magias.md; a resolução das magias de dano (curada em
`spell_resolution.py`) é da nota 0054.
"""
import json, re, subprocess, sys
from pathlib import Path

from spell_resolution import RESOLUTION

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

ABILITY_NAMES = {"str": "Strength", "dex": "Dexterity", "con": "Constitution", "int": "Intelligence", "wis": "Wisdom", "cha": "Charisma"}


def check_resolution(spell, parts, quotes, upgrade):
    """Confere a resolução curada contra o texto da magia; devolve a lista de problemas."""
    who, found = spell["name"], []
    flat = " ".join(spell["description"].split())
    upcast = flat.split("Using a Higher-Level Spell Slot.", 1)[1] if "Using a Higher-Level Spell Slot." in flat else ""
    for q in quotes:
        if q not in flat:
            found.append(f"{who}: citação não encontrada: '{q}'")
    END_TEXT = {"spell": ("until the spell ends", "for the duration"), "caster_turn_start": ("until the start of your next turn",),
                "caster_turn_end": ("until the end of your next turn",)}
    for part in parts:
        conditions = part.get("onHitConditions", []) + part.get("onFailConditions", []) + part.get("conditions", []) + part.get("endConditions", [])
        for c in conditions:
            if c.capitalize() not in flat:
                found.append(f"{who}: condição {c} fora do texto")
        if "conditionsEnd" in part and not any(t in flat for t in END_TEXT[part["conditionsEnd"]]):
            found.append(f"{who}: duração {part['conditionsEnd']} das condições fora do texto")
        if part["kind"] == "heal":
            h = part["healing"]
            if h == "full":
                if "regains all its Hit Points" not in flat:
                    found.append(f"{who}: cura de todos os PV fora do texto")
            else:
                if re.match(r"\d+(?:d\d+)?", h["dice"]).group(0) not in flat:
                    found.append(f"{who}: cura {h['dice']} fora do texto")
                if "perSlot" in h and f"by {h['perSlot']}" not in upcast and f"{h['perSlot']} additional" not in upcast:
                    found.append(f"{who}: escala da cura {h['perSlot']} fora de 'Using a Higher-Level Spell Slot'")
                if h.get("addModifier") and "plus your spellcasting ability modifier" not in flat:
                    found.append(f"{who}: modificador de conjuração fora do texto")
            if ("Temporary Hit Points" in flat) != bool(part.get("temporary")):
                found.append(f"{who}: PV temporários divergem do texto")
        if part["kind"] == "buff" or part.get("onFailEffects"):
            effects = part.get("onFailEffects", []) + part.get("effects", []) + [e for o in part.get("options", []) for e in o["effects"]] + part.get("upcast", [])
            for e in effects:
                if e["type"] in ("resistance", "damage_reduction") and e["damageType"].capitalize() not in flat and "Resistance to all damage" not in flat:
                    found.append(f"{who}: tipo {e['damageType']} fora do texto")
                if e["type"] == "d20_bonus" and e["dice"] not in flat:
                    found.append(f"{who}: dado {e['dice']} fora do texto")
                if e["type"] == "flat_bonus" and isinstance(e["value"], int) and str(abs(e["value"])) not in flat:
                    found.append(f"{who}: bônus {e['value']} fora do texto")
            if part.get("upcast") and not upcast:
                found.append(f"{who}: efeito por círculo sem 'Using a Higher-Level Spell Slot'")
        if part["kind"] == "save" and not part.get("damage") and part["onSuccess"] != "none":
            found.append(f"{who}: salvaguarda sem dano com metade no sucesso")
        for d in part.get("damage", []):
            base = re.match(r"\d+(?:d\d+)?", d["dice"]).group(0)
            if base not in flat:
                found.append(f"{who}: dado base {base} fora do texto")
            for t in d["type"] if isinstance(d["type"], list) else [d["type"]]:
                if t.capitalize() not in flat:
                    found.append(f"{who}: tipo {t} fora do texto")
            if "perSlot" in d and f"by {d['perSlot']}" not in upcast:
                found.append(f"{who}: escala {d['perSlot']} fora de 'Using a Higher-Level Spell Slot'")
            if d.get("addModifier") and "plus your spellcasting ability modifier" not in flat:
                found.append(f"{who}: modificador de conjuração fora do texto")
        if part.get("count", {}).get("perSlot") and not upcast:
            found.append(f"{who}: quantidade por círculo sem 'Using a Higher-Level Spell Slot'")
        if part["kind"] == "save" and f"{ABILITY_NAMES[part['ability']]} saving throw" not in flat:
            found.append(f"{who}: salvaguarda de {part['ability']} fora do texto")
        if part["kind"] == "attack" and f"{part['attackKind']} spell attack" not in flat.lower():
            found.append(f"{who}: ataque de magia {part['attackKind']} fora do texto")
        if spell["level"] == 0 and any("perSlot" in d for d in part.get("damage", [])):
            found.append(f"{who}: truque com escala por círculo")
    damaging = any(p.get("damage") for p in parts)
    if spell["level"] == 0 and any(p["kind"] == "heal" and p["healing"] != "full" and "perSlot" in p["healing"] for p in parts):
        found.append(f"{who}: truque com escala por círculo")
    if spell["level"] == 0 and damaging and (upgrade is None or "Cantrip Upgrade." not in flat):
        found.append(f"{who}: truque de dano sem a melhoria (Cantrip Upgrade)")
    if upgrade is not None and spell["level"] != 0:
        found.append(f"{who}: melhoria de truque numa magia de círculo {spell['level']}")
    if len(parts) > 1 and sum(1 for p in parts if "label" not in p) > 1:
        found.append(f"{who}: mais de uma parte sem nome")
    return found


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
    if name in RESOLUTION:
        parts, quotes, upgrade = RESOLUTION[name]
        problems.extend(check_resolution(spell, parts, quotes, upgrade))
        if upgrade:
            spell["cantripUpgrade"] = upgrade
        spell["resolution"] = parts
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

for nm in sorted(set(RESOLUTION) - {s["name"] for s in spells}):
    problems.append(f"resolução curada para magia inexistente: {nm}")

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
print("com resolução:", sum(1 for s in spells if "resolution" in s))
print("problemas:", len(problems))
for p in problems:
    print(" -", p)
sys.exit(1 if problems else 0)
