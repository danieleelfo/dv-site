"""
query_db.py — Backend "QueryDB" per QueryDb.jsx (read-only). v3

Endpoint (tutti con Google auth, stesso verify_admin_token del gateway):
    GET  /api/db/status?area=leles|emergence
    GET  /api/db/table?area=&table=&page=&user=&date_from=&date_to=

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
from typing import Callable

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

from fastapi import APIRouter, Header, HTTPException

log = logging.getLogger("query_db")

PAGE_SIZE = 50
MAX_TABLES = 200

# Aree mostrate nel selettore di QueryDb.jsx: id -> schema Postgres.
AREAS = {
    "leles": "public",
    "emergence": "emergence",
}

# Colonne "temporal" per ordinamento, attivita' recente e filtro date
# (match sul suffisso).
TIME_HINTS = ("created_at", "updated_at", "timestamp", "time", "date", "when", "_at")

# Colonne su cui si applica il filtro "user" (la prima che esiste).
USER_COLS = ("user", "username", "utente", "user_email", "email", "sender", "author", "agent", "name")


def _readonly(get_connection: Callable):
    """Apre una connessione in sola lettura (il DB rifiuta le scritture)."""
    conn = get_connection()
    try:
        conn.set_session(readonly=True, autocommit=True)
    except Exception:
        pass
    return conn


def _schema(area: str) -> str:
    if area not in AREAS:
        raise HTTPException(status_code=400, detail=f"Area non valida: {area}")
    return AREAS[area]


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


def _user_col(cols: list[str]):
    lowered = {c.lower(): c for c in cols}
    for cand in USER_COLS:
        if cand in lowered:
            return lowered[cand]
    return None


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
            conn = _readonly(get_connection)
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
        authorization: str | None = Header(None),
    ):
        verify_admin_token(authorization)
        schema = _schema(area)
        if not table or len(table) > 120 or not table.replace("_", "").isalnum():
            raise HTTPException(status_code=400, detail="Nome tabella non valido.")
        page = max(int(page), 0)
        user = (user or "").strip()[:200]
        date_from = (date_from or "").strip()[:10]
        date_to = (date_to or "").strip()[:10]

        try:
            conn = _readonly(get_connection)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"PostgreSQL non raggiungibile: {exc}")
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cols = _columns(cur, schema, table)
                if not cols:
                    raise HTTPException(status_code=404, detail=f"Tabella non trovata: {table}")

                tc = _time_col(cols)
                uc = _user_col(cols)

                # Ordinamento: colonna temporale DESC (poi id DESC), cosi'
                # l'anteprima mostra i record piu' recenti per prima.
                if tc:
                    order = sql.SQL("{} DESC").format(sql.Identifier(tc))
                    order_label = tc + " DESC"
                elif "id" in [c.lower() for c in cols]:
                    id_col = next(c for c in cols if c.lower() == "id")
                    order = sql.SQL("{} DESC").format(sql.Identifier(id_col))
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
                    "filterable": {"user_col": uc, "time_col": tc},
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

    return router
