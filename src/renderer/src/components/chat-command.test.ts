import { describe, expect, it } from 'vitest';
import { parseChatInput } from './chat-command';

/** A mensagem de erro, ou `''` se o comando foi aceito. */
const errorOf = (input: string): string => {
  const command = parseChatInput(input);
  return command.ok ? '' : command.message;
};

describe('parseChatInput', () => {
  it('turns plain text into a chat message', () => {
    expect(parseChatInput('  Olá, mesa!  ')).toEqual({ ok: true, intent: { kind: 'chat.message', data: { text: 'Olá, mesa!' } } });
  });

  it('turns /r and /gr into public and secret rolls, with an optional label', () => {
    expect(parseChatInput('/r 2d6+3')).toEqual({ ok: true, intent: { kind: 'dice.roll', data: { formula: '2d6+3', visibility: 'public' } } });
    expect(parseChatInput('/r 1D20+5 Ataque com espada')).toEqual({
      ok: true,
      intent: { kind: 'dice.roll', data: { formula: '1d20+5', label: 'Ataque com espada', visibility: 'public' } },
    });
    expect(parseChatInput('/gr 1d20')).toEqual({ ok: true, intent: { kind: 'dice.roll', data: { formula: '1d20', visibility: 'gm' } } });
  });

  it('explains what is wrong', () => {
    expect(parseChatInput('   ')).toEqual({ ok: false, message: 'Mensagem vazia' });
    expect(errorOf('/x 1d20')).toContain('Comando desconhecido');
    expect(errorOf('/r')).toContain('Fórmula inválida');
    expect(errorOf('/r 2d7')).toContain('Fórmula inválida');
    expect(errorOf('/r 101d6')).toContain('Fórmula inválida');
    expect(errorOf(`/r 1d20 ${'a'.repeat(101)}`)).toContain('Rótulo');
    expect(errorOf('a'.repeat(2001))).toContain('longa demais');
  });
});
