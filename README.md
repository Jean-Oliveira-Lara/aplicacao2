# Discador WhatsApp

Aplicação web mobile-first para registrar o número de um cliente, escolher uma mensagem pronta e abrir a conversa no WhatsApp em segundos — pensada para uso na rua, em semáforos.

## Estrutura de pastas

```
discador-whatsapp/
├── index.html
├── src/
│   ├── main.tsx              # Bootstrap do React + Router
│   ├── App.tsx                # Rotas (Início / Recentes)
│   ├── index.css              # Tokens de design (cores, tipografia, layout)
│   ├── types/
│   │   └── index.ts           # Tipos: QuickMessage, HistoryEntry, AppSettings
│   ├── services/
│   │   ├── storage.ts         # Abstração de armazenamento (hoje localStorage)
│   │   ├── messagesService.ts # CRUD das mensagens prontas
│   │   └── historyService.ts  # Leitura/gravação do histórico de envios
│   ├── utils/
│   │   ├── phone.ts           # Máscara, validação e montagem do número completo
│   │   └── whatsapp.ts        # Geração do link wa.me e abertura do WhatsApp
│   ├── components/
│   │   ├── AppShell.tsx       # Layout geral (conteúdo + navegação inferior)
│   │   ├── BottomNav.tsx      # Abas Início / Recentes
│   │   ├── PhoneInput.tsx     # Campo do telefone com máscara (estilo "visor" de discador)
│   │   ├── MessageCard.tsx    # Card de mensagem pronta (selecionar/editar/excluir)
│   │   ├── MessageFormModal.tsx # Formulário de criar/editar mensagem
│   │   ├── ConfirmDialog.tsx  # Confirmação antes de excluir
│   │   ├── SendButton.tsx     # Botão "Enviar pelo WhatsApp"
│   │   ├── HistoryEntryCard.tsx # Item da lista de Recentes
│   │   └── Modal.tsx          # Base reutilizável dos modais (bottom sheet)
│   └── pages/
│       ├── Home.tsx           # Tela inicial
│       └── Recentes.tsx       # Histórico de envios
└── package.json
```

## Como o armazenamento funciona hoje (e como trocar por Supabase depois)

Todo acesso a dados passa por `src/services/storage.ts`, que expõe uma interface simples (`get`/`set`) e hoje é implementada com `localStorage`. `messagesService.ts` e `historyService.ts` nunca chamam `localStorage` diretamente — sempre passam por essa interface.

Para migrar para Supabase no futuro, basta criar uma nova classe que implemente `StorageDriver` (com chamadas assíncronas ao Supabase) e trocar a linha `export const storage = new LocalStorageDriver()` por ela. Nenhum outro arquivo precisa mudar.

## Instalar dependências

```bash
cd discador-whatsapp
npm install
```

## Rodar localmente (desenvolvimento)

```bash
npm run dev
```

Isso abre o servidor de desenvolvimento (por padrão em `http://localhost:5173`). Para testar no celular pela mesma rede Wi-Fi, rode com `npm run dev -- --host` e acesse pelo IP da máquina mostrado no terminal.

## Como testar

1. Abra a aplicação e digite um número de telefone (com DDD) no campo do topo — a máscara `(44) 99999-9999` é aplicada automaticamente.
2. Selecione uma das mensagens prontas na lista, ou toque em **+ Nova mensagem** para criar uma.
3. Toque em **Enviar pelo WhatsApp**: o WhatsApp abrirá em uma nova aba com o número e a mensagem preenchidos, e o envio será registrado na aba **Recentes**.
4. Vá até a aba **Recentes** (barra inferior) para ver o histórico, do mais novo para o mais antigo.
5. Toque em um item de **Recentes** para voltar à tela inicial com aquele número já preenchido.
6. Teste editar e excluir mensagens (a exclusão pede confirmação antes de apagar).
7. Teste digitar um número incompleto e tocar em enviar — deve aparecer o aviso "Digite um número de telefone válido." e o WhatsApp não deve abrir.
8. Recarregue a página: mensagens e histórico devem continuar lá (dados salvos em `localStorage`).

## Build para produção

```bash
npm run build
```

Gera os arquivos otimizados em `dist/`. Para conferir o resultado localmente antes de publicar:

```bash
npm run preview
```

Os arquivos de `dist/` podem ser publicados em qualquer hospedagem de site estático (Netlify Drop, Vercel, GitHub Pages, etc.).

## Decisões técnicas do MVP

- **Código do país:** fixo em `+55` por enquanto (`DEFAULT_COUNTRY_CODE` em `src/utils/phone.ts`), mas todas as funções de telefone recebem o código do país como parâmetro, então trocar ou tornar configurável no futuro é uma mudança pequena e isolada.
- **Abertura do WhatsApp:** feita exclusivamente via link oficial `https://wa.me/<numero>?text=<mensagem>`, sem nenhuma automação, scraping ou controle do WhatsApp Web.
- **Sem dependência de biblioteca de ícones:** os ícones são SVGs simples embutidos, para manter o bundle enxuto.
- **Roteamento:** `react-router-dom`, com duas rotas (`/` e `/recentes`) e uma barra de navegação inferior fixa, no padrão de app de celular.

## Próximos passos sugeridos (fora do MVP)

Login de usuário, sincronização via Supabase, tags e busca de clientes, favoritos, exportação de contatos, estatísticas de envio e empacotamento como PWA instalável — a arquitetura atual (serviços isolados, storage abstraído) foi pensada para que cada um desses itens seja incremental, sem reescrever telas existentes.

---

# Painel Financeiro (histórico, cobranças e despesas)

Adicionado **sem alterar o discador**. O discador continua salvando mensagens e Recentes no celular, como antes. Cada envio agora também é registrado no banco **Neon** (Postgres), onde vira uma cobrança no painel.

## O que mudou nos arquivos que já existiam

Só quatro arquivos do app foram tocados, e nenhum deles é da tela do discador:

| Arquivo | Mudança |
|---|---|
| `src/services/historyService.ts` | +1 linha: depois de salvar o envio nos Recentes, coloca o envio na fila para o banco |
| `src/App.tsx` | rota `/financeiro` (carregada só quando aberta) |
| `src/components/BottomNav.tsx` | terceira aba "Financeiro" |
| `public/_redirects` | regra `/api/*` antes da regra do app |

O CSS do discador continua byte a byte igual (`index-DvcJSkFv.css`).

## Estrutura nova

```
db/migrations/001_financeiro.sql   # tabelas do banco
server/                            # regras do servidor (login, envios, cobranças, despesas, resumos)
netlify/functions/api.mts          # Netlify Function que atende /api/*
src/financeiro/                    # telas do painel + fila de sincronização dos envios
scripts/migrar.ts                  # aplica migrações
scripts/criar-usuario.ts           # cria o usuário único
tests/                             # testes automatizados (Postgres em memória)
netlify.toml
```

## Tabelas

- `charges`: cobranças (valor em centavos, status `pendente` / `pago` / `cancelado`, data da cobrança, data do pagamento)
- `message_sends`: cada envio (id gerado no celular, então nunca duplica), ligado a uma cobrança
- `charge_events`: histórico de toda alteração em cobrança (pago, pagamento desfeito, valor alterado…)
- `expenses`: despesas (exclusão lógica: some dos totais, mas fica no banco)
- `settings`: valor padrão por envio e fuso horário (`America/Sao_Paulo`)
- `app_user`, `sessions`, `login_attempts`: login do usuário único

## Regras financeiras

- **Vendido** = pendente + pago (pela data da cobrança).
- **Recebido** = só pagamentos confirmados (pela data da confirmação).
- **Pendente** nunca entra no saldo.
- **Saldo líquido** = recebido − despesas.
- Sem valor padrão configurado, a cobrança nasce **sem valor** e não entra nos totais até você definir o valor.
- Mesmo número no mesmo dia, com cobrança ainda pendente: o novo envio é vinculado a ela (não cobra duas vezes). Em dias diferentes, vira cobrança nova.
- "Marcar como pago" só muda a cobrança uma vez, mesmo com cliques repetidos.
- Pagamento marcado por engano: **Desfazer pagamento** no detalhe da cobrança. Cobrança lançada por engano: **Cancelar cobrança**. Tudo fica no histórico.
- O link `wa.me` só abre a conversa no WhatsApp; o app não sabe se a mensagem foi entregue ou lida. O status registrado é sempre "conversa aberta no WhatsApp".

## Configuração (uma vez)

### 1. Banco (Neon)

O projeto **discador-whatsapp** já foi criado no Neon e a migração já foi aplicada. Para aplicar migrações futuras:

```bash
# crie um arquivo .env (ele NÃO vai para o GitHub) com:
# DATABASE_URL=postgresql://...   (copie em console.neon.tech → Connect)
npm install
npm run migrar
```

### 2. Usuário único

```bash
npm run criar-usuario
```

O script pede nome, e-mail e senha (a senha não aparece na tela) e grava só o hash no banco, como conta **administradora**. Sem `.env`, ele imprime um comando SQL para colar no **SQL Editor** do Neon. Rodar de novo com o mesmo e-mail troca a senha e desconecta as sessões abertas. Contas comuns são criadas pela própria tela de login (**Criar conta**).

### 3. Netlify

1. Em app.netlify.com: **Add new project → Import an existing project → GitHub → aplicacao2**. O `netlify.toml` já define o build (`npm run build`, pasta `dist`).
2. Em **Project configuration → Environment variables**, crie `DATABASE_URL` com a connection string do Neon, com escopo **Functions** (marque como secreta).
3. Faça o deploy. O Netlify Drop (arrastar a pasta) **não** roda as funções do painel.

> **Repositório público:** no plano gratuito do Netlify, repositórios privados só aceitam build de commits de um único contribuidor. Por isso o aplicacao2 é público. Nenhuma senha fica no código: a `DATABASE_URL` existe só nas variáveis de ambiente do Netlify.

## Testes

```bash
npm test
```

Roda os testes da API (53 hoje) contra um Postgres em memória (PGlite), com a mesma migração do Neon: login, envio duplicado, mesmo número em dias diferentes, pagamento com cliques repetidos, desfazer pagamento, despesas e saldo, agrupamento por dia e mês no fuso de São Paulo.

## Contas, login em todo o app e dados no banco (migração 002)

- **Todo o app exige login**: discador, Recentes e Financeiro. Sem sessão, aparece só a tela de login. Toda rota `/api/*` (menos `/api/me`, `/api/login`, `/api/signup`, `/api/logout` e `/api/health`) responde 401 sem sessão válida.
- **Criar conta** na tela de login: nome, e-mail e senha (mínimo 8, com confirmação). E-mail repetido é recusado. Conta criada pela tela é sempre usuário comum (`role = user`), nunca administradora. Limite de 5 cadastros por IP por hora.
- **Cada conta só vê os próprios dados**: toda consulta do servidor filtra pelo usuário da sessão (o id da conta nunca vem do navegador). Trocar o id de uma cobrança, despesa, mensagem ou recente na requisição de outra conta resulta em 404/400/409, sem vazar nem alterar nada.
- **Mensagens prontas e Recentes ficam no banco** (`quick_messages`, `recent_entries`), por conta. O celular guarda uma cópia local por conta para o discador continuar instantâneo e funcionar sem internet; as alterações entram numa fila e vão para o banco assim que houver conexão. Ao entrar, a cópia local é atualizada com o banco (que é a fonte oficial). Em outro aparelho, as mesmas mensagens e Recentes aparecem.
- **Conta nova começa com a lista de mensagens vazia.**
- **Dados antigos do celular** (mensagens, Recentes e envios ainda não enviados, de antes desta versão) passam, uma única vez, para a primeira conta que entrar naquele aparelho. Nada é duplicado (cada item mantém o próprio id).
- **"Limpar tudo" / excluir nos Recentes** apaga também os Recentes do banco, mas **não** mexe no financeiro (envios e cobranças continuam).

### Tabelas novas

- `users` (nome, e-mail único, hash da senha, papel `admin`/`user`)
- `user_settings` (valor padrão e fuso, por conta)
- `quick_messages`, `recent_entries` (por conta)
- `charges`, `message_sends`, `expenses`, `sessions` ganharam `user_id` (obrigatório)

A migração `002_multiusuario.sql` transforma o usuário único antigo (`app_user`) na conta administradora, com o mesmo e-mail e a mesma senha, e passa para ela todas as cobranças, envios, despesas, sessões abertas e o valor padrão. Nada é apagado: `app_user` e `settings` ficam no banco, sem uso. Ela pode ser rodada mais de uma vez sem efeito colateral.

```bash
npm run migrar   # aplica a 002 (precisa da DATABASE_URL no .env)
```

### Limitações conhecidas

- Sem internet, o discador só abre se aquele aparelho já tinha entrado na conta antes (e o app já estiver carregado no navegador). O financeiro precisa de internet.
- O app não sabe se a mensagem foi entregue no WhatsApp; só que a conversa foi aberta.
