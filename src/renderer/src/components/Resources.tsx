import { type ReactNode, useState } from 'react';
import { availableUses } from 'rules-engine/resources';
import type { SheetResource } from 'rules-engine';
import type { ChatEntry, SessionCharacter } from '../../../shared/protocol';
import { sendIntent } from '../store/table';

/**
 * Recursos de uso limitado na ficha (nota 0052): usos que restam, gastar e
 * recuperar. Reservas grandes (Lay On Hands, Focus Points) aceitam uma
 * quantidade. Os descansos devolvem no Host.
 */

const RECHARGE_LABEL = { long_rest: 'descanso longo', short_rest: 'descanso curto ou longo', short_rest_one: '1 no curto, todos no longo' } as const;
/** Acima disso, mostra o número em vez das marcas e aceita quantidade. */
const PIPS_LIMIT = 8;

export function ResourcesControl({ character, resources, canEdit }: { character: SessionCharacter; resources: readonly SheetResource[]; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (resources.length === 0) return null;
  return (
    <section className="resources" aria-label="Recursos">
      <h3>Recursos</h3>
      <ul>
        {resources.map((r) => (
          <ResourceRow
            key={r.id}
            characterId={character.id}
            resource={r}
            available={availableUses(r.max, character.resourcesSpent, r.id)}
            canEdit={canEdit}
            onError={setError}
          />
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ResourceRow({
  characterId,
  resource,
  available,
  canEdit,
  onError,
}: {
  characterId: string;
  resource: SheetResource;
  available: number;
  canEdit: boolean;
  onError: (message: string | null) => void;
}) {
  const pool = resource.max > PIPS_LIMIT;
  const [amount, setAmount] = useState('1');
  const value = Number(amount);
  const valid = Number.isInteger(value) && value >= 1 && value <= 100;
  const send = (kind: 'resource.spend' | 'resource.restore'): void => {
    void sendIntent({ kind, data: { characterId, resourceId: resource.id, ...(pool && valid ? { amount: value } : {}) } }).then(onError);
  };
  return (
    <li className="resource-row" title={`${resource.source.name} · recarga: ${RECHARGE_LABEL[resource.recharge]}`}>
      <span className="resource-name">{resource.name}</span>
      {pool ? (
        <span className="resource-count">
          {available}/{resource.max}
        </span>
      ) : (
        <span className="slot-pips" aria-label={`${available} de ${resource.max}`}>
          {Array.from({ length: resource.max }, (_, i) => (
            <span key={i} className={i < available ? 'pip on' : 'pip'}>
              {i < available ? '◆' : '◇'}
            </span>
          ))}
        </span>
      )}
      {canEdit && (
        <>
          {pool && (
            <input
              type="number"
              min={1}
              max={100}
              className="resource-amount"
              aria-label={`Quantidade de ${resource.name}`}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
            />
          )}
          <button type="button" className="small" disabled={available === 0 || (pool && !valid)} onClick={() => { send('resource.spend'); }}>
            Gastar
          </button>
          <button type="button" className="small secondary" disabled={available === resource.max || (pool && !valid)} onClick={() => { send('resource.restore'); }}>
            Recuperar
          </button>
        </>
      )}
    </li>
  );
}

export function ResourceBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'resource' }>; header: ReactNode }) {
  const amount = entry.amount > 1 ? ` ${entry.amount}` : '';
  return (
    <li className="entry slot-event">
      {header}
      <p>
        {entry.characterName} {entry.event === 'spent' ? 'gastou' : 'recuperou'}
        {amount} {entry.resourceName} ({entry.available}/{entry.max})
      </p>
    </li>
  );
}
