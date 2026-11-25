import { applyHitPointChange, CONDITION_NAME, type Condition, type Effect, hasUnsupportedCreatureEffect, type ImposedConditions, sizeAtMost, rollDice, type TurnExpiry, withoutDependents } from 'rules-engine';
import { type ChatEntry, type ConditionState, type IntentData, MAX_ADJUSTMENT_EFFECTS, MAX_ADJUSTMENTS, type PatchOp, type Role, type SessionCharacter, type TableCondition, type Token, toPointer } from '../../shared/protocol';
import { notAllowed, type SessionContext, violation } from './context';
import { untilNextTurn } from './conditions';
import { changeCharacterHp, concentrationBreaks } from './vitality';

/**
 * Cura e condições das magias estruturadas (nota 0058). O Host aplica direto:
 * a cura nos PV (decisão do usuário, nota 0054) e as condições da falha, do
 * acerto ou sem salvaguarda. O mestre corrige pelos PV e pelas condições.
 */

/** Magia de origem de uma condição: com Concentração, cai quando ela acaba. */
export interface SpellLink {
  characterId: string;
  spellId: string;
}

/** Onde estão as condições de um token: no personagem ligado ou no próprio token. */
interface Holder {
  path: string;
  name: string;
  state: ConditionState;
  immune: ReadonlySet<string>;
  character?: SessionCharacter | undefined;
  logTarget: { characterId: string } | { tokenId: string };
}

/**
 * Condições dos alvos ao longo de uma mesma ação: dois raios no mesmo token,
 * ou a cura que tirou Inconsciente antes de a magia terminar outras
 * condições, partem do estado já mudado, não do estado da sessão.
 */
export class ConditionLedger {
  private readonly states = new Map<string, ConditionState>();

  constructor(private readonly ctx: SessionContext) {}

  holder(token: Token): Holder | undefined {
    const { ctx } = this;
    if (token.characterId !== null) {
      const character = ctx.current.characters[token.characterId];
      if (!character) return undefined;
      const sheet = ctx.deps.characterSheet(character);
      const path = toPointer('characters', character.id, 'conditions');
      return {
        path,
        name: character.name,
        state: this.states.get(path) ?? character.conditions,
        immune: new Set(sheet ? sheet.defenses.conditionImmunities.map((c) => c.condition) : []),
        character,
        logTarget: { characterId: character.id },
      };
    }
    const path = toPointer('tokens', token.id, 'conditions');
    // Do bloco, e as que vêm das condições (Petrificado é imune a Envenenado), como no `condition.add`.
    const defenses = ctx.creatureOf(token)?.defenses;
    return {
      path,
      name: token.name,
      state: this.states.get(path) ?? token.conditions,
      immune: new Set(defenses ? defenses.conditionImmunities.map((c) => c.condition) : []),
      logTarget: { tokenId: token.id },
    };
  }

  set(path: string, state: ConditionState): void {
    this.states.set(path, state);
  }
}

/** Até quando a condição dura: até a magia acabar (ligada a ela) ou até o próximo turno de quem conjurou (com combate). */
export function conditionTiming(
  ctx: SessionContext,
  end: 'spell' | 'caster_turn_start' | 'caster_turn_end' | undefined,
  link: SpellLink,
): { spell?: SpellLink; until?: TurnExpiry; note?: string } {
  if (end === 'spell') return { spell: link };
  if (end === undefined) return {};
  const combat = ctx.current.combat;
  const casterToken = combat?.combatants.map((c) => ctx.current.tokens[c.tokenId]).find((t) => t?.characterId === link.characterId);
  if (!casterToken) return { note: 'Sem combate com quem conjurou: a duração por turno fica com o mestre' };
  return { until: untilNextTurn(ctx, end === 'caster_turn_start' ? 'turn_start' : 'turn_end', casterToken.id) };
}

/**
 * Põe as condições num alvo. Pula as que ele já tem e as de que é imune (com
 * nota). Num personagem, Incapacitado (ou o que o inclui) encerra a
 * Concentração dele.
 */
export function imposeConditions(
  ctx: SessionContext,
  playerId: string,
  ledger: ConditionLedger,
  target: Token,
  conditions: readonly Condition[],
  timing: { spell?: SpellLink; until?: TurnExpiry; note?: string; with?: TableCondition },
  source: string,
): { ops: PatchOp[]; notes: string[] } {
  const holder = ledger.holder(target);
  if (!holder) return { ops: [], notes: ['Personagem do token não encontrado'] };
  const notes: string[] = [];
  const added: TableCondition[] = [];
  let state = holder.state;
  for (const condition of conditions) {
    if (condition === 'exhaustion') continue;
    if (holder.immune.has(condition)) {
      notes.push(`Imune a ${CONDITION_NAME[condition]}`);
      continue;
    }
    if (state.active.some((c) => c.condition === condition)) {
      notes.push(`Já estava ${CONDITION_NAME[condition]}`);
      continue;
    }
    state = { ...state, active: [...state.active, { condition, ...(timing.until ? { until: timing.until } : {}), ...(timing.spell ? { spell: timing.spell } : {}), ...(timing.with ? { with: timing.with } : {}) }] };
    added.push(condition);
    notes.push(CONDITION_NAME[condition]);
  }
  if (added.length === 0) return { ops: [], notes };
  if (timing.note) notes.push(timing.note);
  ledger.set(holder.path, state);
  const ops: PatchOp[] = [
    { op: 'replace', path: holder.path, value: state },
    ...added.map((condition) =>
      ctx.appendChat({ kind: 'condition_changed', ...ctx.entryBase(playerId), target: holder.logTarget, targetName: holder.name, change: { kind: 'added', condition }, notes: [source] }),
    ),
  ];
  if (holder.character) ops.push(...concentrationBreaks(ctx, playerId, holder.character, state, holder.character.deathSaves));
  return { ops, notes };
}

/** Até quando dura a condição de uma ação de monstro: os turnos dele ou do alvo, com os dois no combate. */
function imposedUntil(ctx: SessionContext, end: ImposedConditions['end'], actor: Token, target: Token): { until?: TurnExpiry; note?: string } {
  if (end === undefined) return {};
  const token = end.startsWith('actor') ? actor : target;
  if (!ctx.current.combat?.combatants.some((c) => c.tokenId === token.id)) return { note: `Sem ${token.name} no combate: a duração por turno fica com o mestre` };
  return { until: untilNextTurn(ctx, end.endsWith('start') ? 'turn_start' : 'turn_end', token.id) };
}

/**
 * As condições que uma ação de monstro impõe (nota 0065): entram direto no
 * alvo do tamanho certo, com a duração; `while` fica ligada à principal.
 */
export function imposeFromAction(ctx: SessionContext, playerId: string, imposes: readonly ImposedConditions[], actor: Token, target: Token, source: string): { ops: PatchOp[]; notes: string[] } {
  const ledger = new ConditionLedger(ctx);
  const ops: PatchOp[] = [];
  const notes: string[] = [];
  for (const imposed of imposes) {
    if (imposed.maxSize && !sizeAtMost(target.size, imposed.maxSize)) {
      notes.push('Grande demais para a condição');
      continue;
    }
    const before = ledger.holder(target)?.state.active ?? [];
    const done = imposeConditions(ctx, playerId, ledger, target, imposed.conditions, imposedUntil(ctx, imposed.end, actor, target), source);
    ops.push(...done.ops);
    notes.push(...done.notes);
    const [anchor] = imposed.conditions;
    const active = ledger.holder(target)?.state.active ?? [];
    // Só com a principal posta agora: se ela já vinha de outra fonte, não se sabe qual acaba primeiro.
    if (!anchor || !active.some((c) => c.condition === anchor) || before.some((c) => c.condition === anchor)) continue;
    if (imposed.while) {
      const tied = imposeConditions(ctx, playerId, ledger, target, imposed.while, { with: anchor }, source);
      ops.push(...tied.ops);
      notes.push(...tied.notes);
    }
    if (imposed.escapeDc !== undefined) notes.push(`Escapar: CD ${imposed.escapeDc}`);
    if (imposed.repeatSave) notes.push('Repete a salvaguarda no fim de cada turno');
  }
  return { ops, notes };
}

/** Tira condições de um alvo (Heal termina Cego, Surdo e Envenenado). */
export function liftConditions(ctx: SessionContext, playerId: string, ledger: ConditionLedger, target: Token, conditions: readonly Condition[], source: string): { ops: PatchOp[]; notes: string[] } {
  const holder = ledger.holder(target);
  if (!holder) return { ops: [], notes: [] };
  const removed = holder.state.active.filter((c) => conditions.includes(c.condition)).map((c) => c.condition);
  if (removed.length === 0) return { ops: [], notes: [] };
  const state = { ...holder.state, active: withoutDependents(holder.state.active.filter((c) => !removed.includes(c.condition))) };
  ledger.set(holder.path, state);
  return {
    ops: [
      { op: 'replace', path: holder.path, value: state },
      ...removed.map((condition) =>
        ctx.appendChat({ kind: 'condition_changed', ...ctx.entryBase(playerId), target: holder.logTarget, targetName: holder.name, change: { kind: 'removed', condition }, notes: [source] }),
      ),
    ],
    notes: removed.map((c) => `Sem ${CONDITION_NAME[c]}`),
  };
}

/**
 * Cura (ou PV temporários) direto nos alvos, rolada uma vez para todos
 * (`full`: todos os PV de cada um), e as condições que a magia termina.
 */
export function applyHealing(
  ctx: SessionContext,
  playerId: string,
  options: {
    casterName: string;
    label: string;
    spellOf: { entryId: string; part: number };
    healing: string;
    temporary: boolean;
    endConditions: readonly Condition[];
    targets: Token[];
  },
): PatchOp[] {
  const { label, targets } = options;
  const full = options.healing === 'full';
  const roll = full ? undefined : rollDice(options.healing, ctx.deps.rng);
  const rolled = roll ? Math.max(0, roll.total) : 0;
  const ledger = new ConditionLedger(ctx);
  const ops: PatchOp[] = [];
  const results: Extract<ChatEntry, { kind: 'spell_applied' }>['results'] = [];
  for (const target of targets) {
    const notes: string[] = [];
    if (target.characterId !== null) {
      const character = ctx.current.characters[target.characterId];
      const sheet = character ? ctx.deps.characterSheet(character) : undefined;
      if (!character || !sheet) notes.push('O personagem ainda não tem ficha');
      else if (character.deathSaves.dead) notes.push('Morto: o mestre o revive antes de curar');
      else {
        const amount = full ? sheet.hpMax.total : rolled;
        const changed = changeCharacterHp(ctx, playerId, character, sheet, { kind: options.temporary ? 'temp' : 'healing', amount });
        ops.push(...changed.ops);
        ledger.set(toPointer('characters', character.id, 'conditions'), changed.after.conditions);
        notes.push(options.temporary ? `${amount} PV temporários` : `+${changed.result.hpChange} PV`);
      }
    } else if (!target.hp) {
      notes.push('Sem PV definidos: o mestre aplica');
    } else {
      const amount = full ? target.hp.max : rolled;
      const result = applyHitPointChange(target.hp.max, target.hp, { kind: options.temporary ? 'temp' : 'healing', amount });
      ops.push({ op: 'replace', path: toPointer('tokens', target.id, 'hp'), value: { max: target.hp.max, ...result.state } });
      notes.push(options.temporary ? `${amount} PV temporários` : `+${result.hpChange} PV`);
    }
    if (options.endConditions.length > 0) {
      const lifted = liftConditions(ctx, playerId, ledger, target, options.endConditions, label);
      ops.push(...lifted.ops);
      notes.push(...lifted.notes);
    }
    results.push({ targetTokenId: target.id, targetName: target.name, notes: notes.slice(0, 50) });
  }
  const entry: ChatEntry = {
    kind: 'spell_applied',
    ...ctx.entryBase(playerId),
    spellOf: options.spellOf,
    casterName: options.casterName,
    label,
    healing: {
      ...(roll ? { dice: options.healing } : {}),
      rolls: roll ? roll.rolls.map((r) => ({ sides: r.sides, value: r.value })) : [],
      total: rolled,
      full,
      temporary: options.temporary,
    },
    results,
  };
  return [ctx.appendChat(entry), ...ops];
}

/** Condição sem salvaguarda (Invisibility) em cada alvo. */
export function applyConditionPart(
  ctx: SessionContext,
  playerId: string,
  options: {
    casterName: string;
    label: string;
    spellOf: { entryId: string; part: number };
    conditions: readonly Condition[];
    timing: ReturnType<typeof conditionTiming>;
    targets: Token[];
  },
): PatchOp[] {
  const ledger = new ConditionLedger(ctx);
  const ops: PatchOp[] = [];
  const results = options.targets.map((target) => {
    const imposed = imposeConditions(ctx, playerId, ledger, target, options.conditions, options.timing, options.label);
    ops.push(...imposed.ops);
    return { targetTokenId: target.id, targetName: target.name, notes: imposed.notes.slice(0, 50) };
  });
  return [ctx.appendChat({ kind: 'spell_applied', ...ctx.entryBase(playerId), spellOf: options.spellOf, casterName: options.casterName, label: options.label, results }), ...ops];
}

/**
 * Põe os efeitos da magia em cada alvo: na ficha do personagem, como ajuste
 * ligado à magia (nota 0060), ou no token do monstro (nota 0062). A mesma
 * magia não se acumula (SRD 5.2.1, "Combining Magical Effects"): um efeito
 * dela, de quem quer que tenha conjurado, é substituído.
 */
export function putSpellEffects(
  ctx: SessionContext,
  options: { name: string; effects: readonly Effect[]; link: SpellLink; targets: Token[]; weapon?: string | undefined; until?: TurnExpiry | undefined; playerId: string },
): { ops: PatchOp[]; notes: Map<string, string[]> } {
  const ops: PatchOp[] = [];
  const notes = new Map<string, string[]>();
  const effects = options.effects.slice(0, MAX_ADJUSTMENT_EFFECTS);
  // Uma marca (Hex) ou arma (Magic Weapon) por conjurador: a nova tira a anterior dos outros alvos (nota 0063).
  if (options.weapon !== undefined || effects.some((e) => e.type === 'target_damage' && e.within === undefined)) {
    ops.push(...liftFromOthers(ctx, options.playerId, options.link, options.targets));
  }
  for (const target of options.targets) {
    const own: string[] = [];
    notes.set(target.id, own);
    if (effects.length === 0) continue;
    const character = target.characterId !== null ? ctx.current.characters[target.characterId] : undefined;
    if (target.characterId !== null && !character) {
      own.push('Personagem do token não encontrado');
      continue;
    }
    const current = character ? character.adjustments : target.spellEffects;
    const kept = current.filter((a) => a.spell?.spellId !== options.link.spellId);
    if (kept.length >= MAX_ADJUSTMENTS) {
      own.push(`No máximo ${MAX_ADJUSTMENTS} ajustes por ${character ? 'personagem' : 'token'}`);
      continue;
    }
    const path = character ? toPointer('characters', character.id, 'adjustments') : toPointer('tokens', target.id, 'spellEffects');
    ops.push({ op: 'replace', path, value: [...kept, { id: ctx.deps.newId(), name: options.name.slice(0, 100), effects, spell: options.link, ...(options.weapon !== undefined ? { weapon: options.weapon } : {}), ...(options.until ? { until: options.until } : {}) }] });
    own.push(kept.length < current.length ? 'Efeito renovado (a mesma magia não se acumula)' : character ? 'Efeito na ficha' : 'Efeito no token');
    if (!character && hasUnsupportedCreatureEffect(effects)) own.push('Parte do efeito não entra no bloco do monstro: o mestre acompanha');
  }
  return { ops, notes };
}

/** Tira o efeito da magia de quem não está entre os alvos novos. */
function liftFromOthers(ctx: SessionContext, playerId: string, link: SpellLink, targets: Token[]): PatchOp[] {
  const ops: PatchOp[] = [];
  const tokens = new Set(targets.map((t) => t.id));
  const characters = new Set(targets.map((t) => t.characterId));
  const lift = (path: string, list: SessionCharacter['adjustments'], who: { characterId: string } | { tokenId: string }, name: string): void => {
    const gone = list.filter((a) => a.spell?.characterId === link.characterId && a.spell.spellId === link.spellId);
    const [first] = gone;
    if (!first) return;
    ops.push({ op: 'replace', path, value: list.filter((a) => !gone.includes(a)) });
    ops.push(ctx.appendChat({ kind: 'spell_effect_ended', ...ctx.entryBase(playerId), ...who, characterName: name, effectName: first.name.slice(0, 100), reason: 'replaced' }));
  };
  for (const c of Object.values(ctx.current.characters)) {
    if (!characters.has(c.id)) lift(toPointer('characters', c.id, 'adjustments'), c.adjustments, { characterId: c.id }, c.name);
  }
  for (const t of Object.values(ctx.current.tokens)) {
    if (!tokens.has(t.id)) lift(toPointer('tokens', t.id, 'spellEffects'), t.spellEffects, { tokenId: t.id }, t.name);
  }
  return ops;
}

/** Bônus ou penalidade de magia sem salvaguarda, com as condições que ela termina. */
export function applyBuff(
  ctx: SessionContext,
  playerId: string,
  options: {
    casterName: string;
    label: string;
    spellOf: { entryId: string; part: number };
    name: string;
    effects: readonly Effect[];
    endConditions: readonly Condition[];
    link: SpellLink;
    targets: Token[];
    weapon?: string | undefined;
    timing: { until?: TurnExpiry; note?: string };
  },
): PatchOp[] {
  const ledger = new ConditionLedger(ctx);
  const { ops, notes: putNotes } = putSpellEffects(ctx, { ...options, until: options.timing.until, playerId });
  const results = options.targets.map((target) => {
    const notes = [...(putNotes.get(target.id) ?? []), ...(options.timing.note !== undefined ? [options.timing.note] : [])];
    if (options.endConditions.length > 0) {
      const lifted = liftConditions(ctx, playerId, ledger, target, options.endConditions, options.label);
      ops.push(...lifted.ops);
      notes.push(...lifted.notes);
    }
    return { targetTokenId: target.id, targetName: target.name, notes: notes.slice(0, 50) };
  });
  return [ctx.appendChat({ kind: 'spell_applied', ...ctx.entryBase(playerId), spellOf: options.spellOf, casterName: options.casterName, label: options.label, results }), ...ops];
}

/** Encerra um efeito de magia num token: o mestre, ou quem controla o token (salvaguarda repetida do Slow). */
export function removeTokenEffect(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'token.effect_remove'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  if (role !== 'gm' && !ctx.controls(playerId, token)) throw notAllowed('Você não controla este token');
  const effect = token.spellEffects.find((e) => e.id === data.effectId);
  if (!effect) throw violation('Efeito não encontrado');
  return [
    { op: 'replace', path: toPointer('tokens', token.id, 'spellEffects'), value: token.spellEffects.filter((e) => e.id !== effect.id) },
    ctx.appendChat({ kind: 'spell_effect_ended', ...ctx.entryBase(playerId), tokenId: token.id, characterName: token.name, effectName: effect.name.slice(0, 100), reason: 'removed' }),
  ];
}

/**
 * As condições que uma magia pôs (`spell` igual ao do personagem e da magia)
 * saem de todos os personagens e tokens: a Concentração acabou (nota 0058).
 * `own`: as condições atuais de quem conjurou, quando a mesma ação acabou de
 * mudá-las (caiu Inconsciente).
 */
export function liftSpellConditions(ctx: SessionContext, playerId: string, link: SpellLink, spellName: string, own?: ConditionState): PatchOp[] {
  const ops: PatchOp[] = [];
  const matches = (c: ConditionState['active'][number]): boolean => c.spell?.characterId === link.characterId && c.spell.spellId === link.spellId;
  const lift = (path: string, state: ConditionState, name: string, logTarget: { characterId: string } | { tokenId: string }): void => {
    const removed = state.active.filter(matches);
    if (removed.length === 0) return;
    ops.push({ op: 'replace', path, value: { ...state, active: withoutDependents(state.active.filter((c) => !matches(c))) } });
    for (const { condition } of removed) {
      ops.push(
        ctx.appendChat({ kind: 'condition_changed', ...ctx.entryBase(playerId), target: logTarget, targetName: name, change: { kind: 'removed', condition }, notes: [`Fim de ${spellName}`.slice(0, 200)] }),
      );
    }
  };
  for (const character of Object.values(ctx.current.characters)) {
    const state = character.id === link.characterId && own ? own : character.conditions;
    lift(toPointer('characters', character.id, 'conditions'), state, character.name, { characterId: character.id });
    // Os bônus e penalidades da magia (nota 0060) saem da ficha.
    const linked = character.adjustments.filter((a) => a.spell?.characterId === link.characterId && a.spell.spellId === link.spellId);
    if (linked.length > 0) {
      ops.push({ op: 'replace', path: toPointer('characters', character.id, 'adjustments'), value: character.adjustments.filter((a) => !linked.includes(a)) });
      ops.push(
        ctx.appendChat({
          kind: 'spell_effect_ended',
          ...ctx.entryBase(playerId),
          characterId: character.id,
          characterName: character.name,
          effectName: (linked[0]?.name ?? spellName).slice(0, 100),
          reason: 'concentration',
        }),
      );
    }
  }
  for (const token of Object.values(ctx.current.tokens)) {
    if (token.characterId === null) lift(toPointer('tokens', token.id, 'conditions'), token.conditions, token.name, { tokenId: token.id });
    const linked = token.spellEffects.filter((e) => e.spell?.characterId === link.characterId && e.spell.spellId === link.spellId);
    if (linked.length > 0) {
      ops.push({ op: 'replace', path: toPointer('tokens', token.id, 'spellEffects'), value: token.spellEffects.filter((e) => !linked.includes(e)) });
      ops.push(
        ctx.appendChat({ kind: 'spell_effect_ended', ...ctx.entryBase(playerId), tokenId: token.id, characterName: token.name, effectName: (linked[0]?.name ?? spellName).slice(0, 100), reason: 'concentration' }),
      );
    }
  }
  return ops;
}
