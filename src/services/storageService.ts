import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Storage } from "@google-cloud/storage";
import { env } from "../config/env";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const GCP_V4_MAX_SIGNED_URL_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeFileName = (fileName: string) => {
  const ext = path.extname(fileName || "");
  const base = path
    .basename(fileName || "file", ext)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);

  const safeBase = base || "file";
  return `${Date.now()}-${safeBase}-${randomUUID().slice(0, 8)}${ext}`;
};

const normalizeFolder = (folder: string) =>
  folder
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

const parsedCredentialJson = (() => {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim()) {
    return null;
  }

  try {
    return JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    return null;
  }
})();

const hasGcpEnv = Boolean(env.GCP_PROJECT_ID && env.GCP_BUCKET_NAME);

const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS
  ? path.resolve(process.cwd(), env.GOOGLE_APPLICATION_CREDENTIALS)
  : "";

const hasCredentialsFile = Boolean(credentialsPath && fs.existsSync(credentialsPath));
const hasCredentialsJson = Boolean(parsedCredentialJson);

const gcpEnabled = env.STORAGE_PROVIDER === "gcp" && hasGcpEnv && (hasCredentialsFile || hasCredentialsJson);

if (!gcpEnabled) {
  throw new Error(
    "Google Cloud Storage is required but not fully configured. Check STORAGE_PROVIDER, GCP_PROJECT_ID, GCP_BUCKET_NAME, and credentials."
  );
}

const gcpCredentials = hasCredentialsJson ? (parsedCredentialJson as Record<string, unknown>) : undefined;

const storage = gcpEnabled
  ? new Storage({
      projectId: env.GCP_PROJECT_ID,
      ...(hasCredentialsFile ? { keyFilename: credentialsPath } : {}),
      ...(gcpCredentials ? { credentials: gcpCredentials } : {}),
    })
  : null;

const bucket = storage && env.GCP_BUCKET_NAME ? storage.bucket(env.GCP_BUCKET_NAME) : null;

export const storageRuntime = {
  mode: gcpEnabled ? "gcp" : "local",
  gcpEnabled,
  bucketName: env.GCP_BUCKET_NAME || null,
  projectId: env.GCP_PROJECT_ID || null,
};

export const uploadFile = async (
  buffer: Buffer,
  fileName: string,
  folder: string,
  mimeType: string
): Promise<string> => {
  const normalizedFolder = normalizeFolder(folder);
  const normalizedFileName = normalizeFileName(fileName);
  const filePath = `${normalizedFolder}/${normalizedFileName}`;

  if (!bucket) {
    throw new Error("Cloud storage bucket is not initialized.");
  }

  const file = bucket.file(filePath);
  await file.save(buffer, {
    resumable: false,
    contentType: mimeType,
    metadata: {
      cacheControl: "private, max-age=31536000",
    },
  });
  return filePath;
};

export const deleteFile = async (filePath: string): Promise<void> => {
  if (!filePath) return;

  if (!bucket) {
    throw new Error("Cloud storage bucket is not initialized.");
  }

  try {
    await bucket.file(filePath).delete();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("No such object")) {
      throw error;
    }
  }
};

export const getSignedUrl = async (filePath: string, expiresInMs: number = ONE_YEAR_MS): Promise<string> => {
  if (!filePath) return "";
  if (/^https?:\/\//i.test(filePath)) return filePath;

  if (!bucket) {
    throw new Error("Cloud storage bucket is not initialized.");
  }

  const safeExpiresInMs = Math.max(60 * 1000, Math.min(expiresInMs, GCP_V4_MAX_SIGNED_URL_MS));

  const [url] = await bucket.file(filePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + safeExpiresInMs,
  });
  return url;
};

export const getSignedUrls = async (filePaths: string[]): Promise<string[]> =>
  Promise.all(filePaths.map((filePath) => getSignedUrl(filePath)));

const isMissingObjectError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : "";
  return message.includes("No such object") || message.includes("404");
};

export const readTextFile = async (filePath: string): Promise<string | null> => {
  if (!filePath) return null;

  if (!bucket) {
    throw new Error("Cloud storage bucket is not initialized.");
  }

  try {
    const [buffer] = await bucket.file(filePath).download();
    return buffer.toString("utf8");
  } catch (error: unknown) {
    if (isMissingObjectError(error)) {
      return null;
    }

    throw error;
  }
};

export const writeTextFile = async (
  filePath: string,
  content: string,
  contentType: string = "application/json"
): Promise<void> => {
  if (!filePath) {
    throw new Error("filePath is required");
  }

  if (!bucket) {
    throw new Error("Cloud storage bucket is not initialized.");
  }

  await bucket.file(filePath).save(Buffer.from(content, "utf8"), {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: "no-store",
    },
  });
};

export const storageService = {
  uploadFile,
  deleteFile,
  getSignedUrl,
  getSignedUrls,
  readTextFile,
  writeTextFile,
};
