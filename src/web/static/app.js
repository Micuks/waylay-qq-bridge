// Waylay shared client script.
// Theme toggle, code-block copy, status polling, QR polling.

(function () {
  "use strict";

  const STORAGE = "wl-theme";

  function initTheme() {
    let theme;
    const qs = new URLSearchParams(location.search).get("theme");
    if (qs === "dark" || qs === "light") {
      theme = qs;
    } else {
      try { theme = localStorage.getItem(STORAGE); } catch (_) {}
      if (theme !== "dark" && theme !== "light") {
        theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
    }
    setTheme(theme);
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(STORAGE, theme); } catch (_) {}
    document.querySelectorAll("[data-theme-icon]").forEach(function (el) {
      el.hidden = el.dataset.themeIcon !== (theme === "dark" ? "sun" : "moon");
    });
  }

  function toggleTheme() {
    const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(cur === "dark" ? "light" : "dark");
  }

  function initThemeButton() {
    document.querySelectorAll("[data-action='toggle-theme']").forEach(function (btn) {
      btn.addEventListener("click", toggleTheme);
    });
  }

  function initCopyButtons() {
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const sel = btn.getAttribute("data-copy");
        const target = sel ? document.querySelector(sel) : btn.closest(".wl-code")?.querySelector("pre");
        if (!target) return;
        const text = target.innerText;
        const done = function () {
          const original = btn.textContent;
          btn.textContent = "copied";
          setTimeout(function () { btn.textContent = original; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch (_) {}
          document.body.removeChild(ta);
          done();
        }
      });
    });
  }

  function fmtUptime(sec) {
    sec = Math.floor(sec || 0);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return d + "d " + h + "h " + m + "m";
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m " + s + "s";
    return s + "s";
  }

  function setRow(name, value, badge) {
    const el = document.querySelector("[data-status='" + name + "']");
    if (!el) return;
    if (badge) {
      el.innerHTML = "";
      const span = document.createElement("span");
      span.className = "wl-badge wl-badge--" + badge;
      span.textContent = value;
      el.appendChild(span);
    } else {
      el.textContent = value;
    }
  }

  function refreshStatus() {
    fetch("/api/status", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        setRow("version", s.version || "—");
        setRow("uptime", fmtUptime(s.uptime_sec));
        setRow("login",
          s.logged_in ? (s.uin ? "uin " + s.uin : "logged in") : "waiting",
          s.logged_in ? "ok" : "warn");
        setRow("ws_clients", String(s.bridge_ws_clients ?? 0));
        setRow("bridge_port", String(s.bridge_port ?? "—"));
        setRow("onebot",
          s.onebot.enabled ? (s.onebot.ws_port ? "ws :" + s.onebot.ws_port : "reverse only") : "disabled",
          s.onebot.enabled ? "ok" : undefined);
        setRow("onebot_clients", String(s.onebot.clients ?? 0));
        setRow("milky",
          s.milky.enabled ? "http :" + s.milky.port : "disabled",
          s.milky.enabled ? "ok" : undefined);
        setRow("milky_clients", String((s.milky.ws_clients ?? 0) + (s.milky.sse_clients ?? 0)));
      })
      .catch(function () { /* ignore transient errors */ });
  }

  function initStatusPanel() {
    if (!document.querySelector("[data-status='version']")) return;
    refreshStatus();
    setInterval(refreshStatus, 4000);
  }

  function initDocsNav() {
    const links = document.querySelectorAll(".wl-docs__nav-link");
    if (!links.length) return;
    function activate(id) {
      links.forEach(function (a) {
        const match = a.getAttribute("href") === "#" + id;
        a.classList.toggle("is-active", match);
      });
      document.querySelectorAll(".wl-docs__section").forEach(function (s) {
        s.classList.toggle("is-active", s.id === id);
      });
      if (history.replaceState) history.replaceState(null, "", "#" + id);
    }
    links.forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        const id = a.getAttribute("href").slice(1);
        activate(id);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    const initial = (location.hash || "").replace("#", "") || links[0].getAttribute("href").slice(1);
    activate(initial);
  }

  let qrLoggedIn = false;

  function setStampWaiting() {
    if (qrLoggedIn) return;
    const stamp = document.querySelector("[data-qr-status]");
    if (!stamp) return;
    stamp.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = "wl-dot wl-dot--live";
    stamp.appendChild(dot);
    stamp.appendChild(document.createTextNode("waiting · scan with QQ Mobile"));
  }

  function setStampMissing() {
    if (qrLoggedIn) return;
    const stamp = document.querySelector("[data-qr-status]");
    if (!stamp) return;
    stamp.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = "wl-dot wl-dot--warn";
    stamp.appendChild(dot);
    stamp.appendChild(document.createTextNode("no qr yet · waiting for kernel"));
  }

  function refreshQR() {
    const img = document.querySelector("[data-qr-img]");
    const empty = document.querySelector("[data-qr-empty]");
    if (!img) return;
    const url = "/qrcode.png?ts=" + Date.now();
    img.onload = function () {
      img.style.visibility = "visible";
      if (empty) empty.hidden = true;
      setStampWaiting();
    };
    img.onerror = function () {
      img.style.visibility = "hidden";
      if (empty) empty.hidden = false;
      setStampMissing();
    };
    img.src = url;
  }

  function setLoggedInOverlay(uin) {
    const overlay = document.querySelector("[data-qr-loggedin]");
    if (!overlay) return;
    overlay.hidden = false;
    const label = overlay.querySelector("[data-qr-loggedin-label]");
    if (label) label.textContent = uin ? "logged in · uin " + uin : "logged in";
  }

  function pollLoginState() {
    fetch("/api/status", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s.logged_in) return;
        qrLoggedIn = true;
        setLoggedInOverlay(s.uin);
        const stamp = document.querySelector("[data-qr-status]");
        if (stamp) {
          stamp.innerHTML = "";
          const dot = document.createElement("span");
          dot.className = "wl-dot wl-dot--ok";
          stamp.appendChild(dot);
          stamp.appendChild(document.createTextNode("logged in" + (s.uin ? " · " + s.uin : "")));
        }
      })
      .catch(function () {});
  }

  function initQrPage() {
    if (!document.querySelector("[data-qr-img]")) return;
    refreshQR();
    pollLoginState();
    setInterval(refreshQR, 5000);
    setInterval(pollLoginState, 3000);
    document.querySelectorAll("[data-action='refresh-qr']").forEach(function (b) {
      b.addEventListener("click", function (e) { e.preventDefault(); refreshQR(); });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initThemeButton();
    initCopyButtons();
    initStatusPanel();
    initDocsNav();
    initQrPage();
  });
})();
