import json
import time
import streamlit as st
import streamlit.components.v1 as components
from typing import Literal, List, Dict
from pydantic import BaseModel, Field
from openai import OpenAI

# -----------------------------
# Página
# -----------------------------
st.set_page_config(page_title="PrioriZÉ", page_icon="✅", layout="wide")

st.markdown(
    """
    <style>
      /* Layout mais compacto */
      .block-container { padding-top: 1.2rem; padding-bottom: 1rem; max-width: 1100px; }
      [data-testid="stAppViewContainer"] {
        background: radial-gradient(1200px 600px at 30% 10%, #142045 0%, #0b1220 55%);
      }
      [data-testid="stHeader"] { background: transparent; }

      /* Cards mais leves */
      .card {
        background: rgba(15,23,42,.75);
        border: none;               /* sem bordas do card */
        border-radius: 14px;
        padding: 12px;
      }

      /* Tirar bordas dos inputs e também borda de foco */
      input, textarea { box-shadow: none !important; }
      [data-baseweb="input"] > div,
      [data-baseweb="textarea"] > div,
      [data-baseweb="select"] > div {
        border: none !important;
        box-shadow: none !important;
        background: rgba(17,28,54,.90) !important;
        border-radius: 12px !important;
      }
      [data-baseweb="input"] > div:focus-within,
      [data-baseweb="textarea"] > div:focus-within,
      [data-baseweb="select"] > div:focus-within {
        outline: none !important;
        box-shadow: none !important;
        border: none !important;
      }

      /* Títulos internos sem “link” ao lado */
      .section-title { font-size: 16px; font-weight: 800; margin: 0 0 8px 0; }
      .tiny { color: #cbd5e1; font-size: 13px; margin-top: -4px; }
      .warn { color: #fb7185; font-size: 13px; margin-top: 6px; }
      .req { color: #ef4444; font-weight: 900; }

      /* Botões */
      div.stButton > button[kind="primary"] {
        background: #2563eb !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 12px !important;
        font-weight: 900 !important;
        padding: 0.7rem 0.9rem !important;
      }
      div.stButton > button {
        border-radius: 12px !important;
        font-weight: 800 !important;
        border: none !important;
        padding: 0.65rem 0.9rem !important;
      }

      /* “Toggles” (botões de método) */
      .method-row { margin-top: 6px; margin-bottom: 8px; }
      .method-hint { color:#94a3b8; font-size:12px; margin-top: 6px; }

      /* Separadores */
      hr { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 10px 0; }
    </style>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# Modelos de resposta
# -----------------------------
Method = Literal["IMPACT_EFFORT", "RICE", "MOSCOW", "GUT"]

class RankedItem(BaseModel):
    position: int = Field(ge=1)
    task_title: str
    explanation: str
    key_points: List[str]
    tip: str

class PriorizeResult(BaseModel):
    friendly_message: str
    method_used: Method
    estimated_time_saved_percent: int = Field(ge=0, le=80)
    summary: str
    ordered_tasks: List[RankedItem]

# -----------------------------
# Escalas (texto -> número)
# -----------------------------
BENEFIT = [
    ("Quase não ajuda", 1),
    ("Ajuda um pouco", 2),
    ("Ajuda bem", 3),
    ("Ajuda muito", 4),
    ("Vai mudar bastante", 5),
]
WORK = [
    ("Rapidinho", 1),
    ("Fácil", 2),
    ("Dá um trabalhinho", 3),
    ("Trabalhoso", 4),
    ("Muito pesado", 5),
]

def labels(options): return [x[0] for x in options]
def to_num(options, selected_label: str) -> int:
    return int({lbl: num for (lbl, num) in options}[selected_label])

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
        "Você é o PrioriZÉ. Fale como um colega legal, bem simples, sem palavras difíceis. "
        "O usuário tem 16 anos. Seja claro e direto. "
        "Use o nome do usuário e cite as tarefas para personalizar. "
        "Não invente nada. Use só os dados fornecidos. "
        "Retorne no schema."
    )

    rule = (
        "Método Impacto e Esforço: primeiro o que AJUDA MUITO e dá POUCO TRABALHO. "
        "Depois o que ajuda muito mesmo se der mais trabalho. "
        "Evite o que ajuda pouco e dá muito trabalho."
    )

    user = f"""
Nome: {user_name}
Método: {method}

Como aplicar:
{rule}

Tarefas (JSON):
{json.dumps(tasks_payload, ensure_ascii=False)}

Regras da resposta:
- Ordene as tarefas (position 1..N).
- friendly_message: curto e personalizado, citando 1 ou 2 tarefas.
- summary: 2 a 3 frases com um plano geral.
- Para cada tarefa: explanation (2 a 4 frases), key_points (2 a 4 itens), tip (1 frase).
- estimated_time_saved_percent: inteiro 0..80, realista.
"""

    resp = client.responses.parse(
        model=model,
        input=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        text_format=PriorizeResult,
    )
    return resp.output_parsed

# -----------------------------
# Estado
# -----------------------------
if "task_count" not in st.session_state:
    st.session_state.task_count = 3
if "last_result" not in st.session_state:
    st.session_state.last_result = None
if "scroll_up" not in st.session_state:
    st.session_state.scroll_up = False

# -----------------------------
# Cabeçalho
# -----------------------------
st.title("PrioriZÉ")
st.write("Você escreve suas tarefas. Eu coloco na melhor ordem, com um motivo fácil de entender.")
st.caption("Nada fica salvo. Eu só uso o que você preencher agora.")

# 3 opções do app (MVP só a primeira)
top1, top2, top3 = st.columns(3)
with top1:
    st.button("PrioriZÉ", type="primary", use_container_width=True)
with top2:
    st.button("Em breve 2", disabled=True, use_container_width=True)
with top3:
    st.button("Em breve 3", disabled=True, use_container_width=True)

st.write("")

# -----------------------------
# Layout principal
# -----------------------------
left, right = st.columns([1, 1])

# -----------------------------
# RESULTADO (fica no topo do lado direito)
# -----------------------------
with right:
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.markdown('<div class="section-title">Resultado</div>', unsafe_allow_html=True)

    if st.session_state.scroll_up:
        # Scroll pro topo quando gerar resultado (técnica com JS no container principal)
        js = """
        <script>
          var body = window.parent.document.querySelector(".main");
          if(body){ body.scrollTop = 0; window.scrollTo(0,0); }
        </script>
        """
        temp = st.empty()
        with temp:
            components.html(js, height=0)
            time.sleep(0.2)
        temp.empty()
        st.session_state.scroll_up = False

    if st.session_state.last_result:
        if "error" in st.session_state.last_result:
            st.error(st.session_state.last_result["error"])
        else:
            r = st.session_state.last_result
            st.success(r["friendly_message"])
            st.write(r["summary"])
            st.write(f"Tempo economizado (estimado): **{r['estimated_time_saved_percent']}%**")
            st.write("")

            for item in r["ordered_tasks"]:
                st.markdown(f"**{item['position']}. {item['task_title']}**")
                st.write(item["explanation"])
                for p in item["key_points"]:
                    st.write(f"- {p}")
                st.caption(item["tip"])
                st.write("")
    else:
        st.caption("O resultado vai aparecer aqui.")
    st.markdown("</div>", unsafe_allow_html=True)

# -----------------------------
# ENTRADA (lado esquerdo)
# -----------------------------
with left:
    st.markdown('<div class="card">', unsafe_allow_html=True)

    # Nome + método logo abaixo
    st.markdown('<div class="section-title">Seu nome <span class="req">*</span></div>', unsafe_allow_html=True)
    user_name = st.text_input("nome", label_visibility="collapsed", placeholder="Ex.: Castelão")

    st.markdown('<div class="section-title">Método de priorização</div>', unsafe_allow_html=True)
    st.markdown('<div class="tiny">Por enquanto, só o primeiro está liberado.</div>', unsafe_allow_html=True)

    # Toggles visíveis, mas só Impacto e Esforço habilitado
    m1, m2, m3, m4 = st.columns(4)
    with m1:
        st.button("Impacto e Esforço", type="primary", use_container_width=True)
    with m2:
        st.button("RICE", disabled=True, use_container_width=True)
    with m3:
        st.button("MoSCoW", disabled=True, use_container_width=True)
    with m4:
        st.button("GUT", disabled=True, use_container_width=True)

    method: Method = "IMPACT_EFFORT"

    st.markdown("<hr/>", unsafe_allow_html=True)

    # Tarefas
    st.markdown('<div class="section-title">Tarefas</div>', unsafe_allow_html=True)
    filled_preview = 0

    # Aviso logo abaixo do título (não no fim)
    # (a validação final acontece mais abaixo)
    st.markdown('<div class="tiny">Preencha pelo menos 3 tarefas.</div>', unsafe_allow_html=True)

    tasks_raw = []
    for idx in range(1, st.session_state.task_count + 1):
        # Primeiras 3 sempre abertas. As demais ficam em expander para não poluir.
        container = st.container()
        is_extra = idx > 3

        if is_extra:
            with st.expander(f"Tarefa extra {idx}", expanded=False):
                container = st.container()

        with container:
            st.markdown(f"<div class='tiny'><b>Tarefa {idx}</b></div>", unsafe_allow_html=True)

            st.markdown('O que você vai fazer <span class="req">*</span>', unsafe_allow_html=True)
            title = st.text_input("t", key=f"title_{idx}", label_visibility="collapsed", placeholder="Ex.: Lavar a cozinha")

            st.markdown('Explique rápido <span class="req">*</span>', unsafe_allow_html=True)
            desc = st.text_area(
                "d",
                key=f"desc_{idx}",
                label_visibility="collapsed",
                placeholder="Ex.: Lavar tudo e deixar limpo.",
                height=80,
            )

            c1, c2 = st.columns(2)
            with c1:
                st.markdown("Quanto isso te ajuda", unsafe_allow_html=True)
                benefit_lbl = st.selectbox(
                    "b",
                    options=labels(BENEFIT),
                    index=2,
                    key=f"benefit_{idx}",
                    label_visibility="collapsed",
                )
            with c2:
                st.markdown("Quanto trabalho dá", unsafe_allow_html=True)
                work_lbl = st.selectbox(
                    "w",
                    options=labels(WORK),
                    index=2,
                    key=f"work_{idx}",
                    label_visibility="collapsed",
                )

            tasks_raw.append(
                {
                    "title": (title or "").strip(),
                    "description": (desc or "").strip(),
                    "benefit_label": benefit_lbl,
                    "work_label": work_lbl,
                    "benefit": to_num(BENEFIT, benefit_lbl),
                    "work": to_num(WORK, work_lbl),
                }
            )

    st.write("")
    a1, a2 = st.columns([1, 1])
    with a1:
        if st.button("Adicionar tarefa", use_container_width=True, disabled=(st.session_state.task_count >= 10)):
            st.session_state.task_count += 1
            st.rerun()
    with a2:
        st.caption(f"{st.session_state.task_count}/10")

    # Validação (sem textos extras por campo)
    filled = [t for t in tasks_raw if t["title"] and t["description"]]
    can_run = bool(user_name.strip()) and (len(filled) >= 3)

    if not can_run:
        st.markdown('<div class="warn">Falta: nome e pelo menos 3 tarefas completas.</div>', unsafe_allow_html=True)

    st.write("")
    run = st.button("Priorizar com IA", type="primary", use_container_width=True, disabled=not can_run)

    if run:
        try:
            payload = [
                {
                    "title": t["title"],
                    "description": t["description"],
                    "benefit": t["benefit"],
                    "work": t["work"],
                    "benefit_label": t["benefit_label"],
                    "work_label": t["work_label"],
                    "scale": "1 a 5 (baixo -> alto). benefit = quanto ajuda, work = quanto trabalho dá.",
                }
                for t in filled
            ]

            with st.spinner("Pensando na melhor ordem..."):
                result = call_openai_prioritize(user_name.strip(), method, payload)

            st.session_state.last_result = result.model_dump()
            st.session_state.scroll_up = True
            st.rerun()

        except Exception as e:
            st.session_state.last_result = {"error": str(e)}
            st.session_state.scroll_up = True
            st.rerun()

    st.markdown("</div>", unsafe_allow_html=True)
