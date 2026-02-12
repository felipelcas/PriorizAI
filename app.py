import json
import streamlit as st
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
# Modelos (Structured Outputs)
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
IMPACT = [
    ("Muito baixo", 1),
    ("Baixo", 2),
    ("Médio", 3),
    ("Alto", 4),
    ("Muito alto", 5),
]

EFFORT = [
    ("Muito fácil e rápido", 1),
    ("Fácil", 2),
    ("Médio", 3),
    ("Difícil", 4),
    ("Muito difícil e demorado", 5),
]

REACH = [
    ("Só eu", 1),
    ("Poucas pessoas", 2),
    ("Algumas pessoas", 3),
    ("Muitas pessoas", 4),
    ("Muita gente", 5),
]

CONFIDENCE = [
    ("Baixa certeza", 1),
    ("Alguma certeza", 2),
    ("Boa certeza", 3),
    ("Quase certo", 4),
    ("Certo", 5),
]

G_SEVERITY = [
    ("Leve", 1),
    ("Pouco grave", 2),
    ("Grave", 3),
    ("Muito grave", 4),
    ("Crítico", 5),
]

U_URGENCY = [
    ("Pode esperar", 1),
    ("Sem pressa", 2),
    ("Seria bom fazer logo", 3),
    ("Urgente", 4),
    ("Imediato", 5),
]

T_TREND = [
    ("Não piora", 1),
    ("Piora devagar", 2),
    ("Piora em médio prazo", 3),
    ("Piora rápido", 4),
    ("Vai piorar muito rápido", 5),
]

MOSCOW = [
    ("Obrigatório", "Must"),
    ("Importante", "Should"),
    ("Bom ter", "Could"),
    ("Não agora", "Wont"),
]

def labels(options):
    return [x[0] for x in options]

def map_number(options, selected_label: str) -> int:
    return int({lbl: num for (lbl, num) in options}[selected_label])

def map_moscow(options, selected_label: str) -> str:
    return {lbl: key for (lbl, key) in options}[selected_label]

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

    rules = {
        "IMPACT_EFFORT": (
            "Priorize primeiro o que tiver ALTO impacto e BAIXO esforço. "
            "Depois alto impacto e alto esforço. "
            "Evite baixo impacto e alto esforço."
        ),
        "RICE": "Use RICE = (reach * impact * confidence) / effort. Maior score vem primeiro.",
        "GUT": "Use GUT = G * U * T. Maior score vem primeiro.",
        "MOSCOW": (
            "Ordene por categoria: Must primeiro, depois Should, depois Could, e Wont por último. "
            "Dentro da mesma categoria, use alto impacto e baixo esforço como desempate."
        ),
    }

    system = (
        "Você é PrioriZÉ, um assistente de priorização de tarefas. "
        "Explique como um colega de trabalho: simples, amigável, útil e direto. "
        "Use os nomes das tarefas para personalizar. "
        "Não invente fatos. Use apenas os dados fornecidos. "
        "Retorne no schema."
    )

    user = f"""
Nome do usuário: {user_name}
Método escolhido: {method}

Como aplicar:
{rules[method]}

As escalas numéricas são de 1 a 5 (baixo -> alto).
Os campos também incluem rótulos em texto.

Tarefas (JSON):
{json.dumps(tasks_payload, ensure_ascii=False)}

Regras de resposta:
- Ordene somente tarefas preenchidas.
- friendly_message: curto e levemente informal, mencionando 1 ou 2 tarefas.
- summary: plano geral em 2 a 3 frases.
- Para cada tarefa: explanation (2 a 5 frases), key_factors (2 a 4 itens), tip (1 frase prática).
- estimated_time_saved_percent: inteiro 0..80, realista.
"""

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

if "last_result" not in st.session_state:
    st.session_state.last_result = None

# -----------------------------
# Header
# -----------------------------
st.title("PrioriZÉ")
st.write("Você coloca suas tarefas e eu organizo a melhor ordem para fazer.")
st.caption("Nada é salvo. A IA só recebe o que você preencher no momento.")
st.write("")

# 3 opções (MVP só a primeira)
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
    st.caption("Comece com 3. Para adicionar mais, clique no botão. Até 10.")

    # Método padrão e nomes amigáveis
    method_label_map = {
        "Impacto e Esforço": "IMPACT_EFFORT",
        "RICE": "RICE",
        "MoSCoW": "MOSCOW",
        "GUT": "GUT",
    }

    # Guardar seleção do método em session_state para renderizar campos
    if "method_label" not in st.session_state:
        st.session_state.method_label = "Impacto e Esforço"

    # Render das tarefas (campos mudam conforme método atual)
    tasks_raw = []
    for idx in range(1, st.session_state.task_count + 1):
        with st.expander(f"Tarefa {idx}", expanded=(idx <= 3)):
            title = st.text_input(f"Título {idx}", key=f"title_{idx}")
            desc = st.text_area(
                f"Descrição curta {idx}",
                key=f"desc_{idx}",
                placeholder="Em 1 frase, o que é e qual resultado você quer.",
            )

            # Campos base (sempre)
            col1, col2 = st.columns(2)
            with col1:
                impact_lbl = st.selectbox(
                    f"Impacto {idx}",
                    options=labels(IMPACT),
                    index=2,
                    key=f"impact_lbl_{idx}",
                )
            with col2:
                effort_lbl = st.selectbox(
                    f"Esforço {idx}",
                    options=labels(EFFORT),
                    index=2,
                    key=f"effort_lbl_{idx}",
                )

            # Campos extras por método
            method_key: Method = method_label_map[st.session_state.method_label]

            reach_lbl = None
            conf_lbl = None
            mos_lbl = None
            gut_g_lbl = None
            gut_u_lbl = None
            gut_t_lbl = None

            if method_key == "RICE":
                st.caption("RICE precisa de Alcance e Certeza também.")
                c3, c4 = st.columns(2)
                with c3:
                    reach_lbl = st.selectbox(
                        f"Alcance {idx}",
                        options=labels(REACH),
                        index=2,
                        key=f"reach_lbl_{idx}",
                    )
                with c4:
                    conf_lbl = st.selectbox(
                        f"Certeza {idx}",
                        options=labels(CONFIDENCE),
                        index=2,
                        key=f"conf_lbl_{idx}",
                    )

            elif method_key == "MOSCOW":
                st.caption("MoSCoW: escolha a importância.")
                mos_lbl = st.selectbox(
                    f"Importância {idx}",
                    options=labels(MOSCOW),
                    index=1,
                    key=f"mos_lbl_{idx}",
                )

            elif method_key == "GUT":
                st.caption("GUT: gravidade, urgência e tendência.")
                g1, g2, g3 = st.columns(3)
                with g1:
                    gut_g_lbl = st.selectbox(
                        f"Gravidade {idx}",
                        options=labels(G_SEVERITY),
                        index=2,
                        key=f"gut_g_lbl_{idx}",
                    )
                with g2:
                    gut_u_lbl = st.selectbox(
                        f"Urgência {idx}",
                        options=labels(U_URGENCY),
                        index=2,
                        key=f"gut_u_lbl_{idx}",
                    )
                with g3:
                    gut_t_lbl = st.selectbox(
                        f"Tendência {idx}",
                        options=labels(T_TREND),
                        index=2,
                        key=f"gut_t_lbl_{idx}",
                    )

            tasks_raw.append(
                {
                    "title": (title or "").strip(),
                    "description": (desc or "").strip(),
                    "impact_label": impact_lbl,
                    "effort_label": effort_lbl,
                    "impact": map_number(IMPACT, impact_lbl),
                    "effort": map_number(EFFORT, effort_lbl),

                    "reach_label": reach_lbl,
                    "confidence_label": conf_lbl,
                    "reach": (map_number(REACH, reach_lbl) if reach_lbl else None),
                    "confidence": (map_number(CONFIDENCE, conf_lbl) if conf_lbl else None),

                    "moscow_label": mos_lbl,
                    "moscow": (map_moscow(MOSCOW, mos_lbl) if mos_lbl else None),

                    "gut_g_label": gut_g_lbl,
                    "gut_u_label": gut_u_lbl,
                    "gut_t_label": gut_t_lbl,
                    "gut_g": (map_number(G_SEVERITY, gut_g_lbl) if gut_g_lbl else None),
                    "gut_u": (map_number(U_URGENCY, gut_u_lbl) if gut_u_lbl else None),
                    "gut_t": (map_number(T_TREND, gut_t_lbl) if gut_t_lbl else None),
                }
            )

    # Botão adicionar tarefa
    st.write("")
    a1, a2 = st.columns([1, 1])
    with a1:
        if st.button("Adicionar tarefa", use_container_width=True, disabled=(st.session_state.task_count >= 10)):
            st.session_state.task_count += 1
            st.rerun()
    with a2:
        st.caption(f"Tarefas visíveis: {st.session_state.task_count}/10")

    # Validação (mínimo 3 tarefas completas)
    filled = [t for t in tasks_raw if t["title"]]
    tasks_ok = True

    if len(filled) < 3:
        tasks_ok = False
        st.warning("Preencha pelo menos 3 tarefas (título e descrição).")

    for i, t in enumerate(filled, start=1):
        if not t["description"]:
            tasks_ok = False
            st.warning(f"Complete a descrição da tarefa {i}.")
            break

    st.write("")
    st.subheader("3) Método de priorização")
    st.caption("Escolha o método depois de preencher suas tarefas.")

    st.session_state.method_label = st.selectbox(
        "Critério",
        options=list(method_label_map.keys()),
        index=list(method_label_map.keys()).index(st.session_state.method_label),
        disabled=not tasks_ok,
    )
    method: Method = method_label_map[st.session_state.method_label]

    # Validação extra por método
    if tasks_ok and method == "RICE":
        for i, t in enumerate(filled, start=1):
            if t["reach"] is None or t["confidence"] is None:
                tasks_ok = False
                st.warning(f"Complete Alcance e Certeza na tarefa {i}.")
                break

    if tasks_ok and method == "MOSCOW":
        for i, t in enumerate(filled, start=1):
            if not t["moscow"]:
                tasks_ok = False
                st.warning(f"Complete a Importância (MoSCoW) na tarefa {i}.")
                break

    if tasks_ok and method == "GUT":
        for i, t in enumerate(filled, start=1):
            if t["gut_g"] is None or t["gut_u"] is None or t["gut_t"] is None:
                tasks_ok = False
                st.warning(f"Complete G, U e T na tarefa {i}.")
                break

    st.write("")
    st.subheader("4) Rodar")
    run = st.button(
        "Priorizar com IA",
        type="primary",
        use_container_width=True,
        disabled=(not user_name.strip() or not tasks_ok),
    )

    st.markdown("</div>", unsafe_allow_html=True)

# -----------------------------
# Output
# -----------------------------
with right:
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.subheader("Resultado")
    st.caption("Ordem sugerida, com explicação amigável e dicas práticas.")

    if run:
        try:
            tasks_payload = []
            for t in filled:
                base = {
                    "title": t["title"],
                    "description": t["description"],
                    "impact": t["impact"],
                    "effort": t["effort"],
                    "impact_label": t["impact_label"],
                    "effort_label": t["effort_label"],
                    "scale": "1 a 5 (baixo -> alto), escolhidos por rótulos em texto.",
                }

                if method == "RICE":
                    base.update({
                        "reach": t["reach"],
                        "confidence": t["confidence"],
                        "reach_label": t["reach_label"],
                        "confidence_label": t["confidence_label"],
                    })

                if method == "MOSCOW":
                    base.update({
                        "moscow": t["moscow"],
                        "moscow_label": t["moscow_label"],
                    })

                if method == "GUT":
                    base.update({
                        "gut_g": t["gut_g"],
                        "gut_u": t["gut_u"],
                        "gut_t": t["gut_t"],
                        "gut_g_label": t["gut_g_label"],
                        "gut_u_label": t["gut_u_label"],
                        "gut_t_label": t["gut_t_label"],
                    })

                tasks_payload.append(base)

            with st.spinner("Organizando suas tarefas com IA..."):
                result = call_openai_prioritize(user_name.strip(), method, tasks_payload)

            st.session_state.last_result = result.model_dump()

        except Exception as e:
            st.session_state.last_result = {"error": str(e)}

    # Render do último resultado
    if st.session_state.last_result:
        if "error" in st.session_state.last_result:
            st.error(st.session_state.last_result["error"])
            st.info("Se for chave, revise os Secrets no Streamlit Cloud.")
        else:
            r = st.session_state.last_result
            st.success(r["friendly_message"])
            st.write(f"Método: **{r['method_used']}**")
            st.write(f"Tempo economizado (estimado): **{r['estimated_time_saved_percent']}%**")
            st.write("")
            st.write(r["summary"])
            st.write("")

            for item in r["ordered_tasks"]:
                st.markdown(f"### {item['position']}. {item['task_title']}")
                st.write(item["explanation"])
                st.write("**Pontos que pesaram:**")
                for k in item["key_factors"]:
                    st.write(f"- {k}")
                st.caption(item["tip"])
                st.write("")

    st.markdown("</div>", unsafe_allow_html=True)
