import { type ReactNode, useState } from 'react';
import type { InventoryLine } from 'rules-engine';
import type { ChatEntry, SessionCharacter, SessionState } from '../../../shared/protocol';
import { sendIntent } from '../store/table';

/** Usar um item consumível (nota 0074): quem usa escolhe os alvos; o Host rola e aplica. */

interface Props {
  character: SessionCharacter;
  line: InventoryLine;
  use: NonNullable<InventoryLine['use']>;
  state: SessionState;
  onDone: () => void;
}

const SELF = 'self';

export function ItemUseForm({ character, line, use, state, onDone }: Props) {
  // Os outros tokens do mapa na tela; o próprio personagem é "Eu".
  const others = Object.values(state.tokens).filter((t) => t.mapId === state.activeMapId && t.characterId !== character.id);
  const [targets, setTargets] = useState<string[]>([SELF]);
  const [option, setOption] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const available = [{ id: SELF, name: `${character.name} (quem usa)` }, ...others];
  // Um token que saiu do mapa deixa de ser alvo.
  const picked = targets.filter((id) => available.some((t) => t.id === id));

  const send = (): void => {
    setBusy(true);
    void sendIntent({
      kind: 'item.use',
      data: {
        characterId: character.id,
        instanceId: line.instanceId,
        self: picked.includes(SELF),
        targetTokenIds: picked.filter((id) => id !== SELF),
        ...(use.options.length > 0 ? { option } : {}),
      },
    }).then((refused) => {
      setBusy(false);
      setError(refused);
      if (!refused) onDone();
    });
  };

  return (
    <form
      className="item-use stack"
      aria-label={`Usar ${line.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {use.targets === 'one' ? (
        <label>
          Alvo
          <select
            value={picked[0] ?? SELF}
            onChange={(e) => {
              setTargets([e.target.value]);
            }}
          >
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <fieldset className="target-list">
          <legend>Alvos na área</legend>
          {available.map((t) => (
            <label key={t.id} className="check">
              <input
                type="checkbox"
                checked={picked.includes(t.id)}
                onChange={(e) => {
                  setTargets(e.target.checked ? [...picked, t.id] : picked.filter((id) => id !== t.id));
                }}
              />
              {t.name}
            </label>
          ))}
        </fieldset>
      )}
      {use.options.length > 0 && (
        <label>
          Escolha
          <select
            value={option}
            onChange={(e) => {
              setOption(Number(e.target.value));
            }}
          >
            {use.options.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <button type="submit" className="small" disabled={busy || picked.length === 0}>
          Confirmar uso
        </button>
        <button type="button" className="link" onClick={onDone}>
          Cancelar
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Item usado, com o texto recolhido. O que ele fez vem nas entradas seguintes. */
export function ItemUsedBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'item_used' }>; header: ReactNode }) {
  return (
    <li className="entry item-used">
      {header}
      <p>
        <span className="roll-label">{entry.characterName}</span> usou {entry.itemName}
        <span className="hint"> (restam {entry.left})</span>
      </p>
      {entry.duration !== undefined && <p className="hint">Duração: {entry.duration}</p>}
      <details>
        <summary>Texto do item</summary>
        <p className="monster-text">{entry.description}</p>
      </details>
    </li>
  );
}
