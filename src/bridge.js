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
    this.onebotAdapter = null; // set externally after construction
    this.milkyAdapter = null; // set externally after construction

    this.appDir = config.qqResourceAppDir || "/opt/QQ/resources/app";
    this.packageJSON = JSON.parse(
      fs.readFileSync(path.join(this.appDir, "package.json"), "utf-8")
    );
  }

  /** Set the BridgeServer instance for pushing events */
  setServer(server) {
    this.server = server;
  }

  /** Set the OneBotAdapter instance for pushing events */
  setOneBotAdapter(adapter) {
    this.onebotAdapter = adapter;
  }

  /** Set the MilkyAdapter instance for pushing events */
  setMilkyAdapter(adapter) {
    this.milkyAdapter = adapter;
  }

  // --- Event handler ---

  _onEvent(event) {
    // Log all listener callbacks for debugging
    const dataStr = JSON.stringify(event.data);
    const isMediaEvent = /[Rr]ich[Mm]edia|[Uu]pload|[Tt]ransfer/.test(event.eventName);
    const maxLen = isMediaEvent ? 2000 : 200;
    const preview = dataStr && dataStr.length > maxLen ? dataStr.substring(0, maxLen) + "..." : dataStr;
    console.log(`[event] ${event.listenerName}/${event.eventName} ${preview}`);

    if (event.eventName === "onKickedOffLine") {
      this._handleKickedOffLine(event.data);
    }

    if (this.server) {
      this.server.pushEvent(event.listenerName, event.eventName, event.data);
    }
    if (this.onebotAdapter) {
      this.onebotAdapter.pushEvent(event.listenerName, event.eventName, event.data);
    }
    if (this.milkyAdapter) {
      this.milkyAdapter.pushEvent(event.listenerName, event.eventName, event.data);
    }
  }

  _handleKickedOffLine(data) {
    const title = data?.tipsTitle || "下线通知";
    const desc  = data?.tipsDesc  || "";
    console.warn(`[bridge] Kicked offline · ${title}${desc ? " · " + desc : ""}`);
    // Flip login state so /api/status and the dashboard reflect reality.
    this.selfInfo = { uin: "", uid: "", nickName: "" };
    // Drop the stale QR on disk so /qrcode stops returning the old PNG.
    try { fs.unlinkSync("/tmp/qrcode.png"); } catch (_) {}
  }

  // --- Initialization ---

  async init() {
    return this._initStandaloneMode();
  }

  /**
   * Initialize the bridge: load wrapper, init engine, login, create session.
   */
  async _initStandaloneMode() {
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
        platform_type: os.platform() === "win32" ? 3 : os.platform() === "darwin" ? 4 : 5,
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
            let b64 = data?.pngBase64QrcodeData || "";
            if (b64) {
              const commaIdx = b64.indexOf(",");
              if (commaIdx !== -1 && b64.startsWith("data:")) {
                b64 = b64.substring(commaIdx + 1);
              }
              const buf = Buffer.from(b64, "base64");
              fs.writeFileSync("/tmp/qrcode.png", buf);
              const host = this.config.host === "0.0.0.0" || this.config.host === "::" ? "0.0.0.0" : this.config.host;
              console.log(`[bridge] QR code saved (${buf.length} bytes). View at http://${host}:${this.config.port}/qrcode`);
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

    setTimeout(async () => {
      let uin = this.config.quickLoginQQ;
      if (!uin) {
        uin = await this._pickLastLoggedInUin();
      }
      if (uin) {
        this._quickLogin(uin);
      } else {
        console.log("[bridge] Requesting QR code for login...");
        this.loginService.getQRCodePicture();
      }
    }, 1000);
  }

  async _pickLastLoggedInUin() {
    try {
      const r = await this.loginService.getLoginList();
      if (r.result !== 0) {
        console.warn("[bridge] getLoginList failed:", r);
        return null;
      }
      // NTQQ's field name varies across versions; probe the common ones.
      const list = r.LocalLoginInfoList || r.localLoginInfoList || r.loginInfoList || [];
      if (!list.length) {
        console.log("[bridge] No previous login record; falling back to QR code");
        return null;
      }
      const first = list[0];
      const uin = String(first?.uin || first?.Uin || first?.uinString || "");
      if (!uin) {
        console.warn("[bridge] Could not extract uin from login list entry:", JSON.stringify(first));
        return null;
      }
      console.log(`[bridge] Auto-login using previously logged-in account ${uin}`);
      return uin;
    } catch (e) {
      console.error("[bridge] getLoginList error:", e);
      return null;
    }
  }

  // --- Session initialization ---

  async _initSession(uin, uid) {
    console.log("[bridge] Creating session...");
    const SessionClass = this.wrapper.NodeIQQNTWrapperSession;

    // QQ >=3.2.27: create startup session first, then get the wrapper session
    const StartupSession = this.wrapper.NodeIQQNTStartupSessionWrapper;
    if (StartupSession && typeof StartupSession.create === "function") {
      this.startupSession = StartupSession.create();
      this.session = SessionClass.getNTWrapperSession("nt_1");
    } else if (typeof SessionClass.create === "function") {
      this.session = SessionClass.create();
    } else {
      throw new Error("Cannot create session - no known factory method");
    }
    if (!this.session) throw new Error("Session creation returned undefined");
    console.log("[bridge] Session created");

    const globalDataDir = this._getGlobalDataDir();
    const desktopPathConfig = os.platform() === "win32"
      ? path.join(process.env.USERPROFILE, "Documents", "Tencent Files")
      : path.join(process.env.HOME, ".config", "QQ");
    const downloadPath = os.platform() === "win32"
      ? path.join(process.env.USERPROFILE, "Downloads")
      : path.join(process.env.HOME, "Downloads");

    const appid = this._getAppid(globalDataDir);
    const qqVer = this.packageJSON.version;

    // Get GUID from login service and format as UUID (must match what was registered during login)
    let guid = "";
    try {
      const rawGuid = this.loginService.getMachineGuid();
      // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      guid = rawGuid.slice(0, 8) + "-" + rawGuid.slice(8, 12) + "-" + rawGuid.slice(12, 16) + "-" + rawGuid.slice(16, 20) + "-" + rawGuid.slice(20);
      console.log("[bridge] GUID:", guid);
    } catch (e) {
      guid = this._getOrCreateGuid(globalDataDir);
      console.log("[bridge] GUID from file fallback:", guid);
    }

    // Platform: 3=Windows, 4=Mac, 5=Linux
    const systemPlatform = os.platform() === "win32" ? 3 : os.platform() === "darwin" ? 4 : 5;

    const onEvent = (e) => this._onEvent(e);

    const sessionConfig = {
      selfUin: uin,
      selfUid: uid,
      desktopPathConfig: { account_path: desktopPathConfig },
      clientVer: qqVer,
      a2: "",
      d2: "",
      d2Key: "",
      machineId: "",
      platform: systemPlatform,
      platVer: os.release(),
      appid,
      rdeliveryConfig: {
        appKey: "",
        systemId: 0,
        appId: "",
        logicEnvironment: "",
        platform: systemPlatform,
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
        osVer: os.release(),
        vendorOsName: os.type(),
        setMute: false,
        vendorType: 0,
      },
      deviceConfig: '{"appearance":{"isSplitViewMode":true},"msg":{}}',
    };

    const sessionListener = createListener("nodeIKernelSessionListener", {
      onOpentelemetryInit: (info) => {
        if (info && info.is_init) {
          console.log("[bridge] Session initialized");
          this._onSessionReady();
        }
      },
    }, onEvent);

    const dependsAdapter = {
      onMSFStatusChange() {},
      onMSFSsoError() {},
      getGroupCode() {},
    };
    const dispatcherAdapter = {
      dispatchRequest() {},
      dispatchCall() {},
      dispatchCallWithJson() {},
    };

    this.session.init(sessionConfig, dependsAdapter, dispatcherAdapter, sessionListener);

    // Start the session
    if (this.startupSession && typeof this.startupSession.start === "function") {
      this.startupSession.start();
    } else {
      try {
        this.session.startNT(0);
      } catch {
        this.session.startNT();
      }
    }
  }

  // --- Register all listeners after session is ready ---

  _onSessionReady() {
    const s = this.session;
    const onEvent = (e) => this._onEvent(e);
    // Signal online and foreground status
    try { s.onLine(true); } catch {}
    try { s.switchToFront(); } catch {}
    try { s.getMsgService()?.switchForeGround(); } catch {}

    // Core listeners
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
        createListener("nodeIKernelFlashTransferDownloadListener", {}, onEvent)
      );
      ft.addFileSetUploadListener(
        createListener("nodeIKernelFlashTransferUploadListener", {}, onEvent)
      );
    } catch (e) {
      console.warn("[bridge] FlashTransfer listener registration failed:", e.message);
    }

    // BDH upload listener
    try {
      s.getBdhUploadService().addKernelBdhUploadListener(
        createListener("nodeIKernelBdhUploadListener", {}, onEvent)
      );
    } catch {}

    // Rich media listener
    try {
      s.getRichMediaService().addKernelRichMediaListener(
        createListener("nodeIKernelRichMediaListener", {}, onEvent)
      );
    } catch {}

    // === Extended listeners ===
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
        }
      } catch {}
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
      // Re-notify adapters so clients re-fetch friend/group lists
      if (this.onebotAdapter) this.onebotAdapter.notifyLogin();
      if (this.milkyAdapter) this.milkyAdapter.notifyLogin();
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
        // Fallback: try as global path
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
    // NapCat uses: dataPath + /nt_qq/global where dataPath = ~/.config/QQ
    if (os.platform() === "win32") {
      return path.join(process.env.USERPROFILE, "Documents", "Tencent Files", "nt_qq", "global");
    }
    return path.join(process.env.HOME, ".config", "QQ", "nt_qq", "global");
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

    // Extract appid from major.node binary (the REAL protocol appid).
    // package.json.appid is the store/platform appid which differs from the
    // actual protocol appid embedded in the encrypted code.
    let appid = "";
    try {
      const majorPath = path.join(this.appDir, "major.node");
      const majorContent = fs.readFileSync(majorPath);
      const match = majorContent.toString("latin1").match(/QQAppId\/(\d+)/);
      if (match) appid = match[1];
    } catch {}

    // Fallback to package.json
    if (!appid) {
      const platformKey = os.platform();
      if (this.packageJSON.appid && this.packageJSON.appid[platformKey]) {
        appid = String(this.packageJSON.appid[platformKey]);
      }
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
