import React from "react";
import ReactDOM from "react-dom/client";
import FounderOS from "./src/FounderOS.jsx";

/* ============================================================================
   Founder OS — Shopify/Render deployment entry
   - window.storage shim: cloud-synced via the Render backend
     (GET/PUT /api/founder-os/state) with localStorage as offline fallback
   - Login gate: reuses the existing admin JWT login before any data loads
============================================================================ */

const API_BASE = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "http://localhost:3000/api"
  : "https://exchange-return-tracking.onrender.com/api";
const TOKEN_KEY = "fos_token";
const USER_KEY = "fos_user";
const LS_KEY = "offcomfrt-founder-os-v1";

let saveTimer = null;

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers || {})
    }
  });
  if (res.status === 401 && localStorage.getItem(TOKEN_KEY)) {
    localStorage.removeItem(TOKEN_KEY); // expired token — force re-login on next load
    window.location.reload();
    throw new Error("Session expired");
  }
  return res;
}

async function pushToCloud(json) {
  try {
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { return; }
    const res = await api("/founder-os/state", {
      method: "PUT",
      body: JSON.stringify({ state: parsed })
    });
    if (!res.ok) throw new Error("save failed");
  } catch (e) { /* offline — local copy is already saved */ }
}

/* ------------------------------- LOGIN GATE ------------------------------- */

function showLoginGate() {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
                  background:#fafaf9;font-family:'Inter',ui-sans-serif,system-ui,sans-serif;">
        <form id="fos-login" style="background:#fff;border:1px solid #e7e5e4;border-radius:14px;padding:32px;
                                    width:min(360px,calc(100vw - 48px));box-shadow:0 12px 40px rgba(0,0,0,.08);">
          <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:20px;letter-spacing:-.01em;">OFFCOMFRT</div>
          <div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.1em;color:#a8a29e;
                      text-transform:uppercase;margin:4px 0 22px;">Founder OS</div>
          <input id="fos-username" type="text" placeholder="Username (optional)" autocomplete="username"
                 style="width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:10px;border:1px solid #e7e5e4;
                        border-radius:8px;font-size:13px;outline:none;">
          <input id="fos-password" type="password" placeholder="Password" autocomplete="current-password" required
                 style="width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:14px;border:1px solid #e7e5e4;
                        border-radius:8px;font-size:13px;outline:none;">
          <div id="fos-error" style="color:#dc2626;font-size:12px;min-height:16px;margin-bottom:8px;"></div>
          <button type="submit" style="width:100%;padding:11px;background:#1c1917;color:#fff;border:none;
                                       border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Sign in</button>
        </form>
      </div>`;
    document.body.appendChild(root);

    // Load Google Fonts used by the gate (app injects its own later)
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@400;600&display=swap";
    document.head.appendChild(link);

    root.querySelector("#fos-login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = root.querySelector("#fos-error");
      const btn = root.querySelector("button");
      const username = root.querySelector("#fos-username").value.trim();
      const password = root.querySelector("#fos-password").value;
      btn.disabled = true;
      btn.textContent = "Signing in…";
      errEl.textContent = "";
      try {
        const res = await fetch(API_BASE + "/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(username ? { username, password } : { password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) {
          throw new Error(data.error || "Sign-in failed");
        }
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, data.username || "founder");
        root.remove();
        resolve();
      } catch (err) {
        errEl.textContent = err.message || "Could not reach the server";
        btn.disabled = false;
        btn.textContent = "Sign in";
      }
    });
    setTimeout(() => root.querySelector("#fos-password").focus(), 50);
  });
}

/* ------------------------------ STORAGE SHIM ------------------------------ */

window.storage = window.storage || {
  async get(key) {
    if (key !== LS_KEY) {
      const v = localStorage.getItem(key);
      return v == null ? undefined : { value: v };
    }
    if (!localStorage.getItem(TOKEN_KEY)) await showLoginGate();
    try {
      const res = await api("/founder-os/state");
      if (res.ok) {
        const data = await res.json();
        if (data.state) {
          const json = JSON.stringify(data.state);
          localStorage.setItem(LS_KEY, json); // offline cache
          return { value: json };
        }
      }
    } catch (e) { /* fall through to local copy */ }
    const local = localStorage.getItem(LS_KEY);
    return local == null ? undefined : { value: local };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    if (key === LS_KEY && localStorage.getItem(TOKEN_KEY)) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => pushToCloud(value), 900);
    }
    return true;
  }
};

const mount = document.getElementById("app") || document.getElementById("root");
ReactDOM.createRoot(mount).render(<FounderOS />);
