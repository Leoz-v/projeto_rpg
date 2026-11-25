import { currentHitPoints, isDying, previousTurn } from 'rules-engine';
import { applyPatch, chatBefore, type ChatEntry, chatWindow, type Intent, type PatchOp, type Role, type SessionState, toPointer } from '../../shared/protocol';
import { opsFor, viewOf } from './visibility';
import { type Identity, type IntentOutcome, Rejection, SessionContext, type SessionDeps, type StateChange, notAllowed, violation } from './context';
import { applyProposal, forceSave, makeAttack, proposalOf, rollDamage, rollFromSheet, useMastery } from './attacks';
import { addAdjustment, addItem, createCharacter, removeCharacter, removeItem, rollScores, updateCharacter, updateItem } from './characters';
import { advanceTurn, expire, joinCombat, leaveCombat, setInitiative, startCombat } from './combat';
import { changeConditions } from './conditions';
import { cancelRest, finishRest, spendHitDie, startRest } from './rest';
import { changeSpellSlot } from './spell-slots';
import { changeResource } from './resources';
import { castSpell, useSpellEffect } from './casting';
import { clearFogMemory, configureFog, fillManualFog, paintManualFog, rectManualFog, setTokenVision } from './fog';
import { createMap, createToken, moveToken, roll, updateMap } from './map-tokens';
import { changeHp, concentrate, concentrationBreaks, deathStateEntry, endConcentration, inCombat, rollDeathSave } from './vitality';

export type { Identity, IntentOutcome, IntentResultPayload, SessionDeps, StateChange } from './context';

/**
 * Executor da sessão do Host: recebe `Intent` de quem já passou pelo
 * handshake, confere permissões e regras, aplica a mudança e devolve o patch.
 * Não faz I/O: a rede (PR 3) e o IPC (PR 4) só entregam e transmitem.
 * Nunca lança: erro inesperado vira `internal_error` e o estado não muda.
 * As regras de cada área ficam em módulos próprios (nota 0049).
 */
export class HostSession extends SessionContext {
  private revision = 0;
  private previous: SessionState | undefined;

  /**
   * `restored`: o estado salvo da campanha (`<campanha>.db`). Ninguém começa
   * conectado além do mestre, e só o mestre desta sessão tem o papel `gm`
   * (o arquivo é portátil e pode ter sido hospedado por outra pessoa).
   */
  constructor(
    campaign: SessionState['campaign'],
    private readonly gm: Identity,
    deps: SessionDeps,
    restored?: SessionState,
  ) {
    super(deps);
    const players = Object.fromEntries(
      Object.entries(restored?.players ?? {}).map(([id, p]) => [id, { displayName: p.displayName, role: 'player' as const, connected: false }]),
    );
    this.current = {
      campaign: restored?.campaign ?? campaign,
      players: { ...players, [gm.playerId]: { displayName: gm.displayName, role: 'gm', connected: true } },
      chat: restored?.chat ?? [],
      maps: restored?.maps ?? {},
      activeMapId: restored?.activeMapId ?? null,
      tokens: restored?.tokens ?? {},
      characters: restored?.characters ?? {},
      proposals: {},
      combat: restored?.combat ?? null,
      rest: restored?.rest ?? null,
    };
  }

  get rev(): number {
    return this.revision;
  }

  /** Estado completo (visão do mestre). */
  get state(): SessionState {
    return this.current;
  }

  roleOf(playerId: string): Role | undefined {
    return this.current.players[playerId]?.role;
  }

  isConnected(playerId: string): boolean {
    return this.current.players[playerId]?.connected === true;
  }

  /** O snapshot para um jogador. */
  viewFor(playerId: string): SessionState {
    return viewOf(this.current, { playerId, role: this.roleOf(playerId) ?? 'player' });
  }

  /** O `StateSnapshot` desse jogador: o estado visível com a janela do chat (nota 0047). */
  snapshotFor(playerId: string): { state: SessionState; chatFrom: number } {
    const { state, chatFrom } = chatWindow(this.current);
    return { state: viewOf(state, { playerId, role: this.roleOf(playerId) ?? 'player' }), chatFrom };
  }

  /** Entradas do chat antes de `before`, filtradas para esse jogador (`ChatHistoryRequest`). */
  chatHistory(playerId: string, before: number, limit: number): { from: number; entries: ChatEntry[] } {
    const { from, entries } = chatBefore(this.current.chat, before, limit);
    const view = viewOf({ ...this.current, chat: entries }, { playerId, role: this.roleOf(playerId) ?? 'player' });
    return { from, entries: view.chat };
  }

  /** O patch para um jogador: mesmo `rev`, operações filtradas (podem ficar vazias). */
  patchFor(change: StateChange, playerId: string): StateChange {
    return { ...change, ops: opsFor(change.ops, { playerId, role: this.roleOf(playerId) ?? 'player' }, this.current, change.rev === this.revision ? this.previous : undefined) };
  }

  /** Conexão aceita no handshake: registra o jogador ou o marca como conectado. */
  connect(identity: Identity): StateChange {
    const known = this.current.players[identity.playerId];
    const role: Role = identity.playerId === this.gm.playerId ? 'gm' : (known?.role ?? 'player');
    return this.commit([{ op: 'add', path: toPointer('players', identity.playerId), value: { displayName: identity.displayName, role, connected: true } }]);
  }

  /** Conexão caiu. Sem mudança se o jogador não estava conectado. */
  disconnect(playerId: string): StateChange | undefined {
    if (!this.isConnected(playerId)) return undefined;
    return this.commit([{ op: 'replace', path: toPointer('players', playerId, 'connected'), value: false }]);
  }

  handle(playerId: string, intent: Intent): IntentOutcome {
    try {
      const role = this.roleOf(playerId);
      if (!role || !this.isConnected(playerId)) throw notAllowed('Jogador não está na mesa');
      if (intent.kind === 'session.resync') return { result: { status: 'applied', rev: this.revision }, resync: true };
      const change = this.commit(this.opsFor(playerId, role, intent));
      return { result: { status: 'applied', rev: change.rev }, change };
    } catch (err: unknown) {
      if (err instanceof Rejection) return { result: { status: 'rejected', code: err.code, message: err.message } };
      return { result: { status: 'rejected', code: 'internal_error', message: 'Erro interno do Host' } };
    }
  }

  private commit(ops: PatchOp[]): StateChange {
    // Aplica antes de mudar a revisão: se o patch falhar, nada muda.
    const before = this.current;
    this.current = applyPatch(this.current, ops);
    this.previous = before;
    const baseRev = this.revision;
    this.revision += 1;
    return { rev: this.revision, baseRev, ops };
  }

  private opsFor(playerId: string, role: Role, intent: Exclude<Intent, { kind: 'session.resync' }>): PatchOp[] {
    switch (intent.kind) {
      case 'chat.message':
        return [this.appendChat({ kind: 'message', ...this.entryBase(playerId), text: intent.data.text })];
      case 'dice.roll':
        return [this.appendChat(roll(this, playerId, intent.data))];
      case 'token.move':
        return moveToken(this, playerId, role, intent.data);
      case 'map.create':
        this.requireGm(role);
        return createMap(this, intent.data);
      case 'map.update':
        this.requireGm(role);
        return updateMap(this, intent.data);
      case 'map.activate':
        this.requireGm(role);
        this.map(intent.data.mapId);
        return [{ op: 'replace', path: '/activeMapId', value: intent.data.mapId }];
      case 'token.create':
        this.requireGm(role);
        return createToken(this, intent.data);
      case 'token.remove':
        this.requireGm(role);
        this.token(intent.data.tokenId);
        return [{ op: 'remove', path: toPointer('tokens', intent.data.tokenId) }, ...leaveCombat(this, playerId, intent.data.tokenId)];
      case 'character.create':
        return createCharacter(this, playerId, role, intent.data);
      case 'character.update':
        return updateCharacter(this, playerId, role, intent.data);
      case 'character.roll_scores':
        return rollScores(this, playerId, role, intent.data.characterId);
      case 'character.remove':
        return removeCharacter(this, playerId, role, intent.data.characterId);
      case 'inventory.add':
        return addItem(this, playerId, role, intent.data);
      case 'inventory.remove':
        return removeItem(this, playerId, role, intent.data);
      case 'inventory.update':
        return updateItem(this, playerId, role, intent.data);
      case 'adjustment.add':
        this.requireGm(role);
        return addAdjustment(this, playerId, role, intent.data);
      case 'adjustment.remove': {
        const character = this.ownCharacter(playerId, role, intent.data.characterId);
        const index = character.adjustments.findIndex((a) => a.id === intent.data.adjustmentId);
        const adjustment = character.adjustments[index];
        if (!adjustment) throw violation('Ajuste não encontrado');
        // Efeito de magia (nota 0060): o dono do personagem também tira (Mage Armor ao vestir armadura).
        if (!adjustment.spell) this.requireGm(role);
        return [
          { op: 'remove', path: toPointer('characters', character.id, 'adjustments', String(index)) },
          ...(adjustment.spell
            ? [this.appendChat({ kind: 'spell_effect_ended', ...this.entryBase(playerId), characterId: character.id, characterName: character.name, effectName: adjustment.name.slice(0, 100), reason: 'removed' })]
            : []),
        ];
      }
      case 'roll.d20': {
        // Salvaguarda contra a Morte de quem está morrendo conta (fora do combate; no combate, o Host rola no início do turno).
        if (intent.data.target.kind === 'death_save') {
          const { character, sheet } = this.sheetOf(playerId, role, intent.data.characterId);
          if (isDying(currentHitPoints(sheet.hpMax.total, character.hp), character.deathSaves)) {
            if (inCombat(this, character.id)) throw violation('No combate, o Host rola a Salvaguarda contra a Morte no início do turno');
            return rollDeathSave(this, playerId, this.current, character.id);
          }
        }
        return [this.appendChat(rollFromSheet(this, playerId, role, intent.data))];
      }
      case 'death.set': {
        this.requireGm(role);
        const character = this.current.characters[intent.data.characterId];
        if (!character) throw violation('Personagem não encontrado');
        return [
          { op: 'replace', path: toPointer('characters', character.id, 'deathSaves'), value: intent.data.deathSaves },
          deathStateEntry(this, playerId, character, 'gm', intent.data.deathSaves, ['Ajuste do mestre']),
          ...concentrationBreaks(this, playerId, character, character.conditions, intent.data.deathSaves),
        ];
      }
      case 'spell.cast':
        return castSpell(this, playerId, role, intent.data);
      case 'spell.effect':
        return useSpellEffect(this, playerId, role, intent.data);
      case 'resource.spend':
      case 'resource.restore':
        return changeResource(this, playerId, role, intent);
      case 'spell_slot.spend':
      case 'spell_slot.restore':
        return changeSpellSlot(this, playerId, role, intent);
      case 'rest.start':
        this.requireGm(role);
        return startRest(this, playerId, intent.data);
      case 'rest.finish':
        this.requireGm(role);
        return finishRest(this, playerId);
      case 'rest.cancel':
        this.requireGm(role);
        if (!this.current.rest) throw violation('Não há descanso em andamento');
        return cancelRest(this, playerId, 'Interrompido pelo mestre');
      case 'hit_dice.spend':
        return spendHitDie(this, playerId, role, intent.data);
      case 'concentration.set':
        return concentrate(this, playerId, role, intent.data.characterId, intent.data.spellId);
      case 'concentration.end': {
        const character = this.ownCharacter(playerId, role, intent.data.characterId);
        if (!character.concentration) throw violation(`${character.name} não está concentrado`);
        return endConcentration(this, playerId, character, 'ended');
      }
      case 'roll.damage':
        return [this.appendChat(rollDamage(this, playerId, role, intent.data))];
      case 'attack.make':
        return makeAttack(this, playerId, role, intent.data);
      case 'save.force':
        return forceSave(this, playerId, role, intent.data);
      case 'mastery.use':
        return useMastery(this, playerId, role, intent.data);
      case 'combat.start':
        this.requireGm(role);
        return startCombat(this, playerId, intent.data);
      case 'combat.add':
        this.requireGm(role);
        return joinCombat(this, playerId, intent.data);
      case 'combat.remove':
        this.requireGm(role);
        this.combatant(intent.data.tokenId);
        return leaveCombat(this, playerId, intent.data.tokenId);
      case 'combat.set_initiative':
        this.requireGm(role);
        return setInitiative(this, intent.data.tokenId, intent.data.initiative);
      case 'combat.next':
        return advanceTurn(this, playerId, role);
      case 'combat.previous': {
        this.requireGm(role);
        const combat = this.combat();
        const position = previousTurn(combat, combat.combatants.length);
        return [this.replaceCombat({ ...combat, ...position })];
      }
      case 'combat.end': {
        this.requireGm(role);
        const combat = this.combat();
        // As durações por turno não fazem sentido fora do combate: terminam todas.
        const expired = expire(this, combat, () => true, playerId);
        return [...expired.ops, this.replaceCombat(null), this.appendChat({ kind: 'combat_event', ...this.entryBase(playerId), event: 'ended', round: combat.round })];
      }
      case 'damage.apply':
        this.requireGm(role);
        return applyProposal(this, playerId, intent.data.proposalId, intent.data.amount);
      case 'damage.dismiss':
        this.requireGm(role);
        proposalOf(this, intent.data.proposalId);
        return [{ op: 'remove', path: toPointer('proposals', intent.data.proposalId) }];
      case 'hp.change':
        return changeHp(this, playerId, role, intent.data);
      case 'condition.add':
      case 'condition.remove':
      case 'exhaustion.set':
        return changeConditions(this, playerId, role, intent);
      case 'inventory.currency':
        this.ownCharacter(playerId, role, intent.data.characterId);
        return [{ op: 'replace', path: toPointer('characters', intent.data.characterId, 'inventory', 'currency'), value: intent.data.currency }];
      case 'fog.manual.paint':
        this.requireGm(role);
        return paintManualFog(this, intent.data);
      case 'fog.manual.rect':
        this.requireGm(role);
        return rectManualFog(this, intent.data);
      case 'fog.manual.fill':
        this.requireGm(role);
        return fillManualFog(this, intent.data);
      case 'fog.config':
        this.requireGm(role);
        return configureFog(this, intent.data);
      case 'fog.memory.clear':
        this.requireGm(role);
        return clearFogMemory(this, intent.data);
      case 'token.vision':
        this.requireGm(role);
        return setTokenVision(this, intent.data);
    }
  }
}
