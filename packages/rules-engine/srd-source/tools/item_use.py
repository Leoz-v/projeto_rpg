"""Curadoria de usar itens (Fase 9, nota 0074), usada por `import_gear.py` e `import_magic_items.py`.

Cada item (ou variante, com a chave `(id, variante)`) tem o uso (`use`, no formato de
`schemas/item-use.ts`) e as citações do SRD que o apoiam: o importador confere que cada uma aparece
na descrição. O que não cabe no uso fica no texto do item, que vai para o chat.
"""

TYPES = [("acid", "Ácido"), ("cold", "Frio"), ("fire", "Fogo"), ("force", "Energia"), ("lightning", "Elétrico"), ("necrotic", "Necrótico"),
         ("poison", "Veneno"), ("psychic", "Psíquico"), ("radiant", "Radiante"), ("thunder", "Trovejante")]
PHYSICAL = ["bludgeoning", "piercing", "slashing"]


def use(*parts, many=False, duration=None):
    u = {"targets": "many"} if many else {}
    if duration:
        u["duration"] = duration
    u["parts"] = list(parts)
    return u


def heal(dice, temporary=False):
    return {"kind": "heal", "dice": dice, **({"temporary": True} if temporary else {})}


def restore(*conditions, exhaustion=False):
    return {"kind": "restore", **({"conditions": list(conditions)} if conditions else {}), **({"exhaustion": True} if exhaustion else {})}


def buff(*effects, options=()):
    return {"kind": "buff", **({"effects": list(effects)} if effects else {}), **({"options": list(options)} if options else {})}


def cond(*conditions):
    return {"kind": "condition", "conditions": list(conditions)}


def dmg(dice, type_):
    return {"dice": dice, "type": type_}


def save(ability, dc, *damage, on_fail=(), only=(), exempt=()):
    p = {"kind": "save", "ability": ability, "dc": dc}
    if damage:
        p["damage"] = list(damage)
    if on_fail:
        p["onFailConditions"] = list(on_fail)
    if only:
        p["onlyTypes"] = list(only)
    if exempt:
        p["exceptTypes"] = list(exempt)
    return p


def resist(t):
    return {"type": "resistance", "damageType": t}


def bonus(target):
    return {"type": "d20_bonus", "dice": "1d4", "target": target}


def adv(target, **more):
    return {"type": "advantage", "target": target, **more}


DEX_DC = {"ability": "dex"}
DEX_DC_TEXT = "Dexterity saving throw (DC 8 plus your Dexterity modifier and Proficiency Bonus)"

# Equipamento de aventura: id -> (uso, citações).
GEAR_USE = {
    "acid": (use(save("dex", DEX_DC, dmg("2d6", "acid"))), [DEX_DC_TEXT, "or take 2d6 Acid damage"]),
    "alchemists_fire": (use(save("dex", DEX_DC, dmg("1d4", "fire"))), [DEX_DC_TEXT, "or take 1d4 Fire damage"]),
    "holy_water": (use(save("dex", DEX_DC, dmg("2d8", "radiant"), only=("fiend", "undead"))),
                   [DEX_DC_TEXT, "or take 2d8 Radiant damage if it is a Fiend or an Undead"]),
    "antitoxin": (use(buff(adv("save.all", when={"against": {"condition": "poisoned"}})), duration="1 hora"),
                  ["Advantage on saving throws to avoid or end the Poisoned condition for 1 hour"]),
}

# Itens mágicos: id ou (id, variante) -> (uso, citações).
MAGIC_USE = {
    ("potion_of_healing", "healing"): (use(heal("2d4+2")), ["Potion of Healing 2d4 + 2 Common"]),
    ("potion_of_healing", "greater"): (use(heal("4d4+4")), ["(greater) 4d4 + 4 Uncommon"]),
    ("potion_of_healing", "superior"): (use(heal("8d4+8")), ["(superior) 8d4 + 8 Rare"]),
    ("potion_of_healing", "supreme"): (use(heal("10d4+20")), ["(supreme) 10d4 + 20 Very Rare"]),
    "elixir_of_health": (use(restore("blinded", "deafened", "paralyzed", "poisoned")),
                         ["the following conditions end on you: Blinded, Deafened, Paralyzed, and Poisoned"]),
    # Os efeitos da magia Bless (`spell_resolution.py`).
    "potion_of_heroism": (use(heal("10", temporary=True), buff(bonus("attack.all"), bonus("save.all")), duration="1 hora"),
                          ["you gain 10 Temporary Hit Points that last for 1 hour", "under the effect of the Bless spell"]),
    "potion_of_invisibility": (use(cond("invisible"), duration="1 hora; acaba ao atacar, causar dano ou conjurar"),
                               ["you have the Invisible condition for 1 hour"]),
    "potion_of_invulnerability": (use(buff(*[resist(t) for t in PHYSICAL + [t for t, _ in TYPES]]), duration="1 minuto"),
                                  ["For 1 minute after you drink this potion, you have Resistance to all damage"]),
    "potion_of_resistance": (use(buff(options=[{"label": pt, "effects": [resist(t)]} for t, pt in TYPES]), duration="1 hora"),
                             ["you have Resistance to one type of damage for 1 hour"]),
    **{("potion_of_giant_strength", vid): (use(buff({"type": "set_minimum_score", "ability": "str", "value": value}), duration="1 hora"),
                                           ["your Strength score changes for 1 hour", f"{label} {value}"])
       for vid, label, value in [("hill", "(hill)", 21), ("frost_or_stone", "(frost or stone)", 23), ("fire", "(fire)", 25),
                                 ("cloud", "(cloud)", 27), ("storm", "(storm)", 29)]},
    # Os efeitos da magia Enlarge/Reduce.
    "potion_of_growth": (use(buff(adv("check.str"), adv("save.str"), {"type": "extra_damage", "dice": "1d4"}), duration="10 minutos"),
                         ['you gain the "enlarge" effect of the Enlarge/Reduce spell for 10 minutes']),
    "potion_of_diminution": (use(buff({"type": "disadvantage", "target": "check.str"}, {"type": "disadvantage", "target": "save.str"}),
                                 duration="1d4 horas"),
                             ['you gain the "reduce" effect of the Enlarge/Reduce spell for 1d4 hours']),
    # Os efeitos da magia Haste.
    "potion_of_speed": (use(buff({"type": "flat_bonus", "target": "ac", "value": 2}, adv("save.dex"),
                                 {"type": "reminder", "on": "turn_start",
                                  "note": "Haste: Deslocamento dobrado e uma ação a mais neste turno (Atacar com um ataque, Disparada, "
                                          "Desengajar, Esconder ou Usar)."}), duration="1 minuto"),
                        ["you gain the effect of the Haste spell for 1 minute"]),
    "potion_of_climbing": (use(buff({"type": "grant_speed", "speed": "climb", "value": "walk"},
                                    adv("skill.athletics", note="Só para escalar.")), duration="1 hora"),
                           ["you gain a Climb Speed equal to your Speed for 1 hour", "Advantage on Strength (Athletics) checks to climb"]),
    "potion_of_flying": (use(buff({"type": "grant_speed", "speed": "fly", "value": "walk"}), duration="1 hora"),
                         ["you gain a Fly Speed equal to your Speed for 1 hour"]),
    "potion_of_poison": (use({"kind": "damage", "damage": [dmg("4d6", "poison")]}, save("con", 13, on_fail=("poisoned",)), duration="1 hora"),
                         ["you take 4d6 Poison damage and must succeed on a DC 13 Constitution saving throw or have the Poisoned condition for 1 hour"]),
    "potion_of_vitality": (use(restore("poisoned", exhaustion=True), duration="24 horas (Dados de Vida no máximo)"),
                           ["it removes any Exhaustion levels you have and ends the Poisoned condition on you"]),
    "dust_of_disappearance": (use(cond("invisible"), many=True, duration="2d4 minutos; acaba ao atacar, causar dano ou conjurar"),
                              ["have the Invisible condition for 2d4 minutes"]),
    "dust_of_sneezing_and_choking": (use(save("con", 15, on_fail=("incapacitated",), exempt=("construct", "elemental", "ooze", "plant", "undead")),
                                         many=True, duration="repete a salvaguarda no fim de cada turno"),
                                     ["DC 15 Constitution saving throw", "Constructs, Elementals, Oozes, Plants, and Undead succeed on the save automatically",
                                      "it has the Incapacitated condition"]),
    "bead_of_force": (use(save("dex", 15, dmg("5d4", "force")), many=True),
                      ["must succeed on a DC 15 Dexterity saving throw or take 5d4 Force damage"]),
}


def check(who, quotes, description, problems):
    flat = " ".join(description.split())
    for quote in quotes:
        if quote not in flat:
            problems.append(f"{who}: uso curado sem o texto de apoio '{quote}'")


def put(item, curated, problems):
    """Põe o uso no item e nas variantes; devolve as chaves usadas."""
    seen = set()
    for holder, key in [(item, item["id"])] + [(v, (item["id"], v["id"])) for v in item.get("variants", [])]:
        if key in curated:
            seen.add(key)
            holder["use"], quotes = curated[key]
            check(str(key), quotes, item["description"], problems)
    return seen
