import './SendButton.css';

interface SendButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export default function SendButton({ onClick, disabled }: SendButtonProps) {
  return (
    <button type="button" className="send-button" onClick={onClick} disabled={disabled}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="send-button__icon">
        <path
          d="M17.5 6.5a7.1 7.1 0 0 0-11.6 8.1L5 21l6.5-.9a7.1 7.1 0 0 0 6-11.6Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M9.3 11.6c.6 1.4 1.7 2.5 3.1 3.1.3.1.6 0 .8-.2l.6-.8c.2-.2.4-.3.7-.2.8.3 1.6.4 2.5.4.4 0 .7.3.7.7v1.9c0 .4-.3.7-.7.7-5 0-9-4-9-9 0-.4.3-.7.7-.7h1.9c.4 0 .7.3.7.7 0 .9.1 1.7.4 2.5.1.3 0 .5-.2.7l-.8.6c-.2.2-.3.5-.2.8Z"
          fill="currentColor"
        />
      </svg>
      Enviar pelo WhatsApp
    </button>
  );
}
