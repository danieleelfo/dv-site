"""
git_admin_branches.py — Git Admin: operazioni su branch (rebase, promote).

Nuovi endpoint (stessa auth admin e stessi principi di sicurezza di git_admin.py):
    GET  /api/git/admin/branches?project=
    GET  /api/git/admin/branchdiff?project=&base=main
    POST /api/git/admin/branch-preview  {project, action: rebase|promote}
    POST /api/git/admin/branch-execute  {project, action, confirmation_phrase, preview_id}

  - rebase:  "git pull --rebase" del branch corrente. Se compaiono conflitti
    si fa automaticamente "git rebase --abort" per lasciare il repo pulito.
  - promote: porta il branch corrente dentro main (checkout main, pull
    --ff-only, merge --no-ff, push origin main) e torna sul branch di partenza.

Tutto passa da preview monouso con frase di conferma e fingerprint: se il
repo cambia dopo l'anteprima, l'esecuzione viene rifiutata.
Per attivarlo: in gateway.py aggiungere
    from git_admin_branches import build_git_admin_branches_router
    app.include_router(build_git_admin_branches_router(verify_admin_token))
"""

import hashlib
import re
import secrets
import time

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from git_admin import (
    OUTPUT_MAX_CHARS,
    _audit, _branch, _cap, _files, _fetch, _flag, _head, _is_conflict,
    _lock, _ok, _phrase, _porcelain, _repo_path, _run, _scrub, _try, _upstream,
)

BRANCH_PREVIEW_TTL = 300
BRANCH_DIFF_MAX_CHARS = 200_000
_MAIN_CANDIDATES = ("main", "master")
_BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]+$")

BRANCH_ACTIONS = ("rebase", "promote")
_BRANCH_PREVIEWS: dict[str, dict] = {}


def _kid(action: str) -> str:
    """Spiegazione step by step."""
    return {
        "rebase": (
            "Rebase = rimetti i tuoi cambi in cima a tutto: prima scendono le modifiche degli altri, e i tuoi si aggiungono sopra."
        ),
        "promote": (
            "Promuovi = porta tutte le modifiche del tuo branch dentro l'app principale (main): da quel momento il sito di tutti usa anche i tuoi cambi."
        ),
    }.get(action, "")


def _clean_ref(ref: str) -> str:
    r = (ref or "").strip().strip("/")
    if not r or not _BRANCH_RE.match(r) or "\x00" in r or ".." in r:
        raise HTTPException(status_code=400, detail=f"Nome di branch non valido: {ref}")
    return r


async def _count(path: str, rng: str) -> int | None:
    out = await _try(path, "rev-list", "--count", rng)
    return int(out) if out and out.isdigit() else None


async def _main_branch(path: str) -> str | None:
    for candidate in _MAIN_CANDIDATES:
        if await _try(path, "rev-parse", "--verify", "--quiet", candidate):
            return candidate
    return None


async def _fingerprint(path: str) -> str:
    head = await _head(path) or ""
    entries = await _porcelain(path)
    status = "|".join(f"{e['xy']}:{e['path']}" for e in entries)
    return hashlib.sha256(f"{head}#{status}".encode()).hexdigest()


async def _build_branch_preview(project: str, path: str, action: str) -> dict:
    reasons: list[str] = []
    warnings: list[str] = []
    files: list[dict] = []
    output = ""
    summary = ""
    branch = await _branch(path)
    entries = await _porcelain(path)
    conflicts = [e["path"] for e in entries if _is_conflict(e["xy"])]
    upstream = await _upstream(path)
    main = await _main_branch(path)

    if action == "rebase":
        if branch is None:
            reasons.append("HEAD e detached: non c'e un branch da ribasare.")
        if not upstream:
            reasons.append("Il branch non ha un upstream configurato.")
        if entries:
            reasons.append("Modifiche non committate: committale o mettile in stash prima del rebase.")
        if conflicts:
            reasons.append("Conflitti non risolti: " + ", ".join(conflicts[:10]))
        if not reasons:
            behind = await _count(path, "HEAD..@{u}")
            if not behind:
                reasons.append("Gia aggiornato: nessun commit remoto da ribasare.")
            else:
                output = await _try(path, "log", "--format=%h %s (%an)", "HEAD..@{u}") or ""
                files = await _files(path, ["HEAD...@{u}"])
                summary = (
                    f"Rebase di {branch} su {upstream}: i tuoi {behind} commit locali si riposizionano"
                    f"sopra i commit appena arrivati dal remoto."
                )
                warnings.append(
                    "Se compaiono conflitti eseguiamo automaticamente git rebase --abort: il repo torna esattamente com'era."
                )
    else:  # promote
        if branch is None:
            reasons.append("HEAD e detached: non c'e un branch da promuovere.")
        elif main is None:
            reasons.append("Ne main ne master esistono nel repository.")
        elif branch in _MAIN_CANDIDATES:
            reasons.append("Sei gia su main: niente da promuovere.")
        if entries:
            reasons.append("Modifiche non committate: committale o mettile in stash prima della promozione.")
        if conflicts:
            reasons.append("Conflitti non risolti: " + ", ".join(conflicts[:10]))
        if not reasons and main and branch:
            main_only = await _count(path, f"HEAD..{main}")
            if main_only:
                warnings.append(
                    f"In {main} ci sono {main_only} commit assenti in {branch}: il merge li"
                    f"portera anche nel tuo branch (senza perdere nulla)."
                )
            commits = (await _try(path, "log", "--format=%h %s (%an)", f"{main}..HEAD") or "").splitlines()
            output = "\n".join(commits)
            if not commits:
                reasons.append(f"Il branch {branch} non ha commit nuovi rispetto a {main}.")
            files = await _files(path, [f"{main}...HEAD"])
            summary = (
                f"Verranno portati in {main} i {len(commits)} commit di {branch} (merge --no-ff)"
                f"e poi fatto push su origin. Alla fine tornerai sul branch {branch}."
            )
            if not (await _upstream(path)):
                warnings.append(f"Il branch {branch} non e pushato: il merge usera i commit presenti in locale.")

    safe = not reasons
    return {
        "summary": summary,
        "child_explainer": _kid(action),
        "warnings": warnings,
        "files": files[:500],
        "output": _cap(output, OUTPUT_MAX_CHARS),
        "safe": safe,
        "block_reason": " ".join(reasons) or None,
        "confirmation_phrase": _phrase(action, project),
        "expires_in": BRANCH_PREVIEW_TTL,
        "_internal": {
            "fingerprint": await _fingerprint(path),
            "safe": safe,
            "block_reason": " ".join(reasons) or None,
        },
    }


async def _abort_merge_quietly(path: str) -> None:
    await _run(path, "rebase", "--abort", timeout=60)
    await _run(path, "merge", "--abort", timeout=30)


async def _exec_rebase(path: str) -> str:
    rc, out, err = await _run(path, "pull", "--rebase", timeout=120)
    if rc != 0:
        await _abort_merge_quietly(path)
        detail = _scrub((err or out).strip()) or "Rebase fallito."
        raise HTTPException(
            status_code=409,
            detail=detail + "\nComparsi conflitti: rebase annullato, il repo e tornato com'era."
        )
    return f"Rebase completato. HEAD: {(await _head(path) or '')[:8]}"


async def _exec_promote(path: str) -> str:
    start = await _branch(path)
    if not start or start in _MAIN_CANDIDATES:
        raise HTTPException(status_code=409, detail="Branch di partenza non valido per la promozione.")
    main = await _main_branch(path)
    if not main:
        raise HTTPException(status_code=409, detail="Nessun branch main/master trovato.")
    notes: list[str] = []
    try:
        await _ok(path, "checkout", main, timeout=60)
        notes.append(f"checkout {main}")
        rc, out, err = await _run(path, "pull", "--ff-only", timeout=120)
        if rc != 0:
            raise HTTPException(status_code=409, detail=_scrub((err or out).strip()) or "Pull su main fallito.")
        rc, out, err = await _run(
            path, "merge", "--no-ff", "-m", f"Merge branch '{start}' into {main}", start, timeout=120
        )
        if rc != 0:
            raise HTTPException(status_code=409, detail=_scrub((err or out).strip()) or "Merge fallito.")
        notes.append(f"merge {start}")
        rc, out, err = await _run(path, "push", "origin", main, timeout=120)
        if rc != 0:
            raise HTTPException(status_code=409, detail=_scrub((err or out).strip()) or "Push di main fallito.")
        notes.append("push origin " + main)
    except HTTPException:
        # Torna com'era: se il merge e incompleto, abort; poi checkout iniziale.
        await _abort_merge_quietly(path)
        if (await _branch(path)) != start:
            await _run(path, "checkout", start, timeout=60)
        raise
    await _ok(path, "checkout", start, timeout=60)
    notes.append(f"checkout {start}")
    return f"Promozione completata: {start} e dentro {main} ({', '.join(notes)})."


def build_git_admin_branches_router(verify_admin_token) -> APIRouter:
    router = APIRouter(prefix="/api/git/admin", tags=["git-admin-branches"])

    @router.get("/branches")
    async def git_admin_branches(project: str, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        path = _repo_path(project)
        async with _lock(project):
            current = await _branch(path)
            raw = await _ok(
                path,
                "for-each-ref",
                "--format=%(refname:short)\x1f%(objectname:short)\x1f%(upstream:short)\x1f%(upstream:track)",
                "refs/heads",
            )
            main = await _main_branch(path)
        branches = []
        for line in raw.splitlines():
            if not line.strip():
                continue
            name, sha, upstream, track = (line.split("\x1f") + ["", "", "", ""])[:4]
            ahead = behind = None
            m = re.search(r"ahead (\d+)", track or "")
            if m:
                ahead = int(m.group(1))
            m = re.search(r"behind (\d+)", track or "")
            if m:
                behind = int(m.group(1))
            branches.append({
                "name": name,
                "sha": sha,
                "upstream": upstream or None,
                "ahead": ahead,
                "behind": behind,
                "current": name == current,
                "is_main": name in _MAIN_CANDIDATES,
            })
        return {"project": project, "current": current, "main": main, "branches": branches}

    @router.get("/branchdiff")
    async def git_admin_branchdiff(
        project: str, base: str = "main", authorization: str | None = Header(None)
    ):
        verify_admin_token(authorization)
        base = _clean_ref(base)
        path = _repo_path(project)
        async with _lock(project):
            if not await _try(path, "rev-parse", "--verify", "--quiet", base):
                raise HTTPException(status_code=404, detail=f"Branch base non trovato: {base}")
            await _fetch(path, project)
            commits = (await _try(path, "log", "--format=%h %s (%an)", f"{base}..HEAD") or "").splitlines()
            files = await _files(path, [f"{base}...HEAD"])
            _, patch, _ = await _run(path, "diff", "--no-renames", f"{base}...HEAD")
        header = f"# Diff da {base}: {len(commits)} commit\n" + "\n".join(f"#   {c}" for c in commits) + "\n\n"
        text = header + patch
        return {
            "project": project,
            "base": base,
            "commits": commits,
            "summary": f"{len(commits)} commit · {len(files)} file rispetto a {base}",
            "files": files,
            "diff": _cap(text, BRANCH_DIFF_MAX_CHARS),
            "truncated": len(text) > BRANCH_DIFF_MAX_CHARS,
        }

    class BranchPreviewRequest(BaseModel):
        project: str
        action: str

    @router.post("/branch-preview")
    async def git_admin_branch_preview(req: BranchPreviewRequest, authorization: str | None = Header(None)):
        email = verify_admin_token(authorization)
        if req.action not in BRANCH_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Azione non valida: {req.action}")
        path = _repo_path(req.project)
        async with _lock(req.project):
            preview = await _build_branch_preview(req.project, path, req.action)

        now = time.time()
        for pid in [k for k, v in _BRANCH_PREVIEWS.items() if v["expires"] < now]:
            _BRANCH_PREVIEWS.pop(pid, None)
        pid = secrets.token_urlsafe(24)
        _BRANCH_PREVIEWS[pid] = {
            "email": email,
            "project": req.project,
            "action": req.action,
            "expires": now + BRANCH_PREVIEW_TTL,
            **preview["_internal"],
        }
        _audit(email, req.project, req.action, True, f"branch-preview safe={preview['safe']}")
        return {k: v for k, v in preview.items() if k != "_internal" and k != "preview_id"} | {"preview_id": pid}

    class BranchExecuteRequest(BaseModel):
        project: str
        action: str
        confirmation_phrase: str
        preview_id: str

    @router.post("/branch-execute")
    async def git_admin_branch_execute(req: BranchExecuteRequest, authorization: str | None = Header(None)):
        email = verify_admin_token(authorization)
        if req.action not in BRANCH_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Azione non valida: {req.action}")
        if not _flag("GIT_ADMIN_ALLOW_WRITE"):
            raise HTTPException(
                status_code=403,
                detail="Esecuzione disabilitata: imposta GIT_ADMIN_ALLOW_WRITE=1 in gateway.env."
            )
        path = _repo_path(req.project)
        async with _lock(req.project):
            now = time.time()
            for pid in [k for k, v in _BRANCH_PREVIEWS.items() if v["expires"] < now]:
                _BRANCH_PREVIEWS.pop(pid, None)
            pv = _BRANCH_PREVIEWS.get(req.preview_id)
            if not pv:
                raise HTTPException(status_code=409, detail="Anteprima scaduta o inesistente: rigenerala.")
            if (pv["email"], pv["project"], pv["action"]) != (email, req.project, req.action):
                raise HTTPException(status_code=409, detail="L'anteprima non corrisponde a questa richiesta.")
            if not pv["safe"]:
                raise HTTPException(status_code=409, detail=pv["block_reason"] or "Operazione bloccata.")
            if not secrets.compare_digest(req.confirmation_phrase.strip(), pv["phrase"]):
                raise HTTPException(status_code=400, detail=f"Frase di conferma errata: scrivi {pv['phrase']}")
            if await _fingerprint(path) != pv["fingerprint"]:
                raise HTTPException(status_code=409, detail="Il repository e cambiato dopo l'anteprima: rigenerala.")
            _BRANCH_PREVIEWS.pop(req.preview_id, None)
            try:
                message = await _exec_rebase(path) if req.action == "rebase" else await _exec_promote(path)
            except HTTPException as e:
                _audit(email, req.project, req.action, False, str(e.detail))
                raise
        _audit(email, req.project, req.action, True, message)
        return {"ok": True, "message": message}

    return router
