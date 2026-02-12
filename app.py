import json
import time
import html
import streamlit as st
import streamlit.components.v1 as components
from typing import Literal, List, Dict
from pydantic import BaseModel, Field
from openai import OpenAI

Method = Literal["IMPACT_EFFORT", "RICE", "MOSCOW", "GUT"]

# -----------------------------
# Página
# -----------------------------
st.set_page_config(page_title="PriorizAI", page_icon="✅", layout="wide")

def help_icon(text: str) -> str:
    tip = html.escape(text, quote=True)
    return f"<span class='helpIcon' title='{tip}'>?</span>"

st.markdown(
    """
    <style>
      /* Layout compacto */
      .block-container { padding-top: 0.9rem; padding-bottom: 0.9rem; max-width: 1100px; }
      [data-testid="stAppViewContainer"] {
        background: radial-gradient(1200px 600px at 30% 10%, #142045 0%, #0b1220 55%);
      }
      [data-testid="stHeader"] { background: transparent; }

      /* Esconde ícones/links de cabeçalho */
      a[href^="#"] { display: none !important; }
      button[title*="link"], button[aria-label*="link"] { display:none !important; }

      /* Cards sem borda */
      .card {
        background: rgba(15,23,42,.74);
        border: none;
        border-radius: 14px;
        padding: 12px;
      }

      /* Títulos maiores onde pediu */
      .title { font-size: 20px; font-weight: 950; margin: 0 0 6px 0; }
      .sectionBig { font-size: 18px; font-weight: 950; margin: 10px 0 6px 0; }
      .section { font-size: 15px; font-weight: 900; margin: 10px 0 6px 0; }
      .tiny { color: #cbd5e1; font-size: 13px; margin: 0 0 6px 0; }

      /* Aviso amarelo maior */
      .notice { color: #fbbf24; font-size: 15px; font-weight: 950; margin: 6px 0 10px 0; }

      /* Obrigatório */
      .req { color: #ef4444; font-weight: 950; }

      /* Ícone ? amarelo, pequeno, com tooltip no hover */
      .helpIcon{
        display:inline-flex;
        justify-content:center;
        align-items:center;
        width:16px;
        height:16px;
        margin-left:6px;
        border-radius:999px;
        background:#fbbf24;
        color:#0b1220;
        font-weight:950;
        font-size:12px;
        cursor:help;
        user-select:none;
        line-height:16px;
      }

      /* Alternância visual dos blocos de tarefa */
      .taskA{
        background: rgba(30,41,59,.70);
        border-radius: 14px;
        padding: 10px;
        margin-bottom: 10px;
        border-left: 4px solid rgba(37,99,235,.85);
      }
      .taskB{
        background: rgba(51,65,85,.55);
        border-radius: 14px;
        padding: 10px;
        margin-bottom: 10px;
        border-left: 4px solid rgba(251,191,36,.85);
      }

      /* Inputs sem borda forte */
      input, textarea { box-shadow: none !important; }
      [data-baseweb="input"] > div,
      [data-baseweb="textarea"] > div,
      [data-baseweb="select"] > div {
        border: none !important;
        box-shadow: none !important;
        background: rgba(2,6,23,.45) !important;
        border-radius: 12px !important;
      }
      [data-baseweb="input"] > div:focus-within,
      [data-baseweb="textarea"] > div:focus-within,
      [data-baseweb="select"] > div:focus-within {
        outline: none !important;
        box-shadow: none !important;
        border: none !important;
      }

      /* Botões */
      div.stButton > button[kind="primary"] {
        background: #2563eb !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 12px !important;
        font-weight: 950 !important;
        padding: 0.62rem 0.9rem !important;
      }
      div.stButton > button {
        border-radius: 12px !important;
        font-weight: 900 !important;
        border: none !important;
        padding: 0.58rem 0.9rem !important;
      }

      hr { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 10px 0; }
    </style>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# Modelos de resposta
# -----------------------------
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
# Escalas universais
# -----------------------------
IMPORTANCE = [
    ("Quase não importa", 1),
    ("Importa pouco", 2),
    ("Importa", 3),
    ("Importa muito", 4),
    ("É crítico, não dá para adiar", 5),
]

TIME_COST = [
    ("Menos de 10 min", 1),
    ("10 a 30 min", 2),
    ("30 min a 2 horas", 3),
    ("2 a 6 horas", 4),
    ("Mais de 6 horas", 5),
]

def labels(options): 
    return [x[0] for x in options]

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
        "Você é o PriorizAI. Fale como um colega de trabalho legal, simples e direto. "
        "O usuário tem 16 anos e pouca instrução. "
        "Use o nome do usuário e cite as tarefas para personalizar. "
        "Muito importante: use também a descrição para estimar tempo/complexidade e importância real. "
        "Se a escolha do usuário (importância/tempo) estiver incoerente com a descrição, ajuste sua análise "
        "sem julgar, e explique de forma gentil. "
        "Não invente fatos externos. Use só o que foi informado. "
        "Retorne no schema."
    )

    rule = (
        "Método Impacto e Esforço: faça primeiro o que é MAIS IMPORTANTE e leva MENOS TEMPO. "
        "Depois o que é muito importante mesmo se levar mais tempo. "
        "Por último, coisas pouco importantes e demoradas."
    )

    user = f"""
Nome: {user_name}
Método: {method}

Como aplicar:
{rule}

Tarefas (JSON):
{json.dumps(tasks_payload, ensure_ascii=False)}

Regras da resposta:
- Faça um check: compare IMPORTÂNCIA e TEMPO escolhidos com a DESCRIÇÃO.
- Se a descrição indicar tempo maior/menor, considere isso.
- Se a descrição indicar urgência (prazo/visita/entrega), considere isso.
- Retorne primeiro a ORDEM em tabela (position e task_title) e depois explique.
- friendly_message: curto e personalizado.
- summary: 2 a 3 frases.
- Para cada tarefa: explanation (2 a 5 frases), key_points (2 a 4 itens), tip (1 frase).
- estimated_time_saved_percent: inteiro 0..80, realista.
"""

    resp = client.responses.parse(
        model=model,
        input=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        text_format=PriorizeResult,
    )
    return resp.output_parsed

def scroll_to_top():
    components.html(
        """
        <script>
          var body = window.parent.document.querySelector(".main");
          if(body){ body.scrollTop = 0; }
          window.scrollTo(0,0);
        </script>
        """,
        height=0,
    )

# -----------------------------
# Estado
# -----------------------------
if "task_count" not in st.session_state:
    st.session_state.task_count = 3

# -----------------------------
# Cabeçalho
# -----------------------------
st.markdown('<div class="title">PriorizAI</div>', unsafe_allow_html=True)
st.write("Você escreve suas tarefas. Eu coloco na melhor ordem e explico de um jeito fácil.")
st.caption("Nada fica salvo. Eu só uso o que você preencher agora.")

st.write("")
t1, t2, t3 = st.columns(3)
with t1:
    st.button("PriorizAI", type="primary", use_container_width=True)
with t2:
    st.button("Em breve 2", disabled=True, use_container_width=True)
with t3:
    st.button("Em breve 3", disabled=True, use_container_width=True)

st.write("")
left, right = st.columns([1, 1])

# -----------------------------
# Resultado (direita)
# -----------------------------
with right:
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.markdown('<div class="section">Resultado</div>', unsafe_allow_html=True)
    status_ph = st.empty()
    table_ph = st.empty()
    text_ph = st.empty()
    st.markdown("</div>", unsafe_allow_html=True)

# -----------------------------
# Entrada (esquerda)
# -----------------------------
with left:
    st.markdown('<div class="card">', unsafe_allow_html=True)

    st.markdown('<div class="sectionBig">Seu nome <span class="req">*</span></div>', unsafe_allow_html=True)
    user_name = st.text_input(
        "nome",
        label_visibility="collapsed",
        placeholder="Ex.: Felipe Castelão",
    )

    st.markdown('<div class="section">Método de priorização</div>', unsafe_allow_html=True)
    st.markdown('<div class="tiny">Por enquanto, só o primeiro está liberado.</div>', unsafe_allow_html=True)

    # “Toggles” visíveis, só o primeiro habilitado
    m1, m2, m3, m4 = st.columns(4)
    with m1:
        st.button("Impacto e Esforço", type="primary", use_container_width=True)
        st.markdown(help_icon("Prioriza o que é mais importante e leva menos tempo."), unsafe_allow_html=True)
    with m2:
        st.button("RICE", disabled=True, use_container_width=True)
        st.markdown(help_icon("Método mais técnico. Vai liberar depois."), unsafe_allow_html=True)
    with m3:
        st.button("MoSCoW", disabled=True, use_container_width=True)
        st.markdown(help_icon("Separa em: obrigatório, importante, bom ter, não agora."), unsafe_allow_html=True)
    with m4:
        st.button("GUT", disabled=True, use_container_width=True)
        st.markdown(help_icon("Olha gravidade, urgência e tendência. Vai liberar depois."), unsafe_allow_html=True)

    method: Method = "IMPACT_EFFORT"

    st.markdown("<hr/>", unsafe_allow_html=True)

    st.markdown('<div class="sectionBig">Tarefas</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="tiny">Dica: escreva prazo, quem depende, e o que acontece se atrasar. Quanto mais claro, melhor.</div>',
        unsafe_allow_html=True,
    )
    st.markdown('<div class="notice">Preencha no mínimo 3 tarefas completas.</div>', unsafe_allow_html=True)

    tasks_raw = []
    for idx in range(1, st.session_state.task_count + 1):
        wrap_class = "taskA" if idx % 2 == 1 else "taskB"

        # Primeiras 3 abertas. Extras recolhidas.
        if idx <= 3:
            st.markdown(f"<div class='{wrap_class}'>", unsafe_allow_html=True)
            st.markdown(f"<div class='tiny'><b>Tarefa {idx}</b></div>", unsafe_allow_html=True)

            st.markdown("O que você vai fazer <span class='req'>*</span>", unsafe_allow_html=True)
            title = st.text_input(
                "t",
                key=f"title_{idx}",
                label_visibility="collapsed",
                placeholder="Ex.: Enviar planilha para o fornecedor",
            )

            st.markdown("Explique bem <span class='req'>*</span>", unsafe_allow_html=True)
            desc = st.text_area(
                "d",
                key=f"desc_{idx}",
                label_visibility="collapsed",
                height=80,
                placeholder=(
                    "Ex.: Enviar a planilha X para o fornecedor Y até 16h. "
                    "Se atrasar, o pedido de amanhã pode travar."
                ),
            )

            c1, c2 = st.columns(2)
            with c1:
                st.markdown(
                    f"Quão importante isso é agora {help_icon('Pense no que você ganha ou evita. Se tem prazo, aumenta a importância.')}",
                    unsafe_allow_html=True,
                )
                imp_lbl = st.selectbox(
                    "imp",
                    options=labels(IMPORTANCE),
                    key=f"imp_{idx}",
                    label_visibility="collapsed",
                    index=2,
                )
            with c2:
                st.markdown(
                    f"Quanto tempo isso leva {help_icon('Escolha o tempo total que você acha que vai gastar de verdade.')}",
                    unsafe_allow_html=True,
                )
                time_lbl = st.selectbox(
                    "tm",
                    options=labels(TIME_COST),
                    key=f"time_{idx}",
                    label_visibility="collapsed",
                    index=1,
                )

            st.markdown("</div>", unsafe_allow_html=True)

        else:
            with st.expander(f"Tarefa extra {idx}", expanded=False):
                st.markdown(f"<div class='{wrap_class}'>", unsafe_allow_html=True)

                st.markdown("O que você vai fazer <span class='req'>*</span>", unsafe_allow_html=True)
                title = st.text_input(
                    "t",
                    key=f"title_{idx}",
                    label_visibility="collapsed",
                    placeholder="Ex.: Decidir onde será meu aniversário",
                )

                st.markdown("Explique bem <span class='req'>*</span>", unsafe_allow_html=True)
                desc = st.text_area(
                    "d",
                    key=f"desc_{idx}",
                    label_visibility="collapsed",
                    height=80,
                    placeholder=(
                        "Ex.: Escolher local e confirmar até sexta. "
                        "Preciso ver preço, distância e quem vai."
                    ),
                )

                c1, c2 = st.columns(2)
                with c1:
                    st.markdown(
                        f"Quão importante isso é agora {help_icon('Se tem prazo ou alguém depende disso, marque mais alto.')}",
                        unsafe_allow_html=True,
                    )
                    imp_lbl = st.selectbox(
                        "imp",
                        options=labels(IMPORTANCE),
                        key=f"imp_{idx}",
                        label_visibility="collapsed",
                        index=2,
                    )
                with c2:
                    st.markdown(
                        f"Quanto tempo isso leva {help_icon('Se for grande, marque uma opção mais alta.')}",
                        unsafe_allow_html=True,
                    )
                    time_lbl = st.selectbox(
                        "tm",
                        options=labels(TIME_COST),
                        key=f"time_{idx}",
                        label_visibility="collapsed",
                        index=1,
                    )

                st.markdown("</div>", unsafe_allow_html=True)

        tasks_raw.append(
            {
                "title": (title or "").strip(),
                "description": (desc or "").strip(),
                "importance_label": imp_lbl,
                "time_label": time_lbl,
                "importance": to_num(IMPORTANCE, imp_lbl),
                "time_cost": to_num(TIME_COST, time_lbl),
            }
        )

    st.write("")
    add1, add2 = st.columns([1, 1])
    with add1:
        if st.button("Adicionar tarefa", use_container_width=True, disabled=(st.session_state.task_count >= 10)):
            st.session_state.task_count += 1
            st.rerun()
    with add2:
        st.caption(f"{st.session_state.task_count}/10")

    filled = [t for t in tasks_raw if t["title"] and t["description"]]
    can_run = bool(user_name.strip()) and (len(filled) >= 3)

    st.write("")
    run = st.button("Priorizar com IA", type="primary", use_container_width=True, disabled=not can_run)

    st.markdown("</div>", unsafe_allow_html=True)

# -----------------------------
# Rodar IA + resultado (com scroll e status abaixo de Resultado)
# -----------------------------
if run and can_run:
    scroll_to_top()
    status_ph.info("Priorizando a ordem...")

    payload = [
        {
            "title": t["title"],
            "description": t["description"],
            "user_chosen_importance": t["importance"],
            "user_chosen_time_cost": t["time_cost"],
            "importance_label": t["importance_label"],
            "time_label": t["time_label"],
            "note": "Use também a descrição para corrigir importância e tempo estimado, se fizer sentido.",
        }
        for t in filled
    ]

    try:
        result = call_openai_prioritize(user_name.strip(), method, payload)
        status_ph.empty()

        # Tabela simples primeiro
        table_ph.table([{"Ordem": i.position, "Tarefa": i.task_title} for i in result.ordered_tasks])

        # Texto completo abaixo
        text_ph.success(result.friendly_message)
        text_ph.write(result.summary)
        text_ph.write(f"Tempo economizado (estimado): **{result.estimated_time_saved_percent}%**")
        text_ph.write("")

        for item in result.ordered_tasks:
            text_ph.markdown(f"**{item.position}. {item.task_title}**")
            text_ph.write(item.explanation)
            for p in item.key_points:
                text_ph.write(f"- {p}")
            text_ph.caption(item.tip)
            text_ph.write("")

    except Exception as e:
        status_ph.empty()
        table_ph.empty()
        text_ph.error(str(e))
