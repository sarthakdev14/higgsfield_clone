/**
 * Unit tests for src/lib/uploads.ts
 *
 * Tests the pure helper functions (extFromMime, toDataUrl, uploadErrorHandler).
 * multer itself is a third-party library that doesn't need re-testing.
 */

import { describe, it, expect, vi } from "vitest";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { extFromMime, toDataUrl, uploadErrorHandler } from "../lib/uploads.js";

// ---------------------------------------------------------------------------
// extFromMime
// ---------------------------------------------------------------------------

describe("extFromMime", () => {
  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ])("maps %s to %s", (mime, ext) => {
    expect(extFromMime(mime)).toBe(ext);
  });

  it("falls back to 'png' for unknown mime types", () => {
    expect(extFromMime("application/octet-stream")).toBe("png");
    expect(extFromMime("video/mp4")).toBe("png");
    expect(extFromMime("")).toBe("png");
  });
});

// ---------------------------------------------------------------------------
// toDataUrl
// ---------------------------------------------------------------------------

describe("toDataUrl", () => {
  it("produces a valid base64 data URL from a multer file", () => {
    const content = "hello world";
    const file = {
      mimetype: "image/png",
      buffer: Buffer.from(content),
    } as Express.Multer.File;

    const dataUrl = toDataUrl(file);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);

    const encoded = dataUrl.split(",")[1];
    expect(Buffer.from(encoded, "base64").toString()).toBe(content);
  });

  it("handles an empty buffer", () => {
    const file = {
      mimetype: "image/jpeg",
      buffer: Buffer.alloc(0),
    } as Express.Multer.File;

    const dataUrl = toDataUrl(file);
    expect(dataUrl).toBe("data:image/jpeg;base64,");
  });
});

// ---------------------------------------------------------------------------
// uploadErrorHandler
// ---------------------------------------------------------------------------

function makeRes(): Partial<Response> & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as unknown as Partial<Response> & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("uploadErrorHandler", () => {
  it("returns a 400 with 'Upload is too large.' for LIMIT_FILE_SIZE errors", () => {
    const err = new multer.MulterError("LIMIT_FILE_SIZE");
    const res = makeRes();
    const next = vi.fn();

    uploadErrorHandler(err, {} as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Upload is too large." });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 with unexpected-field message for LIMIT_UNEXPECTED_FILE", () => {
    const err = new multer.MulterError("LIMIT_UNEXPECTED_FILE");
    err.field = "avatar";
    const res = makeRes();
    const next = vi.fn();

    uploadErrorHandler(err, {} as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].error).toContain("avatar");
  });

  it("uses the multer error message for other multer errors", () => {
    const err = new multer.MulterError("LIMIT_FILE_COUNT");
    const res = makeRes();
    const next = vi.fn();

    uploadErrorHandler(err, {} as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls next(err) for non-multer errors", () => {
    const err = new Error("Something else");
    const res = makeRes();
    const next = vi.fn();

    uploadErrorHandler(err, {} as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next(err) when err is not an Error object", () => {
    const res = makeRes();
    const next = vi.fn();

    uploadErrorHandler("raw string error", {} as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith("raw string error");
  });
});
