/**
 * Unit tests for src/lib/openrouter.ts
 *
 * All external HTTP calls are mocked via vi.stubGlobal('fetch').
 * The env is mocked so no real API key is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../env.js", () => ({
  env: {
    OPENROUTER_API_KEY: "sk-or-test",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  },
}));

import {
  supportsAudioLipsync,
  listVideoModels,
  listImageModels,
  generateImage,
  generateVideo,
} from "../lib/openrouter.js";

// ---------------------------------------------------------------------------
// supportsAudioLipsync
// ---------------------------------------------------------------------------

describe("supportsAudioLipsync", () => {
  it("returns true for models matching /seedance-2/i", () => {
    expect(supportsAudioLipsync("bytedance/seedance-2.0")).toBe(true);
    expect(supportsAudioLipsync("Seedance-2-pro")).toBe(true);
  });

  it("returns false for other model ids", () => {
    expect(supportsAudioLipsync("google/veo-3")).toBe(false);
    expect(supportsAudioLipsync("")).toBe(false);
    expect(supportsAudioLipsync("seedance-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper: build a mock Response-like object
// ---------------------------------------------------------------------------

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: new Headers({ "content-type": "video/mp4" }),
    arrayBuffer: async () => Buffer.from("fake-video").buffer,
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// listVideoModels
// ---------------------------------------------------------------------------

describe("listVideoModels", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns an empty array when the API returns no data", async () => {
    global.fetch = mockFetch({ data: [] });
    const models = await listVideoModels();
    expect(models).toEqual([]);
  });

  it("maps raw models and annotates supportsAudioInput for Seedance-2", async () => {
    global.fetch = mockFetch({
      data: [
        { id: "bytedance/seedance-2.0", name: "Seedance 2.0" },
        { id: "google/veo-3", name: "Veo 3" },
      ],
    });

    const models = await listVideoModels();
    expect(models).toHaveLength(2);
    expect(models[0].supportsAudioInput).toBe(true);
    expect(models[1].supportsAudioInput).toBe(false);
  });

  it("throws when the API responds with a non-OK status", async () => {
    global.fetch = mockFetch("Unauthorized", false, 401);
    await expect(listVideoModels()).rejects.toThrow("Failed to list video models");
  });
});

// ---------------------------------------------------------------------------
// listImageModels
// ---------------------------------------------------------------------------

describe("listImageModels", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns normalised image models from the API", async () => {
    global.fetch = mockFetch({
      data: [
        {
          id: "black-forest-labs/flux.1-dev",
          name: "FLUX.1 Dev",
          description: "An image model",
          supported_parameters: {
            aspect_ratio: { values: ["1:1", "16:9"] },
            input_references: { type: "array" },
          },
        },
        {
          id: "stability/stable-diffusion",
          name: "Stable Diffusion",
          supported_parameters: {},
        },
      ],
    });

    const models = await listImageModels();
    expect(models).toHaveLength(2);

    const flux = models.find((m) => m.id === "black-forest-labs/flux.1-dev")!;
    expect(flux.supported_aspect_ratios).toEqual(["1:1", "16:9"]);
    expect(flux.supportsReferences).toBe(true);

    const sd = models.find((m) => m.id === "stability/stable-diffusion")!;
    expect(sd.supportsReferences).toBe(false);
  });

  it("throws when the API responds with a non-OK status", async () => {
    global.fetch = mockFetch("Server Error", false, 500);
    await expect(listImageModels()).rejects.toThrow("Failed to list image models");
  });
});

// ---------------------------------------------------------------------------
// generateImage
// ---------------------------------------------------------------------------

describe("generateImage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("decodes a b64_json response and returns a GeneratedImage", async () => {
    const fakePngBase64 = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64");
    global.fetch = mockFetch({
      data: [{ b64_json: fakePngBase64 }],
      usage: { cost: 0.01 },
    });

    const result = await generateImage({ model: "flux", prompt: "a cat" });
    expect(result.contentType).toBe("image/jpeg"); // 0xFF 0xD8 0xFF → JPEG
    expect(result.cost).toBe(0.01);
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("throws when no image data is returned", async () => {
    global.fetch = mockFetch({ data: [], error: "Content filtered" });
    await expect(generateImage({ model: "flux", prompt: "a cat" })).rejects.toThrow(
      "Content filtered",
    );
  });

  it("throws when the API call fails", async () => {
    global.fetch = mockFetch("Bad Request", false, 400);
    await expect(generateImage({ model: "flux", prompt: "a cat" })).rejects.toThrow(
      "OpenRouter image generation failed",
    );
  });

  it("includes resolution and aspectRatio in the request body when provided", async () => {
    const fakePngBase64 = Buffer.from("PNG").toString("base64");
    global.fetch = mockFetch({ data: [{ b64_json: fakePngBase64 }], usage: {} });

    await generateImage({
      model: "flux",
      prompt: "a dog",
      resolution: "1024x1024",
      aspectRatio: "1:1",
    });

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    expect(body.resolution).toBe("1024x1024");
    expect(body.aspect_ratio).toBe("1:1");
  });
});

// ---------------------------------------------------------------------------
// generateVideo (abbreviated — the polling loop is complex)
// ---------------------------------------------------------------------------

describe("generateVideo", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("submits, polls, downloads and returns a GeneratedVideo", async () => {
    const submitResponse = {
      id: "job-123",
      status: "in_progress",
      polling_url: "https://openrouter.ai/api/v1/videos/job-123",
    };
    const pollResponse = {
      id: "job-123",
      status: "completed",
      unsigned_urls: ["https://cdn.example.com/video.mp4"],
      usage: { cost: 0.5 },
    };
    const fakeVideoBuffer = Buffer.from("fake-video-bytes");

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (callCount === 1) {
        // Submit
        return { ok: true, json: async () => submitResponse } as unknown as Response;
      } else if (callCount === 2) {
        // Poll → completed
        return { ok: true, json: async () => pollResponse } as unknown as Response;
      } else {
        // Download content
        return {
          ok: true,
          headers: new Headers({ "content-type": "video/mp4" }),
          arrayBuffer: async () => fakeVideoBuffer.buffer,
        } as unknown as Response;
      }
    });

    const result = await generateVideo({ model: "veo-3", prompt: "a sunset" });

    expect(result.providerJobId).toBe("job-123");
    expect(result.cost).toBe(0.5);
    expect(result.contentType).toBe("video/mp4");
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("throws when video generation ends in a failed state", async () => {
    const submitResponse = { id: "job-fail", status: "pending" };
    const pollResponse = { id: "job-fail", status: "failed", error: "Provider error" };

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { ok: true, json: async () => submitResponse } as Response;
      return { ok: true, json: async () => pollResponse } as Response;
    });

    await expect(generateVideo({ model: "veo-3", prompt: "fail" })).rejects.toThrow(
      "Provider error",
    );
  });

  it("throws when the submit call fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    } as unknown as Response);

    await expect(generateVideo({ model: "veo-3", prompt: "a cat" })).rejects.toThrow(
      "OpenRouter submit failed",
    );
  });
});
