import { Hono } from "hono";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { employees, userRoles, users, workshops } from "../db/schema.js";
import { actorName, audit } from "../audit.js";
import { hashPassword } from "../auth.js";
import { cargoFromSystemRole, systemRoleFromCargo, userIsWorkshopDono } from "../hierarchy.js";
import { canApprove, loadMe } from "../me.js";
import { currentUserId } from "./auth.js";

export const admin = new Hono();

admin.use("*", async (c, next) => {
  const id = await currentUserId(c);
  if (!id) return c.json({ error: "Não autenticado" }, 401);
  const me = await loadMe(id);
  if (!me) return c.json({ error: "Não autenticado" }, 401);
  if (!me.approved && !me.isOwner) return c.json({ error: "Cadastro aguardando liberação" }, 403);
  if (!me.isAdmin && !me.isDonoMec && !me.isManager) return c.json({ error: "Acesso negado" }, 403);
  c.set("me" as never, me as never);
  await next();
});

function meOf(c: { get: (k: string) => unknown }) {
  return c.get("me" as never) as NonNullable<Awaited<ReturnType<typeof loadMe>>>;
}

admin.get("/users", async (c) => {
  const me = meOf(c);
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      discordId: users.discordId,
      displayName: users.displayName,
      approved: users.approved,
      requestedWorkshopId: users.requestedWorkshopId,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  const roles = await db.select().from(userRoles);
  const byUser = new Map<string, typeof roles>();
  for (const r of roles) {
    const list = byUser.get(r.userId) ?? [];
    list.push(r);
    byUser.set(r.userId, list);
  }

  const filtered = rows.filter((u) => {
    if (me.isAdmin) return true;
    if (u.requestedWorkshopId && me.manageWorkshops.includes(u.requestedWorkshopId)) return true;
    return (byUser.get(u.id) ?? []).some((r) => r.workshopId && me.manageWorkshops.includes(r.workshopId));
  });

  return c.json(
    filtered.map((u) => ({
      ...u,
      roles: (byUser.get(u.id) ?? []).map((r) => ({ role: r.role, workshopId: r.workshopId })),
    })),
  );
});

admin.post("/users/:id/approve", async (c) => {
  const me = meOf(c);
  const userId = c.req.param("id");
  const parsed = z
    .object({
      approved: z.boolean(),
      role: z.enum(["mechanic", "manager_mec", "dono_mec", "admin"]).optional(),
      cargoLabel: z.string().trim().max(80).optional(),
      workshopId: z.string().uuid().nullable().optional(),
    })
    .refine((v) => !v.approved || !!v.role || !!v.cargoLabel, { message: "Selecione o cargo ao aprovar" })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return c.json({ error: "Usuário não encontrado" }, 404);

  let workshopId = parsed.data.workshopId ?? target.requestedWorkshopId;
  if (!me.isAdmin) {
    if (workshopId && !me.manageWorkshops.includes(workshopId)) {
      return c.json({ error: "Você só pode liberar cadastros da sua mecânica" }, 403);
    }
    workshopId = workshopId && me.manageWorkshops.includes(workshopId) ? workshopId : me.manageWorkshops[0] ?? workshopId;
  }
  const cargoLabel = parsed.data.cargoLabel || cargoFromSystemRole(parsed.data.role);
  const role = parsed.data.role === "admin" ? "admin" : parsed.data.cargoLabel ? systemRoleFromCargo(cargoLabel) : parsed.data.role;
  if (parsed.data.approved && role === "admin" && !me.isOwner) {
    return c.json({ error: "Apenas o owner pode promover admin" }, 403);
  }
  if (parsed.data.approved && role === "dono_mec" && !me.isAdmin) {
    return c.json({ error: "Apenas admin pode nomear dono da mecânica" }, 403);
  }
  if (!me.isAdmin && !me.donoWorkshops.includes(workshopId ?? "") && role === "dono_mec") {
    return c.json({ error: "Gerente não pode alterar o proprietário" }, 403);
  }
  if (!canApprove(me, workshopId)) {
    return c.json({ error: "Você só pode liberar cadastros da sua mecânica" }, 403);
  }
  if (
    workshopId &&
    !me.isAdmin &&
    !me.donoWorkshops.includes(workshopId) &&
    (await userIsWorkshopDono(userId, workshopId))
  ) {
    return c.json({ error: "Gerente não pode excluir ou alterar o proprietário" }, 403);
  }

  await db.update(users).set({ approved: parsed.data.approved }).where(eq(users.id, userId));

  if (!parsed.data.approved && workshopId) {
    await db
      .update(employees)
      .set({ status: "inactive" })
      .where(and(eq(employees.userId, userId), eq(employees.workshopId, workshopId)));
  }

  if (parsed.data.approved && role) {
    const scoped = role !== "admin";
    if (scoped && !workshopId) return c.json({ error: "Selecione a mecânica" }, 400);

    const existing = await db
      .select()
      .from(userRoles)
      .where(
        scoped
          ? and(eq(userRoles.userId, userId), eq(userRoles.role, role), eq(userRoles.workshopId, workshopId!))
          : and(eq(userRoles.userId, userId), eq(userRoles.role, role)),
      )
      .limit(1);
    if (existing.length === 0) {
      await db.insert(userRoles).values({
        userId,
        role,
        workshopId: scoped ? workshopId : null,
      });
    }

    if (workshopId) {
      const [ws] = await db.select().from(workshops).where(eq(workshops.id, workshopId)).limit(1);
      const [emp] = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.workshopId, workshopId),
            or(eq(employees.userId, target.id), eq(employees.discordId, target.discordId)),
          ),
        )
        .limit(1);
      const roleLabel = cargoLabel || cargoFromSystemRole(role);
      if (!emp && ws) {
        await db.insert(employees).values({
          userId: target.id,
          workshopId,
          name: target.displayName || target.username,
          discordId: target.discordId,
          roleLabel,
          status: "active",
        });
      } else if (emp) {
        await db
          .update(employees)
          .set({ userId: target.id, status: "active", roleLabel })
          .where(eq(employees.id, emp.id));
      }
    }
  }

  await audit({
    workshopId,
    actorId: me.id,
    actorName: actorName(me),
    action: parsed.data.approved ? "user.approve" : "user.revoke",
    summary: parsed.data.approved
      ? `Liberou ${target.username} como ${role} (${cargoLabel})`
      : `Revogou ${target.username}`,
    payload: { userId: target.id, role, cargoLabel, workshopId },
  });
  return c.json({ ok: true });
});

admin.post("/users/:id/access", async (c) => {
  const me = meOf(c);
  const userId = c.req.param("id");
  const parsed = z
    .object({
      role: z.enum(["mechanic", "manager_mec", "dono_mec", "admin"]),
      workshopId: z.string().uuid().nullable().optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Selecione cargo e mecânica" }, 400);

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return c.json({ error: "Usuário não encontrado" }, 404);
  if (target.username === "owner" || target.discordId === "owner-seed") {
    return c.json({ error: "Não dá para alterar o owner" }, 403);
  }

  let workshopId = parsed.data.workshopId ?? target.requestedWorkshopId;
  if (!me.isAdmin) {
    if (workshopId && !me.manageWorkshops.includes(workshopId)) {
      return c.json({ error: "Sem permissão nesta mecânica" }, 403);
    }
    workshopId = workshopId && me.manageWorkshops.includes(workshopId) ? workshopId : me.manageWorkshops[0] ?? workshopId;
  }
  if (parsed.data.role === "admin" && !me.isOwner) return c.json({ error: "Apenas o owner pode promover admin" }, 403);
  if (parsed.data.role === "dono_mec" && !me.isAdmin) return c.json({ error: "Apenas admin pode nomear dono" }, 403);
  if (!me.isAdmin && workshopId && !me.donoWorkshops.includes(workshopId) && parsed.data.role === "dono_mec") {
    return c.json({ error: "Gerente não pode alterar o proprietário" }, 403);
  }
  if (workshopId && !me.isAdmin && !me.donoWorkshops.includes(workshopId) && (await userIsWorkshopDono(userId, workshopId))) {
    return c.json({ error: "Gerente não pode excluir ou alterar o proprietário" }, 403);
  }
  if (!canApprove(me, workshopId)) return c.json({ error: "Sem permissão nesta mecânica" }, 403);

  const scoped = parsed.data.role !== "admin";
  if (scoped && !workshopId) return c.json({ error: "Selecione a mecânica" }, 400);

  await db.update(users).set({ approved: true, requestedWorkshopId: workshopId ?? target.requestedWorkshopId }).where(eq(users.id, userId));
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  await db.insert(userRoles).values({
    userId,
    role: parsed.data.role,
    workshopId: scoped ? workshopId : null,
  });

  if (workshopId) {
    const emps = await db.select().from(employees).where(eq(employees.userId, userId));
    for (const emp of emps) {
      if (emp.workshopId !== workshopId) {
        await db.update(employees).set({ status: "inactive" }).where(eq(employees.id, emp.id));
      }
    }
    const [emp] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.workshopId, workshopId), eq(employees.discordId, target.discordId)))
      .limit(1);
    const roleLabel =
      parsed.data.role === "dono_mec" ? "Proprietario" : parsed.data.role === "manager_mec" ? "Gerente" : "Mecânico";
    if (!emp) {
      await db.insert(employees).values({
        userId: target.id,
        workshopId,
        name: target.displayName || target.username,
        discordId: target.discordId,
        roleLabel,
        status: "active",
      });
    } else {
      await db.update(employees).set({ userId: target.id, status: "active", roleLabel }).where(eq(employees.id, emp.id));
    }
  }

  return c.json({ ok: true });
});

admin.post("/users/:id/password", async (c) => {
  const me = meOf(c);
  if (!me.isOwner) return c.json({ error: "Apenas o owner pode redefinir senha" }, 403);

  const userId = c.req.param("id");
  const parsed = z.object({ password: z.string().min(8).max(72) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Senha deve ter entre 8 e 72 caracteres" }, 400);

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return c.json({ error: "Usuário não encontrado" }, 404);

  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, userId));

  await audit({
    workshopId: target.requestedWorkshopId,
    actorId: me.id,
    actorName: actorName(me),
    action: "user.password",
    summary: `Redefiniu a senha de ${target.username}`,
    payload: { userId: target.id },
  });
  return c.json({ ok: true });
});

admin.delete("/users/:id", async (c) => {
  const me = meOf(c);
  if (!me.isOwner) return c.json({ error: "Apenas o owner pode excluir usuário" }, 403);

  const userId = c.req.param("id");
  if (userId === me.id) return c.json({ error: "Você não pode excluir a própria conta" }, 403);

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return c.json({ error: "Usuário não encontrado" }, 404);
  if (target.username === "owner" || target.discordId === "owner-seed") {
    return c.json({ error: "Não dá para excluir o owner" }, 403);
  }

  const targetRoles = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  if (targetRoles.some((r) => r.role === "owner")) {
    return c.json({ error: "Não dá para excluir o owner" }, 403);
  }

  await db.update(employees).set({ userId: null, status: "inactive" }).where(eq(employees.userId, userId));
  await db.delete(users).where(eq(users.id, userId));

  await audit({
    workshopId: target.requestedWorkshopId,
    actorId: me.id,
    actorName: actorName(me),
    action: "user.delete",
    summary: `Excluiu a conta ${target.username}`,
    payload: { userId: target.id, discordId: target.discordId },
  });
  return c.json({ ok: true });
});

admin.get("/workshops", async (c) => {
  const me = meOf(c);
  if (!me.isAdmin && !me.isDonoMec && !me.isManager) return c.json({ error: "Acesso negado" }, 403);
  let rows = await db.select().from(workshops).orderBy(workshops.name);
  if (!me.isAdmin) {
    rows = rows.filter((w) => me.manageWorkshops.includes(w.id));
  }
  return c.json(rows);
});

admin.patch("/workshops/:id", async (c) => {
  const me = meOf(c);
  const id = c.req.param("id");
  if (!me.isAdmin && !me.manageWorkshops.includes(id)) {
    return c.json({ error: "Acesso negado" }, 403);
  }

  const parsed = z
    .object({
      guildId: z.string().trim().max(40).nullable().optional(),
      pontoChannelId: z.string().trim().max(64).nullable().optional(),
      farmChannelId: z.string().trim().max(64).nullable().optional(),
      logChannelId: z.string().trim().max(64).nullable().optional(),
      pontoAutoCloseHours: z.number().int().min(1).max(48).optional(),
      orderWebhookUrl: z.string().trim().max(500).nullable().optional(),
      hierarchyWebhookUrl: z.string().trim().max(500).nullable().optional(),
      staffEventsWebhookUrl: z.string().trim().max(500).nullable().optional(),
      blacklistWebhookUrl: z.string().trim().max(500).nullable().optional(),
      whitelistWebhookUrl: z.string().trim().max(500).nullable().optional(),
      pontoWebhookUrl: z.string().trim().max(500).nullable().optional(),
      farmWebhookUrl: z.string().trim().max(500).nullable().optional(),
      farmWeeklyGoal: z.number().int().min(0).max(1_000_000).optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);

  const d = parsed.data;
  await db
    .update(workshops)
    .set({
      ...(d.guildId !== undefined ? { guildId: d.guildId || null } : {}),
      ...(d.pontoChannelId !== undefined ? { pontoChannelId: d.pontoChannelId || null } : {}),
      ...(d.farmChannelId !== undefined ? { farmChannelId: d.farmChannelId || null } : {}),
      ...(d.logChannelId !== undefined ? { logChannelId: d.logChannelId || null } : {}),
      ...(d.pontoAutoCloseHours !== undefined ? { pontoAutoCloseHours: d.pontoAutoCloseHours } : {}),
      ...(d.orderWebhookUrl !== undefined ? { orderWebhookUrl: d.orderWebhookUrl || null } : {}),
      ...(d.hierarchyWebhookUrl !== undefined ? { hierarchyWebhookUrl: d.hierarchyWebhookUrl || null } : {}),
      ...(d.staffEventsWebhookUrl !== undefined ? { staffEventsWebhookUrl: d.staffEventsWebhookUrl || null } : {}),
      ...(d.blacklistWebhookUrl !== undefined ? { blacklistWebhookUrl: d.blacklistWebhookUrl || null } : {}),
      ...(d.whitelistWebhookUrl !== undefined ? { whitelistWebhookUrl: d.whitelistWebhookUrl || null } : {}),
      ...(d.pontoWebhookUrl !== undefined ? { pontoWebhookUrl: d.pontoWebhookUrl || null } : {}),
      ...(d.farmWebhookUrl !== undefined ? { farmWebhookUrl: d.farmWebhookUrl || null } : {}),
      ...(d.farmWeeklyGoal !== undefined ? { farmWeeklyGoal: d.farmWeeklyGoal } : {}),
    })
    .where(eq(workshops.id, id));

  const [row] = await db.select().from(workshops).where(eq(workshops.id, id)).limit(1);
  return c.json(row);
});
