"use strict";

const path = require("path");
const os = require("os");
const fs = require("fs");
const { createListener } = require("./listener");

const CMD_TRACE_TAG = "___";

/**
 * Core bridge: initializes NTQQ wrapper.node, manages login/session,
 * registers listeners, and handles call/sendPB requests.
 */
class Bridge {
  constructor(config) {
    this.config = config;
    this.wrapper = null;
    this.session = null;
    this.loginService = null;
    this.selfInfo = { uin: "", uid: "", nickName: "" };
    this.server = null; // set externally after construction

    this.appDir = config.qqResourceAppDir || "/opt/QQ/resources/app";
    this.packageJSON = JSON.parse(
      fs.readFileSync(path.join(this.appDir, "package.json"), "utf-8")
    );
  }

  /** Set the BridgeServer instance for pushing events */
  setServer(server) {
    this.server = server;
  }

  // --- Event handler ---

  _onEvent(event) {
    if (this.server) {
      this.server.pushEvent(event.listenerName, event.eventName, event.data);
    }
  }

  // --- Initialization ---

  async init() {
    console.log("[bridge] Loading wrapper.node...");
    this.wrapper = require(path.join(this.appDir, "wrapper.node"));

    console.log("[bridge] Initializing engine...");
    const engine = this.wrapper.NodeIQQNTWrapperEngine.get();

    const globalDataDir = this._getGlobalDataDir();
    if (!fs.existsSync(globalDataDir)) {
      fs.mkdirSync(globalDataDir, { recursive: true });
    }

    const qqVer = this.packageJSON.version;
    const platform = os.platform() === "win32" ? "WIN" : "LNX";
    const qua = `V1_${platform}_NQ_${qqVer.replaceAll("-", "_")}_GW_B`;

    engine.initWithDeskTopConfig(
      {
        base_path_prefix: "",
        platform_type: 3,
        app_type: 4,
        app_version: qqVer,
        os_version: os.version(),
        use_xlog: true,
        qua,
        global_path_config: { desktopGlobalPath: globalDataDir },
        thumb_config: { maxSide: 324, minSide: 48, longLimit: 6, density: 2 },
      },
      createListener(null)
    );

    const appid = this._getAppid(globalDataDir);
    console.log(`[bridge] QQ version: ${qqVer}, appid: ${appid}`);

    this.loginService = this.wrapper.NodeIKernelLoginService.get();
    this.loginService.initConfig({
      machineId: "",
      appid,
      platVer: os.version(),
      commonPath: globalDataDir,
      clientVer: qqVer,
      hostName: os.hostname(),
      externalVersion: false,
    });

    this.loginService.addKernelLoginListener(
      createListener(
        "nodeIKernelLoginListener",
        {
          onQRCodeGetPicture: (data) => {
            if (data && data.pngBase64QrcodeData) {
              console.log("[bridge] QR code received. Saving to /tmp/qrcode.png");
              const buf = Buffer.from(data.pngBase64QrcodeData, "base64");
              fs.writeFileSync("/tmp/qrcode.png", buf);
            } else {
              console.log("[bridge] QR code event (no image data)");
            }
          },
          onQRCodeSessionFailed: (...args) => {
            console.warn("[bridge] QR session failed, requesting new QR code...");
            setTimeout(() => this.loginService.getQRCodePicture(), 1000);
          },
          onQRCodeLoginSucceed: (data) => {
            console.log(`[bridge] Login success: uin=${data.uin} uid=${data.uid}`);
            this.selfInfo.uin = data.uin;
            this.selfInfo.uid = data.uid;
            this._initSession(data.uin, data.uid);
          },
          onLoginFailed: (...args) => {
            console.error("[bridge] Login failed:", args);
          },
        },
        (e) => this._onEvent(e)
      )
    );

    this.loginService.connect();
    console.log("[bridge] Login service connected, waiting for login...");

    // Auto quick login if configured, with fallback to QR code
    if (this.config.quickLoginQQ) {
      setTimeout(() => this._quickLogin(this.config.quickLoginQQ), 1000);
    } else {
      // No quick login configured, go straight to QR code
      setTimeout(() => {
        console.log("[bridge] Requesting QR code for login...");
        this.loginService.getQRCodePicture();
      }, 1000);
    }
  }

  // --- Session initialization ---

  async _initSession(uin, uid) {
    console.log("[bridge] Creating session...");
    this.session = this.wrapper.NodeIQQNTWrapperSession.create();

    const globalDataDir = this._getGlobalDataDir();
    const desktopPathConfig = os.platform() === "win32"
      ? path.join(process.env.USERPROFILE, "Documents", "Tencent Files")
      : path.join(process.env.HOME, ".config", "QQ");
    const downloadPath = os.platform() === "win32"
      ? path.join(process.env.USERPROFILE, "Downloads")
      : path.join(process.env.HOME, "Downloads");

    const guid = this._getOrCreateGuid(globalDataDir);
    const appid = this._getAppid(globalDataDir);
    const qqVer = this.packageJSON.version;

    const onEvent = (e) => this._onEvent(e);

    this.session.init(
      {
        selfUin: uin,
        selfUid: uid,
        desktopPathConfig: { account_path: desktopPathConfig },
        clientVer: qqVer,
        a2: "",
        d2: "",
        d2Key: "",
        machineId: "",
        platform: 3,
        platVer: os.release(),
        appid,
        rdeliveryConfig: {
          appKey: "",
          systemId: 0,
          appId: "",
          logicEnvironment: "",
          platform: 3,
          language: "",
          sdkVersion: "",
          userId: "",
          appVersion: "",
          osVersion: "",
          bundleId: "",
          serverUrl: "",
          fixedAfterHitKeys: [""],
        },
        defaultFileDownloadPath: downloadPath,
        deviceInfo: {
          guid,
          buildVer: qqVer,
          localId: 2052,
          devName: os.hostname(),
          devType: os.type(),
          vendorName: "",
          osVer: os.version(),
          vendorOsName: os.platform(),
          setMute: false,
          vendorType: 0,
        },
        deviceConfig: '{"appearance":{"isSplitViewMode":true},"msg":{}}',
        deviceType: 3,
      },
      createListener("nodeIQQNTWrapperSessionListener", {}, onEvent),
      createListener("nodeIQQNTWrapperSessionListener", {}, onEvent),
      createListener("nodeIQQNTWrapperSessionListener", {
        onSessionInitComplete: (...args) => {
          console.log("[bridge] Session initialized!");
          this._onSessionReady();
        },
      }, onEvent)
    );

    try {
      this.session.startNT(0);
    } catch {
      this.session.startNT();
    }
  }

  // --- Register all listeners after session is ready ---

  _onSessionReady() {
    const s = this.session;
    const onEvent = (e) => this._onEvent(e);

    // Core listeners (same as PMHQ)
    s.getMsgService().addKernelMsgListener(
      createListener("nodeIKernelMsgListener", {}, onEvent)
    );
    s.getBuddyService().addKernelBuddyListener(
      createListener("nodeIKernelBuddyListener", {}, onEvent)
    );
    s.getProfileService().addKernelProfileListener(
      createListener("nodeIKernelProfileListener", {}, onEvent)
    );
    s.getGroupService().addKernelGroupListener(
      createListener("nodeIKernelGroupListener", {}, onEvent)
    );

    // FlashTransfer listeners
    const ft = s.getFlashTransferService();
    try {
      ft.addFileSetDownloadListener(
        createListener("nodeIKernelFlashTransferListener", {}, onEvent)
      );
      ft.addFileSetUploadListener(
        createListener("nodeIKernelFlashTransferListener", {}, onEvent)
      );
    } catch (e) {
      console.warn("[bridge] FlashTransfer listener registration failed:", e.message);
    }

    // === Extended listeners (beyond PMHQ) ===
    const extended = [
      ["getOnlineStatusService", "addKernelOnlineStatusListener", "nodeIKernelOnlineStatusListener"],
      ["getRobotService", "addKernelRobotListener", "nodeIKernelRobotListener"],
      ["getRecentContactService", "addKernelRecentContactListener", "nodeIKernelRecentContactListener"],
      ["getCollectionService", "addKernelCollectionListener", "nodeIKernelCollectionListener"],
      ["getSearchService", "addKernelSearchListener", "nodeIKernelSearchListener"],
      ["getSettingService", "addKernelSettingListener", "nodeIKernelSettingListener"],
      ["getFileAssistantService", "addKernelFileAssistantListener", "nodeIKernelFileAssistantListener"],
      ["getYellowFaceService", "addKernelYellowFaceListener", "nodeIKernelYellowFaceListener"],
      ["getBaseEmojiService", "addKernelBaseEmojiListener", "nodeIKernelBaseEmojiListener"],
      ["getNodeMiscService", "addKernelNodeMiscListener", "nodeIKernelNodeMiscListener"],
      ["getConfigMgrService", "addKernelConfigMgrListener", "nodeIKernelConfigMgrListener"],
      ["getTicketService", "addKernelTicketListener", "nodeIKernelTicketListener"],
    ];

    for (const [getService, addListener, listenerName] of extended) {
      try {
        const service = s[getService]();
        if (service && typeof service[addListener] === "function") {
          service[addListener](createListener(listenerName, {}, onEvent));
          console.log(`[bridge] Registered ${listenerName}`);
        }
      } catch (e) {
        console.warn(`[bridge] ${listenerName} registration skipped: ${e.message}`);
      }
    }

    // Notify self info
    setTimeout(() => {
      try {
        const nickMap = s.getBuddyService().getBuddyNick([this.selfInfo.uid]);
        this.selfInfo.nickName = nickMap.get(this.selfInfo.uid) || "";
        console.log(`[bridge] Self: ${this.selfInfo.nickName} (${this.selfInfo.uin})`);
      } catch (e) {
        console.warn("[bridge] Failed to get self nick:", e.message);
      }
      this.server?.broadcast({
        type: "on_session",
        data: { sub_type: "onSessionInitComplete", data: {} },
      });
    }, 3000);
  }

  // --- Handle "call" requests ---

  async handleCall(func, args) {
    if (!Array.isArray(args)) args = [args];

    // Special case: getSelfInfo
    if (func === "getSelfInfo") {
      return this.selfInfo;
    }

    // Parse function path: "wrapperSession.getMsgService().sendMsg"
    // or direct: "loginService.quickLoginWithUin"
    try {
      let target;
      if (func.startsWith("wrapperSession.")) {
        target = this.session;
        const chain = func.replace("wrapperSession.", "");
        return await this._evalChain(target, chain, args);
      } else if (func.startsWith("loginService.")) {
        target = this.loginService;
        const method = func.replace("loginService.", "");
        return await this._callMethod(target, method, args);
      } else {
        // Fallback: try as global PMHQ-compatible path
        return await this._evalChain(this.session, func, args);
      }
    } catch (e) {
      console.error(`[bridge] call error: ${func}`, e.message);
      throw e;
    }
  }

  /** Evaluate a method chain like "getMsgService().sendMsg" on a target object */
  async _evalChain(target, chain, args) {
    // Split on ")." to get intermediate calls
    // e.g. "getMsgService().sendMsg" → ["getMsgService()", "sendMsg"]
    const parts = chain.split(/\)\./);
    let obj = target;

    for (let i = 0; i < parts.length - 1; i++) {
      const methodName = parts[i].replace("(", "").replace(")", "");
      if (typeof obj[methodName] !== "function") {
        throw new Error(`Method not found: ${methodName}`);
      }
      obj = obj[methodName]();
    }

    const finalMethod = parts[parts.length - 1].replace("()", "");
    return await this._callMethod(obj, finalMethod, args);
  }

  async _callMethod(obj, method, args) {
    if (typeof obj[method] !== "function") {
      throw new Error(`Method not found: ${method}`);
    }
    const result = obj[method](...args);
    if (result && typeof result.then === "function") {
      return await result;
    }
    return result;
  }

  // --- Handle "send" (raw SSO packet) requests ---

  async handleSendPB(cmd, pbHex) {
    if (!this.session) throw new Error("Session not ready");
    const echo = require("crypto").randomUUID();
    const ssoCmd = `${cmd}${CMD_TRACE_TAG}${echo}${CMD_TRACE_TAG}${pbHex}`;
    this.session.getMsgService().sendSsoCmdReqByContend(ssoCmd, pbHex);
    return { pb: "", echo };
  }

  // --- Quick login ---

  _quickLogin(uin) {
    console.log(`[bridge] Attempting quick login for ${uin}...`);
    this.loginService.getLoginList().then((r) => {
      if (r.result !== 0) {
        console.warn("[bridge] getLoginList failed:", r);
      }
      setTimeout(() => {
        this.loginService.quickLoginWithUin(uin).then((res) => {
          if (res.result === "0" || res.result === 0) {
            console.log("[bridge] Quick login success");
          } else {
            console.warn("[bridge] Quick login failed:", JSON.stringify(res));
            console.log("[bridge] Falling back to QR code login...");
            this.loginService.getQRCodePicture();
          }
        }).catch((e) => {
          console.error("[bridge] Quick login error:", e);
          console.log("[bridge] Falling back to QR code login...");
          this.loginService.getQRCodePicture();
        });
      }, 1000);
    });
  }

  // --- Helpers ---

  _getGlobalDataDir() {
    if (os.platform() === "win32") {
      return path.join(process.env.USERPROFILE, "Documents", "Tencent Files", "nt_qq", "global");
    }
    return path.join(process.env.HOME, ".config", "QQ", "global");
  }

  _getOrCreateGuid(globalDir) {
    const guidPath = path.join(globalDir, "guid");
    if (fs.existsSync(guidPath)) {
      return fs.readFileSync(guidPath, "utf-8");
    }
    const guid = genUUID();
    fs.writeFileSync(guidPath, guid);
    return guid;
  }

  _getAppid(globalDir) {
    const appidPath = path.join(globalDir, "appid.json");
    const qqVer = this.packageJSON.version;
    let appidJson = {};

    if (fs.existsSync(appidPath)) {
      try {
        appidJson = JSON.parse(fs.readFileSync(appidPath, "utf-8"));
        if (appidJson[qqVer]) return appidJson[qqVer];
      } catch {}
    }

    // Try to extract from major.node strings or package.json
    let appid = "";
    const platformKey = os.platform();
    if (this.packageJSON.appid && this.packageJSON.appid[platformKey]) {
      appid = String(this.packageJSON.appid[platformKey]);
    }

    if (!appid) {
      // Fallback: try to read from major.node binary
      try {
        const majorPath = path.join(this.appDir, "major.node");
        const majorContent = fs.readFileSync(majorPath);
        const match = majorContent.toString("latin1").match(/QQAppId\/(\d+)/);
        if (match) appid = match[1];
      } catch {}
    }

    if (appid) {
      appidJson[qqVer] = appid;
      fs.writeFileSync(appidPath, JSON.stringify(appidJson, null, 2));
    }

    return appid || this.packageJSON.appid?.linux || "";
  }
}

function genUUID() {
  let d = Date.now();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = ((d + Math.random() * 16) % 16) | 0;
    d = Math.floor(d / 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

module.exports = { Bridge };
