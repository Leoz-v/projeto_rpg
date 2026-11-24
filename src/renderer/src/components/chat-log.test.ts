import { describe, expect, it } from 'vitest';
import type { ChatEntry } from '../../../shared/protocol';
import { addToChatLog, chatLogEntries, chatLogWithWindow, EMPTY_CHAT_LOG, firstChatIndex } from './chat-log';

const entry = (n: number): ChatEntry => ({ kind: 'message', id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, at: n, authorId: '00000000-0000-4000-8000-000000000000', text: `m${n}` });
const texts = (entries: ChatEntry[]): string[] => entries.map((e) => (e.kind === 'message' ? e.text : e.kind));

describe('chat log', () => {
  it('keeps what left the window and orders by position in the full log', () => {
    let log = addToChatLog(EMPTY_CHAT_LOG, 10, [entry(10), entry(11), entry(12)]);
    // A janela andou: 11 e 12 continuam, 13 chegou, 10 saiu da janela mas fica.
    log = addToChatLog(log, 11, [entry(11), entry(12), entry(13)]);
    expect(texts(chatLogEntries(log))).toEqual(['m10', 'm11', 'm12', 'm13']);
    expect(firstChatIndex(log)).toBe(10);
  });

  it('puts older pages before the window, without changing the previous log', () => {
    const window = addToChatLog(EMPTY_CHAT_LOG, 5, [entry(5), entry(6)]);
    const withOlder = addToChatLog(window, 2, [entry(2), entry(3), entry(4)]);
    expect(texts(chatLogEntries(withOlder))).toEqual(['m2', 'm3', 'm4', 'm5', 'm6']);
    expect(firstChatIndex(withOlder)).toBe(2);
    expect(window.size).toBe(2);
  });

  it('starts at 0 when empty', () => {
    expect(firstChatIndex(EMPTY_CHAT_LOG)).toBe(0);
    expect(chatLogEntries(EMPTY_CHAT_LOG)).toEqual([]);
    expect(addToChatLog(EMPTY_CHAT_LOG, 0, [])).toBe(EMPTY_CHAT_LOG);
  });
});

describe('chat log with the window', () => {
  it('keeps saved pages that touch the window and drops them after a gap', () => {
    const saved = addToChatLog(EMPTY_CHAT_LOG, 0, [entry(0), entry(1), entry(2)]);
    expect(texts(chatLogEntries(chatLogWithWindow(saved, 3, [entry(3)])))).toEqual(['m0', 'm1', 'm2', 'm3']);
    expect(texts(chatLogEntries(chatLogWithWindow(saved, 2, [entry(2), entry(3)])))).toEqual(['m0', 'm1', 'm2', 'm3']);
    expect(texts(chatLogEntries(chatLogWithWindow(saved, 5, [entry(5)])))).toEqual(['m5']);
  });
});
