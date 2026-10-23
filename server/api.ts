/**
 * Roteador da API do app. Uma única Netlify Function
 * (netlify/functions/api.mts) entrega todas as requisições para cá.
 *
 * Só /me, /login, /signup e /logout são públicas. Todo o resto exige
 * sessão válida, e cada operação recebe o id do usuário da sessão:
 * nunca um id vindo do navegador.
 */
import type { Db } from './db';
import { changeEmail, changePassword, getAccount, getSessionUser, login, logout, requireUser, signup } from './auth';
import {
  cancelCharge,
  createExpense,
  deleteExpense,
  getSettings,
  getSummary,
  listChargeEvents,
  listCharges,
  listExpenses,
  markPaid,
  parseSend,
  recordSend,
  reopenCharge,
  undoPayment,
  updateCharge,
  updateExpense,
  updateSettings,
} from './finance';
import { HttpError, assertSameOrigin, json, readJson } from './http';
import { addRecents, clearRecents, deleteMessage, deleteRecent, getSyncData, upsertMessage } from './sync';

const MAX_SENDS_PER_BATCH = 50;

function routePath(url: URL): string {
  let path = url.pathname;
  for (const prefix of ['/.netlify/functions/api', '/api']) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      path = path.slice(prefix.length);
      break;
    }
  }
  return path.replace(/\/+$/, '') || '/';
}

export async function handleApi(req: Request, db: Db): Promise<Response> {
  try {
    const url = new URL(req.url);
    const path = routePath(url);
    const method = req.method.toUpperCase();
    if (method !== 'GET') assertSameOrigin(req);

    // ---------- rotas públicas ----------
    if (path === '/me' && method === 'GET') {
      const user = await getSessionUser(req, db);
      // userConfigured fica sempre true: com "Criar conta" sempre dá para entrar.
      return json({ authenticated: Boolean(user), userConfigured: true, user });
    }
    if (path === '/login' && method === 'POST') {
      const body = await readJson(req);
      // Aceita "email" (novo) e "username" (versão anterior do app).
      const cookie = await login(req, db, body.email ?? body.username, body.password);
      return json({ ok: true }, 200, { 'set-cookie': cookie });
    }
    if (path === '/signup' && method === 'POST') {
      const cookie = await signup(req, db, await readJson(req));
      return json({ ok: true }, 201, { 'set-cookie': cookie });
    }
    if (path === '/logout' && method === 'POST') {
      const cookie = await logout(req, db);
      return json({ ok: true }, 200, { 'set-cookie': cookie });
    }

    // ---------- daqui para baixo, só com login ----------
    const user = await requireUser(req, db);
    const uid = user.id;

    // ---------- discador: mensagens prontas e Recentes ----------
    if (path === '/sync' && method === 'GET') return json(await getSyncData(db, uid));

    const messageMatch = path.match(/^\/messages\/([^/]+)$/);
    if (messageMatch) {
      const id = decodeURIComponent(messageMatch[1]);
      if (method === 'PUT') return json({ message: await upsertMessage(db, uid, id, await readJson(req)) });
      if (method === 'DELETE') {
        await deleteMessage(db, uid, id);
        return json({ ok: true });
      }
    }

    if (path === '/recents' && method === 'POST') return json(await addRecents(db, uid, await readJson(req)));
    if (path === '/recents/clear' && method === 'POST') return json(await clearRecents(db, uid, await readJson(req)));
    const recentMatch = path.match(/^\/recents\/([^/]+)$/);
    if (recentMatch && method === 'DELETE') {
      await deleteRecent(db, uid, decodeURIComponent(recentMatch[1]));
      return json({ ok: true });
    }

    // ---------- financeiro ----------
    if (path === '/sends' && method === 'POST') {
      const body = await readJson<{ sends?: unknown[] }>(req);
      if (!Array.isArray(body.sends) || body.sends.length === 0) {
        throw new HttpError(400, 'Nenhum envio informado.');
      }
      if (body.sends.length > MAX_SENDS_PER_BATCH) throw new HttpError(400, 'Lote muito grande.');
      const results = [];
      for (const raw of body.sends) {
        try {
          results.push({ ok: true, ...(await recordSend(db, uid, parseSend(raw))) });
        } catch (error) {
          // Envio malformado: devolve o erro só desse item, para o celular
          // descartá-lo da fila sem travar os outros.
          if (error instanceof HttpError && error.status === 400) {
            const id = (raw as { id?: unknown })?.id;
            results.push({ ok: false, id: typeof id === 'string' ? id : null, error: error.message });
          } else {
            throw error;
          }
        }
      }
      return json({ results });
    }

    if (path === '/account' && method === 'GET') return json(await getAccount(user));
    if (path === '/account/email' && method === 'POST') {
      const body = await readJson(req);
      return json(await changeEmail(req, db, user, body.currentPassword, body.newEmail));
    }
    if (path === '/account/password' && method === 'POST') {
      const body = await readJson(req);
      return json(await changePassword(req, db, user, body.currentPassword, body.newPassword));
    }

    if (path === '/summary' && method === 'GET') return json(await getSummary(db, uid, url.searchParams));

    if (path === '/settings') {
      if (method === 'GET') return json(await getSettings(db, uid));
      if (method === 'PATCH') return json(await updateSettings(db, uid, await readJson(req)));
    }

    if (path === '/charges' && method === 'GET') {
      return json({ charges: await listCharges(db, uid, url.searchParams) });
    }

    const chargeMatch = path.match(/^\/charges\/([^/]+)(?:\/([a-z-]+))?$/);
    if (chargeMatch) {
      const [, id, action] = chargeMatch;
      if (!action && method === 'PATCH') return json({ charge: await updateCharge(db, uid, id, await readJson(req)) });
      if (action === 'events' && method === 'GET') return json(await listChargeEvents(db, uid, id));
      if (method === 'POST') {
        if (action === 'pay') return json(await markPaid(db, uid, id));
        if (action === 'unpay') return json(await undoPayment(db, uid, id));
        if (action === 'cancel') return json(await cancelCharge(db, uid, id));
        if (action === 'reopen') return json(await reopenCharge(db, uid, id));
      }
    }

    if (path === '/expenses') {
      if (method === 'GET') return json({ expenses: await listExpenses(db, uid, url.searchParams) });
      if (method === 'POST') {
        const result = await createExpense(db, uid, await readJson(req));
        return json(result, result.created ? 201 : 200);
      }
    }

    const expenseMatch = path.match(/^\/expenses\/([^/]+)$/);
    if (expenseMatch) {
      const [, id] = expenseMatch;
      if (method === 'PATCH') return json({ expense: await updateExpense(db, uid, id, await readJson(req)) });
      if (method === 'DELETE') {
        await deleteExpense(db, uid, id);
        return json({ ok: true });
      }
    }

    throw new HttpError(404, 'Rota não encontrada.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('Erro na API:', error);
    return json({ error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
}
