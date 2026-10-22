import { useEffect, useState } from 'react';
import { formatPhoneNumber } from '../utils/phone';
import { api } from './api';
import type { Charge } from './api';
import ChargeDetail, { StatusBadge } from './ChargeDetail';
import { formatDateTime, formatDayLabel, formatMoney, plural } from './format';

export type StatusFilter = 'todos' | 'pendente' | 'pago' | 'sem_valor' | 'cancelado';
export type PeriodFilter = 'todos' | 'mes' | 'dia';

export interface ChargeFilters {
  status: StatusFilter;
  period: PeriodFilter;
  month: string;
  day: string;
  q: string;
}

interface CobrancasTabProps {
  filters: ChargeFilters;
  onFiltersChange: (filters: ChargeFilters) => void;
  onChanged: () => void;
  version: number;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'pendente', label: 'Pendentes' },
  { value: 'pago', label: 'Pagos' },
  { value: 'sem_valor', label: 'Sem valor' },
  { value: 'cancelado', label: 'Cancelados' },
];

export default function CobrancasTab({ filters, onFiltersChange, onChanged, version }: CobrancasTabProps) {
  const [charges, setCharges] = useState<Charge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Charge | null>(null);
  const [search, setSearch] = useState(filters.q);

  // Busca com pequena espera para não consultar a cada letra.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search !== filters.q) onFiltersChange({ ...filters, q: search });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, filters, onFiltersChange]);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .charges({
        status: filters.status,
        month: filters.period === 'mes' ? filters.month : undefined,
        day: filters.period === 'dia' ? filters.day : undefined,
        q: filters.q || undefined,
      })
      .then((data) => alive && setCharges(data.charges))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Erro ao carregar cobranças.'));
    return () => {
      alive = false;
    };
  }, [filters.status, filters.period, filters.month, filters.day, filters.q, version]);

  function applyUpdate(updated: Charge) {
    setCharges((list) => list?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
    setSelected((current) => (current?.id === updated.id ? updated : current));
    onChanged();
  }

  async function markPaid(charge: Charge) {
    if (busyId) return; // impede cliques repetidos enquanto salva
    setBusyId(charge.id);
    setError(null);
    try {
      const { charge: updated } = await api.chargeAction(charge.id, 'pay');
      applyUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível marcar como pago.');
    } finally {
      setBusyId(null);
    }
  }

  const visibleTotal = (charges ?? [])
    .filter((c) => c.status === 'pendente' && c.amountCents !== null)
    .reduce((sum, c) => sum + (c.amountCents ?? 0), 0);

  return (
    <div className="fin-stack">
      <div className="fin-filters">
        <div className="fin-chips" role="tablist" aria-label="Status">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={filters.status === opt.value}
              className={`fin-chip${filters.status === opt.value ? ' is-active' : ''}`}
              onClick={() => onFiltersChange({ ...filters, status: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="fin-period">
          <select
            className="fin-input fin-select"
            value={filters.period}
            onChange={(e) => onFiltersChange({ ...filters, period: e.target.value as PeriodFilter })}
            aria-label="Período"
          >
            <option value="todos">Todo o período</option>
            <option value="mes">Por mês</option>
            <option value="dia">Por dia</option>
          </select>
          {filters.period === 'mes' && (
            <input
              type="month"
              className="fin-input"
              value={filters.month}
              onChange={(e) => e.target.value && onFiltersChange({ ...filters, month: e.target.value })}
              aria-label="Mês"
            />
          )}
          {filters.period === 'dia' && (
            <input
              type="date"
              className="fin-input"
              value={filters.day}
              onChange={(e) => e.target.value && onFiltersChange({ ...filters, day: e.target.value })}
              aria-label="Dia"
            />
          )}
        </div>

        <input
          type="search"
          className="fin-input"
          placeholder="Buscar por número ou nome"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar por número ou nome"
        />
      </div>

      {filters.period === 'dia' && (
        <p className="fin-muted">Cobranças de {formatDayLabel(filters.day)}</p>
      )}

      {error && <p className="fin-error">{error}</p>}
      {!charges && !error && <p className="fin-empty">Carregando…</p>}
      {charges && charges.length === 0 && <p className="fin-empty">Nenhuma cobrança encontrada com esses filtros.</p>}

      {charges && charges.length > 0 && (
        <p className="fin-muted">
          {plural(charges.length, 'cobrança', 'cobranças')}
          {visibleTotal > 0 && <> · <span className="is-amber">{formatMoney(visibleTotal)} pendente</span></>}
        </p>
      )}

      <div className="fin-list">
        {charges?.map((charge) => (
          <div key={charge.id} className={`fin-charge fin-charge--${charge.status}`}>
            <button type="button" className="fin-charge__main" onClick={() => setSelected(charge)}>
              <span className="fin-charge__top">
                <span className="fin-charge__who">
                  <span className="fin-charge__name">{charge.contactName ?? 'Sem nome'}</span>
                  <span className="fin-charge__phone">{formatPhoneNumber(charge.phoneLocalDigits)}</span>
                </span>
                <span className="fin-charge__amount">{formatMoney(charge.amountCents)}</span>
              </span>
              <span className="fin-charge__meta">
                <StatusBadge charge={charge} />
                <span>
                  {charge.status === 'pago' && charge.paidAt
                    ? `Pago em ${formatDateTime(charge.paidAt)}`
                    : `Cobrança de ${formatDateTime(charge.chargedAt)}`}
                </span>
                {charge.sendsCount > 1 && <span>{charge.sendsCount} envios</span>}
              </span>
            </button>

            {charge.status === 'pendente' && charge.amountCents !== null && (
              <button
                type="button"
                className="fin-btn fin-btn--primary fin-charge__pay"
                disabled={busyId !== null}
                onClick={() => markPaid(charge)}
              >
                {busyId === charge.id ? 'Salvando…' : 'Marcar como pago'}
              </button>
            )}
            {charge.status === 'pendente' && charge.amountCents === null && (
              <button type="button" className="fin-btn fin-charge__pay" onClick={() => setSelected(charge)}>
                Definir valor
              </button>
            )}
          </div>
        ))}
      </div>

      {selected && (
        <ChargeDetail charge={selected} onClose={() => setSelected(null)} onChanged={applyUpdate} />
      )}
    </div>
  );
}
