import type {
  Template,
  TemplateAudioClip,
  TemplateBlock,
  TemplateRender,
  TemplateRenderBlock,
} from "@repo/db";
import { getPublicUrl } from "./storage.js";

export function serializeAudioClip(clip: TemplateAudioClip) {
  return {
    ...clip,
    audioUrl: getPublicUrl(clip.audioKey),
  };
}

export function serializeBlock(block: TemplateBlock) {
  return {
    ...block,
    startImageUrl: block.startImageKey ? getPublicUrl(block.startImageKey) : null,
    endImageUrl: block.endImageKey ? getPublicUrl(block.endImageKey) : null,
    swappedStartUrl: block.swappedStartKey ? getPublicUrl(block.swappedStartKey) : null,
    swappedEndUrl: block.swappedEndKey ? getPublicUrl(block.swappedEndKey) : null,
    videoUrl: block.videoKey ? getPublicUrl(block.videoKey) : null,
    sourceVideoUrl: block.sourceVideoKey ? getPublicUrl(block.sourceVideoKey) : null,
  };
}

export function serializeTemplate(
  template: Template & { blocks?: TemplateBlock[]; audioClips?: TemplateAudioClip[] },
) {
  return {
    ...template,
    previewVideoUrl: template.previewVideoKey ? getPublicUrl(template.previewVideoKey) : null,
    thumbnailUrl: template.thumbnailKey ? getPublicUrl(template.thumbnailKey) : null,
    blocks: template.blocks ? template.blocks.map(serializeBlock) : undefined,
    audioClips: template.audioClips ? template.audioClips.map(serializeAudioClip) : undefined,
  };
}

export function serializeRenderBlock(block: TemplateRenderBlock) {
  return block;
}

export function serializeRender(render: TemplateRender & { blocks?: TemplateRenderBlock[] }) {
  return {
    ...render,
    videoUrl: render.videoKey ? getPublicUrl(render.videoKey) : null,
    thumbnailUrl: render.thumbnailKey ? getPublicUrl(render.thumbnailKey) : null,
    blocks: render.blocks ? render.blocks.map(serializeRenderBlock) : undefined,
  };
}
