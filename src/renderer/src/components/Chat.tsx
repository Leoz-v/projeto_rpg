import { type SyntheticEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { type ChatEntry, MAX_CHAT_HISTORY, type Role, type SessionState } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { CHAT_HELP, parseChatInput } from './chat-command';
import { type RollPart, rollParts } from './roll-parts';
import { addToChatLog, type ChatLog, chatLogEntries, chatLogWithWindow, EMPTY_CHAT_LOG, firstChatIndex } from './chat-log';
import { FeatureUsedBody } from './FeatureUses';
import { DawnBody, ItemChargesBody, ScrollCheckBody } from './ItemCharges';
import { ItemUsedBody } from './ItemUse';
import { PendingSaveActions, AttackRollBody, D20RollBody, DamageAppliedBody, DamageRollBody, MasteryDamageBody, SaveRollBody } from './SheetRollEntries';
import { CONDITION_LABEL } from './sheet-labels';
import { DeathSaveBody, DeathStateBody } from './DeathSaves';
import { ConcentrationBody, ConcentrationSaveBody } from './Concentration';
import { HitDieBody, RestBody } from './Rest';
import { SpellSlotBody } from './SpellSlots';
import { ResourceBody } from './Resources';
import { SpellAppliedBody, SpellCastBody, SpellDamageBody, SpellEffectEndedBody } from './Casting';

/** Log da sessão (mensagens e rolagens) e campo de envio. */

const time = (at: number): string => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function Die({ part }: { part: RollPart }) {
  const { sides, value, negative } = part;
  const mark = sides === 20 && value === 20 ? ' crit' : sides === 20 && value === 1 ? ' fumble' : '';
  return (
    <span className={`die${mark}`} title={`d${sides}${negative ? ' (subtrai)' : ''}`}>
      {negative ? `−${value}` : value}
    </span>
  );
}

function RollResult({ formula, rolls, total }: { formula: string; rolls: { sides: number; value: number }[]; total: number }) {
  const { dice, modifier } = rollParts(formula, rolls);
  return (
    <p className="roll-result">
      {dice.map((part, i) => (
        <Die key={i} part={part} />
      ))}
      {modifier !== 0 && <span className="modifier">{modifier > 0 ? `+${modifier}` : `−${-modifier}`}</span>}
      <span className="total">= {total}</span>
    </p>
  );
}

/** Quem está olhando o chat: decide quem vê os botões das maestrias. */
export interface ChatViewer {
  playerId: string;
  role: Role;
}

interface EntryContext {
  state: SessionState;
  viewer: ChatViewer;
  /** Ataques cuja maestria já foi usada (alguma entrada tem `masteryOf` apontando para eles). */
  masteryUsed: ReadonlySet<string>;
}

function Entry({ entry, author, context }: { entry: ChatEntry; author: string; context: EntryContext }) {
  const { proposals } = context.state;
  const header = (
    <header>
      <strong>{author}</strong> <time>{time(entry.at)}</time>
    </header>
  );
  switch (entry.kind) {
    case 'message':
      return (
        <li className="entry">
          {header}
          <p>{entry.text}</p>
        </li>
      );
    case 'roll':
      return (
        <li className={`entry roll${entry.visibility === 'gm' ? ' secret' : ''}`}>
          {header}
          <p>
            {entry.label && <span className="roll-label">{entry.label}: </span>}
            <code>{entry.formula}</code>
            {entry.visibility === 'gm' && <span className="tag">secreta</span>}
          </p>
          <RollResult formula={entry.formula} rolls={entry.rolls} total={entry.total} />
        </li>
      );
    case 'hidden_roll':
      if (entry.silent) return null;
      return (
        <li className="entry hidden">
          {header}
          <p>Fez uma rolagem secreta para o mestre.</p>
        </li>
      );
    case 'd20_roll':
      return <D20RollBody entry={entry} header={header} />;
    case 'damage_roll':
      return <DamageRollBody entry={entry} header={header} />;
    case 'attack_roll':
      // Só o mestre recebe as propostas: para os outros, `pending` é sempre falso.
      return (
        <AttackRollBody
          entry={entry}
          header={header}
          pending={entry.damage !== undefined && entry.damage.proposalId in proposals}
          mastery={{
            used: context.masteryUsed.has(entry.id),
            canUse: context.viewer.role === 'gm' || entry.authorId === context.viewer.playerId,
            tokens: context.state.tokens,
            activeMapId: context.state.activeMapId,
          }}
        />
      );
    case 'mastery_damage':
      return <MasteryDamageBody entry={entry} header={header} pending={entry.proposalId !== undefined && entry.proposalId in proposals} />;
    case 'save_roll':
      return <SaveRollBody entry={entry} header={header} proposals={proposals} viewer={context.viewer} state={context.state} />;
    case 'condition_changed': {
      const { change } = entry;
      const text =
        change.kind === 'added'
          ? `${entry.targetName} está ${CONDITION_LABEL[change.condition]}`
          : change.kind === 'removed'
            ? `${entry.targetName} não está mais ${CONDITION_LABEL[change.condition]}`
            : `${entry.targetName}: Exaustão ${change.from} → ${change.to}`;
      return (
        <li className="entry condition-event">
          {header}
          <p>{text}</p>
          {entry.notes.map((n, i) => (
            <p key={i} className="hint">
              {n}
            </p>
          ))}
        </li>
      );
    }
    case 'damage_applied':
      return <DamageAppliedBody entry={entry} header={header} />;
    case 'initiative_roll':
      return (
        <li className="entry roll">
          {header}
          <p>
            <span className="roll-label">Iniciativa</span>
          </p>
          {entry.results.length === 0 && <p className="hint">Rolada pelo mestre.</p>}
          {entry.results.map((r) => {
            const kept = r.dice.indexOf(r.natural);
            return (
              <div key={r.tokenId}>
                <p className="roll-result">
                  <strong>{r.name}</strong>
                  {r.dice.map((value, i) => (
                    <span key={i} className={`die${i !== kept ? ' dropped' : ''}`}>
                      {value}
                    </span>
                  ))}
                  <span className="modifier">{r.modifier >= 0 ? `+${r.modifier}` : `−${-r.modifier}`}</span>
                  <span className="total">= {r.total}</span>
                </p>
                {r.notes.map((n, i) => (
                  <p key={i} className="hint">
                    {n}
                  </p>
                ))}
              </div>
            );
          })}
        </li>
      );
    case 'timed_effect': {
      const label = { sap: 'Sap', vex: 'Vex', slow: 'Slow' }[entry.effect];
      return (
        <li className="entry condition-event">
          <p>
            {entry.event === 'started' ? `${label} de ${entry.sourceName} em ${entry.targetName}` : `Fim do ${label} de ${entry.sourceName} em ${entry.targetName}`}
          </p>
        </li>
      );
    }
    case 'spell_cast':
      return <SpellCastBody entry={entry} header={header} state={context.state} viewer={context.viewer} />;
    case 'spell_damage':
      return <SpellDamageBody entry={entry} header={header} proposals={proposals} />;
    case 'feature_used':
      return <FeatureUsedBody entry={entry} header={header} />;
    case 'scroll_check':
      return <ScrollCheckBody entry={entry} header={header} />;
    case 'item_charges':
      return <ItemChargesBody entry={entry} header={header} />;
    case 'dawn':
      return <DawnBody entry={entry} header={header} />;
    case 'item_used':
      return <ItemUsedBody entry={entry} header={header} />;
    case 'spell_applied':
      return <SpellAppliedBody entry={entry} header={header} />;
    case 'spell_effect_ended':
      return <SpellEffectEndedBody entry={entry} header={header} />;
    case 'resource':
      return <ResourceBody entry={entry} header={header} />;
    case 'spell_slot':
      return <SpellSlotBody entry={entry} header={header} />;
    case 'rest':
      return <RestBody entry={entry} header={header} />;
    case 'hit_die':
      return <HitDieBody entry={entry} header={header} />;
    case 'concentration':
      return <ConcentrationBody entry={entry} header={header} />;
    case 'concentration_save':
      return (
        <>
          <ConcentrationSaveBody entry={entry} header={header} />
          {Object.values(context.state.pendingSaves)
            .filter((p) => p.entryId === entry.id)
            .map((p) => (
              <li key={p.id} className="entry">
                <PendingSaveActions pending={p} />
              </li>
            ))}
        </>
      );
    case 'death_save':
      return <DeathSaveBody entry={entry} header={header} />;
    case 'death_state':
      return <DeathStateBody entry={entry} header={header} />;
    case 'legendary_resistance':
      return (
        <li className="entry condition-event">
          {header}
          <p>
            {entry.name} {entry.used ? 'usa Resistência Lendária e passa em' : 'aceita a falha em'} {entry.label}
          </p>
        </li>
      );
    case 'recharge_roll':
      return (
        <li className="entry condition-event">
          {header}
          <p>
            {entry.name}: recarga de {entry.actionName}, 1d6 = {entry.roll} (precisa de {entry.min})
            <span className="hint"> {entry.roll >= entry.min ? 'recuperada' : 'continua gasta'}</span>
          </p>
        </li>
      );
    case 'turn_trigger': {
      const moment = { initiative: 'Iniciativa', turn_start: 'Início do turno', turn_end: 'Fim do turno' }[entry.on];
      return (
        <li className="entry turn-trigger">
          <p>
            <strong>
              {moment} de {entry.name}
            </strong>
          </p>
          <ul className="turn-trigger-items">
            {entry.items.map((item, i) => (
              <li key={i}>
                <span className="roll-label">{item.source}:</span> {item.healed !== undefined ? `recupera ${item.healed} PV` : item.text}
              </li>
            ))}
          </ul>
        </li>
      );
    }
    case 'combat_event':
      return (
        <li className="entry combat-event">
          <p>{entry.event === 'started' ? 'Combate iniciado: rodada 1' : entry.event === 'round' ? `Rodada ${entry.round}` : `Combate encerrado na rodada ${entry.round}`}</p>
        </li>
      );
    case 'ability_roll':
      return (
        <li className="entry roll">
          {header}
          <p>
            <span className="roll-label">Atributos de {entry.characterName}:</span> <code>4d6</code> × 6, descartando o menor
          </p>
          <ol className="ability-sets">
            {entry.sets.map((set, i) => (
              <li key={i} className="roll-result">
                {set.dice.map((value, d) => (
                  <span key={d} className={`die${d === set.dropped ? ' dropped' : ''}`} title={d === set.dropped ? 'descartado' : 'd6'}>
                    {value}
                  </span>
                ))}
                <span className="total">= {set.total}</span>
              </li>
            ))}
          </ol>
        </li>
      );
  }
}

export function Chat({ state, chatFrom, viewer }: { state: SessionState; chatFrom: number; viewer: ChatViewer }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLLIElement>(null);
  // Páginas antigas do chat carregadas sob demanda, por campanha; a janela vem do estado (nota 0047).
  const [saved, setSaved] = useState<{ campaignId: string; log: ChatLog }>({ campaignId: state.campaign.id, log: EMPTY_CHAT_LOG });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const base = saved.campaignId === state.campaign.id ? saved.log : EMPTY_CHAT_LOG;
  const log = useMemo(() => chatLogWithWindow(base, chatFrom, state.chat), [base, chatFrom, state.chat]);
  const entries = useMemo(() => chatLogEntries(log), [log]);
  const first = firstChatIndex(log);
  const masteryUsed = useMemo(() => new Set(entries.flatMap((e) => ('masteryOf' in e && e.masteryOf !== undefined ? [e.masteryOf] : []))), [entries]);
  const context: EntryContext = { state, viewer, masteryUsed };
  const lastId = state.chat.at(-1)?.id;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);

  const loadOlder = async (): Promise<void> => {
    setLoadingOlder(true);
    const result = await window.vtt.chatHistory(first, MAX_CHAT_HISTORY);
    setLoadingOlder(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // Guarda a janela atual junto: ela pode sair da janela antes do próximo pedido.
    setSaved({ campaignId: state.campaign.id, log: addToChatLog(log, result.value.from, result.value.entries) });
  };

  const submit = async (event?: SyntheticEvent): Promise<void> => {
    event?.preventDefault();
    const command = parseChatInput(input);
    if (!command.ok) {
      setError(command.message);
      return;
    }
    setBusy(true);
    const refused = await sendIntent(command.intent);
    setBusy(false);
    setError(refused);
    if (!refused) setInput('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section className="chat" aria-label="Chat e rolagens">
      <ol className="log">
        {first > 0 && (
          <li className="chat-older">
            <button type="button" className="link" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </button>
          </li>
        )}
        {entries.length === 0 && <li className="hint">{CHAT_HELP}</li>}
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} author={state.players[entry.authorId]?.displayName ?? 'Desconhecido'} context={context} />
        ))}
        <li ref={end} aria-hidden />
      </ol>
      <form className="composer" onSubmit={(e) => void submit(e)}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Mensagem, /r 2d6+3 ou /gr 1d20"
          rows={2}
          aria-label="Mensagem"
        />
        <button type="submit" disabled={busy}>
          Enviar
        </button>
      </form>
    </section>
  );
}
