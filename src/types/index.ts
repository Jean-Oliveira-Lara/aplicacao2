/**
 * Domain types shared across the app.
 * Kept separate from services so the storage layer (localStorage today,
 * Supabase tomorrow) can change without touching consumers.
 */

export interface QuickMessage {
  id: string;
  name: string;
  text: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

export interface HistoryEntry {
  id: string;
  /** Digits only, including country code, e.g. "5544999999999" */
  phoneDigits: string;
  /** Local number only (no country code), raw digits, e.g. "44999999999" — no mask applied. */
  phoneLocalDigits: string;
  messageId: string | null;
  messageName: string | null;
  messageText: string;
  sentAt: string; // ISO date string
}

export interface AppSettings {
  countryCode: string; // e.g. "55"
}
