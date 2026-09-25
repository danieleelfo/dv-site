import os

import httpx
from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel

app = FastAPI(title="Lele AI Gateway")

# --------------------------------------------------------------------------
# GOOGLE AUTH (solo per /api/admin/*) — richiesto da env, niente default
# in chiaro nel codice.
# --------------------------------------------------------------------------
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
# Lista di email autorizzate, separate da virgole:
#   ADMIN_ALLOWED_EMAIL="a@example.com,b@example.com"
ADMIN_ALLOWED_EMAILS = [
    e.strip().lower()
    for e in os.environ.get("ADMIN_ALLOWED_EMAIL", "").split(",")
    if e.strip()
]
_google_request = google_requests.Request()

# Mappa email -> chat_id Telegram personale, per far parlare Leles col
# contesto giusto quando entra dal sito invece che da Telegram:
#   ADMIN_USER_CHAT_IDS="dannybydanny@hotmail.com:8733881519"
# Se l'email verificata e' nella mappa, il suo chat_id SOSTITUISCE quello
# random generato dal browser. Se non c'e', resta quello del browser.
ADMIN_USER_CHAT_IDS = {}
for pair in os.environ.get("ADMIN_USER_CHAT_IDS", "").split(","):
    if ":" in pair:
        _mail, _cid = pair.split(":", 1)
        _mail, _cid = _mail.strip().lower(), _cid.strip()
        if _mail and _cid.isdigit():
            ADMIN_USER_CHAT_IDS[_mail] = int(_cid)


def verify_admin_token(authorization: str | None) -> str:
    """Verifica l'ID token Google passato come 'Authorization: Bearer <token>'.
    Ritorna l'email verificata, oppure solleva HTTPException 401/403."""
    if not GOOGLE_CLIENT_ID or not ADMIN_ALLOWED_EMAILS:
        raise HTTPException(
            status_code=500,
            detail="Admin auth non configurata sul server (GOOGLE_CLIENT_ID / ADMIN_ALLOWED_EMAIL mancanti).",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token mancante.")

    token = authorization.split(" ", 1)[1]
    try:
        idinfo = id_token.verify_oauth2_token(
            token, _google_request, GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Token non valido o scaduto.")

    if not idinfo.get("email_verified"):
        raise HTTPException(status_code=401, detail="Email Google non verificata.")

    email = (idinfo.get("email") or "").strip().lower()
    if email not in ADMIN_ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato.")

    return email


# Config dell'agente Admin: NON entra nel dict AGENTS pubblico apposta,
# così resta irraggiungibile da /api/chat qualunque cosa passi il client.
ADMIN_AGENT = {
    "port": 8082,
    "path": "/ask",
    "payload": "message",
}


async def forward_to_agent(config: dict, prompt: str, chat_id: int, language: str, agent_label: str, user_email: str | None = None):
    """Logica di forward condivisa tra /api/chat e /api/admin/chat."""
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
        # L'agente può usarlo per registrare CHI ha parlato (log su Postgres)
        payload["user_email"] = user_email

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            response = await client.post(target_url, json=payload)
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
                detail=f"Impossibile raggiungere {agent_label} sulla porta {port}: {str(e)}",
            )


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# CONFIGURAZIONE AGENTI (Lele Admin rimosso: non deve essere rag
giungibile
# dal gateway pubblico, resta accessibile solo via Telegram / /api/admin/chat)
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
    },
}

class ChatRequest(BaseModel):
    agent: str
    prompt: str
    chat_id: int = 1010101010
    language: str = "en"

@app.get("/")
async def root():
    return {
        "status": "Gateway Online",
        "agents": list(AGENTS.keys()),
    }

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
                detail=f"Impossibile raggiungere {req.agent} sulla porta {port}: {str(e)}"
            )

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
                detail=f"Impossibile raggiungere {agent} sulla porta {port}: {str(e)}"
            )

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
                    detail=f"Audio non trovato per '{agent}' ({filename}).",
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
                detail=f"Impossibile raggiungere {agent} sulla porta {port}: {str(e)}"
            )


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
    email = verify_admin_token(authorization)
    chat_id = ADMIN_USER_CHAT_IDS.get(email, req.chat_id)
    return await forward_to_agent(
        ADMIN_AGENT, req.prompt, chat_id, req.language, "Lele Admin", user_email=email
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=9090,
    )
