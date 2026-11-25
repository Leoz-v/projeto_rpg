import { type ChangeEvent, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { availableMonsterUses } from 'rules-engine/monster-uses';
import type { Size } from 'rules-engine/schemas';
import type { ImportedAsset, MonsterAction, MonsterSummary, TableView } from '../../../shared/ipc';
import { type GameMap, MAX_VISION_FEET, MIN_VISION_FEET, type Token } from '../../../shared/protocol';
import type { MapStageHandle } from '../canvas/MapStage';
import type { FogTool } from '../canvas/fog-render';
import { placeToken, tokenSide } from '../canvas/geometry';
import { defaultCellPx, gridDimensionsForImage } from '../canvas/map-grid';
import { parseMapDocument } from '../canvas3d/map/mapDocument';
import { sendIntent } from '../store/table';
import { tokenHealth } from '../canvas/health';
import { usesLabel } from './MonsterBlock';
import { TokenEffects } from './TokenEffects';
import { tokenConditions } from '../canvas/conditions';
import { combatantOptions } from '../canvas/conditions';
import { ConditionsControl } from './Conditions';
import { FogPanel } from './FogPanel';
import { HitPointsControl, HitPointsSummary } from './HitPoints';
import { MapGridModal } from './MapGridModal';
import type { MapViewerMode } from './MapView';
import { RestPanel } from './Rest';
import { forceSave, SaveEffectForm, TargetChecklist, type TargetOption } from './SaveEffect';
import { ABILITY_LABEL, CONDITION_LABEL, DAMAGE_LABEL, signed } from './sheet-labels';
import { nextTokenName } from './token-name';

/** Painel do mestre: mapas (criar e mostrar) e tokens (colocar e remover). Tudo vira `Intent`. */

const SIZES: readonly { value: Size; label: string }[] = [
  { value: 'tiny', label: 'Miúdo' },
  { value: 'small', label: 'Pequeno' },
  { value: 'medium', label: 'Médio' },
  { value: 'large', label: 'Grande' },
  { value: 'huge', label: 'Enorme' },
  { value: 'gargantuan', label: 'Imenso' },
];
const sizeLabel = (size: Size): string => SIZES.find((s) => s.value === size)?.label ?? size;
const crLabel = (cr: number): string => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' })[cr] ?? String(cr);

/** Abre o seletor de imagens; devolve a imagem, `null` se cancelou, ou a mensagem de erro. */
async function chooseImage(): Promise<ImportedAsset | null | string> {
  const result = await window.vtt.importAsset();
  return result.ok ? result.value : result.error.message;
}

function ImagePicker({ value, onChange, onError }: { value: ImportedAsset | null; onChange: (a: ImportedAsset | null) => void; onError: (m: string) => void }) {
  return (
    <div className="image-picker">
      <button
        type="button"
        className="secondary"
        onClick={() =>
          void chooseImage().then((picked) => {
            if (typeof picked === 'string') onError(picked);
            else if (picked) onChange(picked);
          })
        }
      >
        {value ? 'Trocar imagem…' : 'Escolher imagem…'}
      </button>
      {value && (
        <>
          <img src={`vtt-asset://${value.sha256}`} alt="" className="thumb" />
          <button
            type="button"
            className="link"
            onClick={() => {
              onChange(null);
            }}
          >
            Remover
          </button>
        </>
      )}
    </div>
  );
}

/** Carrega a imagem importada para ler as dimensões reais e alimentar o preview do grid. */
function loadMapImage(sha256: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error('Não foi possível carregar a imagem do mapa'));
    };
    img.src = `vtt-asset://${sha256}`;
  });
}

interface BackgroundGrid {
  asset: ImportedAsset;
  image: HTMLImageElement;
  cellPx: number;
}

function Maps({
  view,
  activeViewerMode,
  onSelectViewerMode,
  onError,
  onOpen3dEditor,
}: {
  view: TableView;
  activeViewerMode: MapViewerMode;
  onSelectViewerMode: (mapId: string, mode: MapViewerMode) => void;
  onError: (m: string | null) => void;
  onOpen3dEditor: (map: GameMap | null) => void;
}) {
  const { maps, activeMapId } = view.state;
  const [name, setName] = useState('');
  const [width, setWidth] = useState('30');
  const [height, setHeight] = useState('20');
  const [background, setBackground] = useState<BackgroundGrid | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [importing3d, setImporting3d] = useState(false);
  const import3dInputRef = useRef<HTMLInputElement>(null);

  const handleImport3dFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting3d(true);
    onError(null);
    try {
      const text = await file.text();
      const raw: unknown = JSON.parse(text);
      const fallbackName = file.name.replace(/\.vttmap\.json$/i, '').replace(/\.json$/i, '') || 'Mapa 3D';
      const doc = parseMapDocument(raw, fallbackName);
      const stored = await window.vtt.save3dMapAsset(JSON.stringify(doc));
      if (!stored.ok) {
        onError(stored.error.message);
        return;
      }
      const mapName = doc.name.trim().slice(0, 100) || fallbackName.slice(0, 100);
      const refused = await sendIntent({
        kind: 'map.create',
        data: {
          name: mapName,
          width: doc.terrain.width,
          height: doc.terrain.length,
          scene3d: stored.value.sha256,
        },
      });
      onError(refused);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Arquivo de mapa 3D inválido');
    } finally {
      setImporting3d(false);
    }
  };

  const backgroundDims = background
    ? gridDimensionsForImage({ width: background.image.naturalWidth, height: background.image.naturalHeight }, background.cellPx)
    : null;

  const handleBackgroundChange = (asset: ImportedAsset | null): void => {
    if (!asset) {
      setBackground(null);
      setPreviewOpen(false);
      return;
    }
    void loadMapImage(asset.sha256).then(
      (image) => {
        const cellPx = defaultCellPx({ width: image.naturalWidth, height: image.naturalHeight });
        setBackground({ asset, image, cellPx });
        setPreviewOpen(true);
        onError(null);
      },
      (err: unknown) => {
        onError(err instanceof Error ? err.message : 'Não foi possível carregar a imagem do mapa');
      },
    );
  };

  const create = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    const mapWidth = backgroundDims ? backgroundDims.width : Number(width);
    const mapHeight = backgroundDims ? backgroundDims.height : Number(height);
    const refused = await sendIntent({
      kind: 'map.create',
      data: {
        name: name.trim(),
        width: mapWidth,
        height: mapHeight,
        ...(background ? { background: background.asset.sha256, cellPx: background.cellPx } : {}),
      },
    });
    onError(refused);
    if (refused) return;
    setName('');
    setBackground(null);
    setPreviewOpen(false);
    setOpen(false);
  };

  return (
    <section className="panel" aria-label="Mapas">
      <h2>Mapas</h2>
      <ul>
        {Object.values(maps).map((m) => (
          <li key={m.id}>
            {m.name}{' '}
            {m.scene3d !== null && <span className="tag">3D</span>}{' '}
            <span className="hint">
              ({m.width}×{m.height}
              {m.cellPx !== null ? `, ${m.cellPx} px` : ''})
            </span>
            {m.id === activeMapId ? (
              <>
                <span className="tag">na tela ({activeViewerMode.toUpperCase()})</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onSelectViewerMode(m.id, activeViewerMode === '2d' ? '3d' : '2d');
                  }}
                >
                  {activeViewerMode === '2d' ? 'Abrir em 3D' : 'Abrir em 2D'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onSelectViewerMode(m.id, '2d');
                    void sendIntent({ kind: 'map.activate', data: { mapId: m.id } }).then(onError);
                  }}
                >
                  Abrir 2D
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onSelectViewerMode(m.id, '3d');
                    void sendIntent({ kind: 'map.activate', data: { mapId: m.id } }).then(onError);
                  }}
                >
                  Abrir 3D
                </button>
              </>
            )}
            {m.scene3d !== null && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  onOpen3dEditor(m);
                }}
              >
                Editar 3D
              </button>
            )}
          </li>
        ))}
      </ul>
      {open ? (
        <form className="stack" onSubmit={(e) => void create(e)}>
          <label>
            Nome do mapa
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              required
              maxLength={100}
            />
          </label>
          <span className="hint">Imagem de fundo (opcional) — define o grid por pixels sem distorcer:</span>
          <ImagePicker value={background?.asset ?? null} onChange={handleBackgroundChange} onError={onError} />
          {background && backgroundDims ? (
            <div className="grid-config-card">
              <div className="grid-config-info">
                <strong>
                  {background.cellPx} px / célula → {backgroundDims.width} × {backgroundDims.height} células
                </strong>
                <span className="hint">
                  {background.image.naturalWidth} × {background.image.naturalHeight} px
                  {backgroundDims.exact ? ' · divisão exata' : ' · borda parcial'}
                </span>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setPreviewOpen(true);
                }}
              >
                Ajustar grid…
              </button>
            </div>
          ) : (
            <div className="row">
              <label>
                Largura (células)
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={width}
                  onChange={(e) => {
                    setWidth(e.target.value);
                  }}
                  required
                />
              </label>
              <label>
                Altura (células)
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={height}
                  onChange={(e) => {
                    setHeight(e.target.value);
                  }}
                  required
                />
              </label>
            </div>
          )}
          <div className="row">
            <button type="submit">Criar mapa</button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setOpen(true);
              }}
            >
              Novo mapa 2D
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onOpen3dEditor(null);
              }}
            >
              Novo mapa 3D
            </button>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={importing3d}
            onClick={() => {
              import3dInputRef.current?.click();
            }}
          >
            {importing3d ? 'Importando mapa 3D…' : 'Importar mapa 3D (.vttmap.json)…'}
          </button>
          <input
            ref={import3dInputRef}
            type="file"
            accept=".json,.vttmap.json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              void handleImport3dFile(e);
            }}
          />
        </div>
      )}
      {previewOpen && background && (
        <MapGridModal
          image={background.image}
          initialCellPx={background.cellPx}
          onApply={(cellPx) => {
            setBackground((current) => (current ? { ...current, cellPx } : null));
            setPreviewOpen(false);
          }}
          onCancel={() => {
            setPreviewOpen(false);
          }}
        />
      )}
    </section>
  );
}

/** Busca no compêndio enquanto o mestre digita. */
function useMonsterSearch(query: string): MonsterSummary[] {
  const [found, setFound] = useState<{ query: string; results: MonsterSummary[] }>({ query: '', results: [] });
  const active = query.trim().length >= 2;
  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = setTimeout(() => {
      void window.vtt.searchMonsters(query).then((r) => {
        if (current) setFound({ query, results: r.ok ? r.value : [] });
      });
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, active]);
  // Resultado de uma busca antiga, ou consulta curta demais: nada.
  return active && found.query === query ? found.results : [];
}

function Tokens({ view, stage, selectedId, onError }: { view: TableView; stage: MapStageHandle | null; selectedId: string | null; onError: (m: string | null) => void }) {
  const { state } = view;
  const map = state.activeMapId !== null ? state.maps[state.activeMapId] : undefined;
  const [query, setQuery] = useState('');
  const [monster, setMonster] = useState<MonsterSummary | null>(null);
  const [name, setName] = useState('');
  const [size, setSize] = useState<Size>('medium');
  const [owners, setOwners] = useState<string[]>([]);
  const [image, setImage] = useState<ImportedAsset | null>(null);
  const [hpMax, setHpMax] = useState('');
  const results = useMonsterSearch(monster ? '' : query);
  const players = Object.entries(state.players).filter(([, p]) => p.role === 'player');
  const selected = selectedId !== null ? state.tokens[selectedId] : undefined;
  const selectedHealth = selected ? tokenHealth(selected, state.characters, {}) : null;

  if (!map) return null;
  const namesOnMap = Object.values(state.tokens)
    .filter((t) => t.mapId === map.id)
    .map((t) => t.name);

  const choose = (m: MonsterSummary): void => {
    setMonster(m);
    setSize(m.size);
    setName(nextTokenName(m.name, namesOnMap));
    setQuery('');
    // Monstro novo não herda os donos do token anterior.
    setOwners([]);
  };

  const place = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    // No centro da tela, encaixado no grid e dentro do mapa.
    const center = stage?.viewCenter() ?? { x: 0, y: 0 };
    const half = tokenSide(size) / 2;
    const position = placeToken({ x: center.x - half, y: center.y - half }, size, map);
    const refused = await sendIntent({
      kind: 'token.create',
      data: {
        mapId: map.id,
        name: name.trim(),
        position,
        size,
        ...(monster ? { monsterId: monster.id } : {}),
        ...(image ? { image: image.sha256 } : {}),
        ...(owners.length > 0 ? { ownerIds: owners } : {}),
        ...(hpMax.trim() !== '' && Number.isInteger(Number(hpMax)) && Number(hpMax) >= 1 ? { hpMax: Number(hpMax) } : {}),
      },
    });
    onError(refused);
    if (refused) return;
    // Donos e imagem não passam para o próximo token (um ogre não vira da Ana sem querer).
    setOwners([]);
    setImage(null);
    // O próximo do mesmo monstro já vem numerado.
    if (monster) setName(nextTokenName(monster.name, [...namesOnMap, name.trim()]));
  };

  return (
    <section className="panel" aria-label="Tokens">
      <h2>Tokens</h2>
      {selected && (
        <div className="selected stack">
          <div className="row">
            <span>
              Selecionado: <strong>{selected.name}</strong>
            </span>
            <button type="button" className="link danger" onClick={() => void sendIntent({ kind: 'token.remove', data: { tokenId: selected.id } }).then(onError)}>
              Remover token
            </button>
          </div>
          {selected.characterId === null ? (
            <>
              {selectedHealth && (
                <span>
                  PV <HitPointsSummary health={selectedHealth} />
                </span>
              )}
              <HitPointsControl key={selected.id} target={{ tokenId: selected.id }} health={selectedHealth} allowMax />
              <ConditionsControl key={`conditions:${selected.id}`} target={{ tokenId: selected.id }} state={selected.conditions} canEdit combatants={combatantOptions(state)} />
              <TokenEffects token={selected} canEdit />
              {selected.monsterId !== null && (
                <MonsterActions
                  key={`actions:${selected.id}`}
                  tokenId={selected.id}
                  uses={selected.uses}
                  monsterId={selected.monsterId}
                  targets={Object.values(state.tokens).filter((t) => t.mapId === selected.mapId && t.id !== selected.id)}
                  onError={onError}
                />
              )}
            </>
          ) : (
            <>
              <p className="hint">Os PV deste token são os do personagem: mude na ficha.</p>
              <ConditionsControl
                key={`conditions:${selected.id}`}
                target={{ tokenId: selected.id }}
                state={tokenConditions(selected, state.characters)}
                canEdit
                combatants={combatantOptions(state)}
              />
            </>
          )}
          <TokenVisionControl key={`vision:${selected.id}`} token={selected} defaultFeet={map.fog.visionFeet} onError={onError} />
        </div>
      )}
      <form className="stack" onSubmit={(e) => void place(e)}>
        {monster ? (
          <div className="chosen">
            <span>
              {monster.name}{' '}
              <span className="hint">
                ({sizeLabel(monster.size)}, ND {crLabel(monster.cr)})
              </span>
            </span>
            <button
              type="button"
              className="link"
              onClick={() => {
                setMonster(null);
              }}
            >
              Trocar
            </button>
          </div>
        ) : (
          <label>
            Monstro do compêndio (opcional)
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              placeholder="ex.: goblin"
            />
          </label>
        )}
        {results.length > 0 && (
          <ul className="results">
            {results.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    choose(m);
                  }}
                >
                  {m.name}
                </button>{' '}
                <span className="hint">
                  {sizeLabel(m.size)}, ND {crLabel(m.cr)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <label>
          Nome do token
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            required
            maxLength={100}
          />
        </label>
        <label>
          Tamanho
          <select
            value={size}
            onChange={(e) => {
              setSize(SIZES.find((s) => s.value === e.target.value)?.value ?? 'medium');
            }}
          >
            {SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {players.length > 0 && (
          <fieldset>
            <legend>Quem pode mover</legend>
            {players.map(([id, p]) => (
              <label key={id} className="check">
                <input
                  type="checkbox"
                  checked={owners.includes(id)}
                  onChange={(e) => {
                    setOwners(e.target.checked ? [...owners, id] : owners.filter((o) => o !== id));
                  }}
                />
                {p.displayName}
              </label>
            ))}
          </fieldset>
        )}
        <label>
          PV máximos (opcional)
          <input
            type="number"
            min={1}
            value={hpMax}
            placeholder={monster ? 'média do monstro' : 'sem PV'}
            onChange={(e) => {
              setHpMax(e.target.value);
            }}
          />
        </label>
        <ImagePicker value={image} onChange={setImage} onError={onError} />
        <button type="submit">Colocar no mapa</button>
      </form>
    </section>
  );
}

/** Ações do monstro do token selecionado: ataques contra um alvo e salvaguardas contra vários (o dano vira proposta no chat). */
function MonsterActions({ tokenId, uses, monsterId, targets, onError }: { tokenId: string; uses: Token['uses']; monsterId: string; targets: readonly TargetOption[]; onError: (m: string | null) => void }) {
  const [actions, setActions] = useState<MonsterAction[]>([]);
  const [targetId, setTargetId] = useState('');
  const [saveTargets, setSaveTargets] = useState<string[]>([]);
  const [declared, setDeclared] = useState<'normal' | 'advantage' | 'disadvantage'>('normal');
  useEffect(() => {
    let current = true;
    void window.vtt.monsterActions(monsterId).then((r) => {
      if (current && r.ok) setActions(r.value);
    });
    return () => {
      current = false;
    };
  }, [monsterId]);
  if (actions.length === 0) return null;
  const attacks = actions.filter((a) => a.kind === 'attack');
  const saves = actions.filter((a) => a.kind === 'save');
  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const damageText = (damage: MonsterAction['damage']): string => damage.map((d) => `${d.dice} ${DAMAGE_LABEL[d.type].toLowerCase()}`).join(' + ');

  const spent = (a: MonsterAction): boolean => a.limit !== undefined && availableMonsterUses({ id: a.id, limit: a.limit }, uses) === 0;
  const limitText = (a: MonsterAction): string => (a.limit !== undefined ? ` · ${usesLabel({ id: a.id, limit: a.limit }, uses)}` : '');

  const attack = (actionId: string): void => {
    if (!target) return;
    void sendIntent({
      kind: 'attack.make',
      data: {
        attacker: { tokenId, actionId },
        targetTokenId: target.id,
        ...(declared === 'advantage' ? { advantage: true } : {}),
        ...(declared === 'disadvantage' ? { disadvantage: true } : {}),
        visibility: 'public',
      },
    }).then(onError);
  };

  return (
    <div className="monster-attacks stack">
      {attacks.length > 0 && (
        <>
          <h3>Ataques</h3>
          <label>
            Alvo
            <select
              value={target?.id ?? ''}
              onChange={(e) => {
                setTargetId(e.target.value);
              }}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label="Vantagem ou Desvantagem"
            value={declared}
            onChange={(e) => {
              setDeclared(e.target.value === 'advantage' ? 'advantage' : e.target.value === 'disadvantage' ? 'disadvantage' : 'normal');
            }}
          >
            <option value="normal">Rolagem normal</option>
            <option value="advantage">Com Vantagem</option>
            <option value="disadvantage">Com Desvantagem</option>
          </select>
          <ul>
            {attacks.map((a) => (
              <li key={a.id}>
                <button type="button" className="secondary small" disabled={!target || spent(a)} onClick={() => { attack(a.id); }}>
                  {a.name}
                </button>
                <span className="hint">
                  {signed(a.toHit)} · {damageText(a.damage)}{limitText(a)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {saves.length > 0 && (
        <>
          <h3>Salvaguardas</h3>
          <TargetChecklist targets={targets} selected={saveTargets} onChange={setSaveTargets} />
          <ul>
            {saves.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={saveTargets.length === 0 || spent(a)}
                    onClick={() => {
                      void forceSave({ tokenId, actionId: a.id }, saveTargets, false).then(onError);
                    }}
                  >
                    {a.name}
                  </button>
                  <span className="hint">
                    {ABILITY_LABEL[a.ability].short} CD {a.dc}
                    {a.damage.length > 0 && ` · ${damageText(a.damage)}${a.onSuccess === 'half' ? ' (metade no sucesso)' : ''}`}
                    {a.conditions.length > 0 && ` · ${a.conditions.map((c) => CONDITION_LABEL[c]).join(', ')}`}
                    {limitText(a)}
                  </span>
                </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Token de um personagem da mesa: nome, tamanho (da ficha) e dono vêm do
 * personagem, e o token fica ligado a ele (`characterId`).
 */
function CharacterTokens({ view, stage, onError }: { view: TableView; stage: MapStageHandle | null; onError: (m: string | null) => void }) {
  const { state } = view;
  const map = state.activeMapId !== null ? state.maps[state.activeMapId] : undefined;
  const characters = Object.values(state.characters).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const [characterId, setCharacterId] = useState('');
  const [busy, setBusy] = useState(false);
  if (!map || characters.length === 0) return null;
  const chosen = state.characters[characterId] ?? characters[0];
  if (!chosen) return null;
  const onMap = Object.values(state.tokens).some((t) => t.mapId === map.id && t.characterId === chosen.id);

  const place = async (): Promise<void> => {
    setBusy(true);
    const sheet = await window.vtt.characterSheet(chosen.id);
    const size: Size = (sheet.ok ? sheet.value.sheet?.size : undefined) ?? 'medium';
    const center = stage?.viewCenter() ?? { x: 0, y: 0 };
    const half = tokenSide(size) / 2;
    const position = placeToken({ x: center.x - half, y: center.y - half }, size, map);
    const refused = await sendIntent({
      kind: 'token.create',
      data: { mapId: map.id, name: chosen.name, position, size, ownerIds: [chosen.ownerId], characterId: chosen.id },
    });
    setBusy(false);
    onError(refused);
  };

  return (
    <section className="panel" aria-label="Tokens de personagens">
      <h2>Personagem no mapa</h2>
      <div className="stack">
        <label>
          Personagem
          <select
            value={chosen.id}
            onChange={(e) => {
              setCharacterId(e.target.value);
            }}
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({state.players[c.ownerId]?.displayName ?? '?'})
              </option>
            ))}
          </select>
        </label>
        {onMap && <p className="hint">Já tem um token neste mapa.</p>}
        <button type="button" disabled={busy} onClick={() => void place()}>
          Colocar personagem
        </button>
      </div>
    </section>
  );
}

function TokenVisionControl({ token, defaultFeet, onError }: { token: Token; defaultFeet: number; onError: (m: string | null) => void }) {
  const saved = token.visionFeet !== null ? String(token.visionFeet) : '';
  const [draft, setDraft] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setDraft(saved);
  }

  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (token.visionFeet !== null) void sendIntent({ kind: 'token.vision', data: { tokenId: token.id, visionFeet: null } }).then(onError);
      return;
    }
    const parsed = Math.round(Number(trimmed));
    if (!Number.isFinite(parsed) || parsed < MIN_VISION_FEET || parsed > MAX_VISION_FEET) {
      setDraft(token.visionFeet !== null ? String(token.visionFeet) : '');
      return;
    }
    if (parsed !== token.visionFeet) void sendIntent({ kind: 'token.vision', data: { tokenId: token.id, visionFeet: parsed } }).then(onError);
  };

  return (
    <label>
      Visão do token (pés, vazio = padrão {defaultFeet})
      <input
        type="number"
        min={MIN_VISION_FEET}
        max={MAX_VISION_FEET}
        step={5}
        placeholder={`Padrão (${defaultFeet})`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

export function GmPanel({
  view,
  stage,
  selectedId,
  fogTool,
  onFogTool,
  activeViewerMode,
  onSelectViewerMode,
  onOpen3dEditor,
}: {
  view: TableView;
  stage: MapStageHandle | null;
  selectedId: string | null;
  fogTool: FogTool;
  onFogTool: (tool: FogTool) => void;
  activeViewerMode: MapViewerMode;
  onSelectViewerMode: (mapId: string, mode: MapViewerMode) => void;
  onOpen3dEditor: (map: GameMap | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Maps
        view={view}
        activeViewerMode={activeViewerMode}
        onSelectViewerMode={onSelectViewerMode}
        onError={setError}
        onOpen3dEditor={onOpen3dEditor}
      />
      <FogPanel view={view} fogTool={fogTool} onFogTool={onFogTool} onError={setError} />
      <RestPanel state={view.state} />
      <CharacterTokens view={view} stage={stage} onError={setError} />
      <Tokens view={view} stage={stage} selectedId={selectedId} onError={setError} />
      {view.state.activeMapId !== null && (
        <section className="panel" aria-label="Efeito com salvaguarda">
          <SaveEffectForm targets={Object.values(view.state.tokens).filter((t) => t.mapId === view.state.activeMapId)} />
        </section>
      )}
    </>
  );
}
