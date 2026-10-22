import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PhoneInput from '../components/PhoneInput';
import type { PhoneInputHandle } from '../components/PhoneInput';
import Keypad from '../components/Keypad';
import MessageCard from '../components/MessageCard';
import MessageFormModal from '../components/MessageFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import SendButton from '../components/SendButton';
import type { QuickMessage } from '../types';
import {
  createMessage,
  deleteMessage,
  getMessages,
  updateMessage,
} from '../services/messagesService';
import { addHistoryEntry } from '../services/historyService';
import { DEFAULT_COUNTRY_CODE, isValidLocalPhone, toFullPhoneDigits } from '../utils/phone';
import { openWhatsApp } from '../utils/whatsapp';
import './Home.css';

interface LocationState {
  phone?: string;
}

export default function Home() {
  const location = useLocation();
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const phoneInputRef = useRef<PhoneInputHandle>(null);
  const [messages, setMessages] = useState<QuickMessage[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [formModal, setFormModal] = useState<'create' | QuickMessage | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<QuickMessage | null>(null);

  // Set right after we hand off to WhatsApp; consumed the next time the app
  // is foregrounded, so the number only gets cleared after an actual send
  // — not any time the person switches away to check something else.
  const pendingClearOnReturn = useRef(false);

  useEffect(() => {
    getMessages().then((loaded) => {
      setMessages(loaded);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const state = location.state as LocationState | null;
    if (state?.phone) {
      setPhone(state.phone);
      // Clear the router state so refreshing/back doesn't keep re-filling it.
      navigate('.', { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // After sending, the person switches to WhatsApp and back. When the app
    // is foregrounded again — detected via any of these three signals,
    // since browsers/webviews aren't fully consistent about which one they
    // fire — clear the field that was just used, so the app is ready for
    // the next customer's number instead of showing the last one.
    function clearIfPending() {
      if (!pendingClearOnReturn.current) return;
      pendingClearOnReturn.current = false;
      phoneInputRef.current?.clear();
      setPhoneError(null);
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') clearIfPending();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', clearIfPending);
    window.addEventListener('pageshow', clearIfPending);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', clearIfPending);
      window.removeEventListener('pageshow', clearIfPending);
    };
  }, []);

  const selectedMessage = messages.find((message) => message.id === selectedMessageId) ?? null;

  function handlePhoneChange(value: string) {
    setPhone(value);
    if (phoneError) setPhoneError(null);
  }

  function handleKeypadDigit(digit: string) {
    phoneInputRef.current?.insertDigit(digit);
    if (phoneError) setPhoneError(null);
  }

  function handleKeypadBackspace() {
    phoneInputRef.current?.backspace();
    if (phoneError) setPhoneError(null);
  }

  function handleKeypadClear() {
    phoneInputRef.current?.clear();
    if (phoneError) setPhoneError(null);
  }

  async function handleCreateMessage(name: string, text: string) {
    const created = await createMessage(name, text);
    setMessages((prev) => [...prev, created]);
    setSelectedMessageId(created.id);
    setFormModal(null);
  }

  async function handleUpdateMessage(id: string, name: string, text: string) {
    const updated = await updateMessage(id, name, text);
    setMessages(updated);
    setFormModal(null);
  }

  async function handleConfirmDelete() {
    if (!messageToDelete) return;
    const updated = await deleteMessage(messageToDelete.id);
    setMessages(updated);
    if (selectedMessageId === messageToDelete.id) setSelectedMessageId(null);
    setMessageToDelete(null);
  }

  async function handleSend() {
    if (!isValidLocalPhone(phone)) {
      setPhoneError('Digite um número de telefone válido.');
      return;
    }

    const fullDigits = toFullPhoneDigits(phone, DEFAULT_COUNTRY_CODE);
    openWhatsApp(fullDigits, selectedMessage?.text);
    pendingClearOnReturn.current = true;

    await addHistoryEntry({
      phoneDigits: fullDigits,
      phoneLocalDigits: phone,
      messageId: selectedMessage?.id ?? null,
      messageName: selectedMessage?.name ?? null,
      messageText: selectedMessage?.text ?? '',
    });
  }

  const canSend = isValidLocalPhone(phone);

  return (
    <div className="home">
      <header className="home__header">
        <p className="home__eyebrow">Discador</p>
        <h1 className="home__title">WhatsApp</h1>
      </header>

      <PhoneInput ref={phoneInputRef} value={phone} onChange={handlePhoneChange} error={phoneError} />

      <Keypad
        onDigit={handleKeypadDigit}
        onBackspace={handleKeypadBackspace}
        onClear={handleKeypadClear}
      />

      <section className="home__section">
        <div className="home__section-header">
          <h2 className="home__section-title">Mensagens prontas</h2>
          <button type="button" className="home__new-message" onClick={() => setFormModal('create')}>
            + Nova mensagem
          </button>
        </div>

        {loading && <p className="home__empty">Carregando mensagens…</p>}

        {!loading && messages.length === 0 && (
          <p className="home__empty">
            Nenhuma mensagem cadastrada ainda. Toque em “+ Nova mensagem” para criar a primeira.
          </p>
        )}

        <div className="home__message-list">
          {messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              selected={message.id === selectedMessageId}
              onSelect={() =>
                setSelectedMessageId((current) => (current === message.id ? null : message.id))
              }
              onEdit={() => setFormModal(message)}
              onDelete={() => setMessageToDelete(message)}
            />
          ))}
        </div>
      </section>

      <div className="home__send-wrapper">
        <SendButton onClick={handleSend} disabled={!canSend} />
      </div>

      {formModal && (
        <MessageFormModal
          initial={formModal === 'create' ? null : formModal}
          onClose={() => setFormModal(null)}
          onSave={(name, text) =>
            formModal === 'create'
              ? handleCreateMessage(name, text)
              : handleUpdateMessage((formModal as QuickMessage).id, name, text)
          }
        />
      )}

      {messageToDelete && (
        <ConfirmDialog
          title="Excluir mensagem"
          message={`Tem certeza que deseja excluir "${messageToDelete.name}"? Essa ação não pode ser desfeita.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setMessageToDelete(null)}
        />
      )}
    </div>
  );
}
