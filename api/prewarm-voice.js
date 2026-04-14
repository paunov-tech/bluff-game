// api/prewarm-voice.js
// Call once manually: GET /api/prewarm-voice

const COMMON_LINES = [
  "ratio",
  "Predictable.",
  "The gap between us widens.",
  "Impossible. A fluke.",
  "I did not anticipate that.",
  "Finally.",
  "Your confidence is endearing. Begin.",
  "Every human falls eventually.",
];

export default async function handler(req, res) {
  const baseUrl = `https://${req.headers.host}`;
  const results = [];

  for (const line of COMMON_LINES) {
    try {
      const r = await fetch(`${baseUrl}/api/axiom-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line, skin: "default" }),
      });
      results.push({ line, status: r.status, cached: r.headers.get("X-Cache") });
    } catch (e) {
      results.push({ line, error: e.message });
    }
  }

  return res.status(200).json({ prewarm: results });
}
