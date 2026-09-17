import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
    "Lele Admin": {
        "port": 8082,
        "path": "/ask",
        "payload": "message",
    },
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
    chat_id: int = 1010101010  # Default al tuo admin ID


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

    # Costruisce il payload in base all'agente
    if req.agent == "Lele Admin":
        payload = {
            "message": req.prompt,
            "chat_id": req.chat_id,
        }
    else:
        payload = {
            payload_field: req.prompt,
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
                detail=(
                    f"Impossibile raggiungere {req.agent} "
                    f"sulla porta {port}: {str(e)}"
                ),
            )

        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Errore nella risposta di {req.agent}: {str(e)}",
            )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=9090,
    )
