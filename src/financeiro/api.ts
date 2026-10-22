/** Cliente da API do painel financeiro (Netlify Functions em /api). */

export type ChargeStatus = 'pendente' | 'pago' | 'cancelado';

export interface Charge {
  id: string;
  phoneDigits: string;
  phoneLocalDigits: string;
  contactName: string | null;
  amountCents: number | null;
  status: ChargeStatus;
  chargedAt: string;
  paidAt: string | null;
  updatedAt: string;
  sendsCount: number;
  lastSentAt: string | null;
}

export interface ChargeEvent {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromAmountCents: number | null;
  toAmountCents: number | null;
  detail: string | null;
  createdAt: string;
}

export interface ChargeSend {
  id: string;
  messageName: string | null;
  sentAt: string;
  sendStatus: string;
}

export interface Totals {
  soldCents: number;
  receivedCents: number;
  pendingCents: number;
  expensesCents: number;
  balanceCents: number;
  contactsCharged: number;
  paidCount: number;
  pendingCount: number;
  noValueCount: number;
}

export interface DayTotals {
  day: string;
  chargesCount: number;
  soldCents: number;
  receivedCents: number;
  pendingCents: number;
  expensesCents: number;
  balanceCents: number;
}

export interface Summary {
  month: string;
  currentMonth: string;
  today: string;
  overall: Totals;
  monthTotals: Totals;
  days: DayTotals[];
}

export interface Expense {
  id: string;
  description: string;
  amountCents: number;
  category: string;
  expenseDate: string;
  note: string | null;
}

export interface Settings {
  defaultAmountCents: number | null;
  timezone: string;
  currentMonth: string;
  today: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Disparado quando a sessão expira, para o painel voltar à tela de login. */
export const AUTH_EXPIRED_EVENT = 'financeiro:auth-expired';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com a internet.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // resposta sem JSON (ex.: servidor fora do ar)
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    const message =
      (data as { error?: string } | null)?.error ??
      (res.status === 404 ? 'API não encontrada. O painel precisa estar publicado no Netlify.' : 'Erro ao falar com o servidor.');
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  me: () => request<{ authenticated: boolean; userConfigured: boolean }>('GET', '/me'),
  login: (username: string, password: string) => request<{ ok: true }>('POST', '/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/logout'),

  summary: (month?: string) => request<Summary>('GET', `/summary${month ? `?month=${month}` : ''}`),

  charges: (filters: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const qs = params.toString();
    return request<{ charges: Charge[] }>('GET', `/charges${qs ? `?${qs}` : ''}`);
  },
  chargeAction: (id: string, action: 'pay' | 'unpay' | 'cancel' | 'reopen') =>
    request<{ charge: Charge; changed: boolean }>('POST', `/charges/${id}/${action}`),
  updateCharge: (id: string, patch: { amountCents?: number; contactName?: string | null }) =>
    request<{ charge: Charge }>('PATCH', `/charges/${id}`, patch),
  chargeEvents: (id: string) => request<{ events: ChargeEvent[]; sends: ChargeSend[] }>('GET', `/charges/${id}/events`),

  expenses: (filters: { month?: string; day?: string }) => {
    const params = new URLSearchParams();
    if (filters.month) params.set('month', filters.month);
    if (filters.day) params.set('day', filters.day);
    return request<{ expenses: Expense[] }>('GET', `/expenses?${params.toString()}`);
  },
  createExpense: (expense: Omit<Expense, 'id'> & { id: string }) =>
    request<{ expense: Expense; created: boolean }>('POST', '/expenses', expense),
  updateExpense: (id: string, patch: Partial<Omit<Expense, 'id'>>) =>
    request<{ expense: Expense }>('PATCH', `/expenses/${id}`, patch),
  deleteExpense: (id: string) => request<{ ok: true }>('DELETE', `/expenses/${id}`),

  settings: () => request<Settings>('GET', '/settings'),
  updateSettings: (defaultAmountCents: number | null) =>
    request<Settings>('PATCH', '/settings', { defaultAmountCents }),
};
