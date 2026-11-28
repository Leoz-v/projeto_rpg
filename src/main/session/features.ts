import { availableUses, featureEnded, isPoolUse, poolConditions, type ResolvedFeaturePart, type SheetFeatureUse, type TurnExpiry, wearsHeavyArmor } from 'rules-engine';
import { type IntentData, MAX_ADJUSTMENTS, type PatchOp, type Role, type SessionCharacter, type SessionState, type Token, toPointer } from '../../shared/protocol';
import { untilNextTurn } from './conditions';
import { type SessionContext, violation } from './context';
import { selfTarget } from './items';
import { changeResource } from './resources';
import { applyConditionPart, applyHealing, ConditionLedger, liftConditions } from './spell-effects';
import { endConcentration } from './vitality';

/** Usar características da ficha (nota 0078). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

const withoutChat = (ops: PatchOp[]): PatchOp[] => ops.filter((op) => !op.path.startsWith('/chat/'));

type SpellOf = { entryId: string; part: number };

interface Using {
  playerId: string;
  character: SessionCharacter;
  use: SheetFeatureUse;
  data: IntentData<'feature.use'>;
  target: Token;
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
  if (use.targets === 'self' && data.targetTokenId !== undefined) throw violation(`${use.name} só age em quem usa`);
  const target = data.targetTokenId !== undefined ? ctx.token(data.targetTokenId) : selfTarget(ctx, character).token;

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
  const notes: string[] = [];
  if (use.cost && amount > 0) {
    ops.push(...withoutChat(changeResource(ctx, playerId, role, { kind: 'resource.spend', data: { characterId: character.id, resourceId: use.cost.resourceId, amount } })));
    const resource = sheet.resources.find((r) => r.id === use.cost?.resourceId);
    if (resource) notes.push(`${resource.name}: ${availableUses(resource.max, character.resourcesSpent, resource.id) - amount}/${resource.max}`);
  }
  const base = ctx.entryBase(playerId);
  const using: Using = { playerId, character, use, data, target };
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
      ...(use.action !== undefined ? { action: use.action } : {}),
      ...(use.duration !== undefined ? { duration: use.duration } : {}),
      notes: [...notes, ...(use.note !== undefined ? [use.note] : [])].slice(0, 50),
    }),
    ...ops,
    ...partOps,
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
      const timing = untilUserTurn(ctx, character, part.until);
      return { ops: applyConditionPart(ctx, playerId, { ...common, conditions: part.conditions, timing }), notes: [] };
    }
    case 'regain': {
      const spent = character.resourcesSpent[part.resource] ?? 0;
      if (spent === 0) return { ops: [], notes: [] };
      const rest = Object.fromEntries(Object.entries(character.resourcesSpent).filter(([id]) => id !== part.resource && id !== use.cost?.resourceId));
      const own = use.cost ? { [use.cost.resourceId]: (character.resourcesSpent[use.cost.resourceId] ?? 0) + use.cost.amount } : {};
      return { ops: [{ op: 'replace', path: toPointer('characters', character.id, 'resourcesSpent'), value: { ...rest, ...own } }], notes: [`Recuperou ${spent} uso(s)`] };
    }
    case 'buff':
      return startState(ctx, using, part);
  }
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
