"use strict";

/**
 * QQ 版本自适应 profile 注册表。
 * waylay 走 NTQQ 的 JS 原生 API（wrapper.node），少数东西随版本变化
 * （session 创建流程 / 内核返回字段名 / appid 提取）。本模块把这些版本敏感
 * 项收敛进按版本键控的注册表，并对未识别的更新版本用运行时能力探测做 best-effort。
 * 无第三方依赖：版本比较为内置实现。
 */

/** "3.2.31_51102" -> [3, 2, 31]，build 后缀忽略。 */
function parseVer(str) {
  const nums = String(str == null ? "" : str)
    .split(/[._-]/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  return [nums[0] || 0, nums[1] || 0, nums[2] || 0];
}

/** 按 [major, minor, patch] 数值比较，返回 -1 | 0 | 1。 */
function cmpVer(a, b) {
  const pa = parseVer(a);
  const pb = parseVer(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/** range 形如 ">=3.2.27" 或 "<3.2.27"。 */
function matchRange(version, range) {
  const m = String(range).match(/^(>=|<)(.+)$/);
  if (!m) return false;
  const op = m[1];
  const v = m[2];
  if (op === ">=") return cmpVer(version, v) >= 0;
  if (op === "<") return cmpVer(version, v) < 0;
  return false;
}

const PROFILES = [
  {
    key: "modern",
    range: ">=3.2.27",
    verifiedUpTo: "3.2.31",
    label: "3.2.27-3.2.31",
    session: { mode: "startup-session", wrapperName: "nt_1" },
    loginListFields: ["LocalLoginInfoList", "localLoginInfoList", "loginInfoList"],
    uinFields: ["uin", "Uin", "uinString"],
    appid: { source: "major.node", regex: "QQAppId/(\\d+)" },
  },
  {
    key: "legacy",
    range: "<3.2.27",
    verifiedUpTo: "3.2.26",
    label: "<3.2.27 (legacy)",
    session: { mode: "direct" },
    loginListFields: ["LocalLoginInfoList", "localLoginInfoList", "loginInfoList"],
    uinFields: ["uin", "Uin", "uinString"],
    appid: { source: "major.node", regex: "QQAppId/(\\d+)" },
  },
];

function cloneProfile(p) {
  return JSON.parse(JSON.stringify(p));
}

/** 运行时能力探测：只覆盖能确定的项，其余交由调用方保留 base。 */
function probeProfile(base, wrapper) {
  const out = {};
  if (wrapper) {
    const startup = wrapper.NodeIQQNTStartupSessionWrapper;
    const plain = wrapper.NodeIQQNTWrapperSession;
    if (startup && typeof startup.create === "function") {
      out.session = { mode: "startup-session", wrapperName: (base.session && base.session.wrapperName) || "nt_1" };
    } else if (plain && typeof plain.create === "function") {
      out.session = { mode: "direct" };
    }
  }
  return out;
}

/**
 * 解析已装 QQ 版本 -> 规范化 profile。
 * - range 命中且 <=verifiedUpTo -> exact
 * - range 命中但 >verifiedUpTo   -> probe（探测覆盖 + fallback base）
 * - 版本串无法解析/无命中        -> fallback（modern）
 */
function resolveProfile(version, wrapper, opts) {
  const log = (opts && opts.logger) || console;
  const hasDigits = /\d/.test(String(version == null ? "" : version));

  let base = hasDigits ? PROFILES.find((p) => matchRange(version, p.range)) : null;
  let resolvedBy = "exact";

  if (!base) {
    base = PROFILES.find((p) => p.key === "modern");
    resolvedBy = "fallback";
    log.warn(`[profiles] QQ version "${version}" unparseable/unmatched; falling back to ${base.label}`);
  } else if (cmpVer(version, base.verifiedUpTo) > 0) {
    resolvedBy = "probe";
  }

  const profile = cloneProfile(base);

  if (resolvedBy === "probe") {
    let overrides = {};
    try {
      overrides = probeProfile(base, wrapper) || {};
    } catch (e) {
      log.warn(`[profiles] probe failed for "${version}": ${e && e.message}; using ${base.label} as-is`);
      overrides = {};
    }
    if (overrides.session) profile.session = Object.assign({}, profile.session, overrides.session);
    log.warn(
      `[profiles] QQ version "${version}" is beyond verified ${base.verifiedUpTo}; ` +
        `best-effort profile (session.mode=${profile.session.mode})`
    );
  }

  profile.resolvedBy = resolvedBy;
  profile.version = String(version == null ? "" : version);
  return profile;
}

module.exports = { parseVer, cmpVer, matchRange, PROFILES, probeProfile, resolveProfile };
