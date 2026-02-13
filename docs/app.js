/* app.js - PriorizAI + CalmAI (GitHub Pages) */
(() => {
  "use strict";

  // ========= CONFIG =========
  // Cole aqui a URL do seu Worker (sempre com https://)
  // Exemplo: https://priorizai.felipelcas.workers.dev
  const WORKER_BASE_URL = "https://priorizai.felipelcas.workers.dev";

  const MAX_TASKS = 10;
  const MIN_TASKS = 3;

  // Escalas (universais)
  const IMPORTANCE = [
    { label: "Quase não importa", value: 1 },
    { label: "Importa pouco", value: 2 },
    { label: "Importa", value: 3 },
    { label: "Importa muito", value: 4 },
    { label: "É crítico, não dá para adiar", value: 5 },
  ];

  const TIME_COST = [
    { label: "Menos de 10 min", value: 1 },
    { label: "10 a 30 min", value: 2 },
    { label: "30 min a 2 horas", value: 3 },
    { label: "2 a 6 horas", value: 4 },
    { label: "Mais de 6 horas", value: 5 },
  ];

  // ========= HELPERS =========
  const $ = (id) => document.getElementById(id);

  function normalizeBaseUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return withProto.replace(/\/+$/, "");
  }

  const BASE = normalizeBaseUrl(WORKER_BASE_URL);
  const API_PRIORITIZE = `${BASE}/prioritize`;
  const API_CALMAI = `${BASE}/calmai`;

  function looksLikeInjection(text) {
    const t = String(text || "").toLowerCase();

    // Bloqueios de XSS comuns
    const xss = [
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
    if (xss.some((p) => t.includes(p))) return true;

    // Heurística para SQLi (evita falso positivo excessivo)
    const sqli = [
      " union select",
      "drop table",
      "insert into",
      "delete from",
      "update ",
      " or 1=1",
      "' or '1'='1",
      "\" or \"1\"=\"1",
      "--",
      "/*",
      "*/",
      ";--",
    ];
    if (sqli.some((p) => t.includes(p))) return true;

    return false;
  }

  function cleanText(text) {
    return String(text || "").replace(/\u0000/g, "").trim();
  }

  function requireSafeText(fieldName, value, { required = false, min = 0, max = 9999 } = {}) {
    const v = cleanText(value);

    if (required && !v) throw new Error(`Preencha: ${fieldName}.`);
    if (!required && !v) return "";

    if (v.length < min) throw new Error(`${fieldName} está muito curto.`);
    if (v.length > max) throw new Error(`${fieldName} passou do limite de caracteres.`);

    if (looksLikeInjection(v)) {
      throw new Error(`${fieldName} parece ter conteúdo perigoso. Ajuste o texto e tente de novo.`);
    }
    return v;
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setActiveTab(tab) {
    document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    const viewPriorizai = $("viewPriorizai");
    const viewCalmai = $("viewCalmai");

    if (tab === "calmai") {
      viewPriorizai.style.display = "none";
      viewCalmai.style.display = "grid";
    } else {
      viewCalmai.style.display = "none";
      viewPriorizai.style.display = "grid";
    }
    scrollToTop();
  }

  function renderLoading(container, text) {
    container.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "loading";

    const spinner = document.createElement("div");
    spinner.className = "spinner";

    const t = document.createElement("div");
    t.className = "loading-text";
    t.textContent = text;

    wrap.appendChild(spinner);
    wrap.appendChild(t);
    container.appendChild(wrap);
  }

  function renderError(container, message) {
    container.innerHTML = "";

    const box = document.createElement("div");
    box.className = "result-header";

    const title = document.createElement("div");
    title.className = "result-message";
    title.textContent = "Ops. Deu problema.";

    const desc = document.createElement("div");
    desc.className = "result-summary";
    desc.textContent = message;

    box.appendChild(title);
    box.appendChild(desc);
    container.appendChild(box);
  }

  // ========= METHOD SELECTION =========
  let selectedMethod = "impact_effort"; // por enquanto fixo

  function initMethodCards() {
    const cards = document.querySelectorAll(".method-card");
    cards.forEach((card) => {
      card.addEventListener("click", () => {
        if (card.classList.contains("disabled")) return;

        cards.forEach((c) => c.classList.remove("active"));
        card.classList.add("active");

        const v = card.dataset.method;
        selectedMethod = v === "impact" ? "impact_effort" : "impact_effort";
      });
    });
  }

  // ========= TASKS UI =========
  let taskCount = 0;

  function makeOption(value, label) {
    const opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = label;
    return opt;
  }

  function makeTooltipIcon(title) {
    const s = document.createElement("span");
    s.className = "tooltip-icon";
    s.title = title;
    s.textContent = "?";
    return s;
  }

  function createTaskItem(index) {
    const item = document.createElement("div");
    item.className = "task-item";
    item.dataset.index = String(index);

    const header = document.createElement("div");
    header.className = "task-header";
    header.textContent = `Tarefa ${index}`;
    item.appendChild(header);

    // Title
    const g1 = document.createElement("div");
    g1.className = "form-group";

    const l1 = document.createElement("label");
    l1.textContent = "O que você vai fazer ";
    const req1 = document.createElement("span");
    req1.className = "required";
    req1.textContent = "*";
    l1.appendChild(req1);

    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = `taskTitle_${index}`;
    inp.placeholder = "Ex.: Enviar planilha para o fornecedor (até 16h)";

    g1.appendChild(l1);
    g1.appendChild(inp);
    item.appendChild(g1);

    // Description
    const g2 = document.createElement("div");
    g2.className = "form-group";

    const l2 = document.createElement("label");
    l2.textContent = "Explique bem ";
    const req2 = document.createElement("span");
    req2.className = "required";
    req2.textContent = "*";
    l2.appendChild(req2);

    const ta = document.createElement("textarea");
    ta.id = `taskDesc_${index}`;
    ta.placeholder =
      "Ex.: Enviar a planilha X para o fornecedor Y até 16h. Se atrasar, o pedido de amanhã pode travar. Depende de mim e de mais 1 pessoa.";
    ta.maxLength = 800;

    g2.appendChild(l2);
    g2.appendChild(ta);
    item.appendChild(g2);

    // Two columns: importance + time
    const two = document.createElement("div");
    two.className = "two-col";

    // Importance
    const g3 = document.createElement("div");
    g3.className = "form-group";

    const l3 = document.createElement("label");
    l3.textContent = "Quão importante isso é agora ";
    l3.appendChild(makeTooltipIcon("Pense no que você ganha ou evita. Se tem prazo, aumenta a importância."));

    const selImp = document.createElement("select");
    selImp.id = `taskImp_${index}`;
    IMPORTANCE.forEach((o) => selImp.appendChild(makeOption(o.value, o.label)));
    selImp.value = "3";

    g3.appendChild(l3);
    g3.appendChild(selImp);

    // Time
    const g4 = document.createElement("div");
    g4.className = "form-group";

    const l4 = document.createElement("label");
    l4.textContent = "Quanto tempo isso leva ";
    l4.appendChild(makeTooltipIcon("Escolha o tempo total real que você vai gastar."));

    const selTime = document.createElement("select");
    selTime.id = `taskTime_${index}`;
    TIME_COST.forEach((o) => selTime.appendChild(makeOption(o.value, o.label)));
    selTime.value = "2";

    g4.appendChild(l4);
    g4.appendChild(selTime);

    two.appendChild(g3);
    two.appendChild(g4);
    item.appendChild(two);

    return item;
  }

  function updateTaskCounter() {
    const el = $("taskCounter");
    if (el) el.textContent = `${taskCount}/${MAX_TASKS}`;
  }

  function ensureInitialTasks() {
    const container = $("tasksContainer");
    container.innerHTML = "";
    taskCount = 0;

    for (let i = 1; i <= MIN_TASKS; i++) {
      taskCount++;
      container.appendChild(createTaskItem(taskCount));
    }
    updateTaskCounter();
  }

  function addTask() {
    if (taskCount >= MAX_TASKS) return;
    const container = $("tasksContainer");
    taskCount++;
    container.appendChild(createTaskItem(taskCount));
    updateTaskCounter();
  }

  function getLabelByValue(arr, value) {
    const n = Number(value);
    const found = arr.find((x) => x.value === n);
    return found ? found.label : "";
  }

  function collectPriorizaiPayload() {
    const name = requireSafeText("Seu nome", $("userName").value, { required: true, min: 2, max: 60 });

    const tasks = [];
    for (let i = 1; i <= taskCount; i++) {
      const titleEl = $(`taskTitle_${i}`);
      const descEl = $(`taskDesc_${i}`);
      const impEl = $(`taskImp_${i}`);
      const timeEl = $(`taskTime_${i}`);

      if (!titleEl || !descEl || !impEl || !timeEl) continue;

      const titleRaw = cleanText(titleEl.value);
      const descRaw = cleanText(descEl.value);

      // tarefa vazia pode existir. Só considera se tiver título OU descrição
      const isEmpty = !titleRaw && !descRaw;
      if (isEmpty) continue;

      const title = requireSafeText(`Tarefa ${i} - título`, titleRaw, { required: true, min: 3, max: 80 });
      const description = requireSafeText(`Tarefa ${i} - descrição`, descRaw, { required: true, min: 10, max: 800 });

      const importance = Number(impEl.value);
      const time_cost = Number(timeEl.value);

      tasks.push({
        title,
        description,
        importance,
        time_cost,
        importance_label: getLabelByValue(IMPORTANCE, importance),
        time_label: getLabelByValue(TIME_COST, time_cost),
      });
    }

    if (tasks.length < MIN_TASKS) {
      throw new Error(`Preencha no mínimo ${MIN_TASKS} tarefas completas (título e descrição).`);
    }
    if (!BASE) {
      throw new Error("WORKER_BASE_URL está vazio. Configure a URL do seu Worker no app.js.");
    }

    return { name, method: selectedMethod, tasks };
  }

  async function callWorkerPrioritize(payload) {
    const res = await fetch(API_PRIORITIZE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // nada
    }

    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || text || "Erro ao chamar o Worker.";
      throw new Error(msg);
    }
    return data;
  }

  function renderPriorizaiResults(result) {
    const container = $("resultsContainer");
    container.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "result-header";

    const msg = document.createElement("div");
    msg.className = "result-message";
    msg.textContent = String(result.friendly_message || "Pronto. Aqui vai sua ordem.");

    const summary = document.createElement("div");
    summary.className = "result-summary";
    summary.textContent = String(result.summary || "");

    const stat = document.createElement("div");
    stat.className = "result-stat";
    stat.textContent = `⏱️ Tempo economizado (estimado): ${Number(result.estimated_time_saved_percent ?? 0)}%`;

    header.appendChild(msg);
    if (summary.textContent) header.appendChild(summary);
    header.appendChild(stat);
    container.appendChild(header);

    // Table (ordem primeiro)
    const ordered = Array.isArray(result.ordered_tasks) ? result.ordered_tasks : [];
    const tableWrap = document.createElement("div");
    tableWrap.style.marginBottom = "1rem";

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.background = "rgba(0,0,0,.2)";
    table.style.border = "1px solid rgba(212,165,116,.25)";
    table.style.borderRadius = "12px";
    table.style.overflow = "hidden";

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");

    const th1 = document.createElement("th");
    th1.textContent = "Ordem";
    th1.style.textAlign = "left";
    th1.style.padding = "10px";
    th1.style.borderBottom = "1px solid rgba(212,165,116,.25)";
    th1.style.color = "var(--text-secondary)";

    const th2 = document.createElement("th");
    th2.textContent = "Tarefa";
    th2.style.textAlign = "left";
    th2.style.padding = "10px";
    th2.style.borderBottom = "1px solid rgba(212,165,116,.25)";
    th2.style.color = "var(--text-secondary)";

    hr.appendChild(th1);
    hr.appendChild(th2);
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    ordered.forEach((it) => {
      const tr = document.createElement("tr");

      const td1 = document.createElement("td");
      td1.textContent = String(it.position ?? "");
      td1.style.padding = "10px";
      td1.style.borderBottom = "1px solid rgba(212,165,116,.12)";
      td1.style.color = "var(--text-primary)";
      td1.style.fontWeight = "800";
      td1.style.width = "90px";

      const td2 = document.createElement("td");
      td2.textContent = String(it.task_title ?? "");
      td2.style.padding = "10px";
      td2.style.borderBottom = "1px solid rgba(212,165,116,.12)";
      td2.style.color = "var(--text-primary)";

      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    tableWrap.appendChild(table);
    container.appendChild(tableWrap);

    // Full text list
    const list = document.createElement("div");
    list.className = "ranked-list";

    ordered.forEach((it) => {
      const card = document.createElement("div");
      card.className = "ranked-item";

      const top = document.createElement("div");
      top.className = "ranked-header";

      const num = document.createElement("div");
      num.className = "rank-number";
      num.textContent = String(it.position ?? "");

      const ttl = document.createElement("div");
      ttl.className = "rank-title";
      ttl.textContent = String(it.task_title ?? "");

      top.appendChild(num);
      top.appendChild(ttl);

      const exp = document.createElement("div");
      exp.className = "rank-explanation";
      exp.textContent = String(it.explanation ?? "");

      const ul = document.createElement("ul");
      ul.className = "key-points";

      const points = Array.isArray(it.key_points) ? it.key_points : [];
      points.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = String(p);
        ul.appendChild(li);
      });

      const tip = document.createElement("div");
      tip.className = "rank-tip";
      tip.textContent = String(it.tip ?? "");

      card.appendChild(top);
      card.appendChild(exp);
      if (points.length) card.appendChild(ul);
      if (tip.textContent) card.appendChild(tip);

      list.appendChild(card);
    });

    container.appendChild(list);
  }

  async function onPrioritizeClick() {
    scrollToTop();

    const results = $("resultsContainer");
    renderLoading(results, "Priorizando a ordem...");

    let payload;
    try {
      payload = collectPriorizaiPayload();
    } catch (err) {
      renderError(results, err.message || String(err));
      return;
    }

    try {
      const result = await callWorkerPrioritize(payload);
      renderPriorizaiResults(result);
    } catch (err) {
      renderError(results, err.message || String(err));
    }
  }

  // ========= CALMAI =========
  function updateCalmCount() {
    const text = $("calmText");
    const count = $("calmCount");
    if (!text || !count) return;
    count.textContent = String((text.value || "").length);
  }

  async function callWorkerCalmai(payload) {
    const res = await fetch(API_CALMAI, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // nada
    }

    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || text || "Erro ao chamar o Worker.";
      throw new Error(msg);
    }
    return data;
  }

  function renderCalmaiResult(reply) {
    const container = $("calmResultsContainer");
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "result-header";

    const msg = document.createElement("div");
    msg.className = "result-message";
    msg.textContent = "A Diva do Caos respondeu.";

    const body = document.createElement("div");
    body.className = "result-summary";
    body.textContent = String(reply || "");

    header.appendChild(msg);
    header.appendChild(body);
    container.appendChild(header);
  }

async function onCalmClick() {
  scrollToTop();

  const container = $("calmResultsContainer");
  renderLoading(container, "A Diva está pensando...");

  try {
    const name = requireSafeText("Seu nome", $("calmName").value, {
      required: true,
      min: 2,
      max: 60,
    });

    const text = requireSafeText("Conta seu problema", $("calmText").value, {
      required: true,
      min: 10,
      max: 500,
    });

    if (!BASE) throw new Error("WORKER_BASE_URL está vazio. Configure a URL do seu Worker no app.js.");

    const data = await callWorkerCalmai({ name, text });
    renderCalmaiResult(data.reply);
  } catch (err) {
    renderError(container, err.message || String(err));
  }
}

  // ========= INIT =========
  function initTabs() {
    document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        setActiveTab(btn.dataset.tab);
      });
    });
  }

  function init() {
    initTabs();
    initMethodCards();

    ensureInitialTasks();
    updateTaskCounter();

    $("addTaskBtn").addEventListener("click", () => addTask());
    $("prioritizeBtn").addEventListener("click", () => onPrioritizeClick());

    $("calmText").addEventListener("input", updateCalmCount);
    updateCalmCount();
    $("calmBtn").addEventListener("click", () => onCalmClick());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
