/**
 * Studio modal dialogs for creating maps (size presets + custom dimensions + templates),
 * saving maps (workspace `maps/` folder + `.vttmap.json` download), and loading maps
 * (workspace list + `.vttmap.json` file import).
 */

import {
  MAP_SIZE_PRESETS,
  MAX_MAP_TILES,
  MIN_MAP_TILES,
  clampMapDimension,
  sanitizeMapId,
  type CreateMapOptions,
  type MapTemplateId,
  type SavedMapSummary,
} from '../map/mapDocument';
import {
  deleteMapFromStorage,
  describeSaveTarget,
  exportMapToDownload,
  importMapFromFile,
  listSavedMaps,
  loadMapFromStorageWithMeta,
  openMapFromFilePicker,
  saveMapToStorage,
  saveMapToTarget,
  saveMapWithFilePicker,
  supportsOpenFilePicker,
  supportsSaveFilePicker,
  type MapSaveTarget,
} from '../map/mapStorage';
import { TILE_SIZE_FEET, TILE_SIZE_METERS } from '../terrain/constants';
import { CAVE_ROCK_UNDERLAY_ID, DEFAULT_UNDERLAY_ID, getUnderlayMaterials } from '../terrain/materials';
import type { ToolController } from '../tools/toolController';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export class MapModalsController {
  private readonly controller: ToolController;
  private readonly modalHost: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly onRefreshUI: () => void;

  private toastTimer: number | null = null;
  private activeModal: 'new' | 'save' | 'load' | null = null;
  private isSaving = false;

  // Draft state for New Map modal
  private draft: CreateMapOptions = {
    name: 'New Encounter',
    width: 32,
    length: 32,
    template: 'flat',
    baseUnderlayId: 1,
    baseElevationFeet: 0,
    includeStarterProps: true,
  };

  constructor(rootEl: HTMLElement, controller: ToolController, onRefreshUI: () => void) {
    this.controller = controller;
    this.onRefreshUI = onRefreshUI;

    this.modalHost = document.createElement('div');
    this.modalHost.className = 'modal-backdrop hidden';
    rootEl.appendChild(this.modalHost);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'studio-toast hidden';
    rootEl.appendChild(this.toastEl);

    this.modalHost.addEventListener('click', (e) => {
      if (e.target === this.modalHost) this.close();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.activeModal !== null) {
        this.close();
      }
    });
  }

  showToast(message: string, isError = false): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden', 'error');
    if (isError) this.toastEl.classList.add('error');
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.add('hidden');
      this.toastTimer = null;
    }, 3400);
  }

  close(): void {
    this.activeModal = null;
    this.modalHost.classList.add('hidden');
    this.modalHost.innerHTML = '';
  }

  openNewMap(): void {
    this.activeModal = 'new';
    this.draft = {
      name: 'New Encounter',
      width: this.controller.grid.width,
      length: this.controller.grid.length,
      template: 'flat',
      baseUnderlayId: 1,
      baseElevationFeet: 0,
      includeStarterProps: true,
    };
    this.renderNewMapModal();
    this.modalHost.classList.remove('hidden');
  }

  /**
   * Standard Save (`Ctrl+S` / Save button):
   *  - If the current map is already linked to a saved workspace slot or an opened disk file,
   *    writes directly in-place without prompting "Save As".
   *  - If the map has not been saved yet, opens the Save As dialog.
   */
  async saveCurrentMap(): Promise<void> {
    if (this.isSaving) return;
    const target = this.controller.saveTarget;
    if (!target) {
      this.openSaveAsMap();
      return;
    }

    this.isSaving = true;
    try {
      const overrideId = target.kind === 'storage' ? target.id : undefined;
      const doc = this.controller.buildMapDocument(undefined, overrideId);
      const saved = await saveMapToTarget(target, doc);
      this.controller.markSaved({
        id: saved.id,
        name: saved.name,
        createdAt: doc.createdAt,
        saveTarget: saved.saveTarget,
      });
      this.onRefreshUI();
      this.showToast(`Saved "${saved.name}" → ${saved.locationLabel}`);
    } catch (err) {
      this.showToast(`Direct save failed (${String(err)}). Choose a new location.`, true);
      this.openSaveAsMap();
    } finally {
      this.isSaving = false;
    }
  }

  openSaveAsMap(): void {
    this.activeModal = 'save';
    void this.renderSaveMapModal(this.controller.mapName);
    this.modalHost.classList.remove('hidden');
  }

  openSaveMap(): void {
    this.openSaveAsMap();
  }

  openLoadMap(): void {
    this.activeModal = 'load';
    void this.renderLoadMapModal();
    this.modalHost.classList.remove('hidden');
  }

  private renderNewMapModal(): void {
    const d = this.draft;
    const underlays = getUnderlayMaterials();
    const feetW = d.width * TILE_SIZE_FEET;
    const feetL = d.length * TILE_SIZE_FEET;
    const metersW = (d.width * TILE_SIZE_METERS).toFixed(0);
    const metersL = (d.length * TILE_SIZE_METERS).toFixed(0);

    this.modalHost.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Create New Map">
        <div class="modal-header">
          <div>
            <h3>Create New Map</h3>
            <p class="modal-sub">Configure D&amp;D 5ft / 1.5m grid dimensions and starting terrain.</p>
          </div>
          <button class="btn small" id="nm-close">✕</button>
        </div>

        <div class="modal-body">
          <div class="field">
            <div class="field-row"><span>Map Name</span></div>
            <input type="text" id="nm-name" value="${escapeHtml(d.name)}" placeholder="e.g. Goblin Ambush Bridge" />
          </div>

          <div class="field">
            <div class="field-row">
              <span>Size Presets</span>
              <strong>${d.width}×${d.length} tiles · ${feetW}×${feetL} ft (${metersW}×${metersL} m)</strong>
            </div>
            <div class="preset-grid">
              ${MAP_SIZE_PRESETS.map((p) => {
                const active = d.width === p.width && d.length === p.length;
                return `<button class="preset-card ${active ? 'active' : ''}" data-preset-w="${p.width}" data-preset-l="${p.length}">
                  <strong>${p.label}</strong>
                  <span>${p.width}×${p.length} · ${p.width * TILE_SIZE_FEET}×${p.length * TILE_SIZE_FEET} ft</span>
                </button>`;
              }).join('')}
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <div class="field-row"><span>Width (tiles)</span><strong>${feetW} ft</strong></div>
              <input type="number" id="nm-width" min="${MIN_MAP_TILES}" max="${MAX_MAP_TILES}" step="2" value="${d.width}" />
            </div>
            <div class="field">
              <div class="field-row"><span>Length (tiles)</span><strong>${feetL} ft</strong></div>
              <input type="number" id="nm-length" min="${MIN_MAP_TILES}" max="${MAX_MAP_TILES}" step="2" value="${d.length}" />
            </div>
          </div>

          <div class="field">
            <div class="field-row"><span>Starting Terrain Template</span></div>
            <div class="grid-3">
              <button class="btn small ${d.template === 'flat' ? 'active' : ''}" data-tpl="flat">Flat Canvas</button>
              <button class="btn small ${d.template === 'rolling_hills' ? 'active' : ''}" data-tpl="rolling_hills">Rolling Hills</button>
              <button class="btn small ${d.template === 'dungeon' ? 'active' : ''}" data-tpl="dungeon">Dungeon</button>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <div class="field-row"><span>Base Underlay</span></div>
              <select id="nm-underlay">
                ${underlays
                  .map(
                    (m) =>
                      `<option value="${m.id}" ${d.baseUnderlayId === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <div class="field-row"><span>Base Elevation</span><strong>${d.baseElevationFeet >= 0 ? '+' : ''}${d.baseElevationFeet} ft</strong></div>
              <input type="range" id="nm-elev" min="-10" max="20" step="2.5" value="${d.baseElevationFeet}" />
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" id="nm-cancel">Cancel</button>
          <button class="btn primary" id="nm-create">Create Map (${d.width}×${d.length})</button>
        </div>
      </div>
    `;

    const nameEl = this.modalHost.querySelector<HTMLInputElement>('#nm-name');
    if (nameEl) {
      nameEl.oninput = () => {
        d.name = nameEl.value;
      };
    }

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-preset-w]').forEach((btn) => {
      btn.onclick = () => {
        d.width = clampMapDimension(Number(btn.dataset.presetW));
        d.length = clampMapDimension(Number(btn.dataset.presetL));
        this.renderNewMapModal();
      };
    });

    const wEl = this.modalHost.querySelector<HTMLInputElement>('#nm-width');
    const lEl = this.modalHost.querySelector<HTMLInputElement>('#nm-length');
    if (wEl) {
      wEl.onchange = () => {
        d.width = clampMapDimension(Number(wEl.value));
        this.renderNewMapModal();
      };
    }
    if (lEl) {
      lEl.onchange = () => {
        d.length = clampMapDimension(Number(lEl.value));
        this.renderNewMapModal();
      };
    }

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-tpl]').forEach((btn) => {
      btn.onclick = () => {
        const tpl = btn.dataset.tpl as MapTemplateId;
        d.template = tpl;
        if (tpl === 'dungeon') {
          d.baseUnderlayId = CAVE_ROCK_UNDERLAY_ID;
        } else if (d.baseUnderlayId === CAVE_ROCK_UNDERLAY_ID) {
          d.baseUnderlayId = DEFAULT_UNDERLAY_ID;
        }
        this.renderNewMapModal();
      };
    });

    const underlaySel = this.modalHost.querySelector<HTMLSelectElement>('#nm-underlay');
    if (underlaySel) {
      underlaySel.onchange = () => {
        d.baseUnderlayId = Number(underlaySel.value);
      };
    }

    const elevEl = this.modalHost.querySelector<HTMLInputElement>('#nm-elev');
    if (elevEl) {
      elevEl.oninput = () => {
        d.baseElevationFeet = Number(elevEl.value);
        this.renderNewMapModal();
      };
    }

    const closeBtn = this.modalHost.querySelector<HTMLButtonElement>('#nm-close');
    const cancelBtn = this.modalHost.querySelector<HTMLButtonElement>('#nm-cancel');
    const createBtn = this.modalHost.querySelector<HTMLButtonElement>('#nm-create');
    if (closeBtn) closeBtn.onclick = () => { this.close(); };
    if (cancelBtn) cancelBtn.onclick = () => { this.close(); };
    if (createBtn) {
      createBtn.onclick = async () => {
        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        try {
          const finalW = wEl ? clampMapDimension(Number(wEl.value)) : d.width;
          const finalL = lEl ? clampMapDimension(Number(lEl.value)) : d.length;
          const finalName = nameEl?.value.trim() || 'Untitled Map';
          await this.controller.createNewMap({
            ...d,
            name: finalName,
            width: finalW,
            length: finalL,
          });
          this.close();
          this.onRefreshUI();
          this.showToast(
            `Created "${finalName}" (${finalW}×${finalL} · ${finalW * TILE_SIZE_FEET}×${finalL * TILE_SIZE_FEET} ft)`
          );
        } catch (err) {
          this.showToast(`Failed to create map: ${String(err)}`, true);
          createBtn.disabled = false;
          createBtn.textContent = `Create Map (${d.width}×${d.length})`;
        }
      };
    }
  }

  private async renderSaveMapModal(initialName: string): Promise<void> {
    const c = this.controller;
    let currentName = initialName.trim() || 'Untitled Map';
    const existing = await listSavedMaps();
    if (this.activeModal !== 'save') return;

    const hasExistingTarget = c.saveTarget !== null;
    const currentTargetLabel = describeSaveTarget(c.saveTarget);
    const canPickSaveFile = supportsSaveFilePicker();

    const renderBody = (): void => {
      const slug = sanitizeMapId(currentName);
      this.modalHost.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="${hasExistingTarget ? 'Save Map As' : 'Save Map'}">
          <div class="modal-header">
            <div>
              <h3>${hasExistingTarget ? 'Save Map As' : 'Save Map'}</h3>
              <p class="modal-sub">Save to local workspace <code>maps/</code> folder or to a standalone <code>.vttmap.json</code> file.</p>
            </div>
            <button class="btn small" id="sm-close">✕</button>
          </div>

          <div class="modal-body">
            ${
              hasExistingTarget
                ? `<div class="hint-box">Current target: <strong>${escapeHtml(currentTargetLabel)}</strong> (use <strong>Ctrl+S</strong> to save in-place)</div>`
                : ''
            }

            <div class="field">
              <div class="field-row">
                <span>Map Name</span>
                <strong>${c.grid.width}×${c.grid.length} (${c.grid.width * 5}×${c.grid.length * 5} ft) · ${c.assets.placedAssets.length} props</strong>
              </div>
              <input type="text" id="sm-name" value="${escapeHtml(currentName)}" placeholder="Enter map name..." />
            </div>

            <div class="hint-box">
              Workspace target: <strong id="sm-slug">maps/${escapeHtml(slug)}.vttmap.json</strong>
            </div>

            ${
              existing.length > 0
                ? `
              <div class="field">
                <div class="field-row"><span>Overwrite Existing Saved Map</span><span>${existing.length}</span></div>
                <div class="saved-map-list compact">
                  ${existing
                    .map(
                      (m) => `
                    <button class="saved-map-pick" data-pick-name="${escapeHtml(m.name)}">
                      <span>${escapeHtml(m.name)}</span>
                      <span class="saved-meta">${m.width}×${m.length} · ${m.propCount} props</span>
                    </button>`
                    )
                    .join('')}
                </div>
              </div>`
                : ''
            }
          </div>

          <div class="modal-footer">
            <button class="btn" id="sm-download" title="${canPickSaveFile ? 'Choose a .vttmap.json file on disk (future Ctrl+S saves directly to it)' : 'Download standalone .vttmap.json file'}">${canPickSaveFile ? 'Save to File...' : 'Download File'}</button>
            <div class="modal-footer-right">
              <button class="btn" id="sm-cancel">Cancel</button>
              <button class="btn primary" id="sm-save">Save to Workspace</button>
            </div>
          </div>
        </div>
      `;

      const nameInput = this.modalHost.querySelector<HTMLInputElement>('#sm-name');
      const slugEl = this.modalHost.querySelector<HTMLElement>('#sm-slug');
      const closeBtn = this.modalHost.querySelector<HTMLButtonElement>('#sm-close');
      const cancelBtn = this.modalHost.querySelector<HTMLButtonElement>('#sm-cancel');
      const downloadBtn = this.modalHost.querySelector<HTMLButtonElement>('#sm-download');
      const saveBtn = this.modalHost.querySelector<HTMLButtonElement>('#sm-save');

      if (nameInput) {
        nameInput.focus();
        nameInput.select();
        nameInput.oninput = () => {
          currentName = nameInput.value;
          if (slugEl) slugEl.textContent = `maps/${sanitizeMapId(currentName)}.vttmap.json`;
        };
        nameInput.onkeydown = (e) => {
          if (e.key === 'Enter' && saveBtn && !saveBtn.disabled) {
            e.preventDefault();
            saveBtn.click();
          }
        };
      }

      this.modalHost.querySelectorAll<HTMLButtonElement>('[data-pick-name]').forEach((btn) => {
        btn.onclick = () => {
          currentName = btn.dataset.pickName ?? currentName;
          renderBody();
        };
      });

      if (closeBtn) closeBtn.onclick = () => { this.close(); };
      if (cancelBtn) cancelBtn.onclick = () => { this.close(); };

      if (downloadBtn) {
        downloadBtn.onclick = async () => {
          const cleanName = nameInput?.value.trim() || 'Untitled Map';
          const doc = c.buildMapDocument(cleanName);
          if (canPickSaveFile) {
            downloadBtn.disabled = true;
            try {
              const savedFile = await saveMapWithFilePicker(doc);
              if (!savedFile) {
                downloadBtn.disabled = false;
                return;
              }
              const nextTarget: MapSaveTarget = {
                kind: 'file_handle',
                handle: savedFile.handle,
                fileName: savedFile.fileName,
              };
              c.markSaved({
                id: doc.id,
                name: doc.name,
                createdAt: doc.createdAt,
                saveTarget: nextTarget,
              });
              this.close();
              this.onRefreshUI();
              this.showToast(`Saved "${doc.name}" → ${savedFile.fileName}`);
            } catch (err) {
              this.showToast(`Failed to save file: ${String(err)}`, true);
              downloadBtn.disabled = false;
            }
          } else {
            exportMapToDownload(doc);
            c.markSaved({ id: doc.id, name: doc.name, createdAt: doc.createdAt });
            this.close();
            this.onRefreshUI();
            this.showToast(`Downloaded ${doc.id}.vttmap.json`);
          }
        };
      }

      if (saveBtn) {
        saveBtn.onclick = async () => {
          const cleanName = nameInput?.value.trim() || 'Untitled Map';
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
          try {
            const doc = c.buildMapDocument(cleanName);
            const saved = await saveMapToStorage(doc);
            const nextTarget: MapSaveTarget = {
              kind: 'storage',
              id: saved.id,
              storage: saved.storage,
            };
            c.markSaved({
              id: saved.id,
              name: saved.name,
              createdAt: doc.createdAt,
              saveTarget: nextTarget,
            });
            this.close();
            this.onRefreshUI();
            this.showToast(
              `Saved "${saved.name}" (${saved.width}×${saved.length}) → ${saved.storage === 'disk' ? `maps/${saved.id}.vttmap.json` : 'browser storage'}`
            );
          } catch (err) {
            this.showToast(`Failed to save map: ${String(err)}`, true);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save to Workspace';
          }
        };
      }
    };

    renderBody();
  }

  private async renderLoadMapModal(): Promise<void> {
    this.modalHost.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Load Map">
        <div class="modal-header">
          <div>
            <h3>Load Map</h3>
            <p class="modal-sub">Open a saved map from <code>maps/</code> or import a <code>.vttmap.json</code> file.</p>
          </div>
          <button class="btn small" id="lm-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="hint-box">Loading saved maps...</div>
        </div>
      </div>
    `;

    const maps: SavedMapSummary[] = await listSavedMaps();
    if (this.activeModal !== 'load') return;

    this.modalHost.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Load Map">
        <div class="modal-header">
          <div>
            <h3>Load Map</h3>
            <p class="modal-sub">Open a saved map from <code>maps/</code> or import a <code>.vttmap.json</code> file.</p>
          </div>
          <button class="btn small" id="lm-close">✕</button>
        </div>

        <div class="modal-body">
          <div class="saved-map-list">
            ${
              maps.length === 0
                ? `<div class="hint-box">No saved maps found in <strong>maps/</strong> yet. Click <strong>Save</strong> to store your current map, or import a <code>.vttmap.json</code> file below.</div>`
                : maps
                    .map(
                      (m) => `
                  <div class="saved-map-row">
                    <div class="saved-map-info">
                      <div class="saved-map-title">
                        <strong>${escapeHtml(m.name)}</strong>
                        <span class="cat-badge">${m.storage}</span>
                      </div>
                      <div class="saved-meta">
                        ${m.width}×${m.length} tiles (${m.width * 5}×${m.length * 5} ft) · ${m.propCount} props · ${formatTimestamp(m.updatedAt)}
                      </div>
                    </div>
                    <div class="saved-map-actions">
                      <button class="btn small primary" data-load-id="${escapeHtml(m.id)}">Load</button>
                      <button class="btn small danger" data-del-id="${escapeHtml(m.id)}" title="Delete saved map">Del</button>
                    </div>
                  </div>`
                    )
                    .join('')
            }
          </div>
          <input type="file" id="lm-file-input" accept=".json,.vttmap.json,application/json" style="display:none" />
        </div>

        <div class="modal-footer">
          <button class="btn" id="lm-import">Open .vttmap.json File...</button>
          <button class="btn" id="lm-cancel">Close</button>
        </div>
      </div>
    `;

    const closeBtn = this.modalHost.querySelector<HTMLButtonElement>('#lm-close');
    const cancelBtn = this.modalHost.querySelector<HTMLButtonElement>('#lm-cancel');
    const importBtn = this.modalHost.querySelector<HTMLButtonElement>('#lm-import');
    const fileInput = this.modalHost.querySelector<HTMLInputElement>('#lm-file-input');

    if (closeBtn) closeBtn.onclick = () => { this.close(); };
    if (cancelBtn) cancelBtn.onclick = () => { this.close(); };

    if (importBtn && fileInput) {
      importBtn.onclick = async () => {
        if (supportsOpenFilePicker()) {
          try {
            const opened = await openMapFromFilePicker();
            if (!opened) return;
            const target: MapSaveTarget = {
              kind: 'file_handle',
              handle: opened.handle,
              fileName: opened.fileName,
            };
            const { loadedProps, missingProps } = await this.controller.loadMapDocument(opened.doc, target);
            this.close();
            this.onRefreshUI();
            const missNote = missingProps.length > 0 ? ` (${missingProps.length} missing assets skipped)` : '';
            this.showToast(
              `Opened "${opened.doc.name}" (${opened.fileName} · ${loadedProps} props)${missNote}`
            );
          } catch (err) {
            this.showToast(`Open failed: ${String(err)}`, true);
          }
          return;
        }
        fileInput.click();
      };
      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          const doc = await importMapFromFile(file);
          const { loadedProps, missingProps } = await this.controller.loadMapDocument(doc, null);
          this.close();
          this.onRefreshUI();
          const missNote = missingProps.length > 0 ? ` (${missingProps.length} missing assets skipped)` : '';
          this.showToast(
            `Imported "${doc.name}" (${doc.terrain.width}×${doc.terrain.length} · ${loadedProps} props)${missNote}`
          );
        } catch (err) {
          this.showToast(`Import failed: ${String(err)}`, true);
        }
      };
    }

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-load-id]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.loadId;
        if (!id) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const loaded = await loadMapFromStorageWithMeta(id);
          const target: MapSaveTarget = {
            kind: 'storage',
            id: loaded.id,
            storage: loaded.storage,
          };
          const { loadedProps, missingProps } = await this.controller.loadMapDocument(loaded.doc, target);
          this.close();
          this.onRefreshUI();
          const missNote = missingProps.length > 0 ? ` (${missingProps.length} missing assets skipped)` : '';
          this.showToast(
            `Loaded "${loaded.doc.name}" (${loaded.doc.terrain.width}×${loaded.doc.terrain.length} · ${loadedProps} props)${missNote}`
          );
        } catch (err) {
          this.showToast(`Load failed: ${String(err)}`, true);
          btn.disabled = false;
          btn.textContent = 'Load';
        }
      };
    });

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-del-id]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.delId;
        if (!id) return;
        await deleteMapFromStorage(id);
        if (this.controller.saveTarget?.kind === 'storage' && this.controller.saveTarget.id === id) {
          this.controller.saveTarget = null;
          this.onRefreshUI();
        }
        this.showToast(`Deleted saved map "${id}"`);
        void this.renderLoadMapModal();
      };
    });
  }
}
