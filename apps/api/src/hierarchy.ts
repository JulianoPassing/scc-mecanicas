import { and, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { employees, hierarchyRoles, userRoles } from "./db/schema.js";

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
