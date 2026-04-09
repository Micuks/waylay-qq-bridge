"use strict";

const { ntToOneBot, segmentsToRawMessage } = require("./message");

/**
 * Translates NTQQ kernel listener events into OneBot v11 events.
 *
 * Returns an array of OB11 event objects (can be 0 or more per kernel event).
 */
class EventTranslator {
  constructor(bridge) {
    this.bridge = bridge;
    // msgId -> short id (int32) for OneBot compatibility
    this._msgIdCounter = 0;
    this._msgIdMap = new Map(); // msgId -> shortId
    this._shortIdMap = new Map(); // shortId -> msgId
    this._msgCache = new Map(); // shortId -> msg data
    // UIN <-> UID mapping built from observed messages
    this._uinToUid = new Map(); // uin(string) -> uid(string)
    this._uidToUin = new Map(); // uid(string) -> uin(string)
    // Group member cache: groupId -> Map<uin, { uid, nick, card }>
    this._groupMembers = new Map();
    // Group list cache from onGroupListUpdate
    this._groupList = new Map(); // groupCode -> group info
    // Buddy list cache: uin -> { uid, nick, remark }
    this._buddyList = new Map();
    // Track buddy list for friend_add detection
    this._knownBuddyUins = new Set();
    this._buddyListInitialized = false;
  }

  /** Record a UIN<->UID mapping from observed data */
  recordUinUid(uin, uid) {
    if (uin && uid && uid.startsWith("u_")) {
      this._uinToUid.set(String(uin), uid);
      this._uidToUin.set(uid, String(uin));
    }
  }

  /** Record group member info from observed data */
  recordGroupMember(groupId, uin, uid, nick, card) {
    if (!groupId || !uin) return;
    const gid = String(groupId);
    if (!this._groupMembers.has(gid)) this._groupMembers.set(gid, new Map());
    const existing = this._groupMembers.get(gid).get(String(uin)) || {};
    this._groupMembers.get(gid).set(String(uin), {
      uid: uid || existing.uid || "",
      nick: nick || existing.nick || "",
      card: card || existing.card || "",
    });
  }

  /** Look up group member info by UIN */
  getGroupMember(groupId, uin) {
    return this._groupMembers.get(String(groupId))?.get(String(uin));
  }

  /** Look up UID from UIN (from cache) */
  getUidByUin(uin) {
    return this._uinToUid.get(String(uin));
  }

  /** Look up UIN from UID (from cache) */
  getUinByUid(uid) {
    return this._uidToUin.get(uid);
  }

  get selfId() {
    return Number(this.bridge.selfInfo.uin) || 0;
  }

  /** Create a short int32 message ID from NTQQ's string msgId */
  createShortId(msgId) {
    if (this._msgIdMap.has(msgId)) return this._msgIdMap.get(msgId);
    this._msgIdCounter = (this._msgIdCounter + 1) & 0x7fffffff;
    const shortId = this._msgIdCounter;
    this._msgIdMap.set(msgId, shortId);
    this._shortIdMap.set(shortId, msgId);
    return shortId;
  }

  /** Resolve a short ID back to NTQQ msgId */
  resolveShortId(shortId) {
    return this._shortIdMap.get(Number(shortId));
  }

  /** Cache a message for later retrieval by get_msg */
  cacheMsg(shortId, data) {
    this._msgCache.set(shortId, data);
    // Limit cache size
    if (this._msgCache.size > 5000) {
      const oldest = this._msgCache.keys().next().value;
      this._msgCache.delete(oldest);
    }
  }

  getCachedMsg(shortId) {
    return this._msgCache.get(Number(shortId));
  }

  /**
   * Translate a kernel event into OneBot v11 events.
   * @returns {Array<Object>} Array of OB11 event objects
   */
  translate(listenerName, eventName, data) {
    try {
      // Message events
      if (listenerName === "nodeIKernelMsgListener") {
        return this._translateMsgEvent(eventName, data);
      }
      // Group events
      if (listenerName === "nodeIKernelGroupListener") {
        return this._translateGroupEvent(eventName, data);
      }
      // Buddy events
      if (listenerName === "nodeIKernelBuddyListener") {
        return this._translateBuddyEvent(eventName, data);
      }
      return [];
    } catch (e) {
      console.error(`[onebot-events] Error translating ${listenerName}.${eventName}:`, e.message);
      return [];
    }
  }

  // ---- Message events ----

  _translateMsgEvent(eventName, data) {
    if (eventName === "onRecvMsg") {
      return this._onRecvMsg(data);
    }
    if (eventName === "onRecvActiveMsg") {
      return this._onRecvMsg(data);
    }
    if (eventName === "onMsgInfoListUpdate") {
      return this._onMsgInfoListUpdate(data);
    }
    if (eventName === "onRecvSysMsg") {
      // System messages - could be friend requests, etc.
      return [];
    }
    return [];
  }

  _onRecvMsg(data) {
    const events = [];
    const msgList = Array.isArray(data) ? data : data?.msgList || [data];

    for (const msg of msgList) {
      if (!msg || !msg.msgId) continue;

      // Record UIN<->UID from sender
      if (msg.senderUin && msg.senderUid) {
        this.recordUinUid(msg.senderUin, msg.senderUid);
      }
      // For group messages, cache sender member info (nick/card) for @ resolution
      if (msg.chatType === 2 && msg.senderUin && msg.peerUin) {
        this.recordGroupMember(msg.peerUin, msg.senderUin, msg.senderUid,
          msg.sendNickName, msg.senderMemberName || msg.sendMemberName);
      }
      // For C2C messages, record peer mapping
      if (msg.chatType === 1 && msg.peerUid && msg.peerUin) {
        this.recordUinUid(msg.peerUin, msg.peerUid);
      }

      // Skip system messages (msgType 5 = gray tip/system)
      if (msg.msgType === 5) {
        const tipEvents = this._handleGrayTip(msg);
        events.push(...tipEvents);
        continue;
      }
      const shortId = this.createShortId(msg.msgId);
      const segments = ntToOneBot(msg.elements, msg);
      const rawMessage = segmentsToRawMessage(segments);

      const base = {
        time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
        self_id: this.selfId,
        post_type: "message",
        message_id: shortId,
        message: segments,
        raw_message: rawMessage,
        font: 0,
        user_id: Number(msg.senderUin) || 0,
      };

      // ChatType: 1=C2C(friend), 2=Group, 100=TempC2CFromGroup
      if (msg.chatType === 2) {
        // Group message
        const event = {
          ...base,
          message_type: "group",
          sub_type: "normal",
          group_id: Number(msg.peerUin) || 0,
          anonymous: null,
          sender: {
            user_id: Number(msg.senderUin) || 0,
            nickname: msg.sendNickName || "",
            card: msg.senderMemberName || msg.sendMemberName || "",
            sex: "unknown",
            age: 0,
            area: "",
            level: "0",
            role: msg.senderRole === 3 ? "owner" : msg.senderRole === 2 ? "admin" : "member",
            title: "",
          },
        };
        this.cacheMsg(shortId, event);
        events.push(event);

        // Emit group_upload notice for file elements
        for (const el of msg.elements || []) {
          if (el.fileElement) {
            events.push({
              time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
              self_id: this.selfId,
              post_type: "notice",
              notice_type: "group_upload",
              group_id: Number(msg.peerUin) || 0,
              user_id: Number(msg.senderUin) || 0,
              file: {
                id: el.fileElement.fileUuid || "",
                name: el.fileElement.fileName || "",
                size: Number(el.fileElement.fileSize) || 0,
                busid: 0,
              },
            });
          }
        }
      } else if (msg.chatType === 1 || msg.chatType === 100) {
        // Private message
        const event = {
          ...base,
          message_type: "private",
          sub_type: msg.chatType === 100 ? "group" : "friend",
          sender: {
            user_id: Number(msg.senderUin) || 0,
            nickname: msg.sendNickName || "",
            sex: "unknown",
            age: 0,
          },
        };
        this.cacheMsg(shortId, event);
        events.push(event);
      }
    }
    return events;
  }

  _onMsgInfoListUpdate(data) {
    // Message updates - could be recall, etc.
    const events = [];
    const msgList = Array.isArray(data) ? data : data?.msgList || [data];

    for (const msg of msgList) {
      if (!msg) continue;
      // Check for recall
      if (msg.recallTime && msg.recallTime !== "0") {
        const shortId = this._msgIdMap.get(msg.msgId) || 0;
        if (msg.chatType === 2) {
          events.push({
            time: Math.floor(Date.now() / 1000),
            self_id: this.selfId,
            post_type: "notice",
            notice_type: "group_recall",
            group_id: Number(msg.peerUin) || 0,
            user_id: Number(msg.senderUin) || 0,
            operator_id: Number(msg.senderUin) || 0,
            message_id: shortId,
          });
        } else if (msg.chatType === 1) {
          events.push({
            time: Math.floor(Date.now() / 1000),
            self_id: this.selfId,
            post_type: "notice",
            notice_type: "friend_recall",
            user_id: Number(msg.senderUin) || 0,
            message_id: shortId,
          });
        }
      }
    }
    return events;
  }

  _handleGrayTip(msg) {
    const events = [];
    if (!msg.elements) return events;

    for (const el of msg.elements) {
      if (!el.grayTipElement) continue;
      const tip = el.grayTipElement;

      // Group member increase/decrease/ban from group tip
      if (tip.subElementType === 4 && tip.groupElement) {
        const ge = tip.groupElement;
        // type 1 = member increase
        if (ge.type === 1) {
          events.push({
            time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
            self_id: this.selfId,
            post_type: "notice",
            notice_type: "group_increase",
            sub_type: "approve",
            group_id: Number(msg.peerUin) || 0,
            operator_id: Number(ge.adminUin) || 0,
            user_id: Number(ge.memberUin) || 0,
          });
        }
        // type 3 = kicked
        if (ge.type === 3) {
          events.push({
            time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
            self_id: this.selfId,
            post_type: "notice",
            notice_type: "group_decrease",
            sub_type: "kick",
            group_id: Number(msg.peerUin) || 0,
            operator_id: Number(ge.adminUin) || 0,
            user_id: Number(ge.memberUin) || 0,
          });
        }
        // type 8 = ban
        if (ge.type === 8) {
          events.push({
            time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
            self_id: this.selfId,
            post_type: "notice",
            notice_type: "group_ban",
            sub_type: ge.shutUp?.duration ? "ban" : "lift_ban",
            group_id: Number(msg.peerUin) || 0,
            operator_id: Number(ge.adminUin || ge.shutUp?.admin?.uin) || 0,
            user_id: Number(ge.memberUin || ge.shutUp?.member?.uin) || 0,
            duration: ge.shutUp?.duration || 0,
          });
        }
      }

      // Admin set/unset (groupElement type 5 or 13)
      if (tip.subElementType === 4 && tip.groupElement) {
        const ge2 = tip.groupElement;
        if (ge2.type === 5 || ge2.type === 13) {
          events.push({
            time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
            self_id: this.selfId,
            post_type: "notice",
            notice_type: "group_admin",
            sub_type: ge2.type === 5 ? "set" : "unset",
            group_id: Number(msg.peerUin) || 0,
            user_id: Number(ge2.memberUin) || 0,
          });
        }
      }

      // JSON gray tips (poke, lucky_king, honor, etc.)
      if (tip.subElementType === 17 && tip.jsonGrayTipElement) {
        const json = tip.jsonGrayTipElement;
        const busiId = String(json.busiId);

        // Poke
        if (busiId === "1061") {
          try {
            const items = JSON.parse(json.jsonStr);
            const actionUser = items?.find?.(i => i.uid)?.uid;
            const targetUser = items?.find?.((i, idx) => idx > 0 && i.uid)?.uid;
            if (actionUser) {
              events.push({
                time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
                self_id: this.selfId,
                post_type: "notice",
                notice_type: "notify",
                sub_type: "poke",
                group_id: msg.chatType === 2 ? Number(msg.peerUin) || 0 : undefined,
                user_id: Number(actionUser) || 0,
                target_id: Number(targetUser) || this.selfId,
              });
            }
          } catch {}
        }

        // Lucky king (red packet)
        if (busiId === "1068") {
          try {
            const items = JSON.parse(json.jsonStr);
            const luckyUser = items?.find?.(i => i.uid)?.uid;
            events.push({
              time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
              self_id: this.selfId,
              post_type: "notice",
              notice_type: "notify",
              sub_type: "lucky_king",
              group_id: msg.chatType === 2 ? Number(msg.peerUin) || 0 : undefined,
              user_id: Number(msg.senderUin) || 0,
              target_id: Number(luckyUser) || 0,
            });
          } catch {}
        }

        // Honor change
        if (busiId === "1064") {
          try {
            const items = JSON.parse(json.jsonStr);
            const honorUser = items?.find?.(i => i.uid)?.uid;
            events.push({
              time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
              self_id: this.selfId,
              post_type: "notice",
              notice_type: "notify",
              sub_type: "honor",
              group_id: msg.chatType === 2 ? Number(msg.peerUin) || 0 : undefined,
              user_id: Number(honorUser) || 0,
              honor_type: "talkative",
            });
          } catch {}
        }
      }
    }
    return events;
  }

  // ---- Group events ----

  _translateGroupEvent(eventName, data) {
    if (eventName === "onGroupNotifyChange") {
      return this._onGroupNotifyChange(data);
    }
    // Cache group list from onGroupListUpdate
    if (eventName === "onGroupListUpdate") {
      this._cacheGroupList(data);
    }
    // Cache member info from member list/info change events
    if (eventName === "onMemberInfoChange" || eventName === "onMemberListChange") {
      this._cacheMemberInfo(data);
    }
    return [];
  }

  _cacheGroupList(data) {
    // data: [updateType, groupList]
    const groups = Array.isArray(data) ? data[1] : data?.groupList || [];
    if (!Array.isArray(groups)) return;
    for (const g of groups) {
      if (g?.groupCode) this._groupList.set(g.groupCode, g);
    }
  }

  getGroupList() {
    return Array.from(this._groupList.values());
  }

  getBuddyList() {
    return this._buddyList;
  }

  _cacheMemberInfo(data) {
    const groupCode = data?.groupCode || (Array.isArray(data) ? data[0] : null);
    if (!groupCode) return;
    // onMemberInfoChange: [groupCode, changeType, infos(Map)]
    // onMemberListChange: { sceneId, groupCode, ids, infos(Map), finish, hasRobot }
    const infos = data?.infos || (Array.isArray(data) ? data[2] : null);
    if (!infos) return;
    let count = 0;
    try {
      // Native Maps from wrapper.node may not pass instanceof Map check,
      // but they do support .entries() and for..of
      const iter = typeof infos.entries === "function" ? infos.entries()
        : Object.entries(infos);
      for (const [uid, m] of iter) {
        if (m?.uin) {
          this.recordUinUid(m.uin, uid);
          this.recordGroupMember(groupCode, m.uin, uid, m.nick, m.cardName);
          count++;
        }
      }
    } catch {}
    if (count > 0) {
      console.log(`[onebot-events] Cached ${count} members for group ${groupCode}`);
    }
  }

  _onGroupNotifyChange(data) {
    const events = [];
    const notifies = Array.isArray(data) ? data : data?.notifies || [data];

    for (const notify of notifies) {
      if (!notify || notify.status !== 0) continue; // Only pending
      const groupId = Number(notify.group?.groupCode || notify.groupCode) || 0;
      const requesterUin = Number(notify.user1?.uin || notify.requestorUin) || 0;
      const inviterUin = Number(notify.user2?.uin || notify.invitorUin) || 0;
      const comment = notify.postscript || "";
      const seq = notify.seq || "";

      if (notify.type === 1) {
        // Join request
        events.push({
          time: Math.floor(Date.now() / 1000),
          self_id: this.selfId,
          post_type: "request",
          request_type: "group",
          sub_type: "add",
          group_id: groupId,
          user_id: requesterUin,
          comment,
          flag: `${seq}|${groupId}|${notify.type}`,
        });
      } else if (notify.type === 2 || notify.type === 13) {
        // Invite
        events.push({
          time: Math.floor(Date.now() / 1000),
          self_id: this.selfId,
          post_type: "request",
          request_type: "group",
          sub_type: "invite",
          group_id: groupId,
          user_id: inviterUin,
          comment,
          flag: `${seq}|${groupId}|${notify.type}`,
        });
      }
    }
    return events;
  }

  // ---- Buddy events ----

  _translateBuddyEvent(eventName, data) {
    // Cache UIN<->UID from buddy list updates + detect friend_add
    if (eventName === "onBuddyListChange" || eventName === "onBuddyListChangedV2") {
      const events = [];
      const categories = Array.isArray(data) ? data : [data];
      const currentUins = new Set();

      for (const cat of categories) {
        for (const buddy of cat?.buddyList || []) {
          if (buddy.uin && buddy.uid) {
            this.recordUinUid(buddy.uin, buddy.uid);
          }
          if (buddy.uin) {
            currentUins.add(String(buddy.uin));
            this._buddyList.set(String(buddy.uin), {
              uid: buddy.uid || "",
              nick: buddy.nick || "",
              remark: buddy.remark || "",
            });
          }
        }
      }

      if (this._buddyListInitialized) {
        for (const uin of currentUins) {
          if (!this._knownBuddyUins.has(uin)) {
            events.push({
              time: Math.floor(Date.now() / 1000),
              self_id: this.selfId,
              post_type: "notice",
              notice_type: "friend_add",
              user_id: Number(uin) || 0,
            });
          }
        }
      }

      this._knownBuddyUins = currentUins;
      this._buddyListInitialized = true;
      return events;
    }

    if (eventName === "onBuddyReqChange") {
      // Friend request
      const events = [];
      const reqs = data?.buddyReqs || data?.unreadNums ? [] : (Array.isArray(data) ? data : [data]);
      for (const req of reqs) {
        if (!req?.friendUin) continue;
        events.push({
          time: Math.floor(Date.now() / 1000),
          self_id: this.selfId,
          post_type: "request",
          request_type: "friend",
          user_id: Number(req.friendUin) || 0,
          comment: req.extMsg || "",
          flag: req.friendUin || "",
        });
      }
      return events;
    }
    return [];
  }
}

module.exports = { EventTranslator };
