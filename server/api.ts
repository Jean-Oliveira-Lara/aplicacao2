/**
 * Roteador da API do painel financeiro. Uma única Netlify Function
 * (netlify/functions/api.mts) entrega todas as requisições para cá.
 */
import type { Db } from './db';
import { hasValidSession, isUserConfigured, login, logout, requireSession } from './auth';
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
      const [authenticated, userConfigured] = await Promise.all([
        hasValidSession(req, db),
        isUserConfigured(db),
      ]);
      return json({ authenticated, userConfigured });
    }
    if (path === '/login' && method === 'POST') {
      const body = await readJson(req);
      const cookie = await login(req, db, body.username, body.password);
      return json({ ok: true }, 200, { 'set-cookie': cookie });
    }
    if (path === '/logout' && method === 'POST') {
      const cookie = await logout(req, db);
      return json({ ok: true }, 200, { 'set-cookie': cookie });
    }

    // ---------- daqui para baixo, só com login ----------
    await requireSession(req, db);

    if (path === '/sends' && method === 'POST') {
      const body = await readJson<{ sends?: unknown[] }>(req);
      if (!Array.isArray(body.sends) || body.sends.length === 0) {
        throw new HttpError(400, 'Nenhum envio informado.');
      }
      if (body.sends.length > MAX_SENDS_PER_BATCH) throw new HttpError(400, 'Lote muito grande.');
      const results = [];
      for (const raw of body.sends) {
        try {
          results.push({ ok: true, ...(await recordSend(db, parseSend(raw))) });
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

    if (path === '/summary' && method === 'GET') return json(await getSummary(db, url.searchParams));

    if (path === '/settings') {
      if (method === 'GET') return json(await getSettings(db));
      if (method === 'PATCH') return json(await updateSettings(db, await readJson(req)));
    }

    if (path === '/charges' && method === 'GET') {
      return json({ charges: await listCharges(db, url.searchParams) });
    }

    const chargeMatch = path.match(/^\/charges\/([^/]+)(?:\/([a-z-]+))?$/);
    if (chargeMatch) {
      const [, id, action] = chargeMatch;
      if (!action && method === 'PATCH') return json({ charge: await updateCharge(db, id, await readJson(req)) });
      if (action === 'events' && method === 'GET') return json(await listChargeEvents(db, id));
      if (method === 'POST') {
        if (action === 'pay') return json(await markPaid(db, id));
        if (action === 'unpay') return json(await undoPayment(db, id));
        if (action === 'cancel') return json(await cancelCharge(db, id));
        if (action === 'reopen') return json(await reopenCharge(db, id));
      }
    }

    if (path === '/expenses') {
      if (method === 'GET') return json({ expenses: await listExpenses(db, url.searchParams) });
      if (method === 'POST') {
        const result = await createExpense(db, await readJson(req));
        return json(result, result.created ? 201 : 200);
      }
    }

    const expenseMatch = path.match(/^\/expenses\/([^/]+)$/);
    if (expenseMatch) {
      const [, id] = expenseMatch;
      if (method === 'PATCH') return json({ expense: await updateExpense(db, id, await readJson(req)) });
      if (method === 'DELETE') {
        await deleteExpense(db, id);
        return json({ ok: true });
      }
    }

    throw new HttpError(404, 'Rota não encontrada.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('Erro na API financeira:', error);
    return json({ error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
}
