export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({ ok: true, service: "priorizai-worker" }, 200);
      }

      if (request.method === "POST" && isLimitedPath(url.pathname)) {
        const limit = getDailyLimit(env);
        const blocked = await enforceDailyRateLimit(request, env, limit);
        if (blocked) return blocked;
      }

      if (request.method === "POST" && url.pathname === "/prioritize") {
        const body = await readJson(request);
        const tasks = Array.isArray(body.tasks) ? body.tasks : [];
        if (!tasks.length) throw new Error("Informe ao menos 1 tarefa.");

        const result = await handlePrioritize(env, body);
        return json({ ok: true, data: result }, 200);
      }

      if (request.method === "POST" && url.pathname === "/calmai") {
        const body = await readJson(request);
        const text = cleanText(body?.text);
        if (!text) throw new Error("Informe o texto.");
        const result = await handleCalmAI(env, body);
        return json({ ok: true, data: result }, 200);
      }

      if (request.method === "POST" && url.pathname === "/briefai") {
        const body = await readJson(request);
        const text = cleanText(body?.text);
        if (!text) throw new Error("Informe o texto.");
        const result = await handleBriefAI(env, body);
        return json({ ok: true, data: result }, 200);
      }

      return json({ ok: false, error: "Not Found" }, 404);
    } catch (err) {
      return json({ ok: false, error: err?.message || "Erro interno" }, 500);
    }
  },
};

function isLimitedPath(pathname) {
  return pathname === "/prioritize" || pathname === "/calmai" || pathname === "/briefai";
}

function getDailyLimit(env) {
  const raw = env?.IP_DAILY_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 3;
  return n;
}

function getClientIp(request) {
  const h = request.headers;
  return (h.get("CF-Connecting-IP") || h.get("X-Forwarded-For") || "").split(",")[0].trim();
}

function saoPauloDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nextDayKey(dateKey) {
  const [y, m, d] = String(dateKey).split("-").map((n) => parseInt(n, 10));
  const next = new Date(Date.UTC(y, (m || 1) - 1, d || 1) + 86400000);
  return next.toISOString().slice(0, 10);
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function enforceDailyRateLimit(request, env, limit) {
  const kv = env?.RATE_LIMIT_KV;
  if (!kv) return json({ ok: false, code: "CONFIG_ERROR", message: "RATE_LIMIT_KV não configurado no Worker." }, 500);

  const salt = env?.HASH_SALT;
  if (!salt) return json({ ok: false, code: "CONFIG_ERROR", message: "HASH_SALT não configurado no Worker." }, 500);

  const ip = getClientIp(request) || "0.0.0.0";
  const day = saoPauloDateKey();
  const hash = await sha256Hex(`${salt}:${ip}`);
  const key = `rl:${day}:${hash}`;

  const currentRaw = await kv.get(key);
  const current = parseInt(currentRaw || "0", 10) || 0;

  if (current >= limit) {
    const resetDay = nextDayKey(day);
    const resetAt = `${resetDay}T00:00:00-03:00`;
    return json({ ok: false, code: "RATE_LIMITED", message: "Limite diário atingido.", limit, remaining: 0, resetAt }, 429);
  }

  await kv.put(key, String(current + 1), { expirationTtl: 172800 });
  return null;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" } });
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new Error();
    return body;
  } catch {
    throw new Error("JSON inválido.");
  }
}

function cleanText(text) {
  return String(text || "").replace(/\u0000/g, "").trim();
}

// ====== OpenAI calls (mantém seus handlers atuais) ======
function requireOpenAIKey(env) {
  const key = env?.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY não configurada no Worker.");
  return key;
}

async function openaiChat(env, payload) {
  const key = requireOpenAIKey(env);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(data?.error?.message || data?.message || text || "Falha no OpenAI.");
  return data;
}

async function handlePrioritize(env, body) {
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  const method = cleanText(body?.method) || "impact_effort";
  const model = env?.OPENAI_MODEL || "gpt-4o-mini";

  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: "Retorne JSON estrito: {\"ordered_tasks\":[{\"position\":1,\"task_title\":\"...\"}]}" },
      { role: "user", content: JSON.stringify({ method, tasks }) },
    ],
    response_format: { type: "json_object" },
  };

  const out = await openaiChat(env, payload);
  return JSON.parse(out?.choices?.[0]?.message?.content || "{\"ordered_tasks\":[]}");
}

async function handleCalmAI(env, body) {
  const model = env?.OPENAI_MODEL || "gpt-4o-mini";
  const payload = {
    model,
    temperature: 0.4,
    messages: [
      { role: "system", content: "Retorne JSON estrito: {\"rewritten_text\":\"...\"}" },
      { role: "user", content: JSON.stringify({ tone: body?.tone || "neutro", text: body?.text || "" }) },
    ],
    response_format: { type: "json_object" },
  };
  const out = await openaiChat(env, payload);
  return JSON.parse(out?.choices?.[0]?.message?.content || "{\"rewritten_text\":\"\"}");
}

async function handleBriefAI(env, body) {
  const model = env?.OPENAI_MODEL || "gpt-4o-mini";
  const payload = {
    model,
    temperature: 0.3,
    messages: [
      { role: "system", content: "Retorne JSON estrito: {\"summary\":\"...\",\"bullets\":[\"...\"]}" },
      { role: "user", content: JSON.stringify({ style: body?.style || "executivo", text: body?.text || "" }) },
    ],
    response_format: { type: "json_object" },
  };
  const out = await openaiChat(env, payload);
  return JSON.parse(out?.choices?.[0]?.message?.content || "{\"summary\":\"\",\"bullets\":[]}");
}
