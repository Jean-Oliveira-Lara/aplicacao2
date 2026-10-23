import type { HistoryEntry } from '../types';
import { storage, STORAGE_KEYS } from './storage';
import { enqueueSend } from '../financeiro/syncOutbox';
import { queueOp } from '../auth/syncQueue';

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `hist-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const stored = await storage.get<HistoryEntry[]>(STORAGE_KEYS.history);
  if (!stored) return [];
  // Most recent first.
  return [...stored].sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
  );
}

export async function addHistoryEntry(
  entry: Omit<HistoryEntry, 'id' | 'sentAt'>
): Promise<HistoryEntry> {
  const history = await storage.get<HistoryEntry[]>(STORAGE_KEYS.history);
  const newEntry: HistoryEntry = {
    ...entry,
    id: makeId(),
    sentAt: new Date().toISOString(),
  };
  const updated = [newEntry, ...(history ?? [])];
  await storage.set(STORAGE_KEYS.history, updated);
  // Painel financeiro: registra o envio no banco (fila com nova tentativa).
  enqueueSend(newEntry);
  // Recentes: guarda o registro no banco, na conta logada.
  queueOp({ kind: 'recents-add', entries: [newEntry] });
  return newEntry;
}

export async function deleteHistoryEntry(id: string): Promise<HistoryEntry[]> {
  const history = await storage.get<HistoryEntry[]>(STORAGE_KEYS.history);
  const updated = (history ?? []).filter((entry) => entry.id !== id);
  await storage.set(STORAGE_KEYS.history, updated);
  queueOp({ kind: 'recent-delete', id });
  return updated;
}

export async function clearHistory(): Promise<void> {
  await storage.set(STORAGE_KEYS.history, []);
  queueOp({ kind: 'recents-clear', before: new Date().toISOString() });
}
