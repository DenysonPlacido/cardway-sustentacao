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

### Dois módulos principais

**1. Lançamento (`/lancamento`)** — Geração de SQL Oracle a partir de planilhas Excel
- Upload de arquivo → detecção automática de colunas → geração de SQL
- Rotas em `api/gerador/routes.ts`, banco de dados em `api/gerador/db.ts`
- Mapeamentos e tipos de transação são configuráveis pelo usuário

**2. Sustentação GLPI (`/api/automacao`)** — Análise automatizada de chamados com IA
- `GlpiClient` → `GlpiService` → rotas em `api/automation-routes.ts`
- `AiService` chama o Gemini (via endpoint compatível com OpenAI) para analisar chamados
- `SustentacaoEngine` orquestra a análise em lote de todos os chamados
- O endpoint `/api/automacao/rodar-agente` usa SSE para transmitir progresso em tempo real

### Autenticação

- Login valida usuário no sistema SGV externo (POST legacy) e, em seguida, verifica no banco local
- JWT armazenado em cookie (`token`); expira em 30 minutos com refresh automático
- `authMiddleware` protege todas as rotas `/api/automacao` e `/api` (lançamento)
- Rotas de página (ex: `/home`, `/lancamento/*`) verificam o JWT manualmente e redirecionam para `/login`

### Banco de dados

PostgreSQL (Neon) com queries SQL diretas via `pg` — sem ORM. Tabelas principais:
- `users`, `tipos_transacao`, `mapeamentos_colunas`, `historico_lancamentos`, `tipos_transacao_sistema`
- Soft delete: registros são desativados com `ativo = 0` em vez de deletados

### Frontend

Páginas HTML estáticas com TypeScript compilado pelo esbuild. Os bundles ficam em `public/js/`. Fontes em `src/client/` (ex: `home.ts`, `login.ts`). Ao alterar código client-side, é necessário rodar `npm run build` para atualizar os arquivos servidos.

### Variáveis de ambiente

Consultar `.env.example` para a lista completa. As principais:
- `DATABASE_URL` — string de conexão Neon/PostgreSQL
- `JWT_SECRET` — segredo para assinar tokens
- `SGV_*` — credenciais da integração SGV
- `GLPI_*` — URL e credenciais do GLPI
- `GEMINI_API_KEY` — chave para análise de chamados com IA
- `SEED_USERS` — JSON com usuários iniciais (usado em `db:seed`)

### Deploy

Configurado para Vercel (`vercel.json`). O build gera os bundles client-side; o runtime Node.js serve `api/index.ts`.
