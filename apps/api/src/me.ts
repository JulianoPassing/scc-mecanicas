import { eq, or } from "drizzle-orm";
import { db } from "./db/index.js";
import { employees, userRoles, users, workshops } from "./db/schema.js";
import { isDonoCargo, isGerenteCargo } from "./hierarchy.js";

export type Role = "owner" | "admin" | "dono_mec" | "manager_mec" | "mechanic";

export async function loadMe(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const roles = await db.select().from(userRoles).where(eq(userRoles.userId, user.id));
  const isOwner = roles.some((r) => r.role === "owner");
  const isAdmin = isOwner || roles.some((r) => r.role === "admin");
  const donoWorkshops = roles
    .filter((r) => r.role === "dono_mec")
    .map((r) => r.workshopId || user.requestedWorkshopId)
    .filter(Boolean) as string[];
  const managerWorkshops = roles
    .filter((r) => r.role === "manager_mec")
    .map((r) => r.workshopId || user.requestedWorkshopId)
    .filter(Boolean) as string[];

  const empRows = await db
    .select({
      id: employees.id,
      name: employees.name,
      workshopId: employees.workshopId,
      workshopSlug: workshops.slug,
      workshopName: workshops.name,
      status: employees.status,
      roleLabel: employees.roleLabel,
    })
    .from(employees)
    .innerJoin(workshops, eq(employees.workshopId, workshops.id))
    .where(or(eq(employees.userId, user.id), eq(employees.discordId, user.discordId)));

  const donoFromTeam = empRows
    .filter((e) => e.status === "active" && isDonoCargo(e.roleLabel))
    .map((e) => e.workshopId);
  const gerFromTeam = empRows
    .filter((e) => e.status === "active" && isGerenteCargo(e.roleLabel))
    .map((e) => e.workshopId);
  const donoWorkshopsAll = [...new Set([...donoWorkshops, ...donoFromTeam])];
  const managerWorkshopsAll = [...new Set([...managerWorkshops, ...gerFromTeam])];
  const isDonoMec = donoWorkshopsAll.length > 0;
  const isManager = managerWorkshopsAll.length > 0;
  const manageWorkshops = [...new Set([...donoWorkshopsAll, ...managerWorkshopsAll])];

  const workshopIds = new Set<string>();
  if (isAdmin) {
    const all = await db.select({ id: workshops.id }).from(workshops);
    for (const w of all) workshopIds.add(w.id);
  } else {
    for (const r of roles) if (r.workshopId) workshopIds.add(r.workshopId);
    for (const e of empRows) workshopIds.add(e.workshopId);
  }

  return {
    id: user.id,
    username: user.username,
    discordId: user.discordId,
    displayName: user.displayName,
    approved: user.approved,
    requestedWorkshopId: user.requestedWorkshopId,
    isOwner,
    isAdmin,
    isDonoMec,
    isManager,
    donoWorkshops: donoWorkshopsAll,
    managerWorkshops: managerWorkshopsAll,
    manageWorkshops,
    roles: roles.map((r) => ({ role: r.role as Role, workshopId: r.workshopId })),
    employee: empRows[0] ?? null,
    employees: empRows,
    accessibleWorkshopIds: [...workshopIds],
  };
}

export function canApprove(me: NonNullable<Awaited<ReturnType<typeof loadMe>>>, workshopId: string | null) {
  if (me.isAdmin) return true;
  if (workshopId && me.manageWorkshops.includes(workshopId)) return true;
  return false;
}
