/**
 * Mensagens prontas e Recentes do discador, por usuário.
 *
 * O app continua funcionando como antes (com uma cópia no celular para
 * funcionar sem internet) e manda cada alteração para cá. Todas as
 * operações são idempotentes: repetir o mesmo pedido não duplica nada.
 */
import type { Db, Row } from './db';
import { HttpError, optionalText } from './http';

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_RECENTS_PER_BATCH = 500;

function requireId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new HttpError(400, `${what} inválido.`);
  return value;
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

function parseDate(value: unknown, what: string): string {
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${what} inválida.`);
  if (date.getTime() > Date.now() + 10 * 60 * 1000) throw new HttpError(400, `${what} no futuro.`);
  return date.toISOString();
}

// =====================================================================
// Leitura de tudo (ao entrar no app)
// =====================================================================

function mapMessage(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    text: r.text as string,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function mapRecent(r: Row) {
  return {
    id: r.id as string,
    phoneDigits: r.phone_digits as string,
    phoneLocalDigits: r.phone_local_digits as string,
    messageId: (r.message_id as string | null) ?? null,
    messageName: (r.message_name as string | null) ?? null,
    messageText: (r.message_text as string) ?? '',
    sentAt: toIso(r.sent_at),
  };
}

export async function getSyncData(db: Db, userId: string) {
  const [messages, recents] = await Promise.all([
    db.query(
      `SELECT id, name, text, created_at, updated_at FROM quick_messages
        WHERE user_id = $1::uuid ORDER BY position, created_at`,
      [userId]
    ),
    db.query(
      `SELECT id, phone_digits, phone_local_digits, message_id, message_name, message_text, sent_at
         FROM recent_entries WHERE user_id = $1::uuid ORDER BY sent_at DESC LIMIT 2000`,
      [userId]
    ),
  ]);
  return { messages: messages.map(mapMessage), recents: recents.map(mapRecent) };
}

// =====================================================================
// Mensagens prontas
// =====================================================================

/** Cria ou atualiza uma mensagem (mesmo id = mesma mensagem). */
export async function upsertMessage(db: Db, userId: string, id: string, body: Record<string, unknown>) {
  requireId(id, 'Identificador da mensagem');
  const name = optionalText(body.name, 200);
  if (!name) throw new HttpError(400, 'Dê um nome para a mensagem.');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, 'Escreva o texto da mensagem.');
  if (text.length > 5000) throw new HttpError(400, 'Mensagem muito longa.');
  const position = Number.isInteger(body.position) ? (body.position as number) : 0;
  const createdAt = body.createdAt === undefined ? new Date().toISOString() : parseDate(body.createdAt, 'Data');
  const rows = await db.query(
    `INSERT INTO quick_messages (user_id, id, name, text, position, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, now())
     ON CONFLICT (user_id, id) DO UPDATE
       SET name = EXCLUDED.name, text = EXCLUDED.text, position = EXCLUDED.position, updated_at = now()
     RETURNING id, name, text, created_at, updated_at`,
    [userId, id, name, text, position, createdAt]
  );
  return mapMessage(rows[0]);
}

export async function deleteMessage(db: Db, userId: string, id: string) {
  requireId(id, 'Identificador da mensagem');
  await db.query('DELETE FROM quick_messages WHERE user_id = $1::uuid AND id = $2', [userId, id]);
}

// =====================================================================
// Recentes
// =====================================================================

function parseRecent(raw: unknown) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Registro inválido.');
  const r = raw as Record<string, unknown>;
  const phoneDigits = typeof r.phoneDigits === 'string' ? r.phoneDigits.replace(/\D/g, '') : '';
  const phoneLocalDigits = typeof r.phoneLocalDigits === 'string' ? r.phoneLocalDigits.replace(/\D/g, '') : '';
  if (phoneDigits.length < 10 || phoneDigits.length > 15 || phoneLocalDigits.length < 10 || phoneLocalDigits.length > 11) {
    throw new HttpError(400, 'Número de telefone inválido.');
  }
  return {
    id: requireId(r.id, 'Identificador do registro'),
    phoneDigits,
    phoneLocalDigits,
    messageId: optionalText(r.messageId, 200),
    messageName: optionalText(r.messageName, 200),
    messageText: optionalText(r.messageText, 5000) ?? '',
    sentAt: parseDate(r.sentAt, 'Data do envio'),
  };
}

/** Grava um ou vários registros dos Recentes. Os que já existem são ignorados. */
export async function addRecents(db: Db, userId: string, body: Record<string, unknown>) {
  const list = body.entries;
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'Nenhum registro informado.');
  if (list.length > MAX_RECENTS_PER_BATCH) throw new HttpError(400, 'Lote muito grande.');
  const entries = list.map(parseRecent);
  const rows = await db.query(
    `INSERT INTO recent_entries
       (user_id, id, phone_digits, phone_local_digits, message_id, message_name, message_text, sent_at)
     SELECT $1::uuid, e.id, e.phone_digits, e.phone_local_digits, e.message_id, e.message_name, e.message_text, e.sent_at
       FROM jsonb_to_recordset($2::jsonb) AS e(
         id text, phone_digits text, phone_local_digits text, message_id text,
         message_name text, message_text text, sent_at timestamptz)
     ON CONFLICT (user_id, id) DO NOTHING
     RETURNING id`,
    [
      userId,
      JSON.stringify(
        entries.map((e) => ({
          id: e.id,
          phone_digits: e.phoneDigits,
          phone_local_digits: e.phoneLocalDigits,
          message_id: e.messageId,
          message_name: e.messageName,
          message_text: e.messageText,
          sent_at: e.sentAt,
        }))
      ),
    ]
  );
  return { received: entries.length, inserted: rows.length };
}

export async function deleteRecent(db: Db, userId: string, id: string) {
  requireId(id, 'Identificador do registro');
  await db.query('DELETE FROM recent_entries WHERE user_id = $1::uuid AND id = $2', [userId, id]);
}

/**
 * "Limpar tudo": apaga os registros enviados até o momento em que o botão
 * foi tocado (não apaga um envio feito depois, ainda na fila do celular).
 */
export async function clearRecents(db: Db, userId: string, body: Record<string, unknown>) {
  const before = parseDate(body.before, 'Data');
  const rows = await db.query(
    'DELETE FROM recent_entries WHERE user_id = $1::uuid AND sent_at <= $2::timestamptz RETURNING id',
    [userId, before]
  );
  return { deleted: rows.length };
}
