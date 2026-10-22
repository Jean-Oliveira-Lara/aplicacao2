/** Formatação de dinheiro e datas do painel (sempre no fuso de São Paulo). */

export const TIMEZONE = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(cents: number | null): string {
  if (cents === null) return 'Sem valor';
  return brl.format(cents / 100);
}

/**
 * Lê um valor digitado ("12", "12,5", "1.234,56", "R$ 10,00") e devolve
 * centavos inteiros, ou null se não for um valor válido maior que zero.
 */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[R$\s]/g, '');
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(',')) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

/** Centavos -> texto para preencher um campo ("12,50"). */
export function centsToInput(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(',', ' -');
}

/** "2026-10-22" -> "Qui., 22 de out." */
export function formatDayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const label = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** plural(1, 'pago', 'pagos') -> "1 pago" */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "2026-10" -> "Outubro de 2026" */
export function formatMonthLabel(month: string): string {
  const date = new Date(`${month}-15T12:00:00Z`);
  const label = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  ferramentas: 'Ferramentas',
  sistemas: 'Sistemas',
  anuncios: 'Anúncios',
  infraestrutura: 'Infraestrutura',
  internet: 'Internet',
  equipe: 'Equipe',
  outros: 'Outros',
};

export const EVENT_LABELS: Record<string, string> = {
  criada: 'Cobrança criada',
  envio_vinculado: 'Novo envio vinculado',
  pago: 'Marcada como paga',
  pagamento_desfeito: 'Pagamento desfeito',
  valor_alterado: 'Valor alterado',
  nome_alterado: 'Nome alterado',
  cancelada: 'Cobrança cancelada',
  reaberta: 'Cobrança reaberta',
};
