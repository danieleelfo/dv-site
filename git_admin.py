"""
git_admin.py — Backend "Git Admin" per Test2.jsx

Endpoint (tutti con Google auth, stesso verify_admin_token del gateway):
    GET  /api/git/admin/status?project=
    GET  /api/git/admin/diff?project=&scope=working|staged|incoming|outgoing
    POST /api/git/admin/preview   {project, action, message?}
    POST /api/git/admin/execute   {project, action, message?, confirmation_phrase, preview_id}

Principi di sicurezza:
  - repo in WHITELIST (id -> path lato server): il client non manda mai path.
  - nessuna shell: solo subprocess con lista di argomenti.
  - ogni scrittura passa da preview_id monouso (TTL 5 min), legato a email,
    repo, azione, messaggio e "fingerprint" dello stato del repo: se il repo
    cambia dopo l'anteprima, l'esecuzione viene rifiutata.
  - la frase di conferma è decisa e verificata dal server.
  - mai push --force. Il "pull forzato" crea prima un branch di backup e uno
    stash (inclusi i file non tracciati), poi fa reset --hard sull'upstream.
  - un solo comando git alla volta per repo (lock).
  - le scritture sono DISABILITATE finché non imposti GIT_ADMIN_ALLOW_WRITE=1
    (e GIT_ADMIN_ALLOW_FORCE=1 per il pull forzato) in gateway.env.
  - audit log JSON in GIT_ADMIN_AUDIT_LOG (default: git_admin_audit.log).

Env opzionali:
  GIT_ADMIN_BASE        cartella che contiene i repo (default /Users/danny/Desktop/Danny)
  GIT_REPO_<ID>         path esplicito per un repo, es. GIT_REPO_BAR_AI=/path/bar_ai
                        (per leles e dv_site valgono anche LELES_REPO_PATH / DV_SITE_PATH)
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import time
from datetime import datetime
from typing import Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

log = logging.getLogger("git_admin")

# --------------------------------------------------------------------------
# CONFIG
# --------------------------------------------------------------------------
BASE_
DIR = os.environ.get("GIT_ADMIN_BASE", "/Users/danny/Desktop/Danny")

# id (come in Test2.jsx) -> nome cartella sotto BASE_DIR.
# VERIFICA i nomi delle cartelle sul tuo Mac, oppure usa GIT_REPO_<ID>.
REPO_DIRS = {
    "leles": "leles",
    "bar_ai": "bar_ai",
    "lele": "lele",
    "lele_story_whisper": "lele_story_whisper",
    "lele_night_story": "lele_night_story",
    "dv_site": "dv-site",
    "gradv": "GraDV",
}

# Variabili d'ambiente già usate altrove nel gateway, come fallback.
LEGACY_ENV = {"leles": "LELES_REPO_PATH", "dv_site": "DV_SITE_PATH"}

ACTIONS = ("commit", "push", "pull", "force_pull")
SCOPES = ("working", "staged", "incoming", "outgoing")

PREVIEW_TTL = 300          # secondi
FETCH_THROTTLE = 60        # secondi tra due fetch automatici su status/diff
FETCH_TIMEOUT = 30
DIFF_MAX_CHARS = 200_000
OUTPUT_MAX_CHARS = 20_000
MAX_MESSAGE_CHARS = 500

AUDIT_LOG = os.environ.get("GIT_ADMIN_AUDIT_LOG", "git_admin_audit.log")


def _flag(name: str) -> bool:
    return os.environ.get(name, "0").strip().lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------
# STATO IN MEMORIA
# --------------------------------------------------------------------------
_LOCKS: dict[str, asyncio.Lock] = {}
_PREVIEWS: dict[str, dict] = {}
_FETCH_CACHE: dict[str, tuple[float, str | None]] = {}


def _lock(project: str) -> asyncio.Lock:
    return _LOCKS.setdefault(project, asyncio.Lock())


def _gc_previews() -> None:
    now = time.time()
    for pid in [k for k, v in _PREVIEWS.items() if v["expires"] < now]:
        _PREVIEWS.pop(pid, None)


# --------------------------------------------------------------------------
# UTILITY
# --------------------------------------------------------------------------
_CRED_RE = re.compile(r"(https?://)[^/@\s]+@")


def _scrub(text: str) -> str:
    """Toglie user:token@ dagli URL prima di mostrare errori al browser."""
    return _CRED_RE.sub(r"\1***@", text or "")


def _cap(text: str, limit: int) -
> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n… [troncato: {len(text) - limit} caratteri omessi]"


def _short(sha: str | None) -> str:
    return sha[:8] if sha else ""


def _env() -> dict:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"      # mai prompt interattivi
    env["GIT_PAGER"] = "cat"
    env["GIT_OPTIONAL_LOCKS"] = "0"       # le letture non bloccano l'index
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=10")
    return env


def _repo_path(project: str) -> str:
    if project not in REPO_DIRS:
        raise HTTPException(status_code=400, detail=f"Repository non valido: {project}")

    path = (
        os.environ.get(f"GIT_REPO_{project.upper()}")
        or os.environ.get(LEGACY_ENV.get(project, ""), "")
        or os.path.join(BASE_DIR, REPO_DIRS[project])
    )
    path = os.path.realpath(os.path.expanduser(path))

    if not os.path.isdir(path) or not os.path.exists(os.path.join(path, ".git")):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Repository '{project}' non trovato sul server. "
                f"Imposta GIT_REPO_{project.upper()}=/percorso/del/repo in gateway.env."
            ),
        )
    return path


async def _run(path: str, *args: str, timeout: int = 30) -> tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-c", "core.quotepath=false", "-C", path, *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_env(),
        )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="git non è installato sul server.")

    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise HTTPException(status_code=504
, detail=f"Timeout: git {args[0]} oltre {timeout}s.")
    except asyncio.CancelledError:
        proc.kill()
        raise

    return proc.returncode, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


async def _ok(path: str, *args: str, timeout: int = 30) -> str:
    rc, out, err = await _run(path, *args, timeout=timeout)
    if rc != 0:
        msg = _scrub((err or out).strip()) or f"git {args[0]} fallito (codice {rc})."
        raise HTTPException(status_code=409, detail=msg)
    return out


async def _try(path: str, *args: str) -> str | None:
    rc, out, _ = await _run(path, *args)
    return out.strip() if rc == 0 else None


# --------------------------------------------------------------------------
# LETTURA STATO
# --------------------------------------------------------------------------
async def _head(path: str) -> str | None:
    return await _try(path, "rev-parse", "HEAD")


async def _branch(path: str) -> str | None:
    return await _try(path, "symbolic-ref", "--short", "-q", "HEAD")


async def _upstream(path: str) -> str | None:
    return await _try(path, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")


async def _upstream_sha(path: str) -> str | None:
    return await _try(path, "rev-parse", "@{u}")


async def _ahead_behind(path: str) -> tuple[int | None, int | None]:
    out = await _try(path, "rev-list", "--left-right", "--count", "HEAD...@{u}")
    if not out:
        return None, None
    a, b = out.split()
    return int(a), int(b)


async def _porcelain(path: str) -> list[dict]:
    rc, out, err = await _run(
        path, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"
    )
    if rc != 0:
        raise HTTPException(status_code=409, detail=_scrub(err.strip()) or "git status fallito.")
    entries = []
    for item in out.split("\0"):
        if len(item) >= 4:
            entries.append({"xy": item[:2], "path": item[3:]})
    return entries


def _is_conflict(xy: str) -> bool:

    return "U" in xy or xy in ("AA", "DD")


def _is_staged(xy: str) -> bool:
    return xy[0] not in " ?"


def _is_unstaged(xy: str) -> bool:
    return xy != "??" and xy[1] != " "


_SENSITIVE_RE = re.compile(
    r"(^|/)(\.env(\..+)?|[^/]*\.env|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)[^/]*"
    r"|credentials\.json|service[-_]account[^/]*\.json)$",
    re.I,
)
_SAFE_SUFFIX = (".example", ".sample", ".template", ".pub")


def _is_sensitive(p: str) -> bool:
    return bool(_SENSITIVE_RE.search(p)) and not p.lower().endswith(_SAFE_SUFFIX)


def _entry_file(e: dict) -> dict:
    xy = e["xy"]
    st = "?" if xy == "??" else (xy[0] if xy[0] != " " else xy[1])
    return {"path": e["path"], "status": st}


async def _files(path: str, diff_args: list[str]) -> list[dict]:
    """Elenco file con +/- per un `git diff <diff_args>`."""
    _, ns, _ = await _run(path, "diff", "--no-renames", "--name-status", *diff_args)
    _, num, _ = await _run(path, "diff", "--no-renames", "--numstat", *diff_args)

    stats: dict[str, tuple[int, int]] = {}
    for line in num.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3:
            a, d, p = parts[0], parts[1], "\t".join(parts[2:])
            stats[p] = (int(a) if a.isdigit() else 0, int(d) if d.isdigit() else 0)

    files = []
    for line in ns.splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            add, dele = stats.get(parts[1], (0, 0))
            files.append(
                {"path": parts[1], "status": parts[0][:1], "additions": add, "deletions": dele}
            )
    return files


async def _fetch(path: str, project: str, force: bool = False) -> str | None:
    """Fetch non interattivo. Ritorna None se ok, altrimenti il messaggio d'errore."""
    now = time.time()
    cached = _FETCH_CACHE.get(project)
    if not force and cached and now - cached[0] < FETCH_THROTTLE:
        return cached[1]

    error: str | None = None
    try:
        rc, out, err = a
wait _run(path, "fetch", "--quiet", timeout=FETCH_TIMEOUT)
        if rc != 0:
            error = _scrub((err or out).strip()) or "git fetch fallito."
    except HTTPException as e:
        error = str(e.detail)

    _FETCH_CACHE[project] = (time.time(), error)
    return error


async def _fingerprint(path: str, action: str) -> str:
    """Impronta dello stato rilevante per l'azione: se cambia, la preview è invalida."""
    head = await _head(path) or ""
    up = await _upstream_sha(path) or ""
    entries = await _porcelain(path)
    status = "|".join(f"{e['xy']}:{e['path']}" for e in entries)

    if action == "commit":
        raw = f"{head}#{status}"
    elif action == "push":
        raw = f"{head}#{up}"
    elif action == "pull":
        raw = f"{head}#{up}#{status}"
    else:  # force_pull
        raw = f"{head}#{up}#{status}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _audit(email: str, project: str, action: str, ok: bool, detail: str = "") -> None:
    rec = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "email": email,
        "project": project,
        "action": action,
        "ok": ok,
        "detail": detail[:500],
    }
    log.info("git_admin %s", json.dumps(rec, ensure_ascii=False))
    try:
        with open(AUDIT_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _clean_message(message: str | None) -> str:
    msg = (message or "").replace("\x00", "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Scrivi un messaggio di commit.")
    if len(msg) > MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=400, detail=f"Messaggio troppo lungo (massimo {MAX_MESSAGE_CHARS})."
        )
    return msg


# --------------------------------------------------------------------------
# STATUS / DIFF
# --------------------------------------------------------------------------
async def _st
atus_payload(path: str, project: str) -> dict:
    fetch_error = await _fetch(path, project)

    head = await _head(path)
    branch = await _branch(path)
    upstream = await _upstream(path)
    ahead, behind = await _ahead_behind(path) if upstream else (None, None)

    last_commit = None
    if head:
        raw = await _try(path, "log", "-1", "--format=%H%x1f%s%x1f%an%x1f%cI")
        if raw:
            sha, subject, author, date = (raw.split("\x1f") + ["", "", "", ""])[:4]
            last_commit = {"sha": sha, "message": subject, "author": author, "date": date}

    entries = await _porcelain(path)
    staged = [e for e in entries if _is_staged(e["xy"])]
    unstaged = [e for e in entries if _is_unstaged(e["xy"])]
    untracked = [e for e in entries if e["xy"] == "??"]
    conflicts = [e["path"] for e in entries if _is_conflict(e["xy"])]

    if not entries:
        working = "Pulito"
    else:
        bits = []
        if unstaged:
            bits.append(f"{len(unstaged)} modificati")
        if untracked:
            bits.append(f"{len(untracked)} non tracciati")
        if conflicts:
            bits.append(f"{len(conflicts)} in conflitto")
        working = " · ".join(bits) or "Modificato"

    remote_name = upstream.split("/", 1)[0] if upstream else "origin"
    remote_url = await _try(path, "remote", "get-url", remote_name)

    return {
        "project": project,
        "branch": branch or "(detached HEAD)",
        "detached": branch is None,
        "upstream": upstream,
        "head_sha": head,
        "last_commit": last_commit,
        "ahead": ahead,
        "behind": behind,
        "dirty": bool(entries),
        "working_tree": working,
        "staged_summary": f"{len(staged)} file in stage" if staged else "Nessun file in stage",
        "remote": _scrub(remote_url) if remote_url else None,
        "conflicts": conflicts,
        "fetch_error": fetch_error,
    }


async def _diff_payload(path: str, project: str, scope: str) -> dict:
   
 header = ""

    if scope == "working":
        files = await _files(path, [])
        untracked = [e["path"] for e in await _porcelain(path) if e["xy"] == "??"]
        files += [
            {"path": p, "status": "?", "additions": 0, "deletions": 0} for p in untracked
        ]
        _, patch, _ = await _run(path, "diff", "--no-renames")
        if untracked:
            patch += "\n# File non tracciati (non inclusi nel diff):\n" + "\n".join(
                f"#   {p}" for p in untracked
            ) + "\n"
        summary = f"{len(files)} file con modifiche non in stage"

    elif scope == "staged":
        files = await _files(path, ["--cached"])
        _, patch, _ = await _run(path, "diff", "--no-renames", "--cached")
        summary = f"{len(files)} file pronti per il commit"

    else:
        if scope == "incoming":
            await _fetch(path, project)
        upstream = await _upstream(path)
        if not upstream:
            return {
                "summary": "Nessun upstream configurato per questo branch.",
                "files": [],
                "diff": "",
                "truncated": False,
            }
        if scope == "incoming":
            rng, log_rng, label = "HEAD...@{u}", "HEAD..@{u}", "Commit in arrivo"
        else:
            rng, log_rng, label = "@{u}...HEAD", "@{u}..HEAD", "Commit in uscita"

        commits = (await _try(path, "log", "--format=%h %s (%an)", log_rng) or "").splitlines()
        files = await _files(path, [rng])
        _, patch, _ = await _run(path, "diff", "--no-renames", rng)
        header = f"# {label}: {len(commits)}\n" + "\n".join(f"#   {c}" for c in commits) + "\n\n"
        summary = f"{len(commits)} commit · {len(files)} file ({upstream})"

    text = header + patch
    return {
        "summary": summary,
        "files": files,
        "diff": _cap(text, DIFF_MAX_CHARS),
        "truncated": len(text) > DIFF_MAX_CHARS,
    }


# --------------------------------------------------------------
------------
# PREVIEW
# --------------------------------------------------------------------------
def _phrase(action: str, project: str) -> str:
    if action == "force_pull":
        return f"SOVRASCRIVI {project.upper()}"
    return f"CONFERMA {action.upper()}"


async def _build_preview(project: str, path: str, action: str, message: str | None) -> dict:
    reasons: list[str] = []
    warnings: list[str] = []
    files: list[dict] = []
    output = ""
    summary = ""
    msg: str | None = None

    entries = await _porcelain(path)
    branch = await _branch(path)
    conflicts = [e["path"] for e in entries if _is_conflict(e["xy"])]

    # -------------------------------------------------- COMMIT
    if action == "commit":
        msg = _clean_message(message)
        files = [_entry_file(e) for e in entries]
        output = "\n".join(f"{e['xy']} {e['path']}" for e in entries)

        if not entries:
            reasons.append("Nessuna modifica da committare.")
        if conflicts:
            reasons.append("Conflitti non risolti: " + ", ".join(conflicts[:10]))
        sensitive = [e["path"] for e in entries if _is_sensitive(e["path"])]
        if sensitive:
            reasons.append(
                "File sensibili rilevati, aggiungili a .gitignore: " + ", ".join(sensitive[:10])
            )

        staged = [e for e in entries if _is_staged(e["xy"])]
        untracked = [e for e in entries if e["xy"] == "??"]
        if untracked:
            warnings.append(f"{len(untracked)} file non tracciati verranno aggiunti al repository.")
        if staged and len(staged) < len(entries):
            warnings.append(
                "Alcuni file sono già in stage, ma verrà eseguito `git add -A`: "
                "entreranno nel commit anche tutti gli altri."
            )
        if branch is None:
            warnings.append("HEAD è detached: il commit non appartiene a nessun branch.")

        summary = (
            f"Verrà eseguito `git add -A` e un commit 
su {branch or 'HEAD detached'} "
            f"({len(entries)} file) con messaggio: «{msg}»."
        )

    # -------------------------------------------------- PUSH
    elif action == "push":
        fetch_err = await _fetch(path, project, force=True)
        upstream = await _upstream(path)
        ahead, behind = await _ahead_behind(path) if upstream else (None, None)

        if fetch_err:
            warnings.append(f"Fetch non riuscito, il confronto col remoto può essere vecchio: {fetch_err}")
        if branch is None:
            reasons.append("HEAD è detached: nessun branch da pushare.")
        if not upstream:
            reasons.append(
                "Il branch non ha un upstream. La prima volta fai `git push -u` da terminale."
            )
        else:
            if behind:
                reasons.append(
                    f"Il remoto ha {behind} commit che non hai in locale: fai prima un pull."
                )
            if not ahead:
                reasons.append("Nessun commit da pushare.")
            files = await _files(path, ["@{u}...HEAD"])
            output = await _try(path, "log", "--format=%h %s (%an)", "@{u}..HEAD") or ""
        if entries:
            warnings.append("Hai modifiche locali non committate: non verranno incluse nel push.")
        if branch in ("main", "master"):
            warnings.append(f"Stai pushando direttamente su «{branch}».")

        summary = f"Verranno pushati {ahead or 0} commit di {branch} su {upstream or '—'} (nessun --force)."

    # -------------------------------------------------- PULL (ff-only)
    elif action == "pull":
        fetch_err = await _fetch(path, project, force=True)
        upstream = await _upstream(path)
        ahead, behind = await _ahead_behind(path) if upstream else (None, None)

        if fetch_err:
            reasons.append(f"Fetch non riuscito: {fetch_err}")
        if not upstream:
            reasons.append("Il branch non ha un upstream configurato.")
        elif
 not fetch_err:
            if conflicts:
                reasons.append("Conflitti non risolti: " + ", ".join(conflicts[:10]))
            if not behind:
                reasons.append("Già aggiornato: nessun commit remoto da ricevere.")
            if ahead:
                reasons.append(
                    f"Branch divergente ({ahead} in uscita, {behind} in arrivo): "
                    "il pull fast-forward non è possibile. Risolvi da terminale "
                    "(rebase/merge) oppure usa il Pull forzato, che è distruttivo."
                )
            files = await _files(path, ["HEAD", "@{u}"])
            output = await _try(path, "log", "--format=%h %s (%an)", "HEAD..@{u}") or ""

            if entries and behind and not ahead:
                incoming = {f["path"] for f in files}
                overlap = sorted(
                    e["path"] for e in entries if e["xy"] != "??" and e["path"] in incoming
                )
                if overlap:
                    reasons.append(
                        "Il pull toccherebbe file con modifiche locali: " + ", ".join(overlap[:10])
                    )
                else:
                    warnings.append("Hai modifiche locali, ma non toccano i file in arrivo.")

        summary = f"Verranno ricevuti {behind or 0} commit da {upstream or '—'} (solo fast-forward)."

    # -------------------------------------------------- FORCE PULL
    else:
        fetch_err = await _fetch(path, project, force=True)
        upstream = await _upstream(path)
        ahead, behind = await _ahead_behind(path) if upstream else (None, None)

        if fetch_err:
            reasons.append(f"Fetch non riuscito: {fetch_err}")
        if not upstream:
            reasons.append("Il branch non ha un upstream configurato.")
        elif not fetch_err:
            if not ahead and not behind and not entries:
                reasons.append("Locale e remoto coincidono e non ci sono modifiche: niente da forzare.")
        
    files = [_entry_file(e) for e in entries]
            lost = await _try(path, "log", "--format=%h %s (%an)", "@{u}..HEAD") or ""
            output = (
                f"# Il branch locale verrà portato esattamente a {upstream}\n"
                f"# Commit locali non remoti ({ahead or 0}):\n{lost}\n\n"
                f"# Modifiche locali:\n"
                + "\n".join(f"{e['xy']} {e['path']}" for e in entries)
            )

        warnings.append(
            "Operazione distruttiva: il branch locale verrà sovrascritto con quello remoto."
        )
        warnings.append(
            "Rete di sicurezza: prima del reset viene creato un branch backup/force-pull-<data> "
            "sul HEAD attuale e le modifiche locali (file non tracciati inclusi) vanno in uno stash."
        )
        summary = (
            f"`git reset --hard {upstream or '@{u}'}` su {branch or 'HEAD detached'}: "
            f"{ahead or 0} commit locali e {len(entries)} file modificati verranno messi da parte."
        )

    safe = not reasons
    fingerprint = await _fingerprint(path, action)
    phrase = _phrase(action, project)
    preview_id = secrets.token_urlsafe(24)
    return {
        "_internal": {
            "fingerprint": fingerprint,
            "message": msg,
            "phrase": phrase,
            "safe": safe,
            "block_reason": " ".join(reasons) or None,
        },
        "public": {
            "preview_id": preview_id,
            "project": project,
            "action": action,
            "summary": summary,
            "warnings": warnings,
            "files": files[:500],
            "output": _cap(output, OUTPUT_MAX_CHARS),
            "safe": safe,
            "block_reason": " ".join(reasons) or None,
            "confirmation_phrase": phrase,
            "expires_in": PREVIEW_TTL,
        },
    }


# --------------------------------------------------------------------------
# ESECUZIONE
# -----------------------------------------------------
---------------------
def _tail(text: str, n: int = 600) -> str:
    text = _scrub((text or "").strip())
    return text[-n:]


async def _exec_commit(path: str, msg: str) -> str:
    await _ok(path, "add", "-A", timeout=60)
    rc, out, err = await _run(path, "commit", "-m", msg, timeout=120)
    if rc != 0:
        raise HTTPException(status_code=409, detail=_tail(err or out) or "Commit fallito.")
    return f"Commit creato: {_short(await _head(path))} · {msg}"


async def _exec_push(path: str) -> str:
    branch = await _branch(path)
    if not branch:
        raise HTTPException(status_code=409, detail="HEAD è detached.")
    remote = await _try(path, "config", "--get", f"branch.{branch}.remote")
    merge = await _try(path, "config", "--get", f"branch.{branch}.merge")
    if not remote or not merge:
        raise HTTPException(status_code=409, detail="Upstream non configurato.")
    # Refspec esplicito: indipendente da push.default. Mai --force.
    rc, out, err = await _run(path, "push", remote, f"HEAD:{merge}", timeout=120)
    if rc != 0:
        raise HTTPException(status_code=409, detail=_tail(err or out) or "Push fallito.")
    return "Push completato.\n" + _tail(err or out)


async def _exec_pull(path: str) -> str:
    rc, out, err = await _run(path, "merge", "--ff-only", "@{u}", timeout=60)
    if rc != 0:
        raise HTTPException(status_code=409, detail=_tail(err or out) or "Pull fallito.")
    return f"Pull completato. HEAD: {_short(await _head(path))}"


async def _exec_force_pull(path: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    notes = []

    if await _head(path):
        backup = f"backup/force-pull-{stamp}"
        await _ok(path, "branch", backup, "HEAD")
        notes.append(f"backup branch: {backup}")

    if await _porcelain(path):
        await _ok(
            path, "stash", "push", "--include-untracked", "-m", f"git-admin force_pull {stamp}",
            timeout=60,
        )
        notes.append(f"stash: «git
-admin force_pull {stamp}»")

    await _ok(path, "reset", "--hard", "@{u}", timeout=60)
    return (
        f"Pull forzato completato. HEAD: {_short(await _head(path))}"
        + (f"\nRecupero: {' · '.join(notes)}" if notes else "")
    )


# --------------------------------------------------------------------------
# ROUTER
# --------------------------------------------------------------------------
class PreviewRequest(BaseModel):
    project: str
    action: str
    message: str | None = None


class ExecuteRequest(BaseModel):
    project: str
    action: str
    message: str | None = None
    confirmation_phrase: str
    preview_id: str


def build_git_admin_router(verify_admin_token: Callable[[str | None], str]) -> APIRouter:
    router = APIRouter(prefix="/api/git/admin", tags=["git-admin"])

    @router.get("/status")
    async def git_admin_status(project: str, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        path = _repo_path(project)
        async with _lock(project):
            return await _status_payload(path, project)

    @router.get("/diff")
    async def git_admin_diff(
        project: str, scope: str = "working", authorization: str | None = Header(None)
    ):
        verify_admin_token(authorization)
        if scope not in SCOPES:
            raise HTTPException(status_code=400, detail=f"Scope non valido: {scope}")
        path = _repo_path(project)
        async with _lock(project):
            return await _diff_payload(path, project, scope)

    @router.post("/preview")
    async def git_admin_preview(req: PreviewRequest, authorization: str | None = Header(None)):
        email = verify_admin_token(authorization)
        if req.action not in ACTIONS:
            raise HTTPException(status_code=400, detail=f"Azione non valida: {req.action}")
        path = _repo_path(req.project)

        async with _lock(req.project):
            built = await _build_preview(req.project, path, req.action, req.me
ssage)

        _gc_previews()
        pub, internal = built["public"], built["_internal"]
        _PREVIEWS[pub["preview_id"]] = {
            "email": email,
            "project": req.project,
            "action": req.action,
            "expires": time.time() + PREVIEW_TTL,
            **internal,
        }
        _audit(email, req.project, req.action, True, f"preview safe={internal['safe']}")
        return pub

    @router.post("/execute")
    async def git_admin_execute(req: ExecuteRequest, authorization: str | None = Header(None)):
        email = verify_admin_token(authorization)

        if req.action not in ACTIONS:
            raise HTTPException(status_code=400, detail=f"Azione non valida: {req.action}")
        if not _flag("GIT_ADMIN_ALLOW_WRITE"):
            raise HTTPException(
                status_code=403,
                detail="Esecuzione disabilitata sul server: imposta GIT_ADMIN_ALLOW_WRITE=1 in gateway.env.",
            )
        if req.action == "force_pull" and not _flag("GIT_ADMIN_ALLOW_FORCE"):
            raise HTTPException(
                status_code=403,
                detail="Pull forzato disabilitato: imposta GIT_ADMIN_ALLOW_FORCE=1 in gateway.env.",
            )

        path = _repo_path(req.project)

        async with _lock(req.project):
            _gc_previews()
            pv = _PREVIEWS.get(req.preview_id)

            if not pv:
                raise HTTPException(status_code=409, detail="Anteprima scaduta o inesistente: rigenerala.")
            if (pv["email"], pv["project"], pv["action"]) != (email, req.project, req.action):
                raise HTTPException(status_code=409, detail="L'anteprima non corrisponde a questa richiesta.")

            msg = _clean_message(req.message) if req.action == "commit" else None
            if msg != pv["message"]:
                raise HTTPException(status_code=409, detail="Il messaggio è cambiato dopo l'anteprima: rigenerala.")
            if not pv["safe"]:
               
 raise HTTPException(status_code=409, detail=pv["block_reason"] or "Operazione bloccata.")
            if not secrets.compare_digest(req.confirmation_phrase.strip(), pv["phrase"]):
                raise HTTPException(status_code=400, detail=f"Frase di conferma errata: scrivi {pv['phrase']}")

            # pull / force_pull: riallinea il remoto e poi verifica che sia
            # ancora identico a quello mostrato in anteprima.
            if req.action in ("pull", "force_pull"):
                err = await _fetch(path, req.project, force=True)
                if err:
                    raise HTTPException(status_code=502, detail=f"Fetch non riuscito: {err}")

            if await _fingerprint(path, req.action) != pv["fingerprint"]:
                raise HTTPException(
                    status_code=409,
                    detail="Il repository è cambiato dopo l'anteprima: rigenerala.",
                )

            _PREVIEWS.pop(req.preview_id, None)  # monouso

            try:
                if req.action == "commit":
                    message = await _exec_commit(path, msg or "")
                elif req.action == "push":
                    message = await _exec_push(path)
                elif req.action == "pull":
                    message = await _exec_pull(path)
                else:
                    message = await _exec_force_pull(path)
            except HTTPException as e:
                _audit(email, req.project, req.action, False, str(e.detail))
                raise

        _FETCH_CACHE.pop(req.project, None)
        _audit(email, req.project, req.action, True, message)
        return {"ok": True, "message": message}

    return router
