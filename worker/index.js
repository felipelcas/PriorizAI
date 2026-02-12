export default {
  async fetch(request, env) {
    // CORS
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname !== "/prioritize") {
      return new Response("Not Found", { status: 404, headers: cors });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "JSON inválido" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const clampInt = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      const i = Math.round(n);
      if (i < min) return min;
      if (i > max) return max;
      return i;
    };

    const normalizeMethod = (m) => {
      const raw = String(m || "").trim().toUpperCase();
      const allowed = new Set(["IMPACT_EFFORT", "RICE", "MOSCOW", "GUT"]);
      if (allowed.has(raw)) return raw;
      return "IMPACT_EFFORT";
    };

    const userName = String(body.userName || "").trim();
    const method = normalizeMethod(body.method);
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];

    // Aceita "time" (front atual) e também "effort" (compatibilidade)
    const filled = tasks
      .map((t) => {
        const title = String(t.title || "").trim();
        const description = String(t.description || "").trim();

        const importance = clampInt(t.importance, 1, 5, 3);

        // Compat: se vier effort, usa. Se vier time, usa.
        const time = clampInt(
          t.time ?? t.effort,
          1,
          5,
          3
        );

        return { title, description, importance, time };
      })
      .filter((t) => t.title && t.description);

    if (!userName) {
      return new Response(JSON.stringify({ error: "Informe seu nome." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (filled.length < 3) {
      return new Response(
        JSON.stringify({ error: "Preencha no mínimo 3 tarefas completas." }),
        {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        }
      );
    }

    if (!env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY não configurada no Worker." }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        }
      );
    }

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const system = `
Você é o PriorizAI.
Fale simples, direto e amigável.
O usuário pode escolher importância e tempo errado. Então use também a descrição para ajustar sua análise com carinho.
Não invente fatos externos. Use só o que foi informado.
Retorne APENAS JSON no schema.
`.trim();

    const rule = `
Método Impacto e Esforço:
- Faça primeiro o que ajuda mais e leva menos tempo.
- Se algo é muito importante (prazo, gente depende, risco alto), pode subir mesmo sendo demorado.
- Coisas pouco importantes e demoradas ficam por último.
`.trim();

    const user = `
Nome: ${userName}
Método: ${method}

Como aplicar:
${rule}

Tarefas (JSON):
${JSON.stringify(filled)}

Regras da resposta:
- Use também a descrição para estimar o tempo real e a importância real.
- Se a descrição indicar algo diferente do número, ajuste sem julgar.
- Traga dicas práticas.
- estimatedTimeSaved: inteiro de 0 a 80, realista.
`.trim();

    const jsonSchema = {
      name: "priorizai_result",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["friendlyMessage", "summary", "estimatedTimeSaved", "rankedTasks"],
        properties: {
          friendlyMessage: { type: "string" },
          summary: { type: "string" },
          estimatedTimeSaved: { type: "integer", minimum: 0, maximum: 80 },
          rankedTasks: {
            type: "array",
            minItems: 3,
            maxItems: 10,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["position", "title", "explanation", "keyPoints", "tip"],
              properties: {
                position: { type: "integer", minimum: 1, maximum: 10 },
                title: { type: "string" },
                explanation: { type: "string" },
                keyPoints: {
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

    let resp;
    try {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_schema", json_schema: jsonSchema },
        }),
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Falha de rede ao chamar a IA." }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: "Erro na IA", details: data }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const content = data?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return new Response(
        JSON.stringify({ error: "A IA não retornou JSON válido.", raw: content }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
