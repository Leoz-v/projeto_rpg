import { useState } from 'react';
import type { Token } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { describeEffect } from './effect-forms';

/** Efeitos de magia sobre um token de monstro (nota 0062), com o botão de encerrar para quem o controla. */
export function TokenEffects({ token, canEdit }: { token: Token; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (token.characterId !== null || token.spellEffects.length === 0) return null;
  return (
    <div className="token-effects">
      <ul>
        {token.spellEffects.map((e) => (
          <li key={e.id}>
            <strong>{e.name}</strong> <span className="hint">{e.effects.map(describeEffect).join(' · ')}</span>{' '}
            {canEdit && (
              <button type="button" className="link" onClick={() => void sendIntent({ kind: 'token.effect_remove', data: { tokenId: token.id, effectId: e.id } }).then(setError)}>
                Encerrar
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
