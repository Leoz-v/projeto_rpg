import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Camera, screenToWorld } from '../canvas/geometry';
import { cellPxBounds, clampCellPx, gridDimensionsForImage, recommendedCellSizes } from '../canvas/map-grid';

/**
 * Modal de calibração do grid em pixels sobre a imagem escolhida: preview com
 * zoom e arrasto em tempo real, alternando entre divisores exatos recomendados
 * e seleção livre por pixel.
 */

export interface MapGridModalProps {
  image: HTMLImageElement;
  initialCellPx: number;
  onApply: (cellPx: number) => void;
  onCancel: () => void;
}

type GridMode = 'recommended' | 'free';
type GridTone = 'light' | 'dark' | 'accent';

const PREVIEW_MIN_ZOOM = 0.05;
const PREVIEW_MAX_ZOOM = 8;
const ZOOM_SPEED = 0.0015;
const FIT_MARGIN = 24;

const TONE_STYLES: Record<GridTone, { label: string; stroke: string }> = {
  light: { label: 'Claro', stroke: 'rgba(255, 255, 255, 0.55)' },
  dark: { label: 'Escuro', stroke: 'rgba(12, 11, 18, 0.72)' },
  accent: { label: 'Roxo', stroke: 'rgba(143, 124, 247, 0.8)' },
};

const clampZoom = (zoom: number): number => Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, zoom));

function fitImageCamera(contentW: number, contentH: number, viewW: number, viewH: number): Camera {
  const usableW = Math.max(1, viewW - FIT_MARGIN * 2);
  const usableH = Math.max(1, viewH - FIT_MARGIN * 2);
  const zoom = clampZoom(Math.min(usableW / Math.max(1, contentW), usableH / Math.max(1, contentH)));
  return { zoom, x: (viewW - contentW * zoom) / 2, y: (viewH - contentH * zoom) / 2 };
}

function zoomPreviewAt(camera: Camera, point: { x: number; y: number }, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const anchor = screenToWorld(camera, point);
  return { zoom, x: point.x - anchor.x * zoom, y: point.y - anchor.y * zoom };
}

export function MapGridModal({ image, initialCellPx, onApply, onCancel }: MapGridModalProps) {
  const imageSize = useMemo(() => ({ width: image.naturalWidth, height: image.naturalHeight }), [image]);
  const bounds = useMemo(() => cellPxBounds(imageSize), [imageSize]);
  const recommended = useMemo(() => recommendedCellSizes(imageSize), [imageSize]);

  const initialClamped = clampCellPx(initialCellPx, bounds);
  const [cellPx, setCellPx] = useState(initialClamped);
  const [inputText, setInputText] = useState(String(initialClamped));
  const [mode, setMode] = useState<GridMode>(() =>
    recommended.some((item) => item.cellPx === initialClamped) ? 'recommended' : 'free',
  );
  const [tone, setTone] = useState<GridTone>('light');
  const [zoomPercent, setZoomPercent] = useState(100);

  const dims = useMemo(() => gridDimensionsForImage(imageSize, cellPx), [imageSize, cellPx]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const fittedRef = useRef(false);
  const panRef = useRef<{ pointerId: number; fromX: number; fromY: number; camera: Camera } | null>(null);
  const renderParamsRef = useRef({ image, imageSize, cellPx, dims, tone });
  useLayoutEffect(() => {
    renderParamsRef.current = { image, imageSize, cellPx, dims, tone };
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const viewW = viewport.clientWidth;
    const viewH = viewport.clientHeight;
    if (viewW === 0 || viewH === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(viewW * dpr);
    const targetH = Math.round(viewH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { image: img, imageSize: imgSize, cellPx: px, dims: gridDims, tone: gridTone } = renderParamsRef.current;
    const mapPxW = gridDims.width * px;
    const mapPxH = gridDims.height * px;

    if (!fittedRef.current) {
      fittedRef.current = true;
      cameraRef.current = fitImageCamera(mapPxW, mapPxH, viewW, viewH);
      setZoomPercent(Math.round(cameraRef.current.zoom * 100));
    }

    const cam = cameraRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#16151a';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    // Piso do mapa completo (incluindo eventual borda parcial quando `cellPx` não divide exato).
    ctx.fillStyle = '#22212a';
    ctx.fillRect(0, 0, mapPxW, mapPxH);

    ctx.drawImage(img, 0, 0, imgSize.width, imgSize.height);

    // Realce discreto da faixa extra da última célula quando não há divisão exata.
    if (!gridDims.exact) {
      ctx.fillStyle = 'rgba(143, 124, 247, 0.16)';
      if (mapPxW > imgSize.width) ctx.fillRect(imgSize.width, 0, mapPxW - imgSize.width, mapPxH);
      if (mapPxH > imgSize.height) ctx.fillRect(0, imgSize.height, imgSize.width, mapPxH - imgSize.height);
    }

    // Linhas do grid com espessura constante na tela.
    ctx.beginPath();
    for (let x = 0; x <= mapPxW; x += px) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, mapPxH);
    }
    for (let y = 0; y <= mapPxH; y += px) {
      ctx.moveTo(0, y);
      ctx.lineTo(mapPxW, y);
    }
    ctx.strokeStyle = TONE_STYLES[gridTone].stroke;
    ctx.lineWidth = 1 / cam.zoom;
    ctx.stroke();

    if (!gridDims.exact) {
      ctx.save();
      ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.85)';
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.strokeRect(0, 0, imgSize.width, imgSize.height);
      ctx.restore();
    }

    // Borda externa do mapa.
    ctx.strokeStyle = 'rgba(143, 124, 247, 0.85)';
    ctx.lineWidth = 2 / cam.zoom;
    ctx.strokeRect(0, 0, mapPxW, mapPxH);
    ctx.restore();
  }, []);

  useEffect(() => {
    draw();
  }, [draw, cellPx, dims, tone]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      draw();
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      cameraRef.current = zoomPreviewAt(cameraRef.current, point, Math.exp(-event.deltaY * ZOOM_SPEED));
      setZoomPercent(Math.round(cameraRef.current.zoom * 100));
      draw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [draw]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel]);

  const applyCellPx = (value: number): void => {
    const clamped = clampCellPx(value, bounds);
    setCellPx(clamped);
    setInputText(String(clamped));
  };

  const switchMode = (next: GridMode): void => {
    setMode(next);
    if (next === 'recommended' && recommended.length > 0 && !recommended.some((r) => r.cellPx === cellPx)) {
      const [first, ...rest] = recommended;
      if (first) {
        const nearest = rest.reduce(
          (best, current) => (Math.abs(current.cellPx - cellPx) < Math.abs(best.cellPx - cellPx) ? current : best),
          first,
        );
        applyCellPx(nearest.cellPx);
      }
    }
  };

  const fitView = (): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    cameraRef.current = fitImageCamera(dims.width * cellPx, dims.height * cellPx, viewport.clientWidth, viewport.clientHeight);
    setZoomPercent(Math.round(cameraRef.current.zoom * 100));
    draw();
  };

  const zoomCenter = (factor: number): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    cameraRef.current = zoomPreviewAt(cameraRef.current, center, factor);
    setZoomPercent(Math.round(cameraRef.current.zoom * 100));
    draw();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, fromX: event.clientX, fromY: event.clientY, camera: cameraRef.current };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    cameraRef.current = {
      ...pan.camera,
      x: pan.camera.x + (event.clientX - pan.fromX),
      y: pan.camera.y + (event.clientY - pan.fromY),
    };
    draw();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="map-grid-modal-title">
        <header className="modal-header">
          <div>
            <h2 id="map-grid-modal-title">Ajustar grid do mapa</h2>
            <p className="hint">
              Imagem: {imageSize.width} × {imageSize.height} px · Arraste para mover e use a roda do mouse para dar zoom.
            </p>
          </div>
          <button type="button" className="secondary" onClick={onCancel}>
            Fechar
          </button>
        </header>

        <div className="grid-modal-body">
          <div className="grid-preview-pane">
            <div ref={viewportRef} className="grid-preview-viewport">
              <canvas
                ref={canvasRef}
                className="grid-preview-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
            <div className="grid-preview-toolbar">
              <div className="toolbar-group" aria-label="Zoom">
                <button
                  type="button"
                  className="secondary"
                  aria-label="Diminuir zoom"
                  onClick={() => {
                    zoomCenter(1 / 1.25);
                  }}
                >
                  −
                </button>
                <span className="zoom-readout">{zoomPercent}%</span>
                <button
                  type="button"
                  className="secondary"
                  aria-label="Aumentar zoom"
                  onClick={() => {
                    zoomCenter(1.25);
                  }}
                >
                  +
                </button>
                <button type="button" className="secondary" onClick={fitView}>
                  Ajustar à tela
                </button>
              </div>
              <div className="toolbar-group" role="group" aria-label="Contraste do grid">
                <span className="hint">Linhas:</span>
                {(Object.keys(TONE_STYLES) as GridTone[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={tone === key ? 'pill active' : 'pill'}
                    onClick={() => {
                      setTone(key);
                    }}
                  >
                    {TONE_STYLES[key].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <aside className="grid-controls-pane">
            <div className="segmented" role="tablist" aria-label="Modo de seleção do grid">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'recommended'}
                className={mode === 'recommended' ? 'active' : ''}
                onClick={() => {
                  switchMode('recommended');
                }}
              >
                Recomendados ({recommended.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'free'}
                className={mode === 'free' ? 'active' : ''}
                onClick={() => {
                  switchMode('free');
                }}
              >
                Seleção livre
              </button>
            </div>

            {mode === 'recommended' ? (
              recommended.length > 0 ? (
                <div className="recommended-list" role="listbox" aria-label="Tamanhos recomendados em pixels">
                  {recommended.map((option) => {
                    const selected = option.cellPx === cellPx;
                    return (
                      <button
                        key={option.cellPx}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={selected ? 'recommended-item active' : 'recommended-item'}
                        onClick={() => {
                          applyCellPx(option.cellPx);
                        }}
                      >
                        <strong>{option.cellPx} px</strong>
                        <span className="hint">
                          {option.width} × {option.height} células
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="hint">
                  Esta imagem ({imageSize.width} × {imageSize.height} px) não tem divisores exatos em comum dentro do limite de células. Use a{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      switchMode('free');
                    }}
                  >
                    seleção livre
                  </button>
                  .
                </p>
              )
            ) : (
              <div className="stack free-controls">
                <label>
                  Tamanho da célula (px)
                  <div className="stepper-row">
                    <button
                      type="button"
                      className="secondary"
                      aria-label="Diminuir 1 pixel"
                      disabled={cellPx <= bounds.min}
                      onClick={() => {
                        applyCellPx(cellPx - 1);
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={bounds.min}
                      max={bounds.max}
                      step={1}
                      value={inputText}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setInputText(raw);
                        const parsed = Number(raw);
                        if (Number.isInteger(parsed) && parsed >= bounds.min && parsed <= bounds.max) setCellPx(parsed);
                      }}
                      onBlur={() => {
                        const parsed = Number(inputText);
                        applyCellPx(Number.isFinite(parsed) && inputText.trim() !== '' ? parsed : cellPx);
                      }}
                    />
                    <button
                      type="button"
                      className="secondary"
                      aria-label="Aumentar 1 pixel"
                      disabled={cellPx >= bounds.max}
                      onClick={() => {
                        applyCellPx(cellPx + 1);
                      }}
                    >
                      +
                    </button>
                  </div>
                </label>
                <input
                  type="range"
                  aria-label="Ajustar tamanho da célula em pixels"
                  min={bounds.min}
                  max={bounds.max}
                  step={1}
                  value={cellPx}
                  onChange={(event) => {
                    applyCellPx(Number(event.target.value));
                  }}
                />
                <div className="range-bounds hint">
                  <span>{bounds.min} px</span>
                  <span>{bounds.max} px</span>
                </div>
              </div>
            )}

            <dl className="grid-summary">
              <div>
                <dt>Célula</dt>
                <dd>{cellPx} × {cellPx} px</dd>
              </div>
              <div>
                <dt>Mapa resultante</dt>
                <dd>
                  {dims.width} × {dims.height} células
                </dd>
              </div>
              <div>
                <dt>Alinhamento</dt>
                <dd className={dims.exact ? 'status-exact' : 'notice'}>
                  {dims.exact
                    ? 'Divisão exata'
                    : `Sobra parcial (${dims.remainderX} px × ${dims.remainderY} px) — sem distorção`}
                </dd>
              </div>
            </dl>
          </aside>
        </div>

        <footer className="modal-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(cellPx);
            }}
          >
            Aplicar grid
          </button>
        </footer>
      </div>
    </div>
  );
}
