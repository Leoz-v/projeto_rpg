"""Curadoria da resolução das magias de dano (Fase 7, nota 0054), usada por `import_spells.py`.

Cada magia lista as suas partes (`resolution`): ataque de magia, salvaguarda ou dano direto. Uma magia
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


def atk(attack_kind, *damage, label=None, count=None, on_hit=(), on_miss=None):
    p = _base("attack", damage, label, count)
    p["attackKind"] = attack_kind
    if on_miss:
        p["onMiss"] = on_miss
    if on_hit:
        p["onHitConditions"] = list(on_hit)
    return p


def sv(ability, *damage, label=None, success="half", on_fail=(), count=None):
    p = _base("save", damage, label, count)
    p["ability"] = ability
    p["onSuccess"] = success
    if on_fail:
        p["onFailConditions"] = list(on_fail)
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
                     sv("dex", label="Grasping Hand", success="none", on_fail=["grappled"]),
                     auto(dmg("4d6", "bludgeoning", "2d6", mod=True), label="Grasping Hand (esmagar)")],
                    ["Make a melee spell attack. On a hit, the target takes 5d8 Force damage",
                     "the target has the Grappled condition", "Bludgeoning damage to the target equal to 4d6 plus your spellcasting ability modifier",
                     "the Grasping Hand increases by 2d6"], None),
    "Arcane Sword": ([atk("melee", dmg("4d12", "force", mod=True))],
                     ["you make a melee spell attack", "Force damage equal to 4d12 plus your spellcasting ability modifier"], None),
    "Chill Touch": ([atk("melee", dmg("1d10", "necrotic"))], ["make a melee spell attack"], "damage"),
    "Chromatic Orb": ([atk("ranged", dmg("3d8", ["acid", "cold", "fire", "lightning", "poison", "thunder"], "1d8"))],
                      ["Choose Acid, Cold, Fire, Lightning, Poison, or Thunder", "make a ranged spell attack"], None),
    "Conjure Fey": ([atk("melee", dmg("3d12", "psychic", "1d12", mod=True), on_hit=["frightened"])],
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
    "Ray of Sickness": ([atk("ranged", dmg("2d8", "poison", "1d8"), on_hit=["poisoned"])],
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
    "Black Tentacles": ([sv("str", dmg("3d6", "bludgeoning"), success="none", on_fail=["restrained"])],
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
    "Conjure Celestial": ([sv("dex", dmg("6d12", "radiant", "1d12"), label="Searing Light")],
                          ["taking 6d12 Radiant damage on a failed save or half as much damage on a successful one"], None),
    "Conjure Elemental": ([sv("dex", dmg("8d8", ["lightning", "thunder", "fire", "cold"], "1d8"), success="none", on_fail=["restrained"])],
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
    "Storm of Vengeance": ([sv("con", dmg("2d6", "thunder"), success="none", on_fail=["deafened"]),
                            auto(dmg("4d6", "acid"), label="Turno 2"),
                            sv("dex", dmg("10d6", "lightning"), label="Turno 3"),
                            auto(dmg("2d6", "bludgeoning"), label="Turno 4"),
                            auto(dmg("1d6", "cold"), label="Turnos 5-10")],
                           ["must succeed on a Constitution saving throw or take 2d6 Thunder damage and have the Deafened condition",
                            "takes 4d6 Acid damage", "taking 10d6 Lightning damage on a failed save or half as much damage on a successful one",
                            "takes 2d6 Bludgeoning damage", "takes 1d6 Cold damage"], None),
    "Sunbeam": ([sv("con", dmg("6d8", "radiant"), on_fail=["blinded"])],
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
    "Web": ([sv("dex", label="Teia", success="none", on_fail=["restrained"]), auto(dmg("2d4", "fire"), label="Teia em chamas")],
            ["must succeed on a Dexterity saving throw or have the Restrained condition", "dealing 2d4 Fire damage"], None),
    "Weird": ([sv("wis", dmg("10d10", "psychic"), on_fail=["frightened"]), sv("wis", dmg("5d10", "psychic"), label="Fim do turno do alvo", success="none")],
              ["a target takes 10d10 Psychic damage and has the Frightened condition", "On a successful save, a target takes half as much damage only",
               "On a failed save, it takes 5d10 Psychic damage"], None),
    "Wind Wall": ([sv("str", dmg("4d8", "bludgeoning"))], ["taking 4d8 Bludgeoning damage on a failed save or half as much damage on a successful one"], None),
    "Phantasmal Force": ([sv("int", success="none"), auto(dmg("2d8", "psychic"), label="Dano do fantasma")],
                         ["The target makes an Intelligence saving throw", "such a phantasm can deal 2d8 Psychic damage to the target"], None),
    "Geas": ([sv("wis", success="none", on_fail=["charmed"]), auto(dmg("5d10", "psychic"), label="Desobedecer")],
             ["must succeed on a Wisdom saving throw or have the Charmed condition", "takes 5d10 Psychic damage if it acts in a manner directly counter to your command"],
             None),
    "Ensnaring Strike": ([sv("str", success="none", on_fail=["restrained"]), auto(dmg("1d6", "piercing", "1d6"), label="Início do turno do alvo")],
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
}
