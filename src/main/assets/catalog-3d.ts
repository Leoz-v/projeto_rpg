import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

/**
 * Protocolo `vtt-3d://` para servir os modelos GLB embutidos no app (`resources/3d-assets/`)
 * e o catálogo gerado a partir dos cabeçalhos GLB + arquivos `.model.json`.
 * Funciona de forma idêntica em desenvolvimento e no build empacotado.
 */

export const VTT_3D_SCHEME = 'vtt-3d';

type AssetCategory = 'architecture' | 'nature' | 'prop' | 'creature' | 'fx';
type PlacementRole = 'ground' | 'wall_decor' | 'elevated';

export interface Catalog3dEntry {
  key: string;
  pack: string;
  name: string;
  glbUrl: string;
  unitsPerTile: number;
  nominalWidthTiles: number;
  nominalLengthTiles: number;
  fitFootprint: boolean;
  anchor: string;
  assetKind: string;
  category: AssetCategory;
  placementRole: PlacementRole;
  rawBounds?: [number, number, number];
  rawMinY?: number;
  hasAnimation: boolean;
  animations?: string[];
}

interface ParsedCatalogMeta {
  widthTiles: number;
  lengthTiles: number;
  displayName?: string;
}

interface GlbHeaderInfo {
  bounds: [number, number, number];
  minY: number;
  animations: string[];
}

const ARCH_PACKS = new Set([
  'alderwatch',
  'barleyfold',
  'blackbeck',
  'borough',
  'dunmere',
  'dunmere_lower_ward',
  'greyvein',
  'reedbank',
]);

function loadCatalogFootprints(rootDir: string): Map<string, ParsedCatalogMeta> {
  const index = new Map<string, ParsedCatalogMeta>();
  if (!existsSync(rootDir)) return index;

  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (item.name.toLowerCase() !== 'catalog.json') continue;
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf8')) as { assets?: Record<string, unknown>[] };
        for (const a of parsed.assets ?? []) {
          const key = typeof a['key'] === 'string' ? a['key'] : '';
          if (!key) continue;
          const w =
            typeof a['width'] === 'number' && a['width'] > 0
              ? a['width']
              : typeof a['widthTiles'] === 'number' && a['widthTiles'] > 0
                ? a['widthTiles']
                : 0;
          const l =
            typeof a['length'] === 'number' && a['length'] > 0
              ? a['length']
              : typeof a['lengthTiles'] === 'number' && a['lengthTiles'] > 0
                ? a['lengthTiles']
                : 0;
          if (w > 0 || l > 0) {
            const displayName = typeof a['name'] === 'string' ? a['name'] : undefined;
            index.set(key, {
              widthTiles: w > 0 ? w : 1,
              lengthTiles: l > 0 ? l : 1,
              ...(displayName !== undefined ? { displayName } : {}),
            });
          }
        }
      } catch {
        // Ignora catalog.json malformado.
      }
    }
  }
  return index;
}

/** Lê apenas o cabeçalho JSON de um arquivo GLB para extrair bounds, minY e animações. */
function readGlbInfo(filePath: string): GlbHeaderInfo | null {
  try {
    const fd = openSync(filePath, 'r');
    const header = Buffer.alloc(20);
    const readHead = readSync(fd, header, 0, 20, 0);
    if (readHead < 20 || header.readUInt32LE(0) !== 0x46546c67) {
      closeSync(fd);
      return null;
    }
    const jsonLen = header.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonLen);
    readSync(fd, jsonBuf, 0, jsonLen, 20);
    closeSync(fd);

    const gltf = JSON.parse(jsonBuf.toString('utf8')) as {
      meshes?: { primitives?: { attributes?: { POSITION?: number } }[] }[];
      accessors?: { min?: number[]; max?: number[] }[];
      nodes?: { mesh?: number; scale?: [number, number, number]; children?: number[] }[];
      animations?: { name?: string }[];
    };

    const accessors = gltf.accessors ?? [];
    const meshes = gltf.meshes ?? [];
    const nodes = gltf.nodes ?? [];
    const animations = (gltf.animations ?? []).map((a, idx) => (a.name && a.name.length > 0 ? a.name : `anim_${idx}`));

    const meshBounds: ([number, number, number, number, number, number] | null)[] = meshes.map((mesh) => {
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (const prim of mesh.primitives ?? []) {
        const posIdx = prim.attributes?.POSITION;
        if (posIdx === undefined) continue;
        const acc = accessors[posIdx];
        if (!acc?.min || !acc.max || acc.min.length < 3 || acc.max.length < 3) continue;
        const [ax0, ay0, az0] = acc.min;
        const [ax1, ay1, az1] = acc.max;
        if (ax0 === undefined || ay0 === undefined || az0 === undefined || ax1 === undefined || ay1 === undefined || az1 === undefined) continue;
        minX = Math.min(minX, ax0);
        minY = Math.min(minY, ay0);
        minZ = Math.min(minZ, az0);
        maxX = Math.max(maxX, ax1);
        maxY = Math.max(maxY, ay1);
        maxZ = Math.max(maxZ, az1);
      }
      return Number.isFinite(minX) ? [minX, minY, minZ, maxX, maxY, maxZ] : null;
    });

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    const visitNode = (nodeIdx: number, sx: number, sy: number, sz: number): void => {
      const node = nodes[nodeIdx];
      if (!node) return;
      const nsx = sx * (node.scale ? Math.abs(node.scale[0]) : 1);
      const nsy = sy * (node.scale ? Math.abs(node.scale[1]) : 1);
      const nsz = sz * (node.scale ? Math.abs(node.scale[2]) : 1);
      if (node.mesh !== undefined) {
        const b = meshBounds[node.mesh];
        if (b) {
          minX = Math.min(minX, b[0] * nsx);
          minY = Math.min(minY, b[1] * nsy);
          minZ = Math.min(minZ, b[2] * nsz);
          maxX = Math.max(maxX, b[3] * nsx);
          maxY = Math.max(maxY, b[4] * nsy);
          maxZ = Math.max(maxZ, b[5] * nsz);
        }
      }
      for (const child of node.children ?? []) {
        visitNode(child, nsx, nsy, nsz);
      }
    };

    if (nodes.length > 0) {
      const childSet = new Set<number>();
      for (const n of nodes) {
        for (const c of n.children ?? []) childSet.add(c);
      }
      for (let i = 0; i < nodes.length; i++) {
        if (!childSet.has(i)) visitNode(i, 1, 1, 1);
      }
    } else {
      for (const b of meshBounds) {
        if (!b) continue;
        minX = Math.min(minX, b[0]);
        minY = Math.min(minY, b[1]);
        minZ = Math.min(minZ, b[2]);
        maxX = Math.max(maxX, b[3]);
        maxY = Math.max(maxY, b[4]);
        maxZ = Math.max(maxZ, b[5]);
      }
    }

    if (!Number.isFinite(minX)) return null;
    return {
      bounds: [Number((maxX - minX).toFixed(3)), Number((maxY - minY).toFixed(3)), Number((maxZ - minZ).toFixed(3))],
      minY: Number(minY.toFixed(3)),
      animations,
    };
  } catch {
    return null;
  }
}

function inferPlacementRole(stemAndName: string, anchor: string, minY: number | undefined): PlacementRole {
  const lower = stemAndName.toLowerCase();
  if (/wall_torch|wall_cresset|castle_banner|sun_pennon|forktower_pennon|fish_trade_sign|bracketed_canopy|sheared_wall_pipe|socketed_wall_pipe|shutter|wall_lantern|wall_banner/.test(lower)) {
    return 'wall_decor';
  }
  if (anchor === 'AUTHORED' && typeof minY === 'number' && minY > 0.25) {
    return 'elevated';
  }
  return 'ground';
}

function inferCategory(pack: string, name: string, assetKind: string): AssetCategory {
  const lowerPack = pack.toLowerCase();
  const lowerName = name.toLowerCase();
  const lowerKind = assetKind.toLowerCase();

  if (lowerPack === 'nature') return 'nature';
  if (lowerPack === 'characters' || lowerPack === 'creatures') return 'creature';
  if (lowerPack === 'spells' || lowerPack === 'common_fx' || lowerPack === 'ambient' || lowerPack === 'field_fury') {
    return 'fx';
  }
  if (/wall|roof|entrance|door|window|column|beam/.test(lowerKind)) return 'architecture';
  if (/tree|rock|shrub|stump|ground_detail/.test(lowerKind)) return 'nature';

  if (
    /wall|roof|floor|door|window|stair|ramp|pillar|column|arch|gable|parapet|foundation|gate|bridge|fence|dock|pier|beam|post|chimney|hearth|passage|tunnel|timber|plank|vault|tower|drum|buttress|canopy|bressummer|battlement|chamber|sump|pocket|drain|grille|corner|return|bay|crown|ridge|hatch|house|building|cottage|hall|shed|keep|fort|ruin/.test(
      lowerName,
    )
  ) {
    return 'architecture';
  }
  if (
    /tree|pine|oak|birch|willow|bush|shrub|rock|boulder|stump|log|fern|reed|grass|flower|hedge|cliff|stone|evergreen|cactus|vine|root|fungi|mushroom|ice_chunk|rockslide|snow|stalagmite|outcrop|flowstone|calcite/.test(
      lowerName,
    )
  ) {
    return 'nature';
  }
  if (
    ARCH_PACKS.has(lowerPack) &&
    !/barrel|crate|jug|stool|chair|table|bench|basket|sack|sheaf|lantern|torch|brazier|bed|cabbage|cart|well|stall|chest|trough|scarecrow|hopper|hayrick|wheat|shoots|tub|sign|box|pennon|banner|pennant|windlass|sail/.test(
      lowerName,
    )
  ) {
    return 'architecture';
  }
  return 'prop';
}

function parseDimHintFromName(stem: string): [number, number] | null {
  const m = /(?:^|[_-])(\d+)x(\d+)(?:$|[_-])/.exec(stem.toLowerCase());
  if (!m) return null;
  const w = Number(m[1]);
  const l = Number(m[2]);
  if (w >= 1 && w <= 16 && l >= 1 && l <= 16) return [w, l];
  return null;
}

export function scan3dAssets(rootDir: string): Catalog3dEntry[] {
  if (!existsSync(rootDir)) return [];
  const footprintIndex = loadCatalogFootprints(rootDir);
  const entries: Catalog3dEntry[] = [];

  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, item.name);
      if (item.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!item.name.toLowerCase().endsWith('.glb')) continue;

      const relFromAssets = relative(rootDir, fullPath).replace(/\\/g, '/');
      const parts = relFromAssets.split('/');
      const packName = parts.length > 1 && parts[0] ? parts[0] : 'general';
      const baseNoExt = fullPath.slice(0, -4);
      const sidecarPath = `${baseNoExt}.model.json`;
      let meta: Record<string, unknown> = {};
      if (existsSync(sidecarPath)) {
        try {
          meta = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
        } catch {
          meta = {};
        }
      }

      const stem = basename(fullPath, '.glb');
      const relKey = relFromAssets.slice(0, -4).replace(/\//g, '.');
      const key = typeof meta['key'] === 'string' && meta['key'].length > 0 ? meta['key'] : relKey;
      const unitsPerTile = typeof meta['unitsPerTile'] === 'number' && meta['unitsPerTile'] > 0 ? meta['unitsPerTile'] : 1;
      const anchor = typeof meta['anchor'] === 'string' ? meta['anchor'].toUpperCase() : 'BOUNDS_MIN';
      const assetKind = typeof meta['assetKind'] === 'string' ? meta['assetKind'].toUpperCase() : 'AUTO';
      const fitFootprint = Boolean(meta['fitFootprint']);

      const catMeta = footprintIndex.get(key) ?? footprintIndex.get(relKey);
      const glbInfo = readGlbInfo(fullPath);
      const rawBounds = glbInfo?.bounds;
      const rawMinY = glbInfo?.minY;
      const animations = glbInfo?.animations ?? [];

      let widthTiles = 1;
      let lengthTiles = 1;
      if (catMeta) {
        widthTiles = catMeta.widthTiles;
        lengthTiles = catMeta.lengthTiles;
      } else if (
        typeof meta['nominalWidthTiles'] === 'number' &&
        meta['nominalWidthTiles'] > 0 &&
        typeof meta['nominalLengthTiles'] === 'number' &&
        meta['nominalLengthTiles'] > 0
      ) {
        widthTiles = meta['nominalWidthTiles'];
        lengthTiles = meta['nominalLengthTiles'];
      } else {
        const hint = parseDimHintFromName(stem);
        if (hint) {
          widthTiles = hint[0];
          lengthTiles = hint[1];
        } else if (anchor === 'AUTHORED' && rawBounds) {
          const tilesX = rawBounds[0] / unitsPerTile;
          const tilesZ = rawBounds[2] / unitsPerTile;
          widthTiles = tilesX > 1.35 ? Math.round(tilesX) : 1;
          lengthTiles = tilesZ > 1.35 ? Math.round(tilesZ) : 1;
        }
      }

      const displayName =
        typeof meta['displayName'] === 'string' && meta['displayName'].trim().length > 0
          ? meta['displayName'].trim()
          : (catMeta?.displayName ?? stem.replace(/[_-]+/g, ' '));

      entries.push({
        key,
        pack: packName,
        name: displayName,
        glbUrl: `${VTT_3D_SCHEME}://models/${relFromAssets}`,
        unitsPerTile,
        nominalWidthTiles: widthTiles,
        nominalLengthTiles: lengthTiles,
        fitFootprint,
        anchor,
        assetKind,
        category: inferCategory(packName, `${stem} ${displayName}`, assetKind),
        placementRole: inferPlacementRole(`${stem} ${displayName}`, anchor, rawMinY),
        ...(rawBounds !== undefined ? { rawBounds } : {}),
        ...(rawMinY !== undefined ? { rawMinY } : {}),
        hasAnimation: animations.length > 0,
        ...(animations.length > 0 ? { animations } : {}),
      });
    }
  }

  entries.sort((a, b) => a.pack.localeCompare(b.pack) || a.name.localeCompare(b.name));
  return entries;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
};

/**
 * Responde às URLs `vtt-3d://catalog.json` e `vtt-3d://models/<pack>/<arquivo>`.
 */
export function create3dAssetHandler(rootDir: string): (request: Request) => Response {
  const rootResolved = resolve(rootDir);
  let cachedCatalogJson: string | null = null;

  return (request: Request): Response => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (parsed.protocol !== `${VTT_3D_SCHEME}:`) return new Response(null, { status: 400 });

    if (parsed.hostname === 'catalog.json' && (parsed.pathname === '' || parsed.pathname === '/')) {
      if (cachedCatalogJson === null) {
        const entries = scan3dAssets(rootResolved);
        cachedCatalogJson = JSON.stringify({ root: rootResolved, count: entries.length, assets: entries });
      }
      return new Response(cachedCatalogJson, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
      });
    }

    if (parsed.hostname === 'models') {
      const rel = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      const target = resolve(rootResolved, rel);
      if (!target.startsWith(`${rootResolved}${sep}`)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!existsSync(target) || !statSync(target).isFile()) {
        return new Response('Not found', { status: 404 });
      }
      const lower = target.toLowerCase();
      const contentType = lower.endsWith('.glb')
        ? 'model/gltf-binary'
        : lower.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : 'application/octet-stream';
      const bytes = readFileSync(target);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'Content-Type': contentType, ...CORS_HEADERS },
      });
    }

    return new Response('Not found', { status: 404 });
  };
}
