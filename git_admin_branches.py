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

import asyncio
import hashlib
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from git_admin import (
    FETCH_TIMEOUT, OUTPUT_MAX_CHARS,
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
    if not r or r.startswith("-") or not _BRANCH_RE.match(r) or "\x00" in r or ".." in r:
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


async def _fingerprint(path: str, extra: str = "") -> str:
    head = await _head(path) or ""
    entries = await _porcelain(path)
    status = "|".join(f"{e['xy']}:{e['path']}" for e in entries)
    return hashlib.sha256(f"{head}#{status}#{extra}".encode()).hexdigest()


def _target_label(target: str) -> str:
    m = re.match(r"^origin/pr/(\d+)$", target)
    if m:
        return f"pull request #{m.group(1)}"
    return f"branch '{target.removeprefix('origin/')}'"


async def _refresh_target(path: str, target: str) -> str | None:
    """Aggiorna dal remoto il riferimento scelto. Ritorna un avviso se fallisce."""
    cmds = [("fetch", "--quiet", "origin")]
    m = re.match(r"^origin/pr/(\d+)$", target)
    if m:
        n = m.group(1)
        cmds.append(("fetch", "--quiet", "origin", f"+refs/pull/{n}/head:refs/remotes/origin/pr/{n}"))
    for args in cmds:
        try:
            rc, out, err = await _run(path, *args, timeout=FETCH_TIMEOUT)
        except HTTPException as e:
            return str(e.detail)
        if rc != 0:
            return _scrub((err or out).strip()) or "git fetch fallito."
    return None


async def _build_target_promote_preview(project: str, path: str, target: str) -> dict:
    """Anteprima di 'unisci <target> in main' senza spostarti dal tuo branch."""
    reasons: list[str] = []
    warnings: list[str] = []
    files: list[dict] = []
    output = ""
    summary = ""
    branch = await _branch(path)
    entries = await _porcelain(path)
    tracked = [e for e in entries if e["xy"] != "??"]
    untracked = [e["path"] for e in entries if e["xy"] == "??"]
    conflicts = [e["path"] for e in tracked if _is_conflict(e["xy"])]
    main = await _main_branch(path)

    warn = await _refresh_target(path, target)
    if warn:
        warnings.append("Aggiornamento dal remoto non riuscito: " + warn)
    target_sha = await _try(path, "rev-parse", "--verify", "--quiet", target + "^{commit}")

    if branch is None:
        reasons.append("HEAD e detached: passa prima su un branch.")
    if not main:
        reasons.append("Ne main ne master esistono nel repository.")
    elif not target_sha:
        reasons.append(f"Riferimento non trovato: {target}")
    elif target in _MAIN_CANDIDATES or target.removeprefix("origin/") in _MAIN_CANDIDATES:
        reasons.append("Non puoi unire main dentro se stesso.")
    if tracked:
        reasons.append("Modifiche non committate: committale o mettile in stash prima della promozione.")
    if conflicts:
        reasons.append("Conflitti non risolti: " + ", ".join(conflicts[:10]))
    if untracked:
        warnings.append(
            f"{len(untracked)} file non tracciati ({', '.join(untracked[:5])}): non vengono toccati; "
            "se il merge dovesse sovrascriverli, git annulla tutto."
        )

    if not reasons and main and target_sha:
        base = "origin/" + main
        if not await _try(path, "rev-parse", "--verify", "--quiet", base):
            base = main
        if base != main:
            ahead = await _count(path, f"{base}..{main}") or 0
            behind = await _count(path, f"{main}..{base}") or 0
            if ahead and behind:
                reasons.append(
                    f"{main} locale e {base} sono divergenti ({ahead} commit locali, {behind} remoti): "
                    "allineali prima di promuovere."
                )
            elif ahead:
                warnings.append(f"{main} ha {ahead} commit non pushati: verranno pushati insieme al merge.")
        commits = (await _try(path, "log", "--format=%h %s (%an)", f"{base}..{target}") or "").splitlines()
        output = "\n".join(commits)
        files = await _files(path, [f"{base}...{target}"])
        if not commits:
            reasons.append(f"{target} non ha commit nuovi rispetto a {base}: niente da unire.")
        else:
            rc, out, err = await _run(path, "merge-tree", "--write-tree", "--name-only", base, target)
            if rc == 1:
                names: list[str] = []
                for line in out.splitlines()[1:]:
                    if not line.strip():
                        break
                    names.append(line.strip())
                reasons.append("Il merge andrebbe in conflitto su: " + (", ".join(names[:10]) or "(file non indicati)"))
            elif rc != 0:
                warnings.append(
                    "Controllo preventivo dei conflitti non disponibile (git troppo vecchio): "
                    "se il merge va in conflitto viene annullato."
                )
            summary = (
                f"Verranno portati in {main} i {len(commits)} commit di {_target_label(target)} "
                f"(merge --no-ff) e poi fatto push su origin. Resterai su {branch}."
            )
        if main and branch and branch != main:
            warnings.append(f"In background: checkout {main}, merge, push, poi torni su {branch}.")

    safe = not reasons
    phrase = _phrase("promote", project)
    return {
        "summary": summary or f"Promozione di {target} in {main or 'main'}.",
        "child_explainer": _kid("promote"),
        "warnings": warnings,
        "files": files[:500],
        "output": _cap(output, OUTPUT_MAX_CHARS),
        "safe": safe,
        "block_reason": " ".join(reasons) or None,
        "confirmation_phrase": phrase,
        "expires_in": BRANCH_PREVIEW_TTL,
        "target": target,
        "_internal": {
            "fingerprint": await _fingerprint(path, target_sha or ""),
            "safe": safe,
            "block_reason": " ".join(reasons) or None,
            "phrase": phrase,
            "target": target,
            "target_sha": target_sha,
        },
    }


async def _build_branch_preview(project: str, path: str, action: str, target: str | None = None) -> dict:
    if action == "promote" and target:
        return await _build_target_promote_preview(project, path, target)
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
                    f"Rebase di {branch} su {upstream}: i tuoi {behind} commit locali si riposizionano "
                    f"sopra i commit appena arrivati dal remoto."
                )
                warnings.append(
                    "Se compaiono conflitti eseguiamo automaticamente git rebase --abort: "
                    "il repo torna esattamente com'era."
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
    phrase = _phrase(action, project)
    return {
        "summary": summary,
        "child_explainer": _kid(action),
        "warnings": warnings,
        "files": files[:500],
        "output": _cap(output, OUTPUT_MAX_CHARS),
        "safe": safe,
        "block_reason": " ".join(reasons) or None,
        "confirmation_phrase": phrase,
        "expires_in": BRANCH_PREVIEW_TTL,
        "_internal": {
            "fingerprint": await _fingerprint(path),
            "safe": safe,
            "block_reason": " ".join(reasons) or None,
            "phrase": phrase,
            "target": None,
            "target_sha": None,
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


async def _exec_promote(path: str, target: str | None = None, target_sha: str | None = None) -> str:
    start = await _branch(path)
    main = await _main_branch(path)
    if not main:
        raise HTTPException(status_code=409, detail="Nessun branch main/master trovato.")
    if target:
        if not start:
            raise HTTPException(status_code=409, detail="HEAD e detached: passa prima su un branch.")
        current = await _try(path, "rev-parse", "--verify", "--quiet", target + "^{commit}")
        if not current or (target_sha and current != target_sha):
            raise HTTPException(status_code=409, detail=f"{target} e cambiato dopo l'anteprima: rigenerala.")
        merge_ref, label = target, _target_label(target)
    else:
        if not start or start in _MAIN_CANDIDATES:
            raise HTTPException(status_code=409, detail="Branch di partenza non valido per la promozione.")
        merge_ref, label = start, f"branch '{start}'"
    notes: list[str] = []
    before: str | None = None
    try:
        if start != main:
            await _ok(path, "checkout", main, timeout=60)
            notes.append(f"checkout {main}")
        rc, out, err = await _run(path, "pull", "--ff-only", timeout=120)
        if rc != 0:
            raise HTTPException(status_code=409, detail=_scrub((err or out).strip()) or "Pull su main fallito.")
        before = await _head(path)
        rc, out, err = await _run(
            path, "merge", "--no-ff", "-m", f"Merge {label} into {main}", merge_ref, timeout=120
        )
        if rc != 0:
            raise HTTPException(status_code=409, detail=_scrub((err or out).strip()) or "Merge fallito.")
        notes.append(f"merge {label}")
        rc, out, err = await _run(path, "push", "origin", main, timeout=120)
        if rc != 0:
            if before:
                await _run(path, "reset", "--hard", before, timeout=60)
            raise HTTPException(
                status_code=409,
                detail=(_scrub((err or out).strip()) or "Push di main fallito.")
                + "\nPush rifiutato: il merge locale e stato annullato.",
            )
        notes.append("push origin " + main)
    except HTTPException:
        await _abort_merge_quietly(path)
        if start and (await _branch(path)) != start:
            await _run(path, "checkout", start, timeout=60)
        raise
    if start and start != main:
        await _ok(path, "checkout", start, timeout=60)
        notes.append(f"checkout {start}")
    return f"Promozione completata: {label} e dentro {main} ({', '.join(notes)})."


# --------------------------------------------------------------------------
# PULL REQUEST + BRANCH REMOTI (sola lettura)
# --------------------------------------------------------------------------
_GH_REMOTE_RE = re.compile(r"github\.com[:/]([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+?)(?:\.git)?/?$")
_PR_REF_RE = re.compile(r"^origin/pr/\d+$")
PR_MAX = 100
PR_API_TTL = 60
_PR_API_CACHE: dict[str, tuple[float, dict | None, str | None]] = {}


async def _base_ref(path: str) -> str | None:
    """Branch principale di riferimento: preferisce quello remoto (aggiornato)."""
    for cand in ("origin/main", "origin/master", "main", "master"):
        if await _try(path, "rev-parse", "--verify", "--quiet", cand):
            return cand
    return None


def _github_pulls(owner: str, repo: str) -> list[dict]:
    """Elenco PR dall'API GitHub. Il token (opzionale) serve per i repo privati."""
    url = (
        f"https://api.github.com/repos/{owner}/{repo}/pulls"
        f"?state=all&per_page={PR_MAX}&sort=updated&direction=desc"
    )
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "dv-git-admin",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = (os.environ.get("GIT_ADMIN_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = "Bearer " + token
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def _api_prs(project: str, path: str) -> tuple[dict | None, str | None]:
    """Ritorna ({numero: dati PR}, errore). In cache per PR_API_TTL secondi."""
    cached = _PR_API_CACHE.get(project)
    if cached and time.time() - cached[0] < PR_API_TTL:
        return cached[1], cached[2]
    remote = await _try(path, "remote", "get-url", "origin") or ""
    m = _GH_REMOTE_RE.search(remote.strip())
    data: dict | None = None
    error: str | None = None
    if not m:
        error = "Remote origin non riconosciuto come repository GitHub."
    else:
        try:
            raw = await asyncio.to_thread(_github_pulls, m.group(1), m.group(2))
            data = {int(pr["number"]): pr for pr in raw}
        except urllib.error.HTTPError as e:
            error = f"API GitHub: HTTP {e.code}" + (
                " (repo privato? imposta GIT_ADMIN_GITHUB_TOKEN in gateway.env)" if e.code in (401, 403, 404) else ""
            )
        except Exception as e:  # rete, timeout, JSON
            error = "API GitHub non raggiungibile: " + type(e).__name__
    _PR_API_CACHE[project] = (time.time(), data, error)
    return data, error


async def _list_prs(project: str, path: str) -> dict:
    # Scarica le "teste" di tutte le PR (anche chiuse/unite) come origin/pr/<n>.
    # Usa lo stesso accesso SSH del remote: non serve nessun token per questo.
    fetch_error = None
    try:
        rc, out, err = await _run(
            path, "fetch", "--quiet", "--prune", "origin",
            "+refs/pull/*/head:refs/remotes/origin/pr/*", timeout=FETCH_TIMEOUT * 2,
        )
        if rc != 0:
            fetch_error = _scrub((err or out).strip()) or "git fetch delle PR fallito."
    except HTTPException as e:
        fetch_error = str(e.detail)

    raw = await _try(
        path, "for-each-ref",
        "--format=%(refname:lstrip=4)\x1f%(objectname:short)\x1f%(contents:subject)\x1f%(authorname)\x1f%(committerdate:iso-strict)",
        "refs/remotes/origin/pr/",
    ) or ""
    base = await _base_ref(path)
    api, api_error = await _api_prs(project, path)

    prs = []
    for line in raw.splitlines():
        num, sha, subject, author, date = (line.split("\x1f") + [""] * 5)[:5]
        if not num.isdigit():
            continue
        n = int(num)
        info = (api or {}).get(n)
        if info:
            if info.get("merged_at"):
                state = "merged"
            else:
                state = info.get("state") or "unknown"  # open | closed
            title = info.get("title") or subject
            author = (info.get("user") or {}).get("login") or author
            branch = (info.get("head") or {}).get("ref")
            url = info.get("html_url")
            draft = bool(info.get("draft"))
        else:
            state, title, branch, url, draft = "unknown", subject, None, None, False
            if base:
                rc, _, _ = await _run(path, "merge-base", "--is-ancestor", sha, base)
                if rc == 0:
                    state = "merged"
        prs.append({
            "number": n, "title": title, "state": state, "draft": draft,
            "author": author, "branch": branch, "sha": sha, "date": date,
            "ref": f"origin/pr/{n}", "url": url,
        })
    prs.sort(key=lambda x: x["number"], reverse=True)
    return {
        "project": project,
        "base": base,
        "source": "github" if api else "git",
        "prs": prs[:PR_MAX],
        "fetch_error": fetch_error,
        "api_error": None if api else api_error,
    }


def build_git_admin_branches_router(verify_admin_token) -> APIRouter:
    router = APIRouter(prefix="/api/git/admin", tags=["git-admin-branches"])

    @router.get("/branches")
    async def git_admin_branches(project: str, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        path = _repo_path(project)
        async with _lock(project):
            fetch_error = None
            try:
                rc, out, err = await _run(path, "fetch", "--quiet", "--prune", timeout=FETCH_TIMEOUT)
                if rc != 0:
                    fetch_error = _scrub((err or out).strip()) or "git fetch fallito."
            except HTTPException as e:
                fetch_error = str(e.detail)
            current = await _branch(path)
            raw = await _ok(
                path,
                "for-each-ref",
                "--format=%(refname)\x1f%(refname:short)\x1f%(objectname:short)\x1f%(upstream:short)\x1f%(upstream:track)",
                "refs/heads", "refs/remotes/origin",
            )
            main = await _main_branch(path)
            base = await _base_ref(path)
            rows = []
            for line in raw.splitlines():
                if not line.strip():
                    continue
                full, name, sha, upstream, track = (line.split("\x1f") + [""] * 5)[:5]
                if full.endswith("/HEAD") or _PR_REF_RE.match(name):
                    continue
                rows.append((full.startswith("refs/remotes/"), name, sha, upstream, track))
            local_names = {r[1] for r in rows if not r[0]}
            branches = []
            for remote, name, sha, upstream, track in rows:
                if remote and name.split("/", 1)[-1] in local_names:
                    continue  # già mostrato come branch locale (con upstream)
                ahead = behind = None
                m = re.search(r"ahead (\d+)", track or "")
                if m:
                    ahead = int(m.group(1))
                m = re.search(r"behind (\d+)", track or "")
                if m:
                    behind = int(m.group(1))
                ahead_main = behind_main = None
                if base and len(branches) < 60 and name != base and name not in _MAIN_CANDIDATES:
                    ahead_main = await _count(path, f"{base}..{name}")
                    behind_main = await _count(path, f"{name}..{base}")
                branches.append({
                    "name": name,
                    "sha": sha,
                    "upstream": upstream or None,
                    "ahead": ahead,
                    "behind": behind,
                    "ahead_main": ahead_main,
                    "behind_main": behind_main,
                    "current": (not remote) and name == current,
                    "is_main": name in _MAIN_CANDIDATES or name == base,
                    "remote": remote,
                })
        branches.sort(key=lambda b: (b["remote"], not b["is_main"], b["name"]))
        return {
            "project": project, "current": current, "main": main,
            "branches": branches, "fetch_error": fetch_error,
        }

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

    @router.get("/prs")
    async def git_admin_prs(project: str, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        path = _repo_path(project)
        async with _lock(project):
            return await _list_prs(project, path)

    @router.get("/refdiff")
    async def git_admin_refdiff(
        project: str, ref: str, base: str = "", authorization: str | None = Header(None)
    ):
        """Cosa aggiunge `ref` (branch o PR) rispetto a `base` (default: main remoto)."""
        verify_admin_token(authorization)
        ref = _clean_ref(ref)
        path = _repo_path(project)
        async with _lock(project):
            base = _clean_ref(base) if base else await _base_ref(path)
            if not base:
                raise HTTPException(status_code=404, detail="Nessun branch main/master trovato.")
            for r in (ref, base):
                if not await _try(path, "rev-parse", "--verify", "--quiet", r + "^{commit}"):
                    raise HTTPException(status_code=404, detail=f"Riferimento non trovato: {r}")
            commits = (await _try(path, "log", "--format=%h %s (%an)", f"{base}..{ref}") or "").splitlines()
            files = await _files(path, [f"{base}...{ref}"])
            _, patch, _ = await _run(path, "diff", "--no-renames", f"{base}...{ref}")
        header = f"# {ref} rispetto a {base}: {len(commits)} commit\n" + "\n".join(f"#   {c}" for c in commits) + "\n\n"
        text = header + patch
        return {
            "project": project,
            "ref": ref,
            "base": base,
            "commits": commits,
            "summary": f"{len(commits)} commit · {len(files)} file in {ref} rispetto a {base}",
            "files": files,
            "diff": _cap(text, BRANCH_DIFF_MAX_CHARS),
            "truncated": len(text) > BRANCH_DIFF_MAX_CHARS,
        }

    class BranchPreviewRequest(BaseModel):
        project: str
        action: str
        target: str | None = None  # solo per promote: branch/PR da unire in main

    @router.post("/branch-preview")
    async def git_admin_branch_preview(req: BranchPreviewRequest, authorization: str | None = Header(None)):
        email = verify_admin_token(authorization)
        if req.action not in BRANCH_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Azione non valida: {req.action}")
        target = None
        if req.target:
            if req.action != "promote":
                raise HTTPException(status_code=400, detail="target e ammesso solo per promote.")
            target = _clean_ref(req.target)
        path = _repo_path(req.project)
        async with _lock(req.project):
            preview = await _build_branch_preview(req.project, path, req.action, target)

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
        target: str | None = None

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
            if (pv.get("target") or None) != (_clean_ref(req.target) if req.target else None):
                raise HTTPException(status_code=409, detail="L'anteprima non corrisponde al branch/PR richiesto.")
            if not pv["safe"]:
                raise HTTPException(status_code=409, detail=pv["block_reason"] or "Operazione bloccata.")
            if not secrets.compare_digest(req.confirmation_phrase.strip(), pv["phrase"]):
                raise HTTPException(status_code=400, detail=f"Frase di conferma errata: scrivi {pv['phrase']}")
            cur_sha = ""
            if pv.get("target"):
                cur_sha = await _try(path, "rev-parse", "--verify", "--quiet", pv["target"] + "^{commit}") or ""
            if await _fingerprint(path, cur_sha) != pv["fingerprint"]:
                raise HTTPException(status_code=409, detail="Il repository e cambiato dopo l'anteprima: rigenerala.")
            _BRANCH_PREVIEWS.pop(req.preview_id, None)
            try:
                message = (
                    await _exec_rebase(path) if req.action == "rebase"
                    else await _exec_promote(path, pv.get("target"), pv.get("target_sha"))
                )
            except HTTPException as e:
                _audit(email, req.project, req.action, False, str(e.detail))
                raise
        _audit(email, req.project, req.action, True, message)
        return {"ok": True, "message": message}

    return router
