"use strict";

const fs = require("fs");
const path = require("path");
const { oneBotToNt } = require("./message");

/**
 * OneBot v11 action handlers.
 * Each handler takes (params, bridge, eventTranslator) and returns the response data.
 */

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
    app_version: "0.2.0",
    protocol_version: "v11",
    app_full_name: "waylay v0.2.0",
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

handlers.get_stranger_info = async (params, bridge) => {
  const userId = String(params.user_id || "");
  if (!bridge.session) return { user_id: Number(userId), nickname: "", sex: "unknown", age: 0 };
  try {
    const profileService = bridge.session.getProfileService();
    const uids = await bridge.session.getUidByUin("FriendsServiceImpl", [userId]);
    const uid = uids?.uidInfo?.get(userId) || "";
    if (uid) {
      const profiles = await profileService.getUserSimpleInfo(false, [uid]);
      const profile = profiles?.profileMap?.get(uid) || profiles?.get?.(uid);
      if (profile) {
        return {
          user_id: Number(userId),
          nickname: profile.nick || profile.nickName || "",
          sex: "unknown",
          age: 0,
        };
      }
    }
  } catch {}
  return { user_id: Number(userId), nickname: "", sex: "unknown", age: 0 };
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
  const elements = oneBotToNt(message, uidResolver);
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

handlers.send_group_forward_msg = async (params, bridge, eventTranslator) => {
  // Forward messages require creating a multi-forward message
  // This is complex and requires NT API's multiForwardMsg
  // For now, send each node as a separate message as a fallback
  const groupId = String(params.group_id || "");
  const messages = params.messages || [];
  const peer = { chatType: 2, peerUid: groupId, guildId: "" };

  for (const node of messages) {
    if (node.type !== "node" || !node.data?.content) continue;
    try {
      const elements = oneBotToNt(node.data.content);
      if (elements.length) {
        await bridge.session.getMsgService().sendMsg("0", peer, elements, new Map());
      }
    } catch (e) {
      console.error("[onebot-actions] send_group_forward_msg node error:", e.message);
    }
  }
  return { message_id: 0 };
};

handlers.send_private_forward_msg = async (params, bridge, eventTranslator) => {
  const userId = String(params.user_id || "");
  let peerUid = userId;
  try {
    const result = await bridge.session.getUidByUin("FriendsServiceImpl", [userId]);
    peerUid = result?.uidInfo?.get(userId) || userId;
  } catch {}
  const peer = { chatType: 1, peerUid, guildId: "" };
  const messages = params.messages || [];

  for (const node of messages) {
    if (node.type !== "node" || !node.data?.content) continue;
    try {
      const elements = oneBotToNt(node.data.content);
      if (elements.length) {
        await bridge.session.getMsgService().sendMsg("0", peer, elements, new Map());
      }
    } catch {}
  }
  return { message_id: 0 };
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
handlers.send_like = async () => null;
handlers.set_group_special_title = async () => null;
handlers.send_group_sign = async () => null;
handlers.download_file = async () => ({ file: "" });
handlers.get_group_honor_info = async () => ({});
handlers.get_essence_msg_list = async () => ({ msg_list: [] });
handlers.set_essence_msg = async () => null;
handlers.delete_essence_msg = async () => null;
handlers.get_group_file_system_info = async () => ({});
handlers.get_group_root_files = async () => ({ files: [], folders: [] });
handlers.get_group_files_by_folder = async () => ({ files: [], folders: [] });
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
handlers.delete_group_file = async () => null;
handlers.create_group_file_folder = async () => null;
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
