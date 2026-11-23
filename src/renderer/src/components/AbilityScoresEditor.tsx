import { useState } from 'react';
import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type BaseScores,
  POINT_BUY_BUDGET,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  pointBuySpent,
  STANDARD_ARRAY,
} from 'rules-engine/schemas';
import type { SessionCharacter } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { type Assignment, availableValues, isComplete } from './score-pool';
import { ABILITY_LABEL } from './sheet-labels';

/**
 * Definição dos atributos base (SRD 5.2.1 p. 20): conjunto padrão, compra de
 * pontos ou valores rolados pelo Host. Valores à mão só para o mestre. A tela
 * só monta a proposta; o Host confere e aplica (`character.update`).
 */

type Method = BaseScores['method'];

const METHODS: readonly { value: Method; label: string; gmOnly?: boolean }[] = [
  { value: 'standard_array', label: 'Conjunto padrão' },
  { value: 'point_buy', label: 'Compra de pontos' },
  { value: 'rolled', label: 'Rolagem' },
  { value: 'manual', label: 'À mão (mestre)', gmOnly: true },
];

/** A distribuição sem o valor de um atributo. */
const without = (assigned: Assignment, ability: Ability): Assignment => Object.fromEntries(Object.entries(assigned).filter(([a]) => a !== ability));

const uniform = (value: number): AbilityScores => ({ str: value, dex: value, con: value, int: value, wis: value, cha: value });

/** Ponto de partida de cada método: o que já está salvo, se for o mesmo método. */
function initial(method: Method, character: SessionCharacter): Assignment {
  if (character.baseScores?.method === method) return { ...character.baseScores.scores };
  if (method === 'point_buy') return uniform(POINT_BUY_MIN);
  if (method === 'manual') return character.baseScores ? { ...character.baseScores.scores } : uniform(10);
  return {};
}

function PoolPicker({ pool, assigned, onChange }: { pool: readonly number[]; assigned: Assignment; onChange: (a: Assignment) => void }) {
  return (
    <div className="score-grid">
      {ABILITIES.map((ability) => (
        <label key={ability}>
          <span title={ABILITY_LABEL[ability].long}>{ABILITY_LABEL[ability].short}</span>
          <select
            value={assigned[ability] ?? ''}
            onChange={(e) => {
              onChange(e.target.value === '' ? without(assigned, ability) : { ...assigned, [ability]: Number(e.target.value) });
            }}
          >
            <option value="">—</option>
            {availableValues(pool, assigned, ability).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function PointBuy({ scores, onChange }: { scores: AbilityScores; onChange: (s: AbilityScores) => void }) {
  const spent = pointBuySpent(scores) ?? POINT_BUY_BUDGET;
  const canSet = (ability: Ability, value: number): boolean => {
    if (value < POINT_BUY_MIN || value > POINT_BUY_MAX) return false;
    const next = pointBuySpent({ ...scores, [ability]: value });
    return next !== undefined && next <= POINT_BUY_BUDGET;
  };
  return (
    <>
      <p className={`hint${spent === POINT_BUY_BUDGET ? ' status-exact' : ''}`}>
        Pontos: {spent} de {POINT_BUY_BUDGET}
      </p>
      <div className="score-grid">
        {ABILITIES.map((ability) => (
          <div key={ability} className="stepper">
            <span title={ABILITY_LABEL[ability].long}>{ABILITY_LABEL[ability].short}</span>
            <button
              type="button"
              className="secondary"
              aria-label={`Diminuir ${ABILITY_LABEL[ability].long}`}
              disabled={!canSet(ability, scores[ability] - 1)}
              onClick={() => {
                onChange({ ...scores, [ability]: scores[ability] - 1 });
              }}
            >
              −
            </button>
            <output>{scores[ability]}</output>
            <button
              type="button"
              className="secondary"
              aria-label={`Aumentar ${ABILITY_LABEL[ability].long}`}
              disabled={!canSet(ability, scores[ability] + 1)}
              onClick={() => {
                onChange({ ...scores, [ability]: scores[ability] + 1 });
              }}
            >
              +
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function Manual({ scores, onChange }: { scores: Assignment; onChange: (a: Assignment) => void }) {
  return (
    <div className="score-grid">
      {ABILITIES.map((ability) => (
        <label key={ability}>
          <span title={ABILITY_LABEL[ability].long}>{ABILITY_LABEL[ability].short}</span>
          <input
            type="number"
            min={1}
            max={30}
            value={scores[ability] ?? ''}
            onChange={(e) => {
              const value = Number(e.target.value);
              onChange(e.target.value === '' || !Number.isInteger(value) ? without(scores, ability) : { ...scores, [ability]: value });
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function AbilityScoresEditor({ character, isGm, onDone }: { character: SessionCharacter; isGm: boolean; onDone: () => void }) {
  const [method, setMethod] = useState<Method>(character.baseScores?.method ?? (character.rolledScores ? 'rolled' : 'standard_array'));
  const [assigned, setAssigned] = useState<Assignment>(() => initial(method, character));
  const [rolledSeen, setRolledSeen] = useState(character.rolledScores);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Valores rolados de novo (o mestre mandou rolar): a distribuição antiga não vale mais.
  if (rolledSeen !== character.rolledScores) {
    setRolledSeen(character.rolledScores);
    if (method === 'rolled') setAssigned({});
  }

  const choose = (next: Method): void => {
    setMethod(next);
    setAssigned(initial(next, character));
    setError(null);
  };

  const run = async (send: () => Promise<string | null>, close: boolean): Promise<void> => {
    setBusy(true);
    const refused = await send();
    setBusy(false);
    setError(refused);
    if (!refused && close) onDone();
  };

  const save = (): void => {
    if (!isComplete(assigned)) return;
    void run(() => sendIntent({ kind: 'character.update', data: { characterId: character.id, baseScores: { method, scores: assigned } } }), true);
  };

  const roll = (): void => {
    void run(() => sendIntent({ kind: 'character.roll_scores', data: { characterId: character.id } }), false);
  };

  const canReroll = isGm && character.rolledScores !== null;

  return (
    <section className="score-editor" aria-label="Atributos base">
      <div className="method-tabs" role="tablist">
        {METHODS.filter((m) => !m.gmOnly || isGm).map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={method === m.value}
            className={`pill${method === m.value ? ' active' : ''}`}
            onClick={() => {
              choose(m.value);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {method === 'standard_array' && (
        <>
          <p className="hint">Distribua 15, 14, 13, 12, 10 e 8 entre os atributos.</p>
          <PoolPicker pool={STANDARD_ARRAY} assigned={assigned} onChange={setAssigned} />
        </>
      )}
      {method === 'point_buy' && <PointBuy scores={isComplete(assigned) ? assigned : uniform(POINT_BUY_MIN)} onChange={setAssigned} />}
      {method === 'rolled' &&
        (character.rolledScores === null ? (
          <p className="hint">
            O Host rola 4d6 seis vezes, descartando o menor dado de cada vez. O resultado aparece no chat para todos e só pode ser rolado uma vez (o mestre
            pode mandar rolar de novo).
          </p>
        ) : (
          <>
            <p className="hint">Valores rolados: {character.rolledScores.join(', ')}. Distribua entre os atributos.</p>
            <PoolPicker pool={character.rolledScores} assigned={assigned} onChange={setAssigned} />
          </>
        ))}
      {method === 'manual' && (
        <>
          <p className="hint">Valores livres de 1 a 30, para casos especiais da mesa.</p>
          <Manual scores={assigned} onChange={setAssigned} />
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row editor-actions">
        {method === 'rolled' && (character.rolledScores === null || canReroll) && (
          <button
            type="button"
            className={character.rolledScores === null ? '' : 'secondary'}
            disabled={busy}
            onClick={() => {
              if (character.rolledScores === null || window.confirm('Rolar os atributos de novo? Os valores atuais deixam de valer.')) roll();
            }}
          >
            {character.rolledScores === null ? 'Rolar atributos' : 'Rolar de novo'}
          </button>
        )}
        {character.baseScores && (
          <button type="button" className="secondary" disabled={busy} onClick={onDone}>
            Cancelar
          </button>
        )}
        {!(method === 'rolled' && character.rolledScores === null) && (
          <button type="button" disabled={busy || !isComplete(assigned)} onClick={save}>
            Salvar atributos
          </button>
        )}
      </div>
    </section>
  );
}
