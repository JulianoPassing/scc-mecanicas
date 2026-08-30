import { and, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { employees, hierarchyRoles, userRoles, users } from "./db/schema.js";

export const DEFAULT_HIERARCHY = [
  { label: "Proprietario", nicknamePrefix: "[PROP]", discordRoleId: null, sortOrder: 0 },
  { label: "Gerente", nicknamePrefix: "[GER]", discordRoleId: null, sortOrder: 1 },
  { label: "Supervisor da Oficina", nicknamePrefix: "[SUP]", discordRoleId: null, sortOrder: 2 },
  { label: "Preparador", nicknamePrefix: "[PREP]", discordRoleId: null, sortOrder: 3 },
  { label: "Mecânico", nicknamePrefix: "[MEC]", discordRoleId: null, sortOrder: 4 },
  { label: "Auxiliar", nicknamePrefix: "[AUX]", discordRoleId: null, sortOrder: 5 },
  { label: "Aprendiz", nicknamePrefix: "[APR]", discordRoleId: null, sortOrder: 6 },
] as const;

function normCargo(label?: string | null) {
  return (label ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function isDonoCargo(label?: string | null) {
  const n = normCargo(label);
  return n === "proprietario" || n === "dono" || n === "dono da mecanica" || n === "dono_mec";
}

export function isGerenteCargo(label?: string | null) {
  const n = normCargo(label);
  return n === "gerente" || n === "manager" || n === "manager_mec";
}

export function cargoRank(label?: string | null) {
  const n = normCargo(label);
  const idx = DEFAULT_HIERARCHY.findIndex((r) => normCargo(r.label) === n);
  return idx === -1 ? DEFAULT_HIERARCHY.length : idx;
}

export function sortTeam<T extends { roleLabel?: string | null; name: string }>(rows: T[]) {
  return [...rows].sort((a, b) => cargoRank(a.roleLabel) - cargoRank(b.roleLabel) || a.name.localeCompare(b.name, "pt-BR"));
}

function digitsId(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

export function systemRoleFromCargo(label?: string | null): "dono_mec" | "manager_mec" | "mechanic" {
  if (isDonoCargo(label)) return "dono_mec";
  if (isGerenteCargo(label)) return "manager_mec";
  return "mechanic";
}

export function cargoFromSystemRole(role?: string | null) {
  if (role === "dono_mec") return "Proprietario";
  if (role === "manager_mec") return "Gerente";
  return "Mecânico";
}

export async function ensureWorkshopTeam(workshopId: string) {
  const roleRows = await db.select().from(userRoles).where(eq(userRoles.workshopId, workshopId));
  const teamUserIds = new Set(
    roleRows.filter((r) => r.role === "mechanic" || r.role === "manager_mec" || r.role === "dono_mec").map((r) => r.userId),
  );
  const requested = await db
    .select()
    .from(users)
    .where(and(eq(users.approved, true), eq(users.requestedWorkshopId, workshopId)));
  for (const u of requested) teamUserIds.add(u.id);

  const emps = await db.select().from(employees).where(eq(employees.workshopId, workshopId));
  const byUser = new Map(emps.filter((e) => e.userId).map((e) => [e.userId as string, e]));
  const byDiscord = new Map(emps.map((e) => [digitsId(e.discordId), e]).filter(([k]) => k) as [string, (typeof emps)[0]][]);

  for (const userId of teamUserIds) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.approved) continue;
    const shopRoles = roleRows.filter((r) => r.userId === userId);
    const inferred = shopRoles.some((r) => r.role === "dono_mec")
      ? "Proprietario"
      : shopRoles.some((r) => r.role === "manager_mec")
        ? "Gerente"
        : "Mecânico";
    const emp = (user.id && byUser.get(user.id)) || byDiscord.get(digitsId(user.discordId));
    if (!emp) {
      const [created] = await db
        .insert(employees)
        .values({
          userId: user.id,
          workshopId,
          name: user.displayName || user.username,
          discordId: digitsId(user.discordId) || user.discordId,
          roleLabel: inferred,
          status: "active",
        })
        .returning();
      byUser.set(user.id, created);
      const did = digitsId(created.discordId);
      if (did) byDiscord.set(did, created);
      continue;
    }
    const patch: { userId: string; status: string; roleLabel?: string | null } = { userId: user.id, status: "active" };
    if (!emp.roleLabel) patch.roleLabel = inferred;
    if (emp.userId !== user.id || emp.status !== "active" || !emp.roleLabel) {
      await db.update(employees).set(patch).where(eq(employees.id, emp.id));
    }
  }
}

export async function listWorkshopTeam(workshopId: string) {
  await seedHierarchy(workshopId);
  await ensureWorkshopTeam(workshopId);
  const rows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workshopId, workshopId), eq(employees.status, "active")));
  return sortTeam(rows);
}

export async function syncEmployeeSystemRole(
  emp: { userId: string | null },
  workshopId: string,
  roleLabel: string | null,
  opts?: { allowChangeDono?: boolean },
) {
  if (!emp.userId) return;
  const existing = await db.select().from(userRoles).where(eq(userRoles.userId, emp.userId));
  const hasDono = existing.some((r) => r.role === "dono_mec" && r.workshopId === workshopId);
  const hasMgr = existing.some((r) => r.role === "manager_mec" && r.workshopId === workshopId);

  if (isDonoCargo(roleLabel)) {
    if (!hasDono && opts?.allowChangeDono) {
      await db.insert(userRoles).values({ userId: emp.userId, role: "dono_mec", workshopId });
    }
    if (hasMgr) {
      await db
        .delete(userRoles)
        .where(and(eq(userRoles.userId, emp.userId), eq(userRoles.role, "manager_mec"), eq(userRoles.workshopId, workshopId)));
    }
    return;
  }

  if (hasDono && opts?.allowChangeDono) {
    await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, emp.userId), eq(userRoles.role, "dono_mec"), eq(userRoles.workshopId, workshopId)));
  }

  if (isGerenteCargo(roleLabel)) {
    if (!hasMgr) {
      await db.insert(userRoles).values({ userId: emp.userId, role: "manager_mec", workshopId });
    }
    return;
  }

  if (hasMgr) {
    await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, emp.userId), eq(userRoles.role, "manager_mec"), eq(userRoles.workshopId, workshopId)));
  }
}

export async function seedHierarchy(workshopId: string) {
  const existing = await db.select().from(hierarchyRoles).where(eq(hierarchyRoles.workshopId, workshopId)).limit(1);
  if (existing.length) return;
  await db.insert(hierarchyRoles).values(DEFAULT_HIERARCHY.map((r) => ({ ...r, workshopId })));
}

export async function employeeIsWorkshopDono(emp: { userId: string | null; roleLabel: string | null }, workshopId: string) {
  if (isDonoCargo(emp.roleLabel)) return true;
  if (!emp.userId) return false;
  const roles = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, emp.userId), eq(userRoles.role, "dono_mec"), eq(userRoles.workshopId, workshopId)))
    .limit(1);
  return roles.length > 0;
}

export async function userIsWorkshopDono(userId: string, workshopId: string) {
  const roles = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "dono_mec"), eq(userRoles.workshopId, workshopId)))
    .limit(1);
  if (roles.length) return true;
  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.userId, userId), eq(employees.workshopId, workshopId)))
    .limit(1);
  return !!(emp && isDonoCargo(emp.roleLabel));
}
