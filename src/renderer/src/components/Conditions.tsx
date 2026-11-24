import { useState } from 'react';
import { type ConditionState, type CreatureTarget, type Intent, MAX_EXHAUSTION_LEVEL, type TableCondition, TableConditionSchema, type TurnExpiryValue } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { CONDITION_LABEL } from './sheet-labels';

/**
 * Condições de um personagem ou token: as ativas, com a Exaustão e o nível.
 * Quem pode mudar (mestre, dono) põe e tira condições e ajusta a Exaustão; o
 * Host confere permissão e imunidades.
 */

const ALL: readonly TableCondition[] = TableConditionSchema.options;

/** Combatente para escolher a duração ("até o fim do próximo turno de…"). */
export interface DurationOption {
  tokenId: string;
  name: string;
}

/** "até o fim do turno de Thorin (rodada 2)". */
export function untilLabel(until: TurnExpiryValue, names: ReadonlyMap<string, string>): string {
  const who = names.get(until.tokenId) ?? 'combatente';
  return `até o ${until.at === 'turn_start' ? 'início' : 'fim'} do turno de ${who} (rodada ${until.round})`;
}

export function ConditionsControl({
  target,
  state,
  canEdit,
  combatants = [],
}: {
  target: CreatureTarget;
  state: ConditionState;
  canEdit: boolean;
  /** Combatentes do combate em andamento (vazio sem combate: sem duração por turno). */
  combatants?: readonly DurationOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState('');
  const names = new Map(combatants.map((c) => [c.tokenId, c.name]));
  const [busy, setBusy] = useState(false);
  const send = (intent: Intent): void => {
    setBusy(true);
    void sendIntent(intent).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };
  const missing = ALL.filter((c) => !state.active.some((a) => a.condition === c));
  if (!canEdit && state.active.length === 0 && state.exhaustion === 0) return null;
  return (
    <div className="conditions" aria-label="Condições">
      <div className="condition-tags">
        {state.active.length === 0 && state.exhaustion === 0 && <span className="hint">Sem condições</span>}
        {state.active.map(({ condition, until }) => (
          <span key={condition} className="tag condition-tag" title={until ? untilLabel(until, names) : undefined}>
            {CONDITION_LABEL[condition]}
            {until && <span className="hint"> ⏱</span>}
            {canEdit && (
              <button
                type="button"
                className="link"
                disabled={busy}
                aria-label={`Tirar ${CONDITION_LABEL[condition]}`}
                onClick={() => {
                  send({ kind: 'condition.remove', data: { target, condition } });
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {state.exhaustion > 0 && (
          <span className="tag condition-tag">
            {CONDITION_LABEL.exhaustion} {state.exhaustion}
          </span>
        )}
      </div>
      {canEdit && (
        <div className="row condition-edit">
          <select
            aria-label="Pôr condição"
            value=""
            disabled={busy}
            onChange={(e) => {
              const condition = TableConditionSchema.safeParse(e.target.value);
              if (!condition.success) return;
              const [edge, tokenId] = duration.split(':');
              const at = edge === 'turn_start' ? 'turn_start' : edge === 'turn_end' ? 'turn_end' : undefined;
              const until: { at: TurnExpiryValue['at']; tokenId: string } | undefined = at && tokenId ? { at, tokenId } : undefined;
              send({ kind: 'condition.add', data: { target, condition: condition.data, ...(until ? { until } : {}) } });
            }}
          >
            <option value="">Pôr condição…</option>
            {missing.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
          {combatants.length > 0 && (
            <select
              aria-label="Duração da condição"
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value);
              }}
            >
              <option value="">sem duração</option>
              {combatants.flatMap((c) => [
                <option key={`s:${c.tokenId}`} value={`turn_start:${c.tokenId}`}>
                  até o início do próximo turno de {c.name}
                </option>,
                <option key={`e:${c.tokenId}`} value={`turn_end:${c.tokenId}`}>
                  até o fim do próximo turno de {c.name}
                </option>,
              ])}
            </select>
          )}
          <span className="exhaustion-edit">
            Exaustão
            <button
              type="button"
              className="secondary small"
              disabled={busy || state.exhaustion === 0}
              aria-label="Diminuir Exaustão"
              onClick={() => {
                send({ kind: 'exhaustion.set', data: { target, level: state.exhaustion - 1 } });
              }}
            >
              −
            </button>
            <strong>{state.exhaustion}</strong>
            <button
              type="button"
              className="secondary small"
              disabled={busy || state.exhaustion >= MAX_EXHAUSTION_LEVEL}
              aria-label="Aumentar Exaustão"
              onClick={() => {
                send({ kind: 'exhaustion.set', data: { target, level: state.exhaustion + 1 } });
              }}
            >
              +
            </button>
          </span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
