import { describe, expect, it } from 'vitest';
import { pruneSelections } from '../../src/engine/build';
import type { PendingChoice } from '../../src/engine/types';
import { CharacterSchema } from '../../src/schemas/character';
import { loadSrdCompendium } from '../../src/srd';
import { derive, fighterSteps, LANGUAGES, sel } from './helpers';

/**
 * Candidatos das escolhas pendentes: o que a tela oferece para cada escolha,
 * já filtrado pelo que o personagem tem.
 */

const compendium = loadSrdCompendium();
const pendingOf = (choices: readonly PendingChoice[], choiceId: string): PendingChoice | undefined => choices.find((p) => p.choiceId === choiceId);

describe('choice candidates', () => {
  it('offers the class skill list minus skills the character already has', () => {
    // Soldado dá Atletismo e Intimidação: o Guerreiro não oferece essas duas.
    const sheet = derive({
      steps: [
        { kind: 'species', speciesId: 'dwarf', selections: [LANGUAGES] },
        { kind: 'background', backgroundId: 'soldier', abilityIncreases: { str: 2, con: 1 }, selections: [sel('background', 'soldier', 'gaming_set', 'gaming_set_dice')] },
        { kind: 'class_level', classId: 'fighter', selections: [] },
      ],
    });
    const skills = pendingOf(sheet.pending, 'skills');
    expect(skills?.count).toBe(2);
    expect(skills?.candidates).toEqual(['acrobatics', 'animal_handling', 'history', 'insight', 'persuasion', 'perception', 'survival']);
    expect(skills?.repeatable).toBe(false);
  });

  it('offers origin feats or fighting styles by category, without the ones already taken', () => {
    const sheet = derive({ steps: fighterSteps().map((s) => (s.kind === 'class_level' ? { ...s, selections: [] } : s)) });
    const styles = pendingOf(sheet.pending, 'fighting_style')?.candidates ?? [];
    expect(styles).toContain('defense');
    expect(styles.every((id) => compendium.feats.find((f) => f.id === id)?.category === 'fighting_style')).toBe(true);
  });

  it('offers only weapons for mastery and standard languages at creation', () => {
    const sheet = derive({
      steps: [
        { kind: 'species', speciesId: 'dwarf', selections: [] },
        { kind: 'background', backgroundId: 'soldier', abilityIncreases: { str: 2, con: 1 }, selections: [] },
        { kind: 'class_level', classId: 'fighter', selections: [] },
      ],
    });
    // Comum vem da criação; os outros dois saem da tabela de idiomas padrão (a espécie não dá idioma em 2024).
    expect(pendingOf(sheet.pending, 'languages')?.candidates).toEqual(['common_sign_language', 'draconic', 'dwarvish', 'elvish', 'giant', 'gnomish', 'goblin', 'halfling', 'orc']);
    const mastery = pendingOf(sheet.pending, 'weapon_mastery_1')?.candidates ?? [];
    expect(mastery).toContain('longsword');
    expect(mastery.every((id) => compendium.items.find((i) => i.id === id)?.kind === 'weapon')).toBe(true);
  });

  it('leaves out languages the character already speaks', () => {
    const sheet = derive({
      steps: [
        { kind: 'species', speciesId: 'dwarf', selections: [LANGUAGES] },
        { kind: 'background', backgroundId: 'soldier', abilityIncreases: { str: 2, con: 1 }, selections: [] },
        { kind: 'class_level', classId: 'rogue', selections: [] },
      ],
    });
    const extra = sheet.pending.find((p) => p.options.pick === 'proficiency' && p.options.categories.includes('language') && p.source.id === 'rogue');
    expect(extra?.candidates).toContain('celestial');
    expect(extra?.candidates).not.toContain('dwarvish');
    expect(extra?.candidates).not.toContain('thieves_cant');
  });

  it('offers wizard cantrips from the wizard list only', () => {
    const sheet = derive({
      steps: [{ kind: 'class_level', classId: 'wizard', selections: [] }],
    });
    const cantrips = pendingOf(sheet.pending, 'cantrips')?.candidates ?? [];
    expect(cantrips).toContain('fire_bolt');
    expect(cantrips.every((id) => {
      const spell = compendium.spells.find((s) => s.id === id);
      return spell?.level === 0 && spell.classes.includes('wizard');
    })).toBe(true);
  });

  it('marks ability score increases as repeatable and drops abilities at the cap', () => {
    const sheet = derive({
      baseScores: { method: 'manual', scores: { str: 20, dex: 14, con: 14, int: 8, wis: 12, cha: 10 } },
      steps: fighterSteps([1, 2, 3].map(() => ({ kind: 'class_level' as const, classId: 'fighter', selections: [] }))),
    });
    const asi = sheet.pending.find((p) => p.options.pick === 'feat' && p.options.categories.includes('general'));
    expect(asi).toBeDefined();
    const featAsi = derive({
      baseScores: { method: 'manual', scores: { str: 20, dex: 14, con: 14, int: 8, wis: 12, cha: 10 } },
      steps: fighterSteps([
        { kind: 'class_level', classId: 'fighter', selections: [] },
        { kind: 'class_level', classId: 'fighter', selections: [sel('class', 'fighter', 'subclass', 'champion')] },
        { kind: 'class_level', classId: 'fighter', selections: [sel('class', 'fighter', asi?.choiceId ?? '', 'ability_score_improvement')] },
      ]),
    });
    const increase = featAsi.pending.find((p) => p.options.pick === 'ability_score');
    expect(increase?.repeatable).toBe(true);
    // FOR 20 já está no teto do talento.
    expect(increase?.candidates).not.toContain('str');
    expect(increase?.candidates).toContain('dex');
  });

  it('offers the subclasses of the class', () => {
    const sheet = derive({ steps: fighterSteps([{ kind: 'class_level', classId: 'fighter', selections: [] }, { kind: 'class_level', classId: 'fighter', selections: [] }]) });
    expect(pendingOf(sheet.pending, 'subclass')?.candidates).toEqual(compendium.subclasses.filter((s) => s.classId === 'fighter').map((s) => s.id));
  });
});

describe('pruneSelections', () => {
  it('drops selections no choice uses anymore and keeps the rest', () => {
    const steps = CharacterSchema.shape.steps.parse(fighterSteps());
    // O jogador troca o estilo de luta por nada e deixa uma seleção solta de um talento que não tem.
    const loose = sel('feat', 'magic_initiate_wizard', 'cantrips', 'light', 'mage_hand');
    const withLoose = steps.map((s) => (s.kind === 'class_level' ? { ...s, selections: [...s.selections, loose] } : s));
    const pruned = pruneSelections(withLoose, compendium);
    expect(pruned).toEqual(steps);
    expect(pruneSelections(steps, compendium)).toEqual(steps);
  });
});
