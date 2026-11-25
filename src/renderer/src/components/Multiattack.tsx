import { useEffect, useState } from 'react';
import type { Multiattack as MultiattackData } from 'rules-engine/schemas';
import { availableMonsterUses, monsterSpellUseId } from 'rules-engine/monster-uses';
import { multiattackFits, multiattackSlots } from 'rules-engine/multiattack';
import type { MonsterBlockView } from '../../../shared/ipc';
import type { Token } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { type TargetOption, TargetChecklist } from './SaveEffect';

/** Multiattack de um monstro (nota 0066): um alvo por ataque, e o Host rola tudo de uma vez. */

type Mode = 'normal' | 'advantage' | 'disadvantage';
interface Row {
  actionId: string;
  target: string;
  saveTargets: string[];
  mode: Mode;
}

function MultiattackForm({ token, block, data, description, targets, onError }: { token: Token; block: MonsterBlockView; data: MultiattackData; description: string; targets: readonly TargetOption[]; onError: (m: string | null) => void }) {
  const [option, setOption] = useState(0);
  const { creature } = block;
  const actionOf = (id: string) => creature.actions.find((a) => a.id === id);
  const spellOf = (id: string) => block.spells.find((s) => monsterSpellUseId(s.spellId) === id);
  const nameOf = (id: string): string => {
    const spell = spellOf(id);
    return actionOf(id)?.name ?? (spell ? `${spell.name} (magia)` : id);
  };
  const spent = (id: string): boolean => {
    const use = spellOf(id)?.use;
    const limit = use ? { per: 'day', count: use.perDay } : actionOf(id)?.limit;
    return limit !== undefined && availableMonsterUses({ id, limit }, token.uses) === 0;
  };
  const isSave = (row: Row): boolean => actionOf(row.actionId)?.kind === 'save';
  // Uma ação sem usos ("if available") começa fora.
  const initial = (o: number): Row[] => multiattackSlots(data, o).map((s) => ({ actionId: s.actions.find((id) => !spent(id)) ?? '', target: '', saveTargets: [], mode: 'normal' }));
  const [rows, setRows] = useState<Row[]>(() => initial(0));
  const [busy, setBusy] = useState(false);
  const slots = multiattackSlots(data, option);
  // Sem alvo escolhido, vale o primeiro da lista.
  const targetOf = (row: Row): string => (targets.some((t) => t.id === row.target) ? row.target : (targets[0]?.id ?? ''));
  const used = rows.filter((r) => r.actionId !== '');
  const ready =
    used.length > 0 &&
    multiattackFits(data, option, used.map((r) => r.actionId)) &&
    used.every((r) => !spent(r.actionId) && (spellOf(r.actionId) ? true : isSave(r) ? r.saveTargets.some((id) => targets.some((t) => t.id === id)) : targetOf(r) !== ''));
  const change = (index: number, patch: Partial<Row>): void => {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const send = (): void => {
    setBusy(true);
    void sendIntent({
      kind: 'attack.multi',
      data: {
        tokenId: token.id,
        option,
        steps: used.map((r) => ({
          actionId: r.actionId,
          targetTokenIds: spellOf(r.actionId) ? [] : isSave(r) ? r.saveTargets.filter((id) => targets.some((t) => t.id === id)) : [targetOf(r)],
          ...(!isSave(r) && !spellOf(r.actionId) && r.mode !== 'normal' ? { [r.mode]: true } : {}),
        })),
        visibility: 'public',
      },
    }).then((refused) => {
      setBusy(false);
      onError(refused);
    });
  };
  const label = (o: number): string => multiattackSlots(data, o).map((s) => s.actions.map(nameOf).join(' ou ')).join(', ');
  return (
    <div className="multiattack stack">
      <h3>Multiattack</h3>
      <p className="hint">{description}</p>
      {data.options.length > 1 && (
        <select
          aria-label="Opção do Multiattack"
          value={option}
          onChange={(e) => {
            const next = Number(e.target.value);
            setOption(next);
            setRows(initial(next));
          }}
        >
          {data.options.map((_, i) => (
            <option key={i} value={i}>
              {label(i)}
            </option>
          ))}
        </select>
      )}
      {slots.map((slot, i) => {
        const row = rows[i];
        if (!row) return null;
        return (
          <div key={`${option}:${i}`} className="multiattack-row">
            <select aria-label={`Ação ${i + 1}`} value={row.actionId} onChange={(e) => { change(i, { actionId: e.target.value }); }}>
              {[...slot.actions, ...slot.replacements].map((id) => (
                <option key={id} value={id} disabled={spent(id)}>
                  {nameOf(id)}
                  {slot.replacements.includes(id) ? ' (troca)' : ''}
                  {spent(id) ? ' (sem usos)' : ''}
                </option>
              ))}
              <option value="">não usar</option>
            </select>
            {row.actionId !== '' && isSave(row) && <TargetChecklist targets={targets} selected={row.saveTargets} onChange={(ids) => { change(i, { saveTargets: ids }); }} />}
            {spellOf(row.actionId) && <span className="hint">alvos no chat</span>}
            {row.actionId !== '' && !isSave(row) && !spellOf(row.actionId) && (
              <>
                <select aria-label={`Alvo ${i + 1}`} value={targetOf(row)} onChange={(e) => { change(i, { target: e.target.value }); }}>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Vantagem ou Desvantagem ${i + 1}`}
                  value={row.mode}
                  onChange={(e) => { change(i, { mode: e.target.value === 'advantage' ? 'advantage' : e.target.value === 'disadvantage' ? 'disadvantage' : 'normal' }); }}
                >
                  <option value="normal">normal</option>
                  <option value="advantage">Vantagem</option>
                  <option value="disadvantage">Desvantagem</option>
                </select>
              </>
            )}
          </div>
        );
      })}
      {data.replace && (
        <p className="hint">
          Até {data.replace.max} troca(s){data.replace.cost > 1 ? `, cada uma no lugar de ${data.replace.cost} ataques: marque "não usar" nos outros` : ''}.
        </p>
      )}
      <button type="button" className="secondary" disabled={busy || !ready} onClick={send}>
        Rolar Multiattack
      </button>
    </div>
  );
}

export function Multiattack({ token, targets, onError }: { token: Token; targets: readonly TargetOption[]; onError: (m: string | null) => void }) {
  const { monsterId } = token;
  const [block, setBlock] = useState<MonsterBlockView | null>(null);
  useEffect(() => {
    let alive = true;
    if (monsterId !== null) {
      void window.vtt.monsterBlock(monsterId).then((r) => {
        if (alive && r.ok) setBlock(r.value);
      });
    }
    return () => {
      alive = false;
    };
  }, [monsterId]);
  const action = block?.creature.actions.find((a) => a.kind === 'text' && a.multiattack !== undefined);
  if (!block || action?.kind !== 'text' || !action.multiattack) return null;
  return <MultiattackForm token={token} block={block} data={action.multiattack} description={action.description} targets={targets} onError={onError} />;
}
