import { describe, expect, it } from 'vitest';
import { applyPatch, PatchError, parsePointer, toPointer } from './patch';

describe('applyPatch', () => {
  const doc = { a: { b: 1, c: [1, 2] }, d: { e: true } };

  it('adds, replaces and removes object members', () => {
    expect(applyPatch(doc, [{ op: 'add', path: '/a/x', value: 5 }]).a).toEqual({ b: 1, c: [1, 2], x: 5 });
    expect(applyPatch(doc, [{ op: 'replace', path: '/a/b', value: 2 }]).a.b).toBe(2);
    expect(applyPatch(doc, [{ op: 'remove', path: '/d' }])).toEqual({ a: doc.a });
  });

  it('appends, inserts, replaces and removes array items', () => {
    const at = (ops: Parameters<typeof applyPatch>[1]): number[] => applyPatch(doc, ops).a.c;
    expect(at([{ op: 'add', path: '/a/c/-', value: 3 }])).toEqual([1, 2, 3]);
    expect(at([{ op: 'add', path: '/a/c/0', value: 0 }])).toEqual([0, 1, 2]);
    expect(at([{ op: 'replace', path: '/a/c/1', value: 9 }])).toEqual([1, 9]);
    expect(at([{ op: 'remove', path: '/a/c/0' }])).toEqual([2]);
  });

  it('never mutates the input and shares untouched branches', () => {
    const next = applyPatch(doc, [{ op: 'replace', path: '/a/b', value: 7 }]);
    expect(doc.a.b).toBe(1);
    expect(next.d).toBe(doc.d);
    expect(next.a.c).toBe(doc.a.c);
  });

  it('applies the operations in order', () => {
    const next = applyPatch(doc, [
      { op: 'add', path: '/f', value: { g: [] } },
      { op: 'add', path: '/f/g/-', value: 'x' },
    ]);
    expect(next).toMatchObject({ f: { g: ['x'] } });
  });

  it('rejects paths that do not exist', () => {
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/z', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'remove', path: '/a/zz' }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'add', path: '/z/y', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/a/c/2', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'add', path: '/a/c/01', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: 'remove', path: '/a/c/-' }])).toThrow(PatchError);
  });

  it('escapes and unescapes pointer segments', () => {
    expect(toPointer('tokens', 'a/b', 'c~d', 0)).toBe('/tokens/a~1b/c~0d/0');
    expect(parsePointer('/tokens/a~1b/c~0d/0')).toEqual(['tokens', 'a/b', 'c~d', '0']);
  });
});
