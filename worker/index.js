export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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

    const body = await request.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: "JSON inválido" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const userName = String(body.userName || "").trim();
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];

    const filled = tasks
      .map((t) => ({
        title: String(t.title || "").trim(),
        description: String(t.description || "").trim(),
        importance: Number(t.importance),
        effort: Number(t.effort),
      }))
      .filter((t) => t.title && t.description);

    if (!userName) {
      return new Response(JSON.stringify({ error: "Informe seu nome." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (filled.length < 3) {
      return new Response(JSON.stringify({ error: "Preencha no mínimo 3 tarefas completas." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY não configurada no Worker." }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const system = `
Você é o PriorizAI.
Fale simples, direto e amigável.
Use também a descrição para ajustar a análise se o usuário escolheu números incoerentes.
Não invente fatos externos.
Retorne APENAS JSON.
`.trim();

    const user = `
Nome: ${userName}
Método: IMPACT_EFFORT

Regras:
- Faça primeiro o que ajuda mais e leva menos tempo.
- Se a descrição indicar prazo/urgência, considere isso.
- Dê dicas práticas.

Tarefas (JSON):
${JSON.stringify(filled)}
`.trim();

    const schema = {
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
            items: {
              type: "object",
              additionalProperties: false,
              required: ["position", "title", "explanation", "keyPoints", "tip"],
              properties: {
                position: { type: "integer", minimum: 1, maximum: 10 },
                title: { type: "string" },
                explanation: { type: "string" },
                keyPoints: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
                tip: { type: "string" },
              },
            },
          },
        },
      },
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
        response_format: { type: "json_schema", json_schema: schema },
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "Erro na IA", details: data }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const content = data?.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return new Response(JSON.stringify({ error: "IA não retornou JSON válido.", raw: content }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
