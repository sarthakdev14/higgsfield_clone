import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Camera, Clapperboard, Film, Flag, Link2, Loader2, Music, Pause, Play, Plus, Scissors, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TemplateAudioClip, TemplateBlock } from "@/lib/api";

const PPS = 48; // pixels per second
const MIN_BLOCK = 1; // seconds
const LANE_H = 76; // px per video track lane
const AUDIO_LANE_H = 48; // px per audio track lane
const TRACK_LABEL_W = 96; // px, width of the left label gutter
const SNAP_PX = 8; // magnet distance (px) for snapping to the playhead marker
const MARKER_TOLERANCE = 0.2; // seconds: how close to a marker counts as "on" it (for toggling)
const MAX_MARKERS = 2;

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Playable clip URL for a block: an admin upload takes precedence over a baked clip. */
function clipUrl(b: TemplateBlock): string | null {
  return b.sourceVideoUrl ?? b.videoUrl;
}

/** Whether a block only uses part of its generated clip (cropped/trimmed). */
function isCropped(b: TemplateBlock): boolean {
  const duration = b.duration ?? b.endSec - b.startSec;
  return b.cropStart > 0.001 || (b.cropEnd != null && b.cropEnd < duration - 0.001);
}

/** Whether an audio clip only uses part of its file (cropped/trimmed). */
function isAudioCropped(c: TemplateAudioClip): boolean {
  return c.cropStart > 0.001 || (c.cropEnd != null && c.cropEnd < c.duration - 0.001);
}

/** Topmost block (highest track, then latest start) covering time `t`. */
function topBlockAt(blocks: TemplateBlock[], t: number): TemplateBlock | null {
  let best: TemplateBlock | null = null;
  for (const b of blocks) {
    if (t >= b.startSec && t < b.endSec) {
      if (!best || b.track > best.track || (b.track === best.track && b.startSec >= best.startSec)) {
        best = b;
      }
    }
  }
  return best;
}

/** Partial timeline geometry update for a clip (move / crop), shared by video + audio. */
export interface BlockPatch {
  startSec?: number;
  endSec?: number;
  track?: number;
  cropStart?: number;
  cropEnd?: number;
}

/** Imperative handle so the page can read live timeline state (playhead, markers)
 *  and grab the current program-monitor frame for capture. */
export interface TimelineCaptureApi {
  getContext: () => { sourceBlockId: string; atSec: number } | null;
  /** Current playhead time (seconds). */
  getPlayhead: () => number;
  /** Active marker times (seconds), sorted ascending. */
  getMarkers: () => number[];
}

interface Props {
  blocks: TemplateBlock[];
  trackCount: number;
  audioClips: TemplateAudioClip[];
  audioTrackCount: number;
  selectedId: string | null;
  selectedAudioId: string | null;
  onSelect: (id: string | null) => void;
  onSelectAudio: (id: string | null) => void;
  onAddTrack: () => void;
  onAddAudioTrack: () => void;
  onCreateBlock: (startSec: number, endSec: number, track: number) => void;
  /** Create a video block spanning the two markers (start → end). */
  onCreateBlockFromMarkers: (startSec: number, endSec: number) => void;
  /**
   * Capture the frame currently shown in the program monitor (from `sourceBlockId`
   * at clip-time `atSec`) and apply it to the selected block's start/end frame.
   */
  onCaptureFrame: (slot: "start" | "end", sourceBlockId: string, atSec: number) => Promise<void> | void;
  /** Populated with a handle to read the current monitor frame (for the inspector). */
  captureApiRef?: React.MutableRefObject<TimelineCaptureApi | null>;
  /** Live update during drag (local only). */
  onChangeBlock: (id: string, patch: BlockPatch) => void;
  /** Persist after drag completes. */
  onCommitBlock: (id: string, patch: BlockPatch) => void;
  /** Live update for an audio clip during drag (local only). */
  onChangeAudio: (id: string, patch: BlockPatch) => void;
  /** Persist an audio clip after drag completes. */
  onCommitAudio: (id: string, patch: BlockPatch) => void;
  /** Right-click on a block (id) or the empty track area (null). */
  onContextMenu: (blockId: string | null, e: React.MouseEvent) => void;
}

type DragState =
  | {
      kind: "video" | "audio";
      mode: "move";
      id: string;
      startX: number;
      origStart: number;
      origEnd: number;
      origTrack: number;
      last: { start: number; end: number; track: number };
    }
  | {
      kind: "video" | "audio";
      mode: "crop-l" | "crop-r";
      id: string;
      startX: number;
      track: number;
      origStart: number;
      origCropStart: number;
      origCropEnd: number;
      duration: number;
      last: { start: number; end: number; cropStart: number; cropEnd: number };
    }
  | { kind: "video"; mode: "create"; startSec: number; track: number; last: { start: number; end: number } }
  | null;

export function Timeline({
  blocks,
  trackCount,
  audioClips,
  audioTrackCount,
  selectedId,
  selectedAudioId,
  onSelect,
  onSelectAudio,
  onAddTrack,
  onAddAudioTrack,
  onCreateBlock,
  onCreateBlockFromMarkers,
  onCaptureFrame,
  captureApiRef,
  onChangeBlock,
  onCommitBlock,
  onChangeAudio,
  onCommitAudio,
  onContextMenu,
}: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const audioAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);
  const [createPreview, setCreatePreview] = useState<{ start: number; end: number; track: number } | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const monitorVideoRef = useRef<HTMLVideoElement>(null);
  // Hidden <audio> element per audio clip, synced to the playhead for preview.
  const audioEls = useRef<Map<string, HTMLAudioElement>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);
  const playheadRef = useRef(0);
  // Id of the clip currently dragged into a colliding spot (rendered red), and
  // whether the in-progress create preview collides.
  const [invalidId, setInvalidId] = useState<string | null>(null);
  const [previewInvalid, setPreviewInvalid] = useState(false);
  // Up to two session-only timeline markers (seconds), toggled with the `m` key.
  const [markers, setMarkers] = useState<number[]>([]);
  const markersRef = useRef<number[]>([]);
  markersRef.current = markers;
  // Which start/end frame capture is in flight (disables the buttons).
  const [capturing, setCapturing] = useState<null | "start" | "end">(null);

  // Latest clips, read by collision checks inside drag listeners (avoids stale closures).
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const audioRef = useRef(audioClips);
  audioRef.current = audioClips;

  // Latest callback props, read by the (stable) drag listeners so a re-render
  // never detaches an in-progress drag.
  const propsRef = useRef({ onChangeBlock, onCommitBlock, onCreateBlock, onChangeAudio, onCommitAudio });
  propsRef.current = { onChangeBlock, onCommitBlock, onCreateBlock, onChangeAudio, onCommitAudio };
  const tracksRef = useRef(1);
  const audioTracksRef = useRef(1);

  /** True if [start,end) on `track` overlaps another video block on the same track. */
  const collidesVideo = useCallback(
    (start: number, end: number, track: number, exceptId?: string) =>
      blocksRef.current.some(
        (b) => b.id !== exceptId && b.track === track && start < b.endSec - 1e-3 && end > b.startSec + 1e-3,
      ),
    [],
  );
  /** True if [start,end) on `track` overlaps another audio clip on the same track. */
  const collidesAudio = useCallback(
    (start: number, end: number, track: number, exceptId?: string) =>
      audioRef.current.some(
        (c) => c.id !== exceptId && c.track === track && start < c.endSec - 1e-3 && end > c.startSec + 1e-3,
      ),
    [],
  );

  const tracks = Math.max(trackCount, 1, ...blocks.map((b) => b.track + 1));
  tracksRef.current = tracks;
  const audioTracks = Math.max(audioTrackCount, 1, ...audioClips.map((c) => c.track + 1));
  audioTracksRef.current = audioTracks;

  // The timeline has no fixed length — it grows to fit the furthest clip.
  const contentEnd = Math.max(0, ...blocks.map((b) => b.endSec), ...audioClips.map((c) => c.endSec));
  const totalSec = Math.max(contentEnd, 10);
  const width = totalSec * PPS;
  const areaHeight = tracks * LANE_H;
  const audioAreaHeight = audioTracks * AUDIO_LANE_H;
  const laneTop = (track: number) => (tracks - 1 - track) * LANE_H; // track 0 at bottom
  const audioLaneTop = (track: number) => (audioTracks - 1 - track) * AUDIO_LANE_H;

  /** Pixel x → seconds (precise, no quantization). */
  const xToSecRaw = useCallback((clientX: number) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, (clientX - rect.left) / PPS);
  }, []);
  /** Snap a precise time to the playhead or a marker if close, else to a fine 0.1s grid. */
  const snapSec = useCallback((sec: number) => {
    const targets = [playheadRef.current, ...markersRef.current];
    for (const t of targets) {
      if (Math.abs(sec - t) * PPS <= SNAP_PX) return Math.max(0, t);
    }
    return Math.max(0, Math.round(sec * 10) / 10);
  }, []);
  const yToVideoTrack = useCallback((clientY: number) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const t = tracksRef.current;
    const laneFromTop = Math.floor((clientY - rect.top) / LANE_H);
    return Math.min(Math.max(0, t - 1 - laneFromTop), t - 1);
  }, []);
  const yToAudioTrack = useCallback((clientY: number) => {
    const rect = audioAreaRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const t = audioTracksRef.current;
    const laneFromTop = Math.floor((clientY - rect.top) / AUDIO_LANE_H);
    return Math.min(Math.max(0, t - 1 - laneFromTop), t - 1);
  }, []);

  // ---- Playback / preview ----
  const stopRaf = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };
  const pauseAllAudio = () => audioEls.current.forEach((el) => el.pause());
  const pause = useCallback(() => {
    setPlaying(false);
    stopRaf();
    pauseAllAudio();
  }, []);

  // The playhead clock is driven purely by requestAnimationFrame; audio clips are
  // synced to it (below) rather than driving it, since there can be many of them.
  const tick = useCallback(
    (ts: number) => {
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      const next = playheadRef.current + dt;
      playheadRef.current = next;
      setPlayhead(next);
      if (next >= totalSec) {
        playheadRef.current = totalSec;
        setPlayhead(totalSec);
        setPlaying(false);
        stopRaf();
        pauseAllAudio();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [totalSec],
  );

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  const play = useCallback(() => {
    if (playheadRef.current >= totalSec) {
      playheadRef.current = 0;
      setPlayhead(0);
    }
    setPlaying(true);
    lastTsRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick, totalSec]);

  useEffect(() => stopRaf, []);

  const seekTo = useCallback(
    (sec: number) => {
      const clamped = Math.min(Math.max(0, sec), totalSec);
      playheadRef.current = clamped;
      setPlayhead(clamped);
    },
    [totalSec],
  );

  // ---- Markers ----
  // Toggle a marker at the playhead: remove a nearby one, else add (max two).
  const toggleMarker = useCallback(() => {
    const ph = Math.round(playheadRef.current * 10) / 10;
    setMarkers((prev) => {
      const near = prev.find((m) => Math.abs(m - ph) <= MARKER_TOLERANCE);
      if (near !== undefined) return prev.filter((m) => m !== near);
      if (prev.length >= MAX_MARKERS) return prev; // already at the max
      return [...prev, ph].sort((a, b) => a - b);
    });
  }, []);

  // `m` toggles a marker at the playhead (ignored while typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "m" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      toggleMarker();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMarker]);

  // Keep every audio clip element in sync with the playhead so overlapping clips
  // play together (an in-browser approximation of the mix produced on render).
  useEffect(() => {
    audioClips.forEach((clip) => {
      const el = audioEls.current.get(clip.id);
      if (!el) return;
      const inWindow = playhead >= clip.startSec && playhead < clip.endSec;
      if (playing && inWindow) {
        const offset = clip.cropStart + Math.max(0, playhead - clip.startSec);
        if (Number.isFinite(offset) && Math.abs(el.currentTime - offset) > 0.3) {
          try {
            el.currentTime = offset;
          } catch {
            /* seeking before metadata is loaded */
          }
        }
        if (el.paused) void el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    });
  }, [playhead, playing, audioClips]);

  // ---- Drag (create / move / crop). Handlers are STABLE (read latest via refs)
  // so re-renders during a drag never detach the window listeners.
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.mode === "create") {
        const sec = snapSec(xToSecRaw(e.clientX));
        const start = Math.min(drag.startSec, sec);
        const end = Math.max(drag.startSec, sec);
        drag.last = { start, end };
        setCreatePreview({ start, end, track: drag.track });
        setPreviewInvalid(collidesVideo(start, end, drag.track));
        return;
      }

      const isAudio = drag.kind === "audio";
      const change = isAudio ? propsRef.current.onChangeAudio : propsRef.current.onChangeBlock;
      const collide = isAudio ? collidesAudio : collidesVideo;
      const yToTrack = isAudio ? yToAudioTrack : yToVideoTrack;
      const dRaw = xToSecRaw(e.clientX) - xToSecRaw(drag.startX);

      if (drag.mode === "crop-r") {
        const origEnd = drag.origStart + (drag.origCropEnd - drag.origCropStart);
        const maxEnd = drag.origStart + (drag.duration - drag.origCropStart);
        const end = Math.min(Math.max(drag.origStart + MIN_BLOCK, snapSec(origEnd + dRaw)), maxEnd);
        const cropEnd = drag.origCropStart + (end - drag.origStart);
        drag.last = { start: drag.origStart, end, cropStart: drag.origCropStart, cropEnd };
        setInvalidId(collide(drag.origStart, end, drag.track, drag.id) ? drag.id : null);
        change(drag.id, { endSec: end, cropEnd });
        return;
      }
      if (drag.mode === "crop-l") {
        const origEnd = drag.origStart + (drag.origCropEnd - drag.origCropStart);
        const minStart = Math.max(0, drag.origStart - drag.origCropStart); // cropStart >= 0
        const start = Math.min(Math.max(minStart, snapSec(drag.origStart + dRaw)), origEnd - MIN_BLOCK);
        const cropStart = drag.origCropStart + (start - drag.origStart);
        drag.last = { start, end: origEnd, cropStart, cropEnd: drag.origCropEnd };
        setInvalidId(collide(start, origEnd, drag.track, drag.id) ? drag.id : null);
        change(drag.id, { startSec: start, cropStart });
        return;
      }

      if (drag.mode === "move") {
        const span = drag.origEnd - drag.origStart;
        const newStart = Math.max(0, snapSec(drag.origStart + dRaw));
        const track = yToTrack(e.clientY);
        drag.last = { start: newStart, end: newStart + span, track };
        setInvalidId(collide(newStart, newStart + span, track, drag.id) ? drag.id : null);
        change(drag.id, { startSec: newStart, endSec: newStart + span, track });
      }
    },
    [collidesVideo, collidesAudio, snapSec, xToSecRaw, yToVideoTrack, yToAudioTrack],
  );

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (drag) {
      if (drag.mode === "create") {
        const p = drag.last;
        if (p && p.end - p.start >= MIN_BLOCK && !collidesVideo(p.start, p.end, drag.track)) {
          propsRef.current.onCreateBlock(p.start, p.end, drag.track);
        }
        setCreatePreview(null);
        setPreviewInvalid(false);
      } else {
        const isAudio = drag.kind === "audio";
        const change = isAudio ? propsRef.current.onChangeAudio : propsRef.current.onChangeBlock;
        const commit = isAudio ? propsRef.current.onCommitAudio : propsRef.current.onCommitBlock;
        const collide = isAudio ? collidesAudio : collidesVideo;
        if (drag.mode === "move") {
          const { start, end, track } = drag.last;
          if (collide(start, end, track, drag.id)) {
            change(drag.id, { startSec: drag.origStart, endSec: drag.origEnd, track: drag.origTrack });
          } else {
            commit(drag.id, { startSec: start, track });
          }
        } else {
          const { start, end, cropStart, cropEnd } = drag.last;
          if (collide(start, end, drag.track, drag.id)) {
            change(drag.id, {
              startSec: drag.origStart,
              endSec: drag.origStart + (drag.origCropEnd - drag.origCropStart),
              cropStart: drag.origCropStart,
              cropEnd: drag.origCropEnd,
            });
          } else {
            commit(drag.id, { startSec: start, cropStart, cropEnd });
          }
        }
        setInvalidId(null);
      }
    }
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [collidesVideo, collidesAudio, onPointerMove]);

  function beginDrag(state: DragState) {
    dragRef.current = state;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  // Detach listeners only on unmount (handlers are stable, so this never runs mid-drag).
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  function handleAreaPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return; // left-click only (right-click opens the context menu)
    if (e.target !== e.currentTarget) return; // only empty space starts a create
    onSelect(null);
    const startSec = snapSec(xToSecRaw(e.clientX));
    const track = yToVideoTrack(e.clientY);
    setCreatePreview({ start: startSec, end: startSec, track });
    beginDrag({ kind: "video", mode: "create", startSec, track, last: { start: startSec, end: startSec } });
  }

  function beginCrop(
    e: React.PointerEvent,
    kind: "video" | "audio",
    item: { id: string; startSec: number; endSec: number; duration: number | null; cropStart: number; cropEnd: number | null; track: number },
    mode: "crop-l" | "crop-r",
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (kind === "audio") onSelectAudio(item.id);
    else onSelect(item.id);
    const duration = item.duration ?? Math.round(item.endSec - item.startSec);
    const origCropStart = item.cropStart ?? 0;
    const origCropEnd = item.cropEnd ?? duration;
    beginDrag({
      kind,
      mode,
      id: item.id,
      startX: e.clientX,
      track: item.track,
      origStart: item.startSec,
      origCropStart,
      origCropEnd,
      duration,
      last: { start: item.startSec, end: item.endSec, cropStart: origCropStart, cropEnd: origCropEnd },
    });
  }

  // ---- Monitor (topmost block under the playhead) ----
  const activeBlock = topBlockAt(blocks, playhead);
  const activeClipUrl = activeBlock ? clipUrl(activeBlock) : null;
  let monitorImg: string | null = null;
  if (activeBlock) {
    const progress = (playhead - activeBlock.startSec) / Math.max(0.001, activeBlock.endSec - activeBlock.startSec);
    monitorImg =
      progress < 0.5
        ? activeBlock.startImageUrl ?? activeBlock.endImageUrl
        : activeBlock.endImageUrl ?? activeBlock.startImageUrl;
  }

  useEffect(() => {
    const v = monitorVideoRef.current;
    if (!v || !activeBlock || !activeClipUrl) return;
    // Map the playhead into clip time using the block's crop in-point.
    const offset = (activeBlock.cropStart ?? 0) + Math.max(0, playhead - activeBlock.startSec);
    if (playing) {
      // Transport running: pin the clip to the playhead and play it.
      if (Number.isFinite(offset) && Math.abs(v.currentTime - offset) > 0.3) {
        try {
          v.currentTime = offset;
        } catch {
          /* seeking before metadata is loaded */
        }
      }
      const dur = v.duration || Infinity;
      if (v.paused && offset < dur - 0.05) void v.play().catch(() => {});
    } else {
      // Transport paused/stopped: hold the frame at the playhead and stay paused.
      if (!v.paused) v.pause();
      if (Number.isFinite(offset) && Math.abs(v.currentTime - offset) > 0.1) {
        try {
          v.currentTime = offset;
        } catch {
          /* seeking before metadata is loaded */
        }
      }
    }
  }, [playhead, playing, activeBlock?.id, activeClipUrl, activeBlock?.startSec, activeBlock?.cropStart]);

  // ---- Frame capture (program monitor → selected block's start/end frame) ----
  // The target is the selected video block; the source is the clip under the
  // playhead. Only AI blocks use start/end frames (uploaded clips ignore them).
  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;
  const captureTargetOk = !!selectedBlock && !selectedBlock.sourceVideoUrl;
  const canCapture = captureTargetOk && !!activeBlock && !!activeClipUrl;

  async function captureFrame(slot: "start" | "end") {
    if (!activeBlock || !activeClipUrl || !captureTargetOk) return;
    const atSec = (activeBlock.cropStart ?? 0) + Math.max(0, playhead - activeBlock.startSec);
    setCapturing(slot);
    try {
      await onCaptureFrame(slot, activeBlock.id, atSec);
    } finally {
      setCapturing(null);
    }
  }

  // Read the clip currently under the playhead (for the inspector's capture buttons).
  const getCaptureContext = useCallback((): { sourceBlockId: string; atSec: number } | null => {
    const ph = playheadRef.current;
    const active = topBlockAt(blocksRef.current, ph);
    if (!active) return null;
    if (!(active.sourceVideoUrl ?? active.videoUrl)) return null; // needs a playable clip
    return { sourceBlockId: active.id, atSec: (active.cropStart ?? 0) + Math.max(0, ph - active.startSec) };
  }, []);

  const getPlayhead = useCallback(() => playheadRef.current, []);
  const getMarkers = useCallback(() => [...markersRef.current].sort((a, b) => a - b), []);

  useEffect(() => {
    if (!captureApiRef) return;
    captureApiRef.current = { getContext: getCaptureContext, getPlayhead, getMarkers };
    return () => {
      if (captureApiRef.current?.getContext === getCaptureContext) captureApiRef.current = null;
    };
  }, [captureApiRef, getCaptureContext, getPlayhead, getMarkers]);

  const markersReady = markers.length === MAX_MARKERS;
  function handleCreateFromMarkers() {
    if (!markersReady) return;
    const sorted = [...markers].sort((a, b) => a - b);
    onCreateBlockFromMarkers(sorted[0]!, sorted[1]!);
    setMarkers([]);
  }

  const ticks: number[] = [];
  for (let t = 0; t <= totalSec; t += 5) ticks.push(t);

  // Lanes rendered top (highest index) → bottom (track 0) like an NLE.
  const laneOrder = Array.from({ length: tracks }, (_, i) => tracks - 1 - i);
  const audioLaneOrder = Array.from({ length: audioTracks }, (_, i) => audioTracks - 1 - i);

  return (
    <div className="flex flex-col gap-3">
      {/* Program monitor */}
      <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-lg border bg-black">
        <div className="relative flex aspect-video items-center justify-center">
          {activeClipUrl ? (
            <video
              // Key on the clip URL so a re-baked clip (new URL) remounts and
              // actually reloads, instead of keeping the old buffered source.
              key={activeClipUrl}
              ref={monitorVideoRef}
              src={activeClipUrl}
              muted
              playsInline
              className="h-full w-full object-contain"
            />
          ) : monitorImg ? (
            <img src={monitorImg} alt="" className="h-full w-full object-contain" />
          ) : activeBlock ? (
            <div className="px-6 text-center text-sm text-white/70">
              <Film className="mx-auto mb-2 h-6 w-6" />
              No preview yet — “Bake” this clip to generate it, or set a start frame.
            </div>
          ) : (
            <div className="text-sm text-white/40">No clip at the playhead</div>
          )}
          {activeBlock && (
            <div className="absolute inset-x-0 bottom-0 line-clamp-2 bg-black/60 px-3 py-1.5 text-xs text-white">
              {activeBlock.prompt || (activeBlock.sourceVideoUrl ? "Uploaded video" : "Untitled clip")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 bg-neutral-900 px-3 py-2 text-white">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => (playing ? pause() : play())}
            title={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => {
              pause();
              seekTo(0);
            }}
            title="Stop"
          >
            <Square className="h-4 w-4" />
          </Button>
          <span className="font-mono text-xs tabular-nums text-white/80">
            {formatTime(playhead)} / {formatTime(totalSec)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white disabled:opacity-40"
              onClick={() => void captureFrame("start")}
              disabled={!canCapture || capturing !== null}
              title={
                captureTargetOk
                  ? "Use the frame at the playhead as the selected block's start frame"
                  : "Select an AI video block to set its start frame"
              }
            >
              {capturing === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Start frame
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white disabled:opacity-40"
              onClick={() => void captureFrame("end")}
              disabled={!canCapture || capturing !== null}
              title={
                captureTargetOk
                  ? "Use the frame at the playhead as the selected block's end frame"
                  : "Select an AI video block to set its end frame"
              }
            >
              {capturing === "end" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              End frame
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div style={{ minWidth: width + TRACK_LABEL_W }}>
          {/* Ruler */}
          <div className="flex border-b bg-muted/40">
            <div style={{ width: TRACK_LABEL_W }} className="shrink-0 border-r px-2 py-1 text-xs text-muted-foreground">
              Timeline
            </div>
            <div className="relative h-7 cursor-pointer" style={{ width }} onClick={(e) => seekTo(xToSecRaw(e.clientX))}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-border/60" style={{ left: t * PPS }}>
                  <span className="ml-1 text-[10px] text-muted-foreground">{formatTime(t)}</span>
                </div>
              ))}
              {markers.map((m, i) => (
                <div
                  key={`mk-${i}`}
                  className="absolute top-0 z-30 flex h-full items-start"
                  style={{ left: m * PPS }}
                  title={`Marker ${i + 1} (${formatTime(m)})`}
                >
                  <div className="h-full w-0.5 bg-amber-500" />
                  <Flag className="-ml-0.5 h-3 w-3 fill-amber-500 text-amber-500" />
                </div>
              ))}
              <div className="absolute top-0 z-20 h-full w-0.5 bg-destructive" style={{ left: playhead * PPS }} />
            </div>
          </div>

          {/* Video tracks */}
          <div className="flex border-b">
            <div style={{ width: TRACK_LABEL_W }} className="shrink-0 border-r">
              {laneOrder.map((track) => (
                <div
                  key={track}
                  style={{ height: LANE_H }}
                  className="flex items-center gap-1.5 border-b px-2 text-xs font-medium text-muted-foreground last:border-b-0"
                >
                  <Film className="h-3.5 w-3.5" /> V{track + 1}
                </div>
              ))}
            </div>
            <div
              ref={areaRef}
              className="relative select-none bg-[repeating-linear-gradient(90deg,transparent,transparent_47px,var(--color-border)_47px,var(--color-border)_48px)]"
              style={{ width, height: areaHeight }}
              onPointerDown={handleAreaPointerDown}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(null, e);
              }}
            >
              {/* lane separators */}
              {laneOrder.map((track, i) => (
                <div
                  key={track}
                  className="pointer-events-none absolute left-0 right-0 border-b border-border/70"
                  style={{ top: i * LANE_H, height: LANE_H }}
                />
              ))}

              {blocks.map((b) => (
                <div
                  key={b.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(b.id);
                    onContextMenu(b.id, e);
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return; // left-click only
                    e.stopPropagation();
                    onSelect(b.id);
                    beginDrag({
                      kind: "video",
                      mode: "move",
                      id: b.id,
                      startX: e.clientX,
                      origStart: b.startSec,
                      origEnd: b.endSec,
                      origTrack: b.track,
                      last: { start: b.startSec, end: b.endSec, track: b.track },
                    });
                  }}
                  className={cn(
                    "absolute flex cursor-grab flex-col justify-between overflow-hidden rounded-md border px-2 py-1 text-xs active:cursor-grabbing",
                    invalidId === b.id
                      ? "border-destructive bg-destructive/20 ring-2 ring-destructive"
                      : selectedId === b.id
                        ? "border-primary bg-primary/20 ring-2 ring-primary"
                        : "border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25",
                  )}
                  style={{
                    left: b.startSec * PPS,
                    width: Math.max(2, (b.endSec - b.startSec) * PPS),
                    top: laneTop(b.track) + 6,
                    height: LANE_H - 12,
                  }}
                >
                  <span className="pointer-events-none flex items-start gap-1 font-medium">
                    {b.sourceVideoUrl ? (
                      <Upload className="mt-0.5 h-3 w-3 shrink-0 text-sky-400" />
                    ) : (
                      b.videoUrl && <Clapperboard className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                    )}
                    {b.linkGroupId && <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />}
                    {isCropped(b) && <Scissors className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />}
                    <span className="line-clamp-2">
                      {b.prompt || (b.sourceVideoUrl ? "Uploaded video" : "Untitled clip")}
                    </span>
                  </span>
                  <span className="pointer-events-none text-[10px] text-muted-foreground">
                    {(b.endSec - b.startSec).toFixed(1)}s
                    {isCropped(b) && ` of ${b.duration ?? Math.round(b.endSec - b.startSec)}s`}
                  </span>
                  {/* Crop (trim) handles */}
                  <div
                    className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-foreground/20 hover:bg-foreground/40"
                    onPointerDown={(e) => beginCrop(e, "video", b, "crop-l")}
                  />
                  <div
                    className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-foreground/20 hover:bg-foreground/40"
                    onPointerDown={(e) => beginCrop(e, "video", b, "crop-r")}
                  />
                </div>
              ))}

              {createPreview && (
                <div
                  className={cn(
                    "pointer-events-none absolute rounded-md border-2 border-dashed",
                    previewInvalid ? "border-destructive bg-destructive/10" : "border-primary bg-primary/10",
                  )}
                  style={{
                    left: createPreview.start * PPS,
                    width: Math.max(2, (createPreview.end - createPreview.start) * PPS),
                    top: laneTop(createPreview.track) + 6,
                    height: LANE_H - 12,
                  }}
                />
              )}

              {markers.map((m, i) => (
                <div
                  key={`mkv-${i}`}
                  className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-amber-500/70"
                  style={{ left: m * PPS }}
                />
              ))}
              <div className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-destructive/80" style={{ left: playhead * PPS }} />
            </div>
          </div>

          {/* Audio tracks */}
          <div className="flex">
            <div style={{ width: TRACK_LABEL_W }} className="shrink-0 border-r">
              {audioLaneOrder.map((track) => (
                <div
                  key={track}
                  style={{ height: AUDIO_LANE_H }}
                  className="flex items-center gap-1.5 border-b px-2 text-xs font-medium text-muted-foreground last:border-b-0"
                >
                  <AudioLines className="h-3.5 w-3.5" /> A{track + 1}
                </div>
              ))}
            </div>
            <div
              ref={audioAreaRef}
              className="relative select-none bg-muted/20"
              style={{ width, height: audioAreaHeight }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                if (e.target !== e.currentTarget) return;
                onSelectAudio(null);
                onSelect(null);
              }}
            >
              {/* lane separators */}
              {audioLaneOrder.map((track, i) => (
                <div
                  key={track}
                  className="pointer-events-none absolute left-0 right-0 border-b border-border/70"
                  style={{ top: i * AUDIO_LANE_H, height: AUDIO_LANE_H }}
                />
              ))}

              {audioClips.map((c) => (
                <div
                  key={c.id}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    onSelectAudio(c.id);
                    beginDrag({
                      kind: "audio",
                      mode: "move",
                      id: c.id,
                      startX: e.clientX,
                      origStart: c.startSec,
                      origEnd: c.endSec,
                      origTrack: c.track,
                      last: { start: c.startSec, end: c.endSec, track: c.track },
                    });
                  }}
                  className={cn(
                    "absolute flex cursor-grab items-center gap-1 overflow-hidden rounded-md border px-2 text-xs active:cursor-grabbing",
                    invalidId === c.id
                      ? "border-destructive bg-destructive/20 ring-2 ring-destructive"
                      : selectedAudioId === c.id
                        ? "border-primary bg-primary/20 ring-2 ring-primary"
                        : "border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25",
                  )}
                  style={{
                    left: c.startSec * PPS,
                    width: Math.max(2, (c.endSec - c.startSec) * PPS),
                    top: audioLaneTop(c.track) + 5,
                    height: AUDIO_LANE_H - 10,
                  }}
                >
                  <Music className="h-3 w-3 shrink-0 text-emerald-500" />
                  {isAudioCropped(c) && <Scissors className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span className="pointer-events-none truncate font-medium">{c.name || "Audio clip"}</span>
                  {/* Crop (trim) handles */}
                  <div
                    className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-foreground/20 hover:bg-foreground/40"
                    onPointerDown={(e) => beginCrop(e, "audio", c, "crop-l")}
                  />
                  <div
                    className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-foreground/20 hover:bg-foreground/40"
                    onPointerDown={(e) => beginCrop(e, "audio", c, "crop-r")}
                  />
                </div>
              ))}

              {audioClips.length === 0 && (
                <div className="pointer-events-none flex h-full items-center px-3 text-xs text-muted-foreground">
                  No audio yet — use “Upload audio” to add a track.
                </div>
              )}

              {markers.map((m, i) => (
                <div
                  key={`mka-${i}`}
                  className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-amber-500/70"
                  style={{ left: m * PPS }}
                />
              ))}
              <div className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-destructive/80" style={{ left: playhead * PPS }} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onAddTrack}>
            <Plus className="h-4 w-4" /> Video track
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onAddAudioTrack}>
            <Plus className="h-4 w-4" /> Audio track
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleCreateFromMarkers}
            disabled={!markersReady}
            title={
              markersReady
                ? "Create a video block spanning the two markers"
                : "Set two markers (press M at two points) to enable"
            }
          >
            <Plus className="h-4 w-4" /> Create video block from markers
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMarkers([])}
            disabled={markers.length === 0}
            title="Remove all markers"
          >
            <Flag className="h-4 w-4" /> Clear markers
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Press <kbd className="rounded border px-1">M</kbd> to set/clear a marker at the playhead
          (max 2) · drag clips to move/crop · overlapping audio is mixed together.
        </p>
      </div>

      {/* Hidden audio elements (one per clip) used for in-browser preview. Keyed on
          the URL too so replacing a clip's file reloads the element. */}
      {audioClips.map((c) => (
        <audio
          key={`${c.id}:${c.audioUrl}`}
          ref={(el) => {
            if (el) audioEls.current.set(c.id, el);
            else audioEls.current.delete(c.id);
          }}
          src={c.audioUrl}
          preload="auto"
          className="hidden"
        />
      ))}
    </div>
  );
}
