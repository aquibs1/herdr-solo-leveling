#!/bin/bash
# The System's quest master: turns your real work into today's Daily Quest (JSON on stdout).
# Usage: quest-master.sh '<context json>'
#   The sl-system mod passes the player (level, fatigue, streak, penalty) and your workspaces
#   (each space's repo, branch, recent commits, uncommitted files) and the agents' tasks.
# This script adds your open PRs and the PRs waiting for your review (gh), and your Jira tickets
# (through Claude's claude.ai Atlassian connector), then asks Claude for the quest.
# A copy is saved to ~/.config/herdr-app/data/sl-system/quests/<date>.json.
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/homebrew/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

CTX="${1:-{\}}"
DAY="$(date +%F)"
WEEKDAY="$(date +%A)"
OUTDIR="$HOME/.config/herdr-app/data/sl-system/quests"
mkdir -p "$OUTDIR"

DATADIR="$HOME/.config/herdr-app/data/sl-system"

# Jira, through the claude.ai Atlassian connector (read-only search). Runs alongside the GitHub lookups.
JIRA_FILE="$DATADIR/jira.json"
JIRA_PROMPT="Using the Atlassian MCP tools (read only; change nothing), search Jira with JQL
'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC' (max 20 issues).
Reply with ONLY a JSON array of {key, summary, status, priority, type, sprint, due, updated, url}
(sprint: the issue's open sprint name or null). No prose, no code fences."
( claude -p "$JIRA_PROMPT" --model haiku --allowedTools "mcp__claude_ai_Atlassian_MCP" 2>/dev/null \
  | python3 -I -c '
import sys, re, json
s = sys.stdin.read()
m = re.search(r"\[.*\]", s, re.S)
d = json.loads(m.group(0))
assert isinstance(d, list)
print(json.dumps(d))
' > "$JIRA_FILE.tmp" 2>/dev/null && mv "$JIRA_FILE.tmp" "$JIRA_FILE" ) &
JIRA_PID=$!

gh_json() { command -v gh >/dev/null && gh "$@" 2>/dev/null || echo "[]"; }
MY_PRS="$(gh_json search prs --author=@me --state=open --json title,url,repository,updatedAt,isDraft --limit 12)"
# Only PRs whose review was requested from the Player directly: not through a team or CODEOWNERS.
REVIEWS="$(gh_json search prs "user-review-requested:@me" --state=open --json title,url,repository,updatedAt --limit 10)"

wait "$JIRA_PID" 2>/dev/null
# This run's tickets, else the last ones fetched (a failed lookup keeps yesterday's view).
JIRA="$(cat "$JIRA_FILE" 2>/dev/null || echo "[]")"

read -r -d '' PROMPT <<EOF
You are "the System" from Solo Leveling. Assign today's Daily Quest to the Player, a software engineer
who works with AI coding agents. The quest is about their real WORK only: no physical exercise.
Today is $WEEKDAY, $DAY.

Player and workspaces (JSON): $CTX
Player's open pull requests (JSON): $MY_PRS
Pull requests whose review was requested from the Player directly (JSON): $REVIEWS
Player's open Jira tickets (JSON): $JIRA

Write 7 or 8 concrete, doable-today quests grounded in the data above. Name the real Jira key, PR, branch
or repo in each label where you can (shorten titles). Use Jira to choose what matters: tickets in the current
open sprint first (mind how many days the sprint has left), then by priority (P0/P1 before P2), and match
tickets to their PRs and branches when the key or topic lines up. At least 2 quests must be about Jira tickets:
move one forward a status (such as In Progress to Needs QA), finish its subtask, unblock one "Waiting On X",
or triage a stale "New Request" (start it, re-scope it, or close it). Cover these stats:
- str (Shipping): push a branch forward, get a PR ready for review or merged.
- agi (Agent Command): run, steer and unblock AI agents; answer agent questions fast.
- vit (Code Quality): tests, CI fixes, bug fixes, addressing review comments.
- int (System Design): a TAN, PRD, analysis or design doc (Jira analysis tasks and epics); learning the codebase.
- sen (Review Sense): review the PRs requested from the Player directly (listed above), oldest first. Never pick
  PRs the Player is only a code owner or team member on. If none are requested directly, make it a self-review
  of one of the Player's own open PRs before asking for reviewers.
Include exactly one quest with "auto": "agents" whose target is how many tasks the Player's agents should
finish today (2 to 5); it fills itself as agents finish. Scale the amount of work to level and fatigue
(level 1 = a light day). Fridays, wrap up; Mondays, plan. If context.penalty is true, add one extra,
harder quest with id "penalty" (the Penalty Zone: such as clear stale PRs, branches or old Jira tickets).
Each quest: id (short slug), label (imperative, under 46 characters), detail (one short line: which PR, branch
or why; under 80 characters), url (the Jira or PR url, or ""), target (integer), unit ("tickets", "PRs",
"reviews", "tasks", "commits", "sessions", "comments", "docs" or "fixes"), step (1), stat, xp (an integer from 15 to 50), auto
("agents" or omitted).
Also "message": one ominous System-style line under 90 characters.

Reply with ONLY a JSON object: {"title": "...", "message": "...", "quests": [...]}. No prose, no code fences.
EOF

RAW="$(claude -p --model haiku "$PROMPT" 2>/dev/null)" || { echo '{"error":"claude failed"}'; exit 1; }

JSON="$(printf '%s' "$RAW" | python3 -I -c '
import sys, re, json
s = sys.stdin.read()
m = re.search(r"\{.*\}", s, re.S)
d = json.loads(m.group(0))
assert isinstance(d.get("quests"), list) and d["quests"]
print(json.dumps(d))
' 2>/dev/null)" || { echo '{"error":"unparseable reply"}'; exit 1; }

printf '%s\n' "$JSON" > "$OUTDIR/$DAY.json"
printf '%s\n' "$JSON"
