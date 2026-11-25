import { creatureD20, creatureReminders, currentHitPoints, type D20RollInput, d20Mode, d20StepNotes, expiresAt, isDying, isBloodied, nextTurn, rollD20, sheetD20, sortByInitiative, type TriggerMoment, type TurnExpiry, turnAfterRemoval } from 'rules-engine';
import { applyPatch, type ChatEntry, type Combat, type ConditionState, type TimedEffect, type IntentData, type PatchOp, type Role, type SessionCharacter, type SessionState, MAX_TURN_TRIGGER_ITEMS, MAX_COMBATANTS, MAX_INITIATIVE, MIN_INITIATIVE, toPointer } from '../../shared/protocol';
import { type SessionContext, violation, notAllowed } from './context';
import { cancelRest } from './rest';
import { changeCharacterHp, rollDeathSave } from './vitality';

/** Combate, iniciativa, turnos, lembretes de turno e fim das durações (notas 0039, 0042 e 0043). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/**
 * O Host rola a iniciativa de cada token: a da ficha do personagem ligado,
 * o bônus publicado do monstro, ou +0. Surpresa dá Desvantagem.
 */
export function rollInitiatives(ctx: SessionContext, data: IntentData<'combat.start'>): { combatants: Combat['combatants']; entry: Extract<ChatEntry, { kind: 'initiative_roll' }>['results'] } {
  const surprised = new Set(data.surprisedTokenIds ?? []);
  const rolled = data.tokenIds.map((tokenId) => {
    const token = ctx.token(tokenId);
    const notes: string[] = [];
    let modifier: number;
    let advantage: string[];
    let disadvantage: string[];
    let rules: D20RollInput['rules'];
    let bonusDice: D20RollInput['bonusDice'];
    const character = token.characterId !== null ? ctx.current.characters[token.characterId] : undefined;
    const sheet = character ? ctx.deps.characterSheet(character) : undefined;
    const roll = sheet ? sheetD20(sheet, { kind: 'initiative' }) : undefined;
    const creature = token.monsterId !== null ? ctx.deps.creature(token.monsterId) : undefined;
    if (roll) {
      modifier = roll.input.modifier;
      advantage = roll.advantage;
      disadvantage = roll.disadvantage;
      rules = roll.input.rules;
      bonusDice = roll.input.bonusDice;
    } else {
      if (!creature) notes.push(token.characterId !== null ? 'Personagem sem ficha: iniciativa +0' : 'Sem ficha nem bloco de monstro: iniciativa +0');
      // Bônus do bloco (ou +0), com a Exaustão e as condições (Incapacitado, Invisível).
      const own = creatureD20({ label: 'Iniciativa', modifier: creature?.initiative ?? 0 }, ctx.conditionsOf(token), { kind: 'initiative' }, {}, token.spellEffects);
      bonusDice = own.input.bonusDice;
      modifier = own.input.modifier;
      advantage = own.advantage;
      disadvantage = own.disadvantage;
    }
    if (surprised.has(tokenId)) disadvantage = [...disadvantage, 'Surpresa'];
    const input: D20RollInput = { modifier, mode: d20Mode(advantage.length > 0, disadvantage.length > 0), ...(rules ? { rules } : {}), ...(bonusDice ? { bonusDice } : {}) };
    const result = rollD20(input, ctx.deps.rng);
    const total = Math.max(MIN_INITIATIVE, Math.min(MAX_INITIATIVE, result.total));
    return {
      combatant: { tokenId, initiative: total, modifier },
      result: {
        tokenId,
        name: token.name,
        mode: input.mode,
        dice: result.dice,
        natural: result.natural,
        modifier,
        total,
        notes: [
          ...(advantage.length > 0 ? [`Vantagem: ${advantage.join(', ')}`] : []),
          ...(disadvantage.length > 0 ? [`Desvantagem: ${disadvantage.join(', ')}`] : []),
          ...d20StepNotes(result.steps),
          ...notes,
        ].slice(0, 50),
      },
    };
  });
  return { combatants: rolled.map((r) => r.combatant), entry: rolled.map((r) => r.result) };
}

/** Ordem de turnos pelo motor; quem estava na vez continua na vez. */
export function ordered(ctx: SessionContext, combatants: Combat['combatants'], current: string | undefined): { combatants: Combat['combatants']; turn: number } {
  const sorted = sortByInitiative(combatants.map((c) => ({ ...c, initiative: c.initiative ?? 0, modifier: c.modifier ?? 0 })));
  const turn = current === undefined ? 0 : Math.max(0, sorted.findIndex((c) => c.tokenId === current));
  return { combatants: sorted, turn };
}

export function startCombat(ctx: SessionContext, playerId: string, data: IntentData<'combat.start'>): PatchOp[] {
  if (ctx.current.combat) throw violation('Já há um combate em andamento');
  const { combatants, entry } = rollInitiatives(ctx, data);
  const order = ordered(ctx, combatants, undefined);
  const first = order.combatants[order.turn]?.tokenId;
  return [
    // Rolar a iniciativa interrompe o descanso (SRD 5.2.1, "Short Rest").
    ...cancelRest(ctx, playerId, 'Rolaram a iniciativa'),
    ctx.replaceCombat({ round: 1, turn: order.turn, combatants: order.combatants, effects: [] }),
    ctx.appendChat({ kind: 'combat_event', ...ctx.entryBase(playerId), event: 'started', round: 1 }),
    ctx.appendChat({ kind: 'initiative_roll', ...ctx.entryBase(playerId), results: entry }),
    ...data.tokenIds.flatMap((tokenId) => triggers(ctx, playerId, ctx.current, 'initiative', tokenId)),
    ...(first !== undefined ? turnStart(ctx, playerId, ctx.current, first) : []),
  ];
}

export function joinCombat(ctx: SessionContext, playerId: string, data: IntentData<'combat.add'>): PatchOp[] {
  const combat = ctx.combat();
  if (data.tokenIds.some((id) => combat.combatants.some((c) => c.tokenId === id))) throw violation('Token já está no combate');
  if (combat.combatants.length + data.tokenIds.length > MAX_COMBATANTS) throw violation(`No máximo ${MAX_COMBATANTS} combatentes`);
  const { combatants, entry } = rollInitiatives(ctx, data);
  const order = ordered(ctx, [...combat.combatants, ...combatants], combat.combatants[combat.turn]?.tokenId);
  return [
    ctx.replaceCombat({ ...combat, turn: order.turn, combatants: order.combatants }),
    ctx.appendChat({ kind: 'initiative_roll', ...ctx.entryBase(playerId), results: entry }),
    ...data.tokenIds.flatMap((tokenId) => triggers(ctx, playerId, ctx.current, 'initiative', tokenId)),
  ];
}

/** Tira o token do combate (se estiver nele); o último a sair encerra o combate. */
export function leaveCombat(ctx: SessionContext, playerId: string, tokenId: string): PatchOp[] {
  const combat = ctx.current.combat;
  const index = combat ? combat.combatants.findIndex((c) => c.tokenId === tokenId) : -1;
  if (!combat || index < 0) return [];
  const position = turnAfterRemoval(combat, index, combat.combatants.length);
  if (!position) {
    const all = expire(ctx, combat, () => true, playerId);
    return [...all.ops, ctx.replaceCombat(null), ctx.appendChat({ kind: 'combat_event', ...ctx.entryBase(playerId), event: 'ended', round: combat.round })];
  }
  // Durações presas aos turnos de quem saiu não teriam fim: terminam agora, como os efeitos que ele causou ou sofria.
  const expired = expire(ctx, combat, (until) => until.tokenId === tokenId, playerId, (e) => e.sourceTokenId === tokenId || e.targetTokenId === tokenId);
  const combatants = combat.combatants.filter((_, i) => i !== index);
  return [
    ...expired.ops,
    ctx.replaceCombat({ round: position.round, turn: position.turn, combatants, effects: expired.effects }),
    ...(position.newRound ? [ctx.appendChat({ kind: 'combat_event', ...ctx.entryBase(playerId), event: 'round', round: position.round })] : []),
  ];
}

export function setInitiative(ctx: SessionContext, tokenId: string, initiative: number): PatchOp[] {
  const combat = ctx.combat();
  const index = ctx.combatant(tokenId);
  const combatants = combat.combatants.map((c, i) => (i === index ? { ...c, initiative } : c));
  const order = ordered(ctx, combatants, combat.combatants[combat.turn]?.tokenId);
  return [ctx.replaceCombat({ ...combat, turn: order.turn, combatants: order.combatants })];
}

export function advanceTurn(ctx: SessionContext, playerId: string, role: Role): PatchOp[] {
  const combat = ctx.combat();
  if (role !== 'gm') {
    const current = combat.combatants[combat.turn];
    const token = current ? ctx.current.tokens[current.tokenId] : undefined;
    if (!token || !ctx.controls(playerId, token)) throw notAllowed('Só o mestre ou quem controla o combatente da vez passa o turno');
  }
  const position = nextTurn(combat, combat.combatants.length);
  // Termina o que vai até o fim do turno que acabou e até o início do turno que começa.
  const ended = combat.combatants[combat.turn]?.tokenId;
  const started = combat.combatants[position.turn]?.tokenId;
  const events: TurnExpiry[] = [
    ...(ended !== undefined ? [{ at: 'turn_end' as const, tokenId: ended, round: combat.round }] : []),
    ...(started !== undefined ? [{ at: 'turn_start' as const, tokenId: started, round: position.round }] : []),
  ];
  const expired = expire(ctx, combat, (until) => events.some((e) => expiresAt(until, e)), playerId);
  // Lembretes e cura com o estado depois das durações encerradas (nota 0043).
  const after = expired.ops.length > 0 ? applyPatch(ctx.current, expired.ops) : ctx.current;
  const endOps = ended !== undefined ? triggers(ctx, playerId, after, 'turn_end', ended) : [];
  return [
    ...(position.newRound ? [ctx.appendChat({ kind: 'combat_event', ...ctx.entryBase(playerId), event: 'round', round: position.round })] : []),
    ...expired.ops,
    ...endOps,
    ...(started !== undefined ? turnStart(ctx, playerId, endOps.length > 0 ? applyPatch(after, endOps) : after, started) : []),
    ctx.replaceCombat({ ...combat, round: position.round, turn: position.turn, effects: expired.effects }),
  ];
}

/**
 * Lembretes (`reminder`) e cura do início do turno (`turn_start_heal`) da
 * ficha do personagem ligado ao token, no momento `on`, avaliados em `state`
 * (nota 0043). A cura entra nos PV do personagem; tudo vai numa entrada
 * `turn_trigger`, só se houver algo a dizer. Um monstro só tem os
 * lembretes dos efeitos de magia.
 */
export function triggers(ctx: SessionContext, playerId: string, state: SessionState, on: TriggerMoment, tokenId: string): PatchOp[] {
  const token = state.tokens[tokenId];
  const character = token && token.characterId !== null ? state.characters[token.characterId] : undefined;
  if (!token) return [];
  if (!character) {
    // Monstro: só os lembretes dos efeitos de magia (nota 0062).
    const items = creatureReminders(token.spellEffects, on).map((r) => ({ source: r.source.slice(0, 100), text: r.text.slice(0, 500) }));
    if (items.length === 0) return [];
    return [ctx.appendChat({ kind: 'turn_trigger', ...ctx.entryBase(playerId), on, tokenId, name: token.name, items: items.slice(0, MAX_TURN_TRIGGER_ITEMS) })];
  }
  const sheet = ctx.deps.characterSheet(character);
  if (!sheet) return [];
  const max = sheet.hpMax.total;
  let current = character;
  const healOps: PatchOp[] = [];
  const items: Extract<ChatEntry, { kind: 'turn_trigger' }>['items'] = [];
  for (const trigger of sheet.triggers) {
    if (trigger.on !== on) continue;
    if (trigger.kind === 'reminder') {
      items.push({ source: trigger.source.name.slice(0, 100), text: trigger.text.slice(0, 500) });
      continue;
    }
    // Heroic Rally: Sangrando e com pelo menos 1 PV (com 0 PV, a criatura está morrendo).
    if (current.deathSaves.dead) continue;
    if (trigger.bloodiedOnly && (currentHitPoints(max, current.hp) < 1 || !isBloodied(max, current.hp))) continue;
    const healed = changeCharacterHp(ctx, playerId, current, sheet, { kind: 'healing', amount: trigger.amount });
    if (healed.result.hpChange <= 0) continue;
    current = healed.after;
    healOps.push(...healed.ops);
    items.push({ source: trigger.source.name.slice(0, 100), healed: healed.result.hpChange });
  }
  if (items.length === 0) return [];
  return [
    ctx.appendChat({ kind: 'turn_trigger', ...ctx.entryBase(playerId), on, tokenId, name: token.name, items: items.slice(0, MAX_TURN_TRIGGER_ITEMS) }),
    ...healOps,
  ];
}

/**
 * Início do turno do token: primeiro a Salvaguarda contra a Morte (se o
 * personagem ligado está morrendo), depois os lembretes e a cura do turno,
 * com o estado depois da rolagem.
 */
export function turnStart(ctx: SessionContext, playerId: string, state: SessionState, tokenId: string): PatchOp[] {
  const token = state.tokens[tokenId];
  const character = token && token.characterId !== null ? state.characters[token.characterId] : undefined;
  const sheet = character ? ctx.deps.characterSheet(character) : undefined;
  const dying = character !== undefined && sheet !== undefined && isDying(currentHitPoints(sheet.hpMax.total, character.hp), character.deathSaves);
  const save = dying ? rollDeathSave(ctx, playerId, state, character.id) : [];
  return [...save, ...triggers(ctx, playerId, save.length > 0 ? applyPatch(state, save) : state, 'turn_start', tokenId)];
}

/**
 * Termina as condições com duração e os efeitos temporários cujo `until`
 * passa no teste (ou que `alsoEffect` manda terminar), com o registro no
 * chat. Devolve os efeitos que continuam e as operações.
 */
export function expire(
  ctx: SessionContext,
  combat: Combat,
  isOver: (until: TurnExpiry) => boolean,
  playerId: string,
  alsoEffect: (effect: TimedEffect) => boolean = () => false,
): { effects: TimedEffect[]; ops: PatchOp[] } {
  const ops: PatchOp[] = [];
  const prune = (state: ConditionState, path: string, target: { characterId: string } | { tokenId: string }, name: string): void => {
    const over = state.active.filter((c) => c.until !== undefined && isOver(c.until));
    if (over.length === 0) return;
    ops.push({ op: 'replace', path, value: { ...state, active: state.active.filter((c) => !over.includes(c)) } });
    for (const c of over) {
      ops.push(ctx.appendChat({ kind: 'condition_changed', ...ctx.entryBase(playerId), target, targetName: name, change: { kind: 'removed', condition: c.condition }, notes: ['Fim da duração'] }));
    }
  };
  // Efeitos de magia por um turno (Shield; nota 0063).
  const pruneEffects = (list: SessionCharacter['adjustments'], path: string, who: { characterId: string } | { tokenId: string }, name: string): void => {
    const over = list.filter((a) => a.until !== undefined && isOver(a.until));
    if (over.length === 0) return;
    ops.push({ op: 'replace', path, value: list.filter((a) => !over.includes(a)) });
    for (const a of over) {
      ops.push(ctx.appendChat({ kind: 'spell_effect_ended', ...ctx.entryBase(playerId), ...who, characterName: name, effectName: a.name.slice(0, 100), reason: 'duration' }));
    }
  };
  for (const character of Object.values(ctx.current.characters)) {
    pruneEffects(character.adjustments, toPointer('characters', character.id, 'adjustments'), { characterId: character.id }, character.name);
    prune(character.conditions, toPointer('characters', character.id, 'conditions'), { characterId: character.id }, character.name);
  }
  for (const token of Object.values(ctx.current.tokens)) {
    pruneEffects(token.spellEffects, toPointer('tokens', token.id, 'spellEffects'), { tokenId: token.id }, token.name);
    if (token.characterId === null) prune(token.conditions, toPointer('tokens', token.id, 'conditions'), { tokenId: token.id }, token.name);
  }
  const effects: TimedEffect[] = [];
  for (const effect of combat.effects) {
    if (!isOver(effect.until) && !alsoEffect(effect)) {
      effects.push(effect);
      continue;
    }
    ops.push(ctx.appendChat(timedEffectEntry(ctx, playerId, 'ended', effect)));
  }
  return { effects, ops };
}

export function timedEffectEntry(ctx: SessionContext, playerId: string, event: 'started' | 'ended', effect: TimedEffect): ChatEntry {
  const target = ctx.current.tokens[effect.targetTokenId];
  return {
    kind: 'timed_effect',
    ...ctx.entryBase(playerId),
    event,
    effect: effect.kind,
    sourceName: ctx.current.tokens[effect.sourceTokenId]?.name ?? 'Token removido',
    targetTokenId: effect.targetTokenId,
    targetName: target?.name ?? 'Token removido',
  };
}
