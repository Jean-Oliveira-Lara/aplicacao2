/**
 * Storage abstraction.
 *
 * Every read/write in the app goes through this interface instead of
 * calling `localStorage` directly. The methods are `async` on purpose:
 * `localStorage` doesn't need it today, but a future Supabase-backed
 * implementation will, and this keeps callers unchanged when that swap
 * happens.
 */
import { scopedKey } from '../auth/session';

export interface StorageDriver {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

/**
 * Cópia local POR CONTA: cada chave ganha o sufixo da conta logada
 * (ver src/auth/session.ts). O banco de dados é a fonte oficial; esta
 * cópia deixa o discador funcionar sem internet.
 */
class LocalStorageDriver implements StorageDriver {
  async get<T>(baseKey: string): Promise<T | null> {
    const key = scopedKey(baseKey);
    if (!key) return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      console.error(`Falha ao ler "${key}" do localStorage`, error);
      return null;
    }
  }

  async set<T>(baseKey: string, value: T): Promise<void> {
    const key = scopedKey(baseKey);
    if (!key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Falha ao salvar "${key}" no localStorage`, error);
    }
  }
}

// Swap this single line for a Supabase-backed driver when the app grows
// beyond a single device (e.g. `export const storage = new SupabaseDriver()`).
export const storage: StorageDriver = new LocalStorageDriver();

export const STORAGE_KEYS = {
  messages: 'discador:messages',
  history: 'discador:history',
  settings: 'discador:settings',
} as const;
