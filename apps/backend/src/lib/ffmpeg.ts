import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Run ffmpeg with the given args, rejecting on a non-zero exit code. */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("ffmpeg is not installed or not on PATH (required to stitch template videos)."));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export interface StitchOptions {
  /** Output width in pixels (clips are scaled + padded to fit). Defaults to 1280. */
  width?: number;
  /** Output height in pixels. Defaults to 720. */
  height?: number;
  /** Output frame rate. Defaults to 30. */
  fps?: number;
}

/**
 * One slice of the output timeline: either a trimmed portion of a clip
 * (`clip` = index into the clips array, taken from `inPoint` for `length`
 * seconds) or a black gap (`clip` = null).
 */
export interface TimelineSegment {
  clip: number | null;
  inPoint: number;
  length: number;
}

/**
 * One positioned audio clip to mix into the output: the slice
 * `[inPoint, inPoint + length)` of `buffer`, delayed to begin at `startSec`.
 * Overlapping parts are summed together.
 */
export interface AudioPart {
  buffer: Buffer;
  startSec: number;
  inPoint: number;
  length: number;
}

/**
 * Compose an ordered list of timeline segments into a single mp4. Each segment
 * is a trimmed slice of one clip (or a black gap), normalised to a common size,
 * concatenated in order. Any number of positioned audio parts are then mixed
 * together (summed where they overlap) and laid over the video, padded with
 * silence / trimmed to match the video length.
 *
 * Segments that reuse the same clip each get their own decode input, so a clip
 * can appear in multiple non-adjacent slices (e.g. when an overlay hides its
 * middle).
 */
export async function stitchTimeline(
  clips: Buffer[],
  segments: TimelineSegment[],
  audioParts: AudioPart[],
  opts: StitchOptions = {},
): Promise<Buffer> {
  if (segments.length === 0) throw new Error("Cannot stitch zero segments.");

  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const fps = opts.fps ?? 30;

  const dir = await mkdtemp(join(tmpdir(), "tpl-stitch-"));
  try {
    const clipPaths: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const p = join(dir, `clip-${i}.mp4`);
      await writeFile(p, clips[i]!);
      clipPaths.push(p);
    }
    const audioPaths: string[] = [];
    for (let i = 0; i < audioParts.length; i++) {
      const p = join(dir, `audio-${i}.bin`);
      await writeFile(p, audioParts[i]!.buffer);
      audioPaths.push(p);
    }

    const scale = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`;

    // One decode input per clip-backed segment (lets a clip recur in several slices).
    // Each input is seeked at the demuxer level (`-ss`/`-t` before `-i`) so ffmpeg
    // jumps to the slice's in-point instead of decoding the clip from 0 every time
    // — a long base clip reused across many slices would otherwise be re-decoded
    // from the start for each slice, pegging CPU and buffering huge amounts of RAM.
    const inputArgs: string[] = [];
    const parts: string[] = [];
    const labels: string[] = [];
    let inputIdx = 0;
    segments.forEach((seg, k) => {
      const label = `seg${k}`;
      labels.push(`[${label}]`);
      if (seg.clip == null) {
        parts.push(
          `color=c=black:s=${width}x${height}:r=${fps}:d=${seg.length},format=yuv420p,setsar=1[${label}]`,
        );
      } else {
        inputArgs.push("-ss", String(seg.inPoint), "-t", String(seg.length), "-i", clipPaths[seg.clip]!);
        parts.push(
          `[${inputIdx}:v]setpts=PTS-STARTPTS,${scale}[${label}]`,
        );
        inputIdx++;
      }
    });
    parts.push(`${labels.join("")}concat=n=${segments.length}:v=1:a=0[outv]`);

    const mapArgs: string[] = ["-map", "[outv]"];

    // Each audio part: trim its crop window, normalise the format, then delay it
    // to its timeline position. All parts are summed (amix, no auto-normalise).
    if (audioParts.length > 0) {
      const audioLabels: string[] = [];
      audioParts.forEach((part, i) => {
        inputArgs.push("-i", audioPaths[i]!);
        const delayMs = Math.max(0, Math.round(part.startSec * 1000));
        const label = `a${i}`;
        audioLabels.push(`[${label}]`);
        parts.push(
          `[${inputIdx}:a]atrim=start=${part.inPoint}:duration=${part.length},asetpts=PTS-STARTPTS,` +
            `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
            `adelay=${delayMs}|${delayMs}[${label}]`,
        );
        inputIdx++;
      });
      if (audioParts.length === 1) {
        parts.push(`${audioLabels[0]}apad[outa]`);
      } else {
        parts.push(
          `${audioLabels.join("")}amix=inputs=${audioParts.length}:normalize=0:dropout_transition=0[amixed]`,
        );
        parts.push(`[amixed]apad[outa]`);
      }
      mapArgs.push("-map", "[outa]", "-shortest", "-c:a", "aac", "-b:a", "192k");
    }

    const outPath = join(dir, "out.mp4");
    await runFfmpeg([
      ...inputArgs,
      "-filter_complex",
      parts.join(";"),
      ...mapArgs,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One positioned slice of audio for a block window (relative to the window start). */
export interface AudioWindowPart {
  buffer: Buffer;
  /** In-point into the source audio (seconds). */
  inPoint: number;
  /** Length of the slice (seconds). */
  length: number;
  /** Offset from the window start where this slice begins (seconds). */
  delaySec: number;
}

/**
 * Build a standalone audio clip (MP3) for a block's time window by trimming each
 * overlapping audio part to its slice, delaying it to its position within the
 * window, and mixing them. The result is exactly `totalSec` long (padded with
 * silence). Used to feed a lip-sync video model the audio under a block.
 */
export async function mixAudioWindow(parts: AudioWindowPart[], totalSec: number): Promise<Buffer> {
  if (parts.length === 0) throw new Error("No audio parts to mix.");
  const dir = await mkdtemp(join(tmpdir(), "tpl-lipaudio-"));
  try {
    const inputArgs: string[] = [];
    const filters: string[] = [];
    const labels: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const path = join(dir, `a-${i}.bin`);
      await writeFile(path, p.buffer);
      inputArgs.push("-i", path);
      const delayMs = Math.max(0, Math.round(p.delaySec * 1000));
      const label = `a${i}`;
      labels.push(`[${label}]`);
      filters.push(
        `[${i}:a]atrim=start=${p.inPoint}:duration=${p.length},asetpts=PTS-STARTPTS,` +
          `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
          `adelay=${delayMs}|${delayMs}[${label}]`,
      );
    }
    if (parts.length === 1) {
      filters.push(`${labels[0]}apad,atrim=0:${totalSec}[outa]`);
    } else {
      filters.push(
        `${labels.join("")}amix=inputs=${parts.length}:normalize=0:dropout_transition=0,apad,atrim=0:${totalSec}[outa]`,
      );
    }
    const outPath = join(dir, "out.mp3");
    await runFfmpeg([
      ...inputArgs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outa]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run ffprobe with the given args, resolving with its stdout (rejects on error). */
function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("ffprobe is not installed or not on PATH (required to read uploaded video duration)."));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/** Read an uploaded media file's duration (seconds) via ffprobe. Throws if unreadable. */
export async function probeMediaDuration(media: Buffer): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "tpl-probe-"));
  try {
    const inPath = join(dir, "in.bin");
    await writeFile(inPath, media);
    const out = await runFfprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inPath,
    ]);
    const seconds = Number.parseFloat(out.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error("Could not determine the uploaded file's duration.");
    }
    return seconds;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Read an image's pixel dimensions via ffprobe. Throws if unreadable. */
export async function probeImageSize(image: Buffer): Promise<{ width: number; height: number }> {
  const dir = await mkdtemp(join(tmpdir(), "tpl-imgsize-"));
  try {
    const inPath = join(dir, "in.bin");
    await writeFile(inPath, image);
    const out = await runFfprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      inPath,
    ]);
    const [w, h] = out.trim().split("x").map((n) => Number.parseInt(n, 10));
    if (!w || !h) throw new Error("Could not read image dimensions.");
    return { width: w, height: h };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Extract a single JPEG thumbnail frame from a video buffer. */
export async function generateThumbnail(video: Buffer, atSeconds = 1): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "tpl-thumb-"));
  try {
    const inPath = join(dir, "in.mp4");
    const outPath = join(dir, "thumb.jpg");
    await writeFile(inPath, video);
    try {
      await runFfmpeg(["-ss", String(atSeconds), "-i", inPath, "-frames:v", "1", "-q:v", "3", outPath]);
    } catch {
      // Video may be shorter than `atSeconds`; fall back to the very first frame.
      await runFfmpeg(["-i", inPath, "-frames:v", "1", "-q:v", "3", outPath]);
    }
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
