// Waylay web console — i18n. Default zh; en switchable via header or ?lang=.
// Brand and design tokens stay constant; only visible copy changes.

(function () {
  "use strict";

  const STORAGE = "wl-lang";

  const messages = {
    zh: {
      "doc.title.landing":  "waylay» bridge — NTQQ 无头桥接 · OneBot v11 + Milky",
      "doc.title.qrcode":   "waylay» 登录 · /qrcode",
      "meta.description":   "轻量、高速、纯 JS 的 NTQQ 无头桥接，内置 OneBot v11 + Milky 协议支持。",

      "nav.home":           "首页",
      "nav.docs":           "文档",
      "nav.qrcode":         "/qrcode",
      "nav.toggleTheme":    "切换主题",
      "nav.toggleLang":     "切换语言",
      "nav.github":         "GitHub",
      "nav.docsTitle":      "查看文档站（外部 wiki）",

      "hero.live":          "实时 · 当前实例",
      "hero.lede":          "轻量、高速、纯 JS 的 NTQQ 无头桥接，内置 OneBot v11 + Milky 协议支持。本控制台由 Bridge 进程直接提供。",
      "hero.cta.login":     "登录二维码",
      "hero.cta.docs":      "阅读文档",
      "hero.cta.status":    "/api/status",
      "hero.badges.deps":   "依赖 · 1 (ws)",
      "hero.badges.node":   "Node ≥18",

      "status.micro":       "实时状态 · 每 4 秒轮询",
      "status.h":           "Bridge 状态",
      "status.kernel":      "内核",
      "status.kernel.col":  "登录",
      "status.protocols":   "协议",
      "status.protocols.col": "适配器",
      "status.row.version": "版本",
      "status.row.uptime":  "运行时长",
      "status.row.login":   "登录态",
      "status.row.bport":   "Bridge 端口",
      "status.row.wsclients": "WS 客户端",
      "status.row.onebot":  "OneBot v11",
      "status.row.onebotc": "OneBot 客户端",
      "status.row.milky":   "Milky",
      "status.row.milkyc":  "Milky 客户端",

      "stats.lines":        "行纯 JavaScript",
      "stats.files":        "源文件数",
      "stats.deps":         "运行时依赖",
      "stats.glogin":       "get_login_info",

      "arch.micro":         "工作原理",
      "arch.h":             "直连 wrapper.node · 无抽象层",
      "arch.body":          "Waylay 在 QQ 的 Electron 进程中运行（补丁入口点），直接加载 wrapper.node，并在 WebSocket 端口上暴露 OneBot v11 + Milky。无内存注入，无协议重写，无浏览器侧 UI。",

      "lat.micro":          "查询延迟 · 10 轮平均值",
      "lat.h":              "极速读取 — 全部来自内存缓存",
      "lat.col.action":     "Action",
      "lat.col.waylay":     "Waylay",
      "lat.col.llonebot":   "LLOneBot",
      "lat.col.note":       "备注",
      "lat.note.qq":        "QQ 服务器往返延迟",

      "code.copy":          "复制",
      "code.copied":        "已复制",
      "code.text":          "TEXT",

      "qr.header":          "bridge · :13000/qrcode",
      "qr.pill.waiting":    "等待扫码",
      "qr.pill.loggedin":   "已登录",
      "qr.scan":            "请使用 QQ 手机版扫码登录",
      "qr.hint":            "或设置 <code>AUTO_LOGIN_QQ</code> 环境变量，重启时跳过扫码。",
      "qr.refresh":         "刷新二维码",
      "qr.status.checking": "检查中…",
      "qr.status.waiting":  "等待中 · 请用 QQ 手机版扫码",
      "qr.status.missing":  "二维码尚未就绪 · 等待内核",
      "qr.status.loggedin": "已登录",
      "qr.empty":           "二维码尚未生成",
      "qr.empty.sub":       "等待内核",
      "qr.loggedin":        "已登录",

      "footer.brand":       "waylay · 无头 ntqq 桥接",
      "footer.brand.qr":    "waylay · 登录",
      "footer.brand.dash":  "waylay · 控制台",
      "footer.docs":        "文档",
      "footer.qr":          "/qrcode",
      "footer.status":      "/api/status",
      "footer.png":         "/qrcode.png",
      "footer.home":        "首页",
    },
    en: {
      "doc.title.landing":  "waylay» bridge — NTQQ headless OneBot v11 + Milky bridge",
      "doc.title.qrcode":   "waylay» login · /qrcode",
      "meta.description":   "Lightweight, fast, pure-JS headless NTQQ bridge with built-in OneBot v11 + Milky protocol support.",

      "nav.home":           "Home",
      "nav.docs":           "Docs",
      "nav.qrcode":         "/qrcode",
      "nav.toggleTheme":    "Toggle theme",
      "nav.toggleLang":     "Switch language",
      "nav.github":         "GitHub",
      "nav.docsTitle":      "Open the documentation site (external wiki)",

      "hero.live":          "live · this instance",
      "hero.lede":          "Lightweight, fast, pure-JS headless NTQQ bridge with built-in OneBot v11 + Milky protocol support. This dashboard is served by the bridge process itself.",
      "hero.cta.login":     "Login QR",
      "hero.cta.docs":      "Read the docs",
      "hero.cta.status":    "/api/status",
      "hero.badges.deps":   "deps · 1 (ws)",
      "hero.badges.node":   "Node ≥18",

      "status.micro":       "Live status · polled every 4s",
      "status.h":           "Bridge state",
      "status.kernel":      "kernel",
      "status.kernel.col":  "login",
      "status.protocols":   "protocols",
      "status.protocols.col": "adapters",
      "status.row.version": "version",
      "status.row.uptime":  "uptime",
      "status.row.login":   "login",
      "status.row.bport":   "bridge port",
      "status.row.wsclients": "ws clients",
      "status.row.onebot":  "onebot v11",
      "status.row.onebotc": "onebot clients",
      "status.row.milky":   "milky",
      "status.row.milkyc":  "milky clients",

      "stats.lines":        "lines of plain JS",
      "stats.files":        "source files",
      "stats.deps":         "runtime dependency",
      "stats.glogin":       "get_login_info",

      "arch.micro":         "How it works",
      "arch.h":             "Direct wrapper.node · no abstraction",
      "arch.body":          "Waylay runs inside QQ's Electron process with a patched entry point, loads wrapper.node directly, and exposes OneBot v11 + Milky on clean WebSocket ports. No memory injection. No protocol reimplementation. No browser-side UI.",

      "lat.micro":          "Query latency · 10-round average",
      "lat.h":              "Fast, because reads come from memory",
      "lat.col.action":     "Action",
      "lat.col.waylay":     "Waylay",
      "lat.col.llonebot":   "LLOneBot",
      "lat.col.note":       "Note",
      "lat.note.qq":        "QQ server bound",

      "code.copy":          "copy",
      "code.copied":        "copied",
      "code.text":          "text",

      "qr.header":          "bridge · :13000/qrcode",
      "qr.pill.waiting":    "waiting",
      "qr.pill.loggedin":   "logged in",
      "qr.scan":            "Scan with QQ Mobile",
      "qr.hint":            "Or set <code>AUTO_LOGIN_QQ</code> to skip the scan on restart.",
      "qr.refresh":         "refresh qr",
      "qr.status.checking": "checking…",
      "qr.status.waiting":  "waiting · scan with QQ Mobile",
      "qr.status.missing":  "no qr yet · waiting for kernel",
      "qr.status.loggedin": "logged in",
      "qr.empty":           "no qr available yet",
      "qr.empty.sub":       "waiting for kernel",
      "qr.loggedin":        "logged in",

      "footer.brand":       "waylay · headless ntqq bridge",
      "footer.brand.qr":    "waylay · login",
      "footer.brand.dash":  "waylay · console",
      "footer.docs":        "docs",
      "footer.qr":          "/qrcode",
      "footer.status":      "/api/status",
      "footer.png":         "/qrcode.png",
      "footer.home":        "home",
    },
  };

  function detect() {
    try {
      const stored = localStorage.getItem(STORAGE);
      if (stored === "zh" || stored === "en") return stored;
    } catch (_) {}
    const qs = new URLSearchParams(location.search).get("lang");
    if (qs === "zh" || qs === "en") return qs;
    const nav = (navigator.language || "").toLowerCase();
    if (nav.startsWith("zh")) return "zh";
    if (nav.startsWith("en")) return "en";
    return "zh";
  }

  let lang = detect();

  function t(key) {
    return (messages[lang] && messages[lang][key]) || (messages.zh[key] || key);
  }

  function applyTo(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    Array.prototype.forEach.call(root.querySelectorAll("*"), function (el) {
      Array.prototype.forEach.call(el.attributes, function (a) {
        const m = /^data-i18n-attr-(.+)$/.exec(a.name);
        if (m) el.setAttribute(m[1], t(a.value));
      });
    });
    const titleKey = document.documentElement.getAttribute("data-i18n-title");
    if (titleKey) document.title = t(titleKey);
    const descKey = document.documentElement.getAttribute("data-i18n-meta-description");
    if (descKey) {
      const m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute("content", t(descKey));
    }
    document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
    document.querySelectorAll("[data-lang-label]").forEach(function (el) {
      el.textContent = lang === "zh" ? "EN" : "中";
    });
  }

  function setLang(next) {
    if (next !== "zh" && next !== "en") return;
    lang = next;
    try { localStorage.setItem(STORAGE, lang); } catch (_) {}
    applyTo();
  }

  function toggleLang() { setLang(lang === "zh" ? "en" : "zh"); }

  function init() {
    applyTo();
    document.querySelectorAll("[data-action='toggle-lang']").forEach(function (b) {
      b.addEventListener("click", toggleLang);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.WL_I18N = { t: t, setLang: setLang, getLang: function () { return lang; }, apply: applyTo };
})();
