import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

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

export async function saveFarmProof(input: {
  bytes: Buffer;
  filename?: string;
  contentType?: string;
}): Promise<{ filename: string; url: string }> {
  if (input.bytes.length < 32 || input.bytes.length > MAX_BYTES) {
    throw new Error("Print inválido (tamanho)");
  }
  const type = (input.contentType || "").toLowerCase();
  if (type && !type.startsWith("image/")) throw new Error("Envie uma imagem");
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}${extFrom(input.filename || "", type)}`;
  await writeFile(join(dir, filename), input.bytes);
  return { filename, url: proofPublicUrl(filename) };
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
