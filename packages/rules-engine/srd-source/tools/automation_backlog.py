"""Gera/atualiza o backlog de automação (Fase 1.5): tudo o que tem mecânica mas não tem efeito declarado.

Uso (a partir da raiz do repositório):
    python packages/rules-engine/srd-source/tools/automation_backlog.py

Lê o compêndio (`src/srd/data/`) e grava `tests/srd/automation-backlog.json`. As classificações
ficam neste script (regras por palavra-chave e exceções explícitas), para a próxima geração não
desfazer a curadoria. O teste `tests/srd/automation-backlog.test.ts` confere que toda entrada sem
efeito está classificada. Ver docs/decisions/0015-etapa-de-automacao.md e docs/automation-backlog.md.

Categorias:
- structural: a mecânica já existe em outro ponto do modelo (escolha, conjuração, concessão);
- automate:   passivo, automatizável agora (com `mechanic`: a extensão de catálogo necessária);
- phase_4:    resolução de ações (ataque, dano, salvaguarda, magia, recurso, uso de item);
- phase_5:    combate (iniciativa, turnos, condições, concentração, morte);
- gm:         julgamento do mestre ou narrativo, com efeito real mas não mecanizável sem distorcer;
- none:       descritivo, sem mecânica.
"""
import json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
PKG = HERE.parent.parent
DATA = PKG / "src" / "srd" / "data"
OUT = PKG / "tests" / "srd" / "automation-backlog.json"

# Extensões de catálogo agrupadas (um PR por grupo, contrato em docs/effects-spec.md primeiro).
# Vazio desde o fim da fila da Fase 1.5; conteúdo novo `automate` volta a declarar a sua mecânica aqui.
MECHANICS = {}

# --- Características (espécie, antecedente, talento, classe, subclasse) ----------------------------------------
FEATURE = {
    # Mecânica já modelada por escolha, concessão ou conjuração no mesmo nível da fonte (o teste de guarda confere
    # que o nível tem alguma concessão além da característica).
    "structural": [
        "species:dragonborn/draconic_ancestry_trait", "species:dragonborn/damage_resistance", "species:elf/elven_lineage_trait",
        "species:elf/keen_senses_trait", "species:gnome/gnomish_lineage_trait", "species:goliath/giant_ancestry_trait",
        "species:human/skillful_trait", "species:human/versatile_trait", "species:tiefling/fiendish_legacy_trait",
        "class:barbarian/weapon_mastery_feature", "class:paladin/weapon_mastery_feature", "class:ranger/weapon_mastery_feature",
        "class:rogue/weapon_mastery_feature", "class:barbarian/primal_champion", "class:monk/body_and_mind",
        "class:bard/expertise_feature", "class:rogue/expertise_feature", "class:bard/magical_secrets", "class:cleric/divine_order",
        "class:druid/primal_order", "class:cleric/blessed_strikes", "class:druid/elemental_fury", "class:paladin/fighting_style_feature",
        "class:ranger/fighting_style_feature", "class:ranger/deft_explorer", "class:warlock/eldritch_invocations",
        "class:warlock/mystic_arcanum", "class:warlock/lessons_of_the_first_ones", "class:warlock/pact_of_the_tome",
        "class:wizard/spell_mastery", "class:wizard/signature_spells_feature", "class:sorcerer/metamagic",
        "subclass:evoker/evocation_savant_feature", "subclass:college_of_lore/bonus_proficiencies",
        "subclass:college_of_lore/magical_discoveries", "subclass:life_domain/life_domain_spells",
        "subclass:circle_of_the_land/circle_of_the_land_spells", "subclass:oath_of_devotion/oath_of_devotion_spells",
        "subclass:draconic_sorcery/draconic_spells", "subclass:fiend_patron/fiend_spells", "subclass:hunter/hunters_prey",
        "subclass:hunter/defensive_tactics", "subclass:draconic_sorcery/elemental_affinity", "subclass:fiend_patron/fiendish_resilience",
        "class:barbarian/primal_knowledge", "class:wizard/spellcasting", "class:bard/spellcasting", "class:cleric/spellcasting",
        "class:druid/spellcasting", "class:paladin/spellcasting", "class:ranger/spellcasting", "class:sorcerer/spellcasting",
        "class:warlock/pact_magic",
    ],
    "automate": {},
    # Lembretes de iniciativa e de turno (`reminder`, nota 0043) já saíram; fica a Concentração (Fase 5, PR 5).
    "phase_5": [
        "class:ranger/relentless_hunter",
    ],
    "gm": [
        "species:elf/trance", "species:halfling/halfling_nimbleness", "species:halfling/naturally_stealthy", "species:gnome/clockwork_device",
        "class:monk/acrobatic_movement", "feat:grappler/fast_wrestler", "class:warlock/devils_sight", "class:warlock/gaze_of_two_minds",
        "subclass:hunter/hunters_lore", "class:druid/beast_spells", "feat:boon_of_the_night_spirit/shadowy_form",
        "class:warlock/investment_of_the_chain_master",
    ],
}
# Motivos específicos, no lugar do motivo da categoria.
FEATURE_REASON_OVERRIDE = {
    "class:ranger/relentless_hunter": "Concentração em Hunter's Mark que o dano não quebra (Concentração, Fase 5).",
    "subclass:berserker/mindless_rage": "Imunidade enquanto a Fúria está ativa: depende do estado de Rage, que é recurso e ação (como Rage).",
}
FEATURE_REASONS = {
    "structural": "Implementado por escolha, concessão ou conjuração no mesmo nível da fonte.",
    "phase_4": "Ação, reação, recurso ou efeito no momento da rolagem/dano: resolução assistida (Fase 4).",
    "phase_5": "Depende do estado de combate (iniciativa, turnos, fúria ativa, concentração, condições).",
    "gm": "Efeito de exploração, percepção ou narrativa: o mestre decide (sem número na ficha).",
}

# --- Itens mágicos -------------------------------------------------------------------------------------------
ITEM = {
    "automate": {},
    "gm": [
        "amulet_of_proof_against_detection_and_location", "bag_of_holding", "handy_haversack", "efficient_quiver", "portable_hole",
        "well_of_many_worlds", "pipes_of_the_sewers", "ring_of_mind_shielding", "manual_of_bodily_health", "manual_of_gainful_exercise",
        "manual_of_quickness_of_action", "tome_of_clear_thought", "tome_of_leadership_and_influence", "tome_of_understanding",
        "manual_of_golems", "helm_of_brilliance", "helm_of_telepathy", "ring_of_free_action", "ring_of_feather_falling",
        "cloak_of_displacement", "lantern_of_revealing", "sending_stones", "sovereign_glue", "universal_solvent", "decanter_of_endless_water",
        "immovable_rod", "folding_boat", "instant_fortress", "apparatus_of_the_crab", "sphere_of_annihilation", "talisman_of_pure_good",
        "talisman_of_ultimate_evil", "mirror_of_life_trapping", "mysterious_deck", "deck_of_illusions", "robe_of_useful_items",
        "bag_of_beans", "bag_of_devouring", "marvelous_pigments", "cubic_gate", "dragon_orb", "ring_of_three_wishes",
    ],
}
ITEM_REASONS = {
    "phase_4": "Ativado (ação, carga, consumo, conjuração) ou condicional ao alvo/ataque: resolução assistida (Fase 4).",
    "gm": "Utilidade, armazenamento, narrativa ou efeito permanente (Manuals/Tomes viram ajuste do mestre).",
}

# --- Monstros ------------------------------------------------------------------------------------------------
MONSTER_TRAIT = {
    "automate": {},
    "gm": ["amphibious", "limited_amphibiousness", "illumination", "water_breathing", "hold_breath", "spider_climb", "web_walker",
           "ice_walk", "earth_glide", "tunneler", "siege_monster", "beast_of_burden", "mimicry", "ethereal_sight", "treasure_sense",
           "sense_magic", "iron_scent", "divine_awareness", "speak_with_beasts_and_plants", "shark_telepathy", "telepathic_bond",
           "probing_telepathy", "inscrutable", "transparent", "training", "running_water", "forbiddance", "spirit_jar", "soul_bag",
           "celestial_restoration", "demonic_restoration", "diabolical_restoration", "eldritch_restoration", "elemental_restoration",
           "exalted_restoration", "fiendish_restoration", "hellish_restoration", "undead_restoration", "troll_spawn", "wishes"],
}
MONSTER_REASONS = {
    "phase_4": "Traço ou ação de criatura: resolução assistida no combate (Fase 4).",
    "gm": "Exploração ou narrativa: o mestre decide.",
}


def snake(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower().replace("'", "")).strip("_")


def load(name):
    return json.load(open(DATA / name, encoding="utf-8"))


entries = {}


def put(key, category, reason, mechanics=None):
    e = {"category": category, "reason": reason}
    if mechanics:
        e["mechanics"] = [mechanics] if isinstance(mechanics, str) else list(mechanics)
    entries[key] = e


# Características sem efeito.
features = []


def walk(o, src):
    if isinstance(o, dict):
        if o.get("kind") == "feature" and "feature" in o and not o["feature"].get("effects"):
            features.append(f"{src}/{o['feature']['id']}")
        for v in o.values():
            walk(v, src)
    elif isinstance(o, list):
        for x in o:
            walk(x, src)


for f, k in [("species", "species"), ("backgrounds", "background"), ("feats", "feat"), ("classes", "class"), ("subclasses", "subclass")]:
    for e in load(f + ".json"):
        walk(e, f"{k}:{e['id']}")
for fid in dict.fromkeys(features):
    key = f"feature:{fid}"
    if fid in FEATURE["automate"]:
        put(key, "automate", "Passivo: vale sempre que a característica está ativa.", FEATURE["automate"][fid])
    else:
        cat = next((c for c in ("structural", "phase_5", "gm") if fid in FEATURE[c]), "phase_4")
        put(key, cat, FEATURE_REASON_OVERRIDE.get(fid, FEATURE_REASONS[cat]))

# Itens mágicos sem efeito.
for it in load("magic-items.json"):
    if it.get("effects") or any(v["effects"] for v in it.get("variants", [])):
        continue
    key = f"item:{it['id']}"
    if it["id"] in ITEM["automate"]:
        put(key, "automate", "Passivo enquanto vestido, empunhado ou sintonizado.", ITEM["automate"][it["id"]])
    elif it["id"] in ITEM["gm"]:
        put(key, "gm", ITEM_REASONS["gm"])
    else:
        put(key, "phase_4", ITEM_REASONS["phase_4"])
# Entradas parciais (`<chave>#<aspecto>`): a fonte já tem efeitos, mas parte da mecânica segue pendente.
# Valor: (categoria, motivo, mecânica só para `automate`).
PARTIAL = {
    "item:sun_blade#undead_damage": ("phase_4", "+1d8 Radiant ao acertar um Undead: dano que depende do alvo (resolução do ataque).", None),
    "item:boots_of_striding_and_springing#jump": ("gm", "Salto de 30 ft gastando 10 ft de movimento, uma vez por turno: o movimento não é controlado pelo Host.",
                                                  None),
    "feature:class:druid/archdruid#nature_magician": ("phase_4", "Nature Magician: converte usos de Wild Shape num espaço de magia (recurso). Longevity é narrativa.",
                                                      None),
    "feature:class:barbarian/persistent_rage#rage_duration": ("phase_4", "Rage dura 10 minutos sem precisar ser estendida: depende do estado de Rage (recurso e ação).",
                                                              None),
    "monster_trait:greater_magic_resistance#spell_attacks_miss": ("phase_4", "Ataques de magia erram a criatura automaticamente (resolução do ataque).",
                                                                  None),
}
for key, (category, reason, mechanic) in PARTIAL.items():
    put(key, category, reason, mechanic)

# Traços e ações de monstro (por nome, sem o limite entre parênteses).
monsters = load("monsters.json")
for name in sorted({snake(t["name"].split(" (")[0]) for m in monsters for t in m.get("traits", []) if not t.get("effects")}):
    key = f"monster_trait:{name}"
    if name in MONSTER_TRAIT["automate"]:
        put(key, "automate", "Passivo da criatura.", MONSTER_TRAIT["automate"][name])
    elif name in MONSTER_TRAIT["gm"]:
        put(key, "gm", MONSTER_REASONS["gm"])
    else:
        put(key, "phase_4", MONSTER_REASONS["phase_4"])
for name in sorted({snake(a["name"].split(" (")[0]) for m in monsters for a in m["actions"] if a["kind"] == "text"}):
    put(f"monster_action:{name}", "phase_4", MONSTER_REASONS["phase_4"])

# Conferência: toda exceção listada aqui precisa existir no compêndio (curadoria não fica órfã).
magic_ids = {i["id"] for i in load("magic-items.json")}
problems = []
listed = ([f"feature:{k}" for c in ("structural", "phase_5", "gm") for k in FEATURE[c]] + [f"feature:{k}" for k in FEATURE["automate"]]
          + [f"item:{k}" for k in ITEM["automate"]] + [f"item:{k}" for k in ITEM["gm"]]
          + [f"monster_trait:{k}" for k in MONSTER_TRAIT["automate"]] + [f"monster_trait:{k}" for k in MONSTER_TRAIT["gm"]])
feature_keys = set(dict.fromkeys(features))
all_features = []


def walk_all(o, src):
    if isinstance(o, dict):
        if o.get("kind") == "feature" and "feature" in o:
            all_features.append(f"feature:{src}/{o['feature']['id']}")
        for v in o.values():
            walk_all(v, src)
    elif isinstance(o, list):
        for x in o:
            walk_all(x, src)


for f, k in [("species", "species"), ("backgrounds", "background"), ("feats", "feat"), ("classes", "class"), ("subclasses", "subclass")]:
    for e in load(f + ".json"):
        walk_all(e, f"{k}:{e['id']}")
trait_names = {snake(t["name"].split(" (")[0]) for m in monsters for t in m.get("traits", []) if t.get("effects")}
for k in PARTIAL:
    base = k.split("#")[0]
    kind, _, ref = base.partition(":")
    ok = {"item": ref in magic_ids, "feature": base in all_features and ref not in feature_keys,
          "monster_trait": ref in trait_names}.get(kind, False)
    if not ok:
        problems.append(f"entrada parcial sem fonte com efeitos: {k}")
for k in listed:
    if k not in entries:
        problems.append(f"exceção sem entrada no compêndio (ou já tem efeito): {k}")
for k, e in entries.items():
    for m in e.get("mechanics", []):
        if m not in MECHANICS:
            problems.append(f"{k}: mecânica desconhecida: {m}")
used = {m for e in entries.values() for m in e.get("mechanics", [])}
for m in MECHANICS:
    if m not in used:
        problems.append(f"mecânica sem nenhuma entrada: {m}")

doc = {"mechanics": MECHANICS, "entries": dict(sorted(entries.items()))}
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(doc, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
counts = {}
for e in entries.values():
    counts[e["category"]] = counts.get(e["category"], 0) + 1
per_mech = {}
for e in entries.values():
    for m in e.get("mechanics", []):
        per_mech[m] = per_mech.get(m, 0) + 1
print("entradas:", len(entries), counts)
print("automate por mecânica:", per_mech)
print("problemas:", len(problems))
for p in problems:
    print(" -", p)
sys.exit(1 if problems else 0)
