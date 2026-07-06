import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { listImageModels, listSwapModels, listVideoModels } from "../lib/openrouter.js";

export const modelsRouter: Router = Router();

/** Shared handler: list models for a given media type from OpenRouter. */
function modelsHandler(list: () => Promise<unknown>) {
  return async (_req: Request, res: Response) => {
    try {
      res.json(await list());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load models";
      res.status(502).json({ error: message });
    }
  };
}

// `/api/models` and `/api/models/video` → video models (kept for backwards compat).
modelsRouter.get("/", requireAuth, modelsHandler(listVideoModels));
modelsRouter.get("/video", requireAuth, modelsHandler(listVideoModels));
// `/api/models/image` → image-generation models.
modelsRouter.get("/image", requireAuth, modelsHandler(listImageModels));
// `/api/models/swap` → selectable face-swap models (local FaceFusion + edit models).
modelsRouter.get("/swap", requireAuth, modelsHandler(listSwapModels));
