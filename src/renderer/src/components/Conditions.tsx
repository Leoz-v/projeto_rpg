import { useState } from 'react';
import { type ConditionState, type CreatureTarget, type Intent, MAX_EXHAUSTION_LEVEL, type TableCondition, TableConditionSchema } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { CONDITION_LABEL } from './sheet-labels';

/**
 * Condições de um personagem ou token: as ativas, com a Exaustão e o nível.
 * Quem pode mudar (mestre, dono) põe e tira condições e ajusta a Exaustão; o
 * Host confere permissão e imunidades.
 */

const ALL: readonly TableCondition[] = TableConditionSchema.options;

export function ConditionsControl({ target, state, canEdit }: { target: CreatureTarget; state: ConditionState; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
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
        {state.active.map(({ condition }) => (
          <span key={condition} className="tag condition-tag">
            {CONDITION_LABEL[condition]}
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
              if (condition.success) send({ kind: 'condition.add', data: { target, condition: condition.data } });
            }}
          >
            <option value="">Pôr condição…</option>
            {missing.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
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
