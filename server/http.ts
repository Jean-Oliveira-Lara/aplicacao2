/** Pequenos utilitários HTTP compartilhados pelas rotas. */

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new HttpError(415, 'Envie os dados em JSON.');
  }
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== 'object') throw new Error('corpo inválido');
    return body as T;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Bloqueia requisições de escrita vindas de outro site (CSRF), além do
 * cookie SameSite. Se o navegador mandou Origin, ele tem que bater com
 * o host atual.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Origem inválida.');
  }
  if (originHost !== host) throw new HttpError(403, 'Origem não permitida.');
}

// ---------- validação ----------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CENTS = 100_000_000; // R$ 1.000.000,00 por lançamento

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function requireCents(value: unknown, field = 'valor'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_CENTS) {
    throw new HttpError(400, `O ${field} precisa ser maior que zero (em centavos inteiros).`);
  }
  return value;
}

export function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Texto inválido.');
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `Texto muito longo (máx. ${max}).`);
  return trimmed.length ? trimmed : null;
}

/** Converte o resultado de SUM/COUNT (que pode vir como texto do Postgres) em número. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
