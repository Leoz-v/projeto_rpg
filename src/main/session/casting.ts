import { applyDamage, creatureD20, monsterSpells, type SheetD20, availableSpellSlots, availableUses, type DamageType, damageNotes, resolveAttack, resolveSpellParts, rollActionDamage, spellAttackD20, spellDamageWith } from 'rules-engine';
import { type ChatEntry, type IntentData, type PatchOp, type Role, type SpellEffectPart, type SpellLink, type Token, toPointer } from '../../shared/protocol';
import { attackCircumstances, autoCriticalNotes, rollSaves, rollTargetDamage, targetDamageOf, targetOf, withCircumstances } from './attacks';
import { notAllowed, type SessionContext, violation } from './context';
import { applyBuff, applyConditionPart, applyHealing, ConditionLedger, conditionTiming, imposeConditions, putSpellEffects } from './spell-effects';
import { concentrateToken } from './monster-concentration';
import { spendMonsterUse } from './monsters';
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

/** Conjura uma magia do bloco de um monstro (nota 0067): gasta o uso por dia e publica a magia, com a CD e o bônus do bloco. */
export function castMonsterSpell(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'monster.cast'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
  const block = ctx.creatureOf(token);
  const known = block && monsterSpells(block.creature).find((s) => s.spellId === data.spellId);
  const spell = ctx.deps.spell(data.spellId);
  if (!known || !spell) throw violation(`${token.name} não conjura essa magia`);
  const useOps = known.use ? spendMonsterUse(ctx, token, known.use.id) : [];
  const level = known.level ?? spell.level;
  const concentration = spell.concentration && !known.noConcentration;
  const concentrationOps = concentration ? concentrateToken(ctx, playerId, token, spell) : [];
  const parts = resolveSpellParts(spell, { slotLevel: level, characterLevel: 1, modifier: known.modifier });
  return [
    ctx.appendChat({
      kind: 'spell_cast',
      ...ctx.entryBase(playerId),
      tokenId: token.id,
      characterName: token.name,
      spellName: spell.name.slice(0, 100),
      level: spell.level,
      using: 'free',
      castingTime: spell.castingTime.slice(0, 100),
      range: spell.range.slice(0, 100),
      duration: spell.duration.slice(0, 100),
      concentration,
      description: spell.description.slice(0, 6000),
      // Os usos que restam são só do mestre: ficam no bloco.
      notes: [
        ...(level > spell.level ? [`Conjurada em círculo maior (${level}º)`] : []),
        ...(known.note !== undefined ? [known.note.slice(0, 200)] : []),
      ],
      ...(parts.length > 0
        ? {
            effect: {
              spellId: spell.id,
              ability: known.ability,
              saveDc: known.saveDc,
              attackBonus: known.attackBonus,
              parts: parts.map((p) => (p.label ? { ...p, label: p.label.slice(0, 100) } : p)),
            },
          }
        : {}),
    }),
    ...useOps,
    ...concentrationOps,
  ];
}

/** Quem usa uma parte de magia: um personagem, ou um monstro pelo token (nota 0067). */
interface SpellUser {
  name: string;
  link: SpellLink;
  /** A magia em que está concentrado. */
  concentration: string | null;
  /** Token de quem conjurou no mapa do alvo, se houver. */
  tokenOn(mapId: string): Token | undefined;
  attackD20(attackBonus: number, declared: { advantage?: boolean | undefined; disadvantage?: boolean | undefined }): SheetD20;
}

function spellUser(ctx: SessionContext, playerId: string, role: Role, entry: CastEntry, effect: NonNullable<CastEntry['effect']>): SpellUser {
  const { tokenId } = entry;
  if (tokenId !== undefined) {
    const token = ctx.token(tokenId);
    if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
    return {
      name: token.name,
      link: { tokenId, spellId: effect.spellId },
      concentration: token.concentration?.spellId ?? null,
      tokenOn: (mapId) => (token.mapId === mapId ? token : undefined),
      attackD20: (attackBonus, declared) =>
        creatureD20({ label: 'Bônus de ataque de magia', modifier: attackBonus }, ctx.conditionsOf(token), { kind: 'attack', attackKind: 'spell' }, declared, token.spellEffects),
    };
  }
  const { character, sheet } = ctx.sheetOf(playerId, role, entry.characterId ?? '');
  return {
    name: character.name,
    link: { characterId: character.id, spellId: effect.spellId },
    concentration: character.concentration?.spellId ?? null,
    tokenOn: (mapId) => Object.values(ctx.current.tokens).find((t) => t.characterId === character.id && t.mapId === mapId),
    attackD20: (attackBonus, declared) =>
      spellAttackD20(sheet, { ability: effect.ability, saveDc: effect.saveDc, attack: { total: attackBonus, parts: [{ label: 'Bônus de ataque de magia', value: attackBonus }] } }, declared),
  };
}

type CastEntry = Extract<ChatEntry, { kind: 'spell_cast' }>;
type SpellOf = { entryId: string; part: number };
type SpellDamage = { dice: string; type: DamageType }[];

/** Nome de uma parte no log: a magia, e a parte quando ela tem nome ("Ice Knife: Explosão"). */
const partLabel = (entry: CastEntry, part: SpellEffectPart): string => (part.label ? `${entry.spellName}: ${part.label}` : entry.spellName).slice(0, 100);

/** Nome do efeito na ficha ou no token: "Hex: Força (Morg)". */
const effectName = (label: string, option: string | undefined, caster: string): string => `${label}${option !== undefined ? `: ${option}` : ''} (${caster})`;

/** A arma escolhida precisa estar empunhada por um único personagem alvo e servir para a magia. */
function requireWeapon(ctx: SessionContext, rule: NonNullable<Extract<SpellEffectPart, { kind: 'buff' }>['weapon']>, targets: Token[], weaponId: string | undefined): void {
  const [target] = targets;
  const holder = target && target.characterId !== null ? ctx.current.characters[target.characterId] : undefined;
  if (!holder || targets.length !== 1) throw violation('Escolha um personagem com a arma');
  const attack = ctx.deps.characterSheet(holder)?.attacks.find((a) => a.instanceId === weaponId);
  const entry = holder.inventory.items.find((i) => i.instanceId === weaponId);
  if (!attack || !entry) throw violation('Escolha uma arma empunhada pelo alvo');
  if (rule.nonmagical && entry.itemId !== attack.itemId) throw violation('A arma já é mágica');
  if (rule.itemIds && !rule.itemIds.includes(attack.itemId)) throw violation('A magia não age nesta arma');
}

/**
 * Usa uma parte de uma magia conjurada (`spell.effect`): o Host rola os
 * ataques, as salvaguardas ou o dano direto com a CD e o bônus gravados no
 * `spell_cast`, e o dano de cada alvo vira proposta para o mestre. A cura e
 * as condições (da falha, do acerto ou sem salvaguarda) entram direto (nota 0058).
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
  const user = spellUser(ctx, playerId, role, entry, effect);
  if (entry.duration === 'Instantaneous' && ctx.current.chat.some((e) => 'spellOf' in e && e.spellOf?.entryId === entry.id && e.spellOf.part === data.part)) {
    throw violation('Esta parte da magia já foi usada');
  }
  if (entry.concentration && user.concentration !== effect.spellId) throw violation(`${user.name} não está mais concentrado em ${entry.spellName}`);
  if (part.kind !== 'attack' && part.kind !== 'save' && (data.advantage !== undefined || data.disadvantage !== undefined)) {
    throw violation('Vantagem e Desvantagem só valem nos ataques e nas salvaguardas');
  }
  if (data.condition !== undefined && !(part.kind === 'save' && part.conditionChoice)) throw violation('Esta parte não deixa a condição à escolha');
  const options = part.kind === 'buff' || part.kind === 'save' ? part.options : [];
  if (data.option !== undefined && options.length === 0) throw violation('Esta parte não tem opções');
  const option = data.option !== undefined ? options[data.option] : undefined;
  if (options.length > 0 && !option) throw violation('Escolha uma das opções da magia');
  if (data.weaponId !== undefined && !(part.kind === 'buff' && part.weapon)) throw violation('Esta parte não age numa arma');
  const targets = data.targetTokenIds.map((id) => ctx.token(id));
  const spellOf: SpellOf = { entryId: entry.id, part: data.part };
  const label = partLabel(entry, part);
  const { link } = user;
  const declared = { advantage: data.advantage, disadvantage: data.disadvantage };

  // Salvaguarda, cura, condição e bônus: alvos distintos, até `count` (sem ele, sem limite).
  if (part.kind === 'save' || part.kind === 'heal' || part.kind === 'condition' || part.kind === 'buff') {
    if (new Set(data.targetTokenIds).size !== targets.length) throw violation('Alvo repetido');
    if (part.count !== undefined && targets.length > part.count) throw violation(`${label}: até ${part.count} alvo(s) neste círculo`);
  }
  if (part.kind === 'heal') {
    return applyHealing(ctx, playerId, { casterName: user.name, label, spellOf, healing: part.healing, temporary: part.temporary === true, endConditions: part.endConditions, targets });
  }
  if (part.kind === 'condition') {
    return applyConditionPart(ctx, playerId, { casterName: user.name, label, spellOf, conditions: part.conditions, timing: conditionTiming(ctx, part.conditionsEnd, link), targets });
  }
  if (part.kind === 'buff') {
    let effects = [...part.effects, ...(option?.effects ?? [])];
    const name = effectName(label, option?.label, user.name);
    if (part.weapon) {
      requireWeapon(ctx, part.weapon, targets, data.weaponId);
      if (part.weapon.spellcastingAbility) effects = [...effects, { type: 'attack_ability', ability: effect.ability, scope: 'weapon' }];
    }
    const timing = conditionTiming(ctx, part.effectsEnd, link);
    return applyBuff(ctx, playerId, { casterName: user.name, label, spellOf, name, effects, endConditions: part.endConditions, link, targets, weapon: data.weaponId, timing });
  }
  const damage = spellDamageWith(part.damage, data.damageType);
  if (!damage) throw violation('Escolha o tipo de dano entre os da magia');

  if (part.kind === 'save') {
    let conditions = part.onFailConditions;
    if (part.conditionChoice) {
      if (data.condition === undefined || !conditions.includes(data.condition)) throw violation('Escolha a condição entre as da magia');
      conditions = [data.condition];
    }
    const [condition] = conditions;
    const saves = rollSaves(ctx, playerId, {
      actorName: user.name,
      effect: { name: label, ability: part.ability, dc: effect.saveDc, damage, onSuccess: part.onSuccess, conditions },
      // Salvaguarda contra magia: valem as Vantagens contra magias e contra a condição da falha.
      against: { source: 'spell', ...(condition ? { condition } : {}) },
      targets,
      visibility: 'public',
      spellOf,
      declared,
    });
    if (saves.failed.length === 0) return saves.ops;
    // Na falha, os efeitos entram na ficha ou no token (Bane, Slow; nota 0062).
    const failEffects = [...part.onFailEffects, ...(option?.effects ?? [])];
    if (failEffects.length > 0) {
      const put = putSpellEffects(ctx, { name: effectName(label, option?.label, user.name), effects: failEffects, link, targets: saves.failed, playerId });
      const results = saves.failed.map((t) => ({ targetTokenId: t.id, targetName: t.name, notes: put.notes.get(t.id) ?? [] }));
      saves.ops.push(ctx.appendChat({ kind: 'spell_applied', ...ctx.entryBase(playerId), spellOf, casterName: user.name, label, results }), ...put.ops);
    }
    if (conditions.length === 0) return saves.ops;
    // Na falha, as condições entram direto (nota 0058).
    const timing = conditionTiming(ctx, part.conditionsEnd, link);
    const ledger = new ConditionLedger(ctx);
    return [...saves.ops, ...saves.failed.flatMap((target) => imposeConditions(ctx, playerId, ledger, target, conditions, timing, label).ops)];
  }
  if (targets.length > part.count) throw violation(`${label}: ${part.count} ${part.kind === 'attack' ? 'ataque(s)' : 'projétil(eis)'} neste círculo`);
  if (part.kind === 'damage') return directDamage(ctx, playerId, { user, label, spellOf, damage, targets });
  return spellAttacks(ctx, playerId, { user, entry: { ...entry, effect }, part, label, spellOf, damage, targets, declared, link });
}

/** Ataques de magia, um por alvo (pode repetir: dois raios no mesmo alvo), cada um com o próprio d20 e o próprio dano. */
function spellAttacks(
  ctx: SessionContext,
  playerId: string,
  options: {
    user: SpellUser;
    entry: CastEntry & { effect: NonNullable<CastEntry['effect']> };
    part: Extract<SpellEffectPart, { kind: 'attack' }>;
    label: string;
    spellOf: SpellOf;
    damage: SpellDamage;
    targets: Token[];
    declared: { advantage?: boolean | undefined; disadvantage?: boolean | undefined };
    link: SpellLink;
  },
): PatchOp[] {
  const { user, entry, part, label, spellOf, damage, targets, declared } = options;
  const ledger = new ConditionLedger(ctx);
  const timing = part.onHitConditions.length > 0 ? conditionTiming(ctx, part.conditionsEnd, options.link) : {};
  const imposed: PatchOp[] = [];
  const { effect } = entry;
  const spent = new Set<string>();
  const ops: PatchOp[] = [];
  const proposals: PatchOp[] = [];
  for (const target of targets) {
    const attackerToken = user.tokenOn(target.mapId);
    const defender = targetOf(ctx, target);
    const around = attackCircumstances(ctx, attackerToken, target, spent);
    for (const id of around.used) spent.add(id);
    // Hex e Hunter's Mark também valem nos ataques de magia (nota 0063).
    const extra = targetDamageOf(ctx, 'tokenId' in user.link ? { tokenId: user.link.tokenId } : { characterId: user.link.characterId }, attackerToken, target);
    around.reminders.push(...extra.reminders);
    const d20 = withCircumstances(user.attackD20(effect.attackBonus, declared), around);
    const result = resolveAttack(
      {
        d20: d20.input,
        targetAc: defender.ac,
        rollDamage: (critical, hit) => ({ groups: [...rollActionDamage(damage, critical, ctx.deps.rng), ...(hit ? rollTargetDamage(ctx, extra.damage, critical) : [])], bonus: 0 }),
        defenses: defender.defenses,
        autoCritical: around.autoCritical.length > 0,
        onMiss: part.onMiss,
      },
      ctx.deps.rng,
    );
    // No acerto, as condições entram direto (nota 0058).
    let conditionNotes: string[] = [];
    if (result.hit && part.onHitConditions.length > 0) {
      const done = imposeConditions(ctx, playerId, ledger, target, part.onHitConditions, timing, label);
      imposed.push(...done.ops);
      conditionNotes = done.notes.map((n) => `No acerto: ${n}`);
    }
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
        attackerName: user.name,
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
  return [...ops, ...proposals, ...combatOps, ...imposed];
}

/** Dano direto (Magic Missile): cada projétil rolado à parte contra o alvo dele, com as defesas, como proposta. */
function directDamage(
  ctx: SessionContext,
  playerId: string,
  options: { user: SpellUser; label: string; spellOf: SpellOf; damage: SpellDamage; targets: Token[] },
): PatchOp[] {
  const { user, label, spellOf, damage, targets } = options;
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
  return [ctx.appendChat({ kind: 'spell_damage', ...base, spellOf, casterName: user.name, label, visibility: 'public', results }), ...proposals];
}
