import json
import streamlit as st
from typing import Literal, List, Dict
from pydantic import BaseModel, Field
from openai import OpenAI

# -----------------------------
# Página
# -----------------------------
st.set_page_config(page_title="PrioriZÉ", page_icon="✅", layout="wide")

# CSS leve (o tema oficial fica no config.toml)
st.markdown(
    """
    <style>
      [data-testid="stAppViewContainer"] {
        background: radial-gradient(1200px 600px at 30% 10%, #142045 0%, #0b1220 55%);
      }
      [data-testid="stHeader"] { background: transparent; }

      .card {
        background: rgba(15,23,42,.72);
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 14px;
        padding: 14px;
      }
      .muted { color: #cbd5e1 !important; font-size: 13px; }

      div.stButton > button[kind="primary"] {
        background: #2563eb !important;
        color: #ffffff !important;
        border: 1px solid rgba(255,255,255,0.16) !important;
        border-radius: 12px !important;
        font-weight: 800 !important;
      }
      div.stButton > button { border-radius: 12px !important; font-weight: 700 !important; }
    </style>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# Modelos
# -----------------------------
Method = Literal["RICE", "MOSCOW", "IMPACT_EFFORT", "GUT"]

class RankedItem(BaseModel):
    position: int = Field(ge=1)
    task_title: str
    explanation: str
    key_factors: List[str]
    tip: str

class PriorizeResult(BaseModel):
    friendly_message: str
    method_used: Method
    estimated_time_saved_percent: int = Field(ge=0, le=80)
    summary: str
    ordered_tasks: List[RankedItem]

# -----------------------------
# Escalas simples (texto -> número)
# -----------------------------
SCALE_5 = [
    ("Muito baixo", 1),
    ("Baixo", 2),
    ("Médio", 3),
    ("Alto", 4),
    ("Muito alto", 5),
]
EFFORT_5 = [
    ("Muito fácil e rápido", 1),
    ("Fácil", 2),
    ("Médio", 3),
    ("Difícil", 4),
    ("Muito difícil e demorado", 5),
]
CONF_5 = [
    ("Baixa certeza", 1),
    ("Alguma certeza", 2),
    ("Boa certeza", 3),
    ("Quase certo", 4),
    ("Certo", 5),
]

def label_list(options):
    return [x[0] for x in options]

def to_number(options, selected_label: str) -> int:
    m = {lbl: num for (lbl, num) in options}
    return int(m[selected_label])

# -----------------------------
# OpenAI
# -----------------------------
def get_openai_client() -> OpenAI:
    api_key = None
    try:
        api_key = st.secrets.get("OPENAI_API_KEY")
    except Exception:
        api_key = None

    if not api_key:
        raise RuntimeError("OPENAI_API_KEY não configurada nos Secrets do Streamlit Cloud.")
    return OpenAI(api_key=api_key)

def call_openai_prioritize(user_name: str, method: Method, tasks_payload: List[Dict]) -> PriorizeResult:
    client = get_openai_client()
    model = "gpt-4o-mini"
    try:
        model = st.secrets.get("OPENAI_MODEL", model)
    except Exception:
        pass

    system = (
        "Você é PrioriZÉ, um assistente de priorização. "
        "Explique como um colega de trabalho: simples, amigável, útil. "
        "Use os nomes das tarefas para personalizar. "
        "Justifique a ordem com base APENAS nos dados fornecidos. "
        "Retorne no schema."
    )

    user = f"""
Nome do usuário: {user_name}
Método escolhido: {method}

Tarefas (JSON):
{json.dumps(tasks_payload, ensure_ascii=False)}

Regras:
- Ordene somente tarefas preenchidas.
- Dê uma explicação curta porém clara por tarefa (2 a 4 frases).
- key_factors: 2 a 4 itens, bem objetivos.
- tip: 1 frase prática.
- estimated_time_saved_percent: inteiro 0..80, realista.
- friendly_message: curto, levemente informal, mencionando 1 ou 2 tarefas.
- summary: plano geral em 2 a 3 frases.
"""

    # Structured Outputs: resposta sempre no formato do schema
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
# Estado da tela
# -----------------------------
if "task_count" not in st.session_state:
    st.session_state.task_count = 3

if "mode" not in st.session_state:
    st.session_state.mode = "PrioriZÉ"

# -----------------------------
# Header
# -----------------------------
st.title("PrioriZÉ")
st.write("Coloque suas tarefas, e eu organizo a ordem ideal para você.")
st.caption("Nada fica salvo. A IA só recebe o que você preencher no momento.")

# 3 botões (MVP só o primeiro)
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

if st.session_state.mode != "PrioriZÉ":
    st.info("Essa opção ainda não está no MVP. Use PrioriZÉ por enquanto.")
    st.stop()

left, right = st.columns([1, 1])

# -----------------------------
# Inputs
# -----------------------------
with left:
    st.markdown('<div class="card">', unsafe_allow_html=True)

    st.subheader("1) Seu nome")
    user_name = st.text_input("Obrigatório", placeholder="Ex.: Felipe Castelão")

    st.write("")
    st.subheader("2) Tarefas")
    st.caption("Comece com 3. Para adicionar mais, clique em “Adicionar tarefa”.")

    # Método só aparece depois (para incentivar preencher tarefas primeiro)
    # Padrão: Impacto e Esforço
    method_label_map = {
        "Impacto e Esforço": "IMPACT_EFFORT",
        "RICE": "RICE",
        "MoSCoW": "MOSCOW",
        "GUT": "GUT",
    }

    # Coletar tarefas (só até task_count)
    tasks_raw = []
    for idx in range(1, st.session_state.task_count + 1):
        with st.expander(f"Tarefa {idx}", expanded=(idx <= 3)):
            title = st.text_input(f"Título {idx}", key=f"title_{idx}")
            desc = st.text_area(
                f"Descrição curta {idx}",
                key=f"desc_{idx}",
                placeholder="Em 1 frase, o que é e qual resultado você quer.",
            )

            # Método padrão no início: Impacto e Esforço
            # Neste MVP, por padrão mostramos apenas Impacto e Esforço.
            impact_lbl = st.selectbox(
                f"Impacto {idx}",
                options=label_list(SCALE_5),
                index=2,
                key=f"impact_lbl_{idx}",
            )
            effort_lbl = st.selectbox(
                f"Esforço {idx}",
                options=label_list(EFFORT_5),
                index=2,
                key=f"effort_lbl_{idx}",
            )

            # Guardar os dados simples (texto) e numéricos (convertidos)
            tasks_raw.append(
                {
                    "title": (title or "").strip(),
                    "description": (desc or "").strip(),
                    "impact_label": impact_lbl,
                    "effort_label": effort_lbl,
                    "impact": to_number(SCALE_5, impact_lbl),
                    "effort": to_number(EFFORT_5, effort_lbl),
                }
            )

    # Botão para adicionar tarefa
    st.write("")
    add_col1, add_col2 = st.columns([1, 1])
    with add_col1:
        if st.button("Adicionar tarefa", use_container_width=True, disabled=(st.session_state.task_count >= 10)):
            st.session_state.task_count += 1
            st.rerun()
    with add_col2:
        st.caption(f"Tarefas visíveis: {st.session_state.task_count}/10")

    # Validação mínima
    filled = [t for t in tasks_raw if t["title"]]
    tasks_ok = True
    if len(filled) < 3:
        tasks_ok = False
        st.warning("Você precisa preencher pelo menos 3 tarefas (título e descrição).")

    for i, t in enumerate(filled, start=1):
        if not t["description"]:
            tasks_ok = False
            st.warning(f"Complete a descrição da tarefa {i}.")
            break

    st.write("")
    st.subheader("3) Método de priorização")
    st.caption("Depois de preencher suas tarefas, escolha o método.")
    method_label = st.selectbox(
        "Critério",
        options=list(method_label_map.keys()),
        index=0,  # Impacto e Esforço
        disabled=not tasks_ok,
    )
    method: Method = method_label_map[method_label]  # internal key

    st.write("")
    st.subheader("4) Rodar a priorização")
    run = st.button(
        "Priorizar com IA",
        type="primary",
        use_container_width=True,
        disabled=(not user_name.strip() or not tasks_ok),
    )

    st.markdown('</div>', unsafe_allow_html=True)

# -----------------------------
# Output
# -----------------------------
with right:
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.subheader("Resultado")
    st.caption("Ordem sugerida, com explicação simples e dicas práticas.")

    if run:
        try:
            # Se o usuário escolher RICE/MoSCoW/GUT no futuro, você pode ampliar os campos.
            # Por enquanto, o MVP envia Impacto e Esforço (bem simples e claro para leigos).
            tasks_payload = [
                {
                    "title": t["title"],
                    "description": t["description"],
                    "impact": t["impact"],
                    "effort": t["effort"],
                    "impact_label": t["impact_label"],
                    "effort_label": t["effort_label"],
                    "scale_info": "impact e effort: 1 (baixo) a 5 (alto), escolhidos por rótulos de texto.",
                }
                for t in filled
            ]

            with st.spinner("Organizando suas tarefas com IA..."):
                result = call_openai_prioritize(user_name.strip(), method, tasks_payload)

            st.success(result.friendly_message)
            st.write(f"Método: **{result.method_used}**")
            st.write(f"Tempo economizado (estimado): **{result.estimated_time_saved_percent}%**")
            st.write("")
            st.write(result.summary)
            st.write("")

            for item in result.ordered_tasks:
                st.markdown(f"### {item.position}. {item.task_title}")
                st.write(item.explanation)
                st.write("**Pontos que pesaram:**")
                for k in item.key_factors:
                    st.write(f"- {k}")
                st.caption(item.tip)
                st.write("")

        except Exception as e:
            st.error(str(e))
            st.info("Se for chave, revise os Secrets no Streamlit Cloud (não é no GitHub).")

    st.markdown('</div>', unsafe_allow_html=True)
