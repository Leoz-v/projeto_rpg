"""Importa o capítulo Magic Items A-Z do SRD 5.2.1 (pp. 209-253) para JSON.

Requisitos: Python 3.10+ e `pdftotext` (poppler) no PATH.

Uso (a partir da raiz do repositório):
    python packages/rules-engine/srd-source/tools/import_magic_items.py [pdf]

Sem argumentos, lê `srd-source/SRD_CC_v5.2.1.pdf` e grava `src/srd/data/magic-items.json`.

O texto (categoria, raridade, sintonização, cargas, descrição) vem do PDF. Os efeitos mecânicos
(`EFFECTS` e as variantes com efeito) são curados aqui, item a item, a partir da descrição:
só o que o catálogo de efeitos (docs/effects-spec.md) expressa sem perder sentido. O resto fica
na descrição, para o mestre (Fase 4).

Conferências:
- toda variante transcrita à mão (tabelas de raridade) aparece no texto do item, com a raridade;
- todo item base citado ("Glaive, Greatsword, ...") existe em armas, armaduras ou munição;
- toda chave de `EFFECTS` é um item importado (curadoria não fica órfã);
- itens com efeito "por raridade" (+1, +2, +3) têm uma variante por raridade do cabeçalho.

Sai com código 1 se houver problema (o JSON é gravado mesmo assim, para inspeção).
Ver docs/decisions/0014-itens-magicos.md.
"""
import json, re, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
DATA = HERE.parent.parent / "src" / "srd" / "data"
PDF = sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent / "SRD_CC_v5.2.1.pdf")
problems = []

CATEGORIES = {"Armor": "armor", "Weapon": "weapon", "Wondrous Item": "wondrous", "Potion": "potion", "Ring": "ring",
              "Rod": "rod", "Scroll": "scroll", "Staff": "staff", "Wand": "wand"}
RARITIES = {"Common": "common", "Uncommon": "uncommon", "Rare": "rare", "Very Rare": "very_rare", "Legendary": "legendary",
            "Artifact": "artifact"}
RARITY_RE = "Very Rare|Common|Uncommon|Rare|Legendary|Artifact"
RARITY_NAME = {v: k for k, v in RARITIES.items()}
HEADER = re.compile(r"^(" + "|".join(CATEGORIES) + r")(?: \((.+?)\))?, (Rarity Varies.*|(?:" + RARITY_RE + r")\b.*)$")
CLASSES = ["Bard", "Cleric", "Druid", "Paladin", "Ranger", "Sorcerer", "Warlock", "Wizard", "Barbarian", "Fighter", "Monk", "Rogue"]


def text(first, last):
    args = ["pdftotext", "-q", "-enc", "UTF-8", "-raw", "-f", str(first), "-l", str(last), PDF, "-"]
    out = subprocess.run(args, capture_output=True, check=True).stdout.decode("utf-8")
    out = out.replace("\f", "\n").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    out = out.replace("­", "").replace("−", "-").replace("‑", "-").replace("–", "-").replace("—", "--").replace("\t", " ")
    lines = []
    for l in out.split("\n"):
        s = re.sub(r" {2,}", " ", l.strip())
        if not s or re.fullmatch(r"\d+", s) or s == "System Reference Document 5.2.1":
            continue
        lines.append(s)
    return lines


def join(parts):
    out = ""
    for s in parts:
        if out.endswith("-") and not out.endswith("--") and s[:1].islower():
            out = out[:-1] + s
        else:
            out = (out + " " + s).strip()
    return out


def paragraphs(lines):
    paras, cur = [], []
    for s in lines:
        if cur and re.search(r"[.:!?\")]$", cur[-1]) and s[:1].isupper():
            paras.append(join(cur))
            cur = []
        cur.append(s)
    if cur:
        paras.append(join(cur))
    return paras


def snake(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower().replace("'", "")).strip("_")


# --- Referências do compêndio --------------------------------------------------------------------------------
def load(name):
    return json.load(open(DATA / name, encoding="utf-8"))


WEAPONS = {w["name"].lower(): w for w in load("weapons.json")}
ARMOR = {a["name"].lower(): a for a in load("armor.json")}
AMMO = ["arrows", "bolts", "firearm_bullets", "needles", "sling_bullets"]


def base_rule(category, sub, who):
    """Restrição de item base a partir do subtipo do cabeçalho ("Any Simple or Martial", "Longbow or Shortbow")."""
    if category == "armor":
        if sub == "Any Light, Medium, or Heavy":
            return {"kind": "armor", "categories": ["light", "medium", "heavy"]}
        m = re.fullmatch(r"Any Medium or Heavy, Except (.+)", sub)
        if m:
            excluded = ARMOR.get(m.group(1).lower())
            if not excluded:
                problems.append(f"{who}: armadura excluída desconhecida {m.group(1)}")
            ids = [a["id"] for a in ARMOR.values() if a["category"] in ("medium", "heavy") and a is not excluded]
            return {"kind": "armor", "ids": ids}
        names = re.split(r", or |, | or ", sub)
        ids = []
        for n in names:
            a = ARMOR.get(n.lower())
            if not a:
                problems.append(f"{who}: armadura base desconhecida '{n}'")
            else:
                ids.append(a["id"])
        return {"kind": "armor", "ids": ids}
    if sub == "Any Simple or Martial":
        return {"kind": "weapon", "categories": ["simple", "martial"]}
    if sub == "Any Melee Weapon":
        return {"kind": "weapon", "attackKind": "melee"}
    if sub == "Any Ammunition":
        return {"kind": "gear", "ids": AMMO}
    ids = []
    for n in re.split(r", or |, | or ", sub):
        w = WEAPONS.get(n.lower())
        if not w:
            problems.append(f"{who}: arma base desconhecida '{n}'")
        else:
            ids.append(w["id"])
    return {"kind": "weapon", "ids": ids}


def attunement(note, who):
    """`Requires Attunement by a Sorcerer, Warlock, or Wizard` -> classes; `by a Spellcaster` -> spellcaster."""
    m = re.fullmatch(r"Requires Attunement(?: (by .+))?", note)
    if not m:
        problems.append(f"{who}: sintonização não reconhecida: {note}")
        return {}
    out = {}
    by = m.group(1)
    if by:
        out["by"] = by
        if by == "by a Spellcaster":
            out["spellcaster"] = True
        else:
            names = [c for c in CLASSES if re.search(r"\b" + c + r"\b", by)]
            if names:
                out["classes"] = [c.lower() for c in names]
    return out


# --- Variantes transcritas das tabelas (conferidas contra o texto abaixo) --------------------------------------
GIANTS = [("hill", "hill", 21), ("frost_or_stone", "frost or stone", 23), ("fire", "fire", 25), ("cloud", "cloud", 27),
          ("storm", "storm", 29)]
# (id, nome, raridade, efeitos, linha da tabela que precisa aparecer no texto do item, com a raridade)
TABLE_VARIANTS = {
    "Belt of Giant Strength": [(gid, f"Belt of Giant Strength ({g})", r, [{"type": "set_minimum_score", "ability": "str", "value": v}],
                                f"Belt of Giant Strength ({g}) {v} {RARITY_NAME[r]}")
                               for (gid, g, v), r in zip(GIANTS, ["rare", "very_rare", "very_rare", "legendary", "legendary"])],
    # Efeito temporário ao beber (Fase 4): sem efeito declarado.
    "Potion of Giant Strength": [(gid, f"Potion of Giant Strength ({g})", r, [], f"Potion of Giant Strength ({g}) {v} {RARITY_NAME[r]}")
                                 for (gid, g, v), r in zip(GIANTS, ["uncommon", "rare", "rare", "very_rare", "legendary"])],
    "Potions of Healing": [("healing", "Potion of Healing", "common", [], "Potion of Healing 2d4 + 2 Common"),
                           ("greater", "Potion of Healing (greater)", "uncommon", [], "Potion of Healing (greater) 4d4 + 4 Uncommon"),
                           ("superior", "Potion of Healing (superior)", "rare", [], "Potion of Healing (superior) 8d4 + 8 Rare"),
                           ("supreme", "Potion of Healing (supreme)", "very_rare", [], "Potion of Healing (supreme) 10d4 + 20 Very Rare")],
    "Spell Scroll": [("cantrip", "Spell Scroll (Cantrip)", "common", [], "Cantrip Common 13 +5")]
                    + [(f"level_{n}", f"Spell Scroll (Level {n})", r, [], f"{n} {RARITY_NAME[r]} {dc} +{atk}")
                       for n, r, dc, atk in [(1, "common", 13, 5), (2, "uncommon", 13, 5), (3, "uncommon", 15, 7), (4, "rare", 15, 7),
                                             (5, "rare", 17, 9), (6, "very_rare", 17, 9), (7, "very_rare", 18, 10),
                                             (8, "very_rare", 18, 10), (9, "legendary", 19, 11)]],
    "Horn of Valhalla": [("silver", "Horn of Valhalla (Silver)", "rare", [], "01-40 Silver 2"),
                         ("brass", "Horn of Valhalla (Brass)", "rare", [], "41-75 Brass 3"),
                         ("bronze", "Horn of Valhalla (Bronze)", "very_rare", [], "76-90 Bronze 4"),
                         ("iron", "Horn of Valhalla (Iron)", "legendary", [], "91-00 Iron 5")],
}
# Preço publicado na tabela de equipamento (p. 95) para as variantes que se compram.
VARIANT_COST = {("Spell Scroll", "cantrip"): {"amount": 30, "coin": "gp"}, ("Spell Scroll", "level_1"): {"amount": 50, "coin": "gp"},
                ("Potions of Healing", "healing"): {"amount": 50, "coin": "gp"}}
# Peso publicado na tabela de equipamento (p. 95); o capítulo de itens mágicos não traz peso.
WEIGHT = {"Potions of Healing": 0.5, "Spell Scroll": 0}
# Fora da curadoria de propósito (o catálogo não expressa a regra sem distorcer):
# - Bracers of Archery: +2 só com Longbow e Shortbow (sem predicado por arma);
# - aumentos "+2, máximo 20" (Ioun Stones, Belt of Dwarvenkind) e Manuals/Tomes (permanentes: ajuste do mestre).
DAMAGE_TYPES = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"]
DRAGONS = [("black", "acid"), ("blue", "lightning"), ("brass", "fire"), ("bronze", "lightning"), ("copper", "acid"),
           ("gold", "fire"), ("green", "poison"), ("red", "fire"), ("silver", "cold"), ("white", "cold")]
# Escolha do mestre com efeito fixo por tipo: uma variante por tipo, mesma raridade do item.
CHOICE_VARIANTS = {
    "Ring of Resistance": [(t, f"Ring of Resistance ({t.capitalize()})", [{"type": "resistance", "damageType": t}]) for t in DAMAGE_TYPES],
    "Armor of Resistance": [(t, f"Armor of Resistance ({t.capitalize()})", [{"type": "resistance", "damageType": t}]) for t in DAMAGE_TYPES],
    "Dragon Scale Mail": [(d, f"Dragon Scale Mail ({d.capitalize()})", [{"type": "resistance", "damageType": t}]) for d, t in DRAGONS],
    "Armor of Vulnerability": [
        (t, f"Armor of Vulnerability ({t.capitalize()})",
         [{"type": "resistance", "damageType": t}] + [{"type": "vulnerability", "damageType": o, "note": "Maldição"}
                                                      for o in ("bludgeoning", "piercing", "slashing") if o != t])
        for t in ("bludgeoning", "piercing", "slashing")],
}
# Itens "+1, +2, or +3": efeitos por variante.
PLUS = {
    "Weapon, +1, +2, or +3": lambda n: [{"type": "flat_bonus", "target": "attack.weapon", "value": n},
                                        {"type": "flat_bonus", "target": "damage.weapon", "value": n}],
    "Ammunition, +1, +2, or +3": lambda n: [],  # o bônus é do disparo com esta munição (Fase 4)
    "Armor, +1, +2, or +3": lambda n: [{"type": "flat_bonus", "target": "ac", "value": n}],
    "Shield, +1, +2, or +3": lambda n: [{"type": "flat_bonus", "target": "ac", "value": n}],
    "Wand of the War Mage, +1, +2, or +3": lambda n: [{"type": "flat_bonus", "target": "attack.spell", "value": n}],
}
ID_OVERRIDES = {"Weapon, +1, +2, or +3": "weapon_plus", "Ammunition, +1, +2, or +3": "ammunition_plus",
                "Armor, +1, +2, or +3": "armor_plus", "Shield, +1, +2, or +3": "shield_plus",
                "Wand of the War Mage, +1, +2, or +3": "wand_of_the_war_mage", "Potions of Healing": "potion_of_healing",
                "Stone of Good Luck (Luckstone)": "stone_of_good_luck"}


def weapon_plus(n):
    return [{"type": "flat_bonus", "target": "attack.weapon", "value": n}, {"type": "flat_bonus", "target": "damage.weapon", "value": n}]


ALL_CHECKS = [{"type": "flat_bonus", "target": f"check.{a}", "value": 1} for a in ("str", "dex", "con", "int", "wis", "cha")]
NO_ARMOR_NO_SHIELD = {"all": [{"wearingArmor": False}, {"wieldingShield": False}]}
# Efeitos passivos curados a partir da descrição de cada item (valem enquanto o item está ativo:
# vestido/empunhado, ou sintonizado quando exige sintonização). Cada item curado traz o trecho
# da descrição que justifica o efeito; o script confere que o trecho existe.
def spell_bonus(n):
    return [{"type": "flat_bonus", "target": "attack.spell", "value": n}]


def vs_magic(source):
    """Vantagem em salvaguardas contra magias (`spell`) ou contra magias e outros efeitos mágicos (`magic`)."""
    return {"type": "advantage", "target": "save.all", "when": {"against": {"source": source}}}


EFFECTS = {
    "Amulet of Health": ([{"type": "set_minimum_score", "ability": "con", "value": 19}], "Your Constitution is 19"),
    "Armor of Invulnerability": ([{"type": "resistance", "damageType": t} for t in ("bludgeoning", "piercing", "slashing")],
                                 "You have Resistance to Bludgeoning, Piercing, and Slashing damage while you wear this armor"),
    "Berserker Axe": (weapon_plus(1) + [{"type": "flat_bonus", "target": "hp_max", "value": {"perLevel": 1}}],
                      "your Hit Point maximum increases by 1 for each level"),
    "Boots of Elvenkind": ([{"type": "advantage", "target": "skill.stealth"}], "Advantage on Dexterity (Stealth) checks"),
    "Boots of the Winterlands": ([{"type": "resistance", "damageType": "cold"}], "You have Resistance to Cold damage"),
    "Bracers of Defense": ([{"type": "flat_bonus", "target": "ac", "value": 2, "when": NO_ARMOR_NO_SHIELD}],
                           "+2 bonus to Armor Class if you are wearing no armor and using no Shield"),
    "Brooch of Shielding": ([{"type": "resistance", "damageType": "force"}], "you have Resistance to Force damage"),
    "Cloak of Arachnida": ([{"type": "resistance", "damageType": "poison"}, {"type": "grant_speed", "speed": "climb", "value": "walk"}],
                           "You have a Climb Speed equal to your Speed"),
    "Cloak of Elvenkind": ([{"type": "advantage", "target": "skill.stealth"}], "you have Advantage on Dexterity (Stealth) checks"),
    "Cloak of Protection": ([{"type": "flat_bonus", "target": "ac", "value": 1}, {"type": "flat_bonus", "target": "save.all", "value": 1}],
                            "+1 bonus to Armor Class and saving throws"),
    "Cloak of the Bat": ([{"type": "advantage", "target": "skill.stealth"}], "you have Advantage on Dexterity (Stealth) checks"),
    "Cloak of the Manta Ray": ([{"type": "grant_speed", "speed": "swim", "value": 60}], "you have a Swim Speed of 60 feet"),
    "Dagger of Venom": (weapon_plus(1), "+1 bonus to attack rolls and damage rolls"),
    "Defender": (weapon_plus(3), "+3 bonus to attack rolls and damage rolls"),
    "Demon Armor": ([{"type": "flat_bonus", "target": "ac", "value": 1}], "+1 bonus to Armor Class"),
    "Dragon Scale Mail": ([{"type": "flat_bonus", "target": "ac", "value": 1}], "you gain a +1 bonus to Armor Class"),
    "Dragon Slayer": (weapon_plus(1), "+1 bonus to attack rolls and damage rolls"),
    "Dwarven Plate": ([{"type": "flat_bonus", "target": "ac", "value": 2}], "+2 bonus to Armor Class"),
    "Dwarven Thrower": (weapon_plus(3), "+3 bonus to attack rolls and damage rolls"),
    "Elven Chain": ([{"type": "flat_bonus", "target": "ac", "value": 1}, {"type": "grant_proficiency", "category": "armor", "id": "self"}],
                    ["+1 bonus to Armor Class", "You are considered trained with this armor even if you lack training with Medium or Heavy armor"]),
    "Energy Bow": (weapon_plus(1), "+1 bonus to attack rolls and damage rolls"),
    "Eyes of the Eagle": ([{"type": "advantage", "target": "skill.perception", "note": "Testes que dependem da visão"}],
                          "Advantage on Wisdom (Perception) checks that rely on sight"),
    "Frost Brand": ([{"type": "resistance", "damageType": "fire"}], "you have Resistance to Fire damage"),
    "Gauntlets of Ogre Power": ([{"type": "set_minimum_score", "ability": "str", "value": 19}], "Your Strength is 19"),
    "Giant Slayer": (weapon_plus(1), "+1 bonus to attack rolls and damage rolls"),
    "Glamoured Studded Leather": ([{"type": "flat_bonus", "target": "ac", "value": 1}], "+1 bonus to Armor Class"),
    "Gloves of Swimming and Climbing": ([{"type": "grant_speed", "speed": "climb", "value": "walk"},
                                         {"type": "grant_speed", "speed": "swim", "value": "walk"}],
                                        "you have a Climb Speed and a Swim Speed equal to your Speed"),
    # Soma 60 ft a uma Darkvision existente; sem ela, concede 60 ft (`extend`).
    "Goggles of Night": ([{"type": "grant_sense", "sense": "darkvision", "range": 60, "extend": True}],
                         "you have Darkvision out to 60 feet. If you already have Darkvision, wearing the goggles increases its range by 60 feet"),
    "Hammer of Thunderbolts": (weapon_plus(1), "+1 bonus to attack rolls and damage rolls"),
    "Headband of Intellect": ([{"type": "set_minimum_score", "ability": "int", "value": 19}], "Your Intelligence is 19"),
    "Holy Avenger": (weapon_plus(3) + [vs_magic("magic")],
                     ["+3 bonus to attack rolls and damage rolls", "Advantage on saving throws against spells and other magical effects"]),
    "Luck Blade": (weapon_plus(1) + [{"type": "flat_bonus", "target": "save.all", "value": 1}], "you also gain a +1 bonus to saving throws"),
    "Mace of Smiting": (weapon_plus(1), "+1 bonus to attack rolls and damage rolls"),
    "Nine Lives Stealer": (weapon_plus(2), "+2 bonus to attack rolls and damage rolls"),
    "Periapt of Proof against Poison": ([{"type": "immunity", "damageType": "poison"}, {"type": "immunity", "condition": "poisoned"}],
                                        "Immunity to the Poisoned condition and Poison damage"),
    "Quarterstaff of the Acrobat": (weapon_plus(2) + [{"type": "advantage", "target": "skill.acrobatics"}],
                                    "you have Advantage on Dexterity (Acrobatics) checks"),
    "Ring of Protection": ([{"type": "flat_bonus", "target": "ac", "value": 1}, {"type": "flat_bonus", "target": "save.all", "value": 1}],
                           "+1 bonus to Armor Class and saving throws"),
    "Ring of Swimming": ([{"type": "grant_speed", "speed": "swim", "value": 40}], "Swim Speed of 40 feet"),
    # Não é Resistência: reduz cada dano de frio em 2d8, rolados por `applyDamage`.
    "Ring of Warmth": ([{"type": "damage_reduction", "damageType": "cold", "amount": "2d8"}],
                       "If you take Cold damage while wearing this ring, the ring reduces the damage you take by 2d8"),
    "Robe of Eyes": ([{"type": "advantage", "target": "skill.perception", "note": "Testes que dependem da visão"},
                      {"type": "grant_sense", "sense": "darkvision", "range": 120}, {"type": "grant_sense", "sense": "truesight", "range": 120}],
                     "You have Darkvision and Truesight, both with a range of 120 feet"),
    "Robe of Stars": ([{"type": "flat_bonus", "target": "save.all", "value": 1}], "+1 bonus to saving throws"),
    "Robe of the Archmagi": ([{"type": "set_base_ac", "base": 15, "abilities": ["dex"], "when": {"wearingArmor": False}},
                              {"type": "flat_bonus", "target": "spell_save_dc", "value": 2}] + spell_bonus(2) + [vs_magic("magic")],
                             ["Your spell save DC and spell attack bonus each increase by 2",
                              "You have Advantage on saving throws against spells and other magical effects"]),
    "Rod of Alertness": ([{"type": "advantage", "target": "skill.perception"}, {"type": "advantage", "target": "initiative"}],
                         "Advantage on Wisdom (Perception) checks and on Initiative rolls"),
    "Scimitar of Speed": (weapon_plus(2), "+2 bonus to attack rolls and damage rolls"),
    "Sentinel Shield": ([{"type": "advantage", "target": "initiative"}, {"type": "advantage", "target": "skill.perception"}],
                        "Advantage on Initiative rolls and Wisdom (Perception) checks"),
    "Shield of the Cavalier": ([{"type": "flat_bonus", "target": "ac", "value": 2}], "you have a +2 bonus to Armor Class"),
    "Slippers of Spider Climbing": ([{"type": "grant_speed", "speed": "climb", "value": "walk"}], "You have a Climb Speed equal to your Speed"),
    "Staff of Power": (weapon_plus(2) + [{"type": "flat_bonus", "target": "ac", "value": 2}, {"type": "flat_bonus", "target": "save.all", "value": 2}]
                       + spell_bonus(2), "you gain a +2 bonus to Armor Class, saving throws, and spell attack rolls"),
    "Staff of Striking": (weapon_plus(3), "grants a +3 bonus to attack rolls and damage rolls"),
    "Staff of the Magi": (weapon_plus(2) + spell_bonus(2) + [vs_magic("spell")],
                          ["you gain a +2 bonus to spell attack rolls", "you have Advantage on saving throws against spells"]),
    "Staff of the Woodlands": (weapon_plus(2) + spell_bonus(2), "you have a +2 bonus to spell attack rolls"),
    "Staff of Thunder and Lightning": (weapon_plus(2), "grants a +2 bonus to attack rolls and damage rolls"),
    "Stone of Good Luck (Luckstone)": (ALL_CHECKS + [{"type": "flat_bonus", "target": "save.all", "value": 1}],
                                       "+1 bonus to ability checks and saving throws"),
    "Sun Blade": (weapon_plus(2), "+2 bonus to attack rolls and damage rolls"),
    "Thunderous Greatclub": ([{"type": "set_minimum_score", "ability": "str", "value": 20}], "your Strength is 20"),
    # Fase 1.5, grupo 1 (lacunas de curadoria: já cabiam no catálogo).
    "Staff of Fire": ([{"type": "resistance", "damageType": "fire"}], "You have Resistance to Fire damage while you hold this staff"),
    "Staff of Frost": ([{"type": "resistance", "damageType": "cold"}], "You have Resistance to Cold damage while you hold this staff"),
    "Vorpal Sword": (weapon_plus(3), "You gain a +3 bonus to attack rolls and damage rolls made with this magic weapon"),
    "Rod of Lordly Might": (weapon_plus(3), "it functions as a magic Mace that grants a +3 bonus to attack rolls and damage rolls"),
    "Scarab of Protection": ([{"type": "flat_bonus", "target": "ac", "value": 1}, vs_magic("spell")],
                             ["Defense. You gain a +1 bonus to Armor Class", "You have Advantage on saving throws against spells"]),
    # Fase 1.5, grupo 2 (`against.source`). O efeito sobre quem ataca (Spellguard Shield) é da Fase 4.
    # Fase 1.5, grupo 3 (itens concedem proficiência; predicado `weaponId`).
    "Bracers of Archery": ([{"type": "grant_proficiency", "category": "weapon", "id": "longbow"},
                            {"type": "grant_proficiency", "category": "weapon", "id": "shortbow"},
                            {"type": "flat_bonus", "target": "damage.ranged", "value": 2,
                             "when": {"any": [{"weaponId": "longbow"}, {"weaponId": "shortbow"}]}}],
                           "you have proficiency with the Longbow and Shortbow, and you gain a +2 bonus to damage rolls made with such weapons"),
    # Parcial: CON +2 (teto 20) e os benefícios "se você não é anão" seguem no backlog.
    "Belt of Dwarvenkind": ([{"type": "grant_proficiency", "category": "language", "id": "dwarvish"},
                             {"type": "advantage", "target": "skill.persuasion", "note": "Interagir com anões e duergar"},
                             {"type": "ability_increase", "ability": "con", "value": 2, "max": 20}],
                            ["Dwarvish. You know Dwarvish",
                             "You have Advantage on Charisma (Persuasion) checks made to interact with dwarves and duergar",
                             "Toughness. Your Constitution increases by 2, to a maximum of 20"]),
    # Fase 1.5, grupo 5: dano extra só nesta arma, do mesmo tipo do dano dela.
    "Vicious Weapon": ([{"type": "extra_damage", "dice": "2d6", "scope": "weapon"}],
                       ["This magic weapon deals an extra 2d6 damage to any creature it hits",
                        "This extra damage is of the same type as the weapon's normal damage"]),
    "Mantle of Spell Resistance": ([vs_magic("spell")], "You have Advantage on saving throws against spells while you wear this cloak"),
    "Ring of Spell Turning": ([vs_magic("spell")], "you have Advantage on saving throws against spells"),
    "Spellguard Shield": ([vs_magic("magic")], "you have Advantage on saving throws against spells and other magical effects"),
    "Gloves of Thievery": ([{"type": "flat_bonus", "target": "skill.sleight_of_hand", "value": 5}],
                           "you gain a +5 bonus to Dexterity (Sleight of Hand) checks"),
    # Só o próprio portador: o benefício aos aliados é da Fase 4 (auras).
    "Weapon of Warning": ([{"type": "advantage", "target": "initiative"}], "Each subject has Advantage on its Initiative rolls"),
    "Necklace of Adaptation": ([{"type": "advantage", "target": "save.all", "when": {"against": {"condition": "poisoned"}}}],
                               "you have Advantage on saving throws made to avoid or end the Poisoned condition"),
    # A Darkvision de 1 pé não cabe no grid (múltiplos de 5 ft): fica só a vantagem situacional.
    "Eyes of Minute Seeing": ([{"type": "advantage", "target": "skill.investigation", "note": "Examinar algo a até 1 pé"}],
                              "Advantage on Intelligence (Investigation) checks made to examine something within that range"),
    "Talisman of the Sphere": ([{"type": "advantage", "target": "skill.arcana", "note": "Controlar uma Sphere of Annihilation"}],
                               "Advantage on any Intelligence (Arcana) check you make to control a Sphere of Annihilation"),
}
# Variantes lidas dos parágrafos "Nome (Raridade)." que têm efeito passivo: (efeitos, trecho de apoio).
VARIANT_EFFECTS = {
    ("Ioun Stone", "awareness"): ([{"type": "advantage", "target": "initiative"}, {"type": "advantage", "target": "skill.perception"}],
                                  "Advantage on Initiative rolls and Wisdom (Perception) checks"),
    ("Ioun Stone", "protection"): ([{"type": "flat_bonus", "target": "ac", "value": 1}], "+1 bonus to Armor Class"),
    # Fase 1.5, grupo 4: aumentos com o teto do próprio texto, e o bônus de proficiência.
    ("Ioun Stone", "mastery"): ([{"type": "flat_bonus", "target": "proficiency_bonus", "value": 1}], "Your Proficiency Bonus increases by 1"),
}
for _vid, _ability, _label in [("agility", "dex", "Dexterity"), ("fortitude", "con", "Constitution"), ("insight", "wis", "Wisdom"),
                               ("intellect", "int", "Intelligence"), ("leadership", "cha", "Charisma"), ("strength", "str", "Strength")]:
    VARIANT_EFFECTS[("Ioun Stone", _vid)] = ([{"type": "ability_increase", "ability": _ability, "value": 2, "max": 20}],
                                             f"Your {_label} increases by 2, to a maximum of 20")

# --- Leitura dos itens ---------------------------------------------------------------------------------------
lines = text(209, 253)
lines = lines[lines.index("Magic Items A-Z") + 1:]
# Cabeçalhos partidos em duas ou três linhas: junta enquanto há parêntese aberto ou vírgula no fim.
merged, i = [], 0
while i < len(lines):
    s = lines[i]
    if re.match(r"^(" + "|".join(CATEGORIES) + r")( \(|, )", s):
        while i + 1 < len(lines) and (s.count("(") > s.count(")") or s.endswith((",", " Very", " or"))
                                      or re.match(r"^(or (" + RARITY_RE + r")|Rare \(|\()", lines[i + 1])):
            i += 1
            s += " " + lines[i]
    merged.append(s)
    i += 1
lines = merged
starts = [k for k, s in enumerate(lines) if HEADER.match(s)]
items = []
for n, h in enumerate(starts):
    name = lines[h - 1]
    if name[:1].islower():  # nome partido ("Amulet of Proof against Detection" + "and Location")
        name = lines[h - 2] + " " + name
    who = name
    end = starts[n + 1] - 1 if n + 1 < len(starts) else len(lines)
    if n + 1 < len(starts) and lines[starts[n + 1] - 1][:1].islower():
        end -= 1
    m = HEADER.match(lines[h])
    category, sub, rest = CATEGORIES[m.group(1)], m.group(2), m.group(3)
    att = None
    am = re.search(r" \((Requires Attunement[^)]*)\)$", rest)
    if am:
        att = attunement(am.group(1), who)
        rest = rest[: am.start()]
    item = {"id": ID_OVERRIDES.get(name, snake(name)), "name": name, "kind": "magic_item", "category": category}
    body = lines[h + 1:end]
    description = "\n".join(paragraphs(body))
    variants = []
    plus = re.fullmatch(r"(?:(" + RARITY_RE + r") \(\+1\)), (" + RARITY_RE + r") \(\+2\),? or (" + RARITY_RE + r") \(\+3\)", rest)
    if plus:
        if name not in PLUS:
            problems.append(f"{who}: item +N sem efeitos curados")
        label = name.split(",")[0]
        for k, r in enumerate(plus.groups(), start=1):
            variants.append({"id": f"plus_{k}", "name": f"{label}, +{k}", "rarity": RARITIES[r], "effects": PLUS.get(name, lambda _: [])(k)})
    elif name in TABLE_VARIANTS:
        for vid, vname, r, effects, _ in TABLE_VARIANTS[name]:
            v = {"id": vid, "name": vname, "rarity": r}
            if (name, vid) in VARIANT_COST:
                v["cost"] = VARIANT_COST[(name, vid)]
            v["effects"] = effects
            variants.append(v)
    elif rest == "Rarity Varies":
        # Variantes descritas em parágrafos "Anchor (Uncommon). ..." (Feather Token, Figurine, Ioun Stone).
        for p in description.split("\n"):
            vm = re.match(r"^([A-Z][\w' -]+?) \((" + RARITY_RE + r")\)\. ", p)
            if vm:
                vid = snake(vm.group(1))
                effects, evidence = VARIANT_EFFECTS.get((name, vid), ([], None))
                if evidence and evidence not in p:
                    problems.append(f"{who} ({vid}): efeito curado sem o texto de apoio '{evidence}'")
                variants.append({"id": vid, "name": f"{name} ({vm.group(1)})", "rarity": RARITIES[vm.group(2)], "effects": effects})
        if not variants:
            problems.append(f"{who}: raridade variável sem variantes")
    elif name in CHOICE_VARIANTS:
        if rest not in RARITIES:
            problems.append(f"{who}: raridade não reconhecida: {rest}")
        for vid, vname, effects in CHOICE_VARIANTS[name]:
            variants.append({"id": vid, "name": vname, "rarity": RARITIES.get(rest, "rare"), "effects": effects})
    elif rest in RARITIES:
        item["rarity"] = RARITIES[rest]
    else:
        problems.append(f"{who}: raridade não reconhecida: {rest}")
    # Conferência das variantes transcritas: cada nome aparece no texto (sem o prefixo do item, se for o caso).
    if name in TABLE_VARIANTS:
        flat = " ".join(body)
        for _, _, _, _, evidence in TABLE_VARIANTS[name]:
            if evidence not in flat:
                problems.append(f"{who}: linha da tabela '{evidence}' não aparece no texto")
    if variants:
        item["variants"] = variants
    if sub is not None:
        item["base"] = base_rule(category, sub, who)
    elif category == "staff" and re.search(r"\bQuarterstaff\b", description):
        # Cajado que também é arma: "can be wielded as a magic Quarterstaff".
        item["base"] = {"kind": "weapon", "ids": ["quarterstaff"]}
    elif category == "rod" and "functions as a magic Mace" in description:
        item["base"] = {"kind": "weapon", "ids": ["mace"]}  # Rod of Lordly Might
    if att is not None:
        item["attunement"] = att
        item["activation"] = "attuned"
    cm = re.search(r"has (\d+) charges", description)
    if cm:
        charges = {"max": int(cm.group(1))}
        rm = re.search(r"regains ([^.]*?) expended charges? (daily at dawn|at dawn|[^.]*)", description)
        if rm:
            charges["regain"] = f"{rm.group(1)} {rm.group(2)}".strip()
        item["charges"] = charges
    if category in ("potion", "scroll") or name in ("Bead of Force", "Bead of Nourishment", "Dust of Disappearance", "Dust of Dryness",
                                                     "Dust of Sneezing and Choking", "Oil of Etherealness", "Oil of Sharpness",
                                                     "Oil of Slipperiness", "Elixir of Health", "Philter of Love", "Universal Solvent",
                                                     "Sovereign Glue", "Marvelous Pigments", "Feather Token"):
        item["consumable"] = True
    if name in WEIGHT:
        item["weight"] = WEIGHT[name]
    if name in EFFECTS:
        effects, evidence = EFFECTS[name]
        item["effects"] = effects
        for quote in [evidence] if isinstance(evidence, str) else evidence:
            if quote not in description.replace("\n", " "):
                problems.append(f"{who}: efeito curado sem o texto de apoio '{quote}'")
    item["description"] = description
    items.append(item)

names = {i["name"] for i in items}
for k in list(EFFECTS) + list(CHOICE_VARIANTS) + list(TABLE_VARIANTS) + list(PLUS) + [n for n, _ in VARIANT_EFFECTS]:
    if k not in names:
        problems.append(f"curadoria sem item: {k}")
ids = [i["id"] for i in items]
dups = {i for i in ids if ids.count(i) > 1}
if dups:
    problems.append(f"ids repetidos: {sorted(dups)}")
for it in items:
    if len(it["description"]) < 30:
        problems.append(f"{it['name']}: descrição curta demais")

ORDER = ["id", "name", "kind", "category", "rarity", "attunement", "activation", "weight", "base", "variants", "charges", "consumable",
         "effects", "description"]
items = [{k: it[k] for k in ORDER if k in it} for it in items]
with open(DATA / "magic-items.json", "w", encoding="utf-8", newline="\n") as fh:
    json.dump(items, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
per_cat = {}
for it in items:
    per_cat[it["category"]] = per_cat.get(it["category"], 0) + 1
print("itens mágicos:", len(items), "por categoria:", per_cat)
print("com efeitos:", sum(1 for it in items if it.get("effects") or any(v["effects"] for v in it.get("variants", []))),
      "com variantes:", sum(1 for it in items if it.get("variants")), "com item base:", sum(1 for it in items if "base" in it))
print("problemas:", len(problems))
for p in problems:
    print(" -", p)
sys.exit(1 if problems else 0)
