import { type Ability, applyDamage, applyHitPointChange, attackedByEffects, attackedConditions, type AttacksAgainst, cleaveDamageBonus, creatureAttacksAgainst, creatureD20, type CreatureType, type Condition, CONDITION_NAME, creatureSaveBonus, d20Mode, d20StepNotes, damageNotes, type DamageType, type Defenses, grazeDamage, type ImposedConditions, MASTERY_NAME, masteryOutcome, nextTurnRound, resolveAttack, resolveSave, rollActionDamage, type RollAgainst, rollD20, rollWeaponDamage, sheetD20, type SheetD20, type TargetDamage, targetDamage, TIMED_MASTERY_UNTIL, timedMastery, timedMasteryNote, toppleDc } from 'rules-engine';
import { type ChatEntry, type TimedEffect, type IntentData, type PatchOp, type Role, type SessionState, type Token, toPointer, type Visibility } from '../../shared/protocol';
import { type SessionContext, violation, notAllowed } from './context';
import { timedEffectEntry } from './combat';
import { imposeFromAction } from './spell-effects';
import { spendMonsterUse } from './monsters';
import { changeCharacterHp } from './vitality';

/** Rolagens da ficha, ataques, maestrias, salvaguardas forçadas e aplicação de dano (Fase 4). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/** Teste d20 a partir da ficha: modificador, Vantagem/Desvantagem e regras do d20 vêm do motor; o dado, do RNG do Host. */
export function rollFromSheet(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'roll.d20'>): ChatEntry {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const roll = sheetD20(sheet, data.target, { advantage: data.advantage, disadvantage: data.disadvantage });
  if (!roll) throw violation('Este ataque não está na ficha (a arma precisa estar equipada)');
  const result = rollD20(roll.input, ctx.deps.rng);
  const { target } = data;
  const attack = target.kind === 'attack' ? sheet.attacks.find((a) => a.instanceId === target.instanceId) : undefined;
  return {
    kind: 'd20_roll',
    ...ctx.entryBase(playerId),
    characterId: character.id,
    characterName: character.name,
    target: data.target,
    ...(attack ? { label: attack.name.slice(0, 100) } : {}),
    visibility: data.visibility,
    mode: roll.input.mode,
    dice: result.dice,
    natural: result.natural,
    modifier: roll.input.modifier,
    total: result.total,
    // Crítico e falha crítica só existem na jogada de ataque (o 20 e o 1 da Salvaguarda contra a Morte valem no `death_save`, nota 0044).
    critical: target.kind === 'attack' && result.critical,
    fumble: target.kind === 'attack' && result.fumble,
    parts: roll.parts.map((p) => ({ label: p.label.slice(0, 200), value: p.value })),
    advantage: roll.advantage,
    disadvantage: roll.disadvantage,
    notes: d20StepNotes(result.steps),
    reminders: roll.reminders,
  };
}

/** Dano de uma arma equipada (crítico dobra os dados, Versatile com as duas mãos). */
export function rollDamage(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'roll.damage'>): ChatEntry {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const attack = sheet.attacks.find((a) => a.instanceId === data.instanceId);
  if (!attack) throw violation('Este ataque não está na ficha (a arma precisa estar equipada)');
  const result = rollWeaponDamage(attack, { critical: data.critical, versatile: data.versatile }, ctx.deps.rng);
  return {
    kind: 'damage_roll',
    ...ctx.entryBase(playerId),
    characterId: character.id,
    characterName: character.name,
    label: attack.name.slice(0, 100),
    visibility: data.visibility,
    critical: data.critical === true,
    groups: result.groups.map((g) => ({ dice: g.dice, type: g.type, ...(g.source ? { source: g.source } : {}), rolls: g.rolls, total: g.total })),
    bonus: result.bonus,
    total: result.total,
    ...(result.dieMinimum ? { dieMinimum: result.dieMinimum } : {}),
  };
}

export function proposalOf(ctx: SessionContext, proposalId: string): SessionState['proposals'][string] {
  const proposal = ctx.current.proposals[proposalId];
  if (!proposal) throw violation('Proposta de dano não encontrada (já aplicada ou descartada)');
  return proposal;
}

/** CA e defesas de um token alvo: as da ficha do personagem ligado, ou as do bloco do monstro. */
export function targetOf(ctx: SessionContext, token: Token): { ac: number; defenses: Defenses; reminders: string[] } {
  if (token.characterId !== null) {
    const character = ctx.current.characters[token.characterId];
    const sheet = character ? ctx.deps.characterSheet(character) : undefined;
    if (!sheet) throw violation('O personagem do alvo ainda não tem ficha');
    return { ac: sheet.ac.total, defenses: sheet.defenses, reminders: [] };
  }
  const block = ctx.creatureOf(token);
  if (!block) throw violation('O alvo não tem CA conhecida (não é personagem nem monstro do compêndio)');
  return { ac: block.ac, defenses: block.defenses, reminders: block.reminders };
}

/** O que pesa num ataque além da ficha do atacante: as condições do alvo e os efeitos de maestria do combate. */
export interface AttackCircumstances {
  advantage: string[];
  disadvantage: string[];
  reminders: string[];
  /** Condições do alvo que tornam o acerto crítico (Paralisado, Inconsciente a até 5 ft). */
  autoCritical: string[];
  /** Efeitos temporários gastos neste ataque (Sap, Vex). */
  used: Set<string>;
}

/** `attacks_against` que pesam no token: da ficha do personagem ligado ou dos efeitos de magia do monstro. */
function attacksAgainst(ctx: SessionContext, token: Token): AttacksAgainst[] {
  const character = token.characterId !== null ? ctx.current.characters[token.characterId] : undefined;
  if (character) return ctx.deps.characterSheet(character)?.attacksAgainst ?? [];
  return creatureAttacksAgainst(token.spellEffects);
}

/** Tipo de criatura do token: o do bloco, ou Humanoide (as espécies do SRD); `undefined` fora do mapa ou sem bloco. */
function creatureTypeOf(ctx: SessionContext, token: Token | undefined): CreatureType | undefined {
  if (!token) return undefined;
  if (token.characterId !== null) return 'humanoid';
  return token.monsterId !== null ? ctx.deps.creature(token.monsterId)?.type : undefined;
}

/**
 * Condições do alvo (Vantagem contra Impedido, Caído pela distância, crítico
 * automático contra Paralisado a até 5 ft) e efeitos temporários das
 * maestrias: Sap pesa no próximo ataque do alvo; Vex ajuda o próximo do
 * atacante contra ele. Os dois se gastam no ataque.
 */
export function attackCircumstances(ctx: SessionContext, attackerToken: Token | undefined, target: Token, spent: ReadonlySet<string> = new Set()): AttackCircumstances {
  const against = attackedConditions(ctx.conditionsOf(target).conditions, ctx.distanceBetween(attackerToken, target));
  const effects = attackedByEffects(attacksAgainst(ctx, target), creatureTypeOf(ctx, attackerToken));
  const result: AttackCircumstances = {
    advantage: [...against.advantage.map((s) => s.name), ...effects.advantage],
    disadvantage: [...against.disadvantage.map((s) => s.name), ...effects.disadvantage],
    reminders: [...against.reminders, ...effects.reminders],
    autoCritical: against.autoCritical.map((s) => s.name),
    used: new Set(),
  };
  const combat = ctx.current.combat;
  if (combat && attackerToken) {
    // `spent`: já gastos por um ataque anterior da mesma ação (os raios do Scorching Ray).
    for (const effect of combat.effects.filter((e) => !spent.has(e.id))) {
      const source = ctx.current.tokens[effect.sourceTokenId]?.name ?? 'Token removido';
      if (effect.kind === 'sap' && effect.targetTokenId === attackerToken.id) {
        result.disadvantage.push(`Sap (${source})`);
        result.used.add(effect.id);
      } else if (effect.kind === 'vex' && effect.sourceTokenId === attackerToken.id && effect.targetTokenId === target.id) {
        result.advantage.push('Vex');
        result.used.add(effect.id);
      }
    }
  }
  return result;
}

/** O d20 do atacante com as circunstâncias do alvo e do combate (Vantagem e Desvantagem se anulam). */
export function withCircumstances(d20: SheetD20, around: AttackCircumstances): SheetD20 {
  const advantage = [...d20.advantage, ...around.advantage];
  const disadvantage = [...d20.disadvantage, ...around.disadvantage];
  return { ...d20, input: { ...d20.input, mode: d20Mode(advantage.length > 0, disadvantage.length > 0) }, advantage, disadvantage, reminders: [...d20.reminders, ...around.reminders] };
}

/** O dano extra do conjurador contra o alvo: as marcas dele no alvo e os efeitos nele mesmo que dependem da distância. */
export function targetDamageOf(ctx: SessionContext, characterId: string, attackerToken: Token | undefined, target: Token): ReturnType<typeof targetDamage> {
  const onTarget = target.characterId !== null ? (ctx.current.characters[target.characterId]?.adjustments ?? []) : target.spellEffects;
  return targetDamage(
    onTarget.filter((a) => a.spell?.characterId === characterId),
    ctx.current.characters[characterId]?.adjustments ?? [],
    ctx.distanceBetween(attackerToken, target),
  );
}

/** Rola o dano extra (dobrado no crítico), um grupo por fonte. */
export function rollTargetDamage(ctx: SessionContext, damage: readonly TargetDamage[], critical: boolean): ReturnType<typeof rollActionDamage> {
  return damage.flatMap((d) => rollActionDamage([{ dice: d.dice, type: d.type }], critical, ctx.deps.rng).map((g) => ({ ...g, source: d.source.slice(0, 100) })));
}

/** Nota do crítico que veio da condição do alvo, não do 20 natural. */
export function autoCriticalNotes(result: { critical: boolean; roll: { critical: boolean } }, autoCritical: readonly string[]): string[] {
  return result.critical && !result.roll.critical ? [`Acerto Crítico: alvo ${autoCritical.join(', ')} a até 5 ft`] : [];
}

/**
 * Ataque contra um token: o Host rola contra a CA do alvo e, no acerto,
 * rola o dano e aplica as defesas do alvo com o motor. O dano vira uma
 * proposta: só muda os PV quando o mestre aplica (override manual).
 */
export function makeAttack(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'attack.make'>, cleaveOf?: string): PatchOp[] {
  const target = ctx.token(data.targetTokenId);
  const declared = { advantage: data.advantage, disadvantage: data.disadvantage };
  let attackerName: string;
  let label: string;
  let d20: SheetD20;
  let rollDamage: (critical: boolean, hit: boolean) => { groups: ReturnType<typeof rollActionDamage>; bonus: number };
  /** Token do atacante (para a distância até o alvo), se estiver no mapa. */
  let attackerToken: Token | undefined;
  /** Condições que o acerto da ação impõe (nota 0065). */
  let onHit: { imposes: ImposedConditions[]; actor: Token } | undefined;
  /** Uso gasto da ação do monstro, se ela é limitada. */
  let useOps: PatchOp[] = [];
  /** Arma da ficha: o que a maestria dela permite depois do resultado. */
  let weapon: { ref: { characterId: string; instanceId: string }; mastery: (hit: boolean, damaged: boolean) => ReturnType<typeof masteryOutcome> | undefined } | undefined;

  if ('characterId' in data.attacker) {
    const { character, sheet } = ctx.sheetOf(playerId, role, data.attacker.characterId);
    const instanceId = data.attacker.instanceId;
    const attack = sheet.attacks.find((a) => a.instanceId === instanceId);
    const roll = sheetD20(sheet, { kind: 'attack', instanceId }, declared);
    if (!attack || !roll) throw violation('Este ataque não está na ficha (a arma precisa estar equipada)');
    d20 = roll;
    attackerToken = Object.values(ctx.current.tokens).find((t) => t.characterId === character.id && t.mapId === target.mapId);
    attackerName = character.name;
    label = attack.name;
    const abilityModifier = sheet.abilities[attack.ability].modifier;
    rollDamage = (critical) => {
      const rolled = rollWeaponDamage(attack, { critical }, ctx.deps.rng);
      // Cleave: o dano do segundo ataque fica sem o modificador de atributo, a menos que seja negativo.
      return { groups: rolled.groups, bonus: cleaveOf !== undefined ? cleaveDamageBonus(rolled.bonus, abilityModifier) : rolled.bonus };
    };
    weapon = {
      ref: { characterId: character.id, instanceId },
      mastery: (hit, damaged) =>
        attack.mastery.available
          ? masteryOutcome({
              property: attack.mastery.property,
              hit,
              damaged,
              abilityModifier,
              proficiencyBonus: sheet.proficiencyBonus,
              damageType: attack.damage.type,
              targetSize: target.size,
              fromCleave: cleaveOf !== undefined,
            })
          : undefined,
    };
  } else {
    const token = ctx.token(data.attacker.tokenId);
    if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
    const creature = token.monsterId !== null ? ctx.deps.creature(token.monsterId) : undefined;
    const actionId = data.attacker.actionId;
    const action = creature?.actions.find((a) => a.id === actionId);
    if (!creature || action?.kind !== 'attack') throw violation('Ação de ataque não encontrada no bloco do monstro');
    useOps = spendMonsterUse(ctx, token, action.id);
    onHit = action.imposes.length > 0 ? { imposes: action.imposes, actor: token } : undefined;
    // Bônus do bloco, com a Exaustão e as condições do monstro (Envenenado, Caído…).
    d20 = creatureD20({ label: 'Bônus de ataque', modifier: action.toHit }, ctx.conditionsOf(token), { kind: 'attack', ...(action.attackKind !== 'melee_or_ranged' ? { attackKind: action.attackKind } : {}) }, declared, token.spellEffects);
    attackerToken = token;
    attackerName = token.name;
    label = action.name;
    rollDamage = (critical) => ({ groups: rollActionDamage(action.damage, critical, ctx.deps.rng), bonus: 0 });
  }
  const defender = targetOf(ctx, target);
  const around = attackCircumstances(ctx, attackerToken, target);
  const used = around.used;
  // Dano extra de quem conjurou contra este alvo (Hex, Hunter's Mark; nota 0063).
  const extra = 'characterId' in data.attacker ? targetDamageOf(ctx, data.attacker.characterId, attackerToken, target) : { damage: [], reminders: [] };
  const baseDamage = rollDamage;
  rollDamage = (critical, hit) => {
    const rolled = baseDamage(critical, hit);
    return { ...rolled, groups: [...rolled.groups, ...rollTargetDamage(ctx, extra.damage, critical)] };
  };
  around.reminders.push(...extra.reminders);
  d20 = withCircumstances(d20, around);
  const result = resolveAttack(
    { d20: d20.input, targetAc: defender.ac, rollDamage, defenses: defender.defenses, autoCritical: around.autoCritical.length > 0 },
    ctx.deps.rng,
  );
  const autoCriticalNote = autoCriticalNotes(result, around.autoCritical);
  const combat = ctx.current.combat;
  const damaged = (result.damage?.applied.total ?? 0) > 0;
  let mastery = weapon?.mastery(result.hit, damaged);
  // Com combate e o atacante nele, Sap, Vex e Slow viram efeitos temporários de verdade (até o próximo turno do atacante).
  const attackerId = attackerToken?.id;
  const attackerIndex = combat && attackerId !== undefined ? combat.combatants.findIndex((c) => c.tokenId === attackerId) : -1;
  const timed = mastery && combat && attackerToken && attackerIndex >= 0 ? timedMastery(mastery.property, result.hit, damaged) : undefined;
  let effects = combat ? combat.effects.filter((e) => !used.has(e.id)) : [];
  const started: TimedEffect[] = [];
  if (timed && combat && attackerToken && mastery) {
    const effect: TimedEffect = {
      id: ctx.deps.newId(),
      kind: timed,
      sourceTokenId: attackerToken.id,
      targetTokenId: target.id,
      until: { at: TIMED_MASTERY_UNTIL[timed], tokenId: attackerToken.id, round: nextTurnRound(combat, attackerIndex) },
    };
    // Slow não acumula: o novo substitui o anterior no mesmo alvo.
    if (timed === 'slow') effects = effects.filter((e) => !(e.kind === 'slow' && e.targetTokenId === target.id));
    effects = [...effects, effect];
    started.push(effect);
    mastery = { ...mastery, notes: [timedMasteryNote(timed, attackerName, target.name)] };
  }
  const imposed = onHit && result.hit ? imposeFromAction(ctx, playerId, onHit.imposes, onHit.actor, target, `${label} (${attackerName})`) : { ops: [], notes: [] };
  const entryId = ctx.deps.newId();
  const ops: PatchOp[] = [];
  let damage: Extract<ChatEntry, { kind: 'attack_roll' }>['damage'];
  if (result.damage && result.damage.groups.length > 0) {
    const proposalId = ctx.deps.newId();
    damage = {
      groups: result.damage.groups,
      bonus: result.damage.bonus,
      total: result.damage.applied.total,
      defenses: damageNotes(result.damage.applied),
      proposalId,
    };
    ops.push({
      op: 'add',
      path: toPointer('proposals', proposalId),
      value: { id: proposalId, entryId, targetTokenId: target.id, targetName: target.name, amount: result.damage.applied.total },
    });
  }
  const entry: ChatEntry = {
    kind: 'attack_roll',
    id: entryId,
    at: ctx.deps.now(),
    authorId: playerId,
    attackerName,
    label: label.slice(0, 100),
    targetTokenId: target.id,
    targetName: target.name,
    visibility: data.visibility,
    mode: d20.input.mode,
    dice: result.roll.dice,
    natural: result.roll.natural,
    modifier: d20.input.modifier,
    total: result.roll.total,
    critical: result.critical,
    fumble: result.roll.fumble,
    advantage: d20.advantage,
    disadvantage: d20.disadvantage,
    notes: [...d20StepNotes(result.roll.steps), ...autoCriticalNote, ...imposed.notes.map((n) => `No acerto: ${n}`)].slice(0, 50),
    reminders: [...d20.reminders, ...defender.reminders].slice(0, 50),
    hit: result.hit,
    ...(damage ? { damage } : {}),
    ...(weapon ? { weapon: weapon.ref } : {}),
    ...(mastery && (mastery.action || mastery.notes.length > 0)
      ? { mastery: { property: mastery.property, ...(mastery.action ? { action: mastery.action } : {}), notes: mastery.notes } }
      : {}),
    ...(cleaveOf !== undefined ? { masteryOf: cleaveOf } : {}),
  };
  const combatOps: PatchOp[] =
    combat && (used.size > 0 || started.length > 0)
      ? [...started.map((e) => ctx.appendChat(timedEffectEntry(ctx, playerId, 'started', e))), ctx.replaceCombat({ ...combat, effects })]
      : [];
  return [ctx.appendChat(entry), ...ops, ...combatOps, ...imposed.ops, ...useOps];
}

/**
 * Usa a ação de seguimento da maestria de um `attack_roll` (uma vez por
 * ataque): Cleave ataca um segundo alvo, Graze causa o modificador de dano
 * no erro, Topple força a salvaguarda de Constituição contra Caído. A ficha
 * é recalculada: a arma precisa continuar equipada e com a maestria.
 */
export function useMastery(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'mastery.use'>): PatchOp[] {
  const entry = ctx.current.chat.find((e) => e.id === data.entryId);
  if (entry?.kind !== 'attack_roll') throw violation('Ataque não encontrado no chat');
  if (role !== 'gm' && entry.authorId !== playerId) throw notAllowed('Só quem fez o ataque (ou o mestre) usa a maestria');
  const action = entry.mastery?.action;
  if (!entry.weapon || !entry.mastery || !action) throw violation('Este ataque não tem maestria para usar');
  if (ctx.current.chat.some((e) => 'masteryOf' in e && e.masteryOf === entry.id)) throw violation('A maestria deste ataque já foi usada');
  if (action !== 'cleave' && (data.targetTokenId !== undefined || data.advantage !== undefined || data.disadvantage !== undefined)) {
    throw violation('Alvo e Vantagem/Desvantagem só valem no Cleave');
  }
  const { character, sheet } = ctx.sheetOf(playerId, role, entry.weapon.characterId);
  const instanceId = entry.weapon.instanceId;
  const attack = sheet.attacks.find((a) => a.instanceId === instanceId);
  if (!attack?.mastery.available || attack.mastery.property !== entry.mastery.property) throw violation('A arma não está mais equipada com esta maestria');
  const abilityModifier = sheet.abilities[attack.ability].modifier;
  const name = MASTERY_NAME[entry.mastery.property];

  if (action === 'cleave') {
    if (data.targetTokenId === undefined) throw violation('Escolha o segundo alvo do Cleave');
    if (data.targetTokenId === entry.targetTokenId) throw violation('O Cleave precisa de outra criatura');
    return makeAttack(ctx, 
      playerId,
      role,
      {
        attacker: entry.weapon,
        targetTokenId: data.targetTokenId,
        ...(data.advantage !== undefined ? { advantage: data.advantage } : {}),
        ...(data.disadvantage !== undefined ? { disadvantage: data.disadvantage } : {}),
        visibility: entry.visibility,
      },
      entry.id,
    );
  }

  const target = ctx.token(entry.targetTokenId);
  if (action === 'graze') {
    const amount = grazeDamage(abilityModifier);
    if (amount === 0) throw violation('Sem dano do Graze: o modificador de atributo não é positivo');
    const defender = targetOf(ctx, target);
    const applied = applyDamage(defender.defenses, [{ amount, type: attack.damage.type }], ctx.deps.rng);
    const base = ctx.entryBase(playerId);
    const proposalId = applied.total > 0 ? ctx.deps.newId() : undefined;
    return [
      ctx.appendChat({
        kind: 'mastery_damage',
        ...base,
        masteryOf: entry.id,
        property: 'graze',
        attackerName: character.name,
        label: attack.name.slice(0, 100),
        targetTokenId: target.id,
        targetName: target.name,
        visibility: entry.visibility,
        damageType: attack.damage.type,
        amount,
        total: applied.total,
        defenses: [...damageNotes(applied), ...defender.reminders].slice(0, 50),
        ...(proposalId ? { proposalId } : {}),
      }),
      ...(proposalId
        ? [{ op: 'add' as const, path: toPointer('proposals', proposalId), value: { id: proposalId, entryId: base.id, targetTokenId: target.id, targetName: target.name, amount: applied.total } }]
        : []),
    ];
  }

  // Topple: salvaguarda de Constituição contra Caído, sem dano.
  const dc = toppleDc(abilityModifier, sheet.proficiencyBonus);
  const save = saveOf(ctx, target, 'con', { condition: 'prone' });
  const result = resolveSave({ d20: save.input, dc, damage: [], onSuccess: 'none', defenses: save.defenses }, ctx.deps.rng);
  const immune = save.defenses.conditionImmunities.some((c) => c.condition === 'prone');
  const conditionNotes = result.success ? [] : [immune ? `Imune a ${CONDITION_NAME.prone}` : `Na falha: ${CONDITION_NAME.prone}`];
  return [
    ctx.appendChat({
      kind: 'save_roll',
      ...ctx.entryBase(playerId),
      actorName: character.name,
      label: `${name} (${attack.name})`.slice(0, 100),
      ability: 'con',
      dc,
      onSuccess: 'none',
      visibility: entry.visibility,
      conditions: ['prone'],
      masteryOf: entry.id,
      results: [
        {
          targetTokenId: target.id,
          targetName: target.name,
          mode: save.input.mode,
          dice: result.roll.dice,
          natural: result.roll.natural,
          modifier: save.input.modifier,
          total: result.roll.total,
          success: result.success,
          advantage: save.advantage,
          disadvantage: save.disadvantage,
          notes: [...d20StepNotes(result.roll.steps), ...conditionNotes].slice(0, 50),
          reminders: save.reminders.slice(0, 50),
        },
      ],
    }),
  ];
}

/** Aplica o dano proposto (ou o valor do mestre) nos PV do alvo e registra no chat. */
export function applyProposal(ctx: SessionContext, playerId: string, proposalId: string, override: number | undefined): PatchOp[] {
  const proposal = proposalOf(ctx, proposalId);
  const token = ctx.current.tokens[proposal.targetTokenId];
  if (!token) throw violation('O alvo não está mais no mapa');
  const amount = override ?? proposal.amount;
  let result: ReturnType<typeof applyHitPointChange>;
  let ops: PatchOp[];
  if (token.characterId !== null) {
    const character = ctx.current.characters[token.characterId];
    const sheet = character ? ctx.deps.characterSheet(character) : undefined;
    if (!character || !sheet) throw violation('O personagem do alvo ainda não tem ficha');
    // Dano de um Acerto Crítico com 0 PV conta duas falhas.
    const source = ctx.current.chat.find((e) => e.id === proposal.entryId);
    const critical = source?.kind === 'attack_roll' && source.critical;
    ({ result, ops } = changeCharacterHp(ctx, playerId, character, sheet, { kind: 'damage', amount }, critical));
  } else {
    if (!token.hp) throw violation('O alvo não tem PV (defina os PV máximos no painel)');
    result = applyHitPointChange(token.hp.max, token.hp, { kind: 'damage', amount });
    ops = [{ op: 'replace', path: toPointer('tokens', token.id, 'hp'), value: { max: token.hp.max, ...result.state } }];
  }
  const notes = [
    ...(result.absorbed > 0 ? [`${result.absorbed} absorvido(s) pelos PV temporários`] : []),
    ...(result.droppedToZero ? [`${token.name} caiu a 0 PV`] : []),
    ...(result.massiveDamage && token.characterId !== null ? ['Dano massivo: morte instantânea (SRD)'] : []),
    ...(result.damagedAtZero && token.characterId === null ? ['Dano com 0 PV'] : []),
  ];
  // O registro do dano vem antes das consequências (Inconsciente, falhas, morte).
  return [
    { op: 'remove', path: toPointer('proposals', proposalId) },
    ctx.appendChat({
      kind: 'damage_applied',
      ...ctx.entryBase(playerId),
      targetTokenId: token.id,
      targetName: token.name,
      amount,
      ...(override !== undefined && override !== proposal.amount ? { proposed: proposal.amount } : {}),
      notes,
    }),
    ...ops,
  ];
}

/**
 * Um efeito com CD contra um ou mais tokens: o dano é rolado uma vez para
 * todos; cada alvo rola a própria salvaguarda (com as Vantagens
 * circunstanciais que batem com `against`); o dano de cada um, depois do
 * sucesso e das defesas, vira uma proposta para o mestre.
 */
export function forceSave(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'save.force'>): PatchOp[] {
  let actorName: string;
  let onFail: { imposes: ImposedConditions[]; actor: Token } | undefined;
  let useOps: PatchOp[] = [];
  let effect: SaveEffect;
  if ('tokenId' in data.source) {
    const token = ctx.token(data.source.tokenId);
    if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
    const actionId = data.source.actionId;
    const action = token.monsterId !== null ? ctx.deps.creature(token.monsterId)?.actions.find((a) => a.id === actionId) : undefined;
    if (action?.kind !== 'save') throw violation('Ação de salvaguarda não encontrada no bloco do monstro');
    actorName = token.name;
    useOps = spendMonsterUse(ctx, token, action.id);
    if (action.imposes.length > 0) onFail = { imposes: action.imposes, actor: token };
    effect = { name: action.name, ability: action.ability, dc: action.dc, damage: action.damage, onSuccess: action.onSuccess, conditions: action.onFailConditions };
  } else {
    actorName = ctx.current.players[playerId]?.displayName ?? 'Alguém';
    const custom = data.source.custom;
    effect = { ...custom, conditions: custom.conditions ?? [] };
  }
  const targets = data.targetTokenIds.map((id) => ctx.token(id));
  const against: RollAgainst | undefined = data.against ?? (effect.conditions[0] ? { condition: effect.conditions[0] } : undefined);
  const imposing = onFail;
  const saves = rollSaves(ctx, playerId, {
    actorName,
    effect,
    targets,
    against,
    visibility: data.visibility,
    // Na falha, as condições do bloco entram direto (nota 0065).
    ...(imposing ? { impose: (target: Token) => imposeFromAction(ctx, playerId, imposing.imposes, imposing.actor, target, `${effect.name} (${actorName})`) } : {}),
  });
  return [...saves.ops, ...useOps];
}

/** Um efeito com CD que os alvos precisam salvar: a regra comum a `save.force` e às magias (`spell.effect`). */
export interface SaveEffect {
  name: string;
  ability: Ability;
  dc: number;
  damage: { dice: string; type: DamageType }[];
  onSuccess: 'half' | 'none';
  conditions: Condition[];
}

/**
 * Rola o dano uma vez e a salvaguarda de cada alvo, com as defesas dele; o
 * dano de cada um vira proposta para o mestre. Devolve a entrada `save_roll`
 * e as propostas, e quem falhou (para as condições das magias, nota 0058).
 * `declared`: Vantagem ou Desvantagem dos alvos (Charm Person contra quem luta).
 */
export function rollSaves(
  ctx: SessionContext,
  playerId: string,
  options: {
    actorName: string;
    effect: SaveEffect;
    targets: Token[];
    against: RollAgainst | undefined;
    visibility: Visibility;
    spellOf?: { entryId: string; part: number };
    declared?: { advantage?: boolean | undefined; disadvantage?: boolean | undefined };
    /** Condições que entram direto na falha; as notas vão no resultado do alvo. */
    impose?: (target: Token) => { ops: PatchOp[]; notes: string[] };
  },
): { ops: PatchOp[]; failed: Token[] } {
  const { actorName, effect, targets, against } = options;
  const failed: Token[] = [];
  // Dano rolado uma vez para todos os alvos (SRD 5.2.1, "Damage against Multiple Targets").
  const groups = rollActionDamage(effect.damage, false, ctx.deps.rng);
  const rolled = groups.map((g) => ({ amount: g.total, type: g.type }));
  const entryId = ctx.deps.newId();
  const ops: PatchOp[] = [];

  const results = targets.map((target) => {
    const save = saveOf(ctx, target, effect.ability, against, options.declared);
    const result = resolveSave({ d20: save.input, dc: effect.dc, damage: rolled, onSuccess: effect.onSuccess, defenses: save.defenses }, ctx.deps.rng);
    if (!result.success) failed.push(target);
    const immune = new Set(save.defenses.conditionImmunities.map((c) => c.condition));
    const imposed = !result.success && options.impose ? options.impose(target) : undefined;
    if (imposed) ops.push(...imposed.ops);
    const conditionNotes = result.success
      ? []
      : imposed
        ? imposed.notes.map((n) => (n.startsWith('Imune a ') ? n : `Na falha: ${n}`))
        : effect.conditions.map((c) => (immune.has(c) ? `Imune a ${CONDITION_NAME[c]}` : `Na falha: ${CONDITION_NAME[c]}`));
    let damage: { total: number; defenses: string[]; proposalId?: string } | undefined;
    if (result.damage) {
      damage = { total: result.damage.total, defenses: damageNotes(result.damage) };
      if (result.damage.total > 0) {
        const proposalId = ctx.deps.newId();
        damage.proposalId = proposalId;
        ops.push({ op: 'add', path: toPointer('proposals', proposalId), value: { id: proposalId, entryId, targetTokenId: target.id, targetName: target.name, amount: result.damage.total } });
      }
    }
    return {
      targetTokenId: target.id,
      targetName: target.name,
      mode: save.input.mode,
      dice: result.roll.dice,
      natural: result.roll.natural,
      modifier: save.input.modifier,
      total: result.roll.total,
      success: result.success,
      advantage: save.advantage,
      disadvantage: save.disadvantage,
      notes: [...d20StepNotes(result.roll.steps), ...conditionNotes].slice(0, 50),
      reminders: save.reminders.slice(0, 50),
      ...(damage ? { damage } : {}),
    };
  });

  const entry: ChatEntry = {
    kind: 'save_roll',
    id: entryId,
    at: ctx.deps.now(),
    authorId: playerId,
    actorName,
    label: effect.name.slice(0, 100),
    ability: effect.ability,
    dc: effect.dc,
    onSuccess: effect.onSuccess,
    visibility: options.visibility,
    ...(groups.length > 0 ? { damage: { groups, total: rolled.reduce((sum, d) => sum + d.amount, 0) } } : {}),
    conditions: effect.conditions,
    ...(options.spellOf ? { spellOf: options.spellOf } : {}),
    results,
  };
  return { ops: [ctx.appendChat(entry), ...ops], failed };
}

/** A salvaguarda de um token: a da ficha do personagem ligado ou a do bloco do monstro, com as defesas dele. */
export function saveOf(
  ctx: SessionContext,
  token: Token,
  ability: Ability,
  against: RollAgainst | undefined,
  declared: { advantage?: boolean | undefined; disadvantage?: boolean | undefined } = {},
): SheetD20 & { defenses: Defenses } {
  if (token.characterId !== null) {
    const character = ctx.current.characters[token.characterId];
    const sheet = character ? ctx.deps.characterSheet(character) : undefined;
    const roll = sheet ? sheetD20(sheet, { kind: 'save', ability }, declared, against) : undefined;
    if (!sheet || !roll) throw violation(`${token.name}: o personagem ainda não tem ficha`);
    return { ...roll, defenses: sheet.defenses };
  }
  const block = ctx.creatureOf(token);
  if (!block) throw violation(`${token.name}: sem salvaguarda conhecida (não é personagem nem monstro do compêndio)`);
  const { creature, defenses, reminders } = block;
  const state = ctx.conditionsOf(token);
  // Bônus do bloco, com a Exaustão e as condições (Paralisado falha em FOR e DES).
  const roll = creatureD20({ label: 'Salvaguarda do bloco', modifier: creatureSaveBonus(creature, ability) }, state, { kind: 'save', ability }, declared, token.spellEffects);
  return { ...roll, reminders: [...roll.reminders, ...reminders], defenses };
}
