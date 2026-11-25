import { type SyntheticEvent, useEffect, useState } from 'react';
import type { DerivedSheet, InventoryLine } from 'rules-engine';
import type { ItemSummary } from '../../../shared/ipc';
import type { SessionCharacter, SessionState } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { ItemUseForm } from './ItemUse';

/**
 * Inventário na ficha. A lista e o que está ativo vêm do motor (`sheet.inventory`);
 * cada mudança é um `Intent` ao Host. Regras que dependem da ficha (uma
 * armadura por vez, limite e restrição de sintonização) aparecem nas
 * pendências da ficha, sem bloquear.
 */

const COINS = [
  { key: 'pp', label: 'PL' },
  { key: 'gp', label: 'PO' },
  { key: 'ep', label: 'PE' },
  { key: 'sp', label: 'PP' },
  { key: 'cp', label: 'PC' },
] as const;

const RARITY: Record<string, string> = {
  common: 'comum',
  uncommon: 'incomum',
  rare: 'raro',
  very_rare: 'muito raro',
  legendary: 'lendário',
  artifact: 'artefato',
};

const KIND: Record<ItemSummary['kind'], string> = { weapon: 'arma', armor: 'armadura', tool: 'ferramenta', gear: 'equipamento', magic_item: 'item mágico' };

/** Itens que fazem sentido vestir ou empunhar. */
const canEquip = (line: InventoryLine): boolean => line.kind === 'weapon' || line.kind === 'armor' || line.kind === 'magic_item';

function useItemSearch(query: string): ItemSummary[] {
  const [found, setFound] = useState<{ query: string; results: ItemSummary[] }>({ query: '', results: [] });
  const active = query.trim().length >= 2;
  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = setTimeout(() => {
      void window.vtt.searchItems(query).then((r) => {
        if (current) setFound({ query, results: r.ok ? r.value : [] });
      });
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, active]);
  return active && found.query === query ? found.results : [];
}

function Coins({ character, canEdit, onError }: { character: SessionCharacter; canEdit: boolean; onError: (m: string | null) => void }) {
  const saved = character.inventory.currency;
  const [draft, setDraft] = useState(saved);
  const [seen, setSeen] = useState(saved);
  // Moedas mudaram no Host (outra tela, o mestre): o rascunho acompanha.
  if (seen !== saved) {
    setSeen(saved);
    setDraft(saved);
  }
  const dirty = COINS.some(({ key }) => draft[key] !== saved[key]);
  const save = (e: SyntheticEvent): void => {
    e.preventDefault();
    void sendIntent({ kind: 'inventory.currency', data: { characterId: character.id, currency: draft } }).then(onError);
  };
  return (
    <form className="coins" onSubmit={save}>
      {COINS.map(({ key, label }) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={0}
            value={draft[key]}
            disabled={!canEdit}
            onChange={(e) => {
              const value = Math.max(0, Math.floor(Number(e.target.value) || 0));
              setDraft({ ...draft, [key]: value });
            }}
          />
        </label>
      ))}
      {canEdit && dirty && <button type="submit">Salvar moedas</button>}
    </form>
  );
}

function AddItem({ character, onError }: { character: SessionCharacter; onError: (m: string | null) => void }) {
  const [query, setQuery] = useState('');
  const [item, setItem] = useState<ItemSummary | null>(null);
  const [variantId, setVariantId] = useState('');
  const [baseId, setBaseId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const results = useItemSearch(item ? '' : query);

  const choose = (found: ItemSummary): void => {
    setItem(found);
    setVariantId(found.variants[0]?.id ?? '');
    setBaseId(found.bases[0]?.id ?? '');
    setQuantity(1);
  };

  const add = (e: SyntheticEvent): void => {
    e.preventDefault();
    if (!item) return;
    void sendIntent({
      kind: 'inventory.add',
      data: {
        characterId: character.id,
        itemId: item.id,
        ...(item.variants.length > 0 ? { variantId } : {}),
        ...(item.bases.length > 1 ? { baseItemId: baseId } : {}),
        ...(quantity > 1 ? { quantity } : {}),
      },
    }).then((refused) => {
      onError(refused);
      if (!refused) {
        setItem(null);
        setQuery('');
      }
    });
  };

  return (
    <form className="add-item stack" onSubmit={add}>
      {item ? (
        <div className="chosen">
          <span>
            {item.name} <span className="hint">({[KIND[item.kind], ...(item.rarity ?? []).map((r) => RARITY[r] ?? r)].join(', ')})</span>
          </span>
          <button
            type="button"
            className="link"
            onClick={() => {
              setItem(null);
            }}
          >
            Trocar
          </button>
        </div>
      ) : (
        <label>
          Adicionar item do compêndio
          <input
            type="search"
            value={query}
            placeholder="ex.: longsword, potion, rope"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </label>
      )}
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  choose(r);
                }}
              >
                {r.name}
              </button>{' '}
              <span className="hint">
                {KIND[r.kind]}
                {r.attunement ? ', sintonização' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {item && (
        <div className="row">
          {item.variants.length > 0 && (
            <label>
              Variante
              <select
                value={variantId}
                onChange={(e) => {
                  setVariantId(e.target.value);
                }}
              >
                {item.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {item.bases.length > 1 && (
            <label>
              Item base
              <select
                value={baseId}
                onChange={(e) => {
                  setBaseId(e.target.value);
                }}
              >
                {item.bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="quantity">
            Qtd.
            <input
              type="number"
              min={1}
              max={9999}
              value={quantity}
              onChange={(e) => {
                setQuantity(Math.min(9999, Math.max(1, Math.floor(Number(e.target.value) || 1))));
              }}
            />
          </label>
          <button type="submit">Adicionar</button>
        </div>
      )}
      {item?.attunementBy && <p className="hint">Sintonização {item.attunementBy}.</p>}
    </form>
  );
}

export function Inventory({ character, sheet, state, canEdit }: { character: SessionCharacter; sheet: DerivedSheet; state: SessionState; canEdit: boolean }) {
  const [usingId, setUsingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = character.id;
  const update = (line: InventoryLine, change: { equipped?: boolean; attuned?: boolean; quantity?: number }): void => {
    void sendIntent({ kind: 'inventory.update', data: { characterId: id, instanceId: line.instanceId, ...change } }).then(setError);
  };
  const remove = (line: InventoryLine, quantity?: number): void => {
    void sendIntent({ kind: 'inventory.remove', data: { characterId: id, instanceId: line.instanceId, ...(quantity !== undefined ? { quantity } : {}) } }).then(setError);
  };

  return (
    <section className="inventory" aria-label="Inventário">
      <div className="row inventory-heading">
        <h3>Inventário</h3>
        <span className={`hint${sheet.attunement.used > sheet.attunement.limit ? ' error' : ''}`}>
          Sintonizados: {sheet.attunement.used} de {sheet.attunement.limit}
        </span>
      </div>
      <Coins character={character} canEdit={canEdit} onError={setError} />
      {sheet.inventory.length === 0 ? (
        <p className="hint">Nenhum item.</p>
      ) : (
        <ul className="items">
          {sheet.inventory.map((line) => (
            <li key={line.instanceId} className={line.active ? 'active' : ''}>
              <span className="item-name">
                {line.name}
                {line.quantity > 1 && <span className="hint"> × {line.quantity}</span>}
                {(line.equipped || line.attuned) && !line.active && <span className="tag">sem efeito</span>}
              </span>
              {canEdit ? (
                <span className="item-actions">
                  {canEquip(line) && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={line.equipped}
                        onChange={(e) => {
                          update(line, { equipped: e.target.checked });
                        }}
                      />
                      equipado
                    </label>
                  )}
                  {line.requiresAttunement && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={line.attuned}
                        onChange={(e) => {
                          update(line, { attuned: e.target.checked });
                        }}
                      />
                      sintonizado
                    </label>
                  )}
                  {line.use && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setUsingId(usingId === line.instanceId ? null : line.instanceId);
                      }}
                    >
                      usar
                    </button>
                  )}
                  {line.quantity > 1 && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        remove(line, 1);
                      }}
                    >
                      −1
                    </button>
                  )}
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => {
                      if (window.confirm(`Remover ${line.name}${line.quantity > 1 ? ` (${line.quantity})` : ''}?`)) remove(line);
                    }}
                  >
                    remover
                  </button>
                </span>
              ) : (
                <span className="hint">{[line.equipped ? 'equipado' : '', line.attuned ? 'sintonizado' : ''].filter(Boolean).join(', ')}</span>
              )}
              {canEdit && line.use && usingId === line.instanceId && (
                <ItemUseForm
                  character={character}
                  line={line}
                  use={line.use}
                  state={state}
                  onDone={() => {
                    setUsingId(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {canEdit && <AddItem character={character} onError={setError} />}
    </section>
  );
}
