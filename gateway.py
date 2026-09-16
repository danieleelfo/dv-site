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

# MAPPA DEGLI AGENTI E PORTE
AGENT_PORTS = {
    "Lele Admin": 8082,     # leles (admin/timoniere)
    "Lele I": 8080,         # lele (pirata)
    "Bar_AI demo": 8081,    # bar_ai
    "Story Whisper": 8088,  # porta 8088
    "Night Story": 8666,    # porta 8666
}

class ChatRequest(BaseModel):
    agent: str
    prompt: str

@app.post("/api/chat")
async def chat_router(req: ChatRequest):
    port = AGENT_PORTS.get(req.agent)
    if not port:
        raise HTTPException(
            status_code=400, detail=f"Agente '{req.agent}' non configurato."
        )

    # Indirizzo del bot locale specifico
    target_url = f"http://127.0.0.1:{port}/chat"

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(target_url, json={"prompt": req.prompt})
            return response.json()
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Impossibile raggiungere {req.agent} sulla porta {port}: {str(e)}",
            )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9090)
