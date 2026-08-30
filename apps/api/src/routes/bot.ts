import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "../env.js";
import { db } from "../db/index.js";
import { botActions, botLogs, employees, farmEntries, timeClockSessions, workshops } from "../db/schema.js";
import { sendWebhook } from "../discord.js";

export const botPublic = new Hono();

function safeEq(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function authorize(c: { req: { header: (n: string) => string | undefined } }) {
  if (!env.botSecret) return { ok: false as const, status: 503 as const, error: "bot_webhook_secret não configurado" };
  const provided = c.req.header("x-bot-secret") ?? "";
  if (!provided || !safeEq(provided, env.botSecret)) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  return { ok: true as const };
}

botPublic.get("/bot/workshop-by-guild", async (c) => {
  const auth = authorize(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const guildId = (c.req.query("guild_id") ?? "").trim();
  if (!guildId) return c.json({ error: "guild_id ausente" }, 400);
  const [ws] = await db.select().from(workshops).where(eq(workshops.guildId, guildId)).limit(1);
  if (!ws) return c.json({ error: "Mecânica não encontrada" }, 404);
  return c.json({ id: ws.id, name: ws.name, primary_color: ws.primaryColor, farm_weekly_goal: ws.farmWeeklyGoal });
});

botPublic.get("/bot/actions", async (c) => {
  const auth = authorize(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const guildId = (c.req.query("guild_id") ?? "").trim();
  if (!guildId) return c.json({ error: "guild_id obrigatório" }, 400);
  let limit = Number(c.req.query("limit") ?? 50);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;
  const actions = await db
    .select()
    .from(botActions)
    .where(and(eq(botActions.guildId, guildId), eq(botActions.status, "pending")))
    .limit(limit);
  return c.json({
    now: new Date().toISOString(),
    actions: actions.map((a) => {
      let payload: unknown = a.payload;
      if (typeof a.payload === "string" && a.payload) {
        try {
          payload = JSON.parse(a.payload);
        } catch {
          payload = {};
        }
      }
      return { ...a, payload };
    }),
  });
});

botPublic.post("/bot/nicks", async (c) => {
  const auth = authorize(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const parsed = z
    .object({
      guild_id: z.string().trim().min(1),
      workshop_id: z.string().uuid().optional(),
      nicks: z.array(z.object({ discord_id: z.string(), nick: z.string().max(80) })).max(400),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Payload inválido" }, 400);
  const [ws] = parsed.data.workshop_id
    ? await db.select().from(workshops).where(eq(workshops.id, parsed.data.workshop_id)).limit(1)
    : await db.select().from(workshops).where(eq(workshops.guildId, parsed.data.guild_id)).limit(1);
  if (!ws) return c.json({ error: "Mecânica não encontrada" }, 404);
  let updated = 0;
  for (const n of parsed.data.nicks) {
    const [emp] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.workshopId, ws.id), eq(employees.discordId, n.discord_id)))
      .limit(1);
    if (!emp) continue;
    await db.update(employees).set({ discordNick: n.nick }).where(eq(employees.id, emp.id));
    updated += 1;
  }
  return c.json({ ok: true, updated });
});

botPublic.post("/bot/actions", async (c) => {
  const auth = authorize(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const body = await c.req.json().catch(() => ({}));
  const ack = Array.isArray((body as { ack?: unknown }).ack) ? (body as { ack: { id: string; status: string }[] }).ack : [];
  let updated = 0;
  for (const item of ack.slice(0, 500)) {
    if (!item?.id || (item.status !== "sent" && item.status !== "failed")) continue;
    await db.update(botActions).set({ status: item.status }).where(eq(botActions.id, item.id));
    updated += 1;
  }
  return c.json({ updated, errors: [] });
});

botPublic.post("/bot/logs", async (c) => {
  const auth = authorize(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const body = await c.req.json().catch(() => null);
  const entries = Array.isArray(body) ? body : body ? [body] : [];
  if (entries.length > 500) return c.json({ error: "Máximo 500 entradas por requisição" }, 400);
  let inserted = 0;
  for (const e of entries) {
    if (!e || typeof e.raw_text !== "string") continue;
    const guildId = typeof e.guild_id === "string" ? e.guild_id : null;
    let workshopId: string | null = null;
    if (guildId) {
      const [ws] = await db.select({ id: workshops.id }).from(workshops).where(eq(workshops.guildId, guildId)).limit(1);
      workshopId = ws?.id ?? null;
    }
    await db.insert(botLogs).values({
      guildId,
      workshopId,
      discordId: typeof e.discord_id === "string" ? e.discord_id : null,
      rawText: e.raw_text,
    });
    inserted += 1;
  }
  return c.json({ inserted });
});

async function recordFarm(input: { guildId: string; discordId: string; amount: number }) {
  const [ws] = await db.select().from(workshops).where(eq(workshops.guildId, input.guildId)).limit(1);
  if (!ws) return { error: "Mecânica não encontrada para esse guild_id", status: 404 as const };
  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workshopId, ws.id), eq(employees.discordId, input.discordId)))
    .limit(1);
  if (!emp) return { error: "Funcionário não encontrado nessa mecânica", status: 404 as const };
  const [row] = await db
    .insert(farmEntries)
    .values({
      workshopId: ws.id,
      employeeId: emp.id,
      discordId: input.discordId,
      amount: input.amount,
      status: "pending",
    })
    .returning();
  return { ok: true as const, employee: emp.name, amount: input.amount, id: row.id };
}

botPublic.post("/bot/farm", async (c) => {
  const auth = authorize(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const parsed = z
    .object({
      guild_id: z.string().trim().min(1).max(40),
      discord_id: z.string().trim().min(1).max(40),
      amount: z.coerce.number().int().positive().max(1_000_000),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Payload inválido" }, 400);
  const result = await recordFarm({
    guildId: parsed.data.guild_id,
    discordId: parsed.data.discord_id,
    amount: parsed.data.amount,
  });
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

botPublic.post("/bot/farm-upload", async (c) => {
  const auth = authorize(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const body = await c.req.parseBody();
  const guildId = String(body.guild_id ?? "").trim();
  const discordId = String(body.discord_id ?? "").trim();
  const amount = Number(body.amount);
  if (!guildId || !discordId || !Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: "Payload inválido" }, 400);
  }
  const result = await recordFarm({ guildId, discordId, amount: Math.floor(amount) });
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

botPublic.post("/hooks/ponto", async (c) => {
  const auth = authorize(c);
  if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
  const parsed = z
    .object({
      channel_id: z.string().min(1),
      discord_id: z.string().min(1),
      action: z.enum(["open", "close", "toggle"]).default("toggle"),
      timestamp: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: "Payload inválido" }, 400);

  const [ws] = await db.select().from(workshops).where(eq(workshops.pontoChannelId, parsed.data.channel_id)).limit(1);
  if (!ws) return c.json({ ok: false, error: "channel_not_configured" }, 404);

  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workshopId, ws.id), eq(employees.discordId, parsed.data.discord_id), eq(employees.status, "active")))
    .limit(1);
  if (!emp) return c.json({ ok: false, error: "employee_not_found" }, 404);

  const [open] = await db
    .select()
    .from(timeClockSessions)
    .where(and(eq(timeClockSessions.employeeId, emp.id), isNull(timeClockSessions.closedAt)))
    .limit(1);

  const nowIso = parsed.data.timestamp ?? new Date().toISOString();
  let action = parsed.data.action;
  if (action === "toggle") action = open ? "close" : "open";

  if (action === "open") {
    if (open) {
      return c.json({ ok: true, status: "already_open", employee: emp.name, opened_at: open.openedAt });
    }
    await db.insert(timeClockSessions).values({
      workshopId: ws.id,
      employeeId: emp.id,
      discordId: parsed.data.discord_id,
      channelId: parsed.data.channel_id,
      openedAt: new Date(nowIso),
    });
    sendWebhook(
      ws.pontoWebhookUrl,
      {
        title: `🟢 Ponto aberto — ${ws.name}`,
        description: `**${emp.name}** iniciou o expediente.`,
        fields: [{ name: "Início", value: new Date(nowIso).toLocaleString("pt-BR"), inline: true }],
      },
      ws,
    );
    return c.json({ ok: true, status: "opened", employee: emp.name, opened_at: nowIso });
  }

  if (!open) return c.json({ ok: true, status: "already_closed", employee: emp.name });
  await db
    .update(timeClockSessions)
    .set({ closedAt: new Date(nowIso), closedVia: "discord" })
    .where(eq(timeClockSessions.id, open.id));
  const hours = Math.round(((new Date(nowIso).getTime() - open.openedAt.getTime()) / 3600000) * 10) / 10;
  sendWebhook(
    ws.pontoWebhookUrl,
    {
      title: `🔴 Ponto fechado — ${ws.name}`,
      description: `**${emp.name}** encerrou o expediente.`,
      fields: [
        { name: "Início", value: open.openedAt.toLocaleString("pt-BR"), inline: true },
        { name: "Fim", value: new Date(nowIso).toLocaleString("pt-BR"), inline: true },
        { name: "Total", value: `${hours}h`, inline: true },
      ],
    },
    ws,
  );
  return c.json({
    ok: true,
    status: "closed",
    employee: emp.name,
    opened_at: open.openedAt,
    closed_at: nowIso,
    hours,
  });
});
