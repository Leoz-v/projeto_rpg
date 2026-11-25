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
- phase_7:    magias (nota 0054): cura e condições (PR 3) ou bônus e penalidades temporários (PR 4);
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
        "species:elf/keen_senses_trait", "species:gnome/gnomish_lineage_trait",
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
    # Lembretes de turno (nota 0043) e Concentração (nota 0045) já saíram: a fila da Fase 5 está vazia.
    "phase_5": [],
    "gm": [
        "species:elf/trance", "species:halfling/halfling_nimbleness", "species:halfling/naturally_stealthy", "species:gnome/clockwork_device",
        "class:monk/acrobatic_movement", "feat:grappler/fast_wrestler", "class:warlock/devils_sight", "class:warlock/gaze_of_two_minds",
        "subclass:hunter/hunters_lore", "class:druid/beast_spells", "feat:boon_of_the_night_spirit/shadowy_form",
        "class:warlock/investment_of_the_chain_master",
    ],
}
# Motivos específicos, no lugar do motivo da categoria.
FEATURE_REASON_OVERRIDE = {
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
        "bag_of_beans", "bag_of_devouring", "marvelous_pigments", "ring_of_three_wishes",
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


# --- Magias (Fase 7, nota 0054) -------------------------------------------------------------------------------
# As magias de dano, cura e condição têm resolução estruturada (`srd-source/tools/spell_resolution.py`, notas 0054
# e 0056). As demais ficam aqui:
SPELL = {
    # Vazio desde a nota 0063: magia nova com mecânica entra aqui, por grupo.
}
SPELL_REASONS = {
    "gm": "Utilidade, exploração, deslocamento ou narrativa: o texto basta e o mestre decide.",
}
# Magias com dano, cura ou condição no texto que ficam sem resolução estruturada, com o motivo.
SPELL_REASON_OVERRIDE = {
    "true_strike": "Um ataque de arma com o atributo de conjuração e dano extra Radiante: o jogador ataca com a arma e o mestre ajusta.",
    "death_ward": "Gatilho único ao cair a 0 PV ou diante de morte instantânea: o mestre aplica (fica 1 PV).",
    "sanctuary": "Salvaguarda de quem ataca o alvo protegido, decidida na hora da escolha do alvo: o mestre conduz.",
    "mass_heal": "700 PV divididos à escolha de quem conjura entre os alvos: o mestre aplica a cura de cada um no painel de PV.",
    "spare_the_dying": "Estabiliza uma criatura com 0 PV: o mestre marca Estável nas Salvaguardas contra a Morte.",
    "lesser_restoration": "Quem conjura escolhe a condição que termina: o mestre (ou o dono do token) a remove.",
    "greater_restoration": "Um entre vários efeitos (Exaustão, condição, maldição, redução de atributo ou de PV máximos): o mestre aplica.",
    "eyebite": "Três efeitos à escolha e um alvo novo a cada turno: o mestre conduz.",
    "power_word_stun": "Sem salvaguarda: depende dos PV atuais do alvo (150 ou menos), que o mestre confere.",
    "sleep": "Duas salvaguardas em sequência (Incapacitado até o fim do turno do alvo, depois Inconsciente): o mestre conduz.",
    "sleet_storm": "Área com salvaguarda a cada turno, que derruba e quebra a Concentração: o mestre conduz.",
    "stinking_cloud": "Salvaguarda no início de cada turno na nuvem, Envenenado só até o fim daquele turno: o mestre conduz.",
    "divine_word": "Efeito pelos PV atuais de cada alvo e banimento por tipo de criatura: o mestre aplica.",
    "telekinesis": "Move criaturas ou objetos a cada turno, com Impedido até o fim do próximo turno: o mestre conduz.",
    "antipathy_sympathy": "Salvaguarda quando uma criatura do tipo escolhido se aproxima, por dias: o mestre conduz.",
    "animate_objects": "Invocação com bloco de estatísticas próprio: as ações da criatura são das ações de monstro (extra futuro).",
    "find_steed": "Invocação com bloco de estatísticas próprio: as ações da criatura são das ações de monstro (extra futuro).",
    "giant_insect": "Invocação com bloco de estatísticas próprio: as ações da criatura são das ações de monstro (extra futuro).",
    "summon_dragon": "Invocação com bloco de estatísticas próprio: as ações da criatura são das ações de monstro (extra futuro).",
    "dream": "O dano vem ao acordar, fora de combate e depois de um descanso sem benefício: o mestre aplica.",
    "contact_other_plane": "Salvaguarda de quem conjura contra CD 15 fixa, com resultado narrativo: o mestre conduz.",
    "prismatic_wall": "Muralha de sete camadas atravessadas uma a uma: o mestre conduz (as cores repetem as do Prismatic Spray).",
    "wish": "Efeitos à escolha e consequência do esforço decididos pelo mestre.",
}
# Partes pendentes de magias que já têm resolução estruturada.
SPELL_PARTIAL = {
    "spell:enlarge_reduce#size_and_damage": ("gm", "O tamanho do token e o -1d4 no dano do Reduzir: o mestre ajusta. O +1d4 só entra na ficha de personagens."),
    "spell:bestow_curse#spell_damage_and_slots": ("gm", "Dano extra nas magias sem ataque, e a duração sem Concentração com espaço de 5º círculo ou mais: o mestre acompanha."),
    "spell:hex#duration": ("gm", "A Concentração dura mais em círculos maiores: a mesa controla o tempo."),
    "spell:hunters_mark#perception": ("gm", "Vantagem em Percepção e Sobrevivência para achar o alvo: declarada na rolagem."),
    "spell:shield#triggering_attack": ("gm", "O +5 vale contra o ataque que disparou e anula Magic Missile: o mestre descarta a proposta de dano."),
    "spell:faerie_fire#invisible": ("gm", "O alvo não se beneficia de Invisível: o mestre tira a condição ou ajusta a rolagem."),
    "spell:holy_aura#blinded": ("gm", "Um Corruptor ou Morto-vivo que acerta o alvo corpo a corpo salva contra Cego: o mestre conduz."),
    "spell:protection_from_evil_and_good#conditions": ("gm", "Não pode ser possuído nem Enfeitiçado ou Amedrontado por esses tipos: o mestre confere a origem."),
    "spell:ray_of_enfeeblement#damage_and_attacks": ("gm", "Ataques com Força têm Desvantagem, -1d8 no dano, e Desvantagem no próximo ataque no sucesso: o mestre ajusta."),
    "spell:beacon_of_hope#max_healing": ("gm", "A cura recupera o máximo possível: o mestre ajusta o valor da cura."),
    "spell:heroes_feast#hp_max": ("gm", "PV máximos +2d10 (rolados uma vez, por 24 horas): o mestre rola e aplica como ajuste."),
    "spell:freedom_of_movement#restraints": ("gm", "Magias e efeitos mágicos não reduzem o Deslocamento nem impõem Paralisado ou Impedido: o mestre confere a origem."),
    "spell:aura_of_life#zero_hp": ("gm", "Aliado com 0 PV no início do turno na aura recupera 1 PV, e os PV máximos não diminuem: o mestre aplica."),
    "spell:haste#lethargy": ("gm", "No fim da magia, o alvo fica Incapacitado e com Deslocamento 0 até o fim do próximo turno: o mestre aplica."),
    "spell:vampiric_touch#healing": ("gm", "Quem conjura recupera metade do dano Necrotic causado: o mestre aplica a cura depois do dano."),
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
    if it.get("effects") or it.get("use") or it.get("casting") or any(v["effects"] or v.get("use") or v.get("scroll") for v in it.get("variants", [])):
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
    "feature:subclass:berserker/mindless_rage#immunity": ("phase_4", "Imunidade a Charmed e Frightened enquanto a Rage dura: as que já havia terminam ao entrar.", None),
    "feature:class:barbarian/reckless_attack#advantage": ("phase_4", "Vantagem nos ataques com Força: declarada por quem ataca.", None),
    "feature:class:cleric/channel_divinity#effects": ("phase_4", "Divine Spark contra um alvo e Turn Undead: salvaguardas.", None),
    "feature:class:ranger/tireless#exhaustion": ("phase_4", "A Exaustão cai 1 no descanso curto.", None),
    "item:sword_of_wounding#save": ("phase_4", "Salvaguarda de CON ou não recupera PV por 1 hora (resolução com salvaguarda).", None),
    "item:staff_of_withering#save": ("phase_4", "Salvaguarda de CON ou Desvantagem em FOR e CON por 1 hora (resolução com salvaguarda).", None),
    "item:mace_of_disruption#destroy": ("phase_4", "Salvaguarda de SAB ou é destruído, com 25 PV ou menos (resolução com salvaguarda).", None),
    "item:oathbow#sworn_enemy": ("phase_4", "Inimigo jurado: Vantagem e sem cobertura contra ele (alvo marcado).", None),
    "feature:class:barbarian/brutal_strike#effects": ("phase_4", "Forceful Blow e Hamstring Blow: empurrar e reduzir o deslocamento do alvo.", None),
    "feature:class:warlock/eldritch_smite#prone": ("phase_4", "Pode deixar o alvo Caído (Enorme ou menor).", None),
    "feature:class:warlock/lifedrinker#heal": ("phase_4", "Gasta um Dado de Vida para recuperar PV ao acertar.", None),
    "feature:class:rogue/sneak_attack#cunning_strike": ("phase_4", "Cunning Strike e Devious Strikes trocam dados do Sneak Attack por efeitos.", None),
    "item:dragon_orb#control": ("gm", "Controlar o orbe, o chamado dos dragões e o Suggestion dele: o mestre conduz.", None),
    "item:ring_of_elemental_command#focus": ("phase_4", "Elemental Bane, Compulsion e as propriedades do plano ligado: dependem do plano e do alvo.", None),
    "item:ring_of_shooting_stars#spheres": ("phase_4", "Lightning Spheres e Shooting Stars: salvaguardas com cargas variáveis.", None),
    "item:staff_of_charming#enchantment": ("phase_4", "Reflect Enchantment e Resist Enchantment: reações a uma salvaguarda.", None),
    "item:staff_of_swarming_insects#insect_cloud": ("gm", "A nuvem de insetos muda a visibilidade da área: o mestre conduz.", None),
    "item:potion_of_vitality#hit_dice": ("phase_4", "Dados de Vida recuperam o máximo por 24 horas: muda a rolagem do descanso.", None),
    "item:bead_of_force#sphere": ("gm", "A esfera que prende ou empurra depende de quem está na área: o mestre conduz.", None),
    "item:boots_of_striding_and_springing#jump": ("gm", "Salto de 30 ft gastando 10 ft de movimento, uma vez por turno: o movimento não é controlado pelo Host.",
                                                  None),
    "feature:class:druid/archdruid#nature_magician": ("phase_4", "Nature Magician: converte usos de Wild Shape num espaço de magia (recurso). Longevity é narrativa.",
                                                      None),
    "monster_trait:greater_magic_resistance#spell_attacks_miss": ("phase_4", "Ataques de magia erram a criatura automaticamente (resolução do ataque).",
                                                                  None),
}
# Recursos contados pelo efeito `resource` (nota 0052): o uso em si (ação, rolagem, escolha) segue pendente.
RESOURCE_USES = [
    "feature:class:bard/bardic_inspiration", "feature:class:bard/font_of_inspiration",
    "feature:class:cleric/divine_intervention", "feature:class:druid/wild_shape",
    "feature:class:fighter/action_surge", "feature:class:fighter/indomitable",
    "feature:class:monk/monks_focus", "feature:class:paladin/channel_divinity",
    "feature:class:rogue/stroke_of_luck", "feature:class:sorcerer/font_of_magic",
    "feature:class:sorcerer/sorcerous_restoration", "feature:class:warlock/magical_cunning", "feature:class:wizard/arcane_recovery",
    "feature:species:dragonborn/breath_weapon",
    "feature:species:goliath/giant_ancestry_trait",
    "feature:species:orc/relentless_endurance", "feature:subclass:circle_of_the_land/natural_recovery",
    "feature:subclass:fiend_patron/dark_ones_own_luck",
]
for key in RESOURCE_USES:
    PARTIAL[f"{key}#use"] = ("phase_4", "Usar o recurso (o efeito: ação, rolagem ou escolha) é da resolução de ações; os usos já são contados (efeito `resource`, nota 0052).", None)
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

# Magias sem resolução estruturada.
spells = load("spells.json")
spell_ids = {sp["id"] for sp in spells}
structured = {sp["id"] for sp in spells if sp.get("resolution")}
for sp in spells:
    if sp["id"] in structured:
        continue
    key = f"spell:{sp['id']}"
    group = next((g for g, ids in SPELL.items() if sp["id"] in ids), None)
    if sp["id"] in SPELL_REASON_OVERRIDE:
        put(key, "gm", SPELL_REASON_OVERRIDE[sp["id"]])
    elif group:
        put(key, "phase_7", SPELL_REASONS[group])
    else:
        put(key, "gm", SPELL_REASONS["gm"])
for key, (category, reason) in SPELL_PARTIAL.items():
    put(key, category, reason)

# Conferência: toda exceção listada aqui precisa existir no compêndio (curadoria não fica órfã).
magic_ids = {i["id"] for i in load("magic-items.json")}
problems = []
listed = ([f"feature:{k}" for c in ("structural", "phase_5", "gm") for k in FEATURE[c]] + [f"feature:{k}" for k in FEATURE["automate"]]
          + [f"item:{k}" for k in ITEM["automate"]] + [f"item:{k}" for k in ITEM["gm"]]
          + [f"monster_trait:{k}" for k in MONSTER_TRAIT["automate"]] + [f"monster_trait:{k}" for k in MONSTER_TRAIT["gm"]])
for sid in [i for ids in SPELL.values() for i in ids] + list(SPELL_REASON_OVERRIDE):
    if sid not in spell_ids or sid in structured:
        problems.append(f"magia classificada inexistente ou já estruturada: {sid}")
for key in SPELL_PARTIAL:
    if key.split("#")[0].split(":")[1] not in structured:
        problems.append(f"parte pendente de magia sem resolução: {key}")
dups = [i for g in SPELL.values() for i in g]
if len(dups) != len(set(dups)):
    problems.append("magia em mais de um grupo")
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
