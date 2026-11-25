"""Curadoria da resolução das magias (Fase 7, notas 0054 e 0056), usada por `import_spells.py`.

Cada magia lista as suas partes (`resolution`): ataque de magia, salvaguarda, dano direto, cura ou
condição sem salvaguarda. As condições dizem até quando duram (`end`): "spell" (até a magia acabar),
"caster_turn_start" ou "caster_turn_end" (até o início ou o fim do próximo turno de quem conjura). Uma magia
com mais de uma parte (Ice Knife: o fragmento e a explosão) dá um nome a cada uma. O importador confere
cada parte contra o texto: o dado base aparece na descrição, o atributo da salvaguarda aparece como
"<Atributo> saving throw", a escala por círculo aparece em "Using a Higher-Level Spell Slot" e o truque
tem "Cantrip Upgrade". As citações (`quotes`) são o texto de apoio do resto (condições, metade no erro).

O que tem mecânica mas fica fora daqui é classificado em `automation_backlog.py` (`spell:<id>`).
"""

TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant",
         "slashing", "thunder"]


def dmg(dice, type_, per=None, mod=False):
    """Dano: dados no círculo da magia (ou no 1º patamar do truque), tipo (ou tipos para escolher), dados por círculo acima."""
    d = {"dice": dice, "type": type_}
    if per:
        d["perSlot"] = per
    if mod:
        d["addModifier"] = True
    return d


def _base(kind, damage, label, count):
    p = {"kind": kind}
    if label:
        p["label"] = label
    if damage:
        p["damage"] = list(damage)
    if count:
        p["count"] = {"base": count[0], **({"perSlot": count[1]} if len(count) > 1 else {})}
    return p


def atk(attack_kind, *damage, label=None, count=None, on_hit=(), on_miss=None, end=None):
    p = _base("attack", damage, label, count)
    p["attackKind"] = attack_kind
    if on_miss:
        p["onMiss"] = on_miss
    if on_hit:
        p["onHitConditions"] = list(on_hit)
    if end:
        p["conditionsEnd"] = end
    return p


def sv(ability, *damage, label=None, success="half", on_fail=(), count=None, end=None, choice=False, effects=()):
    """Salvaguarda; `choice`: quem conjura escolhe uma das condições da falha."""
    p = _base("save", damage, label, count)
    p["ability"] = ability
    p["onSuccess"] = success
    if on_fail:
        p["onFailConditions"] = list(on_fail)
    if choice:
        p["conditionChoice"] = True
    if effects:
        p["onFailEffects"] = list(effects)
    if end:
        p["conditionsEnd"] = end
    return p


def heal(dice, per=None, mod=False, temp=False, ends=(), count=None, label=None):
    """Cura (ou PV temporários) direto nos alvos; `dice="full"`: todos os PV. `ends`: condições que a cura termina."""
    p = _base("heal", (), label, count)
    if dice == "full":
        p["healing"] = "full"
    else:
        p["healing"] = {"dice": dice, **({"perSlot": per} if per else {}), **({"addModifier": True} if mod else {})}
    if temp:
        p["temporary"] = True
    if ends:
        p["endConditions"] = list(ends)
    return p


def buff(*effects, upcast=(), options=(), ends=(), count=None, label=None):
    """Bônus ou penalidade enquanto a magia dura (nota 0060): efeitos do catálogo na ficha do alvo.
    `upcast`: efeitos somados por círculo acima. `options`: (rótulo, [efeitos]) para quem conjura escolher."""
    p = _base("buff", (), label, count)
    if effects:
        p["effects"] = list(effects)
    if upcast:
        p["upcast"] = list(upcast)
    if options:
        p["options"] = [{"label": lab, "effects": list(eff)} for lab, eff in options]
    if ends:
        p["endConditions"] = list(ends)
    return p


# Efeitos do catálogo (docs/effects-spec.md) para as partes `buff`.
def fb(target, value):
    return {"type": "flat_bonus", "target": target, "value": value}


def adv(target, when=None):
    return {"type": "advantage", "target": target, **({"when": when} if when else {})}


def dis(target):
    return {"type": "disadvantage", "target": target}


def against(mode, types=None, note=None):
    """Vantagem ou Desvantagem nos ataques contra o alvo (nota 0062)."""
    return {"type": "attacks_against", "mode": mode, **({"from": types} if types else {}), **({"note": note} if note else {})}


def d20b(dice, target, subtract=False):
    return {"type": "d20_bonus", "dice": dice, "target": target, **({"subtract": True} if subtract else {})}


def res(damage_type):
    return {"type": "resistance", "damageType": damage_type}


def immune(condition):
    return {"type": "immunity", "condition": condition}


def remind(note, on="turn_start"):
    return {"type": "reminder", "on": on, "note": note}


TYPE_PT = {"acid": "Ácido", "bludgeoning": "Concussão", "cold": "Frio", "fire": "Fogo", "force": "Energia", "lightning": "Elétrico",
           "necrotic": "Necrótico", "piercing": "Perfurante", "poison": "Veneno", "psychic": "Psíquico", "radiant": "Radiante",
           "slashing": "Cortante", "thunder": "Trovejante"}
ABILITY_PT = {"str": "Força", "dex": "Destreza", "con": "Constituição", "int": "Inteligência", "wis": "Sabedoria", "cha": "Carisma"}
SKILL_PT = {"acrobatics": "Acrobacia", "animal_handling": "Lidar com Animais", "arcana": "Arcanismo", "athletics": "Atletismo",
            "deception": "Enganação", "history": "História", "insight": "Intuição", "intimidation": "Intimidação",
            "investigation": "Investigação", "medicine": "Medicina", "nature": "Natureza", "perception": "Percepção",
            "performance": "Atuação", "persuasion": "Persuasão", "religion": "Religião", "sleight_of_hand": "Prestidigitação",
            "stealth": "Furtividade", "survival": "Sobrevivência"}


def cond(*conditions, label=None, count=None, end=None):
    """Condição sem salvaguarda (Invisibility)."""
    p = _base("condition", (), label, count)
    p["conditions"] = list(conditions)
    if end:
        p["conditionsEnd"] = end
    return p


def auto(*damage, label=None, count=None):
    return _base("damage", damage, label, count)


# Nome da magia -> (partes, citações de apoio, melhoria do truque: "damage" multiplica os dados, "count" os ataques).
RESOLUTION = {
    # --- Ataques de magia ---------------------------------------------------------------------------------------
    "Acid Arrow": ([atk("ranged", dmg("4d4", "acid", "1d4"), on_miss="half"),
                    auto(dmg("2d4", "acid", "1d4"), label="Fim do próximo turno do alvo")],
                   ["On a miss, the arrow splashes the target with acid for half as much of the initial damage only",
                    "2d4 Acid damage at the end of its next turn"], None),
    "Arcane Hand": ([atk("melee", dmg("5d8", "force", "2d8"), label="Clenched Fist"),
                     sv("dex", label="Grasping Hand", success="none", on_fail=["grappled"], end="spell"),
                     auto(dmg("4d6", "bludgeoning", "2d6", mod=True), label="Grasping Hand (esmagar)")],
                    ["Make a melee spell attack. On a hit, the target takes 5d8 Force damage",
                     "the target has the Grappled condition", "Bludgeoning damage to the target equal to 4d6 plus your spellcasting ability modifier",
                     "the Grasping Hand increases by 2d6"], None),
    "Arcane Sword": ([atk("melee", dmg("4d12", "force", mod=True))],
                     ["you make a melee spell attack", "Force damage equal to 4d12 plus your spellcasting ability modifier"], None),
    "Chill Touch": ([atk("melee", dmg("1d10", "necrotic"))], ["make a melee spell attack"], "damage"),
    "Chromatic Orb": ([atk("ranged", dmg("3d8", ["acid", "cold", "fire", "lightning", "poison", "thunder"], "1d8"))],
                      ["Choose Acid, Cold, Fire, Lightning, Poison, or Thunder", "make a ranged spell attack"], None),
    "Conjure Fey": ([atk("melee", dmg("3d12", "psychic", "1d12", mod=True), on_hit=["frightened"], end="caster_turn_start")],
                    ["make one melee spell attack", "Psychic damage equal to 3d12 plus your spellcasting ability modifier, and the target has the Frightened condition"],
                    None),
    "Eldritch Blast": ([atk("ranged", dmg("1d10", "force"), count=(1,))],
                       ["Make a ranged spell attack", "The spell creates two beams at level 5, three beams at level 11, and four beams at level 17"], "count"),
    "Fire Bolt": ([atk("ranged", dmg("1d10", "fire"))], ["Make a ranged spell attack"], "damage"),
    "Flame Blade": ([atk("melee", dmg("3d6", "fire", "1d6", mod=True))],
                    ["make a melee spell attack", "Fire damage equal to 3d6 plus your spellcasting ability modifier"], None),
    "Guiding Bolt": ([atk("ranged", dmg("4d6", "radiant", "1d6"))], ["Make a ranged spell attack"], None),
    "Ice Knife": ([atk("ranged", dmg("1d10", "piercing"), label="Fragmento"),
                   sv("dex", dmg("2d6", "cold", "1d6"), label="Explosão", success="none")],
                  ["Make a ranged spell attack", "must succeed on a Dexterity saving throw or take 2d6 Cold damage", "The Cold damage increases by 1d6"],
                  None),
    "Poison Spray": ([atk("ranged", dmg("1d12", "poison"))], ["Make a ranged spell attack"], "damage"),
    "Produce Flame": ([atk("ranged", dmg("1d8", "fire"))], ["Make a ranged spell attack"], "damage"),
    "Ray of Frost": ([atk("ranged", dmg("1d8", "cold"))], ["Make a ranged spell attack"], "damage"),
    "Ray of Sickness": ([atk("ranged", dmg("2d8", "poison", "1d8"), on_hit=["poisoned"], end="caster_turn_end")],
                        ["Make a ranged spell attack", "has the Poisoned condition"], None),
    "Scorching Ray": ([atk("ranged", dmg("2d6", "fire"), count=(3, 1))],
                      ["You hurl three fiery rays", "Make a ranged spell attack for each ray", "You create one additional ray for each spell slot level above 2"],
                      None),
    "Shocking Grasp": ([atk("melee", dmg("1d8", "lightning"))], ["Make a melee spell attack"], "damage"),
    "Sorcerous Burst": ([atk("ranged", dmg("1d8", ["acid", "cold", "fire", "lightning", "poison", "psychic", "thunder"]))],
                        ["Make a ranged spell attack", "Acid, Cold, Fire, Lightning, Poison, Psychic, or Thunder"], "damage"),
    "Spiritual Weapon": ([atk("melee", dmg("1d8", "force", "1d8", mod=True))],
                         ["make one melee spell attack", "Force damage equal to 1d8 plus your spellcasting ability modifier"], None),
    "Starry Wisp": ([atk("ranged", dmg("1d8", "radiant"))], ["Make a ranged spell attack"], "damage"),
    "Vampiric Touch": ([atk("melee", dmg("3d6", "necrotic", "1d6"))], ["Make a melee spell attack"], None),

    # --- Salvaguardas -------------------------------------------------------------------------------------------
    "Acid Splash": ([sv("dex", dmg("1d6", "acid"), success="none")], ["must succeed on a Dexterity saving throw or take 1d6 Acid damage"], "damage"),
    "Befuddlement": ([sv("int", dmg("10d12", "psychic"))], ["On a successful save, the target takes half as much damage only"], None),
    "Black Tentacles": ([sv("str", dmg("3d6", "bludgeoning"), success="none", on_fail=["restrained"], end="spell")],
                        ["On a failed save, it takes 3d6 Bludgeoning damage, and it has the Restrained condition"], None),
    "Blade Barrier": ([sv("dex", dmg("6d10", "force"))], ["taking 6d10 Force damage on a failed save or half as much damage on a successful one"], None),
    "Blight": ([sv("con", dmg("8d8", "necrotic", "1d8"))], ["taking 8d8 Necrotic damage on a failed save or half as much damage on a successful one"], None),
    "Burning Hands": ([sv("dex", dmg("3d6", "fire", "1d6"))], ["taking 3d6 Fire damage on a failed save or half as much damage on a successful one"], None),
    "Call Lightning": ([sv("dex", dmg("3d10", "lightning", "1d10"))],
                       ["taking 3d10 Lightning damage on a failed save or half as much damage on a successful one"], None),
    "Chain Lightning": ([sv("dex", dmg("10d8", "lightning"))], ["taking 10d8 Lightning damage on a failed save or half as much damage on a successful one"], None),
    "Circle of Death": ([sv("con", dmg("8d8", "necrotic", "2d8"))], ["taking 8d8 Necrotic damage on a failed save or half as much damage on a successful one"], None),
    "Cloudkill": ([sv("con", dmg("5d8", "poison", "1d8"))], ["taking 5d8 Poison damage on a failed save or half as much damage on a successful one"], None),
    "Cone of Cold": ([sv("con", dmg("8d8", "cold", "1d8"))], ["taking 8d8 Cold damage on a failed save or half as much damage on a successful one"], None),
    "Conjure Animals": ([sv("dex", dmg("3d10", "slashing", "1d10"), success="none")], ["On a failed save, the creature takes 3d10 Slashing damage"], None),
    "Conjure Celestial": ([heal("4d12", "1d12", mod=True, label="Healing Light"), sv("dex", dmg("6d12", "radiant", "1d12"), label="Searing Light")],
                          ["The target regains Hit Points equal to 4d12 plus your spellcasting ability modifier",
                           "taking 6d12 Radiant damage on a failed save or half as much damage on a successful one"], None),
    "Conjure Elemental": ([sv("dex", dmg("8d8", ["lightning", "thunder", "fire", "cold"], "1d8"), success="none", on_fail=["restrained"], end="spell")],
                          ["air (Lightning), earth (Thunder), fire (Fire), or water (Cold)", "On failed save, the target takes 8d8 damage of the spirit's type, and the target has the Restrained condition"],
                          None),
    "Conjure Woodland Beings": ([sv("wis", dmg("5d8", "force", "1d8"))],
                                ["The creature takes 5d8 Force damage on a failed save or half as much damage on a successful one"], None),
    "Contagion": ([sv("con", dmg("11d8", "necrotic"), success="none", on_fail=["poisoned"])],
                  ["must succeed on a Constitution saving throw or take 11d8 Necrotic damage and have the Poisoned condition"], None),
    "Control Water": ([sv("str", dmg("2d8", "bludgeoning"), label="Whirlpool")],
                      ["On a failed save, the creature takes 2d8 Bludgeoning damage. On a successful save, the creature takes half as much damage"], None),
    "Delayed Blast Fireball": ([sv("dex", dmg("12d6", "fire", "1d6"))],
                               ["The spell's base damage is 12d6", "on a failed save or half as much damage on a successful one", "The base damage increases by 1d6"],
                               None),
    "Disintegrate": ([sv("dex", dmg("10d6+40", "force", "3d6"), success="none")], ["On a failed save, the target takes 10d6 + 40 Force damage"], None),
    "Dissonant Whispers": ([sv("wis", dmg("3d6", "psychic", "1d6"))], ["On a successful save, the target takes half as much damage only"], None),
    "Dragon's Breath": ([sv("dex", dmg("3d6", ["acid", "cold", "fire", "lightning", "poison"], "1d6"))],
                        ["choose Acid, Cold, Fire, Lightning, or Poison", "taking 3d6 damage of the chosen type on a failed save or half as much damage on a successful one"],
                        None),
    "Earthquake": ([sv("dex", label="Tremor", success="none", on_fail=["prone"]),
                    sv("dex", dmg("12d6", "bludgeoning"), label="Desabamento", on_fail=["prone"])],
                   ["On a failed save, a creature has the Prone condition", "the creature takes 12d6 Bludgeoning damage, has the Prone condition",
                    "On a successful save, the creature takes half as much damage only"], None),
    "Faithful Hound": ([sv("dex", dmg("4d8", "force"), success="none")], ["must succeed on a Dexterity saving throw or take 4d8 Force damage"], None),
    "Finger of Death": ([sv("con", dmg("7d8+30", "necrotic"))], ["taking 7d8 + 30 Necrotic damage on a failed save or half as much damage on a successful one"], None),
    "Fireball": ([sv("dex", dmg("8d6", "fire", "1d6"))], ["taking 8d6 Fire damage on a failed save or half as much damage on a successful one"], None),
    "Fire Storm": ([sv("dex", dmg("7d10", "fire"))], ["taking 7d10 Fire damage on a failed save or half as much damage on a successful one"], None),
    "Flame Strike": ([sv("dex", dmg("5d6", "fire", "1d6"), dmg("5d6", "radiant", "1d6"))],
                     ["taking 5d6 Fire damage and 5d6 Radiant damage on a failed save or half as much damage on a successful one",
                      "The Fire damage and the Radiant damage increase by 1d6"], None),
    "Flaming Sphere": ([sv("dex", dmg("2d6", "fire", "1d6"))], ["taking 2d6 Fire damage on a failed save or half as much damage on a successful one"], None),
    "Freezing Sphere": ([sv("con", dmg("10d6", "cold", "1d6"))], ["taking 10d6 Cold damage on failed save or half as much damage on a successful one"], None),
    "Glyph of Warding": ([sv("dex", dmg("5d8", ["acid", "cold", "fire", "lightning", "thunder"], "1d8"), label="Explosive Rune")],
                         ["A creature takes 5d8 Acid, Cold, Fire, Lightning, or Thunder damage (your choice when you create the glyph) on a failed save or half as much damage on a successful one",
                          "The damage of an explosive rune increases by 1d8"], None),
    "Harm": ([sv("con", dmg("14d6", "necrotic"))], ["On a failed save, it takes 14d6 Necrotic damage", "On a successful save, it takes half as much damage only"], None),
    "Hellish Rebuke": ([sv("dex", dmg("2d10", "fire", "1d10"))], ["taking 2d10 Fire damage on a failed save or half as much damage on a successful one"], None),
    "Ice Storm": ([sv("dex", dmg("2d10", "bludgeoning", "1d10"), dmg("4d6", "cold"))],
                  ["A creature takes 2d10 Bludgeoning damage and 4d6 Cold damage on a failed save or half as much damage on a successful one",
                   "The Bludgeoning damage increases by 1d10"], None),
    "Incendiary Cloud": ([sv("dex", dmg("10d8", "fire"))], ["taking 10d8 Fire damage on a failed save or half as much damage on a successful one"], None),
    "Inflict Wounds": ([sv("con", dmg("2d10", "necrotic", "1d10"))], ["taking 2d10 Necrotic damage on a failed save or half as much damage on a successful one"], None),
    "Insect Plague": ([sv("con", dmg("4d10", "piercing", "1d10"))], ["taking 4d10 Piercing damage on a failed save or half as much damage on a successful one"], None),
    "Lightning Bolt": ([sv("dex", dmg("8d6", "lightning", "1d6"))], ["taking 8d6 Lightning damage on a failed save or half as much damage on a successful one"], None),
    "Meteor Swarm": ([sv("dex", dmg("20d6", "fire"), dmg("20d6", "bludgeoning"))],
                     ["A creature takes 20d6 Fire damage and 20d6 Bludgeoning damage on a failed save or half as much damage on a successful one"], None),
    "Mind Spike": ([sv("wis", dmg("3d8", "psychic", "1d8"))], ["taking 3d8 Psychic damage on a failed save or half as much damage on a successful one"], None),
    "Moonbeam": ([sv("con", dmg("2d10", "radiant", "1d10"))], ["On a successful save, a creature takes half as much damage only"], None),
    "Phantasmal Killer": ([sv("wis", dmg("4d10", "psychic", "1d10")),
                           sv("wis", dmg("4d10", "psychic", "1d10"), label="Fim do turno do alvo", success="none")],
                          ["On a successful save, the target takes half as much damage, and the spell ends",
                           "the target makes a Wisdom saving throw at the end of each of its turns. On a failed save, it takes the Psychic damage again"], None),
    "Prismatic Spray": ([sv("dex", dmg("12d6", "fire"), label="Red"), sv("dex", dmg("12d6", "acid"), label="Orange"),
                         sv("dex", dmg("12d6", "lightning"), label="Yellow"), sv("dex", dmg("12d6", "poison"), label="Green"),
                         sv("dex", dmg("12d6", "cold"), label="Blue"), sv("dex", label="Indigo", success="none", on_fail=["restrained"]),
                         sv("dex", label="Violet", success="none", on_fail=["blinded"])],
                        ["Red. Failed Save: 12d6 Fire damage", "Orange. Failed Save: 12d6 Acid damage", "Yellow. Failed Save: 12d6 Lightning damage",
                         "Green. Failed Save: 12d6 Poison damage", "Blue. Failed Save: 12d6 Cold damage", "Indigo. Failed Save: The target has the Restrained condition",
                         "Violet. Failed Save: The target has the Blinded condition"], None),
    "Sacred Flame": ([sv("dex", dmg("1d8", "radiant"), success="none")], ["must succeed on a Dexterity saving throw or take 1d8 Radiant damage"], "damage"),
    "Shatter": ([sv("con", dmg("3d8", "thunder", "1d8"))], ["taking 3d8 Thunder damage on a failed save or half as much damage on a successful one"], None),
    "Spirit Guardians": ([sv("wis", dmg("3d8", ["radiant", "necrotic"], "1d8"))],
                         ["3d8 Radiant damage (if you are good or neutral) or 3d8 Necrotic damage (if you are evil)", "the creature takes half as much damage"], None),
    "Storm of Vengeance": ([sv("con", dmg("2d6", "thunder"), success="none", on_fail=["deafened"], end="spell"),
                            auto(dmg("4d6", "acid"), label="Turno 2"),
                            sv("dex", dmg("10d6", "lightning"), label="Turno 3"),
                            auto(dmg("2d6", "bludgeoning"), label="Turno 4"),
                            auto(dmg("1d6", "cold"), label="Turnos 5-10")],
                           ["must succeed on a Constitution saving throw or take 2d6 Thunder damage and have the Deafened condition",
                            "takes 4d6 Acid damage", "taking 10d6 Lightning damage on a failed save or half as much damage on a successful one",
                            "takes 2d6 Bludgeoning damage", "takes 1d6 Cold damage"], None),
    "Sunbeam": ([sv("con", dmg("6d8", "radiant"), on_fail=["blinded"], end="caster_turn_start")],
                ["takes 6d8 Radiant damage and has the Blinded condition", "On a successful save, it takes half as much damage only"], None),
    "Sunburst": ([sv("con", dmg("12d6", "radiant"), on_fail=["blinded"])],
                 ["takes 12d6 Radiant damage and has the Blinded condition", "On a successful save, it takes half as much damage only"], None),
    "Symbol": ([sv("con", dmg("10d10", "necrotic"), label="Death"),
                sv("wis", label="Fear", success="none", on_fail=["frightened"]),
                sv("con", label="Pain", success="none", on_fail=["incapacitated"]),
                sv("wis", label="Sleep", success="none", on_fail=["unconscious"]),
                sv("wis", label="Stunning", success="none", on_fail=["stunned"])],
               ["taking 10d10 Necrotic damage on a failed save or half as much damage on a successful save",
                "Fear. Each target must succeed on a Wisdom saving throw or have the Frightened condition",
                "Pain. Each target must succeed on a Constitution saving throw or have the Incapacitated condition",
                "Sleep. Each target must succeed on a Wisdom saving throw or have the Unconscious condition",
                "Stunning. Each target must succeed on a Wisdom saving throw or have the Stunned condition"], None),
    "Thunderwave": ([sv("con", dmg("2d8", "thunder", "1d8"))], ["On a successful save, a creature takes half as much damage only"], None),
    "Tsunami": ([sv("str", dmg("6d10", "bludgeoning")), sv("str", dmg("5d10", "bludgeoning"), label="Onda em movimento", success="none")],
                ["taking 6d10 Bludgeoning damage on a failed save or half as much damage on a successful one",
                 "must succeed on a Strength saving throw or take 5d10 Bludgeoning damage"], None),
    "Vicious Mockery": ([sv("wis", dmg("1d6", "psychic"), success="none")], ["must succeed on a Wisdom saving throw or take 1d6 Psychic damage"], "damage"),
    "Vitriolic Sphere": ([sv("dex", dmg("10d4", "acid", "2d4")), auto(dmg("5d4", "acid"), label="Fim do próximo turno do alvo")],
                         ["On a failed save, a creature takes 10d4 Acid damage and another 5d4 Acid damage at the end of its next turn",
                          "On a successful save, a creature takes half the initial damage only", "The initial damage increases by 2d4"], None),
    "Wall of Fire": ([sv("dex", dmg("5d8", "fire", "1d8"))], ["taking 5d8 Fire damage on a failed save or half as much damage on a successful one"], None),
    "Wall of Ice": ([sv("dex", dmg("10d6", "cold", "2d6")), sv("con", dmg("5d6", "cold", "1d6"), label="Ar gélido")],
                    ["taking 10d6 Cold damage on a failed save or half as much damage on a successful one",
                     "taking 5d6 Cold damage on a failed save or half as much damage on a successful one", "increases by 2d6", "increases by 1d6"], None),
    "Wall of Thorns": ([sv("dex", dmg("7d8", "piercing", "1d8")), sv("dex", dmg("7d8", "slashing", "1d8"), label="Atravessar")],
                       ["taking 7d8 Piercing damage on a failed save or half as much damage on a successful one",
                        "taking 7d8 Slashing damage on a failed save or half as much damage on a successful one", "Both types of damage increase by 1d8"], None),
    "Web": ([sv("dex", label="Teia", success="none", on_fail=["restrained"], end="spell"), auto(dmg("2d4", "fire"), label="Teia em chamas")],
            ["must succeed on a Dexterity saving throw or have the Restrained condition", "dealing 2d4 Fire damage"], None),
    "Weird": ([sv("wis", dmg("10d10", "psychic"), on_fail=["frightened"], end="spell"), sv("wis", dmg("5d10", "psychic"), label="Fim do turno do alvo", success="none")],
              ["a target takes 10d10 Psychic damage and has the Frightened condition", "On a successful save, a target takes half as much damage only",
               "On a failed save, it takes 5d10 Psychic damage"], None),
    "Wind Wall": ([sv("str", dmg("4d8", "bludgeoning"))], ["taking 4d8 Bludgeoning damage on a failed save or half as much damage on a successful one"], None),
    "Phantasmal Force": ([sv("int", success="none"), auto(dmg("2d8", "psychic"), label="Dano do fantasma")],
                         ["The target makes an Intelligence saving throw", "such a phantasm can deal 2d8 Psychic damage to the target"], None),
    "Geas": ([sv("wis", success="none", on_fail=["charmed"], end="spell"), auto(dmg("5d10", "psychic"), label="Desobedecer")],
             ["must succeed on a Wisdom saving throw or have the Charmed condition", "takes 5d10 Psychic damage if it acts in a manner directly counter to your command"],
             None),
    "Ensnaring Strike": ([sv("str", success="none", on_fail=["restrained"], end="spell"), auto(dmg("1d6", "piercing", "1d6"), label="Início do turno do alvo")],
                         ["On a failed save, the target has the Restrained condition", "the target takes 1d6 Piercing damage at the start of each of its turns"], None),

    # --- Dano direto (sem ataque nem salvaguarda) ---------------------------------------------------------------
    "Magic Missile": ([auto(dmg("1d4+1", "force"), count=(3, 1))],
                      ["You create three glowing darts", "A dart deals 1d4 + 1 Force damage", "The spell creates one more dart for each spell slot level above 1"],
                      None),
    "Divine Smite": ([auto(dmg("2d8", "radiant", "1d8"))], ["The target takes an extra 2d8 Radiant damage from the attack"], None),
    "Searing Smite": ([auto(dmg("1d6", "fire", "1d6"), label="No acerto"), auto(dmg("1d6", "fire", "1d6"), label="Início do turno do alvo")],
                      ["it takes an extra 1d6 Fire damage from the attack", "the target takes 1d6 Fire damage and then makes a Constitution saving throw",
                       "All the damage increases by 1d6"], None),
    "Shining Smite": ([auto(dmg("2d6", "radiant", "1d6"))], ["The target hit by the strike takes an extra 2d6 Radiant damage"], None),
    "Heat Metal": ([auto(dmg("2d8", "fire", "1d8"))], ["takes 2d8 Fire damage when you cast the spell"], None),
    "Spike Growth": ([auto(dmg("2d4", "piercing"), label="A cada 5 ft")], ["it takes 2d4 Piercing damage for every 5 feet it travels"], None),
    "Forbiddance": ([auto(dmg("5d10", ["radiant", "necrotic"]))], ["the creature takes 5d10 Radiant or Necrotic damage (your choice when you cast this spell)"], None),
    "Fire Shield": ([auto(dmg("2d8", ["fire", "cold"]), label="Retaliação")],
                    ["The attacker takes 2d8 Fire damage from a warm shield or 2d8 Cold damage from a chill shield"], None),
    "Power Word Kill": ([auto(dmg("12d12", "psychic"), label="Acima de 100 PV")], ["Otherwise, it takes 12d12 Psychic damage"], None),
    "Dimension Door": ([auto(dmg("4d6", "force"), label="Destino ocupado")], ["each take 4d6 Force damage, and the teleportation fails"], None),
    "Meld into Stone": ([auto(dmg("6d6", "force"), label="Pedra danificada"), auto(dmg("50", "force"), label="Pedra destruída")],
                        ["expels you and deals 6d6 Force damage to you", "expels you and deals 50 Force damage to you"], None),
    "Teleport": ([auto(dmg("3d10", "force"), label="Acidente")], ["Each teleporting creature (or the target object) takes 3d10 Force damage"], None),

    # --- Cura (Fase 7, PR 3, nota 0056) ---------------------------------------------------------------------------
    "Cure Wounds": ([heal("2d8", "2d8", mod=True)], ["regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier"], None),
    "Healing Word": ([heal("2d4", "2d4", mod=True)], ["regains Hit Points equal to 2d4 plus your spellcasting ability modifier"], None),
    "Mass Cure Wounds": ([heal("5d8", "1d8", mod=True, count=(6,))],
                         ["Choose up to six creatures", "Each target regains Hit Points equal to 5d8 plus your spellcasting ability modifier"], None),
    "Mass Healing Word": ([heal("2d4", "1d4", mod=True, count=(6,))],
                          ["Up to six creatures of your choice", "regain Hit Points equal to 2d4 plus your spellcasting ability modifier"], None),
    "Prayer of Healing": ([heal("2d8", "1d8", count=(5,))], ["Up to five creatures of your choice", "also regain 2d8 Hit Points"], None),
    "Heal": ([heal("70", "10", ends=["blinded", "deafened", "poisoned"])],
             ["restoring 70 Hit Points", "This spell also ends the Blinded, Deafened, and Poisoned conditions on the target"], None),
    "Power Word Heal": ([heal("full", ends=["charmed", "frightened", "paralyzed", "poisoned", "stunned"])],
                        ["The target regains all its Hit Points", "If the creature has the Charmed, Frightened, Paralyzed, Poisoned, or Stunned condition, the condition ends"],
                        None),
    "Regenerate": ([heal("4d8+15")], ["A creature you touch regains 4d8 + 15 Hit Points"], None),
    "False Life": ([heal("2d4+4", "5", temp=True)], ["You gain 2d4 + 4 Temporary Hit Points", "You gain 5 additional Temporary Hit Points for each spell slot level above 1"], None),

    # --- Condição por salvaguarda ou sem ela (Fase 7, PR 3, nota 0056) ------------------------------------------
    "Animal Friendship": ([sv("wis", success="none", on_fail=["charmed"], count=(1, 1), end="spell")],
                          ["must succeed on a Wisdom saving throw or have the Charmed condition for the duration",
                           "You can target one additional Beast for each spell slot level above 1"], None),
    "Blindness/Deafness": ([sv("con", success="none", on_fail=["blinded", "deafened"], choice=True, count=(1, 1), end="spell")],
                           ["it has the Blinded or Deafened condition (your choice) for the duration",
                            "You can target one additional creature for each spell slot level above 2"], None),
    "Charm Monster": ([sv("wis", success="none", on_fail=["charmed"], count=(1, 1), end="spell")],
                      ["On a failed save, the target has the Charmed condition until the spell ends",
                       "You can target one additional creature for each spell slot level above 4"], None),
    "Charm Person": ([sv("wis", success="none", on_fail=["charmed"], count=(1, 1), end="spell")],
                     ["On a failed save, the target has the Charmed condition until the spell ends",
                      "You can target one additional creature for each spell slot level above 1"], None),
    "Color Spray": ([sv("con", success="none", on_fail=["blinded"], end="caster_turn_end")],
                    ["must succeed on a Constitution saving throw or have the Blinded condition until the end of your next turn"], None),
    "Dominate Beast": ([sv("wis", success="none", on_fail=["charmed"], end="spell")],
                       ["must succeed on a Wisdom saving throw or have the Charmed condition for the duration"], None),
    "Dominate Monster": ([sv("wis", success="none", on_fail=["charmed"], end="spell")],
                         ["must succeed on a Wisdom saving throw or have the Charmed condition for the duration"], None),
    "Dominate Person": ([sv("wis", success="none", on_fail=["charmed"], end="spell")],
                        ["must succeed on a Wisdom saving throw or have the Charmed condition for the duration"], None),
    "Entangle": ([sv("str", success="none", on_fail=["restrained"], end="spell")],
                 ["must succeed on a Strength saving throw or have the Restrained condition until the spell ends"], None),
    "Fear": ([sv("wis", success="none", on_fail=["frightened"], end="spell")],
             ["must succeed on a Wisdom saving throw or drop whatever it is holding and have the Frightened condition for the duration"], None),
    "Flesh to Stone": ([sv("con", success="none", on_fail=["restrained"], end="spell")],
                       ["On a failed save, it has the Restrained condition for the duration"], None),
    "Grease": ([sv("dex", success="none", on_fail=["prone"])], ["must succeed on a Dexterity saving throw or have the Prone condition"], None),
    "Hideous Laughter": ([sv("wis", success="none", on_fail=["prone", "incapacitated"], count=(1, 1), end="spell")],
                         ["On a failed save, it has the Prone and Incapacitated conditions for the duration",
                          "You can target one additional creature for each spell slot level above 1"], None),
    "Hold Monster": ([sv("wis", success="none", on_fail=["paralyzed"], count=(1, 1), end="spell")],
                     ["must succeed on a Wisdom saving throw or have the Paralyzed condition for the duration",
                      "You can target one additional creature for each spell slot level above 5"], None),
    "Hold Person": ([sv("wis", success="none", on_fail=["paralyzed"], count=(1, 1), end="spell")],
                    ["must succeed on a Wisdom saving throw or have the Paralyzed condition for the duration",
                     "You can target one additional Humanoid for each spell slot level above 2"], None),
    "Hypnotic Pattern": ([sv("wis", success="none", on_fail=["charmed", "incapacitated"], end="spell")],
                         ["must succeed on a Wisdom saving throw or have the Charmed condition for the duration",
                          "While Charmed, the creature has the Incapacitated condition"], None),
    "Irresistible Dance": ([sv("wis", success="none", on_fail=["charmed"], end="spell")],
                           ["On a failed save, the target has the Charmed condition for the duration"], None),
    "Suggestion": ([sv("wis", success="none", on_fail=["charmed"], end="spell")],
                   ["must succeed on a Wisdom saving throw or have the Charmed condition for the duration"], None),
    "Mass Suggestion": ([sv("wis", success="none", on_fail=["charmed"], count=(12,), end="spell")],
                        ["to twelve or fewer creatures", "Each target must succeed on a Wisdom saving throw or have the Charmed condition for the duration"],
                        None),
    "Invisibility": ([cond("invisible", count=(1, 1), end="spell")],
                     ["A creature you touch has the Invisible condition until the spell ends",
                      "You can target one additional creature for each spell slot level above 2"], None),
    "Greater Invisibility": ([cond("invisible", end="spell")], ["A creature you touch has the Invisible condition until the spell ends"], None),

    # --- Bônus e penalidades enquanto a magia dura (Fase 7, PR 4a, nota 0060) ------------------------------------
    "Aid": ([buff(fb("hp_max", 5), upcast=[fb("hp_max", 5)], count=(3,))],
            ["Choose up to three creatures", "Each target's Hit Point maximum and current Hit Points increase by 5 for the duration",
             "Each target's Hit Points increase by 5 for each spell slot level above 2"], None),
    "Beacon of Hope": ([buff(adv("save.wis"), adv("death_save"))],
                       ["each target has Advantage on Wisdom saving throws and Death Saving Throws"], None),
    "Bane": ([sv("cha", success="none", effects=[d20b("1d4", "attack.all", True), d20b("1d4", "save.all", True)], count=(3, 1))],
             ["Up to three creatures", "the target must subtract 1d4 from the attack roll or save",
              "You can target one additional creature for each spell slot level above 1"], None),
    "Barkskin": ([buff({"type": "minimum_ac", "value": 17}, count=(1,))], ["has an Armor Class of 17 if its AC is lower than that"], None),
    "Blur": ([buff(against("disadvantage", note="não vale contra quem percebe o alvo com Visão às Cegas ou Visão Verdadeira"), count=(1,))],
             ["any creature has Disadvantage on attack rolls against you", "if it perceives you with Blindsight or Truesight"], None),
    "Faerie Fire": ([sv("dex", success="none", effects=[against("advantage", note="se o atacante puder ver o alvo")])],
                    ["Attack rolls against an affected creature or object have Advantage if the attacker can see it"], None),
    "Holy Aura": ([buff(adv("save.all"), against("disadvantage"))],
                  ["creatures of your choice have Advantage on all saving throws, and other creatures have Disadvantage on attack rolls against them"], None),
    "Protection from Evil and Good": ([buff(against("disadvantage", ["aberration", "celestial", "elemental", "fey", "fiend", "undead"]), count=(1,))],
                                      ["Aberrations, Celestials, Elementals, Fey, Fiends, or Undead",
                                       "Creatures of those types have Disadvantage on attack rolls against the target"], None),
    "Ray of Enfeeblement": ([sv("con", success="none", count=(1,), effects=[
        dis("save.str"), dis("check.str"),
        remind("Ray of Enfeeblement: repete a salvaguarda de Constituição; no sucesso, o efeito acaba.", "turn_end")])],
        ["the target has Disadvantage on Strength-based D20 Tests for the duration", "The target repeats the save at the end of each of its turns"], None),
    "Slow": ([sv("wis", success="none", count=(6,), effects=[
        fb("ac", -2), fb("save.dex", -2),
        remind("Slow: Deslocamento pela metade, sem Reações, ação ou Ação Bônus (não as duas) e um só ataque; magia somática tem 25% de chance de falhar."),
        remind("Slow: repete a salvaguarda de Sabedoria; no sucesso, o efeito acaba.", "turn_end")])],
        ["up to six creatures", "a -2 penalty to AC and Dexterity saving throws", "it can't take Reactions", "An affected target repeats the save at the end of each of its turns"], None),
    "Bless": ([buff(d20b("1d4", "attack.all"), d20b("1d4", "save.all"), count=(3, 1))],
              ["You bless up to three creatures", "the target adds 1d4 to the attack roll or save",
               "You can target one additional creature for each spell slot level above 1"], None),
    "Divine Favor": ([buff({"type": "extra_damage", "dice": "1d4", "damageType": "radiant"}, count=(1,))],
                     ["your attacks with weapons deal an extra 1d4 Radiant damage on a hit"], None),
    "Enhance Ability": ([buff(options=[(ABILITY_PT[a], [adv(f"check.{a}")]) for a in ("str", "dex", "int", "wis", "cha")], count=(1, 1))],
                        ["choose Strength, Dexterity, Intelligence, Wisdom, or Charisma", "the target has Advantage on ability checks using the chosen ability",
                         "You can target one additional creature for each spell slot level above 2"], None),
    "Foresight": ([buff(adv("attack.all"), adv("save.all"), adv("initiative"), adv("death_save"),
                        *[adv(f"check.{a}") for a in ("str", "dex", "con", "int", "wis", "cha")], against("disadvantage"), count=(1,))],
                  ["the target has Advantage on D20 Tests", "other creatures have Disadvantage on attack rolls against it"], None),
    "Guidance": ([buff(options=[(SKILL_PT[k], [d20b("1d4", f"skill.{k}")]) for k in SKILL_PT], count=(1,))],
                 ["choose a skill", "the creature adds 1d4 to any ability check using the chosen skill"], None),
    "Haste": ([buff(fb("ac", 2), adv("save.dex"),
                    remind("Haste: Deslocamento dobrado e uma ação a mais neste turno (Atacar com um ataque, Disparada, Desengajar, Esconder ou Usar)."),
                    count=(1,))],
              ["the target's Speed is doubled, it gains a +2 bonus to Armor Class, it has Advantage on Dexterity saving throws, and it gains an additional action"],
              None),
    "Heroism": ([buff(immune("frightened"), remind("Heroism: ganha PV temporários iguais ao modificador de conjuração de quem conjurou."), count=(1, 1))],
                ["the creature is immune to the Frightened condition and gains Temporary Hit Points equal to your spellcasting ability modifier at the start of each of its turns",
                 "You can target one additional creature for each spell slot level above 1"], None),
    "Longstrider": ([buff(fb("speed.walk", 10), count=(1, 1))],
                    ["The target's Speed increases by 10 feet", "You can target one additional creature for each spell slot level above 1"], None),
    "Mage Armor": ([buff({"type": "set_base_ac", "base": 13, "abilities": ["dex"], "when": {"wearingArmor": False}}, count=(1,))],
                   ["the target's base AC becomes 13 plus its Dexterity modifier", "The spell ends early if the target dons armor"], None),
    "Pass without Trace": ([buff(fb("skill.stealth", 10))], ["you and each creature you choose have a +10 bonus to Dexterity (Stealth) checks"], None),
    "Protection from Energy": ([buff(options=[(TYPE_PT[t], [res(t)]) for t in ("acid", "cold", "fire", "lightning", "thunder")], count=(1,))],
                               ["has Resistance to one damage type of your choice: Acid, Cold, Fire, Lightning, or Thunder"], None),
    "Protection from Poison": ([buff(adv("save.all", {"against": {"condition": "poisoned"}}), res("poison"), ends=["poisoned"], count=(1,))],
                               ["end the Poisoned condition on it",
                                "the target has Advantage on saving throws to avoid or end the Poisoned condition, and it has Resistance to Poison damage"], None),
    "Resistance": ([buff(options=[(TYPE_PT[t], [{"type": "damage_reduction", "damageType": t, "amount": "1d4", "note": "Uma vez por turno."}])
                                  for t in ("acid", "bludgeoning", "cold", "fire", "lightning", "necrotic", "piercing", "poison", "radiant", "slashing", "thunder")],
                         count=(1,))],
                   ["choose a damage type: Acid, Bludgeoning, Cold, Fire, Lightning, Necrotic, Piercing, Poison, Radiant, Slashing, or Thunder",
                    "the creature reduces the total damage taken by 1d4", "A creature can benefit from this spell only once per turn"], None),
    "Shield of Faith": ([buff(fb("ac", 2), count=(1,))], ["granting it a +2 bonus to AC for the duration"], None),
    "Stoneskin": ([buff(res("bludgeoning"), res("piercing"), res("slashing"), count=(1,))],
                  ["has Resistance to Bludgeoning, Piercing, and Slashing damage"], None),
    "Warding Bond": ([buff(fb("ac", 1), fb("save.all", 1), *[res(t) for t in TYPE_PT],
                           remind("Warding Bond: cada dano que sofrer, quem conjurou sofre também (a até 60 ft)."), count=(1,))],
                     ["it gains a +1 bonus to AC and saving throws, and it has Resistance to all damage", "each time it takes damage, you take the same amount of damage"],
                     None),
    "Aura of Life": ([buff(res("necrotic"))], ["you and your allies have Resistance to Necrotic damage"], None),
    "Heroes' Feast": ([buff(res("poison"), immune("frightened"), immune("poisoned"), count=(12,))],
                      ["Up to twelve creatures can partake of the feast",
                       "The creature has Resistance to Poison damage, and it has Immunity to the Frightened and Poisoned conditions"], None),
    "Freedom of Movement": ([buff({"type": "grant_speed", "speed": "swim", "value": "walk"}, count=(1,))],
                            ["The target also has a Swim Speed equal to its Speed"], None),
}
