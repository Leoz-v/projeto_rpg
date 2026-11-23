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
  /** Ataque com a arma: contra o alvo escolhido (CA, dano proposto) ou, sem alvo, só a rolagem. */
  attack: (instanceId: string) => void;
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
  error: string | null;
}

export function useRoller(characterId: string): RollState {
  const [declared, setDeclared] = useState<Declared>('normal');
  const [secret, setSecret] = useState(false);
  const [versatile, setVersatile] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibility = secret ? ('gm' as const) : ('public' as const);
  const declaredFlags = {
    ...(declared === 'advantage' ? { advantage: true } : {}),
    ...(declared === 'disadvantage' ? { disadvantage: true } : {}),
  };
  const roller: Roller = {
    attack: (instanceId) => {
      if (targetId === null) {
        roller.roll({ kind: 'attack', instanceId });
        return;
      }
      void sendIntent({ kind: 'attack.make', data: { attacker: { characterId, instanceId }, targetTokenId: targetId, ...declaredFlags, visibility } }).then((refused) => {
        setError(refused);
        if (!refused) setDeclared('normal');
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
  return { roller, declared, setDeclared, secret, setSecret, versatile, setVersatile, targetId, setTargetId, error };
}

const DECLARED: readonly { value: Declared; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'advantage', label: 'Vantagem' },
  { value: 'disadvantage', label: 'Desvantagem' },
];

/** Opções da próxima rolagem: Vantagem/Desvantagem declarada, secreta, duas mãos. */
export function RollToolbar({ state, hasVersatile, targets }: { state: RollState; hasVersatile: boolean; targets: readonly TargetOption[] }) {
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
