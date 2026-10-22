import { formatMonthLabel, shiftMonth } from './format';

interface MonthPickerProps {
  month: string;
  currentMonth: string;
  onChange: (month: string) => void;
}

export default function MonthPicker({ month, currentMonth, onChange }: MonthPickerProps) {
  const isCurrent = month >= currentMonth;
  return (
    <div className="fin-month">
      <button
        type="button"
        className="fin-month__arrow"
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label="Mês anterior"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="fin-month__label">
        <span>{formatMonthLabel(month)}</span>
        {!isCurrent && (
          <button type="button" className="fin-link" onClick={() => onChange(currentMonth)}>
            voltar ao mês atual
          </button>
        )}
      </div>
      <button
        type="button"
        className="fin-month__arrow"
        onClick={() => onChange(shiftMonth(month, 1))}
        disabled={isCurrent}
        aria-label="Próximo mês"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
