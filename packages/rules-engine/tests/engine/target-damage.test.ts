import { describe, expect, it } from 'vitest';
import { deriveSheet, targetDamage } from '../../src/engine';
import { CharacterSchema, type GmAdjustment, InventorySchema } from '../../src/schemas';
import { loadSrdCompendium } from '../../src/srd';
import fixtureJson from '../fixtures/elf-wizard-7.json';

const compendium = loadSrdCompendium();

describe('targetDamage', () => {
  const hex = { name: 'Hex', effects: [{ type: 'target_damage' as const, dice: '1d6', damageType: 'necrotic' as const }] };
  const spirits = { name: 'Espíritos', effects: [{ type: 'target_damage' as const, dice: '2d8', damageType: 'cold' as const, within: 15 }] };

  it('a mark on the target always counts; an emanation needs the distance', () => {
    expect(targetDamage([hex], [], undefined).damage).toEqual([{ dice: '1d6', type: 'necrotic', source: 'Hex' }]);
    expect(targetDamage([], [spirits], 15).damage).toHaveLength(1);
    expect(targetDamage([], [spirits], 20)).toEqual({ damage: [], reminders: [] });
    expect(targetDamage([], [spirits], undefined).reminders).toHaveLength(1);
    // A marca em quem ataca não é dele, e a emanação no alvo também não.
    expect(targetDamage([spirits], [hex], 5).damage).toEqual([]);
  });
});

describe('spell on a weapon', () => {
  const sheetWith = (adjustments: GmAdjustment[]) =>
    deriveSheet({
      character: CharacterSchema.parse((fixtureJson as { character: unknown }).character),
      inventory: InventorySchema.parse({
        items: [
          { instanceId: 'staff', itemId: 'quarterstaff', equipped: true },
          { instanceId: 'dagger', itemId: 'dagger', equipped: true },
        ],
      }),
      adjustments,
      compendium,
    }).attacks;

  it('Magic Weapon raises only the chosen weapon', () => {
    const before = sheetWith([]);
    const after = sheetWith([
      { id: 'mw', name: 'Magic Weapon', weapon: 'dagger', effects: [{ type: 'flat_bonus', target: 'attack.weapon', value: 1 }, { type: 'flat_bonus', target: 'damage.weapon', value: 1 }] },
    ]);
    const total = (list: typeof before, id: string) => list.find((a) => a.instanceId === id)?.attack.total ?? 0;
    expect(total(after, 'dagger')).toBe(total(before, 'dagger') + 1);
    expect(total(after, 'staff')).toBe(total(before, 'staff'));
  });

  it('Shillelagh changes the die, the type and the ability of the chosen weapon only', () => {
    const after = sheetWith([
      {
        id: 'sh',
        name: 'Shillelagh',
        weapon: 'staff',
        effects: [{ type: 'base_override', damageDice: '1d10' }, { type: 'base_override', damageType: 'force' }, { type: 'attack_ability', ability: 'int', scope: 'weapon' }],
      },
    ]);
    expect(after.find((a) => a.instanceId === 'staff')).toMatchObject({ ability: 'int', damage: { dice: '1d10', type: 'force' }, versatileDice: '1d10' });
    expect(after.find((a) => a.instanceId === 'dagger')).toMatchObject({ ability: 'dex', damage: { dice: '1d4', type: 'piercing' } });
  });
});
