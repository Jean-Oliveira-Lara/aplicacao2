import type { QuickMessage } from '../types';
import { storage, STORAGE_KEYS } from './storage';
import { queueOp } from '../auth/syncQueue';

// Cada conta começa com a lista vazia. (As mensagens que já estavam no
// celular passam para a conta no primeiro login: ver auth/syncQueue.ts.)
const DEFAULT_MESSAGES: QuickMessage[] = [];

/** Manda a mensagem (nova ou editada) para o banco, na posição atual da lista. */
function queueUpsert(message: QuickMessage, list: QuickMessage[]) {
  queueOp({
    kind: 'msg-upsert',
    id: message.id,
    name: message.name,
    text: message.text,
    position: Math.max(0, list.findIndex((m) => m.id === message.id)),
    createdAt: message.createdAt,
  });
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function getMessages(): Promise<QuickMessage[]> {
  const stored = await storage.get<QuickMessage[]>(STORAGE_KEYS.messages);
  if (stored && stored.length > 0) return stored;
  // Seed with a starter message on first run so the app isn't empty.
  await storage.set(STORAGE_KEYS.messages, DEFAULT_MESSAGES);
  return DEFAULT_MESSAGES;
}

export async function createMessage(name: string, text: string): Promise<QuickMessage> {
  const messages = await getMessages();
  const now = new Date().toISOString();
  const newMessage: QuickMessage = {
    id: makeId(),
    name: name.trim(),
    text: text.trim(),
    createdAt: now,
    updatedAt: now,
  };
  const updated = [...messages, newMessage];
  await storage.set(STORAGE_KEYS.messages, updated);
  queueUpsert(newMessage, updated);
  return newMessage;
}

export async function updateMessage(
  id: string,
  name: string,
  text: string
): Promise<QuickMessage[]> {
  const messages = await getMessages();
  const updated = messages.map((message) =>
    message.id === id
      ? { ...message, name: name.trim(), text: text.trim(), updatedAt: new Date().toISOString() }
      : message
  );
  await storage.set(STORAGE_KEYS.messages, updated);
  const edited = updated.find((message) => message.id === id);
  if (edited) queueUpsert(edited, updated);
  return updated;
}

export async function deleteMessage(id: string): Promise<QuickMessage[]> {
  const messages = await getMessages();
  const updated = messages.filter((message) => message.id !== id);
  await storage.set(STORAGE_KEYS.messages, updated);
  queueOp({ kind: 'msg-delete', id });
  return updated;
}
