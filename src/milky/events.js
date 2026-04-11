"use strict";

const { ntToMilky } = require("./message");

/**
 * Translates NTQQ kernel listener events into Milky protocol events.
 *
 * Milky event envelope: { event_type, time, self_id, data }
 */
class MilkyEventTranslator {
  constructor(bridge) {
    this.bridge = bridge;
    // message_seq counter (int64 range, exposed as number)
    this._seqCounter = 0;
    this._msgIdToSeq = new Map(); // NTQQ msgId -> seq
    this._seqToMsgId = new Map(); // seq -> NTQQ msgId
    this._msgCache = new Map(); // seq -> msg data
    // UIN <-> UID mapping
    this._uinToUid = new Map();
    this._uidToUin = new Map();
    // Group member cache
    this._groupMembers = new Map(); // groupCode -> Map<uin, { uid, nick, card }>
    // Group list cache
    this._groupList = new Map(); // groupCode -> group info
    // Buddy list cache
    this._buddyList = new Map(); // uin -> { uid, nick, remark }
    this._knownBuddyUins = new Set();
    this._buddyListInitialized = false;
  }

  get selfId() {
    return String(this.bridge.selfInfo.uin || "0");
  }

  createSeq(msgId) {
    if (this._msgIdToSeq.has(msgId)) return this._msgIdToSeq.get(msgId);
    this._seqCounter++;
    const seq = this._seqCounter;
    this._msgIdToSeq.set(msgId, seq);
    this._seqToMsgId.set(seq, msgId);
    return seq;
  }

  resolveSeq(seq) {
    return this._seqToMsgId.get(Number(seq));
  }

  cacheMsg(seq, data) {
    this._msgCache.set(seq, data);
    if (this._msgCache.size > 5000) {
      const oldest = this._msgCache.keys().next().value;
      this._msgCache.delete(oldest);
    }
  }

  getCachedMsg(seq) {
    return this._msgCache.get(Number(seq));
  }

  recordUinUid(uin, uid) {
    if (uin && uid && uid.startsWith("u_")) {
      this._uinToUid.set(String(uin), uid);
      this._uidToUin.set(uid, String(uin));
    }
  }

  getUidByUin(uin) {
    return this._uinToUid.get(String(uin));
  }

  getUinByUid(uid) {
    return this._uidToUin.get(uid);
  }

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

  getGroupMember(groupId, uin) {
    return this._groupMembers.get(String(groupId))?.get(String(uin));
  }

  getGroupList() {
    return Array.from(this._groupList.values());
  }

  getBuddyList() {
    return this._buddyList;
  }

  _makeEvent(eventType, data) {
    return {
      event_type: eventType,
      time: Math.floor(Date.now() / 1000),
      self_id: this.selfId,
      data,
    };
  }

  translate(listenerName, eventName, data) {
    try {
      if (listenerName === "nodeIKernelMsgListener") {
        return this._translateMsgEvent(eventName, data);
      }
      if (listenerName === "nodeIKernelGroupListener") {
        return this._translateGroupEvent(eventName, data);
      }
      if (listenerName === "nodeIKernelBuddyListener") {
        return this._translateBuddyEvent(eventName, data);
      }
      return [];
    } catch (e) {
      console.error(`[milky-events] Error translating ${listenerName}.${eventName}:`, e.message);
      return [];
    }
  }

  // ---- Message events ----

  _translateMsgEvent(eventName, data) {
    if (eventName === "onRecvMsg" || eventName === "onRecvActiveMsg") {
      return this._onRecvMsg(data);
    }
    if (eventName === "onMsgInfoListUpdate") {
      return this._onMsgInfoListUpdate(data);
    }
    return [];
  }

  _onRecvMsg(data) {
    const events = [];
    const msgList = Array.isArray(data) ? data : data?.msgList || [data];

    for (const msg of msgList) {
      if (!msg || !msg.msgId) continue;

      if (msg.senderUin && msg.senderUid) {
        this.recordUinUid(msg.senderUin, msg.senderUid);
      }
      if (msg.chatType === 2 && msg.senderUin && msg.peerUin) {
        this.recordGroupMember(msg.peerUin, msg.senderUin, msg.senderUid,
          msg.sendNickName, msg.senderMemberName || msg.sendMemberName);
      }
      if (msg.chatType === 1 && msg.peerUid && msg.peerUin) {
        this.recordUinUid(msg.peerUin, msg.peerUid);
      }

      // Skip gray tip messages — handle them separately
      if (msg.msgType === 5) {
        events.push(...this._handleGrayTip(msg));
        continue;
      }

      const seq = this.createSeq(msg.msgId);
      const segments = ntToMilky(msg.elements, msg);

      // Resolve reply segment message_seq
      for (const seg of segments) {
        if (seg.type === "reply") {
          const replyMsgId = msg.elements?.find(e => e.replyElement)?.replyElement;
          if (replyMsgId) {
            const refId = replyMsgId.sourceMsgIdInRecords || replyMsgId.replayMsgId;
            if (refId && this._msgIdToSeq.has(refId)) {
              seg.data.message_seq = this._msgIdToSeq.get(refId);
            }
          }
        }
      }

      let messageScene, peerId;
      if (msg.chatType === 2) {
        messageScene = "group";
        peerId = String(msg.peerUin);
      } else if (msg.chatType === 1) {
        messageScene = "friend";
        peerId = String(msg.senderUin);
      } else if (msg.chatType === 100) {
        messageScene = "temp";
        peerId = String(msg.senderUin);
      } else {
        continue;
      }

      const eventData = {
        message_seq: seq,
        message_scene: messageScene,
        peer_id: peerId,
        sender: {
          user_id: String(msg.senderUin || "0"),
          nickname: msg.sendNickName || "",
          card: msg.senderMemberName || msg.sendMemberName || "",
        },
        message: segments,
        time: parseInt(msg.msgTime) || Math.floor(Date.now() / 1000),
      };

      // Cache for later reference
      eventData._ntMsgSeq = msg.msgSeq || "0";
      this.cacheMsg(seq, eventData);
      events.push(this._makeEvent("message_receive", eventData));

      // Emit group_file_upload for file elements in group
      if (msg.chatType === 2) {
        for (const el of msg.elements || []) {
          if (el.fileElement) {
            events.push(this._makeEvent("group_file_upload", {
              group_id: String(msg.peerUin),
              user_id: String(msg.senderUin),
              file_id: el.fileElement.fileUuid || "",
              file_name: el.fileElement.fileName || "",
              file_size: Number(el.fileElement.fileSize) || 0,
            }));
          }
        }
      }

      // Emit friend_file_upload for file elements in C2C
      if (msg.chatType === 1) {
        for (const el of msg.elements || []) {
          if (el.fileElement) {
            events.push(this._makeEvent("friend_file_upload", {
              user_id: String(msg.senderUin),
              file_id: el.fileElement.fileUuid || "",
              file_name: el.fileElement.fileName || "",
              file_size: Number(el.fileElement.fileSize) || 0,
            }));
          }
        }
      }
    }
    return events;
  }

  _onMsgInfoListUpdate(data) {
    const events = [];
    const msgList = Array.isArray(data) ? data : data?.msgList || [data];

    for (const msg of msgList) {
      if (!msg || !msg.recallTime || msg.recallTime === "0") continue;

      const seq = this._msgIdToSeq.get(msg.msgId) || 0;
      if (msg.chatType === 2) {
        events.push(this._makeEvent("message_recall", {
          message_seq: seq,
          message_scene: "group",
          peer_id: String(msg.peerUin),
          operator_id: String(msg.senderUin || "0"),
          time: Math.floor(Date.now() / 1000),
        }));
      } else if (msg.chatType === 1) {
        events.push(this._makeEvent("message_recall", {
          message_seq: seq,
          message_scene: "friend",
          peer_id: String(msg.senderUin || msg.peerUin),
          operator_id: String(msg.senderUin || "0"),
          time: Math.floor(Date.now() / 1000),
        }));
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
      const time = parseInt(msg.msgTime) || Math.floor(Date.now() / 1000);

      if (tip.subElementType === 4 && tip.groupElement) {
        const ge = tip.groupElement;
        const groupId = String(msg.peerUin);

        if (ge.type === 1) {
          events.push(this._makeEvent("group_member_increase", {
            group_id: groupId,
            user_id: String(ge.memberUin || "0"),
            operator_id: String(ge.adminUin || "0"),
            time,
          }));
        }

        if (ge.type === 3) {
          events.push(this._makeEvent("group_member_decrease", {
            group_id: groupId,
            user_id: String(ge.memberUin || "0"),
            operator_id: String(ge.adminUin || "0"),
            time,
          }));
        }

        if (ge.type === 8) {
          const duration = ge.shutUp?.duration || 0;
          if (duration > 0) {
            events.push(this._makeEvent("group_mute", {
              group_id: groupId,
              user_id: String(ge.memberUin || ge.shutUp?.member?.uin || "0"),
              operator_id: String(ge.adminUin || ge.shutUp?.admin?.uin || "0"),
              duration,
            }));
          } else {
            events.push(this._makeEvent("group_mute", {
              group_id: groupId,
              user_id: String(ge.memberUin || ge.shutUp?.member?.uin || "0"),
              operator_id: String(ge.adminUin || ge.shutUp?.admin?.uin || "0"),
              duration: 0,
            }));
          }
        }

        if (ge.type === 5 || ge.type === 13) {
          events.push(this._makeEvent("group_admin_change", {
            group_id: groupId,
            user_id: String(ge.memberUin || "0"),
            is_admin: ge.type === 5,
          }));
        }
      }

      // JSON gray tips (poke/nudge)
      if (tip.subElementType === 17 && tip.jsonGrayTipElement) {
        const json = tip.jsonGrayTipElement;
        const busiId = String(json.busiId);

        if (busiId === "1061") {
          try {
            const items = JSON.parse(json.jsonStr);
            const actionUser = items?.find?.(i => i.uid)?.uid;
            const targetUser = items?.find?.((i, idx) => idx > 0 && i.uid)?.uid;
            if (actionUser) {
              if (msg.chatType === 2) {
                events.push(this._makeEvent("group_nudge", {
                  group_id: String(msg.peerUin),
                  user_id: String(actionUser || "0"),
                  target_id: String(targetUser || this.selfId),
                }));
              } else {
                events.push(this._makeEvent("friend_nudge", {
                  user_id: String(actionUser || "0"),
                  target_id: String(targetUser || this.selfId),
                }));
              }
            }
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
    if (eventName === "onGroupListUpdate") {
      this._cacheGroupList(data);
    }
    if (eventName === "onMemberInfoChange" || eventName === "onMemberListChange") {
      this._cacheMemberInfo(data);
    }
    return [];
  }

  _cacheGroupList(data) {
    const groups = Array.isArray(data) ? data[1] : data?.groupList || [];
    if (!Array.isArray(groups)) return;
    for (const g of groups) {
      if (g?.groupCode) this._groupList.set(g.groupCode, g);
    }
  }

  _cacheMemberInfo(data) {
    const groupCode = data?.groupCode || (Array.isArray(data) ? data[0] : null);
    if (!groupCode) return;
    const infos = data?.infos || (Array.isArray(data) ? data[2] : null);
    if (!infos) return;
    try {
      const iter = typeof infos.entries === "function" ? infos.entries() : Object.entries(infos);
      for (const [uid, m] of iter) {
        if (m?.uin) {
          this.recordUinUid(m.uin, uid);
          this.recordGroupMember(groupCode, m.uin, uid, m.nick, m.cardName);
        }
      }
    } catch {}
  }

  _onGroupNotifyChange(data) {
    const events = [];
    const notifies = Array.isArray(data) ? data : data?.notifies || [data];

    for (const notify of notifies) {
      if (!notify || notify.status !== 0) continue;
      const groupId = String(notify.group?.groupCode || notify.groupCode || "0");
      const requesterUin = String(notify.user1?.uin || notify.requestorUin || "0");
      const inviterUin = String(notify.user2?.uin || notify.invitorUin || "0");
      const comment = notify.postscript || "";
      const seq = notify.seq || "";
      const requestId = `${seq}|${groupId}|${notify.type}`;

      if (notify.type === 1) {
        events.push(this._makeEvent("group_join_request", {
          group_id: groupId,
          user_id: requesterUin,
          comment,
          request_id: requestId,
        }));
      } else if (notify.type === 2 || notify.type === 13) {
        events.push(this._makeEvent("group_invited_join_request", {
          group_id: groupId,
          user_id: requesterUin,
          invitor_id: inviterUin,
          comment,
          request_id: requestId,
        }));
      }
    }
    return events;
  }

  // ---- Buddy events ----

  _translateBuddyEvent(eventName, data) {
    if (eventName === "onBuddyListChange" || eventName === "onBuddyListChangedV2") {
      const categories = Array.isArray(data) ? data : [data];
      for (const cat of categories) {
        for (const buddy of cat?.buddyList || []) {
          if (buddy.uin && buddy.uid) {
            this.recordUinUid(buddy.uin, buddy.uid);
          }
          if (buddy.uin) {
            this._buddyList.set(String(buddy.uin), {
              uid: buddy.uid || "",
              nick: buddy.nick || "",
              remark: buddy.remark || "",
            });
          }
        }
      }
      return [];
    }

    if (eventName === "onBuddyReqChange") {
      const events = [];
      const reqs = data?.buddyReqs || data?.unreadNums ? [] : (Array.isArray(data) ? data : [data]);
      for (const req of reqs) {
        if (!req?.friendUin) continue;
        events.push(this._makeEvent("friend_request", {
          user_id: String(req.friendUin),
          nickname: req.friendNick || "",
          comment: req.extMsg || "",
          request_id: req.friendUin || "",
        }));
      }
      return events;
    }
    return [];
  }
}

module.exports = { MilkyEventTranslator };
