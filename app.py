import json
import streamlit as st
from pydantic import BaseModel, Field
from typing import Literal, List
from openai import OpenAI

# -----------------------------
# UI / Branding
# -----------------------------
st.set_page_config(page_title="PrioriZÉ", page_icon="✅", layout="wide")

st.markdown(
    """
    <style>
      /* Fundo e header */
      [data-testid="stAppViewContainer"] {
        background: radial-gradient(1200px 600px at 30% 10%, #142045 0%, #0b1220 55%);
      }
      [data-testid="stHeader"] { background: transparent; }

      /* Cards */
      .card {
        background: rgba(15,23,42,.72);
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 14px;
        padding: 14px;
      }

      /* Botão principal com realce */
      div.stButton > button[kind="primary"] {
        background: #2563eb !important;
        color: #ffffff !important;
        border: 1px solid rgba(255,255,255,0.16) !important;
        border-radius: 12px !important;
        font-weight: 800 !important;
      }
      div.stButton > button[kind="primary"]:hover { filter: brightness(1.05); }

      /* Textos auxiliares mais visíveis */
      .muted { color: #cbd5e1 !important; font-size: 13px; }
    </style>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# Data models (Structured Output)
# -----------------------------
Method = Literal["RICE", "MOSCOW", "IMPACT_EFFORT", "GUT"]

class RankedItem(BaseModel):
    position: int = Field(ge=1)
    task_title: str
    short_reason: str
    quick_tip: str

class PriorizeResult(BaseModel):
    friendly_message: str
    method_used: Method
    estimated_time_saved_percent: int = Field(ge=0, le=80)
    ordered_tasks: List[RankedItem]

# -----------------------------
# Helpers
# -----------------------------
def get_openai_client() -> OpenAI:
    # Prefer Streamlit secrets. Never hardcode keys.
    api_key = None
    try:
        api_key = st.secrets.get("OPENAI_API_KEY")
    except Exception:
        api_key = None

    if not api_key:
        raise RuntimeError("OPENAI_API_KEY não configurada em Secrets.")
    return OpenAI(api_key=api_key)

def build_payload(name: str, method: Method, tasks: list[dict]) -> dict:
    return {
        "user_name": name,
        "method": method,
        "tasks": tasks,
        "scales": "Todos os campos numéricos usam escala 1 (baixo) a 5 (alto).",
        "note": "Gerar priorização objetiva, justificativa curta por item e estimativa de tempo economizado em %."
    }

def validate(tasks: list[dict]) -> tuple[bool, str]:
    # Count tasks with title filled
    filled = [t for t in tasks if t["title"].strip()]
    if len(filled) < 3:
        return False, "Você precisa preencher pelo menos 3 tarefas."

    # For each filled task, all fields must be present
    for i, t in enumerate(filled, start=1):
        if not t["description"].strip():
            return False, f"Complete a descrição da tarefa {i}."
        # numeric fields already enforced by selectbox values; just ensure existence
        required_keys = [
            "impact", "effort", "reach", "confidence",
            "moscow",
            "gut_g", "gut_u", "gut_t",
        ]
        for k in required_keys:
            if k not in t or t[k] is None:
                return False, f"Complete o campo {k} da tarefa {i}."
    return True, ""

def call_openai_prioritize(name: str, method: Method, tasks: list[dict]) -> PriorizeResult:
    client = get_openai_client()
    model = "gpt-4o-mini"
    try:
        model = st.secrets.get("OPENAI_MODEL", model)
    except Exception:
        pass

    payload = build_payload(name, method, tasks)

    system = (
        "Você é um assistente de priorização de tarefas chamado PrioriZÉ. "
        "Você deve ordenar tarefas com base no método escolhido. "
        "Seja direto. Linguagem simples. Justificativa curta por tarefa. "
        "Não invente fatos. Use apenas os dados fornecidos. "
        "Retorne apenas no formato exigido pelo schema."
    )

    user = f"""
Usuário: {name}
Método: {method}

Dados (JSON):
{json.dumps(payload, ensure_ascii=False)}

Regras:
- Ordene apenas as tarefas com título preenchido.
- method_used deve ser igual ao método informado.
- estimated_time_saved_percent: número inteiro (0 a 80), estimativa realista.
- friendly_message: texto curto, levemente informal, personalizado com o nome.
- Cada tarefa deve ter position, short_reason (1 frase), quick_tip (1 frase).
"""

    # Structured Outputs using Pydantic via OpenAI Python SDK
    resp = client.responses.parse(
        model=model,
        input=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        text_format=PriorizeResult,
    )
    return resp.output_parsed

# -----------------------------
# App State
# -----------------------------
if "mode" not in st.session_state:
    st.session_state.mode = "PrioriZÉ"

# -----------------------------
# Header
# -----------------------------
st.title("PrioriZÉ")
st.write("Uma forma simples de ordenar suas tarefas usando métodos conhecidos, com ajuda de IA.")
st.caption("Nada é salvo. A priorização é feita na hora, usando apenas o que você preenche aqui.")

# -----------------------------
# 3 options (MVP: only first)
# -----------------------------
c1, c2, c3 = st.columns(3)
with c1:
    if st.button("PrioriZÉ", type="primary", use_container_width=True):
        st.session_state.mode = "PrioriZÉ"
with c2:
    if st.button("Em breve 2", use_container_width=True):
        st.session_state.mode = "Em breve 2"
with c3:
    if st.button("Em breve 3", use_container_width=True):
        st.session_state.mode = "Em breve 3"

st.write("")

if st.session_state.mode != "PrioriZÉ":
    st.info("Esta opção ainda não está no MVP. Use PrioriZÉ por enquanto.")
    st.stop()

# -----------------------------
# Form
# -----------------------------
left, right = st.columns([1, 1])

with left:
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.subheader("1) Seus dados")
    name = st.text_input("Seu nome (obrigatório)", placeholder="Ex.: Castelão")
    st.write("")

    st.subheader("2) Método de priorização")
    method: Method = st.selectbox(
        "Escolha o critério",
        options=["RICE", "MOSCOW", "IMPACT_EFFORT", "GUT"],
        help="RICE, MoSCoW, Impacto x Esforço ou GUT.",
    )

    st.write("")
    st.subheader("3) Tarefas (3 a 10)")
    st.caption("Preencha pelo menos 3 tarefas. Se deixar o título vazio, a tarefa será ignorada.")

    tasks = []
    for idx in range(1, 11):
        with st.expander(f"Tarefa {idx}", expanded=(idx <= 3)):
            title = st.text_input(f"Título da tarefa {idx}", key=f"title_{idx}")
            description = st.text_area(f"Descrição curta {idx}", key=f"desc_{idx}", placeholder="O que é e qual o resultado esperado.")

            st.caption("Escala 1 (baixo) a 5 (alto).")

            colA, colB = st.columns(2)
            with colA:
                impact = st.selectbox(f"Impacto {idx}", [1, 2, 3, 4, 5], index=2, key=f"impact_{idx}")
                reach = st.selectbox(f"Alcance {idx}", [1, 2, 3, 4, 5], index=1, key=f"reach_{idx}")
                moscow = st.selectbox(f"MoSCoW {idx}", ["Must", "Should", "Could", "Wont"], index=1, key=f"moscow_{idx}")
                gut_g = st.selectbox(f"G (Gravidade) {idx}", [1, 2, 3, 4, 5], index=2, key=f"gut_g_{idx}")

            with colB:
                effort = st.selectbox(f"Esforço {idx}", [1, 2, 3, 4, 5], index=2, key=f"effort_{idx}")
                confidence = st.selectbox(f"Confiança {idx}", [1, 2, 3, 4, 5], index=2, key=f"conf_{idx}")
                gut_u = st.selectbox(f"U (Urgência) {idx}", [1, 2, 3, 4, 5], index=2, key=f"gut_u_{idx}")
                gut_t = st.selectbox(f"T (Tendência) {idx}", [1, 2, 3, 4, 5], index=2, key=f"gut_t_{idx}")

            tasks.append({
                "title": title or "",
                "description": description or "",
                "impact": impact,
                "effort": effort,
                "reach": reach,
                "confidence": confidence,
                "moscow": moscow,
                "gut_g": gut_g,
                "gut_u": gut_u,
                "gut_t": gut_t,
            })

    st.write("")
    st.markdown("<hr/>", unsafe_allow_html=True)

    can_run = True
    if not name.strip():
        can_run = False
        st.warning("Informe seu nome para continuar.")

    ok, reason = validate(tasks)
    if not ok:
        can_run = False
        st.warning(reason)

    run = st.button("Priorizar com IA", type="primary", use_container_width=True, disabled=not can_run)

    st.markdown("</div>", unsafe_allow_html=True)

with right:
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.subheader("Resultado")
    st.caption("A IA ordena as tarefas e explica rapidamente o porquê.")

    if run:
        try:
            with st.spinner("Analisando e ordenando suas tarefas..."):
                result = call_openai_prioritize(name.strip(), method, tasks)

            st.success(result.friendly_message)
            st.write(f"Método: **{result.method_used}**")
            st.write(f"Tempo economizado (estimado): **{result.estimated_time_saved_percent}%**")
            st.write("")

            for item in result.ordered_tasks:
                st.markdown(f"### {item.position}. {item.task_title}")
                st.write(item.short_reason)
                st.caption(item.quick_tip)

        except Exception as e:
            st.error(str(e))
            st.info("Se for erro de chave, configure o OPENAI_API_KEY em Secrets no Streamlit Cloud.")

    st.markdown("</div>", unsafe_allow_html=True)
