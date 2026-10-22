import { useState } from 'react';
import type { QuickMessage } from '../types';
import Modal from './Modal';
import './MessageFormModal.css';

interface MessageFormModalProps {
  initial?: QuickMessage | null;
  onClose: () => void;
  onSave: (name: string, text: string) => void;
}

export default function MessageFormModal({ initial, onClose, onSave }: MessageFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [text, setText] = useState(initial?.text ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !text.trim()) {
      setError('Preencha o nome e o texto da mensagem.');
      return;
    }
    onSave(name, text);
  }

  return (
    <Modal title={initial ? 'Editar mensagem' : 'Nova mensagem'} onClose={onClose}>
      <form className="message-form" onSubmit={handleSubmit}>
        <label className="message-form__label" htmlFor="message-name">
          Nome da mensagem
        </label>
        <input
          id="message-name"
          className="message-form__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex: Mensagem inicial"
          maxLength={40}
        />

        <label className="message-form__label" htmlFor="message-text">
          Texto da mensagem
        </label>
        <textarea
          id="message-text"
          className="message-form__textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ex: Olá! Tudo bem? Estou entrando em contato sobre nosso produto."
          rows={5}
          maxLength={600}
        />

        {error && (
          <p className="message-form__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="message-form__submit">
          Salvar mensagem
        </button>
      </form>
    </Modal>
  );
}
