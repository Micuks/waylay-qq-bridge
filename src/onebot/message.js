"use strict";

/**
 * NTQQ element <-> OneBot v11 message segment converter.
 *
 * NTQQ element types:
 *   1=Text, 2=Pic, 3=File, 4=Ptt(voice), 5=Video, 6=Face,
 *   7=Reply, 8=GrayTip, 10=Ark, 11=MarketFace, 14=Markdown,
 *   16=MultiForward, 17=InlineKeyboard
 *
 * AtType: 0=Unknown, 1=All, 2=One
 * ChatType: 1=C2C(friend), 2=Group, 100=TempC2CFromGroup
 */

const IMAGE_HTTP_HOST = "https://gchat.qpic.cn";

// ---- NTQQ elements -> OneBot v11 segments ----

function ntToOneBot(elements, msg) {
  const segments = [];
  if (!elements || !Array.isArray(elements)) return segments;

  for (const el of elements) {
    const seg = convertElement(el, msg);
    if (seg) {
      if (Array.isArray(seg)) segments.push(...seg);
      else segments.push(seg);
    }
  }
  return segments;
}

function convertElement(el, msg) {
  // Text or At
  if (el.textElement) {
    const te = el.textElement;
    if (te.atType === 1) {
      return { type: "at", data: { qq: "all" } };
    }
    if (te.atType === 2) {
      const qq = te.atUid && te.atUid !== "0" ? te.atUid : te.content?.replace("@", "");
      return { type: "at", data: { qq: String(qq), name: te.content?.replace("@", "") } };
    }
    if (!te.content) return null;
    return { type: "text", data: { text: te.content } };
  }

  // Reply
  if (el.replyElement) {
    return {
      type: "reply",
      data: { id: String(el.replyElement.sourceMsgIdInRecords || el.replyElement.replayMsgId || "0") },
    };
  }

  // Image
  if (el.picElement) {
    const pe = el.picElement;
    let url = "";
    if (pe.originImageUrl) {
      url = pe.originImageUrl.startsWith("http") ? pe.originImageUrl : IMAGE_HTTP_HOST + pe.originImageUrl;
    }
    return {
      type: "image",
      data: {
        file: pe.fileName || "",
        subType: pe.picSubType,
        url,
        file_size: String(pe.fileSize || "0"),
      },
    };
  }

  // Video
  if (el.videoElement) {
    return {
      type: "video",
      data: {
        file: el.videoElement.fileName || "",
        url: el.videoElement.filePath || "",
        file_size: String(el.videoElement.fileSize || "0"),
      },
    };
  }

  // File
  if (el.fileElement) {
    return {
      type: "file",
      data: {
        file: el.fileElement.fileName || "",
        url: el.fileElement.filePath || "",
        file_id: el.fileElement.fileUuid || "",
        file_size: String(el.fileElement.fileSize || "0"),
      },
    };
  }

  // Voice (PTT)
  if (el.pttElement) {
    return {
      type: "record",
      data: {
        file: el.pttElement.fileName || "",
        url: el.pttElement.filePath || "",
        file_size: String(el.pttElement.fileSize || "0"),
      },
    };
  }

  // Ark (JSON card / forward)
  if (el.arkElement) {
    try {
      const data = JSON.parse(el.arkElement.bytesData);
      if (data.app === "com.tencent.multimsg") {
        return { type: "forward", data: { id: msg?.msgId || "0" } };
      }
    } catch {}
    return { type: "json", data: { data: el.arkElement.bytesData } };
  }

  // Face
  if (el.faceElement) {
    const fe = el.faceElement;
    if (fe.faceType === 5 && fe.faceIndex === 1) {
      return { type: "shake", data: {} };
    }
    if (fe.faceIndex === 358) {
      return { type: "dice", data: { result: fe.resultId } };
    }
    if (fe.faceIndex === 359) {
      return { type: "rps", data: { result: fe.resultId } };
    }
    return { type: "face", data: { id: String(fe.faceIndex) } };
  }

  // MarketFace (sticker)
  if (el.marketFaceElement) {
    const mf = el.marketFaceElement;
    const dir = (mf.emojiId || "").substring(0, 2);
    return {
      type: "mface",
      data: {
        summary: mf.faceName || "",
        url: `https://gxh.vip.qq.com/club/item/parcel/item/${dir}/${mf.emojiId}/raw300.gif`,
        emoji_id: mf.emojiId,
        emoji_package_id: mf.emojiPackageId,
        key: mf.key,
      },
    };
  }

  // Markdown
  if (el.markdownElement) {
    return { type: "markdown", data: { content: el.markdownElement.content || "" } };
  }

  // MultiForward
  if (el.multiForwardMsgElement) {
    return { type: "forward", data: { id: msg?.msgId || "0" } };
  }

  return null;
}

// ---- OneBot v11 segments -> NTQQ send elements ----

function oneBotToNt(segments, uidResolver) {
  if (!Array.isArray(segments)) {
    if (typeof segments === "string") {
      return [makeTextElement(segments)];
    }
    segments = [segments];
  }

  const elements = [];
  for (const seg of segments) {
    if (typeof seg === "string") {
      elements.push(makeTextElement(seg));
      continue;
    }
    const el = convertSegment(seg, uidResolver);
    if (el) elements.push(el);
  }
  return elements;
}

function convertSegment(seg, uidResolver) {
  switch (seg.type) {
    case "text":
      return makeTextElement(seg.data?.text || "");

    case "at": {
      const qq = String(seg.data?.qq || "");
      if (qq === "all") {
        return {
          elementType: 1,
          elementId: "",
          textElement: { content: "@全体成员", atType: 1, atUid: "", atTinyId: "", atNtUid: "" },
        };
      }
      const uid = uidResolver?.(qq) || "";
      return {
        elementType: 1,
        elementId: "",
        textElement: {
          content: `@${seg.data?.name || qq}`,
          atType: 2,
          atUid: qq,
          atTinyId: "",
          atNtUid: uid,
        },
      };
    }

    case "face":
      return {
        elementType: 6,
        elementId: "",
        faceElement: {
          faceIndex: parseInt(seg.data?.id) || 0,
          faceType: parseInt(seg.data?.sub_type) || 1,
          sourceType: 1,
        },
      };

    case "reply":
      return {
        elementType: 7,
        elementId: "",
        replyElement: {
          replayMsgSeq: "0",
          replayMsgId: String(seg.data?.id || "0"),
          senderUin: "0",
          senderUinStr: "0",
        },
      };

    case "image":
      // Image handling requires file download/upload via NT API
      // For now, return a placeholder that the action handler will process
      return {
        elementType: 2,
        elementId: "",
        picElement: {
          fileName: seg.data?.file || "",
          sourcePath: seg.data?.file || "",
          _obFile: seg.data?.file || "", // marker for action handler to process
        },
      };

    case "json":
      return {
        elementType: 10,
        elementId: "",
        arkElement: { bytesData: seg.data?.data || "{}", linkInfo: null, subElementType: null },
      };

    case "dice":
      return {
        elementType: 6,
        elementId: "",
        faceElement: {
          faceIndex: 358,
          faceType: 3,
          resultId: String(seg.data?.result || Math.floor(Math.random() * 6) + 1),
          packId: "1",
          stickerId: "33",
          sourceType: 1,
          stickerType: 2,
          surpriseId: "",
        },
      };

    case "rps":
      return {
        elementType: 6,
        elementId: "",
        faceElement: {
          faceIndex: 359,
          faceType: 3,
          resultId: String(seg.data?.result || Math.floor(Math.random() * 3) + 1),
          packId: "1",
          stickerId: "34",
          sourceType: 1,
          stickerType: 2,
          surpriseId: "",
        },
      };

    default:
      return null;
  }
}

function makeTextElement(text) {
  return {
    elementType: 1,
    elementId: "",
    textElement: { content: String(text), atType: 0, atUid: "", atTinyId: "", atNtUid: "" },
  };
}

// ---- Helpers ----

/** Build raw_message string from OneBot segments */
function segmentsToRawMessage(segments) {
  return segments
    .map((s) => {
      switch (s.type) {
        case "text": return s.data.text;
        case "at": return `@${s.data.qq === "all" ? "全体成员" : s.data.name || s.data.qq}`;
        case "face": return `[表情${s.data.id}]`;
        case "image": return "[图片]";
        case "record": return "[语音]";
        case "video": return "[视频]";
        case "file": return `[文件]`;
        case "reply": return "";
        case "json": return "[JSON]";
        case "forward": return "[转发消息]";
        case "dice": return "[骰子]";
        case "rps": return "[猜拳]";
        case "shake": return "[戳一戳]";
        case "mface": return `[${s.data.summary || "表情"}]`;
        default: return `[${s.type}]`;
      }
    })
    .join("");
}

module.exports = { ntToOneBot, oneBotToNt, segmentsToRawMessage };
