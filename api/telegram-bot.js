// api/telegram-bot.js
import { kv } from "@vercel/kv";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_BOT_SECRET;
const BASE = `https://api.telegram.org/bot${TOKEN}`;

async function sendMessage(chatId, text, extra = {}) {
  await fetch(`${BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

async function answerInlineQuery(queryId, results) {
  await fetch(`${BASE}/answerInlineQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inline_query_id: queryId, results, cache_time: 0 }),
  });
}

export default async function handler(req, res) {
  if (req.headers["x-telegram-bot-api-secret-token"] !== SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const update = req.body;

  // ── /start ─────────────────────────────────────────────────────
  if (update.message?.text?.startsWith("/start")) {
    const chatId = update.message.chat.id;
    const user = update.message.from;
    const firstName = user?.first_name || "challenger";

    await kv.set(`tg:user:${user.id}`, {
      id: user.id,
      firstName,
      username: user.username,
      firstSeen: Date.now(),
    }, { ex: 60 * 60 * 24 * 365 }).catch(() => {});

    await sendMessage(chatId,
      `🎭 Welcome, ${firstName}.\n\nI am AXIOM. You think you can detect my lies?\n\nTap the button below to prove it.`,
      {
        reply_markup: {
          inline_keyboard: [[{
            text: "⚔️ Challenge AXIOM",
            web_app: { url: "https://playbluff.games" },
          }]],
        },
      }
    );
    return res.status(200).json({ ok: true });
  }

  // ── /daily ─────────────────────────────────────────────────────
  if (update.message?.text === "/daily") {
    const chatId = update.message.chat.id;
    await sendMessage(chatId,
      `📅 Today's Daily Challenge is live.\nSame puzzle for everyone. Clock is ticking.`,
      {
        reply_markup: {
          inline_keyboard: [[{
            text: "📅 Play Daily Challenge",
            web_app: { url: "https://playbluff.games?mode=daily" },
          }]],
        },
      }
    );
    return res.status(200).json({ ok: true });
  }

  // ── /shame ─────────────────────────────────────────────────────
  if (update.message?.text === "/shame") {
    const chatId = update.message.chat.id;
    await sendMessage(chatId,
      `💀 The Hall of Shame awaits.\nSee this week's most embarrassing defeats.`,
      {
        reply_markup: {
          inline_keyboard: [[{
            text: "💀 Hall of Shame",
            url: "https://playbluff.games/shame.html",
          }]],
        },
      }
    );
    return res.status(200).json({ ok: true });
  }

  // ── Inline query ────────────────────────────────────────────────
  if (update.inline_query) {
    const query = update.inline_query;
    const score = query.query?.trim() || "?";

    await answerInlineQuery(query.id, [{
      type: "article",
      id: "challenge_1",
      title: `Challenge — Score: ${score}`,
      description: "Send a BLUFF challenge to this chat",
      input_message_content: {
        message_text: `🎭 I scored ${score} against AXIOM in BLUFF.\nCan you beat me? AXIOM is waiting.`,
      },
      reply_markup: {
        inline_keyboard: [[{
          text: "⚔️ Accept challenge",
          web_app: { url: "https://playbluff.games" },
        }]],
      },
    }]);
    return res.status(200).json({ ok: true });
  }

  // ── Web App data — game results ─────────────────────────────────
  if (update.message?.web_app_data) {
    const chatId = update.message.chat.id;
    const user = update.message.from;
    let data;
    try { data = JSON.parse(update.message.web_app_data.data); }
    catch { return res.status(200).json({ ok: true }); }

    const { score, total, won, dayNum, isDaily, emojiGrid } = data;
    const emoji = won ? "🏆" : "💀";
    const gridLine = emojiGrid ? `\n${emojiGrid}` : "";
    const msg = isDaily
      ? `${emoji} ${user.first_name} — Daily #${dayNum}: ${score}/${total}${gridLine}\nAXIOM ${won ? "has been defeated" : "wins again"}.`
      : `${emoji} ${user.first_name} scored ${score}/${total} against AXIOM.${gridLine}\n${won ? "AXIOM was defeated! 🎯" : "AXIOM wins again. 💀"}`;

    await sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [[{
          text: "⚔️ Play yourself",
          web_app: { url: "https://playbluff.games" },
        }]],
      },
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true });
}
