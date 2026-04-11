"use strict";

const fs = require("fs");
const path = require("path");
const { milkyToNt } = require("./message");

const handlers = {};

// ---- System / Info ----

handlers.get_login_info = async (params, bridge) => {
  return {
    user_id: String(bridge.selfInfo.uin || "0"),
    nickname: bridge.selfInfo.nickName || "",
  };
};

handlers.get_impl_info = async () => {
  return {
    name: "waylay",
    version: "0.2.0",
    onebot_version: "",
    milky_version: "1",
  };
};

handlers.get_user_profile = async (params, bridge) => {
  const userId = String(params.user_id || "");
  if (!bridge.session) return { user_id: userId, nickname: "" };
  try {
    const profileService = bridge.session.getProfileService();
    const uids = await profileService.getUidByUin("FriendsServiceImpl", [userId]);
    const uid = uids?.uidInfo?.get(userId) || "";
    if (uid) {
      const profiles = await profileService.getUserSimpleInfo(false, [uid]);
      const p = profiles?.profileMap?.get(uid) || profiles?.get?.(uid);
      if (p) {
        return { user_id: userId, nickname: p.nick || p.nickName || "" };
      }
    }
  } catch {}
  return { user_id: userId, nickname: "" };
};

// ---- Friend ----

handlers.get_friend_list = async (params, bridge, eventTranslator) => {
  const cached = eventTranslator.getBuddyList();
  if (cached.size > 0) {
    const friends = [];
    for (const [uin, info] of cached) {
      friends.push({
        user_id: String(uin),
        nickname: info.nick || "",
        remark: info.remark || "",
      });
    }
    return friends;
  }
  try { bridge.session?.getBuddyService().getBuddyList(true); } catch {}
  return [];
};

handlers.get_friend_info = async (params, bridge, eventTranslator) => {
  const userId = String(params.user_id || "");
  const buddy = eventTranslator.getBuddyList().get(userId);
  if (buddy) {
    return { user_id: userId, nickname: buddy.nick || "", remark: buddy.remark || "" };
  }
  return { user_id: userId, nickname: "", remark: "" };
};

// ---- Group ----

handlers.get_group_list = async (params, bridge, eventTranslator) => {
  const groups = eventTranslator.getGroupList();
  if (groups.length > 0) {
    return groups.map(g => ({
      group_id: String(g.groupCode),
      group_name: g.groupName || "",
      member_count: g.memberCount || 0,
      max_member_count: g.maxMember || 0,
    }));
  }
  try { bridge.session?.getGroupService().getGroupList(true); } catch {}
  return [];
};

handlers.get_group_info = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  const groups = eventTranslator.getGroupList();
  const g = groups.find(g => g.groupCode === groupId);
  if (g) {
    return {
      group_id: String(g.groupCode),
      group_name: g.groupName || "",
      member_count: g.memberCount || 0,
      max_member_count: g.maxMember || 0,
    };
  }
  return { group_id: groupId, group_name: "", member_count: 0, max_member_count: 0 };
};

async function fetchGroupMembersAndWait(bridge, groupId, eventTranslator) {
  const groupService = bridge.session.getGroupService();
  try {
    const sceneId = groupService.createMemberListScene(groupId, `milky_fetch_${Date.now()}`);
    await groupService.getNextMemberList(sceneId, undefined, 3000);
    try { groupService.destroyMemberListScene(sceneId); } catch {}
  } catch {}
  await new Promise(r => setTimeout(r, 500));
}

handlers.get_group_member_list = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  if (!bridge.session) return [];

  let cached = eventTranslator._groupMembers.get(groupId);
  if (!cached || cached.size === 0) {
    await fetchGroupMembersAndWait(bridge, groupId, eventTranslator);
    cached = eventTranslator._groupMembers.get(groupId);
  }
  if (!cached || cached.size === 0) return [];

  const members = [];
  for (const [uin, info] of cached) {
    members.push({
      user_id: String(uin),
      nickname: info.nick || "",
      card: info.card || "",
    });
  }
  return members;
};

handlers.get_group_member_info = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  const userId = String(params.user_id || "");
  if (!bridge.session) return { user_id: userId, nickname: "", card: "" };

  let member = eventTranslator.getGroupMember(groupId, userId);
  if (!member) {
    const groupCache = eventTranslator._groupMembers.get(groupId);
    if (!groupCache || groupCache.size === 0) {
      await fetchGroupMembersAndWait(bridge, groupId, eventTranslator);
      member = eventTranslator.getGroupMember(groupId, userId);
    }
  }
  if (member) {
    return { user_id: userId, nickname: member.nick || "", card: member.card || "" };
  }
  return { user_id: userId, nickname: "", card: "" };
};

// ---- Messages ----

handlers.send_private_message = async (params, bridge, eventTranslator) => {
  const userId = String(params.user_id || "");
  let peerUid = eventTranslator.getUidByUin(userId);
  if (!peerUid) {
    try {
      const r = await bridge.session.getProfileService().getUidByUin("FriendsServiceImpl", [userId]);
      peerUid = r?.uidInfo?.get(userId) || null;
    } catch {}
  }
  if (!peerUid) {
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
  if (!peerUid) peerUid = userId;
  const peer = { chatType: 1, peerUid, guildId: "" };
  return await sendMessage(peer, params.message || [], bridge, eventTranslator);
};

handlers.send_group_message = async (params, bridge, eventTranslator) => {
  const groupId = String(params.group_id || "");
  const peer = { chatType: 2, peerUid: groupId, guildId: "" };
  return await sendMessage(peer, params.message || [], bridge, eventTranslator);
};

async function sendMessage(peer, segments, bridge, eventTranslator) {
  if (!bridge.session) throw new Error("Session not ready");
  if (!Array.isArray(segments)) segments = [];

  // Build UID resolver for mentions
  const mentionMap = new Map();
  for (const seg of segments) {
    if (seg.type !== "mention") continue;
    const userId = String(seg.data?.user_id || "");
    if (!userId || mentionMap.has(userId)) continue;

    if (peer.chatType === 2) {
      const member = eventTranslator.getGroupMember(peer.peerUid, userId);
      if (member?.uid) {
        mentionMap.set(userId, { uid: member.uid, name: member.card || member.nick || null });
        continue;
      }
    }
    let uid = eventTranslator.getUidByUin(userId);
    if (!uid) {
      try {
        const r = await bridge.session.getProfileService().getUidByUin("FriendsServiceImpl", [userId]);
        uid = r?.uidInfo?.get(userId) || null;
        if (uid) eventTranslator.recordUinUid(userId, uid);
      } catch {}
    }
    mentionMap.set(userId, { uid: uid || "", name: null });
  }

  const uidResolver = mentionMap.size > 0
    ? (uin) => mentionMap.get(uin) || { uid: "", name: null }
    : null;

  const elements = milkyToNt(segments, uidResolver);
  if (!elements.length) throw new Error("Empty message");

  // Resolve reply elements: convert message_seq -> real NTQQ msgId
  for (const el of elements) {
    if (el.elementType === 7 && el.replyElement) {
      const seq = Number(el.replyElement.replayMsgId);
      const realMsgId = eventTranslator.resolveSeq(seq);
      if (realMsgId) {
        el.replyElement.replayMsgId = realMsgId;
      }
      const cached = eventTranslator.getCachedMsg(seq);
      if (cached) {
        el.replyElement.replayMsgSeq = cached._ntMsgSeq || "0";
        el.replyElement.senderUin = String(cached.sender?.user_id || "0");
        el.replyElement.senderUinStr = String(cached.sender?.user_id || "0");
      }
    }
  }

  // Register media files with NTQQ
  const msgService = bridge.session.getMsgService();
  for (const el of elements) {
    try {
      if (el.elementType === 2 && el.picElement?.sourcePath) {
        const mediaPath = registerMedia(msgService, el.picElement.md5HexStr, el.picElement.fileName, 2);
        if (mediaPath) {
          fs.copyFileSync(el.picElement.sourcePath, mediaPath);
          el.picElement.sourcePath = mediaPath;
        }
      } else if (el.elementType === 5 && el.videoElement?.filePath) {
        const mediaPath = registerMedia(msgService, el.videoElement.videoMd5, el.videoElement.fileName, 5);
        if (mediaPath) {
          fs.copyFileSync(el.videoElement.filePath, mediaPath);
          el.videoElement.filePath = mediaPath;
        }
      } else if (el.elementType === 4 && el.pttElement?.filePath) {
        const mediaPath = registerMedia(msgService, el.pttElement.md5HexStr, el.pttElement.fileName, 4);
        if (mediaPath) {
          fs.copyFileSync(el.pttElement.filePath, mediaPath);
          el.pttElement.filePath = mediaPath;
        }
      }
    } catch (e) {
      console.warn(`[milky-actions] Media registration error (type ${el.elementType}):`, e.message);
    }
  }

  const result = await msgService.sendMsg("0", peer, elements, new Map());
  const msgId = result?.msgId || result?.result?.msgId || "0";
  const seq = eventTranslator.createSeq(msgId);
  return { message_seq: seq };
}

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

handlers.recall_private_message = async (params, bridge, eventTranslator) => {
  const seq = Number(params.message_seq);
  const msgId = eventTranslator.resolveSeq(seq);
  if (!msgId || !bridge.session) return null;
  const userId = String(params.user_id || "");
  let peerUid = eventTranslator.getUidByUin(userId) || userId;
  try {
    await bridge.session.getMsgService().recallMsg({ chatType: 1, peerUid, guildId: "" }, [msgId]);
  } catch (e) {
    console.error("[milky-actions] recall_private_message error:", e.message);
  }
  return null;
};

handlers.recall_group_message = async (params, bridge, eventTranslator) => {
  const seq = Number(params.message_seq);
  const msgId = eventTranslator.resolveSeq(seq);
  if (!msgId || !bridge.session) return null;
  const groupId = String(params.group_id || "");
  try {
    await bridge.session.getMsgService().recallMsg({ chatType: 2, peerUid: groupId, guildId: "" }, [msgId]);
  } catch (e) {
    console.error("[milky-actions] recall_group_message error:", e.message);
  }
  return null;
};

handlers.get_message = async (params, bridge, eventTranslator) => {
  const seq = Number(params.message_seq);
  const cached = eventTranslator.getCachedMsg(seq);
  if (cached) {
    return {
      message_seq: seq,
      message_scene: cached.message_scene,
      peer_id: cached.peer_id,
      sender: cached.sender,
      message: cached.message,
      time: cached.time,
    };
  }
  return null;
};

// ---- Group admin operations ----

handlers.set_group_name = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().modifyGroupName(String(params.group_id), params.group_name || "");
  } catch {}
  return null;
};

handlers.set_group_member_card = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().modifyMemberCardName(
      String(params.group_id), String(params.user_id), params.card || "");
  } catch {}
  return null;
};

handlers.set_group_member_admin = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().setMemberRole(
      String(params.group_id), String(params.user_id), params.is_admin ? 3 : 2);
  } catch {}
  return null;
};

handlers.set_group_member_mute = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().setMemberShutUp(
      String(params.group_id), [{ uid: String(params.user_id), timeStamp: params.duration || 0 }]);
  } catch {}
  return null;
};

handlers.set_group_whole_mute = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().setGroupShutUp(String(params.group_id), params.is_mute !== false);
  } catch {}
  return null;
};

handlers.kick_group_member = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().kickMember(
      String(params.group_id), [String(params.user_id)], params.reject_add || false);
  } catch {}
  return null;
};

handlers.quit_group = async (params, bridge) => {
  if (!bridge.session) return null;
  try {
    bridge.session.getGroupService().quitGroup(String(params.group_id));
  } catch {}
  return null;
};

// ---- Nudge ----

handlers.send_group_nudge = async (params, bridge, eventTranslator) => {
  if (!bridge.session) return null;
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
      await groupService.sendPoke(String(params.group_id), uid);
    }
  } catch (e) {
    console.error("[milky-actions] send_group_nudge error:", e.message);
  }
  return null;
};

handlers.send_friend_nudge = async (params, bridge, eventTranslator) => {
  if (!bridge.session) return null;
  const userId = String(params.user_id || "");
  let uid = eventTranslator.getUidByUin(userId) || userId;
  try {
    const msgService = bridge.session.getMsgService();
    if (typeof msgService.sendPoke === "function") {
      await msgService.sendPoke(uid);
    }
  } catch (e) {
    console.error("[milky-actions] send_friend_nudge error:", e.message);
  }
  return null;
};

// ---- Requests ----

handlers.accept_friend_request = async (params, bridge) => {
  if (!bridge.session) return null;
  const requestId = String(params.request_id || "");
  try {
    const buddyService = bridge.session.getBuddyService();
    if (typeof buddyService.approveOrRejectFriendRequest === "function") {
      await buddyService.approveOrRejectFriendRequest(requestId, true);
    } else if (typeof buddyService.handleFriendRequest === "function") {
      await buddyService.handleFriendRequest(requestId, true);
    }
  } catch (e) {
    console.error("[milky-actions] accept_friend_request error:", e.message);
  }
  return null;
};

handlers.reject_friend_request = async (params, bridge) => {
  if (!bridge.session) return null;
  const requestId = String(params.request_id || "");
  try {
    const buddyService = bridge.session.getBuddyService();
    if (typeof buddyService.approveOrRejectFriendRequest === "function") {
      await buddyService.approveOrRejectFriendRequest(requestId, false);
    } else if (typeof buddyService.handleFriendRequest === "function") {
      await buddyService.handleFriendRequest(requestId, false);
    }
  } catch (e) {
    console.error("[milky-actions] reject_friend_request error:", e.message);
  }
  return null;
};

handlers.accept_group_join_request = async (params, bridge) => {
  if (!bridge.session) return null;
  const requestId = String(params.request_id || "");
  const [seq, groupCode, type] = requestId.split("|");
  if (!seq || !groupCode) return null;
  try {
    const groupService = bridge.session.getGroupService();
    if (typeof groupService.operateGroupReqNotify === "function") {
      await groupService.operateGroupReqNotify(1, { groupCode, seq, type: Number(type) || 1 }, "");
    } else if (typeof groupService.operateGroupNotify === "function") {
      await groupService.operateGroupNotify(1, { groupCode, seq, type: Number(type) || 1 }, "");
    }
  } catch (e) {
    console.error("[milky-actions] accept_group_join_request error:", e.message);
  }
  return null;
};

handlers.reject_group_join_request = async (params, bridge) => {
  if (!bridge.session) return null;
  const requestId = String(params.request_id || "");
  const reason = params.reason || "";
  const [seq, groupCode, type] = requestId.split("|");
  if (!seq || !groupCode) return null;
  try {
    const groupService = bridge.session.getGroupService();
    if (typeof groupService.operateGroupReqNotify === "function") {
      await groupService.operateGroupReqNotify(2, { groupCode, seq, type: Number(type) || 1 }, reason);
    } else if (typeof groupService.operateGroupNotify === "function") {
      await groupService.operateGroupNotify(2, { groupCode, seq, type: Number(type) || 1 }, reason);
    }
  } catch (e) {
    console.error("[milky-actions] reject_group_join_request error:", e.message);
  }
  return null;
};

// ---- Stubs ----

handlers.get_history_messages = async () => ({ messages: [] });
handlers.get_resource_temp_url = async () => ({ url: "" });
handlers.get_forwarded_messages = async () => ({ messages: [] });
handlers.mark_message_as_read = async () => null;
handlers.send_profile_like = async () => null;
handlers.delete_friend = async () => null;
handlers.get_friend_requests = async () => ({ requests: [] });
handlers.set_avatar = async () => null;
handlers.set_nickname = async () => null;
handlers.set_bio = async () => null;
handlers.get_cookies = async () => ({ cookies: "" });
handlers.get_csrf_token = async () => ({ token: 0 });
handlers.set_group_avatar = async () => null;

module.exports = { handlers };
