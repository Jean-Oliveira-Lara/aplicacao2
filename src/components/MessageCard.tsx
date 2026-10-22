import type { QuickMessage } from '../types';
import './MessageCard.css';

interface MessageCardProps {
  message: QuickMessage;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function MessageCard({
  message,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: MessageCardProps) {
  return (
    <div className={`message-card${selected ? ' message-card--selected' : ''}`}>
      <button
        type="button"
        className="message-card__select"
        onClick={onSelect}
        aria-pressed={selected}
      >
        <span className="message-card__name">{message.name}</span>
        <span className="message-card__text">{message.text}</span>
      </button>
      <div className="message-card__actions">
        <button
          type="button"
          className="message-card__icon-btn"
          onClick={onEdit}
          aria-label={`Editar mensagem ${message.name}`}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="message-card__icon-btn message-card__icon-btn--danger"
          onClick={onDelete}
          aria-label={`Excluir mensagem ${message.name}`}
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
    </div>
  );
}
