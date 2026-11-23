import { type SyntheticEvent, useEffect, useState } from 'react';
import type { Size } from 'rules-engine/schemas';
import type { ImportedAsset, MonsterSummary, TableView } from '../../../shared/ipc';
import type { MapStage } from '../canvas/MapStage';
import { placeToken, tokenSide } from '../canvas/geometry';
import { sendIntent } from '../store/table';
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

function Maps({ view, onError }: { view: TableView; onError: (m: string | null) => void }) {
  const { maps, activeMapId } = view.state;
  const [name, setName] = useState('');
  const [width, setWidth] = useState('30');
  const [height, setHeight] = useState('20');
  const [background, setBackground] = useState<ImportedAsset | null>(null);
  const [open, setOpen] = useState(Object.keys(maps).length === 0);

  const create = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    const refused = await sendIntent({
      kind: 'map.create',
      data: { name: name.trim(), width: Number(width), height: Number(height), ...(background ? { background: background.sha256 } : {}) },
    });
    onError(refused);
    if (refused) return;
    setName('');
    setBackground(null);
    setOpen(false);
  };

  return (
    <section className="panel" aria-label="Mapas">
      <h2>Mapas</h2>
      <ul>
        {Object.values(maps).map((m) => (
          <li key={m.id}>
            {m.name}{' '}
            <span className="hint">
              ({m.width}×{m.height})
            </span>
            {m.id === activeMapId ? (
              <span className="tag">na tela</span>
            ) : (
              <button type="button" className="link" onClick={() => void sendIntent({ kind: 'map.activate', data: { mapId: m.id } }).then(onError)}>
                Mostrar
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
          <span className="hint">Imagem de fundo (opcional), esticada para o tamanho do mapa:</span>
          <ImagePicker value={background} onChange={setBackground} onError={onError} />
          <div className="row">
            <button type="submit">Criar mapa</button>
            {Object.keys(maps).length > 0 && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          Novo mapa
        </button>
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

function Tokens({ view, stage, selectedId, onError }: { view: TableView; stage: MapStage | null; selectedId: string | null; onError: (m: string | null) => void }) {
  const { state } = view;
  const map = state.activeMapId !== null ? state.maps[state.activeMapId] : undefined;
  const [query, setQuery] = useState('');
  const [monster, setMonster] = useState<MonsterSummary | null>(null);
  const [name, setName] = useState('');
  const [size, setSize] = useState<Size>('medium');
  const [owners, setOwners] = useState<string[]>([]);
  const [image, setImage] = useState<ImportedAsset | null>(null);
  const results = useMonsterSearch(monster ? '' : query);
  const players = Object.entries(state.players).filter(([, p]) => p.role === 'player');
  const selected = selectedId !== null ? state.tokens[selectedId] : undefined;

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
        <div className="selected">
          <span>
            Selecionado: <strong>{selected.name}</strong>
          </span>
          <button type="button" className="link danger" onClick={() => void sendIntent({ kind: 'token.remove', data: { tokenId: selected.id } }).then(onError)}>
            Remover token
          </button>
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
        <ImagePicker value={image} onChange={setImage} onError={onError} />
        <button type="submit">Colocar no mapa</button>
      </form>
    </section>
  );
}

export function GmPanel({ view, stage, selectedId }: { view: TableView; stage: MapStage | null; selectedId: string | null }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Maps view={view} onError={setError} />
      <Tokens view={view} stage={stage} selectedId={selectedId} onError={setError} />
    </>
  );
}
