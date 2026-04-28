// Community pulse — polls /api/community-pulse on a jittered cadence and
// emits one toast at a time. Intentionally simple: caller passes onToast
// which fires for each chosen toast; an empty payload returns null and
// we just wait for the next poll. Stop by calling the returned cleanup.

const TOAST_INTERVAL_MIN = 25000;
const TOAST_INTERVAL_MAX = 35000;
const FIRST_TOAST_DELAY  = 6000;

export function startCommunityPulse(onToast, opts = {}) {
  const lang = opts.lang || "en";
  let active = true;
  let timer = null;

  async function poll() {
    if (!active) return;
    try {
      const res = await fetch(`/api/community-pulse?lang=${encodeURIComponent(lang)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const toast = pickToast(data);
        if (toast && active) onToast(toast);
      }
    } catch {}
    if (!active) return;
    const delay = TOAST_INTERVAL_MIN + Math.random() * (TOAST_INTERVAL_MAX - TOAST_INTERVAL_MIN);
    timer = setTimeout(poll, delay);
  }

  timer = setTimeout(poll, FIRST_TOAST_DELAY);

  return () => {
    active = false;
    if (timer) clearTimeout(timer);
  };
}

function pickToast(data) {
  if (!data) return null;
  const r = Math.random();
  // 30% activity count, 50% recent event, 20% topChoice
  if (r < 0.3 && Number.isFinite(data.activePlayersNow) && data.activePlayersNow > 5) {
    return { type: "count", text: `${data.activePlayersNow} players are choosing now` };
  }
  if (r < 0.8 && data.recentEvent) {
    const { kind, flag, handle } = data.recentEvent;
    const f = flag ? `${flag} ` : "";
    if (kind === "loss")    return { type: "event", text: `${f}${handle} just lost on this round` };
    if (kind === "win")     return { type: "event", text: `${f}${handle} just nailed it 🎯` };
    if (kind === "streak")  return { type: "event", text: `${f}${handle} hit a 5-streak 🔥` };
  }
  if (data.topChoice && data.topChoice.answer) {
    return { type: "stat", text: `Top ${data.topChoice.percent || 10}% chose ${data.topChoice.answer} on this one` };
  }
  if (Number.isFinite(data.activePlayersNow) && data.activePlayersNow > 5) {
    return { type: "count", text: `${data.activePlayersNow} players are choosing now` };
  }
  return null;
}
