import { describe, expect, it } from 'vitest';
import { addSelection, removeSelection, setBackground, setFirstClass, setSpecies } from './build-steps';

const pick = (choiceId: string, ...picks: string[]) => ({ source: { kind: 'class' as const, id: 'fighter' }, choiceId, picks });

describe('build steps', () => {
  it('keeps species, background and classes in order', () => {
    let steps = setFirstClass([], 'fighter');
    steps = setBackground(steps, 'soldier', { str: 2, con: 1 });
    steps = setSpecies(steps, 'human', 'small');
    expect(steps.map((s) => s.kind)).toEqual(['species', 'background', 'class_level']);
    expect(steps[0]).toEqual({ kind: 'species', speciesId: 'human', size: 'small', selections: [] });
  });

  it('keeps selections when the source stays and drops them when it changes', () => {
    const base = addSelection(setFirstClass([], 'fighter'), 0, pick('skills', 'athletics', 'perception'));
    expect(setFirstClass(base, 'fighter')[0]?.selections).toHaveLength(1);
    expect(setFirstClass(base, 'wizard')[0]).toEqual({ kind: 'class_level', classId: 'wizard', selections: [] });
    const withSize = setSpecies([{ kind: 'species', speciesId: 'human', selections: [pick('skillful', 'stealth')] }], 'human', 'medium');
    expect(withSize[0]?.selections).toHaveLength(1);
  });

  it('refuses to change the first class after level 1', () => {
    const two = [...setFirstClass([], 'fighter'), { kind: 'class_level' as const, classId: 'fighter', selections: [] }];
    expect(() => setFirstClass(two, 'wizard')).toThrow();
  });

  it('adds and removes selections in a step', () => {
    let steps = setFirstClass([], 'fighter');
    steps = addSelection(steps, 0, pick('skills', 'athletics', 'perception'));
    steps = addSelection(steps, 0, pick('fighting_style', 'defense'));
    expect(removeSelection(steps, 0, 0)[0]?.selections).toEqual([pick('fighting_style', 'defense')]);
  });
});
