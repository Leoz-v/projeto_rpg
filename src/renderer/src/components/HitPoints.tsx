import { type SyntheticEvent, useState } from 'react';
import type { Health } from '../canvas/health';
import { sendIntent } from '../store/table';

/**
 * PV atuais com dano, cura e PV temporários. As regras (temporários absorvem
 * primeiro, cura até o máximo) ficam no motor, no Host; aqui só se pede.
 */

type Target = { characterId: string } | { tokenId: string };
type Kind = 'damage' | 'healing' | 'temp' | 'max';

export function HitPointsSummary({ health }: { health: Health }) {
  return (
    <span className="hp-summary">
      <strong>{health.current}</strong> / {health.max}
      {health.temp > 0 && <span className="hp-temp"> +{health.temp} temp.</span>}
    </span>
  );
}

export function HitPointsControl({ target, health, allowMax = false }: { target: Target; health: Health | null; allowMax?: boolean }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = Number(amount);
  const valid = amount.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 100_000;

  const send = (kind: Kind) => (e?: SyntheticEvent): void => {
    e?.preventDefault();
    if (!valid || (kind === 'max' && value < 1)) return;
    setBusy(true);
    void sendIntent({ kind: 'hp.change', data: { target, change: { kind, amount: value } } }).then((refused) => {
      setBusy(false);
      setError(refused);
      if (!refused) setAmount('');
    });
  };

  return (
    <form className="hp-control" onSubmit={send('damage')}>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        placeholder="valor"
        aria-label="Valor de PV"
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setError(null);
        }}
      />
      {health && (
        <>
          <button type="submit" className="danger-fill" disabled={busy || !valid}>
            Dano
          </button>
          <button type="button" className="heal" disabled={busy || !valid} onClick={send('healing')}>
            Cura
          </button>
          <button type="button" className="secondary" disabled={busy || !valid} onClick={send('temp')} title="Substitui os PV temporários atuais (eles não se acumulam)">
            PV temp.
          </button>
        </>
      )}
      {allowMax && (
        <button type="button" className="secondary" disabled={busy || !valid || value < 1} onClick={send('max')}>
          {health ? 'Definir máximo' : 'Definir PV máximos'}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
