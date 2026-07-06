import type { NextFunction, Request, Response } from "express";
import multer from "multer";

/** Shared multer instance for in-memory image uploads (reused by every route). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per image
});

/**
 * Multer instance for uploads that include an audio track. Audio for a multi-
 * minute template can be large, so allow a much higher per-file size.
 */
export const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB (covers long WAV/MP3 tracks)
});

/**
 * Multer instance for template-block uploads, which may include a raw video the
 * admin wants to use as-is (instead of an AI-generated clip). Videos can be much
 * larger than images, so allow a higher per-file size.
 */
export const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB (covers uploaded video clips)
});

/**
 * Express error-handling middleware that turns multer failures (e.g. a file that
 * exceeds the size limit) into a clean 400 JSON response instead of crashing the
 * request with an opaque stack trace.
 */
export function uploadErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Upload is too large."
        : err.code === "LIMIT_UNEXPECTED_FILE"
          ? `Unexpected file field "${err.field}".`
          : err.message;
    res.status(400).json({ error: message });
    return;
  }
  next(err);
}

/** Map an image mime type to a file extension (defaults to png). */
export const extFromMime = (mime: string): string => {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mime] ?? "png";
};

/** Encode an uploaded file as a base64 data URL (sent to providers that can't reach MinIO). */
export const toDataUrl = (file: Express.Multer.File): string =>
  `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
