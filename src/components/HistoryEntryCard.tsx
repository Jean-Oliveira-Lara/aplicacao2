import type { HistoryEntry } from '../types';
import { formatPhoneNumber } from '../utils/phone';
import './HistoryEntryCard.css';

interface HistoryEntryCardProps {
  entry: HistoryEntry;
  onReuse: () => void;
  onDelete: () => void;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString('pt-BR');
  const timePart = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} - ${timePart}`;
}

export default function HistoryEntryCard({ entry, onReuse, onDelete }: HistoryEntryCardProps) {
  return (
    <div className="history-card">
      <button type="button" className="history-card__main" onClick={onReuse}>
        <span className="history-card__content">
          <span className="history-card__phone">{formatPhoneNumber(entry.phoneLocalDigits)}</span>
          <span className="history-card__message">
            Mensagem: {entry.messageName ?? 'Nenhuma'}
          </span>
          <span className="history-card__time">{formatDateTime(entry.sentAt)}</span>
        </span>
        <span className="history-card__reuse" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <button
        type="button"
        className="history-card__delete"
        onClick={onDelete}
        aria-label="Excluir do histórico"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m1 0-.6 12.1a2 2 0 0 1-2 1.9H9.6a2 2 0 0 1-2-1.9L7 7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
