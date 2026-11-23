import type { Condition, DamageType } from '../schemas/common';

/** Nomes em pt-BR usados nas mensagens do motor (lembretes, log de dano). */

export const CONDITION_NAME: Record<Condition, string> = {
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

export const DAMAGE_NAME: Record<DamageType, string> = {
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
