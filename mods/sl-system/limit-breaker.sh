#!/bin/bash
# Bellion, the Limit Breaker: reads your work and plans how to go past today's quest (JSON on stdout).
# Usage: limit-breaker.sh '<context json>'
#   The sl-system mod passes: the player, today's quest and progress, the shadow army and its state,
#   running agents, today's dispatch budget, and past dispatches with your 👍/👎 ratings.
# This script adds your open PRs, review requests and Jira tickets (cached from the quest master,
# refreshed through the claude.ai Atlassian connector when older than 3 hours), then asks Claude.
# Each plan is saved to ~/.config/herdr-app/data/sl-system/limit/<time>.json.
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/homebrew/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

CTX="${1:-{\}}"
DATADIR="$HOME/.config/herdr-app/data/sl-system"
OUTDIR="$DATADIR/limit"
mkdir -p "$OUTDIR"
NOW="$(date '+%A %Y-%m-%d %H:%M')"

JIRA_FILE="$DATADIR/jira.json"
if [ ! -f "$JIRA_FILE" ] || [ $(( $(date +%s) - $(stat -f %m "$JIRA_FILE") )) -gt 10800 ]; then
  claude -p "Using the Atlassian MCP tools (read only; change nothing), search Jira with JQL
'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC' (max 20 issues).
Reply with ONLY a JSON array of {key, summary, status, priority, type, sprint, due, updated, url}.
No prose, no code fences." --model haiku --allowedTools "mcp__claude_ai_Atlassian_MCP" 2>/dev/null \
  | python3 -I -c '
import sys, re, json
s = sys.stdin.read(); m = re.search(r"\[.*\]", s, re.S); d = json.loads(m.group(0)); assert isinstance(d, list); print(json.dumps(d))
' > "$JIRA_FILE.tmp" 2>/dev/null && mv "$JIRA_FILE.tmp" "$JIRA_FILE"
fi
JIRA="$(cat "$JIRA_FILE" 2>/dev/null || echo "[]")"

gh_json() { command -v gh >/dev/null && gh "$@" 2>/dev/null || echo "[]"; }
MY_PRS="$(gh_json search prs --author=@me --state=open --json title,url,repository,updatedAt,isDraft --limit 12)"
# Only PRs whose review was requested from the Player directly: not through a team or CODEOWNERS.
REVIEWS="$(gh_json search prs "user-review-requested:@me" --state=open --json title,url,repository,updatedAt --limit 10)"

read -r -d '' PROMPT <<EOF
You are Bellion, Grand Marshal of the Shadow Army in the Solo Leveling "System", serving a software
engineer (the Player) who works with AI coding agents. Your job: push the Player past their limit today,
without wasting effort. It is $NOW.

Context (JSON): $CTX
Player's open PRs: $MY_PRS
PRs whose review was requested from the Player directly: $REVIEWS
(Never plan reviews of other PRs: requests that reach the Player only through a team or code ownership are ignored.)
Player's open Jira tickets: $JIRA

Plan the next two hours:
1. "bonus": 0 to 2 BONUS quests beyond today's Daily Quest that are realistic in two hours (skip if the Daily
   Quest is far from done; finishing it comes first). Same shape as quests: id ("bonus-..."), label (under 46
   chars), detail (under 80), url, target, unit, step (1), stat (str|agi|vit|int|sen), xp (30 to 60).
2. "moves": up to 6 next moves, best first, each {title (under 50 chars), why (under 90 chars), url, by}.
   If context.priorities is not empty, it is the Player's own ranked list: return those items FIRST, in the
   same order, with the same title, and keep their "by" value ("you" items must be unchanged); drop one only
   if it is clearly done. Then add your own new moves after them, with by "bellion". Plan dispatches in the
   spirit of the Player's priorities.
3. "dispatch": the autonomous work to start NOW, at most context.budget items (may be fewer or none).
   Only pick work with clear value that an agent can do alone. Learn from context.history ratings: repeat
   kinds the Player rated up, avoid kinds rated down. Never repeat a dispatch already running or done today.
   Each: {title (under 50), kind ("order" to give a standing soldier a task, or "agent" to start a new agent),
   soldier (for "order": one of context.army names, matching its role), space (for "agent": a space name from
   context.spaces where the repo lives), task (the full instruction for the agent, concrete: which ticket/PR/
   branch, what to produce), why (under 90 chars), url}.
   Agents may read code, run tests, write code on a NEW LOCAL BRANCH, and draft text. They must not push,
   merge, approve, comment on PRs, or change Jira; say so is not needed, the System adds that rule.
4. "message": one ominous Bellion-style line under 90 characters.

Reply with ONLY a JSON object: {"message": "...", "bonus": [...], "moves": [...], "dispatch": [...]}.
No prose, no code fences.
EOF

ERR="$OUTDIR/last-error.log"
printf '%s' "$CTX" > "$OUTDIR/last-context.json"
RAW="$(claude -p --model sonnet "$PROMPT" 2>"$ERR")"
CODE=$?
if [ $CODE -ne 0 ]; then
  printf '\n--- stdout (exit %s) ---\n%s\n' "$CODE" "$RAW" >> "$ERR"
  python3 -I -c 'import json,sys; print(json.dumps({"error": "claude failed: " + (open(sys.argv[1]).read().strip()[-300:] or "no message")}))' "$ERR"
  exit 1
fi
JSON="$(printf '%s' "$RAW" | python3 -I -c '
import sys, re, json
s = sys.stdin.read(); m = re.search(r"\{.*\}", s, re.S); d = json.loads(m.group(0))
for k in ("bonus", "moves", "dispatch"): d[k] = d.get(k) or []
print(json.dumps(d))
' 2>/dev/null)" || { echo '{"error":"unparseable reply"}'; exit 1; }

printf '%s\n' "$JSON" > "$OUTDIR/$(date +%Y%m%d-%H%M).json"
printf '%s\n' "$JSON"
