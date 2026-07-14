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

module.exports = { parseVer, cmpVer, matchRange };
