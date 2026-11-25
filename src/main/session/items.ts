import { applyDamage, damageNotes, isConsumed, type Item, itemSaveApplies, itemSaveDc, type ItemUse, itemUse, itemUseDamages, type ItemUsePart, rollActionDamage, usedItemName } from 'rules-engine';
import { type ChatEntry, type IntentData, type PatchOp, type Role, type SessionCharacter, type Token, toPointer } from '../../shared/protocol';
import { rollSaves, targetOf } from './attacks';
import { inventoryEntry } from './characters';
import { type SessionContext, violation } from './context';
import { applyBuff, applyConditionPart, applyHealing, ConditionLedger, imposeConditions, liftConditions } from './spell-effects';

/**
 * Usar um item consumível (nota 0074). Funções do executor da sessão
 * (`HostSession`), sobre o `SessionContext`. A cura e os efeitos entram
 * direto; o dano vira proposta para o mestre; a unidade usada sai do inventário.
 */

type SpellOf = { entryId: string; part: number };

interface Using {
  playerId: string;
  character: SessionCharacter;
  itemId: string;
  /** Nome exibido (o da variante). */
  name: string;
  entryId: string;
  targets: Token[];
  option: number | undefined;
}

/**
 * Quem usa como alvo: um token dele (o do mapa na tela primeiro) ou, sem
 * token, um alvo só com o personagem, para beber uma poção fora do mapa.
 */
function selfTarget(ctx: SessionContext, character: SessionCharacter): { token: Token; onMap: boolean } {
  const own = Object.values(ctx.current.tokens).filter((t) => t.characterId === character.id);
  const token = own.find((t) => t.mapId === ctx.current.activeMapId) ?? own[0];
  if (token) return { token, onMap: true };
  return {
    onMap: false,
    token: {
      id: character.id,
      mapId: character.id,
      name: character.name,
      position: { x: 0, y: 0 },
      size: 'medium',
      monsterId: null,
      image: null,
      ownerIds: [],
      characterId: character.id,
      hp: null,
      conditions: { active: [], exhaustion: 0 },
      spellEffects: [],
      concentration: null,
      uses: { spent: {}, lair: false },
      visionFeet: null,
      rotation: 0,
      elevation: 0,
      hidden: false,
      dead: false,
    },
  };
}

/** Os alvos distintos: dois tokens do mesmo personagem são um alvo só. */
function distinctTargets(tokens: Token[]): Token[] {
  const seen = new Set<string>();
  return tokens.filter((t) => {
    const key = t.characterId ?? t.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function useItem(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'item.use'>): PatchOp[] {
  const character = ctx.ownCharacter(playerId, role, data.characterId);
  const { entry, index } = inventoryEntry(ctx, character, data.instanceId);
  const item: Item | undefined = ctx.deps.item(entry.itemId);
  const use: ItemUse | undefined = item ? itemUse(item, entry.variantId) : undefined;
  if (!item || !use) throw violation('Este item não tem um uso que a mesa resolva');

  const self = data.self ? selfTarget(ctx, character) : undefined;
  const targets = distinctTargets([...(self ? [self.token] : []), ...data.targetTokenIds.map((id) => ctx.token(id))]);
  if (targets.length === 0) throw violation('Escolha pelo menos um alvo');
  if (use.targets === 'one' && targets.length > 1) throw violation(`${item.name}: um alvo só`);
  if (self && !self.onMap && itemUseDamages(use)) throw violation('Este item causa dano: ponha um token do personagem no mapa');

  const options = use.parts.flatMap((p) => (p.kind === 'buff' ? p.options : []));
  if (options.length === 0 && data.option !== undefined) throw violation('Este item não tem opções');
  if (options.length > 0 && (data.option === undefined || !options[data.option])) throw violation('Escolha uma das opções do item');

  const base = ctx.entryBase(playerId);
  const name = usedItemName(item, entry.variantId);
  const using: Using = { playerId, character, itemId: item.id, name, entryId: base.id, targets, option: data.option };
  const consumed = isConsumed(item);
  const left = consumed ? entry.quantity - 1 : entry.quantity;
  const path = toPointer('characters', character.id, 'inventory', 'items', String(index));
  const used: ChatEntry = {
    kind: 'item_used',
    ...base,
    characterId: character.id,
    characterName: character.name,
    itemName: name.slice(0, 100),
    left,
    ...(use.duration !== undefined ? { duration: use.duration } : {}),
    description: (item.description ?? name).slice(0, 6000),
  };
  const spend: PatchOp[] = !consumed ? [] : [left > 0 ? { op: 'replace', path: `${path}/quantity`, value: left } : { op: 'remove', path }];
  return [ctx.appendChat(used), ...spend, ...use.parts.flatMap((part, i) => resolvePart(ctx, using, part, { entryId: base.id, part: i }))];
}

function resolvePart(ctx: SessionContext, using: Using, part: ItemUsePart, spellOf: SpellOf): PatchOp[] {
  const { playerId, targets } = using;
  const common = { casterName: using.character.name, label: using.name.slice(0, 100), spellOf, targets };
  switch (part.kind) {
    case 'heal':
      return applyHealing(ctx, playerId, { ...common, healing: part.dice, temporary: part.temporary === true, endConditions: [] });
    case 'restore':
      return restore(ctx, using, part, spellOf);
    case 'condition':
      return applyConditionPart(ctx, playerId, { ...common, conditions: part.conditions, timing: {} });
    case 'buff': {
      const option = using.option !== undefined ? part.options[using.option] : undefined;
      const label = option ? `${using.name}: ${option.label}` : using.name;
      return applyBuff(ctx, playerId, {
        ...common,
        name: label,
        effects: [...part.effects, ...(option?.effects ?? [])],
        endConditions: [],
        // O id do item no lugar do da magia: o mesmo item não se acumula, e o dono do personagem tira o efeito.
        link: { characterId: using.character.id, spellId: using.itemId },
        timing: {},
      });
    }
    case 'damage':
      return directDamage(ctx, using, part, spellOf);
    case 'save':
      return forcedSave(ctx, using, part, spellOf);
  }
}

/** Condições que terminam e a Exaustão que sai (Potion of Vitality). */
function restore(ctx: SessionContext, using: Using, part: Extract<ItemUsePart, { kind: 'restore' }>, spellOf: SpellOf): PatchOp[] {
  const ledger = new ConditionLedger(ctx);
  const ops: PatchOp[] = [];
  const results = using.targets.map((target) => {
    const lifted = liftConditions(ctx, using.playerId, ledger, target, part.conditions, using.name);
    ops.push(...lifted.ops);
    const notes = [...lifted.notes];
    const holder = part.exhaustion ? ledger.holder(target) : undefined;
    if (holder && holder.state.exhaustion > 0) {
      const from = holder.state.exhaustion;
      const state = { ...holder.state, exhaustion: 0 };
      ledger.set(holder.path, state);
      ops.push(
        { op: 'replace', path: holder.path, value: state },
        ctx.appendChat({ kind: 'condition_changed', ...ctx.entryBase(using.playerId), target: holder.logTarget, targetName: holder.name, change: { kind: 'exhaustion', from, to: 0 }, notes: [using.name.slice(0, 200)] }),
      );
      notes.push('Sem Exaustão');
    }
    return { targetTokenId: target.id, targetName: target.name, notes: notes.slice(0, 50) };
  });
  return [ctx.appendChat({ kind: 'spell_applied', ...ctx.entryBase(using.playerId), spellOf, casterName: using.character.name, label: using.name.slice(0, 100), results }), ...ops];
}

/** Dano sem salvaguarda (Potion of Poison), com as defesas de cada alvo, como proposta. */
function directDamage(ctx: SessionContext, using: Using, part: Extract<ItemUsePart, { kind: 'damage' }>, spellOf: SpellOf): PatchOp[] {
  const base = ctx.entryBase(using.playerId);
  const proposals: PatchOp[] = [];
  const results = using.targets.map((target) => {
    const defender = targetOf(ctx, target);
    const groups = rollActionDamage(part.damage, false, ctx.deps.rng);
    const applied = applyDamage(defender.defenses, groups.map((g) => ({ amount: g.total, type: g.type })), ctx.deps.rng);
    const proposalId = applied.total > 0 ? ctx.deps.newId() : undefined;
    if (proposalId !== undefined) {
      proposals.push({ op: 'add', path: toPointer('proposals', proposalId), value: { id: proposalId, entryId: base.id, targetTokenId: target.id, targetName: target.name, amount: applied.total } });
    }
    return {
      targetTokenId: target.id,
      targetName: target.name,
      groups,
      total: applied.total,
      defenses: [...damageNotes(applied), ...defender.reminders].slice(0, 50),
      ...(proposalId !== undefined ? { proposalId } : {}),
    };
  });
  return [ctx.appendChat({ kind: 'spell_damage', ...base, spellOf, casterName: using.character.name, label: using.name.slice(0, 100), visibility: 'public', results }), ...proposals];
}

/** Salvaguarda dos alvos: o tipo da criatura pode dispensar a rolagem (Holy Water, Dust of Sneezing and Choking). */
function forcedSave(ctx: SessionContext, using: Using, part: Extract<ItemUsePart, { kind: 'save' }>, spellOf: SpellOf): PatchOp[] {
  const { playerId, character } = using;
  let dc: number;
  if (typeof part.dc === 'number') dc = part.dc;
  else {
    const sheet = ctx.deps.characterSheet(character);
    if (!sheet) throw violation('O personagem ainda não tem ficha (defina os atributos)');
    dc = itemSaveDc(part.dc, { proficiencyBonus: sheet.proficiencyBonus, modifier: (a) => sheet.abilities[a].modifier });
  }
  const rolling: Token[] = [];
  const skipped: { targetTokenId: string; targetName: string; notes: string[] }[] = [];
  for (const target of using.targets) {
    const type = target.characterId !== null ? (ctx.current.characters[target.characterId] ? 'humanoid' : undefined) : ctx.creatureOf(target)?.creature.type;
    const applies = itemSaveApplies(part, type);
    if (applies === 'roll') rolling.push(target);
    else skipped.push({ targetTokenId: target.id, targetName: target.name, notes: [applies === 'unaffected' ? 'Não é afetado (tipo de criatura)' : 'Sucesso automático (tipo de criatura)'] });
  }
  const label = using.name.slice(0, 100);
  const ops: PatchOp[] = skipped.length > 0 ? [ctx.appendChat({ kind: 'spell_applied', ...ctx.entryBase(playerId), spellOf, casterName: character.name, label, results: skipped })] : [];
  if (rolling.length === 0) return ops;
  const [condition] = part.onFailConditions;
  const saves = rollSaves(ctx, playerId, {
    actorName: character.name,
    effect: { name: label, ability: part.ability, dc, damage: part.damage, onSuccess: part.onSuccess, conditions: part.onFailConditions },
    against: condition ? { condition } : undefined,
    targets: rolling,
    visibility: 'public',
    spellOf,
    ...(part.onFailConditions.length > 0 ? { pending: { item: { label, conditions: part.onFailConditions } } } : {}),
  });
  ops.push(...saves.ops);
  if (saves.failed.length > 0) ops.push(...applyItemFailure(ctx, playerId, { label, conditions: part.onFailConditions }, saves.failed));
  return ops;
}

/** As condições da falha contra um item, também quando o mestre aceita a falha que esperava a Resistência Lendária. */
export function applyItemFailure(ctx: SessionContext, playerId: string, item: { label: string; conditions: Extract<ItemUsePart, { kind: 'save' }>['onFailConditions'] }, failed: Token[]): PatchOp[] {
  const ledger = new ConditionLedger(ctx);
  return failed.flatMap((target) => imposeConditions(ctx, playerId, ledger, target, item.conditions, {}, item.label).ops);
}
