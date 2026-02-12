// 1) COLE A URL DO SEU WORKER AQUI (a rota é /prioritize)
const WORKER_BASE_URL = "priorizai.felipelcas.workers.dev";
const API_URL = `${WORKER_BASE_URL.replace(/\/$/, "")}/prioritize`;

(function injectOrderTableStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .order-table-wrap{
      background: rgba(15, 23, 42, 0.45);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 16px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .order-table-title{
      font-weight: 800;
      margin-bottom: 0.75rem;
      color: var(--text-primary);
      font-family: 'Outfit', sans-serif;
    }
    .order-table{
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 12px;
    }
    .order-table th, .order-table td{
      text-align: left;
      padding: 0.75rem 0.75rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.12);
      color: var(--text-secondary);
      font-size: 0.95rem;
    }
    .order-table th{
      color: var(--text-primary);
      font-weight: 800;
    }
    .order-pill{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 10px;
      background: rgba(6, 182, 212, 0.12);
      border: 1px solid rgba(6, 182, 212, 0.25);
      color: var(--text-primary);
      font-weight: 800;
    }
  `;
  document.head.appendChild(style);
})();

// State
let taskCount = 3;
const MAX_TASKS = 10;

// Helpers
function getActiveMethod() {
  const active = document.querySelector(".method-card.active");
  const method = active?.dataset?.method || "impact";

  // No HTML atual o data-method do 1o é "impact"
  if (method === "impact") return "IMPACT_EFFORT";
  if (method === "rice") return "RICE";
  if (method === "moscow") return "MOSCOW";
  if (method === "gut") return "GUT";
  return "IMPACT_EFFORT";
}

// Add task element
function addTaskElement(number) {
  const container = document.getElementById("tasksContainer");
  const taskItem = document.createElement("div");
  taskItem.className = "task-item";

  taskItem.innerHTML = `
    <div class="task-header">
      <h3 class="task-number">Tarefa ${number}</h3>
    </div>

    <div class="form-group">
      <label>O que você vai fazer <span class="required">*</span></label>
      <input type="text" class="task-title" placeholder="Ex.: Enviar a planilha para o fornecedor" required>
    </div>

    <div class="form-group">
      <label>Explique bem <span class="required">*</span></label>
      <textarea class="task-desc" placeholder="Ex.: Enviar a planilha X para o fornecedor Y até 16h. Se atrasar, o pedido de amanhã pode travar." required></textarea>
    </div>

    <div class="two-col">
      <div class="form-group">
        <label>
          Quão importante isso é agora
          <span class="tooltip-icon" title="Pense no que você ganha ou evita. Se tem prazo ou alguém depende, sobe a importância.">?</span>
        </label>
        <select class="task-importance">
          <option value="1">Quase não muda nada</option>
          <option value="2">Ajuda um pouco</option>
          <option value="3" selected>Ajuda bem</option>
          <option value="4">Ajuda muito</option>
          <option value="5">É muito importante agora</option>
        </select>
      </div>

      <div class="form-group">
        <label>
          Quanto tempo isso leva
          <span class="tooltip-icon" title="Escolha o tempo total. Se tiver várias etapas, some tudo.">?</span>
        </label>
        <select class="task-time">
          <option value="1">Menos de 10 min</option>
          <option value="2" selected>10 a 30 min</option>
          <option value="3">30 min a 2 horas</option>
          <option value="4">2 a 6 horas</option>
          <option value="5">Mais de 6 horas</option>
        </select>
      </div>
    </div>
  `;
  container.appendChild(taskItem);
}

// Update task counter
function updateTaskCounter() {
  document.getElementById("taskCounter").textContent = `${taskCount}/${MAX_TASKS}`;
  document.getElementById("addTaskBtn").disabled = taskCount >= MAX_TASKS;
}

// Initialize tasks
function initializeTasks() {
  const container = document.getElementById("tasksContainer");
  container.innerHTML = "";
  for (let i = 1; i <= taskCount; i++) addTaskElement(i);
  updateTaskCounter();
}

// Validate form
function validateForm() {
  const userName = document.getElementById("userName").value.trim();
  if (!userName) {
    alert("Por favor, preencha seu nome.");
    return false;
  }

  const tasks = Array.from(document.querySelectorAll(".task-item"));
  const completeTasks = tasks.filter((task) => {
    const title = task.querySelector(".task-title").value.trim();
    const desc = task.querySelector(".task-desc").value.trim();
    return title && desc;
  });

  if (completeTasks.length < 3) {
    alert("Por favor, preencha no mínimo 3 tarefas completas (título e descrição).");
    return false;
  }

  if (!WORKER_BASE_URL || WORKER_BASE_URL.includes("COLE_AQUI")) {
    alert("Falta configurar a URL do Worker no app.js.");
    return false;
  }

  return true;
}

// Collect form data
function collectFormData() {
  const userName = document.getElementById("userName").value.trim();
  const method = getActiveMethod();

  const tasks = Array.from(document.querySelectorAll(".task-item"))
    .map((task) => ({
      title: task.querySelector(".task-title").value.trim(),
      description: task.querySelector(".task-desc").value.trim(),
      importance: parseInt(task.querySelector(".task-importance").value, 10),
      time: parseInt(task.querySelector(".task-time").value, 10),
    }))
    .filter((task) => task.title && task.description);

  return { userName, method, tasks };
}

// Show loading state
function showLoading() {
  const container = document.getElementById("resultsContainer");
  container.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div class="loading-text">Priorizando a ordem...</div>
    </div>
  `;
}

// Real API call (Cloudflare Worker)
async function prioritizeTasks(data) {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userName: data.userName,
      method: data.method,
      tasks: data.tasks,
    }),
  });

  let json = {};
  try {
    json = await resp.json();
  } catch {
    json = {};
  }

  if (!resp.ok) {
    const msg = json?.error || "Ops. Falha ao priorizar.";
    throw new Error(msg);
  }

  return json;
}

function buildOrderTable(rankedTasks) {
  const rows = rankedTasks
    .map(
      (t) => `
      <tr>
        <td><span class="order-pill">${t.position}</span></td>
        <td>${escapeHtml(t.title)}</td>
      </tr>
    `
    )
    .join("");

  return `
    <div class="order-table-wrap">
      <div class="order-table-title">Ordem sugerida</div>
      <table class="order-table">
        <thead>
          <tr>
            <th style="width: 72px;">Ordem</th>
            <th>Tarefa</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Display results
function displayResults(results) {
  const container = document.getElementById("resultsContainer");

  const orderTableHTML = buildOrderTable(results.rankedTasks || []);

  const rankedListHTML = (results.rankedTasks || [])
    .map(
      (task) => `
      <div class="ranked-item">
        <div class="ranked-header">
          <div class="rank-number">${task.position}</div>
          <div class="rank-title">${escapeHtml(task.title)}</div>
        </div>
        <div class="rank-explanation">${escapeHtml(task.explanation)}</div>
        <ul class="key-points">
          ${(task.keyPoints || []).map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
        </ul>
        <div class="rank-tip">${escapeHtml(task.tip)}</div>
      </div>
    `
    )
    .join("");

  container.innerHTML = `
    ${orderTableHTML}
    <div class="result-header">
      <div class="result-message">${escapeHtml(results.friendlyMessage || "")}</div>
      <div class="result-summary">${escapeHtml(results.summary || "")}</div>
      <div class="result-stat">📊 Tempo economizado estimado: ${Number(results.estimatedTimeSaved || 0)}%</div>
    </div>
    <div class="ranked-list">${rankedListHTML}</div>
  `;

  // Em telas menores, rola até o resultado.
  if (window.innerWidth <= 1024) {
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// UI events
document.getElementById("addTaskBtn").addEventListener("click", () => {
  if (taskCount < MAX_TASKS) {
    taskCount++;
    addTaskElement(taskCount);
    updateTaskCounter();
  }
});

document.getElementById("prioritizeBtn").addEventListener("click", async () => {
  if (!validateForm()) return;

  window.scrollTo({ top: 0, behavior: "smooth" });

  const formData = collectFormData();
  showLoading();

  try {
    const results = await prioritizeTasks(formData);
    displayResults(results);
  } catch (error) {
    const msg = String(error?.message || "Ops. Algo deu errado.");
    document.getElementById("resultsContainer").innerHTML = `
      <div class="result-empty">
        <div class="result-empty-icon">❌</div>
        <p>${escapeHtml(msg)}</p>
      </div>
    `;
  }
});

// Method card selection (visual only)
document.querySelectorAll(".method-card:not(.disabled)").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".method-card").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
  });
});

// Initialize
initializeTasks();
