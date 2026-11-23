import { type SyntheticEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatEntry, Role, SessionState } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { CHAT_HELP, parseChatInput } from './chat-command';
import { type RollPart, rollParts } from './roll-parts';
import { AttackRollBody, D20RollBody, DamageAppliedBody, DamageRollBody, MasteryDamageBody, SaveRollBody } from './SheetRollEntries';
import { CONDITION_LABEL } from './sheet-labels';

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

export function Chat({ state, viewer }: { state: SessionState; viewer: ChatViewer }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLLIElement>(null);
  const masteryUsed = useMemo(() => new Set(state.chat.flatMap((e) => ('masteryOf' in e && e.masteryOf !== undefined ? [e.masteryOf] : []))), [state.chat]);
  const context: EntryContext = { state, viewer, masteryUsed };

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [state.chat.length]);

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
        {state.chat.length === 0 && <li className="hint">{CHAT_HELP}</li>}
        {state.chat.map((entry) => (
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
