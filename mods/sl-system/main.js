// Solo Leveling "System" for Herdr.
// props.view:
//   "engine": an invisible copy the layout floats; runs the daily reset and penalty, the quest master
//             (quest-master.sh turns your PRs, reviews, branches and agents into the day's quests),
//             agent rewards, emergency quests, and the `sl-system.home` / `sl-system.quest` key commands.
//   "home" (default): the System's home pane, a tab in this computer's "Home" space: status, abilities, Daily Quest, shadow army,
//             inventory, skills, titles and the System log.
// All player state lives in shared("sl.state"), so every copy sees the same player.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, InputState, Input } from "gpui-base";
import { Collector as ClaudeCollector, KEY as CLAUDE_KEY, until as claudeUntil, parseTime as claudeTime } from "./claude/data.js";
import { usd as claudeUsd, tokens as claudeTok, agentRows as claudeAgents, forecastLine as claudeForecast } from "./claude/view.js";
import { agents, terminals, spaces, panes, machines, theme, shared, setShared, notify, playSound, exec, appHome, home, props, run, readTextFile, writeTextFile, nextCommand } from "herdr";

const KEY = "sl.state";
const GLOW = "#3fd0ff";
const GOLD = "#ffd36b";
const RED = "#ff4f6d";
const VIOLET = "#ffb547"; // amber: the secondary accent (was violet)
const PURPLE = "#b48cff"; // only for the Opus bars in the usage chart
const INK = "#e8f7ff";
const PANEL = "#07122bcc";
// The manhwa's System window: royal-blue panels, cyan filigree, condensed capitals.
const BLUE_TOP = "#1f52a8", BLUE_BOT = "#143a7c", FIELD = "#0a1a3c99", FILIGREE = "#7fe6ff";
const TITLE_FONT = "DIN Condensed";
const KEYWORDS = [[/^(players?)$/i, "#4dff88"], [/^(penalt(y|ies)|failed?|fail)$/i, RED], [/^(rewards?|exp|gold)$/i, GOLD], [/^(shadows?|arise)$/i, VIOLET]];
// Your abilities, from how you work. Keys stay str/agi/vit/int/sen so saved progress carries over.
const STATS = [
  ["str", "SHIP", "Shipping", "PRs made ready, merged and landed"],
  ["agi", "AGNT", "Agent Command", "running, steering and unblocking AI agents"],
  ["vit", "QUAL", "Code Quality", "tests, CI fixes, bugs, review comments"],
  ["int", "ARCH", "System Design", "TANs, PRDs, architecture, learning the codebase"],
  ["sen", "REVW", "Review Sense", "reviewing teammates' PRs"],
];
const SKILLS = [
  [1, "Sprint", "Active · move faster for a short time"],
  [5, "Persistence", "Passive · fatigue builds more slowly"],
  [10, "Bloodlust", "Active · lowers enemies' stats with fear"],
  [15, "Stealth", "Active · vanish from sight"],
  [20, "Dagger Rush", "Active · a flurry of thrown daggers"],
  [30, "Dragon's Fear", "Active · a roar that freezes the weak"],
  [40, "Shadow Extraction", "Job skill · raise the fallen as shadows"],
  [45, "Shadow Exchange", "Job skill · swap places with a shadow"],
  [60, "Ruler's Authority", "Active · move objects with the mind"],
  [100, "Monarch's Domain", "Passive · shadows grow stronger"],
];
const TITLES = {
  "Wolf Slayer": "Clear the Daily Quest 7 days in a row",
  "One Who Overcame Adversity": "Survive the Penalty Zone",
  "Demon Hunter": "Reach level 25",
  "Shadow Commander": "Clear 50 dungeons with your shadows",
  "Shadow Monarch": "Reach level 100",
};

// ---------- state ----------
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const need = (lv) => Math.round(100 * Math.pow(lv, 1.35));
const rankOf = (lv) => (lv >= 60 ? "S" : lv >= 45 ? "A" : lv >= 30 ? "B" : lv >= 20 ? "C" : lv >= 10 ? "D" : "E");
const jobOf = (lv) => (lv >= 100 ? "Shadow Monarch" : lv >= 40 ? "Necromancer" : "None");

function fresh() {
  const user = (home() || "").split("/").pop() || "Player";
  return {
    v: 1, name: user.charAt(0).toUpperCase() + user.slice(1), level: 1, xp: 0, points: 0,
    stats: { str: 10, agi: 10, vit: 10, int: 10, sen: 10 }, train: { str: 0, agi: 0, vit: 0, int: 0, sen: 0 },
    gold: 0, fatigue: 0, streak: 0, best: 0, cleared: 0, dungeons: 0, penalty: false,
    inventory: { box: 1, potion: 1 }, titles: [], title: null, daily: null, log: [],
  };
}
const getState = () => (shared(KEY) && shared(KEY).v ? shared(KEY) : fresh());
function update(fn) { const s = clone(getState()); fn(s); setShared(KEY, s); return s; }
function log(s, text) { s.log.unshift({ t: Date.now(), text }); s.log = s.log.slice(0, 60); }
function system(title, body, level = "info", timeout) { notify({ title: `[SYSTEM] ${title}`, body, level, timeout }); }

function addXP(s, n, why) {
  s.xp += n;
  if (why) log(s, `${why} +${n} EXP`);
  while (s.xp >= need(s.level)) {
    s.xp -= need(s.level);
    const job = jobOf(s.level);
    s.level += 1; s.points += 5; s.fatigue = 0;
    log(s, `Level up! Lv ${s.level}. +5 ability points.`);
    system("LEVEL UP!", `You have reached Lv ${s.level}. Ability points +5. Fatigue fully recovered.`, "success");
    playSound("done");
    const skill = SKILLS.find(([lv]) => lv === s.level);
    if (skill) { log(s, `Skill acquired: ${skill[1]}`); system("Skill Acquired", `[${skill[1]}] — ${skill[2]}`, "success"); }
    if (jobOf(s.level) !== job) { log(s, `Job change: ${jobOf(s.level)}`); system("JOB CHANGE", `Your job is now [${jobOf(s.level)}].`, "success"); }
  }
  checkTitles(s);
}
function earn(s, title) {
  if (s.titles.includes(title)) return;
  s.titles.push(title); if (!s.title) s.title = title;
  log(s, `Title acquired: ${title}`);
  system("Title Acquired", `[${title}] — ${TITLES[title]}`, "success");
}
function checkTitles(s) {
  if (s.streak >= 7) earn(s, "Wolf Slayer");
  if (s.level >= 25) earn(s, "Demon Hunter");
  if (s.dungeons >= 50) earn(s, "Shadow Commander");
  if (s.level >= 100) earn(s, "Shadow Monarch");
}

// ---------- quests ----------
function penaltyQuest() {
  return { id: "penalty", label: "PENALTY ZONE: clear 3 stale PRs or branches", detail: "Close, merge or delete work that has gone cold.", url: "", target: 3, unit: "tasks", step: 1, stat: "vit", xp: 45, progress: 0 };
}
function fallbackQuests(s) {
  const q = [
    { id: "ship", label: "Move one PR forward", detail: "Push, mark ready, or get it merged.", target: 1, unit: "PRs", stat: "str", xp: 30 },
    { id: "unblock", label: "Answer waiting agents quickly", detail: "Respond to every blocked agent within 5 minutes.", target: 3, unit: "tasks", stat: "agi", xp: 20 },
    { id: "agents", label: "Let your agents clear dungeons", detail: "Fills itself as your agents finish tasks.", target: 3, unit: "tasks", stat: "agi", xp: 35, auto: "agents" },
    { id: "quality", label: "Fix a test, bug or review comment", detail: "Leave the code better than you found it.", target: 1, unit: "fixes", stat: "vit", xp: 25 },
    { id: "learn", label: "Read a doc or design note", detail: "A TAN, PRD or unfamiliar part of the codebase.", target: 1, unit: "docs", stat: "int", xp: 20 },
    { id: "review", label: "Review a teammate's PR", detail: "Oldest review request first.", target: 1, unit: "reviews", stat: "sen", xp: 30 },
  ].map((x) => ({ url: "", step: 1, ...x, progress: 0 }));
  if (s.penalty) q.push(penaltyQuest());
  return q;
}
function normalize(list, s) {
  const ok = new Set(STATS.map(([k]) => k));
  const q = (list || []).slice(0, 10).map((x, i) => ({
    id: String(x.id || `q${i}`), label: String(x.label || "Quest").slice(0, 60), detail: String(x.detail || "").slice(0, 110),
    url: /^https?:\/\//.test(x.url || "") ? x.url : "",
    target: Math.max(1, Math.round(+x.target || 1)), unit: String(x.unit || ""),
    step: Math.max(1, Math.round(+x.step || 1)), stat: ok.has(x.stat) ? x.stat : "vit",
    xp: Math.min(60, Math.max(5, Math.round(+x.xp || 20))), auto: x.auto === "agents" ? "agents" : undefined, progress: 0,
  }));
  if (s.penalty && !q.some((x) => x.id === "penalty")) q.push(penaltyQuest());
  return q;
}

// Move a quest's progress (dir = +1 / -1 steps); rewards on completion, claims when all are done.
function advance(s, q, dir) {
  const d = s.daily;
  const was = q.progress >= q.target;
  q.progress = Math.max(0, Math.min(q.target, q.progress + dir * q.step));
  if (!was && q.progress >= q.target) {
    addXP(s, q.xp, `Quest done: ${q.label}.`);
    s.train[q.stat] = (s.train[q.stat] || 0) + 1;
    if (s.train[q.stat] % 3 === 0) {
      s.stats[q.stat] += 1;
      const name = STATS.find(([k]) => k === q.stat)[2];
      log(s, `${name} increased to ${s.stats[q.stat]}.`);
      system("Stat Increased", `Your work paid off. ${name} +1.`, "success", 4000);
    }
  }
  if (!d.claimed && d.quests.filter((x) => !x.bonus).every((x) => x.progress >= x.target)) claim(s);
}
function progress(id, dir) {
  update((s) => {
    const d = s.daily; if (!d) return;
    const q = d.quests.find((x) => x.id === id);
    if (q && (!d.claimed || q.bonus)) advance(s, q, dir);
  });
}
function claim(s) {
  const d = s.daily; d.claimed = true;
  s.streak += 1; s.best = Math.max(s.best, s.streak); s.cleared += 1;
  s.points += 3; s.fatigue = 0; s.inventory.box = (s.inventory.box || 0) + 1;
  if (s.penalty) { s.penalty = false; earn(s, "One Who Overcame Adversity"); }
  log(s, `Daily Quest complete. Streak ${s.streak}.`);
  system("Daily Quest Complete", "Rewards: Full Recovery · Ability Points +3 · Random Box ×1 · 50 EXP", "success");
  playSound("done");
  addXP(s, 50);
  checkTitles(s);
}

// ---------- the engine ----------
// Scripts that call `claude` run in a hidden herdr-core terminal through your login shell (zsh -lic), the
// way your agents start: outside it `claude` reports "Not logged in". Output comes back by file.
async function runInCore(script, arg, timeoutMs) {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const out = `${appHome()}/data/sl-system/run-${id}.out`;
  const r = await exec("hc", ["run", "--json", "--no-parent", "--rm", "--bg", "--",
    "zsh", "-lic", 'bash "$1" "$2" > "$3.part" 2>&1; mv "$3.part" "$3"', "sl-run", script, arg, out], { timeout: 30000 });
  if (r.code !== 0) throw new Error(`hc run: ${(r.stderr || r.stdout || "").trim().slice(0, 120)}`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const text = await readTextFile(out).catch(() => null);
    if (text != null) { exec("rm", ["-f", out]).catch(() => {}); return text; }
    await exec("sleep", ["2"]);
  }
  throw new Error("timed out");
}
let generating = false;

// Your workspaces, for the quest master: each space's repo, branch, recent commits and uncommitted files.
async function workContext() {
  const seen = new Set(), out = [];
  for (const sp of (spaces() || []).slice(0, 8)) {
    if (!sp.folder || seen.has(`${sp.machine}:${sp.folder}`)) continue;
    seen.add(`${sp.machine}:${sp.folder}`);
    const entry = { name: sp.name, machine: sp.machine || "this computer", folder: sp.folder, branch: sp.branch || null };
    try {
      const r = await exec("sh", ["-c", 'cd "$1" 2>/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0; echo "@@repo $(basename "$(git rev-parse --show-toplevel)")"; git log --since="3 days ago" --no-merges --author="$(git config user.email)" --format="%h %s" -n 6; echo "@@dirty $(git status --porcelain | wc -l)"', "sh", sp.folder], { on: sp.machine, timeout: 15000 });
      for (const l of (r.stdout || "").split("\n").filter(Boolean)) {
        if (l.startsWith("@@repo ")) entry.repo = l.slice(7);
        else if (l.startsWith("@@dirty ")) entry.uncommitted = +l.slice(8) || 0;
        else (entry.commits = entry.commits || []).push(l);
      }
    } catch { /* an unreachable machine: send what the app knows */ }
    out.push(entry);
  }
  return out;
}

function generate(cx, force, keep = false) {
  if (generating) return;
  generating = true; setShared("sl.generating", true);
  update((s) => { if (s.daily) s.daily.lastTry = Date.now(); });
  cx.spawn(async () => {
    try {
      // The quest master saves each day's quest; reuse it unless asked for a new one.
      const saved = force ? null : await readTextFile(`${appHome()}/data/sl-system/quests/${today()}.json`).catch(() => null);
      let out = saved;
      if (!out) {
        const s0 = getState();
        const ctx = JSON.stringify({
          level: s0.level, rank: rankOf(s0.level), fatigue: s0.fatigue, streak: s0.streak, penalty: s0.penalty,
          spaces: await workContext(),
          agents: (agents() || []).map((a) => ({ task: a.tab_name || a.title, space: a.space_name, status: a.status })),
        });
        out = await runInCore(`${appHome()}/mods/sl-system/quest-master.sh`, ctx, 300000);
      }
      const data = JSON.parse((out || "").trim().split("\n").pop());
      if (data.error || !Array.isArray(data.quests)) throw new Error(data.error || "no quests");
      update((s) => {
        if (!s.daily || s.daily.day !== today() || s.daily.claimed) return;
        const old = new Map(s.daily.quests.flatMap((q) => [[q.id, q.progress], [q.label, q.progress]]));
        const bonus = s.daily.quests.filter((q) => q.bonus);
        s.daily.quests = [...normalize(data.quests, s).map((q) => ({ ...q, progress: force && !keep ? 0 : Math.min(q.target, old.get(q.id) || old.get(q.label) || 0) })), ...(keep ? bonus : [])];
        s.daily.title = data.title || "Daily Quest";
        s.daily.message = data.message || s.daily.message;
        s.daily.source = "agent";
      });
      system("Daily Quest Arrived", `${data.quests.length} quests from your work today. ${data.message || ""}`, "info", 6000);
    } catch (e) {
      update((s) => {
        if (s.daily && s.daily.source !== "agent") { s.daily.source = "default"; s.daily.message = "The quest master is silent. The standard quest applies (retrying soon)."; }
        log(s, `The quest master did not answer (${String(e?.message || e).slice(0, 60)}).`);
      });
    } finally {
      generating = false; setShared("sl.generating", false);
    }
  });
}

function rollover(cx) {
  const day = today(), s = getState();
  if (s.daily && s.daily.day === day && s.daily.v === 2) return;
  update((s) => {
    if (s.daily && s.daily.day !== day) {
      const d = s.daily;
      s.history = (s.history || []).filter((h) => h.day !== d.day);
      s.history.push({ day: d.day, done: d.quests.filter((q) => q.progress >= q.target).length, total: d.quests.length, claimed: !!d.claimed });
      s.history = s.history.slice(-30);
    }
    if (s.daily && s.daily.day !== day && !s.daily.claimed) {
      s.penalty = true; s.streak = 0; s.fatigue = Math.min(100, s.fatigue + 30);
      log(s, `Daily Quest failed (${s.daily.day}). Penalty applied.`);
      system("PENALTY", "You failed yesterday's Daily Quest. You will be sent to the Penalty Zone. Streak reset · Fatigue +30.", "error", 12000);
      playSound("blocked");
    }
    s.daily = { v: 2, day, title: "Daily Quest", message: "The quest master is reading your work…", quests: fallbackQuests(s), claimed: false, source: "pending" };
  });
  generate(cx, s.daily && s.daily.day === day); // same day, old physical quest: ask again
}

// Retry the quest master every 10 minutes until today's quest came from it.
function retry(cx) {
  const d = getState().daily;
  if (!d || d.claimed || d.source === "agent" || generating) return;
  if (Date.now() - (d.lastTry || 0) > 600000) generate(cx, false);
}

// ---------- token usage ----------
// token-usage.py reads Claude Code's session logs; it runs here and on each connected machine.
// The merged result is shared("sl.tokens"): { updated, days, models: { model: { day: {in,out,cw,cr} } }, machines }.
let tokensBusy = false, tokensAt = 0;
function refreshTokens(cx) {
  if (tokensBusy) return;
  tokensBusy = true; tokensAt = Date.now();
  cx.spawn(async () => {
    try {
      const script = `${appHome()}/mods/sl-system/token-usage.py`;
      const code = await readTextFile(script);
      const where = [null, ...(machines() || []).filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
      const merged = { updated: Date.now(), days: [], models: {}, machines: [] };
      for (const on of where) {
        try {
          const r = on ? await exec("python3", ["-c", code, "14"], { on, timeout: 120000 }) : await exec("python3", ["-I", script, "14"], { timeout: 120000 });
          const d = JSON.parse((r.stdout || "").trim());
          merged.days = d.days;
          merged.machines.push(on || "this Mac");
          for (const [model, byDay] of Object.entries(d.models || {})) {
            const m = (merged.models[model] = merged.models[model] || {});
            for (const [day, u] of Object.entries(byDay)) {
              const x = (m[day] = m[day] || { in: 0, out: 0, cw: 0, cr: 0 });
              x.in += u.in; x.out += u.out; x.cw += u.cw; x.cr += u.cr;
            }
          }
        } catch { /* that machine has no logs or python3: skip it */ }
      }
      if (merged.machines.length) setShared("sl.tokens", merged);
    } finally { tokensBusy = false; }
  });
}
// Every 5 minutes, or when the home pane asks (shared "sl.tokens.ask").
function tokensTick(cx) {
  const ask = shared("sl.tokens.ask") || 0;
  if (Date.now() - tokensAt > 300000 || ask > tokensAt) refreshTokens(cx);
}

const fmtTok = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n || 0)));
const tokAll = (u) => (u ? u.in + u.out + u.cw + u.cr : 0);

// ---------- Bellion, the Limit Breaker ----------
// Weekdays at 9, 11, 13, 15 and 17 (or on demand) limit-breaker.sh plans the next two hours:
// bonus quests, ranked next moves, and up to the day's remaining budget of autonomous dispatches
// (orders to standing soldiers, or new agents). Every dispatch is tracked so you can rate its ROI.
const RULES = "\n\nRules from the System: work locally. You may read code, run tests, write code on a NEW LOCAL BRANCH and draft text. Do NOT push, merge, approve, comment on PRs, or change Jira; if that's the next step, stop and ask me. End with a short summary: what you did, what you found, and what you'd do next.";
const SLOTS = [9, 11, 13, 15, 17];
let limitBusy = false;
const limitOf = (s) => ({ enabled: true, cap: 3, runs: {}, dispatches: [], last: null, ...(s.limit || {}) });
const todayDispatches = (L) => L.dispatches.filter((x) => x.day === today());

// Every PR and Jira ticket an item points at: its url, plus the refs named in its text
// ("JOUR-5436", "PR 49956", "PRs #51514 and #51516"). Each becomes an "↗ <ref>" button.
const JIRA_BASE = "https://wizrocket.atlassian.net/browse/";
const PR_BASE = "https://github.com/CleverTap-Platform/Ultron/pull/";
function linksOf(...parts) {
  const out = [], seen = new Set();
  const add = (label, url) => { if (url && !seen.has(url)) { seen.add(url); out.push({ label, url }); } };
  for (const p of parts) {
    if (!p) continue;
    if (/^https?:\/\//.test(p) && !/\s/.test(p)) {
      const j = /\/browse\/([A-Z][A-Z0-9]+-\d+)/.exec(p), pr = /\/pull\/(\d+)/.exec(p);
      add(j ? j[1] : pr ? `PR ${pr[1]}` : "OPEN", p);
      continue;
    }
    for (const m of p.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{2,6})\b/g)) add(m[1], JIRA_BASE + m[1]);
    for (const m of p.matchAll(/\bPRs?\s+((?:#?\d{4,6}(?:\s*(?:,|and|&)\s*)?)+)/gi))
      for (const n of m[1].matchAll(/\d{4,6}/g)) add(`PR ${n[0]}`, PR_BASE + n[0]);
    for (const m of p.matchAll(/(?:^|\s|\()#(\d{4,6})\b/g)) add(`PR ${m[1]}`, PR_BASE + m[1]);
  }
  return out;
}
function nextSlot(L) {
  const n = new Date(), wd = n.getDay(), ran = L.runs[today()] || [];
  if (wd >= 1 && wd <= 5) for (const h of SLOTS) if (h > n.getHours() || (h === n.getHours() && !ran.includes(h))) return `${String(h).padStart(2, "0")}:00`;
  const d = new Date(n); do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} 09:00`;
}
function limitTick(cx) {
  const s = getState(), L = limitOf(s);
  const ask = shared("sl.limit.ask") || 0;
  if (ask > (L.askedAt || 0)) { update((x) => { x.limit = { ...limitOf(x), askedAt: ask }; }); return runLimit(cx, "on demand"); }
  if (!L.enabled) return;
  const n = new Date(), wd = n.getDay(), h = n.getHours();
  if (wd < 1 || wd > 5 || h < 9 || h >= 18) return;
  const slot = SLOTS.filter((x) => x <= h).pop();
  if (slot == null || (L.runs[today()] || []).includes(slot)) return;
  update((x) => { const l = limitOf(x); l.runs = { [today()]: [...(l.runs[today()] || []), slot] }; x.limit = l; });
  runLimit(cx, `${slot}:00 run`);
}
function limitContext(s) {
  const L = limitOf(s), list = agents() || [], d = s.daily;
  const st = (addr) => (alive(addr) ? ((list.find((a) => a.address === addr) || {}).status || "summoned") : "dormant");
  return {
    player: { level: s.level, rank: rankOf(s.level), fatigue: s.fatigue, streak: s.streak },
    daily: d ? { done: d.quests.filter((q) => q.progress >= q.target).length, total: d.quests.length, claimed: d.claimed,
      open: d.quests.filter((q) => q.progress < q.target).map((q) => `${q.bonus ? "[bonus] " : ""}${q.label}`) } : null,
    army: army(s).map((x) => ({ name: x.name, role: x.role, state: st(x.terminal), space: x.spaceName, machine: x.machine })),
    spaces: (spaces() || []).filter((x) => x.name !== "Home").map((x) => ({ name: x.name, machine: x.machine, folder: x.folder, branch: x.branch })),
    agents: list.map((a) => ({ name: shadowName(s, a.address), task: a.tab_name || a.title, space: a.space_name, status: a.status })),
    budget: Math.max(0, L.cap - todayDispatches(L).length),
    priorities: L.edited ? (L.last?.moves || []).map((m, i) => ({ rank: i + 1, title: m.title, why: m.why, by: m.by || "bellion" })) : [],
    history: L.dispatches.slice(-15).map((x) => ({ day: x.day, title: x.title, kind: x.kind, soldier: x.soldier, status: x.status, rating: x.rating ?? null })),
  };
}
function runLimit(cx, why) {
  if (limitBusy) return;
  limitBusy = true; setShared("sl.limit.busy", true);
  cx.spawn(async () => {
    try {
      const text = await runInCore(`${appHome()}/mods/sl-system/limit-breaker.sh`, JSON.stringify(limitContext(getState())), 300000);
      const plan = JSON.parse((text || "").trim().split("\n").pop() || '{"error":"no output"}');
      if (plan.error) throw new Error(plan.error);
      // Bonus quests join today's quest; moves and the message show on the LIMIT BREAK page.
      update((s) => {
        const L = limitOf(s);
        // Bellion was given your list (context.priorities) and returns it first, in your order; the
        // items you wrote or edited stay exactly as you left them.
        const mine = L.edited ? (L.last?.moves || []).filter((m) => m.by === "you") : [];
        const fromBellion = (plan.moves || []).map((m) => ({ title: String(m.title || "").slice(0, 80), why: String(m.why || "").slice(0, 120), url: m.url || "", by: m.by === "you" ? "you" : "bellion" }));
        const merged = [];
        for (const m of fromBellion) { const own = mine.find((x) => x.title === m.title); merged.push(own || m); }
        for (const m of mine) if (!merged.some((x) => x.title === m.title)) merged.splice(mine.indexOf(m), 0, m);
        L.last = { at: Date.now(), why, message: plan.message || "", moves: merged.slice(0, 8) };
        L.edited = false;
        s.limit = L;
        const d = s.daily;
        if (d && d.day === today()) {
          for (const b of normalize(plan.bonus || [], { penalty: false }).slice(0, 2)) {
            if (d.quests.some((q) => q.label === b.label)) continue;
            d.quests.push({ ...b, id: `bonus-${Date.now().toString(36)}-${d.quests.length}`, bonus: true, xp: Math.round(b.xp * 1.5) });
          }
        }
        log(s, `Bellion surveyed the battlefield (${why}): ${(plan.dispatch || []).length} dispatches, ${(plan.bonus || []).length} bonus quests.`);
      });
      // Autonomous work, within today's budget.
      const budget = Math.max(0, limitOf(getState()).cap - todayDispatches(limitOf(getState())).length);
      for (const job of (plan.dispatch || []).slice(0, budget)) await dispatch(job);
      if ((plan.bonus || []).length) system("Bonus Quest", `Bellion: ${plan.message || "Go past your limit."}`, "info", 6000);
    } catch (e) {
      update((s) => log(s, `Bellion could not plan (${String(e?.message || e).slice(0, 200)}).`));
    } finally { limitBusy = false; setShared("sl.limit.busy", false); }
  });
}
// Start one job: an order to a standing soldier, or a new agent at a space. Recorded for ROI.
async function dispatch(job) {
  const s = getState(), rec = { id: `d${Date.now().toString(36)}`, day: today(), at: Date.now(), title: String(job.title || "Task").slice(0, 60),
    kind: job.kind === "agent" ? "agent" : "order", soldier: job.soldier || null, why: job.why || "", url: job.url || "", task: String(job.task || ""), terminal: null, status: "running" };
  if (!rec.task.trim()) return;
  try {
    if (rec.kind === "order") {
      const m = army(s).find((x) => x.name.toLowerCase() === String(job.soldier || "").toLowerCase());
      if (!m) throw new Error(`no soldier named ${job.soldier}`);
      await order(m.id, rec.task + RULES);
      rec.terminal = army(getState()).find((x) => x.id === m.id)?.terminal || null;
    } else {
      const all = spaces() || [];
      const sp = all.find((x) => x.name === job.space) || postFor(army(s)[0] || {}) || all.find((x) => x.machine) || all.find((x) => x.name !== "Home");
      const out = await hd("tab.new", { ...(sp ? { space: sp.id } : {}), name: `⚡ ${rec.title.slice(0, 28)}`, argv: ["claude"], task: rec.task + RULES });
      rec.terminal = out.terminal || null;
      rec.soldier = "new agent";
    }
  } catch (e) { rec.status = "failed"; rec.error = String(e?.message || e).slice(0, 120); }
  update((x) => {
    const L = limitOf(x); L.dispatches = [...L.dispatches, rec].slice(-60); x.limit = L;
    log(x, rec.status === "failed" ? `Bellion's dispatch failed: ${rec.title} (${rec.error}).` : `Bellion dispatched ${rec.soldier}: ${rec.title}.`);
  });
  if (rec.status !== "failed") system("Bellion dispatched", `${rec.soldier}: ${rec.title}`, "info", 5000);
}
// A dispatched agent that worked and went quiet has finished its job.
function finishDispatch(s, addr) {
  const L = limitOf(s);
  const rec = L.dispatches.find((x) => x.terminal === addr && x.status === "running" && Date.now() - x.at > 60000);
  if (rec) { rec.status = "done"; rec.doneAt = Date.now(); s.limit = L; log(s, `Dispatch finished: ${rec.title}. Rate it on LIMIT BREAK.`); }
}
// Your edits to the Next Moves list (index based; the list is short).
function editMoves(fn) { update((s) => { const L = limitOf(s); L.last = L.last || { at: Date.now(), why: "your list", message: "", moves: [] }; fn(L.last.moves); L.edited = true; s.limit = L; }); }
const moveUp = (i) => editMoves((m) => { if (i > 0) [m[i - 1], m[i]] = [m[i], m[i - 1]]; });
const moveDown = (i) => editMoves((m) => { if (i < m.length - 1) [m[i + 1], m[i]] = [m[i], m[i + 1]]; });
const moveDrop = (i) => editMoves((m) => { m.splice(i, 1); });
const moveEdit = (i, title) => editMoves((m) => { if (m[i] && title.trim()) { m[i] = { ...m[i], title: title.trim().slice(0, 80), by: "you" }; } });
const moveAdd = (title) => editMoves((m) => { if (title.trim()) m.push({ title: title.trim().slice(0, 80), why: "Added by you", url: "", by: "you" }); });
function rate(id, v) { update((s) => { const L = limitOf(s); const r = L.dispatches.find((x) => x.id === id); if (r) r.rating = r.rating === v ? null : v; s.limit = L; }); }

// ---------- shadows ----------
// Every agent gets a shadow's name for as long as its terminal lives (s.names, by address).
// The army (s.army) is the standing shadows: each keeps one long-lived agent, its post (space,
// folder), a role and saved orders. Summoning reuses its live agent; a fresh one only if it's gone.
const SHADOW_NAMES = ["Igris", "Beru", "Tank", "Iron", "Tusk", "Kaisel", "Greed", "Bellion", "Fang", "Jima", "Kamish", "Cerberus", "Esil", "Baruka", "Kargalgan", "Sillad"];
const SHADOW_RANKS = [[200, "Grand Marshal"], [100, "Marshal"], [50, "Commander"], [25, "Elite Knight"], [10, "Knight"], [3, "Elite Soldier"], [0, "Soldier"]];
const shadowRank = (n) => SHADOW_RANKS.find(([min]) => (n || 0) >= min)[1];
const army = (s) => s.army || [];
const alive = (addr) => !!addr && ((agents() || []).some((a) => a.address === addr) || (terminals() || []).some((x) => x.address === addr && x.state !== "exited"));
const soldierOf = (s, addr) => army(s).find((x) => x.terminal === addr);
function shadowName(s, addr) { const m = soldierOf(s, addr); return m ? m.name : s.names?.[addr]?.name; }
function freeName(s) {
  const used = new Set([...army(s).map((x) => x.name), ...Object.values(s.names || {}).map((x) => x.name)]);
  return SHADOW_NAMES.find((n) => !used.has(n)) || `Soldier ${used.size + 1}`;
}
// A soldier whose terminal isn't recorded (or died) adopts the live terminal of its "⚔ Name" tab;
// dispatches given to it that lack a terminal get it too.
function healArmy() {
  const s0 = getState(), all = spaces() || [];
  const found = [];
  for (const m of army(s0)) {
    if (alive(m.terminal)) continue;
    for (const sp of all) {
      const tab = (sp.tabs || []).find((t) => t.name === `⚔ ${m.name}`);
      const term = tab && (panes() || []).find((p) => p.tab === tab.id && p.terminal && alive(p.terminal));
      if (term) { found.push([m.id, term.terminal, sp.id]); break; }
    }
  }
  const L0 = limitOf(s0);
  const orphan = L0.dispatches.some((d) => d.status === "running" && !d.terminal && d.kind === "order");
  if (!found.length && !orphan) return;
  update((s) => {
    for (const [id, terminal, space] of found) {
      const m = army(s).find((x) => x.id === id);
      if (m) { m.terminal = terminal; m.space = space; log(s, `${m.name} rejoined the army (${terminal}).`); }
    }
    const L = limitOf(s);
    for (const d of L.dispatches) if (d.status === "running" && !d.terminal && d.kind === "order") {
      const m = army(s).find((x) => x.name === d.soldier);
      if (m && alive(m.terminal)) d.terminal = m.terminal;
    }
    s.limit = L;
  });
}

// Name every agent that has none (engine, each tick).
function nameShadows() {
  const list = agents() || [], s0 = getState();
  if (!list.some((a) => !shadowName(s0, a.address))) return;
  update((s) => {
    s.names = s.names || {};
    for (const a of list) if (!shadowName(s, a.address)) s.names[a.address] = { name: freeName(s), cleared: 0, born: Date.now() };
    // Forget ad-hoc names of terminals that are gone (army names stay with the army).
    for (const k of Object.keys(s.names)) if (!list.some((a) => a.address === k) && !alive(k)) delete s.names[k];
  });
}
// The space a shadow should be summoned in: its own if still there, else one on its machine.
function postFor(m) {
  const all = spaces() || [];
  return all.find((x) => x.id === m.space) || all.find((x) => (x.machine || null) === (m.machine || null) && x.name === m.spaceName) || all.find((x) => (x.machine || null) === (m.machine || null));
}
async function hd(cmd, args) {
  const r = await exec("herdr-app", ["do", cmd, JSON.stringify(args)], { timeout: 30000 });
  const text = r.stdout || "", a = text.indexOf("{"), b = text.lastIndexOf("}");
  const out = a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : { error: (r.stderr || text || `exit ${r.code}`).trim().slice(0, 120) };
  if (out.error) throw new Error(out.error);
  return out;
}
// Summon a soldier: focus its live agent (and hand it the task), or raise a fresh one at its post.
async function summon(id, task) {
  const m = army(getState()).find((x) => x.id === id);
  if (!m) return;
  if (alive(m.terminal)) {
    if (task) await order(id, task); else run("agent.focus", { terminal: m.terminal });
    return;
  }
  const sp = postFor(m);
  const args = { name: `⚔ ${m.name}`, argv: m.argv || ["claude"], ...(sp ? { space: sp.id } : {}), ...(m.folder ? { folder: m.folder } : {}), ...(task ? { task } : {}) };
  try {
    const out = await hd("tab.new", args);
    update((s) => {
      const x = army(s).find((y) => y.id === id); if (!x) return;
      x.terminal = out.terminal; x.space = out.space || x.space; x.summoned = Date.now();
      log(s, `ARISE. ${x.name} (${x.role}) answers the summons${task ? ` with an order: ${task.slice(0, 50)}` : ""}.`);
    });
    system("ARISE", `${m.name} has answered your summons.`, "success", 4000);
  } catch (e) { system("Summon failed", `${m.name}: ${String(e?.message || e).slice(0, 120)}`, "error"); }
}
// Give a live soldier an order (pasted and submitted in its agent); a dormant one is summoned with it.
async function order(id, task) {
  const m = army(getState()).find((x) => x.id === id);
  if (!m || !task.trim()) return;
  if (!alive(m.terminal)) return summon(id, task);
  try {
    const r = await exec("hc", ["send", m.terminal, task], { timeout: 20000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || "send failed").trim());
    update((s) => { const x = army(s).find((y) => y.id === id); if (x) { x.orders_given = (x.orders_given || 0) + 1; log(s, `Order to ${x.name}: ${task.slice(0, 60)}`); } });
    system("Order given", `${m.name}: ${task.slice(0, 90)}`, "info", 3000);
  } catch (e) { system("Order not delivered", `${m.name}: ${String(e?.message || e).slice(0, 120)}`, "warning"); }
}
// ARISE: turn a passing agent into a standing soldier that keeps its name, terminal and post.
function arise(a) {
  update((s) => {
    s.army = army(s);
    if (soldierOf(s, a.address)) return;
    const sp = (spaces() || []).find((x) => x.id === a.space);
    const name = shadowName(s, a.address) || freeName(s);
    const cleared = s.names?.[a.address]?.cleared || 0;
    if (s.names) delete s.names[a.address];
    s.army.push({ id: `sh${Date.now().toString(36)}`, name, role: a.tab_name || a.title || "Shadow soldier", terminal: a.address,
      space: a.space, spaceName: sp?.name || a.space_name, machine: sp?.machine || null,
      folder: (panes() || []).find((p) => p.terminal === a.address)?.cwd || sp?.folder || "", argv: ["claude"], orders: [], cleared });
    log(s, `ARISE. ${name} joins your army.`);
  });
  system("ARISE", "Extraction successful. A new soldier joins your army.", "success", 4000);
}
function newSoldier(role, sp) {
  update((s) => {
    s.army = army(s);
    const name = freeName(s);
    s.army.push({ id: `sh${Date.now().toString(36)}`, name, role: role || "Shadow soldier", terminal: null,
      space: sp?.id || null, spaceName: sp?.name || null, machine: sp?.machine || null, folder: sp?.folder || "", argv: ["claude"], orders: [], cleared: 0 });
    log(s, `${name} was raised${sp ? ` at ${sp.name}` : ""}: ${role || "shadow soldier"}.`);
  });
}
function release(id) { update((s) => { const m = army(s).find((x) => x.id === id); if (!m) return; s.army = army(s).filter((x) => x.id !== id); if (m.terminal && alive(m.terminal)) (s.names = s.names || {})[m.terminal] = { name: m.name, cleared: m.cleared || 0, born: Date.now() }; log(s, `${m.name} was released from the army.`); }); }
function saveOrder(id, task) { update((s) => { const m = army(s).find((x) => x.id === id); if (m && task.trim()) { m.orders = m.orders || []; m.orders.push({ label: task.trim().slice(0, 40), task: task.trim() }); } }); }
function dropOrder(id, i) { update((s) => { const m = army(s).find((x) => x.id === id); if (m) m.orders.splice(i, 1); }); }

// The first standing soldiers, posted where your work lives (a space on another machine if you have one).
function seedArmy() {
  if (getState().armySeeded) return;
  const all = spaces() || [];
  const sp = all.find((x) => x.machine && x.machine !== null) || all.find((x) => !x.machine && x.name !== "Home") || all[0];
  update((s) => {
    s.armySeeded = true; s.army = army(s);
    const post = { space: sp?.id || null, spaceName: sp?.name || null, machine: sp?.machine || null, folder: sp?.folder || "", argv: ["claude"], terminal: null, cleared: 0 };
    const add = (name, role, orders) => { if (!s.army.some((x) => x.name === name)) s.army.push({ id: `sh-${name.toLowerCase()}`, name, role, ...post, orders }); };
    add("Igris", "PR reviewer", [
      { label: "Review my oldest direct request", task: "Using gh, list the PRs whose review was requested from me directly (gh search prs 'user-review-requested:@me' --state=open; ignore team and code-owner requests) and review the oldest one. If there are none, say so and stop. Summarize what you found. Don't approve, comment or push without asking me." },
      { label: "Check CI on my PRs", task: "Using gh, check CI on my open PRs (gh search prs --author=@me --state=open). Summarize what is failing and why, oldest first. Change nothing." },
    ]);
    add("Beru", "Jira tracker", [
      { label: "Triage my Jira", task: "Using the Atlassian tools, list my open Jira tickets in the current sprint, flag anything blocked, stale or due soon, and suggest today's next step for each. Change nothing in Jira." },
      { label: "Draft my standup", task: "Draft my standup: what I did yesterday (my git commits and Jira updates), what I'll do today (sprint tickets by priority), and blockers. Keep it short." },
    ]);
    add("Tank", "CI & test fixer", [
      { label: "Fix the failing tests", task: "Find the failing tests on this branch, explain the root cause, and propose a fix. Ask me before pushing anything." },
    ]);
    log(s, "Your first shadows stand ready: Igris, Beru and Tank.");
  });
}

function trackAgents(view) {
  const now = Date.now(), seen = new Set();
  for (const a of agents() || []) {
    seen.add(a.address);
    const prev = view.last.get(a.address);
    if (prev === "working" && (a.status === "done" || a.status === "idle")) {
      update((s) => {
        s.dungeons += 1; s.fatigue = Math.min(100, s.fatigue + (s.level >= 5 ? 1 : 2));
        const gold = 10 + Math.floor(Math.random() * 21); s.gold += gold;
        const m = soldierOf(s, a.address), n = s.names?.[a.address];
        const holder = m || n;
        if (holder) {
          const before = shadowRank(holder.cleared || 0);
          holder.cleared = (holder.cleared || 0) + 1;
          const after = shadowRank(holder.cleared);
          if (after !== before) { log(s, `${holder.name} was promoted to ${after}.`); system("Shadow Promoted", `${holder.name} is now a ${after}.`, "success", 4000); }
        }
        addXP(s, 12, `${shadowName(s, a.address) || "A shadow"} cleared a dungeon (${a.tab_name || a.title || "task"}). +${gold} gold,`);
        const d = s.daily;
        const q = d && !d.claimed && d.quests.find((x) => x.auto === "agents" && x.progress < x.target);
        if (q) advance(s, q, 1);
        finishDispatch(s, a.address);
      });
    }
    if (a.status === "blocked") {
      if (!view.blockedSince.has(a.address)) view.blockedSince.set(a.address, now);
      if (now - view.blockedSince.get(a.address) > 180000 && !view.warned.has(a.address)) {
        view.warned.add(a.address);
        notify({ title: "[SYSTEM] EMERGENCY QUEST", body: `A shadow in "${a.space_name} / ${a.tab_name || a.tab_index}" awaits your command. Respond to clear it (+20 EXP).`, level: "warning", action: { name: "agent.focus", args: { terminal: a.address } } });
      }
    } else if (prev === "blocked") {
      const late = view.warned.has(a.address);
      view.blockedSince.delete(a.address); view.warned.delete(a.address);
      update((s) => addXP(s, late ? 20 : 5, late ? "Emergency quest cleared." : "Command given to a shadow."));
    }
    view.last.set(a.address, a.status);
  }
  for (const k of [...view.last.keys()]) if (!seen.has(k)) view.last.delete(k);
}

// The System lives in its own space on this computer, "Home": one tab per page, each a copy of this mod.
const PAGES = [["home", "◆ SYSTEM"], ["quests", "▲ QUESTS"], ["shadows", "☾ SHADOWS"], ["limit", "⚡ LIMIT BREAK"], ["usage", "▤ USAGE"], ["profile", "✦ PROFILE"]];
const PAGES_VERSION = 2; // bump when a page is added, so an existing Home gets it once
const pageName = (view) => (PAGES.find(([v]) => v === view) || PAGES[0])[1];
const homeSpace = () => (spaces() || []).find((x) => !x.machine && x.named && x.name === "Home");
let homePending = false;

// Show a page's tab in Home, making the tab (or the whole Home space) if it was closed.
function openPage(view) {
  const sp = homeSpace();
  if (!sp) { homePending = view; run("space.new", { name: "Home", machine: "", folder: home(), tab: "shell" }); return; }
  const tab = (sp.tabs || []).find((t) => t.name === pageName(view));
  run("space.select", { id: sp.id });
  if (tab) run("tab.select", { id: tab.id });
  else run("tab.new", { space: sp.id, name: pageName(view), mod: "sl-system", props: { view } });
}
function openHome() { openPage("home"); }

// Every page tab Home doesn't have yet, in order (once per Home; closing a page later is respected).
function addPages(sp) {
  for (const [view, name] of PAGES) if (!(sp.tabs || []).some((t) => t.name === name)) run("tab.new", { space: sp.id, name, mod: "sl-system", props: { view } });
}
function ensurePages() {
  const sp = homeSpace();
  if (!sp || shared("sl.pages") === PAGES_VERSION) return;
  const fresh = !shared("sl.pages");
  setShared("sl.pages", PAGES_VERSION);
  addPages(sp);
  const first = (sp.tabs || []).find((t) => t.name === pageName("home"));
  if (first && fresh) run("tab.select", { id: first.id });
}

// After openPage made the Home space: add the pages, drop the shell it started with, put Home first.
function finishHome() {
  if (!homePending) return;
  const sp = homeSpace();
  if (!sp) return;
  const view = homePending; homePending = false;
  const shells = (sp.tabs || []).map((t) => t.id);
  setShared("sl.pages", PAGES_VERSION);
  addPages(sp);
  for (const id of shells) run("tab.close", { id, confirmed: true });
  run("space.move", { id: sp.id, index: 1 });
  if (view !== "home") openPage(view);
}

// ---------- actions ----------
function spend(stat) { update((s) => { if (s.points > 0) { s.points -= 1; s.stats[stat] += 1; } }); }
function usePotion() {
  update((s) => { if ((s.inventory.potion || 0) > 0) { s.inventory.potion -= 1; s.fatigue = Math.max(0, s.fatigue - 50); log(s, "Used a Recovery Potion. Fatigue -50."); } });
}
function openBox() {
  update((s) => {
    if ((s.inventory.box || 0) < 1) return;
    s.inventory.box -= 1;
    const r = Math.random();
    let got;
    if (r < 0.35) { s.inventory.potion = (s.inventory.potion || 0) + 1; got = "Recovery Potion ×1"; }
    else if (r < 0.7) { const g = 100 + Math.floor(Math.random() * 401); s.gold += g; got = `${g} gold`; }
    else if (r < 0.92) { s.points += 1; got = "Ability Point ×1"; }
    else { s.inventory.key = (s.inventory.key || 0) + 1; got = "Instant Dungeon Key ×1 (rare)"; }
    log(s, `Random Box opened: ${got}.`);
    system("Random Box", `You obtained: ${got}`, "success", 5000);
  });
}
function useKey() { update((s) => { if ((s.inventory.key || 0) > 0) { s.inventory.key -= 1; addXP(s, 150, "Instant Dungeon cleared."); } }); }
function buyPotion() { update((s) => { if (s.gold >= 200) { s.gold -= 200; s.inventory.potion = (s.inventory.potion || 0) + 1; log(s, "Bought a Recovery Potion (200 gold)."); } }); }

// ---------- art: SVGs drawn from the player's numbers ----------
const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const RADAR = { box: 200, c: 100, r: 78 };
const axis = (i, r) => { const a = (-90 + i * 72) * Math.PI / 180; return [RADAR.c + r * Math.cos(a), RADAR.c + r * Math.sin(a)]; };
function radarSVG(stats) {
  const vals = STATS.map(([k]) => stats[k] || 0);
  const max = Math.max(20, ...vals) * 1.1;
  const poly = (f) => STATS.map((_, i) => axis(i, f(i)).map((n) => n.toFixed(1)).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1].map((k) => `<polygon points="${poly(() => RADAR.r * k)}" fill="none" stroke="#3fd0ff" stroke-opacity="${k === 1 ? 0.5 : 0.18}" stroke-width="1"/>`).join("");
  const spokes = STATS.map((_, i) => { const [x, y] = axis(i, RADAR.r); return `<line x1="100" y1="100" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#3fd0ff" stroke-opacity="0.22"/>`; }).join("");
  const pts = poly((i) => RADAR.r * (vals[i] / max));
  const dots = STATS.map((_, i) => { const [x, y] = axis(i, RADAR.r * (vals[i] / max)); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#e8fbff"/>`; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3fd0ff" stop-opacity="0.18"/><stop offset="1" stop-color="#3fd0ff" stop-opacity="0"/></radialGradient></defs><circle cx="100" cy="100" r="96" fill="url(#g)"/>${rings}${spokes}<polygon points="${pts}" fill="#3fd0ff" fill-opacity="0.3" stroke="#7fe6ff" stroke-width="2" stroke-linejoin="round"/>${dots}</svg>`;
}
function ringSVG(value, max, color) {
  const r = 40, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, value / Math.max(1, max)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="46" fill="none" stroke="${color}" stroke-opacity="0.15" stroke-width="1"/><circle cx="48" cy="48" r="${r}" fill="#0f2d63" stroke="#0b1838" stroke-width="6"/><circle cx="48" cy="48" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 48 48)"/></svg>`;
}

// ---------- view ----------
export default class SoloLevelingSystem extends View {
  init(_p, cx) {
    this.view = props()?.view || "home";
    this.width = 1200;
    if (this.view !== "engine") {
      this.art = {}; this.pend = {};
      this.scroll = ScrollHandle.new();
      this.sel = null; this.post = 0; this.typing = false;
      this.cmd = InputState.new({ placeholder: "Give an order, or describe a new soldier's role…" });
      this.cmd.on("submit", (_e, cx) => this.sendOrder(cx));
      this.cmd.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
      this.cmd.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
      this.editIdx = null;
      this.moveEditor = InputState.new({ placeholder: "Edit this move…" });
      this.moveEditor.on("submit", (_e, cx) => { if (this.editIdx != null) moveEdit(this.editIdx, this.moveEditor.value() || ""); this.editIdx = null; cx.notify(); });
      this.moveAdder = InputState.new({ placeholder: "Add your own move…" });
      this.moveAdder.on("submit", (_e, cx) => { moveAdd(this.moveAdder.value() || ""); this.moveAdder.set_value(""); cx.notify(); });
      this.syncArt(cx);
      cx.timer.every(2000, (cx) => this.syncArt(cx));
      // `sl-system.top` scrolls the System back to its header.
      cx.spawn(async (cx) => { for (;;) { if ((await nextCommand()) === "top") { this.scroll.scroll_to_item(0); cx.notify(); } } });
      return;
    }
    generating = false; // a previous engine's run may have been cancelled mid-way
    limitBusy = false; if (shared("sl.limit.busy")) setShared("sl.limit.busy", false);
    if (shared("sl.generating")) setShared("sl.generating", false);
    this.last = new Map(); this.blockedSince = new Map(); this.warned = new Set();
    for (const a of agents() || []) this.last.set(a.address, a.status);
    if (!shared(KEY)) setShared(KEY, fresh());
    rollover(cx);
    // A run cut short (the layout reloaded mid-way) left the quest pending: ask again now.
    if (getState().daily?.source === "pending" && !generating) generate(cx, false);
    retry(cx);
    seedArmy();
    if (!(getState().migrations || []).includes("direct-reviews")) update((s) => {
      s.migrations = [...(s.migrations || []), "direct-reviews"];
      for (const m of army(s)) for (const o of m.orders || []) if (/review-requested=@me/.test(o.task)) {
        o.label = "Review my oldest direct request";
        o.task = 'Using gh, list the PRs whose review was requested from me directly (gh search prs "user-review-requested:@me" --state=open; ignore team and code-owner requests) and review the oldest one. If there are none, say so and stop. Summarize what you found. Don\'t approve, comment or push without asking me.';
      }
      log(s, "Reviews now count only when requested from you directly.");
    });
    ensurePages();
    refreshTokens(cx);
    // cunderw/herdr-claude-usage: account limits, forecast and per-agent cost for the USAGE page.
    try { this.claude = new ClaudeCollector(); this.claude.start(cx); } catch { /* the USAGE page just omits the limits */ }
    cx.timer.every(5000, (cx) => { finishHome(); rollover(cx); retry(cx); healArmy(); nameShadows(); trackAgents(this); tokensTick(cx); limitTick(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "home") openHome();
        if (c === "quest") generate(cx, true);
        if (c === "quest-refresh") generate(cx, true, true);
        if (c === "limit") runLimit(cx, "on demand");
        if (c === "notify-test") system("Shadow Promoted", "Tank has reached Knight rank. You may bestow a name.", "success", 8000);
      }
    });
    // The first time, open the System's home tab once.
    if (!shared("sl.homeMade")) { setShared("sl.homeMade", true); if (!(panes() || []).some((p) => p.mod === "sl-system")) openHome(); }
  }


  // Write each picture once per distinct content (the name carries its hash, so the image is never stale).
  syncArt(cx) {
    const s = getState();
    this.want("radar", radarSVG(s.stats), cx);
    this.want("ring", ringSVG(s.xp, need(s.level), s.penalty ? RED : GLOW), cx);
  }
  want(key, text, cx) {
    const path = `data/sl-system/art/${key}-${hash(text)}.svg`;
    if (this.art[key] === path || this.pend[key] === path) return;
    this.pend[key] = path;
    cx.spawn(async (cx) => {
      try { await writeTextFile(`${appHome()}/${path}`, text, null); } catch { /* already written */ }
      const old = this.art[key];
      this.art[key] = path; this.pend[key] = null;
      cx.notify();
      if (old && old !== path) exec("rm", ["-f", `${appHome()}/${old}`]).catch(() => {});
    });
  }
  pic(key, size) { return this.art[key] ? image(this.art[key]).w(size).h(size).flex_none() : div().w(size).h(size).flex_none(); }

  // ===== the home pane: a strict grid. Spacing 8/12/16; every card has the same header; fixed columns. =====

  // A fixed-size button. Disabled ones keep their space so columns never shift.
  btn(id, label, onClick, { color = GOLD, disabled = false, w = 28, tip } = {}) {
    const t = theme();
    return div().id(id).w(w).h(26).flex_none().flex().items_center().justify_center()
      .border(1).border_color(disabled ? t.border : color + "99").bg(disabled ? "#00000000" : color + "12")
      .text_size(11).font_semibold().text_color(disabled ? t.dim : color)
      .when(!!tip, (el) => el.tooltip(tip))
      .when(!disabled, (el) => el.hover((st) => st.bg(color + "33")).on_click((_e, cx) => onClick(cx)))
      .child(label);
  }
  gap(w) { return div().w(w).h(26).flex_none(); }
  // "↗ JOUR-5436"  "↗ PR 49956": one button per linked PR or ticket; nothing when there are none.
  links(key, ...parts) {
    const ls = linksOf(...parts);
    if (!ls.length) return div();
    return h_flex().gap(6).flex_wrap().pt(2).children(ls.slice(0, 4).map((l, i) =>
      div().id(`lk-${key}-${i}`).h(20).px(7).flex().items_center().gap(4).flex_none().rounded(4)
        .border(1).border_color(GOLD + "88").bg(GOLD + "14").hover((st) => st.bg(GOLD + "33")).tooltip(l.url)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); exec("open", [l.url]).catch(() => {}); })
        .child(div().text_size(10).text_color(GOLD).child("↗"))
        .child(div().text_size(10.5).font_semibold().text_color(GOLD).child(l.label))));
  }
  bar(value, max, color, h = 6) {
    const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
    return div().h(h).w_full().bg("#0a1530").child(div().h_full().w(`${pct}%`).bg(color));
  }
  // Label left, value right, one fixed row height.
  kv(label, value, color) {
    const t = theme();
    return h_flex().h(26).items_center().justify_between()
      .child(div().text_size(11).text_color(t.muted).child(label))
      .child(div().text_size(13).font_semibold().text_color(color ?? INK).child(String(value)));
  }
  // A labelled meter: "HP          300 / 300" over its bar.
  meter(label, value, max, color) {
    const t = theme();
    return v_flex().gap(4)
      .child(h_flex().justify_between().text_size(11)
        .child(div().text_color(t.muted).child(label))
        .child(div().text_color(INK).child(`${value} / ${max}`)))
      .child(this.bar(value, max, color));
  }
  // The System window frame, as in the manhwa: a royal-blue gradient panel, a thin glowing border with
  // an inner line, and cyan filigree swirls in the four corners. `el` must be relative; returns it framed.
  // A soft sheen across the top of the panel; the FIRST child, so it paints behind the content.
  back() {
    return v_flex().absolute().top(0).left(0).right(0).h(120).rounded_t(16)
      .child(div().h(40).w_full().bg("#ffffff0b")).child(div().h(40).w_full().bg("#ffffff06")).child(div().h(40).w_full().bg("#ffffff02"));
  }
  // The System window frame: a translucent royal-blue panel with rounded corners inside a soft cyan glow,
  // with knotwork filigree in the corners whose arms run along the edges. `el` must be relative.
  frame(el, small = false) {
    const z = small ? 58 : 84, R = small ? 12 : 16;
    const orn = (pos) => image(`mods/sl-system/art/orn-${pos}.svg`).absolute().w(z).h(z)
      .when(pos[0] === "t", (e) => e.top(-4)).when(pos[0] === "b", (e) => e.bottom(-4))
      .when(pos[1] === "l", (e) => e.left(-4)).when(pos[1] === "r", (e) => e.right(-4));
    const halo = (d, w, a) => div().absolute().top(-d).left(-d).right(-d).bottom(-d).rounded(R + d).border(w).border_color(`#3fd0ff${a}`);
    return el.rounded(R).bg("#07142e99").border(1).border_color(FILIGREE + "66")
      .child(halo(3, 2, "38")).child(halo(6, 3, "1c")).child(halo(10, 4, "0b"))   // glow, brightest nearest the edge
      .child(div().absolute().top(6).left(6).right(6).bottom(6).rounded(R - 4).border(1).border_color(FILIGREE + "1c"))
      .child(orn("tl")).child(orn("tr")).child(orn("bl")).child(orn("br"));
  }
  // Text in the System's voice: condensed capitals, keywords colored like the manhwa
  // (PLAYER green, PENALTY red, REWARDS gold, SHADOWS violet).
  voice(text, { size = 15, color = INK, center = true, bracket = true } = {}) {
    const words = String(text || "").toUpperCase().split(/\s+/).filter(Boolean);
    const tint = (w) => { const bare = w.replace(/[^A-Z']/gi, ""); const k = KEYWORDS.find(([re]) => re.test(bare)); return k ? k[1] : color; };
    return h_flex().flex_wrap().gap_x(5).when(center, (el) => el.justify_center())
      .children(words.map((w, i) => div().font_family(TITLE_FONT).text_size(size).text_color(tint(w))
        .child(`${bracket && i === 0 ? "[" : ""}${w}${bracket && i === words.length - 1 ? "]" : ""}`)));
  }
  // A System window: the frame, "ⓘ TITLE" with its summary on the right over one glow line, the body.
  // Every card, tile and page panel is built from this; `color` tints the ring of the ⓘ.
  card(title, meta, body, { color = GLOW, pad = 16 } = {}) {
    const t = theme();
    const ring = color === GLOW ? "#ffffff" : color;
    const header = v_flex().w_full().pt(18).px(pad + 14)
      .child(h_flex().h(34).gap(10).items_center()
        .child(div().size(20).flex_none().rounded(10).border(2).border_color(ring).bg("#ffffff14").flex().items_center().justify_center()
          .text_size(12).font_bold().text_color("#ff6b8a").child("!"))
        .child(div().flex_1().min_w(0).truncate().font_family(TITLE_FONT).text_size(22).text_color(INK).child(title.toUpperCase()))
        .when(!!meta, (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(meta))))
      .child(h_flex().w_full().pt(6).items_center()
        .child(div().flex_1().h(1).bg(FILIGREE + "99")).child(div().w(60).h(1).bg(FILIGREE + "44")).child(div().w(60).h(1).bg(FILIGREE + "18")));
    return this.frame(v_flex().relative().w_full()
      .child(this.back())
      .child(header)
      .child(v_flex().px(pad + 14).pb(pad + 14).pt(12).gap(8).children(body)));
  }

  // Column headers for a table, using the same widths as its rows.
  colHead(cols) {
    const t = theme();
    return h_flex().h(24).items_center().gap(12).border_b(1).border_color(t.border).text_size(10).text_color(t.dim)
      .children(cols.map(([label, w, align]) => {
        const c = div().child(label);
        const sized = w === "flex" ? c.flex_1().min_w(0) : c.w(w).flex_none();
        return align === "right" ? sized.flex().justify_end() : align === "center" ? sized.flex().justify_center() : sized;
      }));
  }

  // ----- banner -----
  banner(s) {
    const t = theme(), color = s.penalty ? RED : GLOW;
    const page = pageName(this.view).replace(/^\S+\s/, "");
    const busyQuest = !!shared("sl.generating"), busyLimit = !!shared("sl.limit.busy");
    // One main action per page, always in the same slot (empty pages keep the space).
    const action = {
      quests: () => this.btn("act-quest", busyQuest ? "RECEIVING…" : "NEW QUEST", (cx) => generate(cx, true), { w: 150, color: VIOLET, disabled: busyQuest || !!s.daily?.claimed, tip: "Ask the quest master for a fresh quest (resets today's progress)" }),
      limit: () => this.btn("act-limit", busyLimit ? "SURVEYING…" : "BREAK LIMIT NOW", () => setShared("sl.limit.ask", Date.now()), { w: 150, color: GOLD, disabled: busyLimit, tip: "Plan now and dispatch within today's budget" }),
      usage: () => this.btn("act-usage", "RECOUNT", () => setShared("sl.tokens.ask", Date.now()), { w: 150, color: t.muted, tip: "Count token usage again now" }),
      profile: () => this.btn("act-box", `OPEN BOX ×${s.inventory.box || 0}`, () => openBox(), { w: 150, color: GOLD, disabled: !(s.inventory.box > 0) }),
      home: () => this.btn("act-box", `OPEN BOX ×${s.inventory.box || 0}`, () => openBox(), { w: 150, color: GOLD, disabled: !(s.inventory.box > 0) }),
    }[this.view];
    return this.frame(h_flex().relative().h(84).flex_none().px(36).gap(16).items_center().child(this.back()), true)
      .child(div().id("logo-home").flex_none().hover((st) => st.opacity(0.8)).on_click(() => openPage("home")).tooltip("SYSTEM")
        .child(image("mods/sl-system/art/beru.png").w(56).h(56).loop("opacity", { from: 0.85, to: 1, period: 2600 })))
      .child(v_flex().w(220).flex_none()
        .child(div().text_size(10).text_color(color === RED ? RED : GOLD).child("THE SYSTEM"))
        .child(div().truncate().font_family(TITLE_FONT).text_size(28).text_color(INK).child(page)))
      .child(div().w(1).h(40).flex_none().bg(t.border))
      .child(v_flex().flex_1().min_w(0).gap(6)
        .child(h_flex().gap(12).items_center()
          .child(div().text_size(14).font_bold().text_color(INK).child(s.name))
          .child(div().text_size(12).text_color(GOLD).child(`Lv ${s.level}`))
          .child(div().text_size(12).text_color(GOLD).child(`${rankOf(s.level)}-Rank`))
          .child(div().truncate().text_size(12).text_color(s.penalty ? RED : t.muted).child(s.penalty ? "in the Penalty Zone" : `streak ${s.streak}`)))
        .child(h_flex().gap(12).items_center()
          .child(div().w(240).flex_none().child(this.bar(s.xp, need(s.level), GLOW, 4)))
          .child(div().text_size(11).text_color(t.muted).child(`${s.xp} / ${need(s.level)} EXP`))))
      .child(div().w(150).flex_none().flex().justify_end().child(action ? action() : div()));
  }

  // ----- status -----
  status(s) {
    const t = theme(), hp = 100 + s.stats.vit * 20, mp = 10 + s.stats.int * 10;
    return this.card("STATUS", `${rankOf(s.level)}-Rank`, [
      h_flex().h(96).gap(16).items_center()
        .child(div().relative().w(96).h(96).flex_none()
          .child(this.pic("ring", 96))
          .child(v_flex().absolute().top(0).left(0).w(96).h(96).items_center().justify_center()
            .child(div().text_size(9).text_color(t.muted).child("LEVEL"))
            .child(div().text_size(26).font_bold().text_color(INK).child(String(s.level)))
            .child(div().text_size(9).text_color(GOLD).child(`${Math.round((s.xp / need(s.level)) * 100)}% EXP`))))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(10).text_color(t.dim).child("NAME"))
          .child(div().truncate().text_size(20).font_bold().text_color(INK).child(s.name))
          .child(div().text_size(11).text_color(GOLD).child(`${rankOf(s.level)}-Rank Hunter`)))
        .child(div().relative().w(56).h(56).flex_none()
          .child(image("mods/sl-system/art/hex.svg").w(56).h(56))
          .child(div().absolute().top(0).left(0).w(56).h(56).flex().items_center().justify_center()
            .text_size(22).font_bold().text_color(GOLD).child(rankOf(s.level)))),
      div().h(1).bg(t.border),
      this.kv("JOB", jobOf(s.level)),
      this.kv("TITLE", s.title || "—", s.title ? VIOLET : t.dim),
      this.kv("GOLD", s.gold, GOLD),
      div().h(1).bg(t.border),
      this.meter("HP", hp, hp, "#ff6b81"),
      this.meter("MP", mp, mp, "#3d8bff"),
      this.meter("FATIGUE", s.fatigue, 100, s.fatigue > 60 ? RED : GOLD),
    ]);
  }

  // ----- abilities: CODE | name + what | value | + -----
  stats(s) {
    const t = theme();
    const line = ([k, short, name, what]) => h_flex().h(44).items_center().gap(12)
      .child(div().w(40).flex_none().text_size(11).font_bold().text_color(GOLD).child(short))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12).text_color(INK).child(name))
        .child(div().truncate().text_size(10).text_color(t.dim).child(what)))
      .child(div().w(28).flex_none().flex().justify_end().text_size(16).font_bold().text_color(INK).child(String(s.stats[k])))
      .child(s.points > 0 ? this.btn(`up-${k}`, "+", () => spend(k), { tip: `Spend a point on ${name}` }) : this.gap(28));
    const label = ([k, short], i) => {
      const a = (-90 + i * 72) * Math.PI / 180, R = RADAR.r + 22;
      const x = 20 + RADAR.c + R * Math.cos(a), y = 12 + RADAR.c + R * Math.sin(a);
      return v_flex().absolute().left(x - 24).top(y - 14).w(48).h(28).items_center().justify_center()
        .child(div().text_size(9).font_bold().text_color(GOLD).child(short))
        .child(div().text_size(11).font_semibold().text_color(INK).child(String(s.stats[k])));
    };
    const radar = h_flex().justify_center().child(div().relative().w(240).h(226)
      .child(div().absolute().left(20).top(12).child(this.pic("radar", RADAR.box)))
      .children(STATS.map(label)));
    return this.card("ABILITIES", s.points > 0 ? `${s.points} points to spend` : "", [
      radar,
      div().h(1).bg(t.border),
      ...STATS.map(line),
      div().pt(4).text_size(10).text_color(t.dim).child("Every 3 quests cleared for an ability raise it by 1."),
    ]);
  }

  // ----- daily quest: ☐ | goal | ability | EXP | progress | actions -----
  daily(s) {
    const t = theme(), d = s.daily, busy = !!shared("sl.generating");
    if (!d) return this.card("DAILY QUEST", "", [div().text_size(12).text_color(t.muted).child("Awaiting the System…")]);
    const now = new Date(), end = new Date(now); end.setHours(24, 0, 0, 0);
    const mins = Math.max(0, Math.round((end - now) / 60000));
    const left = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m left`;
    const done = d.quests.filter((q) => q.progress >= q.target).length;
    const code = (k) => (STATS.find(([x]) => x === k) || [])[1] || k;
    const W = { box: 16, chip: 52, xp: 52, prog: 92, act: 60 };

    const quest = (q) => {
      const ok = q.progress >= q.target, pen = q.id === "penalty", color = pen ? RED : GLOW;
      const auto = q.auto === "agents";
      return h_flex().py(10).gap(12).items_start().border_b(1).border_color(t.border)
        .child(div().mt(2).w(W.box).h(W.box).flex_none().border(1).border_color(color).bg(ok ? color : "#00000000"))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(8).items_start().min_w(0)
            .when(!!q.bonus, (el) => el.child(div().flex_none().px(5).h(18).flex().items_center().bg(GOLD + "22").border(1).border_color(GOLD + "88").text_size(9).font_bold().text_color(GOLD).child("BONUS")))
            .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(ok ? t.dim : pen ? RED : INK).child(q.label)))
          .when(!!q.detail, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(q.detail)))
          .child(this.links(`q-${q.id}`, q.url, q.label, q.detail)))
        .child(div().w(W.chip).flex_none().flex().justify_center()
          .child(div().px(6).h(20).flex().items_center().border(1).border_color(VIOLET + "88").text_size(10).text_color(VIOLET).child(code(q.stat))))
        .child(div().w(W.xp).flex_none().flex().justify_end().text_size(11).text_color(GOLD).child(`${q.xp}`))
        .child(v_flex().w(W.prog).flex_none().gap(4)
          .child(h_flex().justify_end().gap(4)
            .child(div().text_size(12).font_semibold().text_color(ok ? (pen ? RED : GOLD) : INK).child(`[${q.progress}/${q.target}]`))
            .child(div().text_size(10).text_color(t.dim).child(auto ? "auto" : q.unit)))
          .child(this.bar(q.progress, q.target, color, 3)))
        .child(h_flex().w(W.act).flex_none().gap(4).justify_end()
          .child(auto || (d.claimed && !q.bonus) ? this.gap(28) : this.btn(`dn-${q.id}`, "−", () => progress(q.id, -1), { color: t.muted, disabled: q.progress <= 0 }))
          .child(auto || (d.claimed && !q.bonus) ? this.gap(28) : this.btn(`up-${q.id}`, ok ? "✓" : "+", () => progress(q.id, 1), { color, disabled: ok })));
    };

    const title = d.title && !/^daily quest$/i.test(d.title.trim()) ? d.title : null;
    return this.card(s.penalty ? "DAILY QUEST · PENALTY ZONE" : "DAILY QUEST", d.claimed ? "COMPLETE" : `${done}/${d.quests.length} cleared · ${left}`, [
      title ? div().text_size(14).font_bold().text_color(INK).child(title + (d.source === "default" ? " (standard)" : "")) : null,
      busy ? h_flex().h(20).gap(8).items_center().text_size(11).text_color(GOLD)
        .child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90))
        .child("The quest master is reading your Jira, PRs, branches and agents… (about a minute)")
        : d.message ? div().py(4).child(this.voice(d.message, { size: 17 })) : null,
      this.colHead([["", W.box], ["GOAL", "flex"], ["ABILITY", W.chip, "center"], ["EXP", W.xp, "right"], ["PROGRESS", W.prog, "right"], ["", W.act]]),
      v_flex().children(d.quests.map(quest)),
      v_flex().pt(4).gap(4)
        .child(div().text_size(11).text_color(t.muted).child(d.claimed
          ? `✓ Cleared. Streak ${s.streak}. Rewards received.`
          : "REWARD  Full Recovery · Ability Points +3 · Random Box · 50 EXP"))
        .when(!d.claimed, (el) => el.child(div().text_size(11).text_color(RED + "dd")
          .child("WARNING  Failing to clear the Daily Quest by midnight sends you to the Penalty Zone."))),
      this.record(s),
    ].filter(Boolean), { color: s.penalty ? RED : GLOW });
  }

  // The last 14 days: cleared (glow), partly done (dim glow), failed (red), no record (empty); today pulses.
  record(s) {
    const t = theme(), byDay = new Map((s.history || []).map((h) => [h.day, h]));
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const live = i === 0 && s.daily ? { done: s.daily.quests.filter((q) => q.progress >= q.target).length, total: s.daily.quests.length, claimed: s.daily.claimed, today: true } : null;
      days.push({ key, wd: "SMTWTFS"[d.getDay()], h: live || byDay.get(key) });
    }
    const cell = ({ key, wd, h }) => {
      const f = h ? h.done / Math.max(1, h.total) : 0;
      const fill = !h ? "#00000000" : h.claimed ? GLOW : h.today ? GLOW + (f > 0.5 ? "77" : f > 0 ? "44" : "14") : f > 0 ? RED + "66" : RED + "33";
      const box = div().h(22).w_full().border(1).border_color(h ? (h.claimed ? GLOW : h.today ? GLOW + "aa" : RED + "88") : t.border).bg(fill)
        .tooltip(h ? `${key}: ${h.done}/${h.total}${h.claimed ? " · cleared" : h.today ? " · today" : " · failed"}` : `${key}: no record`);
      return v_flex().flex_1().min_w(0).gap(3).items_center()
        .child(h && h.today && !h.claimed ? box.loop("opacity", { from: 0.55, to: 1, period: 1400 }) : box)
        .child(div().text_size(9).text_color(h && h.today ? GOLD : t.dim).child(wd));
    };
    return v_flex().pt(8).gap(6)
      .child(h_flex().justify_between().text_size(10).text_color(t.dim)
        .child("QUEST RECORD · LAST 14 DAYS")
        .child(`streak ${s.streak} · best ${s.best} · ${s.cleared} cleared`))
      .child(h_flex().gap(4).children(days.map(cell)));
  }

  // ----- navigation: the same row on every page -----
  nav() {
    const t = theme();
    return h_flex().gap(6).children(PAGES.map(([view, name]) => {
      const on = view === this.view;
      return div().id(`nav-${view}`).h(30).px(14).flex().items_center().border(1)
        .border_color(on ? GLOW : t.border).bg(on ? GLOW + "1a" : PANEL)
        .text_size(11.5).font_semibold().text_color(on ? GOLD : t.muted)
        .when(!on, (el) => el.hover((st) => st.bg(GLOW + "10").text_color(INK)).on_click(() => openPage(view)))
        .child(name);
    }));
  }

  // A shortcut tile on the overview: a framed card that opens its page.
  tile(view, title, big, sub, extra, color = GLOW) {
    const t = theme();
    return div().id(`tile-${view}`).flex_1().min_w(0).hover((st) => st.bg(color + "0a")).on_click(() => openPage(view))
      .child(this.card(title, "OPEN ›", [
        h_flex().gap(12).items_end()
          .child(div().font_family(TITLE_FONT).text_size(38).text_color(INK).child(big))
          .child(div().pb(6).truncate().text_size(11).text_color(t.muted).child(sub)),
        ...extra,
      ], { color }));
  }

  overview(s) {
    const t = theme(), d = s.daily, list = agents() || [], A = army(s), tok = shared("sl.tokens");
    const done = d ? d.quests.filter((q) => q.progress >= q.target).length : 0, total = d ? d.quests.length : 0;
    const mins = (() => { const n = new Date(), e = new Date(n); e.setHours(24, 0, 0, 0); return Math.max(0, Math.round((e - n) / 60000)); })();
    let n = 0;   // the tiles stay one line per item; hover shows the full text
    const line = (dotColor, text, right) => h_flex().id(`ov-ln-${n++}`).h(22).gap(8).items_center().tooltip(text)
      .child(div().size(6).flex_none().bg(dotColor))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(INK).child(text))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(right || ""));

    const open = d ? d.quests.filter((q) => q.progress < q.target).slice(0, 3) : [];
    const quests = this.tile("quests", "DAILY QUEST", `${done}/${total}`, d?.claimed ? "cleared · rewards received" : `cleared · ${Math.floor(mins / 60)}h ${mins % 60}m left`, [
      this.bar(done, Math.max(1, total), d?.claimed ? GLOW : VIOLET, 5),
      ...(open.length ? open.map((q) => line(q.id === "penalty" ? RED : GLOW, q.label, `[${q.progress}/${q.target}]`)) : [line(GLOW, "All quests cleared.", "")]),
    ], s.penalty ? RED : GLOW);

    const st = (addr) => (list.find((a) => a.address === addr) || {}).status;
    const working = list.filter((a) => a.status === "working").length, blocked = list.filter((a) => a.status === "blocked").length;
    const shadows = this.tile("shadows", "SHADOW ARMY", String(A.length), `soldiers · ${working} in combat · ${blocked} await command`, [
      ...A.slice(0, 4).map((x) => { const live = alive(x.terminal), k = live ? st(x.terminal) : null;
        return line(!live ? t.dim : k === "blocked" ? RED : k === "working" ? t.working : GLOW, `${x.name} · ${x.role}`, live ? (k || "summoned").toUpperCase() : "DORMANT"); }),
    ], blocked ? RED : GLOW);

    let usage;
    if (tok) {
      const today = tok.days[tok.days.length - 1];
      const perDay = tok.days.map((day) => Object.values(tok.models).reduce((a, m) => a + tokAll(m[day]), 0));
      const max = Math.max(1, ...perDay);
      const top = Object.entries(tok.models).map(([m, v]) => [m, tokAll(v[today])]).sort((a, b) => b[1] - a[1])[0];
      usage = this.tile("usage", "TOKEN USAGE", fmtTok(perDay[perDay.length - 1]), `today${top && top[1] ? ` · mostly ${top[0]}` : ""}`, [
        h_flex().h(48).gap(3).items_end().children(perDay.map((v, i) => div().flex_1().h(Math.max(2, Math.round((v / max) * 48)))
          .bg(i === perDay.length - 1 ? GLOW : GLOW + "55"))),
        div().text_size(10).text_color(t.dim).child(`${fmtTok(perDay.reduce((a, b) => a + b, 0))} over 14 days · ${tok.machines.join(" + ")}`),
      ], VIOLET);
    } else usage = this.tile("usage", "TOKEN USAGE", "…", "counting", [], VIOLET);

    const profile = this.tile("profile", "PROFILE", `Lv ${s.level}`, `${rankOf(s.level)}-Rank · ${jobOf(s.level) === "None" ? "no job yet" : jobOf(s.level)}`, [
      this.bar(s.xp, need(s.level), GLOW, 5),
      line(GOLD, `${s.points} ability points to spend`, ""),
      line(VIOLET, `${s.titles.length}/${Object.keys(TITLES).length} titles · ${SKILLS.filter(([lv]) => s.level >= lv).length}/${SKILLS.length} skills`, ""),
      line(GOLD, `${s.inventory.box || 0} random boxes · ${s.gold} gold`, ""),
    ], GOLD);

    const recent = this.card("LATEST FROM THE SYSTEM", "", (s.log.length ? s.log : [{ t: Date.now(), text: "The System has chosen you as its Player." }]).slice(0, 6)
      .map((e) => h_flex().gap(12).py(3).items_start()
        .child(div().w(40).flex_none().text_size(10).text_color(t.dim).child(new Date(e.t).toTimeString().slice(0, 5)))
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.muted).child(e.text))), { pad: 12 });

    const L = limitOf(s), used = todayDispatches(L).length, rated = L.dispatches.filter((x) => x.rating != null);
    const limit = this.tile("limit", "LIMIT BREAKER", `${used}/${L.cap}`, `dispatched today · next run ${L.enabled ? nextSlot(L) : "off"} · ROI ${rated.length ? Math.round((rated.filter((x) => x.rating > 0).length / rated.length) * 100) + "%" : "—"}`, [
      ...((L.last?.moves || []).slice(0, 2).map((m, i) => line(GOLD, `${i + 1}. ${m.title}`, ""))),
      ...todayDispatches(L).slice(-2).map((r) => line(r.status === "failed" ? RED : r.status === "done" ? GLOW : t.working, `${r.soldier}: ${r.title}`, r.status.toUpperCase())),
    ], GOLD);
    const grid = v_flex().gap(24)
      .child(h_flex().gap(24).items_start().child(quests).child(shadows))
      .child(h_flex().gap(24).items_start().child(usage).child(profile))
      .child(limit);
    return this.width >= 1000
      ? h_flex().gap(24).items_start()
        .child(v_flex().w(340).flex_none().gap(24).child(this.status(s)).child(recent))
        .child(v_flex().flex_1().min_w(0).child(grid))
      : v_flex().gap(24).child(grid).child(this.status(s)).child(recent);
  }

  // ----- LIMIT BREAK: Bellion's plan, his dispatches and their ROI -----
  limitPage(s) {
    const t = theme(), L = limitOf(s), busy = !!shared("sl.limit.busy"), list = agents() || [];
    const used = todayDispatches(L).length, left = Math.max(0, L.cap - used);
    const rated = L.dispatches.filter((x) => x.rating != null), worth = rated.filter((x) => x.rating > 0).length;
    const finished = L.dispatches.filter((x) => x.status === "done").length;
    const roi = rated.length ? `${Math.round((worth / rated.length) * 100)}%` : "—";

    const control = this.card("BELLION · LIMIT BREAKER", busy ? "surveying…" : `next run ${L.enabled ? nextSlot(L) : "off"}`, [
      h_flex().gap(16).items_center()
        .child(image("mods/sl-system/art/beru.png").w(56).h(56).flex_none())
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().text_size(15).font_bold().text_color(INK).child("Grand Marshal Bellion"))
          .child(busy ? div().text_size(12).text_color(INK).child("Reading your Jira, PRs, quests and shadows…") : this.voice(L.last?.message || "Awaiting the first survey.", { size: 16, center: false }))
          .child(div().text_size(10.5).text_color(t.dim).child(L.last ? `last survey ${new Date(L.last.at).toTimeString().slice(0, 5)} (${L.last.why})` : "Runs on weekdays at 9, 11, 13, 15 and 17."))),
      h_flex().gap(12).items_center().pt(4)
        .child(this.kvBox("TODAY", `${used} / ${L.cap}`, "dispatches"))
        .child(this.kvBox("FINISHED", String(finished), "all time"))
        .child(this.kvBox("ROI", roi, `${worth}/${rated.length} rated worth it`))
        .child(v_flex().gap(6).w(180).flex_none()
          .child(div().text_size(10).text_color(t.dim).child("DAILY BUDGET"))
          .child(h_flex().gap(6).items_center()
            .child(this.btn("cap-dn", "−", () => update((x) => { const l = limitOf(x); l.cap = Math.max(0, l.cap - 1); x.limit = l; }), { color: t.muted, disabled: L.cap <= 0 }))
            .child(div().w(28).flex().justify_center().text_size(15).font_bold().text_color(INK).child(String(L.cap)))
            .child(this.btn("cap-up", "+", () => update((x) => { const l = limitOf(x); l.cap = Math.min(10, l.cap + 1); x.limit = l; }), { color: t.muted }))
            .child(this.btn("limit-on", L.enabled ? "AUTO ON" : "AUTO OFF", () => update((x) => { const l = limitOf(x); l.enabled = !l.enabled; x.limit = l; }), { w: 76, color: L.enabled ? GLOW : t.dim, tip: "Scheduled runs (the button still works when off)" })))),
      div().text_size(10.5).text_color(t.dim).child(`${left} autonomous ${left === 1 ? "dispatch" : "dispatches"} left today. Every dispatch works on a local branch only: no push, merge, approval, PR comment or Jira change without you.`),
    ], { color: GOLD });

    const mv = L.last?.moves || [];
    const field = (id, state) => div().id(id).flex_1().min_w(0).h(30).px(10).flex().items_center().border(1).border_color(GLOW).bg(FIELD)
      .cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(state).h_full().w_full().text_size(12).text_color(INK));
    const moveRow = (m, i) => {
      const n = mv.length;
      if (this.editIdx === i) return h_flex().gap(8).py(8).items_center().border_b(1).border_color(t.border)
        .child(div().w(20).flex_none().text_size(13).font_bold().text_color(GOLD).child(String(i + 1)))
        .child(field(`mv-edit-${i}`, this.moveEditor))
        .child(this.btn(`mv-save-${i}`, "SAVE", (cx) => { moveEdit(i, this.moveEditor.value() || ""); this.editIdx = null; cx.notify(); }, { w: 52 }))
        .child(this.btn(`mv-cancel-${i}`, "✕", (cx) => { this.editIdx = null; cx.notify(); }, { color: t.muted, tip: "Cancel" }));
      // Full text, wrapped: the title, why, then a button per linked PR or ticket.
      return h_flex().gap(10).py(10).items_start().border_b(1).border_color(t.border)
        .child(div().w(20).flex_none().text_size(13).font_bold().text_color(GOLD).child(String(i + 1)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(6).items_start().min_w(0)
            .when(m.by === "you", (el) => el.child(div().flex_none().mt(1).px(4).h(16).flex().items_center().border(1).border_color(GLOW + "88").text_size(9).font_bold().text_color(GOLD).child("YOU")))
            .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(INK).child(m.title || "")))
          .when(!!m.why, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(m.why)))
          .child(this.links(`mv-${i}`, m.url, m.title, m.why)))
        .child(v_flex().flex_none().gap(4)
          .child(h_flex().gap(4)
            .child(this.btn(`mv-up-${i}`, "▲", () => moveUp(i), { color: t.muted, disabled: i === 0, tip: "Move up" }))
            .child(this.btn(`mv-dn-${i}`, "▼", () => moveDown(i), { color: t.muted, disabled: i === n - 1, tip: "Move down" })))
          .child(h_flex().gap(4)
            .child(this.btn(`mv-ed-${i}`, "✎", (cx) => { this.editIdx = i; this.moveEditor.set_value(m.title || ""); cx.notify(); }, { color: t.muted, tip: "Edit" }))
            .child(this.btn(`mv-x-${i}`, "✕", () => { moveDrop(i); if (this.editIdx === i) this.editIdx = null; }, { color: t.muted, tip: "Remove" }))));
    };
    const adder = h_flex().gap(8).pt(8).items_center()
      .child(div().w(20).flex_none().text_size(13).font_bold().text_color(t.dim).child("+"))
      .child(div().id("mv-add-field").flex_1().min_w(0).h(30).px(10).flex().items_center().border(1).border_color(t.border).bg(FIELD)
        .cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.moveAdder).h_full().w_full().text_size(12).text_color(INK)))
      .child(this.btn("mv-add", "ADD", (cx) => { moveAdd(this.moveAdder.value() || ""); this.moveAdder.set_value(""); cx.notify(); }, { w: 52 }));
    const moves = this.card("NEXT MOVES", L.edited ? "your order · Bellion keeps it next run" : L.last ? "ranked by Bellion · reorder or edit freely" : "", [
      ...(mv.length ? [this.colHead([["#", 20], ["MOVE", "flex"], ["", 60]]), ...mv.map(moveRow)]
        : [div().text_size(12).text_color(t.dim).child("No moves yet. Press BREAK LIMIT NOW, or add your own below.")]),
      adder,
    ]);

    const stateOf = (r) => {
      if (r.status === "failed") return ["FAILED", RED];
      if (r.status === "done") return ["DONE", GLOW];
      const a = list.find((x) => x.address === r.terminal);
      if (!a) return alive(r.terminal) ? ["RUNNING", t.working] : ["GONE", t.dim];
      return a.status === "blocked" ? ["AWAITS YOU", RED] : a.status === "working" ? ["IN COMBAT", t.working] : ["STANDING BY", t.muted];
    };
    // One job per row: time | the job (full text, click for the whole order) and under it
    // who · state · its links, with the ROI vote and FOCUS on the right of that line.
    const W = { at: 48 };
    const rows = L.dispatches.slice().reverse().slice(0, 20).map((r) => {
      const [label, col] = stateOf(r);
      const open = !!this.openJobs?.[r.id];
      return h_flex().gap(12).py(10).items_start().border_b(1).border_color(t.border)
        .child(v_flex().w(W.at).flex_none()
          .child(div().text_size(11).text_color(INK).child(new Date(r.at).toTimeString().slice(0, 5)))
          .child(div().text_size(9.5).text_color(t.dim).child(r.day === today() ? "today" : r.day.slice(5))))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(v_flex().id(`job-${r.id}`).gap(3).cursor_pointer()
            .tooltip(open ? "Click to fold the order" : "Click to read the full order")
            .on_click((_e, cx) => { this.openJobs = { ...(this.openJobs || {}), [r.id]: !open }; cx.notify(); })
            .child(h_flex().gap(6).items_start()
              .child(div().flex_none().text_size(10).text_color(t.dim).child(open ? "▾" : "▸"))
              .child(div().flex_1().min_w(0).text_size(12.5).font_semibold().text_color(INK).child(r.title)))
            .child(div().text_size(11).text_color(r.error ? RED : t.muted).child(r.error || r.why || ""))
            .when(open && !!r.task, (el) => el.child(div().mt(2).p(8).rounded(6).bg(FIELD).border(1).border_color(t.border)
              .text_size(11).text_color(INK).child(r.task))))
          .child(this.links(`job-${r.id}`, r.url, r.title, r.why, open ? r.task : ""))
          .child(h_flex().gap(8).items_center().pt(2)
            .child(div().flex_none().text_size(11).text_color(VIOLET).child(r.soldier || "—"))
            .child(div().flex_none().text_size(10).text_color(t.dim).child("·"))
            .child(div().flex_none().text_size(10).font_semibold().text_color(col).child(label))
            .child(div().flex_1())
            .child(div().flex_none().text_size(9.5).text_color(t.dim).child("ROI"))
            .child(this.btn(`up-${r.id}`, "▲", () => rate(r.id, 1), { color: r.rating > 0 ? GLOW : t.muted, tip: "Worth it" }))
            .child(this.btn(`dn-${r.id}`, "▼", () => rate(r.id, -1), { color: r.rating < 0 ? RED : t.muted, tip: "Not worth it" }))
            .when(!!(r.terminal && alive(r.terminal)), (el) => el.child(this.btn(`go-${r.id}`, "FOCUS", () => run("agent.focus", { terminal: r.terminal }), { w: 56, color: t.muted })))));
    });
    const log = this.card("DISPATCHES", `${L.dispatches.length} total · rate each one to measure ROI`, rows.length
      ? [this.colHead([["WHEN", W.at], ["JOB", "flex"]]), ...rows]
      : [div().text_size(12).text_color(t.dim).child("Nothing dispatched yet.")]);

    return v_flex().gap(16).child(control).child(this.width >= 1100
      ? h_flex().gap(16).items_start().child(v_flex().flex_1().min_w(0).child(moves)).child(v_flex().flex_1().min_w(0).child(log))
      : v_flex().gap(16).child(moves).child(log));
  }
  kvBox(label, value, sub) {
    const t = theme();
    return v_flex().flex_1().min_w(0).gap(2).p(10).border(1).border_color(t.border).bg(FIELD)
      .child(div().text_size(10).text_color(t.dim).child(label))
      .child(div().text_size(20).font_bold().text_color(INK).child(value))
      .child(div().truncate().text_size(10).text_color(t.muted).child(sub));
  }

  // ----- Claude limits: the 5-hour and weekly limits, forecast, today's cost, each agent (herdr-claude-usage) -----
  claudeLimits() {
    const t = theme(), s = shared(CLAUDE_KEY);
    if (!s) return this.card("CLAUDE LIMITS", "reading…", [div().h(60).flex().items_center().justify_center().text_size(12).text_color(t.dim).child("Reading your limits and Claude Code's transcripts…")], { color: GOLD });
    const lvl = (p) => (p >= 95 ? RED : p >= 80 ? GOLD : GLOW);
    const q = s.quota || {}, wins = q.windows || [];
    const note = { "signed-out": "Account limits need Claude Code's sign-in (run claude /login).", expired: "Claude Code's sign-in has expired; it renews on its next request.", error: `Couldn't read account limits${q.error ? ` (${q.error})` : ""}. Retrying in a few minutes.`, none: "This account reports no usage limits." }[q.state];
    const limitRow = (w) => {
      const f = claudeForecast(w, t), resets = w.resets ? `resets in ${claudeUntil(claudeTime(w.resets))}` : "";
      return v_flex().gap(3).py(4)
        .child(h_flex().gap(12).items_center()
          .child(div().w(110).flex_none().text_size(12).text_color(t.muted).child(w.label))
          .child(div().flex_1().child(this.bar(w.pct, 100, lvl(w.pct), 8)))
          .child(div().w(44).flex_none().flex().justify_end().text_size(13).font_bold().text_color(lvl(w.pct)).child(`${Math.round(w.pct)}%`))
          .child(div().w(130).flex_none().flex().justify_end().text_size(11).text_color(t.dim).child(resets)))
        .when(!!f, (el) => el.child(div().pl(122).text_size(10.5).text_color(f[1] === t.ansi1 ? RED : f[1] === t.ansi3 ? GOLD : t.dim).child(f[0])));
    };
    const d = s.today, rows = claudeAgents(s).filter((a) => a.usage).sort((a, b) => b.usage.cost - a.usage.cost);
    const stats = d ? h_flex().gap(12).items_center().pt(4)
      .child(this.kvBox("TODAY", claudeUsd(d.cost), `${d.sessions} session${d.sessions === 1 ? "" : "s"} · ${claudeTok(d.replies)} replies`))
      .child(this.kvBox("7 DAYS", claudeUsd((s.history || []).reduce((n, x) => n + x.cost, 0)), "est. at API list prices"))
      .child(this.kvBox("TOP SPENDER", s.top ? claudeUsd(s.top.perMin) + "/min" : "—", s.top ? ((claudeAgents(s).find((a) => a.address === s.top.address) || {}).title || s.top.address) : "no agent spending now")) : null;
    const agentLine = (a) => h_flex().id(`cl-ag-${a.address}`).h(28).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(INK).child(a.title || a.address))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${a.usage.model || ""} · in ${claudeTok(a.usage.input)} · out ${claudeTok(a.usage.output)} · cache ${claudeTok(a.usage.read)}`))
      .child(div().w(70).flex_none().flex().justify_end().text_size(12).font_semibold().text_color(INK).child(a.usage.unpriced ? `${claudeUsd(a.usage.cost)}+` : claudeUsd(a.usage.cost)));
    const days = s.history || [], mx = Math.max(0.01, ...days.map((x) => x.cost));
    const week = days.length ? h_flex().gap(5).items_end().children(days.map((x, i) => v_flex().flex_1().min_w(0).items_center().gap(3)
      .child(div().text_size(9).text_color(t.dim).child(x.cost > 0 ? claudeUsd(x.cost).replace(/\.\d\d$/, "") : "–"))
      .child(v_flex().h(40).w_full().justify_end().child(div().w_full().h(Math.max(2, Math.round((x.cost / mx) * 40))).bg(i === days.length - 1 ? GLOW : GLOW + "55")))
      .child(div().text_size(9).text_color(t.dim).child("SMTWTFS"[new Date(`${x.date}T12:00:00`).getDay()])))) : null;
    return this.card("CLAUDE LIMITS", `${q.plan || "Claude"}${s.beat ? ` · updated ${Math.max(0, Math.round((Date.now() - s.beat) / 60000))}m ago` : ""}`, [
      ...wins.map(limitRow),
      ...(note && q.state !== "ok" ? [div().text_size(11.5).text_color(t.dim).child(note)] : []),
      ...(stats ? [stats] : []),
      ...(week ? [week] : []),
      ...(rows.length ? [div().pt(6).text_size(10).text_color(t.dim).child(`AGENTS IN HERDR (${rows.length})`), ...rows.map(agentLine)] : []),
      div().text_size(10).text_color(t.dim).child("Costs are estimates at API list prices; a subscription isn't billed per token."),
    ], { color: GOLD });
  }

  // ----- token usage: stacked bars per day, by model -----
  tokens() {
    const t = theme(), data = shared("sl.tokens");
    const METRICS = [["total", "TOTAL", (u) => u.in + u.out + u.cw + u.cr], ["out", "OUTPUT", (u) => u.out], ["input", "INPUT", (u) => u.in + u.cw + u.cr], ["cr", "CACHE READS", (u) => u.cr]];
    const metric = METRICS.find(([k]) => k === (this.metric || "total")) || METRICS[0];
    const val = metric[2];
    const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
    const tint = (m) => (/opus/.test(m) ? PURPLE : /sonnet/.test(m) ? GLOW : /haiku/.test(m) ? "#3ef0b2" : /fable/.test(m) ? GOLD : "#ff7a90");
    const ago = data ? Math.max(0, Math.round((Date.now() - data.updated) / 60000)) : 0;
    const refresh = this.btn("tok-refresh", "↻", () => setShared("sl.tokens.ask", Date.now()), { color: t.muted, tip: "Count again now" });
    const chips = h_flex().gap(4).children(METRICS.map(([k, label]) => this.btn(`tm-${k}`, label, (cx) => { this.metric = k; cx.notify(); },
      { w: label.length * 7 + 20, color: (this.metric || "total") === k ? GLOW : t.muted })));
    if (!data) return this.card("TOKEN USAGE", "counting…", [h_flex().justify_between().child(chips).child(refresh),
      div().h(120).flex().items_center().justify_center().text_size(12).text_color(t.dim).child("Reading Claude Code's session logs on this Mac and your machines…")]);

    const models = Object.keys(data.models).map((m) => ({ m, total: data.days.reduce((a, d) => a + (data.models[m][d] ? val(data.models[m][d]) : 0), 0),
      out: data.days.reduce((a, d) => a + (data.models[m][d]?.out || 0), 0) })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
    const dayTotal = (d) => models.reduce((a, x) => a + (data.models[x.m][d] ? val(data.models[x.m][d]) : 0), 0);
    const max = Math.max(1, ...data.days.map(dayTotal));
    const all = models.reduce((a, x) => a + x.total, 0);
    const H = 168, today = data.days[data.days.length - 1];

    const column = (d) => {
      const dt = new Date(`${d}T12:00:00`), tot = dayTotal(d), isToday = d === today;
      const stack = v_flex().w_full().h(H).justify_end()
        .children(models.slice().reverse().map((x) => {
          const v = data.models[x.m][d] ? val(data.models[x.m][d]) : 0;
          const h = Math.round((v / max) * H);
          return h > 0 ? div().w_full().h(h).bg(tint(x.m) + (isToday ? "ff" : "cc")).border_t(1).border_color("#020611").tooltip(`${d} · ${x.m}: ${fmt(v)}`) : null;
        }).filter(Boolean));
      return v_flex().flex_1().min_w(0).gap(4).items_center()
        .child(div().h(14).text_size(9).text_color(tot ? t.muted : "#00000000").child(fmt(tot)))
        .child(div().w_full().px(3).child(stack))
        .child(div().text_size(10).text_color(isToday ? GOLD : t.dim).child(String(dt.getDate())))
        .child(div().text_size(9).text_color(isToday ? GOLD : t.dim).child("SMTWTFS"[dt.getDay()]));
    };
    const axis = v_flex().w(44).flex_none().h(H).mt(18).justify_between().items_end().text_size(9).text_color(t.dim)
      .child(fmt(max)).child(fmt(max / 2)).child("0");
    const grid = div().relative().flex_1().min_w(0)
      .child(div().absolute().left(0).right(0).top(18).h(1).bg(t.border))
      .child(div().absolute().left(0).right(0).top(18 + H / 2).h(1).bg(t.border))
      .child(div().absolute().left(0).right(0).top(18 + H).h(1).bg(GLOW + "55"))
      .child(h_flex().gap(2).children(data.days.map(column)));

    const W = { sw: 16, total: 90, share: 150, out: 90 };
    const legend = v_flex()
      .child(this.colHead([["", W.sw], ["MODEL", "flex"], [metric[1], W.total, "right"], ["SHARE", W.share, "right"], ["OUTPUT", W.out, "right"]]))
      .children(models.map((x) => h_flex().h(30).gap(12).items_center().border_b(1).border_color(t.border)
        .child(div().w(W.sw).flex_none().flex().justify_center().child(div().size(10).bg(tint(x.m))))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(INK).child(x.m))
        .child(div().w(W.total).flex_none().flex().justify_end().text_size(12).font_semibold().text_color(INK).child(fmt(x.total)))
        .child(h_flex().w(W.share).flex_none().gap(8).items_center()
          .child(div().flex_1().child(this.bar(x.total, all, tint(x.m), 4)))
          .child(div().w(36).flex_none().flex().justify_end().text_size(11).text_color(t.muted).child(`${Math.round((x.total / Math.max(1, all)) * 100)}%`)))
        .child(div().w(W.out).flex_none().flex().justify_end().text_size(11).text_color(t.muted).child(fmt(x.out)))));

    return this.card("TOKEN USAGE", `${fmt(all)} ${metric[1].toLowerCase()} · 14 days · ${data.machines.join(" + ")} · ${ago ? `${ago}m ago` : "just now"}`, [
      h_flex().justify_between().items_center().child(chips).child(refresh),
      h_flex().gap(8).items_start().child(axis).child(grid),
      legend,
    ]);
  }

  // ----- shadow army -----
  selected(s) { const a = army(s); return a.find((x) => x.id === this.sel) || a[0] || null; }
  sendOrder(cx) {
    const s = getState(), m = this.selected(s), text = (this.cmd.value() || "").trim();
    if (!m || !text) return;
    this.cmd.set_value("");
    cx.spawn(async () => { await order(m.id, text); });
  }
  shadows(s) {
    const t = theme(), list = agents() || [], A = army(s), m = this.selected(s);
    const color = { working: t.working, blocked: RED, done: t.done, idle: t.dim };
    const word = { working: "IN COMBAT", blocked: "AWAITS COMMAND", done: "RETURNED", idle: "STANDING BY" };
    const statusOf = (addr) => (list.find((a) => a.address === addr) || {}).status;
    const W = { dot: 16, post: 150, rank: 120, state: 116, act: 120 };
    const cols = (first) => [["", W.dot], [first, "flex"], ["POST", W.post], ["RANK", W.rank, "right"], ["STATE", W.state, "right"], ["", W.act]];
    const dot = (st, live) => div().w(W.dot).flex_none().flex().justify_center()
      .child(div().size(8).bg(live ? (color[st] || GLOW) : "#00000000").border(1).border_color(live ? (color[st] || GLOW) : t.dim)
        .when(st === "blocked" || st === "working", (e) => e.loop("opacity", { from: 0.3, to: 1, period: 900 })));
    const where = (machine, name) => `${name || "—"}${machine ? ` @ ${machine}` : ""}`;

    // A standing soldier: its row, then its saved orders.
    const soldier = (x) => {
      const live = alive(x.terminal), st = live ? statusOf(x.terminal) : null, on = m && m.id === x.id;
      return v_flex().border_b(1).border_color(t.border).bg(on ? GLOW + "10" : "#00000000")
        .child(h_flex().id(`army-${x.id}`).h(48).gap(12).items_center().on_click((_e, cx) => { this.sel = x.id; cx.notify(); })
          .child(dot(st, live))
          .child(v_flex().id(`army-txt-${x.id}`).flex_1().min_w(0).tooltip(`${x.name} · ${x.role}${x.folder ? `\n${x.folder}` : ""}`)
            .child(h_flex().gap(8).items_center()
              .child(div().text_size(13).font_bold().text_color(on ? GOLD : INK).child(x.name))
              .child(div().truncate().text_size(11).text_color(t.muted).child(x.role)))
            .child(div().truncate().text_size(10).text_color(t.dim).child(x.folder || "")))
          .child(div().w(W.post).flex_none().truncate().text_size(11).text_color(t.muted).child(where(x.machine, x.spaceName)))
          .child(v_flex().w(W.rank).flex_none().items_end()
            .child(div().text_size(11).text_color(GOLD).child(shadowRank(x.cleared)))
            .child(div().text_size(10).text_color(t.dim).child(`${x.cleared || 0} cleared`)))
          .child(div().w(W.state).flex_none().flex().justify_end().text_size(10).font_semibold()
            .text_color(live ? (color[st] || GOLD) : t.dim).child(live ? (word[st] || "SUMMONED") : "DORMANT"))
          .child(h_flex().w(W.act).flex_none().gap(4).justify_end()
            .child(this.btn(`sum-${x.id}`, live ? "FOCUS" : "SUMMON", () => summon(x.id), { w: 84, color: live ? GLOW : VIOLET, tip: live ? "Go to its agent" : "Raise its agent at its post" }))
            .child(this.btn(`rel-${x.id}`, "✕", () => { release(x.id); if (this.sel === x.id) this.sel = null; }, { color: t.muted, tip: "Release from the army (its agent keeps running)" }))))
        .when((x.orders || []).length > 0, (el) => el.child(h_flex().pl(28).pb(8).gap(6).flex_wrap()
          .children(x.orders.map((o, i) => h_flex().id(`ord-${x.id}-${i}`).h(22).px(8).gap(6).items_center()
            .border(1).border_color(VIOLET + "66").bg(VIOLET + "10").hover((st2) => st2.bg(VIOLET + "26"))
            .tooltip(`${o.task}\n\nClick: give this order · right-click: delete it`)
            .on_click(() => order(x.id, o.task))
            .on_mouse_down("right", () => dropOrder(x.id, i))
            .child(div().text_size(10).text_color(VIOLET).child("▸"))
            .child(div().text_size(10.5).text_color(INK).child(o.label))))));
    };

    // An agent that isn't in the army: named, ranked, and one click from joining.
    const passing = list.filter((a) => !soldierOf(s, a.address));
    const wanderer = (a) => {
      const n = s.names?.[a.address];
      return h_flex().id(`adhoc-${a.address}`).h(44).gap(12).items_center().border_b(1).border_color(t.border)
        .bg(a.status === "blocked" ? RED + "14" : "#00000000").hover((st) => st.bg(GLOW + "0c"))
        .child(dot(a.status, true))
        .child(v_flex().id(`adhoc-txt-${a.address}`).flex_1().min_w(0).tooltip(a.tab_name || a.title || a.address)
          .child(div().text_size(12.5).font_semibold().text_color(INK).child(n?.name || "Unnamed"))
          .child(div().truncate().text_size(10.5).text_color(t.muted).child(a.tab_name || a.title || a.address)))
        .child(div().w(W.post).flex_none().truncate().text_size(11).text_color(t.muted).child(where(null, a.space_name)))
        .child(v_flex().w(W.rank).flex_none().items_end()
          .child(div().text_size(11).text_color(GOLD).child(shadowRank(n?.cleared)))
          .child(div().text_size(10).text_color(t.dim).child(`${n?.cleared || 0} cleared`)))
        .child(div().w(W.state).flex_none().flex().justify_end().text_size(10).font_semibold().text_color(color[a.status] || t.dim).child(word[a.status] || a.status))
        .child(h_flex().w(W.act).flex_none().gap(4).justify_end()
          .child(this.btn(`go-${a.address}`, "FOCUS", () => run("agent.focus", { terminal: a.address }), { w: 56, color: t.muted }))
          .child(this.btn(`arise-${a.address}`, "ARISE", () => arise(a), { w: 56, color: VIOLET, tip: "Make it a standing soldier: it keeps its name and terminal for repeated orders" })));
    };

    const all = spaces() || [], post = all.length ? all[this.post % all.length] : null;
    const bar = h_flex().gap(8).items_center().pt(4)
      .child(div().w(96).flex_none().truncate().text_size(11).font_bold().text_color(m ? GOLD : t.dim).child(m ? `→ ${m.name}` : "→ no soldier"))
      .child(div().id("sl-cmd").flex_1().min_w(0).h(30).px(10).flex().items_center().border(1)
        .border_color(this.typing ? GLOW : t.border).bg(FIELD).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.cmd).h_full().w_full().text_size(12).text_color(INK)))
      .child(this.btn("cmd-send", "ORDER", (cx) => this.sendOrder(cx), { w: 64, disabled: !m, tip: m ? `Send to ${m.name}'s agent (summons it if dormant). Enter works too.` : "" }))
      .child(this.btn("cmd-save", "SAVE", () => { if (m) { saveOrder(m.id, this.cmd.value() || ""); this.cmd.set_value(""); } }, { w: 52, color: VIOLET, disabled: !m, tip: "Save the text as a repeatable order for this soldier" }));
    const raise = h_flex().gap(8).items_center()
      .child(div().w(96).flex_none().text_size(10).text_color(t.dim).child("NEW SOLDIER AT"))
      .child(div().id("post-cycle").flex_1().min_w(0).h(26).px(10).flex().items_center().border(1).border_color(t.border)
        .hover((st) => st.bg(GLOW + "10")).on_click((_e, cx) => { this.post += 1; cx.notify(); })
        .tooltip("Click to choose another space")
        .child(div().truncate().text_size(11).text_color(INK).child(post ? `${post.name}${post.machine ? ` @ ${post.machine}` : ""}  ·  ${post.folder || "~"}` : "—")))
      .child(this.btn("raise", "RAISE", () => { newSoldier((this.cmd.value() || "").trim(), post); this.cmd.set_value(""); }, { w: 124, color: VIOLET, tip: "Raise a new standing soldier here; the text box becomes its role" }));

    return this.card("SHADOW ARMY", `${A.length} soldiers · ${passing.length} passing · ${s.dungeons} dungeons cleared`, [
      this.colHead(cols("STANDING ARMY")),
      A.length ? v_flex().children(A.map(soldier)) : div().py(8).text_size(11).text_color(t.dim).child("No standing soldiers. ARISE an agent below, or RAISE a new one."),
      bar,
      raise,
      div().h(8),
      this.colHead(cols("PASSING SHADOWS")),
      passing.length ? v_flex().children(passing.map(wanderer)) : div().py(8).text_size(11).text_color(t.dim).child("No other agents running."),
    ]);
  }

  // ----- inventory: item | count | action -----
  inventory(s) {
    const t = theme(), inv = s.inventory;
    const item = (id, name, n, desc, label, fn, color = GLOW) => h_flex().h(44).gap(12).items_center()
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12).text_color(INK).child(name))
        .child(div().truncate().text_size(10).text_color(t.dim).child(desc)))
      .child(div().w(28).flex_none().flex().justify_end().text_size(13).font_semibold().text_color(n > 0 ? INK : t.dim).child(`×${n || 0}`))
      .child(this.btn(id, label, fn, { color, disabled: !(n > 0), w: 56 }));
    return this.card("INVENTORY", `${s.gold} gold`, [
      item("i-box", "Random Box", inv.box, "From each Daily Quest", "OPEN", openBox, GOLD),
      item("i-potion", "Recovery Potion", inv.potion, "Removes 50 fatigue", "USE", usePotion),
      item("i-key", "Instant Dungeon Key", inv.key, "Clear a dungeon: 150 EXP", "USE", useKey, VIOLET),
      div().h(1).bg(t.border),
      h_flex().h(44).gap(12).items_center()
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_size(12).text_color(INK).child("Shop: Recovery Potion"))
          .child(div().text_size(10).text_color(t.dim).child("200 gold")))
        .child(this.btn("i-buy", "BUY", buyPotion, { color: GOLD, disabled: s.gold < 200, w: 56 })),
    ]);
  }

  // ----- skills: level | skill -----
  skills(s) {
    const t = theme();
    return this.card("SKILLS", `${SKILLS.filter(([lv]) => s.level >= lv).length}/${SKILLS.length} unlocked`, SKILLS.map(([lv, name, desc]) => {
      const has = s.level >= lv;
      return h_flex().h(36).gap(12).items_center()
        .child(div().w(44).flex_none().text_size(10).font_semibold().text_color(has ? GOLD : t.dim).child(`LV ${lv}`))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(12).text_color(has ? INK : t.dim).child(has ? name : "Locked"))
          .when(has, (e) => e.child(div().truncate().text_size(10).text_color(t.muted).child(desc))));
    }), { pad: 12 });
  }

  // ----- titles -----
  titles(s) {
    const t = theme();
    return this.card("TITLES", "click to equip", Object.entries(TITLES).map(([name, how]) => {
      const has = s.titles.includes(name), on = s.title === name;
      return h_flex().id(`title-${name}`).h(44).gap(12).items_center()
        .when(has, (el) => el.hover((st) => st.bg(GLOW + "10")).on_click(() => update((x) => { x.title = name; })))
        .child(div().w(16).flex_none().flex().justify_center().child(div().size(10).border(1).border_color(on ? VIOLET : t.dim).bg(on ? VIOLET : "#00000000")))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(12).text_color(has ? INK : t.dim).child(has ? name : "???"))
          .child(div().truncate().text_size(10).text_color(t.dim).child(how)));
    }), { pad: 12 });
  }

  // ----- log: time | event -----
  logCard(s) {
    const t = theme();
    const list = s.log.length ? s.log : [{ t: Date.now(), text: "The System has chosen you as its Player." }];
    return this.card("SYSTEM LOG", "", list.slice(0, 14).map((e) => h_flex().gap(12).items_start().py(4)
      .child(div().w(40).flex_none().text_size(10).text_color(t.dim).child(new Date(e.t).toTimeString().slice(0, 5)))
      .child(div().flex_1().min_w(0).text_size(11).text_color(t.muted).child(e.text))), { pad: 12 });
  }

  render() {
    if (this.view === "engine") return div();
    const t = theme(), s = getState(), w = this.width;
    const col = (width, items) => {
      const c = v_flex().gap(24).children(items);
      return width ? c.w(width).flex_none() : c.flex_1().min_w(0);
    };
    let body;
    switch (this.view) {
      case "quests": body = this.daily(s); break;
      case "shadows": body = this.shadows(s); break;
      case "usage": body = v_flex().gap(24).child(this.claudeLimits()).child(this.tokens()); break;
      case "limit": body = this.limitPage(s); break;
      case "profile":
        body = w >= 1200
          ? h_flex().gap(16).items_start().child(col(320, [this.status(s), this.inventory(s)])).child(col(0, [this.stats(s), this.skills(s)])).child(col(320, [this.titles(s), this.logCard(s)]))
          : w >= 820
            ? h_flex().gap(16).items_start().child(col(320, [this.status(s), this.inventory(s), this.titles(s)])).child(col(0, [this.stats(s), this.skills(s), this.logCard(s)]))
            : col(0, [this.status(s), this.stats(s), this.inventory(s), this.skills(s), this.titles(s), this.logCard(s)]);
        break;
      default: body = this.overview(s);
    }
    return v_flex().id("sl-home").size_full()
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 4) { this.width = size.width; cx.notify(); } })
      .child(div().flex_none().px(22).pt(22).child(this.banner(s)))
      .child(v_flex().id("sl-scroll").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).px(22).pt(28).pb(22)
        .child(body));
  }
}
