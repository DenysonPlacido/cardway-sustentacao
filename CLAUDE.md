# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Inicia o servidor com hot-reload (ts-node-dev)
npm run build      # Compila os bundles client-side (esbuild → public/js/)
npm start          # Inicia o servidor em produção (ts-node)
npm run db:seed    # Inicializa o schema do banco e cria usuários via SEED_USERS
```

Não há testes automatizados configurados. O frontend não tem servidor de desenvolvimento separado — é servido pelo próprio Express a partir de `public/`.

## Arquitetura

Aplicação monolítica: um único servidor Express (`api/index.ts`) serve tanto a API REST quanto os arquivos estáticos do frontend (`public/`).

### Módulos principais

**1. Lançamento (`/lancamento`)** — Geração de SQL Oracle a partir de planilhas Excel
- Upload de arquivo → detecção automática de colunas → geração de SQL
- Rotas em `api/gerador/routes.ts`, banco de dados em `api/gerador/db.ts`
- Mapeamentos e tipos de transação são configuráveis pelo usuário

**2. Sustentação GLPI (`/api/automacao`)** — Análise automatizada de chamados com IA
- `GlpiClient` → `GlpiService` → rotas em `api/automation-routes.ts`
- `AiService` chama o Gemini (via endpoint compatível com OpenAI) para analisar chamados
- `SustentacaoEngine` orquestra a análise em lote de todos os chamados
- O endpoint `/api/automacao/rodar-agente` usa SSE para transmitir progresso em tempo real

**3. Logs de Pedido (`/api/logs`)** — Busca de logs do ms-backoffice por pedido
- Rota em `api/logs-routes.ts`; registrada antes de `/api/logs/web` em `api/index.ts`
- Input: resultado de SELECT Oracle (ID + DATA_ALTERACAO); parseia via `parseSqlOutput` no cliente
- Backend descobre pods via nginx directory listing, localiza arquivo `file-YYYY-MM-DD_HH00.txt`, faz grep por ID via stream HTTP
- 12 serviços configurados em `LOG_SERVICES`; base em `LOG_SERVER_URL` (`.env`)
- SSE: eventos `status`, `result`, `done`, `error`
- Cliente em `src/client/home/log-pedido.ts`; botão de download TXT ao finalizar

**4. Logs Web SGV (`/api/logs/web`)** — Busca de logs dos servidores web SGV
- Rota em `api/logs-web-routes.ts`; deve ser registrada **antes** de `/api/logs` no Express
- Logs em `https://sgvlogs-prd.integrati.cloud/web02_producao/` e `.../web03_producao/`
- web02: 5 instâncias (`cluster02-instance01..05`); web03: 4 instâncias (`cluster03-instance01..04`)
- Arquivos nomeados por timestamp de rotação: `server.log_YYYY-MM-DDTHH-MM-SS` (~48 MB/arquivo, rotação por tamanho)
- **Algoritmo de seleção**: o timestamp no filename é quando o arquivo foi *rotacionado* (arquivado). Para tempo alvo T, buscar o primeiro arquivo com `rotationTime >= T`
- Suporta `.bz2` apenas de forma implícita (skip) — sem decompressão
- SSE: mesmos eventos que logs-routes; botão Parar fecha EventSource e mostra resultados parciais
- Download por instância (botão TXT em cada card) e download global de todos os resultados
- Cliente em `src/client/home/log-web.ts`

### Autenticação

- Login valida usuário no sistema SGV externo (POST legacy) e, em seguida, verifica no banco local
- JWT armazenado em cookie (`token`); expira em 30 minutos com refresh automático
- `authMiddleware` protege todas as rotas `/api/automacao`, `/api/logs`, `/api/logs/web` e `/api` (lançamento)
- Rotas de página (ex: `/home`, `/lancamento/*`) verificam o JWT manualmente e redirecionam para `/login`

### Banco de dados

PostgreSQL (Neon) com queries SQL diretas via `pg` — sem ORM. Tabelas principais:
- `users`, `tipos_transacao`, `mapeamentos_colunas`, `historico_lancamentos`, `tipos_transacao_sistema`
- Soft delete: registros são desativados com `ativo = 0` em vez de deletados

### Frontend

Páginas HTML estáticas com TypeScript compilado pelo esbuild. Os bundles ficam em `public/js/`. Fontes em `src/client/` (ex: `home.ts`, `login.ts`). Ao alterar código client-side, é necessário rodar `npm run build` para atualizar os arquivos servidos.

**Design system** (definido em `public/css/home.css`):
- Variáveis CSS: `--bg`, `--surface`, `--card`, `--input`, `--accent` (#ff6a00), `--t1/t2/t3`, `--border`, `--r`
- Fonte principal: `Inter`; monospace: `Menlo/Consolas` via `var(--mono)`
- Classes de formulário: `.form-group`, `.form-select` (select estilizado), `.form-row` (flex com wrap), `.input-sm`, `.checkbox-row`, `.checkbox-label`
- Classes de botão: `.btn.btn-primary`, `.btn.btn-ghost`, `.btn.btn-danger`, `.btn-download`, `.btn-card-download`, `.btn-copy`
- Resultados de log: `.log-results`, `.log-result-card`, `.log-result-header`, `.log-result-pre`
- Status: `.log-status` (neutro) e `.log-status.error`
- Responsivo: `@media (max-width: 768px)` — sidebar vira drawer (`mobile-open`), main sem margem, form rows empilham
- Sidebar: hamburguer (`#hamburgerBtn`) + overlay (`#sidebarOverlay`) gerenciados em `initSidebar()` em `home.ts`

### Variáveis de ambiente

Consultar `.env.example` para a lista completa. As principais:
- `DATABASE_URL` — string de conexão Neon/PostgreSQL
- `JWT_SECRET` — segredo para assinar tokens
- `SGV_*` — credenciais da integração SGV
- `GLPI_*` — URL e credenciais do GLPI
- `GEMINI_API_KEY` — chave para análise de chamados com IA
- `LOG_SERVER_URL` — base dos logs ms-backoffice (padrão: `http://10.111.2.54/pods/microservices_prod/ms-backoffice`)
- `SEED_USERS` — JSON com usuários iniciais (usado em `db:seed`)

### Deploy

Configurado para Vercel (`vercel.json`). O build gera os bundles client-side; o runtime Node.js serve `api/index.ts`.
