"""
query_db.py — Backend "QueryDB" per QueryDb.jsx (read-only). v4

Endpoint (tutti con Google auth, stesso verify_admin_token del gateway):
    GET  /api/db/status?area=leles|emergence|lele_ns|lele_sw|dbt
    GET  /api/db/table?area=&table=&page=&user=&users=&date_from=&date_to=&agent=&model=
    GET  /api/db/users?area=&table=&facet=   (valori distinti colonna user + count)
    GET  /api/db/summary?area=&date=          (righe memory_summary del giorno)
    POST /api/db/summary/generate {area,date}  (riassunto del giorno via Ollama)
    POST /api/db/summary/save {area,date,...}  (salva il riassunto: NUOVA riga)

Novità v2:
  - aree = SCHEMI Postgres: "leles" -> schema public, "emergence" -> schema
    emergence (tabelle emergence.*: runs, iterations, messages, metrics, ...);
  - anteprima ORDINATA: colonna temporale DESC (es. created_at), altrimenti
    id DESC -> i record piu' recenti arrivano prima;
  - filtri opzionali: user (ILIKE su colonna user-ish) e intervallo
    date_from/date_to (sulla colonna temporale). La risposta include
    "filterable" cosi' la UI mostra solo i filtri applicabili.

Principi di sicurezza:
  - READ-ONLY: connessione Postgres aperta con readonly=True.
  - NESSUNA query libera dal client: schema e tabella validati contro
    information_schema e quotati con psycopg2.sql.Identifier.
  - LIMIT/OFFSET decisi dal server (50 righe per pagina).

Riusa la get_connection() del gateway (env PGHOST/PGPORT/PGDATABASE/
PGUSER/PGPASSWORD in gateway.env).
"""

import logging
import os
from datetime import datetime
from typing import Callable

import httpx
from pydantic import BaseModel

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

from fastapi import APIRouter, Header, HTTPException

log = logging.getLogger("query_db")

PAGE_SIZE = 50
MAX_TABLES = 200

# Aree mostrate nel selettore di QueryDb.jsx: id -> schema Postgres.
# NB: lele_ns e lele_sw sono DATABASE Postgres separati (schema public),
# non schemi del db principale: la connessione e' dedicata (vedi sotto).
# "dbt" e' lo schema bronze del db principale (layer bronze di dbt).
AREAS = {
    "leles": "public",
    "emergence": "emergence",
    "lele_ns": "public",
    "lele_sw": "public",
    "dbt": "bronze",
}

# Per queste aree la connessione punta a un database Postgres diverso da
# quello del gateway: credenziali riusate dall'env del gateway (PGHOST/
# PGPORT/PGUSER/PGPASSWORD), nome db overridabile via env dedicata.
AREA_DB_ENV = {
    "lele_ns": "QDB_DB_LELE_NS",
    "lele_sw": "QDB_DB_LELE_SW",
}


def _connect_area(area: str, get_connection: Callable):
    """Connessione per area: default = db del gateway, altrimenti db dedicato."""
    env_name = AREA_DB_ENV.get(area)
    if not env_name:
        return get_connection()
    dbname = os.environ.get(env_name) or area
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        port=os.environ.get("PGPORT", "5432"),
        dbname=dbname,
        user=os.environ.get("PGUSER"),
        password=os.environ.get("PGPASSWORD"),
    )

# Colonne "temporal" per ordinamento, attivita' recente e filtro date
# (match sul suffisso).
TIME_HINTS = ("created_at", "updated_at", "timestamp", "time", "date", "when", "_at")

# Colonne candidato per il filtro/gruppo "utente", PER AREA:
# si usa la prima colonna presente nella tabella.
#   - leles: "role" e' generato dal codice Leles (non e' un utente del DB)
#     ma VALE come chiave di raggruppamento automatico del pannello utenti.
#   - emergence: "role" identifica il ruolo del messaggio (sempre
#     "assistant") e agent_id/model_id sono FK alle tabelle agents/models:
#     NON sono filtri utente e non compaiono qui.
GENERIC_USER_COLS = ("user", "username", "utente", "user_email", "email", "sender", "author", "owner")
USER_COLS_BY_AREA = {
    "leles": GENERIC_USER_COLS + ("role",),
    "emergence": GENERIC_USER_COLS,
    "lele_ns": GENERIC_USER_COLS,
    "lele_sw": GENERIC_USER_COLS,
    "dbt": GENERIC_USER_COLS,
}
# Override per singola tabella (area -> {tabella: colonne}) quando serve una
# colonna di raggruppamento specifica, es. session_id su emergence.messages.
TABLE_USER_COLS = {
    "leles": {},
    "emergence": {},
    "lele_ns": {},
    "lele_sw": {},
    "dbt": {},
}

# Emergence: i metadati vivono in una colonna JSON ("metadata"), es.
# {'agent_name': 'Tester', 'model_name': 'qwen2.5'}. I filtri agente/modello
# si applicano sulle chiavi JSON, non su colonne relazionali.
# (parametro query -> chiave JSON)
META_COL = "metadata"
META_FILTERS = {"agent": "agent_name", "model": "model_name"}


def _readonly(area: str, get_connection: Callable):
    """Apre una connessione in sola lettura (il DB rifiuta le scritture)."""
    conn = _connect_area(area, get_connection)
    try:
        conn.set_session(readonly=True, autocommit=True)
    except Exception:
        pass
    return conn


def _schema(area: str) -> str:
    if area not in AREAS:
        raise HTTPException(status_code=400, detail=f"Area non valida: {area}")
    return AREAS[area]


# ---------------------------------------------------------------------------
# MEMORY SUMMARY — generazione e salvataggio riassunti giornalieri
# ---------------------------------------------------------------------------
# Aree con la tabella memory_summary (stessa struttura: id, summary, model,
# n_messages, days, period_start, period_end, created_at). Il summary viene
# generato al volo con Ollama sul transcript del giorno (tabella memory) e,
# se approvato dall'admin, salvato come NUOVA riga: mai update/overwrite.
SUMMARY_AREAS = ("leles", "lele_ns", "lele_sw")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
SUMMARY_MODEL = os.environ.get("QDB_SUMMARY_MODEL", "mistral")
MAX_TRANSCRIPT_CHARS = 20000

SUMMARY_SYSTEM_PROMPT = (
    "Sei l'archivista della memoria degli agenti di Daniele. "
    "Riassumi il transcript di conversazioni e attivita' del giorno. "
    "Scrivi in italiano, in forma densa e fattuale: cosa e' stato chiesto, "
    "cosa e' stato fatto/deciso, eventi notevoli. Massimo 400 parole. "
    "Niente preamboli, solo il riassunto."
)


class SummaryGenerate(BaseModel):
    area: str
    date: str


class SummarySave(BaseModel):
    area: str
    date: str
    summary: str
    model: str = ""
    n_messages: int = 0


def _check_summary_area(area: str) -> None:
    if area not in SUMMARY_AREAS:
        raise HTTPException(status_code=400, detail=f"Area non valida per il summary: {area}")


def _summary_date(date: str):
    try:
        return datetime.strptime((date or "").strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Data non valida: {date} (attesa YYYY-MM-DD)")


async def _ollama_summary(transcript: str, model: str) -> str:
    payload = {
        "model": model,
        "prompt": transcript,
        "stream": False,
        "system": SUMMARY_SYSTEM_PROMPT,
        "options": {"num_ctx": 16384, "num_predict": 4096, "temperature": 0.7},
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=600.0)) as client:
        response = await client.post(OLLAMA_URL, json=payload)
        response.raise_for_status()
        return (response.json() or {}).get("response", "").strip()


def _build_transcript(rows) -> str:
    lines = [
        f"{r['created_at'].strftime('%m-%d %H:%M')} | {r['role']}: {r['content']}"
        for r in rows
    ]
    transcript = "\n".join(lines)
    if len(transcript) > MAX_TRANSCRIPT_CHARS:
        cut = transcript[-MAX_TRANSCRIPT_CHARS:]
        head = "[... troncato: prime voci del giorno omesse ...]\n"
        transcript = head + cut[cut.find("\n") + 1:]
    return transcript


def _columns(cur, schema: str, table: str) -> list[str]:
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s "
        "ORDER BY ordinal_position",
        (schema, table),
    )
    return [r["column_name"] for r in cur.fetchall()]


def _tables(cur, schema: str) -> list[dict]:
    """Tabelle dello schema, con stima righe."""
    cur.execute(
        "SELECT c.relname AS name, GREATEST(c.reltuples::bigint, 0) AS approx_rows "
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = %s AND c.relkind = 'r' "
        "ORDER BY c.relname LIMIT %s",
        (schema, MAX_TABLES),
    )
    out = []
    for r in cur.fetchall():
        approx = r["approx_rows"]
        out.append({
            "name": r["name"],
            "rows": int(approx) if approx and approx > 0 else None,
            "detail": "stima" if approx and approx > 0 else "",
        })

    # Stima mancante (reltuples = 0, mai ANALYZE): count esatto, ma con
    # timeout corto e tetto di tabelle per non impallare la status.
    unknown = [t for t in out if t["rows"] is None][:40]
    for t in unknown:
        try:
            cur.execute(
                sql.SQL("SELECT COUNT(*) AS n FROM {}").format(
                    sql.Identifier(schema, t["name"])
                )
            )
            t["rows"] = int(cur.fetchone()["n"])
            t["detail"] = "esatto"
        except Exception as exc:
            log.warning("count %s: %s", t["name"], exc)
    return out


def _time_col(cols: list[str]):
    return next((c for c in cols if c.lower().endswith(TIME_HINTS)), None)


def _user_col(cols: list[str], area: str, table: str):
    """Colonna di filtro/raggruppamento per la tabella, scelta per area.

    Prima l'eventuale override per tabella, poi la lista candidato
    dell'area (USER_COLS_BY_AREA): la prima colonna presente nella tabella.
    NB: colonne come agent_id/model_id/role di emergence non sono qui:
    restano dati visibili ma non diventano "utenti".
    """
    lowered = {c.lower(): c for c in cols}
    for cand in TABLE_USER_COLS.get(area, {}).get(table, ()):
        if cand in lowered:
            return lowered[cand]
    for cand in USER_COLS_BY_AREA.get(area, GENERIC_USER_COLS):
        if cand in lowered:
            return lowered[cand]
    return None


def _meta_col(cols: list[str]):
    return next((c for c in cols if c.lower() == META_COL), None)


def _recent(cur, schema: str, tables: list[dict]) -> list[dict]:
    """Per ogni tabella con colonna temporale, l'ultimo valore registrato."""
    out = []
    for t in tables[:20]:
        name = t["name"]
        try:
            cols = _columns(cur, schema, name)
            tc = _time_col(cols)
            if not tc:
                continue
            cur.execute(
                sql.SQL("SELECT MAX({}) AS last FROM {}").format(
                    sql.Identifier(tc), sql.Identifier(schema, name)
                )
            )
            last = cur.fetchone()["last"]
            if last is not None:
                out.append({"what": name + " · " + tc, "when": str(last)})
        except Exception as exc:
            log.warning("recent %s: %s", name, exc)
    out.sort(key=lambda r: r["when"], reverse=True)
    return out[:12]


def _jsonable(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def build_query_db_router(
    verify_admin_token: Callable[[str | None], str],
    get_connection: Callable,
) -> APIRouter:
    router = APIRouter(prefix="/api/db", tags=["query-db"])

    @router.get("/status")
    async def db_status(area: str = "leles", authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        schema = _schema(area)
        try:
            conn = _readonly(area, get_connection)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Safety net: niente query che gira troppo sulla status.
                cur.execute("SET statement_timeout = 3000")
                tables = _tables(cur, schema)
                recent = []
                try:
                    recent = _recent(cur, schema, tables)
                except Exception:
                    log.exception("db status recent")
                return {
                    "area": area,
                    "schema": schema,
                    "tables": tables,
                    "recent": recent,
                }
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("db status")
            raise HTTPException(
                status_code=500,
                detail=f"Errore nella lettura del database: {exc}",
            )
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @router.get("/table")
    async def db_table(
        area: str = "leles",
        table: str = "",
        page: int = 0,
        user: str = "",
        date_from: str = "",
        date_to: str = "",
        users: str = "",
        agent: str = "",
        model: str = "",
        authorization: str | None = Header(None),
    ):
        verify_admin_token(authorization)
        schema = _schema(area)
        if not table or len(table) > 120 or not table.replace("_", "").isalnum():
            raise HTTPException(status_code=400, detail="Nome tabella non valido.")
        page = max(int(page), 0)
        user = (user or "").strip()[:200]
        users_list = [u.strip()[:200] for u in (users or "").split(",") if u.strip()][:100]
        date_from = (date_from or "").strip()[:10]
        date_to = (date_to or "").strip()[:10]
        agent = (agent or "").strip()[:200]
        model = (model or "").strip()[:200]

        try:
            conn = _readonly(area, get_connection)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Safety net anche sul caricamento tabella (sort su tabelle
                # grandi senza indice puo' metterci minuti: meglio un errore
                # netto che una richiesta appesa).
                cur.execute("SET statement_timeout = 15000")
                cols = _columns(cur, schema, table)
                if not cols:
                    raise HTTPException(status_code=404, detail=f"Tabella non trovata: {table}")

                tc = _time_col(cols)
                uc = _user_col(cols, area, table)
                mc = _meta_col(cols)

                # Ordinamento: colonna temporale DESC (poi id DESC), cosi'
                # l'anteprima mostra i record piu' recenti per prima.
                if tc:
                    order = sql.SQL("ORDER BY {} DESC").format(sql.Identifier(tc))
                    order_label = tc + " DESC"
                elif "id" in [c.lower() for c in cols]:
                    id_col = next(c for c in cols if c.lower() == "id")
                    order = sql.SQL("ORDER BY {} DESC").format(sql.Identifier(id_col))
                    order_label = "id DESC"
                else:
                    order = None
                    order_label = ""

                # Filtri opzionali: solo sulle colonne che la tabella ha.
                conds = []
                params = []
                if user and uc:
                    conds.append(sql.SQL("{} ILIKE %s").format(sql.Identifier(uc)))
                    params.append("%" + user + "%")
                if users_list and uc:
                    # Selezione checkbox della UI: solo gli utenti spuntati.
                    conds.append(sql.SQL("{} = ANY(%s)").format(sql.Identifier(uc)))
                    params.append(users_list)
                if mc:
                    # Filtri agente/modello sulle chiavi del JSON metadata.
                    for param_name, json_key in META_FILTERS.items():
                        val = {"agent": agent, "model": model}[param_name]
                        if val:
                            conds.append(
                                sql.SQL("CAST({} AS jsonb)->>'{}' = %s").format(
                                    sql.Identifier(mc), sql.SQL(json_key)
                                )
                            )
                            params.append(val)
                if tc:
                    if date_from:
                        conds.append(sql.SQL("{}::date >= %s").format(sql.Identifier(tc)))
                        params.append(date_from)
                    if date_to:
                        conds.append(sql.SQL("{}::date <= %s").format(sql.Identifier(tc)))
                        params.append(date_to)

                where = sql.SQL("")
                if conds:
                    where = sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conds)

                base = sql.SQL("SELECT * FROM {}").format(sql.Identifier(schema, table))
                query = base + where
                if order is not None:
                    query += sql.SQL(" ") + order
                query += sql.SQL(" LIMIT %s OFFSET %s")
                params += [PAGE_SIZE, page * PAGE_SIZE]

                cur.execute(query, params)
                rows = [
                    {k: _jsonable(v) for k, v in dict(r).items()} for r in cur.fetchall()
                ]
                return {
                    "table": table,
                    "columns": cols,
                    "rows": rows,
                    "page": page,
                    "order": order_label,
                    "filterable": {
                        "user_col": uc,
                        "time_col": tc,
                        "meta_keys": list(META_FILTERS.values()) if mc else [],
                    },
                }
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("db table %s", table)
            raise HTTPException(
                status_code=500,
                detail=f"Errore nella lettura della tabella: {exc}",
            )
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @router.get("/users")
    async def db_users(
        area: str = "leles",
        table: str = "",
        facet: str = "",
        authorization: str | None = Header(None),
    ):
        """Valori distinti della colonna user della tabella, con conteggio.

        Con facet=<chiave metadata> (es. agent_name, model_name) restituisce
        i valori distinti di quella chiave del JSON metadata, con conteggio.
        """
        verify_admin_token(authorization)
        schema = _schema(area)
        if not table or len(table) > 120 or not table.replace("_", "").isalnum():
            raise HTTPException(status_code=400, detail="Nome tabella non valido.")

        try:
            conn = _readonly(area, get_connection)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SET statement_timeout = 3000")
                cols = _columns(cur, schema, table)
                if not cols:
                    raise HTTPException(status_code=404, detail=f"Tabella non trovata: {table}")
                uc = _user_col(cols, area, table)
                mc = _meta_col(cols)
                if facet in META_FILTERS.values():
                    # Facet su chiave del JSON metadata (Emergence).
                    if not mc:
                        return {"table": table, "column": None, "users": []}
                    cur.execute(
                        sql.SQL(
                            "SELECT COALESCE(CAST({} AS jsonb)->> %s, '') AS name, COUNT(*) AS n "
                            "FROM {} GROUP BY 1 ORDER BY n DESC, name LIMIT 500"
                        ).format(sql.Identifier(mc), sql.Identifier(schema, table)),
                        (facet,),
                    )
                    facet_users = [
                        {"name": _jsonable(r["name"]), "count": int(r["n"])}
                        for r in cur.fetchall()
                    ]
                    return {
                        "table": table,
                        "column": mc + "->>'" + facet + "'",
                        "users": facet_users,
                    }
                if not uc:
                    return {"table": table, "column": None, "users": []}
                cur.execute(
                    sql.SQL(
                        "SELECT {} AS name, COUNT(*) AS n FROM {} "
                        "GROUP BY {} ORDER BY n DESC, name LIMIT 500"
                    ).format(
                        sql.Identifier(uc), sql.Identifier(schema, table), sql.Identifier(uc)
                    )
                )
                users = [
                    {"name": _jsonable(r["name"]), "count": int(r["n"])}
                    for r in cur.fetchall()
                ]
                return {"table": table, "column": uc, "users": users}
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("db users %s", table)
            raise HTTPException(
                status_code=500,
                detail=f"Errore nella lettura degli utenti: {exc}",
            )
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return router
    # ------------------------------------------------------------------
    # MEMORY SUMMARY — genera con Ollama, salva su approvazione
    # ------------------------------------------------------------------

    @router.get("/summary")
    async def db_summary_list(
        area: str = "leles",
        date: str = "",
        authorization: str | None = Header(None),
    ):
        """Righe gia' salvate in memory_summary per il giorno scelto."""
        verify_admin_token(authorization)
        _check_summary_area(area)
        day = _summary_date(date)
        try:
            conn = _readonly(area, get_connection)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SET statement_timeout = 5000")
                cur.execute(
                    "SELECT id, summary, model, n_messages, days, "
                    "period_start, period_end, created_at "
                    "FROM memory_summary WHERE period_start::date = %s ORDER BY id",
                    (day,),
                )
                rows = [
                    {k: _jsonable(v) for k, v in dict(r).items()} for r in cur.fetchall()
                ]
                return {"area": area, "date": str(day), "rows": rows}
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("db summary list %s", area)
            raise HTTPException(status_code=500, detail=f"Errore nella lettura di memory_summary: {exc}")
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @router.post("/summary/generate")
    async def db_summary_generate(req: SummaryGenerate, authorization: str | None = Header(None)):
        """Genera (senza salvare) il riassunto del giorno con Ollama."""
        verify_admin_token(authorization)
        _check_summary_area(req.area)
        day = _summary_date(req.date)
        try:
            conn = _readonly(req.area, get_connection)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SET statement_timeout = 15000")
                cur.execute(
                    "SELECT role, content, created_at FROM memory "
                    "WHERE created_at::date = %s ORDER BY created_at",
                    (day,),
                )
                rows = cur.fetchall()
        except Exception as exc:
            log.exception("db summary fetch %s", req.area)
            raise HTTPException(status_code=500, detail=f"Errore nella lettura di memory: {exc}")
        finally:
            try:
                conn.close()
            except Exception:
                pass

        if not rows:
            raise HTTPException(status_code=404, detail=f"Nessun messaggio in memory il {day}.")
        model = (SUMMARY_MODEL or "mistral").strip()
        try:
            summary = await _ollama_summary(_build_transcript(rows), model)
        except Exception as exc:
            log.exception("db summary ollama")
            raise HTTPException(status_code=502, detail=f"Ollama non raggiungibile o in errore: {exc}")
        if not summary.strip():
            raise HTTPException(status_code=502, detail="Ollama ha restituito un riassunto vuoto.")
        return {
            "area": req.area,
            "date": str(day),
            "summary": summary,
            "model": model,
            "n_messages": len(rows),
        }

    @router.post("/summary/save")
    async def db_summary_save(req: SummarySave, authorization: str | None = Header(None)):
        """Salva il riassunto approvato come NUOVA riga di memory_summary."""
        verify_admin_token(authorization)
        _check_summary_area(req.area)
        day = _summary_date(req.date)
        text = (req.summary or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Riassunto vuoto: niente da salvare.")
        if len(text) > 100000:
            raise HTTPException(status_code=400, detail="Riassunto troppo lungo.")
        try:
            conn = _connect_area(req.area, get_connection)  # connessione scrivibile
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        "INSERT INTO memory_summary "
                        "(summary, model, n_messages, days, period_start, period_end) "
                        "VALUES (%s, %s, %s, 1, %s, %s::date + interval '1 day' - interval '1 second') "
                        "RETURNING id",
                        (
                            text,
                            (req.model or SUMMARY_MODEL).strip() or None,
                            int(req.n_messages or 0),
                            day,
                            day,
                        ),
                    )
                    new_id = cur.fetchone()["id"]
            return {"saved": True, "id": new_id, "area": req.area, "date": str(day)}
        except Exception as exc:
            log.exception("db summary save %s", req.area)
            raise HTTPException(status_code=500, detail=f"Errore nel salvataggio: {exc}")
        finally:
            try:
                conn.close()
            except Exception:
                pass
