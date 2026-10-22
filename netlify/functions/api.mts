/**
 * Netlify Function única do painel financeiro.
 *
 * Endereço: /.netlify/functions/api/*  — o app chama /api/*, que o
 * public/_redirects reescreve para cá ANTES da regra "/* /index.html"
 * (sem isso a regra do app engoliria as chamadas da API).
 *
 * A conexão com o Neon vem da variável de ambiente DATABASE_URL,
 * configurada no painel do Netlify (escopo: Functions).
 *
 * O código do servidor é carregado dentro do try/catch para que qualquer
 * falha, inclusive no carregamento, apareça nos logs da função e volte
 * como JSON em vez de derrubar a função.
 */

function errorResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async (req: Request): Promise<Response> => {
  let handleApi: typeof import('../../server/api.ts').handleApi;
  let getDb: typeof import('../../server/db.ts').getDb;
  try {
    ({ handleApi } = await import('../../server/api.ts'));
    ({ getDb } = await import('../../server/db.ts'));
  } catch (error) {
    console.error('[api] falha ao carregar o servidor:', error);
    return errorResponse('Falha ao iniciar a API.');
  }

  let db;
  try {
    db = getDb();
  } catch (error) {
    console.error('[api] DATABASE_URL ausente:', error instanceof Error ? error.message : error);
    return errorResponse('Banco de dados não configurado no servidor (DATABASE_URL).');
  }

  try {
    return await handleApi(req, db);
  } catch (error) {
    console.error('[api] erro inesperado:', error);
    return errorResponse('Erro interno. Tente de novo em instantes.');
  }
};
