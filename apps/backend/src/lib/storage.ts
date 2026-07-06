import { randomUUID } from "node:crypto";
import { Client as MinioClient } from "minio";
import { env } from "../env.js";

export const minio = new MinioClient({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

const BUCKET = env.MINIO_BUCKET;

/** Anonymous read-only policy so objects are publicly fetchable by key. */
const publicReadPolicy = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { AWS: ["*"] },
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${BUCKET}/*`],
    },
  ],
});

/**
 * Base URL objects are publicly served from. The port is omitted when it's the
 * protocol default (443 for https, 80 for http) so that pointing the MinIO_*
 * envs at a hosted S3 endpoint (e.g. DigitalOcean Spaces:
 * `MINIO_FRONTEND_ENDPOINT=blr1.digitaloceanspaces.com`, `MINIO_USE_SSL=true`,
 * `MINIO_PORT=443`) yields clean URLs like
 * `https://blr1.digitaloceanspaces.com/<bucket>/<key>`.
 */
const PROTOCOL = env.MINIO_USE_SSL ? "https" : "http";
const IS_DEFAULT_PORT =
  (env.MINIO_USE_SSL && env.MINIO_PORT === 443) ||
  (!env.MINIO_USE_SSL && env.MINIO_PORT === 80);
const HOST = IS_DEFAULT_PORT
  ? env.MINIO_FRONTEND_ENDPOINT
  : `${env.MINIO_FRONTEND_ENDPOINT}:${env.MINIO_PORT}`;
const PUBLIC_BASE = `${PROTOCOL}://${HOST}/${BUCKET}`;

/** Ensure the bucket exists and allows anonymous reads. Safe to call repeatedly. */
export async function ensureBucket(): Promise<void> {
  const exists = await minio.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await minio.makeBucket(BUCKET);
    console.log(`📦 Created object-store bucket "${BUCKET}"`);
  }
  await minio.setBucketPolicy(BUCKET, publicReadPolicy);
}

/** Upload a buffer and return the object key. */
export async function uploadBuffer(
  buffer: Buffer,
  contentType: string,
  prefix = "uploads",
  extension?: string,
): Promise<string> {
  const ext = extension ? `.${extension.replace(/^\./, "")}` : "";
  const key = `${prefix}/${randomUUID()}${ext}`;
  await minio.putObject(BUCKET, key, buffer, buffer.length, {
    "Content-Type": contentType,
    // Mark each object public-read so it's fetchable by its permanent URL. On
    // hosted stores (e.g. DigitalOcean Spaces) a bucket-wide public policy often
    // can't be set with a scoped key, so we grant read per object instead. On
    // local MinIO this is harmless (the bucket policy already allows reads).
    "x-amz-acl": "public-read",
  });
  return key;
}

/** Build a public, permanent URL for a stored object (bucket is anonymous-read). */
export function getPublicUrl(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${PUBLIC_BASE}/${encoded}`;
}

/** Download an object into a Buffer. */
export async function downloadObject(key: string): Promise<Buffer> {
  const stream = await minio.getObject(BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
