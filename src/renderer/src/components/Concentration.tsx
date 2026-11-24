import { type ReactNode, useState } from 'react';
import type { ChatEntry, Concentration } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { signed } from './sheet-labels';

/**
 * Concentração (nota 0045): a magia mantida na ficha e as entradas do chat.
 * A salvaguarda ao sofrer dano e o fim por Incapacitado ou morte ficam no Host.
 */

const REASON_LABEL = {
  replaced: 'trocou de magia',
  ended: 'encerrada',
  failed_save: 'falhou na salvaguarda',
  incapacitated: 'Incapacitado',
  dead: 'morto',
} as const;
const MODE_LABEL = { advantage: 'Vantagem', disadvantage: 'Desvantagem' } as const;

export function ConcentrationControl({
  characterId,
  current,
  spells,
  canEdit,
}: {
  characterId: string;
  current: Concentration | null;
  /** Magias da ficha que exigem Concentração, com o nome. */
  spells: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!current && (spells.length === 0 || !canEdit)) return null;
  const send = (intent: Parameters<typeof sendIntent>[0]): void => {
    void sendIntent(intent).then(setError);
  };
  return (
    <section className="concentration" aria-label="Concentração">
      <p>
        <strong>Concentração:</strong> {current ? current.name : <span className="hint">nenhuma</span>}
        {current && canEdit && (
          <button type="button" className="link" onClick={() => { send({ kind: 'concentration.end', data: { characterId } }); }}>
            encerrar
          </button>
        )}
      </p>
      {canEdit && spells.length > 0 && (
        <select
          aria-label="Concentrar em"
          value=""
          onChange={(e) => {
            if (e.target.value) send({ kind: 'concentration.set', data: { characterId, spellId: e.target.value } });
          }}
        >
          <option value="">{current ? 'Trocar para…' : 'Concentrar em…'}</option>
          {spells
            .filter((s) => s.id !== current?.spellId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function ConcentrationBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'concentration' }>; header: ReactNode }) {
  const text =
    entry.event === 'started'
      ? `${entry.characterName} se concentra em ${entry.spellName}`
      : entry.event === 'kept'
        ? `${entry.characterName} mantém ${entry.spellName}`
        : `${entry.characterName} perde a Concentração em ${entry.spellName}${entry.reason ? ` (${REASON_LABEL[entry.reason]})` : ''}`;
  return (
    <li className={`entry concentration-event${entry.event === 'ended' ? ' ended' : ''}`}>
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

export function ConcentrationSaveBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'concentration_save' }>; header: ReactNode }) {
  const keptIndex = entry.dice.indexOf(entry.natural);
  return (
    <li className={`entry roll concentration-event${entry.success ? '' : ' ended'}`}>
      {header}
      <p>
        <span className="roll-label">Concentração (CON, CD {entry.dc})</span> · {entry.characterName} · {entry.spellName}
        {entry.mode !== 'normal' && <span className="tag">{MODE_LABEL[entry.mode]}</span>}
      </p>
      <p className="roll-result">
        {entry.dice.map((value, i) => (
          <span key={i} className={`die${i !== keptIndex ? ' dropped' : ''}`} title="d20">
            {value}
          </span>
        ))}
        <span className="modifier">{signed(entry.modifier)}</span>
        <span className="total">= {entry.total}</span>
        <span className="tag">{entry.success ? 'mantém' : 'perde'}</span>
      </p>
      {(entry.advantage.length > 0 || entry.disadvantage.length > 0) && (
        <p className="hint">
          {entry.advantage.length > 0 && `Vantagem: ${entry.advantage.join(', ')}`}
          {entry.advantage.length > 0 && entry.disadvantage.length > 0 && ' · '}
          {entry.disadvantage.length > 0 && `Desvantagem: ${entry.disadvantage.join(', ')}`}
        </p>
      )}
      {entry.notes.map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
    </li>
  );
}
