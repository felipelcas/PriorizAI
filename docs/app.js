// Shared front-end logic for PriorizAI, CalmAI and BriefAI
// Works with standalone pages: priorizai.html, calmai.html, briefai.html

const WORKER_BASE_URL = "https://priorizai.felipelcas.workers.dev";

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function callAPI(endpoint, payload) {
  const resp = await fetch(`${WORKER_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });

  const json = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const code = json?.code || "";
    if (resp.status === 429 || code === "RATE_LIMITED") {
      const limit = Number(json?.limit ?? 5);
      throw new Error(`Limite diário atingido (${limit} usos/dia). Tente novamente amanhã.`);
    }
    throw new Error(json?.error || json?.message || "Erro ao processar.");
  }

  return json?.data ?? json;
}

function nowBR() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function initPriorizai() {
  let taskCount = 3;
  const MAX_TASKS = 10;
  let isBusy = false;

  function setBusy(busy) {
    isBusy = busy;
    const btn = $("processBtn");
    if (!btn) return;
    btn.disabled = busy;
    btn.style.opacity = busy ? ".45" : "1";
    const label = btn.querySelector("span:last-child");
    if (label) label.textContent = busy ? "Processando..." : "Bora!! PriorizAI";
  }

  function createTaskItem(index) {
    const el = document.createElement("div");
    el.className = "task-item";
    el.innerHTML = `
      <div class="task-item-top">
        <span class="task-num">Task ${String(index).padStart(2, "0")}</span>
        <button class="task-remove" type="button" title="Remover tarefa">×</button>
      </div>
      <div class="form-group">
        <label>O que você precisa fazer? <span class="req">*</span></label>
        <input type="text" class="task-title" placeholder="Ex: Revisar proposta do cliente">
      </div>
      <div class="form-group">
        <label>Dê mais detalhes para te ajudar melhor <span class="req">*</span></label>
        <textarea class="task-desc" placeholder="Ex: Preciso revisar a mensagem de resposta rápida e padronizar um texto claro..."></textarea>
      </div>
      <div class="row-2">
        <div class="form-group">
          <label>Importância <span class="help-dot" style="font-size:.6rem;width:15px;height:15px" title="Pense no impacto. Prazo aumenta a importância.">?</span></label>
          <select class="task-importance">
            <option value="1">Pode esperar</option>
            <option value="2">Fazer quando der</option>
            <option value="3" selected>Preciso planejar</option>
            <option value="4">Preciso fazer logo</option>
            <option value="5">Urgente!!</option>
          </select>
        </div>
        <div class="form-group">
          <label>Tempo estimado <span class="help-dot" style="font-size:.6rem;width:15px;height:15px" title="Quanto tempo vai levar para concluir?">?</span></label>
          <select class="task-time">
            <option value="1">Menos de 10 min</option>
            <option value="2" selected>10 a 30 min</option>
            <option value="3">30 min a 2h</option>
            <option value="4">2 a 6h</option>
            <option value="5">Mais de 6h</option>
          </select>
        </div>
      </div>`;

    el.querySelector(".task-remove")?.addEventListener("click", () => {
      if (document.querySelectorAll("#taskList .task-item").length > 1) {
        el.remove();
        taskCount--;
        renumber();
        updateCounter();
      }
    });

    return el;
  }

  function renumber() {
    document.querySelectorAll("#taskList .task-item").forEach((item, i) => {
      const num = item.querySelector(".task-num");
      if (num) num.textContent = `Task ${String(i + 1).padStart(2, "0")}`;
    });
  }

  function updateCounter() {
    const counter = $("taskCounter");
    if (counter) counter.textContent = `${taskCount} / ${MAX_TASKS}`;
    const addBtn = $("addTaskBtn");
    if (addBtn) addBtn.disabled = taskCount >= MAX_TASKS;
  }

  function getTasksPayload() {
    return Array.from(document.querySelectorAll("#taskList .task-item"))
      .map((item) => {
        const impEl = item.querySelector(".task-importance");
        const timeEl = item.querySelector(".task-time");
        return {
          title: item.querySelector(".task-title")?.value?.trim() || "",
          description: item.querySelector(".task-desc")?.value?.trim() || "",
          importance: parseInt(impEl?.value || "3", 10),
          time_cost: parseInt(timeEl?.value || "2", 10),
          importance_label: impEl?.options?.[impEl.selectedIndex]?.text || "",
          time_label: timeEl?.options?.[timeEl.selectedIndex]?.text || "",
        };
      })
      .filter((t) => t.title && t.description);
  }

  function showLoading() {
    const el = $("resultsContainer");
    if (!el) return;
    el.innerHTML = `
      <div class="result-loading">
        <div class="spinner"></div>
        <div class="loading-label">Processando com IA...</div>
        <div class="loading-sub">analisando · priorizando · explicando</div>
      </div>`;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showError(msg) {
    const el = $("resultsContainer");
    if (!el) return;
    el.innerHTML = `
      <div class="result-error">
        <div class="result-error-title">⚠️ Ops, algo deu errado</div>
        <div class="result-error-msg">${escapeHtml(msg)}</div>
      </div>`;
  }

  function renderResults(data) {
    const el = $("resultsContainer");
    if (!el) return;

    const ordered = Array.isArray(data?.ordered_tasks) ? data.ordered_tasks : [];
    if (!ordered.length) {
      showError("Sem retorno válido da IA.");
      return;
    }

    const tableRows = ordered
      .map(
        (t) => `
        <tr>
          <td class="td-rank">${escapeHtml(String(t.position))}</td>
          <td>${escapeHtml(t.task_title)}</td>
        </tr>`
      )
      .join("");

    const ranked = ordered
      .map(
        (task) => `
        <div class="ranked-item">
          <div class="ranked-head">
            <div class="rank-num">${escapeHtml(String(task.position))}</div>
            <div class="rank-title">${escapeHtml(task.task_title)}</div>
          </div>
          ${task.explanation ? `<div class="rank-expl">${escapeHtml(task.explanation)}</div>` : ""}
          ${Array.isArray(task.key_points) && task.key_points.length ? `
            <ul class="key-points">${task.key_points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : ""}
          ${task.tip ? `<div class="rank-tip">${escapeHtml(task.tip)}</div>` : ""}
        </div>`
      )
      .join("");

    const stat =
      data?.estimated_time_saved_percent != null
        ? `<div class="res-stat">📊 Tempo economizado: ${escapeHtml(String(data.estimated_time_saved_percent))}%</div>`
        : "";

    el.innerHTML = `
      <div class="res-header">
        <div class="res-msg">${escapeHtml(data.friendly_message || "Priorização concluída!")}</div>
        ${data.summary ? `<div class="res-sum">${escapeHtml(data.summary)}</div>` : ""}
        ${stat}
      </div>
      <table class="order-table">
        <thead><tr><th style="width:60px">Ordem</th><th>Tarefa</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="ranked-list">${ranked}</div>`;
  }

  async function process() {
    if (isBusy) return;

    const name = $("userName")?.value?.trim() || "";
    if (!name) {
      alert("Por favor, preencha seu nome.");
      return;
    }

    const tasks = getTasksPayload();
    if (tasks.length < 3) {
      alert("Preencha no mínimo 3 tarefas completas (título + detalhes).");
      return;
    }

    const method = document.querySelector(".method-card.active")?.dataset?.method || "impact_effort";

    showLoading();
    setBusy(true);

    try {
      const data = await callAPI("/prioritize", { name, method, tasks });
      renderResults(data);
    } catch (err) {
      showError(err?.message || "Erro ao processar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  // bind method cards
  document.querySelectorAll(".method-card:not(.disabled)").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".method-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
    });
  });

  const list = $("taskList");
  if (list) {
    for (let i = 0; i < taskCount; i++) {
      list.appendChild(createTaskItem(i + 1));
    }
  }
  updateCounter();

  $("addTaskBtn")?.addEventListener("click", () => {
    if (!list || taskCount >= MAX_TASKS) return;
    taskCount++;
    list.appendChild(createTaskItem(taskCount));
    renumber();
    updateCounter();
  });

  $("processBtn")?.addEventListener("click", process);
}

function initCalmai() {
  let isBusy = false;
  const MAX_CHARS = 500; // alinhado ao Worker atual

  function setBusy(busy) {
    isBusy = busy;
    const btn = $("processBtn");
    if (!btn) return;
    btn.disabled = busy;
    btn.style.opacity = busy ? ".45" : "1";
    const label = btn.querySelector("span:last-child");
    if (label) label.textContent = busy ? "A Diva está pensando..." : "Conversar com a Diva";
    const emoji = btn.querySelector(".btn-emoji");
    if (emoji) emoji.style.animationPlayState = busy ? "paused" : "running";
  }

  const textEl = $("userText");
  textEl?.addEventListener("input", function () {
    if (this.value.length > MAX_CHARS) this.value = this.value.slice(0, MAX_CHARS);
    const len = this.value.length;
    const counter = $("charCount");
    if (counter) {
      counter.textContent = `${len} / ${MAX_CHARS}`;
      counter.classList.toggle("warn", len > Math.floor(MAX_CHARS * 0.9));
    }
  });

  function showLoading() {
    $("idlePanel") && ($("idlePanel").style.display = "none");
    $("resultPanel")?.classList.add("visible");
    const body = $("resultBody");
    if (!body) return;
    body.innerHTML = `
      <div class="result-loading">
        <div class="diva-spinner">💅</div>
        <div class="loading-label">A Diva está elaborando sua resposta...</div>
        <div class="loading-sub">paciência · elegância · drama calculado</div>
      </div>`;
    $("resultPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showError(msg) {
    const body = $("resultBody");
    if (!body) return;
    body.innerHTML = `
      <div class="result-error">
        <div class="result-error-title">😤 Ops — até a Diva tem limites</div>
        <div class="result-error-msg">${escapeHtml(msg)}</div>
      </div>`;
  }

  function renderReply(data) {
    const raw = (data?.reply || data?.rewritten_text || "").trim();
    if (!raw) {
      showError("A Diva ficou em silêncio. Tente novamente.");
      return;
    }
    const html = raw
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => `<p>${escapeHtml(l)}</p>`)
      .join("");
    const body = $("resultBody");
    if (body) body.innerHTML = `<div class="reply-bubble">${html}</div>`;
  }

  async function process() {
    if (isBusy) return;

    const name = $("userName")?.value?.trim() || "";
    const text = $("userText")?.value?.trim() || "";

    if (!name) {
      alert("Docinho, me diz seu nome antes, tá bom? 💜");
      $("userName")?.focus();
      return;
    }
    if (!text || text.length < 10) {
      alert("Solta a bomba. Preciso de pelo menos 10 caracteres para trabalhar. 😏");
      $("userText")?.focus();
      return;
    }

    showLoading();
    setBusy(true);

    try {
      const data = await callAPI("/calmai", { name, text });
      renderReply(data);
    } catch (err) {
      showError(err?.message || "Algo deu errado. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  $("processBtn")?.addEventListener("click", process);
  $("userName")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("userText")?.focus();
    }
  });
}

function initBriefai() {
  let isBusy = false;
  const MAX_CHARS = 4000;

  function setBusy(busy) {
    isBusy = busy;
    const btn = $("processBtn");
    if (!btn) return;
    btn.disabled = busy;
    btn.style.opacity = busy ? ".45" : "1";
    const label = btn.querySelector("span:last-child");
    if (label) label.textContent = busy ? "Gerando briefing..." : "Gerar Briefing";
  }

  const textEl = $("userText");
  textEl?.addEventListener("input", function () {
    if (this.value.length > MAX_CHARS) this.value = this.value.slice(0, MAX_CHARS);
    const len = this.value.length;
    const el = $("charCount");
    if (el) {
      el.textContent = `${len} / ${MAX_CHARS}`;
      el.classList.toggle("warn", len > 3600);
    }
  });

  function showLoading() {
    const preview = $("previewCard");
    if (preview) preview.style.display = "none";
    $("resultPanel")?.classList.add("visible");

    const docTitle = $("docTitle");
    const docSummary = $("docSummary");
    const genTime = $("genTime");
    const docBody = $("docBody");

    if (docTitle) docTitle.textContent = "Estruturando seu briefing…";
    if (docSummary) docSummary.textContent = "";
    if (genTime) genTime.textContent = "";
    if (docBody) {
      docBody.innerHTML = `
        <div class="result-loading">
          <div class="spinner-wrap">
            <div class="spinner-outer"></div>
            <div class="spinner-inner"></div>
          </div>
          <div class="loading-label">Analisando seu texto…</div>
          <div class="loading-steps">
            <div class="loading-step active">→ lendo contexto</div>
            <div class="loading-step">→ identificando estrutura</div>
            <div class="loading-step">→ montando briefing</div>
          </div>
        </div>`;
    }

    $("resultPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showError(msg) {
    const docTitle = $("docTitle");
    const docBody = $("docBody");
    if (docTitle) docTitle.textContent = "Algo deu errado";
    if (docBody) {
      docBody.innerHTML = `
        <div class="result-error">
          <div class="result-error-title">⚠️ Erro ao processar</div>
          <div class="result-error-msg">${escapeHtml(msg)}</div>
        </div>`;
    }
  }

  function renderResult(data) {
    const docTitle = $("docTitle");
    const docSummary = $("docSummary");
    const genTime = $("genTime");
    const docBody = $("docBody");

    if (docTitle) docTitle.textContent = data?.friendlyMessage || "Briefing gerado com sucesso!";
    if (docSummary) docSummary.textContent = data?.summary || "";
    if (genTime) genTime.textContent = nowBR();

    let html = "";

    const brief = (data?.brief || data?.structured_brief || "").trim();
    if (brief) {
      html += `
        <div class="doc-section brief">
          <div class="doc-section-head">
            <span class="doc-section-title">📋 Briefing Estruturado</span>
          </div>
          <div class="doc-section-content">${escapeHtml(brief)}</div>
        </div>`;
    }

    const missing = Array.isArray(data?.missingInfo) ? data.missingInfo : [];
    if (missing.length) {
      html += `
        <div class="doc-section missing">
          <div class="doc-section-head">
            <span class="doc-section-title">🔍 Informações que Faltam</span>
          </div>
          <ul class="missing-list">
            ${missing.map((item, i) => `<li style="animation-delay:${i * 0.07}s">${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>`;
    }

    const steps = Array.isArray(data?.nextSteps) ? data.nextSteps : [];
    if (steps.length) {
      html += `
        <div class="doc-section steps">
          <div class="doc-section-head">
            <span class="doc-section-title">🎯 Próximos Passos</span>
          </div>
          <ul class="steps-list">
            ${steps.map((item, i) => `
              <li style="animation-delay:${i * 0.07}s">
                <span class="step-num">${String(i + 1).padStart(2, "0")}.</span>
                <span>${escapeHtml(item)}</span>
              </li>`).join("")}
          </ul>
        </div>`;
    }

    if (!html) {
      html = `
        <div class="result-error">
          <div class="result-error-title">Retorno inesperado</div>
          <div class="result-error-msg">A IA retornou uma resposta vazia. Tente novamente com um texto diferente.</div>
        </div>`;
    }

    if (docBody) docBody.innerHTML = html;
  }

  async function process() {
    if (isBusy) return;

    const name = $("userName")?.value?.trim() || "";
    const text = $("userText")?.value?.trim() || "";

    if (!name) {
      alert("Por favor, preencha seu nome antes de continuar.");
      $("userName")?.focus();
      return;
    }
    if (!text || text.length < 20) {
      alert("Por favor, escreva pelo menos 20 caracteres para gerar um briefing.");
      $("userText")?.focus();
      return;
    }

    showLoading();
    setBusy(true);

    try {
      const data = await callAPI("/briefai", { name, text });
      renderResult(data);
    } catch (err) {
      showError(err?.message || "Erro desconhecido. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  $("processBtn")?.addEventListener("click", process);
  $("userName")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("userText")?.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const moduleName = (document.body?.dataset?.module || "").toLowerCase();

  if (moduleName === "priorizai") return initPriorizai();
  if (moduleName === "calmai") return initCalmai();
  if (moduleName === "briefai") return initBriefai();
});
