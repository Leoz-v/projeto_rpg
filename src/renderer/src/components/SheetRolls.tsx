import { useState } from 'react';
import type { AttackRider, DamageType, DerivedSheet } from 'rules-engine';
import type { SheetRollTarget } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { DAMAGE_LABEL } from './sheet-labels';

/**
 * Rolar a partir da ficha: a tela só pede (`roll.d20`, `roll.damage`); o Host
 * calcula o modificador e as regras com o motor e rola com o RNG dele. O
 * resultado aparece no chat.
 */

export interface Roller {
  roll: (target: SheetRollTarget) => void;
  /** Ataque com a arma: contra o alvo escolhido (CA, dano proposto) ou, sem alvo, só a rolagem. */
  attack: (attack: DerivedSheet['attacks'][number]) => void;
  damage: (instanceId: string, critical: boolean) => void;
}

/** Um token que pode ser alvo. */
export interface TargetOption {
  id: string;
  name: string;
}

type Declared = 'normal' | 'advantage' | 'disadvantage';

export interface RollState {
  roller: Roller;
  declared: Declared;
  setDeclared: (d: Declared) => void;
  secret: boolean;
  setSecret: (s: boolean) => void;
  versatile: boolean;
  setVersatile: (v: boolean) => void;
  targetId: string | null;
  setTargetId: (id: string | null) => void;
  /** Dano extra marcado para o próximo ataque, com o tipo escolhido. */
  riders: ReadonlyMap<string, DamageType | undefined>;
  setRider: (id: string, on: boolean, damageType?: DamageType) => void;
  error: string | null;
}

export function useRoller(characterId: string): RollState {
  const [declared, setDeclared] = useState<Declared>('normal');
  const [secret, setSecret] = useState(false);
  const [versatile, setVersatile] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [riders, setRiders] = useState<ReadonlyMap<string, DamageType | undefined>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const visibility = secret ? ('gm' as const) : ('public' as const);
  const declaredFlags = {
    ...(declared === 'advantage' ? { advantage: true } : {}),
    ...(declared === 'disadvantage' ? { disadvantage: true } : {}),
  };
  const roller: Roller = {
    attack: ({ instanceId, riders: available }) => {
      if (targetId === null) {
        roller.roll({ kind: 'attack', instanceId });
        return;
      }
      // Só o que este ataque tem; sem tipo escolhido, vai o primeiro.
      const chosen = available.filter((r) => r.mode === 'choice' && riders.has(r.id)).map((r) => ({ id: r.id, ...(r.types.length > 1 ? { damageType: riders.get(r.id) ?? r.types[0] } : {}) }));
      void sendIntent({ kind: 'attack.make', data: { attacker: { characterId, instanceId }, targetTokenId: targetId, ...declaredFlags, visibility, ...(chosen.length > 0 ? { riders: chosen } : {}) } }).then((refused) => {
        setError(refused);
        if (refused) return;
        setDeclared('normal');
        setRiders(new Map());
      });
    },
    roll: (target) => {
      void sendIntent({
        kind: 'roll.d20',
        data: {
          characterId,
          target,
          ...declaredFlags,
          visibility,
        },
      }).then((refused) => {
        setError(refused);
        // A vantagem declarada vale para uma rolagem.
        if (!refused) setDeclared('normal');
      });
    },
    damage: (instanceId, critical) => {
      void sendIntent({ kind: 'roll.damage', data: { characterId, instanceId, ...(critical ? { critical } : {}), ...(versatile ? { versatile } : {}), visibility } }).then(setError);
    },
  };
  const setRider = (id: string, on: boolean, damageType?: DamageType): void => {
    const next = new Map(riders);
    if (on) next.set(id, damageType);
    else next.delete(id);
    setRiders(next);
  };
  return { roller, declared, setDeclared, secret, setSecret, versatile, setVersatile, targetId, setTargetId, riders, setRider, error };
}

const DECLARED: readonly { value: Declared; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'advantage', label: 'Vantagem' },
  { value: 'disadvantage', label: 'Desvantagem' },
];

/** O dano extra à escolha de algum dos ataques, sem repetir. */
export function choiceRiders(sheet: DerivedSheet): AttackRider[] {
  const all = sheet.attacks.flatMap((a) => a.riders.filter((r) => r.mode === 'choice'));
  return all.filter((r, j) => all.findIndex((x) => x.id === r.id) === j);
}

/** Opções da próxima rolagem: Vantagem/Desvantagem declarada, secreta, duas mãos. */
export function RollToolbar({ state, hasVersatile, targets, riders }: { state: RollState; hasVersatile: boolean; targets: readonly TargetOption[]; riders: readonly AttackRider[] }) {
  // Alvo que saiu do mapa deixa de valer.
  const targetId = state.targetId !== null && targets.some((t) => t.id === state.targetId) ? state.targetId : '';
  return (
    <div className="roll-toolbar">
      <label>
        Alvo dos ataques
        <select
          value={targetId}
          onChange={(e) => {
            state.setTargetId(e.target.value === '' ? null : e.target.value);
          }}
        >
          <option value="">sem alvo (só rolar)</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <span className="hint">Próxima rolagem:</span>
      <div className="method-tabs">
        {DECLARED.map((d) => (
          <button
            key={d.value}
            type="button"
            className={`pill${state.declared === d.value ? ' active' : ''}`}
            title={d.value === 'normal' ? undefined : 'Circunstância que a ficha não sabe (ou concedida pelo mestre); vale para uma rolagem e se anula com a oposta'}
            onClick={() => {
              state.setDeclared(d.value);
            }}
          >
            {d.label}
          </button>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={state.secret}
          onChange={(e) => {
            state.setSecret(e.target.checked);
          }}
        />
        secreta (só o mestre vê)
      </label>
      {hasVersatile && (
        <label className="check">
          <input
            type="checkbox"
            checked={state.versatile}
            onChange={(e) => {
              state.setVersatile(e.target.checked);
            }}
          />
          duas mãos (Versatile)
        </label>
      )}
      {targetId !== '' && riders.length > 0 && (
        <fieldset className="attack-riders">
          <legend>Dano extra no próximo ataque</legend>
          {riders.map((r) => (
            <span key={r.id} className="check">
              <label className="check" title={r.note}>
                <input
                  type="checkbox"
                  checked={state.riders.has(r.id)}
                  onChange={(e) => {
                    state.setRider(r.id, e.target.checked, r.types.length > 1 ? r.types[0] : undefined);
                  }}
                />
                {r.name} (+{r.dice}
                {r.oncePerTurn ? ', 1×/turno' : ''}
                {r.cost ? ', gasta um uso' : ''})
              </label>
              {state.riders.has(r.id) && r.types.length > 1 && (
                <select
                  aria-label={`Tipo de dano de ${r.name}`}
                  value={state.riders.get(r.id) ?? r.types[0]}
                  onChange={(e) => {
                    state.setRider(r.id, true, r.types.find((t) => t === e.target.value));
                  }}
                >
                  {r.types.map((t) => (
                    <option key={t} value={t}>
                      {DAMAGE_LABEL[t]}
                    </option>
                  ))}
                </select>
              )}
            </span>
          ))}
        </fieldset>
      )}
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}

/** Botão pequeno de rolar (d20). */
export function RollButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="roll-button" title={label} aria-label={label} onClick={onClick}>
      d20
    </button>
  );
}
