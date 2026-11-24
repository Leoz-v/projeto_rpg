import { availableHitDice, currentHitPoints, exhaustionAfterLongRest, hitDieHealing, MIN_HP_TO_REST, resourcesAfterRest, spellSlotsAfterRest } from 'rules-engine';
import { type IntentData, type PatchOp, type Role, type SessionCharacter, toPointer } from '../../shared/protocol';
import { type SessionContext, violation } from './context';
import { changeCharacterHp } from './vitality';

/** Descansos e Dados de Vida (nota 0050). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/** Começa um descanso para os personagens: fora do combate e com pelo menos 1 PV cada um. */
export function startRest(ctx: SessionContext, playerId: string, data: IntentData<'rest.start'>): PatchOp[] {
  if (ctx.current.combat) throw violation('Não dá para descansar durante o combate');
  if (ctx.current.rest) throw violation('Já há um descanso em andamento');
  const characters = data.characterIds.map((id) => {
    const character = ctx.current.characters[id];
    if (!character) throw violation('Personagem não encontrado');
    const max = ctx.deps.characterSheet(character)?.hpMax.total;
    if (max === undefined) throw violation(`${character.name} ainda não tem ficha`);
    if (character.deathSaves.dead || currentHitPoints(max, character.hp) < MIN_HP_TO_REST) throw violation(`${character.name} precisa de pelo menos 1 PV para descansar`);
    return character;
  });
  return [
    { op: 'replace', path: '/rest', value: { kind: data.kind, characterIds: data.characterIds } },
    ctx.appendChat({ kind: 'rest', ...ctx.entryBase(playerId), event: 'started', rest: data.kind, characters: characters.map((c) => ({ characterId: c.id, name: c.name })), notes: [] }),
  ];
}

/**
 * Termina o descanso e aplica os benefícios a quem continua nele. Longo: PV
 * cheios, todos os Dados de Vida de volta e Exaustão −1 (SRD 5.2.1, "Long Rest").
 */
export function finishRest(ctx: SessionContext, playerId: string): PatchOp[] {
  const rest = ctx.current.rest;
  if (!rest) throw violation('Não há descanso em andamento');
  const ops: PatchOp[] = [];
  const notes: string[] = [];
  const characters = rest.characterIds.flatMap((id) => {
    const character = ctx.current.characters[id];
    return character ? [character] : [];
  });
  for (const character of characters) {
    const result = rest.kind === 'long' ? longRest(ctx, playerId, character) : { ops: [], recovered: [] };
    // Espaços de magia: o longo devolve todos; o curto, os da Magia de Pacto (nota 0051).
    const slots = spellSlotsAfterRest(character.spellSlotsSpent, rest.kind);
    const slotsBack = spentSlots(character.spellSlotsSpent) - spentSlots(slots);
    if (slotsBack > 0) {
      result.ops.push({ op: 'replace', path: toPointer('characters', character.id, 'spellSlotsSpent'), value: slots });
      result.recovered.push(`${slotsBack} espaço(s) de magia`);
    }
    // Recursos da ficha: o longo devolve todos; o curto, conforme a recarga de cada um (nota 0052).
    const resources = ctx.deps.characterSheet(character)?.resources ?? [];
    const after = resourcesAfterRest(resources, character.resourcesSpent, rest.kind);
    const back = resources.flatMap((r) => {
      const returned = (character.resourcesSpent[r.id] ?? 0) - (after[r.id] ?? 0);
      return returned > 0 ? [`${r.name} +${returned}`] : [];
    });
    if (JSON.stringify(after) !== JSON.stringify(character.resourcesSpent)) {
      result.ops.push({ op: 'replace', path: toPointer('characters', character.id, 'resourcesSpent'), value: after });
    }
    result.recovered.push(...back);
    ops.push(...result.ops);
    if (rest.kind === 'long' || result.recovered.length > 0) notes.push(`${character.name}: ${result.recovered.length > 0 ? result.recovered.join(', ') : 'nada a recuperar'}`);
  }
  return [
    { op: 'replace', path: '/rest', value: null },
    ...ops,
    ctx.appendChat({ kind: 'rest', ...ctx.entryBase(playerId), event: 'finished', rest: rest.kind, characters: characters.map((c) => ({ characterId: c.id, name: c.name })), notes: notes.slice(0, 50) }),
  ];
}

/** Quantos espaços de magia estão gastos, de todos os tipos. */
function spentSlots(spent: SessionCharacter['spellSlotsSpent']): number {
  return Object.values(spent.byLevel).reduce((sum: number, n) => sum + n, 0) + spent.pact;
}

function longRest(ctx: SessionContext, playerId: string, character: SessionCharacter): { ops: PatchOp[]; recovered: string[] } {
  const ops: PatchOp[] = [];
  const recovered: string[] = [];
  const sheet = ctx.deps.characterSheet(character);
  if (sheet && character.hp.damage > 0 && !character.deathSaves.dead) {
    const healed = changeCharacterHp(ctx, playerId, character, sheet, { kind: 'healing', amount: character.hp.damage });
    ops.push(...healed.ops);
    recovered.push(`PV cheios (+${healed.result.hpChange})`);
  }
  const spent = Object.values(character.hitDiceSpent).reduce((sum, n) => sum + n, 0);
  if (spent > 0) {
    ops.push({ op: 'replace', path: toPointer('characters', character.id, 'hitDiceSpent'), value: {} });
    recovered.push(`${spent} Dado(s) de Vida`);
  }
  const { exhaustion } = character.conditions;
  if (exhaustion > 0) {
    const level = exhaustionAfterLongRest(exhaustion);
    ops.push({ op: 'replace', path: toPointer('characters', character.id, 'conditions', 'exhaustion'), value: level });
    recovered.push(`Exaustão ${exhaustion} → ${level}`);
  }
  return { ops, recovered };
}

/** Interrompe o descanso de todos, sem benefícios. */
export function cancelRest(ctx: SessionContext, playerId: string, note: string): PatchOp[] {
  const rest = ctx.current.rest;
  if (!rest) return [];
  const characters = rest.characterIds.flatMap((id) => {
    const character = ctx.current.characters[id];
    return character ? [{ characterId: character.id, name: character.name }] : [];
  });
  return [
    { op: 'replace', path: '/rest', value: null },
    ctx.appendChat({ kind: 'rest', ...ctx.entryBase(playerId), event: 'interrupted', rest: rest.kind, characters, notes: [note] }),
  ];
}

/** Gasta um Dado de Vida no descanso curto: o Host rola o dado e soma CON (mínimo 1). */
export function spendHitDie(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'hit_dice.spend'>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const rest = ctx.current.rest;
  if (rest?.kind !== 'short' || !rest.characterIds.includes(character.id)) throw violation('Dados de Vida só se gastam num descanso curto');
  const pool = availableHitDice(sheet.hitDice, character.hitDiceSpent).find((h) => h.die === data.die);
  if (!pool || pool.available === 0) throw violation(`${character.name} não tem d${data.die} de Vida disponível`);
  const roll = ctx.deps.rng.roll(data.die);
  const conModifier = sheet.abilities.con.modifier;
  const healed = changeCharacterHp(ctx, playerId, character, sheet, { kind: 'healing', amount: hitDieHealing(roll, conModifier) });
  const key = String(data.die) as keyof SessionCharacter['hitDiceSpent'];
  return [
    { op: 'replace', path: toPointer('characters', character.id, 'hitDiceSpent'), value: { ...character.hitDiceSpent, [key]: (character.hitDiceSpent[key] ?? 0) + 1 } },
    ctx.appendChat({ kind: 'hit_die', ...ctx.entryBase(playerId), characterId: character.id, characterName: character.name, die: data.die, roll, conModifier, healed: healed.result.hpChange }),
    ...healed.ops,
  ];
}
