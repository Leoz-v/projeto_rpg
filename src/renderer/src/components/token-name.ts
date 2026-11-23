/**
 * Nome do próximo token de um mesmo monstro: "Goblin Boss 1", "Goblin Boss 2"…
 * Segue o maior número já usado no mapa, para não repetir depois de remover
 * um token do meio.
 */
export function nextTokenName(base: string, existing: readonly string[]): string {
  const name = base.trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped} (\\d+)$`);
  let highest = 0;
  for (const other of existing) {
    const match = pattern.exec(other);
    if (match?.[1]) highest = Math.max(highest, Number(match[1]));
  }
  return `${name} ${highest + 1}`;
}
