/**
 * Netlify Function única do painel financeiro.
 *
 * Endereço: /.netlify/functions/api/*  — o app chama /api/*, que o
 * public/_redirects reescreve para cá ANTES da regra "/* /index.html"
 * (sem isso a regra do app engoliria as chamadas da API).
 *
 * A conexão com o Neon vem da variável de ambiente DATABASE_URL,
 * configurada no painel do Netlify (escopo: Functions).
 */
import { handleApi } from '../../server/api.ts';
import { getDb } from '../../server/db.ts';

export default async (req: Request): Promise<Response> => {
  let db;
  try {
    db = getDb();
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: 'Banco de dados não configurado no servidor (DATABASE_URL).' }),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  }
  return handleApi(req, db);
};
