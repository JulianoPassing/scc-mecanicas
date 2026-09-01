"""
Cog unificado: Ponto + LogForwarder.

Ambos os fluxos usam o MESMO SITE_URL e o MESMO segredo (X-Bot-Secret),
lido de `app_settings.bot_webhook_secret` no site:

- Ponto:       POST  {SITE_URL}/api/public/hooks/ponto      (header X-Bot-Secret)
- Logs:        POST  {SITE_URL}/api/public/bot/logs         (header X-Bot-Secret)
- Actions:     GET/POST {SITE_URL}/api/public/bot/actions   (header X-Bot-Secret)

setup(bot) registra os dois cogs (Ponto e LogForwarderCog) — carregue apenas
`cogs.ponto` no seu bot.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands, tasks

SITE_URL = (os.getenv("SITE_URL") or "").rstrip("/")
if not SITE_URL:
    raise RuntimeError("SITE_URL ausente no .env do bot (URL pública da API na VPS)")
# Header X-Bot-Secret: env BOT_WEBHOOK_SECRET (mesmo valor da API).
BOT_WEBHOOK_SECRET_FALLBACK = ""

PONTO_URL       = f"{SITE_URL}/api/public/hooks/ponto"
BOT_LOGS_URL    = f"{SITE_URL}/api/public/bot/logs"
BOT_ACTIONS_URL = f"{SITE_URL}/api/public/bot/actions"
BOT_FARM_URL          = f"{SITE_URL}/api/public/bot/farm"
BOT_FARM_UPLOAD_URL   = f"{SITE_URL}/api/public/bot/farm-upload"
BOT_WORKSHOP_GUILD_URL = f"{SITE_URL}/api/public/bot/workshop-by-guild"
BOT_WORKSHOPS_URL = f"{SITE_URL}/api/public/bot/workshops"
BOT_NICKS_URL = f"{SITE_URL}/api/public/bot/nicks"


def _resolve_bot_secret() -> str:
    return os.getenv("BOT_WEBHOOK_SECRET", "") or BOT_WEBHOOK_SECRET_FALLBACK


log = logging.getLogger("cogs.ponto")
if not log.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

EMBED_COLOR = 0x2ECC71
EMBED_COLOR_ERR = 0xE74C3C

CID_OPEN = "ponto:open"
CID_CLOSE = "ponto:close"
CID_FARM_PAY = "farm:pay"



# ---------------------------------------------------------------------------
# Utilitários compartilhados
# ---------------------------------------------------------------------------

_LAST_LOG: dict[str, tuple[float, int]] = {}
_LOG_WINDOW_S = 60.0


def _short(value: object, limit: int = 120) -> str:
    compact = " ".join(str(value or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1] + "…"


def _rate_limited(key: str) -> tuple[bool, int]:
    now = time.monotonic()
    ts, suppressed = _LAST_LOG.get(key, (0.0, 0))
    if now - ts >= _LOG_WINDOW_S:
        _LAST_LOG[key] = (now, 0)
        return True, suppressed
    _LAST_LOG[key] = (ts, suppressed + 1)
    return False, 0


def _short_reason(body_text: str) -> str:
    if not body_text:
        return "empty"
    s = body_text.strip()
    lower = s[:500].lower()
    if (
        "<!doctype html" in lower
        or "<html" in lower
        or "project not found" in lower
    ):
        return "project_not_found_or_unpublished"
    if not s.startswith("{"):
        return "non-json body"
    try:
        j = json.loads(s)
        msg = j.get("error") or j.get("message") or ""
        return _short(msg, 120) if msg else "json without error field"
    except Exception:
        return "non-json body"


def _log_http(method: str, url: str, status: int, reason: str = "") -> None:
    key = f"{method} {url} {status}"
    should, suppressed = _rate_limited(key)
    if not should:
        return
    extra = f" (suppressed {suppressed})" if suppressed else ""
    log.warning("%s %s -> %s %s%s", method, url, status, f"({reason})" if reason else "", extra)


def _log_exc(op: str, exc: BaseException) -> None:
    key = f"EXC {op} {type(exc).__name__}"
    should, suppressed = _rate_limited(key)
    if not should:
        return
    extra = f" (suppressed {suppressed})" if suppressed else ""
    log.warning("%s: %s: %s%s", op, type(exc).__name__, _short(exc, 160), extra)


def _short_http_error(status: int, text: str) -> dict:
    compact = _short(text, 300)
    reason = _short_reason(text)
    if status == 404 and reason == "project_not_found_or_unpublished":
        return {
            "ok": False,
            "error": "site_url_invalid_or_not_published",
            "message": f"Endpoint não encontrado em {SITE_URL}. Confira se o app foi publicado/atualizado.",
        }
    if not compact:
        return {"ok": False, "error": f"http_{status}"}
    return {"ok": False, "error": _short(compact, 120)}


# ---------------------------------------------------------------------------
# Ponto
# ---------------------------------------------------------------------------

async def _call_hook(
    session: aiohttp.ClientSession,
    *,
    channel_id: str,
    discord_id: str,
    action: str,
) -> tuple[int, dict]:
    payload = {
        "channel_id": channel_id,
        "discord_id": discord_id,
        "action": action,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    headers = {
        "content-type": "application/json",
        "X-Bot-Secret": _resolve_bot_secret(),
    }
    async with session.post(PONTO_URL, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as r:
        try:
            data = await r.json(content_type=None)
        except Exception:
            data = _short_http_error(r.status, await r.text())
        return r.status, data



def _fmt_time(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        dt = dt.astimezone(timezone(timedelta(hours=-3)))
        return dt.strftime("%d/%m %H:%M")
    except Exception:
        return iso


class PontoView(discord.ui.View):
    def __init__(self) -> None:
        super().__init__(timeout=None)

    @discord.ui.button(label="Bater ponto", style=discord.ButtonStyle.success, emoji="🟢", custom_id=CID_OPEN)
    async def open_btn(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await _handle_action(interaction, "open")

    @discord.ui.button(label="Fechar ponto", style=discord.ButtonStyle.danger, emoji="🔴", custom_id=CID_CLOSE)
    async def close_btn(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await _handle_action(interaction, "close")


# ---------------------------------------------------------------------------
# Farm — painel com botão + modal, print no canal (auto-apagado)
# ---------------------------------------------------------------------------


async def _submit_farm_upload(
    session: aiohttp.ClientSession,
    *,
    guild_id: str,
    discord_id: str,
    amount: int,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    message_id: Optional[str],
    channel_id: Optional[str],
) -> tuple[int, dict]:
    form = aiohttp.FormData()
    form.add_field("guild_id", guild_id)
    form.add_field("discord_id", discord_id)
    form.add_field("amount", str(amount))
    if message_id:
        form.add_field("message_id", message_id)
    if channel_id:
        form.add_field("channel_id", channel_id)
    form.add_field("file", file_bytes, filename=filename or "print.png", content_type=content_type or "image/png")
    headers = {"X-Bot-Secret": _resolve_bot_secret()}
    async with session.post(
        BOT_FARM_UPLOAD_URL, data=form, headers=headers,
        timeout=aiohttp.ClientTimeout(total=30),
    ) as r:
        try:
            data = await r.json(content_type=None)
        except Exception:
            data = {"error": _short_http_error(r.status, await r.text())}
        return r.status, (data or {})


class FarmAmountModal(discord.ui.Modal, title="Pagar farm"):
    quantidade = discord.ui.TextInput(
        label="Quantidade",
        placeholder="ex.: 150",
        required=True,
        max_length=8,
    )

    async def on_submit(self, interaction: discord.Interaction) -> None:
        try:
            amount = int(str(self.quantidade.value).strip())
        except Exception:
            await interaction.response.send_message("❌ Quantidade inválida.", ephemeral=True)
            return
        if amount <= 0 or amount > 1_000_000:
            await interaction.response.send_message("❌ Quantidade fora do intervalo permitido.", ephemeral=True)
            return
        if not interaction.guild or not interaction.channel:
            await interaction.response.send_message("❌ Use em um servidor.", ephemeral=True)
            return

        await interaction.response.send_message(
            f"📸 Agora envie o **print da entrega** neste canal (imagem anexada) em até **2 minutos**.\n"
            f"Quantidade: **{amount}**. O print será apagado automaticamente após o envio.",
            ephemeral=True,
        )

        bot = interaction.client

        def _check(m: discord.Message) -> bool:
            return (
                m.author.id == interaction.user.id
                and m.channel.id == interaction.channel_id
                and bool(m.attachments)
                and any((a.content_type or "").startswith("image/") for a in m.attachments)
            )

        try:
            msg: discord.Message = await bot.wait_for("message", timeout=120.0, check=_check)
        except asyncio.TimeoutError:
            await interaction.followup.send(
                "⌛ Tempo esgotado. Clique em **Pagar farm** de novo e envie o print.",
                ephemeral=True,
            )
            return

        attachment = next(
            (a for a in msg.attachments if (a.content_type or "").startswith("image/")),
            None,
        )
        if attachment is None:
            await interaction.followup.send("❌ Nenhuma imagem encontrada.", ephemeral=True)
            try:
                await msg.delete()
            except Exception:
                pass
            return

        try:
            file_bytes = await attachment.read()
        except Exception as e:
            _log_exc("farm attachment read", e)
            await interaction.followup.send(f"❌ Falha ao baixar o print: `{_short(e, 120)}`", ephemeral=True)
            return

        cog = bot.get_cog("Ponto")  # type: ignore
        session = cog.session if cog and getattr(cog, "session", None) else aiohttp.ClientSession()
        close_after = not (cog and getattr(cog, "session", None))
        try:
            status, data = await _submit_farm_upload(
                session,
                guild_id=str(interaction.guild.id),
                discord_id=str(interaction.user.id),
                amount=amount,
                file_bytes=file_bytes,
                filename=attachment.filename or "print.png",
                content_type=attachment.content_type or "image/png",
                message_id=str(msg.id),
                channel_id=str(msg.channel.id),
            )
        except Exception as e:
            _log_exc("farm upload", e)
            await interaction.followup.send(
                f"❌ Falha ao contatar o servidor: `{_short(e, 120)}`", ephemeral=True
            )
            return
        finally:
            if close_after:
                await session.close()

        # Apaga o print no canal para manter o canal limpo
        try:
            await msg.delete()
        except Exception:
            pass

        if status == 401:
            await interaction.followup.send("❌ Chave secreta (X-Bot-Secret) não confere.", ephemeral=True)
            return
        if status == 404:
            err = (data or {}).get("error") or "não encontrado"
            await interaction.followup.send(f"❌ {_short(err, 160)}", ephemeral=True)
            return
        if status >= 400 or not (data or {}).get("ok"):
            await interaction.followup.send(
                f"❌ Erro: `{_short((data or {}).get('error', status), 160)}`",
                ephemeral=True,
            )
            return

        await interaction.followup.send(
            f"✅ Farm de **{amount}** registrado como **pendente**. Aguarde a aprovação.",
            ephemeral=True,
        )


class FarmPayView(discord.ui.View):
    def __init__(self) -> None:
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Pagar farm",
        style=discord.ButtonStyle.success,
        emoji="🌾",
        custom_id=CID_FARM_PAY,
    )
    async def pay_btn(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_modal(FarmAmountModal())


_last_click: dict[str, float] = {}


async def _handle_action(interaction: discord.Interaction, action: str) -> None:
    user_id = str(interaction.user.id)
    now = time.time()
    if now - _last_click.get(user_id, 0) < 2:
        await interaction.response.send_message("⏱️ Espera um instante e tenta de novo.", ephemeral=True)
        return
    _last_click[user_id] = now

    await interaction.response.defer(ephemeral=True, thinking=True)

    channel_id = str(interaction.channel_id)
    cog: "Ponto" = interaction.client.get_cog("Ponto")  # type: ignore
    session = cog.session if cog and cog.session else aiohttp.ClientSession()
    close_after = not (cog and cog.session)

    try:
        status, data = await _call_hook(session, channel_id=channel_id, discord_id=user_id, action=action)
    except Exception as e:
        log.warning("hook call failed: %s", _short(e, 120))
        await interaction.followup.send(f"❌ Falha ao contatar o servidor: `{_short(e, 120)}`", ephemeral=True)
        return
    finally:
        if close_after:
            await session.close()

    if status == 401:
        await interaction.followup.send(
            "❌ Chave secreta (X-Bot-Secret) não confere. Peça pro admin conferir o campo em `/mecanica`.",
            ephemeral=True,
        )
        return

    if status == 404:
        err = data.get("error")
        if err == "channel_not_configured":
            msg = "❌ Este canal não está vinculado a nenhuma mecânica. Peça pro admin configurar em `/admin/webhooks`."
        elif err == "employee_not_found":
            msg = "❌ Você não está registrado como funcionário ativo desta mecânica (Discord ID não encontrado)."
        elif err == "site_url_invalid_or_not_published":
            msg = "❌ Endpoint do ponto não encontrado. Publique/atualize o site e confirme o SITE_URL no cog."
        else:
            msg = f"❌ Não encontrado: `{_short(err, 120)}`"
        await interaction.followup.send(msg, ephemeral=True)
        return
    if status >= 400 or not data.get("ok"):
        await interaction.followup.send(f"❌ Erro: `{_short(data.get('error', status), 120)}`", ephemeral=True)
        return

    st = data.get("status")
    emp = data.get("employee", interaction.user.display_name)

    if st == "opened":
        emb = discord.Embed(title="🟢 Ponto aberto", description=f"**{emp}** iniciou o expediente.", color=EMBED_COLOR)
        emb.add_field(name="Abertura", value=_fmt_time(data.get("opened_at")), inline=True)
    elif st == "already_open":
        emb = discord.Embed(title="ℹ️ Ponto já estava aberto", description=f"**{emp}** já tem um ponto em andamento.", color=EMBED_COLOR)
        emb.add_field(name="Aberto desde", value=_fmt_time(data.get("opened_at")), inline=True)
    elif st == "closed":
        hours = data.get("hours", 0)
        emb = discord.Embed(title="🔴 Ponto fechado", description=f"**{emp}** encerrou o expediente.", color=EMBED_COLOR_ERR)
        emb.add_field(name="Abertura", value=_fmt_time(data.get("opened_at")), inline=True)
        emb.add_field(name="Fechamento", value=_fmt_time(data.get("closed_at")), inline=True)
        emb.add_field(name="Total", value=f"**{hours}h**", inline=True)
    elif st == "already_closed":
        emb = discord.Embed(title="ℹ️ Nenhum ponto aberto", description=f"**{emp}** não tinha ponto em andamento.", color=EMBED_COLOR_ERR)
    else:
        emb = discord.Embed(title="OK", description=str(data), color=EMBED_COLOR)

    if st in ("opened", "closed") and interaction.channel:
        try:
            await interaction.channel.send(embed=emb)
        except Exception:
            pass

    await interaction.followup.send(embed=emb, ephemeral=True)


class Ponto(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.session: aiohttp.ClientSession | None = None

    async def cog_load(self) -> None:
        self.session = aiohttp.ClientSession()
        self.bot.add_view(PontoView())
        self.bot.add_view(FarmPayView())
        secret = _resolve_bot_secret()
        log.info("Cog Ponto carregado. SITE_URL=%s bot_secret_set=%s", SITE_URL, bool(secret))
        if not secret:
            log.warning("BOT_WEBHOOK_SECRET ausente e sem fallback — /ponto vai receber 401.")


    async def cog_unload(self) -> None:
        if self.session:
            await self.session.close()

    group = app_commands.Group(
        name="ponto",
        description="Sistema de ponto",
        default_permissions=discord.Permissions(manage_guild=True),
    )

    @group.command(name="setup", description="Posta a embed de ponto neste canal (admin).")
    @app_commands.describe(
        mecanica="Nome da mecânica (só aparece no título da embed)",
        canal="Canal onde postar (padrão: canal atual)",
    )
    async def setup_cmd(
        self,
        interaction: discord.Interaction,
        mecanica: str,
        canal: Optional[discord.TextChannel] = None,
    ) -> None:
        target = canal or interaction.channel
        if not isinstance(target, discord.TextChannel):
            await interaction.response.send_message("Canal inválido.", ephemeral=True)
            return
        emb = discord.Embed(
            title=f"⏱️ Ponto — {mecanica}",
            description=(
                "Clique em **🟢 Bater ponto** para iniciar seu expediente.\n"
                "Clique em **🔴 Fechar ponto** para encerrar.\n\n"
                "Cada batida é registrada **neste canal** com início, fim e total de horas."
            ),
            color=EMBED_COLOR,
        )
        emb.set_footer(text="Mecânico SCC")
        msg = await target.send(embed=emb, view=PontoView())
        await interaction.response.send_message(
            f"✅ Embed postada em {target.mention}.\n"
            f"**Copie o Channel ID `{target.id}`** e cole em `/admin/webhooks` "
            f"na coluna *Canal do Ponto* da mecânica **{mecanica}**.\n"
            f"Mensagem: {msg.jump_url}",
            ephemeral=True,
        )

    @group.command(name="status", description="Mostra se você tem ponto aberto neste canal.")
    async def status_cmd(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(
            "ℹ️ Use os botões da embed do canal para bater/fechar ponto. "
            "O status ao vivo está em **/admin/ponto** no painel.",
            ephemeral=True,
        )

    @group.command(name="forcar_fechar", description="Força o fechamento do seu próprio ponto (equivalente ao botão 🔴).")
    async def forcar_fechar(self, interaction: discord.Interaction) -> None:
        await _handle_action(interaction, "close")

    # ---------- /farm-painel ----------

    @app_commands.command(
        name="farm-painel",
        description="Publica o painel de pagamento de farm neste canal (admin).",
    )
    @app_commands.describe(canal="Canal onde postar (padrão: canal atual)")
    @app_commands.default_permissions(administrator=True)
    async def farm_panel_cmd(
        self,
        interaction: discord.Interaction,
        canal: Optional[discord.TextChannel] = None,
    ) -> None:
        if not interaction.guild:
            await interaction.response.send_message("❌ Use este comando dentro de um servidor.", ephemeral=True)
            return
        target = canal or interaction.channel
        if not isinstance(target, discord.TextChannel):
            await interaction.response.send_message("Canal inválido.", ephemeral=True)
            return

        # Resolve nome/cor da mecânica pelo guild_id
        mec_name = interaction.guild.name
        color = EMBED_COLOR
        session = self.session or aiohttp.ClientSession()
        close_after = self.session is None
        try:
            async with session.get(
                BOT_WORKSHOP_GUILD_URL,
                params={"guild_id": str(interaction.guild.id)},
                headers={"X-Bot-Secret": _resolve_bot_secret()},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as r:
                if r.status == 200:
                    ws = await r.json(content_type=None)
                    mec_name = ws.get("name") or mec_name
                    hexv = (ws.get("primary_color") or "").lstrip("#")
                    try:
                        if hexv:
                            color = int(hexv, 16)
                    except Exception:
                        pass
        except Exception as e:
            _log_exc("farm-painel workshop lookup", e)
        finally:
            if close_after:
                await session.close()

        emb = discord.Embed(
            title=f"🌾 Pagamento de Farm — {mec_name}",
            description=(
                "Clique em **Pagar farm** para registrar sua entrega.\n\n"
                "1️⃣ Informe a **quantidade** entregue.\n"
                "2️⃣ Envie o **print** neste canal (imagem anexada).\n"
                "3️⃣ O bot apaga o print para manter o canal limpo e envia ao painel para aprovação."
            ),
            color=color,
        )
        emb.set_footer(text="Mecânico SCC")
        msg = await target.send(embed=emb, view=FarmPayView())
        await interaction.response.send_message(
            f"✅ Painel postado em {target.mention}. Mensagem: {msg.jump_url}",
            ephemeral=True,
        )

    @app_commands.command(
        name="publicar-paineis",
        description="Publica ponto + farm em todos os canais já configurados no Admin (de uma vez).",
    )
    @app_commands.default_permissions(administrator=True)
    async def publish_panels_cmd(self, interaction: discord.Interaction) -> None:
        if not interaction.guild or not isinstance(interaction.user, discord.Member):
            await interaction.response.send_message("❌ Use em um servidor.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        session = self.session or aiohttp.ClientSession()
        close_after = self.session is None
        workshops: list[dict] = []
        try:
            try:
                async with session.get(
                    BOT_WORKSHOPS_URL,
                    headers={"X-Bot-Secret": _resolve_bot_secret()},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as r:
                    data = await r.json(content_type=None) if r.status == 200 else {}
                    workshops = list((data or {}).get("workshops") or [])
            except Exception as e:
                _log_exc("publicar-paineis fetch", e)
                await interaction.followup.send("❌ Não consegui ler as mecânicas na API.", ephemeral=True)
                return
        finally:
            if close_after:
                await session.close()

        if not workshops:
            await interaction.followup.send(
                "❌ Nenhuma mecânica com Guild ID no Admin.",
                ephemeral=True,
            )
            return

        lines: list[str] = []
        posted = 0
        for ws in workshops:
            gid = str(ws.get("guild_id") or "")
            guild = self.bot.get_guild(int(gid)) if gid.isdigit() else None
            if guild is None:
                lines.append(f"• **{ws.get('name')}** — bot não está nesse servidor")
                continue
            member = guild.get_member(interaction.user.id)
            if member is None or not member.guild_permissions.administrator:
                lines.append(f"• **{ws.get('name')}** — você não é admin nesse Discord")
                continue
            try:
                notes = await publish_workshop_panels(self.bot, {**ws, "guild_id": gid})
                posted += 1
                lines.append(f"• **{ws.get('name')}** — {', '.join(notes)}")
            except Exception as e:
                _log_exc("publicar-paineis post", e)
                lines.append(f"• **{ws.get('name')}** — falha `{_short(e, 80)}`")

        await interaction.followup.send(
            f"**Painéis:** {posted} mecânica(s)\n" + "\n".join(lines[:20]),
            ephemeral=True,
        )





# ---------------------------------------------------------------------------
# LogForwarder (unificado)
# ---------------------------------------------------------------------------

# import opcional — algumas hospedagens não têm o helper local
try:
    from utils.data_manager import load_config, save_config  # type: ignore
except Exception:
    _CONFIG_FILE = "log_forwarder_config.json"

    def load_config() -> dict:
        try:
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except Exception:
            return {}

    def save_config(cfg: dict) -> None:
        try:
            with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception as e:
            _log_exc("save_config", e)


def _embed_color(hexv: object) -> int:
    try:
        s = str(hexv or "").lstrip("#")
        if s:
            return int(s, 16)
    except Exception:
        pass
    return EMBED_COLOR


async def _fetch_text_channel(bot: commands.Bot, channel_id: object) -> Optional[discord.TextChannel]:
    raw = str(channel_id or "").strip()
    if not raw:
        return None
    try:
        cid = int(raw)
    except Exception:
        return None
    ch = bot.get_channel(cid)
    if ch is None:
        try:
            ch = await bot.fetch_channel(cid)
        except Exception as e:
            _log_exc(f"fetch_channel {cid}", e)
            return None
    return ch if isinstance(ch, discord.TextChannel) else None


async def publish_workshop_panels(bot: commands.Bot, ws: dict) -> list[str]:
    notes: list[str] = []
    name = str(ws.get("name") or "Mecânica")
    color = _embed_color(ws.get("primary_color"))
    ponto_ch = await _fetch_text_channel(bot, ws.get("ponto_channel_id"))
    farm_ch = await _fetch_text_channel(bot, ws.get("farm_channel_id"))
    if ponto_ch:
        emb = discord.Embed(
            title=f"⏱️ Ponto — {name}",
            description=(
                "Clique em **🟢 Bater ponto** para iniciar seu expediente.\n"
                "Clique em **🔴 Fechar ponto** para encerrar.\n\n"
                "Cada batida é registrada **neste canal** com início, fim e total de horas."
            ),
            color=color,
        )
        emb.set_footer(text="Mecânico SCC")
        await ponto_ch.send(embed=emb, view=PontoView())
        notes.append(f"ponto → #{ponto_ch.name}")
    else:
        notes.append("ponto: canal ausente")
    if farm_ch:
        emb = discord.Embed(
            title=f"🌾 Pagamento de Farm — {name}",
            description=(
                "Clique em **Pagar farm** para registrar sua entrega.\n\n"
                "1️⃣ Informe a **quantidade** entregue.\n"
                "2️⃣ Envie o **print** neste canal (imagem anexada).\n"
                "3️⃣ O bot apaga o print para manter o canal limpo e envia ao painel para aprovação."
            ),
            color=color,
        )
        emb.set_footer(text="Mecânico SCC")
        await farm_ch.send(embed=emb, view=FarmPayView())
        notes.append(f"farm → #{farm_ch.name}")
    else:
        notes.append("farm: canal ausente")
    gid = str(ws.get("guild_id") or "")
    log_id = str(ws.get("log_channel_id") or "").strip()
    if gid and log_id:
        try:
            cog = bot.get_cog("LogForwarderCog")
            if cog and hasattr(cog, "guild_configs"):
                cog.guild_configs.setdefault(gid, {})["log_channel_id"] = int(log_id)
                save_config(cog.guild_configs)
                notes.append("logs ligados")
        except Exception as e:
            _log_exc("publish log channel", e)
            notes.append("logs: falha")
    return notes


class LogForwarderCog(commands.Cog):
    HTTP_TIMEOUT = aiohttp.ClientTimeout(total=15)

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.bot_secret = os.getenv("BOT_WEBHOOK_SECRET", "") or BOT_WEBHOOK_SECRET_FALLBACK
        self.headers = {
            "X-Bot-Secret": self.bot_secret,
            "Content-Type": "application/json",
        }
        self.guild_configs = load_config()

        log.info(
            "Cog LogForwarder carregado. SITE_URL=%s bot_secret_set=%s len=%s",
            SITE_URL, bool(self.bot_secret), len(self.bot_secret),
        )

        if not self.bot_secret:
            log.warning("BOT_WEBHOOK_SECRET ausente — polling desativado.")
            self._polling_enabled = False
        else:
            self._polling_enabled = True
            self._first_poll_reported = False
            self.poll_actions.start()

    def cog_unload(self) -> None:
        if self._polling_enabled:
            self.poll_actions.cancel()

    # ---------- Utilitários ----------

    def extract_discord_id(self, text: str) -> Optional[str]:
        m = re.search(r"<@!?(\d+)>", text or "")
        return m.group(1) if m else None

    async def _safe_request(
        self, session: aiohttp.ClientSession, method: str, url: str, **kw,
    ) -> tuple[int, dict | list | None]:
        try:
            async with session.request(method, url, timeout=self.HTTP_TIMEOUT, **kw) as resp:
                text = ""
                data: dict | list | None = None
                try:
                    text = await resp.text()
                except Exception:
                    text = ""
                if text:
                    try:
                        data = json.loads(text)
                    except Exception:
                        data = None
                if resp.status >= 400:
                    _log_http(method, url, resp.status, _short_reason(text))
                return resp.status, data
        except asyncio.TimeoutError as e:
            _log_exc(f"{method} {url}", e)
            return 0, None
        except aiohttp.ClientError as e:
            _log_exc(f"{method} {url}", e)
            return 0, None
        except Exception as e:
            _log_exc(f"{method} {url}", e)
            return 0, None

    # ---------- /set_log_channel ----------

    @app_commands.command(name="set_log_channel", description="Define o canal de logs deste servidor.")
    @app_commands.describe(canal="Canal onde as logs serão monitoradas.")
    async def set_log_channel(self, interaction: discord.Interaction, canal: discord.TextChannel):
        if not interaction.user.guild_permissions.administrator:
            return await interaction.response.send_message("❌ Apenas administradores.", ephemeral=True)
        gid = str(interaction.guild.id)
        self.guild_configs.setdefault(gid, {})["log_channel_id"] = canal.id
        save_config(self.guild_configs)
        await interaction.response.send_message(f"✅ Canal de logs: {canal.mention}", ephemeral=True)

    # ---------- /logs (forward automático) ----------

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author == self.bot.user or not message.guild:
            return
        gid = str(message.guild.id)
        log_channel_id = self.guild_configs.get(gid, {}).get("log_channel_id")
        if message.channel.id != log_channel_id:
            return

        discord_id = self.extract_discord_id(message.content)
        raw_text = message.content or ""
        if message.embeds:
            for emb in message.embeds:
                raw_text += f"\n[Embed] {emb.title or ''}: {emb.description or ''}"
                for f in emb.fields:
                    raw_text += f"\n{f.name}: {f.value}"

        payload = {
            "guild_id": gid,
            "raw_text": raw_text,
            "discord_id": discord_id,
            "occurred_at": datetime.utcnow().isoformat() + "Z",
        }
        try:
            async with aiohttp.ClientSession() as session:
                await self._safe_request(
                    session, "POST", BOT_LOGS_URL,
                    json=payload, headers=self.headers,
                )
        except Exception as e:
            _log_exc("logs session", e)

    # ---------- Hierarquia ----------

    async def _apply_hierarchy(self, guild: discord.Guild, payload: dict) -> tuple[bool, str | None]:
        prefixes = payload.get("role_prefixes", []) or []
        employees = payload.get("employees", []) or []

        by_label = {p["label"]: p for p in prefixes if p.get("label")}
        hierarchy_role_ids = {str(p["discord_role_id"]) for p in prefixes if p.get("discord_role_id")}
        known_prefix_strs = [p["nickname_prefix"] for p in prefixes if p.get("nickname_prefix")]

        first_error: str | None = None

        for emp in employees:
            did = emp.get("discord_id")
            if not did:
                continue
            try:
                member = guild.get_member(int(did)) or await guild.fetch_member(int(did))
            except Exception:
                continue
            if not member:
                continue

            p = by_label.get(emp.get("role_label") or "")
            prefix = (p or {}).get("nickname_prefix") or ""
            base_name = emp.get("name") or member.display_name

            current = member.nick or member.name
            for pf in known_prefix_strs:
                if current.startswith(pf + " "):
                    current = current[len(pf) + 1:]
                    break
            new_nick = f"{prefix} {base_name}".strip() if prefix else base_name
            new_nick = new_nick[:32]

            try:
                if (member.nick or "") != new_nick:
                    await member.edit(nick=new_nick, reason="Sync hierarquia (site)")

                target_role_id = (p or {}).get("discord_role_id")
                target_role = guild.get_role(int(target_role_id)) if target_role_id else None

                to_remove = [
                    r for r in member.roles
                    if str(r.id) in hierarchy_role_ids and (not target_role or r.id != target_role.id)
                ]
                if to_remove:
                    await member.remove_roles(*to_remove, reason="Sync hierarquia (site)")
                if target_role and target_role not in member.roles:
                    await member.add_roles(target_role, reason="Sync hierarquia (site)")
            except discord.Forbidden as e:
                first_error = first_error or f"forbidden {member.id}"
                _log_exc(f"apply_hierarchy {member.id}", e)
            except Exception as e:
                first_error = first_error or f"{type(e).__name__} {member.id}"
                _log_exc(f"apply_hierarchy {member.id}", e)

        return (first_error is None), first_error

    # ---------- Kick (remoção do servidor) ----------

    async def _apply_kick(self, guild: discord.Guild, payload: dict) -> tuple[bool, str | None]:
        did = payload.get("discord_id")
        if not did:
            return True, None  # nada para fazer
        reason = _short(payload.get("reason") or "Removido do painel", 400)
        try:
            member = guild.get_member(int(did))
            if member is None:
                try:
                    member = await guild.fetch_member(int(did))
                except discord.NotFound:
                    return True, None  # já não está no servidor
        except Exception as e:
            _log_exc(f"kick_lookup {did}", e)
            return False, f"{type(e).__name__}"
        if member is None:
            return True, None
        try:
            await guild.kick(member, reason=reason)
            return True, None
        except discord.Forbidden as e:
            _log_exc(f"kick_forbidden {did}", e)
            return False, "forbidden"
        except Exception as e:
            _log_exc(f"kick {did}", e)
            return False, f"{type(e).__name__}"


    async def _apply_ponto_warn(self, guild: discord.Guild, payload: dict) -> tuple[bool, str | None]:
        channel_id = payload.get("channel_id")
        discord_id = payload.get("discord_id")
        hours_limit = payload.get("hours_limit", 8)
        emp_name = payload.get("employee_name") or ""
        if not channel_id or not discord_id:
            return True, None
        try:
            ch = guild.get_channel(int(channel_id)) or await self.bot.fetch_channel(int(channel_id))
        except Exception as e:
            _log_exc(f"ponto_warn_channel {channel_id}", e)
            return False, f"channel_fetch_{type(e).__name__}"
        if ch is None or not isinstance(ch, (discord.TextChannel, discord.Thread)):
            return False, "invalid_channel"
        mention = f"<@{discord_id}>"
        content = (
            f"⏰ {mention} seu ponto está aberto há mais de **{hours_limit}h**. "
            f"Feche em até **20 minutos** clicando no botão 🔴 acima, "
            f"ou ele será fechado automaticamente."
        )
        try:
            await ch.send(
                content=content,
                allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False),
            )
            return True, None
        except discord.Forbidden as e:
            _log_exc(f"ponto_warn_send {channel_id}", e)
            return False, "forbidden"
        except Exception as e:
            _log_exc(f"ponto_warn_send {channel_id}", e)
            return False, f"{type(e).__name__}"



    async def _lookup_member(self, guild: discord.Guild, discord_id: object) -> discord.Member | None:
        raw = "".join(ch for ch in str(discord_id or "") if ch.isdigit())
        if not raw:
            return None
        uid = int(raw)
        member = guild.get_member(uid)
        if member:
            return member
        try:
            return await guild.fetch_member(uid)
        except discord.NotFound:
            return None
        except discord.HTTPException as e:
            log.warning("fetch_member %s em %s: %s", uid, guild.id, e)
            return None
        except Exception as e:
            _log_exc(f"fetch_member {uid}", e)
            return None

    async def _read_nicks(
        self,
        guild: discord.Guild,
        act: dict,
        session: aiohttp.ClientSession,
    ) -> tuple[bool, str | None, dict]:
        payload = act.get("payload") or {}
        if isinstance(payload, str):
            try:
                payload = json.loads(payload) if payload else {}
            except Exception:
                payload = {}
        ids = ["".join(ch for ch in str(did or "") if ch.isdigit()) for did in (payload.get("discord_ids") or [])]
        ids = [did for did in ids if did]
        workshop_id = payload.get("workshop_id")
        if not guild.chunked:
            try:
                await guild.chunk(cache=True)
            except Exception as e:
                log.warning("guild.chunk %s: %s", guild.id, e)
        nicks = []
        missing = []
        for i, did in enumerate(ids):
            member = await self._lookup_member(guild, did)
            if not member:
                missing.append(did)
                continue
            nick = member.nick or member.display_name or member.name
            nicks.append({"discord_id": did, "nick": str(nick)[:80]})
            if i and i % 8 == 0:
                await asyncio.sleep(0.2)
        result = {"found": len(nicks), "missing": missing, "updated": len(nicks)}
        status, data = await self._safe_request(
            session,
            "POST",
            BOT_NICKS_URL,
            json={
                "guild_id": str(guild.id),
                "workshop_id": workshop_id,
                "action_id": act.get("id"),
                "nicks": nicks,
                "missing": missing,
            },
            headers=self.headers,
        )
        if status >= 400:
            return False, _short((data or {}).get("error") or status, 160), result
        if isinstance(data, dict):
            result["updated"] = int(data.get("updated") or result["updated"])
        log.info(
            "nicks guild=%s found=%s missing=%s updated=%s",
            guild.id, result["found"], len(missing), result["updated"],
        )
        return True, None, result

    async def _process_actions_for_guild(self, guild: discord.Guild) -> tuple[int, int]:
        gid = str(guild.id)
        processed = 0
        failed = 0

        try:
            async with aiohttp.ClientSession() as session:
                status, data = await self._safe_request(
                    session, "GET", f"{BOT_ACTIONS_URL}?guild_id={gid}",
                    headers=self.headers,
                )

                if not self._first_poll_reported:
                    self._first_poll_reported = True
                    if status in (401, 403):
                        log.error("POLLING FALHOU status=%s — verifique BOT_WEBHOOK_SECRET no ShardCloud", status)
                    elif status == 404:
                        log.error("POLLING FALHOU status=404 — verifique SITE_URL (%s)", SITE_URL)
                    elif status == 200:
                        log.info("Polling OK em %s", BOT_ACTIONS_URL)

                if status != 200 or not isinstance(data, dict):
                    return 0, 0

                actions = data.get("actions", []) or []
                if not actions:
                    return 0, 0

                acks = []
                for act in actions:
                    act_id = act.get("id")
                    act_type = act.get("type")
                    if act_type == "hierarchy_update":
                        ok, err = await self._apply_hierarchy(guild, act.get("payload") or {})
                        if ok:
                            acks.append({"id": act_id, "status": "sent"})
                            processed += 1
                        else:
                            acks.append({"id": act_id, "status": "failed", "error": _short(err, 200)})
                            failed += 1
                    elif act_type == "discord_kick":
                        ok, err = await self._apply_kick(guild, act.get("payload") or {})
                        if ok:
                            acks.append({"id": act_id, "status": "sent"})
                            processed += 1
                        else:
                            acks.append({"id": act_id, "status": "failed", "error": _short(err, 200)})
                            failed += 1
                    elif act_type == "ponto_warn":
                        ok, err = await self._apply_ponto_warn(guild, act.get("payload") or {})
                        if ok:
                            acks.append({"id": act_id, "status": "sent"})
                            processed += 1
                        else:
                            acks.append({"id": act_id, "status": "failed", "error": _short(err, 200)})
                            failed += 1
                    elif act_type == "nickname_read":
                        ok, err, result = await self._read_nicks(guild, act, session)
                        if ok:
                            acks.append({"id": act_id, "status": "sent", "result": result})
                            processed += 1
                        else:
                            acks.append({"id": act_id, "status": "failed", "error": _short(err, 200), "result": result})
                            failed += 1
                    elif act_type == "publish_panels":
                        payload = dict(act.get("payload") or {})
                        payload.setdefault("guild_id", gid)
                        try:
                            notes = await publish_workshop_panels(self.bot, payload)
                            acks.append({"id": act_id, "status": "sent", "result": {"notes": notes}})
                            processed += 1
                        except Exception as e:
                            _log_exc("publish_panels action", e)
                            acks.append({"id": act_id, "status": "failed", "error": _short(e, 200)})
                            failed += 1
                    else:
                        acks.append({"id": act_id, "status": "sent"})


                await self._safe_request(
                    session, "POST", BOT_ACTIONS_URL,
                    json={"ack": acks}, headers=self.headers,
                )
        except Exception as e:
            _log_exc("process_actions", e)

        return processed, failed

    @tasks.loop(seconds=8)
    async def poll_actions(self):
        if not self.bot_secret:
            return
        for guild in list(self.bot.guilds):
            try:
                await self._process_actions_for_guild(guild)
            except Exception as e:
                _log_exc(f"poll guild {guild.id}", e)

    @poll_actions.before_loop
    async def _before_poll(self):
        await self.bot.wait_until_ready()

    # ---------- /atcargos ----------

    @app_commands.command(name="atcargos", description="Sincroniza agora a hierarquia vinda do painel.")
    async def atcargos(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        processed, failed = await self._process_actions_for_guild(interaction.guild)
        if processed == 0 and failed == 0:
            return await interaction.followup.send("ℹ️ Nenhuma ação pendente.")
        await interaction.followup.send(f"✅ {processed} aplicada(s), ❌ {failed} falha(s).")


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------

async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Ponto(bot))
    await bot.add_cog(LogForwarderCog(bot))
