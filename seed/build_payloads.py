"""Shape real `gh` output into the GitHub webhook payloads the triager reads.

The triager is woken by raw provider JSON, so a fixture that is *not* that shape
tests nothing. Every value here is read from the repository; the only thing this
file invents is the envelope GitHub would have put around it.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;]*m")
#: A dependabot PR body is tens of kilobytes of changelog. The triager needs
#: enough to judge, not the whole thing, and an oversized wake message is the
#: fastest way to make a run fail for a reason that has nothing to do with triage.
BODY_CAP = 4000


def clip(text: str | None) -> str:
    text = text or ""
    return text if len(text) <= BODY_CAP else text[:BODY_CAP] + "\n…[truncated]"


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout


def repo_block(repo: str) -> dict:
    d = json.loads(gh("repo", "view", repo, "--json", "id,name,owner,defaultBranchRef"))
    return {
        "id": d["id"],
        "full_name": repo,
        "name": d["name"],
        "owner": {"login": d["owner"]["login"]},
        "default_branch": d["defaultBranchRef"]["name"],
    }


def failing_log(repo: str, run_id: int) -> str:
    """The interesting lines of a failed run, not 4000 lines of runner preamble."""
    try:
        raw = subprocess.run(
            ["gh", "run", "view", str(run_id), "--repo", repo, "--log-failed"],
            capture_output=True, text=True, timeout=120,
        ).stdout
    except subprocess.TimeoutExpired:
        return ""
    keep = []
    for line in ANSI.sub("", raw).splitlines():
        body = line.split("\t")[-1]
        body = re.sub(r"^\d{4}-\d\d-\d\dT[\d:.]+Z\s*", "", body)
        if not body.strip():
            continue
        if any(k in body for k in ("##[error]", "FAILED", "Error:", "error:", "assert",
                                   "Traceback", "%|", "below", "floor", "Total:")):
            keep.append(body.strip())
    return "\n".join(keep[-40:])


def main() -> None:
    repo, n, out = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    rb = repo_block(repo)
    written = 0

    runs = json.loads(gh("run", "list", "--repo", repo, "--status", "failure", "--limit", str(n * 3),
                         "--json", "databaseId,name,displayTitle,headBranch,headSha,conclusion,createdAt,url,event"))
    seen_workflows: set[str] = set()
    for r in runs:
        # One run per workflow: ten identical coverage failures teach the
        # triager nothing the first one didn't.
        if r["name"] in seen_workflows:
            continue
        seen_workflows.add(r["name"])
        payload = {
            "action": "completed",
            "workflow_run": {
                "id": r["databaseId"], "name": r["name"], "head_branch": r["headBranch"],
                "head_sha": r["headSha"], "status": "completed", "conclusion": r["conclusion"],
                "html_url": r["url"], "created_at": r["createdAt"], "event": r["event"],
                "display_title": r["displayTitle"],
            },
            "repository": rb,
            "sender": {"login": "github-actions"},
            "failed_job_log": failing_log(repo, r["databaseId"]),
        }
        (out / f"run_{r['databaseId']}.json").write_text(json.dumps(payload, indent=2))
        written += 1
        if len(seen_workflows) >= n:
            break

    issues = json.loads(gh("issue", "list", "--repo", repo, "--limit", str(n),
                           "--json", "number,title,body,createdAt,url,author,labels,id"))
    for i in issues:
        (out / f"issue_{i['number']}.json").write_text(json.dumps({
            "action": "opened",
            "issue": {
                "id": i["id"], "number": i["number"], "title": i["title"], "body": clip(i["body"]),
                "html_url": i["url"], "created_at": i["createdAt"],
                "user": {"login": i["author"]["login"]},
                "labels": [{"name": l["name"]} for l in i.get("labels", [])],
            },
            "repository": rb,
            "sender": {"login": i["author"]["login"]},
        }, indent=2))
        written += 1

    prs = json.loads(gh("pr", "list", "--repo", repo, "--limit", str(n),
                        "--json", "number,title,body,headRefName,createdAt,url,author,additions,deletions,changedFiles,isDraft,id"))
    for p in prs:
        (out / f"pr_{p['number']}.json").write_text(json.dumps({
            "action": "opened",
            "pull_request": {
                "id": p["id"], "number": p["number"], "title": p["title"], "body": clip(p["body"]),
                "html_url": p["url"], "created_at": p["createdAt"], "draft": p["isDraft"],
                "head": {"ref": p["headRefName"]},
                "base": {"ref": rb["default_branch"]},
                "user": {"login": p["author"]["login"]},
                "additions": p["additions"], "deletions": p["deletions"],
                "changed_files": p["changedFiles"],
            },
            "repository": rb,
            "sender": {"login": p["author"]["login"]},
        }, indent=2))
        written += 1

    print(f"{written} real payloads in {out}")


if __name__ == "__main__":
    main()
