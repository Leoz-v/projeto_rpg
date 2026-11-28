"""Curadoria das magias de itens e da última carga (Fase 9, nota 0075), usada por `import_magic_items.py`.

Cada item lista as magias com o custo em cargas. O importador confere que o nome de cada magia e o
texto de apoio aparecem na descrição, que a magia existe e que o custo cabe nas cargas.
"""


def s(spell, charges, level=None, upto=None, note=None, text=None):
    """Magia do item: custo, círculo fixo, custo máximo (cada carga a mais, um círculo acima) e ressalva."""
    e = {"spellId": spell, "charges": charges}
    if level:
        e["level"] = level
    if upto:
        e["maxCharges"] = upto
    if note:
        e["note"] = note
    return e, text


# id -> (CD fixa ou None, carregado em vez de equipado, magias com o texto da tabela).
CASTING = {
    "cubic_gate": (None, True, [s("gate", 1, text="you cast Gate"), s("plane_shift", 1, text="you cast Plane Shift")]),
    "dragon_orb": (18, True, [s("cure_wounds", 4, level=9, text="Cure Wounds (level 9 version) 4"), s("daylight", 1, text="Daylight 1"),
                              s("death_ward", 2, text="Death Ward 2"), s("detect_magic", 0, text="Detect Magic 0"),
                              s("scrying", 3, text="Scrying (save DC 18) 3")]),
    "helm_of_teleportation": (None, False, [s("teleport", 1, text="expend 1 charge to cast Teleport")]),
    "medallion_of_thoughts": (13, False, [s("detect_thoughts", 1, text="expend 1 charge to cast Detect Thoughts (save DC 13)")]),
    "ring_of_animal_influence": (13, False, [s("animal_friendship", 1, text="Animal Friendship"),
                                             s("fear", 1, note="Só afeta Feras", text="Fear (affects Beasts only)"),
                                             s("speak_with_animals", 1, text="Speak with Animals")]),
    "ring_of_elemental_command": (18, False, [
        s("chain_lightning", 3, note="Anel do ar", text="Chain Lightning (3 charges)"), s("feather_fall", 0, note="Anel do ar", text="Feather Fall (0 charges)"),
        s("gust_of_wind", 2, note="Anel do ar", text="Gust of Wind (2 charges)"), s("wind_wall", 1, note="Anel do ar", text="Wind Wall (1 charge)"),
        s("earthquake", 5, note="Anel da terra", text="Earthquake (5 charges)"), s("stone_shape", 2, note="Anel da terra", text="Stone Shape (2 charges)"),
        s("stoneskin", 3, note="Anel da terra", text="Stoneskin (3 charges)"), s("wall_of_stone", 3, note="Anel da terra", text="Wall of Stone (3 charges)"),
        s("burning_hands", 1, note="Anel do fogo", text="Burning Hands (1 charge)"), s("fireball", 2, note="Anel do fogo", text="Fireball (2 charges)"),
        s("fire_storm", 4, note="Anel do fogo", text="Fire Storm (4 charges)"), s("wall_of_fire", 3, note="Anel do fogo", text="Wall of Fire (3 charges)"),
        s("create_or_destroy_water", 1, note="Anel da água", text="Create or Destroy Water (1 charge)"),
        s("ice_storm", 2, note="Anel da água", text="Ice Storm (2 charges)"), s("tsunami", 5, note="Anel da água", text="Tsunami (5 charges)"),
        s("wall_of_ice", 3, note="Anel da água", text="Wall of Ice (3 charges)"), s("water_walk", 2, note="Anel da água", text="Water Walk (2 charges)")]),
    "ring_of_shooting_stars": (None, False, [s("dancing_lights", 0, text="You can cast Dancing Lights or Light from the ring"), s("light", 0, text="Dancing Lights or Light"),
                                             s("faerie_fire", 1, text="expend 1 charge to cast Faerie Fire")]),
    "staff_of_charming": (None, False, [s("charm_person", 1, text="expend 1 of the staff's charges to cast Charm Person, Command, or Comprehend Languages"),
                                        s("command", 1, text="Command"), s("comprehend_languages", 1, text="Comprehend Languages")]),
    "staff_of_fire": (None, False, [s("burning_hands", 1, text="Burning Hands 1"), s("wall_of_fire", 4, text="Wall of Fire 4"), s("fireball", 3, text="Fireball 3")]),
    "staff_of_frost": (None, False, [s("cone_of_cold", 5, text="Cone of Cold 5"), s("ice_storm", 4, text="Ice Storm 4"), s("fog_cloud", 1, text="Fog Cloud 1"),
                                     s("wall_of_ice", 4, text="Wall of Ice 4")]),
    "staff_of_healing": (None, False, [s("cure_wounds", 1, upto=4, text="Cure Wounds 1 charge per spell level (maximum 4 for a level 4 spell)"),
                                       s("lesser_restoration", 2, text="Lesser Restoration 2"), s("mass_cure_wounds", 5, text="Mass Cure Wounds 5")]),
    "staff_of_power": (None, False, [s("cone_of_cold", 5, text="Cone of Cold 5"), s("fireball", 5, level=5, text="Fireball (level 5 version) 5"),
                                     s("globe_of_invulnerability", 6, text="Globe of Invulnerability 6"), s("hold_monster", 5, text="Hold Monster 5"),
                                     s("levitate", 2, text="Levitate 2"), s("lightning_bolt", 5, level=5, text="Lightning Bolt (level 5 version) 5"),
                                     s("magic_missile", 1, text="Magic Missile 1"), s("ray_of_enfeeblement", 1, text="Ray of Enfeeblement 1"),
                                     s("wall_of_force", 5, text="Wall of Force 5")]),
    "staff_of_swarming_insects": (None, False, [s("giant_insect", 4, text="Giant Insect 4"), s("insect_plague", 5, text="Insect Plague 5")]),
    "staff_of_the_magi": (None, False, [
        s("arcane_lock", 0, text="Arcane Lock 0"), s("conjure_elemental", 7, text="Conjure Elemental 7"), s("detect_magic", 0, text="Detect Magic 0"),
        s("dispel_magic", 3, text="Dispel Magic 3"), s("enlarge_reduce", 0, text="Enlarge/Reduce 0"), s("fireball", 7, level=7, text="Fireball (level 7 version) 7"),
        s("flaming_sphere", 2, text="Flaming Sphere 2"), s("ice_storm", 4, text="Ice Storm 4"), s("invisibility", 2, text="Invisibility 2"),
        s("knock", 2, text="Knock 2"), s("light", 0, text="Light 0"), s("lightning_bolt", 7, level=7, text="Lightning Bolt (level 7 version) 7"),
        s("mage_hand", 0, text="Mage Hand 0"), s("passwall", 5, text="Passwall 5"), s("plane_shift", 7, text="Plane Shift 7"),
        s("protection_from_evil_and_good", 0, text="Protection from Evil and Good 0"), s("telekinesis", 5, text="Telekinesis 5"),
        s("wall_of_fire", 4, text="Wall of Fire 4"), s("web", 2, text="Web 2")]),
    "staff_of_the_woodlands": (None, False, [
        s("animal_friendship", 1, text="Animal Friendship 1"), s("awaken", 5, text="Awaken 5"), s("barkskin", 2, text="Barkskin 2"),
        s("locate_animals_or_plants", 2, text="Locate Animals or Plants 2"), s("pass_without_trace", 2, text="Pass without Trace 2"),
        s("speak_with_animals", 1, text="Speak with Animals 1"), s("speak_with_plants", 3, text="Speak with Plants 3"),
        s("wall_of_thorns", 6, text="Wall of Thorns 6")]),
    "trident_of_fish_command": (15, True, [s("dominate_beast", 1, note="Só uma Fera com deslocamento de natação", text="cast Dominate Beast (save DC 15) from it on a Beast that has a Swim Speed")]),
    "wand_of_binding": (17, False, [s("hold_monster", 5, text="Hold Monster 5"), s("hold_person", 2, text="Hold Person 2")]),
    "wand_of_fear": (15, False, [s("command", 1, note="Só \"flee\" ou \"grovel\"", text="Command (\"flee\" or \"grovel\" only) 1"),
                                 s("fear", 3, note="Cone de 60 ft", text="Fear (60-foot Cone) 3")]),
    "wand_of_fireballs": (15, False, [s("fireball", 1, upto=3, text="expend no more than 3 charges to cast Fireball (save DC 15)")]),
    "wand_of_lightning_bolts": (15, False, [s("lightning_bolt", 1, upto=3, text="expend no more than 3 charges to cast Lightning Bolt (save DC 15)")]),
    "wand_of_magic_detection": (None, False, [s("detect_magic", 1, text="expend 1 charge to cast Detect Magic")]),
    "wand_of_magic_missiles": (None, False, [s("magic_missile", 1, upto=3, text="expend no more than 3 charges to cast Magic Missile")]),
    "wand_of_polymorph": (15, False, [s("polymorph", 1, text="expend 1 charge to cast Polymorph (save DC 15)")]),
    "wand_of_web": (13, False, [s("web", 1, text="expend 1 charge to cast Web (save DC 13)")]),
}

# Última carga: destruído, destruído com 1 no d20, ou outra consequência (com 1 ou 20) que o mestre aplica.
LAST_CHARGE = {
    "destroyed": ["scarab_of_protection", "talisman_of_pure_good", "talisman_of_ultimate_evil"],
    "gm": ["staff_of_power", "staff_of_striking", "staff_of_the_magi", "staff_of_the_woodlands"],
    "destroyed_on_1": ["rod_of_resurrection", "staff_of_charming", "staff_of_fire", "staff_of_frost", "staff_of_healing", "staff_of_swarming_insects",
                       "wand_of_binding", "wand_of_enemy_detection", "wand_of_fear", "wand_of_fireballs", "wand_of_lightning_bolts",
                       "wand_of_magic_missiles", "wand_of_paralysis", "wand_of_polymorph", "wand_of_web", "wand_of_wonder"],
}
# "has 24 charges" é de uma das nove figuras (o bode de viagem), não do item.
NOT_CHARGES = {"figurine_of_wondrous_power"}


def put(item, spell_ids, problems):
    import re
    flat = " ".join(item["description"].split())
    charges = item.get("charges")
    if item["id"] in NOT_CHARGES:
        item.pop("charges", None)
        charges = None
    if charges:
        m = re.match(r"(\d+d\d+(?: \+ \d+)?|\d+) daily at dawn$", charges.get("regain", ""))
        if m:
            charges["regainDice"] = m.group(1).replace(" ", "")
        elif "regain" in charges:
            problems.append(f"{item['name']}: recarga não reconhecida: {charges['regain']}")
        rule = next((r for r, ids in LAST_CHARGE.items() if item["id"] in ids), None)
        if rule:
            charges["lastCharge"] = rule
            needle = {"destroyed": "destroyed", "gm": "roll 1d20", "destroyed_on_1": "roll 1d20. On a 1,"}[rule]
            if "last charge" not in flat or needle not in flat:
                problems.append(f"{item['name']}: última carga curada sem o texto de apoio")
        elif "last charge, roll 1d20" in flat:
            problems.append(f"{item['name']}: última carga sem curadoria")
    if item["id"] in CASTING:
        dc, carried, spells = CASTING[item["id"]]
        if dc and f"save DC {dc}" not in flat and f"save DC of {dc}" not in flat:
            problems.append(f"{item['name']}: CD {dc} sem o texto de apoio")
        for e, text in spells:
            if e["spellId"] not in spell_ids:
                problems.append(f"{item['name']}: magia desconhecida {e['spellId']}")
            if text not in flat:
                problems.append(f"{item['name']}: magia sem o texto de apoio '{text}'")
            if not charges or e.get("maxCharges", e["charges"]) > charges["max"]:
                problems.append(f"{item['name']}: custo de {e['spellId']} maior que as cargas")
        item["casting"] = {**({"saveDc": dc} if dc else {}), **({"carried": True} if carried else {}), "spells": [e for e, _ in spells]}
