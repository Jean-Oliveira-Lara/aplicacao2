import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HistoryEntryCard from '../components/HistoryEntryCard';
import ConfirmDialog from '../components/ConfirmDialog';
import type { HistoryEntry } from '../types';
import { clearHistory, deleteHistoryEntry, getHistory } from '../services/historyService';
import { formatPhoneNumber } from '../utils/phone';
import './Recentes.css';

export default function Recentes() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryToDelete, setEntryToDelete] = useState<HistoryEntry | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  useEffect(() => {
    getHistory().then((loaded) => {
      setHistory(loaded);
      setLoading(false);
    });
  }, []);

  function handleReuse(entry: HistoryEntry) {
    navigate('/', { state: { phone: entry.phoneLocalDigits } });
  }

  async function handleConfirmDelete() {
    if (!entryToDelete) return;
    const updated = await deleteHistoryEntry(entryToDelete.id);
    // getHistory() sorts most-recent-first; deleteHistoryEntry doesn't, so
    // re-sort here to keep the list order consistent after a delete.
    setHistory(
      [...updated].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
    );
    setEntryToDelete(null);
  }

  async function handleConfirmClearAll() {
    await clearHistory();
    setHistory([]);
    setConfirmClearAll(false);
  }

  return (
    <div className="recentes">
      <header className="recentes__header">
        <div className="recentes__header-text">
          <p className="recentes__eyebrow">Histórico</p>
          <h1 className="recentes__title">Recentes</h1>
        </div>
        {!loading && history.length > 0 && (
          <button
            type="button"
            className="recentes__clear-all"
            onClick={() => setConfirmClearAll(true)}
          >
            Limpar tudo
          </button>
        )}
      </header>

      {loading && <p className="recentes__empty">Carregando histórico…</p>}

      {!loading && history.length === 0 && (
        <div className="recentes__empty">
          <p>Nenhum número enviado ainda.</p>
          <p className="recentes__empty-hint">
            Os números que você enviar pelo WhatsApp aparecem aqui automaticamente.
          </p>
        </div>
      )}

      <div className="recentes__list">
        {history.map((entry) => (
          <HistoryEntryCard
            key={entry.id}
            entry={entry}
            onReuse={() => handleReuse(entry)}
            onDelete={() => setEntryToDelete(entry)}
          />
        ))}
      </div>

      {entryToDelete && (
        <ConfirmDialog
          title="Excluir dos recentes"
          message={`Tem certeza que deseja excluir "${formatPhoneNumber(entryToDelete.phoneLocalDigits)}" dos recentes? Essa ação não pode ser desfeita.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setEntryToDelete(null)}
        />
      )}

      {confirmClearAll && (
        <ConfirmDialog
          title="Limpar todos os recentes"
          message={`Tem certeza que deseja excluir todos os ${history.length} números do histórico? Essa ação não pode ser desfeita.`}
          confirmLabel="Limpar tudo"
          onConfirm={handleConfirmClearAll}
          onCancel={() => setConfirmClearAll(false)}
        />
      )}
    </div>
  );
}
