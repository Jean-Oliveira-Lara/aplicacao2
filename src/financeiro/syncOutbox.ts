/**
 * Fila de envios para o banco ("outbox").
 *
 * Quando o discador registra um envio, ele entra nesta fila no
 * localStorage na mesma hora (de forma síncrona, antes de o app sair
 * para o WhatsApp). Depois a fila é mandada para /api/sends:
 *  - logo em seguida (com keepalive, que sobrevive à troca de app);
 *  - quando o app volta para a frente, quando a internet volta e
 *    periodicamente enquanto houver pendências;
 *  - logo depois do login no painel.
 * Cada envio tem um id fixo, então reenviar nunca duplica no banco.
 * Se ainda não houver login, os envios ficam guardados até você entrar.
 */
import type { HistoryEntry } from '../types';

const OUTBOX_KEY = 'discador:sync-outbox';
const BATCH_SIZE = 20;
const RETRY_INTERVAL_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OutboxItem {
  id: string;
  phoneDigits: string;
  phoneLocalDigits: string;
  messageId: string | null;
  messageName: string | null;
  messageText: string;
  sentAt: string;
}

export interface SyncState {
  pending: number;
  needsLogin: boolean;
  lastError: string | null;
}

let state: SyncState = { pending: 0, needsLogin: false, lastError: null };
const listeners = new Set<(s: SyncState) => void>();
let flushing: Promise<SyncState> | null = null;

function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function read(): OutboxItem[] {
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]): void {
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('Falha ao salvar a fila de sincronização', error);
  }
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch, pending: read().length };
  listeners.forEach((fn) => fn(state));
}

export function getSyncState(): SyncState {
  return { ...state, pending: read().length };
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Chamado pelo historyService a cada envio do discador. Nunca lança erro. */
export function enqueueSend(entry: HistoryEntry): void {
  try {
    const items = read();
    items.push({
      // O id do histórico é reaproveitado quando já é um UUID; em celulares
      // antigos sem crypto.randomUUID ele não é, então geramos um aqui (uma
      // única vez, e ele fica salvo junto do item).
      id: UUID_RE.test(entry.id) ? entry.id : randomUuid(),
      phoneDigits: entry.phoneDigits,
      phoneLocalDigits: entry.phoneLocalDigits,
      messageId: entry.messageId,
      messageName: entry.messageName,
      messageText: entry.messageText,
      sentAt: entry.sentAt,
    });
    write(items);
    setState({});
    void flushOutbox();
  } catch (error) {
    console.error('Falha ao enfileirar envio para o banco', error);
  }
}

/** Manda a fila para o servidor. Chamadas simultâneas compartilham a mesma execução. */
export function flushOutbox(): Promise<SyncState> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      let items = read();
      while (items.length > 0) {
        const batch = items.slice(0, BATCH_SIZE);
        const body = JSON.stringify({ sends: batch });
        let res: Response;
        try {
          res = await fetch('/api/sends', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: body.length < 60_000,
          });
        } catch {
          setState({ lastError: 'Sem conexão. Os envios serão sincronizados depois.' });
          break;
        }
        if (res.status === 401) {
          setState({ needsLogin: true, lastError: null });
          break;
        }
        if (!res.ok) {
          setState({ lastError: 'O servidor não respondeu. Nova tentativa em instantes.' });
          break;
        }
        const data = (await res.json()) as { results?: { id: string | null; ok: boolean; error?: string }[] };
        const done = new Set<string>();
        for (const result of data.results ?? []) {
          if (result.id) done.add(result.id.toLowerCase());
          if (!result.ok) console.warn('Envio recusado pelo servidor e descartado da fila:', result.error);
        }
        // Relê a fila: novos envios podem ter entrado enquanto esperávamos.
        const remaining = read().filter((item) => !done.has(item.id.toLowerCase()));
        write(remaining);
        setState({ needsLogin: false, lastError: null });
        if (done.size === 0) break; // resposta inesperada: evita laço infinito
        items = remaining;
      }
      return getSyncState();
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

// Gatilhos automáticos (registrados uma vez, quando o app carrega).
if (typeof window !== 'undefined') {
  const tryFlush = () => {
    if (read().length > 0) void flushOutbox();
  };
  window.setTimeout(tryFlush, 2_000);
  window.addEventListener('online', tryFlush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryFlush();
  });
  window.setInterval(tryFlush, RETRY_INTERVAL_MS);
}
