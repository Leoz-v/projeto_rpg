import { useState } from 'react';
import { spaceSquares } from 'rules-engine/space';
import {
  type LightPreset,
  type MapEnvironment,
  SRD_LIGHT_GEAR_PRESETS,
  SRD_LIGHT_SPELL_PRESETS,
  type TimeOfDay,
} from 'rules-engine/vision';
import {
  type AmbientLight,
  type ExtractedPropLight,
  type GameMap,
  LIGHT_INTERACT_CELLS,
  type LightAttachment,
  type MapLightSource,
  type SessionState,
  type Token,
  WORLD_UNITS_PER_CELL,
} from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import {
  AMBIENT_OVERRIDE_LABELS,
  buildLightInputFromPreset,
  ENVIRONMENT_LABELS,
  TIME_OF_DAY_LABELS,
} from './lighting-hud-helpers';

/**
 * Painel flutuante de iluminação, horário, fontes portáteis, magias e tochas 3D
 * na HUD do mapa (compartilhado entre 2D e 3D; jogadores e mestre).
 */

interface Props {
  map: GameMap;
  isGm: boolean;
  playerId: string;
  selectedToken: Token | null;
  tokens: readonly Token[];
  characters: SessionState['characters'];
  bakedPropLights: readonly ExtractedPropLight[];
  viewCenterCell?: { x: number; y: number };
  onError: (message: string | null) => void;
}

const GEAR_PRESET_IDS = new Set(['torch', 'hooded_lantern', 'bullseye_lantern', 'candle']);
const GEAR_PRESETS = SRD_LIGHT_GEAR_PRESETS.filter((p) => GEAR_PRESET_IDS.has(p.id));
const ENVIRONMENTS: readonly MapEnvironment[] = ['exterior', 'interior'];
const TIMES: readonly TimeOfDay[] = ['day', 'dawn', 'dusk', 'twilight', 'night'];
const AMBIENT_OPTIONS: readonly ('auto' | AmbientLight)[] = ['auto', 'bright', 'dim', 'darkness'];

function controlsToken(token: Token, playerId: string, characters: SessionState['characters']): boolean {
  if (token.ownerIds.includes(playerId)) return true;
  return token.characterId !== null && characters[token.characterId]?.ownerId === playerId;
}

function lightRadiusLabel(light: MapLightSource): string {
  if (light.kind === 'darkness') return `${light.darknessFeet} ft escuridão`;
  return `${light.brightFeet}/${light.dimFeet} ft`;
}

export function LightingHudControls({
  map,
  isGm,
  playerId,
  selectedToken,
  tokens,
  characters,
  bakedPropLights,
  viewCenterCell,
  onError,
}: Props) {
  const canUseSelectedToken =
    selectedToken !== null &&
    selectedToken.mapId === map.id &&
    (isGm || controlsToken(selectedToken, playerId, characters));

  const [attachMode, setAttachMode] = useState<'token' | 'point'>(canUseSelectedToken ? 'token' : 'point');
  const effectiveAttachMode: 'token' | 'point' =
    attachMode === 'token' && canUseSelectedToken ? 'token' : isGm ? 'point' : 'token';

  const ownedTokens = tokens.filter((t) => t.mapId === map.id && controlsToken(t, playerId, characters));
  const targetToken = canUseSelectedToken ? selectedToken : (ownedTokens[0] ?? null);

  const visibleLights = isGm
    ? map.lights
    : map.lights.filter((l) => {
        if (l.ownerId === playerId) return true;
        if (l.attach.kind === 'token') {
          const attachedTokenId = l.attach.tokenId;
          const holder = tokens.find((t) => t.id === attachedTokenId);
          return holder ? controlsToken(holder, playerId, characters) : false;
        }
        return false;
      });

  const visiblePropLights = isGm
    ? bakedPropLights
    : bakedPropLights.filter((prop) => {
        if (map.propLightOverrides[prop.id] === 'removed') return false;
        return ownedTokens.some((t) => {
          const side = spaceSquares(t.size);
          const cx = t.position.x / WORLD_UNITS_PER_CELL + side * 0.5;
          const cy = t.position.y / WORLD_UNITS_PER_CELL + side * 0.5;
          return Math.hypot(cx - prop.x, cy - prop.y) <= LIGHT_INTERACT_CELLS + 1 + side * 0.5;
        });
      });

  const spawnPreset = (preset: LightPreset): void => {
    let attach: LightAttachment | undefined;
    if (effectiveAttachMode === 'token' && targetToken) {
      attach = { kind: 'token', tokenId: targetToken.id };
    } else if (isGm) {
      const center = viewCenterCell ?? { x: map.width / 2, y: map.height / 2 };
      attach = {
        kind: 'point',
        x: Math.max(0, Math.min(map.width, Math.round(center.x * 2) / 2)),
        y: Math.max(0, Math.min(map.height, Math.round(center.y * 2) / 2)),
      };
    }
    if (!attach) {
      onError('Selecione um token seu no mapa para aplicar a fonte de luz');
      return;
    }

    let spellLink: { characterId: string; spellId: string } | undefined;
    if (preset.spellId && targetToken?.characterId) {
      const ch = characters[targetToken.characterId];
      if (ch?.concentration?.spellId === preset.spellId) {
        spellLink = { characterId: ch.id, spellId: preset.spellId };
      }
    }

    const light = buildLightInputFromPreset(preset, attach, spellLink);
    void sendIntent({ kind: 'light.add', data: { mapId: map.id, light } }).then(onError);
  };

  return (
    <div className="fog-popover lighting-popover" role="group" aria-label="Controles de iluminação e fontes de luz">
      {isGm && (
        <>
          <div className="fog-popover-row">
            <span className="ruler-hint">Ambiente</span>
            <div className="map3d-hud-group" role="group" aria-label="Tipo de ambiente">
              {ENVIRONMENTS.map((env) => (
                <button
                  key={env}
                  type="button"
                  className={map.lighting.environment === env ? 'active' : ''}
                  aria-pressed={map.lighting.environment === env}
                  onClick={() => void sendIntent({ kind: 'lighting.config', data: { mapId: map.id, environment: env } }).then(onError)}
                >
                  {ENVIRONMENT_LABELS[env]}
                </button>
              ))}
            </div>
            <label className="fog-hud-vision">
              Sobreposição
              <select
                value={map.lighting.ambientOverride ?? 'auto'}
                onChange={(e) => {
                  const val = e.target.value;
                  const next: AmbientLight | null = val === 'auto' ? null : (val as AmbientLight);
                  void sendIntent({ kind: 'lighting.config', data: { mapId: map.id, ambientOverride: next } }).then(onError);
                }}
              >
                {AMBIENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {AMBIENT_OVERRIDE_LABELS[opt]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="fog-popover-row">
            <span className="ruler-hint">Horário</span>
            <div className="map3d-hud-group" role="group" aria-label="Horário do dia">
              {TIMES.map((tod) => (
                <button
                  key={tod}
                  type="button"
                  className={map.lighting.timeOfDay === tod ? 'active' : ''}
                  aria-pressed={map.lighting.timeOfDay === tod}
                  onClick={() => void sendIntent({ kind: 'lighting.config', data: { mapId: map.id, timeOfDay: tod } }).then(onError)}
                >
                  {TIME_OF_DAY_LABELS[tod]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="fog-popover-row">
        <span className="ruler-hint">Destino</span>
        {isGm ? (
          <div className="map3d-hud-group" role="group" aria-label="Destino da nova luz">
            <button
              type="button"
              className={effectiveAttachMode === 'token' ? 'active' : ''}
              disabled={!canUseSelectedToken}
              onClick={() => {
                setAttachMode('token');
              }}
            >
              {targetToken ? `No token (${targetToken.name})` : 'Selecione um token'}
            </button>
            <button
              type="button"
              className={effectiveAttachMode === 'point' ? 'active' : ''}
              onClick={() => {
                setAttachMode('point');
              }}
            >
              No centro da câmera
            </button>
          </div>
        ) : (
          <span className="hint">{targetToken ? `Token: ${targetToken.name}` : 'Selecione seu token no mapa'}</span>
        )}
      </div>

      <div className="fog-popover-row lighting-preset-row">
        <span className="ruler-hint">Fontes</span>
        {GEAR_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={!isGm && !targetToken}
            onClick={() => {
              spawnPreset(preset);
            }}
          >
            + {preset.name}
          </button>
        ))}
      </div>

      <div className="fog-popover-row lighting-preset-row">
        <span className="ruler-hint">Magias</span>
        {SRD_LIGHT_SPELL_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={!isGm && !targetToken}
            onClick={() => {
              spawnPreset(preset);
            }}
          >
            + {preset.name}
          </button>
        ))}
      </div>

      {visibleLights.length > 0 && (
        <div className="lighting-section">
          <div className="fog-popover-row">
            <span className="ruler-hint">Luzes ativas ({visibleLights.length})</span>
          </div>
          <ul className="lighting-list">
            {visibleLights.map((l) => (
              <li key={l.id} className="lighting-item">
                <span>
                  {l.name} <small className="hint">({lightRadiusLabel(l)})</small>
                </span>
                <span className="lighting-item-actions">
                  <button
                    type="button"
                    className={l.enabled ? 'active' : ''}
                    onClick={() => void sendIntent({ kind: 'light.toggle', data: { mapId: map.id, lightId: l.id } }).then(onError)}
                  >
                    {l.enabled ? 'Acesa' : 'Apagada'}
                  </button>
                  <button
                    type="button"
                    title="Remover fonte de luz"
                    onClick={() => void sendIntent({ kind: 'light.remove', data: { mapId: map.id, lightId: l.id } }).then(onError)}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {visiblePropLights.length > 0 && (
        <div className="lighting-section">
          <div className="fog-popover-row">
            <span className="ruler-hint">Tochas do mapa ({visiblePropLights.length})</span>
            {isGm && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    for (const p of visiblePropLights) {
                      if (map.propLightOverrides[p.id] !== 'off' && map.propLightOverrides[p.id] !== 'removed') {
                        void sendIntent({ kind: 'map_prop_light.set', data: { mapId: map.id, propLightId: p.id, state: 'off' } }).then(onError);
                      }
                    }
                  }}
                >
                  Apagar todas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    for (const p of visiblePropLights) {
                      if (map.propLightOverrides[p.id] !== undefined) {
                        void sendIntent({ kind: 'map_prop_light.set', data: { mapId: map.id, propLightId: p.id, state: 'on' } }).then(onError);
                      }
                    }
                  }}
                >
                  Acender todas
                </button>
              </>
            )}
          </div>
          <ul className="lighting-list">
            {visiblePropLights.map((p) => {
              const st = map.propLightOverrides[p.id] ?? 'on';
              return (
                <li key={p.id} className="lighting-item">
                  <span>
                    {p.name} <small className="hint">({Math.round(p.x)}, {Math.round(p.y)})</small>
                  </span>
                  <span className="lighting-item-actions">
                    <button
                      type="button"
                      className={st === 'on' ? 'active' : ''}
                      onClick={() =>
                        void sendIntent({
                          kind: 'map_prop_light.set',
                          data: { mapId: map.id, propLightId: p.id, state: st === 'on' ? 'off' : 'on' },
                        }).then(onError)
                      }
                    >
                      {st === 'on' ? 'Acesa' : st === 'off' ? 'Apagada' : 'Removida'}
                    </button>
                    {isGm && st !== 'removed' && (
                      <button
                        type="button"
                        title="Remover tocha do mapa"
                        onClick={() =>
                          void sendIntent({
                            kind: 'map_prop_light.set',
                            data: { mapId: map.id, propLightId: p.id, state: 'removed' },
                          }).then(onError)
                        }
                      >
                        Remover
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
