import { ChatTextSchema, FormulaSchema, type Intent, LabelSchema } from '../../../shared/protocol';

/**
 * O que o jogador digita no chat vira um `Intent`:
 * - texto comum → `chat.message`;
 * - `/r 2d6+3 Dano` → `dice.roll` pública (o rótulo é opcional);
 * - `/gr 1d20` → `dice.roll` só para o mestre (e para quem rolou).
 */

export type ChatCommand = { ok: true; intent: Intent } | { ok: false; message: string };

export const CHAT_HELP = 'Digite uma mensagem, /r 2d6+3 para rolar ou /gr 1d20 para rolar em segredo para o mestre.';

export function parseChatInput(input: string): ChatCommand {
  const text = input.trim();
  if (text === '') return { ok: false, message: 'Mensagem vazia' };

  if (!text.startsWith('/')) {
    const parsed = ChatTextSchema.safeParse(text);
    return parsed.success ? { ok: true, intent: { kind: 'chat.message', data: { text: parsed.data } } } : { ok: false, message: 'Mensagem longa demais (até 2000 caracteres)' };
  }

  const [command = '', formula = '', ...rest] = text.split(/\s+/);
  const visibility = command === '/r' ? 'public' : command === '/gr' ? 'gm' : undefined;
  if (!visibility) return { ok: false, message: `Comando desconhecido. ${CHAT_HELP}` };

  const parsedFormula = FormulaSchema.safeParse(formula.toLowerCase());
  if (!parsedFormula.success) return { ok: false, message: 'Fórmula inválida: use algo como 2d6+3 (dados d4, d6, d8, d10, d12, d20 e d100, até 100 dados)' };

  const label = rest.join(' ');
  if (label === '') return { ok: true, intent: { kind: 'dice.roll', data: { formula: parsedFormula.data, visibility } } };
  const parsedLabel = LabelSchema.safeParse(label);
  if (!parsedLabel.success) return { ok: false, message: 'Rótulo longo demais (até 100 caracteres)' };
  return { ok: true, intent: { kind: 'dice.roll', data: { formula: parsedFormula.data, label: parsedLabel.data, visibility } } };
}
