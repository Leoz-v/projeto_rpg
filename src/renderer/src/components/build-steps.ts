import type { BuildStep, Selection, Size } from 'rules-engine/schemas';
import type { SessionCharacter } from '../../../shared/protocol';

/**
 * Edição da lista de passos de construção na tela: cada função devolve a lista
 * nova, que vai inteira para o Host num `character.update`. Validar as escolhas
 * é papel do motor; aqui só se mantém a ordem (espécie, antecedente, níveis de
 * classe) e se descartam as seleções de uma fonte que foi trocada.
 */

type Steps = SessionCharacter['steps'];
type BackgroundStep = Extract<BuildStep, { kind: 'background' }>;
export type AbilityIncreases = BackgroundStep['abilityIncreases'];

const indexOfKind = (steps: Steps, kind: BuildStep['kind']): number => steps.findIndex((s) => s.kind === kind);

export function setSpecies(steps: Steps, speciesId: string, size: Size | undefined): Steps {
  const i = indexOfKind(steps, 'species');
  const current = i >= 0 ? steps[i] : undefined;
  const selections = current?.kind === 'species' && current.speciesId === speciesId ? current.selections : [];
  const step: BuildStep = { kind: 'species', speciesId, ...(size !== undefined ? { size } : {}), selections };
  if (i >= 0) return steps.map((s, j) => (j === i ? step : s));
  return [step, ...steps];
}

export function setBackground(steps: Steps, backgroundId: string, abilityIncreases: AbilityIncreases): Steps {
  const i = indexOfKind(steps, 'background');
  const current = i >= 0 ? steps[i] : undefined;
  const selections = current?.kind === 'background' && current.backgroundId === backgroundId ? current.selections : [];
  const step: BuildStep = { kind: 'background', backgroundId, abilityIncreases, selections };
  if (i >= 0) return steps.map((s, j) => (j === i ? step : s));
  // Depois da espécie, antes das classes.
  const at = indexOfKind(steps, 'species') + 1;
  return [...steps.slice(0, at), step, ...steps.slice(at)];
}

/** Classe de nível 1: acrescenta, ou troca enquanto o personagem só tem um nível. */
export function setFirstClass(steps: Steps, classId: string): Steps {
  const levels = steps.filter((s) => s.kind === 'class_level');
  if (levels.length > 1) throw new Error('A classe inicial só muda no nível 1');
  const i = indexOfKind(steps, 'class_level');
  const current = i >= 0 ? steps[i] : undefined;
  const selections = current?.kind === 'class_level' && current.classId === classId ? current.selections : [];
  const step: BuildStep = { kind: 'class_level', classId, selections };
  if (i >= 0) return steps.map((s, j) => (j === i ? step : s));
  return [...steps, step];
}

export function addSelection(steps: Steps, stepIndex: number, selection: Selection): Steps {
  return steps.map((s, i) => (i === stepIndex ? { ...s, selections: [...s.selections, selection] } : s));
}

/** Desfaz uma seleção. As que dependiam dela ficam soltas e o Host as descarta. */
export function removeSelection(steps: Steps, stepIndex: number, index: number): Steps {
  return steps.map((s, i) => (i === stepIndex ? { ...s, selections: s.selections.filter((_, j) => j !== index) } : s));
}

/** Subir de nível: mais um passo de classe no fim (a mesma classe ou multiclasse). */
export function addClassLevel(steps: Steps, classId: string): Steps {
  return [...steps, { kind: 'class_level', classId, selections: [] }];
}

/** Desfaz o último nível (a classe do nível 1 só muda pela troca de classe inicial). */
export function removeLastLevel(steps: Steps): Steps {
  const last = steps.at(-1);
  if (last?.kind !== 'class_level' || steps.filter((s) => s.kind === 'class_level').length < 2) throw new Error('Não há nível para desfazer');
  return steps.slice(0, -1);
}
