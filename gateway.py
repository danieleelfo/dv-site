import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Lele AI Gateway")

# Permette al frontend React di fare richieste senza blocchi CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MAPPA DEGLI AGENTI
AGENTS = {
    "Lele Admin": {
        "port": 8082,
        "path": "/ask",
    },
    "Lele I": {
        "port": 8080,
        "path": "/chat",
    },
    "Bar_AI demo": {
        "port": 8081,
        "path": "/chat",
    },
    "Story Whisper": {
        "port": 8088,
        "path": "/chat",
    },
    "Night Story": {
        "port": 8666,
        "path": "/chat",
    },
}


class ChatRequest(BaseModel):
    agent: str
    prompt: str


@app.get("/")
async def root():
    return {
        "status": "Gateway Online",
        "agents": list(AGENTS.keys()),
    }


@app.post("/api/chat")
@app.post("/api/chat/")
async def chat_router(req: ChatRequest):

    agent = AGENTS.get(req.agent)

    if not agent:
        raise HTTPException(
            status_code=400,
            detail=f"Agente '{req.agent}' non configurato."
        )

    port = agent["port"]
    path = agent["path"]

    target_url = f"http://127.0.0.1:{port}{path}"

    # Payload specifico per Lele Admin
    if req.agent == "Lele Admin":
        payload = {
            "message": req.prompt,
            "chat_id": "web-console",
        }
    else:
        payload = {
            "prompt": req.prompt,
        }

    async with httpx.AsyncClient(timeout=60.0) as client:

        try:
            response = await client.post(
                target_url,
                json=payload,
            )

            # Se l'agente restituisce un errore HTTP,
            # lo riportiamo chiaramente al frontend
            response.raise_for_status()

            return response.json()

        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"{req.agent} ha risposto con HTTP "
                    f"{e.response.status_code}: {e.response.text}"
                ),
            )

        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Impossibile raggiungere {req.agent} "
                    f"sulla porta {port}: {str(e)}"
                ),
            )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=9090,
    )
