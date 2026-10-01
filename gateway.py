import os
import asyncio
import uuid

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
# GOOGLE AUTH (solo per /api/admin/*)
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
    # Se è una richiesta preflight CORS OPTIONS, rispondi subito OK 200
    from fastapi import Request

    # Nota: se FastAPI riceve OPTIONS con payload vuoto, req sarà None

    target_url = "http://127.0.0.1:8081/ask"

    if req is None:
        return {"status": "ok"}

    payload = {
        "question": req.question,
        "plan": req.plan,
        "restaurant_id": req.restaurant_id,
        "user_id": req.user_id,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
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
                    f"sulla porta {port}: {str(e)}"
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
                    f"sulla porta {port}: {str(e)}"
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
#
# La pagina ProjectTest.jsx parla SOLO con questi endpoint.
#
# Flow:
#
#   Browser
#      │
#      ▼
#   POST /api/agent-arena/start
#      │
#      ▼
#   Gateway
#      │
#      ├── Night Story :8666 /ask
#      │
#      └── Leles/QE    :8082 /ask
#             │
#             └── Emergence role + model
#
# Il loop gira nel backend, non nel browser.
# ==========================================================================


ARENA_AGENT_PORTS = {
    "night_story": 8666,
    "story_whisper": 8088,
    "leles": 8082,
    "qe": 8082,
}


# Run attivi in memoria.
#
# È intenzionalmente semplice per Lab Test 2:
# non salviamo lo stato nel DB e non introduciamo Redis.
ARENA_RUNS: dict[str, dict] = {}


class AgentArenaRequest(BaseModel):
    # ------------------------------------------------------
    # AGENTE A
    # ------------------------------------------------------
    agent_a: str
    character_a: str = ""
    model_a: str = ""

    # ------------------------------------------------------
    # AGENTE B
    # ------------------------------------------------------
    agent_b: str
    character_b: str = ""
    role_b: str = ""
    model_b: str = ""

    # ------------------------------------------------------
    # WORLD / TOPIC
    # ------------------------------------------------------
    world_source: str = "free"
    world_ref: str = ""
    topic: str = ""

    # ------------------------------------------------------
    # LOOP
    # ------------------------------------------------------
    max_turns: int = 10


def _arena_chat_id(
    run_id: str,
    side: str
) -> int:
    """
    Crea un chat_id deterministico diverso per A e B.

    Non usiamo il chat_id reale dell'utente:
    l'Arena è una conversazione artificiale isolata.
    """
    value = uuid.UUID(run_id).int

    return 100000000 + (
        (value + (1 if side == "a" else 2))
        % 900000000
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

    Per Night Story:
        character + model

    Per QE/Leles:
        role + model

    Il model è passato solo agli agenti che abbiamo modificato
    per accettarlo: Night Story e Leles/QE.
    """

    port = ARENA_AGENT_PORTS.get(
        agent_id
    )

    if port is None:
        raise RuntimeError(
            f"Agente arena non configurato: {agent_id}"
        )

    payload = {
        "message": message,
        "chat_id": chat_id,
    }

    # ------------------------------------------------------
    # NIGHT STORY
    # ------------------------------------------------------
    if agent_id == "night_story":

        if character:
            payload["character"] = character

        if model:
            payload["model"] = model

    # ------------------------------------------------------
    # QE / LELES
    # ------------------------------------------------------
    elif agent_id in (
        "qe",
        "leles",
    ):

        if role:
            payload["role"] = role

        if model:
            payload["model"] = model

    # ------------------------------------------------------
    # ALTRI AGENTI
    # ------------------------------------------------------
    #
    # Story Whisper / Lele I vengono lasciati compatibili
    # con le loro API attuali.
    #
    # Non passiamo model/role perché le loro Question
    # attuali potrebbero non accettare questi campi.
    # ------------------------------------------------------

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
    world_ref: str
) -> str:
    """
    Recupera un Emergence World già salvato.

    Usiamo l'API pubblica già esistente di Leles:
        query world <id>

    In questo modo non duplichiamo la logica PostgreSQL
    di emergence_worlds.py dentro il gateway.
    """

    world_ref = str(
        world_ref or ""
    ).strip()

    if not world_ref.isdigit():
        raise RuntimeError(
            "world_ref deve essere l'ID numerico "
            "di un Emergence World."
        )

    # Leles protegge query world come comando admin.
    # Usiamo l'admin chat id configurato server-side,
    # oppure il primo admin disponibile.
    admin_chat_id = next(
        iter(ADMIN_USER_CHAT_IDS.values()),
        8733881519
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


async def _run_agent_arena(
    run_id: str,
    cfg: AgentArenaRequest
):
    """
    Esegue il loop:

        topic/world
             ↓
          Agent A
             ↓
          Agent B
             ↓
          Agent A
             ↓
          Agent B
             ...

    max_turns indica quanti cicli A+B eseguire.
    """

    run = ARENA_RUNS[run_id]

    try:

        # --------------------------------------------------
        # VALIDAZIONE
        # --------------------------------------------------

        if not 1 <= cfg.max_turns <= 50:
            raise RuntimeError(
                "max_turns deve essere compreso "
                "tra 1 e 50."
            )

        allowed = set(
            ARENA_AGENT_PORTS
        )

        if cfg.agent_a not in allowed:
            raise RuntimeError(
                f"Agente A non valido: {cfg.agent_a}"
            )

        if cfg.agent_b not in allowed:
            raise RuntimeError(
                f"Agente B non valido: {cfg.agent_b}"
            )

        if cfg.world_source not in (
            "free",
            "emergence",
        ):
            raise RuntimeError(
                "world_source deve essere "
                "'free' oppure 'emergence'."
            )

        # --------------------------------------------------
        # OPENING
        # --------------------------------------------------

        if cfg.world_source == "emergence":

            opening = await _arena_load_world(
                cfg.world_ref
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

        run["opening"] = opening

        last_msg = opening

        # --------------------------------------------------
        # ARENA LOOP
        # --------------------------------------------------

        for turn in range(
            cfg.max_turns
        ):

            # ==============================================
            # AGENT A
            # ==============================================

            if run["stop"]:

                run["status"] = "STOPPED"
                return

            answer_a = await _arena_call(
                agent_id=cfg.agent_a,
                message=last_msg,
                chat_id=_arena_chat_id(
                    run_id,
                    "a"
                ),
                character=cfg.character_a,
                model=cfg.model_a,
            )

            run["turns"].append(
                {
                    "id": len(
                        run["turns"]
                    ) + 1,

                    "turn": turn + 1,

                    "side": "a",

                    "agent": cfg.agent_a,

                    "character": (
                        cfg.character_a
                        if cfg.agent_a == "night_story"
                        else ""
                    ),

                    "role": "",

                    "model": cfg.model_a,

                    "text": answer_a,
                }
            )

            last_msg = answer_a

            # ==============================================
            # AGENT B
            # ==============================================

            if run["stop"]:

                run["status"] = "STOPPED"
                return

            answer_b = await _arena_call(
                agent_id=cfg.agent_b,
                message=last_msg,
                chat_id=_arena_chat_id(
                    run_id,
                    "b"
                ),
                character=cfg.character_b,
                role=cfg.role_b,
                model=cfg.model_b,
            )

            run["turns"].append(
                {
                    "id": len(
                        run["turns"]
                    ) + 1,

                    "turn": turn + 1,

                    "side": "b",

                    "agent": cfg.agent_b,

                    "character": (
                        cfg.character_b
                        if cfg.agent_b == "night_story"
                        else ""
                    ),

                    "role": (
                        cfg.role_b
                        if cfg.agent_b == "qe"
                        else ""
                    ),

                    "model": cfg.model_b,

                    "text": answer_b,
                }
            )

            last_msg = answer_b

        # --------------------------------------------------
        # COMPLETED
        # --------------------------------------------------

        run["status"] = "COMPLETED"

    except asyncio.CancelledError:

        run["status"] = "STOPPED"

        raise

    except Exception as e:

        run["status"] = "ERROR"

        run["error"] = str(e)


# --------------------------------------------------------------------------
# START ARENA
# --------------------------------------------------------------------------
@app.post("/api/agent-arena/start")
async def agent_arena_start(
    req: AgentArenaRequest
):
    allowed = set(
        ARENA_AGENT_PORTS
    )

    if req.agent_a not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Agente A non valido: "
                f"{req.agent_a}"
            ),
        )

    if req.agent_b not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Agente B non valido: "
                f"{req.agent_b}"
            ),
        )

    if not 1 <= req.max_turns <= 50:
        raise HTTPException(
            status_code=400,
            detail=(
                "max_turns deve essere "
                "compreso tra 1 e 50."
            ),
        )

    run_id = str(
        uuid.uuid4()
    )

    ARENA_RUNS[run_id] = {
        "status": "STARTING",
        "turns": [],
        "stop": False,
        "error": None,
        "opening": "",
        "task": None,
    }

    ARENA_RUNS[run_id]["task"] = (
        asyncio.create_task(
            _run_agent_arena(
                run_id,
                req
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
    }


# --------------------------------------------------------------------------
# ARENA STOP
# --------------------------------------------------------------------------
@app.post("/api/agent-arena/{run_id}/stop")
async def agent_arena_stop(
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

    run["stop"] = True

    return {
        "status": "STOPPING"
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
