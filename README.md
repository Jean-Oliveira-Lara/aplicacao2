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
