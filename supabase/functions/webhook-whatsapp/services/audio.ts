// Audio service — transcribes WhatsApp voice messages using OpenAI Whisper.
//
// Flow:
//   1. Download audio from 2chat's public S3 URL
//   2. Send to Whisper API as multipart/form-data
//   3. Return transcription text → flows into the pipeline as user text
//
// WhatsApp voice messages arrive as audio/ogg (opus codec).
// Whisper supports: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm.

import { createLogger } from "../utils/logger.ts";

const logger = createLogger("audio");

const WHISPER_MODEL = "whisper-1";
const OPENAI_TRANSCRIPTION_ENDPOINT =
  "https://api.openai.com/v1/audio/transcriptions";

/** Maps MIME type → file extension expected by Whisper. */
const MIME_TO_EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "mp4",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/flac": "flac",
};

/**
 * Transcribes a WhatsApp audio/voice message using OpenAI Whisper.
 * Returns the transcribed text ready to enter the conversation pipeline.
 */
export async function transcribeAudio(
  audioUrl: string,
  mimeType: string
): Promise<string> {
  const apiKey =
    Deno.env.get("LLM_API_KEY_OPENAI") ?? Deno.env.get("LLM_API_KEY");

  if (!apiKey) {
    logger.error("API key de OpenAI no configurada para Whisper");
    throw new Error("OpenAI API key not configured for audio transcription");
  }

  // 1. Download audio from S3 (public URL, no auth needed)
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(
      `Error descargando audio: HTTP ${audioResponse.status}`
    );
  }

  const audioBuffer = await audioResponse.arrayBuffer();
  // MIME puede incluir parámetros: "audio/ogg; codecs=opus" → base = "audio/ogg"
  const baseMime = mimeType.split(";")[0].trim();
  const ext = MIME_TO_EXT[baseMime] ?? "ogg"; // fallback a ogg (más común en WhatsApp)
  const audioBlob = new Blob([audioBuffer], { type: mimeType });

  logger.debug("Audio descargado", { audioUrl, mimeType, ext, bytes: audioBuffer.byteLength });

  // 2. Build multipart/form-data for Whisper
  const formData = new FormData();
  formData.append("file", audioBlob, `audio.${ext}`); // filename extension matters for Whisper
  formData.append("model", WHISPER_MODEL);
  formData.append("language", "es"); // Spanish — improves accuracy for Colombian dialect

  // 3. Call Whisper API
  const whisperResponse = await fetch(OPENAI_TRANSCRIPTION_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Content-Type is set automatically by fetch when using FormData
    },
    body: formData,
  });

  if (!whisperResponse.ok) {
    const err = await whisperResponse.text();
    logger.error("Error en Whisper API", {
      status: whisperResponse.status,
      error: err,
    });
    throw new Error(`Whisper API error ${whisperResponse.status}`);
  }

  const data = await whisperResponse.json();
  const transcription: string = data.text?.trim() ?? "";

  if (!transcription) {
    logger.warn("Whisper devolvió transcripción vacía", { audioUrl });
    return "audio sin contenido audible";
  }

  logger.info("Audio transcrito", { bytes: audioBuffer.byteLength, transcription });
  return transcription;
}
