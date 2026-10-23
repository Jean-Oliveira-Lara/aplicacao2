/**
 * Sincronização das mensagens prontas e dos Recentes com o banco.
 *
 * O discador continua lendo e gravando na cópia local (para funcionar na
 * rua, sem internet). Cada alteração vira uma "operação" numa fila desta
 * conta, enviada ao servidor na ordem em que aconteceu:
 *  - logo em seguida, quando o app volta para a frente, quando a
 *    internet volta e a cada minuto enquanto houver pendências.
 * Todas as operações são idempotentes no servidor (repetir não duplica).
 *
 * Ao entrar no app, depois de enviar a fila, a cópia local é atualizada
 * com o que está no banco (que é a fonte oficial).
 */
import type { HistoryEntry, QuickMessage } from '../types';
import { STORAGE_KEYS } from '../services/storage';
import { applyMessagePacks } from '../services/messagePacks';
import { AUTH_EXPIRED_EVENT, getCurrentUser, scopedKey } from './session';

const OPS_KEY = 'discador:ops';
/** Conta que recebeu os dados antigos deste aparelho (de antes do login). */
const LEGACY_OWNER_KEY = 'discador:legacy-owner';
const LEGACY_OUTBOX_KEY = 'discador:sync-outbox';
const RECENTS_CHUNK = 200;

type Op =
  | { kind: 'msg-upsert'; id: string; name: string; text: string; position: number; createdAt: string }
  | { kind: 'msg-delete'; id: string }
  | { kind: 'recents-add'; entries: HistoryEntry[] }
  | { kind: 'recent-delete'; id: string }
  | { kind: 'recents-clear'; before: string };

function readJson<T>(key: string | null): T | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function writeJson(key: string | null, value: unknown): void {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Falha ao salvar no armazenamento local', error);
  }
}

function readOps(): Op[] {
  return readJson<Op[]>(scopedKey(OPS_KEY)) ?? [];
}

export function pendingOps(): number {
  return readOps().length;
}

/** Coloca uma operação na fila desta conta e tenta enviar. Nunca lança erro. */
export function queueOp(op: Op): void {
  const key = scopedKey(OPS_KEY);
  if (!key) return;
  const ops = readOps();
  ops.push(op);
  writeJson(key, ops);
  void flushOps();
}

// =====================================================================
// Envio da fila
// =====================================================================

function requestFor(op: Op): { method: string; url: string; body?: unknown } {
  switch (op.kind) {
    case 'msg-upsert':
      return {
        method: 'PUT',
        url: `/api/messages/${encodeURIComponent(op.id)}`,
        body: { name: op.name, text: op.text, position: op.position, createdAt: op.createdAt },
      };
    case 'msg-delete':
      return { method: 'DELETE', url: `/api/messages/${encodeURIComponent(op.id)}` };
    case 'recents-add':
      return { method: 'POST', url: '/api/recents', body: { entries: op.entries } };
    case 'recent-delete':
      return { method: 'DELETE', url: `/api/recents/${encodeURIComponent(op.id)}` };
    case 'recents-clear':
      return { method: 'POST', url: '/api/recents/clear', body: { before: op.before } };
  }
}

let flushing: Promise<boolean> | null = null;

/**
 * Envia a fila na ordem. Retorna true se a fila ficou vazia.
 * Para no primeiro erro de rede/servidor (tenta de novo depois).
 */
export function flushOps(): Promise<boolean> {
  if (flushing) return flushing;
  // O "finally" precisa rodar DEPOIS da atribuição abaixo; por isso fica
  // fora da função assíncrona (que pode terminar sem esperar nada).
  flushing = runFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function runFlush(): Promise<boolean> {
  const userAtStart = getCurrentUser()?.id;
  while (true) {
    const ops = readOps();
    if (ops.length === 0) return true;
    if (getCurrentUser()?.id !== userAtStart) return false; // trocou de conta no meio
    const op = ops[0];
    const req = requestFor(op);
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: req.method,
        credentials: 'same-origin',
        headers: req.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
    } catch {
      return false; // sem internet: fica na fila
    }
    if (res.status === 401) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      return false;
    }
    if (res.status >= 500 || res.status === 429) return false;
    if (!res.ok) console.warn('Operação recusada pelo servidor e descartada:', op.kind, res.status);
    // Sucesso (ou recusa definitiva): tira da fila. Relê para não perder
    // operações que entraram enquanto esperávamos.
    const current = readOps();
    current.shift();
    writeJson(scopedKey(OPS_KEY), current);
  }
}

// =====================================================================
// Atualizar a cópia local com o banco
// =====================================================================

interface SyncData {
  messages: QuickMessage[];
  recents: HistoryEntry[];
}

/**
 * Envia a fila e, se ela ficou vazia, troca a cópia local pelos dados do
 * banco. Retorna false se não deu (sem internet): a cópia local continua.
 */
export async function syncNow(): Promise<boolean> {
  const empty = await flushOps();
  if (!empty) return false;
  let data: SyncData;
  try {
    const res = await fetch('/api/sync', { credentials: 'same-origin' });
    if (res.status === 401) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      return false;
    }
    if (!res.ok) return false;
    data = (await res.json()) as SyncData;
  } catch {
    return false;
  }
  // Uma operação nova pode ter entrado enquanto buscávamos: nesse caso
  // não sobrescreve a cópia local (a próxima sincronização resolve).
  if (readOps().length > 0) return false;
  writeJson(scopedKey(STORAGE_KEYS.messages), data.messages);
  writeJson(scopedKey(STORAGE_KEYS.history), data.recents);
  return true;
}

// =====================================================================
// Dados antigos deste aparelho (de antes do login)
// =====================================================================

/**
 * Na primeira vez que alguém entra neste aparelho depois da atualização,
 * as mensagens prontas, os Recentes e os envios pendentes que estavam
 * salvos no celular passam para a conta dessa pessoa. Acontece uma única
 * vez por aparelho e não duplica nada (cada item mantém o próprio id).
 */
export function importLegacyDataIfNeeded(): void {
  const user = getCurrentUser();
  if (!user) return;
  try {
    if (window.localStorage.getItem(LEGACY_OWNER_KEY)) return;
  } catch {
    return;
  }

  // Só aparelhos que já usavam o discador têm a lista antiga de mensagens.
  // Nesses, aplica antes as atualizações de mensagens que ainda faltavam.
  const hadMessages = readJson<QuickMessage[]>(STORAGE_KEYS.messages) !== null;
  if (hadMessages) applyMessagePacks([]);
  const legacyMessages = hadMessages ? (readJson<QuickMessage[]>(STORAGE_KEYS.messages) ?? []) : [];
  const legacyHistory = readJson<HistoryEntry[]>(STORAGE_KEYS.history) ?? [];
  const legacyOutbox = readJson<unknown[]>(LEGACY_OUTBOX_KEY) ?? [];

  // Cópia local da conta: junta o que já existir com o que veio do aparelho.
  const msgKey = scopedKey(STORAGE_KEYS.messages);
  const histKey = scopedKey(STORAGE_KEYS.history);
  const ownMessages = readJson<QuickMessage[]>(msgKey) ?? [];
  const ownHistory = readJson<HistoryEntry[]>(histKey) ?? [];
  const msgIds = new Set(ownMessages.map((m) => m.id));
  const histIds = new Set(ownHistory.map((h) => h.id));
  writeJson(msgKey, [...ownMessages, ...legacyMessages.filter((m) => !msgIds.has(m.id))]);
  writeJson(
    histKey,
    [...ownHistory, ...legacyHistory.filter((h) => !histIds.has(h.id))].sort(
      (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
    )
  );

  // Fila para o banco.
  const ops = readOps();
  legacyMessages.forEach((m, index) =>
    ops.push({
      kind: 'msg-upsert',
      id: m.id,
      name: m.name,
      text: m.text,
      position: ownMessages.length + index,
      createdAt: m.createdAt,
    })
  );
  for (let i = 0; i < legacyHistory.length; i += RECENTS_CHUNK) {
    ops.push({ kind: 'recents-add', entries: legacyHistory.slice(i, i + RECENTS_CHUNK) });
  }
  writeJson(scopedKey(OPS_KEY), ops);

  // Envios pendentes do financeiro passam para a fila desta conta.
  if (legacyOutbox.length > 0) {
    const outboxKey = scopedKey(LEGACY_OUTBOX_KEY);
    const own = readJson<unknown[]>(outboxKey) ?? [];
    writeJson(outboxKey, [...own, ...legacyOutbox]);
    writeJson(LEGACY_OUTBOX_KEY, []);
  }

  try {
    window.localStorage.setItem(LEGACY_OWNER_KEY, user.id);
  } catch {
    // ignora
  }
}

// Tentativas automáticas (registradas uma vez).
if (typeof window !== 'undefined') {
  const tryFlush = () => {
    if (getCurrentUser() && readOps().length > 0) void flushOps();
  };
  window.addEventListener('online', tryFlush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryFlush();
  });
  window.setInterval(tryFlush, 60_000);
}
