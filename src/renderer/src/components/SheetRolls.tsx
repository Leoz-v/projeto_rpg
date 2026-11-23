import { useState } from 'react';
import type { SheetRollTarget } from '../../../shared/protocol';
import { sendIntent } from '../store/table';

/**
 * Rolar a partir da ficha: a tela só pede (`roll.d20`, `roll.damage`); o Host
 * calcula o modificador e as regras com o motor e rola com o RNG dele. O
 * resultado aparece no chat.
 */

export interface Roller {
  roll: (target: SheetRollTarget) => void;
  damage: (instanceId: string, critical: boolean) => void;
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
  error: string | null;
}

export function useRoller(characterId: string): RollState {
  const [declared, setDeclared] = useState<Declared>('normal');
  const [secret, setSecret] = useState(false);
  const [versatile, setVersatile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibility = secret ? ('gm' as const) : ('public' as const);
  const roller: Roller = {
    roll: (target) => {
      void sendIntent({
        kind: 'roll.d20',
        data: {
          characterId,
          target,
          ...(declared === 'advantage' ? { advantage: true } : {}),
          ...(declared === 'disadvantage' ? { disadvantage: true } : {}),
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
  return { roller, declared, setDeclared, secret, setSecret, versatile, setVersatile, error };
}

const DECLARED: readonly { value: Declared; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'advantage', label: 'Vantagem' },
  { value: 'disadvantage', label: 'Desvantagem' },
];

/** Opções da próxima rolagem: Vantagem/Desvantagem declarada, secreta, duas mãos. */
export function RollToolbar({ state, hasVersatile }: { state: RollState; hasVersatile: boolean }) {
  return (
    <div className="roll-toolbar">
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
