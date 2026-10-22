import type { QuickMessage } from '../types';
import { storage, STORAGE_KEYS } from './storage';
import { applyMessagePacks } from './messagePacks';

// A antiga "Mensagem inicial" foi removida a pedido; a lista começa com
// as mensagens dos pacotes (messagePacks.ts).
const DEFAULT_MESSAGES: QuickMessage[] = [];

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function getMessages(): Promise<QuickMessage[]> {
  // Soma as mensagens dos pacotes novos (uma vez por aparelho).
  applyMessagePacks(DEFAULT_MESSAGES);
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
  return updated;
}

export async function deleteMessage(id: string): Promise<QuickMessage[]> {
  const messages = await getMessages();
  const updated = messages.filter((message) => message.id !== id);
  await storage.set(STORAGE_KEYS.messages, updated);
  return updated;
}
