/* worker/src/index.js - Cloudflare Worker (PriorizAI + CalmAI + BriefAI) */
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (request.method === "GET" && url.pathname === "/") {
        return json(
          {
            ok: true,
            service: "priorizai-worker",
            routes: ["POST /prioritize", "POST /calmai", "POST /briefai"],
          },
          200
        );
      }

      if (request.method === "POST" && url.pathname === "/prioritize") {
        return await handlePrioritize(request, env);
      }

      if (request.method === "POST" && url.pathname === "/calmai") {
        return await handleCalmai(request, env);
      }

      if (request.method === "POST" && url.pathname === "/briefai") {
        return await handleBriefai(request, env);
      }

      return json({ error: "Rota não encontrada." }, 404);
    } catch (err) {
      return json({ error: err?.message || "Erro inesperado." }, 500);
    }
  },
};

// =========================
// Infra
// =========================
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function readJson(request) {
  let payload = null;
  try {
    payload = await request.json();
  } catch {
    throw new Error("JSON inválido.");
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Body inválido.");
  }

  return payload;
}

function cleanText(text) {
  return String(text || "").replace(/\u0000/g, "").trim();
}

function looksLikeInjection(text) {
  const t = cleanText(text).toLowerCase();

  const xss = ["<script", "</script", "<iframe", "<object", "<embed", "<svg", "javascript:", "onerror=", "onload="];
  if (xss.some((p) => t.includes(p))) return true;

  const sqli = [
    " union select",
    "drop table",
    "insert into",
    "delete from",
    "update ",
    " or 1=1",
    "' or '1'='1",
    '" or "1"="1',
    "--",
    "/*",
    "*/",
  ];

  return sqli.some((p) => t.includes(p));
}

function mustBeString(name, value, { required = false, min = 0, max = 9999 } = {}) {
  const v = cleanText(value);

  if (required && !v) throw new Error(`Preencha: ${name}.`);
  if (!required && !v) return "";

  if (v.length < min) throw new Error(`${name} muito curto.`);
  if (v.length > max) throw new Error(`${name} passou do limite de caracteres.`);
  if (looksLikeInjection(v)) throw new Error(`${name} parece ter conteúdo perigoso.`);

  return v;
}

function mustBeInt(name, value, { min = 0, max = 999999 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${name} inválido.`);
  if (n < min || n > max) throw new Error(`${name} fora do intervalo.`);
  return n;
}

function requireOpenAIKey(env) {
  const key = env?.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY não configurada no Worker.");
  return key;
}

async function openaiChat(env, payload) {
  const apiKey = requireOpenAIKey(env);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = data?.error?.message || "Erro na chamada da OpenAI.";
    throw new Error(msg);
  }

  return data;
}

function removeQuestionMarksDeep(value) {
  const strip = (s) => cleanText(String(s || "")).replace(/\?/g, "").replace(/[\s]+$/g, "").trim();

  if (typeof value === "string") return strip(value);
  if (Array.isArray(value)) return value.map((item) => removeQuestionMarksDeep(item));

  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = removeQuestionMarksDeep(value[key]);
    }
    return out;
  }

  return value;
}

// =========================
// /prioritize
// =========================
async function handlePrioritize(request, env) {
  const body = await readJson(request);

  const name = mustBeString("Seu nome", body.name, { required: true, min: 2, max: 60 });
  const method = mustBeString("Método", body.method, { required: true, min: 3, max: 40 });

  if (method !== "impact_effort") {
    return json({ error: "Por enquanto, só o método Impacto e Esforço está liberado." }, 400);
  }

  if (!Array.isArray(body.tasks)) {
    return json({ error: "tasks deve ser uma lista." }, 400);
  }

  const tasksRaw = body.tasks.slice(0, 10);
  if (tasksRaw.length < 3) {
    return json({ error: "Envie no mínimo 3 tarefas." }, 400);
  }

  const tasks = tasksRaw.map((task, idx) => {
    const title = mustBeString(`Tarefa ${idx + 1} - título`, task.title, {
      required: true,
      min: 3,
      max: 80,
    });

    const description = mustBeString(`Tarefa ${idx + 1} - descrição`, task.description, {
      required: true,
      min: 10,
      max: 800,
    });

    const importance = mustBeInt(`Tarefa ${idx + 1} - importância`, task.importance, { min: 1, max: 5 });
    const time_cost = mustBeInt(`Tarefa ${idx + 1} - tempo`, task.time_cost, { min: 1, max: 5 });

    const importance_label = mustBeString(`Tarefa ${idx + 1} - rótulo importância`, task.importance_label, {
      required: true,
      min: 2,
      max: 60,
    });

    const time_label = mustBeString(`Tarefa ${idx + 1} - rótulo tempo`, task.time_label, {
      required: true,
      min: 2,
      max: 60,
    });

    return { title, description, importance, time_cost, importance_label, time_label };
  });

  const model = env?.OPENAI_MODEL || "gpt-4o-mini";

  const system = [
    "Você é o PriorizAI.",
    "Linguagem simples, direta e útil.",
    "Use o nome do usuário.",
    "Analise título, descrição, importância e tempo.",
    "Se houver incoerência entre nota e descrição, ajuste a análise com cuidado.",
    "Não invente fatos externos.",
    "Retorne somente JSON válido no schema enviado.",
  ].join(" ");

  const schema = {
    name: "PriorizeResult",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["friendly_message", "method_used", "estimated_time_saved_percent", "summary", "ordered_tasks"],
      properties: {
        friendly_message: { type: "string" },
        method_used: { type: "string" },
        estimated_time_saved_percent: { type: "integer", minimum: 0, maximum: 80 },
        summary: { type: "string" },
        ordered_tasks: {
          type: "array",
          minItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["position", "task_title", "explanation", "key_points", "tip"],
            properties: {
              position: { type: "integer", minimum: 1, maximum: 10 },
              task_title: { type: "string" },
              explanation: { type: "string" },
              key_points: {
                type: "array",
                minItems: 2,
                maxItems: 4,
                items: { type: "string" },
              },
              tip: { type: "string" },
            },
          },
        },
      },
    },
  };

  const user = {
    name,
    method,
    rules: [
      "Priorize por impacto e esforço.",
      "Quanto mais importante e mais rápido, maior prioridade.",
      "Urgência na descrição pesa na decisão.",
      "Explique de forma simples.",
    ],
    tasks,
  };

  const payload = {
    model,
    temperature: 0.6,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: schema,
    },
  };

  const out = await openaiChat(env, payload);
  const content = out?.choices?.[0]?.message?.content;

  if (!content) throw new Error("Resposta vazia da OpenAI.");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Não foi possível interpretar o JSON retornado.");
  }

  return json(parsed, 200);
}

// =========================
// /calmai
// =========================
async function handleCalmai(request, env) {
  const body = await readJson(request);

  const name = mustBeString("Seu nome", body.name, { required: true, min: 2, max: 60 });
  const text = mustBeString("Texto", body.text, { required: true, min: 10, max: 500 });

  const model = env?.OPENAI_MODEL || "gpt-4o-mini";

  const system = [
    "Você é a Diva do Caos.",
    "Tom divertido, direto e inteligente.",
    "Entregue conselho útil com uma pitada de humor.",
    "Não invente fatos.",
    "Termine com uma pergunta curta e provocante.",
  ].join(" ");

  const prompt = `Nome: ${name}\nProblema: ${text}`;

  const payload = {
    model,
    temperature: 0.9,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };

  const out = await openaiChat(env, payload);
  const reply = cleanText(out?.choices?.[0]?.message?.content);

  if (!reply) throw new Error("Resposta vazia da OpenAI.");

  return json({ reply }, 200);
}

// =========================
// /briefai
// =========================
async function handleBriefai(request, env) {
  const body = await readJson(request);

  const name = mustBeString("Seu nome", body.name, { required: true, min: 2, max: 60 });
  const text = mustBeString("Seu texto", body.text, { required: true, min: 20, max: 1500 });

  const model = env?.OPENAI_MODEL || "gpt-4o-mini";

  const system = [
    "Você é o BriefAI.",
    "Use linguagem simples, direta e objetiva.",
    "Não use perguntas e não use ponto de interrogação.",
    "Não invente fatos externos.",
    "Retorne somente JSON no schema definido.",
  ].join(" ");

  const schema = {
    name: "BriefAIResponse",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["friendlyMessage", "summary", "brief", "missingInfo", "nextSteps"],
      properties: {
        friendlyMessage: { type: "string" },
        summary: { type: "string" },
        brief: { type: "string" },
        missingInfo: {
          type: "array",
          minItems: 0,
          maxItems: 10,
          items: { type: "string" },
        },
        nextSteps: {
          type: "array",
          minItems: 0,
          maxItems: 10,
          items: { type: "string" },
        },
      },
    },
  };

  const user = {
    name,
    text,
    output_rules: [
      "friendlyMessage com 1 a 2 frases.",
      "summary em 4 a 7 linhas curtas.",
      "brief com blocos: Contexto, Objetivo, O que está acontecendo, Restrições e riscos, Plano de ação curto.",
      "missingInfo sem perguntas.",
      "nextSteps sem perguntas.",
    ],
  };

  const payload = {
    model,
    temperature: 0.5,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: schema,
    },
  };

  const out = await openaiChat(env, payload);
  const content = out?.choices?.[0]?.message?.content;

  if (!content) throw new Error("Resposta vazia da OpenAI.");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Não foi possível interpretar o JSON retornado.");
  }

  parsed = removeQuestionMarksDeep(parsed);

  return json(parsed, 200);
}
