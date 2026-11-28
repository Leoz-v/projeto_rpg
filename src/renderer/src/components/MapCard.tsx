import { useEffect, useState } from 'react';
import type { GameMap } from '../../../shared/protocol';
import type { MapViewerMode } from './MapView';
import { defaultViewerModeForMap, formatMapMeta, mapKind, render3dPreviewDataUrl } from './map-preview';

/**
 * Card visual de um mapa criado na campanha: mostra miniatura (imagem 2D,
 * mapa de terreno 3D top-down ou prévia estilizada do grid), badges de tipo e
 * estado ativo, metadados e ações rápidas.
 */

function use3dPreview(scene3d: string | null, mapName: string): string | null {
  const [loaded, setLoaded] = useState<{ hash: string; url: string } | null>(null);

  useEffect(() => {
    if (scene3d === null) return;
    let active = true;
    void render3dPreviewDataUrl(scene3d, mapName).then(
      (url) => {
        if (active) setLoaded({ hash: scene3d, url });
      },
      () => {
        // Falha silenciosa: o card mantém o fundo estilizado de mapa 3D.
      },
    );
    return () => {
      active = false;
    };
  }, [scene3d, mapName]);

  return scene3d !== null && loaded?.hash === scene3d ? loaded.url : null;
}

export interface MapCardProps {
  map: GameMap;
  tokenCount: number;
  isActive: boolean;
  activeViewerMode: MapViewerMode;
  onActivate: (mapId: string, mode: MapViewerMode) => void;
  onSwitchViewerMode: (mapId: string, mode: MapViewerMode) => void;
  onOpen3dEditor: (map: GameMap) => void;
}

export function MapCard({
  map,
  tokenCount,
  isActive,
  activeViewerMode,
  onActivate,
  onSwitchViewerMode,
  onOpen3dEditor,
}: MapCardProps) {
  const kind = mapKind(map);
  const preview3dUrl = use3dPreview(map.scene3d, map.name);
  const [failedBackground, setFailedBackground] = useState<string | null>(null);
  const imageFailed = map.background !== null && failedBackground === map.background;
  const meta = formatMapMeta(map, tokenCount);

  const previewContent = (
    <>
      {kind === 'image2d' && map.background !== null && !imageFailed ? (
        <img
          src={`vtt-asset://${map.background}`}
          alt=""
          className="map-card-image"
          onError={() => {
            setFailedBackground(map.background);
          }}
        />
      ) : kind === '3d' && preview3dUrl !== null ? (
        <img src={preview3dUrl} alt="" className="map-card-image map-card-image-3d" />
      ) : (
        <div className={`map-card-placeholder kind-${kind}`} aria-hidden="true">
          <div className="map-card-grid-frame" style={{ aspectRatio: `${map.width} / ${map.height}` }} />
          <span className="map-card-placeholder-label">{kind === '3d' ? 'Cena 3D' : `${map.width} × ${map.height}`}</span>
        </div>
      )}
      <div className="map-card-scrim" aria-hidden="true" />
      <div className="map-card-badges">
        <span className={`map-card-badge kind-${kind}`}>
          {kind === '3d' ? '3D' : kind === 'image2d' ? '2D' : 'Grid'}
        </span>
        {isActive && (
          <span className="map-card-badge live">
            <span className="map-card-live-dot" aria-hidden="true" />
            na tela ({activeViewerMode.toUpperCase()})
          </span>
        )}
      </div>
    </>
  );

  return (
    <li className={isActive ? 'map-card active' : 'map-card'}>
      {isActive ? (
        <div className="map-card-preview">{previewContent}</div>
      ) : (
        <button
          type="button"
          className="map-card-preview"
          aria-label={`Abrir mapa ${map.name}`}
          onClick={() => {
            onActivate(map.id, defaultViewerModeForMap(map));
          }}
        >
          {previewContent}
        </button>
      )}
      <div className="map-card-body">
        <div className="map-card-header">
          <strong className="map-card-title" title={map.name}>
            {map.name}
          </strong>
          <span className="map-card-meta">{meta}</span>
        </div>
        <div className="map-card-actions">
          {isActive ? (
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                onSwitchViewerMode(map.id, activeViewerMode === '2d' ? '3d' : '2d');
              }}
            >
              {activeViewerMode === '2d' ? 'Abrir em 3D' : 'Abrir em 2D'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  onActivate(map.id, '2d');
                }}
              >
                Abrir 2D
              </button>
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  onActivate(map.id, '3d');
                }}
              >
                Abrir 3D
              </button>
            </>
          )}
          {map.scene3d !== null && (
            <button
              type="button"
              className="secondary small map-card-edit-3d"
              onClick={() => {
                onOpen3dEditor(map);
              }}
            >
              Editar 3D
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
