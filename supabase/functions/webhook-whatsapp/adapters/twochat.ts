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
import {
  isValidPhone,
  isTextWithinLimit,
  isValidMimeType,
  isSafeMediaUrl,
  MAX_TEXT_LENGTH,
} from "../utils/security.ts";

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

  // Validar formato de teléfono (E.164 / WhatsApp)
  if (!isValidPhone(phone) || !isValidPhone(channelPhone)) return null;

  const text: string | undefined = body?.message?.text || undefined;
  const rawMedia = body?.message?.media;

  // Extract quoted message text if the user replied to a previous message.
  // 2chat embeds the original message under body.message.quoted_msg.message.text.
  // We extract only the text of the quoted message; media in quoted messages is ignored.
  const quotedRawText: string | undefined = body?.message?.quoted_msg?.message?.text || undefined;
  const quotedText: string | undefined = quotedRawText
    ? isTextWithinLimit(quotedRawText)
      ? quotedRawText
      : quotedRawText.substring(0, MAX_TEXT_LENGTH)
    : undefined;

  // Must have at least text or media
  if (!text && !rawMedia?.url) return null;

  // Truncar texto que exceda el límite en lugar de rechazar (experiencia de usuario)
  const safeText: string | undefined = text
    ? isTextWithinLimit(text)
      ? text
      : text.substring(0, MAX_TEXT_LENGTH)
    : undefined;

  let media: NormalizedMessage["media"] | undefined;

  if (rawMedia?.url) {
    // Bloquear URLs de media inseguras (SSRF)
    if (!isSafeMediaUrl(rawMedia.url)) return null;

    const rawMime = rawMedia.mime_type ?? "application/octet-stream";
    // Sanear MIME type antes de propagar
    const safeMime = isValidMimeType(rawMime) ? rawMime : "application/octet-stream";

    const normalizedType: NormalizedMediaType =
      MEDIA_TYPE_MAP[rawMedia.type] ?? "document";

    media = {
      url: rawMedia.url,
      type: normalizedType,
      mimeType: safeMime,
    };
  }

  return {
    phone,
    channelPhone,
    sentBy: "user",
    text: safeText,
    media,
    quotedText,
  };
}
