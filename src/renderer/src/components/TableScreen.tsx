import { useCallback, useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import type { GameMap } from '../../../shared/protocol';
import { leaveTable } from '../store/table';
import { AboutButton } from './About';
import type { MapStageHandle } from '../canvas/MapStage';
import type { FogTool } from '../canvas/fog-render';
import { CharacterSheet } from './CharacterSheet';
import { Characters } from './Characters';
import { Chat } from './Chat';
import { CombatTracker } from './CombatTracker';
import { GmPanel } from './GmPanel';
import { Map3DEditorModal } from './Map3DEditorModal';
import { type MapViewerMode, MapView } from './MapView';

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
  const [stage, setStage] = useState<MapStageHandle | null>(null);
  const [selected, setSelectedId] = useState<string | null>(null);
  const [fogTool, setFogTool] = useState<FogTool>('none');
  // Um token removido deixa de estar selecionado.
  const selectedId = selected !== null && selected in view.state.tokens ? selected : null;
  const isHost = view.info.mode === 'host';
  const [openCharacterId, setOpenCharacterId] = useState<string | null>(null);
  const [editor3d, setEditor3d] = useState<{ map: GameMap | null } | null>(null);
  const [viewerByMap, setViewerByMap] = useState<Record<string, MapViewerMode>>({});
  const closeSheet = useCallback(() => {
    setOpenCharacterId(null);
  }, []);
  const open3dEditor = useCallback((map: GameMap | null) => {
    setEditor3d({ map });
  }, []);
  const close3dEditor = useCallback(() => {
    setEditor3d(null);
  }, []);
  const setMapViewerMode = useCallback((mapId: string, mode: MapViewerMode) => {
    setViewerByMap((prev) => ({ ...prev, [mapId]: mode }));
  }, []);

  const activeMap = view.state.activeMapId !== null ? (view.state.maps[view.state.activeMapId] ?? null) : null;
  const activeViewerMode: MapViewerMode = activeMap
    ? (viewerByMap[activeMap.id] ?? (activeMap.scene3d !== null ? '3d' : '2d'))
    : '2d';
  const handleActiveViewerChange = useCallback(
    (mode: MapViewerMode) => {
      if (activeMap) setMapViewerMode(activeMap.id, mode);
    },
    [activeMap, setMapViewerMode],
  );

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
        {view.info.role === 'gm' && (
          <GmPanel
            view={view}
            stage={stage}
            selectedId={selectedId}
            fogTool={fogTool}
            onFogTool={setFogTool}
            activeViewerMode={activeViewerMode}
            onSelectViewerMode={setMapViewerMode}
            onOpen3dEditor={open3dEditor}
          />
        )}
        <HostAddresses view={view} />
      </aside>
      <MapView
        view={view}
        viewerMode={activeViewerMode}
        onViewerModeChange={handleActiveViewerChange}
        selectedId={selectedId}
        fogTool={fogTool}
        onFogTool={setFogTool}
        onSelect={setSelectedId}
        onStage={setStage}
        {...(view.info.role === 'gm' ? { onEdit3dMap: open3dEditor } : {})}
      />
      <Chat state={view.state} chatFrom={view.chatFrom} viewer={view.info} />
      {openCharacterId !== null && <CharacterSheet view={view} characterId={openCharacterId} onClose={closeSheet} />}
      {view.info.role === 'gm' && editor3d !== null && <Map3DEditorModal editingMap={editor3d.map} onClose={close3dEditor} />}
    </div>
  );
}
