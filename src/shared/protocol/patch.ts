import type { PatchOp } from './messages';

/**
 * Aplica operações JSON Patch (RFC 6902: `add`, `remove`, `replace`) sem
 * mutar a entrada: copia só os objetos e arrays no caminho de cada operação e
 * compartilha o resto. O Host usa esta função para aplicar exatamente o que
 * transmite, e o cliente para aplicar o que recebe.
 */

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

type Container = Record<string, unknown> | unknown[];

const isContainer = (v: unknown): v is Container => typeof v === 'object' && v !== null;

/** `/tokens/a~1b` → `['tokens', 'a/b']` (RFC 6901). */
export function parsePointer(path: string): string[] {
  if (!path.startsWith('/')) throw new PatchError(`caminho inválido: ${path}`);
  return path
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Monta um caminho a partir de segmentos, escapando `~` e `/`. */
export function toPointer(...segments: (string | number)[]): string {
  return segments.map((s) => `/${String(s).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

function arrayIndex(arr: unknown[], key: string, allowEnd: boolean): number {
  if (allowEnd && key === '-') return arr.length;
  if (!/^(0|[1-9]\d*)$/.test(key)) throw new PatchError(`índice inválido: ${key}`);
  const i = Number(key);
  if (i > arr.length || (!allowEnd && i === arr.length)) throw new PatchError(`índice fora do array: ${key}`);
  return i;
}

function applyAt(node: unknown, keys: readonly string[], op: PatchOp): unknown {
  if (!isContainer(node)) throw new PatchError(`caminho não existe: ${op.path}`);
  const [key, ...rest] = keys;
  if (key === undefined) throw new PatchError(`caminho vazio: ${op.path}`);

  if (Array.isArray(node)) {
    const copy = [...node];
    if (rest.length > 0) {
      const i = arrayIndex(node, key, false);
      copy[i] = applyAt(node[i], rest, op);
      return copy;
    }
    if (op.op === 'add') copy.splice(arrayIndex(node, key, true), 0, op.value);
    else if (op.op === 'remove') copy.splice(arrayIndex(node, key, false), 1);
    else copy[arrayIndex(node, key, false)] = op.value;
    return copy;
  }

  const has = Object.hasOwn(node, key);
  if (rest.length > 0) {
    if (!has) throw new PatchError(`caminho não existe: ${op.path}`);
    return { ...node, [key]: applyAt(node[key], rest, op) };
  }
  if (op.op !== 'add' && !has) throw new PatchError(`caminho não existe: ${op.path}`);
  if (op.op === 'remove') {
    return Object.fromEntries(Object.entries(node).filter(([k]) => k !== key));
  }
  return { ...node, [key]: op.value };
}

/** Aplica as operações em ordem. Lança `PatchError` se alguma não couber no documento. */
export function applyPatch<T>(doc: T, ops: readonly PatchOp[]): T {
  let current: unknown = doc;
  for (const op of ops) current = applyAt(current, parsePointer(op.path), op);
  return current as T;
}
