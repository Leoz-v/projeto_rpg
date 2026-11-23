import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import { sendIntent } from '../store/table';

/**
 * Personagens da campanha na barra lateral: os seus primeiros, depois os dos
 * outros. Criar um personagem é um `Intent` ao Host; o mestre pode criar para
 * qualquer jogador que já entrou na mesa.
 */

export function Characters({ view, onOpen }: { view: TableView; onOpen: (characterId: string) => void }) {
  const { playerId, role } = view.info;
  const isGm = role === 'gm';
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState(playerId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Personagem pedido ao Host (que gera o id): é o novo com esse nome e dono, fora dos ids que já existiam. */
  const awaiting = useRef<{ known: Set<string>; name: string; ownerId: string } | null>(null);

  useEffect(() => {
    const wanted = awaiting.current;
    if (!wanted) return;
    const created = Object.values(view.state.characters).find((c) => !wanted.known.has(c.id) && c.name === wanted.name && c.ownerId === wanted.ownerId);
    if (!created) return;
    awaiting.current = null;
    onOpen(created.id);
  });

  const characters = Object.values(view.state.characters).sort(
    (a, b) => Number(b.ownerId === playerId) - Number(a.ownerId === playerId) || a.name.localeCompare(b.name, 'pt-BR'),
  );
  const players = Object.entries(view.state.players).sort(([, a], [, b]) => a.displayName.localeCompare(b.displayName, 'pt-BR'));

  const create = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    setBusy(true);
    const known = new Set(Object.keys(view.state.characters));
    const refused = await sendIntent({ kind: 'character.create', data: { name: trimmed, ...(ownerId !== playerId ? { ownerId } : {}) } });
    setBusy(false);
    setError(refused);
    if (refused) return;
    awaiting.current = { known, name: trimmed, ownerId };
    setName('');
  };

  return (
    <section className="panel characters" aria-label="Personagens">
      <h2>Personagens</h2>
      {characters.length === 0 ? (
        <p className="hint">Nenhum personagem ainda.</p>
      ) : (
        <ul>
          {characters.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  onOpen(c.id);
                }}
              >
                {c.name}
              </button>
              {c.ownerId === playerId ? <span className="tag">seu</span> : <small className="hint">{view.state.players[c.ownerId]?.displayName ?? '?'}</small>}
              {c.baseScores === null && <small className="hint">rascunho</small>}
            </li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={(e) => void create(e)}>
        <label>
          Novo personagem
          <input
            value={name}
            maxLength={100}
            placeholder="Nome"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </label>
        {isGm && (
          <label>
            Jogador
            <select
              value={ownerId}
              onChange={(e) => {
                setOwnerId(e.target.value);
              }}
            >
              {players.map(([id, p]) => (
                <option key={id} value={id}>
                  {p.displayName}
                  {id === playerId ? ' (você)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || name.trim() === ''}>
          Criar personagem
        </button>
      </form>
    </section>
  );
}
