export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      // Healthcheck
      if (request.method === "GET" && url.pathname === "/") {
        return json({ ok: true, service: "priorizai-worker" }, 200);
      }

      const pathname = normalizePath(url.pathname);

      // Rate limit (por IP, por dia)
      if (request.method === "POST" && isLimitedPath(pathname)) {
        const limit = getDailyLimit(env);
        const blocked = await enforceDailyRateLimit(request, env, limit);
        if (blocked) return blocked;
      }

      if (request.method === "POST" && pathname === "/prioritize") {
        const body = await readJson(request);
        const tasks = Array.isArray(body.tasks) ? body.tasks : [];
        if (!tasks.length) throw new Error("Informe ao menos 1 tarefa.");
        const result = await handlePrioritize(env, body);
        return json({ ok: true, data: result }, 200);
      }

      if (request.method === "POST" && pathname === "/calmai") {
        const body = await readJson(request);
        const text = cleanText(body?.text);
        if (!text) throw new Error("Informe o texto.");
        const result = await handleCalmAI(env, body);
        return json({ ok: true, data: result }, 200);
      }

      if (request.method === "POST" && pathname === "/briefai") {
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

// =========================
// Routing helpers
// =========================
function normalizePath(pathname) {
  const p = String(pathname || "/").trim();
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p || "/";
}

function isLimitedPath(pathname) {
  return pathname === "/prioritize" || pathname === "/calmai" || pathname === "/briefai";
}

// =========================
// Rate limit helpers
// =========================
function getDailyLimit(env) {
  const raw = String(env?.IP_DAILY_LIMIT ?? "").trim();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("IP_DAILY_LIMIT inválido. Configure como número inteiro (secret) no Cloudflare.");
  }
  return n;
}

function saoPauloDateKey() {
  // YYYY-MM-DD em America/Sao_Paulo
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getClientIp(request) {
  const h = request.headers;
  return (h.get("CF-Connecting-IP") || h.get("X-Forwarded-For") || "").split(",")[0].trim();
}

async function enforceDailyRateLimit(request, env, limit) {
  const kv = env?.RATE_LIMIT_KV;
  if (!kv) {
    return json(
      { ok: false, code: "CONFIG_ERROR", message: "RATE_LIMIT_KV não configurado no Worker." },
      500
    );
  }

  const salt = String(env?.HASH_SALT ?? "").trim();
  if (!salt) {
    return json({ ok: false, code: "CONFIG_ERROR", message: "HASH_SALT não configurado no Worker." }, 500);
  }

  const ip = getClientIp(request) || "0.0.0.0";
  const day = saoPauloDateKey();
  const hash = await sha256Hex(`${salt}:${ip}`);
  const key = `rl:${day}:${hash}`;

  const currentRaw = await kv.get(key);
  const current = parseInt(currentRaw || "0", 10) || 0;

  if (current >= limit) {
    return json(
      {
        ok: false,
        code: "RATE_LIMITED",
        limit,
        remaining: 0,
        message:
          `Desculpa, mas seu limite diário foi atingido. ` +
          `Você pode usar até ${limit} vezes por dia por IP. ` +
          `Tente novamente amanhã.`,
      },
      429
    );
  }

  // TTL só para limpeza. A chave já é por dia.
  await kv.put(key, String(current + 1), { expirationTtl: 172800 });
  return null;
}

// =========================
// CORS / JSON
// =========================
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
  });
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

// =========================
// OpenAI
// =========================
function requireOpenAIKey(env) {
  const key = String(env?.OPENAI_API_KEY ?? "").trim();
  if (!key) throw new Error("OPENAI_API_KEY não configurada no Worker.");
  return key;
}

function requireModel(env) {
  const model = String(env?.OPENAI_MODEL ?? "").trim();
  if (!model) throw new Error("OPENAI_MODEL não configurado no Worker.");
  return model;
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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) throw new Error(data?.error?.message || data?.message || text || "Falha no OpenAI.");
  return data;
}

// =========================
// Modules
// =========================
function safeJsonParse(str, fallbackObj) {
  try {
    const obj = JSON.parse(String(str || ""));
    return obj && typeof obj === "object" ? obj : fallbackObj;
  } catch {
    return fallbackObj;
  }
}

async function handlePrioritize(env, body) {
  const model = requireModel(env);

  const method = cleanText(body?.method) || "impact_effort";
  const tasks = Array.isArray(body?.tasks) ? body.tasks : [];
  const name = cleanText(body?.name) || "Castelão";

  const payload = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Você é a PriorizAI. Retorne APENAS JSON válido e estrito no formato " +
          "{\"ordered_tasks\":[{\"position\":1,\"task_title\":\"...\"}]}.\n" +
          "Regras:\n" +
          "1) Ordene as tarefas do usuário do mais importante para o menos importante.\n" +
          "2) Use 'task_title' com um título curto e fiel ao título original.\n" +
          "3) 'position' deve começar em 1 e ser sequencial.\n" +
          "4) Não inclua explicações, nem textos fora do JSON.",
      },
      { role: "user", content: JSON.stringify({ name, method, tasks }) },
    ],
  };

  const out = await openaiChat(env, payload);
  const parsed = safeJsonParse(out?.choices?.[0]?.message?.content, { ordered_tasks: [] });

  const ordered = Array.isArray(parsed.ordered_tasks) ? parsed.ordered_tasks : [];
  const cleanOrdered = ordered
    .map((t, i) => ({
      position: Number.isFinite(Number(t?.position)) ? Number(t.position) : i + 1,
      task_title: cleanText(t?.task_title) || cleanText(t?.title) || "",
    }))
    .filter((t) => t.task_title);

  return { ordered_tasks: cleanOrdered };
}

async function handleCalmAI(env, body) {
  const model = requireModel(env);

  const name = cleanText(body?.name) || "Castelão";
  const tone = cleanText(body?.tone) || "calmo e objetivo";
  const text = cleanText(body?.text);

  const system =
    "Você é a CalmAI, uma assistente elegante e calma.\n" +
    "Objetivo: reescrever a mensagem do usuário para ficar mais calma, respeitosa e objetiva.\n" +
    "Regras:\n" +
    "1) Não copie o texto original literalmente.\n" +
    "2) Mantenha a intenção e os fatos.\n" +
    "3) Use frases curtas, pontuação simples e português do Brasil.\n" +
    "4) Evite emojis. Se usar, no máximo 1.\n" +
    "5) Não use markdown.\n" +
    "6) Retorne APENAS JSON válido e estrito no formato {\"rewritten_text\":\"...\"}.";

  const payload = {
    model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ name, tone, text }) },
    ],
  };

  const out = await openaiChat(env, payload);
  let parsed = safeJsonParse(out?.choices?.[0]?.message?.content, { rewritten_text: "" });
  let rewritten = cleanText(parsed?.rewritten_text);

  if (rewritten && normalizeLoose(rewritten) === normalizeLoose(text)) {
    const payload2 = {
      ...payload,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            system +
            "\nRegra extra: a saída deve ser claramente diferente do texto original, com nova redação.",
        },
        { role: "user", content: JSON.stringify({ name, tone, text }) },
      ],
    };
    const out2 = await openaiChat(env, payload2);
    parsed = safeJsonParse(out2?.choices?.[0]?.message?.content, { rewritten_text: "" });
    rewritten = cleanText(parsed?.rewritten_text);
  }

  return { rewritten_text: rewritten || "" };
}

function normalizeLoose(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

async function handleBriefAI(env, body) {
  const model = requireModel(env);

  const style = cleanText(body?.style) || "executivo";
  const name = cleanText(body?.name) || "Castelão";
  const text = cleanText(body?.text);

  const payload = {
    model,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Você é a BriefAI. Retorne APENAS JSON válido e estrito no formato " +
          "{\"summary\":\"...\",\"bullets\":[\"...\"]}.\n" +
          "Regras:\n" +
          "1) Escreva em português do Brasil, tom profissional.\n" +
          "2) 'summary' deve ter 2 a 4 frases curtas.\n" +
          "3) 'bullets' deve ter de 3 a 7 itens, cada um com no máximo 1 frase.\n" +
          "4) Não use markdown e não inclua textos fora do JSON.",
      },
      { role: "user", content: JSON.stringify({ name, style, text }) },
    ],
  };

  const out = await openaiChat(env, payload);
  const parsed = safeJsonParse(out?.choices?.[0]?.message?.content, { summary: "", bullets: [] });

  const summary = cleanText(parsed?.summary);
  const bullets = Array.isArray(parsed?.bullets)
    ? parsed.bullets.map((b) => cleanText(b)).filter(Boolean)
    : [];

  return { summary, bullets };
}
