import { type ReactNode, useState } from 'react';
import type { InventoryLine } from 'rules-engine';
import type { ChatEntry, SessionCharacter } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { ABILITY_LABEL, signed } from './sheet-labels';

/** Cargas e magias de itens (nota 0075): a conta, o gasto à mão, conjurar pelo item e as entradas do chat. */

type Charges = NonNullable<InventoryLine['charges']>;

export function ItemChargesControl({ character, line, charges }: { character: SessionCharacter; line: InventoryLine; charges: Charges }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState('');
  const options = charges.spells.flatMap((s) => s.costs.map((c) => ({ key: `${s.spellId}:${c.charges}`, spellId: s.spellId, charges: c.charges, label: `${s.name}${c.level > s.level ? ` (${c.level}º círculo)` : ''} · ${c.charges} carga(s)${s.note !== undefined ? ` · ${s.note}` : ''}` })));
  const option = options.find((o) => o.key === picked) ?? options[0];

  const send = (intent: Parameters<typeof sendIntent>[0]): void => {
    setBusy(true);
    void sendIntent(intent).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };
  const change = (kind: 'spend' | 'restore'): void => {
    send({ kind: 'item.charges', data: { characterId: character.id, instanceId: line.instanceId, change: kind, amount: 1 } });
  };

  return (
    <div className="item-charges">
      <span className="hint" title={charges.regain !== undefined ? `Recupera ${charges.regain} ao amanhecer` : 'Não recupera cargas'}>
        Cargas {charges.available}/{charges.max}
      </span>
      <button type="button" className="small secondary" aria-label={`Gastar uma carga de ${line.name}`} disabled={busy || charges.available === 0} onClick={() => { change('spend'); }}>
        −1
      </button>
      <button type="button" className="small secondary" aria-label={`Devolver uma carga de ${line.name}`} disabled={busy || charges.available === charges.max} onClick={() => { change('restore'); }}>
        +1
      </button>
      {option && (
        <>
          <select
            aria-label={`Magia de ${line.name}`}
            value={option.key}
            onChange={(e) => {
              setPicked(e.target.value);
            }}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key} disabled={o.charges > charges.available}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="small"
            disabled={busy || option.charges > charges.available}
            onClick={() => {
              send({ kind: 'item.cast', data: { characterId: character.id, instanceId: line.instanceId, spellId: option.spellId, charges: option.charges } });
            }}
          >
            Conjurar
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Botão do mestre: os itens de todos recuperam cargas. */
export function DawnPanel() {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel" aria-label="Amanhecer">
      <div className="row">
        <span className="hint">Os itens de todos recuperam cargas.</span>
        <button type="button" className="secondary" onClick={() => void sendIntent({ kind: 'items.dawn', data: {} }).then(setError)}>
          Amanhecer
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function ItemChargesBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'item_charges' }>; header: ReactNode }) {
  const { event } = entry;
  const d20 = entry.d20 !== undefined ? ` (1d20: ${entry.d20})` : '';
  return (
    <li className="entry slot-event">
      {header}
      <p>
        {event === 'destroyed' && `Última carga${d20}: ${entry.itemName}, de ${entry.characterName}, foi destruído`}
        {event === 'last' && `Última carga de ${entry.itemName}, de ${entry.characterName}${d20}`}
        {event === 'spent' && `${entry.characterName} gastou ${entry.amount} carga(s) de ${entry.itemName} (${entry.available}/${entry.max})`}
        {event === 'restored' && `${entry.itemName}, de ${entry.characterName}: ${entry.amount} carga(s) de volta (${entry.available}/${entry.max})`}
      </p>
      {entry.notes.map((n) => (
        <p key={n} className="hint">
          {n}
        </p>
      ))}
    </li>
  );
}

export function DawnBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'dawn' }>; header: ReactNode }) {
  return (
    <li className="entry slot-event">
      {header}
      <p>Amanheceu.</p>
      {entry.items.length === 0 && <p className="hint">Nenhum item tinha cargas a recuperar.</p>}
      {entry.items.map((r, i) => (
        <p key={i} className="hint">
          {r.itemName}, de {r.characterName}: {r.dice} = {r.rolled} ({r.available}/{r.max})
        </p>
      ))}
    </li>
  );
}

export function ScrollCheckBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'scroll_check' }>; header: ReactNode }) {
  return (
    <li className="entry roll">
      {header}
      <p>
        <span className="roll-label">{entry.characterName}</span> · pergaminho de {entry.spellName}: teste de {ABILITY_LABEL[entry.ability].long}, CD {entry.dc}
      </p>
      <p className="roll-result">
        {entry.dice.map((d, i) => (
          <span key={i} className="die">
            {d}
          </span>
        ))}
        <span className="modifier">{signed(entry.modifier)}</span>
        <span className="total">= {entry.total}</span>
        <span className="tag">{entry.success ? 'sucesso' : 'falha: o pergaminho se perdeu'}</span>
      </p>
      {[...entry.advantage.map((a) => `Vantagem: ${a}`), ...entry.disadvantage.map((d) => `Desvantagem: ${d}`), ...entry.notes].map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
    </li>
  );
}
