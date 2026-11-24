import { useEffect, useRef, useState } from 'react';
import type { GameMap } from '../../../shared/protocol';
import '../canvas3d/ui/styles.css';
import { createDefaultInteriorGrid, parseMapDocument } from '../canvas3d/map/mapDocument';
import { AssetManager } from '../canvas3d/render/assetManager';
import { LightingManager } from '../canvas3d/render/lightingSystem';
import { LiquidRenderer } from '../canvas3d/render/liquidRenderer';
import { SceneManager } from '../canvas3d/render/sceneManager';
import { TerrainRenderer } from '../canvas3d/render/terrainRenderer';
import { DEFAULT_MAP_SIZE } from '../canvas3d/terrain/constants';
import { TerrainGrid } from '../canvas3d/terrain/terrainGrid';
import { TerrainHistory } from '../canvas3d/tools/history';
import { ToolController } from '../canvas3d/tools/toolController';
import { EditorUI } from '../canvas3d/ui/editorUI';
import { sendIntent } from '../store/table';

/**
 * Editor completo de mapas 3D (estúdio WorldLab), exclusivo para o mestre ao
 * criar ou editar um mapa 3D da campanha. Salvar envia o documento JSON ao
 * armazenamento de assets (SHA-256) e despacha `map.create` ou `map.update`.
 */

interface Props {
  /** Mapa 3D existente para editar, ou `null` para criar um novo mapa 3D. */
  editingMap: GameMap | null;
  onClose: () => void;
}

export function Map3DEditorModal({ editingMap, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const savedMapIdRef = useRef<string | null>(editingMap?.id ?? null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const rootEl = rootRef.current;
    if (!rootEl) return;

    let cancelled = false;
    const isCancelled = (): boolean => cancelled;
    let cleanup: (() => void) | null = null;

    const mount = async (): Promise<void> => {
      const viewportHost = EditorUI.createShell(rootEl);

      const surfaceGrid = new TerrainGrid(DEFAULT_MAP_SIZE, DEFAULT_MAP_SIZE);
      const interiorGrid = createDefaultInteriorGrid(DEFAULT_MAP_SIZE, DEFAULT_MAP_SIZE);

      const scene = await SceneManager.create(viewportHost, surfaceGrid.width, surfaceGrid.length);
      if (isCancelled()) {
        scene.destroy();
        return;
      }

      const surfaceRenderer = new TerrainRenderer(surfaceGrid, scene.terrainRoot, scene.overlayRoot);
      const interiorRenderer = new TerrainRenderer(interiorGrid, scene.interiorTerrainRoot, scene.overlayRoot);
      const liquids = new LiquidRenderer(
        scene.liquidRoot,
        scene.interiorLiquidRoot,
        scene.overlayRoot,
        surfaceGrid,
        interiorGrid,
      );
      const assets = new AssetManager(surfaceGrid, scene.propsRoot, interiorGrid, scene.interiorPropsRoot);
      const lighting = new LightingManager(scene, scene.lightsRoot);
      lighting.onMoodTintChange = (tintHex) => {
        surfaceRenderer.setUnlitMoodTint(tintHex);
        interiorRenderer.setUnlitMoodTint(tintHex);
        liquids.setUnlitMoodTint(tintHex);
      };
      lighting.setMapBounds(surfaceGrid.width, surfaceGrid.length);

      const surfaceHistory = new TerrainHistory();
      const interiorHistory = new TerrainHistory();
      const controller = new ToolController(
        surfaceGrid,
        interiorGrid,
        scene,
        surfaceRenderer,
        interiorRenderer,
        liquids,
        assets,
        lighting,
        surfaceHistory,
        interiorHistory,
      );

      if (editingMap) {
        controller.mapName = editingMap.name;
      } else {
        controller.mapName = 'Novo mapa 3D';
      }

      scene.app.ticker.add((ticker) => {
        assets.tickAnimations(ticker);
        lighting.tick(ticker.deltaMS / 1000, assets.animationsActive);
      });

      const saveToTable = async (): Promise<void> => {
        setBannerError(null);
        const doc = controller.buildMapDocument();
        const stored = await window.vtt.save3dMapAsset(JSON.stringify(doc));
        if (!stored.ok) {
          setBannerError(stored.error.message);
          return;
        }
        const mapName = doc.name.trim().slice(0, 100) || 'Mapa 3D';
        const existingId = savedMapIdRef.current;
        if (existingId !== null) {
          const refused = await sendIntent({
            kind: 'map.update',
            data: {
              mapId: existingId,
              name: mapName,
              width: doc.terrain.width,
              height: doc.terrain.length,
              scene3d: stored.value.sha256,
            },
          });
          if (refused) {
            setBannerError(refused);
            return;
          }
          controller.isDirty = false;
          ui.render();
          onCloseRef.current();
        } else {
          const refused = await sendIntent({
            kind: 'map.create',
            data: {
              name: mapName,
              width: doc.terrain.width,
              height: doc.terrain.length,
              scene3d: stored.value.sha256,
            },
          });
          if (refused) {
            setBannerError(refused);
            return;
          }
          // Ativa automaticamente o mapa recém-criado para que abrir um mapa 3D seja imediato.
          const table = await window.vtt.getTable();
          if (table.ok && table.value) {
            const created = Object.values(table.value.state.maps).find((m) => m.scene3d === stored.value.sha256);
            if (created) {
              savedMapIdRef.current = created.id;
              if (table.value.state.activeMapId !== created.id) {
                await sendIntent({ kind: 'map.activate', data: { mapId: created.id } });
              }
            }
          }
          controller.isDirty = false;
          ui.render();
          onCloseRef.current();
        }
      };

      const ui = EditorUI.mountIntoShell(rootEl, controller, {
        saveLabel: editingMap ? 'Salvar na mesa' : 'Adicionar à mesa',
        isInCampaign: () => savedMapIdRef.current !== null,
        onSaveToTable: saveToTable,
        onClose: () => {
          onCloseRef.current();
        },
      });

      cleanup = () => {
        ui.destroy();
        controller.destroy();
        assets.destroy();
        scene.destroy();
        rootEl.innerHTML = '';
      };

      const catalog = await assets.loadCatalog();
      if (isCancelled()) return;

      if (catalog.length > 0) {
        const defaultPick =
          catalog.find((e) => e.key === 'alderwatch.carriage_arch') ??
          catalog.find((e) => e.pack === 'alderwatch') ??
          catalog[0] ??
          null;
        controller.assetTool.selectedAsset = defaultPick;
      }

      if (editingMap && editingMap.scene3d !== null) {
        const res = await fetch(`vtt-asset://${editingMap.scene3d}`);
        if (!res.ok) {
          throw new Error(`Não foi possível carregar o mapa 3D (HTTP ${res.status})`);
        }
        const raw: unknown = await res.json();
        const doc = parseMapDocument(raw, editingMap.name);
        if (isCancelled()) return;
        await controller.loadMapDocument(doc);
        controller.isDirty = false;
        ui.render();
      } else {
        controller.syncDynamicLights();
        scene.fitSunShadows();
        controller.isDirty = false;
        ui.render();
      }
    };

    void mount().catch((err: unknown) => {
      if (isCancelled()) return;
      setBannerError(err instanceof Error ? err.message : 'Erro ao abrir o editor 3D');
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [editingMap]);

  return (
    <div className="vtt3d-editor-root" role="dialog" aria-modal="true" aria-label="Editor de mapa 3D">
      <div ref={rootRef} style={{ width: '100%', height: '100%' }} />
      {bannerError && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            bottom: '36px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#4a1820',
            color: '#ffd6dc',
            border: '1px solid #a83244',
            borderRadius: '6px',
            padding: '8px 14px',
            zIndex: 60,
            fontSize: '13px',
          }}
        >
          {bannerError}
        </div>
      )}
    </div>
  );
}
