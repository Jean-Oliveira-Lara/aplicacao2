import { useEffect, useState } from 'react';
import { api } from './api';
import type { Summary, Totals } from './api';
import MonthPicker from './MonthPicker';
import { formatDayLabel, formatMoney } from './format';

interface ResumoTabProps {
  month: string;
  currentMonth: string;
  onMonthChange: (month: string) => void;
  onOpenDay: (day: string) => void;
  onOpenStatus: (status: 'pendente' | 'pago' | 'sem_valor') => void;
  version: number;
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className={`fin-kpi${tone ? ` fin-kpi--${tone}` : ''}`}>
      <span className="fin-kpi__label">{label}</span>
      <span className="fin-kpi__value">{value}</span>
      {hint && <span className="fin-kpi__hint">{hint}</span>}
    </div>
  );
}

function TotalsBlock({ t, onOpenStatus }: { t: Totals; onOpenStatus: ResumoTabProps['onOpenStatus'] }) {
  return (
    <>
      <div className={`fin-balance${t.balanceCents < 0 ? ' fin-balance--negative' : ''}`}>
        <span className="fin-balance__label">Saldo líquido</span>
        <span className="fin-balance__value">{formatMoney(t.balanceCents)}</span>
        <span className="fin-balance__hint">Recebido − despesas. Valores pendentes não entram.</span>
      </div>
      <div className="fin-kpis">
        <Kpi label="Recebido" value={formatMoney(t.receivedCents)} tone="green" />
        <Kpi label="Pendente" value={formatMoney(t.pendingCents)} tone="amber" />
        <Kpi label="Vendido" value={formatMoney(t.soldCents)} hint="pendente + pago" />
        <Kpi label="Despesas" value={formatMoney(t.expensesCents)} tone="red" />
      </div>
      <div className="fin-counts">
        <button type="button" className="fin-count" onClick={() => onOpenStatus('pago')}>
          <strong>{t.paidCount}</strong> {t.paidCount === 1 ? 'pago' : 'pagos'}
        </button>
        <button type="button" className="fin-count" onClick={() => onOpenStatus('pendente')}>
          <strong>{t.pendingCount}</strong> {t.pendingCount === 1 ? 'pendente' : 'pendentes'}
        </button>
        <span className="fin-count fin-count--static">
          <strong>{t.contactsCharged}</strong> {t.contactsCharged === 1 ? 'contato cobrado' : 'contatos cobrados'}
        </span>
        {t.noValueCount > 0 && (
          <button type="button" className="fin-count fin-count--warn" onClick={() => onOpenStatus('sem_valor')}>
            <strong>{t.noValueCount}</strong> sem valor
          </button>
        )}
      </div>
    </>
  );
}

export default function ResumoTab({ month, currentMonth, onMonthChange, onOpenDay, onOpenStatus, version }: ResumoTabProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .summary(month)
      .then((data) => alive && setSummary(data))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Erro ao carregar o resumo.'));
    return () => {
      alive = false;
    };
  }, [month, version]);

  const loading = !summary || summary.month !== month;

  return (
    <div className="fin-stack">
      <MonthPicker month={month} currentMonth={currentMonth} onChange={onMonthChange} />

      {error && <p className="fin-error">{error}</p>}
      {loading && !error && <p className="fin-empty">Carregando…</p>}

      {summary && !loading && (
        <>
          <section className="fin-section">
            <h2 className="fin-section__title">Resumo do mês</h2>
            <TotalsBlock t={summary.monthTotals} onOpenStatus={onOpenStatus} />
          </section>

          <section className="fin-section">
            <h2 className="fin-section__title">Dia a dia</h2>
            {summary.days.length === 0 && <p className="fin-empty">Nenhum movimento neste mês.</p>}
            <div className="fin-days">
              {summary.days.map((d) => (
                <button key={d.day} type="button" className="fin-day" onClick={() => onOpenDay(d.day)}>
                  <div className="fin-day__head">
                    <span className="fin-day__date">
                      {formatDayLabel(d.day)}
                      {d.day === summary.today && <span className="fin-tag">hoje</span>}
                    </span>
                    <span className={`fin-day__balance${d.balanceCents < 0 ? ' is-negative' : ''}`}>
                      {formatMoney(d.balanceCents)}
                    </span>
                  </div>
                  <div className="fin-day__grid">
                    <span>{d.chargesCount === 1 ? 'Cobrança' : 'Cobranças'} <b>{d.chargesCount}</b></span>
                    <span>Vendido <b>{formatMoney(d.soldCents)}</b></span>
                    <span className="is-green">Recebido <b>{formatMoney(d.receivedCents)}</b></span>
                    <span className="is-amber">Pendente <b>{formatMoney(d.pendingCents)}</b></span>
                    <span className="is-red">Despesas <b>{formatMoney(d.expensesCents)}</b></span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="fin-section">
            <h2 className="fin-section__title">Geral (todo o período)</h2>
            <TotalsBlock t={summary.overall} onOpenStatus={onOpenStatus} />
          </section>

          <p className="fin-footnote">
            Vendido e pendente contam pela data da cobrança. Recebido conta pela data em que o pagamento foi
            confirmado. Despesas, pela data da despesa. Horário de São Paulo.
          </p>
        </>
      )}
    </div>
  );
}
