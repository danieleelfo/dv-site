import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="Lele AI Gateway")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# CONFIGURAZIONE AGENTI
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
    language: str = "en"  # <-- MODIFICA 1: Aggiunto language

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

    # Payload per Lele Admin
    if req.agent == "Lele Admin":
        payload = {
            "message": req.prompt,
            "language": req.language,  # <-- MODIFICA 2
            "chat_id": req.chat_id,
        }
    # Payload per gli altri agenti
    else:
        payload = {
            payload_field: req.prompt,
            "language": req.language,  # <-- MODIFICA 3
        }

    async with httpx.AsyncClient(timeout=180.0) as client:
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
    language: str = Form("en"),  # <-- MODIFICA 4
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

    async with httpx.AsyncClient(timeout=180.0) as client:
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
                "language": language,  # <-- MODIFICA 5
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=9090,
    )
