// api/telegram-auth.js
import crypto from "crypto";

export function verifyTelegramData(initData) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");

    const checkString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(token)
      .digest();

    const expectedHash = crypto
      .createHmac("sha256", secretKey)
      .update(checkString)
      .digest("hex");

    if (expectedHash !== hash) return null;

    // Reject data older than 24h
    const authDate = parseInt(params.get("auth_date") || "0");
    if (Date.now() / 1000 - authDate > 86400) return null;

    const userStr = params.get("user");
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { initData } = req.body;
  if (!initData)
    return res.status(400).json({ error: "initData required" });

  const user = verifyTelegramData(initData);
  if (!user)
    return res.status(401).json({ error: "Invalid Telegram data" });

  return res.status(200).json({
    valid: true,
    userId: `tg_${user.id}`,
    firstName: user.first_name,
    username: user.username,
    photoUrl: user.photo_url,
  });
}
