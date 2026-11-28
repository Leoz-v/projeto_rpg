import { type ReactNode, useState } from 'react';
import { availableHitDice } from 'rules-engine/rest';
import type { ChatEntry, SessionCharacter, SessionState } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { SidebarSection } from './SidebarSection';
import { signed } from './sheet-labels';

/**
 * Descansos e Dados de Vida (nota 0050): o controle do mestre, os Dados de
 * Vida na ficha e as entradas do chat. As regras ficam no motor, no Host.
 */

const REST_LABEL = { short: 'Descanso curto', long: 'Descanso longo' } as const;

/** Painel do mestre: escolhe quem descansa e o tipo; durante o descanso, termina ou interrompe. */
export function RestPanel({ state }: { state: SessionState }) {
  const characters = Object.values(state.characters);
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = chosen ?? new Set(characters.map((c) => c.id));
  const send = (intent: Parameters<typeof sendIntent>[0]): void => {
    void sendIntent(intent).then(setError);
  };
  if (characters.length === 0) return null;
  const { rest } = state;
  return (
    <SidebarSection
      id="rest"
      title="Descanso"
      ariaLabel="Descanso"
      className="panel rest-panel"
      badge={rest ? <span className="tag">ativo</span> : undefined}
      defaultOpen={false}
      autoExpandWhen={rest !== null}
    >
      {rest ? (
        <>
          <p>
            <strong>{REST_LABEL[rest.kind]}</strong> em andamento:{' '}
            {rest.characterIds.map((id) => state.characters[id]?.name ?? 'Personagem removido').join(', ')}.
          </p>
          {rest.kind === 'short' && <p className="hint">Cada jogador gasta os Dados de Vida na própria ficha.</p>}
          <div className="row">
            <button type="button" onClick={() => { send({ kind: 'rest.finish', data: {} }); }}>
              Terminar descanso
            </button>
            <button type="button" className="secondary" onClick={() => { send({ kind: 'rest.cancel', data: {} }); }}>
              Interromper
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="rest-characters">
            {characters.map((c) => (
              <li key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setChosen(next);
                    }}
                  />{' '}
                  {c.name}
                </label>
              </li>
            ))}
          </ul>
          <div className="row">
            {(['short', 'long'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={selected.size === 0 || state.combat !== null}
                onClick={() => { send({ kind: 'rest.start', data: { kind, characterIds: [...selected] } }); }}
              >
                {REST_LABEL[kind]}
              </button>
            ))}
          </div>
          {state.combat !== null && <p className="hint">Não dá para descansar durante o combate.</p>}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </SidebarSection>
  );
}

/** Dados de Vida na ficha: quantos restam de cada tamanho e, no descanso curto, o botão de gastar. */
export function HitDiceControl({ character, hitDice, state, canEdit }: { character: SessionCharacter; hitDice: { die: number; count: number }[]; state: SessionState; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const resting = state.rest?.kind === 'short' && state.rest.characterIds.includes(character.id);
  const pools = availableHitDice(hitDice, character.hitDiceSpent);
  if (pools.length === 0) return <>—</>;
  return (
    <span className="hit-dice">
      {pools.map(({ die, count, available }) => (
        <span key={die} className="hit-die-pool">
          {available}/{count} d{die}
          {resting && canEdit && (die === 6 || die === 8 || die === 10 || die === 12) && (
            <button
              type="button"
              className="small"
              disabled={available === 0}
              title="Rola o dado + CON e cura (descanso curto)"
              onClick={() => {
                void sendIntent({ kind: 'hit_dice.spend', data: { characterId: character.id, die } }).then(setError);
              }}
            >
              Gastar
            </button>
          )}
        </span>
      ))}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

export function RestBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'rest' }>; header: ReactNode }) {
  const names = entry.characters.map((c) => c.name).join(', ');
  const text =
    entry.event === 'started'
      ? `${REST_LABEL[entry.rest]}: ${names}`
      : entry.event === 'finished'
        ? `${REST_LABEL[entry.rest]} terminado: ${names}`
        : `${REST_LABEL[entry.rest]} interrompido: ${names}`;
  return (
    <li className={`entry rest-event${entry.event === 'interrupted' ? ' interrupted' : ''}`}>
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

export function HitDieBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'hit_die' }>; header: ReactNode }) {
  return (
    <li className="entry roll rest-event">
      {header}
      <p>
        <span className="roll-label">Dado de Vida</span> · {entry.characterName}
      </p>
      <p className="roll-result">
        <span className="die" title={`d${entry.die}`}>
          {entry.roll}
        </span>
        <span className="modifier" title="Modificador de Constituição">
          {signed(entry.conModifier)}
        </span>
        <span className="total">= recupera {entry.healed} PV</span>
      </p>
    </li>
  );
}
