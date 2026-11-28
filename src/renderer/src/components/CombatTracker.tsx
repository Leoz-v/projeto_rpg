import { useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import { type Intent, MAX_INITIATIVE, MIN_INITIATIVE, type Token } from '../../../shared/protocol';
import { sendIntent } from '../store/table';

/**
 * Combate: ordem de turnos, rodada e o combatente da vez. O mestre inicia
 * (com os tokens do mapa e os surpresos), passa e volta turnos, ajusta a
 * iniciativa, tira e põe combatentes e encerra; o jogador passa o próprio
 * turno. A iniciativa dos monstros chega `null` para jogadores (só a ordem).
 */

/** O jogador controla o token: dono do token ou do personagem que ele representa. */
function controls(view: TableView, token: Token | undefined): boolean {
  if (!token) return false;
  if (view.info.role === 'gm' || token.ownerIds.includes(view.info.playerId)) return true;
  return token.characterId !== null && view.state.characters[token.characterId]?.ownerId === view.info.playerId;
}

function useSend(): { send: (intent: Intent) => void; error: string | null; busy: boolean } {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = (intent: Intent): void => {
    setBusy(true);
    void sendIntent(intent).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };
  return { send, error, busy };
}

/** Escolha dos tokens que entram no combate (início ou depois), com os surpresos. */
function JoinForm({ tokens, label, kind }: { tokens: readonly Token[]; label: string; kind: 'combat.start' | 'combat.add' }) {
  // No início, todos os tokens do mapa entram, menos os desmarcados; depois, só os marcados.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const isPicked = (id: string): boolean => (kind === 'combat.start' ? !toggled.has(id) : toggled.has(id));
  const [surprised, setSurprised] = useState<ReadonlySet<string>>(new Set());
  const { send, error, busy } = useSend();
  const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };
  const ids = tokens.map((t) => t.id).filter(isPicked);
  if (tokens.length === 0) return <p className="hint">{kind === 'combat.start' ? 'Ponha tokens no mapa para iniciar um combate.' : 'Todos os tokens do mapa já estão no combate.'}</p>;
  return (
    <div className="combat-join">
      <ul>
        {tokens.map((t) => (
          <li key={t.id}>
            <label>
              <input
                type="checkbox"
                checked={isPicked(t.id)}
                onChange={() => {
                  setToggled(toggle(toggled, t.id));
                }}
              />
              {t.name}
            </label>
            {isPicked(t.id) && (
              <label className="hint" title="Desvantagem na iniciativa">
                <input
                  type="checkbox"
                  checked={surprised.has(t.id)}
                  onChange={() => {
                    setSurprised(toggle(surprised, t.id));
                  }}
                />
                surpreso
              </label>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="small"
        disabled={busy || ids.length === 0}
        onClick={() => {
          const surprisedTokenIds = ids.filter((id) => surprised.has(id));
          send({ kind, data: { tokenIds: ids, ...(surprisedTokenIds.length > 0 ? { surprisedTokenIds } : {}) } });
          setToggled(new Set());
          setSurprised(new Set());
        }}
      >
        {label}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Iniciativa editável pelo mestre (override): grava ao sair do campo ou com Enter. */
function InitiativeInput({ tokenId, value }: { tokenId: string; value: number }) {
  const [draft, setDraft] = useState(String(value));
  const [saved, setSaved] = useState(value);
  const { send } = useSend();
  // O valor mudou no estado (outro override): o campo acompanha.
  if (saved !== value) {
    setSaved(value);
    setDraft(String(value));
  }
  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isInteger(n) || n < MIN_INITIATIVE || n > MAX_INITIATIVE) {
      setDraft(String(value));
      return;
    }
    if (n !== value) send({ kind: 'combat.set_initiative', data: { tokenId, initiative: n } });
  };
  return (
    <input
      type="number"
      className="initiative-input"
      aria-label="Iniciativa"
      min={MIN_INITIATIVE}
      max={MAX_INITIATIVE}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

export function CombatTracker({ view, onSelect }: { view: TableView; onSelect: (tokenId: string) => void }) {
  const { state, info } = view;
  const combat = state.combat;
  const gm = info.role === 'gm';
  const { send, error, busy } = useSend();
  const mapTokens = Object.values(state.tokens).filter((t) => t.mapId === state.activeMapId);

  if (!combat) {
    if (!gm) return null;
    return (
      <section className="combat" aria-label="Combate">
        <h2>Combate</h2>
        <JoinForm tokens={mapTokens} label="Iniciar combate" kind="combat.start" />
      </section>
    );
  }

  const current = combat.hiddenTurn ? undefined : combat.combatants[combat.turn];
  const currentToken = current ? state.tokens[current.tokenId] : undefined;
  const outside = mapTokens.filter((t) => !combat.combatants.some((c) => c.tokenId === t.id));
  return (
    <section className="combat active" aria-label="Combate">
      <h2>
        Combate <span className="tag">rodada {combat.round}</span>
      </h2>
      <ol className="turn-order">
        {combat.combatants.map((c) => {
          const token = state.tokens[c.tokenId];
          const isCurrent = c === current;
          return (
            <li key={c.tokenId} className={isCurrent ? 'current' : undefined} aria-current={isCurrent ? 'step' : undefined}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  onSelect(c.tokenId);
                }}
              >
                {token?.name ?? 'Fora da visão'}
              </button>
              {gm && c.initiative !== null ? (
                <InitiativeInput tokenId={c.tokenId} value={c.initiative} />
              ) : (
                <span className="initiative" title={c.initiative === null ? 'Iniciativa só para o mestre' : 'Iniciativa'}>
                  {c.initiative ?? '?'}
                </span>
              )}
              {gm && (
                <button
                  type="button"
                  className="link"
                  title="Tirar do combate"
                  aria-label={`Tirar ${token?.name ?? 'token'} do combate`}
                  onClick={() => {
                    send({ kind: 'combat.remove', data: { tokenId: c.tokenId } });
                  }}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {combat.hiddenTurn && <p className="hint">Vez do mestre</p>}
      <div className="combat-actions">
        {gm && (
          <button type="button" className="secondary small" disabled={busy} onClick={() => { send({ kind: 'combat.previous', data: {} }); }}>
            Turno anterior
          </button>
        )}
        {(gm || controls(view, currentToken)) && (
          <button type="button" className="small" disabled={busy} onClick={() => { send({ kind: 'combat.next', data: {} }); }}>
            {gm ? 'Próximo turno' : 'Encerrar meu turno'}
          </button>
        )}
        {gm && (
          <button
            type="button"
            className="secondary small danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Encerrar o combate?')) send({ kind: 'combat.end', data: {} });
            }}
          >
            Encerrar combate
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {gm && outside.length > 0 && (
        <details>
          <summary>Adicionar ao combate</summary>
          <JoinForm tokens={outside} label="Adicionar" kind="combat.add" />
        </details>
      )}
    </section>
  );
}
