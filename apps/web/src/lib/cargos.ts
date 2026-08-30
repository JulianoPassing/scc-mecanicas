export const DEFAULT_CARGOS = [
  { label: "Proprietario", nicknamePrefix: "[PROP]", discordRoleId: null as string | null },
  { label: "Gerente", nicknamePrefix: "[GER]", discordRoleId: null },
  { label: "Supervisor da Oficina", nicknamePrefix: "[SUP]", discordRoleId: null },
  { label: "Preparador", nicknamePrefix: "[PREP]", discordRoleId: null },
  { label: "Mecânico", nicknamePrefix: "[MEC]", discordRoleId: null },
  { label: "Auxiliar", nicknamePrefix: "[AUX]", discordRoleId: null },
  { label: "Aprendiz", nicknamePrefix: "[APR]", discordRoleId: null },
];

export function isDonoCargo(label?: string | null) {
  const n = (label ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
  return n === "proprietario" || n === "dono" || n === "dono da mecanica" || n === "dono_mec";
}
