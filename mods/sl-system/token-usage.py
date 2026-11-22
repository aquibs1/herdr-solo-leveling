# Token usage per model per day, from Claude Code's session logs (~/.claude/projects/**/*.jsonl).
# Usage: python3 token-usage.py [days]   -> JSON on stdout:
#   {"days": ["2026-11-01", ...], "models": {"opus-4": {"2026-11-01": {"in":..,"out":..,"cw":..,"cr":..}}}, "files": n}
# in = input tokens, out = output, cw = cache writes, cr = cache reads.
# The sl-system mod runs this here and, as `python3 -c`, on each connected machine.
import json, os, re, sys, time
from datetime import datetime, timedelta

days = int(sys.argv[1]) if len(sys.argv) > 1 else 14
since = time.time() - (days + 1) * 86400
root = os.path.expanduser("~/.claude/projects")
start = (datetime.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
day_list = [(datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days - 1, -1, -1)]

def short(model):
    m = re.sub(r"^claude-", "", model or "")
    m = re.sub(r"-\d{8}$", "", m)          # drop a date suffix
    m = re.sub(r"\[.*\]$", "", m)           # drop [1m] style tags
    return m or "unknown"

models, seen, files = {}, set(), 0
for dirpath, _dirs, names in os.walk(root):
    for n in names:
        if not n.endswith(".jsonl"):
            continue
        path = os.path.join(dirpath, n)
        try:
            if os.path.getmtime(path) < since:
                continue
            files += 1
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if '"usage"' not in line or '"assistant"' not in line:
                        continue
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    msg = e.get("message") or {}
                    u = msg.get("usage")
                    model = msg.get("model")
                    if not u or not model or model == "<synthetic>":
                        continue
                    key = (msg.get("id"), e.get("requestId"))   # streamed replies repeat; count each once
                    if key[0] and key in seen:
                        continue
                    seen.add(key)
                    ts = e.get("timestamp") or ""
                    try:
                        day = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d")
                    except ValueError:
                        continue
                    if day < start:
                        continue
                    d = models.setdefault(short(model), {}).setdefault(day, {"in": 0, "out": 0, "cw": 0, "cr": 0})
                    d["in"] += u.get("input_tokens", 0) or 0
                    d["out"] += u.get("output_tokens", 0) or 0
                    d["cw"] += u.get("cache_creation_input_tokens", 0) or 0
                    d["cr"] += u.get("cache_read_input_tokens", 0) or 0
        except OSError:
            continue

print(json.dumps({"days": day_list, "models": models, "files": files}))
