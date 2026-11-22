import { networkInterfaces } from 'node:os';

/**
 * Endereços IPv4 desta máquina que um jogador pode usar para entrar (sem o
 * loopback). Na rede virtual, o do Tailscale (100.x) ou do ZeroTier aparece aqui.
 */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}
