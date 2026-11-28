import { addInspirationDie, availableUses, inspirationUseless, type D20RollResult, type DerivedSheet, type InspirationRoll, inspirationRollOf, rollDice, type SheetSelfInspiration, type SourceLabel } from 'rules-engine';
import { type IntentData, type PatchOp, type PendingAttack, type PendingInspiration, type Role, type SessionCharacter, type Token, toPointer } from '../../shared/protocol';
import { makeAttack, targetOf } from './attacks';
import { notAllowed, type SessionContext, violation } from './context';
import { settleSave } from './legendary';
import { changeResource } from './resources';
import { applyDeathSave, endConcentration } from './vitality';

/**
 * Dados de inspiração (nota 0079): Bardic Inspiration guardado por quem
 * recebeu e o uso próprio (Peerless Skill), somados depois de ver a rolagem.
 * Funções do executor da sessão (`HostSession`), sobre o `SessionContext`.
 */

const withoutChat = (ops: PatchOp[]): PatchOp[] => ops.filter((op) => !op.path.startsWith('/chat/'));

const inspirationSource = (name: string): SourceLabel => ({ kind: 'rule', id: 'inspiration', name });

/** O dado guardado sai do personagem. */
export const clearInspiration = (character: SessionCharacter): PatchOp => ({ op: 'replace', path: toPointer('characters', character.id, 'inspiration'), value: null });

/** O uso próprio que vale nesta rolagem, com usos à mão. */
function selfUse(sheet: DerivedSheet, character: SessionCharacter, selfId: string, kind: InspirationRoll): SheetSelfInspiration {
  const self = sheet.selfInspirations.find((s) => s.id === selfId);
  if (!self) throw violation(`${character.name} não tem essa característica`);
  if (!self.rolls.includes(kind)) throw violation(`${self.name} não vale nesta rolagem`);
  const resource = sheet.resources.find((r) => r.id === self.resourceId);
  if (!resource || availableUses(resource.max, character.resourcesSpent, resource.id) < 1) throw violation(`${self.name}: sem usos de ${resource?.name ?? self.resourceId}`);
  return self;
}

/** Pode somar um dado nesta rolagem: o guardado, ou um uso próprio com usos. */
export function canInspire(character: SessionCharacter, sheet: DerivedSheet, kind: InspirationRoll): boolean {
  if (character.inspiration) return true;
  return sheet.selfInspirations.some((s) => {
    const resource = sheet.resources.find((r) => r.id === s.resourceId);
    return s.rolls.includes(kind) && resource !== undefined && availableUses(resource.max, character.resourcesSpent, resource.id) > 0;
  });
}

/** Soma o dado a uma rolagem da ficha (`d20_roll`): o total novo vai no chat; quem julga o resultado é a mesa. */
export function useInspiration(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'inspiration.use'>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const entry = ctx.current.chat.find((e) => e.id === data.entryId);
  if (entry?.kind !== 'd20_roll' || entry.characterId !== character.id) throw violation('Rolagem da ficha não encontrada no chat');
  if (ctx.current.chat.some((e) => e.kind === 'inspiration_roll' && e.entryOf === entry.id)) throw violation('Esta rolagem já recebeu um dado de inspiração');
  const kind = inspirationRollOf(entry.target);
  if (kind === 'attack' && entry.fumble) throw violation('O 1 natural sempre erra o ataque');
  if (kind === 'attack' && entry.critical) throw violation('O ataque já é um Acerto Crítico');

  const ops: PatchOp[] = [];
  const notes: string[] = [];
  let dice: string;
  let featureName: string;
  let giverName: string | undefined;
  if (data.selfId !== undefined) {
    const self = selfUse(sheet, character, data.selfId, kind);
    dice = self.dice;
    featureName = self.name;
    ops.push(...withoutChat(changeResource(ctx, playerId, role, { kind: 'resource.spend', data: { characterId: character.id, resourceId: self.resourceId } })));
    if (self.keepOnFailure) notes.push(`Se ainda falhar, o uso de ${self.name} não é gasto: devolva pela ficha`);
  } else {
    const held = character.inspiration;
    if (!held) throw violation(`${character.name} não tem dado de inspiração`);
    dice = held.dice;
    featureName = held.name;
    giverName = held.giverName;
    ops.push(clearInspiration(character));
  }
  const rolled = rollDice(dice, ctx.deps.rng);
  return [
    ctx.appendChat({
      kind: 'inspiration_roll',
      ...ctx.entryBase(playerId),
      entryOf: entry.id,
      characterId: character.id,
      characterName: character.name,
      featureName: featureName.slice(0, 100),
      ...(giverName !== undefined ? { giverName } : {}),
      visibility: entry.visibility,
      dice,
      value: rolled.total,
      total: entry.total + rolled.total,
      notes,
    }),
    ...ops,
  ];
}

/** Descarta o dado guardado (o dono ou o mestre). */
export function discardInspiration(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'inspiration.discard'>): PatchOp[] {
  const character = ctx.ownCharacter(playerId, role, data.characterId);
  const held = character.inspiration;
  if (!held) throw violation(`${character.name} não tem dado de inspiração`);
  return [
    clearInspiration(character),
    ctx.appendChat({ kind: 'spell_effect_ended', ...ctx.entryBase(playerId), characterId: character.id, characterName: character.name, effectName: held.name.slice(0, 100), reason: 'removed' }),
  ];
}

/** Os dados guardados expiram no fim de um descanso (a hora do texto passou; decisão do usuário, nota 0079). */
export function expireInspirations(ctx: SessionContext): { ops: PatchOp[]; notes: string[] } {
  const holders = Object.values(ctx.current.characters).filter((c) => c.inspiration !== null);
  return {
    ops: holders.map(clearInspiration),
    notes: holders.map((c) => `${c.name}: o dado de ${c.inspiration?.name ?? 'inspiração'} expirou`),
  };
}

const addPendingAttack = (pending: PendingAttack): PatchOp => ({ op: 'add', path: toPointer('pendingAttacks', pending.id), value: pending });

/** O ataque errou e quem atacou tem um dado à mão: o resultado espera a decisão. */
export function pendingAttack(ctx: SessionContext, pending: Omit<PendingAttack, 'id'>): PatchOp {
  return addPendingAttack({ id: ctx.deps.newId(), ...pending });
}

/**
 * Decide o ataque que esperava: com o dado, o Host o rola e soma ao d20;
 * depois o ataque segue (acerto, dano, maestria) como se fosse agora. Peerless
 * Skill que continua errando não gasta o uso.
 */
export function resolvePendingAttack(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'attack.resolve'>): PatchOp[] {
  const pending = ctx.current.pendingAttacks[data.pendingId];
  if (!pending) throw violation('Ataque não encontrado (já decidido)');
  const character = ctx.current.characters[pending.characterId];
  if (!character) throw violation('Personagem não encontrado');
  if (role !== 'gm' && character.ownerId !== playerId && pending.authorId !== playerId) throw notAllowed('Só quem atacou (ou o mestre) decide');
  const ops: PatchOp[] = [{ op: 'remove', path: toPointer('pendingAttacks', pending.id) }];
  let roll: D20RollResult = { dice: pending.roll.dice, natural: pending.roll.natural, die: pending.roll.die, total: pending.roll.total, critical: false, fumble: false, steps: [] };
  const notes = [...pending.roll.notes];
  if (data.inspiration) {
    const sheet = ctx.deps.characterSheet(character);
    if (!sheet) throw violation('O personagem ainda não tem ficha');
    const { selfId } = data.inspiration;
    if (selfId !== undefined) {
      const self = selfUse(sheet, character, selfId, 'attack');
      roll = addInspirationDie(roll, self.dice, inspirationSource(self.name), ctx.deps.rng);
      const hit = roll.total >= targetOf(ctx, ctx.token(pending.targetTokenId)).ac;
      if (hit || !self.keepOnFailure) ops.push(...withoutChat(changeResource(ctx, playerId, 'gm', { kind: 'resource.spend', data: { characterId: character.id, resourceId: self.resourceId } })));
      else notes.push(`${self.name}: ainda errou, o uso não foi gasto`);
    } else {
      const held = character.inspiration;
      if (!held) throw violation(`${character.name} não tem dado de inspiração`);
      roll = addInspirationDie(roll, held.dice, inspirationSource(`${held.name} (${held.giverName})`), ctx.deps.rng);
      ops.push(clearInspiration(character));
    }
  }
  const attack = makeAttack(
    ctx,
    pending.authorId,
    pending.role,
    {
      attacker: { characterId: pending.characterId, instanceId: pending.instanceId },
      targetTokenId: pending.targetTokenId,
      visibility: 'public',
      ...(pending.advantage !== undefined ? { advantage: pending.advantage } : {}),
      ...(pending.disadvantage !== undefined ? { disadvantage: pending.disadvantage } : {}),
      ...(pending.riders ? { riders: pending.riders } : {}),
    },
    pending.cleaveOf,
    { roll, notes },
  );
  return [...attack, ...ops];
}

/** O token ou o personagem saiu: os ataques e as salvaguardas dele (ou contra ele) não têm mais o que decidir. */
export function dropInspirationWaits(ctx: SessionContext, gone: { tokenId?: string; characterId?: string }): PatchOp[] {
  const attacks = Object.values(ctx.current.pendingAttacks)
    .filter((p) => p.targetTokenId === gone.tokenId || p.characterId === gone.characterId)
    .map((p): PatchOp => ({ op: 'remove', path: toPointer('pendingAttacks', p.id) }));
  const saves = Object.values(ctx.current.pendingInspirations)
    .filter((p) => p.characterId === gone.characterId || (p.wait.kind === 'save' && p.wait.save.targetTokenId === gone.tokenId))
    .map((p): PatchOp => ({ op: 'remove', path: toPointer('pendingInspirations', p.id) }));
  return [...attacks, ...saves];
}

/** O personagem do token que pode somar um dado nesta salvaguarda que falhou (nota 0080). */
export function inspirableHolder(ctx: SessionContext, token: Token, roll: D20RollResult): SessionCharacter | undefined {
  const character = token.characterId !== null ? ctx.current.characters[token.characterId] : undefined;
  const sheet = character ? ctx.deps.characterSheet(character) : undefined;
  if (!character || !sheet || !canInspire(character, sheet, 'save') || inspirationUseless(roll, 'save') !== undefined) return undefined;
  return character;
}

/** A salvaguarda falhou e o personagem tem um dado à mão: as consequências esperam. */
export function pendingInspiration(ctx: SessionContext, pending: Omit<PendingInspiration, 'id'>): PatchOp {
  const id = ctx.deps.newId();
  return { op: 'add', path: toPointer('pendingInspirations', id), value: { id, ...pending } };
}

/**
 * Decide a salvaguarda que esperava (nota 0080): com o dado, o Host o rola e
 * soma; contra a CD, vale o sucesso ou a falha. A salvaguarda forçada aplica as
 * consequências como a Resistência Lendária; a de Concentração mantém ou
 * encerra; a contra a Morte entra só agora, no `death_save`.
 */
export function resolveInspirationSave(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'inspiration.save'>): PatchOp[] {
  const pending = ctx.current.pendingInspirations[data.pendingId];
  if (!pending) throw violation('Salvaguarda não encontrada (já decidida)');
  const character = ctx.ownCharacter(playerId, role, pending.characterId);
  const sheet = ctx.deps.characterSheet(character);
  if (!sheet) throw violation('O personagem ainda não tem ficha');
  const ops: PatchOp[] = [{ op: 'remove', path: toPointer('pendingInspirations', pending.id) }];
  const notes = [...pending.roll.notes];
  let total = pending.roll.total;
  let success = false;
  if (data.inspiration) {
    let dice: string;
    let name: string;
    let giverName: string | undefined;
    const { selfId } = data.inspiration;
    if (selfId !== undefined) {
      const self = selfUse(sheet, character, selfId, 'save');
      dice = self.dice;
      name = self.name;
      ops.push(...withoutChat(changeResource(ctx, playerId, role, { kind: 'resource.spend', data: { characterId: character.id, resourceId: self.resourceId } })));
    } else {
      const held = character.inspiration;
      if (!held) throw violation(`${character.name} não tem dado de inspiração`);
      dice = held.dice;
      name = held.name;
      giverName = held.giverName;
      ops.push(clearInspiration(character));
    }
    const rolled = rollDice(dice, ctx.deps.rng);
    total += rolled.total;
    success = total >= pending.dc;
    notes.push(`${name}${giverName !== undefined ? ` (${giverName})` : ''}: +${rolled.total} (${dice})`);
    if (pending.wait.kind !== 'death') {
      ops.push(
        ctx.appendChat({
          kind: 'inspiration_roll',
          ...ctx.entryBase(playerId),
          entryOf: pending.wait.kind === 'save' ? pending.wait.save.entryId : pending.wait.entryId,
          characterId: character.id,
          characterName: character.name,
          featureName: name.slice(0, 100),
          ...(giverName !== undefined ? { giverName } : {}),
          visibility: 'public',
          dice,
          value: rolled.total,
          total,
          success,
          notes: [`${pending.label}: CD ${pending.dc}, ${success ? 'passou' : 'ainda falhou'}`.slice(0, 200)],
        }),
      );
    }
  }
  const { wait } = pending;
  switch (wait.kind) {
    case 'save':
      return [...ops, ...settleSave(ctx, playerId, wait.save, success)];
    case 'concentration':
      // A magia pode ter trocado enquanto a falha esperava.
      return [...ops, ...(!success && character.concentration?.spellId === wait.spellId ? endConcentration(ctx, playerId, character, 'failed_save') : [])];
    case 'death': {
      const { mode, dice, natural, modifier } = pending.roll;
      return [...ops, ...applyDeathSave(ctx, playerId, character, sheet, { mode, dice, natural, modifier, total, natural1: false, natural20: false }, notes)];
    }
  }
}
