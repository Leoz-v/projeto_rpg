"""Importa ferramentas e equipamento de aventura do SRD 5.2.1 (pp. 93-100) para JSON.

Requisitos: Python 3.10+ e `pdftotext` (poppler) no PATH.

Uso (a partir da raiz do repositório):
    python packages/rules-engine/srd-source/tools/import_gear.py [pdf]

Sem argumentos, lê `srd-source/SRD_CC_v5.2.1.pdf` e grava `src/srd/data/tools.json` e `src/srd/data/gear.json`.

Conferências independentes:
- cada linha da tabela Adventuring Gear (p. 95) tem uma descrição, e o preço da descrição é o da tabela;
- o peso de cada pacote (Burglar's Pack etc.) é a soma do peso do que ele contém;
- tudo o que uma ferramenta fabrica (`Craft`) e tudo o que um pacote contém existe no compêndio;
- as proficiências em ferramenta já usadas por antecedentes e classes existem.

Sai com código 1 se houver problema (os JSON são gravados mesmo assim, para inspeção).
Ver docs/decisions/0013-ferramentas-e-equipamento.md.
"""
import json, re, subprocess, sys
from fractions import Fraction
from pathlib import Path

import item_use

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
DATA = HERE.parent.parent / "src" / "srd" / "data"
PDF = sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent / "SRD_CC_v5.2.1.pdf")
ABILITY_NAMES = {"Strength": "str", "Dexterity": "dex", "Constitution": "con", "Intelligence": "int", "Wisdom": "wis",
                 "Charisma": "cha"}
used = set()
problems = []


def text(first, last, raw=False):
    args = ["pdftotext", "-q", "-enc", "UTF-8", "-f", str(first), "-l", str(last)] + (["-raw"] if raw else []) + [PDF, "-"]
    out = subprocess.run(args, capture_output=True, check=True).stdout.decode("utf-8")
    out = out.replace("\f", "\n").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    out = out.replace("­", "").replace("−", "-").replace("‑", "-").replace("–", "-").replace("—", "--").replace("\t", " ")
    return [re.sub(r" {2,}", " ", l.strip()) for l in out.split("\n")]


def is_footer(s):
    return re.fullmatch(r"\d+( System Reference Document 5\.2(\.1)?)?", s) or s == "System Reference Document 5.2.1"


def join(lines):
    """Junta linhas de um parágrafo, desfazendo a hifenização de fim de linha."""
    out = ""
    for s in lines:
        if out.endswith("-") and not out.endswith("--") and s[:1].islower():
            out = out[:-1] + s
        else:
            out = (out + " " + s).strip()
    return out


def paragraphs(lines):
    """Agrupa linhas em parágrafos: começa um novo quando a linha anterior termina uma frase e a atual é maiúscula."""
    paras, cur = [], []
    for s in lines:
        if not s or is_footer(s):
            continue
        if cur and re.search(r"[.:!?\")]$", cur[-1]) and s[:1].isupper():
            paras.append(join(cur))
            cur = []
        cur.append(s)
    if cur:
        paras.append(join(cur))
    return paras


def snake(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower().replace("'", "")).strip("_")


def cost(s):
    m = re.fullmatch(r"([\d,]+) (GP|SP|CP|EP|PP)", s.strip())
    if not m:
        return None
    return {"amount": int(m.group(1).replace(",", "")), "coin": m.group(2).lower()}


def weight(s):
    s = s.strip()
    if s == "--":
        return 0
    m = re.fullmatch(r"(\d+)?(½|1/2)? ?lb\.(?: \(full\))?", s)
    if not m:
        return None
    w = Fraction(int(m.group(1) or 0)) + (Fraction(1, 2) if m.group(2) else 0)
    return float(w) if w.denominator != 1 else int(w)


def natural(name):
    """Nome da tabela em ordem alfabética para o nome corrido: `Bottle, Glass` -> `Glass Bottle`."""
    m = re.fullmatch(r"(.+?), (.+)", name)
    if not m:
        return name
    head, qual = m.groups()
    if head in ("Case", "Clothes", "Lantern", "Bottle", "Pot", "Ram", "Spikes", "Poison"):
        return f"{qual} {head}"
    if head == "Bullets":
        return f"{qual} Bullets"
    return name


def to_gp(c):
    return Fraction(c["amount"]) * {"cp": Fraction(1, 100), "sp": Fraction(1, 10), "ep": Fraction(1, 2), "gp": 1, "pp": 10}[c["coin"]]


# --- Ferramentas (pp. 93-94) ----------------------------------------------------------------------------------
tool_lines = text(93, 94)
start = tool_lines.index("Artisan's Tools")
stop = tool_lines.index("Adventuring Gear")
TOOL_HEAD = re.compile(r"^([A-Z].+?) \((Varies|[\d,]+ (?:GP|SP|CP))\)$")
tools, entry, category = [], None, "artisan"
for s in tool_lines[start + 1:stop]:
    if not s or is_footer(s):
        continue
    if s == "Other Tools":
        category = "other"
        continue
    m = TOOL_HEAD.match(s)
    if m and not s.startswith(("Utilize", "Craft", "Variants")):
        entry = {"name": m.group(1), "cost": m.group(2), "category": category, "fields": {}, "last": None}
        tools.append(entry)
        continue
    if entry is None:
        continue
    fm = re.match(r"^(Ability|Weight|Utilize|Craft|Variants): (.*)$", s)
    if fm:
        entry["fields"][fm.group(1)] = [fm.group(2)]
        entry["last"] = fm.group(1)
    elif entry["last"]:
        entry["fields"][entry["last"]].append(s)

tool_items = []
for t in tools:
    f = {k: join(v) for k, v in t["fields"].items()}
    ability = ABILITY_NAMES.get(f.get("Ability", "").strip())
    if not ability:
        problems.append(f"{t['name']}: atributo não reconhecido")
    if "Utilize" not in f:
        problems.append(f"{t['name']}: sem Utilize ({sorted(f)})")
        continue
    base = {"kind": "tool", "category": t["category"], "ability": ability, "utilize": f["Utilize"]}
    if "Craft" in f:
        base["craft"] = [x.strip() for x in re.split(r",(?![^(]*\))", f["Craft"])]
    if "Variants" in f:
        # Gaming Set e Musical Instrument: cada variante exige proficiência própria e vira um item.
        group = "gaming_set" if t["name"] == "Gaming Set" else "musical_instrument"
        for v in re.split(r",(?![^(]*\))", f["Variants"]):
            vm = re.fullmatch(r"\s*([A-Za-z][a-z -]*?) \(([^)]+)\)\s*", v)
            if not vm:
                problems.append(f"{t['name']}: variante não reconhecida: {v}")
                continue
            vname, details = vm.groups()
            parts = [p.strip() for p in details.split(",")]
            item = {"id": f"{group}_{snake(vname)}", "name": f"{t['name']} ({vname[0].upper() + vname[1:]})",
                    **base, "category": group}
            item["cost"] = cost(parts[0])
            w = weight(parts[1]) if len(parts) > 1 else weight(f.get("Weight", ""))
            if w is None:
                problems.append(f"{item['name']}: peso não reconhecido")
            else:
                item["weight"] = w
            tool_items.append(item)
        continue
    item = {"id": snake(t["name"]), "name": t["name"], **base, "cost": cost(t["cost"]), "weight": weight(f.get("Weight", ""))}
    if item["cost"] is None or item["weight"] is None:
        problems.append(f"{t['name']}: preço ou peso não reconhecido")
    tool_items.append(item)

# --- Tabela Adventuring Gear (p. 95) e tabelas auxiliares (p. 96) ---------------------------------------------
table = []
for s in text(95, 95, raw=True):
    m = re.fullmatch(r"(.+?) (Varies|--|[\d½/]+ lb\.(?: \(full\))?) (Varies|[\d,]+ (?:GP|SP|CP))", s)
    if m and m.group(1) != "Item":
        table.append({"name": m.group(1), "weight": m.group(2), "cost": m.group(3)})

aux = text(96, 97, raw=True)
ammo, focuses = [], {}
section = None
for s in aux:
    if s in ("Ammunition", "Arcane Focuses", "Druidic Focuses", "Holy Symbols"):
        section = s
        continue
    if section == "Ammunition":
        m = re.fullmatch(r"(.+?) (\d+) (Quiver|Case|Pouch) ([\d½]+ lb\.) ([\d,]+ (?:GP|SP|CP))", s)
        if m:
            ammo.append(m.groups())
        elif ammo:
            section = None
    elif section:
        m = re.fullmatch(r"(.+?) (--|[\d½]+ lb\.) ([\d,]+ (?:GP|SP|CP))", s)
        if m and m.group(1) not in ("Focus", "Symbol"):
            focuses.setdefault(section, []).append(m.groups())
        elif focuses.get(section) and not m:
            section = None

# --- Descrições (pp. 94-100) ----------------------------------------------------------------------------------
desc_lines = text(94, 100)
desc_lines = desc_lines[desc_lines.index("Adventuring Gear") + 1:]
# Termina antes das montarias e veículos.
desc_lines = desc_lines[: next(i for i, s in enumerate(desc_lines) if s.startswith("Mounts and Vehicles"))]
GEAR_HEAD = re.compile(r"^(.+?) \((Varies|[\d,]+ (?:GP|SP|CP))\)$")
descriptions, cur = {}, None
skip_tables = {"Arcane Focuses", "Druidic Focuses", "Holy Symbols", "Ammunition"}
i = 0
body = []
for s in desc_lines:
    # "Spell Scroll (Cantrip, 30 GP;" + "Level 1, 50 GP)" vem partido.
    if s.startswith("Spell Scroll (Cantrip, 30 GP;"):
        cur = "Spell Scroll"
        descriptions[cur] = {"cost": "Varies", "lines": []}
        continue
    if cur == "Spell Scroll" and s == "Level 1, 50 GP)":
        continue
    m = GEAR_HEAD.match(s)
    if m and not s.startswith(("A ", "An ", "The ")):
        cur = m.group(1)
        descriptions[cur] = {"cost": m.group(2), "lines": []}
        continue
    if cur:
        descriptions[cur]["lines"].append(s)


def clean_description(lines):
    # Tabelas embutidas (focos, munição, símbolos sagrados) já viraram itens próprios: saem do texto.
    # No PDF elas vêm como "Arcane Focuses Focus Crystal ...", "Weight 1 lb. ...", "Cost 10 GP ...".
    out = []
    for p in paragraphs(lines):
        if any(p.startswith(t) for t in skip_tables) or re.match(r"^(Weight|Cost|Amount|Storage) ", p):
            continue
        out.append(p)
    return "\n".join(out)


# --- Montagem dos itens de equipamento ------------------------------------------------------------------------
CONSUMABLE = {"Acid", "Alchemist's Fire", "Antitoxin", "Candle", "Holy Water", "Oil", "Paper", "Parchment", "Perfume",
              "Poison, Basic", "Potion of Healing", "Rations", "Spell Scroll (Cantrip)", "Spell Scroll (Level 1)", "Torch",
              "Ink"}
# Itens vendidos em lote: preço e peso valem para `perPurchase` unidades.
BUNDLES = {"Spikes, Iron": 10}
GENERIC = {"Ammunition", "Arcane Focus", "Druidic Focus", "Holy Symbol"}
# Itens mágicos listados na tabela de equipamento: vêm de import_magic_items.py (com o preço e o peso daqui).
MAGIC = {"Potion of Healing", "Spell Scroll (Cantrip)", "Spell Scroll (Level 1)"}
table_names = {r["name"] for r in table}
gear = []
for row in table:
    name = row["name"]
    if name in GENERIC or name in MAGIC:
        continue
    key = "Spell Scroll" if name.startswith("Spell Scroll") else name
    d = descriptions.get(key)
    if not d:
        problems.append(f"{name}: sem descrição")
        continue
    if key != "Spell Scroll" and d["cost"] != row["cost"]:
        problems.append(f"{name}: preço da descrição ({d['cost']}) difere da tabela ({row['cost']})")
    nat = natural(name)
    item = {"id": snake(nat), "name": nat, "kind": "gear", "weight": weight(row["weight"]), "cost": cost(row["cost"])}
    if item["weight"] is None or item["cost"] is None:
        problems.append(f"{name}: peso ou preço não reconhecido")
    if name in BUNDLES:
        item["perPurchase"] = BUNDLES[name]
    if name in CONSUMABLE:
        item["consumable"] = True
    item["description"] = clean_description(d["lines"])
    used |= item_use.put(item, item_use.GEAR_USE, problems)
    gear.append(item)
for name in descriptions:
    if name not in table_names and name not in GENERIC and name not in MAGIC and name != "Spell Scroll":
        problems.append(f"{name}: descrição sem linha na tabela")

for typ, amount, storage, w, c in ammo:
    nat = natural(typ)
    gear.append({"id": snake(nat), "name": nat, "kind": "gear", "weight": weight(w), "cost": cost(c), "perPurchase": int(amount),
                 "consumable": True, "description": f"Ammunition, sold in bundles of {amount}. Typically stored in a {storage}."})
FOCUS_KIND = {"Arcane Focuses": ("arcane", "Arcane Focus"), "Druidic Focuses": ("druidic", "Druidic Focus"),
              "Holy Symbols": ("holy_symbol", "Holy Symbol")}
for section, rows in focuses.items():
    kind, label = FOCUS_KIND[section]
    for form, w, c in rows:
        fm = re.fullmatch(r"(.+?)(?: \((.+)\))?", form)
        fname, note = fm.group(1), fm.group(2)
        item = {"id": snake(f"{label} {fname}"), "name": f"{label} ({fname.capitalize()})", "kind": "gear", "weight": weight(w),
                "cost": cost(c), "focus": kind}
        item["description"] = clean_description(descriptions[label]["lines"]) + (f"\n{note[0].upper() + note[1:]}." if note else "")
        gear.append(item)

# --- Conteúdo dos pacotes --------------------------------------------------------------------------------------
by_name = {}
for f in ("weapons.json", "armor.json"):
    for it in json.load(open(DATA / f, encoding="utf-8")):
        by_name[it["name"].lower()] = it
for it in gear + tool_items:
    by_name[it["name"].lower()] = it
ALIASES = {"oil": "oil", "rations": "rations", "torches": "torch", "candles": "candle", "costumes": "costume",
           "ink pens": "ink pen", "map or scroll cases": "map or scroll case", "paper": "paper", "parchment": "parchment"}


def resolve(name):
    n = name.lower()
    n = ALIASES.get(n, n)
    if n in by_name:
        return by_name[n]
    if n.endswith("s") and n[:-1] in by_name:
        return by_name[n[:-1]]
    return None


for item in gear:
    if not item["name"].endswith("Pack"):
        continue
    m = re.search(r"contains the following items: (.+?)\.$", item["description"].replace("\n", " "))
    if not m:
        problems.append(f"{item['name']}: conteúdo não encontrado")
        continue
    contents, total = [], Fraction(0)
    for part in re.split(r", (?:and )?", m.group(1)):
        pm = re.fullmatch(r"(?:(\d+) (?:flasks of |days of |sheets of )?)?(.+)", part.strip())
        qty, name = int(pm.group(1) or 1), pm.group(2)
        found = resolve(name)
        if not found:
            problems.append(f"{item['name']}: item desconhecido '{name}'")
            continue
        contents.append({"itemId": found["id"], "quantity": qty})
        total += Fraction(str(found.get("weight", 0))) * qty / found.get("perPurchase", 1)
    item["contents"] = contents
    if total != Fraction(str(item["weight"])):
        problems.append(f"{item['name']}: peso {item['weight']} difere da soma do conteúdo ({float(total)})")

# Ferramentas: tudo que fabricam precisa existir (exceto categorias genéricas).
# Categorias: o item fabricado é qualquer uma das formas (focos, pergaminhos).
GENERIC_CRAFT = re.compile(r"^(Any Melee weapon|Medium armor|Heavy armor|Ranged weapons|Arcane Focus|Druidic Focus|Holy Symbol|Spell Scroll|Potion of Healing)")
for t in tool_items:
    for c in t.get("craft", []):
        if GENERIC_CRAFT.match(c):
            continue
        if not resolve(c) and not resolve(natural(c)):
            problems.append(f"{t['name']}: fabrica item desconhecido '{c}'")

# Referências já existentes nos dados (antecedentes, classes, talentos).
known_tools = {t["id"] for t in tool_items}
for f in ("backgrounds.json", "classes.json", "subclasses.json", "feats.json", "species.json"):
    raw = open(DATA / f, encoding="utf-8").read()
    for tid in re.findall(r'"category": "tool",\s*"id": "([a-z_]+)"', raw):
        if tid not in known_tools:
            problems.append(f"{f}: ferramenta desconhecida '{tid}'")

ids = [i["id"] for i in gear + tool_items]
dups = {i for i in ids if ids.count(i) > 1}
if dups:
    problems.append(f"ids repetidos: {sorted(dups)}")

ORDER = ["id", "name", "kind", "category", "focus", "ability", "weight", "cost", "perPurchase", "consumable", "use", "utilize",
         "craft", "contents", "description"]
for k in item_use.GEAR_USE:
    if k not in used:
        problems.append(f"uso curado sem item: {k}")
for path, items in (("tools.json", tool_items), ("gear.json", gear)):
    items = sorted(({k: it[k] for k in ORDER if k in it and it[k] is not None} for it in items), key=lambda x: x["name"])
    with open(DATA / path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(items, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
print("ferramentas:", len(tool_items), "equipamento:", len(gear), "(pacotes:", sum(1 for g in gear if "contents" in g),
      "focos:", sum(1 for g in gear if "focus" in g), "munição:", len(ammo), ")")
print("problemas:", len(problems))
for p in problems:
    print(" -", p)
sys.exit(1 if problems else 0)
