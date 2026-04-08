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
  }

  /** Record a UIN<->UID mapping from observed data */
  recordUinUid(uin, uid) {
    if (uin && uid && uid.startsWith("u_")) {
      this._uinToUid.set(String(uin), uid);
      this._uidToUin.set(uid, String(uin));
    }
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
      // Skip non-normal messages
      if (msg.msgType !== 1 && msg.msgType !== 2 && msg.msgType !== 3) continue;

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

      // JSON gray tips (poke, essence, etc.)
      if (tip.subElementType === 17 && tip.jsonGrayTipElement) {
        const json = tip.jsonGrayTipElement;
        // busId "1061" = poke
        if (json.busiId === "1061" || json.busiId === 1061) {
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
      }
    }
    return events;
  }

  // ---- Group events ----

  _translateGroupEvent(eventName, data) {
    if (eventName === "onMemberListChange") {
      // Member list refreshed - not a discrete event we need to push
      return [];
    }
    if (eventName === "onGroupListUpdate") {
      return [];
    }
    return [];
  }

  // ---- Buddy events ----

  _translateBuddyEvent(eventName, data) {
    // Cache UIN<->UID from buddy list updates
    if (eventName === "onBuddyListChange" || eventName === "onBuddyListChangedV2") {
      const categories = Array.isArray(data) ? data : [data];
      for (const cat of categories) {
        for (const buddy of cat?.buddyList || []) {
          if (buddy.uin && buddy.uid) {
            this.recordUinUid(buddy.uin, buddy.uid);
          }
        }
      }
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
