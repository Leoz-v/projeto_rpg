"""Curadoria do dano extra das armas mágicas (Fase 9, nota 0077), usada por `import_magic_items.py`.

Cada arma tem os efeitos (`attack_rider`, ou `extra_damage` quando vale em todo acerto) e o texto de apoio,
que o importador confere na descrição. O que mais a arma faz (salvaguarda, morte) vai como nota.
"""


def r(id_, name, dice, mode="auto", **more):
    return {"type": "attack_rider", "id": id_, "name": name, "dice": dice, "mode": mode, "scope": "weapon", **more}


def always(dice, type_):
    return {"type": "extra_damage", "dice": dice, "damageType": type_, "scope": "weapon"}


RIDERS = {
    "dragon_slayer": ([r("dragon_slayer", "Dragon Slayer", "3d6", onlyTypes=["dragon"])],
                      "deals an extra 3d6 damage of the weapon's type if the target is a Dragon"),
    "giant_slayer": ([r("giant_slayer", "Giant Slayer", "2d6", onlyTypes=["giant"], note="Salvaguarda de Força CD 15 ou Caído (o mestre pede).")],
                     "the Giant takes an extra 2d6 damage of the weapon's type and must succeed on a DC 15 Strength saving throw or have the Prone condition"),
    "holy_avenger": ([r("holy_avenger", "Holy Avenger", "2d10", damageType="radiant", onlyTypes=["fiend", "undead"])],
                     "When you hit a Fiend or an Undead with it, that creature takes an extra 2d10 Radiant damage"),
    "mace_of_disruption": ([r("mace_of_disruption", "Mace of Disruption", "2d6", damageType="radiant", onlyTypes=["fiend", "undead"],
                              note="Com 25 PV ou menos depois do dano: salvaguarda de Sabedoria CD 15 ou é destruído; no sucesso, Amedrontado.")],
                           "When you hit a Fiend or an Undead with this magic weapon, that creature takes an extra 2d6 Radiant damage"),
    "sun_blade": ([r("sun_blade", "Sun Blade", "1d8", damageType="radiant", onlyTypes=["undead"])],
                  "When you hit an Undead with it, that target takes an extra 1d8 Radiant damage"),
    "sword_of_life_stealing": ([r("sword_of_life_stealing", "Sword of Life Stealing", "15", damageType="necrotic", natural20=True, exceptTypes=["construct", "undead"],
                                  note="Quem ataca ganha PV temporários iguais ao dano necrótico sofrido.")],
                               "that target takes an extra 15 Necrotic damage if it isn't a Construct or an Undead"),
    "sword_of_sharpness": ([r("sword_of_sharpness", "Sword of Sharpness", "14", damageType="slashing", natural20=True, note="O alvo ganha 1 nível de Exaustão.")],
                           "that target takes an extra 14 Slashing damage and gains 1 Exhaustion level"),
    "mace_of_smiting": ([r("mace_of_smiting", "Mace of Smiting", "7", damageType="bludgeoning", natural20=True, exceptTypes=["construct"]),
                         r("mace_of_smiting_construct", "Mace of Smiting (Construto)", "14", damageType="bludgeoning", natural20=True, onlyTypes=["construct"],
                           note="Com 25 PV ou menos depois do dano, o Construto é destruído.")],
                        "the target takes an extra 7 Bludgeoning damage, or 14 Bludgeoning damage if it's a Construct"),
    "flame_tongue": ([r("flame_tongue", "Flame Tongue", "2d6", mode="choice", damageType="fire", note="Com as chamas acesas (Ação Bônus).")],
                     "While the weapon is ablaze, it deals an extra 2d6 Fire damage on a hit"),
    "oathbow": ([r("oathbow", "Oathbow", "3d6", mode="choice", damageType="piercing", note="Só contra o inimigo jurado.")],
                "your sworn enemy takes an extra 3d6 Piercing damage"),
    "staff_of_withering": ([r("staff_of_withering", "Staff of Withering", "2d10", mode="choice", damageType="necrotic", cost={"charges": 1},
                              note="Salvaguarda de Constituição CD 15 ou Desvantagem em testes e salvaguardas de Força e Constituição por 1 hora.")],
                           "you can expend 1 charge to deal an extra 2d10 Necrotic damage"),
    "frost_brand": ([always("1d6", "cold")], "the target takes an extra 1d6 Cold damage"),
    "sword_of_wounding": ([always("2d6", "necrotic")], "the target takes an extra 2d6 Necrotic damage"),
}


def put(item, problems):
    if item["id"] not in RIDERS:
        return set()
    effects, evidence = RIDERS[item["id"]]
    if evidence not in " ".join(item["description"].split()):
        problems.append(f"{item['name']}: dano extra curado sem o texto de apoio")
    item["effects"] = [*item.get("effects", []), *effects]
    return {item["id"]}
