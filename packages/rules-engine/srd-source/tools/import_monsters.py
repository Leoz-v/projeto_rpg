"""Importa os blocos de estatística do SRD 5.2.1 (Monsters A-Z e Animals, pp. 258-364) para JSON.

Requisitos: Python 3.10+ e `pdftotext` (poppler) no PATH.

Uso (a partir da raiz do repositório):
    python packages/rules-engine/srd-source/tools/import_monsters.py [pdf] [saida.json]

Sem argumentos, lê `srd-source/SRD_CC_v5.2.1.pdf` e grava `src/srd/data/monsters.json`.

Conferências independentes (cada bloco traz números redundantes):
- XP e bônus de proficiência publicados contra a tabela de ND;
- PV médio contra a fórmula de dados;
- modificadores contra os valores de atributo, salvaguardas contra modificador (+ proficiência);
- Percepção passiva contra 10 + Percepção;
- dano médio de cada ataque/salvaguarda contra os dados;
- magias de Spellcasting contra `spells.json`; equipamento contra armas e armaduras.

Sai com código 1 se houver problema (o JSON é gravado mesmo assim, para inspeção).
Ver docs/decisions/0012-importacao-dos-monstros.md.
"""
import json, re, subprocess, sys
from fractions import Fraction
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
DATA = HERE.parent.parent / "src" / "srd" / "data"
PDF = sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent / "SRD_CC_v5.2.1.pdf")
OUT = sys.argv[2] if len(sys.argv) > 2 else str(DATA / "monsters.json")
FIRST_PAGE, LAST_PAGE = 258, 364

SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]
TYPES = ["Aberration", "Beast", "Celestial", "Construct", "Dragon", "Elemental", "Fey", "Fiend", "Giant", "Humanoid",
         "Monstrosity", "Ooze", "Plant", "Undead"]
ABILITIES = ["str", "dex", "con", "int", "wis", "cha"]
ABILITY_NAMES = {"Strength": "str", "Dexterity": "dex", "Constitution": "con", "Intelligence": "int", "Wisdom": "wis",
                 "Charisma": "cha"}
SKILLS = {"Acrobatics": "acrobatics", "Animal Handling": "animal_handling", "Arcana": "arcana", "Athletics": "athletics",
          "Deception": "deception", "History": "history", "Insight": "insight", "Intimidation": "intimidation",
          "Investigation": "investigation", "Medicine": "medicine", "Nature": "nature", "Perception": "perception",
          "Performance": "performance", "Persuasion": "persuasion", "Religion": "religion",
          "Sleight of Hand": "sleight_of_hand", "Stealth": "stealth", "Survival": "survival"}
SKILL_ABILITY = {"acrobatics": "dex", "animal_handling": "wis", "arcana": "int", "athletics": "str", "deception": "cha",
                 "history": "int", "insight": "wis", "intimidation": "cha", "investigation": "int", "medicine": "wis",
                 "nature": "int", "perception": "wis", "performance": "cha", "persuasion": "cha", "religion": "int",
                 "sleight_of_hand": "dex", "stealth": "dex", "survival": "wis"}
DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic",
                "radiant", "slashing", "thunder"]
CONDITIONS = ["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible",
              "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]
SENSES = ["blindsight", "darkvision", "tremorsense", "truesight"]
# Tabela de ND do SRD 5.2.1 (p. 256): XP e bônus de proficiência.
CR_TABLE = {Fraction(0): (10, 2), Fraction(1, 8): (25, 2), Fraction(1, 4): (50, 2), Fraction(1, 2): (100, 2),
            1: (200, 2), 2: (450, 2), 3: (700, 2), 4: (1100, 2), 5: (1800, 3), 6: (2300, 3), 7: (2900, 3),
            8: (3900, 3), 9: (5000, 4), 10: (5900, 4), 11: (7200, 4), 12: (8400, 4), 13: (10000, 5), 14: (11500, 5),
            15: (13000, 5), 16: (15000, 5), 17: (18000, 6), 18: (20000, 6), 19: (22000, 6), 20: (25000, 6),
            21: (33000, 7), 22: (41000, 7), 23: (50000, 7), 24: (62000, 7), 25: (75000, 8), 26: (90000, 8),
            27: (105000, 8), 28: (120000, 8), 29: (135000, 8), 30: (155000, 9)}
SECTIONS = {"Traits": None, "Actions": "action", "Bonus Actions": "bonus_action", "Reactions": "reaction",
            "Legendary Actions": "legendary"}

problems = []


def text(first, last):
    args = ["pdftotext", "-q", "-enc", "UTF-8", "-f", str(first), "-l", str(last), PDF, "-"]
    return subprocess.run(args, capture_output=True, check=True).stdout.decode("utf-8")


def normalize(raw):
    # Mesmas normalizações de import_spells.py: apóstrofos ASCII, travessões viram hífen.
    raw = raw.replace("\f", "\n").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    raw = raw.replace("­", "").replace("−", "-").replace("‑", "-").replace("–", "-").replace("—", "--").replace("�", "-")
    return raw.replace("\t", " ")


def clean(raw):
    """Remove rodapés e junta linhas partidas por coluna/página."""
    out = []
    for line in normalize(raw).split("\n"):
        s = re.sub(r" {2,}", " ", line.strip())
        if not s or re.fullmatch(r"\d+( System Reference Document 5\.2(\.1)?)?", s) or s == "MOD SAVE":
            continue
        if out:
            prev = out[-1]
            if prev.endswith("-") and not prev.endswith("--") and s[:1].islower():
                out[-1] = prev[:-1] + s
                continue
            if not re.search(r"[.:!?\")]$", prev) and s[:1].islower():
                out[-1] = prev + " " + s
                continue
        out.append(s)
    return out


def snake(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower().replace("'", "")).strip("_")


def dice(expr):
    """`2d6 + 3` -> `2d6+3` (formato do DiceSchema)."""
    return re.sub(r"\s+", "", expr)


def dice_average(expr):
    total, sign = Fraction(0), 1
    for tok in re.findall(r"[+-]|\d+d\d+|\d+", expr):
        if tok in "+-":
            sign = 1 if tok == "+" else -1
            continue
        if "d" in tok:
            n, m = map(int, tok.split("d"))
            total += sign * Fraction(n * (m + 1), 2)
        else:
            total += sign * int(tok)
    return int(total // 1)


def modifier(score):
    return (score - 10) // 2


def parse_cr(s):
    return Fraction(s) if "/" in s else Fraction(int(s))


def split_list(s, conj=True):
    """Separa por vírgula (e por " and ", se `conj`), sem quebrar dentro de parênteses."""
    parts, depth, cur = [], 0, ""
    for ch in s:
        depth += ch == "("
        depth -= ch == ")"
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    out = []
    for p in parts:
        out.extend(re.split(r"\s+and\s+(?![^(]*\))", p) if conj else [p])
    return [x.strip() for x in out if x.strip()]


HEADER = re.compile(
    r"^((?:" + "|".join(SIZES) + r")(?: or (?:" + "|".join(SIZES) + r"))*) "
    r"(?:Swarm of (" + "|".join(SIZES) + r") (Beasts|Undead)|(" + "|".join(TYPES) + r")(?: \(([^)]+)\))?), (.+)$")
# Nome de entrada: começa com letra maiúscula (uma tabela "1-4. The target..." é continuação).
ENTRY = re.compile(r"^([A-Z][\w'-]*(?: (?:[A-Z0-9][\w'-]*|of|the|and|to|in|a|on|or|from|with))*)"
                   r"(?: \(([^)]+)\))?\. (.+)$")
DAMAGE = re.compile(r"(\d+)(?: \(([\dd +-]+)\))? (" + "|".join(t.capitalize() for t in DAMAGE_TYPES) + r") damage")


SPELL_LIST = re.compile(r"^(?:At Will|\d+/Day(?: Each)?):")


def parse_limit(note, who):
    """`Recharge 5-6`, `3/Day`, `3/Day, or 4/Day in Lair`, `Recharge after a Short or Long Rest`."""
    if note is None:
        return None, None
    m = re.fullmatch(r"Recharge (\d)(?:-6)?", note)
    if m:
        return {"recharge": int(m.group(1))}, None
    if note == "Recharge after a Short or Long Rest":
        return {"per": "short_rest", "count": 1}, None
    m = re.fullmatch(r"(\d+)/Day(?:, or (\d+)/Day in Lair)?(?:; (.+))?", note)
    if m:
        limit = {"per": "day", "count": int(m.group(1))}
        if m.group(2):
            limit["lairCount"] = int(m.group(2))
        return limit, m.group(3)
    # Parênteses que não são limite (ex.: forma do licantropo): ficam no nome.
    return None, note


def parse_damage_chain(s):
    """Lê `12 (2d6 + 5) Bludgeoning damage plus 3 (1d6) Fire damage` no início do texto."""
    out, pos = [], 0
    while True:
        m = DAMAGE.match(s, pos)
        if not m:
            break
        avg, expr, kind = int(m.group(1)), m.group(2), m.group(3).lower()
        expr = dice(expr) if expr else str(avg)
        out.append(({"dice": expr, "type": kind}, avg))
        pos = m.end()
        if s.startswith(" plus ", pos):
            pos += len(" plus ")
            continue
        break
    return out


def conditions_in(sentence):
    return [c for c in CONDITIONS if re.search(r"\b(?:has|have) the " + c.capitalize() + r" condition", sentence)]


def check_damage(who, parsed):
    for dmg, avg in parsed:
        if dice_average(dmg["dice"]) != avg:
            problems.append(f"{who}: dano médio {avg} não bate com {dmg['dice']}")
    return [d for d, _ in parsed]


SPELLS = {s["name"].lower(): s["id"] for s in json.load(open(DATA / "spells.json", encoding="utf-8"))}
ITEMS = {}
for f in ("weapons.json", "armor.json", "tools.json", "gear.json"):
    for it in json.load(open(DATA / f, encoding="utf-8")):
        ITEMS[it["name"].lower()] = it["id"]
# "Wand" no bloco é a forma de foco arcano. "Holy Symbol" não diz a forma (amuleto, emblema ou relicário): fica sem itemId.
ITEMS["wand"] = "arcane_focus_wand"


def parse_spellcasting(who, entry, body):
    flat = " ".join(body.split())
    m = re.search(r"using (\w+) as (?:the )?spellcasting ability(?: \(spell save DC (\d+)(?:, ([+-]\d+) to hit with spell attacks)?\))?:", flat)
    if not m or m.group(1) not in ABILITY_NAMES:
        problems.append(f"{who}: Spellcasting sem atributo/CD reconhecidos")
        return None
    action = {**entry, "kind": "spellcasting", "ability": ABILITY_NAMES[m.group(1)]}
    if m.group(2):
        action["dc"] = int(m.group(2))
    if m.group(3):
        action["toHit"] = int(m.group(3))
    spells = []
    for label, names in re.findall(r"(At Will|\d+/Day(?: Each)?):\s*(.+?)(?=\s+(?:At Will|\d+/Day(?: Each)?):|$)", flat[m.end():]):
        uses = "at_will" if label == "At Will" else {"per": "day", "count": int(label.split("/")[0])}
        for raw_name in split_list(names, conj=False):
            nm = re.match(r"(.+?)(?: \((.+)\))?$", raw_name)
            name, note = nm.group(1).strip(), nm.group(2)
            sid = SPELLS.get(name.lower())
            if not sid:
                problems.append(f"{who}: magia desconhecida '{name}'")
                continue
            spell = {"spellId": sid, "uses": uses}
            if note:
                lv = re.fullmatch(r"level (\d) version", note)
                if lv:
                    spell["level"] = int(lv.group(1))
                else:
                    spell["note"] = note
            spells.append(spell)
    if not spells:
        problems.append(f"{who}: Spellcasting sem magias")
    action["spells"] = spells
    return action


def parse_action(who, entry, body):
    first = body.split("\n")[0]
    m = re.match(r"(Melee|Ranged|Melee or Ranged) Attack Roll: ([+-]\d+)(?: to hit)?(?: \([^)]*\))?, (.*?)\. Hit: (.*)$", first)
    if m:
        kind = {"Melee": "melee", "Ranged": "ranged", "Melee or Ranged": "melee_or_ranged"}[m.group(1)]
        action = {**entry, "kind": "attack", "attackKind": kind, "toHit": int(m.group(2))}
        reach = re.search(r"reach (\d+) (?:ft|feet)", m.group(3))
        rng = re.search(r"range (\d+)(?:/(\d+))? (?:ft|feet)", m.group(3))
        if reach:
            action["reach"] = int(reach.group(1))
        if rng:
            action["range"] = int(rng.group(1))
            if rng.group(2):
                action["longRange"] = int(rng.group(2))
        if kind != "ranged" and not reach or kind != "melee" and not rng:
            problems.append(f"{who}: alcance não reconhecido: {m.group(3)}")
        hit = m.group(4)
        action["damage"] = check_damage(who, parse_damage_chain(hit))
        action["onHitConditions"] = conditions_in(re.split(r"(?<=\.) ", hit)[0])
        return action
    # A salvaguarda pode vir depois de um texto de movimento ("The bulette spends 5 feet..."), que
    # fica só na descrição. "Strength or Dexterity Saving Throw" e "First Failure" ficam como texto.
    m = re.search(r"(?<!or )\b(\w+) Saving Throw: DC (\d+), [^.]*?\. Failure: (.*?)(?: Success: (.*))?$", body.replace("\n", " "))
    if m and m.group(1) in ABILITY_NAMES:
        fail = m.group(3)
        action = {**entry, "kind": "save", "ability": ABILITY_NAMES[m.group(1)], "dc": int(m.group(2)),
                  "damage": check_damage(who, parse_damage_chain(fail))}
        success = m.group(4) or ""
        action["onSuccess"] = "half" if success.startswith("Half damage") else "none"
        action["onFailConditions"] = conditions_in(fail.split(" Failure or Success:")[0])
        return action
    if body.startswith("The ") and "casts one of the following spells" in first:
        sc = parse_spellcasting(who, entry, body)
        if sc:
            return sc
    return {**entry, "kind": "text"}


def parse_top(who, top, top_lines):
    c = {}
    m = re.search(r"\bAC (\d+)\b", top)
    c["ac"] = int(m.group(1)) if m else problems.append(f"{who}: sem CA")
    m = re.search(r"Initiative ([+-]\d+) \((\d+)\)", top)
    if m:
        c["initiative"] = int(m.group(1))
        if int(m.group(2)) != 10 + c["initiative"]:
            erratum(who, f"iniciativa {m.group(1)} ({m.group(2)}): o valor entre parênteses não é 10 + bônus")
    else:
        problems.append(f"{who}: sem iniciativa")
    m = re.search(r"HP (\d+) \(([\dd +-]+)\)", top)
    if m:
        c["hp"] = {"average": int(m.group(1)), "formula": dice(m.group(2))}
        if dice_average(c["hp"]["formula"]) != c["hp"]["average"]:
            problems.append(f"{who}: PV {m.group(1)} não bate com {m.group(2)}")
    else:
        m = re.search(r"HP (\d+)\b", top)
        c["hp"] = {"average": int(m.group(1)), "formula": m.group(1)} if m else problems.append(f"{who}: sem PV")
    m = re.search(r"Speed (.+?)(?= Initiative | Str \d|$)", top)
    speed = {}
    if m:
        for part in split_list(m.group(1)):
            sm = re.fullmatch(r"(?:(Fly|Swim|Climb|Burrow|Climb or Fly) )?(\d+) ft\.( \(hover\))?(?: \((.+)\))?", part)
            if not sm:
                problems.append(f"{who}: deslocamento não reconhecido: {part}")
                continue
            if sm.group(4) or sm.group(1) == "Climb or Fly":
                speed.setdefault("notes", []).append(part)
                continue
            speed[(sm.group(1) or "walk").lower()] = int(sm.group(2))
            if sm.group(3):
                speed["hover"] = True
        if "notes" in speed:
            speed["note"] = "; ".join(speed.pop("notes"))
        speed.setdefault("walk", 0)
    c["speed"] = speed
    # Às vezes o PDF separa modificador e salvaguarda do valor ("Dex 3 Wis 6 ... -4 -4 -2 -2"):
    # os pares órfãos vão, na ordem, para os atributos que ficaram sem eles.
    # Leitura linha a linha: uma linha só de números são pares órfãos.
    ab_re = r"\b(Str|Dex|Con|Int|Wis|Cha) ?(\d+)((?: [+-]\d+ [+-]?\d+)?)(?!\d)"  # "Con22" aparece no PDF
    found, orphans = [], []
    for line in top_lines:
        if re.fullmatch(r"(?:[+-]\d+ ?)+", line):
            orphans += re.findall(r"([+-]\d+) ([+-]\d+)", line)
        else:
            found += re.findall(ab_re, line)
    rows = []
    for ab, score, pair in found:
        if re.search(r" \d+$", pair):
            erratum(who, f"salvaguarda de {ab} sem sinal: {pair.strip()}")
            pair = re.sub(r" (\d+)$", r" -\1" if int(pair.split()[0]) < 0 else r" +\1", pair)
        if pair:
            mod, save = pair.split()
        elif orphans:
            mod, save = orphans.pop(0)
        else:
            problems.append(f"{who}: {ab} sem modificador")
            continue
        rows.append((ab, score, mod, save))
    if len(rows) != 6 or orphans:
        problems.append(f"{who}: {len(rows)} atributos")
    c["abilities"], saves = {}, {}
    for ab, score, mod, save in rows:
        k = ab.lower()
        c["abilities"][k] = int(score)
        if modifier(int(score)) != int(mod):
            problems.append(f"{who}: modificador de {ab} {mod} não bate com {score}")
        saves[k] = int(save)
    return c, saves


# Defesas publicadas que não cabem num efeito (escolha do mestre ou condição fora do catálogo de
# predicados): ficam como texto em `notes`, para o mestre. Qualquer outra é problema.
UNMODELED = {
    ("Half-Dragon", "Resistances: Damage type chosen for the Draconic Origin trait below"),
    ("Rakshasa", "Vulnerabilities: Piercing damage from weapons wielded by creatures under the effect of a Bless spell"),
}


# Erros do próprio SRD 5.2.1 achados pelas conferências. Fica o valor publicado, exceto o XP,
# que segue a tabela de ND (regra). Um erro novo que não esteja aqui é problema.
KNOWN_ERRATA = {
    ("Archmage", "XP 8000 não é o da tabela de ND (8400)"),
    ("Gray Ooze", "iniciativa -2 (13): o valor entre parênteses não é 10 + bônus"),
    ("Invisible Stalker", "iniciativa +7 (22): o valor entre parênteses não é 10 + bônus"),
    ("Shambling Mound", "perícia Stealth +3 não é modificador + proficiência (ou especialização)"),
    ("Giant Frog", "perícia Stealth +4 não é modificador + proficiência (ou especialização)"),
    ("Young White Dragon", "salvaguarda de Int sem sinal: -2 2"),
}
errata_seen = []


def erratum(who, msg):
    if (who, msg) in KNOWN_ERRATA:
        errata_seen.append(f"{who}: {msg}")
    else:
        problems.append(f"{who}: {msg}")


def unmodeled(who, c, text_):
    if (who, text_) not in UNMODELED:
        problems.append(f"{who}: defesa não reconhecida: {text_}")
    c.setdefault("notes", []).append(text_)


def parse_details(who, details, c, saves, pb):
    keys = ["Skills", "Resistances", "Vulnerabilities", "Immunities", "Gear", "Senses", "Languages", "CR"]
    spots = sorted((m.start(), k) for k in keys for m in re.finditer(r"(?:^| )" + k + r" ", details))
    fields = {}
    for n, (pos, k) in enumerate(spots):
        end = spots[n + 1][0] if n + 1 < len(spots) else len(details)
        fields[k] = details[pos:end].strip()[len(k):].strip()
    effects = []
    skills = {}
    for part in split_list(fields.get("Skills", "")):
        m = re.fullmatch(r"(.+?) ([+-]\d+)", part)
        if not m or m.group(1) not in SKILLS:
            problems.append(f"{who}: perícia não reconhecida: {part}")
            continue
        sk = SKILLS[m.group(1)]
        skills[sk] = int(m.group(2))
        base = modifier(c["abilities"][SKILL_ABILITY[sk]])
        if skills[sk] not in (base + pb, base + 2 * pb):
            erratum(who, f"perícia {part} não é modificador + proficiência (ou especialização)")
    def defense(kind, key, values, part):
        """`Fire` ou `Charmed (with Mind Blank)`: a ressalva entre parênteses vira `note`."""
        m = re.fullmatch(r"(\w+)(?: \((.+)\))?", part)
        if not m or m.group(1).lower() not in values:
            return False
        eff = {"type": kind, key: m.group(1).lower()}
        if m.group(2):
            eff["note"] = m.group(2)
        effects.append(eff)
        return True

    for kind, field in (("resistance", "Resistances"), ("vulnerability", "Vulnerabilities")):
        for part in split_list(fields.get(field, "")):
            if not defense(kind, "damageType", DAMAGE_TYPES, part):
                unmodeled(who, c, f"{field}: {part}")
    imm = fields.get("Immunities", "")
    dmg_part, _, cond_part = imm.partition(";")
    if not cond_part and dmg_part and all(p.split(" (")[0].lower() in CONDITIONS for p in split_list(dmg_part)):
        dmg_part, cond_part = "", dmg_part
    for part in split_list(dmg_part):
        if not defense("immunity", "damageType", DAMAGE_TYPES, part):
            unmodeled(who, c, f"Immunities: {part}")
    for part in split_list(cond_part):
        if not defense("immunity", "condition", CONDITIONS, part):
            unmodeled(who, c, f"Immunities: {part}")
    senses_text, _, passive = fields.get("Senses", "").partition("Passive Perception")
    for part in split_list(senses_text.strip().rstrip(";")):
        m = re.fullmatch(r"(\w+) (\d+) ft\.(?: \((.+)\))?", part)
        if not m or m.group(1).lower() not in SENSES:
            problems.append(f"{who}: sentido não reconhecido: {part}")
            continue
        sense = {"type": "grant_sense", "sense": m.group(1).lower(), "range": int(m.group(2))}
        if m.group(3):
            sense["note"] = m.group(3)
        effects.append(sense)
    m = re.fullmatch(r"\s*(\d+)", passive)
    if m:
        c["passivePerception"] = int(m.group(1))
        expected = 10 + skills.get("perception", modifier(c["abilities"]["wis"]))
        if c["passivePerception"] != expected:
            problems.append(f"{who}: Percepção passiva {m.group(1)} não é {expected}")
    else:
        problems.append(f"{who}: sem Percepção passiva")
    langs = fields.get("Languages", "")
    tm = re.search(r";?\s*telepathy (\d+) ft\.", langs)
    if tm:
        c["telepathy"] = int(tm.group(1))
        langs = langs[: tm.start()] + langs[tm.end():]
    langs = langs.strip().rstrip(";").strip()
    if langs and langs != "None":
        c["languages"] = langs
    gear = []
    for part in split_list(fields.get("Gear", "")):
        m = re.fullmatch(r"(.+?)(?: \((\d+)\))?", part)
        name, qty = m.group(1), int(m.group(2)) if m.group(2) else None
        singular = re.sub(r"s$", "", name) if qty else name
        item = {"name": name}
        iid = ITEMS.get(name.lower()) or ITEMS.get(singular.lower())
        if iid:
            item["itemId"] = iid
        if qty:
            item["quantity"] = qty
        gear.append(item)
    if gear:
        c["gear"] = gear
    c["saves"] = {}
    for k, v in saves.items():
        mod = modifier(c["abilities"][k])
        if v != mod:
            c["saves"][k] = v
            if v != mod + pb:
                problems.append(f"{who}: salvaguarda de {k} {v:+d} não é modificador + proficiência")
    c["skills"] = skills
    c["effects"] = effects
    return fields


# Efeitos passivos de traços (Fase 1.5): (efeitos, regex do trecho de apoio na descrição).
# A luz é contexto que o motor não conhece: a Desvantagem leva `note` e vira lembrete situacional.
ALL_CHECKS_DIS = [{"type": "disadvantage", "target": f"check.{a}", "note": "Na luz do sol"} for a in ("str", "dex", "con", "int", "wis", "cha")]
TRAIT_EFFECTS = {
    "Magic Resistance": ([{"type": "advantage", "target": "save.all", "when": {"against": {"source": "magic"}}}],
                         r"^The [\w -]+ has Advantage on saving throws against spells and other magical effects\.$"),
    # Sucesso automático (d20_rule); "the attack rolls of spells automatically miss it" fica para a Fase 4.
    "Greater Magic Resistance": ([{"type": "d20_rule", "rule": "auto_success", "target": "save.all", "when": {"against": {"source": "magic"}}}],
                                 r"^The [\w -]+ automatically succeeds on saving throws against spells and other magical effects, "),
    "Invisibility": ([{"type": "condition", "condition": "invisible"}], r"has the Invisible condition\.$"),
    "Sunlight Sensitivity": ([{"type": "disadvantage", "target": "attack.all", "note": "Na luz do sol"}] + ALL_CHECKS_DIS,
                             r"^While in sunlight, the [\w -]+ has Disadvantage on ability checks and attack rolls\.$"),
    "Light Sensitivity": ([{"type": "disadvantage", "target": "attack.all", "note": "Na Luz Plena"}],
                          r"^While in Bright Light, the [\w -]+ has Disadvantage on attack rolls\.$"),
}
traits_curated = set()

lines = clean(text(FIRST_PAGE, LAST_PAGE))
starts = [i for i, l in enumerate(lines) if HEADER.match(l)]
creatures, dropped = [], []
for n, h in enumerate(starts):
    name = lines[h - 1]
    who = name
    m = HEADER.match(lines[h])
    c = {"id": snake(name), "name": name, "size": [s.lower() for s in m.group(1).split(" or ")]}
    if m.group(2):
        c["swarmOf"] = m.group(2).lower()
        c["type"] = "beast" if m.group(3) == "Beasts" else "undead"
    else:
        c["type"] = m.group(4).lower()
        if m.group(5):
            c["tags"] = [snake(t) for t in m.group(5).split(",")]
    c["alignment"] = m.group(6)
    end = starts[n + 1] - 1 if n + 1 < len(starts) else len(lines)
    body = lines[h + 1:end]
    first_section = next((k for k, l in enumerate(body) if l in SECTIONS), len(body))
    head = " ".join(body[:first_section])
    cr_m = re.search(r"CR (\d+(?:/\d)?) \((?:XP )?([\d,]+)(?: XP)?(?:, or ([\d,]+) in lair)?; PB \+(\d)\)", head)
    if not cr_m:
        problems.append(f"{who}: ND não reconhecido")
        continue
    cr = parse_cr(cr_m.group(1))
    xp, pb = CR_TABLE[cr if cr < 1 else int(cr)]
    published_xp = int(cr_m.group(2).replace(",", ""))
    if cr == 0 and published_xp == 0:
        xp = 0  # ND 0 vale 0 ou 10 XP (p. 256): 0 para quem não tem ataques.
    if published_xp != xp:
        erratum(who, f"XP {published_xp} não é o da tabela de ND ({xp})")
    if int(cr_m.group(4)) != pb:
        problems.append(f"{who}: PB {cr_m.group(4)} não bate com ND {cr_m.group(1)}")
    split_at = re.compile(r" (?:Skills|Resistances|Vulnerabilities|Immunities|Gear|Senses) ").search(head, head.find("Str "))
    top, details = head[: split_at.start()], head[split_at.start():].strip()
    stats, saves = parse_top(who, top, body[:first_section])
    c.update(stats)
    parse_details(who, details, c, saves, pb)
    c["cr"] = float(cr) if cr < 1 else int(cr)
    c["xp"] = xp
    if cr_m.group(3):
        c["lairXp"] = int(cr_m.group(3).replace(",", ""))
    # Seções de traços e ações: cada entrada começa com "Nome. " ou "Nome (limite). ".
    traits, actions, section, current = [], [], None, None
    entries = []
    for line in body[first_section:]:
        if line in SECTIONS:
            section = line
            continue
        lm = re.match(r"Legendary Action Uses: (\d+)(?: \((\d+) in Lair\))?\.", line)
        if section == "Legendary Actions" and lm:
            c["legendaryActionUses"] = {"count": int(lm.group(1))}
            if lm.group(2):
                c["legendaryActionUses"]["lairCount"] = int(lm.group(2))
            current = None
            continue
        em = ENTRY.match(line)
        if em and not line.startswith(("Failure", "Success", "Hit:", "Trigger:", "Response:")):
            current = {"section": section, "name": em.group(1), "note": em.group(2), "body": em.group(3)}
            entries.append(current)
        elif current is not None and SPELL_LIST.match(line):
            current["body"] += "\n" + line
        elif (current is not None and not em and SPELL_LIST.match(current["body"].split("\n")[-1])
              and (current["body"].endswith(",") or "," in line)):
            # Lista de magias partida em várias linhas: a linha anterior termina em vírgula ou esta
            # continua a lista. Um título solto entre blocos ("Doppelganger") não tem vírgula.
            current["body"] += " " + line
        elif current is not None and (re.search(r"[.:)]$", line) or line.startswith(("Failure", "Success", "Hit:", "Trigger:", "Response:"))):
            current["body"] += "\n" + line
        else:
            # Só títulos de seção entre blocos ("Black Dragons") podem sobrar; texto com pontuação não.
            if not re.fullmatch(r"[A-Z][\w'-]*(?: (?:[A-Z][\w'-]*|of))*", line):
                problems.append(f"{who}: linha sem entrada: {line}")
            dropped.append(f"{who}: {line}")
    seen = set()
    for e in entries:
        limit, extra = parse_limit(e["note"], who)
        name = e["name"] if extra is None or limit else f"{e['name']} ({extra})"
        base = {"id": snake(name), "name": name}
        if base["id"] in seen:
            base["id"] = f"{base['id']}_{SECTIONS[e['section']] or 'trait'}"
        seen.add(base["id"])
        if limit:
            base["limit"] = limit
        if extra and limit:
            base["name"] = f"{e['name']} ({extra})"
        description = e["body"]
        if e["section"] == "Traits":
            trait = {**base, "description": description}
            curated = TRAIT_EFFECTS.get(e["name"])
            if curated:
                effects, evidence = curated
                if not re.search(evidence, description):
                    problems.append(f"{who} / {e['name']}: efeito curado sem o texto de apoio '{evidence}'")
                trait["effects"] = effects
                traits_curated.add(e["name"])
            traits.append(trait)
            continue
        if e["section"] is None:
            problems.append(f"{who}: entrada fora de seção: {e['name']}")
            continue
        entry = {**base, "activation": SECTIONS[e["section"]], "description": description}
        actions.append(parse_action(f"{who} / {e['name']}", entry, description))
    if traits:
        c["traits"] = traits
    c["actions"] = actions
    if not actions:
        problems.append(f"{who}: sem ações")
    creatures.append(c)

# Ordem estável dos campos (facilita o diff).
ORDER = ["id", "name", "size", "swarmOf", "type", "tags", "alignment", "ac", "initiative", "hp", "speed", "abilities",
         "saves", "skills", "passivePerception", "languages", "telepathy", "gear", "cr", "xp", "lairXp", "effects",
         "notes", "traits", "legendaryActionUses", "actions"]
creatures = [{k: c[k] for k in ORDER if k in c} for c in creatures]
ids = [c["id"] for c in creatures]
dups = {i for i in ids if ids.count(i) > 1}
if dups:
    problems.append(f"ids repetidos: {sorted(dups)}")

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(creatures, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
kinds = {}
for c in creatures:
    for a in c["actions"]:
        kinds[a["kind"]] = kinds.get(a["kind"], 0) + 1
print("criaturas:", len(creatures), "ações por tipo:", kinds)
print("linhas descartadas (títulos de seção entre blocos):", len(dropped))
for name in TRAIT_EFFECTS:
    if name not in traits_curated:
        problems.append(f"curadoria de traço sem traço no compêndio: {name}")
for d in dropped:
    print("   ", d)
print("erros conhecidos do SRD:", len(errata_seen))
for e in errata_seen:
    print("   ", e)
missing = {f"{w}: {m}" for w, m in KNOWN_ERRATA} - set(errata_seen)
for e in sorted(missing):
    problems.append(f"erro conhecido não encontrado (o PDF mudou?): {e}")
print("problemas:", len(problems))
for p in problems:
    print(" -", p)
sys.exit(1 if problems else 0)
