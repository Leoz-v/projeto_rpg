import { useCallback, useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import { leaveTable } from '../store/table';
import { AboutButton } from './About';
import type { MapStage } from '../canvas/MapStage';
import { CharacterSheet } from './CharacterSheet';
import { Characters } from './Characters';
import { Chat } from './Chat';
import { CombatTracker } from './CombatTracker';
import { GmPanel } from './GmPanel';
import { MapView } from './MapView';

/** A mesa: cabeçalho, barra lateral (jogadores e, para o mestre, mapas e tokens), mapa e chat. */

function Players({ view }: { view: TableView }) {
  const players = Object.entries(view.state.players).sort(([, a], [, b]) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'pt-BR') : a.role === 'gm' ? -1 : 1));
  return (
    <section className="players" aria-label="Jogadores">
      <h2>Na mesa</h2>
      <ul>
        {players.map(([id, p]) => (
          <li key={id} className={p.connected ? 'online' : 'offline'}>
            <span className="dot" aria-hidden />
            {p.displayName}
            {p.role === 'gm' && <span className="tag">mestre</span>}
            {id === view.info.playerId && <span className="tag">você</span>}
            {!p.connected && <span className="sr-only"> (desconectado)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HostAddresses({ view }: { view: TableView }) {
  const { addresses = [], port } = view.info;
  if (view.info.mode !== 'host' || port === undefined) return null;
  return (
    <section className="addresses" aria-label="Endereços da mesa">
      <h2>Endereço para os jogadores</h2>
      {addresses.length === 0 ? (
        <p className="hint">Nenhuma rede encontrada. Confira se o Tailscale ou o ZeroTier está ligado.</p>
      ) : (
        <ul>
          {addresses.map((a) => (
            <li key={a}>
              <code>
                {a}:{port}
              </code>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Na rede virtual, use o endereço dela (Tailscale começa com 100.).</p>
    </section>
  );
}

/** Token selecionado que representa um personagem: atalho para a ficha. */
function SelectedCharacter({ view, tokenId, onOpen }: { view: TableView; tokenId: string; onOpen: (id: string) => void }) {
  const characterId = view.state.tokens[tokenId]?.characterId;
  const character = characterId ? view.state.characters[characterId] : undefined;
  if (!character) return null;
  return (
    <p className="selected">
      <span>
        Token de <strong>{character.name}</strong>
      </span>
      <button
        type="button"
        className="link"
        onClick={() => {
          onOpen(character.id);
        }}
      >
        Abrir ficha
      </button>
    </p>
  );
}

export function TableScreen({ view }: { view: TableView }) {
  const [leaving, setLeaving] = useState(false);
  const [stage, setStage] = useState<MapStage | null>(null);
  const [selected, setSelectedId] = useState<string | null>(null);
  // Um token removido deixa de estar selecionado.
  const selectedId = selected !== null && selected in view.state.tokens ? selected : null;
  const isHost = view.info.mode === 'host';
  const [openCharacterId, setOpenCharacterId] = useState<string | null>(null);
  const closeSheet = useCallback(() => {
    setOpenCharacterId(null);
  }, []);

  const leave = async (): Promise<void> => {
    if (isHost && !window.confirm('Encerrar a mesa para todos os jogadores?')) return;
    setLeaving(true);
    await leaveTable();
  };

  return (
    <div className="table">
      <header className="table-header">
        <h1>{view.state.campaign.name}</h1>
        <span className="tag">{view.info.role === 'gm' ? 'Mestre' : 'Jogador'}</span>
        <AboutButton className="secondary about-button" />
        <button type="button" onClick={() => void leave()} disabled={leaving}>
          {isHost ? 'Encerrar mesa' : 'Sair da mesa'}
        </button>
      </header>
      <aside className="sidebar">
        <CombatTracker view={view} onSelect={setSelectedId} />
        <Players view={view} />
        <Characters view={view} onOpen={setOpenCharacterId} />
        {selectedId !== null && <SelectedCharacter view={view} tokenId={selectedId} onOpen={setOpenCharacterId} />}
        {view.info.role === 'gm' && <GmPanel view={view} stage={stage} selectedId={selectedId} />}
        <HostAddresses view={view} />
      </aside>
      <MapView view={view} selectedId={selectedId} onSelect={setSelectedId} onStage={setStage} />
      <Chat state={view.state} viewer={view.info} />
      {openCharacterId !== null && <CharacterSheet view={view} characterId={openCharacterId} onClose={closeSheet} />}
    </div>
  );
}
