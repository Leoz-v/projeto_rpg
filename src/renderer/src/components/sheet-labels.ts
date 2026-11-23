import type { Ability, Condition, DamageType, Sense, Size, Skill } from 'rules-engine/schemas';

/** Rótulos em pt-BR da ficha. Nomes do compêndio (SRD) ficam em inglês até a tradução. */

export const ABILITY_LABEL: Record<Ability, { short: string; long: string }> = {
  str: { short: 'FOR', long: 'Força' },
  dex: { short: 'DES', long: 'Destreza' },
  con: { short: 'CON', long: 'Constituição' },
  int: { short: 'INT', long: 'Inteligência' },
  wis: { short: 'SAB', long: 'Sabedoria' },
  cha: { short: 'CAR', long: 'Carisma' },
};

export const SKILL_LABEL: Record<Skill, string> = {
  acrobatics: 'Acrobacia',
  animal_handling: 'Lidar com Animais',
  arcana: 'Arcanismo',
  athletics: 'Atletismo',
  deception: 'Enganação',
  history: 'História',
  insight: 'Intuição',
  intimidation: 'Intimidação',
  investigation: 'Investigação',
  medicine: 'Medicina',
  nature: 'Natureza',
  perception: 'Percepção',
  performance: 'Atuação',
  persuasion: 'Persuasão',
  religion: 'Religião',
  sleight_of_hand: 'Prestidigitação',
  stealth: 'Furtividade',
  survival: 'Sobrevivência',
};

export const DAMAGE_LABEL: Record<DamageType, string> = {
  acid: 'Ácido',
  bludgeoning: 'Concussão',
  cold: 'Frio',
  fire: 'Fogo',
  force: 'Energia',
  lightning: 'Elétrico',
  necrotic: 'Necrótico',
  piercing: 'Perfurante',
  poison: 'Veneno',
  psychic: 'Psíquico',
  radiant: 'Radiante',
  slashing: 'Cortante',
  thunder: 'Trovejante',
};

export const CONDITION_LABEL: Record<Condition, string> = {
  blinded: 'Cego',
  charmed: 'Enfeitiçado',
  deafened: 'Surdo',
  exhaustion: 'Exaustão',
  frightened: 'Amedrontado',
  grappled: 'Agarrado',
  incapacitated: 'Incapacitado',
  invisible: 'Invisível',
  paralyzed: 'Paralisado',
  petrified: 'Petrificado',
  poisoned: 'Envenenado',
  prone: 'Caído',
  restrained: 'Impedido',
  stunned: 'Atordoado',
  unconscious: 'Inconsciente',
};

export const SENSE_LABEL: Record<Sense, string> = {
  blindsight: 'Percepção às Cegas',
  darkvision: 'Visão no Escuro',
  tremorsense: 'Sentido Sísmico',
  truesight: 'Visão Verdadeira',
};

export const SIZE_LABEL: Record<Size, string> = {
  tiny: 'Miúdo',
  small: 'Pequeno',
  medium: 'Médio',
  large: 'Grande',
  huge: 'Enorme',
  gargantuan: 'Imenso',
};

/** Categorias de treinamento com armas e armaduras. */
const PROFICIENCY_LABEL: Record<string, string> = {
  simple: 'Armas simples',
  martial: 'Armas marciais',
  light: 'Armaduras leves',
  medium: 'Armaduras médias',
  heavy: 'Armaduras pesadas',
  shield: 'Escudos',
  shields: 'Escudos',
};

/** `sleight_of_hand` → `Sleight of hand`: para ids sem nome conhecido (idiomas, categorias). */
export function humanizeId(id: string): string {
  const text = id.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Nome de um id: do compêndio, das categorias conhecidas ou o próprio id legível. */
export function nameOf(id: string, names: Readonly<Record<string, string>>): string {
  return names[id] ?? PROFICIENCY_LABEL[id] ?? humanizeId(id);
}

/** `+3`, `−1`, `+0`. */
export function signed(value: number): string {
  return value < 0 ? `−${-value}` : `+${value}`;
}
