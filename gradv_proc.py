"""
Controllo del processo GraDV: start / stop / restart / status.

GraDV gira sullo stesso Mac del gateway, due processi:
  - UI Gradio    -> porta dell'IMAGE_MODEL_URL (default 7860)
  - model server -> porta GRADV_MODEL_PORT (default 7999), e' lui che
                   tiene il modello in RAM e consuma risorse.

Lo stop uccide ENTRAMBI (SIGTERM, poi SIGKILL). Il successo e' misurato
sulle PORTE (lsof), non sui PID: un processo ucciso dal gateway resta
per un attimo "zombie" (defunto, non in ascolto) e non va scambiato
per un fallimento. Lo start replica il "python main.py" del terminale:
cerca il python dell'env "gradv" nei posti tipici (venv nella cartella
GraDV, ~/.venvs, ~/.virtualenvs, path conda) e lo lancia direttamente;
se non lo trova, fallback su shell zsh interattiva di login (che legge
.zshrc, dove l'env viene attivato). Detached dal gateway, log su
gradv_gateway.log. Config opzionale in gateway.env:

  GRADV_DIR        (default ~/Desktop/Danny/GraDV)
  GRADV_PYTHON     (forza il python da usare, es. .../envs/gradv/bin/python)
  GRADV_START_ARGS (default "main.py")
  GRADV_MODEL_PORT (default 7999)
  IMAGE_MODEL_URL  (gia' usato dal gateway per la porta UI)
"""
import os
import signal
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Header, HTTPException

# Quanto aspettare (secondi) che i processi chiudano dopo il SIGTERM
# prima di forzare con SIGKILL, e che la UI apra la porta dopo lo start.
STOP_TIMEOUT = 10.0
START_TIMEOUT = 90.0

ENV_NAME = "gradv"


def build_gradv_proc_router(verify_admin_token):
    router = APIRouter(prefix="/api/gradv/proc", tags=["gradv-proc"])

    def ui_port() -> int:
        try:
            return urlparse(
                os.environ.get("IMAGE_MODEL_URL", "http://127.0.0.1:7860")
            ).port or 80
        except Exception:
            return 7860

    def model_port() -> int:
        try:
            return int(os.environ.get("GRADV_MODEL_PORT", "7999"))
        except ValueError:
            return 7999

    def gradv_dir() -> Path:
        return Path(
            os.environ.get(
                "GRADV_DIR",
                str(Path.home() / "Desktop" / "Danny" / "GraDV"),
            )
        ).expanduser()

    def _candidates():
        """Percorsi plausibili del python dell'env 'gradv', in ordine."""
        d = gradv_dir()
        home = Path.home()
        out = [
            # venv dentro la cartella del progetto (caso piu' comune)
            d / "venv" / "bin" / "python",
            d / ".venv" / "bin" / "python",
            d / "env" / "bin" / "python",
            d / ENV_NAME / "bin" / "python",
        ]
        # venv/macchine virtuali in casa
        for base in (
            home / ".venvs" / ENV_NAME,
            home / "venvs" / ENV_NAME,
            home / ".virtualenvs" / ENV_NAME,
            home / "Virtualenvs" / ENV_NAME,
        ):
            out.append(base / "bin" / "python")
        # installazioni conda (nel caso esistano davvero)
        for root_base in (home, Path("/opt"), Path("/usr/local")):
            for root in ("anaconda3", "miniconda3", "miniforge3", "mambaforge"):
                out.append(root_base / root / "envs" / ENV_NAME / "bin" / "python")
        return out

    def _resolve_python():
        """Percorso del python dell'env 'gradv' (o None)."""
        explicit = os.environ.get("GRADV_PYTHON", "").strip()
        if explicit:
            p = Path(explicit).expanduser()
            return p if p.is_file() else None
        for cand in _candidates():
            if cand.is_file():
                return cand
        # Ultima spiaggia: chiede a conda (se esiste nel PATH).
        try:
            out = subprocess.run(
                ["conda", "env", "list"], capture_output=True, text=True,
                timeout=10,
            ).stdout
            for line in out.splitlines():
                if line.strip().endswith("/envs/" + ENV_NAME):
                    cand = Path(line.split()[0]) / "bin" / "python"
                    if cand.is_file():
                        return cand
        except Exception:
            pass
        return None

    def _log_tail(path, lines=30):
        try:
            data = path.read_bytes()[-20000:]
            text = data.decode("utf-8", errors="replace")
            return "\n".join(text.splitlines()[-lines:])
        except Exception:
            return ""

    # ------------------------------------------------------------------
    # lsof: pids e RAM dei processi che ascoltano su una porta locale
    # ------------------------------------------------------------------

    def _run(args, timeout=5):
        return subprocess.run(
            args, capture_output=True, text=True, timeout=timeout
        )

    def _pids_on_port(port):
        """PIDs che ascoltano su 'port' (set, vuoto se nessuno)."""
        try:
            out = _run(
                ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"]
            ).stdout
        except Exception:
            return set()
        return {int(p) for p in out.split() if p.isdigit()}

    def _rss_mb(pid):
        try:
            out = _run(["ps", "-o", "rss=", "-p", str(pid)]).stdout.strip()
            return round(int(out) / 1024, 1)
        except Exception:
            return 0.0

    def _port_info(port):
        """{running, pid, command, ram_mb} dei listener sulla porta."""
        pids = sorted(_pids_on_port(port))
        if not pids:
            return {"running": False, "pid": None, "command": None, "ram_mb": None}
        command = None
        try:
            command = _run(
                ["ps", "-o", "command=", "-p", str(pids[0])]
            ).stdout.strip()[:160] or None
        except Exception:
            pass
        return {
            "running": True,
            "pid": pids[0],
            "command": command,
            "ram_mb": round(sum(_rss_mb(p) for p in pids), 1),
        }

    # ------------------------------------------------------------------
    # Azioni
    # ------------------------------------------------------------------

    def _do_stop():
        """SIGTERM (poi SIGKILL) a UI e model server. Idempotente.

        Il successo e' "le porte sono libere": un PID ucciso dal gateway
        resta qualche istante come zombie (defunto, NON in ascolto) e
        va ignorato, altrimenti falsi errori "ancora attivi".
        """
        pids = set()
        for port in (ui_port(), model_port()):
            pids |= _pids_on_port(port)
        # Include i figli diretti (es. il model server avviato dalla UI).
        for pid in list(pids):
            try:
                out = _run(["pgrep", "-P", str(pid)]).stdout
                pids |= {int(p) for p in out.split() if p.isdigit()}
            except Exception:
                pass
        if not pids:
            return {"stopped": False, "detail": "GraDV non era in esecuzione."}

        def _listening():
            out = set()
            for port in (ui_port(), model_port()):
                out |= _pids_on_port(port)
            return out

        for pid in pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass

        deadline = time.time() + STOP_TIMEOUT
        while time.time() < deadline:
            if not _listening():
                break
            time.sleep(0.5)

        remaining = _listening()
        if remaining:
            for pid in remaining:
                try:
                    os.kill(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
            # Grace: il kernel puo' metterci un attimo a liberare le porte.
            grace = time.time() + 3.0
            while time.time() < grace:
                if not _listening():
                    break
                time.sleep(0.3)

        still = _listening()
        if still:
            raise HTTPException(
                status_code=500,
                detail=f"Porte GraDV ancora occupate dopo SIGKILL: {sorted(still)}",
            )
        return {"stopped": True, "killed": sorted(pids)}

    def _launch(cmd_args, env, mode, d, log_path):
        log_file = open(log_path, "ab", buffering=0)
        try:
            subprocess.Popen(
                cmd_args,
                cwd=str(d),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=log_file,
                start_new_session=True,
            )
        except Exception as exc:
            log_file.close()
            raise HTTPException(
                status_code=500, detail=f"Avvio GraDV fallito ({mode}): {exc}"
            )

    def _do_start():
        if _port_info(ui_port()).get("running"):
            raise HTTPException(
                status_code=409, detail="GraDV e' gia' in esecuzione."
            )
        d = gradv_dir()
        if not d.is_dir():
            raise HTTPException(
                status_code=500, detail=f"Cartella GraDV non trovata: {d}"
            )

        args = os.environ.get("GRADV_START_ARGS", "main.py").split()
        log_path = d / "gradv_gateway.log"
        python = _resolve_python()

        if python:
            # Piano A: python dell'env trovato, lo lancia direttamente.
            env = dict(os.environ)
            env_bin = python.parent
            env["PATH"] = str(env_bin) + os.pathsep + env.get("PATH", "")
            env["VIRTUAL_ENV"] = str(env_bin.parent)
            env["CONDA_DEFAULT_ENV"] = ENV_NAME
            _launch([str(python), *args], env, "python " + str(python), d, log_path)
            mode = "direct: " + str(python)
        else:
            # Piano B: shell zsh interattiva di login, uguale al terminale
            # (legge .zshrc, dove l'env 'gradv' viene attivato).
            _launch(
                ["/bin/zsh", "-l", "-i", "-c", "exec python " + " ".join(args)],
                None, "zsh -l -i", d, log_path,
            )
            mode = "shell interattiva (.zshrc)"

        # Attende che la UI apra la porta (il modello puo' metterci di piu').
        deadline = time.time() + START_TIMEOUT
        while time.time() < deadline:
            if _port_info(ui_port()).get("running"):
                return {
                    "started": True,
                    "log": str(log_path),
                    "mode": mode,
                    "detail": "GraDV avviato.",
                }
            time.sleep(2)
        return {
            "started": False,
            "log": str(log_path),
            "mode": mode,
            "detail": (
                f"GraDV non ha aperto la porta {ui_port()} entro "
                f"{int(START_TIMEOUT)}s. Ultime righe del log:\n"
                + (_log_tail(log_path) or "(log vuoto)")
            ),
        }

    # ------------------------------------------------------------------
    # Endpoint (sync: FastAPI li esegue nel threadpool, non bloccano
    # l'event loop mentre si aspetta lo stop/start del processo).
    # ------------------------------------------------------------------

    @router.get("")
    def gradv_status(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        return {
            "ui": _port_info(ui_port()),
            "model_server": _port_info(model_port()),
            "dir": str(gradv_dir()),
            "python": str(_resolve_python() or ""),
        }

    @router.post("/start")
    def gradv_start(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        return _do_start()

    @router.post("/stop")
    def gradv_stop(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        return _do_stop()

    @router.post("/restart")
    def gradv_restart(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        stop_result = _do_stop()
        start_result = _do_start()
        return {"stop": stop_result, "start": start_result}

    return router
