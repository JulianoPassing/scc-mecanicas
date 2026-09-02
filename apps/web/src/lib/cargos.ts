export const DEFAULT_CARGOS = [
  { label: "Proprietario", nicknamePrefix: "[PROP]", discordRoleId: null as string | null },
  { label: "Gerente", nicknamePrefix: "[GER]", discordRoleId: null },
  { label: "Supervisor da Oficina", nicknamePrefix: "[SUP]", discordRoleId: null },
  { label: "Preparador", nicknamePrefix: "[PREP]", discordRoleId: null },
  { label: "Mecânico", nicknamePrefix: "[MEC]", discordRoleId: null },
  { label: "Auxiliar", nicknamePrefix: "[AUX]", discordRoleId: null },
  { label: "Aprendiz", nicknamePrefix: "[APR]", discordRoleId: null },
];

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

export function cargoFromSystemRole(role?: string | null) {
  if (role === "dono_mec") return "Proprietario";
  if (role === "manager_mec") return "Gerente";
  return "Mecânico";
}

export function cargoFromUserRoles(
  roles: { role: string; workshopId: string | null }[] | undefined,
  workshopId?: string,
) {
  const list = roles ?? [];
  const shop = workshopId ? list.filter((r) => !r.workshopId || r.workshopId === workshopId) : list;
  if (shop.some((r) => r.role === "dono_mec")) return "Proprietario";
  if (shop.some((r) => r.role === "manager_mec")) return "Gerente";
  return cargoFromSystemRole(shop.find((r) => r.role === "mechanic")?.role);
}

export function isGerenteCargo(label?: string | null) {
  const n = normCargo(label);
  return n === "gerente" || n === "manager" || n === "manager_mec";
}

export function cargoRank(label?: string | null) {
  const n = normCargo(label);
  const idx = DEFAULT_CARGOS.findIndex((c) => normCargo(c.label) === n);
  return idx === -1 ? DEFAULT_CARGOS.length : idx;
}

export function groupTeamByCargo<T extends { roleLabel?: string | null }>(rows: T[]) {
  const groups = DEFAULT_CARGOS.map((c) => ({ label: c.label, members: [] as T[] }));
  const leftover: T[] = [];
  for (const row of rows) {
    const i = cargoRank(row.roleLabel);
    if (i < DEFAULT_CARGOS.length) groups[i].members.push(row);
    else leftover.push(row);
  }
  return { groups, leftover };
}
