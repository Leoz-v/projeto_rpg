import { applyDamage, availableUses, CONDITION_NAME, damageNotes, type DerivedSheet, featureEnded, isMonkWeapon, rollActionDamage, isPoolUse, UNARMED_INSTANCE_ID, poolConditions, type ResolvedFeaturePart, type SheetFeatureUse, type TurnExpiry, wearsHeavyArmor } from 'rules-engine';
import { type Combat, type IntentData, MAX_ADJUSTMENTS, type PatchOp, type TimedEffect, type Role, type SessionCharacter, type SessionState, type Token, toPointer } from '../../shared/protocol';
import { untilNextTurn } from './conditions';
import { type SessionContext, violation } from './context';
import { applyItemFailure, selfTarget } from './items';
import { creatureTypeOf, rollSaves, targetOf } from './attacks';
import { timedEffectEntry } from './combat';
import { changeResource } from './resources';
import { applyConditionPart, applyHealing, ConditionLedger, liftConditions } from './spell-effects';
import { endConcentration } from './vitality';

/** Usar características da ficha (notas 0078, 0082 e 0083). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;

const withoutChat = (ops: PatchOp[]): PatchOp[] => ops.filter((op) => !op.path.startsWith('/chat/'));

type SpellOf = { entryId: string; part: number };

interface Using {
  playerId: string;
  character: SessionCharacter;
  use: SheetFeatureUse;
  data: IntentData<'feature.use'>;
  /** O primeiro alvo (o único, fora de `many`). */
  target: Token;
  targets: Token[];
  /** Quem falhou na última salvaguarda (para o `fail_damage`). */
  failed: Token[];
  /** Efeitos temporários que começam no combate (o sucesso do Stunning Strike; nota 0083). */
  timed: TimedEffect[];
}

type UsedRider = NonNullable<Combat['usedRiders']>[number];

/** O turno em que o personagem age, se ele está no combate: para "uma vez por turno" e o "depois do Flurry". */
function turnOf(ctx: SessionContext, character: SessionCharacter): { combat: Combat; current: UsedRider[]; mark: UsedRider } | undefined {
  const { combat } = ctx.current;
  const turnTokenId = combat?.combatants[combat.turn]?.tokenId;
  if (!combat || turnTokenId === undefined || !combat.combatants.some((c) => ctx.current.tokens[c.tokenId]?.characterId === character.id)) return undefined;
  const current = (combat.usedRiders ?? []).filter((u) => u.round === combat.round && u.turnTokenId === turnTokenId);
  return { combat, current, mark: { characterId: character.id, riderId: '', round: combat.round, turnTokenId } };
}

/**
 * Confere o ataque de uma característica usada no acerto (nota 0083): um
 * `attack_roll` do personagem que acertou, com o ataque que vale, o dano
 * extra pedido, uma só por ataque (do grupo), uma vez por turno e depois do
 * uso exigido no turno. Devolve o alvo e as notas.
 */
function hitOf(ctx: SessionContext, character: SessionCharacter, sheet: DerivedSheet, use: SheetFeatureUse, data: IntentData<'feature.use'>, turn: ReturnType<typeof turnOf>): { target: Token; entryId: string; notes: string[] } {
  const onHit = use.onHit;
  if (!onHit) throw violation(`${use.name} não é usada num ataque`);
  if (data.targetTokenId !== undefined || data.targetTokenIds !== undefined) throw violation(`${use.name}: o alvo é o do ataque`);
  const entry = ctx.current.chat.find((e) => e.id === data.entryId);
  if (entry?.kind !== 'attack_roll' || entry.weapon?.characterId !== character.id) throw violation(`${use.name}: escolha um ataque de ${character.name}`);
  if (!entry.hit) throw violation(`${use.name}: só num ataque que acertou`);
  const { instanceId } = entry.weapon;
  const attack = sheet.attacks.find((a) => a.instanceId === instanceId);
  if (onHit.attacks !== 'any') {
    const unarmed = instanceId === UNARMED_INSTANCE_ID;
    const item = attack ? ctx.deps.item(attack.itemId) : undefined;
    const monk = unarmed || (item?.kind === 'weapon' && isMonkWeapon(item));
    if (onHit.attacks === 'unarmed' ? !unarmed : !monk) throw violation(`${use.name}: só com ${onHit.attacks === 'unarmed' ? 'Ataque Desarmado' : 'Ataque Desarmado ou arma de Monge'}`);
  }
  if (onHit.rider !== undefined) {
    const name = attack?.riders.find((r) => r.id === onHit.rider)?.name;
    if (name === undefined || !(entry.damage?.groups.some((g) => g.source === name) ?? false)) throw violation(`${use.name}: só no ataque com ${name ?? onHit.rider}`);
  }
  const groupOf = (featureId: string | undefined): string | undefined => {
    const other = sheet.featureUses.find((f) => f.id === featureId);
    return other?.onHit?.group ?? other?.id;
  };
  const mine = onHit.group ?? use.id;
  if (ctx.current.chat.some((e) => e.kind === 'feature_used' && e.attackOf === entry.id && groupOf(e.featureId) === mine)) throw violation(`${use.name}: já usada neste ataque`);
  const notes: string[] = [];
  if (onHit.oncePerTurn && turn?.current.some((u) => u.characterId === character.id && u.riderId === use.id)) throw violation(`${use.name}: uma vez por turno`);
  if (onHit.afterUse !== undefined) {
    const after = sheet.featureUses.find((f) => f.id === onHit.afterUse)?.name ?? onHit.afterUse;
    if (!turn) notes.push(`Fora do combate: confira se o ataque veio do ${after}`);
    else if (!turn.current.some((u) => u.characterId === character.id && u.riderId === onHit.afterUse)) throw violation(`${use.name}: só nos ataques do ${after} neste turno`);
  }
  return { target: ctx.token(entry.targetTokenId), entryId: entry.id, notes };
}

/** Até o fim (ou o início) do próximo turno de quem usou, com ele no combate. */
function untilUserTurn(ctx: SessionContext, character: SessionCharacter, until: 'user_turn_start' | 'user_turn_end' | undefined): { until?: TurnExpiry; note?: string } {
  if (until === undefined) return {};
  const token = ctx.current.combat?.combatants.map((c) => ctx.current.tokens[c.tokenId]).find((t) => t?.characterId === character.id);
  if (!token) return { note: 'Fora do combate: a duração por turno fica com a mesa' };
  return { until: untilNextTurn(ctx, until === 'user_turn_start' ? 'turn_start' : 'turn_end', token.id) };
}

/**
 * Usa uma característica: gasta o recurso e aplica as partes. Cura, condições
 * e efeitos entram direto; um estado (Rage) vira ajuste ligado à
 * característica, que o dono encerra.
 */
export function useFeature(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'feature.use'>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const use = sheet.featureUses.find((f) => f.id === data.featureId);
  if (!use) throw violation(`${character.name} não tem essa característica`);
  if (character.deathSaves.dead) throw violation(`${character.name} está morto`);
  if (use.forbidHeavyArmor && wearsHeavyArmor(character.inventory, (id) => ctx.deps.item(id))) throw violation(`${use.name}: não com armadura pesada`);
  if (use.targets === 'self' && data.targetTokenId !== undefined && !use.onHit) throw violation(`${use.name} só age em quem usa`);
  const turn = turnOf(ctx, character);
  if (!use.onHit && data.entryId !== undefined) throw violation(`${use.name} não é usada num ataque`);
  if (use.onHit && data.entryId === undefined) throw violation(`${use.name}: escolha o ataque que acertou`);
  const hit = use.onHit ? hitOf(ctx, character, sheet, use, data, turn) : undefined;
  let targets: Token[];
  if (hit) targets = [hit.target];
  else if (use.targets === 'many') {
    // Vários alvos, escolhidos no mapa (a área fica com quem usa; nota 0082).
    if (data.targetTokenId !== undefined) throw violation(`${use.name}: escolha os alvos na lista`);
    const ids = data.targetTokenIds ?? [];
    if (ids.length === 0) throw violation(`${use.name}: escolha os alvos`);
    if (new Set(ids).size !== ids.length) throw violation('Alvo repetido');
    if (use.maxTargets !== undefined && ids.length > use.maxTargets) throw violation(`${use.name}: no máximo ${use.maxTargets} alvo(s)`);
    targets = ids.map((id) => ctx.token(id));
  } else {
    if (data.targetTokenIds !== undefined) throw violation(`${use.name} tem um alvo só`);
    targets = [data.targetTokenId !== undefined ? ctx.token(data.targetTokenId) : selfTarget(ctx, character).token];
  }
  const [target] = targets;
  if (!target) throw violation(`${use.name}: escolha os alvos`);
  const choices = use.parts.flatMap((p) => (p.kind === 'save' && Array.isArray(p.damage?.type) ? p.damage.type : []));
  if (data.damageType !== undefined && !choices.includes(data.damageType)) throw violation(`${use.name} não deixa escolher esse tipo de dano`);
  if (choices.length > 0 && data.damageType === undefined) throw violation(`${use.name}: escolha o tipo de dano`);

  // O custo: fixo, ou o que se tirou da reserva.
  let amount = use.cost?.amount ?? 0;
  if (isPoolUse(use)) {
    const allowed = poolConditions(use);
    const picked = data.conditions ?? [];
    if (new Set(picked).size !== picked.length) throw violation('Condição repetida');
    const costs = picked.map((c) => allowed.find((a) => a.condition === c)?.cost);
    if (costs.some((c) => c === undefined)) throw violation(`${use.name} não termina essa condição`);
    amount = (data.amount ?? 0) + costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);
    if (amount < 1) throw violation(`${use.name}: escolha quanto gastar`);
  } else if (data.amount !== undefined || data.conditions !== undefined) throw violation(`${use.name} não gasta uma quantidade à escolha`);

  const ops: PatchOp[] = [];
  const notes: string[] = [...(hit?.notes ?? [])];
  if (use.cost && amount > 0) {
    ops.push(...withoutChat(changeResource(ctx, playerId, role, { kind: 'resource.spend', data: { characterId: character.id, resourceId: use.cost.resourceId, amount } })));
    const resource = sheet.resources.find((r) => r.id === use.cost?.resourceId);
    if (resource) notes.push(`${resource.name}: ${availableUses(resource.max, character.resourcesSpent, resource.id) - amount}/${resource.max}`);
  }
  const base = ctx.entryBase(playerId);
  const using: Using = { playerId, character, use, data, target, targets, failed: [], timed: [] };
  const partOps = use.parts.flatMap((part, i) => {
    const done = usePart(ctx, using, part, { entryId: base.id, part: i });
    notes.push(...done.notes);
    return done.ops;
  });
  return [
    ctx.appendChat({
      kind: 'feature_used',
      ...base,
      characterId: character.id,
      characterName: character.name,
      featureName: use.name,
      featureId: use.id,
      ...(hit ? { attackOf: hit.entryId } : {}),
      ...(use.action !== undefined ? { action: use.action } : {}),
      ...(use.duration !== undefined ? { duration: use.duration } : {}),
      notes: [...notes, ...(use.note !== undefined ? [use.note] : [])].slice(0, 50),
    }),
    ...ops,
    ...partOps,
    ...combatOps(ctx, playerId, using, turn),
  ];
}

/** No combate: o uso anotado no turno (uma vez por turno, o Flurry of Blows) e os efeitos temporários que começam. */
function combatOps(ctx: SessionContext, playerId: string, using: Using, turn: ReturnType<typeof turnOf>): PatchOp[] {
  const combat = ctx.current.combat;
  if (!combat || (!turn && using.timed.length === 0)) return [];
  return [
    ...using.timed.map((e) => ctx.appendChat(timedEffectEntry(ctx, playerId, 'started', e))),
    ctx.replaceCombat({
      ...combat,
      effects: [...combat.effects, ...using.timed],
      ...(turn ? { usedRiders: [...turn.current, { ...turn.mark, riderId: using.use.id }] } : {}),
    }),
  ];
}

function usePart(ctx: SessionContext, using: Using, part: ResolvedFeaturePart, spellOf: SpellOf): { ops: PatchOp[]; notes: string[] } {
  const { playerId, character, use, data, target } = using;
  const label = use.name.slice(0, 100);
  const common = { casterName: character.name, label, spellOf, targets: [target] };
  switch (part.kind) {
    case 'heal':
      return { ops: applyHealing(ctx, playerId, { ...common, healing: part.dice, minimum: part.minimum, temporary: part.temporary, endConditions: [] }), notes: [] };
    case 'pool_heal': {
      const amount = data.amount ?? 0;
      return { ops: amount > 0 ? applyHealing(ctx, playerId, { ...common, healing: String(amount), minimum: 0, temporary: false, endConditions: [] }) : [], notes: [] };
    }
    case 'pool_restore':
      return { ops: lift(ctx, using, part.conditions.filter((c) => data.conditions?.includes(c) === true), spellOf), notes: [] };
    case 'restore':
      return { ops: lift(ctx, using, part.conditions, spellOf), notes: [] };
    case 'condition': {
      // Só em alvos até o tamanho (o Caído do Eldritch Smite: Enorme ou menor).
      const max = part.maxSize;
      if (max !== undefined && SIZES.indexOf(target.size) > SIZES.indexOf(max)) return { ops: [], notes: [`${target.name}: grande demais para ${CONDITION_NAME[part.conditions[0] ?? 'prone']}`] };
      const timing = untilUserTurn(ctx, character, part.until);
      return { ops: applyConditionPart(ctx, playerId, { ...common, conditions: part.conditions, timing }), notes: timing.note !== undefined ? [timing.note] : [] };
    }
    case 'note':
      return { ops: [], notes: [part.text] };
    case 'regain': {
      const spent = character.resourcesSpent[part.resource] ?? 0;
      if (spent === 0) return { ops: [], notes: [] };
      const rest = Object.fromEntries(Object.entries(character.resourcesSpent).filter(([id]) => id !== part.resource && id !== use.cost?.resourceId));
      const own = use.cost ? { [use.cost.resourceId]: (character.resourcesSpent[use.cost.resourceId] ?? 0) + use.cost.amount } : {};
      return { ops: [{ op: 'replace', path: toPointer('characters', character.id, 'resourcesSpent'), value: { ...rest, ...own } }], notes: [`Recuperou ${spent} uso(s)`] };
    }
    case 'inspire':
      return inspire(ctx, using, part.dice);
    case 'save':
      return forceSave(ctx, using, part, spellOf);
    case 'fail_damage':
      return failDamage(ctx, using, part, spellOf);
    case 'buff':
      return startState(ctx, using, part);
  }
}

/**
 * Salvaguarda dos alvos (Breath Weapon, Turn Undead; nota 0082): a regra das
 * magias e dos itens (`rollSaves`), com o dano como proposta para o mestre e
 * as condições da falha direto, que podem acabar com dano. Alvos fora de
 * `onlyTypes` ficam de fora, com nota.
 */
function forceSave(ctx: SessionContext, using: Using, part: Extract<ResolvedFeaturePart, { kind: 'save' }>, spellOf: SpellOf): { ops: PatchOp[]; notes: string[] } {
  const { playerId, character, use, data } = using;
  const label = use.name.slice(0, 100);
  const notes: string[] = [];
  const only = part.onlyTypes;
  const rolling = only
    ? using.targets.filter((t) => {
        const type = creatureTypeOf(ctx, t);
        if (type !== undefined && only.includes(type)) return true;
        notes.push(`${t.name}: ${type === undefined ? 'tipo de criatura desconhecido' : 'não é do tipo que a característica afeta'}`);
        return false;
      })
    : using.targets;
  using.failed = [];
  if (rolling.length === 0) return { ops: [], notes };
  const type = Array.isArray(part.damage?.type) ? data.damageType : part.damage?.type;
  const damage = part.damage && type !== undefined ? [{ dice: part.damage.dice, type }] : [];
  const timing = untilUserTurn(ctx, character, part.until);
  if (timing.note !== undefined && part.conditions.length > 0) notes.push(timing.note);
  const item =
    part.conditions.length > 0 ? { label, conditions: part.conditions, ...(part.endsOnDamage ? { endsOnDamage: spellOf.entryId } : {}), ...(timing.until ? { until: timing.until } : {}) } : undefined;
  if (part.failNote !== undefined) notes.push(`Na falha: ${part.failNote}`);
  const except = part.damage?.exceptTypes;
  const [first] = part.conditions;
  const saves = rollSaves(ctx, playerId, {
    actorName: character.name,
    effect: { name: label, ability: part.ability, dc: part.dc, damage, onSuccess: part.onSuccess, conditions: part.conditions },
    against: first !== undefined ? { condition: first } : undefined,
    targets: rolling,
    visibility: 'public',
    spellOf,
    ...(item ? { pending: { item } } : {}),
    ...(except ? { skipDamage: (t: Token) => { const type = creatureTypeOf(ctx, t); return type !== undefined && except.includes(type); } } : {}),
  });
  using.failed = saves.failed;
  if (part.successEffect === 'stunning') notes.push(...stunning(ctx, using, saves.succeeded));
  const ops = [...saves.ops, ...(item && saves.failed.length > 0 ? applyItemFailure(ctx, playerId, item, saves.failed) : [])];
  return { ops, notes };
}

/**
 * O sucesso do Stunning Strike (nota 0083): Vantagem no próximo ataque contra
 * o alvo até o início do próximo turno de quem usou, como efeito do combate.
 */
function stunning(ctx: SessionContext, using: Using, succeeded: Token[]): string[] {
  if (succeeded.length === 0) return [];
  const combat = ctx.current.combat;
  const own = combat?.combatants.map((c) => ctx.current.tokens[c.tokenId]).find((t) => t?.characterId === using.character.id);
  if (!combat || !own) return ['Fora do combate: a Vantagem no próximo ataque contra o alvo fica com a mesa'];
  const until = untilNextTurn(ctx, 'turn_start', own.id);
  using.timed.push(...succeeded.map((t): TimedEffect => ({ id: ctx.deps.newId(), kind: 'stunning', sourceTokenId: own.id, targetTokenId: t.id, until })));
  return [];
}

/** Dano a mais em quem falhou (Sear Undead): rolado uma vez, com as defesas de cada um, como proposta. */
function failDamage(ctx: SessionContext, using: Using, part: Extract<ResolvedFeaturePart, { kind: 'fail_damage' }>, spellOf: SpellOf): { ops: PatchOp[]; notes: string[] } {
  const { playerId, character, use, failed } = using;
  if (failed.length === 0 || part.dice === '0') return { ops: [], notes: [] };
  const groups = rollActionDamage([{ dice: part.dice, type: part.type }], false, ctx.deps.rng);
  const amount = groups.reduce((sum, g) => sum + g.total, 0);
  const entryId = ctx.deps.newId();
  const ops: PatchOp[] = [];
  const results = failed.map((target) => {
    const applied = applyDamage(targetOf(ctx, target).defenses, [{ amount, type: part.type }], ctx.deps.rng);
    const proposalId = applied.total > 0 ? ctx.deps.newId() : undefined;
    if (proposalId !== undefined) ops.push({ op: 'add', path: toPointer('proposals', proposalId), value: { id: proposalId, entryId, targetTokenId: target.id, targetName: target.name, amount: applied.total } });
    return { targetTokenId: target.id, targetName: target.name, groups, total: applied.total, defenses: damageNotes(applied), ...(proposalId !== undefined ? { proposalId } : {}) };
  });
  return {
    ops: [ctx.appendChat({ kind: 'spell_damage', id: entryId, at: ctx.deps.now(), authorId: playerId, spellOf, casterName: character.name, label: use.name.slice(0, 100), visibility: 'public', results }), ...ops],
    notes: [],
  };
}

/** Bardic Inspiration: o dado fica com outro personagem, um de cada vez (nota 0079). */
function inspire(ctx: SessionContext, using: Using, dice: string): { ops: PatchOp[]; notes: string[] } {
  const { character, use, target } = using;
  const holder = target.characterId !== null ? ctx.current.characters[target.characterId] : undefined;
  if (!holder) throw violation(`${use.name}: escolha o token de outro personagem`);
  if (holder.id === character.id) throw violation(`${use.name}: inspira outra criatura, não quem usa`);
  if (holder.deathSaves.dead) throw violation(`${holder.name} está morto`);
  if (holder.inspiration) throw violation(`${holder.name} já tem um dado de ${holder.inspiration.name}`);
  return {
    ops: [{ op: 'replace', path: toPointer('characters', holder.id, 'inspiration'), value: { dice, name: use.name.slice(0, 100), giverId: character.id, giverName: character.name } }],
    notes: [`${holder.name} recebe um dado de ${use.name} (${dice})`],
  };
}

function lift(ctx: SessionContext, using: Using, conditions: Extract<ResolvedFeaturePart, { kind: 'restore' }>['conditions'], spellOf: SpellOf): PatchOp[] {
  if (conditions.length === 0) return [];
  const { playerId, character, use, target } = using;
  const lifted = liftConditions(ctx, playerId, new ConditionLedger(ctx), target, conditions, use.name);
  if (lifted.ops.length === 0) return [];
  return [
    ctx.appendChat({ kind: 'spell_applied', ...ctx.entryBase(playerId), spellOf, casterName: character.name, label: use.name.slice(0, 100), results: [{ targetTokenId: target.id, targetName: target.name, notes: lifted.notes }] }),
    ...lifted.ops,
  ];
}

/** O estado (Rage, Innate Sorcery) entra na ficha de quem usou; usar de novo renova. */
function startState(ctx: SessionContext, using: Using, part: Extract<ResolvedFeaturePart, { kind: 'buff' }>): { ops: PatchOp[]; notes: string[] } {
  const { playerId, character, use, data } = using;
  if (part.weapon) {
    const attack = ctx.deps.characterSheet(character)?.attacks.find((a) => a.instanceId === data.weaponId);
    if (attack?.kind !== 'melee') throw violation(`${use.name}: escolha uma arma corpo a corpo empunhada`);
  } else if (data.weaponId !== undefined) throw violation(`${use.name} não age numa arma`);
  const kept = character.adjustments.filter((a) => a.feature?.id !== use.id);
  if (kept.length >= MAX_ADJUSTMENTS) throw violation(`No máximo ${MAX_ADJUSTMENTS} ajustes por personagem`);
  const timing = untilUserTurn(ctx, character, part.until);
  const endsOn = part.endsOn ?? [];
  if (featureEnded(endsOn, { conditions: character.conditions.active.map((c) => c.condition), heavyArmor: false, dead: false })) throw violation(`${use.name}: ${character.name} não pode agora (condições)`);
  const adjustment: SessionCharacter['adjustments'][number] = {
    id: ctx.deps.newId(),
    name: use.name.slice(0, 100),
    effects: part.effects,
    feature: { id: use.id, endsOn, ...(part.noSpells ? { noSpells: true } : {}) },
    ...(data.weaponId !== undefined ? { weapon: data.weaponId } : {}),
    ...(timing.until ? { until: timing.until } : {}),
  };
  return {
    ops: [
      { op: 'replace', path: toPointer('characters', character.id, 'adjustments'), value: [...kept, adjustment] },
      ...(part.noSpells ? endConcentration(ctx, playerId, character, 'ended', [use.name]) : []),
    ],
    notes: timing.note !== undefined ? [timing.note] : [],
  };
}

/** Os estados que acabaram com a mudança: condição que os encerra, armadura pesada ou morte. */
export function endedFeatures(ctx: SessionContext, playerId: string, state: SessionState): PatchOp[] {
  return Object.values(state.characters).flatMap((character) => {
    if (!character.adjustments.some((a) => a.feature && a.feature.endsOn.length > 0)) return [];
    const situation = {
      conditions: character.conditions.active.map((c) => c.condition),
      heavyArmor: wearsHeavyArmor(character.inventory, (id) => ctx.deps.item(id)),
      dead: character.deathSaves.dead,
    };
    const over = character.adjustments.filter((a) => a.feature && a.feature.endsOn.length > 0 && featureEnded(a.feature.endsOn, situation));
    if (over.length === 0) return [];
    return [
      { op: 'replace' as const, path: toPointer('characters', character.id, 'adjustments'), value: character.adjustments.filter((a) => !over.includes(a)) },
      ...over.map((a) => ctx.appendChat({ kind: 'spell_effect_ended', ...ctx.entryBase(playerId), characterId: character.id, characterName: character.name, effectName: a.name, reason: 'broken' })),
    ];
  });
}
