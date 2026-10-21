"""
query_db.py — Backend "QueryDB" per QueryDb.jsx (read-only).

Endpoint (tutti con Google auth, stesso verify_admin_token del gateway):
    GET  /api/db/status?area=leles|emergence
    GET  /api/db/table?area=&table=&page=

Principi di sicurezza:
  - READ-ONLY: la connessione Postgres viene aperta con readonly=True,
    quindi il DB rifiuta qualsiasi scrittura anche se il codice cambiasse.
  - NESSUNA query libera dal client: il nome tabella viene validato
    contro information_schema (solo schema "public") e quotato con
    psycopg2.sql.Identifier: niente SQL injection, niente tabelle arbitrarie.
  - LIMIT/OFFSET sono decisi dal server (50 righe per pagina).
  - aree: "leles" = tutte le tabelle public, "emergence" = tabelle che
    iniziano per "emergence". L'area filtra solo l'elenco: la lettura
    resta comunque read-only su tutto lo schema public.

Riusa la get_connection() del gateway (env PGHOST/PGPORT/PGDATABASE/
PGUSER/PGPASSWORD in gateway.env).
"""

import logging
from typing import Callable

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

from fastapi import APIRouter, Header, HTTPException

log = logging.getLogger("query_db")

PAGE_SIZE = 50
MAX_TABLES = 200

# Aree mostrate nel selettore di QueryDb.jsx: id -> filtro sul nome tabella.
AREAS = {
    "leles": None,          # tutte le tabelle public
    "emergence": "emergence",
}

# Colonne "temporal" usate per l'attivita' recente (match sul suffisso).
TIME_HINTS = ("created_at", "updated_at", "timestamp", "time", "date", "when", "_at")


def _readonly(get_connection: Callable):
    """Apre una connessione in sola lettura (il DB rifiuta le scritture)."""
    conn = get_connection()
    try:
        conn.set_session(readonly=True, autocommit=True)
    except Exception:
        pass
    return conn


def _area(area: str) -> str | None:
    if area not in AREAS:
        raise HTTPException(status_code=400, detail=f"Area non valida: {area}")
    return AREAS[area]


def _tables(cur, area: str) -> list[dict]:
    """Tabelle dello schema public (filtrate per area), con stima righe."""
    like = AREAS[area]
    query = sql.SQL(
        "SELECT c.relname AS name, GREATEST(c.reltuples::bigint, 0) AS approx_rows "
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind = 'r' "
    )
    params = []
    if like:
        query += sql.SQL("AND c.relname LIKE %s ")
        params.append(like + "%")
    query += sql.SQL("ORDER BY c.relname LIMIT %s")
    params.append(MAX_TABLES)

    cur.execute(query, params)
    rows = cur.fetchall()
    out = []
    for r in rows:
        approx = r["approx_rows"]
        out.append({
            "name": r["name"],
            "rows": int(approx) if approx and approx > 0 else None,
            "detail": "stima" if approx and approx > 0 else "",
        })
    return out


def _recent(cur, tables: list[dict]) -> list[dict]:
    """Per ogni tabella con colonna temporale, l'ultimo valore registrato."""
    out = []
    for t in tables[:20]:
        name = t["name"]
        try:
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s "
                "ORDER BY ordinal_position",
                (name,),
            )
            cols = [r["column_name"] for r in cur.fetchall()]
            time_col = next((c for c in cols if c.lower().endswith(TIME_HINTS)), None)
            if not time_col:
                continue
            cur.execute(
                sql.SQL("SELECT MAX({}) AS last FROM {}").format(
                    sql.Identifier(time_col), sql.Identifier(name)
                )
            )
            last = cur.fetchone()["last"]
            if last is not None:
                out.append({"what": name + " · " + time_col, "when": str(last)})
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
        _area(area)
        try:
            conn = _readonly(get_connection)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                tables = _tables(cur, area)
                return {
                    "area": area,
                    "tables": tables,
                    "recent": _recent(cur, tables),
                }
        except HTTPException:
            raise
        except Exception:
            log.exception("db status")
            raise HTTPException(status_code=500, detail="Errore nella lettura del database.")
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
        authorization: str | None = Header(None),
    ):
        verify_admin_token(authorization)
        _area(area)
        if not table or len(table) > 120 or not table.replace("_", "").isalnum():
            raise HTTPException(status_code=400, detail="Nome tabella non valido.")
        page = max(int(page), 0)

        try:
            conn = _readonly(get_connection)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = %s "
                    "ORDER BY ordinal_position",
                    (table,),
                )
                columns = [r["column_name"] for r in cur.fetchall()]
                if not columns:
                    raise HTTPException(status_code=404, detail=f"Tabella non trovata: {table}")

                cur.execute(
                    sql.SQL("SELECT * FROM {} LIMIT %s OFFSET %s").format(
                        sql.Identifier(table)
                    ),
                    (PAGE_SIZE, page * PAGE_SIZE),
                )
                rows = [
                    {k: _jsonable(v) for k, v in dict(r).items()} for r in cur.fetchall()
                ]
                return {"table": table, "columns": columns, "rows": rows, "page": page}
        except HTTPException:
            raise
        except Exception:
            log.exception("db table %s", table)
            raise HTTPException(status_code=500, detail="Errore nella lettura della tabella.")
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return router
