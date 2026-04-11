"use strict";

const path = require("path");
const { resolveMediaFile, resolveImageFile } = require("../onebot/message");

const IMAGE_HTTP_HOST = "https://gchat.qpic.cn";

// ---- NTQQ elements -> Milky message segments ----

function ntToMilky(elements, msg) {
  const segments = [];
  if (!elements || !Array.isArray(elements)) return segments;

  for (const el of elements) {
    const seg = convertElementToMilky(el, msg);
    if (seg) {
      if (Array.isArray(seg)) segments.push(...seg);
      else segments.push(seg);
    }
  }
  return segments;
}

function convertElementToMilky(el, msg) {
  if (el.textElement) {
    const te = el.textElement;
    if (te.atType === 1) {
      return { type: "mention_all", data: {} };
    }
    if (te.atType === 2) {
      const userId = te.atUid && te.atUid !== "0" ? te.atUid : te.content?.replace("@", "");
      return { type: "mention", data: { user_id: String(userId) } };
    }
    if (!te.content) return null;
    return { type: "text", data: { text: te.content } };
  }

  if (el.replyElement) {
    // message_seq will be resolved by event translator
    return {
      type: "reply",
      data: { message_seq: 0 },
    };
  }

  if (el.picElement) {
    const pe = el.picElement;
    let url = "";
    if (pe.originImageUrl) {
      url = pe.originImageUrl.startsWith("http") ? pe.originImageUrl : IMAGE_HTTP_HOST + pe.originImageUrl;
    }
    return {
      type: "image",
      data: {
        file_id: pe.md5HexStr || pe.fileName || "",
        url,
        file_name: pe.fileName || "",
        file_size: Number(pe.fileSize) || 0,
      },
    };
  }

  if (el.videoElement) {
    return {
      type: "video",
      data: {
        file_id: el.videoElement.videoMd5 || el.videoElement.fileName || "",
        url: el.videoElement.filePath || "",
        file_name: el.videoElement.fileName || "",
        file_size: Number(el.videoElement.fileSize) || 0,
      },
    };
  }

  if (el.fileElement) {
    return {
      type: "file",
      data: {
        file_id: el.fileElement.fileUuid || "",
        name: el.fileElement.fileName || "",
        size: Number(el.fileElement.fileSize) || 0,
      },
    };
  }

  if (el.pttElement) {
    return {
      type: "record",
      data: {
        file_id: el.pttElement.md5HexStr || el.pttElement.fileName || "",
        url: el.pttElement.filePath || "",
        file_name: el.pttElement.fileName || "",
        file_size: Number(el.pttElement.fileSize) || 0,
      },
    };
  }

  if (el.arkElement) {
    try {
      const data = JSON.parse(el.arkElement.bytesData);
      if (data.app === "com.tencent.multimsg") {
        return { type: "forward", data: { forward_id: msg?.msgId || "0" } };
      }
      return {
        type: "light_app",
        data: { app_name: data.app || "", json_data: el.arkElement.bytesData },
      };
    } catch {}
    return {
      type: "light_app",
      data: { app_name: "", json_data: el.arkElement.bytesData },
    };
  }

  if (el.faceElement) {
    return {
      type: "face",
      data: { face_id: el.faceElement.faceIndex || 0 },
    };
  }

  if (el.marketFaceElement) {
    const mf = el.marketFaceElement;
    const dir = (mf.emojiId || "").substring(0, 2);
    return {
      type: "market_face",
      data: {
        emoji_id: mf.emojiId || "",
        emoji_package_id: mf.emojiPackageId || "",
        summary: mf.faceName || "",
        url: `https://gxh.vip.qq.com/club/item/parcel/item/${dir}/${mf.emojiId}/raw300.gif`,
        key: mf.key || "",
      },
    };
  }

  if (el.markdownElement) {
    return { type: "xml", data: { xml_data: el.markdownElement.content || "" } };
  }

  if (el.multiForwardMsgElement) {
    return { type: "forward", data: { forward_id: msg?.msgId || "0" } };
  }

  return null;
}

// ---- Milky message segments -> NTQQ send elements ----

function milkyToNt(segments, uidResolver) {
  if (!Array.isArray(segments)) return [];

  const elements = [];
  for (const seg of segments) {
    const el = convertMilkySegment(seg, uidResolver);
    if (el) elements.push(el);
  }
  return elements;
}

function convertMilkySegment(seg, uidResolver) {
  switch (seg.type) {
    case "text":
      return {
        elementType: 1,
        elementId: "",
        textElement: { content: String(seg.data?.text || ""), atType: 0, atUid: "", atTinyId: "", atNtUid: "" },
      };

    case "mention": {
      const userId = String(seg.data?.user_id || "");
      const resolved = uidResolver?.(userId);
      const uid = typeof resolved === "string" ? resolved : resolved?.uid || "";
      const name = (typeof resolved === "object" ? resolved?.name : null) || userId;
      return {
        elementType: 1,
        elementId: "",
        textElement: {
          content: `@${name}`,
          atType: 2,
          atUid: uid || userId,
          atTinyId: "",
          atNtUid: uid,
        },
      };
    }

    case "mention_all":
      return {
        elementType: 1,
        elementId: "",
        textElement: { content: "@全体成员", atType: 1, atUid: "0", atTinyId: "", atNtUid: "all" },
      };

    case "face":
      return {
        elementType: 6,
        elementId: "",
        faceElement: { faceIndex: parseInt(seg.data?.face_id) || 0, faceType: 1, sourceType: 1 },
      };

    case "reply":
      return {
        elementType: 7,
        elementId: "",
        replyElement: {
          replayMsgSeq: "0",
          replayMsgId: String(seg.data?.message_seq || "0"),
          senderUin: "0",
          senderUinStr: "0",
        },
      };

    case "image": {
      const fileRef = seg.data?.url || seg.data?.file_id || "";
      const resolved = resolveImageFile(fileRef);
      if (!resolved) return null;
      return {
        elementType: 2,
        elementId: "",
        picElement: {
          md5HexStr: resolved.md5,
          fileSize: String(resolved.size),
          fileName: path.basename(resolved.path),
          sourcePath: resolved.path,
          original: true,
          picType: 1000,
          picSubType: 0,
          picWidth: resolved.width || 0,
          picHeight: resolved.height || 0,
          fileUuid: "",
          fileSubId: "",
          thumbFileSize: 0,
          summary: "[图片]",
        },
      };
    }

    case "record": {
      const fileRef = seg.data?.url || seg.data?.file_id || "";
      const resolved = resolveMediaFile(fileRef, "amr");
      if (!resolved) return null;
      return {
        elementType: 4,
        elementId: "",
        pttElement: {
          fileName: path.basename(resolved.path),
          filePath: resolved.path,
          md5HexStr: resolved.md5,
          fileSize: String(resolved.size),
          duration: 5,
          formatType: 1,
          voiceType: 1,
          voiceChangeType: 0,
          canConvert2Text: true,
          waveAmplitudes: [0, 18, 9, 23, 16, 17, 16, 15, 44, 17, 24, 20, 14, 15, 17],
          fileSubId: "",
          playState: 1,
          autoConvertText: 0,
        },
      };
    }

    case "video": {
      const fileRef = seg.data?.url || seg.data?.file_id || "";
      const resolved = resolveMediaFile(fileRef, "mp4");
      if (!resolved) return null;
      return {
        elementType: 5,
        elementId: "",
        videoElement: {
          fileName: path.basename(resolved.path),
          filePath: resolved.path,
          videoMd5: resolved.md5,
          fileSize: String(resolved.size),
        },
      };
    }

    case "light_app":
      return {
        elementType: 10,
        elementId: "",
        arkElement: { bytesData: seg.data?.json_data || "{}", linkInfo: null, subElementType: null },
      };

    default:
      return null;
  }
}

module.exports = { ntToMilky, milkyToNt };
