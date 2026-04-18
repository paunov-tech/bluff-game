// api/axiom-voice.js
import { kv } from "@vercel/kv";
import { rateLimit, applyRateLimitHeaders } from "./_lib/rate-limit.js";

const SKIN_VOICES = {
  default:   "pNInz6obpgDQGcFmaJgB", // Adam — cold, deep
  balkan:    "pNInz6obpgDQGcFmaJgB", // Adam (balkan skin speaks SR anyway)
  anime:     "N2lVS1w4EtoT3dr4eOWO", // Callum — darker, dramatic
  corporate: "onwK4e9ZLuTAKqWW03F9", // Daniel — formal, measured
  british:   "onwK4e9ZLuTAKqWW03F9", // Daniel — British accent
};

const SKIN_SETTINGS = {
  default:   { stability: 0.45, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
  balkan:    { stability: 0.50, similarity_boost: 0.75, style: 0.40, use_speaker_boost: true },
  anime:     { stability: 0.30, similarity_boost: 0.80, style: 0.65, use_speaker_boost: true },
  corporate: { stability: 0.70, similarity_boost: 0.70, style: 0.10, use_speaker_boost: false },
  british:   { stability: 0.65, similarity_boost: 0.75, style: 0.20, use_speaker_boost: false },
};

function hashText(text, skin) {
  let h = 5381;
  const s = text + skin;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return "axiom_voice_" + Math.abs(h >>> 0).toString(36);
}

export const config = { api: { responseLimit: "4mb" } };

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const rl = await rateLimit(req, { bucket: "axiom-voice", limit: 15, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) {
    return res.status(429).json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) });
  }

  const { text, skin = "default" } = req.body;

  if (!text || text.length < 2)
    return res.status(400).json({ error: "No text" });

  const safeText = text.slice(0, 120);
  const cacheKey = hashText(safeText, skin);

  // Check KV cache
  try {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const buffer = Buffer.from(cached, "base64");
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-Cache", "HIT");
      return res.send(buffer);
    }
  } catch {}

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No API key" });

  const voiceId = SKIN_VOICES[skin] || SKIN_VOICES.default;
  const settings = SKIN_SETTINGS[skin] || SKIN_SETTINGS.default;

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: safeText,
          model_id: "eleven_multilingual_v2",
          voice_settings: settings,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text().catch(() => "unknown");
      console.error("[axiom-voice] ElevenLabs error:", response.status, err.slice(0, 200));
      return res.status(502).json({ error: "TTS failed", status: response.status });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Cache 24h
    try {
      await kv.set(cacheKey, buffer.toString("base64"), { ex: 86400 });
    } catch {}

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(buffer);
  } catch (err) {
    console.error("[axiom-voice] error:", err.message);
    return res.status(500).json({ error: "TTS unavailable" });
  }
}
