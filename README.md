# SCC Mecânicas

Painel das oficinas **Reds**, **Tuner**, **Power** e **Motoclube**.

- **Vercel:** frontend (`apps/web`)
- **VPS (a mesma do scc-bot):** API (`apps/api`) + Postgres + bot Discord `1543653928996970650`
- O bot **não** é o Severino. Só compartilham a máquina.

Cadastro no site. Usuários com papel **admin** (ou dono da mecânica) liberam o acesso.

O que o bot faz em cada canal/servidor: [DISCORD.md](DISCORD.md).

## Local

Postgres + env da API:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm install
cd apps/api && npx tsx src/db/push.ts && npx tsx src/db/seed.ts && cd ../..
npm run dev:api
npm run dev:web
```

Owner inicial: `OWNER_USERNAME` / `OWNER_PASSWORD` no `.env` da API.

## Vercel

1. Importar este repo.
2. Root do projeto: a raiz (usa `vercel.json`) **ou** `apps/web`.
3. Env: `VITE_API_URL=https://api.seudominio.com`

## VPS

```bash
# Postgres
sudo -u postgres psql -c "CREATE USER sccmecanicas WITH PASSWORD 'SENHA';"
sudo -u postgres psql -c "CREATE DATABASE scc_mecanicas OWNER sccmecanicas;"

git clone https://github.com/JulianoPassing/scc-mecanicas.git
cd scc-mecanicas
npm install
cp apps/api/.env.example apps/api/.env   # editar
cd apps/api && npx tsx src/db/push.ts && npx tsx src/db/seed.ts && npm run build && cd ../..

cd bot && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # DISCORD_TOKEN + BOT_WEBHOOK_SECRET + SITE_URL
cd ..

pm2 start deploy/ecosystem.config.cjs
# Nginx: copiar deploy/nginx.mecanicas.conf e apontar o domínio da API
```

Env da API: `DATABASE_URL`, `JWT_SECRET`, `BOT_WEBHOOK_SECRET`, `PUBLIC_URL`, `CORS_ORIGIN` (URL da Vercel), `OWNER_USERNAME`, `OWNER_PASSWORD`, `COOKIE_SECURE=true`.

Env do bot: `DISCORD_TOKEN` (app `1543653928996970650`), `BOT_WEBHOOK_SECRET`, `SITE_URL` (URL pública da API).
