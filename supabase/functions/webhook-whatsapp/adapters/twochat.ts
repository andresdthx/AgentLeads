// Adapter: 2chat → NormalizedMessage
//
// Converts the raw 2chat webhook payload into the provider-agnostic
// NormalizedMessage consumed by the message handler.
//
// Responsibilities:
//   - Filter out non-user messages (status callbacks, bot echoes)
//   - Map 2chat-specific media types to normalized types (ptt → audio)
//   - Return null for payloads that should be silently acknowledged

import type { NormalizedMessage, NormalizedMediaType } from "../types/index.ts";

// 2chat raw type → normalized type
// "ptt" = push-to-talk (WhatsApp voice messages)
const MEDIA_TYPE_MAP: Record<string, NormalizedMediaType> = {
  image:    "image",
  ptt:      "audio",   // WhatsApp voice messages arrive as "ptt"
  audio:    "audio",
  video:    "video",
  document: "document",
  sticker:  "image",   // treat stickers as images
};

/**
 * Parse a raw 2chat webhook body into a NormalizedMessage.
 * Returns null if the payload should be silently acknowledged without processing
 * (e.g. messages sent by the bot, status callbacks, or missing required fields).
 */
// deno-lint-ignore no-explicit-any
export function parseTwochatPayload(body: any): NormalizedMessage | null {
  // Ignore messages we sent (avoid echo loop)
  if (body?.sent_by !== "user") return null;

  const phone: string = body?.remote_phone_number;
  const channelPhone: string = body?.channel_phone_number;

  if (!phone || !channelPhone) return null;

  const text: string | undefined = body?.message?.text || undefined;
  const rawMedia = body?.message?.media;

  // Must have at least text or media
  if (!text && !rawMedia?.url) return null;

  let media: NormalizedMessage["media"] | undefined;

  if (rawMedia?.url) {
    const normalizedType: NormalizedMediaType =
      MEDIA_TYPE_MAP[rawMedia.type] ?? "document";

    media = {
      url: rawMedia.url,
      type: normalizedType,
      mimeType: rawMedia.mime_type ?? "application/octet-stream",
    };
  }

  return {
    phone,
    channelPhone,
    sentBy: "user",
    text,
    media,
  };
}
