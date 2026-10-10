import os
import time
import asyncio
import uuid

import psycopg2

import httpx
from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from dotenv import load_dotenv


load_dotenv("gateway.env")

app = FastAPI(title="Lele AI Gateway")


# --------------------------------------------------------------------------
# GOOGLE AUTH (per /api/admin/* e /api/agent-arena/start|stop|hand|intervene)
# --------------------------------------------------------------------------
# Richiesto da env, niente default in chiaro nel codice.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

# Lista di email autorizzate, separate da virgole:
#   ADMIN_ALLOWED_EMAIL="a@example.com,b@example.com"
ADMIN_ALLOWED_EMAILS = [
    e.strip().lower()
    for e in os.environ.get("ADMIN_ALLOWED_EMAIL", "").split(",")
    if e.strip()
]

_google_request = google_requests.Request()


# Mappa email -> chat_id Telegram personale.
#
# Serve per far parlare Leles con il contesto Telegram corretto
# quando si entra dal sito invece che da Telegram.
#
# Formato:
#   ADMIN_USER_CHAT_IDS="a@example.com:123456789"
#
# Se l'email verificata è nella mappa, il suo chat_id SOSTITUISCE
# quello eventualmente generato/passato dal browser.
# Se non c'è, resta quello del browser.
ADMIN_USER_CHAT_IDS = {}

for pair in os.environ.get("ADMIN_USER_CHAT_IDS", "").split(","):
    if ":" in pair:
        _mail, _cid = pair.split(":", 1)
        _mail = _mail.strip().lower()
        _cid = _cid.strip()

        if _mail and _cid.isdigit():
            ADMIN_USER_CHAT_IDS[_mail] = int(_cid)


def verify_admin_token(authorization: str | None) -> str:
    """
    Verifica l'ID token Google passato come:
        Authorization: Bearer <token>

    Ritorna l'email verificata, oppure solleva HTTPException 401/403.
    """
    if not GOOGLE_CLIENT_ID or not ADMIN_ALLOWED_EMAILS:
        raise HTTPException(
            status_code=500,
            detail=(
                "Admin auth non configurata sul server "
                "(GOOGLE_CLIENT_ID / ADMIN_ALLOWED_EMAIL mancanti)."
            ),
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Token mancante.",
        )

    token = authorization.split(" ", 1)[1]

    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            _google_request,
            GOOGLE_CLIENT_ID,
        )
    except ValueError:
        raise HTTPException(
            status_code=401,
            detail="Token non valido o scaduto.",
        )

    if not idinfo.get("email_verified"):
        raise HTTPException(
            status_code=401,
            detail="Email Google non verificata.",
        )

    email = (idinfo.get("email") or "").strip().lower()

    if email not in ADMIN_ALLOWED_EMAILS:
        raise HTTPException(
            status_code=403,
            detail="Accesso non autorizzato.",
        )

    return email


def get_connection():
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        port=os.environ.get("PGPORT", "5432"),
        dbname=os.environ.get("PGDATABASE"),
        user=os.environ.get("PGUSER"),
        password=os.environ.get("PGPASSWORD"),
    )


# --------------------------------------------------------------------------
# CONFIGURAZIONE AGENTE ADMIN
# --------------------------------------------------------------------------
# NON entra nel dict AGENTS pubblico apposta.
# Resta raggiungibile solo via Telegram / /api/admin/chat.
ADMIN_AGENT = {
    "port": 8082,
    "path": "/ask",
    "payload": "message",
}


# --------------------------------------------------------------------------
# FORWARD CONDIVISO
# --------------------------------------------------------------------------
async def forward_to_agent(
    config: dict,
    prompt: str,
    chat_id: int,
    language: str,
    agent_label: str,
    user_email: str | None = None,
):
    """
    Logica di forward condivisa tra /api/chat e /api/admin/chat.
    """
    port = config["port"]
    path = config["path"]
    payload_field = config["payload"]

    target_url = f"http://127.0.0.1:{port}{path}"

    payload = {
        payload_field: prompt,
        "language": language,
        "chat_id": chat_id,
    }

    if user_email:
        # L'agente può usarlo per registrare CHI ha parlato
        # (log su PostgreSQL).
        payload["user_email"] = user_email

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            response = await client.post(
                target_url,
                json=payload,
            )

            if response.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail={
                        "agent": agent_label,
                        "target": target_url,
                        "status": response.status_code,
                        "response": response.text,
                    },
                )

            return response.json()

        except HTTPException:
            raise

        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Impossibile raggiungere {agent_label} "
                    f"sulla porta {port}: {str(e)}"
                ),
            )


# --------------------------------------------------------------------------
# CORS
# --------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# CONFIGURAZIONE AGENTI PUBBLICI
# --------------------------------------------------------------------------
# Lele Admin è volutamente escluso.
AGENTS = {
    "Lele I": {
        "port": 8080,
        "path": "/ask",
        "payload": "message",
    },
    "Bar_AI demo": {
        "port": 8081,
        "path": "/ask",
        "payload": "message",
    },
    "Story Whisper": {
        "port": 8088,
        "path": "/ask",
        "payload": "message",
        "audio_path": "/ask/audio",
    },
    "Night Story": {
        "port": 8666,
        "path": "/ask",
        "payload": "message",
        "audio_path": "/ask/audio",
    },
}


# --------------------------------------------------------------------------
# CHAT REQUEST
# --------------------------------------------------------------------------
class ChatRequest(BaseModel):
    agent: str
    prompt: str
    chat_id: int = 1010101010
    language: str = "en"


# --------------------------------------------------------------------------
# ROOT
# --------------------------------------------------------------------------
@app.get("/")
async def root():
    return {
        "status": "Gateway Online",
        "agents": list(AGENTS.keys()),
    }


# --------------------------------------------------------------------------
# BAR AI PROXY
# --------------------------------------------------------------------------
class BarAIRequest(BaseModel):
    question: str
    plan: str = "Basic"
    restaurant_id: int = 1
    user_id: str = "default"


@app.api_route("/api/bar-ai/ask", methods=["POST", "OPTIONS"])
@app.api_route("/api/bar-ai/ask/", methods=["POST", "OPTIONS"])
async def bar_ai_ask(req: BarAIRequest | None = None):
    # Nota: se FastAPI riceve OPTIONS con payload vuoto, req sarà None
    # e rispondiamo subito OK 200 (preflight CORS).

    target_url = "http://127.0.0.1:8081/ask"

    if req is None:
        return {"status": "ok"}

    payload = {
        "question": req.question,
        "plan": req.plan,
        "restaurant_id": req.restaurant_id,
        "user_id": req.user_id,
    }

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            response = await client.post(
                target_url,
                json=payload
            )
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Impossibile raggiungere Bar AI "
                    f"su porta 8081: {str(e)}"
                )
            )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    return response.json()


# --------------------------------------------------------------------------
# CHAT TESTUALE
# --------------------------------------------------------------------------
@app.post("/api/chat")
@app.post("/api/chat/")
async def chat_router(req: ChatRequest):
    config = AGENTS.get(req.agent)

    if not config:
        raise HTTPException(
            status_code=400,
            detail=f"Agente '{req.agent}' non configurato.",
        )

    port = config["port"]
    path = config["path"]
    payload_field = config["payload"]

    target_url = f"http://127.0.0.1:{port}{path}"

    payload = {
        payload_field: req.prompt,
        "language": req.language,
        "chat_id": req.chat_id,
    }

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            response = await client.post(
                target_url,
                json=payload,
            )

            if response.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail={
                        "agent": req.agent,
                        "target": target_url,
                        "status": response.status_code,
                        "response": response.text,
                    },
                )

            return response.json()

        except HTTPException:
            raise

        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Impossibile raggiungere {req.agent} "
                    f"sulla porta {port}: {str(e)}"
                ),
            )


# --------------------------------------------------------------------------
# CHAT AUDIO
# --------------------------------------------------------------------------
@app.post("/api/chat/audio")
@app.post("/api/chat/audio/")
async def chat_router_audio(
    audio: UploadFile = File(...),
    agent: str = Form(...),
    chat_id: int = Form(1010101010),
    language: str = Form("en"),
):
    config = AGENTS.get(agent)

    if not config:
        raise HTTPException(
            status_code=400,
            detail=f"Agente '{agent}' non configurato.",
        )

    audio_path = config.get("audio_path")

    if not audio_path:
        raise HTTPException(
            status_code=400,
            detail=f"'{agent}' non supporta ancora l'input audio.",
        )

    port = config["port"]
    target_url = f"http://127.0.0.1:{port}{audio_path}"

    audio_bytes = await audio.read()

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            files = {
                "file": (
                    audio.filename or "recording.webm",
                    audio_bytes,
                    audio.content_type,
                )
            }

            data = {
                "chat_id": str(chat_id),
                "language": language,
            }

            response = await client.post(
                target_url,
                files=files,
                data=data,
            )

            if response.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail={
                        "agent": agent,
                        "target": target_url,
                        "status": response.status_code,
                        "response": response.text,
                    },
                )

            return response.json()

        except HTTPException:
            raise

        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Impossibile raggiungere {agent} "
                    f"sulla porta {port}: {e}"
                ),
            )


# --------------------------------------------------------------------------
# TTS PROXY
# --------------------------------------------------------------------------
@app.get("/api/chat/tts/{agent}/{filename}")
@app.get("/api/chat/tts/{agent}/{filename}/")
async def tts_proxy(agent: str, filename: str):
    config = AGENTS.get(agent)

    if not config:
        raise HTTPException(
            status_code=400,
            detail=f"Agente '{agent}' non configurato.",
        )

    port = config["port"]
    target_url = f"http://127.0.0.1:{port}/tts/{filename}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.get(target_url)

            if response.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"Audio non trovato per "
                        f"'{agent}' ({filename})."
                    ),
                )

            return Response(
                content=response.content,
                media_type="audio/ogg",
            )

        except HTTPException:
            raise

        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Impossibile raggiungere {agent} "
                    f"sulla porta {port}: {e}"
                ),
            )


# --------------------------------------------------------------------------
# ADMIN CHAT
# --------------------------------------------------------------------------
class AdminChatRequest(BaseModel):
    prompt: str
    chat_id: int = 1010101010
    language: str = "en"


@app.post("/api/admin/chat")
@app.post("/api/admin/chat/")
async def admin_chat_router(
    req: AdminChatRequest,
    authorization: str | None = Header(None),
):
    # Verifica Google e recupera l'email reale dell'utente.
    email = verify_admin_token(authorization)

    # Se l'email è configurata nella mappa server-side,
    # usa il chat_id Telegram associato.
    #
    # Altrimenti mantiene il chat_id passato dal browser.
    chat_id = ADMIN_USER_CHAT_IDS.get(
        email,
        req.chat_id
    )

    return await forward_to_agent(
        ADMIN_AGENT,
        req.prompt,
        chat_id,
        req.language,
        "Lele Admin",
        user_email=email,
    )


# ==========================================================================
# AGENT ARENA — BOT TO BOT LAB TEST 2
# ==========================================================================

ARENA_AGENT_PORTS = {
    "night_story": 8666,
    "story_whisper": 8088,
    "leles": 8082,
    "super_leles": 8082,
    "qe": 8082,
}


# Run attivi in memoria.
#
# L'Arena usa la memoria per il live polling.
# La persistenza storica è PostgreSQL.
ARENA_RUNS: dict[str, dict] = {}


MAX_PARTICIPANTS = 12
# 1 = anche un solo bot (improve mirato dalla pagina /improve).
MIN_PARTICIPANTS = 1

# Tetti anti-costo / anti-abuso.
MAX_TURNS = 50
MAX_TOTAL_MESSAGES = 600
MAX_ACTIVE_RUNS = 3
RUN_TTL_SECONDS = 3600

# "PAUSED" = mano alzata: il run è fermo in attesa dell'umano,
# quindi conta come run attivo.
ACTIVE_STATUSES = ("STARTING", "RUNNING", "PAUSED")
FINISHED_STATUSES = ("COMPLETED", "STOPPED", "ERROR")

# Raise hand: tetti anti-abuso per gli interventi umani.
# MAX_HUMAN_CHARS DEVE restare allineato con ProjectTest.jsx.
MAX_HUMAN_CHARS = 2000
MAX_HUMAN_INTERVENTIONS = 20
# Se nessuno interviene entro questo tempo, il run riprende da solo.
HAND_TIMEOUT_SECONDS = 600

# Allowlist: DEVE restare allineata con ProjectTest.jsx.
# Questi sono i modelli consentiti per gli agenti normali.
ALLOWED_MODELS = {
    "gemma4",
    "llama3",
    "mistral",
    "qwen2.5",
    "deepseek-r1",
}

# Super-Leles può usare tutti i modelli esposti da HomeTest4.
# In particolare può usare GPT-OSS e Qwen Coder.
SUPER_LELES_ALLOWED_MODELS = {
    "gemma4",
    "llama3",
    "mistral",
    "qwen2.5",
    "deepseek-r1",
    "qwen2.5-coder:7b",
    "gpt-oss:20b",
}

ALLOWED_CHARACTERS = {
    "horror",
    "drammatica",
    "comico",
    "ose",
    "ricerca",
    "random",
    "amore",
    "culturale",
}

ALLOWED_ROLES = {
    "Planner",
    "Scientist",
    "Builder",
    "Critic",
    "Observer",
    "Architect",
    "Developer",
    "Tester",
    "Reviewer",
    "Sheriff",
    "Outlaw",
    "Explorer",
}

# Topic delle Arena normali.
MAX_TOPIC_CHARS = 4000

# Topic delle Arena "improve": contiene un intero file .py
# (fino a _IMPROVE_MAX_CHARS = 40.000) più le istruzioni.
MAX_TOPIC_CHARS_IMPROVE = 48_000


class ArenaParticipant(BaseModel):
    agent: str
    character: str = ""
    role: str = ""
    model: str = ""


class AgentArenaRequest(BaseModel):
    participants: list[ArenaParticipant]

    world_source: str = "free"
    world_ref: str = ""
    topic: str = ""

    max_turns: int = 10

    # Modalità improve (pagina /improve):
    #  - ogni bot riceve il topic (file + regole) E l'ultima proposta,
    #    non solo il messaggio precedente;
    #  - i bot "qe" usano chat isolate; Super-Leles resta sulla chat
    #    admin perche in lele_api e un comando riservato.
    improve: bool = False


class ArenaInterveneRequest(BaseModel):
    # Testo vuoto = "riprendi senza scrivere".
    text: str = ""


def _validate_arena_request(req: AgentArenaRequest) -> None:
    """
    Validazione unica, usata dall'endpoint start.
    """
    n = len(req.participants)

    if not (MIN_PARTICIPANTS <= n <= MAX_PARTICIPANTS):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Numero partecipanti deve essere "
                f"tra {MIN_PARTICIPANTS} e {MAX_PARTICIPANTS}."
            ),
        )

    if not 1 <= req.max_turns <= MAX_TURNS:
        raise HTTPException(
            status_code=400,
            detail=f"max_turns deve essere compreso tra 1 e {MAX_TURNS}.",
        )

    if req.max_turns * n > MAX_TOTAL_MESSAGES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Troppi messaggi totali "
                f"({req.max_turns * n}, massimo {MAX_TOTAL_MESSAGES}). "
                f"Riduci i giri o i partecipanti."
            ),
        )

    for i, p in enumerate(req.participants):
        if p.agent not in ARENA_AGENT_PORTS:
            raise HTTPException(
                status_code=400,
                detail=f"Agente non valido (slot {i}): {p.agent}",
            )

        if p.model:
            allowed_models = (
                SUPER_LELES_ALLOWED_MODELS
                if p.agent == "super_leles"
                else ALLOWED_MODELS
            )

            if p.model not in allowed_models:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Modello non consentito "
                        f"(slot {i}, agente {p.agent}): {p.model}"
                    ),
                )

        if p.character and p.character not in ALLOWED_CHARACTERS:
            raise HTTPException(
                status_code=400,
                detail=f"Character non valido (slot {i}): {p.character}",
            )

        if p.role and p.role not in ALLOWED_ROLES:
            raise HTTPException(
                status_code=400,
                detail=f"Ruolo non valido (slot {i}): {p.role}",
            )

    if req.world_source not in ("free", "emergence"):
        raise HTTPException(
            status_code=400,
            detail="world_source deve essere 'free' oppure 'emergence'.",
        )

    max_topic = (
        MAX_TOPIC_CHARS_IMPROVE
        if req.improve
        else MAX_TOPIC_CHARS
    )

    if len(req.topic) > max_topic:
        raise HTTPException(
            status_code=400,
            detail=f"Topic troppo lungo (massimo {max_topic} caratteri).",
        )

    if req.world_source == "emergence" and not str(req.world_ref).strip().isdigit():
        raise HTTPException(
            status_code=400,
            detail="world_ref deve essere l'ID numerico di un Emergence World.",
        )


def _arena_cleanup() -> None:
    """
    Rimuove dalla memoria i run finiti da più di RUN_TTL_SECONDS.
    """
    now = time.time()

    expired = [
        rid
        for rid, r in ARENA_RUNS.items()
        if r.get("status") in FINISHED_STATUSES
        and now - r.get("finished_at", now) > RUN_TTL_SECONDS
    ]

    for rid in expired:
        ARENA_RUNS.pop(rid, None)


def _arena_chat_id(
    run_id: str,
    idx: int,
) -> int:
    """
    Crea un chat_id deterministico diverso per ogni partecipante.
    """
    value = uuid.UUID(run_id).int

    return 100000000 + (
        (value + idx + 1) % 900000000
    )


async def _arena_call(
    agent_id: str,
    message: str,
    chat_id: int,
    character: str = "",
    role: str = "",
    model: str = "",
):
    """
    Chiama un agente locale per un singolo turno Arena.

    Super-Leles usa la stessa porta di Leles (8082), ma viene
    attivato esplicitamente tramite il trigger "sl ".
    """

    port = ARENA_AGENT_PORTS.get(
        agent_id
    )

    if port is None:
        raise RuntimeError(
            f"Agente arena non configurato: {agent_id}"
        )

    # --------------------------------------------------
    # SUPER-LELES
    # --------------------------------------------------
    # Super-Leles vive sulla stessa API di Leles, ma il
    # Timoniere lo attiva tramite il trigger "sl ".
    if agent_id == "super_leles":

        prompt = f"sl {message}".strip()

        payload = {
            "message": prompt,
            "chat_id": chat_id,
        }

        if model:
            payload["model"] = model

    # --------------------------------------------------
    # NIGHT STORY
    # --------------------------------------------------
    elif agent_id == "night_story":

        payload = {
            "message": message,
            "chat_id": chat_id,
        }

        if character:
            payload["character"] = character

        if model:
            payload["model"] = model

    # --------------------------------------------------
    # QE / LELES
    # --------------------------------------------------
    elif agent_id in (
        "qe",
        "leles",
    ):

        payload = {
            "message": message,
            "chat_id": chat_id,
        }

        if role:
            payload["role"] = role

        if model:
            payload["model"] = model

    # --------------------------------------------------
    # FALLBACK
    # --------------------------------------------------
    else:

        payload = {
            "message": message,
            "chat_id": chat_id,
        }

        if model:
            payload["model"] = model

    # Dichiara a lele_api QUALE agente sta chiamando l'Arena, cosi non
    # deve indovinarlo dalle parole del testo (route() usa trigger a
    # parole chiave: un file con "query" o "review" nel testo veniva
    # instradato al comando sbagliato). Se lele_api non conosce il campo
    # Pydantic lo ignora, quindi e retrocompatibile.
    if agent_id in ("qe", "super_leles"):
        payload["arena_agent"] = agent_id

    target_url = (
        f"http://127.0.0.1:{port}/ask"
    )

    async with httpx.AsyncClient(
        timeout=620.0
    ) as client:

        try:

            response = await client.post(
                target_url,
                json=payload,
            )

            if response.status_code >= 400:
                raise RuntimeError(
                    f"{agent_id} ha restituito "
                    f"HTTP {response.status_code}: "
                    f"{response.text}"
                )

            data = response.json()

        except httpx.RequestError as e:

            raise RuntimeError(
                f"Impossibile raggiungere "
                f"{agent_id} sulla porta {port}: {e}"
            )

    answer = (
        data.get("answer")
        or data.get("text")
        or ""
    )

    if not answer:
        raise RuntimeError(
            f"{agent_id} ha restituito "
            f"una risposta vuota."
        )

    return answer


async def _arena_load_world(
    world_ref: str,
    admin_chat_id: int | None,
) -> str:
    """
    Recupera un Emergence World già salvato tramite Leles.
    """

    world_ref = str(
        world_ref or ""
    ).strip()

    if not world_ref.isdigit():
        raise RuntimeError(
            "world_ref deve essere l'ID numerico "
            "di un Emergence World."
        )

    if admin_chat_id is None:
        raise RuntimeError(
            "Nessun chat_id Telegram configurato per questa email "
            "(ADMIN_USER_CHAT_IDS): impossibile leggere l'Emergence World."
        )

    result = await _arena_call(
        "leles",
        f"query world {world_ref}",
        admin_chat_id,
    )

    if not result:
        raise RuntimeError(
            f"Emergence World #{world_ref} vuoto."
        )

    if result.startswith("❌"):
        raise RuntimeError(result)

    return result


# --------------------------------------------------------------------------
# ARENA — DATABASE PERSISTENCE
# --------------------------------------------------------------------------

def _arena_db_create_run(
    run_id: str,
    cfg: AgentArenaRequest,
    world_id: int | None = None,
):
    """
    Crea il record Arena e tutti i partecipanti.
    """
    conn = get_connection()

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO emergence.arena_runs (
                    run_id,
                    world_id,
                    world_source,
                    topic,
                    max_turns,
                    status
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s
                )
                RETURNING id
                """,
                (
                    run_id,
                    world_id,
                    cfg.world_source,
                    cfg.topic,
                    cfg.max_turns,
                    "STARTING",
                ),
            )

            arena_run_id = cur.fetchone()[0]

            for idx, p in enumerate(cfg.participants):
                cur.execute(
                    """
                    INSERT INTO emergence.arena_participants (
                        arena_run_id,
                        participant_index,
                        agent,
                        character,
                        role,
                        model
                    )
                    VALUES (
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s
                    )
                    """,
                    (
                        arena_run_id,
                        idx,
                        p.agent,
                        p.character,
                        p.role,
                        p.model,
                    ),
                )

        conn.commit()
        return arena_run_id

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()


def _arena_db_add_turn(
    arena_run_id: int,
    turn_number: int,
    round_number: int,
    participant_index: int,
    agent: str,
    character: str,
    role: str,
    model: str,
    message: str,
):
    """
    Salva immediatamente un messaggio Arena.
    """
    conn = get_connection()

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO emergence.arena_turns (
                    arena_run_id,
                    turn_number,
                    round_number,
                    participant_index,
                    agent,
                    character,
                    role,
                    model,
                    message
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s
                )
                """,
                (
                    arena_run_id,
                    turn_number,
                    round_number,
                    participant_index,
                    agent,
                    character,
                    role,
                    model,
                    message,
                ),
            )

        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()


def _arena_db_update_status(
    arena_run_id: int,
    status: str,
    error: str | None = None,
):
    """
    Aggiorna lo stato persistente del run.
    """
    conn = get_connection()

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE emergence.arena_runs
                SET
                    status = %s,
                    error = %s,
                    started_at = CASE
                        WHEN %s = 'RUNNING'
                             AND started_at IS NULL
                        THEN CURRENT_TIMESTAMP
                        ELSE started_at
                    END,
                    ended_at = CASE
                        WHEN %s IN (
                            'COMPLETED',
                            'STOPPED',
                            'ERROR'
                        )
                        THEN CURRENT_TIMESTAMP
                        ELSE ended_at
                    END
                WHERE id = %s
                """,
                (
                    status,
                    error,
                    status,
                    status,
                    arena_run_id,
                ),
            )

        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()


def _arena_db_update_status_safe(
    arena_run_id: int,
    status: str,
):
    """
    Come _arena_db_update_status, ma non interrompe mai il run.

    Usata per PAUSED / RUNNING durante la mano alzata: se la colonna
    status ha un CHECK che non conosce 'PAUSED', il run non va in ERROR,
    resta solo lo stato in memoria (quello che legge il live polling).
    """
    try:
        _arena_db_update_status(
            arena_run_id,
            status,
        )
    except Exception as e:
        print(
            f"[arena] aggiornamento stato DB '{status}' "
            f"non riuscito (ignorato): {e}"
        )


async def _arena_handle_hand(
    run: dict,
    arena_run_id: int,
    round_number: int,
    last_msg: str,
) -> str:
    """
    Gestisce la "mano alzata".

    - mette il run in PAUSED
    - aspetta /intervene (oppure HAND_TIMEOUT_SECONDS)
    - se c'è un testo umano lo registra come turno agent="human"
      (memoria + DB) e lo accoda all'ultimo messaggio

    Ritorna il nuovo last_msg per il prossimo bot.

    Ogni bot riceve SOLO last_msg, quindi il testo umano non lo sostituisce:
    viene concatenato alla risposta precedente.
    """

    run["status"] = "PAUSED"

    _arena_db_update_status_safe(
        arena_run_id,
        "PAUSED",
    )

    # Nessun await tra status=PAUSED e clear(): /intervene non può
    # inserirsi in mezzo.
    run["resume"].clear()

    try:
        await asyncio.wait_for(
            run["resume"].wait(),
            timeout=HAND_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        # Nessun intervento: il run riprende da solo.
        pass

    text = (
        run.get("human_text") or ""
    ).strip()

    run["human_text"] = ""
    run["hand"] = False
    run["status"] = "RUNNING"

    _arena_db_update_status_safe(
        arena_run_id,
        "RUNNING",
    )

    if not text:
        return last_msg

    message_number = len(run["turns"]) + 1

    run["turns"].append(
        {
            "id": message_number,
            "turn": round_number,
            "idx": -1,
            "agent": "human",
            "character": "",
            "role": "",
            "model": "",
            "text": text,
        }
    )

    try:
        _arena_db_add_turn(
            arena_run_id=arena_run_id,
            turn_number=message_number,
            round_number=round_number,
            participant_index=-1,
            agent="human",
            character="",
            role="",
            model="",
            message=text,
        )
    except Exception as e:
        # Il messaggio è comunque nel live; se il DB lo rifiuta
        # (es. vincoli su agent/participant_index) il run non si ferma.
        print(
            f"[arena] salvataggio turno umano su DB "
            f"non riuscito (ignorato): {e}"
        )

    return (
        f"{last_msg}\n\n"
        f"[Intervento umano]: {text}\n\n"
        f"Tieni conto dell'intervento umano nella tua risposta."
    )


async def _run_agent_arena(
    run_id: str,
    cfg: AgentArenaRequest,
    admin_chat_id: int | None = None,
    arena_run_id: int | None = None,
):
    """
    Esegue il loop round-robin su N partecipanti.

    max_turns = numero di giri completi.
    """

    run = ARENA_RUNS[run_id]

    if arena_run_id is None:
        raise RuntimeError(
            "Arena DB run id mancante."
        )

    try:

        # --------------------------------------------------
        # OPENING
        # --------------------------------------------------

        if cfg.world_source == "emergence":

            opening = await _arena_load_world(
                cfg.world_ref,
                admin_chat_id,
            )

        else:

            opening = (
                cfg.topic or ""
            ).strip()

        if not opening:

            raise RuntimeError(
                "Inserisci un topic oppure "
                "seleziona un Emergence World."
            )

        run["status"] = "RUNNING"

        _arena_db_update_status(
            arena_run_id,
            "RUNNING",
        )

        run["opening"] = opening

        last_msg = opening

        # --------------------------------------------------
        # ARENA LOOP — ROUND ROBIN SU N PARTECIPANTI
        # --------------------------------------------------

        for turn in range(cfg.max_turns):

            for idx, p in enumerate(cfg.participants):

                if run["stop"]:

                    run["status"] = "STOPPED"

                    _arena_db_update_status(
                        arena_run_id,
                        "STOPPED",
                    )

                    return

                # ----------------------------------------------
                # MANO ALZATA: pausa + intervento umano
                # ----------------------------------------------
                # Controllata prima di ogni turno di bot: il turno in
                # corso finisce sempre, poi il run si ferma qui.

                if run.get("hand"):

                    last_msg = await _arena_handle_hand(
                        run,
                        arena_run_id,
                        turn + 1,
                        last_msg,
                    )

                # ----------------------------------------------
                # MESSAGGIO IN INGRESSO AL BOT
                # ----------------------------------------------
                # Arena normale: il bot vede SOLO l'ultimo messaggio.
                #
                # Improve: dal secondo messaggio in poi il bot vede
                # anche il topic (file + regole anti-invenzione),
                # altrimenti lavora senza istruzioni e senza il file.

                msg_in = last_msg

                if cfg.improve and not (turn == 0 and idx == 0):
                    msg_in = (
                        f"{opening}\n\n"
                        f"=== ULTIMA PROPOSTA / MESSAGGIO PRECEDENTE ===\n"
                        f"{last_msg}"
                    )

                # Super-Leles usa SEMPRE la chat Telegram personale
                # dell'admin: in lele_api e un comando riservato
                # ("admin-only"), con una chat isolata risponderebbe
                # "Comando riservato al capitano." come se fosse una
                # proposta valida. Gli altri bot usano chat isolate.

                use_admin_chat = (
                    p.agent == "super_leles"
                    and admin_chat_id is not None
                )

                answer = await _arena_call(
                    agent_id=p.agent,
                    message=msg_in,
                    chat_id=(
                        admin_chat_id
                        if use_admin_chat
                        else _arena_chat_id(run_id, idx)
                    ),
                    character=p.character,
                    role=p.role,
                    model=p.model,
                )

                message_number = len(run["turns"]) + 1

                character = (
                    p.character
                    if p.agent == "night_story"
                    else ""
                )

                role = (
                    p.role
                    if p.agent in (
                        "qe",
                        "leles",
                    )
                    else ""
                )

                run["turns"].append(
                    {
                        "id": message_number,
                        "turn": turn + 1,
                        "idx": idx,
                        "agent": p.agent,
                        "character": character,
                        "role": role,
                        "model": p.model,
                        "text": answer,
                    }
                )

                _arena_db_add_turn(
                    arena_run_id=arena_run_id,
                    turn_number=message_number,
                    round_number=turn + 1,
                    participant_index=idx,
                    agent=p.agent,
                    character=character,
                    role=role,
                    model=p.model,
                    message=answer,
                )

                last_msg = answer

        # --------------------------------------------------
        # COMPLETED
        # --------------------------------------------------

        run["status"] = "COMPLETED"

        _arena_db_update_status(
            arena_run_id,
            "COMPLETED",
        )

    except asyncio.CancelledError:

        run["status"] = "STOPPED"

        _arena_db_update_status(
            arena_run_id,
            "STOPPED",
        )

        raise

    except Exception as e:

        run["status"] = "ERROR"
        run["error"] = str(e)

        try:
            _arena_db_update_status(
                arena_run_id,
                "ERROR",
                str(e),
            )
        except Exception as db_error:
            run["error"] = (
                f"{e} | DB status update failed: {db_error}"
            )

    finally:

        run["finished_at"] = time.time()


# --------------------------------------------------------------------------
# START ARENA  (Google auth obbligatoria)
# --------------------------------------------------------------------------
@app.post("/api/agent-arena/start")
async def agent_arena_start(
    req: AgentArenaRequest,
    authorization: str | None = Header(None),
):
    # Solo utenti Google autorizzati possono lanciare run.
    email = verify_admin_token(authorization)

    _validate_arena_request(req)

    _arena_cleanup()

    active = sum(
        1
        for r in ARENA_RUNS.values()
        if r.get("status") in ACTIVE_STATUSES
    )

    if active >= MAX_ACTIVE_RUNS:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Troppi run attivi ({active}/{MAX_ACTIVE_RUNS}). "
                f"Ferma o attendi un run in corso."
            ),
        )

    run_id = str(
        uuid.uuid4()
    )

    # ------------------------------------------------------
    # PERSISTENZA DB
    # ------------------------------------------------------
    #
    # world_id resta None per ora.
    # Il World viene comunque recuperato da Leles quando
    # world_source == "emergence".
    # ------------------------------------------------------

    try:
        arena_run_id = _arena_db_create_run(
            run_id=run_id,
            cfg=req,
            world_id=None,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Impossibile creare Arena run nel DB: {e}",
        )

    ARENA_RUNS[run_id] = {
        "status": "STARTING",
        "turns": [],
        "stop": False,
        "error": None,
        "opening": "",
        "task": None,
        "owner": email,
        "finished_at": None,
        "arena_run_id": arena_run_id,
        # --- raise hand ---
        "hand": False,
        "resume": asyncio.Event(),
        "human_text": "",
        "human_count": 0,
    }

    ARENA_RUNS[run_id]["task"] = (
        asyncio.create_task(
            _run_agent_arena(
                run_id,
                req,
                ADMIN_USER_CHAT_IDS.get(email),
                arena_run_id,
            )
        )
    )

    return {
        "run_id": run_id
    }


# --------------------------------------------------------------------------
# ARENA STATUS
# --------------------------------------------------------------------------
@app.get("/api/agent-arena/{run_id}")
async def agent_arena_status(
    run_id: str
):
    run = ARENA_RUNS.get(
        run_id
    )

    if not run:
        raise HTTPException(
            status_code=404,
            detail="Run arena non trovato.",
        )

    return {
        "status": run["status"],
        "turns": run["turns"],
        "error": run["error"],
        "opening": run.get(
            "opening",
            ""
        ),
        "hand_raised": bool(
            run.get("hand", False)
        ),
    }


# --------------------------------------------------------------------------
# ARENA STOP  (Google auth obbligatoria)
# --------------------------------------------------------------------------
@app.post("/api/agent-arena/{run_id}/stop")
async def agent_arena_stop(
    run_id: str,
    authorization: str | None = Header(None),
):
    verify_admin_token(authorization)

    run = ARENA_RUNS.get(
        run_id
    )

    if not run:
        raise HTTPException(
            status_code=404,
            detail="Run arena non trovato.",
        )

    run["stop"] = True

    # Stop immediato: cancella il task anche se un LLM sta rispondendo.
    # Il CancelledError è gestito in _run_agent_arena.
    task = run.get("task")

    if task is not None and not task.done():
        task.cancel()

    return {
        "status": "STOPPING"
    }


# --------------------------------------------------------------------------
# ARENA — RAISE HAND  (Google auth obbligatoria, solo il proprietario)
# --------------------------------------------------------------------------
def _arena_get_owned_run(
    run_id: str,
    email: str,
) -> dict:
    """
    Ritorna il run solo se esiste ed è di questa email.

    Se non è dell'utente risponde 404 (e non 403) apposta: il frontend
    fa logout su 401/403, e un run altrui non deve cacciare l'utente.
    """
    run = ARENA_RUNS.get(
        run_id
    )

    if not run or run.get("owner") != email:
        raise HTTPException(
            status_code=404,
            detail="Run arena non trovato.",
        )

    return run


@app.post("/api/agent-arena/{run_id}/hand")
async def agent_arena_hand(
    run_id: str,
    authorization: str | None = Header(None),
):
    """
    Alza la mano: il turno in corso finisce, poi il run va in PAUSED
    e aspetta /intervene.
    """
    email = verify_admin_token(authorization)

    run = _arena_get_owned_run(
        run_id,
        email,
    )

    if run["status"] == "PAUSED":
        return {
            "status": "PAUSED"
        }

    if run["status"] != "RUNNING":
        raise HTTPException(
            status_code=409,
            detail="Il run non è in esecuzione.",
        )

    run["hand"] = True

    return {
        "status": "HAND_RAISED"
    }


# --------------------------------------------------------------------------
# ARENA — INTERVENE  (Google auth obbligatoria, solo il proprietario)
# --------------------------------------------------------------------------
@app.post("/api/agent-arena/{run_id}/intervene")
async def agent_arena_intervene(
    run_id: str,
    req: ArenaInterveneRequest,
    authorization: str | None = Header(None),
):
    """
    Con il run in PAUSED: invia il testo umano (anche vuoto = riprendi
    senza scrivere) e sblocca il run. Il prossimo bot legge il testo
    insieme all'ultima risposta.
    """
    email = verify_admin_token(authorization)

    run = _arena_get_owned_run(
        run_id,
        email,
    )

    if run["status"] != "PAUSED":
        raise HTTPException(
            status_code=409,
            detail="Alza prima la mano: il run non è in pausa.",
        )

    text = (req.text or "").strip()

    if len(text) > MAX_HUMAN_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Messaggio troppo lungo "
                f"(massimo {MAX_HUMAN_CHARS} caratteri)."
            ),
        )

    if text:

        if run["human_count"] >= MAX_HUMAN_INTERVENTIONS:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Troppi interventi umani in questo run "
                    f"(massimo {MAX_HUMAN_INTERVENTIONS})."
                ),
            )

        run["human_count"] += 1

    run["human_text"] = text
    run["resume"].set()

    return {
        "status": "RESUMING"
    }


# ============================================================
# IMPROVE — miglioramento file via pagina web (root multiple)
# ============================================================
# Come improver_agent.py: MAI sovrascrivere l'originale. Si salva
# sempre <file>.improved<ext> affiancato.
#
# Le root sono una WHITELIST: il client manda solo il nome della root
# ("leles", "airflow", ...), mai un path assoluto.

LELES_REPO_PATH = os.environ.get(
    "LELES_REPO_PATH",
    "/Users/danny/Desktop/Danny/leles",
)

# Ogni root: path, estensioni ammesse, prefissi consentiti (None = tutto).
IMPROVE_ROOTS = {
    "leles": {
        "path": LELES_REPO_PATH,
        "exts": {".py"},
        "only": None,
    },
    "airflow": {
        "path": os.environ.get(
            "AIRFLOW_DAGS_PATH",
            os.path.expanduser("~/Desktop/Danny/airflow/dags"),
        ),
        "exts": {".py"},
        "only": None,
    },
    "dv_site": {
        "path": os.environ.get(
            "DV_SITE_PATH",
            "/Users/danny/Desktop/Danny/dv-site",
        ),
        "exts": {".jsx", ".js", ".css", ".py"},
        # Solo sorgenti: niente dist, public, ecc.
        "only": ("src/", "gateway.py"),
    },
    "incoming": {
        "path": os.environ.get(
            "INCOMING_PATH",
            os.path.expanduser("~/Desktop/Danny/airflow/incoming_files"),
        ),
        "exts": {".py", ".jsx", ".js", ".css", ".sql", ".yaml", ".yml", ".md", ".txt"},
        "only": None,
    },
}

_IMPROVE_SKIP_DIRS = {
    ".venv", "venv", ".git", "__pycache__", ".pytest_cache",
    ".ruff_cache", "node_modules", "dist", "build",
}

_IMPROVE_MAX_CHARS = 40_000
_IMPROVE_MAX_SAVE_CHARS = 120_000


def _improve_root(root_name: str) -> tuple[str, dict]:
    cfg = IMPROVE_ROOTS.get(root_name)
    if not cfg or not cfg["path"] or not os.path.isdir(cfg["path"]):
        raise HTTPException(
            status_code=400,
            detail=f"Root non disponibile: {root_name}",
        )
    return os.path.realpath(cfg["path"]), cfg


def _improve_allowed(rel: str, cfg: dict) -> bool:
    rel = rel.replace(os.sep, "/")
    if ".improved." in os.path.basename(rel):
        return False
    if os.path.splitext(rel)[1].lower() not in cfg["exts"]:
        return False
    only = cfg["only"]
    if only and not any(rel == o or rel.startswith(o) for o in only):
        return False
    return True


def _improve_resolve(root_name: str, rel_path: str) -> str:
    """Path assoluto di un file ammesso dentro la root, senza escape."""
    root, cfg = _improve_root(root_name)
    target = os.path.realpath(os.path.join(root, rel_path))
    if not target.startswith(root + os.sep):
        raise HTTPException(
            status_code=400,
            detail="Percorso fuori dalla root.",
        )
    rel = os.path.relpath(target, root)
    if not _improve_allowed(rel, cfg):
        raise HTTPException(
            status_code=400,
            detail="File non ammesso per questa root.",
        )
    if not os.path.isfile(target):
        raise HTTPException(
            status_code=404,
            detail=f"File non trovato: {rel_path}",
        )
    return target


@app.get("/api/improve/files")
async def improve_list_files(authorization: str | None = Header(None)):
    """Elenco file di tutte le root disponibili."""
    verify_admin_token(authorization)

    files = []
    roots = []
    for name, cfg in IMPROVE_ROOTS.items():
        if not cfg["path"] or not os.path.isdir(cfg["path"]):
            continue
        roots.append(name)
        root = os.path.realpath(cfg["path"])
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _IMPROVE_SKIP_DIRS]
            for fname in filenames:
                full = os.path.join(dirpath, fname)
                rel = os.path.relpath(full, root)
                if not _improve_allowed(rel, cfg):
                    continue
                try:
                    size = os.path.getsize(full)
                except OSError:
                    continue
                files.append({"root": name, "path": rel, "size": size})

    files.sort(key=lambda f: (f["root"], f["path"]))
    return {"files": files[:4000], "roots": roots, "total": len(files)}


@app.get("/api/improve/file")
async def improve_read_file(
    path: str,
    root: str = "leles",
    authorization: str | None = Header(None),
):
    """Contenuto di un file ammesso (per il topic Arena)."""
    verify_admin_token(authorization)

    target = _improve_resolve(root, path)
    with open(target, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    if len(content) > _IMPROVE_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File troppo grande ({len(content)} caratteri, "
                f"limite {_IMPROVE_MAX_CHARS}). Spezzalo in moduli più piccoli."
            ),
        )

    return {"root": root, "path": path, "content": content, "size": len(content)}


@app.post("/api/improve/save")
async def improve_save_file(
    req: dict,
    authorization: str | None = Header(None),
):
    """Salva la versione migliorata come <file>.improved<ext> (mai l'originale)."""
    verify_admin_token(authorization)

    root_name = (req.get("root") or "leles").strip()
    rel_path = (req.get("path") or "").strip()
    code = req.get("code") or ""

    if not code.strip():
        raise HTTPException(status_code=400, detail="Nessun codice da salvare.")

    if len(code) > _IMPROVE_MAX_SAVE_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Codice troppo lungo ({len(code)} caratteri, "
                f"limite {_IMPROVE_MAX_SAVE_CHARS})."
            ),
        )

    target = _improve_resolve(root_name, rel_path)
    ext = os.path.splitext(target)[1].lower()

    # Solo per .py: non scrivere codice che non compila.
    if ext == ".py":
        try:
            compile(code, rel_path or "<improved>", "exec")
        except (SyntaxError, ValueError) as e:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Il codice proposto non e Python valido "
                    f"(riga {getattr(e, 'lineno', '?')}: "
                    f"{getattr(e, 'msg', str(e))}). Non salvato."
                ),
            )

    base, _ = os.path.splitext(target)
    saved_path = f"{base}.improved{ext}"
    with open(saved_path, "w", encoding="utf-8") as f:
        f.write(code.rstrip() + "\n")

    return {
        "saved_path": saved_path,
        "bytes": os.path.getsize(saved_path),
    }
# --------------------------------------------------------------------------
# AVVIO DIRETTO
# --------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=9090,
    )
