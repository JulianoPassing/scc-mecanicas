# Discord — bot das mecânicas

Bot próprio (não é o Severino). Application ID: **`1543653928996970650`**.
Processo na mesma VPS do scc-bot: PM2 `scc-mecanicas-bot`.

Cada mecânica = **um servidor Discord**, isolado. O bot `1543653928996970650` precisa estar em todos. Canais (ponto, farm, logs) e webhooks se editam em **Admin → Mecânicas**.

## Servidores (guild)

| Mecânica | Guild ID |
|---|---|
| Motoclube | `1543310030302875829` |
| Tuner | `1426255873423966250` |
| Power | `1425805958738743408` |
| Reds | `1445969740316020758` |

Novas oficinas: criar no admin e colar o Guild ID. Sem misturar canais entre servidores.

## O que o bot faz, e em qual canal

| Função | Onde atua | Como configura |
|---|---|---|
| **Ponto** (bater / fechar) | Canal da embed `/ponto setup` | `workshops.ponto_channel_id` — o ID desse canal. O site resolve a mecânica pelo canal. |
| **Aviso de ponto aberto** | Mesmo canal do ponto | Webhook `ponto_webhook_url` e/ou ação `ponto_warn` (bot menciona o funcionário). |
| **Farm** (pagar + print) | Canal da embed `/farm-painel` | Qualquer canal do **Guild** da mecânica (`workshops.guild_id`). Print some depois do envio. |
| **Logs do baú** (jogo → painel) | Canal definido com `/set_log_channel` | Salvo no arquivo do bot `bot/log_forwarder_config.json` (por guild), **não** no site. |
| **Hierarquia** (nick + cargos) | Servidor inteiro da mecânica | `guild_id` + cargos Discord nos prefixos. Fila `bot_actions` tipo `hierarchy_update`. |
| **Kick** | Servidor da mecânica | Ação `discord_kick` quando alguém é removido/blacklist. |
| **OS / whitelist / staff / BL** | Canais dos **webhooks** do Discord | URLs no admin — o site posta embed, o bot não precisa estar no canal. |

Uma mecânica = **um servidor Discord** (`guild_id` único).

## Comandos (slash)

| Comando | Quem | Efeito |
|---|---|---|
| `/ponto setup` | Admin do servidor | Posta botões Bater/Fechar ponto. Copiar o Channel ID para o admin do site. |
| `/ponto status` | — | Orienta a olhar o painel. |
| `/ponto forcar_fechar` | — | Fecha o próprio ponto. |
| `/farm-painel` | Admin | Posta botão Pagar farm. |
| `/set_log_channel` | Admin | Define o canal de logs daquele guild. |
| `/atcargos` | — | Aplica agora as ações de hierarquia pendentes. |

## API que o bot chama (`X-Bot-Secret`)

Base: `SITE_URL` (env do bot; antes era `https://mecanicascc6.lovable.app`).

- `POST /api/public/hooks/ponto`
- `POST /api/public/bot/logs`
- `GET/POST /api/public/bot/actions` (poll 30s)
- `POST /api/public/bot/farm` e `/api/public/bot/farm-upload`
- `GET /api/public/bot/workshop-by-guild?guild_id=`

## Webhooks (site → Discord, sem o bot)

Por mecânica: OS, hierarquia, staff, blacklist, whitelist, ponto, farm.
Globais (owner): webhook central de OS e blacklist central.

## Oficinas desta versão

Reds · Tuner · Power · Motoclube — cada uma com área no site e o próprio `guild_id`.
