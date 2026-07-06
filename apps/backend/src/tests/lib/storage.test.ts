/**
 * Unit tests for src/lib/storage.ts
 *
 * MinIO client and env are fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../env.js", () => ({
  env: {
    MINIO_ENDPOINT: "localhost",
    MINIO_FRONTEND_ENDPOINT: "localhost",
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: "minioadmin",
    MINIO_SECRET_KEY: "minioadmin",
    MINIO_BUCKET: "test-bucket",
  },
}));

const mockPutObject = vi.fn().mockResolvedValue(undefined);
const mockBucketExists = vi.fn().mockResolvedValue(true);
const mockMakeBucket = vi.fn().mockResolvedValue(undefined);
const mockSetBucketPolicy = vi.fn().mockResolvedValue(undefined);
const mockGetObject = vi.fn();

vi.mock("minio", () => ({
  Client: vi.fn().mockImplementation(() => ({
    putObject: mockPutObject,
    bucketExists: mockBucketExists,
    makeBucket: mockMakeBucket,
    setBucketPolicy: mockSetBucketPolicy,
    getObject: mockGetObject,
  })),
}));

import { uploadBuffer, getPublicUrl, ensureBucket, downloadObject } from "../lib/storage.js";

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockBucketExists.mockResolvedValue(true);
  mockPutObject.mockResolvedValue(undefined);
  mockMakeBucket.mockResolvedValue(undefined);
  mockSetBucketPolicy.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// getPublicUrl
// ---------------------------------------------------------------------------

describe("getPublicUrl", () => {
  it("builds a correct URL from a simple key", () => {
    const url = getPublicUrl("videos/abc.mp4");
    expect(url).toBe("http://localhost:9000/test-bucket/videos/abc.mp4");
  });

  it("percent-encodes UUID segments in the path", () => {
    const key = "inputs/550e8400-e29b-41d4-a716-446655440000.png";
    const url = getPublicUrl(key);
    // Each segment is encoded, but hyphens and dots are safe and stay as-is.
    expect(url).toContain("/test-bucket/inputs/");
    expect(url).toContain(".png");
  });
});

// ---------------------------------------------------------------------------
// uploadBuffer
// ---------------------------------------------------------------------------

describe("uploadBuffer", () => {
  it("calls minio.putObject and returns a key with the correct prefix and extension", async () => {
    const buf = Buffer.from("test-image-data");
    const key = await uploadBuffer(buf, "image/png", "inputs", "png");

    expect(mockPutObject).toHaveBeenCalledOnce();
    expect(key).toMatch(/^inputs\/[0-9a-f-]+\.png$/);
  });

  it("omits the extension dot when passed without leading dot", async () => {
    const buf = Buffer.from("data");
    const key = await uploadBuffer(buf, "image/jpeg", "uploads", "jpg");
    expect(key).toMatch(/\.jpg$/);
  });

  it("uses default prefix 'uploads' when none is provided", async () => {
    const buf = Buffer.from("data");
    const key = await uploadBuffer(buf, "image/png");
    expect(key).toMatch(/^uploads\//);
  });

  it("produces a key without an extension when none is provided", async () => {
    const buf = Buffer.from("data");
    const key = await uploadBuffer(buf, "image/png", "uploads");
    // No extension appended
    expect(key).not.toMatch(/\..+$/);
  });
});

// ---------------------------------------------------------------------------
// ensureBucket
// ---------------------------------------------------------------------------

describe("ensureBucket", () => {
  it("does not create the bucket when it already exists", async () => {
    mockBucketExists.mockResolvedValue(true);
    await ensureBucket();
    expect(mockMakeBucket).not.toHaveBeenCalled();
    expect(mockSetBucketPolicy).toHaveBeenCalledOnce();
  });

  it("creates the bucket when it does not exist", async () => {
    mockBucketExists.mockResolvedValue(false);
    await ensureBucket();
    expect(mockMakeBucket).toHaveBeenCalledOnce();
    expect(mockSetBucketPolicy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// downloadObject
// ---------------------------------------------------------------------------

describe("downloadObject", () => {
  it("reads the stream and returns a concatenated Buffer", async () => {
    const chunks = [Buffer.from("hello "), Buffer.from("world")];
    const stream = Readable.from(chunks);
    mockGetObject.mockResolvedValue(stream);

    const result = await downloadObject("videos/test.mp4");

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe("hello world");
  });
});
