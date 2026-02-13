/* app.js - PriorizAI + CalmAI + BriefAI */
(() => {
  "use strict";

  // =========================
  // Configuração
  // =========================
  const WORKER_BASE_URL = "https://priorizai.felipelcas.workers.dev";
  const BASE = normalizeBaseUrl(WORKER_BASE_URL);

  const ENDPOINTS = {
    prioritize: `${BASE}/prioritize`,
    calmai: `${BASE}/calmai`,
    briefai: `${BASE}/briefai`,
  };

  const LIMITS = {
    minTasks: 3,
    maxTasks: 10,
    calmMax: 500,
    briefMax: 1500,
  };

  const IMPORTANCE = [
    { value: 1, label: "Quase não importa" },
    { value: 2, label: "Importa pouco" },
    { value: 3, label: "Importa" },
    { value: 4, label: "Importa muito" },
    { value: 5, label: "É crítico, não dá para adiar" },
  ];

  const TIME_COST = [
    { value: 1, label: "Menos de 10 min" },
    { value: 2, label: "10 a 30 min" },
    { value: 3, label: "30 min a 2 horas" },
    { value: 4, label: "2 a 6 horas" },
    { value: 5, label: "Mais de 6 horas" },
  ];

  // =========================
  // Estado
  // =========================
  const state = {
    selectedMethod: "impact_effort",
    taskCount: 0,
    pending: {
      prioritize: false,
      calm: false,
      brief: false,
    },
  };

  // =========================
  // Helpers
  // =========================
  const byId = (id) => document.getElementById(id);

  function normalizeBaseUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return withProtocol.replace(/\/+$/, "");
  }

  function cleanText(value) {
    return String(value || "").replace(/\u0000/g, "").trim();
  }

  function looksLikeInjection(text) {
    const t = String(text || "").toLowerCase();

    const xssPatterns = [
      "<script",
      "</script",
      "<iframe",
      "<object",
      "<embed",
      "<svg",
      "javascript:",
      "onerror=",
      "onload=",
    ];

    if (xssPatterns.some((p) => t.includes(p))) return true;

    const sqlPatterns = [
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

    return sqlPatterns.some((p) => t.includes(p));
  }

  function requireSafeText(field, value, { required = false, min = 0, max = 9999 } = {}) {
    const v = cleanText(value);

    if (required && !v) throw new Error(`Preencha: ${field}.`);
    if (!required && !v) return "";

    if (v.length < min) throw new Error(`${field} está muito curto.`);
    if (v.length > max) throw new Error(`${field} passou do limite de caracteres.`);
    if (looksLikeInjection(v)) throw new Error(`${field} parece ter conteúdo perigoso. Ajuste o texto.`);

    return v;
  }

  function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function optionLabel(list, value) {
    const n = Number(value);
    const found = list.find((x) => x.value === n);
    return found ? found.label : "";
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setDisabled(id, isDisabled) {
    const el = byId(id);
    if (el) el.disabled = Boolean(isDisabled);
  }

  function setBusy(buttonId, pendingFlag, labelBusy, labelDefault) {
    const btn = byId(buttonId);
    if (!btn) return;

    state.pending[pendingFlag] = !state.pending[pendingFlag];
    const busy = state.pending[pendingFlag];
    btn.disabled = busy;

    const span = btn.querySelector("span");
    if (span) span.textContent = busy ? labelBusy : labelDefault;
  }

  // =========================
  // Tabs
  // =========================
  function setActiveTab(tab) {
    document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    const views = {
      priorizai: byId("viewPriorizai"),
      calmai: byId("viewCalmai"),
      briefai: byId("viewBriefai"),
    };

    Object.entries(views).forEach(([key, node]) => {
      if (!node) return;
      node.style.display = key === tab ? "grid" : "none";
    });

    scrollToTop();
  }

  function initTabs() {
    document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        setActiveTab(btn.dataset.tab || "priorizai");
      });
    });
  }

  // =========================
  // Método
  // =========================
  function initMethodCards() {
    const cards = Array.from(document.querySelectorAll(".method-card"));

    cards.forEach((card) => {
      card.addEventListener("click", () => {
        if (card.classList.contains("disabled")) return;

        cards.forEach((c) => c.classList.remove("active"));
        card.classList.add("active");

        const method = card.dataset.method || "impact";
        state.selectedMethod = method === "impact" ? "impact_effort" : "impact_effort";
      });
    });
  }

  // =========================
  // Render utilitário
  // =========================
  function renderLoading(container, text) {
    container.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "loading";

    const spinner = document.createElement("div");
    spinner.className = "spinner";

    const message = document.createElement("div");
    message.className = "loading-text";
    message.textContent = text;

    wrap.appendChild(spinner);
    wrap.appendChild(message);
    container.appendChild(wrap);
  }

  function renderError(container, message) {
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "result-header";

    const title = document.createElement("div");
    title.className = "result-message";
    title.textContent = "Ops. Deu problema.";

    const desc = document.createElement("div");
    desc.className = "result-summary";
    desc.textContent = String(message || "Erro inesperado.");

    header.appendChild(title);
    header.appendChild(desc);

    container.appendChild(header);
  }

  // =========================
  // Tarefas
  // =========================
  function makeOption(value, label) {
    const opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = label;
    return opt;
  }

  function makeTooltipIcon(title) {
    const span = document.createElement("span");
    span.className = "tooltip-icon";
    span.title = title;
    span.textContent = "?";
    return span;
  }

  function createTaskItem(index) {
    const item = document.createElement("div");
    item.className = "task-item";
    item.dataset.index = String(index);

    const header = document.createElement("div");
    header.className = "task-header";
    header.textContent = `Tarefa ${index}`;
    item.appendChild(header);

    // Título
    const g1 = document.createElement("div");
    g1.className = "form-group";

    const l1 = document.createElement("label");
    l1.textContent = "O que você vai fazer ";
    const req1 = document.createElement("span");
    req1.className = "required";
    req1.textContent = "*";
    l1.appendChild(req1);

    const title = document.createElement("input");
    title.type = "text";
    title.id = `taskTitle_${index}`;
    title.placeholder = "Ex.: Enviar planilha para o fornecedor (até 16h)";

    g1.appendChild(l1);
    g1.appendChild(title);
    item.appendChild(g1);

    // Descrição
    const g2 = document.createElement("div");
    g2.className = "form-group";

    const l2 = document.createElement("label");
    l2.textContent = "Explique bem ";
    const req2 = document.createElement("span");
    req2.className = "required";
    req2.textContent = "*";
    l2.appendChild(req2);

    const desc = document.createElement("textarea");
    desc.id = `taskDesc_${index}`;
    desc.maxLength = 800;
    desc.placeholder =
      "Ex.: Enviar a planilha X para o fornecedor Y até 16h. Se atrasar, o pedido de amanhã pode travar. Depende de mim e de mais 1 pessoa.";

    g2.appendChild(l2);
    g2.appendChild(desc);
    item.appendChild(g2);

    // Escalas
    const two = document.createElement("div");
    two.className = "two-col";

    const g3 = document.createElement("div");
    g3.className = "form-group";

    const l3 = document.createElement("label");
    l3.textContent = "Quão importante isso é agora ";
    l3.appendChild(makeTooltipIcon("Pense no impacto do atraso e no valor da entrega."));

    const imp = document.createElement("select");
    imp.id = `taskImp_${index}`;
    IMPORTANCE.forEach((x) => imp.appendChild(makeOption(x.value, x.label)));
    imp.value = "3";

    g3.appendChild(l3);
    g3.appendChild(imp);

    const g4 = document.createElement("div");
    g4.className = "form-group";

    const l4 = document.createElement("label");
    l4.textContent = "Quanto tempo isso leva ";
    l4.appendChild(makeTooltipIcon("Escolha o tempo total real, sem otimizar demais."));

    const time = document.createElement("select");
    time.id = `taskTime_${index}`;
    TIME_COST.forEach((x) => time.appendChild(makeOption(x.value, x.label)));
    time.value = "2";

    g4.appendChild(l4);
    g4.appendChild(time);

    two.appendChild(g3);
    two.appendChild(g4);
    item.appendChild(two);

    return item;
  }

  function updateTaskCounter() {
    const counter = byId("taskCounter");
    if (counter) counter.textContent = `${state.taskCount}/${LIMITS.maxTasks}`;

    const addBtn = byId("addTaskBtn");
    if (addBtn) addBtn.disabled = state.taskCount >= LIMITS.maxTasks;
  }

  function ensureInitialTasks() {
    const container = byId("tasksContainer");
    if (!container) return;

    container.innerHTML = "";
    state.taskCount = 0;

    for (let i = 1; i <= LIMITS.minTasks; i += 1) {
      state.taskCount += 1;
      container.appendChild(createTaskItem(state.taskCount));
    }

    updateTaskCounter();
  }

  function addTask() {
    if (state.taskCount >= LIMITS.maxTasks) return;

    const container = byId("tasksContainer");
    if (!container) return;

    state.taskCount += 1;
    container.appendChild(createTaskItem(state.taskCount));

    updateTaskCounter();
  }

  function collectPrioritizePayload() {
    const name = requireSafeText("Seu nome", byId("userName")?.value, {
      required: true,
      min: 2,
      max: 60,
    });

    const tasks = [];

    for (let i = 1; i <= state.taskCount; i += 1) {
      const titleEl = byId(`taskTitle_${i}`);
      const descEl = byId(`taskDesc_${i}`);
      const impEl = byId(`taskImp_${i}`);
      const timeEl = byId(`taskTime_${i}`);

      if (!titleEl || !descEl || !impEl || !timeEl) continue;

      const titleRaw = cleanText(titleEl.value);
      const descRaw = cleanText(descEl.value);

      if (!titleRaw && !descRaw) continue;

      const title = requireSafeText(`Tarefa ${i} - título`, titleRaw, {
        required: true,
        min: 3,
        max: 80,
      });

      const description = requireSafeText(`Tarefa ${i} - descrição`, descRaw, {
        required: true,
        min: 10,
        max: 800,
      });

      const importance = safeNumber(impEl.value, 3);
      const time_cost = safeNumber(timeEl.value, 2);

      tasks.push({
        title,
        description,
        importance,
        time_cost,
        importance_label: optionLabel(IMPORTANCE, importance),
        time_label: optionLabel(TIME_COST, time_cost),
      });
    }

    if (tasks.length < LIMITS.minTasks) {
      throw new Error(`Preencha no mínimo ${LIMITS.minTasks} tarefas completas.`);
    }

    if (!BASE) {
      throw new Error("WORKER_BASE_URL está vazio. Configure a URL no app.js.");
    }

    return {
      name,
      method: state.selectedMethod,
      tasks,
    };
  }

  // =========================
  // HTTP
  // =========================
  async function postJson(url, payload, timeoutMs = 25000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const raw = await response.text();
      let data = null;

      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message = data?.error || data?.message || raw || `Falha HTTP ${response.status}`;
        throw new Error(message);
      }

      return data;
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Tempo de resposta excedido. Tente novamente.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // =========================
  // PriorizAI
  // =========================
  function renderPrioritizeResult(result) {
    const container = byId("resultsContainer");
    if (!container) return;
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "result-header";

    const title = document.createElement("div");
    title.className = "result-message";
    title.textContent = String(result?.friendly_message || "Pronto. Aqui vai sua ordem.");

    const summary = document.createElement("div");
    summary.className = "result-summary";
    summary.textContent = String(result?.summary || "");

    const stat = document.createElement("div");
    stat.className = "result-summary";
    stat.textContent = `Tempo economizado (estimado): ${safeNumber(result?.estimated_time_saved_percent, 0)}%`;

    header.appendChild(title);
    if (summary.textContent) header.appendChild(summary);
    header.appendChild(stat);
    container.appendChild(header);

    const ordered = Array.isArray(result?.ordered_tasks) ? result.ordered_tasks : [];
    const list = document.createElement("div");
    list.className = "ranked-list";

    ordered.forEach((task) => {
      const card = document.createElement("div");
      card.className = "ranked-item";

      const top = document.createElement("div");
      top.className = "ranked-header";

      const num = document.createElement("div");
      num.className = "rank-number";
      num.textContent = String(task?.position ?? "");

      const ttl = document.createElement("div");
      ttl.className = "rank-title";
      ttl.textContent = String(task?.task_title || "");

      top.appendChild(num);
      top.appendChild(ttl);

      const exp = document.createElement("div");
      exp.className = "rank-explanation";
      exp.textContent = String(task?.explanation || "");

      card.appendChild(top);
      card.appendChild(exp);

      const points = Array.isArray(task?.key_points) ? task.key_points : [];
      if (points.length) {
        const ul = document.createElement("ul");
        ul.className = "key-points";
        points.forEach((p) => {
          const li = document.createElement("li");
          li.textContent = String(p);
          ul.appendChild(li);
        });
        card.appendChild(ul);
      }

      const tipText = cleanText(task?.tip);
      if (tipText) {
        const tip = document.createElement("div");
        tip.className = "rank-tip";
        tip.textContent = tipText;
        card.appendChild(tip);
      }

      list.appendChild(card);
    });

    container.appendChild(list);
  }

  async function handlePrioritizeClick() {
    if (state.pending.prioritize) return;

    const container = byId("resultsContainer");
    if (!container) return;

    scrollToTop();
    renderLoading(container, "Priorizando a ordem...");
    setBusy("prioritizeBtn", "prioritize", "⏳ Priorizando...", "✨ Priorizar com IA");

    try {
      const payload = collectPrioritizePayload();
      const data = await postJson(ENDPOINTS.prioritize, payload);
      renderPrioritizeResult(data || {});
    } catch (err) {
      renderError(container, err?.message || String(err));
    } finally {
      setBusy("prioritizeBtn", "prioritize", "⏳ Priorizando...", "✨ Priorizar com IA");
    }
  }

  // =========================
  // CalmAI
  // =========================
  function updateCalmCount() {
    const input = byId("calmText");
    const count = byId("calmCount");
    if (!input || !count) return;
    count.textContent = String((input.value || "").length);
  }

  function renderCalmResult(reply) {
    const container = byId("calmResultsContainer");
    if (!container) return;
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "result-header";

    const title = document.createElement("div");
    title.className = "result-message";
    title.textContent = "A Diva do Caos respondeu.";

    const body = document.createElement("div");
    body.className = "result-summary";
    body.textContent = String(reply || "");

    header.appendChild(title);
    header.appendChild(body);
    container.appendChild(header);
  }

  async function handleCalmClick() {
    if (state.pending.calm) return;

    const container = byId("calmResultsContainer");
    if (!container) return;

    scrollToTop();
    renderLoading(container, "A Diva está pensando...");
    setBusy("calmBtn", "calm", "⏳ Pensando...", "💅 Pedir conselho para a Diva");

    try {
      const name = requireSafeText("Seu nome", byId("calmName")?.value, {
        required: true,
        min: 2,
        max: 60,
      });

      const text = requireSafeText("Conta seu problema", byId("calmText")?.value, {
        required: true,
        min: 10,
        max: LIMITS.calmMax,
      });

      if (!BASE) throw new Error("WORKER_BASE_URL está vazio. Configure a URL no app.js.");

      const data = await postJson(ENDPOINTS.calmai, { name, text });
      renderCalmResult(data?.reply || "Sem resposta.");
    } catch (err) {
      renderError(container, err?.message || String(err));
    } finally {
      setBusy("calmBtn", "calm", "⏳ Pensando...", "💅 Pedir conselho para a Diva");
    }
  }

  // =========================
  // BriefAI
  // =========================
  function updateBriefCount() {
    const input = byId("briefText");
    const count = byId("briefCount");
    if (!input || !count) return;
    count.textContent = String((input.value || "").length);
  }

  function renderBriefResult(data) {
    const container = byId("briefResultsContainer");
    if (!container) return;
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "result-header";

    const title = document.createElement("div");
    title.className = "result-message";
    title.textContent = String(data?.friendlyMessage || "Pronto. Aqui está.");

    const summary = document.createElement("div");
    summary.className = "result-summary";
    summary.textContent = String(data?.summary || "");

    header.appendChild(title);
    header.appendChild(summary);
    container.appendChild(header);

    // Brief
    const briefBox = document.createElement("div");
    briefBox.className = "result-block";

    const briefTitle = document.createElement("div");
    briefTitle.className = "result-block-title";
    briefTitle.textContent = "Brief";

    const briefText = document.createElement("div");
    briefText.className = "result-summary";
    briefText.textContent = String(data?.brief || "");

    briefBox.appendChild(briefTitle);
    briefBox.appendChild(briefText);
    container.appendChild(briefBox);

    // Missing info
    const missingBox = document.createElement("div");
    missingBox.className = "result-block";

    const missingTitle = document.createElement("div");
    missingTitle.className = "result-block-title";
    missingTitle.textContent = "Pontos ausentes";

    const missingList = document.createElement("ul");
    missingList.className = "result-list";

    const missing = Array.isArray(data?.missingInfo) ? data.missingInfo : [];
    if (!missing.length) {
      const li = document.createElement("li");
      li.textContent = "Nada crítico apareceu como ausente no texto.";
      missingList.appendChild(li);
    } else {
      missing.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = String(item);
        missingList.appendChild(li);
      });
    }

    missingBox.appendChild(missingTitle);
    missingBox.appendChild(missingList);
    container.appendChild(missingBox);

    // Next steps
    const nextBox = document.createElement("div");
    nextBox.className = "result-block";

    const nextTitle = document.createElement("div");
    nextTitle.className = "result-block-title";
    nextTitle.textContent = "Próximos passos sugeridos";

    const nextList = document.createElement("ul");
    nextList.className = "result-list";

    const next = Array.isArray(data?.nextSteps) ? data.nextSteps : [];
    if (!next.length) {
      const li = document.createElement("li");
      li.textContent = "Sem sugestão automática agora. O texto ficou genérico demais.";
      nextList.appendChild(li);
    } else {
      next.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = String(item);
        nextList.appendChild(li);
      });
    }

    nextBox.appendChild(nextTitle);
    nextBox.appendChild(nextList);
    container.appendChild(nextBox);
  }

  async function handleBriefClick() {
    if (state.pending.brief) return;

    const container = byId("briefResultsContainer");
    if (!container) return;

    scrollToTop();
    renderLoading(container, "Gerando o brief...");
    setBusy("briefBtn", "brief", "⏳ Gerando...", "📝 Gerar BriefAI");

    try {
      const name = requireSafeText("Seu nome", byId("briefName")?.value, {
        required: true,
        min: 2,
        max: 60,
      });

      const text = requireSafeText("Seu texto", byId("briefText")?.value, {
        required: true,
        min: 20,
        max: LIMITS.briefMax,
      });

      if (!BASE) throw new Error("WORKER_BASE_URL está vazio. Configure a URL no app.js.");

      const data = await postJson(ENDPOINTS.briefai, { name, text });
      renderBriefResult(data || {});
    } catch (err) {
      renderError(container, err?.message || String(err));
    } finally {
      setBusy("briefBtn", "brief", "⏳ Gerando...", "📝 Gerar BriefAI");
    }
  }

  // =========================
  // Init
  // =========================
  function bindEvents() {
    byId("addTaskBtn")?.addEventListener("click", addTask);
    byId("prioritizeBtn")?.addEventListener("click", handlePrioritizeClick);

    byId("calmText")?.addEventListener("input", updateCalmCount);
    byId("calmBtn")?.addEventListener("click", handleCalmClick);

    byId("briefText")?.addEventListener("input", updateBriefCount);
    byId("briefBtn")?.addEventListener("click", handleBriefClick);
  }

  function init() {
    initTabs();
    initMethodCards();
    ensureInitialTasks();
    bindEvents();

    updateCalmCount();
    updateBriefCount();
    setActiveTab("priorizai");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
