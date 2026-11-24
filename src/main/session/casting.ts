import { applyDamage, availableSpellSlots, availableUses, CONDITION_NAME, type DamageType, type DerivedSheet, damageNotes, resolveAttack, resolveSpellParts, rollActionDamage, spellAttackD20, spellDamageWith } from 'rules-engine';
import { type ChatEntry, type IntentData, type PatchOp, type Role, type SessionCharacter, type SpellEffectPart, type Token, toPointer } from '../../shared/protocol';
import { attackCircumstances, autoCriticalNotes, rollSaves, targetOf, withCircumstances } from './attacks';
import { type SessionContext, violation } from './context';
import { changeResource } from './resources';
import { changeSpellSlot } from './spell-slots';
import { concentrate } from './vitality';

/** Conjurar (nota 0053) e usar as partes da magia estruturada (nota 0055). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/** Tira os registros do chat: o gasto do espaço ou do uso vai na entrada `spell_cast`. */
const withoutChat = (ops: PatchOp[]): PatchOp[] => ops.filter((op) => !op.path.startsWith('/chat/'));

/**
 * Conjura uma magia da ficha: gasta o espaço (ou o uso da magia concedida),
 * vira a Concentração do personagem se a magia exigir, tira do descanso
 * (menos truque) e publica a magia no chat. O efeito fica com a mesa.
 */
export function castSpell(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'spell.cast'>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const { spellcasting } = sheet;
  if (!spellcasting.canCast) throw violation(`${character.name} não pode conjurar vestindo armadura sem treinamento`);
  const castable = spellcasting.castable.find((c) => c.spellId === data.spellId);
  const spell = ctx.deps.spell(data.spellId);
  if (!castable || !spell) throw violation(`${character.name} não conhece essa magia`);

  // Quem conjura: o atributo pedido, ou o de maior CD (uma magia pode vir de duas classes).
  const caster = data.ability !== undefined ? castable.casters.find((c) => c.ability === data.ability) : castable.casters[0];
  if (!caster) throw violation(`${character.name} não conjura ${spell.name} com esse atributo`);

  const notes: string[] = [];
  let ops: PatchOp[] = [];
  /** Círculo em que a magia foi conjurada (o do espaço; sem espaço, o da magia). */
  let castLevel = castable.level;
  const { using } = data;
  if (using === 'ritual') {
    if (!castable.ritual || castable.level === 0) throw violation(`${spell.name} não é um ritual`);
    notes.push('Ritual: sem espaço, 10 minutos a mais');
  } else if (using === 'free') {
    const { free } = castable;
    if (free === undefined) throw violation(`${spell.name} precisa de um espaço de magia`);
    if (typeof free === 'object') {
      const resource = sheet.resources.find((r) => r.id === free.resourceId);
      if (!resource) throw violation(`${spell.name} não tem uso gratuito`);
      ops = withoutChat(changeResource(ctx, playerId, role, { kind: 'resource.spend', data: { characterId: character.id, resourceId: resource.id } }));
      notes.push(`Uso de ${resource.name}: ${availableUses(resource.max, character.resourcesSpent, resource.id) - 1}/${resource.max}`);
    }
  } else {
    if (!castable.slots) throw violation(`${spell.name} não usa espaço de magia`);
    const slotLevel = using.slot === 'pact' ? spellcasting.pactSlots?.level : using.slot.level;
    if (slotLevel === undefined || slotLevel < castable.level) throw violation(`${spell.name} é de ${castable.level}º círculo: o espaço precisa ser desse círculo ou maior`);
    ops = withoutChat(changeSpellSlot(ctx, playerId, role, { kind: 'spell_slot.spend', data: { characterId: character.id, slot: using.slot } }));
    const pools = availableSpellSlots(spellcasting, character.spellSlotsSpent);
    const pool = using.slot === 'pact' ? pools.pact : pools.levels.find((p) => p.level === slotLevel);
    const label = using.slot === 'pact' ? `Espaço de Pacto (${slotLevel}º)` : `Espaço de ${slotLevel}º círculo`;
    if (pool) notes.push(`${label}: ${pool.available - 1}/${pool.total}`);
    if (slotLevel > castable.level) notes.push(`Conjurada em círculo maior (${slotLevel}º)`);
    castLevel = slotLevel;
  }
  // Magia estruturada: as partes com os dados no círculo usado e no nível do personagem (truques).
  const parts = resolveSpellParts(spell, { slotLevel: castLevel, characterLevel: sheet.level, modifier: sheet.abilities[caster.ability].modifier });

  // Concentração: a magia nova substitui a anterior; a mesma magia de novo mantém.
  if (castable.concentration && character.concentration?.spellId !== spell.id) {
    ops.push(...concentrate(ctx, playerId, role, character.id, spell.id));
  }
  // Conjurar uma magia que não seja truque interrompe o descanso (SRD 5.2.1, "Short Rest").
  if (castable.level > 0) ops.push(...ctx.leaveRest(playerId, character, 'Conjurou uma magia: o descanso não vale'));

  return [
    ctx.appendChat({
      kind: 'spell_cast',
      ...ctx.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      spellName: spell.name.slice(0, 100),
      level: castable.level,
      using,
      castingTime: spell.castingTime.slice(0, 100),
      range: spell.range.slice(0, 100),
      duration: spell.duration.slice(0, 100),
      concentration: castable.concentration,
      description: spell.description.slice(0, 6000),
      notes,
      ...(parts.length > 0
        ? {
            effect: {
              spellId: spell.id,
              ability: caster.ability,
              saveDc: caster.saveDc,
              attackBonus: caster.attack.total,
              parts: parts.map((p) => (p.label ? { ...p, label: p.label.slice(0, 100) } : p)),
            },
          }
        : {}),
    }),
    ...ops,
  ];
}

type CastEntry = Extract<ChatEntry, { kind: 'spell_cast' }>;
type SpellOf = { entryId: string; part: number };
type SpellDamage = { dice: string; type: DamageType }[];

/** Nome de uma parte no log: a magia, e a parte quando ela tem nome ("Ice Knife: Explosão"). */
const partLabel = (entry: CastEntry, part: SpellEffectPart): string => (part.label ? `${entry.spellName}: ${part.label}` : entry.spellName).slice(0, 100);

/**
 * Usa uma parte de uma magia conjurada (`spell.effect`): o Host rola os
 * ataques, as salvaguardas ou o dano direto com a CD e o bônus gravados no
 * `spell_cast`, e o dano de cada alvo vira proposta para o mestre.
 *
 * Magia instantânea: cada parte uma vez. Magia com Concentração: só enquanto
 * quem conjurou estiver concentrado nela. As demais (Fire Shield, Glyph of
 * Warding) podem repetir; o mestre acompanha pelo chat.
 */
export function useSpellEffect(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'spell.effect'>): PatchOp[] {
  const entry = ctx.current.chat.find((e) => e.id === data.entryId);
  if (entry?.kind !== 'spell_cast' || !entry.effect) throw violation('Magia não encontrada no chat (ou sem efeito estruturado)');
  const { effect } = entry;
  const part = effect.parts[data.part];
  if (!part) throw violation('Parte da magia não encontrada');
  const { character, sheet } = ctx.sheetOf(playerId, role, entry.characterId);
  if (entry.duration === 'Instantaneous' && ctx.current.chat.some((e) => 'spellOf' in e && e.spellOf?.entryId === entry.id && e.spellOf.part === data.part)) {
    throw violation('Esta parte da magia já foi usada');
  }
  if (entry.concentration && character.concentration?.spellId !== effect.spellId) throw violation(`${character.name} não está mais concentrado em ${entry.spellName}`);
  if (part.kind !== 'attack' && (data.advantage !== undefined || data.disadvantage !== undefined)) throw violation('Vantagem e Desvantagem só valem nos ataques');
  const damage = spellDamageWith(part.damage, data.damageType);
  if (!damage) throw violation('Escolha o tipo de dano entre os da magia');
  const targets = data.targetTokenIds.map((id) => ctx.token(id));
  const spellOf: SpellOf = { entryId: entry.id, part: data.part };
  const label = partLabel(entry, part);

  if (part.kind === 'save') {
    if (new Set(data.targetTokenIds).size !== targets.length) throw violation('Alvo repetido na salvaguarda');
    const [condition] = part.onFailConditions;
    return rollSaves(ctx, playerId, {
      actorName: character.name,
      effect: { name: label, ability: part.ability, dc: effect.saveDc, damage, onSuccess: part.onSuccess, conditions: part.onFailConditions },
      // Salvaguarda contra magia: valem as Vantagens contra magias e contra a condição da falha.
      against: { source: 'spell', ...(condition ? { condition } : {}) },
      targets,
      visibility: 'public',
      spellOf,
    });
  }
  if (targets.length > part.count) throw violation(`${label}: ${part.count} ${part.kind === 'attack' ? 'ataque(s)' : 'projétil(eis)'} neste círculo`);
  if (part.kind === 'damage') return directDamage(ctx, playerId, { character, label, spellOf, damage, targets });
  return spellAttacks(ctx, playerId, { character, sheet, entry: { ...entry, effect }, part, label, spellOf, damage, targets, declared: { advantage: data.advantage, disadvantage: data.disadvantage } });
}

/** Ataques de magia, um por alvo (pode repetir: dois raios no mesmo alvo), cada um com o próprio d20 e o próprio dano. */
function spellAttacks(
  ctx: SessionContext,
  playerId: string,
  options: {
    character: SessionCharacter;
    sheet: DerivedSheet;
    entry: CastEntry & { effect: NonNullable<CastEntry['effect']> };
    part: Extract<SpellEffectPart, { kind: 'attack' }>;
    label: string;
    spellOf: SpellOf;
    damage: SpellDamage;
    targets: Token[];
    declared: { advantage?: boolean | undefined; disadvantage?: boolean | undefined };
  },
): PatchOp[] {
  const { character, sheet, entry, part, label, spellOf, damage, targets, declared } = options;
  const { effect } = entry;
  const caster = { ability: effect.ability, saveDc: effect.saveDc, attack: { total: effect.attackBonus, parts: [{ label: 'Bônus de ataque de magia', value: effect.attackBonus }] } };
  const spent = new Set<string>();
  const ops: PatchOp[] = [];
  const proposals: PatchOp[] = [];
  for (const target of targets) {
    const attackerToken = Object.values(ctx.current.tokens).find((t) => t.characterId === character.id && t.mapId === target.mapId);
    const defender = targetOf(ctx, target);
    const around = attackCircumstances(ctx, attackerToken, target, spent);
    for (const id of around.used) spent.add(id);
    const d20 = withCircumstances(spellAttackD20(sheet, caster, declared), around);
    const result = resolveAttack(
      {
        d20: d20.input,
        targetAc: defender.ac,
        rollDamage: (critical) => ({ groups: rollActionDamage(damage, critical, ctx.deps.rng), bonus: 0 }),
        defenses: defender.defenses,
        autoCritical: around.autoCritical.length > 0,
        onMiss: part.onMiss,
      },
      ctx.deps.rng,
    );
    const immune = new Set(defender.defenses.conditionImmunities.map((c) => c.condition));
    const conditionNotes = result.hit ? part.onHitConditions.map((c) => (immune.has(c) ? `Imune a ${CONDITION_NAME[c]}` : `No acerto: ${CONDITION_NAME[c]}`)) : [];
    const entryId = ctx.deps.newId();
    let damageField: Extract<ChatEntry, { kind: 'attack_roll' }>['damage'];
    if (result.damage && result.damage.groups.length > 0) {
      const proposalId = ctx.deps.newId();
      damageField = { groups: result.damage.groups, bonus: 0, total: result.damage.applied.total, defenses: damageNotes(result.damage.applied), proposalId };
      proposals.push({ op: 'add', path: toPointer('proposals', proposalId), value: { id: proposalId, entryId, targetTokenId: target.id, targetName: target.name, amount: result.damage.applied.total } });
    }
    ops.push(
      ctx.appendChat({
        kind: 'attack_roll',
        id: entryId,
        at: ctx.deps.now(),
        authorId: playerId,
        attackerName: character.name,
        label,
        targetTokenId: target.id,
        targetName: target.name,
        visibility: 'public',
        mode: d20.input.mode,
        dice: result.roll.dice,
        natural: result.roll.natural,
        modifier: d20.input.modifier,
        total: result.roll.total,
        critical: result.critical,
        fumble: result.roll.fumble,
        advantage: d20.advantage,
        disadvantage: d20.disadvantage,
        notes: [...autoCriticalNotes(result, around.autoCritical), ...(!result.hit && result.damage ? ['Errou: metade do dano'] : []), ...conditionNotes].slice(0, 50),
        reminders: [...d20.reminders, ...defender.reminders].slice(0, 50),
        hit: result.hit,
        ...(damageField ? { damage: damageField } : {}),
        spellOf,
      }),
    );
  }
  const combat = ctx.current.combat;
  const combatOps: PatchOp[] = combat && spent.size > 0 ? [ctx.replaceCombat({ ...combat, effects: combat.effects.filter((e) => !spent.has(e.id)) })] : [];
  return [...ops, ...proposals, ...combatOps];
}

/** Dano direto (Magic Missile): cada projétil rolado à parte contra o alvo dele, com as defesas, como proposta. */
function directDamage(
  ctx: SessionContext,
  playerId: string,
  options: { character: SessionCharacter; label: string; spellOf: SpellOf; damage: SpellDamage; targets: Token[] },
): PatchOp[] {
  const { character, label, spellOf, damage, targets } = options;
  const base = ctx.entryBase(playerId);
  const proposals: PatchOp[] = [];
  const results = targets.map((target) => {
    const defender = targetOf(ctx, target);
    const groups = rollActionDamage(damage, false, ctx.deps.rng);
    const applied = applyDamage(defender.defenses, groups.map((g) => ({ amount: g.total, type: g.type })), ctx.deps.rng);
    const proposalId = applied.total > 0 ? ctx.deps.newId() : undefined;
    if (proposalId) {
      proposals.push({ op: 'add', path: toPointer('proposals', proposalId), value: { id: proposalId, entryId: base.id, targetTokenId: target.id, targetName: target.name, amount: applied.total } });
    }
    return {
      targetTokenId: target.id,
      targetName: target.name,
      groups,
      total: applied.total,
      defenses: [...damageNotes(applied), ...defender.reminders].slice(0, 50),
      ...(proposalId ? { proposalId } : {}),
    };
  });
  return [ctx.appendChat({ kind: 'spell_damage', ...base, spellOf, casterName: character.name, label, visibility: 'public', results }), ...proposals];
}
