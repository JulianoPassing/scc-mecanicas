import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import { postFarmImageToDiscord } from "./discord.js";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../data/uploads/farm");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const MAX_BYTES = 8 * 1024 * 1024;

export function farmProofDir() {
  return dir;
}

export function proofPublicUrl(filename: string) {
  return `${env.publicUrl.replace(/\/$/, "")}/uploads/farm/${filename}`;
}

export function mimeForProof(filename: string) {
  return MIME[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

function extFrom(name: string, contentType: string) {
  const fromName = extname(name || "").toLowerCase();
  if (fromName && MIME[fromName]) return fromName;
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  return ".png";
}

function extFromMagic(bytes: Buffer, name: string, contentType: string) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ".png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return ".gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return ".webp";
  return extFrom(name, contentType);
}

function assertFarmImage(input: { bytes: Buffer; filename?: string; contentType?: string }) {
  if (input.bytes.length < 32 || input.bytes.length > MAX_BYTES) {
    throw new Error("Print inválido (tamanho)");
  }
  const type = (input.contentType || "").toLowerCase();
  if (type && !type.startsWith("image/")) throw new Error("Envie uma imagem");
  const ext = extFromMagic(input.bytes, input.filename || "", type);
  const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  if (!allowed.includes(ext)) throw new Error("Envie uma imagem (png, jpg, webp ou gif)");
  const looksLikeImage =
    (input.bytes[0] === 0x89 && input.bytes[1] === 0x50) ||
    (input.bytes[0] === 0xff && input.bytes[1] === 0xd8) ||
    (input.bytes[0] === 0x47 && input.bytes[1] === 0x49) ||
    (input.bytes[0] === 0x52 && input.bytes[1] === 0x49);
  if (!looksLikeImage) throw new Error("Arquivo não é uma imagem válida");
  return ext === ".jpeg" ? ".jpg" : ext;
}

export async function saveFarmProof(input: {
  bytes: Buffer;
  filename?: string;
  contentType?: string;
}): Promise<{ filename: string; url: string }> {
  const ext = assertFarmImage(input);
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}${ext}`;
  await writeFile(join(dir, filename), input.bytes);
  return { filename, url: proofPublicUrl(filename) };
}

export async function storeFarmProof(input: {
  bytes: Buffer;
  filename?: string;
  contentType?: string;
  webhookUrl?: string | null;
  workshop?: { name: string; primaryColor?: string | null };
  embed: {
    title: string;
    description?: string;
    fields?: { name: string; value: string; inline?: boolean }[];
    color?: number;
  };
}): Promise<{ url: string; postedToDiscord: boolean }> {
  assertFarmImage(input);
  const filename = input.filename || `print${extFromMagic(input.bytes, input.filename || "", input.contentType || "")}`;
  const discordUrl = await postFarmImageToDiscord(
    input.webhookUrl,
    { bytes: input.bytes, filename, contentType: input.contentType || "image/png" },
    input.embed,
    input.workshop,
  );
  if (discordUrl) return { url: discordUrl, postedToDiscord: true };
  const local = await saveFarmProof(input);
  return { url: local.url, postedToDiscord: false };
}

export async function fileFromBody(file: unknown): Promise<{ bytes: Buffer; filename: string; contentType: string } | null> {
  if (!file || typeof file !== "object") return null;
  if (file instanceof Blob) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = "name" in file && typeof (file as File).name === "string" ? (file as File).name : "print.png";
    const contentType = file.type || "image/png";
    return { bytes, filename, contentType };
  }
  return null;
}
