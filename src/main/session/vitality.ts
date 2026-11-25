import { applyHitPointChange, clampHitPoints, currentHitPoints, d20StepNotes, type DerivedSheet, effectiveConditions, deathAfterDamage, deathAfterHealing, type DeathSaveState, type HitPointChange, type HitPointResult, resolveDeathSave, concentrationDc, rollD20, sheetD20, withoutDependents } from 'rules-engine';
import { type ChatEntry, type ConditionState, type IntentData, type PatchOp, type Role, type SessionCharacter, type SessionState, toPointer } from '../../shared/protocol';
import { type SessionContext, violation, notAllowed } from './context';
import { tokenDamaged } from './monster-concentration';
import { liftSpellConditions } from './spell-effects';

/** Pontos de vida, Salvaguardas contra a Morte (nota 0044) e Concentração (nota 0045). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/**
 * Dano, cura e PV temporários (regras no motor, `applyHitPointChange`). O
 * mestre muda qualquer um; o jogador, o próprio personagem e os próprios
 * tokens. Cair a 0 PV, morte e Salvaguardas contra a Morte são da Fase 5.
 */
export function changeHp(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'hp.change'>): PatchOp[] {
  const { change } = data;
  if ('characterId' in data.target) {
    if (change.kind === 'max') throw violation('Os PV máximos de um personagem vêm da ficha');
    const character = ctx.ownCharacter(playerId, role, data.target.characterId);
    const sheet = ctx.deps.characterSheet(character);
    if (!sheet) throw violation('O personagem ainda não tem ficha (defina os atributos)');
    return changeCharacterHp(ctx, playerId, character, sheet, { kind: change.kind, amount: change.amount }).ops;
  }
  const token = ctx.token(data.target.tokenId);
  if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
  const path = toPointer('tokens', token.id, 'hp');
  if (change.kind === 'max') {
    if (change.amount < 1) throw violation('PV máximos precisam ser pelo menos 1');
    const state = clampHitPoints(change.amount, token.hp ?? { damage: 0, temp: 0 });
    const ops: PatchOp[] = [{ op: 'replace', path, value: { max: change.amount, ...state } }];
    if (currentHitPoints(change.amount, state) === 0 && !token.dead) {
      ops.push({ op: 'replace', path: toPointer('tokens', token.id, 'dead'), value: true });
    }
    return ops;
  }
  if (token.hp === null) throw violation(token.characterId ? 'Mude os PV no personagem' : 'Este token não tem PV (defina os PV máximos)');
  const result = applyHitPointChange(token.hp.max, token.hp, { kind: change.kind, amount: change.amount });
  const hp = { max: token.hp.max, ...result.state };
  const current = currentHitPoints(token.hp.max, result.state);
  const ops: PatchOp[] = [{ op: 'replace', path, value: hp }];
  if (current === 0 && !token.dead) {
    ops.push({ op: 'replace', path: toPointer('tokens', token.id, 'dead'), value: true });
  } else if (change.kind === 'healing' && current > 0 && token.dead) {
    ops.push({ op: 'replace', path: toPointer('tokens', token.id, 'dead'), value: false });
  }
  if (change.kind === 'damage') ops.push(...tokenDamaged(ctx, playerId, token, hp, Math.trunc(change.amount)));
  return ops;
}

/** Algum token do personagem está no combate. */
export function inCombat(ctx: SessionContext, characterId: string): boolean {
  const combat = ctx.current.combat;
  return combat !== null && combat.combatants.some((c) => ctx.current.tokens[c.tokenId]?.characterId === characterId);
}

/**
 * O Host rola a Salvaguarda contra a Morte com a ficha (Vantagens, regras do
 * d20, bônus de `save.all`) e aplica o resultado pelo motor: 20 recupera 1
 * PV, 1 conta duas falhas, três sucessos estabilizam, três falhas matam.
 */
export function rollDeathSave(ctx: SessionContext, playerId: string, state: SessionState, characterId: string): PatchOp[] {
  const character = state.characters[characterId];
  const sheet = character ? ctx.deps.characterSheet(character) : undefined;
  if (!character || !sheet) return [];
  const roll = sheetD20(sheet, { kind: 'death_save' });
  if (!roll) return [];
  const result = rollD20(roll.input, ctx.deps.rng);
  const resolved = resolveDeathSave(character.deathSaves, { total: result.total, natural1: result.fumble, natural20: result.critical });
  const notes = [
    ...(roll.advantage.length > 0 ? [`Vantagem: ${roll.advantage.join(', ')}`] : []),
    ...(roll.disadvantage.length > 0 ? [`Desvantagem: ${roll.disadvantage.join(', ')}`] : []),
    ...d20StepNotes(result.steps),
  ];
  let ops: PatchOp[];
  let deathSaves = resolved.state;
  if (resolved.outcome === 'revived') {
    const healed = changeCharacterHp(ctx, playerId, character, sheet, { kind: 'healing', amount: 1 }, false, false);
    ops = healed.ops;
    deathSaves = healed.after.deathSaves;
    notes.push('20: recupera 1 PV');
  } else {
    ops = [{ op: 'replace', path: toPointer('characters', character.id, 'deathSaves'), value: deathSaves }];
    if (resolved.outcome === 'two_failures') notes.push('1: duas falhas');
    if (deathSaves.stable) notes.push('Três sucessos: Estável');
    if (deathSaves.dead) notes.push('Três falhas: morto');
  }
  return [
    ctx.appendChat({
      kind: 'death_save',
      ...ctx.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      mode: roll.input.mode,
      dice: result.dice,
      natural: result.natural,
      modifier: roll.input.modifier,
      total: result.total,
      outcome: resolved.outcome,
      deathSaves,
      notes: notes.slice(0, 50),
    }),
    ...ops,
  ];
}

export function deathStateEntry(ctx: SessionContext, playerId: string, character: SessionCharacter, cause: Extract<ChatEntry, { kind: 'death_state' }>['cause'], deathSaves: DeathSaveState, notes: string[]): PatchOp {
  return ctx.appendChat({ kind: 'death_state', ...ctx.entryBase(playerId), characterId: character.id, characterName: character.name, cause, deathSaves, notes });
}

/**
 * Mudança de PV de um personagem com as regras de 0 PV (motor,
 * `engine/death.ts`): cair a 0 deixa Inconsciente (dano massivo mata), dano
 * com 0 PV conta falhas, recuperar PV zera a contagem e tira o Inconsciente.
 * Um personagem morto não recupera PV. Devolve as operações (PV, condições,
 * Salvaguardas contra a Morte e os registros no chat) e o personagem depois.
 * `log: false` omite o `death_state` (quem chama já registra, como a rolagem).
 */
export function changeCharacterHp(
  ctx: SessionContext,
  playerId: string,
  character: SessionCharacter,
  sheet: DerivedSheet,
  change: HitPointChange,
  critical = false,
  log = true,
): { ops: PatchOp[]; result: HitPointResult; after: SessionCharacter } {
  if (change.kind === 'healing' && character.deathSaves.dead) throw violation(`${character.name} está morto: o mestre o revive antes de curar`);
  const max = sheet.hpMax.total;
  const result = applyHitPointChange(max, character.hp, change);
  let { conditions, deathSaves } = character;
  const notes: string[] = [];
  const hasUnconscious = conditions.active.some((c) => c.condition === 'unconscious');
  let condition: { kind: 'added' | 'removed'; note: string } | undefined;
  if (change.kind === 'damage') {
    const death = deathAfterDamage(deathSaves, result, critical);
    deathSaves = death.state;
    if (death.event === 'unconscious' && !hasUnconscious) {
      conditions = { ...conditions, active: [...conditions.active, { condition: 'unconscious' }] };
      condition = { kind: 'added', note: 'Caiu a 0 PV' };
    }
    if (death.event === 'dead') notes.push(result.massiveDamage ? 'Dano massivo: morte instantânea' : 'Três falhas: morto');
    if (death.event === 'failure') notes.push('Dano com 0 PV: uma falha');
    if (death.event === 'two_failures') notes.push('Acerto Crítico com 0 PV: duas falhas');
    if (character.deathSaves.stable && !deathSaves.stable) notes.push('Deixou de estar Estável');
  } else if (change.kind === 'healing' && result.hpChange > 0 && currentHitPoints(max, character.hp) === 0) {
    deathSaves = deathAfterHealing(deathSaves);
    if (hasUnconscious) {
      conditions = { ...conditions, active: withoutDependents(conditions.active.filter((c) => c.condition !== 'unconscious')) };
      condition = { kind: 'removed', note: 'Recuperou PV' };
    }
    notes.push('Recuperou PV: contagem zerada');
  }
  const deathChanged = JSON.stringify(deathSaves) !== JSON.stringify(character.deathSaves);
  const ops: PatchOp[] = [{ op: 'replace', path: toPointer('characters', character.id, 'hp'), value: result.state }];
  if (condition) {
    ops.push({ op: 'replace', path: toPointer('characters', character.id, 'conditions'), value: conditions });
    ops.push(
      ctx.appendChat({
        kind: 'condition_changed',
        ...ctx.entryBase(playerId),
        target: { characterId: character.id },
        targetName: character.name,
        change: { kind: condition.kind, condition: 'unconscious' },
        notes: [condition.note],
      }),
    );
  }
  if (deathChanged) {
    ops.push({ op: 'replace', path: toPointer('characters', character.id, 'deathSaves'), value: deathSaves });
    if (log && notes.length > 0) ops.push(deathStateEntry(ctx, playerId, character, change.kind === 'damage' ? 'damage' : 'healing', deathSaves, notes));
  }
  // Concentração: Inconsciente ou morto encerra; senão, dano pede a salvaguarda de Constituição.
  let concentration = character.concentration;
  const broken = concentrationBreaks(ctx, playerId, character, conditions, deathSaves);
  if (broken.length > 0) {
    ops.push(...broken);
    concentration = null;
  } else if (concentration && change.kind === 'damage' && Math.trunc(change.amount) > 0) {
    const kept = concentrationSave(ctx, playerId, character, sheet, concentration, Math.trunc(change.amount));
    ops.push(...kept.ops);
    if (!kept.kept) concentration = null;
  }
  // Dano interrompe o descanso de quem o sofre.
  if (change.kind === 'damage' && Math.trunc(change.amount) > 0) ops.push(...ctx.leaveRest(playerId, character, 'Sofreu dano: o descanso não vale'));
  return { ops, result, after: { ...character, hp: result.state, conditions, deathSaves, concentration } };
}

/** Passa a se concentrar numa magia da ficha que exige Concentração; a anterior termina. */
export function concentrate(ctx: SessionContext, playerId: string, role: Role, characterId: string, spellId: string, fromItem = false): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, characterId);
  if (character.deathSaves.dead) throw violation(`${character.name} está morto`);
  if (effectiveConditions(character.conditions.active.map((c) => c.condition)).has('incapacitated')) throw violation(`${character.name} está Incapacitado`);
  // Pelo item, a magia não precisa estar na ficha (nota 0075).
  if (!fromItem && !sheet.spellcasting.concentration.includes(spellId)) throw violation('Esta magia não está na ficha ou não exige Concentração');
  if (character.concentration?.spellId === spellId) throw violation(`${character.name} já está concentrado nesta magia`);
  const name = (ctx.deps.spell(spellId)?.name ?? spellId).slice(0, 100);
  return [
    ...(character.concentration ? endConcentration(ctx, playerId, character, 'replaced') : []),
    { op: 'replace', path: toPointer('characters', character.id, 'concentration'), value: { spellId, name } },
    ctx.appendChat({ kind: 'concentration', ...ctx.entryBase(playerId), characterId: character.id, characterName: character.name, spellName: name, event: 'started', notes: [] }),
  ];
}

export function endConcentration(
  ctx: SessionContext,
  playerId: string,
  character: SessionCharacter,
  reason: Exclude<Extract<ChatEntry, { kind: 'concentration' }>['reason'], undefined>,
  notes: string[] = [],
): PatchOp[] {
  if (!character.concentration) return [];
  const { spellId, name } = character.concentration;
  return [
    { op: 'replace', path: toPointer('characters', character.id, 'concentration'), value: null },
    ctx.appendChat({
      kind: 'concentration',
      ...ctx.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      spellName: character.concentration.name,
      event: 'ended',
      reason,
      notes,
    }),
    // As condições que a magia pôs caem junto (Hold Person, nota 0058).
    ...liftSpellConditions(ctx, playerId, { characterId: character.id, spellId }, name, character.conditions),
  ];
}

/** A Concentração termina se o personagem morreu ou está Incapacitado (ou com o que o inclui). */
export function concentrationBreaks(ctx: SessionContext, playerId: string, character: SessionCharacter, conditions: ConditionState, deathSaves: DeathSaveState): PatchOp[] {
  if (!character.concentration) return [];
  // As condições novas (a mesma ação pode tê-las mudado) valem para o que cai junto com a magia.
  const current = { ...character, conditions };
  if (deathSaves.dead) return endConcentration(ctx, playerId, current, 'dead');
  if (effectiveConditions(conditions.active.map((c) => c.condition)).has('incapacitated')) return endConcentration(ctx, playerId, current, 'incapacitated');
  return [];
}

/**
 * Dano num personagem concentrado: salvaguarda de Constituição pela ficha,
 * com o contexto de Concentração (Eldritch Mind), CD = o maior entre 10 e
 * metade do dano, até 30. `keep_concentration` (Relentless Hunter) dispensa.
 */
export function concentrationSave(
  ctx: SessionContext,
  playerId: string,
  character: SessionCharacter,
  sheet: DerivedSheet,
  concentration: NonNullable<SessionCharacter['concentration']>,
  damage: number,
): { ops: PatchOp[]; kept: boolean } {
  const base = { ...ctx.entryBase(playerId), characterId: character.id, characterName: character.name, spellName: concentration.name };
  if (sheet.spellcasting.keepConcentration.includes(concentration.spellId)) {
    return { ops: [ctx.appendChat({ kind: 'concentration', ...base, event: 'kept', notes: ['O dano não quebra a Concentração nesta magia'] })], kept: true };
  }
  const dc = concentrationDc(damage);
  const roll = sheetD20(sheet, { kind: 'save', ability: 'con' }, {}, { concentration: true });
  if (!roll) return { ops: [], kept: true };
  const result = rollD20({ ...roll.input, dc }, ctx.deps.rng);
  const success = result.success === true;
  const ops: PatchOp[] = [
    ctx.appendChat({
      kind: 'concentration_save',
      ...base,
      dc,
      mode: roll.input.mode,
      dice: result.dice,
      natural: result.natural,
      modifier: roll.input.modifier,
      total: result.total,
      success,
      advantage: roll.advantage,
      disadvantage: roll.disadvantage,
      notes: [...d20StepNotes(result.steps), ...roll.reminders].slice(0, 50),
    }),
  ];
  if (!success) ops.push(...endConcentration(ctx, playerId, character, 'failed_save'));
  return { ops, kept: success };
}
