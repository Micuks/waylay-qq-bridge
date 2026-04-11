"use strict";

const fs = require("fs");
const path = require("path");
const { oneBotToNt } = require("./message");
const { createListener } = require("../listener");

/**
 * OneBot v11 action handlers.
 * Each handler takes (params, bridge, eventTranslator) and returns the response data.
 */

/** Wrap a promise with a timeout. Rejects if the promise doesn't settle in time. */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const handlers = {};

// ---- Meta / Info ----

handlers.get_login_info = async (params, bridge) => {
  return {
    user_id: Number(bridge.selfInfo.uin) || 0,
    nickname: bridge.selfInfo.nickName || "",
  };
};

handlers.get_version_info = async () => {
  return {
    app_name: "waylay",
    app_version: "0.4.0",
    protocol_version: "v11",
    app_full_name: "waylay v0.4.0",
  };
};

handlers.get_status = async (params, bridge) => {
  return {
    online: !!bridge.session,
    good: !!bridge.session,
  };
};

// ---- Friend / User ----

handlers.get_friend_list = async (params, bridge, eventTranslator) => {
  // Serve from cache (populated by onBuddyListChange events)
  const cached = eventTranslator.getBuddyList();
  if (cached.size > 0) {
    const friends = [];
    for (const [uin, info] of cached) {
      friends.push({
        user_id: Number(uin) || 0,
        nickname: info.nick || info.remark || "",
        remark: info.remark || "",
      });
    }
    return friends;
  }
  // Cache empty — trigger a refresh (result arrives via listener)
  try { bridge.session?.getBuddyService().getBuddyList(true); } catch {}
  return [];
};

handlers.get_stranger_info = async (params, bridge, eventTranslator) => {
  const userId = String(params.user_id || "");
  const fallback = { user_id: Number(userId), nickname: "", sex: "unknown", age: 0 };
  if (!bridge.session) return fallback;

  // 1. Check buddy cache
  const buddy = eventTranslator.getBuddyList().get(userId);
  if (buddy?.nick) {
    return { user_id: Number(userId), nickname: buddy.nick, sex: "unknown", age: 0 };
  }
  // 2. Check group member cache (covers most Yunzai use cases)
  for (const [, members] of eventTranslator._groupMembers) {
    const member = members.get(userId);
    if (member?.nick) {
      return { user_id: Number(userId), nickname: member.nick, sex: "unknown", age: 0 };
    }
  }
  // 3. Event-based profile lookup via getUserSimpleInfo + onProfileSimpleChanged
  const uid = eventTranslator.getUidByUin(userId);
  if (uid) {
    try {
      const profilePromise = eventTranslator.waitForProfile(uid, 5000);
      bridge.session.getProfileService().getUserSimpleInfo(false, [uid]);
      const profile = await profilePromise;
      const nick = profile?.coreInfo?.nick || profile?.nick || "";
      if (nick) {
        return { user_id: Number(userId), nickname: nick, sex: "unknown", age: 0 };
      }
    } catch {}
  }
  return fallback;
};

// ---- Group ----

handlers.get_group_list = async (params, bridge, eventTranslator) => {
  // Use cached group list from onGroupListUpdate events
  const groups = eventTranslator.getGroupList();
  if (groups.length > 0) {
    return groups.map((g) => ({
      group_id: Number(g.groupCode) || 0,
      group_name: g.groupName || "",
      member_count: g.memberCount || 0,
      max_member_count: g.maxMember || 0,
    }));
  }
  // Fallback: trigger a refresh (data arrives via listener, return empty for now)
  try { bridge.session?.getGroupService().getGroupList(true); } catch {}
  return [];
};

handlers.get_group_info = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  const groups = eventTranslator.getGroupList();
  const g = groups.find((g) => g.groupCode === groupId);
  if (g) {
    return {
      group_id: Number(g.groupCode),
      group_name: g.groupName || "",
      member_count: g.memberCount || 0,
      max_member_count: g.maxMember || 0,
    };
  }
  return { group_id: Number(groupId), group_name: "", member_count: 0, max_member_count: 0 };
};

/**
 * Fetch group members via scene-based API.
 * Triggers getNextMemberList which delivers data via onMemberListChange listener,
 * populating the EventTranslator member cache.
 * Returns a Promise that resolves with cached data after a short delay.
 */
async function fetchGroupMembersAndWait(bridge, groupId, eventTranslator) {
  const groupService = bridge.session.getGroupService();
  try {
    const sceneId = groupService.createMemberListScene(groupId, `fetch_${Date.now()}`);
    await groupService.getNextMemberList(sceneId, undefined, 3000);
    try { groupService.destroyMemberListScene(sceneId); } catch {}
  } catch {}
  // Wait briefly for onMemberListChange events to populate cache
  await new Promise((r) => setTimeout(r, 500));
}

handlers.get_group_member_list = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  if (!bridge.session) return [];

  // Return from cache if populated (preloaded on startup)
  let cached = eventTranslator._groupMembers.get(groupId);
  if (!cached || cached.size === 0) {
    // Cache miss — trigger fetch and wait for listener callback
    await fetchGroupMembersAndWait(bridge, groupId, eventTranslator);
    cached = eventTranslator._groupMembers.get(groupId);
  }
  if (!cached || cached.size === 0) return [];

  const members = [];
  for (const [uin, info] of cached) {
    members.push(formatMember({
      uin, uid: info.uid, nick: info.nick, cardName: info.card,
    }, groupId));
  }
  return members;
};

handlers.get_group_member_info = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  const userId = String(params.user_id || "");
  if (!bridge.session) return formatMember({}, groupId);

  // Check cache first
  let member = eventTranslator.getGroupMember(groupId, userId);
  if (!member) {
    // Only fetch if the group's member cache is empty (not yet loaded)
    const groupCache = eventTranslator._groupMembers.get(groupId);
    if (!groupCache || groupCache.size === 0) {
      await fetchGroupMembersAndWait(bridge, groupId, eventTranslator);
      member = eventTranslator.getGroupMember(groupId, userId);
    }
  }
  if (member) {
    return formatMember({
      uin: userId, uid: member.uid, nick: member.nick, cardName: member.card,
    }, groupId);
  }
  return formatMember({ uin: userId }, groupId);
};

/** Register a media file with NTQQ — returns the expected path, or null. */
function registerMedia(msgService, md5, fileName, elementType) {
  const pathInfo = {
    md5HexStr: md5 || "",
    fileName: fileName || "",
    elementType,
    elementSubType: 0,
    thumbSize: 0,
    needCreate: true,
    downloadType: 1,
    file_uuid: "",
  };
  const mediaPath = msgService.getRichMediaFilePathForGuild(pathInfo);
  if (mediaPath) {
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  }
  return mediaPath || null;
}

function formatMember(m, groupId) {
  const role = m.role === 4 ? "owner" : m.role === 3 ? "admin" : "member";
  return {
    group_id: Number(groupId) || 0,
    user_id: Number(m.uin) || 0,
    nickname: m.nick || "",
    card: m.cardName || "",
    sex: "unknown",
    age: 0,
    area: "",
    join_time: Number(m.joinTime) || 0,
    last_sent_time: Number(m.lastSpeakTime) || 0,
    level: String(m.memberLevel || "0"),
    role,
    unfriendly: false,
    title: m.specialTitle || "",
    title_expire_time: 0,
    card_changeable: false,
    shut_up_timestamp: Number(m.shutUpTime) || 0,
  };
}

// ---- Messages ----

handlers.send_msg = async (params, bridge, eventTranslator) => {
  const messageType = params.message_type || (params.group_id ? "group" : "private");
  if (messageType === "group") {
    return handlers.send_group_msg(params, bridge, eventTranslator);
  }
  return handlers.send_private_msg(params, bridge, eventTranslator);
};

handlers.send_group_msg = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  const peer = { chatType: 2, peerUid: groupId, guildId: "" };
  return await sendMessage(peer, params.message, bridge, eventTranslator);
};

handlers.send_private_msg = async (params, bridge, eventTranslator) => {
  const userId = String(params.user_id || "");
  // Convert UIN to UID for NT API (C2C requires UID)
  let peerUid = eventTranslator.getUidByUin(userId);
  if (!peerUid) {
    // Try profile service
    try {
      const profileService = bridge.session.getProfileService();
      const result = await profileService.getUidByUin("FriendsServiceImpl", [userId]);
      peerUid = result?.uidInfo?.get(userId) || null;
    } catch {}
  }
  if (!peerUid) {
    // Try buddy service with getUserDetailInfoByUin
    try {
      const buddyService = bridge.session.getBuddyService();
      const buddyList = await buddyService.getBuddyList(true);
      for (const cat of buddyList?.data || []) {
        for (const buddy of cat.buddyList || []) {
          if (buddy.uin === userId) {
            peerUid = buddy.uid;
            eventTranslator.recordUinUid(userId, buddy.uid);
            break;
          }
        }
        if (peerUid) break;
      }
    } catch {}
  }
  if (!peerUid) {
    console.warn("[onebot-actions] Cannot resolve UID for UIN:", userId);
    peerUid = userId; // fallback, will likely fail
  }
  const peer = { chatType: 1, peerUid, guildId: "" };
  return await sendMessage(peer, params.message, bridge, eventTranslator);
};

async function sendMessage(peer, message, bridge, eventTranslator) {
  if (!bridge.session) throw new Error("Session not ready");

  // Build UID+name resolver for @ mentions (async pre-resolve, then sync pass to converter)
  const segments = Array.isArray(message) ? message : typeof message === "string" ? [] : [message];
  const atResolveMap = new Map(); // uin -> { uid, name }
  for (const seg of segments) {
    if (seg.type !== "at" || seg.data?.qq === "all") continue;
    const uin = String(seg.data?.qq || "");
    if (!uin || atResolveMap.has(uin)) continue;

    // 1. Check cached group member info
    if (peer.chatType === 2) {
      const member = eventTranslator.getGroupMember(peer.peerUid, uin);
      if (member?.uid) {
        atResolveMap.set(uin, { uid: member.uid, name: member.card || member.nick || null });
        continue;
      }
    }

    // 2. Check UIN→UID cache
    let uid = eventTranslator.getUidByUin(uin);

    // 3. Async fallback: profile service lookup
    if (!uid) {
      try {
        const r = await bridge.session.getProfileService().getUidByUin("FriendsServiceImpl", [uin]);
        uid = r?.uidInfo?.get(uin) || null;
        if (uid) eventTranslator.recordUinUid(uin, uid);
      } catch {}
    }

    // 4. Get display name from profile if we have uid
    let name = null;
    if (uid && peer.chatType === 2) {
      try {
        const profiles = await bridge.session.getProfileService().getUserSimpleInfo(false, [uid]);
        const p = profiles?.profileMap?.get(uid) || profiles?.get?.(uid);
        if (p) name = p.nick || p.nickName || null;
      } catch {}
    }

    atResolveMap.set(uin, { uid: uid || "", name });
  }

  const uidResolver = atResolveMap.size > 0 ? (uin) => atResolveMap.get(uin) || { uid: "", name: null } : null;
  const elements = await oneBotToNt(message, uidResolver);
  if (!elements.length) throw new Error("Empty message");

  // Resolve reply elements: convert OneBot short ID -> real NTQQ msgId
  for (const el of elements) {
    if (el.elementType === 7 && el.replyElement) {
      const shortId = Number(el.replyElement.replayMsgId);
      const realMsgId = eventTranslator.resolveShortId(shortId);
      if (realMsgId) {
        el.replyElement.replayMsgId = realMsgId;
      }
      const cached = eventTranslator.getCachedMsg(shortId);
      if (cached) {
        el.replyElement.replayMsgSeq = cached._ntMsgSeq || "0";
        el.replyElement.senderUin = String(cached.sender?.user_id || "0");
        el.replyElement.senderUinStr = String(cached.sender?.user_id || "0");
      }
    }
  }

  // Register media files with NTQQ and copy to the expected paths
  const msgService = bridge.session.getMsgService();
  for (const el of elements) {
    try {
      if (el.elementType === 2 && el.picElement?.sourcePath) {
        // Image
        const mediaPath = registerMedia(msgService, el.picElement.md5HexStr, el.picElement.fileName, 2);
        if (mediaPath) {
          fs.copyFileSync(el.picElement.sourcePath, mediaPath);
          el.picElement.sourcePath = mediaPath;
          console.log("[onebot-actions] Image registered at:", mediaPath);
        }
      } else if (el.elementType === 5 && el.videoElement?.filePath) {
        // Video — register video file and thumbnail
        const mediaPath = registerMedia(msgService, el.videoElement.videoMd5, el.videoElement.fileName, 5);
        if (mediaPath) {
          fs.copyFileSync(el.videoElement.filePath, mediaPath);
          el.videoElement.filePath = mediaPath;
          // Place thumbnail at the Thumb path
          const origThumbPath = el.videoElement.thumbPath?.get(0);
          if (origThumbPath) {
            const thumbDir = path.dirname(mediaPath).replace(/[/\\]Ori[/\\]?/, path.sep + "Thumb" + path.sep);
            const thumbFilePath = path.join(thumbDir, `${el.videoElement.videoMd5}_0.png`);
            fs.mkdirSync(path.dirname(thumbFilePath), { recursive: true });
            fs.copyFileSync(origThumbPath, thumbFilePath);
            el.videoElement.thumbPath = new Map([[0, thumbFilePath]]);
          }
          console.log("[onebot-actions] Video registered at:", mediaPath);
        }
      } else if (el.elementType === 4 && el.pttElement?.filePath) {
        // Voice/PTT
        const mediaPath = registerMedia(msgService, el.pttElement.md5HexStr, el.pttElement.fileName, 4);
        if (mediaPath) {
          fs.copyFileSync(el.pttElement.filePath, mediaPath);
          el.pttElement.filePath = mediaPath;
          console.log("[onebot-actions] Voice registered at:", mediaPath);
        }
      } else if (el.elementType === 3 && el.fileElement?.filePath) {
        // File
        const mediaPath = registerMedia(msgService, null, el.fileElement.fileName, 3);
        if (mediaPath) {
          fs.copyFileSync(el.fileElement.filePath, mediaPath);
          el.fileElement.filePath = mediaPath;
          console.log("[onebot-actions] File registered at:", mediaPath);
        }
      }
    } catch (e) {
      console.warn(`[onebot-actions] Media registration error (type ${el.elementType}):`, e.message);
    }
  }

  try {
    const msgService = bridge.session.getMsgService();
    const result = await msgService.sendMsg("0", peer, elements, new Map());
    console.log("[onebot-actions] sendMsg result:", JSON.stringify(result)?.substring(0, 200));

    // For media messages, sendMsg returns -1 immediately — the actual upload
    // happens asynchronously via BDH. The message is still created (onAddSendMsg fires).
    // We return the msgId from the result regardless.
    const msgId = result?.msgId || result?.result?.msgId || "0";
    const shortId = eventTranslator.createShortId(msgId);
    return { message_id: shortId };
  } catch (e) {
    console.error("[onebot-actions] sendMessage error:", e.message);
    throw e;
  }
}

handlers.delete_msg = async (params, bridge, eventTranslator) => {
  const shortId = Number(params.message_id);
  const msgId = eventTranslator.resolveShortId(shortId);
  if (!msgId || !bridge.session) return null;

  // Need to find the message to get peer info
  const cached = eventTranslator.getCachedMsg(shortId);
  if (cached) {
    const peer = cached.group_id
      ? { chatType: 2, peerUid: String(cached.group_id), guildId: "" }
      : { chatType: 1, peerUid: String(cached.user_id), guildId: "" };
    try {
      await bridge.session.getMsgService().recallMsg(peer, [msgId]);
    } catch (e) {
      console.error("[onebot-actions] delete_msg error:", e.message);
    }
  }
  return null;
};

handlers.get_msg = async (params, bridge, eventTranslator) => {
  const shortId = Number(params.message_id);
  const cached = eventTranslator.getCachedMsg(shortId);
  if (cached) {
    return {
      message_id: shortId,
      real_id: shortId,
      sender: cached.sender,
      time: cached.time,
      message: cached.message,
      raw_message: cached.raw_message,
    };
  }
  return null;
};

// ---- Forward messages ----

/**
 * Normalize a single segment to standard {type, data} format.
 * Handles flat segments like {type:"image", file:"..."} -> {type:"image", data:{file:"..."}}
 */
function normalizeSegment(seg) {
  if (typeof seg === "string") return { type: "text", data: { text: seg } };
  if (!seg || !seg.type) return null;
  // Already has a data object — standard format
  if (seg.data && typeof seg.data === "object") return seg;
  // Flat format: {type:"image", file:"...", ...} -> {type:"image", data:{file:"...", ...}}
  const { type, ...rest } = seg;
  return { type, data: rest };
}

/**
 * Extract sendable message content from a forward node.
 * Supports multiple formats used by different bot frameworks:
 *   - Standard OneBot v11: {type:"node", data:{content:[...segments]}}
 *   - Yunzai/TRSS:         {message: segment_or_array, nickname, user_id}
 *   - Flat content:        {content: segment_or_array, ...}
 */
function extractNodeContent(node) {
  if (!node) return null;

  // Standard OneBot v11 node format
  let raw = null;
  if (node.type === "node" && node.data) {
    raw = node.data.content || node.data.message;
  }
  // Yunzai format: {message: ..., nickname, user_id}
  if (raw == null && node.message !== undefined) {
    raw = node.message;
  }
  // Alternative: {content: [...]}
  if (raw == null && node.content !== undefined) {
    raw = node.content;
  }

  if (raw == null) return null;

  // Normalize to array
  if (typeof raw === "string") return [{ type: "text", data: { text: raw } }];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(normalizeSegment).filter(Boolean);
}

/**
 * Send a real combined forward message via multiForwardMsgWithComment.
 *
 * NTQQ requires msgIds backed by real sent messages for multiForwardMsg,
 * so we stage each node to self-peer (sendMsg), capture the real msgId
 * via onAddSendMsg, then forward all at once to the target.
 *
 * On failure, falls back to sending each node individually.
 */
async function sendForwardMsg(messages, destPeer, bridge, eventTranslator) {
  if (!bridge.session) throw new Error("Session not ready");

  const selfUid = bridge.selfInfo?.uid;
  if (!selfUid) {
    console.warn("[forward] No self UID, falling back to individual send");
    return await _sendForwardFallback(messages, destPeer, bridge, eventTranslator);
  }

  const selfPeer = { chatType: 1, peerUid: selfUid, guildId: "" };
  const msgService = bridge.session.getMsgService();
  const pendingQueue = []; // FIFO: onAddSendMsg resolvers in send order
  const msgInfos = [];

  const tempListener = createListener("", {
    onAddSendMsg(msgRecord) {
      if (msgRecord?.chatType === 1 && msgRecord?.peerUid === selfUid && pendingQueue.length > 0) {
        const pending = pendingQueue.shift();
        clearTimeout(pending.timer);
        pending.resolve(msgRecord.msgId);
      }
    },
  });
  msgService.addKernelMsgListener(tempListener);

  try {
    for (const node of messages) {
      const content = extractNodeContent(node);
      if (!content || content.length === 0) continue;

      const elements = await oneBotToNt(content);
      if (!elements.length) continue;

      // Register media files with NTQQ
      for (const el of elements) {
        try {
          if (el.elementType === 2 && el.picElement?.sourcePath) {
            const mp = registerMedia(msgService, el.picElement.md5HexStr, el.picElement.fileName, 2);
            if (mp) { fs.copyFileSync(el.picElement.sourcePath, mp); el.picElement.sourcePath = mp; }
          } else if (el.elementType === 5 && el.videoElement?.filePath) {
            const mp = registerMedia(msgService, el.videoElement.videoMd5, el.videoElement.fileName, 5);
            if (mp) {
              fs.copyFileSync(el.videoElement.filePath, mp); el.videoElement.filePath = mp;
              const tp = el.videoElement.thumbPath?.get(0);
              if (tp) {
                const td = path.dirname(mp).replace(/[/\\]Ori[/\\]?/, path.sep + "Thumb" + path.sep);
                const tf = path.join(td, `${el.videoElement.videoMd5}_0.png`);
                fs.mkdirSync(path.dirname(tf), { recursive: true });
                fs.copyFileSync(tp, tf);
                el.videoElement.thumbPath = new Map([[0, tf]]);
              }
            }
          } else if (el.elementType === 4 && el.pttElement?.filePath) {
            const mp = registerMedia(msgService, el.pttElement.md5HexStr, el.pttElement.fileName, 4);
            if (mp) { fs.copyFileSync(el.pttElement.filePath, mp); el.pttElement.filePath = mp; }
          }
        } catch (e) {
          console.warn("[forward] Media registration error:", e.message);
        }
      }

      // Stage to self-peer, capture real msgId via onAddSendMsg
      const msgIdPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("onAddSendMsg timeout")), 60000);
        pendingQueue.push({ resolve, reject, timer });
      });
      await msgService.sendMsg("0", selfPeer, elements, new Map());
      const msgId = await msgIdPromise;

      const nickname = node.nickname || node.data?.name || node.data?.nickname || bridge.selfInfo.nickName || "";
      msgInfos.push({ msgId, senderShowName: nickname });
    }

    if (msgInfos.length === 0) return { message_id: 0 };

    const result = await msgService.multiForwardMsgWithComment(
      msgInfos, selfPeer, destPeer, [], new Map()
    );
    console.log(`[forward] multiForwardMsg: ${msgInfos.length} nodes -> peer=${destPeer.peerUid}, result=${result?.errMsg || result?.result}`);
    return { message_id: 0 };

  } catch (e) {
    console.error("[forward] multiForwardMsg failed:", e.message, "- falling back to individual send");
    return await _sendForwardFallback(messages, destPeer, bridge, eventTranslator);
  } finally {
    try { msgService.removeKernelMsgListener(tempListener); } catch {}
    for (const p of pendingQueue) clearTimeout(p.timer);
  }
}

/** Fallback: send each node as an individual message (not combined forward). */
async function _sendForwardFallback(messages, peer, bridge, eventTranslator) {
  let lastMsgId = 0;
  for (const node of messages) {
    const content = extractNodeContent(node);
    if (!content || content.length === 0) continue;
    try {
      const result = await sendMessage(peer, content, bridge, eventTranslator);
      if (result?.message_id) lastMsgId = result.message_id;
    } catch (e) {
      console.error("[forward] fallback node error:", e.message);
    }
  }
  return { message_id: lastMsgId };
}

handlers.send_group_forward_msg = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  const messages = params.messages || [];
  const destPeer = { chatType: 2, peerUid: groupId, guildId: "" };
  return await sendForwardMsg(messages, destPeer, bridge, eventTranslator);
};

handlers.send_private_forward_msg = async (params, bridge, eventTranslator) => {
  const userId = String(params.user_id || "");
  let peerUid = eventTranslator.getUidByUin(userId);
  if (!peerUid) {
    try {
      const result = await bridge.session.getProfileService().getUidByUin("FriendsServiceImpl", [userId]);
      peerUid = result?.uidInfo?.get(userId) || null;
    } catch {}
  }
  if (!peerUid) {
    console.warn("[forward] send_private_forward_msg: cannot resolve UID for:", userId);
    peerUid = userId;
  }
  const destPeer = { chatType: 1, peerUid, guildId: "" };
  const messages = params.messages || [];
  return await sendForwardMsg(messages, destPeer, bridge, eventTranslator);
};

handlers.get_forward_msg = async (params, bridge) => {
  // Would need to fetch multi-forward message content
  return { messages: [] };
};


// ---- Group admin operations ----

handlers.set_group_ban = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().setMemberShutUp(
      String(params.group_id), [{ uid: String(params.user_id), timeStamp: params.duration || 0 }]
    );
  } catch {}
  return null;
};

handlers.set_group_whole_ban = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().setGroupShutUp(String(params.group_id), params.enable !== false);
  } catch {}
  return null;
};

handlers.set_group_kick = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().kickMember(
      String(params.group_id), [String(params.user_id)], params.reject_add_request || false
    );
  } catch {}
  return null;
};


handlers.set_group_admin = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().setMemberRole(
      String(params.group_id), String(params.user_id), params.enable ? 3 : 2
    );
  } catch {}
  return null;
};

handlers.set_group_card = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().modifyMemberCardName(
      String(params.group_id), String(params.user_id), params.card || ""
    );
  } catch {}
  return null;
};

handlers.set_group_name = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().modifyGroupName(String(params.group_id), params.group_name || "");
  } catch {}
  return null;
};

handlers.set_group_leave = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().quitGroup(String(params.group_id));
  } catch {}
  return null;
};

// ---- Stubs for APIs that Yunzai calls but we can gracefully fail ----

// Debug: dump service methods
handlers.__debug = async (params, bridge) => {
  const s = bridge.session;
  if (!s) return { error: "no session" };
  const result = {};
  try {
    const msf = s.getMSFService();
    result.msfStatus = msf.getMsfStatus();
    result.serverTime = msf.getServerTime();
  } catch (e) { result.msfError = e.message; }
  try { result.sessionId = s.getSessionId(); } catch {}
  try { result.accountPath = s.getAccountPath(); } catch {}
  return result;
};

/**
 * Full introspection of wrapper.node API surface.
 * Enumerates all wrapper exports, session services, and their methods with param counts.
 */
handlers.__introspect = async (params, bridge) => {
  const result = { wrapper: {}, session: {}, listeners: {} };

  // 1. All wrapper.node top-level exports
  try {
    const wrapperKeys = Object.keys(bridge.wrapper).sort();
    for (const key of wrapperKeys) {
      const val = bridge.wrapper[key];
      const type = typeof val;
      if (type === "function") {
        // It's a class or function — enumerate static methods and prototype
        const entry = { type: "class", static: [], prototype: [] };
        // Static methods
        for (const m of Object.getOwnPropertyNames(val).filter(m => m !== "constructor" && m !== "prototype" && m !== "length" && m !== "name")) {
          const fn = val[m];
          entry.static.push({ name: m, type: typeof fn, params: typeof fn === "function" ? fn.length : undefined });
        }
        // Prototype methods (for classes instantiated via .get() or .create())
        if (val.prototype) {
          for (const m of Object.getOwnPropertyNames(val.prototype).filter(m => m !== "constructor")) {
            const fn = val.prototype[m];
            entry.prototype.push({ name: m, type: typeof fn, params: typeof fn === "function" ? fn.length : undefined });
          }
        }
        // Try .get() to get singleton instance and enumerate its methods
        try {
          const inst = val.get();
          if (inst && typeof inst === "object") {
            entry.instance = [];
            for (const m of Object.getOwnPropertyNames(Object.getPrototypeOf(inst)).filter(m => m !== "constructor")) {
              const fn = inst[m];
              entry.instance.push({ name: m, type: typeof fn, params: typeof fn === "function" ? fn.length : undefined });
            }
          }
        } catch {}
        result.wrapper[key] = entry;
      } else {
        result.wrapper[key] = { type, value: String(val).substring(0, 100) };
      }
    }
  } catch (e) { result.wrapperError = e.message; }

  // 2. Session services — discover all get*Service methods and enumerate their methods
  const s = bridge.session;
  if (s) {
    try {
      const sessionProto = Object.getOwnPropertyNames(Object.getPrototypeOf(s))
        .filter(m => m !== "constructor").sort();
      result.session._methods = sessionProto.map(m => ({
        name: m, params: typeof s[m] === "function" ? s[m].length : undefined
      }));

      // Enumerate each get*Service method
      const serviceGetters = sessionProto.filter(m => /^get\w+Service/.test(m));
      for (const getter of serviceGetters) {
        try {
          const svc = s[getter]();
          if (!svc) continue;
          const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(svc))
            .filter(m => m !== "constructor").sort();
          result.session[getter] = methods.map(m => ({
            name: m, params: typeof svc[m] === "function" ? svc[m].length : undefined
          }));
        } catch (e) {
          result.session[getter] = { error: e.message };
        }
      }
    } catch (e) { result.sessionError = e.message; }
  }

  // 3. List all known listener class names from wrapper exports
  try {
    const listenerKeys = Object.keys(bridge.wrapper).filter(k => /Listener/i.test(k));
    for (const key of listenerKeys) {
      const cls = bridge.wrapper[key];
      if (cls?.prototype) {
        result.listeners[key] = Object.getOwnPropertyNames(cls.prototype)
          .filter(m => m !== "constructor")
          .map(m => ({ name: m, params: typeof cls.prototype[m] === "function" ? cls.prototype[m].length : undefined }));
      }
    }
  } catch (e) { result.listenersError = e.message; }

  return result;
};

handlers._set_model_show = async () => null;
handlers.get_guild_service_profile = async () => { throw new Error("not supported"); };
handlers.get_online_clients = async () => ({ clients: [] });
handlers.get_cookies = async () => ({ cookies: "" });
handlers.get_csrf_token = async () => ({ token: 0 });
handlers.get_guild_list = async () => [];
handlers.set_qq_profile = async () => null;
handlers.set_qq_avatar = async () => null;
handlers.send_like = async (params, bridge, eventTranslator) => {
  if (!bridge.session) return null;
  const userId = String(params.user_id || "");
  const times = Math.min(params.times || 1, 20);
  let uid = eventTranslator.getUidByUin(userId);
  if (!uid) {
    try {
      const r = await withTimeout(
        bridge.session.getProfileService().getUidByUin("FriendsServiceImpl", [userId]),
        5000
      );
      uid = r?.uidInfo?.get(userId);
      if (uid) eventTranslator.recordUinUid(userId, uid);
    } catch {}
  }
  if (!uid) return null;
  try {
    const profileLikeService = bridge.session.getProfileLikeService();
    const result = await withTimeout(
      profileLikeService.setBuddyProfileLike({
        friendUid: uid,
        sourceId: 71,
        doLikeCount: times,
        doLikeTollCount: 0,
      }),
      5000
    );
    if (result?.result !== 0) {
      console.warn("[onebot-actions] send_like failed:", result?.errMsg || "unknown error");
    }
  } catch (e) {
    console.warn("[onebot-actions] send_like error:", e.message);
  }
  return null;
};
handlers.set_group_special_title = async () => null;
handlers.send_group_sign = async () => null;
handlers.download_file = async () => ({ file: "" });
handlers.get_group_honor_info = async () => ({});
handlers.get_essence_msg_list = async () => ({ msg_list: [] });
handlers.set_essence_msg = async () => null;
handlers.delete_essence_msg = async () => null;
/**
 * Helper: call getGroupFileList and wait for the onGroupFileInfoUpdate callback.
 * Returns { files, folders } in OneBot v11 format.
 */
async function fetchGroupFiles(bridge, eventTranslator, groupCode, folderId) {
  const richMediaService = bridge.session.getRichMediaService();
  const param = {
    sortType: 1,
    fileCount: 100,
    startIndex: 0,
    sortOrder: 2,
    showOnlinedocFolder: 0,
  };
  // Only include folderId when listing a specific subfolder;
  // omitting it returns root files (empty string causes NTQQ to return nothing)
  if (folderId) param.folderId = folderId;
  const reqId = richMediaService.getGroupFileList(groupCode, param);
  // Register the wait immediately — the event fires asynchronously via the native callback
  const data = await eventTranslator.waitForGroupFileInfo(Number(reqId), 10000);
  if (data.retCode !== 0) {
    throw new Error(`getGroupFileList failed: retCode=${data.retCode}`);
  }
  const files = [];
  const folders = [];
  for (const item of data.item || []) {
    if (item.fileInfo) {
      const f = item.fileInfo;
      files.push({
        group_id: Number(groupCode) || 0,
        file_id: f.fileId || "",
        file_name: f.fileName || "",
        busid: f.busId || 0,
        file_size: Number(f.fileSize) || 0,
        upload_time: Number(f.uploadTime) || 0,
        dead_time: Number(f.deadTime) || 0,
        modify_time: Number(f.modifyTime) || 0,
        download_times: Number(f.downloadTimes) || 0,
        uploader: Number(f.uploaderUin) || 0,
        uploader_name: f.uploaderName || "",
      });
    }
    if (item.folderInfo) {
      const d = item.folderInfo;
      folders.push({
        group_id: Number(groupCode) || 0,
        folder_id: d.folderId || "",
        folder_name: d.folderName || "",
        create_time: Number(d.createTime) || 0,
        creator: Number(d.creatorUin) || 0,
        creator_name: d.creatorName || "",
        total_file_count: Number(d.totalFileCount) || 0,
      });
    }
  }
  return { files, folders };
}

handlers.get_group_file_system_info = async (params, bridge, eventTranslator) => {
  if (!bridge.session) return {};
  const groupCode = String(params.group_id || "");
  if (!groupCode) return {};
  try {
    const richMediaService = bridge.session.getRichMediaService();
    const [spaceResult, { files }] = await Promise.all([
      withTimeout(richMediaService.getGroupSpace(groupCode), 10000),
      fetchGroupFiles(bridge, eventTranslator, groupCode),
    ]);
    const space = spaceResult?.groupSpaceResult || {};
    return {
      file_count: files.length,
      limit_count: 10000,
      used_space: Number(space.usedSpace) || 0,
      total_space: Number(space.totalSpace) || 0,
    };
  } catch (e) {
    console.warn("[onebot-actions] get_group_file_system_info error:", e.message);
    return {};
  }
};

handlers.get_group_root_files = async (params, bridge, eventTranslator) => {
  if (!bridge.session) return { files: [], folders: [] };
  const groupCode = String(params.group_id || "");
  if (!groupCode) return { files: [], folders: [] };
  try {
    return await fetchGroupFiles(bridge, eventTranslator, groupCode);
  } catch (e) {
    console.warn("[onebot-actions] get_group_root_files error:", e.message);
    return { files: [], folders: [] };
  }
};

handlers.get_group_files_by_folder = async (params, bridge, eventTranslator) => {
  if (!bridge.session) return { files: [], folders: [] };
  const groupCode = String(params.group_id || "");
  const folderId = String(params.folder_id || "");
  if (!groupCode) return { files: [], folders: [] };
  try {
    return await fetchGroupFiles(bridge, eventTranslator, groupCode, folderId);
  } catch (e) {
    console.warn("[onebot-actions] get_group_files_by_folder error:", e.message);
    return { files: [], folders: [] };
  }
};

// get_group_file_url: NTQQ wrapper.node does not expose a direct file URL API.
// Returns empty — callers should use upload_group_file / download via the QQ client.
handlers.get_group_file_url = async () => ({ url: "" });
handlers.upload_group_file = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  const file = params.file || "";
  const name = params.name || path.basename(file);
  const peer = { chatType: 2, peerUid: groupId, guildId: "" };
  return await sendMessage(peer, [{ type: "file", data: { file, name } }], bridge, eventTranslator);
};

handlers.upload_private_file = async (params, bridge, eventTranslator) => {
  const userId = String(params.user_id || "");
  let peerUid = eventTranslator.getUidByUin(userId);
  if (!peerUid) {
    try {
      const r = await bridge.session.getProfileService().getUidByUin("FriendsServiceImpl", [userId]);
      peerUid = r?.uidInfo?.get(userId) || userId;
    } catch {}
  }
  const file = params.file || "";
  const name = params.name || path.basename(file);
  const peer = { chatType: 1, peerUid: peerUid || userId, guildId: "" };
  return await sendMessage(peer, [{ type: "file", data: { file, name } }], bridge, eventTranslator);
};
handlers.delete_group_file = async (params, bridge) => {
  if (!bridge.session) return null;
  const groupCode = String(params.group_id || "");
  const fileId = String(params.file_id || "");
  const busId = params.busid || params.bus_id || 102;
  if (!groupCode || !fileId) return null;
  try {
    const richMediaService = bridge.session.getRichMediaService();
    await withTimeout(
      richMediaService.deleteGroupFile(groupCode, [busId], [fileId]),
      10000
    );
  } catch (e) {
    console.warn("[onebot-actions] delete_group_file error:", e.message);
  }
  return null;
};

handlers.create_group_file_folder = async (params, bridge) => {
  if (!bridge.session) return null;
  const groupCode = String(params.group_id || "");
  const folderName = String(params.name || params.folder_name || "");
  if (!groupCode || !folderName) return null;
  try {
    const richMediaService = bridge.session.getRichMediaService();
    await withTimeout(
      richMediaService.createGroupFolder(groupCode, folderName),
      10000
    );
  } catch (e) {
    console.warn("[onebot-actions] create_group_file_folder error:", e.message);
  }
  return null;
};

handlers.delete_group_folder = async (params, bridge) => {
  if (!bridge.session) return null;
  const groupCode = String(params.group_id || "");
  const folderId = String(params.folder_id || "");
  if (!groupCode || !folderId) return null;
  try {
    const richMediaService = bridge.session.getRichMediaService();
    await withTimeout(
      richMediaService.deleteGroupFolder(groupCode, folderId),
      10000
    );
  } catch (e) {
    console.warn("[onebot-actions] delete_group_folder error:", e.message);
  }
  return null;
};
handlers.set_friend_add_request = async (params, bridge) => {
  if (!bridge.session) return null;
  const flag = String(params.flag || "");
  const approve = params.approve !== false;
  try {
    const buddyService = bridge.session.getBuddyService();
    if (typeof buddyService.approveOrRejectFriendRequest === "function") {
      await buddyService.approveOrRejectFriendRequest(flag, approve);
    } else if (typeof buddyService.handleFriendRequest === "function") {
      await buddyService.handleFriendRequest(flag, approve);
    }
  } catch (e) {
    console.error("[onebot-actions] set_friend_add_request error:", e.message);
  }
  return null;
};

handlers.set_group_add_request = async (params, bridge) => {
  if (!bridge.session) return null;
  const flag = String(params.flag || "");
  const approve = params.approve !== false;
  const reason = params.reason || "";
  const [seq, groupCode, type] = flag.split("|");
  if (!seq || !groupCode) return null;
  try {
    const groupService = bridge.session.getGroupService();
    // Try common method names across NTQQ versions
    if (typeof groupService.operateGroupReqNotify === "function") {
      await groupService.operateGroupReqNotify(approve ? 1 : 2, { groupCode, seq, type: Number(type) || 1 }, reason);
    } else if (typeof groupService.operateGroupNotify === "function") {
      await groupService.operateGroupNotify(approve ? 1 : 2, { groupCode, seq, type: Number(type) || 1 }, reason);
    } else if (typeof groupService.handleGroupRequest === "function") {
      await groupService.handleGroupRequest(groupCode, seq, approve, reason);
    }
  } catch (e) {
    console.error("[onebot-actions] set_group_add_request error:", e.message);
  }
  return null;
};

handlers.delete_friend = async () => null;
handlers.get_friend_msg_history = async () => ({ messages: [] });
handlers.get_group_msg_history = async () => ({ messages: [] });

handlers.can_send_image = async () => ({ yes: true });
handlers.can_send_record = async () => ({ yes: true });

handlers.get_image = async (params, bridge) => {
  const file = params.file || "";
  if (!bridge.session) return { file: "" };
  try {
    const pathInfo = {
      md5HexStr: "", fileName: file, elementType: 2, elementSubType: 0,
      thumbSize: 0, needCreate: false, downloadType: 1, file_uuid: "",
    };
    const filePath = bridge.session.getMsgService().getRichMediaFilePathForGuild(pathInfo);
    if (filePath && fs.existsSync(filePath)) {
      return { file: filePath, file_size: fs.statSync(filePath).size, filename: file };
    }
  } catch {}
  return { file: "" };
};

handlers.get_record = async (params, bridge) => {
  const file = params.file || "";
  if (!bridge.session) return { file: "" };
  try {
    const pathInfo = {
      md5HexStr: "", fileName: file, elementType: 4, elementSubType: 0,
      thumbSize: 0, needCreate: false, downloadType: 1, file_uuid: "",
    };
    const filePath = bridge.session.getMsgService().getRichMediaFilePathForGuild(pathInfo);
    if (filePath && fs.existsSync(filePath)) {
      return { file: filePath, file_size: fs.statSync(filePath).size, filename: file };
    }
  } catch {}
  return { file: "" };
};

handlers.group_poke = async (params, bridge, eventTranslator) => {
  if (!bridge.session) return null;
  const groupId = String(params.group_id || "");
  const userId = String(params.user_id || "");
  let uid = eventTranslator.getUidByUin(userId);
  if (!uid) {
    try {
      const r = await bridge.session.getProfileService().getUidByUin("FriendsServiceImpl", [userId]);
      uid = r?.uidInfo?.get(userId);
    } catch {}
  }
  if (!uid) uid = userId;
  try {
    const groupService = bridge.session.getGroupService();
    if (typeof groupService.sendPoke === "function") {
      await groupService.sendPoke(groupId, uid);
    }
  } catch (e) {
    console.error("[onebot-actions] group_poke error:", e.message);
  }
  return null;
};
handlers.send_group_poke = handlers.group_poke;

handlers.friend_poke = async (params, bridge, eventTranslator) => {
  if (!bridge.session) return null;
  const userId = String(params.user_id || "");
  let uid = eventTranslator.getUidByUin(userId);
  if (!uid) uid = userId;
  try {
    const msgService = bridge.session.getMsgService();
    if (typeof msgService.sendPoke === "function") {
      await msgService.sendPoke(uid);
    }
  } catch (e) {
    console.error("[onebot-actions] friend_poke error:", e.message);
  }
  return null;
};

module.exports = { handlers };
