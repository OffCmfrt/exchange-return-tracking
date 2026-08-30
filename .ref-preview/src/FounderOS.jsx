import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Home, ListChecks, Target, FolderKanban, Building2, CalendarClock, Scale,
  Users, HeartPulse, Flag, BarChart3, Inbox as InboxIcon, Plus, X, Check,
  ChevronRight, ChevronDown, Pencil, Trash2, Clock, AlertTriangle, Search,
  ArrowUp, ArrowDown, Minus, Sparkles, Zap, PlayCircle, ClipboardList,
  CircleDot, Link2, Repeat, TrendingUp, TrendingDown, MessageSquare,
  CheckCircle2, Circle, MoreHorizontal, Star, Sunrise, Moon, Coffee,
  ChevronLeft, Filter as FilterIcon, Building, ArrowRight, RotateCcw
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

/* ============================================================================
   OFFCOMFRT — FOUNDER OS
   A single-file operating system for a founder running a D2C apparel brand.
   Persisted via window.storage (per-user, not shared).
============================================================================ */

/* ------------------------------- CONSTANTS ------------------------------- */

const STORAGE_KEY = "offcomfrt-founder-os-v1";

const DEPARTMENT_DEFS = [];

const DEPARTMENT_NAMES = DEPARTMENT_DEFS.map(d => d.name);
const PEOPLE = ["You"];
// Form options grow from the founder's own data — no hardcoded sample content
const deptOptions = (state) => Array.from(new Set([...DEPARTMENT_NAMES, ...(state?.departments || []).map(d => d.name).filter(Boolean)]));
const taskDeptOptions = (state) => [...deptOptions(state), "Personal"];
const peopleOptions = (state) => Array.from(new Set([
  ...PEOPLE,
  ...(state?.tasks || []).map(t => t.owner).filter(Boolean),
  ...(state?.meetings || []).map(m => m.owner).filter(Boolean),
  ...(state?.departments || []).map(d => d.owner).filter(Boolean),
]));
const PRIORITIES = ["Critical", "Important", "Normal", "Low"];
const STATUSES = ["Inbox", "Planned", "Today", "In Progress", "Waiting", "Blocked", "Completed", "Cancelled"];
const FOUNDER_AREAS = [
  { key: "strategy", label: "Strategy" },
  { key: "people", label: "People" },
  { key: "decisions", label: "Decisions" },
  { key: "execution", label: "Execution" },
  { key: "delegation", label: "Delegation" },
  { key: "followup", label: "Follow-up" },
];
const ENERGY_TYPES = [
  { key: "deep_work", label: "Deep Work" },
  { key: "execution", label: "Execution" },
  { key: "people", label: "People" },
  { key: "admin", label: "Admin" },
];
const PROJECT_STATUSES = ["Not Started", "On Track", "At Risk", "Off Track", "Completed"];

/* --------------------------------- DATES --------------------------------- */

const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const relDate = (n) => addDays(todayISO(), n);
const humanDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
};
const humanDateLong = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};
const isPast = (iso) => !!iso && iso < todayISO();
const isTodayISO = (iso) => iso === todayISO();
const startOfWeek = (iso) => {
  const d = new Date(iso + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return toISO(d);
};
const endOfWeek = (iso) => addDays(startOfWeek(iso), 6);
const inThisWeek = (iso) => {
  if (!iso) return false;
  const s = startOfWeek(todayISO()), e = endOfWeek(todayISO());
  return iso >= s && iso <= e;
};
const isActive = (status) => status !== "Completed" && status !== "Cancelled";

/* --------------------------------- IDS ------------------------------------ */

let idCounter = 1;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nextCode = (list, prefix) => {
  const nums = list.map(x => parseInt((x.code || "").split("-")[1], 10)).filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}-${pad(max + 1)}`;
};

/* ------------------------------ DERIVED LOGIC ----------------------------- */

const isOverdue = (t) => !!t.dueDate && isPast(t.dueDate) && isActive(t.status);
const isDueToday = (t) => t.status === "Today" || t.dueDate === todayISO();

function computedDeptHealth(dept, tasks) {
  const deptTasks = tasks.filter(t => t.department === dept.name && isActive(t.status));
  const criticalOverdue = deptTasks.some(t => t.priority === "Critical" && isOverdue(t));
  if (criticalOverdue) return "off";
  const anyTrouble = deptTasks.some(t => isOverdue(t) || t.status === "Blocked");
  if (anyTrouble && dept.health === "good") return "risk";
  return dept.health;
}

function computeAvoiding(state) {
  const items = [];
  state.tasks.forEach(t => {
    if (!isActive(t.status)) return;
    if ((t.pushedCount || 0) >= 2) {
      items.push({ kind: "Pushed repeatedly", text: t.name, detail: `Rescheduled ${t.pushedCount} times`, weight: 3 + t.pushedCount, ref: t.id, view: "tasks" });
    } else if (isOverdue(t) && (t.priority === "Critical" || t.priority === "Important")) {
      items.push({ kind: "Overdue & high-priority", text: t.name, detail: `Due ${humanDate(t.dueDate)}`, weight: t.priority === "Critical" ? 4 : 3, ref: t.id, view: "tasks" });
    }
  });
  state.decisions.forEach(d => {
    if (d.reviewDate && isPast(d.reviewDate) && !d.actualOutcome) {
      items.push({ kind: "Decision needs review", text: d.decisionMade, detail: `Review was due ${humanDate(d.reviewDate)}`, weight: 3, ref: d.id, view: "decisions" });
    }
  });
  state.tasks.forEach(t => {
    if (t.owner !== "You" && isOverdue(t)) {
      items.push({ kind: "Delegated & overdue", text: `${t.name} — ${t.owner}`, detail: `Due ${humanDate(t.dueDate)}`, weight: 3, ref: t.id, view: "delegation" });
    }
  });
  state.projects.forEach(p => {
    if (p.status === "Off Track") {
      items.push({ kind: "Project off track", text: p.name, detail: `${p.progress}% complete · due ${humanDate(p.deadline)}`, weight: 4, ref: p.id, view: "projects" });
    }
  });
  return items.sort((a, b) => b.weight - a.weight).slice(0, 6);
}

function computeWeeklyScore(state) {
  const s = startOfWeek(todayISO()), e = endOfWeek(todayISO());
  const weekTasks = state.tasks.filter(t => t.dueDate && t.dueDate >= s && t.dueDate <= e);
  const strategic = weekTasks.filter(t => t.founderArea === "strategy");
  const strategicScore = strategic.length ? (strategic.filter(t => t.status === "Completed").length / strategic.length) * 100 : 100;
  const execScore = weekTasks.length ? (weekTasks.filter(t => t.status === "Completed").length / weekTasks.length) * 100 : 100;
  const delegated = weekTasks.filter(t => t.owner !== "You");
  const delegationScore = delegated.length ? (delegated.filter(t => t.status === "Completed").length / delegated.length) * 100 : 100;
  const deepWorkMinutes = weekTasks.filter(t => t.energyType === "deep_work").reduce((a, t) => a + (t.actMinutes || t.estMinutes || 0), 0);
  const deepWorkScore = Math.min(100, (deepWorkMinutes / 600) * 100);
  const personalDays = state.personalLog.filter(p => p.date >= s && p.date <= e);
  const personalScore = personalDays.length
    ? (personalDays.reduce((a, p) => a + (p.exercise ? 1 : 0) + (p.reading ? 1 : 0), 0) / (personalDays.length * 2)) * 100
    : 0;
  const total = strategicScore * 0.4 + execScore * 0.2 + delegationScore * 0.15 + deepWorkScore * 0.10 + personalScore * 0.15;
  return {
    total: Math.round(total),
    breakdown: {
      strategic: Math.round(strategicScore), exec: Math.round(execScore),
      delegation: Math.round(delegationScore), deepWork: Math.round(deepWorkScore), personal: Math.round(personalScore),
    },
  };
}

function computeEnergyAllocation(state) {
  const s = startOfWeek(todayISO()), e = endOfWeek(todayISO());
  const weekTasks = state.tasks.filter(t => t.dueDate && t.dueDate >= s && t.dueDate <= e);
  const buckets = { deep_work: 0, execution: 0, people: 0, admin: 0 };
  weekTasks.forEach(t => { buckets[t.energyType] = (buckets[t.energyType] || 0) + (t.actMinutes || t.estMinutes || 0); });
  state.meetings.forEach(m => { if (m.date >= s && m.date <= e) buckets.people += (m.durationMinutes || 45); });
  const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 1;
  return { buckets, total };
}

function computeDelegation(state) {
  const iShouldDo = state.tasks.filter(t => t.owner === "You" && t.founderArea === "execution" && isActive(t.status));
  const iShouldDelegate = state.tasks.filter(t => t.owner === "You" && t.founderArea === "delegation" && isActive(t.status));
  const delegatedAll = state.tasks.filter(t => t.owner !== "You" && isActive(t.status));
  const needsFollowUp = delegatedAll.filter(t => t.dueDate && !isPast(t.dueDate) && t.dueDate <= relDate(2));
  const overdueDelegated = delegatedAll.filter(t => isOverdue(t));
  const delegatedWaiting = delegatedAll.filter(t => !isOverdue(t) && !needsFollowUp.includes(t));
  return { iShouldDo, iShouldDelegate, delegatedWaiting, needsFollowUp, overdueDelegated };
}

function suggestStartNow(state) {
  const mits = state.tasks.filter(t => t.isMIT && isActive(t.status)).sort((a, b) => (a.mitRank || 9) - (b.mitRank || 9));
  if (mits.length) return mits[0];
  const order = { Critical: 0, Important: 1, Normal: 2, Low: 3 };
  const today = state.tasks.filter(t => isDueToday(t) && isActive(t.status));
  const pool = today.length ? today : state.tasks.filter(t => isActive(t.status));
  return [...pool].sort((a, b) => (order[a.priority] - order[b.priority]) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))[0] || null;
}

function recommendWorkload(timeAvailable, energy) {
  if (energy === "Low") return "Stick to admin, approvals and quick follow-ups today — protect deep work for a higher-energy day.";
  if (energy === "High" && (timeAvailable === "6 hours" || timeAvailable === "8+ hours")) return "Rare combination — this is the day to move a strategic project forward, not just clear the inbox.";
  if (energy === "High") return "Spend the window on one meaningful decision or piece of strategic work before it fills with small tasks.";
  return "Balance one piece of real progress with your standing follow-ups — don't let admin eat the whole day.";
}

/* ============================================================================
   SEED DATA
============================================================================ */

function buildEmpty() {
  // Fresh workspace — no sample data. All state lives in Supabase.
  return {
    founderName: "",
    tasks: [], projects: [], departments: [], meetings: [], decisions: [],
    goals: [], inbox: [], ideas: [], personalLog: [], weeklyReviews: [],
    checkIn: null,
    checkout: null,
  };
}

/* ============================================================================
   STYLES
============================================================================ */

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.fos {
  --bg: #14161a;
  --bg-elev: #1b1e23;
  --bg-elev-2: #22262c;
  --bg-elev-3: #2a2f36;
  --border: #2e3238;
  --border-soft: #262a30;
  --text: #edeeef;
  --text-dim: #a3a9b0;
  --text-faint: #6d7379;
  --accent: #6b7cf0;
  --accent-strong: #808fff;
  --accent-soft: rgba(107, 124, 240, 0.14);
  --critical: #d16249;
  --critical-soft: rgba(209, 98, 73, 0.15);
  --important: #cc9a45;
  --important-soft: rgba(204, 154, 69, 0.15);
  --normal: #7f8fa6;
  --normal-soft: rgba(127, 143, 166, 0.15);
  --low: #63696f;
  --low-soft: rgba(99, 105, 111, 0.14);
  --good: #6f9d75;
  --good-soft: rgba(111, 157, 117, 0.15);
  --display: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
  --body: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--bg);
  color: var(--text);
  font-family: var(--body);
  min-height: 100vh;
}
.fos * { box-sizing: border-box; }
.fos ::selection { background: var(--accent-soft); }
.fos-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.fos-scroll::-webkit-scrollbar-track { background: transparent; }
.fos-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 8px; }
.f-display { font-family: var(--display); letter-spacing: -0.01em; }
.f-mono { font-family: var(--mono); }
.dim { color: var(--text-dim); }
.faint { color: var(--text-faint); }
.card {
  background: var(--bg-elev);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
}
.card-raised { background: var(--bg-elev-2); border: 1px solid var(--border); border-radius: 14px; }
.hairline { border-color: var(--border-soft); }
.tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--mono); font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.06em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 6px;
  border: 1px dashed var(--border);
  color: var(--text-dim);
  white-space: nowrap;
  line-height: 1.5;
}
.tag-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.tag-critical { border-color: var(--critical); color: var(--critical); background: var(--critical-soft); }
.tag-important { border-color: var(--important); color: var(--important); background: var(--important-soft); }
.tag-normal { border-color: var(--normal); color: var(--normal); background: var(--normal-soft); }
.tag-low { border-color: var(--low); color: var(--text-faint); background: var(--low-soft); }
.tag-good { border-color: var(--good); color: var(--good); background: var(--good-soft); }
.tag-accent { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
.tag-plain { border-style: solid; border-color: var(--border); color: var(--text-dim); background: var(--bg-elev-2); }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font-family: var(--body); font-size: 13px; font-weight: 500;
  padding: 7px 12px; border-radius: 9px; border: 1px solid var(--border);
  background: var(--bg-elev-2); color: var(--text); cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, transform 0.05s ease;
  white-space: nowrap;
}
.btn:hover { background: var(--bg-elev-3); border-color: var(--accent); }
.btn:active { transform: scale(0.98); }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
.btn-ghost { background: transparent; border-color: transparent; }
.btn-ghost:hover { background: var(--bg-elev-2); border-color: var(--border); }
.btn-sm { padding: 4px 9px; font-size: 12px; border-radius: 7px; }
.btn-icon { padding: 6px; border-radius: 8px; }
.input, .select, .textarea {
  width: 100%; background: var(--bg-elev-2); border: 1px solid var(--border);
  border-radius: 8px; padding: 7px 10px; font-size: 13px; color: var(--text);
  font-family: var(--body); outline: none;
}
.input:focus, .select:focus, .textarea:focus { border-color: var(--accent); }
.input::placeholder, .textarea::placeholder { color: var(--text-faint); }
.textarea { resize: vertical; min-height: 64px; }
.label-eyebrow {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--text-faint);
}
.progress-track { height: 6px; border-radius: 4px; background: var(--bg-elev-3); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 4px; background: var(--accent); }
.navitem {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 9px; font-size: 13.5px; color: var(--text-dim); cursor: pointer;
  border: 1px solid transparent;
}
.navitem:hover { background: var(--bg-elev-2); color: var(--text); }
.navitem-active { background: var(--accent-soft); color: var(--accent-strong); border-color: rgba(107,124,240,0.3); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.overlay {
  position: fixed; inset: 0; background: rgba(10, 11, 13, 0.6); backdrop-filter: blur(2px);
  display: flex; align-items: stretch; justify-content: flex-end; z-index: 50;
}
.overlay-center { align-items: center; justify-content: center; }
.drawer { width: min(480px, 100vw); background: var(--bg-elev); border-left: 1px solid var(--border); }
.modal { width: min(560px, 92vw); max-height: 88vh; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 16px; }
.taskrow { border-bottom: 1px solid var(--border-soft); }
.taskrow:last-child { border-bottom: none; }
.taskrow:hover { background: var(--bg-elev-2); }
.checkbox-ring {
  width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--border);
  display: flex; align-items: center; justify-content: center; flex: none; cursor: pointer;
}
.checkbox-ring:hover { border-color: var(--accent); }
.tab-strip { display: flex; gap: 4px; overflow-x: auto; }
.tab-strip::-webkit-scrollbar { display: none; }
.tab {
  font-size: 12.5px; font-weight: 500; padding: 6px 11px; border-radius: 8px;
  color: var(--text-dim); cursor: pointer; white-space: nowrap; border: 1px solid transparent;
}
.tab:hover { color: var(--text); }
.tab-active { background: var(--bg-elev-2); color: var(--text); border-color: var(--border); }
.fos a { color: var(--accent-strong); }
`;

/* ============================================================================
   SMALL UI PRIMITIVES
============================================================================ */

function priorityCls(p) {
  return p === "Critical" ? "tag-critical" : p === "Important" ? "tag-important" : p === "Normal" ? "tag-normal" : "tag-low";
}
function priorityDotColor(p) {
  return p === "Critical" ? "var(--critical)" : p === "Important" ? "var(--important)" : p === "Normal" ? "var(--normal)" : "var(--low)";
}
function healthColor(h) {
  return h === "off" ? "var(--critical)" : h === "risk" ? "var(--important)" : "var(--good)";
}
function projectStatusColor(s) {
  if (s === "On Track" || s === "Completed") return "var(--good)";
  if (s === "At Risk") return "var(--important)";
  if (s === "Off Track") return "var(--critical)";
  return "var(--text-faint)";
}

function PriorityTag({ p }) {
  return <span className={`tag ${priorityCls(p)}`}><span className="tag-dot" style={{ background: priorityDotColor(p) }} />{p}</span>;
}
function StatusTag({ s }) {
  return <span className="tag tag-plain">{s}</span>;
}
function DeptTag({ d }) {
  if (!d) return null;
  return <span className="tag tag-plain">{d}</span>;
}
function CodeTag({ c }) {
  return <span className="f-mono faint" style={{ fontSize: 11 }}>{c}</span>;
}
function HealthDot({ h }) {
  return <span className="status-dot" style={{ background: healthColor(h) }} />;
}
function ProgressBar({ value, height = 6 }) {
  return (
    <div className="progress-track" style={{ height }}>
      <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
function SectionHeading({ icon: Icon, title, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className="dim" />}
        <h3 className="f-display font-semibold" style={{ fontSize: 15 }}>{title}</h3>
      </div>
      {action}
    </div>
  );
}
function Card({ children, className = "", style }) {
  return <div className={`card p-4 ${className}`} style={style}>{children}</div>;
}
function EmptyState({ text, icon: Icon }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 gap-2">
      {Icon && <Icon size={20} className="faint" />}
      <p className="faint" style={{ fontSize: 12.5 }}>{text}</p>
    </div>
  );
}
function IconBtn({ icon: Icon, onClick, title, size = 14 }) {
  return (
    <button className="btn btn-ghost btn-icon" onClick={onClick} title={title} type="button">
      <Icon size={size} />
    </button>
  );
}
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
      <div className="card-raised px-4 py-2 flex items-center gap-2" style={{ fontSize: 13 }}>
        <Check size={14} style={{ color: "var(--good)" }} />
        {toast}
      </div>
    </div>
  );
}
function Modal({ onClose, children, wide }) {
  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="modal fos-scroll" style={{ overflowY: "auto", width: wide ? "min(720px,94vw)" : undefined }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function ModalHeader({ title, onClose }) {
  return (
    <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid var(--border-soft)" }}>
      <h3 className="f-display font-semibold" style={{ fontSize: 16 }}>{title}</h3>
      <IconBtn icon={X} onClick={onClose} title="Close" />
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div className="mb-3">
      <div className="label-eyebrow mb-1">{label}</div>
      {children}
    </div>
  );
}
function QuickAdd({ placeholder, onAdd, buttonLabel }) {
  const [val, setVal] = useState("");
  const submit = () => {
    const v = val.trim();
    if (!v) return;
    onAdd(v);
    setVal("");
  };
  return (
    <div className="flex gap-2">
      <input
        className="input"
        placeholder={placeholder}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
      />
      <button className="btn btn-primary" onClick={submit} type="button"><Plus size={14} />{buttonLabel || "Add"}</button>
    </div>
  );
}

function dueMeta(t) {
  if (!t.dueDate) return { text: "No date", cls: "faint" };
  if (isOverdue(t)) return { text: `Overdue · ${humanDate(t.dueDate)}`, cls: "", color: "var(--critical)" };
  if (isTodayISO(t.dueDate)) return { text: "Today", cls: "", color: "var(--accent-strong)" };
  return { text: humanDate(t.dueDate), cls: "dim" };
}

function TaskRow({ task, onToggleComplete, onOpen, onToggleMIT, compact }) {
  const dm = dueMeta(task);
  const done = task.status === "Completed";
  return (
    <div className="taskrow flex items-center gap-3 py-2.5 px-1">
      <button className="checkbox-ring" onClick={() => onToggleComplete(task)} type="button" title={done ? "Mark not done" : "Mark complete"}>
        {done && <Check size={11} style={{ color: "var(--good)" }} />}
      </button>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(task)}>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: 13.5, textDecoration: done ? "line-through" : "none", color: done ? "var(--text-faint)" : "var(--text)" }}>
            {task.name}
          </span>
          {task.owner !== "You" && <span className="tag tag-plain" style={{ fontSize: 9.5 }}>{task.owner}</span>}
          {task.recurring && <Repeat size={11} className="faint" />}
        </div>
        {!compact && (
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <DeptTag d={task.department} />
            <span className="faint" style={{ fontSize: 11 }}>·</span>
            <span style={{ fontSize: 11.5, color: dm.color || "var(--text-faint)" }}>{dm.text}</span>
            {task.estMinutes ? <><span className="faint" style={{ fontSize: 11 }}>·</span><span className="faint" style={{ fontSize: 11.5 }}>{task.estMinutes}m</span></> : null}
          </div>
        )}
      </div>
      {onToggleMIT && (
        <button className="btn-ghost btn-icon btn" onClick={() => onToggleMIT(task)} type="button" title="Toggle top priority">
          <Star size={14} style={{ color: task.isMIT ? "var(--important)" : "var(--text-faint)", fill: task.isMIT ? "var(--important)" : "none" }} />
        </button>
      )}
      <PriorityTag p={task.priority} />
    </div>
  );
}

function TaskListCard({ title, icon, tasks, actions, emptyText, onOpenTask, showMIT, limit }) {
  const shown = limit ? tasks.slice(0, limit) : tasks;
  return (
    <Card>
      <SectionHeading icon={icon} title={`${title}${tasks.length ? ` (${tasks.length})` : ""}`} />
      {shown.length === 0 ? (
        <EmptyState text={emptyText || "Nothing here."} icon={CheckCircle2} />
      ) : (
        <div>
          {shown.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              onOpen={onOpenTask}
              onToggleComplete={actions.completeTask}
              onToggleMIT={showMIT ? actions.toggleMIT : null}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/* ============================================================================
   TASK DRAWER (full editor)
============================================================================ */

function TaskDrawer({ task, onClose, actions, state }) {
  const [form, setForm] = useState(task);
  useEffect(() => { setForm(task); }, [task]);
  if (!task) return null;
  const isNew = !state.tasks.find(t => t.id === task.id);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = () => {
    if (!form.name || !form.name.trim()) return;
    if (isNew) actions.addTask(form); else actions.updateTask(form.id, form);
    onClose();
  };
  const project = state.projects.find(p => p.id === form.projectId);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer fos-scroll" style={{ overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid var(--border-soft)" }}>
          <div className="flex items-center gap-2">
            {form.code && <CodeTag c={form.code} />}
            <h3 className="f-display font-semibold" style={{ fontSize: 15 }}>{isNew ? "New Task" : "Edit Task"}</h3>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <IconBtn icon={Trash2} title="Delete" onClick={() => { actions.deleteTask(form.id); onClose(); }} />
            )}
            <IconBtn icon={X} onClick={onClose} title="Close" />
          </div>
        </div>
        <div className="p-4">
          <Field label="Task">
            <input className="input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="What needs to happen?" autoFocus />
          </Field>
          <Field label="Description / Notes">
            <textarea className="textarea" value={form.description || ""} onChange={e => set("description", e.target.value)} placeholder="Any context worth remembering..." />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Department">
              <select className="select" value={form.department} onChange={e => set("department", e.target.value)}>
                {taskDeptOptions(state).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Owner">
              <input className="input" list="people-list" value={form.owner} onChange={e => set("owner", e.target.value)} />
            </Field>
            <Field label="Priority">
              <select className="select" value={form.priority} onChange={e => set("priority", e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="select" value={form.status} onChange={e => set("status", e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Due date">
              <input type="date" className="input" value={form.dueDate || ""} onChange={e => set("dueDate", e.target.value)} />
            </Field>
            <Field label="Estimated minutes">
              <input type="number" className="input" value={form.estMinutes || ""} onChange={e => set("estMinutes", parseInt(e.target.value, 10) || null)} />
            </Field>
            <Field label="Actual minutes">
              <input type="number" className="input" value={form.actMinutes || ""} onChange={e => set("actMinutes", parseInt(e.target.value, 10) || null)} />
            </Field>
            <Field label="Category">
              <input className="input" value={form.category || ""} onChange={e => set("category", e.target.value)} placeholder="e.g. Approval, Follow-up" />
            </Field>
            <Field label="Founder area">
              <select className="select" value={form.founderArea || ""} onChange={e => set("founderArea", e.target.value || null)}>
                <option value="">— Not founder-specific —</option>
                {FOUNDER_AREAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </Field>
            <Field label="Energy type">
              <select className="select" value={form.energyType || ""} onChange={e => set("energyType", e.target.value || null)}>
                <option value="">—</option>
                {ENERGY_TYPES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </Field>
            <Field label="Project">
              <select className="select" value={form.projectId || ""} onChange={e => set("projectId", e.target.value || null)}>
                <option value="">— None —</option>
                {state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Recurring">
              <select className="select" value={form.recurring ? (form.recurrence || "Weekly") : ""} onChange={e => {
                const v = e.target.value;
                if (!v) { set("recurring", false); set("recurrence", null); }
                else { set("recurring", true); set("recurrence", v); }
              }}>
                <option value="">One-time</option>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
              </select>
            </Field>
          </div>
          <Field label="Dependency">
            <input className="input" value={form.dependency || ""} onChange={e => set("dependency", e.target.value)} placeholder="What is this waiting on, if anything?" />
          </Field>
          <Field label="Link / reference">
            <input className="input" value={form.link || ""} onChange={e => set("link", e.target.value)} placeholder="URL or reference" />
          </Field>
          {project && (
            <div className="faint mb-3" style={{ fontSize: 11.5 }}>Linked to project: <span className="dim">{project.name}</span></div>
          )}
          <div className="flex items-center justify-between mt-2">
            <label className="flex items-center gap-2" style={{ fontSize: 12.5 }}>
              <input type="checkbox" checked={!!form.isMIT} onChange={e => set("isMIT", e.target.checked)} />
              <span className="dim">Top 3 priority today</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button className="btn" onClick={onClose} type="button">Cancel</button>
            <button className="btn btn-primary" onClick={save} type="button">{isNew ? "Add task" : "Save changes"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   FILTER BAR
============================================================================ */

function FilterBar({ filters, setFilters, projects }) {
  const upd = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5" style={{ minWidth: 180 }}>
        <Search size={13} className="faint" />
        <input className="input" placeholder="Search tasks..." value={filters.q} onChange={e => upd("q", e.target.value)} />
      </div>
      <select className="select" style={{ width: "auto" }} value={filters.department} onChange={e => upd("department", e.target.value)}>
        <option value="">All departments</option>
        {taskDeptOptions(state).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <select className="select" style={{ width: "auto" }} value={filters.priority} onChange={e => upd("priority", e.target.value)}>
        <option value="">Any priority</option>
        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select className="select" style={{ width: "auto" }} value={filters.owner} onChange={e => upd("owner", e.target.value)}>
        <option value="">Anyone</option>
        {peopleOptions(state).map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select className="select" style={{ width: "auto" }} value={filters.projectId} onChange={e => upd("projectId", e.target.value)}>
        <option value="">Any project</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );
}

function applyFilters(tasks, filters) {
  return tasks.filter(t => {
    if (filters.q && !t.name.toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.department && t.department !== filters.department) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.owner && t.owner !== filters.owner) return false;
    if (filters.projectId && t.projectId !== filters.projectId) return false;
    return true;
  });
}

/* ============================================================================
   TASKS VIEW
============================================================================ */

const TASK_TABS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "overdue", label: "Overdue" },
  { key: "waiting", label: "Waiting" },
  { key: "blocked", label: "Blocked" },
  { key: "delegated", label: "Delegated" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
];

function tasksForTab(tasks, tab) {
  switch (tab) {
    case "today": return tasks.filter(t => isDueToday(t) && isActive(t.status));
    case "week": return tasks.filter(t => t.dueDate && inThisWeek(t.dueDate) && isActive(t.status));
    case "overdue": return tasks.filter(isOverdue);
    case "waiting": return tasks.filter(t => t.status === "Waiting");
    case "blocked": return tasks.filter(t => t.status === "Blocked");
    case "delegated": return tasks.filter(t => t.owner !== "You" && isActive(t.status));
    case "completed": return tasks.filter(t => t.status === "Completed");
    default: return tasks.filter(t => t.status !== "Cancelled");
  }
}
function sortTasks(list) {
  const order = { Critical: 0, Important: 1, Normal: 2, Low: 3 };
  return [...list].sort((a, b) => (order[a.priority] - order[b.priority]) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
}

function TasksView({ state, actions, openTask, initialTab, consumeInitialTab }) {
  const [tab, setTab] = useState(initialTab || "today");
  const [filters, setFilters] = useState({ q: "", department: "", priority: "", owner: "", projectId: "" });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => { if (initialTab) { setTab(initialTab); consumeInitialTab && consumeInitialTab(); } }, [initialTab]);

  const base = tasksForTab(state.tasks, tab);
  const filtered = sortTasks(applyFilters(base, filters));

  const quickAdd = (name) => {
    actions.addTask({
      name, department: filters.department || "Founder / Management", category: "",
      owner: "You", priority: "Normal",
      status: tab === "today" ? "Today" : tab === "week" ? "Planned" : "Inbox",
      dueDate: tab === "today" ? todayISO() : null,
      estMinutes: null, actMinutes: null, recurring: false, recurrence: null,
      dependency: "", projectId: null, meetingId: null, goalId: null,
      founderArea: null, energyType: null, isMIT: false, pushedCount: 0, notes: "", link: "", description: "",
    });
  };

  return (
    <div>
      <SectionHeading title="Tasks" icon={ListChecks} action={
        <button className="btn btn-primary btn-sm" onClick={() => openTask({ id: uid("t"), code: nextCode(state.tasks, "TSK"), name: "", department: "Founder / Management", category: "", owner: "You", priority: "Normal", status: "Inbox", createdDate: todayISO(), dueDate: null, estMinutes: null, founderArea: null, energyType: null, isMIT: false, pushedCount: 0, notes: "", description: "" })}>
          <Plus size={13} />New task
        </button>
      } />
      <div className="mb-3"><QuickAdd placeholder={`Quick-add a task to "${TASK_TABS.find(t => t.key === tab)?.label}"...`} onAdd={quickAdd} /></div>
      <div className="tab-strip mb-3">
        {TASK_TABS.map(t => (
          <div key={t.key} className={`tab ${tab === t.key ? "tab-active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label} <span className="faint">({tasksForTab(state.tasks, t.key).length})</span>
          </div>
        ))}
      </div>
      <div className="mb-3">
        <button className="btn btn-ghost btn-sm" onClick={() => setShowDetails(s => !s)} type="button">
          <FilterIcon size={12} /> Filters {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {showDetails && <div className="mt-2"><FilterBar filters={filters} setFilters={setFilters} projects={state.projects} /></div>}
      </div>
      <Card>
        {filtered.length === 0 ? (
          <EmptyState text="Nothing here — good sign, or time to check another tab." icon={CheckCircle2} />
        ) : (
          filtered.map(t => (
            <TaskRow key={t.id} task={t} onOpen={openTask} onToggleComplete={actions.completeTask} onToggleMIT={actions.toggleMIT} />
          ))
        )}
      </Card>
    </div>
  );
}

/* ============================================================================
   FOUNDER WORK VIEW
============================================================================ */

function FounderWorkView({ state, actions, openTask }) {
  const [tab, setTab] = useState("strategy");
  const areaTasks = FOUNDER_AREAS.reduce((acc, a) => {
    acc[a.key] = sortTasks(state.tasks.filter(t => t.founderArea === a.key && isActive(t.status)));
    return acc;
  }, {});
  const helper = {
    strategy: "Brand, product direction, growth, hiring, expansion, financial calls — the thinking only you can do.",
    people: "Hiring, 1:1s, leadership, team development. Building the humans who run the company.",
    decisions: "Approvals and calls waiting on you — vendor picks, product sign-offs, hiring approvals.",
    execution: "\u201cI need to do this.\u201d Tasks only you can personally execute right now.",
    delegation: "\u201cI need to make sure this gets done.\u201d Should be assigned to someone else.",
    followup: "Waiting on someone else — needs a nudge, not new work from you.",
  };
  return (
    <div>
      <SectionHeading title="Founder Work" icon={Target} />
      <p className="dim mb-4" style={{ fontSize: 13 }}>Not every company task is your task. This splits what only you can do from what you're on the hook to make happen.</p>
      <div className="tab-strip mb-3">
        {FOUNDER_AREAS.map(a => (
          <div key={a.key} className={`tab ${tab === a.key ? "tab-active" : ""}`} onClick={() => setTab(a.key)}>
            {a.label} <span className="faint">({areaTasks[a.key].length})</span>
          </div>
        ))}
      </div>
      <p className="faint mb-3" style={{ fontSize: 12 }}>{helper[tab]}</p>
      <Card>
        {areaTasks[tab].length === 0 ? (
          <EmptyState text="Nothing tagged here right now." icon={Target} />
        ) : areaTasks[tab].map(t => (
          <TaskRow key={t.id} task={t} onOpen={openTask} onToggleComplete={actions.completeTask} onToggleMIT={actions.toggleMIT} />
        ))}
      </Card>
    </div>
  );
}

/* ============================================================================
   PROJECTS VIEW
============================================================================ */

function ProjectModal({ project, onClose, actions, state, openTask }) {
  const [form, setForm] = useState(project);
  useEffect(() => { setForm(project); }, [project]);
  const isNew = !state.projects.find(p => p.id === project.id);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const linkedTasks = state.tasks.filter(t => t.projectId === project.id);
  const save = () => {
    if (!form.name.trim()) return;
    if (isNew) actions.addProject(form); else actions.updateProject(form.id, form);
    onClose();
  };
  return (
    <Modal onClose={onClose} wide>
      <ModalHeader title={isNew ? "New Project" : project.name} onClose={onClose} />
      <div className="p-4">
        <Field label="Project name"><input className="input" value={form.name} onChange={e => set("name", e.target.value)} /></Field>
        <Field label="Objective"><textarea className="textarea" value={form.objective || ""} onChange={e => set("objective", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">
            <select className="select" value={form.department} onChange={e => set("department", e.target.value)}>
              {deptOptions(state).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Owner"><input className="input" list="people-list" value={form.owner} onChange={e => set("owner", e.target.value)} /></Field>
          <Field label="Status">
            <select className="select" value={form.status} onChange={e => set("status", e.target.value)}>
              {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="select" value={form.priority} onChange={e => set("priority", e.target.value)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Deadline"><input type="date" className="input" value={form.deadline || ""} onChange={e => set("deadline", e.target.value)} /></Field>
          <Field label="Progress (%)"><input type="number" min="0" max="100" className="input" value={form.progress ?? 0} onChange={e => set("progress", Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))} /></Field>
          <Field label="Founder involvement">
            <select className="select" value={form.founderInvolvement || "Medium"} onChange={e => set("founderInvolvement", e.target.value)}>
              <option>Low</option><option>Medium</option><option>High</option>
            </select>
          </Field>
          <Field label="Budget"><input className="input" value={form.budget || ""} onChange={e => set("budget", e.target.value)} /></Field>
        </div>
        <Field label="Risks"><textarea className="textarea" value={form.risks || ""} onChange={e => set("risks", e.target.value)} placeholder="What could knock this off track?" /></Field>
        <Field label="Notes"><textarea className="textarea" value={form.notes || ""} onChange={e => set("notes", e.target.value)} /></Field>
        {!isNew && (
          <div className="mt-3">
            <div className="label-eyebrow mb-2">Linked tasks ({linkedTasks.length})</div>
            {linkedTasks.length === 0 ? <p className="faint" style={{ fontSize: 12 }}>No tasks linked yet.</p> : (
              <div className="card">
                {linkedTasks.map(t => <TaskRow key={t.id} task={t} onOpen={(tk) => { onClose(); openTask(tk); }} onToggleComplete={actions.completeTask} compact />)}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn" onClick={onClose} type="button">Cancel</button>
          <button className="btn btn-primary" onClick={save} type="button">{isNew ? "Create project" : "Save changes"}</button>
        </div>
      </div>
    </Modal>
  );
}

function ProjectsView({ state, actions, openTask }) {
  const [editing, setEditing] = useState(null);
  const [deptFilter, setDeptFilter] = useState("");
  const projects = state.projects.filter(p => !deptFilter || p.department === deptFilter);
  const blank = () => ({ id: uid("p"), code: nextCode(state.projects, "PRJ"), name: "", department: deptOptions(state)[0] || "", owner: "You", founderInvolvement: "Medium", objective: "", startDate: todayISO(), deadline: relDate(30), status: "Not Started", priority: "Normal", progress: 0, risks: "", budget: "", notes: "" });
  return (
    <div>
      <SectionHeading title="Projects" icon={FolderKanban} action={
        <button className="btn btn-primary btn-sm" onClick={() => setEditing(blank())}><Plus size={13} />New project</button>
      } />
      <div className="mb-3">
        <select className="select" style={{ width: "auto" }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">All departments</option>
          {deptOptions(state).map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {projects.map(p => (
          <Card key={p.id} className="cursor-pointer" style={{ cursor: "pointer" }}>
            <div onClick={() => setEditing(p)}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <CodeTag c={p.code} />
                  <span className="tag" style={{ borderStyle: "solid", borderColor: projectStatusColor(p.status), color: projectStatusColor(p.status), background: "transparent" }}>{p.status}</span>
                </div>
              </div>
              <div className="f-display font-semibold mb-1" style={{ fontSize: 14.5 }}>{p.name}</div>
              <div className="faint mb-2" style={{ fontSize: 11.5 }}>{p.department} · {p.owner}</div>
              <ProgressBar value={p.progress} />
              <div className="flex items-center justify-between mt-2">
                <span className="faint" style={{ fontSize: 11 }}>Due {humanDate(p.deadline)}</span>
                <span className="faint" style={{ fontSize: 11 }}>{p.progress}%</span>
              </div>
              {p.risks && <div className="mt-2 flex items-start gap-1.5" style={{ fontSize: 11.5, color: "var(--important)" }}><AlertTriangle size={12} style={{ marginTop: 2, flex: "none" }} /><span>{p.risks}</span></div>}
            </div>
          </Card>
        ))}
      </div>
      {editing && <ProjectModal project={editing} onClose={() => setEditing(null)} actions={actions} state={state} openTask={openTask} />}
    </div>
  );
}

/* ============================================================================
   DEPARTMENTS VIEW
============================================================================ */

function DepartmentDetail({ dept, onClose, state, actions, openTask }) {
  const tasks = sortTasks(state.tasks.filter(t => t.department === dept.name && isActive(t.status)));
  const projects = state.projects.filter(p => p.department === dept.name);
  const health = computedDeptHealth(dept, state.tasks);
  return (
    <Modal onClose={onClose} wide>
      <ModalHeader title={dept.name} onClose={onClose} />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <HealthDot h={health} /><span className="dim" style={{ fontSize: 12.5 }}>{health === "off" ? "Off track" : health === "risk" ? "At risk" : "On track"}</span>
          <span className="faint" style={{ fontSize: 12 }}>· Owner: {dept.owner}</span>
        </div>
        <p className="dim mb-3" style={{ fontSize: 13 }}>{dept.goal}</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <div className="label-eyebrow mb-1.5">Current priorities</div>
            {dept.priorities.map((p, i) => <div key={i} className="flex items-start gap-1.5 mb-1" style={{ fontSize: 12.5 }}><CircleDot size={11} className="dim" style={{ marginTop: 2, flex: "none" }} />{p}</div>)}
          </div>
          <div>
            <div className="label-eyebrow mb-1.5">KPIs</div>
            <div className="flex flex-wrap gap-1.5">{dept.kpis.map((k, i) => <span key={i} className="tag tag-plain">{k.label}: {k.value}</span>)}</div>
            {dept.issues.length > 0 && <>
              <div className="label-eyebrow mb-1.5 mt-3">Issues</div>
              {dept.issues.map((iss, i) => <div key={i} className="flex items-start gap-1.5 mb-1" style={{ fontSize: 12.5, color: "var(--important)" }}><AlertTriangle size={11} style={{ marginTop: 2, flex: "none" }} />{iss}</div>)}
            </>}
          </div>
        </div>
        {projects.length > 0 && (
          <div className="mb-3">
            <div className="label-eyebrow mb-1.5">Projects ({projects.length})</div>
            <div className="flex flex-wrap gap-2">
              {projects.map(p => <span key={p.id} className="tag tag-plain">{p.name} · {p.progress}%</span>)}
            </div>
          </div>
        )}
        <div className="label-eyebrow mb-1.5">Open tasks ({tasks.length})</div>
        <div className="card">
          {tasks.length === 0 ? <EmptyState text="Nothing open in this department." /> : tasks.map(t => (
            <TaskRow key={t.id} task={t} onOpen={(tk) => { onClose(); openTask(tk); }} onToggleComplete={actions.completeTask} compact />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function DepartmentsView({ state, actions, openTask, goTo }) {
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <SectionHeading title="Departments" icon={Building2} action={
        <button className="btn btn-ghost btn-sm" onClick={() => setAdding(a => !a)}><Plus size={13} />Add department</button>
      } />
      {adding && (
        <div className="mb-3"><QuickAdd placeholder="New department name..." buttonLabel="Add" onAdd={(name) => { actions.addDepartment(name); setAdding(false); }} /></div>
      )}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {state.departments.map(d => {
          const health = computedDeptHealth(d, state.tasks);
          const openTasksCount = state.tasks.filter(t => t.department === d.name && isActive(t.status)).length;
          return (
            <Card key={d.id} className="cursor-pointer" style={{ cursor: "pointer" }} >
              <div onClick={() => setSelected(d)}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2"><HealthDot h={health} /><span className="f-display font-semibold" style={{ fontSize: 13.5 }}>{d.name}</span></div>
                </div>
                <p className="dim mb-2" style={{ fontSize: 12 }}>{d.goal}</p>
                <div className="flex items-center justify-between">
                  <span className="faint" style={{ fontSize: 11.5 }}>{d.owner}</span>
                  <span className="faint" style={{ fontSize: 11.5 }}>{openTasksCount} open</span>
                </div>
                {d.issues.length > 0 && <div className="mt-2 tag tag-important" style={{ fontSize: 10 }}>{d.issues.length} issue{d.issues.length > 1 ? "s" : ""}</div>}
              </div>
            </Card>
          );
        })}
      </div>
      {selected && <DepartmentDetail dept={selected} onClose={() => setSelected(null)} state={state} actions={actions} openTask={openTask} />}
    </div>
  );
}

/* ============================================================================
   MEETINGS VIEW
============================================================================ */

function meetingStatusMeta(m) {
  if (m.status === "completed") {
    const openItems = (m.actionItems || []).filter(a => !a.done).length;
    if (openItems > 0) return { label: `Needs follow-up (${openItems})`, cls: "tag-important" };
    return { label: "Completed", cls: "tag-plain" };
  }
  if (m.status === "needs_prep") return { label: "Needs prep", cls: "tag-important" };
  if (isTodayISO(m.date)) return { label: "Today", cls: "tag-accent" };
  return { label: "Upcoming", cls: "tag-normal" };
}

const MEETING_TABS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "upcoming", label: "Upcoming" },
  { key: "prep", label: "Needs Prep" },
  { key: "followup", label: "Needs Follow-up" },
  { key: "all", label: "All" },
];
function meetingsForTab(meetings, tab) {
  switch (tab) {
    case "today": return meetings.filter(m => isTodayISO(m.date));
    case "week": return meetings.filter(m => inThisWeek(m.date));
    case "upcoming": return meetings.filter(m => m.date >= todayISO() && m.status !== "completed");
    case "prep": return meetings.filter(m => m.status === "needs_prep");
    case "followup": return meetings.filter(m => m.status === "completed" && (m.actionItems || []).some(a => !a.done));
    default: return meetings;
  }
}

function MeetingModal({ meeting, onClose, actions, state, openTask }) {
  const [form, setForm] = useState(meeting);
  useEffect(() => { setForm(meeting); }, [meeting]);
  const isNew = !state.meetings.find(m => m.id === meeting.id);
  const [newAI, setNewAI] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = () => {
    if (!form.name.trim()) return;
    if (isNew) actions.addMeeting(form); else actions.updateMeeting(form.id, form);
    onClose();
  };
  const addActionItem = () => {
    const text = newAI.trim();
    if (!text) return;
    set("actionItems", [...(form.actionItems || []), { id: uid("ai"), text, owner: "You", due: relDate(3), done: false, taskId: null }]);
    setNewAI("");
  };
  return (
    <Modal onClose={onClose} wide>
      <ModalHeader title={isNew ? "New Meeting" : meeting.name} onClose={onClose} />
      <div className="p-4">
        <Field label="Meeting name"><input className="input" value={form.name} onChange={e => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className="input" value={form.date} onChange={e => set("date", e.target.value)} /></Field>
          <Field label="Time"><input type="time" className="input" value={form.time} onChange={e => set("time", e.target.value)} /></Field>
          <Field label="Department">
            <select className="select" value={form.department} onChange={e => set("department", e.target.value)}>
              {deptOptions(state).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Owner"><input className="input" list="people-list" value={form.owner} onChange={e => set("owner", e.target.value)} /></Field>
        </div>
        <Field label="Objective"><textarea className="textarea" value={form.objective || ""} onChange={e => set("objective", e.target.value)} /></Field>
        <Field label="Agenda (one per line)">
          <textarea className="textarea" value={(form.agenda || []).join("\n")} onChange={e => set("agenda", e.target.value.split("\n"))} />
        </Field>
        <Field label="Notes"><textarea className="textarea" value={form.notesText || ""} onChange={e => set("notesText", e.target.value)} /></Field>
        <Field label="Status">
          <select className="select" value={form.status} onChange={e => set("status", e.target.value)}>
            <option value="upcoming">Upcoming</option>
            <option value="needs_prep">Needs prep</option>
            <option value="completed">Completed</option>
          </select>
        </Field>
        {!isNew && (
          <div className="mb-3">
            <div className="label-eyebrow mb-1.5">Action items</div>
            <div className="flex gap-2 mb-2">
              <input className="input" placeholder="New action item..." value={newAI} onChange={e => setNewAI(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addActionItem(); }} />
              <button className="btn btn-ghost btn-sm" onClick={addActionItem} type="button"><Plus size={11} />Add</button>
            </div>
            {(form.actionItems || []).length === 0 ? <p className="faint" style={{ fontSize: 12 }}>No action items yet — meetings should produce them.</p> : (
              <div className="card">
                {form.actionItems.map((ai, i) => (
                  <div key={ai.id} className="taskrow flex items-center gap-2 py-2 px-1">
                    <button className="checkbox-ring" type="button" onClick={() => {
                      const items = [...form.actionItems]; items[i] = { ...ai, done: !ai.done }; set("actionItems", items);
                    }}>{ai.done && <Check size={11} style={{ color: "var(--good)" }} />}</button>
                    <div className="flex-1" style={{ fontSize: 12.5, textDecoration: ai.done ? "line-through" : "none" }}>{ai.text}</div>
                    <span className="faint" style={{ fontSize: 11 }}>{ai.owner} · {humanDate(ai.due)}</span>
                    {!ai.taskId ? (
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => {
                        const newTask = actions.addActionItemAsTask(form.id, ai);
                        const items = [...form.actionItems]; items[i] = { ...ai, taskId: newTask.id }; set("actionItems", items);
                      }}>→ Task</button>
                    ) : <span className="tag tag-good" style={{ fontSize: 9.5 }}>In tasks</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn" onClick={onClose} type="button">Cancel</button>
          <button className="btn btn-primary" onClick={save} type="button">{isNew ? "Create meeting" : "Save changes"}</button>
        </div>
      </div>
    </Modal>
  );
}

function MeetingsView({ state, actions, openTask }) {
  const [tab, setTab] = useState("today");
  const [editing, setEditing] = useState(null);
  const meetings = [...meetingsForTab(state.meetings, tab)].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const blank = () => ({ id: uid("m"), code: nextCode(state.meetings, "MTG"), name: "", date: todayISO(), time: "10:00", durationMinutes: 30, participants: ["You"], department: deptOptions(state)[0] || "", objective: "", agenda: [], notesText: "", decisions: [], actionItems: [], owner: "You", followUpDate: null, status: "upcoming" });
  return (
    <div>
      <SectionHeading title="Meetings" icon={CalendarClock} action={
        <button className="btn btn-primary btn-sm" onClick={() => setEditing(blank())}><Plus size={13} />New meeting</button>
      } />
      <div className="tab-strip mb-3">
        {MEETING_TABS.map(t => (
          <div key={t.key} className={`tab ${tab === t.key ? "tab-active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label} <span className="faint">({meetingsForTab(state.meetings, t.key).length})</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {meetings.length === 0 ? <Card><EmptyState text="No meetings here." icon={CalendarClock} /></Card> : meetings.map(m => {
          const meta = meetingStatusMeta(m);
          return (
            <Card key={m.id} className="cursor-pointer" style={{ cursor: "pointer" }}>
              <div onClick={() => setEditing(m)} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <CodeTag c={m.code} />
                    <span className="f-display font-semibold" style={{ fontSize: 14 }}>{m.name}</span>
                    <span className={`tag ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <div className="dim" style={{ fontSize: 12 }}>{humanDate(m.date)} · {m.time} · {m.department}</div>
                  <div className="faint mt-1" style={{ fontSize: 11.5 }}>{m.objective}</div>
                </div>
                <ChevronRight size={16} className="faint" style={{ flex: "none" }} />
              </div>
            </Card>
          );
        })}
      </div>
      {editing && <MeetingModal meeting={editing} onClose={() => setEditing(null)} actions={actions} state={state} openTask={openTask} />}
    </div>
  );
}

/* ============================================================================
   DECISIONS VIEW
============================================================================ */

function DecisionModal({ decision, onClose, actions, state }) {
  const [form, setForm] = useState(decision);
  useEffect(() => { setForm(decision); }, [decision]);
  const isNew = !state.decisions.find(d => d.id === decision.id);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = () => {
    if (!form.decisionMade.trim()) return;
    if (isNew) actions.addDecision(form); else actions.updateDecision(form.id, form);
    onClose();
  };
  return (
    <Modal onClose={onClose} wide>
      <ModalHeader title={isNew ? "Log a Decision" : form.decisionMade} onClose={onClose} />
      <div className="p-4">
        <Field label="Decision made"><input className="input" value={form.decisionMade} onChange={e => set("decisionMade", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">
            <select className="select" value={form.department} onChange={e => set("department", e.target.value)}>
              {deptOptions(state).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className="input" value={form.date} onChange={e => set("date", e.target.value)} /></Field>
          <Field label="Owner"><input className="input" list="people-list" value={form.owner} onChange={e => set("owner", e.target.value)} /></Field>
          <Field label="Review date"><input type="date" className="input" value={form.reviewDate || ""} onChange={e => set("reviewDate", e.target.value)} /></Field>
        </div>
        <Field label="Context"><textarea className="textarea" value={form.context || ""} onChange={e => set("context", e.target.value)} /></Field>
        <Field label="Options considered"><textarea className="textarea" value={form.options || ""} onChange={e => set("options", e.target.value)} /></Field>
        <Field label="Why"><textarea className="textarea" value={form.why || ""} onChange={e => set("why", e.target.value)} /></Field>
        <Field label="Expected outcome"><textarea className="textarea" value={form.expectedOutcome || ""} onChange={e => set("expectedOutcome", e.target.value)} /></Field>
        <Field label="Actual outcome (fill in at review time)"><textarea className="textarea" value={form.actualOutcome || ""} onChange={e => set("actualOutcome", e.target.value)} /></Field>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn" onClick={onClose} type="button">Cancel</button>
          <button className="btn btn-primary" onClick={save} type="button">{isNew ? "Log decision" : "Save changes"}</button>
        </div>
      </div>
    </Modal>
  );
}

function DecisionsView({ state, actions }) {
  const [editing, setEditing] = useState(null);
  const decisions = [...state.decisions].sort((a, b) => b.date.localeCompare(a.date));
  const blank = () => ({ id: uid("d"), code: nextCode(state.decisions, "DEC"), decision: "", date: todayISO(), department: deptOptions(state)[0] || "", context: "", options: "", decisionMade: "", why: "", owner: "You", expectedOutcome: "", reviewDate: relDate(21), actualOutcome: "" });
  return (
    <div>
      <SectionHeading title="Decision Center" icon={Scale} action={
        <button className="btn btn-primary btn-sm" onClick={() => setEditing(blank())}><Plus size={13} />Log decision</button>
      } />
      <p className="dim mb-4" style={{ fontSize: 13 }}>A record of what was decided and why — so you stop re-deciding the same thing.</p>
      <div className="flex flex-col gap-2">
        {decisions.map(d => {
          const needsReview = d.reviewDate && isPast(d.reviewDate) && !d.actualOutcome;
          return (
            <Card key={d.id} className="cursor-pointer" style={{ cursor: "pointer" }}>
              <div onClick={() => setEditing(d)}>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <CodeTag c={d.code} />
                  <span className="f-display font-semibold" style={{ fontSize: 14 }}>{d.decisionMade}</span>
                  {needsReview && <span className="tag tag-important">Needs review</span>}
                </div>
                <div className="dim" style={{ fontSize: 12 }}>{d.department} · {humanDate(d.date)} · {d.owner}</div>
                <p className="faint mt-1" style={{ fontSize: 11.5 }}>{d.why}</p>
              </div>
            </Card>
          );
        })}
      </div>
      {editing && <DecisionModal decision={editing} onClose={() => setEditing(null)} actions={actions} state={state} />}
    </div>
  );
}

/* ============================================================================
   DELEGATION VIEW
============================================================================ */

function DelegationView({ state, actions, openTask }) {
  const d = computeDelegation(state);
  return (
    <div>
      <SectionHeading title="Delegation" icon={Users} />
      <p className="dim mb-4" style={{ fontSize: 13 }}>What only you should do, what you should hand off, and what's already handed off but needs a nudge.</p>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <TaskListCard title="I Should Do" icon={Zap} tasks={sortTasks(d.iShouldDo)} actions={actions} onOpenTask={openTask} emptyText="No founder-only execution tasks queued." />
        <TaskListCard title="I Should Delegate" icon={ArrowRight} tasks={sortTasks(d.iShouldDelegate)} actions={actions} onOpenTask={openTask} emptyText="Nothing flagged to hand off." />
        <TaskListCard title="Delegated — Waiting" icon={Clock} tasks={sortTasks(d.delegatedWaiting)} actions={actions} onOpenTask={openTask} emptyText="Nothing out with the team right now." />
        <TaskListCard title="Needs Follow-up" icon={AlertTriangle} tasks={sortTasks(d.needsFollowUp)} actions={actions} onOpenTask={openTask} emptyText="Nothing approaching its deadline." />
        <TaskListCard title="Overdue Delegated" icon={AlertTriangle} tasks={sortTasks(d.overdueDelegated)} actions={actions} onOpenTask={openTask} emptyText="Nothing overdue with the team." />
      </div>
    </div>
  );
}

/* ============================================================================
   PERSONAL VIEW
============================================================================ */

function PersonalView({ state, actions, openTask }) {
  const today = state.personalLog.find(p => p.date === todayISO()) || { date: todayISO(), wakeUp: "", sleepHours: "", exercise: false, workHours: "", deepWorkHours: "", screenTimeHours: "", reading: false, energy: 6, oneThing: "" };
  const [form, setForm] = useState(today);
  useEffect(() => { setForm(today.date === todayISO() ? today : form); }, [state.personalLog.length]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const last7 = state.personalLog.slice(-7);
  const exerciseCount = last7.filter(p => p.exercise).length;
  const readingCount = last7.filter(p => p.reading).length;
  const avgEnergy = last7.length ? (last7.reduce((a, p) => a + Number(p.energy || 0), 0) / last7.length).toFixed(1) : "—";
  const personalTasks = sortTasks(state.tasks.filter(t => t.department === "Personal" && isActive(t.status)));
  return (
    <div>
      <SectionHeading title="Personal OS" icon={HeartPulse} />
      <p className="dim mb-4" style={{ fontSize: 13 }}>Simple, not obsessive. The only question that matters: are you becoming the person you want to become?</p>
      <div className="grid gap-4" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
        <Card>
          <SectionHeading title="Today's log" icon={Sunrise} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Wake-up"><input type="time" className="input" value={form.wakeUp} onChange={e => set("wakeUp", e.target.value)} /></Field>
            <Field label="Sleep (hours)"><input type="number" step="0.5" className="input" value={form.sleepHours} onChange={e => set("sleepHours", e.target.value)} /></Field>
            <Field label="Work hours"><input type="number" step="0.5" className="input" value={form.workHours} onChange={e => set("workHours", e.target.value)} /></Field>
            <Field label="Deep work hours"><input type="number" step="0.5" className="input" value={form.deepWorkHours} onChange={e => set("deepWorkHours", e.target.value)} /></Field>
            <Field label="Screen time (hours)"><input type="number" step="0.5" className="input" value={form.screenTimeHours} onChange={e => set("screenTimeHours", e.target.value)} /></Field>
            <Field label="Energy (1–10)"><input type="number" min="1" max="10" className="input" value={form.energy} onChange={e => set("energy", e.target.value)} /></Field>
          </div>
          <div className="flex items-center gap-4 my-2">
            <label className="flex items-center gap-2" style={{ fontSize: 13 }}><input type="checkbox" checked={!!form.exercise} onChange={e => set("exercise", e.target.checked)} /> Exercised</label>
            <label className="flex items-center gap-2" style={{ fontSize: 13 }}><input type="checkbox" checked={!!form.reading} onChange={e => set("reading", e.target.checked)} /> Read something</label>
          </div>
          <Field label="One thing I did for myself"><input className="input" value={form.oneThing} onChange={e => set("oneThing", e.target.value)} placeholder="Optional" /></Field>
          <button className="btn btn-primary btn-sm mt-1" onClick={() => actions.savePersonalToday(form)} type="button">Save today's log</button>
        </Card>
        <div className="flex flex-col gap-3">
          <Card>
            <SectionHeading title="This week" icon={BarChart3} />
            <div className="flex items-center justify-between mb-2"><span className="dim" style={{ fontSize: 12.5 }}>Fitness consistency</span><span className="f-mono" style={{ fontSize: 13 }}>{exerciseCount}/{last7.length}</span></div>
            <div className="flex items-center justify-between mb-2"><span className="dim" style={{ fontSize: 12.5 }}>Reading consistency</span><span className="f-mono" style={{ fontSize: 13 }}>{readingCount}/{last7.length}</span></div>
            <div className="flex items-center justify-between"><span className="dim" style={{ fontSize: 12.5 }}>Avg. energy</span><span className="f-mono" style={{ fontSize: 13 }}>{avgEnergy}/10</span></div>
          </Card>
          <TaskListCard title="Personal tasks" icon={HeartPulse} tasks={personalTasks} actions={actions} onOpenTask={openTask} emptyText="Nothing personal queued." />
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   GOALS VIEW
============================================================================ */

const GOAL_LEVELS = [
  { key: "annual", label: "1 Year" },
  { key: "quarterly", label: "90 Days" },
  { key: "monthly", label: "This Month" },
  { key: "weekly", label: "This Week" },
];

function GoalsView({ state, actions }) {
  const byLevel = (lvl) => state.goals.filter(g => g.level === lvl);
  const [addingFor, setAddingFor] = useState(null);
  return (
    <div>
      <SectionHeading title="Goals" icon={Flag} />
      <p className="dim mb-4" style={{ fontSize: 13 }}>Annual → Quarterly → Monthly → Weekly → today's tasks. Not every small task needs a goal — only the ones that matter.</p>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {GOAL_LEVELS.map((lvl, i) => (
          <div key={lvl.key}>
            <div className="flex items-center justify-between mb-2">
              <div className="label-eyebrow">{lvl.label}</div>
              <IconBtn icon={Plus} onClick={() => setAddingFor(addingFor === lvl.key ? null : lvl.key)} title="Add goal" />
            </div>
            {addingFor === lvl.key && (
              <div className="mb-2"><QuickAdd placeholder="New goal..." buttonLabel="Add" onAdd={(title) => { actions.addGoal({ level: lvl.key, title, parentId: null, progress: 0, timeframe: lvl.label }); setAddingFor(null); }} /></div>
            )}
            <div className="flex flex-col gap-2">
              {byLevel(lvl.key).map(g => (
                <Card key={g.id} className="p-3">
                  <div style={{ fontSize: 12.5 }} className="mb-2">{g.title}</div>
                  <ProgressBar value={g.progress} />
                  <div className="faint mt-1.5" style={{ fontSize: 10.5 }}>{g.progress}% complete</div>
                </Card>
              ))}
              {byLevel(lvl.key).length === 0 && <p className="faint" style={{ fontSize: 11.5 }}>Nothing set.</p>}
              {i < GOAL_LEVELS.length - 1 && <div className="flex justify-center py-1"><ChevronDown size={13} className="faint" /></div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
   WEEKLY REVIEW VIEW
============================================================================ */

function ReflectionField({ label, value, onChange, placeholder }) {
  return (
    <Field label={label}>
      <textarea className="textarea" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </Field>
  );
}

function ScoreRing({ score, label }) {
  return (
    <div className="flex flex-col items-center">
      <div style={{
        width: 74, height: 74, borderRadius: "50%",
        background: `conic-gradient(var(--accent) ${score * 3.6}deg, var(--bg-elev-3) 0deg)`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ width: 58, height: 58, borderRadius: "50%", background: "var(--bg-elev)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="f-mono font-semibold" style={{ fontSize: 17 }}>{score}</span>
        </div>
      </div>
      <span className="faint mt-1.5" style={{ fontSize: 11 }}>{label}</span>
    </div>
  );
}

function WeeklyReviewView({ state, actions }) {
  const [tab, setTab] = useState("week");
  const currentWeekOf = startOfWeek(todayISO());
  const existing = state.weeklyReviews.find(r => r.weekOf === currentWeekOf);
  const lastReview = [...state.weeklyReviews].filter(r => r.weekOf !== currentWeekOf).sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0];
  const draft = state.reviewDraft && state.reviewDraft.weekOf === currentWeekOf ? state.reviewDraft : {
    weekOf: currentWeekOf,
    company: { revenue: "", orders: "", aov: "", cac: "", roas: "", newCustomers: "", repeatCustomers: "", notes: "" },
    wentWell: "", didntGoWell: "", avoided: "", becomingProblem: "", stopDoing: "", delegate: "",
    nextWeekTop3: ["", "", ""],
  };
  const [form, setForm] = useState(existing || draft);
  useEffect(() => { setForm(existing || draft); }, [currentWeekOf, existing?.id]);

  const live = computeWeeklyScore(state);
  const weekTasks = state.tasks.filter(t => t.dueDate && inThisWeek(t.dueDate));
  const meetingsThisWeek = state.meetings.filter(m => inThisWeek(m.date));
  const deepWorkHours = (weekTasks.filter(t => t.energyType === "deep_work").reduce((a, t) => a + (t.actMinutes || t.estMinutes || 0), 0) / 60).toFixed(1);
  const delegationDone = weekTasks.filter(t => t.owner !== "You" && t.status === "Completed").length;

  const setCompany = (k, v) => setForm(f => ({ ...f, company: { ...f.company, [k]: v } }));
  const setTop3 = (i, v) => setForm(f => { const arr = [...f.nextWeekTop3]; arr[i] = v; return { ...f, nextWeekTop3: arr }; });

  const trendData = [...state.weeklyReviews]
    .sort((a, b) => a.weekOf.localeCompare(b.weekOf))
    .map(r => ({ week: humanDate(r.weekOf), score: r.score }))
    .concat([{ week: "This week", score: live.total }]);

  return (
    <div>
      <SectionHeading title="Weekly Review" icon={BarChart3} />
      <div className="tab-strip mb-4">
        <div className={`tab ${tab === "week" ? "tab-active" : ""}`} onClick={() => setTab("week")}>This Week</div>
        <div className={`tab ${tab === "monthly" ? "tab-active" : ""}`} onClick={() => setTab("monthly")}>Monthly Rollup</div>
      </div>

      {tab === "week" ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
          <div className="flex flex-col gap-3">
            <Card>
              <SectionHeading title="Founder Execution Score" icon={Target} />
              <div className="flex items-center gap-4 mb-3">
                <ScoreRing score={live.total} label="This week (live)" />
                {lastReview && <ScoreRing score={lastReview.score} label="Last week" />}
                <div className="flex items-center gap-1" style={{ fontSize: 12.5 }}>
                  {lastReview && (live.total >= lastReview.score
                    ? <><TrendingUp size={14} style={{ color: "var(--good)" }} /><span style={{ color: "var(--good)" }}>+{live.total - lastReview.score}</span></>
                    : <><TrendingDown size={14} style={{ color: "var(--critical)" }} /><span style={{ color: "var(--critical)" }}>{live.total - lastReview.score}</span></>)}
                </div>
              </div>
              <div style={{ fontSize: 11.5 }} className="dim">
                <div className="flex justify-between py-0.5"><span>Strategic priorities (40%)</span><span className="f-mono">{live.breakdown.strategic}%</span></div>
                <div className="flex justify-between py-0.5"><span>Execution (20%)</span><span className="f-mono">{live.breakdown.exec}%</span></div>
                <div className="flex justify-between py-0.5"><span>Delegation (15%)</span><span className="f-mono">{live.breakdown.delegation}%</span></div>
                <div className="flex justify-between py-0.5"><span>Deep work (10%)</span><span className="f-mono">{live.breakdown.deepWork}%</span></div>
                <div className="flex justify-between py-0.5"><span>Personal consistency (15%)</span><span className="f-mono">{live.breakdown.personal}%</span></div>
              </div>
            </Card>
            <Card>
              <SectionHeading title="Myself, computed" icon={HeartPulse} />
              <div style={{ fontSize: 12.5 }} className="dim">
                <div className="flex justify-between py-1"><span>Tasks completed this week</span><span className="f-mono dim">{weekTasks.filter(t => t.status === "Completed").length}</span></div>
                <div className="flex justify-between py-1"><span>Overdue right now</span><span className="f-mono" style={{ color: "var(--critical)" }}>{state.tasks.filter(isOverdue).length}</span></div>
                <div className="flex justify-between py-1"><span>Deep work hours</span><span className="f-mono">{deepWorkHours}h</span></div>
                <div className="flex justify-between py-1"><span>Meetings attended</span><span className="f-mono">{meetingsThisWeek.length}</span></div>
                <div className="flex justify-between py-1"><span>Delegated tasks completed</span><span className="f-mono">{delegationDone}</span></div>
              </div>
            </Card>
          </div>
          <div className="flex flex-col gap-3">
            <Card>
              <SectionHeading title="Company" icon={Building2} />
              <div className="grid grid-cols-2 gap-2">
                {["revenue", "orders", "aov", "cac", "roas", "newCustomers", "repeatCustomers"].map(k => (
                  <Field key={k} label={k === "aov" ? "AOV" : k === "cac" ? "CAC" : k === "roas" ? "ROAS" : k.replace(/([A-Z])/g, " $1")}>
                    <input className="input" value={form.company[k]} onChange={e => setCompany(k, e.target.value)} />
                  </Field>
                ))}
              </div>
              <Field label="Major problems / notes"><textarea className="textarea" value={form.company.notes} onChange={e => setCompany("notes", e.target.value)} /></Field>
            </Card>
            <Card>
              <SectionHeading title="Reflection" icon={MessageSquare} />
              <ReflectionField label="What went well?" value={form.wentWell} onChange={v => setForm(f => ({ ...f, wentWell: v }))} />
              <ReflectionField label="What didn't?" value={form.didntGoWell} onChange={v => setForm(f => ({ ...f, didntGoWell: v }))} />
              <ReflectionField label="What did I avoid?" value={form.avoided} onChange={v => setForm(f => ({ ...f, avoided: v }))} />
              <ReflectionField label="What is becoming a problem?" value={form.becomingProblem} onChange={v => setForm(f => ({ ...f, becomingProblem: v }))} />
              <ReflectionField label="What should I stop doing?" value={form.stopDoing} onChange={v => setForm(f => ({ ...f, stopDoing: v }))} />
              <ReflectionField label="What should I delegate?" value={form.delegate} onChange={v => setForm(f => ({ ...f, delegate: v }))} />
              <div className="label-eyebrow mb-1">Next week's top 3 outcomes</div>
              {[0, 1, 2].map(i => (
                <input key={i} className="input mb-2" value={form.nextWeekTop3[i] || ""} onChange={e => setTop3(i, e.target.value)} placeholder={`Outcome ${i + 1}`} />
              ))}
              <button className="btn btn-primary mt-2" onClick={() => actions.saveWeeklyReview(form, live.total)} type="button">
                {existing ? "Update this week's review" : "Save this week's review"}
              </button>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading title="Execution score trend" icon={TrendingUp} />
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer>
                <LineChart data={trendData}>
                  <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ background: "var(--bg-elev-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "var(--text)" }} />
                  <Line type="monotone" dataKey="score" stroke="var(--accent-strong)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <SectionHeading title="Company metrics by week" icon={Building2} />
            <div className="fos-scroll" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr className="faint" style={{ textAlign: "left" }}>
                    {["Week of", "Revenue", "Orders", "AOV", "CAC", "ROAS", "Score"].map(h => <th key={h} style={{ padding: "6px 10px", fontWeight: 500 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...state.weeklyReviews].sort((a, b) => b.weekOf.localeCompare(a.weekOf)).map(r => (
                    <tr key={r.id} className="taskrow">
                      <td style={{ padding: "6px 10px" }}>{humanDate(r.weekOf)}</td>
                      <td style={{ padding: "6px 10px" }}>{r.company?.revenue || "—"}</td>
                      <td style={{ padding: "6px 10px" }}>{r.company?.orders || "—"}</td>
                      <td style={{ padding: "6px 10px" }}>{r.company?.aov || "—"}</td>
                      <td style={{ padding: "6px 10px" }}>{r.company?.cac || "—"}</td>
                      <td style={{ padding: "6px 10px" }}>{r.company?.roas || "—"}</td>
                      <td style={{ padding: "6px 10px" }} className="f-mono">{r.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <SectionHeading title="Projects pulse" icon={FolderKanban} />
            <div className="flex gap-4 flex-wrap">
              {PROJECT_STATUSES.map(s => {
                const count = state.projects.filter(p => p.status === s).length;
                if (!count) return null;
                return <span key={s} className="tag" style={{ borderStyle: "solid", borderColor: projectStatusColor(s), color: projectStatusColor(s), background: "transparent" }}>{s}: {count}</span>;
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   INBOX & IDEAS VIEW
============================================================================ */

function InboxItemRow({ item, actions, openTask }) {
  const [open, setOpen] = useState(false);
  const [delegateTo, setDelegateTo] = useState("");
  return (
    <div className="taskrow py-2.5 px-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <CircleDot size={13} className="faint" style={{ marginTop: 3, flex: "none" }} />
          <div>
            <div style={{ fontSize: 13 }}>{item.text}</div>
            <div className="faint" style={{ fontSize: 11 }}>{humanDate(item.createdDate)}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)} type="button">Process</button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5 mt-2 ml-5">
          <button className="btn btn-sm" onClick={() => { actions.processInbox(item.id, "task"); setOpen(false); }} type="button">→ Task</button>
          <button className="btn btn-sm" onClick={() => { actions.processInbox(item.id, "personal_task"); setOpen(false); }} type="button">→ Personal task</button>
          <button className="btn btn-sm" onClick={() => { actions.processInbox(item.id, "idea"); setOpen(false); }} type="button">→ Idea</button>
          <button className="btn btn-sm" onClick={() => { actions.processInbox(item.id, "decision"); setOpen(false); }} type="button">→ Decision</button>
          <select className="select" style={{ width: "auto" }} value={delegateTo} onChange={e => setDelegateTo(e.target.value)}>
            {peopleOptions(state).filter(p => p !== "You").map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="btn btn-sm" onClick={() => { actions.processInbox(item.id, "delegate", { owner: delegateTo }); setOpen(false); }} type="button">→ Delegate</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { actions.deleteInboxItem(item.id); setOpen(false); }} type="button">Dismiss</button>
        </div>
      )}
    </div>
  );
}

function InboxIdeasView({ state, actions, openTask }) {
  const unprocessed = state.inbox.filter(i => !i.processed);
  const ideasByCategory = state.ideas.reduce((acc, idea) => { (acc[idea.category] = acc[idea.category] || []).push(idea); return acc; }, {});
  return (
    <div>
      <SectionHeading title="Inbox & Ideas" icon={InboxIcon} />
      <p className="dim mb-4" style={{ fontSize: 13 }}>Get it out of your head first. Decide what it is later.</p>
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <Card className="mb-3">
            <QuickAdd placeholder="Whatever's on your mind..." buttonLabel="Capture" onAdd={actions.addInboxItem} />
          </Card>
          <Card>
            <SectionHeading title={`Unprocessed (${unprocessed.length})`} icon={InboxIcon} />
            {unprocessed.length === 0 ? <EmptyState text="Inbox zero. Nice." icon={CheckCircle2} /> :
              unprocessed.map(i => <InboxItemRow key={i.id} item={i} actions={actions} openTask={openTask} />)}
          </Card>
        </div>
        <div>
          <Card className="mb-3">
            <QuickAdd placeholder="New someday idea..." buttonLabel="Add" onAdd={(text) => actions.addIdea(text, "General")} />
          </Card>
          <Card>
            <SectionHeading title="Ideas / Someday" icon={Sparkles} />
            {Object.keys(ideasByCategory).length === 0 ? <EmptyState text="No ideas parked yet." icon={Sparkles} /> : Object.entries(ideasByCategory).map(([cat, ideas]) => (
              <div key={cat} className="mb-3">
                <div className="label-eyebrow mb-1.5">{cat}</div>
                {ideas.map(idea => (
                  <div key={idea.id} className="taskrow flex items-center justify-between gap-2 py-2 px-1">
                    <span style={{ fontSize: 12.5, opacity: idea.activated ? 0.5 : 1 }}>{idea.text}</span>
                    {idea.activated ? <span className="tag tag-good">Activated</span> :
                      <button className="btn btn-ghost btn-sm" onClick={() => actions.activateIdea(idea.id)} type="button">Activate</button>}
                  </div>
                ))}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SIDEBAR / NAV
============================================================================ */

const NAV_GROUPS = [
  { label: "Overview", items: [{ key: "today", label: "Today", icon: Home }] },
  { label: "Work", items: [
    { key: "tasks", label: "Tasks", icon: ListChecks },
    { key: "founder", label: "Founder Work", icon: Target },
    { key: "projects", label: "Projects", icon: FolderKanban },
    { key: "departments", label: "Departments", icon: Building2 },
  ]},
  { label: "Collaboration", items: [
    { key: "meetings", label: "Meetings", icon: CalendarClock },
    { key: "decisions", label: "Decisions", icon: Scale },
    { key: "delegation", label: "Delegation", icon: Users },
  ]},
  { label: "You", items: [
    { key: "personal", label: "Personal", icon: HeartPulse },
    { key: "goals", label: "Goals", icon: Flag },
    { key: "review", label: "Weekly Review", icon: BarChart3 },
  ]},
  { label: "Capture", items: [{ key: "inbox", label: "Inbox & Ideas", icon: InboxIcon }] },
];

function NavList({ activeView, setActiveView, counts, onNavigate }) {
  return (
    <>
      {NAV_GROUPS.map(group => (
        <div key={group.label} className="mb-4">
          <div className="label-eyebrow mb-1.5 px-2">{group.label}</div>
          {group.items.map(item => (
            <div key={item.key} className={`navitem ${activeView === item.key ? "navitem-active" : ""}`} onClick={() => { setActiveView(item.key); onNavigate && onNavigate(); }}>
              <item.icon size={15} />
              <span className="flex-1">{item.label}</span>
              {counts[item.key] > 0 && <span className="f-mono faint" style={{ fontSize: 10.5 }}>{counts[item.key]}</span>}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function Sidebar({ activeView, setActiveView, counts, resetData }) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <aside className="hidden md:flex md:flex-col fos-scroll" style={{ width: 236, flex: "none", borderRight: "1px solid var(--border-soft)", padding: "18px 12px", overflowY: "auto" }}>
      <div className="flex items-center gap-2 px-2 mb-6">
        <div style={{ width: 26, height: 26, borderRadius: 7, border: "1.5px dashed var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <span className="f-mono" style={{ fontSize: 11, color: "var(--accent-strong)" }}>OC</span>
        </div>
        <div>
          <div className="f-display font-semibold" style={{ fontSize: 13.5, letterSpacing: "0.02em" }}>OFFCOMFRT</div>
          <div className="faint f-mono" style={{ fontSize: 9.5, letterSpacing: "0.08em" }}>FOUNDER OS</div>
        </div>
      </div>
      <NavList activeView={activeView} setActiveView={setActiveView} counts={counts} />
      <div className="flex-1" />
      <div className="px-2">
        <button className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => {
          if (confirmReset) { resetData(); setConfirmReset(false); } else { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 3000); }
        }} type="button">
          <RotateCcw size={12} />{confirmReset ? "Click again to confirm" : "Clear workspace"}
        </button>
      </div>
    </aside>
  );
}

function MobileNav({ activeView, setActiveView }) {
  return (
    <nav className="flex md:hidden tab-strip" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-soft)" }}>
      {NAV_GROUPS.flatMap(g => g.items).map(item => (
        <div key={item.key} className={`tab ${activeView === item.key ? "tab-active" : ""}`} style={{ display: "flex", alignItems: "center", gap: 5 }} onClick={() => setActiveView(item.key)}>
          <item.icon size={13} />{item.label}
        </div>
      ))}
    </nav>
  );
}

/* ============================================================================
   TODAY VIEW — the command center
============================================================================ */

function CheckInBanner({ onSubmit }) {
  const [time, setTime] = useState(null);
  const [energy, setEnergy] = useState(null);
  return (
    <Card className="mb-4" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
      <div className="flex items-center gap-2 mb-3"><Sunrise size={15} style={{ color: "var(--accent-strong)" }} /><span className="f-display font-semibold" style={{ fontSize: 14 }}>Morning check-in</span></div>
      <div className="mb-3">
        <div className="label-eyebrow mb-1.5">How much time do you realistically have today?</div>
        <div className="flex gap-2 flex-wrap">
          {["2 hours", "4 hours", "6 hours", "8+ hours"].map(t => (
            <button key={t} className={`btn btn-sm ${time === t ? "btn-primary" : ""}`} onClick={() => setTime(t)} type="button">{t}</button>
          ))}
        </div>
      </div>
      <div className="mb-3">
        <div className="label-eyebrow mb-1.5">Energy</div>
        <div className="flex gap-2">
          {["Low", "Medium", "High"].map(e => (
            <button key={e} className={`btn btn-sm ${energy === e ? "btn-primary" : ""}`} onClick={() => setEnergy(e)} type="button">{e}</button>
          ))}
        </div>
      </div>
      <button className="btn btn-primary" disabled={!time || !energy} onClick={() => onSubmit(time, energy)} type="button">Set today's focus</button>
    </Card>
  );
}

function CheckoutModal({ onClose, onSave, top3, tomorrowSuggestion }) {
  const [status, setStatus] = useState("Partially");
  const [accomplished, setAccomplished] = useState("");
  const [unfinished, setUnfinished] = useState("");
  const [reason, setReason] = useState("Didn't have time");
  const [tomorrowFirst, setTomorrowFirst] = useState(tomorrowSuggestion || "");
  return (
    <Modal onClose={onClose}>
      <ModalHeader title="End-of-day checkout" onClose={onClose} />
      <div className="p-4">
        <Field label="Did you complete your Top 3?">
          <div className="flex gap-2">{["Yes", "Partially", "No"].map(s => <button key={s} className={`btn btn-sm ${status === s ? "btn-primary" : ""}`} onClick={() => setStatus(s)} type="button">{s}</button>)}</div>
        </Field>
        <Field label="What did you actually accomplish?"><textarea className="textarea" value={accomplished} onChange={e => setAccomplished(e.target.value)} /></Field>
        <Field label="What remains unfinished?"><textarea className="textarea" value={unfinished} onChange={e => setUnfinished(e.target.value)} /></Field>
        <Field label="Why?">
          <select className="select" value={reason} onChange={e => setReason(e.target.value)}>
            {["Didn't have time", "Procrastinated", "Waiting on someone", "Unexpected work", "Poor planning", "Low energy"].map(r => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Tomorrow's first task"><input className="input" value={tomorrowFirst} onChange={e => setTomorrowFirst(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 mt-3">
          <button className="btn" onClick={onClose} type="button">Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({ date: todayISO(), top3Status: status, accomplished, unfinished, reason, tomorrowFirst })} type="button">Save checkout</button>
        </div>
      </div>
    </Modal>
  );
}

function StartNowCard({ task, actions, openTask }) {
  if (!task) return <Card><EmptyState text="Nothing queued — add a task to get started." icon={Zap} /></Card>;
  const project = task.projectId;
  return (
    <Card style={{ borderColor: "var(--accent)" }}>
      <div className="flex items-center gap-2 mb-2"><Zap size={15} style={{ color: "var(--accent-strong)" }} /><span className="label-eyebrow" style={{ color: "var(--accent-strong)" }}>Start now</span></div>
      <div className="f-display font-semibold mb-1.5" style={{ fontSize: 17 }}>{task.name}</div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <PriorityTag p={task.priority} /><DeptTag d={task.department} />
        {task.estMinutes && <span className="tag tag-plain"><Clock size={10} />{task.estMinutes}m</span>}
        {task.dueDate && <span className="tag tag-plain">Due {humanDate(task.dueDate)}</span>}
      </div>
      {task.notes && <p className="dim mb-3" style={{ fontSize: 12.5 }}>{task.notes}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={() => actions.completeTask(task)} type="button"><Check size={13} />Mark complete</button>
        <button className="btn" onClick={() => openTask(task)} type="button">View details</button>
      </div>
    </Card>
  );
}

function EnergyBar({ allocation }) {
  const labels = { deep_work: "Deep Work", execution: "Execution", people: "People", admin: "Admin" };
  const colors = { deep_work: "var(--accent)", execution: "var(--important)", people: "var(--good)", admin: "var(--low)" };
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden" }}>
        {Object.entries(allocation.buckets).map(([k, v]) => v > 0 && (
          <div key={k} style={{ width: `${(v / allocation.total) * 100}%`, background: colors[k] }} title={labels[k]} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {Object.entries(allocation.buckets).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5" style={{ fontSize: 11.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: colors[k] }} />
            <span className="dim">{labels[k]}</span>
            <span className="f-mono faint">{(v / 60).toFixed(1)}h</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TodayView({ state, actions, openTask, goTo }) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(state.founderName);

  const todayTasks = state.tasks.filter(t => isDueToday(t) && isActive(t.status));
  const meetingsToday = state.meetings.filter(m => isTodayISO(m.date));
  const followUps = state.tasks.filter(t => t.founderArea === "followup" && isActive(t.status) && (isDueToday(t) || isOverdue(t)));
  const overdueCount = state.tasks.filter(isOverdue).length;
  const blockedCount = state.tasks.filter(t => t.status === "Blocked").length;
  const waitingCount = state.tasks.filter(t => t.status === "Waiting").length;
  const decisionsCount = state.tasks.filter(t => t.founderArea === "decisions" && isActive(t.status)).length;

  const mits = state.tasks.filter(t => t.isMIT).sort((a, b) => (a.mitRank || 9) - (b.mitRank || 9));
  const startNow = suggestStartNow(state);
  const avoiding = computeAvoiding(state);
  const energyAlloc = computeEnergyAllocation(state);

  const weekTasks = state.tasks.filter(t => t.dueDate && inThisWeek(t.dueDate));
  const weekDone = weekTasks.filter(t => t.status === "Completed").length;
  const weekPct = weekTasks.length ? Math.round((weekDone / weekTasks.length) * 100) : 0;
  const weeklyGoals = state.goals.filter(g => g.level === "weekly");

  const todayPersonal = state.personalLog.find(p => p.date === todayISO());

  const checkedInToday = state.checkIn && state.checkIn.date === todayISO();
  const checkedOutToday = state.checkout && state.checkout.date === todayISO();

  return (
    <div>
      <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="f-display font-semibold" style={{ fontSize: 23 }}>
              Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}
              {state.founderName ? `, ${state.founderName}` : ""}
            </h1>
            {!nameEditing ? (
              <button className="btn-ghost btn-icon btn" onClick={() => setNameEditing(true)} title="Set your name" type="button"><Pencil size={11} /></button>
            ) : (
              <div className="flex items-center gap-1">
                <input className="input" style={{ width: 140 }} value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder="Your name" autoFocus />
                <IconBtn icon={Check} onClick={() => { actions.setFounderName(nameDraft); setNameEditing(false); }} />
              </div>
            )}
          </div>
          <p className="dim" style={{ fontSize: 13.5 }}>{humanDateLong(todayISO())}</p>
        </div>
        {checkedInToday && !checkedOutToday && (
          <button className="btn btn-sm" onClick={() => setCheckoutOpen(true)} type="button"><Moon size={12} />End-of-day checkout</button>
        )}
      </div>

      {!checkedInToday && <div className="mt-4"><CheckInBanner onSubmit={(time, energy) => actions.setCheckIn({ date: todayISO(), timeAvailable: time, energy })} /></div>}
      {checkedInToday && (
        <div className="mb-4 flex items-center gap-2 dim" style={{ fontSize: 12.5 }}>
          <Coffee size={13} />
          <span>{state.checkIn.timeAvailable} · {state.checkIn.energy} energy — {recommendWorkload(state.checkIn.timeAvailable, state.checkIn.energy)}</span>
        </div>
      )}

      <div className="grid gap-4 mt-2" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading title="Focus Today — Top 3" icon={Target} />
            {mits.length === 0 ? (
              <EmptyState text="No top priorities set. Star a task from Tasks to add one." icon={Star} />
            ) : (
              <div className="flex flex-col gap-2 mb-3">
                {mits.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-3 py-1.5">
                    <span className="f-mono faint" style={{ fontSize: 13, width: 14 }}>{i + 1}</span>
                    <button className="checkbox-ring" onClick={() => actions.completeTask(t)} type="button">
                      {t.status === "Completed" && <Check size={11} style={{ color: "var(--good)" }} />}
                    </button>
                    <span className="flex-1 cursor-pointer" style={{ fontSize: 13.5, textDecoration: t.status === "Completed" ? "line-through" : "none" }} onClick={() => openTask(t)}>{t.name}</span>
                    <PriorityTag p={t.priority} />
                  </div>
                ))}
              </div>
            )}
            <StartNowCard task={startNow} actions={actions} openTask={openTask} />
          </Card>

          <Card>
            <SectionHeading title="Needs Attention" icon={AlertTriangle} />
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Overdue", value: overdueCount, tab: "overdue" },
                { label: "Blocked", value: blockedCount, tab: "blocked" },
                { label: "Waiting", value: waitingCount, tab: "waiting" },
                { label: "Decisions pending", value: decisionsCount, view: "founder" },
              ].map(item => (
                <div key={item.label} className="card-raised p-3 cursor-pointer" onClick={() => item.view ? goTo(item.view) : goTo("tasks", item.tab)}>
                  <div className="f-mono font-semibold" style={{ fontSize: 20, color: item.value > 0 ? "var(--important)" : "var(--good)" }}>{item.value}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{item.label}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeading title="What Am I Avoiding?" icon={Sparkles} />
            {avoiding.length === 0 ? (
              <EmptyState text="Nothing obviously being avoided this week." icon={CheckCircle2} />
            ) : (
              <div className="flex flex-col gap-2">
                {avoiding.map((item, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 cursor-pointer taskrow py-2 px-1" onClick={() => goTo(item.view)}>
                    <div className="flex items-start gap-2 min-w-0">
                      <AlertTriangle size={13} style={{ color: "var(--critical)", marginTop: 2, flex: "none" }} />
                      <div className="min-w-0">
                        <div style={{ fontSize: 13 }}>{item.text}</div>
                        <div className="faint" style={{ fontSize: 11 }}>{item.kind} · {item.detail}</div>
                      </div>
                    </div>
                    <ChevronRight size={14} className="faint" style={{ flex: "none" }} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeading title="Founder Energy This Week" icon={Zap} />
            <EnergyBar allocation={energyAlloc} />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between mb-1"><span className="faint" style={{ fontSize: 11.5 }}>Today</span></div>
            <div className="flex items-center gap-4">
              <div><div className="f-mono font-semibold" style={{ fontSize: 18 }}>{todayTasks.length}</div><div className="faint" style={{ fontSize: 11 }}>Tasks</div></div>
              <div><div className="f-mono font-semibold" style={{ fontSize: 18 }}>{meetingsToday.length}</div><div className="faint" style={{ fontSize: 11 }}>Meetings</div></div>
              <div><div className="f-mono font-semibold" style={{ fontSize: 18 }}>{followUps.length}</div><div className="faint" style={{ fontSize: 11 }}>Follow-ups</div></div>
            </div>
            {meetingsToday.length > 0 && (
              <div className="mt-3" style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 10 }}>
                {meetingsToday.map(m => (
                  <div key={m.id} className="flex items-center justify-between py-1 cursor-pointer" onClick={() => goTo("meetings")}>
                    <span style={{ fontSize: 12.5 }}>{m.name}</span>
                    <span className="faint f-mono" style={{ fontSize: 11 }}>{m.time}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeading title="Company" icon={Building2} action={<button className="btn btn-ghost btn-sm" onClick={() => goTo("departments")}>View all</button>} />
            <div className="flex flex-col gap-1.5">
              {state.departments.slice(0, 8).map(d => (
                <div key={d.id} className="flex items-center justify-between cursor-pointer" onClick={() => goTo("departments")}>
                  <div className="flex items-center gap-2"><HealthDot h={computedDeptHealth(d, state.tasks)} /><span style={{ fontSize: 12.5 }}>{d.name}</span></div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeading title="This Week" icon={CalendarClock} />
            <ProgressBar value={weekPct} height={8} />
            <div className="faint mt-1.5 mb-3" style={{ fontSize: 11.5 }}>{weekDone} of {weekTasks.length} tasks done · {weekPct}%</div>
            <div className="label-eyebrow mb-1.5">Top weekly outcomes</div>
            {weeklyGoals.slice(0, 3).map((g, i) => (
              <div key={g.id} className="flex items-start gap-1.5 mb-1" style={{ fontSize: 12 }}>
                <span className="f-mono faint">{i + 1}.</span><span className="dim">{g.title}</span>
              </div>
            ))}
          </Card>

          <Card>
            <SectionHeading title="Personal" icon={HeartPulse} action={<button className="btn btn-ghost btn-sm" onClick={() => goTo("personal")}>Log</button>} />
            {todayPersonal ? (
              <div className="flex items-center gap-4">
                <div><div className="f-mono" style={{ fontSize: 15 }}>{todayPersonal.exercise ? "Yes" : "No"}</div><div className="faint" style={{ fontSize: 10.5 }}>Exercised</div></div>
                <div><div className="f-mono" style={{ fontSize: 15 }}>{todayPersonal.energy}/10</div><div className="faint" style={{ fontSize: 10.5 }}>Energy</div></div>
                <div><div className="f-mono" style={{ fontSize: 15 }}>{todayPersonal.reading ? "Yes" : "No"}</div><div className="faint" style={{ fontSize: 10.5 }}>Read</div></div>
              </div>
            ) : <EmptyState text="No log yet today." />}
          </Card>
        </div>
      </div>

      {checkoutOpen && (
        <CheckoutModal
          onClose={() => setCheckoutOpen(false)}
          tomorrowSuggestion={mits.find(t => t.status !== "Completed")?.name || ""}
          onSave={(data) => { actions.setCheckout(data); setCheckoutOpen(false); }}
        />
      )}
    </div>
  );
}

/* ============================================================================
   APP SHELL
============================================================================ */

function LoadingScreen() {
  return (
    <div className="fos flex items-center justify-center" style={{ minHeight: "100vh" }}>
      <style>{GLOBAL_CSS}</style>
      <div className="flex flex-col items-center gap-2">
        <div style={{ width: 28, height: 28, borderRadius: 8, border: "1.5px dashed var(--accent)" }} />
        <span className="faint f-mono" style={{ fontSize: 11, letterSpacing: "0.08em" }}>LOADING FOUNDER OS…</span>
      </div>
    </div>
  );
}

const advanceDate = (iso, recurrence) => {
  if (recurrence === "Daily") return addDays(iso, 1);
  if (recurrence === "Weekly") return addDays(iso, 7);
  if (recurrence === "Monthly") return addDays(iso, 30);
  return iso;
};

const IDEA_CATEGORY_TO_DEPT = {
  Marketing: "Marketing", Content: "Content", Product: "Product & Design",
  Business: "Founder / Management", General: "Founder / Management",
};

export default function FounderOS() {
  const [state, setState] = useState(null);
  const [activeView, setActiveView] = useState("today");
  const [pendingTab, setPendingTab] = useState(null);
  const [drawerTask, setDrawerTask] = useState(null);
  const [toast, setToast] = useState(null);
  const hasLoaded = useRef(false);
  const saveTimer = useRef(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // Load
  useEffect(() => {
    (async () => {
      let loaded = null;
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) loaded = JSON.parse(res.value);
      } catch (e) {
        loaded = null;
      }
      setState(loaded || buildEmpty());
      hasLoaded.current = true;
    })();
  }, []);

  // Save (debounced)
  useEffect(() => {
    if (!hasLoaded.current || !state) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await window.storage.set(STORAGE_KEY, JSON.stringify(state), false); } catch (e) { /* ignore */ }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [state]);

  const goTo = useCallback((view, tab) => {
    setActiveView(view);
    if (tab) setPendingTab(tab);
  }, []);
  const openTask = useCallback((task) => setDrawerTask(task), []);
  const closeTask = useCallback(() => setDrawerTask(null), []);

  const actions = useMemo(() => ({
    addTask: (partial) => setState(s => ({ ...s, tasks: [...s.tasks, {
      id: partial.id || uid("t"), code: partial.code || nextCode(s.tasks, "TSK"),
      description: "", startDate: null, dueDate: null, estMinutes: null, actMinutes: null,
      recurring: false, recurrence: null, dependency: "", projectId: null, meetingId: null,
      goalId: null, founderArea: null, energyType: null, isMIT: false, mitRank: null,
      pushedCount: 0, notes: "", link: "", createdDate: todayISO(), category: "",
      ...partial,
    }] })),
    updateTask: (id, patch) => setState(s => ({ ...s, tasks: s.tasks.map(t => {
      if (t.id !== id) return t;
      let p = { ...patch };
      if (p.dueDate && t.dueDate && p.dueDate > t.dueDate && isActive(t.status)) p.pushedCount = (t.pushedCount || 0) + 1;
      return { ...t, ...p };
    }) })),
    deleteTask: (id) => setState(s => ({ ...s, tasks: s.tasks.filter(t => t.id !== id) })),
    completeTask: (task) => setState(s => {
      const willComplete = task.status !== "Completed";
      let tasks = s.tasks.map(t => t.id === task.id
        ? { ...t, status: willComplete ? "Completed" : "Planned", completedDate: willComplete ? todayISO() : null }
        : t);
      if (willComplete && task.recurring) {
        tasks = [...tasks, {
          ...task, id: uid("t"), code: nextCode(s.tasks, "TSK"), status: "Planned",
          dueDate: advanceDate(task.dueDate || todayISO(), task.recurrence),
          createdDate: todayISO(), actMinutes: null, isMIT: false, mitRank: null,
          pushedCount: 0, completedDate: null,
        }];
      }
      return { ...s, tasks };
    }),
    toggleMIT: (task) => setState(s => {
      const activeMits = s.tasks.filter(t => t.isMIT && isActive(t.status));
      if (!task.isMIT && activeMits.length >= 3) { showToast("Only 3 top priorities — remove one first"); return s; }
      const nextRank = task.isMIT ? null : (Math.max(0, ...activeMits.map(t => t.mitRank || 0)) + 1);
      return { ...s, tasks: s.tasks.map(t => t.id === task.id ? { ...t, isMIT: !t.isMIT, mitRank: t.isMIT ? null : nextRank } : t) };
    }),
    addProject: (p) => setState(s => ({ ...s, projects: [...s.projects, p] })),
    updateProject: (id, patch) => setState(s => ({ ...s, projects: s.projects.map(p => p.id === id ? { ...p, ...patch } : p) })),
    addDepartment: (name) => setState(s => ({ ...s, departments: [...s.departments, {
      id: uid("dep"), name, owner: "You", goal: "", priorities: [], kpis: [], issues: [], health: "good",
    }] })),
    addMeeting: (m) => setState(s => ({ ...s, meetings: [...s.meetings, m] })),
    updateMeeting: (id, patch) => setState(s => ({ ...s, meetings: s.meetings.map(m => m.id === id ? { ...m, ...patch } : m) })),
    addActionItemAsTask: (meetingId, ai) => {
      const meeting = state.meetings.find(m => m.id === meetingId);
      const newTask = {
        id: uid("t"), code: nextCode(state.tasks, "TSK"), name: ai.text,
        description: `From meeting: ${meeting ? meeting.name : ""}`, department: meeting ? meeting.department : "Founder / Management",
        category: "Follow-up", owner: ai.owner || "You", priority: "Normal", status: "Planned",
        createdDate: todayISO(), startDate: todayISO(), dueDate: ai.due, estMinutes: 30, actMinutes: null,
        recurring: false, recurrence: null, dependency: "", projectId: null, meetingId, goalId: null,
        founderArea: (ai.owner && ai.owner !== "You") ? "delegation" : "execution", energyType: "execution",
        isMIT: false, mitRank: null, pushedCount: 0, notes: "", link: "",
      };
      setState(s => ({ ...s, tasks: [...s.tasks, newTask] }));
      return newTask;
    },
    addDecision: (d) => setState(s => ({ ...s, decisions: [...s.decisions, d] })),
    updateDecision: (id, patch) => setState(s => ({ ...s, decisions: s.decisions.map(d => d.id === id ? { ...d, ...patch } : d) })),
    addInboxItem: (text) => setState(s => ({ ...s, inbox: [{ id: uid("ib"), text, createdDate: todayISO(), processed: false }, ...s.inbox] })),
    deleteInboxItem: (id) => setState(s => ({ ...s, inbox: s.inbox.filter(i => i.id !== id) })),
    processInbox: (id, type, extra) => setState(s => {
      const item = s.inbox.find(i => i.id === id);
      if (!item) return s;
      let next = { ...s, inbox: s.inbox.filter(i => i.id !== id) };
      const baseTask = {
        id: uid("t"), code: nextCode(s.tasks, "TSK"), name: item.text, description: "",
        category: "", priority: "Normal", status: "Inbox", createdDate: todayISO(), startDate: null,
        dueDate: null, estMinutes: null, actMinutes: null, recurring: false, recurrence: null,
        dependency: "", projectId: null, meetingId: null, goalId: null, founderArea: null,
        energyType: null, isMIT: false, mitRank: null, pushedCount: 0, notes: "", link: "",
      };
      if (type === "task") next.tasks = [...s.tasks, { ...baseTask, department: "Founder / Management", owner: "You" }];
      else if (type === "personal_task") next.tasks = [...s.tasks, { ...baseTask, department: "Personal", owner: "You" }];
      else if (type === "idea") next.ideas = [...s.ideas, { id: uid("idea"), text: item.text, category: "General", createdDate: todayISO(), activated: false }];
      else if (type === "decision") next.decisions = [...s.decisions, {
        id: uid("d"), code: nextCode(s.decisions, "DEC"), decision: item.text, date: todayISO(),
        department: "Founder / Management", context: "", options: "", decisionMade: item.text, why: "",
        owner: "You", expectedOutcome: "", reviewDate: relDate(21), actualOutcome: "",
      }];
      else if (type === "delegate") next.tasks = [...s.tasks, {
        ...baseTask, department: "Founder / Management", owner: extra.owner, status: "Waiting", founderArea: "delegation",
      }];
      showToast("Processed");
      return next;
    }),
    addIdea: (text, category) => setState(s => ({ ...s, ideas: [...s.ideas, { id: uid("idea"), text, category, createdDate: todayISO(), activated: false }] })),
    activateIdea: (id) => setState(s => {
      const idea = s.ideas.find(i => i.id === id);
      if (!idea) return s;
      const dept = IDEA_CATEGORY_TO_DEPT[idea.category] || "Founder / Management";
      const newTask = {
        id: uid("t"), code: nextCode(s.tasks, "TSK"), name: idea.text, description: "Activated from Someday list.",
        department: dept, category: "Idea", owner: "You", priority: "Normal", status: "Inbox",
        createdDate: todayISO(), startDate: null, dueDate: null, estMinutes: null, actMinutes: null,
        recurring: false, recurrence: null, dependency: "", projectId: null, meetingId: null, goalId: null,
        founderArea: "strategy", energyType: "deep_work", isMIT: false, mitRank: null, pushedCount: 0, notes: "", link: "",
      };
      showToast("Idea activated — added to Tasks");
      return { ...s, ideas: s.ideas.map(i => i.id === id ? { ...i, activated: true } : i), tasks: [...s.tasks, newTask] };
    }),
    savePersonalToday: (form) => setState(s => {
      const exists = s.personalLog.some(p => p.date === form.date);
      showToast("Log saved");
      return { ...s, personalLog: exists ? s.personalLog.map(p => p.date === form.date ? form : p) : [...s.personalLog, form] };
    }),
    setCheckIn: (obj) => setState(s => ({ ...s, checkIn: obj })),
    setCheckout: (obj) => { showToast("Checkout saved — see you tomorrow"); setState(s => ({ ...s, checkout: obj })); },
    saveWeeklyReview: (form, score) => setState(s => {
      const exists = s.weeklyReviews.find(r => r.weekOf === form.weekOf);
      const entry = { id: exists ? exists.id : uid("wr"), weekOf: form.weekOf, company: form.company, wentWell: form.wentWell, didntGoWell: form.didntGoWell, avoided: form.avoided, becomingProblem: form.becomingProblem, stopDoing: form.stopDoing, delegate: form.delegate, nextWeekTop3: form.nextWeekTop3, score };
      showToast("Weekly review saved");
      return { ...s, weeklyReviews: exists ? s.weeklyReviews.map(r => r.weekOf === form.weekOf ? entry : r) : [...s.weeklyReviews, entry] };
    }),
    addGoal: (g) => setState(s => ({ ...s, goals: [...s.goals, { id: uid("g"), ...g }] })),
    updateGoal: (id, patch) => setState(s => ({ ...s, goals: s.goals.map(g => g.id === id ? { ...g, ...patch } : g) })),
    setFounderName: (name) => setState(s => ({ ...s, founderName: name })),
  }), [state, showToast]);

  const resetData = useCallback(() => { setState(buildEmpty()); showToast("Workspace cleared"); }, [showToast]);

  if (!state) return <LoadingScreen />;

  const counts = {
    today: state.tasks.filter(t => isDueToday(t) && isActive(t.status)).length,
    overdue: state.tasks.filter(isOverdue).length,
  };

  const views = {
    today: <TodayView state={state} actions={actions} openTask={openTask} goTo={goTo} />,
    tasks: <TasksView state={state} actions={actions} openTask={openTask} initialTab={activeView === "tasks" ? pendingTab : null} consumeInitialTab={() => setPendingTab(null)} />,
    founder: <FounderWorkView state={state} actions={actions} openTask={openTask} />,
    projects: <ProjectsView state={state} actions={actions} openTask={openTask} />,
    departments: <DepartmentsView state={state} actions={actions} openTask={openTask} goTo={goTo} />,
    meetings: <MeetingsView state={state} actions={actions} openTask={openTask} />,
    decisions: <DecisionsView state={state} actions={actions} />,
    delegation: <DelegationView state={state} actions={actions} openTask={openTask} />,
    personal: <PersonalView state={state} actions={actions} openTask={openTask} />,
    goals: <GoalsView state={state} actions={actions} />,
    review: <WeeklyReviewView state={state} actions={actions} />,
    inbox: <InboxIdeasView state={state} actions={actions} openTask={openTask} />,
  };

  return (
    <div className="fos" style={{ display: "flex", minHeight: "100vh" }}>
      <style>{GLOBAL_CSS}</style>
      <Sidebar activeView={activeView} setActiveView={setActiveView} counts={counts} resetData={resetData} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav activeView={activeView} setActiveView={setActiveView} />
        <main className="fos-scroll flex-1" style={{ overflowY: "auto", padding: "22px 20px 60px" }}>
          <div style={{ maxWidth: 1180, margin: "0 auto" }}>
            {views[activeView]}
          </div>
        </main>
      </div>
      {drawerTask && <TaskDrawer task={drawerTask} onClose={closeTask} actions={actions} state={state} />}
      <Toast toast={toast} />
      <datalist id="people-list">{peopleOptions(state).map(p => <option key={p} value={p} />)}</datalist>
    </div>
  );
}
