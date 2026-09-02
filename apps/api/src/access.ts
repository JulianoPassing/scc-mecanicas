import type { Context } from "hono";
import { currentUserId } from "./routes/auth.js";
import { loadMe } from "./me.js";

export async function requireMe(c: Context) {
  const id = await currentUserId(c);
  if (!id) return null;
  return loadMe(id);
}

export function canAccessWorkshop(
  me: NonNullable<Awaited<ReturnType<typeof loadMe>>>,
  workshopId: string,
) {
  return me.isAdmin || me.accessibleWorkshopIds.includes(workshopId);
}

export function canManageWorkshop(
  me: NonNullable<Awaited<ReturnType<typeof loadMe>>>,
  workshopId: string,
) {
  if (me.isAdmin) return true;
  return me.manageWorkshops.includes(workshopId);
}

export function canOwnWorkshop(
  me: NonNullable<Awaited<ReturnType<typeof loadMe>>>,
  workshopId: string,
) {
  if (me.isAdmin) return true;
  if (me.donoWorkshops.includes(workshopId)) return true;
  if (me.roles.some((r) => r.role === "dono_mec" && (r.workshopId === workshopId || (!r.workshopId && me.requestedWorkshopId === workshopId)))) {
    return true;
  }
  return false;
}
