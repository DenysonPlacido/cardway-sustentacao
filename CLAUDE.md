# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development server (backend, hot-reloads on save)
npm run dev

# Build frontend TypeScript → public/js/ (required after any src/client/ change)
npm run build

# Production server
npm start

# Seed database
npm run db:seed
```

**Critical:** The frontend and backend are compiled independently. After editing any file under `src/client/`, always run `npm run build` — the browser loads `public/js/home.js` (the esbuild bundle), not the source files.

## Architecture

Single Express server serving static HTML + a REST API, deployed to Vercel.

### Two separate compilation targets

| Layer | Entry | Compiled by | Output |
|---|---|---|---|
| Backend | `api/index.ts` | ts-node (runtime) | — |
| Frontend | `src/client/home.ts`, `src/client/login.ts` | esbuild (build step) | `public/js/home.js`, `public/js/login.js` |

The `tsconfig.json` intentionally excludes `src/` — that path is only processed by esbuild.

### Frontend navigation model

`public/home.html` is a single-page shell. Sections are toggled with the CSS class `hidden`; no routing library is used.

`src/client/home.ts` is the orchestrator:
- `TITLES` — maps section ID → page title shown in the header
- `navigateTo(id)` — hides the current section, shows `section-{id}`, updates the active nav link
- Each tool lives in `src/client/home/` as its own module exporting a single `init*Tool()` function, called once at `boot()`

**To add a new tool:**
1. Create `src/client/home/my-tool.ts` exporting `initMyTool()`
2. Add `<section id="section-my-tool" class="section hidden">` in `home.html`
3. Add `<a class="nav-item" data-section="my-tool">` to the sidebar in `home.html`
4. Add a `tool-card` to `section-painel` in `home.html`
5. Add `'my-tool': 'My Title'` to `TITLES` in `home.ts`
6. Import and call `initMyTool()` inside `boot()` in `home.ts`
7. Run `npm run build`

### Auth flow

- Login posts to `/api/auth/login` which validates credentials against an external SGV system
- JWT is stored in an httpOnly cookie (`token`)
- `checkAuth()` (called at boot) hits `/api/auth/me` — redirects to `/login` if the cookie is absent or expired
- A countdown timer tracks session expiry; when it reaches zero a re-auth modal appears instead of redirecting, so in-progress work is preserved

### Backend structure

```
api/
  index.ts               — Express entry: auth routes, static page serving, middleware
  automation-routes.ts   — GLPI routes (/api/automacao/*) + AI analysis endpoint
  gerador/routes.ts      — Lançamentos CRUD, served at /lancamento
  atendimento-glpi/
    GlpiService.ts       — GLPI REST API client
    AiService.ts         — Anthropic/OpenAI/Gemini ticket analysis
    SustentacaoEngine.ts — Streams analysis events via SSE for the live terminal UI
```

The AI agent streams via SSE at `/api/automacao/run-agent`. The frontend in `src/client/home/glpi.ts` consumes these events to populate the terminal UI in `section-automacoes`.

### CSS

Single file `public/css/home.css`. Dark theme only. Key CSS variables:

```css
--accent:  #ff6a00   /* Cardway orange — buttons, highlights */
--surface: #0d1120   /* Card/panel backgrounds */
--bg:      #080b11   /* Page background */
--mono:    Menlo/Consolas  /* Used for pre/code blocks */
```

All components use these tokens — never hardcode colors.
