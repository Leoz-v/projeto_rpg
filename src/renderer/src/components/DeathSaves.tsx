import { type ReactNode, useState } from 'react';
import type { ChatEntry, DeathSaves } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { signed } from './sheet-labels';

/**
 * Salvaguardas contra a Morte (nota 0044): o estado na ficha e as entradas do
 * chat. As regras (sucesso, falha, Estável, morte) ficam no motor, no Host.
 */

const MODE_LABEL = { advantage: 'Vantagem', disadvantage: 'Desvantagem' } as const;
const OUTCOME_LABEL = { success: 'sucesso', failure: 'falha', two_failures: 'duas falhas', revived: 'recupera 1 PV' } as const;
const CAUSE_LABEL = { damage: 'Dano', healing: 'Cura', gm: 'Mestre', exhaustion: 'Exaustão' } as const;

/** "Morto", "Estável" ou a contagem (✔✔○ ✘○○). */
export function DeathSavesTally({ state }: { state: DeathSaves }) {
  if (state.dead) return <span className="tag death-tag">Morto</span>;
  if (state.stable) return <span className="tag stable-tag">Estável</span>;
  const pips = (count: number, mark: string, label: string) => (
    <span className="death-pips" aria-label={`${count} ${label}`} title={`${count} ${label}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < count ? 'pip on' : 'pip'}>
          {i < count ? mark : '○'}
        </span>
      ))}
    </span>
  );
  return (
    <span className="death-tally">
      {pips(state.successes, '✔', 'sucesso(s)')} {pips(state.failures, '✘', 'falha(s)')}
    </span>
  );
}

const ALIVE: DeathSaves = { successes: 0, failures: 0, stable: false, dead: false };

/**
 * Painel da ficha: aparece com 0 PV ou com algum estado a mostrar. O jogador
 * rola fora do combate (no combate, o Host rola no início do turno); o mestre
 * estabiliza, revive ou zera.
 */
export function DeathSavesPanel({
  characterId,
  state,
  currentHp,
  canRoll,
  inCombat,
  isGm,
  onRoll,
}: {
  characterId: string;
  state: DeathSaves;
  currentHp: number;
  canRoll: boolean;
  inCombat: boolean;
  isGm: boolean;
  onRoll: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const touched = state.dead || state.stable || state.successes > 0 || state.failures > 0;
  if (currentHp > 0 && !touched) return null;
  const set = (deathSaves: DeathSaves): void => {
    void sendIntent({ kind: 'death.set', data: { characterId, deathSaves } }).then(setError);
  };
  const dying = currentHp === 0 && !state.stable && !state.dead;
  return (
    <section className="death-saves" aria-label="Salvaguardas contra a Morte">
      <p>
        <strong>Salvaguardas contra a Morte</strong> <DeathSavesTally state={state} />
      </p>
      {dying && inCombat && <p className="hint">O Host rola no início do turno.</p>}
      <div className="death-actions">
        {dying && canRoll && !inCombat && (
          <button type="button" className="small" onClick={onRoll}>
            Rolar salvaguarda
          </button>
        )}
        {isGm && dying && (
          <button type="button" className="small secondary" onClick={() => { set({ ...ALIVE, stable: true }); }} title="Medicine CD 10, Spare the Dying…">
            Estabilizar
          </button>
        )}
        {isGm && state.dead && (
          <button type="button" className="small secondary" onClick={() => { set(ALIVE); }} title="Raise Dead, Revivify…: depois, cure os PV">
            Reviver
          </button>
        )}
        {isGm && !state.dead && touched && (
          <button type="button" className="small secondary" onClick={() => { set(ALIVE); }}>
            Zerar contagem
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function DeathSaveBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'death_save' }>; header: ReactNode }) {
  const keptIndex = entry.dice.indexOf(entry.natural);
  const good = entry.outcome === 'success' || entry.outcome === 'revived';
  return (
    <li className={`entry roll death-event${good ? '' : ' bad'}`}>
      {header}
      <p>
        <span className="roll-label">Salvaguarda contra a Morte</span> · {entry.characterName}
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
        <span className="tag">{OUTCOME_LABEL[entry.outcome]}</span>
      </p>
      <p>
        <DeathSavesTally state={entry.deathSaves} />
      </p>
      {entry.notes.map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
    </li>
  );
}

export function DeathStateBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'death_state' }>; header: ReactNode }) {
  return (
    <li className={`entry death-event${entry.deathSaves.dead ? ' bad' : ''}`}>
      {header}
      <p>
        <span className="roll-label">{CAUSE_LABEL[entry.cause]}</span> · {entry.characterName} <DeathSavesTally state={entry.deathSaves} />
      </p>
      {entry.notes.map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
    </li>
  );
}
