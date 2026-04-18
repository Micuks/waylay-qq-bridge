"use strict";

/**
 * Minimal repro for the get_stranger_info timeout 顽疾.
 *
 * Root cause (observed in the wild, fixed in src/onebot/events.js):
 *   NTQQ fires `onBuddyListChangedV2` with a boolean payload (true/false
 *   loading status), followed by `onBuddyListChange` with the real buddy
 *   snapshot.  The old _translateBuddyEvent treated both the same way — so
 *   the boolean event wiped _knownBuddyUins to empty and flipped
 *   _buddyListInitialized to true. When the real snapshot arrived, every
 *   buddy looked "new" and the bridge emitted a friend_add event per
 *   buddy.  Yunzai's friend_add handler calls pickFriend(uid).getInfo(),
 *   which issues get_stranger_info; the burst arrives before the bridge
 *   has finished initializing (or during a restart) and each echo times
 *   out 60s later in Yunzai's `this.echo` map.
 *
 * This script simulates the buggy sequence directly against the translator:
 *
 *   1. onBuddyListChangedV2 with payload `true`
 *   2. onBuddyListChange with a full category list of 5 buddies
 *   3. onBuddyListChangedV2 with payload `false`
 *   4. onBuddyListChange with the same full category list
 *
 * With the bug, steps 2 and 4 each emit 5 friend_add events (10 total).
 * After the fix, no friend_add events should fire — _knownBuddyUins only
 * unions, never shrinks, and boolean-payload events are ignored entirely.
 *
 * Usage:
 *   node repro-stranger-timeout.js
 */

const { EventTranslator } = require("./src/onebot/events");

const fakeBridge = { selfInfo: { uin: "3597656306" } };
const translator = new EventTranslator(fakeBridge);

const buddies = [
  { uin: "2903915755", uid: "u_a", nick: "拟态然" },
  { uin: "2605146565", uid: "u_b", nick: "." },
  { uin: "1356928358", uid: "u_c", nick: "." },
  { uin: "1781014930", uid: "u_d", nick: "冷若冰双" },
  { uin: "1227690602", uid: "u_e", nick: "😇" },
];
const fullSnapshot = [
  { categoryId: 9999, buddyList: [] },
  { categoryId: 0, buddyList: buddies },
];

function run(label, eventName, data) {
  const out = translator.translate("nodeIKernelBuddyListener", eventName, data);
  const adds = out.filter((e) => e.notice_type === "friend_add");
  console.log(
    `[${label}] event=${eventName} emitted=${out.length} friend_add=${adds.length}` +
    (adds.length ? " -> " + adds.map((e) => e.user_id).join(",") : "")
  );
  return adds.length;
}

console.log("=== repro: onBuddyListChangedV2 then onBuddyListChange sequence ===");
let totalAdds = 0;
totalAdds += run("step 1", "onBuddyListChangedV2", true);
totalAdds += run("step 2", "onBuddyListChange", fullSnapshot);
totalAdds += run("step 3", "onBuddyListChangedV2", false);
totalAdds += run("step 4", "onBuddyListChange", fullSnapshot);

console.log(`\nTotal friend_add events emitted across the 4 steps: ${totalAdds}`);
if (totalAdds === 0) {
  console.log("OK — bug is fixed (no spurious friend_add → no get_stranger_info burst)");
  process.exit(0);
} else {
  console.log("BUG — would trigger " + totalAdds + " get_stranger_info calls via Yunzai friend_add handler");
  process.exit(1);
}
