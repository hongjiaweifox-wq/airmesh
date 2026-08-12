/* Family device quick console */

const STORAGE_KEY = "groupAppControl.v1"; // legacy browser cache; migrated once to data/store.json

/** @type {{ cookies: Record<string,string>, homes: Home[], activeHomeId: string|null }} */
let state = { cookies: {}, homes: [], activeHomeId: null };
let persistTimer = null;
let storePath = "";

const ENV_CONFIG = {
  "newenergy-operation-cn.wgine-inc.com": {
    name: "中国预发",
    short: "CN-Pre",
    region: "cn",
    supported: true,
  },
  "newenergy-operation-cn.tuya-inc.com": {
    name: "中国线上",
    short: "CN-Prod",
    region: "cn",
    supported: true,
  },
  "newenergy-operation-eu.wgine-inc.com": {
    name: "欧洲预发",
    short: "EU-Pre",
    region: "eu",
    supported: false,
  },
  "newenergy-operation-eu.tuya-inc.com": {
    name: "欧洲线上",
    short: "EU-Prod",
    region: "eu",
    supported: false,
  },
  "newenergy-operation-us.wgine-inc.com": {
    name: "美国预发",
    short: "US-Pre",
    region: "us",
    supported: false,
  },
  "newenergy-operation-us.tuya-inc.com": {
    name: "美国线上",
    short: "US-Prod",
    region: "us",
    supported: false,
  },
  "newenergy-operation-sg.tuya-inc.com": {
    name: "新加坡线上",
    short: "SG-Prod",
    region: "sg",
    supported: false,
  },
  "newenergy-operation-weaz.tuya-inc.com": {
    name: "西欧线上",
    short: "WEAZ",
    region: "weaz",
    supported: false,
  },
  "newenergy-operation-ueaz.tuya-inc.com": {
    name: "美东线上",
    short: "UEAZ",
    region: "ueaz",
    supported: false,
  },
  "127.0.0.1": { name: "本机", short: "Local", region: "local", supported: true },
  localhost: { name: "本机", short: "Local", region: "local", supported: true },
};

/** Hestia hosts for meter bizlog */
const HESTIA_ENVS = {
  "hestia-cn.tuya-inc.com": { name: "Hestia 中国线上", short: "H-CN", region: "cn" },
  "hestia-cn.wgine-inc.com": { name: "Hestia 中国预发", short: "H-CN-Pre", region: "cn" },
  "hestia-eu.tuya-inc.com": { name: "Hestia 欧洲线上", short: "H-EU", region: "eu" },
  "hestia-eu.wgine-inc.com": { name: "Hestia 欧洲预发", short: "H-EU-Pre", region: "eu" },
  "hestia-us.tuya-inc.com": { name: "Hestia 美国线上", short: "H-US", region: "us" },
  "hestia-us.wgine-inc.com": { name: "Hestia 美国预发", short: "H-US-Pre", region: "us" },
  "hestia-sg.tuya-inc.com": { name: "Hestia 新加坡线上", short: "H-SG", region: "sg" },
  "hestia-weaz.tuya-inc.com": { name: "Hestia 西欧线上", short: "H-WEAZ", region: "weaz" },
  "hestia-ueaz.tuya-inc.com": { name: "Hestia 美东线上", short: "H-UEAZ", region: "ueaz" },
};

const METER_PID = "7sndpedu8g2tkzvi";
const METER_DP_ID = "29";
const METER_DP_CODE = "active_power";
/** 三方电表 / 无电表时电网节点：一体机「局域网电表配对功率」DP26 */
const METER_THIRD_DP_ID = "26";
const METER_THIRD_DP_CODE = "grid_power";
const METER_THIRD_MODEL_CODE = "meter_power";
const BIZLOG_EVENT_IDS =
  "1,2,3,4,5,6,7,8,9,10,11,12,13,14,21,36,38,39,40,41,42,43,44,45,46,47,51,52,53,54,56,57,59,60,61,62,63";

/** Device models: pid-schema.pid → model bucket → regulation_grid_export_p_limit cap */
const DEVICE_MODELS = [
  {
    id: "CBE2000",
    label: "CBE2000",
    badge: "CBE2000",
    maxExport: 2048,
    pids: ["c4ilzd7aybycece9"],
  },
  {
    id: "Lyra1500",
    label: "Lyra 1500",
    badge: "Lyra 1500",
    maxExport: 1500,
    pids: ["rloz0sela2ltnqqp", "jns5mgxgranqxjq3"],
  },
  {
    id: "Atlas3000",
    label: "atlas 3000",
    badge: "Atlas 3000",
    maxExport: 3000,
    pids: ["8lkqbvmmrx043jig"],
  },
];

const UNKNOWN_MODEL = { id: "unknown", label: "未知型号", badge: "未知", maxExport: null, pids: [] };

const DP_DISPLAY = [
  { code: "pv_power_total", label: "发电功率", unit: "W", tone: "", aliases: ["pv_power_total"] },
  { code: "battery_power", label: "电池功率", unit: "W", tone: "green", aliases: ["battery_power"] },
  {
    code: "grid_port_power",
    label: "并网口",
    unit: "W",
    tone: "blue",
    // DP27：勿与 DP26 grid_power/meter_power（局域网电表配对功率）混用
    aliases: ["grid_port_power", "inverter_output_power"],
  },
  { code: "current_soc", label: "SOC", unit: "%", tone: "", aliases: ["current_soc", "main_soc"] },
  {
    code: "battery_charging_power_grid",
    label: "离网口",
    unit: "W",
    tone: "",
    aliases: ["offgrid1_export_power", "battery_charging_power_grid"],
  },
];

const DP_EDITABLE = [
  {
    code: "backup_soc",
    label: "备用 SOC",
    unit: "%",
    aliases: ["backup_soc", "backup_reserve", "min_soc_discharge"],
  },
  {
    code: "regulation_grid_export_p_limit",
    label: "法规输出上限(取小)",
    unit: "W",
    useModelMax: true,
    aliases: ["regulation_grid_export_p_limit"],
  },
  { code: "output_power_limit", label: "AC输出限制", unit: "W", aliases: ["output_power_limit"] },
  {
    code: "inverter_input_power_limit",
    label: "AC输入限制",
    unit: "W",
    aliases: ["inverter_input_power_limit"],
  },
];

const ALL_FIELDS = [...DP_DISPLAY, ...DP_EDITABLE];
const ALL_CODES = ALL_FIELDS.map((d) => d.code);

/** 影子只读点：不进①区网格，供能量流 BMS 等展示 */
const DP_SHADOW_EXTRA = [
  {
    code: "battery_capacity",
    label: "电池容量",
    unit: "kWh",
    aliases: ["battery_capacity"],
  },
  {
    // DP26：局域网电表配对功率（无实体电表时供「电网 Grid」节点显示）
    code: "meter_power",
    label: "局域网电表配对功率",
    unit: "W",
    aliases: ["meter_power", "grid_power"],
    dpCode: "grid_power",
    fallbackDpId: METER_THIRD_DP_ID,
  },
  {
    // DP98：多机协同实际工况（主机报文含全员；从机仅本机）
    code: "command_receive",
    label: "协同命令接收",
    unit: "",
    aliases: ["command_receive"],
    dpCode: "command_receive",
    fallbackDpId: "98",
    dpSchema: { type: "raw", maxlen: 128 },
  },
];
const DP_SHADOW_EXTRA_CODES = DP_SHADOW_EXTRA.map((d) => d.code);

/** DP98 主机编号：固定 0x0A 表示本机主机槽位 */
const DP98_MASTER_NUMER = 0x0a;

/** Home-side params: issue to every device in the home. */
const HOME_FAMILY_FIELDS = [
  {
    code: "work_mode",
    label: "工作模式",
    unit: "",
    via: "dp",
    dpCode: "work_mode",
    fallbackDpId: "51",
    type: "enum",
    options: [
      { value: "self_powered", label: "自发自用" },
      { value: "time_of_use", label: "分时用电" },
      { value: "manual", label: "手动设置" },
      { value: "plug", label: "插座优先" },
      { value: "diy", label: "DIY" },
    ],
    aliases: ["work_mode"],
  },
  {
    code: "home_max_current",
    label: "最大电流限制(防总闸线路满载-规划中)",
    unit: "A",
    via: "function_set",
    type: "enum",
    options: ["10", "16", "20", "32", "40", "63"].map((v) => ({ value: v, label: `${v}A` })),
    // 物模型 → function_set(52) register
    regAddr: 0x401d,
    signed: false,
  },
  {
    code: "home_allowed_backflow_power",
    label: "逆流上限功率",
    unit: "W",
    via: "function_set",
    type: "number",
    regAddr: 0x4002,
    signed: false,
  },
  {
    code: "total_plug_power",
    label: "插座功率(智能电器·设备上报后下发)",
    unit: "W",
    via: "function_set",
    type: "number",
    regAddr: 0x5002,
    signed: true,
  },
  {
    code: "base_load",
    label: "基础负载功率(传统负载·用户手输)",
    unit: "W",
    via: "dp",
    dpCode: "base_load",
    fallbackDpId: "91",
    type: "number",
    aliases: ["base_load"],
  },
];

const HOME_SHADOW_FIELDS = HOME_FAMILY_FIELDS.filter((f) => f.via === "dp");
const HOME_MODEL_CODES = HOME_FAMILY_FIELDS.filter((f) => f.via === "function_set").map((f) => f.code);

/** 设备侧物模型只读点（property-query），不进家庭下发 */
const DEVICE_MODEL_READONLY = [
  {
    code: "device_cluster_role",
    label: "集群角色",
    via: "function_set",
    unit: "",
  },
  {
    code: "device_cluster_node_id",
    label: "集群身份id",
    via: "function_set",
    unit: "",
  },
];

/** 所有需从 property-query 拉取的物模型 code */
const ALL_MODEL_CODES = [
  ...HOME_MODEL_CODES,
  ...DEVICE_MODEL_READONLY.map((f) => f.code),
];

/**
 * device_cluster_role 文案：0 主机 / 1 从机 / 2 选举中 / 3 未使能集群。
 * @returns {string|null} null = 尚未读到值
 */
function clusterRoleLabel(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (n === 0) return "主机";
  if (n === 1) return "从机";
  if (n === 2) return "选举中";
  if (n === 3) return "未使能集群";
  if (Number.isFinite(n)) return `角色${n}`;
  return String(raw);
}

/**
 * 集群身份 id（function_set / device_cluster_node_id）。
 * @returns {string|null} 有值返回规范化字符串；空/未读返回 null（按单机）
 */
function deviceClusterNodeId(deviceOrRaw) {
  const raw =
    deviceOrRaw && typeof deviceOrRaw === "object"
      ? deviceOrRaw.values?.device_cluster_node_id
      : deviceOrRaw;
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/** 有 device_cluster_node_id 则进对应集群框；否则单机。 */
function isClusterBoxMember(deviceOrRaw) {
  return deviceClusterNodeId(deviceOrRaw) != null;
}

/**
 * 按 device_cluster_node_id 分多集群；无 id 的进 solos。
 * 集群内优先主机(role=0)，再从机，其余按原序。
 * @returns {{ clusters: { nodeId: string, devices: object[] }[], solos: object[] }}
 */
function groupDevicesByCluster(devices) {
  const list = Array.isArray(devices) ? devices : [];
  const byNode = new Map();
  const solos = [];
  for (const d of list) {
    const nid = deviceClusterNodeId(d);
    if (nid == null) {
      solos.push(d);
      continue;
    }
    if (!byNode.has(nid)) byNode.set(nid, []);
    byNode.get(nid).push(d);
  }
  const roleRank = (d) => {
    const n = Number(d?.values?.device_cluster_role);
    if (n === 0) return 0;
    if (n === 1) return 1;
    if (Number.isFinite(n)) return 10 + n;
    return 99;
  };
  const clusters = [...byNode.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en"))
    .map(([nodeId, devs]) => ({
      nodeId,
      devices: [...devs].sort((a, b) => roleRank(a) - roleRank(b)),
    }));
  return { clusters, solos };
}

/**
 * 一体机上报给主机的 grid 口充放策略（对齐飞书《从机状态判》/ owner_infomation_package）。
 * @see https://icn602w9tnqf.feishu.cn/wiki/BxNGwzYxRiDDXmkijy0cje8Znjc
 */
const OWNER_WORK_MODEL = {
  FORCE_CHARGE: 0x01, // 充电状态2
  FORCE_DISCHARGE: 0x02, // 放电（防弃光）
  BIDIRECTIONAL: 0x03, // 可充可放
  CHARGE_ONLY: 0x04, // 可充
  DISCHARGE_ONLY: 0x05, // 可放
  DISABLED: 0x06, // 禁充禁放
  LOAD_FORCE_CHARGE: 0x21, // 充电状态1
};

const OWNER_WORK_MODEL_CN = {
  [OWNER_WORK_MODEL.FORCE_CHARGE]: "充电状态2",
  [OWNER_WORK_MODEL.FORCE_DISCHARGE]: "放电",
  [OWNER_WORK_MODEL.BIDIRECTIONAL]: "可充可放",
  [OWNER_WORK_MODEL.CHARGE_ONLY]: "可充",
  [OWNER_WORK_MODEL.DISCHARGE_ONLY]: "可放",
  [OWNER_WORK_MODEL.DISABLED]: "禁充禁放",
  [OWNER_WORK_MODEL.LOAD_FORCE_CHARGE]: "充电状态1",
};

function _ownerNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _ownerFault(raw) {
  if (raw == null || raw === "" || raw === 0 || raw === "0") return false;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (Array.isArray(raw)) return raw.some(Boolean);
  if (typeof raw === "object") return Object.values(raw).some((x) => !!x && x !== "0" && x !== 0);
  const s = String(raw);
  if (!s || s === "0" || s === "[]" || s === "{}") return false;
  return /inverter_failure|grid_failure|inverter_output_fault|inverter_other_fault|system_/.test(s) || s !== "0";
}

/**
 * @returns {{ model: number, label: string, chgCapW: number, dchgCapW: number, reason: string, formula: string, inputs: object }|null}
 */
function classifyOwnerWorkModel(device) {
  if (!device) return null;
  const v = device.values || {};
  const hasLive =
    v.current_soc != null ||
    v.main_soc != null ||
    v.pv_power_total != null ||
    v.grid_port_power != null ||
    v.grid_power != null ||
    v.inverter_output_power != null ||
    v.battery_charging_power_grid != null ||
    v.offgrid1_export_power != null;
  if (!hasLive && !device.reportTime) return null;

  const modelMetaObj = typeof modelMeta === "function" ? modelMeta(device) : null;
  const invCap = modelMetaObj?.maxExport || 1500;
  const bypassCap = invCap >= 2500 ? 3000 : 1500; // Lyra 1500 / CBE·Atlas 3000

  const soc = _ownerNum(v.current_soc ?? v.main_soc, NaN);
  const back = _ownerNum(v.backup_soc ?? v.backup_reserve, 20);
  const pv = Math.max(0, _ownerNum(v.pv_power_total, 0));
  const bypass = _ownerNum(v.offgrid1_export_power ?? v.battery_charging_power_grid, 0);
  const batChg = _ownerNum(v.bat_max_chg_w ?? v.battery_max_charge_power, invCap);
  const batDchg = _ownerNum(v.bat_max_dchg_w ?? v.battery_max_discharge_power, invCap);
  const outLim = _ownerNum(v.output_power_limit || v.regulation_grid_export_p_limit, invCap) || invCap;
  const gridLim = _ownerNum(v.inverter_input_power_limit, invCap) || invCap;
  const invLim = invCap;
  const pvVolt = _ownerNum(v.pv_volt_max ?? v.pv1_voltage, 0);
  const invFault = _ownerFault(v.fault) || _ownerFault(v.error_code);

  if (!device._ownerHyst) device._ownerHyst = { forceChg: false, forceChg1: false, forceChg2: false };
  const st = device._ownerHyst;

  const inputs = {
    soc,
    back,
    pv,
    bypass,
    batChg,
    batDchg,
    outLim,
    gridLim,
    invLim,
    bypassCap,
    pvVolt,
    invFault,
  };

  const clamp = (chg, dchg) => {
    let c = Math.max(0, Math.round(chg));
    let d = Math.max(0, Math.round(dchg));
    if (c > gridLim) c = invLim < gridLim ? invLim : gridLim;
    if (d > outLim) d = invLim < outLim ? invLim : outLim;
    return [c, d];
  };
  const ret = (model, chg, dchg, reason, formula) => {
    const [c, d] = clamp(chg, dchg);
    return {
      model,
      label: OWNER_WORK_MODEL_CN[model] || `0x${model.toString(16)}`,
      chgCapW: c,
      dchgCapW: d,
      reason,
      formula,
      inputs,
    };
  };

  if (Number.isNaN(soc)) return null;

  if (invFault || (batChg === 0 && batDchg === 0)) {
    return ret(
      OWNER_WORK_MODEL.DISABLED,
      0,
      0,
      "故障或电池充放限均为 0",
      `条件：故障码 ≠ 0  或  (电池最大充=${batChg} 且 最大放=${batDchg})\n` +
        `故障判定=${invFault}\n→ 禁充禁放，上报可充=0 / 可放=0`
    );
  }

  // 4 放电：PV−Bypass ≥ B充限 且 B充限>0
  if (pv - bypass >= batChg && batChg > 0) {
    let dchg = pv - bypass - batChg;
    if (soc >= back && batChg > 100) dchg += 100;
    return ret(
      OWNER_WORK_MODEL.FORCE_DISCHARGE,
      outLim,
      Math.max(0, dchg),
      "PV−Bypass ≥ 电池最大充",
      `判定条件：PV − Bypass ≥ 电池最大充电功率  且  电池最大充电功率 > 0\n` +
        `${pv} − ${bypass} = ${pv - bypass}  ≥  ${batChg}  ✓\n` +
        `可放功率 ≈ PV − Bypass − 电池最大充` +
        (soc >= back && batChg > 100 ? ` + 100（SoC≥备用）` : ``) +
        `\n= ${Math.max(0, Math.round(dchg))}W\n可充上报 = 输出限制 ${outLim}W`
    );
  }

  // 5 弱光 / bat_chg==0
  if (pv - bypass >= batChg) {
    if (pv < 50 && pvVolt >= 200) {
      const dchg = Math.max(0, 100 - bypass - batChg);
      return ret(
        OWNER_WORK_MODEL.FORCE_DISCHARGE,
        gridLim,
        dchg,
        "弱光：PV<50 且 PV电压≥200",
        `弱光分支：电池最大充=${batChg}，PV=${pv}<50 且 PV电压=${pvVolt}≥200\n→ 放电，可放≈${dchg}W`
      );
    }
    if (pvVolt >= 220) {
      let dchg = pv - bypass - batChg;
      if (dchg < 100) dchg = 100;
      return ret(
        OWNER_WORK_MODEL.FORCE_DISCHARGE,
        gridLim,
        dchg,
        "弱光：PV电压≥220",
        `弱光分支：PV电压=${pvVolt}≥220\n可放 = max(PV−Bypass−B充, 100) = ${dchg}W`
      );
    }
    return ret(
      OWNER_WORK_MODEL.DISCHARGE_ONLY,
      gridLim,
      outLim,
      "B充限=0 且未达弱光阈值 → 可放",
      `条件：PV−Bypass ≥ 电池最大充 且 最大充=0，PV电压未达弱光阈值\n` +
        `${pv}−${bypass}=${pv - bypass} ≥ ${batChg}，pvVolt=${pvVolt}\n→ 可放（可放能力=输出限制 ${outLim}W）`
    );
  }

  // 6 充电状态1：Bypass 过大
  if (bypass > batDchg + pv || bypass > bypassCap) {
    const need = batDchg + pv > bypassCap ? bypass - bypassCap : bypass - batDchg - pv;
    return ret(
      OWNER_WORK_MODEL.LOAD_FORCE_CHARGE,
      Math.max(0, need),
      gridLim,
      "Bypass 负载过大",
      `判定条件：Bypass > 电池最大放 + PV    或    Bypass > 逆变输出上限(${bypassCap}W)\n` +
        `${bypass} > ${batDchg} + ${pv} = ${batDchg + pv}  ?  ${bypass > batDchg + pv}\n` +
        `${bypass} > ${bypassCap}  ?  ${bypass > bypassCap}\n` +
        `可充缺口 ≈ ${Math.max(0, Math.round(need))}W（须从 grid 取电）`
    );
  }

  // 7 充电状态1：SoC ≤ 备用−10
  if (soc <= back - 10 || st.forceChg1) {
    st.forceChg1 = true;
    const chg = Math.max(0, batChg - pv + bypass);
    if (soc >= back - 5) st.forceChg1 = false;
    return ret(
      OWNER_WORK_MODEL.LOAD_FORCE_CHARGE,
      chg,
      0,
      "SoC ≤ 备用−10%",
      `判定条件：当前 SoC ≤ 备用 SoC − 10%（回差：回升到 备用−5% 才退出）\n` +
        `${soc} ≤ ${back} − 10 = ${back - 10}  ✓\n` +
        `可充 = max(0, 电池最大充 − PV + Bypass) = max(0, ${batChg} − ${pv} + ${bypass}) = ${chg}W`
    );
  }

  // 8 充电状态1：SoC ≤ 5
  if (soc <= 5 || st.forceChg2) {
    st.forceChg2 = true;
    const chg = Math.max(0, batChg - pv + bypass);
    if (soc >= 10) st.forceChg2 = false;
    return ret(
      OWNER_WORK_MODEL.LOAD_FORCE_CHARGE,
      chg,
      0,
      "SoC ≤ 5%",
      `判定条件：当前 SoC ≤ 5%（回差：回升到 10% 才退出）\n` +
        `${soc} ≤ 5  ✓\n` +
        `可充 = max(0, ${batChg} − ${pv} + ${bypass}) = ${chg}W`
    );
  }

  // 9 充电状态2
  if (st.forceChg || soc <= back - 5) {
    st.forceChg = true;
    const chg = Math.max(0, batChg + bypass - pv);
    if (soc >= back) st.forceChg = false;
    return ret(
      OWNER_WORK_MODEL.FORCE_CHARGE,
      chg,
      1000,
      "SoC ≤ 备用−5%",
      `判定条件：当前 SoC ≤ 备用 SoC − 5%（回差：回升到 备用 SoC 才退出）\n` +
        `${soc} ≤ ${back} − 5 = ${back - 5}  ✓\n` +
        `可充 = max(0, 电池最大充 + Bypass − PV) = max(0, ${batChg} + ${bypass} − ${pv}) = ${chg}W\n` +
        `可放上报写死 1000W（固件原样）`
    );
  }

  // 10 可放
  if (batChg === 0 && batDchg + pv - bypass > 0) {
    const dchg = batDchg + pv - bypass;
    return ret(
      OWNER_WORK_MODEL.DISCHARGE_ONLY,
      0,
      dchg,
      "仅可放",
      `判定条件：电池最大充 = 0  且  电池最大放 + PV − Bypass > 0\n` +
        `batChg=${batChg}，${batDchg} + ${pv} − ${bypass} = ${dchg} > 0\n→ 可放 ${dchg}W`
    );
  }

  // 11 可充
  if ((batDchg + pv - bypass <= 0 && batChg > 0) || soc <= back) {
    const condA = batDchg + pv - bypass <= 0 && batChg > 0;
    const condB = soc <= back;
    return ret(
      OWNER_WORK_MODEL.CHARGE_ONLY,
      gridLim,
      0,
      condB ? "当前 SoC ≤ 备用 SoC" : "放余量≤0 且可充",
      `判定条件（满足其一即可）：\n` +
        `① 电池最大放 + PV − Bypass ≤ 0  且  电池最大充 > 0\n` +
        `   ${batDchg} + ${pv} − ${bypass} = ${batDchg + pv - bypass} ≤ 0 ? ${batDchg + pv - bypass <= 0}；batChg=${batChg}\n` +
        `② 当前 SoC ≤ 备用 SoC\n` +
        `   ${soc} ≤ ${back} ? ${condB}\n` +
        `命中：${condA ? "①" : ""}${condA && condB ? " + " : ""}${condB ? "②" : ""}\n` +
        `→ 可充，上报可充能力 = 并网口充电限 ${gridLim}W，可放 = 0`
    );
  }

  // 12 可充可放
  if (back < soc && soc < 100) {
    return ret(
      OWNER_WORK_MODEL.BIDIRECTIONAL,
      gridLim,
      outLim,
      "备用 < SoC < 100%",
      `判定条件：备用 SoC < 当前 SoC < 100%\n` +
        `${back} < ${soc} < 100  ✓\n` +
        `→ 可充可放：可充=${gridLim}W，可放=${outLim}W`
    );
  }

  // 13 兜底
  return ret(
    OWNER_WORK_MODEL.DISABLED,
    gridLim,
    outLim,
    "兜底（含 SoC=100%）",
    `以上条件均未命中（常见：SoC=100%，文档注明 100%→95% 回差未实现）\n` +
      `SoC=${soc}，备用=${back}\n→ 禁充禁放（上报并网口限值：充${gridLim}/放${outLim}，非 0）`
  );
}

function openOwnerStrategyDialog(home, device) {
  const dlg = document.getElementById("dlgOwnerStrat");
  if (!dlg || !device) return;
  const owner = classifyOwnerWorkModel(device);
  const title = document.getElementById("dlgOwnerStratTitle");
  const body = document.getElementById("dlgOwnerStratBody");
  const escFn = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s ?? "");
  title.textContent = `上报策略 · ${device.name || device.deviceId}`;
  if (!owner) {
    body.innerHTML = `<p class="hint">尚未读到足够实时量，无法判定。请先「一键读取」。</p>`;
  } else {
    const inp = owner.inputs || {};
    body.innerHTML = `
      <div class="owner-dlg-head">
        <span class="u3-role owner m${owner.model}">${escFn(owner.label)}</span>
        <span class="hint">可充 ${owner.chgCapW}W · 可放 ${owner.dchgCapW}W</span>
      </div>
      <p class="hint" style="margin:8px 0 4px">命中原因：${escFn(owner.reason)}</p>
      <pre class="owner-formula">${escFn(owner.formula || "")}</pre>
      <div class="owner-inputs">
        <div><b>代入量</b></div>
        <div>SoC ${inp.soc}% · 备用 ${inp.back}%</div>
        <div>PV ${inp.pv}W · Bypass ${inp.bypass}W</div>
        <div>电池最大充 ${inp.batChg}W · 最大放 ${inp.batDchg}W</div>
        <div>并网充限 ${inp.gridLim}W · 输出限 ${inp.outLim}W · 逆变上限 ${inp.bypassCap}W</div>
      </div>
      <p class="hint" style="margin-top:10px">依据：飞书《从机状态判》· owner_infomation_package（grid 口能力上报主机）</p>`;
  }
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

/* ---------- DP98 command_receive：实际工况解析 / 编号匹配 ---------- */

function _rawToBytes(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw)) return Uint8Array.from(raw.map((x) => Number(x) & 0xff));
  if (typeof raw === "object") {
    if (raw.data != null) return _rawToBytes(raw.data);
    if (raw.value != null) return _rawToBytes(raw.value);
    if (raw.dpValue != null) return _rawToBytes(raw.dpValue);
  }
  const s = String(raw).trim().replace(/^"|"$/g, "");
  if (!s) return null;

  const fromB64 = (text) => {
    try {
      const bin = atob(text);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (_) {
      return null;
    }
  };
  const looksDp98 = (out) =>
    !!out &&
    out.length >= 8 &&
    ((out[0] === 0x01 && out[1] === 0x03 && out[2] === 0x01) ||
      (out[0] === 0x03 && out[1] === 0x01) ||
      (out[0] === 0x01 && out[1] === 0x01 && out[2] === 0x80));

  // 云端影子 DP98 几乎总是 base64（如 AQMBAQ…）
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && /[A-Za-z]/.test(s)) {
    const compact = s.replace(/\s+/g, "");
    const pad = compact + "=".repeat((4 - (compact.length % 4)) % 4);
    const out = fromB64(pad);
    if (looksDp98(out)) return out;
  }

  const hex = s.replace(/[\s,]/g, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    if (looksDp98(out) || out.length >= 8) return out;
  }

  const loose = fromB64(s.replace(/\s+/g, ""));
  return looksDp98(loose) ? loose : loose;
}

function _asI16(u16) {
  const n = Number(u16) & 0xffff;
  return n > 32767 ? n - 65536 : n;
}

/**
 * 解析 DP98 / command_receive raw。
 * 格式：fnlFlag + 03 01 + 重复(01 01 addr_be val_be)；地址自 0x8000 起每台 7 个寄存器。
 * @returns {{ fnlFlag: number|null, units: Array<object> }|null}
 */
function parseDp98CommandReceive(raw) {
  const bytes = _rawToBytes(raw);
  if (!bytes || bytes.length < 8) return null;
  let i = 0;
  let fnlFlag = null;
  if (bytes[1] === 0x03 && bytes[2] === 0x01) {
    fnlFlag = bytes[0];
    i = 3;
  } else if (bytes[0] === 0x03 && bytes[1] === 0x01) {
    i = 2;
  }
  const byAddr = new Map();
  while (i + 5 < bytes.length) {
    if (bytes[i] === 0x01 && bytes[i + 1] === 0x01) {
      const addr = ((bytes[i + 2] << 8) | bytes[i + 3]) & 0xffff;
      const val = ((bytes[i + 4] << 8) | bytes[i + 5]) & 0xffff;
      byAddr.set(addr, val);
      i += 6;
      continue;
    }
    i += 1;
  }
  if (!byAddr.size) return null;
  const bucket = new Map();
  for (const [addr, val] of byAddr) {
    if (addr < 0x8000) continue;
    const off = addr - 0x8000;
    const idx = Math.floor(off / 7);
    const field = off % 7;
    if (!bucket.has(idx)) bucket.set(idx, {});
    bucket.get(idx)[`f${field}`] = val;
  }
  const units = [...bucket.keys()]
    .sort((a, b) => a - b)
    .map((idx) => {
      const u = bucket.get(idx) || {};
      const model = Number(u.f1 || 0) & 0xff;
      return {
        numer: Number(u.f0 || 0) & 0xff,
        workModel: model,
        label: OWNER_WORK_MODEL_CN[model] || `0x${model.toString(16)}`,
        chgCapW: Math.max(0, _asI16(u.f2 || 0)),
        dchgCapW: Math.max(0, _asI16(u.f3 || 0)),
        pvW: Math.max(0, Number(u.f4 || 0) & 0xffff),
        cmdPowerW: Math.max(0, Number(u.f5 || 0) & 0xffff),
        order: Number(u.f6 || 0) & 0xff,
      };
    });
  return { fnlFlag, units };
}

function dp98UnitToActual(unit, extra = {}) {
  if (!unit) return null;
  return {
    model: unit.workModel,
    label: unit.label,
    chgCapW: unit.chgCapW,
    dchgCapW: unit.dchgCapW,
    pvW: unit.pvW,
    cmdPowerW: unit.cmdPowerW,
    order: unit.order,
    numer: unit.numer,
    source: extra.source || "dp98",
    fromMaster: !!extra.fromMaster,
  };
}

/**
 * 集群内：DP98 编号 → 设备。
 * 0x0A → 主机(role=0)；1..N → 同集群从机，按 deviceId 稳定排序。
 */
function mapDp98NumerToDevice(members, numer) {
  const n = Number(numer) & 0xff;
  const list = members || [];
  const master = list.find((d) => Number(d?.values?.device_cluster_role) === 0) || null;
  const slaves = list
    .filter((d) => d && d !== master && Number(d.values?.device_cluster_role) === 1)
    .slice()
    .sort((a, b) => String(a.deviceId || "").localeCompare(String(b.deviceId || ""), "en"));
  if (n === DP98_MASTER_NUMER) return master;
  if (n >= 1 && n <= slaves.length) return slaves[n - 1];
  return null;
}

/**
 * 用主机 DP98 给集群成员打实际状态；无主机报文时回退各机自己的 DP98。
 */
function applyDp98ActualForHome(home) {
  if (!home) return;
  const devices = home.devices || [];
  for (const d of devices) d.ownerActual = null;

  const grouped =
    typeof groupDevicesByCluster === "function"
      ? groupDevicesByCluster(devices)
      : { clusters: [], solos: devices };

  const applyOwn = (d) => {
    const parsed = parseDp98CommandReceive(d.values?.command_receive);
    if (!parsed?.units?.length) return;
    // 从机自报文通常只有一组且编号=1；单机也可能是 0x0A/1
    const unit =
      parsed.units.find((u) => u.numer === DP98_MASTER_NUMER) ||
      parsed.units.find((u) => u.numer === 1) ||
      parsed.units[0];
    d.ownerActual = dp98UnitToActual(unit, { fromMaster: false, source: "dp98-self" });
  };

  for (const cluster of grouped.clusters || []) {
    const members = cluster.devices || [];
    const master = members.find((d) => Number(d?.values?.device_cluster_role) === 0);
    const parsed = parseDp98CommandReceive(master?.values?.command_receive);
    if (parsed?.units?.length) {
      for (const unit of parsed.units) {
        const target = mapDp98NumerToDevice(members, unit.numer);
        if (!target) continue;
        target.ownerActual = dp98UnitToActual(unit, { fromMaster: true, source: "dp98-master" });
      }
      // 未匹配到的成员再试本机报文
      for (const d of members) {
        if (!d.ownerActual) applyOwn(d);
      }
      continue;
    }
    for (const d of members) applyOwn(d);
  }

  for (const d of grouped.solos || []) applyOwn(d);
}

/** 一体机「更多点位」对照表（dpid / dpcode / 物模型 code） */
const DEVICE_MORE_POINTS = [
  { dpId: "51", dpCode: "work_mode", modelCode: "work_mode", unit: "", valueKeys: ["work_mode"] },
  {
    dpId: "52",
    dpCode: "function_set",
    modelCode: "home_max_current",
    unit: "A",
    valueKeys: ["home_max_current"],
  },
  {
    dpId: "52",
    dpCode: "function_set",
    modelCode: "home_allowed_backflow_power",
    unit: "W",
    valueKeys: ["home_allowed_backflow_power"],
  },
  {
    dpId: "52",
    dpCode: "function_set",
    modelCode: "total_plug_power",
    unit: "W",
    valueKeys: ["total_plug_power"],
  },
  {
    dpId: "52",
    dpCode: "function_set",
    modelCode: "device_cluster_role",
    unit: "",
    valueKeys: ["device_cluster_role"],
  },
  {
    dpId: "52",
    dpCode: "function_set",
    modelCode: "device_cluster_node_id",
    unit: "",
    valueKeys: ["device_cluster_node_id"],
  },
  { dpId: "91", dpCode: "base_load", modelCode: "base_load", unit: "W", valueKeys: ["base_load"] },
  {
    dpId: "20",
    dpCode: "pv_power_total",
    modelCode: "total_photovoltaic_power",
    unit: "W",
    valueKeys: ["pv_power_total", "total_photovoltaic_power"],
  },
  {
    dpId: "25",
    dpCode: "battery_power",
    modelCode: "total_stack_power",
    unit: "W",
    valueKeys: ["battery_power", "total_stack_power"],
  },
  {
    dpId: "27",
    dpCode: "inverter_output_power",
    modelCode: "grid_port_power",
    unit: "W",
    valueKeys: ["grid_port_power", "inverter_output_power"],
  },
  {
    dpId: "26",
    dpCode: "grid_power",
    modelCode: "meter_power",
    unit: "W",
    valueKeys: ["meter_power", "grid_power"],
  },
  {
    dpId: "23",
    dpCode: "current_soc",
    modelCode: "heap_soc",
    unit: "%",
    valueKeys: ["current_soc", "main_soc", "heap_soc"],
  },
  {
    dpId: "38",
    dpCode: "offgrid1_export_power",
    modelCode: "battery_charging_power_grid",
    unit: "W",
    valueKeys: ["offgrid1_export_power", "battery_charging_power_grid"],
  },
  {
    dpId: "50",
    dpCode: "backup_reserve",
    modelCode: "min_soc_discharge",
    unit: "%",
    valueKeys: ["backup_soc", "backup_reserve", "min_soc_discharge"],
  },
  {
    dpId: "84",
    dpCode: "regulation_grid_export_p_limit",
    modelCode: "regulation_grid_export_p_limit",
    unit: "W",
    valueKeys: ["regulation_grid_export_p_limit"],
  },
  {
    dpId: "53",
    dpCode: "output_power_limit",
    modelCode: "output_power_limit",
    unit: "W",
    valueKeys: ["output_power_limit"],
  },
  {
    dpId: "69",
    dpCode: "inverter_input_power_limit",
    modelCode: "inverter_input_power_limit",
    unit: "W",
    valueKeys: ["inverter_input_power_limit"],
  },
];

function lookupDevicePointValue(device, point) {
  const values = device?.values || {};
  for (const key of point.valueKeys || [point.modelCode, point.dpCode]) {
    if (values[key] != null && values[key] !== "") return values[key];
  }
  return null;
}

function formatPointValue(raw, point) {
  if (raw == null || raw === "") return "—";
  if (point.modelCode === "device_cluster_role") {
    const role = clusterRoleLabel(raw);
    return role ? `${role} (${raw})` : String(raw);
  }
  if (point.dpCode === "work_mode" || point.modelCode === "work_mode") {
    const field = HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode");
    const hit = (field?.options || []).find((o) => String(o.value) === String(raw));
    return hit ? `${hit.label} (${raw})` : String(raw);
  }
  if (typeof raw === "number" || isFiniteNumber(raw)) {
    const n = Number(raw);
    return point.unit ? `${n}${point.unit}` : String(n);
  }
  return String(raw);
}

function openDevicePointsDialog(home, device) {
  if (!device) return;
  const title = document.getElementById("dlgDevicePointsTitle");
  const hint = document.getElementById("dlgDevicePointsHint");
  const tbody = document.querySelector("#devicePointsTable tbody");
  title.textContent = `点位详情 · ${device.name || device.deviceId}`;
  hint.textContent = `设备 ID ${device.deviceId}${
    device.reportTime ? ` · 上报 ${fmtTime(device.reportTime)}` : " · 尚未读取"
  }`;
  tbody.innerHTML = DEVICE_MORE_POINTS.map((p) => {
    const raw = lookupDevicePointValue(device, p);
    const inSchema = !!(device.schema && (device.schema[p.dpCode] || device.schema[p.modelCode]));
    const missing = Object.keys(device.schema || {}).length > 0 && !inSchema && p.dpCode !== "function_set";
    // function_set 子项：只要有对应 model 值或 schema 有 function_set 就算有
    const fsMissing =
      p.dpCode === "function_set" &&
      Object.keys(device.schema || {}).length > 0 &&
      !device.schema.function_set &&
      raw == null;
    const rowMissing = missing || fsMissing;
    return `<tr class="${rowMissing ? "point-missing" : ""}">
      <td>${escapeHtml(p.dpId)}</td>
      <td><code>${escapeHtml(p.dpCode)}</code></td>
      <td><code>${escapeHtml(p.modelCode)}</code></td>
      <td class="point-val">${escapeHtml(formatPointValue(raw, p))}</td>
    </tr>`;
  }).join("");
  document.getElementById("dlgDevicePoints").showModal();
}

/** Normalize register address for protocol-model strategySpecString (hex digits, no 0x). */
function normalizeRegAddrInput(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(s)) return "";
  return s.toLowerCase().replace(/^0+(?=[0-9a-f])/, "") || "0";
}

let regQueryCtx = null; // { home, device, protocol }

/**
 * Step1: protocol/query → energyModelType / protocolCode / protocolPlan
 */
async function fetchDeviceProtocolInfo(home, device) {
  const res = await apiGet("/api/proxy/protocol-query", home, { deviceId: device.deviceId });
  const data = unwrapResult(res);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("protocol/query 无数据");
  }
  const energyModelType = row.energyModelType || row.modelType || "";
  const protocolCode = row.protocolCode != null ? String(row.protocolCode) : "";
  const protocolPlan = row.protocolPlan != null ? String(row.protocolPlan) : "";
  if (!energyModelType || protocolCode === "") {
    throw new Error("缺少 energyModelType / protocolCode");
  }
  const protocol = { energyModelType, protocolCode, protocolPlan };
  device.protocol = { ...(device.protocol || {}), ...protocol };
  return protocol;
}

/**
 * Step2: protocol-model page by register → code
 */
async function lookupCodeByRegister(home, protocol, regHex) {
  const res = await apiGet("/api/proxy/protocol-model-page", home, {
    energyModelType: protocol.energyModelType,
    protocolCode: protocol.protocolCode,
    sortType: "",
    page: "1",
    strategySpecString: regHex,
    perPage: "10",
  });
  const data = unwrapResult(res);
  const list = Array.isArray(data)
    ? data
    : data?.list || data?.records || data?.items || data?.rows || [];
  if (!list.length) {
    throw new Error(`未找到寄存器 ${regHex} 对应物模型`);
  }
  // Prefer exact register match when multiple hits
  const want = regHex.toLowerCase();
  const exact = list.find((it) => {
    const addr = parseRegAddr(it?.model?.strategySpec || it?.strategySpec);
    if (addr == null) return false;
    return addr.toString(16).toLowerCase() === want;
  });
  const hit = exact || list[0];
  const code = hit.code || hit.modelCode || hit?.model?.code;
  if (!code) throw new Error("反查结果无 code");
  return { code: String(code), hit, list };
}

/**
 * Step3: property/query by code → value
 */
async function fetchPropertyByCode(home, device, code) {
  const res = await apiGet("/api/proxy/property-query", home, {
    page: "1",
    deviceId: device.deviceId,
    code,
  });
  const data = unwrapResult(res);
  const items = Array.isArray(data) ? data : data?.data || data?.items || data?.list || [];
  const hit =
    (Array.isArray(items) && items.find((it) => (it.code || it.dpCode) === code)) ||
    (Array.isArray(items) && items[0]) ||
    null;
  return { items: Array.isArray(items) ? items : [], hit };
}

function renderRegQueryMeta(protocol, errText) {
  const el = document.getElementById("regQueryMeta");
  if (!el) return;
  if (errText) {
    el.innerHTML = `<span style="color:#b91c1c">${escapeHtml(errText)}</span>`;
    return;
  }
  if (!protocol) {
    el.textContent = "加载协议信息…";
    return;
  }
  el.innerHTML = `
    <div><b>energyModelType</b> · <code>${escapeHtml(protocol.energyModelType)}</code></div>
    <div><b>protocolCode</b> · <code>${escapeHtml(protocol.protocolCode)}</code></div>
    <div><b>protocolPlan</b> · <code>${escapeHtml(protocol.protocolPlan || "—")}</code></div>`;
}

async function openRegQueryDialog(home, device) {
  if (!home || !device) return;
  const dlg = document.getElementById("dlgRegQuery");
  if (!dlg) return;
  regQueryCtx = { home, device, protocol: null };
  document.getElementById("dlgRegQueryTitle").textContent = `寄存器值查询 · ${
    device.name || device.deviceId
  }`;
  document.getElementById("dlgRegQueryHint").textContent = `设备 ID ${device.deviceId}`;
  document.getElementById("regQueryAddr").value = "";
  const resultEl = document.getElementById("regQueryResult");
  resultEl.hidden = true;
  resultEl.textContent = "";
  renderRegQueryMeta(null);
  dlg.showModal();

  try {
    const protocol = await fetchDeviceProtocolInfo(home, device);
    if (regQueryCtx?.device?.uid !== device.uid) return;
    regQueryCtx.protocol = protocol;
    renderRegQueryMeta(protocol);
  } catch (err) {
    renderRegQueryMeta(null, err.message || String(err));
  }
}

async function runRegQuery() {
  const ctx = regQueryCtx;
  if (!ctx?.home || !ctx?.device) return;
  const btn = document.getElementById("btnRegQueryRun");
  const resultEl = document.getElementById("regQueryResult");
  const addrRaw = document.getElementById("regQueryAddr")?.value || "";
  const regHex = normalizeRegAddrInput(addrRaw);
  if (!regHex) {
    toast("请输入有效寄存器地址（如 4026 或 0x4026）", "error");
    return;
  }
  if (btn) btn.disabled = true;
  resultEl.hidden = false;
  resultEl.textContent = "查询中…";
  try {
    let protocol = ctx.protocol;
    if (!protocol?.energyModelType || protocol.protocolCode == null || protocol.protocolCode === "") {
      protocol = await fetchDeviceProtocolInfo(ctx.home, ctx.device);
      ctx.protocol = protocol;
      renderRegQueryMeta(protocol);
    }
    const looked = await lookupCodeByRegister(ctx.home, protocol, regHex);
    const prop = await fetchPropertyByCode(ctx.home, ctx.device, looked.code);
    const hit = prop.hit;
    const value =
      hit == null
        ? null
        : hit.valueObject ?? hit.value ?? hit.dpValue ?? hit.propertyValue ?? null;
    const lines = [
      `寄存器: 0x${regHex}`,
      `code: ${looked.code}`,
      `名称: ${hit?.name || looked.hit?.name || "—"}`,
      `值: ${value == null || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : value}`,
      `时间: ${hit?.time || hit?.reportTime || hit?.gmtModified || "—"}`,
    ];
    if (looked.list.length > 1) {
      lines.push(`(协议模型命中 ${looked.list.length} 条，已取 ${looked.code})`);
    }
    resultEl.textContent = lines.join("\n");
    toast("查询完成", "ok");
  } catch (err) {
    resultEl.textContent = `失败: ${err.message || err}`;
    toast(err.message || String(err), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * @typedef {{
 *   uid: string,
 *   homeId: string,
 *   envHost: string,
 *   name: string,
 *   authId: string,
 *   devices: Device[],
 *   lastReadAt: number|null
 * }} Home
 *
 * @typedef {{
 *   uid: string,
 *   deviceId: string,
 *   name: string,
 *   model: string,
 *   note: string,
 *   values: Record<string, string|number|null>,
 *   reportTime: number|null,
 *   lastReadAt: number|null,
 *   schema: Record<string, {dpId: string, name?: string, dpSchema?: any, dpCode?: string}>,
 *   protocol: {protocolCode?: string, protocolPlan?: string}|null,
 *   socSeries: {t:number, v:number}[],
 *   socMeta: {code:string, start:number, end:number, error?:string}|null,
 *   drafts: Record<string, string>,
 *   loading: boolean,
 *   error: string|null
 * }} Device
 */

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function emptyState() {
  return { cookies: {}, homes: [], activeHomeId: null };
}

function stateFromDump(parsed) {
  return {
    cookies: parsed.cookies || {},
    homes: (parsed.homes || []).map(normalizeHome),
    activeHomeId: parsed.activeHomeId || null,
  };
}

function loadLegacyLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return stateFromDump(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

function normalizeHome(h) {
  const devices = (h.devices || []).map(normalizeDevice);
  return {
    uid: h.uid || uid(),
    homeId: String(h.homeId || ""),
    envHost: h.envHost || "newenergy-operation-cn.tuya-inc.com",
    name: h.name || "",
    authId: h.authId || "",
    lastReadAt: null, // 仅会话内，不从 store 回显
    devices,
    meters: (h.meters || []).map((m) => normalizeMeter(m, h.envHost)),
    // 无实体电表时：电网节点取该一体机 DP26（局域网电表配对功率）
    lanMeterDeviceId: String(h.lanMeterDeviceId || "").trim(),
    // 家庭侧可下发参数：值仅会话内回显，草稿可持久
    familyValues: {},
    familyDrafts: h.familyDrafts || {},
    familyRegs: null,
    wiring: normalizeWiring(
      h.wiring,
      devices.map((d) => d.uid)
    ),
  };
}

/* ---------- Wiring topology (home buses ↔ device ports) ---------- */

const WIRING_BUS_KINDS = [
  { kind: "pv", label: "光伏 PV", short: "PV" },
  { kind: "grid", label: "电网 Grid", short: "Grid" },
  { kind: "bypass", label: "Bypass负载", short: "Bypass" },
  { kind: "family", label: "家庭负载", short: "家庭" },
];

const DEVICE_WIRING_PORTS = [
  { port: "pv", label: "PV", kinds: ["pv"] },
  { port: "grid", label: "Grid 并网口", kinds: ["grid"] },
  { port: "offgrid", label: "离网口", kinds: ["bypass", "family"] },
];

function defaultWiringBuses() {
  return WIRING_BUS_KINDS.map((k) => ({
    id: `bus_${k.kind}`,
    kind: k.kind,
    label: k.label,
    x: null,
    y: null,
  }));
}

/** New devices start unconnected — user wires in 拖拽接线 mode. */
function defaultDevicePorts(_buses) {
  return { pv: "", grid: "", offgrid: "" };
}

function busDefaultSize(kind) {
  if (kind === "grid") return { w: 140, h: 72 };
  if (kind === "family") return { w: 128, h: 56 };
  if (kind === "bypass") return { w: 120, h: 56 };
  return { w: 108, h: 56 };
}

/**
 * Parse stored bus x/y. null/undefined/"" stay unset (layout uses default).
 * Note: Number(null)===0 — must not treat null as a real coordinate.
 * Legacy bug wrote (0,0) for unset; treat that pair as unset too.
 */
function parseBusCoord(x, y) {
  const hasX = x != null && x !== "" && Number.isFinite(Number(x));
  const hasY = y != null && y !== "" && Number.isFinite(Number(y));
  if (!hasX || !hasY) return { x: null, y: null };
  const nx = Number(x);
  const ny = Number(y);
  if (nx === 0 && ny === 0) return { x: null, y: null };
  return { x: nx, y: ny };
}

/** Default terminal position by kind when user hasn't dragged it yet. */
function defaultBusPosition(kind, index, ctx) {
  const { vbW, gridTop, gridCx, loadY } = ctx;
  if (kind === "pv") return { x: 24, y: 16 + index * 66 };
  if (kind === "grid") {
    const gw = 140;
    return { x: gridCx - gw / 2 + index * (gw + 10), y: gridTop };
  }
  if (kind === "bypass") return { x: vbW - 280, y: loadY - index * 66 };
  if (kind === "family") return { x: vbW - 144, y: loadY - index * 66 };
  return { x: 24, y: 16 };
}

function normalizeWiring(raw, deviceUids = []) {
  const src = raw && typeof raw === "object" ? raw : {};
  let buses = Array.isArray(src.buses)
    ? src.buses.map((b, i) => {
        const pos = parseBusCoord(b.x, b.y);
        return {
          id: String(b.id || `bus_${i}`),
          kind: WIRING_BUS_KINDS.some((k) => k.kind === b.kind) ? b.kind : "pv",
          label: String(b.label || WIRING_BUS_KINDS.find((k) => k.kind === b.kind)?.label || b.kind),
          x: pos.x,
          y: pos.y,
        };
      })
    : [];
  if (!buses.length) buses = defaultWiringBuses();
  const devices = {};
  const srcDev = src.devices && typeof src.devices === "object" ? src.devices : {};
  for (const uid of deviceUids) {
    const key = String(uid);
    const d = srcDev[key] || {};
    const def = defaultDevicePorts(buses);
    devices[key] = {
      pv: buses.some((b) => b.id === d.pv) ? d.pv : def.pv,
      grid: buses.some((b) => b.id === d.grid) ? d.grid : def.grid,
      offgrid: buses.some((b) => b.id === d.offgrid) ? d.offgrid : def.offgrid,
    };
  }
  for (const [uid, d] of Object.entries(srcDev)) {
    if (devices[uid]) continue;
    devices[uid] = {
      pv: buses.some((b) => b.id === d.pv) ? d.pv : "",
      grid: buses.some((b) => b.id === d.grid) ? d.grid : "",
      offgrid: buses.some((b) => b.id === d.offgrid) ? d.offgrid : "",
    };
  }
  return { buses, devices };
}

/** Ensure wiring exists and covers all current devices. */
function ensureHomeWiring(home) {
  const uids = (home.devices || []).map((d) => d.uid);
  home.wiring = normalizeWiring(home.wiring, uids);
  return home.wiring;
}

function wiringBusById(home, busId) {
  if (!busId) return null;
  return (home.wiring?.buses || []).find((b) => b.id === busId) || null;
}

function deviceWiringPorts(home, device) {
  ensureHomeWiring(home);
  const w = home.wiring.devices[device.uid];
  if (w) return w;
  const def = defaultDevicePorts(home.wiring.buses);
  home.wiring.devices[device.uid] = def;
  return def;
}

function setDeviceWiringPort(home, deviceUid, port, busId) {
  ensureHomeWiring(home);
  if (!home.wiring.devices[deviceUid]) {
    home.wiring.devices[deviceUid] = { pv: "", grid: "", offgrid: "" };
  }
  const meta = DEVICE_WIRING_PORTS.find((p) => p.port === port);
  if (!meta) return false;
  if (busId) {
    const bus = wiringBusById(home, busId);
    if (!bus || !meta.kinds.includes(bus.kind)) return false;
  }
  home.wiring.devices[deviceUid][port] = busId || "";
  return true;
}

function setBusPosition(home, busId, x, y) {
  ensureHomeWiring(home);
  const bus = home.wiring.buses.find((b) => b.id === busId);
  if (!bus) return false;
  const size = busDefaultSize(bus.kind);
  // keep on canvas
  bus.x = Math.round(Math.max(0, x));
  bus.y = Math.round(Math.max(0, y));
  bus.w = size.w;
  return true;
}

function portForBusKind(kind) {
  if (kind === "pv") return "pv";
  if (kind === "grid") return "grid";
  if (kind === "bypass" || kind === "family") return "offgrid";
  return null;
}

function kindsAllowedForPort(port) {
  return DEVICE_WIRING_PORTS.find((p) => p.port === port)?.kinds || [];
}

/** Session flag: on-canvas drag wiring */
let wiringEditMode = false;

/** Auto refresh live data every 7s when enabled */
let autoRefreshEnabled = false;
let autoRefreshTimer = null;
let autoRefreshBusy = false;
const AUTO_REFRESH_MS = 7000;
const AUTO_REFRESH_KEY = "gac_auto_refresh";

try {
  autoRefreshEnabled = localStorage.getItem(AUTO_REFRESH_KEY) === "1";
} catch (_) {
  autoRefreshEnabled = false;
}

function stopAutoRefreshTimer() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

async function tickAutoRefresh() {
  if (!autoRefreshEnabled || autoRefreshBusy) return;
  if (document.hidden) return;
  if (typeof wiringEditMode !== "undefined" && wiringEditMode) return;
  if (typeof homeTab !== "undefined" && homeTab !== "live") return;
  if (!activeHome()) return;
  autoRefreshBusy = true;
  try {
    await readAllActiveHome({ quiet: true });
  } catch (err) {
    console.warn("auto refresh failed", err);
  } finally {
    autoRefreshBusy = false;
  }
}

function syncAutoRefreshTimer() {
  stopAutoRefreshTimer();
  if (autoRefreshEnabled) {
    autoRefreshTimer = setInterval(tickAutoRefresh, AUTO_REFRESH_MS);
  }
}

function toggleAutoRefresh(on) {
  autoRefreshEnabled = on == null ? !autoRefreshEnabled : !!on;
  try {
    localStorage.setItem(AUTO_REFRESH_KEY, autoRefreshEnabled ? "1" : "0");
  } catch (_) {}
  syncAutoRefreshTimer();
  render();
  toast(autoRefreshEnabled ? "已开启自动刷新（每 7 秒）" : "已关闭自动刷新", "ok");
  if (autoRefreshEnabled) tickAutoRefresh();
}

/** High-frequency report enable: issue now, then every 1 minute while on */
let highFreqEnabled = false;
let highFreqTimer = null;
let highFreqBusy = false;
const HIGH_FREQ_MS = 60 * 1000;
const HIGH_FREQ_KEY = "gac_high_freq";

try {
  highFreqEnabled = localStorage.getItem(HIGH_FREQ_KEY) === "1";
} catch (_) {
  highFreqEnabled = false;
}

function stopHighFreqTimer() {
  if (highFreqTimer) {
    clearInterval(highFreqTimer);
    highFreqTimer = null;
  }
}

function syncHighFreqTimer() {
  stopHighFreqTimer();
  if (highFreqEnabled) {
    highFreqTimer = setInterval(() => {
      issueHighFrequencyOnce({ quiet: true, skipConfirm: true });
    }, HIGH_FREQ_MS);
  }
}

/**
 * Custom confirm — avoids browser chrome like "127.0.0.1:5178 显示".
 * @returns {Promise<boolean>}
 */
function appConfirm(message, opts = {}) {
  const dlg = document.getElementById("dlgAppConfirm");
  const titleEl = document.getElementById("appConfirmTitle");
  const msgEl = document.getElementById("appConfirmMsg");
  const okBtn = document.getElementById("btnAppConfirmOk");
  const cancelBtn = document.getElementById("btnAppConfirmCancel");
  if (!dlg || !msgEl || !okBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message));
  }
  if (titleEl) titleEl.textContent = opts.title || "确认";
  msgEl.textContent = message;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onDlgCancel);
      if (dlg.open) dlg.close();
      resolve(ok);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onDlgCancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onDlgCancel);
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  });
}

function coerceHighFreqIssueValue(value, dpSchema) {
  const t = String(dpSchema?.type || "").toLowerCase();
  if (t === "bool" || t === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  if (t === "value" || t === "number" || t === "integer") {
    const n = Number(value);
    if (!Number.isNaN(n)) return toIssueRaw(n, dpSchema);
  }
  return value;
}

/**
 * Query issueDeviceList and concurrent-issue via /api/proxy/issue.
 * @param {{quiet?: boolean, skipConfirm?: boolean}} opts
 * @returns {Promise<boolean>}
 */
async function issueHighFrequencyOnce(opts = {}) {
  const quiet = !!opts.quiet;
  const skipConfirm = !!opts.skipConfirm;
  const home = activeHome();
  if (!home) {
    if (!quiet) toast("请先选择家庭", "error");
    return false;
  }
  const groupId = String(home.homeId || "").trim();
  if (!groupId) {
    if (!quiet) toast("当前家庭缺少家庭 ID（groupId）", "error");
    return false;
  }
  if (highFreqBusy) return false;
  highFreqBusy = true;
  try {
    const res = await apiGet("/api/proxy/high-frequency", home, { groupId });
    const raw = unwrapResult(res);
    const list = Array.isArray(raw?.issueDeviceList)
      ? raw.issueDeviceList
      : Array.isArray(raw)
        ? raw
        : [];
    const targets = list
      .map((item) => ({
        devId: String(item?.deviceId || item?.devId || "").trim(),
        dpCode: String(item?.code || item?.dpCode || "").trim(),
        value: item?.value,
      }))
      .filter((t) => t.devId && t.dpCode && t.value != null && t.value !== "");
    if (!targets.length) {
      if (!quiet) toast("未找到可高频上报的设备（issueDeviceList 为空）", "error");
      return false;
    }
    if (!skipConfirm) {
      const ok = await appConfirm(
        `将为家庭 ${groupId} 的 ${targets.length} 个设备下发高频上报使能，是否继续？`,
        { title: "开启高频上报" }
      );
      if (!ok) {
        if (!quiet) toast("已取消高频上报下发", "error");
        return false;
      }
    }

    /** @type {Map<string, Record<string, any>>} */
    const schemaByDev = new Map();
    const knownDevices = [...(home.devices || []), ...(home.meters || [])];
    for (const d of knownDevices) {
      if (d?.deviceId && d.schema && Object.keys(d.schema).length) {
        schemaByDev.set(String(d.deviceId), d.schema);
      }
    }

    async function schemaFor(devId) {
      if (schemaByDev.has(devId)) return schemaByDev.get(devId);
      const schemaRes = await apiGet("/api/proxy/pid-schema", home, { devId });
      const map = indexSchema(unwrapResult(schemaRes));
      schemaByDev.set(devId, map);
      return map;
    }

    const uniqueIds = [...new Set(targets.map((t) => t.devId))];
    await Promise.all(uniqueIds.map((id) => schemaFor(id)));

    const results = await Promise.all(
      targets.map(async (t) => {
        try {
          const schema = await schemaFor(t.devId);
          const entry = schema?.[t.dpCode];
          if (!entry?.dpId) {
            throw new Error(`找不到 dpCode=${t.dpCode} 的 dpId`);
          }
          const dpValue = coerceHighFreqIssueValue(t.value, entry.dpSchema);
          const issueRes = await apiPost("/api/proxy/issue", home, {
            devId: t.devId,
            timestamp: null,
            propertyList: [{ dpId: String(entry.dpId), dpValue }],
          });
          const upstream = issueRes.data || {};
          const issueRaw = unwrapResult(issueRes);
          const success =
            issueRes.ok !== false &&
            upstream.success !== false &&
            (issueRaw?.success === true ||
              issueRaw?.success === undefined ||
              issueRes.status === 200);
          if (!success) {
            throw new Error(
              upstream.errorMsg || issueRaw?.message || issueRaw?.errorMsg || "下发失败"
            );
          }
          return { ok: true };
        } catch (err) {
          return { ok: false, tip: `${t.devId}/${t.dpCode}: ${err.message || err}` };
        }
      })
    );
    const okN = results.filter((r) => r.ok).length;
    const failN = results.length - okN;
    const failed = results.filter((r) => !r.ok).map((r) => r.tip);
    if (!quiet) {
      if (failN) {
        const tip = failed.slice(0, 3).join("；");
        toast(
          `高频上报：成功 ${okN} / 失败 ${failN}${tip ? `（${tip}）` : ""}`,
          okN ? "ok" : "error"
        );
      } else {
        toast(`高频上报已开启：${okN} 台下发成功，之后每 1 分钟自动再下发`, "ok");
      }
    } else if (failN) {
      console.warn("high-freq quiet issue fail", failN, failed.slice(0, 5));
    }
    return failN === 0;
  } catch (err) {
    console.warn("issueHighFrequencyOnce", err);
    if (!quiet) toast(`开启高频上报失败：${err.message || err}`, "error");
    return false;
  } finally {
    highFreqBusy = false;
  }
}

async function toggleHighFreqReporting(on) {
  const wantOn = on == null ? !highFreqEnabled : !!on;
  if (!wantOn) {
    highFreqEnabled = false;
    try {
      localStorage.setItem(HIGH_FREQ_KEY, "0");
    } catch (_) {}
    syncHighFreqTimer();
    render();
    toast("已关闭高频上报自动下发", "ok");
    return;
  }
  const ok = await issueHighFrequencyOnce({ quiet: false, skipConfirm: false });
  if (!ok) {
    highFreqEnabled = false;
    try {
      localStorage.setItem(HIGH_FREQ_KEY, "0");
    } catch (_) {}
    syncHighFreqTimer();
    render();
    return;
  }
  highFreqEnabled = true;
  try {
    localStorage.setItem(HIGH_FREQ_KEY, "1");
  } catch (_) {}
  syncHighFreqTimer();
  render();
}

function toggleWiringEditMode(on) {
  wiringEditMode = on == null ? !wiringEditMode : !!on;
  render();
}

function normalizeMeter(m, homeEnvHost) {
  const hestia =
    homeEnvHost != null
      ? hestiaHostForEnv(homeEnvHost)
      : m.hestiaHost || "hestia-eu.tuya-inc.com";
  const isThirdParty = !!(m.isThirdParty || m.thirdParty);
  return {
    uid: m.uid || uid(),
    deviceId: String(m.deviceId || ""),
    name: m.name || "",
    pid: isThirdParty ? m.pid || "" : m.pid || METER_PID,
    isThirdParty,
    hestiaHost: hestia,
    deviceInfo: null,
    powerSeries: [],
    powerMeta: null,
    lastValue: null,
    lastReadAt: null,
    loading: false,
    error: null,
  };
}

function normalizeDevice(d) {
  return {
    uid: d.uid || uid(),
    deviceId: String(d.deviceId || ""),
    name: d.name || "",
    pid: d.pid || "",
    model: d.model || "",
    note: d.note || "",
    // 运行数值不从 store 回显，只能接口读取后展示
    values: {},
    reportTime: null,
    lastReadAt: null, // 仅会话内：本机最近一次成功读取
    schema: d.schema || {},
    protocol: d.protocol || null,
    socSeries: [],
    socMeta: null,
    drafts: d.drafts || {},
    loading: false,
    error: null,
  };
}

function buildStoreDump() {
  return {
    cookies: state.cookies,
    homes: state.homes.map((h) => ({
      uid: h.uid,
      homeId: h.homeId,
      envHost: h.envHost,
      name: h.name,
      authId: h.authId,
      devices: h.devices.map((d) => ({
        uid: d.uid,
        deviceId: d.deviceId,
        name: d.name,
        pid: d.pid,
        model: d.model,
        note: d.note,
        schema: d.schema,
        protocol: d.protocol,
        drafts: d.drafts,
      })),
      meters: (h.meters || []).map((m) => ({
        uid: m.uid,
        deviceId: m.deviceId,
        name: m.name,
        pid: m.pid,
        isThirdParty: !!m.isThirdParty,
        hestiaHost: m.hestiaHost,
      })),
      lanMeterDeviceId: h.lanMeterDeviceId || "",
      familyDrafts: h.familyDrafts || {},
      wiring: ensureHomeWiring(h),
    })),
    activeHomeId: state.activeHomeId,
  };
}

function persist(immediate = false) {
  const dump = buildStoreDump();
  // keep a local backup for offline recovery / migration
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dump));
  } catch (_) {}

  const flush = async () => {
    try {
      const res = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: dump }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "保存失败");
      if (json.path) storePath = json.path;
    } catch (err) {
      console.error("persist store failed", err);
      toast(`保存到本地文件失败: ${err.message || err}`, "error");
    }
  };

  if (immediate) {
    clearTimeout(persistTimer);
    return flush();
  }
  clearTimeout(persistTimer);
  persistTimer = setTimeout(flush, 300);
}

async function loadStoreFromServer() {
  const res = await fetch("/api/store");
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "读取失败");
  storePath = json.path || "";
  const store = json.store || emptyState();
  const hasData =
    (store.homes && store.homes.length) ||
    (store.cookies && Object.keys(store.cookies).length);
  if (hasData) {
    return stateFromDump(store);
  }
  // migrate once from legacy localStorage
  const legacy = loadLegacyLocalStorage();
  if (legacy && (legacy.homes.length || Object.keys(legacy.cookies).length)) {
    state = legacy;
    await persist(true);
    return legacy;
  }
  return emptyState();
}

function envLabel(host) {
  const e = ENV_CONFIG[host] || HESTIA_ENVS[host];
  if (!e) return host;
  return e.name;
}

function envShort(host) {
  const e = ENV_CONFIG[host] || HESTIA_ENVS[host];
  return e ? e.short : host;
}

/** Map home ops env → matching Hestia host (same region, prod/pre aligned). */
function hestiaHostForEnv(envHost) {
  const meta = ENV_CONFIG[envHost];
  const region = meta?.region;
  if (!region || region === "local") {
    return "hestia-cn.tuya-inc.com";
  }
  const isPre = String(envHost).includes("wgine");
  const candidates = Object.entries(HESTIA_ENVS).filter(([, m]) => m.region === region);
  if (!candidates.length) return "hestia-eu.tuya-inc.com";
  const prefer = candidates.find(([h]) =>
    isPre ? h.includes("wgine") : h.includes("tuya-inc.com") && !h.includes("wgine")
  );
  return (prefer || candidates[0])[0];
}

function hestiaHostForHome(home) {
  return hestiaHostForEnv(home?.envHost);
}

function homeDisplayName(home) {
  if (home.name) return home.name;
  return `${envLabel(home.envHost)} / ${home.homeId}`;
}

function modelByPid(pid) {
  if (!pid) return null;
  return DEVICE_MODELS.find((m) => (m.pids || []).includes(String(pid))) || null;
}

function modelMeta(deviceOrModelId) {
  if (deviceOrModelId && typeof deviceOrModelId === "object") {
    const byPid = modelByPid(deviceOrModelId.pid);
    if (byPid) return byPid;
    if (deviceOrModelId.model) {
      return DEVICE_MODELS.find((m) => m.id === deviceOrModelId.model) || UNKNOWN_MODEL;
    }
    return UNKNOWN_MODEL;
  }
  return DEVICE_MODELS.find((m) => m.id === deviceOrModelId) || UNKNOWN_MODEL;
}

function applyPidModel(device, pid) {
  const p = String(pid || "").trim();
  device.pid = p;
  const matched = modelByPid(p);
  if (matched) {
    device.model = matched.id;
  } else if (p) {
    device.model = "";
  }
  return matched;
}

function activeHome() {
  return state.homes.find((h) => h.uid === state.activeHomeId) || null;
}

function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

/**
 * Copy text to clipboard. Works on http://IP (non-secure) via execCommand fallback.
 * navigator.clipboard requires secure context (https / localhost).
 */
async function copyText(text) {
  const value = String(text ?? "");
  if (!value) throw new Error("内容为空");
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_) {
      /* fall through to legacy path */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    ta.remove();
  }
  if (!ok) throw new Error("浏览器禁止复制");
}

function fmtNum(v, unit) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return `${v}${unit || ""}`;
  return `${n}${unit || ""}`;
}

function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

function relativeTime(ms) {
  if (!ms) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  return `${Math.floor(sec / 86400)}天前`;
}

function countDrafts(device) {
  let n = DP_EDITABLE.filter((f) => {
    if (!resolveSchemaEntry(device.schema || {}, f)) return false;
    const v = (device.drafts[f.code] || "").trim();
    if (v === "") return false;
    const cur = device.values[f.code];
    // same as current echo — not a pending change
    if (cur != null && String(cur) === v) return false;
    return true;
  }).length;
  const wm = (device.drafts?.work_mode || "").trim();
  if (wm !== "" && String(device.values?.work_mode ?? "") !== wm) n += 1;
  return n;
}

const FAMILY_RAIL_FOLD_KEY = "gac.familyRailFold";

function loadFamilyRailFold() {
  try {
    const raw = localStorage.getItem(FAMILY_RAIL_FOLD_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch (_) {
    return {};
  }
}

function saveFamilyRailFold(next) {
  try {
    localStorage.setItem(FAMILY_RAIL_FOLD_KEY, JSON.stringify(next || {}));
  } catch (_) {
    /* ignore quota */
  }
}

function countFamilyDrafts(home) {
  const drafts = home.familyDrafts || {};
  const values = home.familyValues || {};
  return HOME_FAMILY_FIELDS.filter((f) => {
    const v = (drafts[f.code] || "").trim();
    if (v === "") return false;
    const cur = values[f.code];
    if (cur != null && String(cur) === v) return false;
    return true;
  }).length;
}

function countHomeDrafts(home) {
  return countFamilyDrafts(home) + home.devices.reduce((n, d) => n + countDrafts(d), 0);
}

/** Clear all pending issue drafts on the active home (family + devices). */
function clearHomeDrafts(home) {
  if (!home) return 0;
  const before = countHomeDrafts(home);
  home.familyDrafts = {};
  for (const d of home.devices || []) {
    d.drafts = {};
  }
  return before;
}

/** Pack function_set raw: 03 01 + repeated (01 01 addr_be val_be). */
function packFunctionSetRaw(entries) {
  const bytes = [0x03, 0x01];
  for (const e of entries) {
    const addr = Number(e.addr) & 0xffff;
    let val = Number(e.value) || 0;
    if (e.signed) {
      if (val > 32767) val = 32767;
      if (val < -32768) val = -32768;
      if (val < 0) val = (val + 0x10000) & 0xffff;
    } else {
      val = Math.max(0, Math.min(0xffff, Math.round(val))) & 0xffff;
    }
    bytes.push(0x01, 0x01, (addr >> 8) & 0xff, addr & 0xff, (val >> 8) & 0xff, val & 0xff);
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function parseRegAddr(spec) {
  if (!spec) return null;
  const raw = spec.registerAddr || (Array.isArray(spec.registerAddrs) ? spec.registerAddrs[0] : null);
  if (raw == null) return null;
  const s = String(raw).replace(/^0x/i, "");
  const n = parseInt(s, 16);
  return Number.isFinite(n) ? n : null;
}

/* ---------- API ---------- */

function unwrapResult(payload) {
  const data = payload?.data ?? payload;
  if (data?.result !== undefined) return data.result;
  if (data?.data !== undefined && data.success !== undefined) return data.data;
  return data;
}

/** Upstream sometimes returns SSO login HTML when cookie expired. */
class AuthExpiredError extends Error {
  constructor(message) {
    super(message || "登录已失效");
    this.name = "AuthExpiredError";
    this.code = "AUTH_EXPIRED";
  }
}

function isAuthExpiredPayload(json) {
  const raw = json?.data?.raw;
  if (typeof raw === "string" && /<!DOCTYPE|统一登录|login-form|password登录|涂鸦统一登录/i.test(raw)) {
    return true;
  }
  const msg = String(
    json?.data?.errorMsg || json?.data?.msg || json?.data?.message || json?.error || ""
  );
  if (/未登录|登录已过期|登录失效|login expired|unauthorized|无权限|请先登录/i.test(msg)) {
    return true;
  }
  const code = json?.data?.code ?? json?.data?.errorCode;
  if (code === 401 || code === "401") return true;
  return false;
}

function assertProxyPayload(json) {
  if (isAuthExpiredPayload(json)) {
    throw new AuthExpiredError("登录已失效，正在尝试自动刷新 SSO…");
  }
  if (!json?.ok && json?.error) throw new Error(json.error);
  if (json?.data && json.data.success === false) {
    throw new Error(json.data.errorMsg || json.error || "请求失败");
  }
}

function resolveCookie(host) {
  if (state.cookies[host]) return state.cookies[host];
  // fallback: any cookie (SSO often works across hestia/ops)
  for (const v of Object.values(state.cookies)) {
    if (v && String(v).trim()) return v;
  }
  return "";
}

function hostOf(homeOrHost) {
  return typeof homeOrHost === "string" ? homeOrHost : homeOrHost.envHost;
}

/** Deduplicate concurrent auto-refresh during parallel reads. */
let ssoRefreshPromise = null;

async function refreshSsoCookieOnce(opts = {}) {
  if (!ssoRefreshPromise) {
    const notify = !!opts.notify;
    ssoRefreshPromise = refreshSsoCookie({ ...opts, force: true })
      .then((r) => {
        if (notify) toast("登录已失效，已自动刷新 SSO 并重试", "ok");
        return r;
      })
      .finally(() => {
        ssoRefreshPromise = null;
      });
  }
  return ssoRefreshPromise;
}

async function apiGet(path, homeOrHost, query = {}, _retried = false) {
  const host = hostOf(homeOrHost);
  const cookie = resolveCookie(host);
  const qs = new URLSearchParams(query).toString();
  const url = qs ? `${path}?${qs}` : path;
  const res = await fetch(url, {
    headers: {
      "X-Target-Host": host,
      "X-Cookie": cookie,
    },
  });
  const json = await res.json();
  try {
    assertProxyPayload(json);
    return json;
  } catch (err) {
    if (!_retried && err?.code === "AUTH_EXPIRED") {
      try {
        await refreshSsoCookieOnce({ quiet: true, skipRender: true, host, notify: true });
      } catch (refreshErr) {
        throw new AuthExpiredError(
          `登录已失效，自动刷新失败：${refreshErr.message || refreshErr}`
        );
      }
      return apiGet(path, homeOrHost, query, true);
    }
    if (err?.code === "AUTH_EXPIRED") {
      throw new AuthExpiredError("登录已失效，自动刷新后仍失败，请手动点「自动获取」或重新粘贴 Cookie");
    }
    throw err;
  }
}

async function apiPost(path, homeOrHost, body, _retried = false) {
  const host = hostOf(homeOrHost);
  const cookie = resolveCookie(host);
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Target-Host": host,
      "X-Cookie": cookie,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  try {
    assertProxyPayload(json);
    return json;
  } catch (err) {
    if (!_retried && err?.code === "AUTH_EXPIRED") {
      try {
        await refreshSsoCookieOnce({ quiet: true, skipRender: true, host, notify: true });
      } catch (refreshErr) {
        throw new AuthExpiredError(
          `登录已失效，自动刷新失败：${refreshErr.message || refreshErr}`
        );
      }
      return apiPost(path, homeOrHost, body, true);
    }
    if (err?.code === "AUTH_EXPIRED") {
      throw new AuthExpiredError("登录已失效，自动刷新后仍失败，请手动点「自动获取」或重新粘贴 Cookie");
    }
    throw err;
  }
}

function indexSchema(result) {
  const list =
    result?.propertyList ||
    result?.property_list ||
    result?.schemaList ||
    result?.dpList ||
    [];
  /** @type {Record<string, {dpId: string, name?: string, dpCode: string, dpSchema?: any}>} */
  const map = {};
  for (const dp of list) {
    const code = dp.dpCode || dp.code || "";
    if (!code) continue;
    const dpId = dp.dpId != null ? String(dp.dpId) : "";
    if (!dpId) continue;
    map[code] = {
      dpId,
      dpCode: code,
      name: dp.name || dp.dpName,
      dpSchema: dp.dpSchema || dp.schema || null,
    };
  }
  return map;
}

/** Resolve which schema DP backs a logical field (supports aliases). */
function resolveSchemaEntry(schemaMap, field) {
  const aliases = field.aliases || [field.code];
  for (const a of aliases) {
    if (schemaMap?.[a]) return schemaMap[a];
  }
  if (field?.fallbackDpId) {
    return {
      dpId: String(field.fallbackDpId),
      dpCode: field.dpCode || field.code,
      dpSchema: field.dpSchema || null,
    };
  }
  return null;
}

function fieldMatchHint(device, field) {
  const entry = resolveSchemaEntry(device.schema || {}, field);
  if (!entry?.dpId) return "";
  const code = entry.dpCode || field.code;
  return `${entry.dpId} · ${code}`;
}

function fieldLabelHtml(device, field) {
  const hint = fieldMatchHint(device, field);
  if (!hint) {
    return `<span class="field-name">${escapeHtml(field.label)}</span>`;
  }
  return `<span class="field-name">${escapeHtml(field.label)}</span>
    <span class="dp-hint" title="${escapeAttr(hint)}">${escapeHtml(hint)}</span>`;
}

/**
 * Convert shadow/raw DP value to card display number.
 * Power fields are normalized to W; SOC stays %.
 *
 * Tuya fixed-point: display = raw / 10^scale [in schema unit].
 * When unit is kW → convert to W (*1000). If scale==0 and |raw| is large,
 * treat as mislabeled watts (already W).
 */
function toDisplayValue(raw, dpSchema, displayUnit) {
  if (raw === null || raw === undefined || raw === "") return null;
  // raw 型（DP98 command_receive 等）：原样保留 base64/hex 字符串，勿当数字
  const schemaType = String(dpSchema?.type || "").toLowerCase();
  if (schemaType === "raw" || schemaType === "rawtype") {
    if (typeof raw === "string") return raw.trim();
    if (typeof raw === "object") {
      const inner = raw.value ?? raw.dpValue ?? raw.data ?? null;
      if (inner != null) return toDisplayValue(inner, dpSchema, displayUnit);
    }
    return raw;
  }
  let n = Number(raw);
  if (Number.isNaN(n)) return raw;
  const scale = Number(dpSchema?.scale ?? 0);
  const unit = String(dpSchema?.unit || "").toLowerCase();
  n = n / Math.pow(10, scale);
  if (displayUnit === "W") {
    if (unit === "kw" || unit === "千瓦") {
      // scale>0 → fixed-point kW (e.g. raw 142 / 10^3 = 0.142 kW = 142 W)
      if (scale > 0) {
        return Math.round(n * 1000);
      }
      // scale 0: small numbers are real kW, large are mislabeled W
      if (Math.abs(n) <= 50) {
        return Math.round(n * 1000);
      }
      return Math.round(n);
    }
    return Math.round(n);
  }
  return n;
}

function toIssueRaw(display, dpSchema) {
  let n = Number(display);
  if (Number.isNaN(n)) return display;
  const scale = Number(dpSchema?.scale ?? 0);
  const unit = String(dpSchema?.unit || "").toLowerCase();
  if (unit === "kw" || unit === "千瓦") {
    if (scale > 0 || Math.abs(n) === 0 || n / 1000 <= 50) {
      n = n / 1000; // UI W → kW
    }
  }
  return Math.round(n * Math.pow(10, scale));
}

async function readDevice(home, device, opts = {}) {
  const batch = !!opts.batch;
  device.loading = true;
  device.error = null;
  if (!batch) render();
  let ok = false;
  try {
    // Refresh only needs shadow + SOC. pid-schema only when本地尚无 schema。
    if (!Object.keys(device.schema || {}).length || !device.pid) {
      const schemaRes = await apiGet("/api/proxy/pid-schema", home, { devId: device.deviceId });
      const schemaRaw = unwrapResult(schemaRes);
      const pidFromSchema =
        schemaRaw?.pid ||
        schemaRaw?.productId ||
        schemaRaw?.product_id ||
        "";
      applyPidModel(device, pidFromSchema);
      if (pidFromSchema && !modelByPid(pidFromSchema)) {
        toast(`未识别 PID ${pidFromSchema}，输出上限未绑定`, "error");
      }
      device.schema = indexSchema(schemaRaw);
    }

    const propertyList = [];
    const fieldToDp = {};
    const fieldsToRead = [...ALL_FIELDS, ...HOME_SHADOW_FIELDS, ...DP_SHADOW_EXTRA];
    for (const field of fieldsToRead) {
      const entry = resolveSchemaEntry(device.schema, field);
      if (!entry) continue;
      fieldToDp[field.code] = entry;
      if (!propertyList.some((p) => p.dpId === entry.dpId)) {
        propertyList.push({ dpId: entry.dpId, dpCode: entry.dpCode });
      }
    }

    const values = { ...(device.values || {}) };
    for (const code of [...ALL_CODES, ...HOME_SHADOW_FIELDS.map((f) => f.code), ...DP_SHADOW_EXTRA_CODES]) {
      if (!(code in values)) values[code] = null;
    }
    let latest = device.reportTime || null;

    if (propertyList.length) {
      const shadowRes = await apiPost("/api/proxy/shadow-property", home, {
        devId: device.deviceId,
        propertyList,
      });
      const shadowList = unwrapResult(shadowRes);
      const items = Array.isArray(shadowList) ? shadowList : shadowList?.items || [];
      const byCode = {};
      const byId = {};
      for (const it of items) {
        const code = it.code || it.dpCode;
        if (code) byCode[code] = it;
        if (it.propertyId != null) byId[String(it.propertyId)] = it;
        const t = Number(it.time || it.reportTime || 0);
        if (t && (!latest || t > latest)) latest = t;
      }

      for (const field of fieldsToRead) {
        const entry = fieldToDp[field.code];
        if (!entry) continue;
        const hit =
          byId[entry.dpId] ||
          byCode[entry.dpCode] ||
          (field.aliases || []).map((a) => byCode[a]).find(Boolean);
        if (!hit) continue;
        const rawVal = hit.valueObject ?? hit.value ?? hit.dpValue;
        values[field.code] = toDisplayValue(rawVal, entry.dpSchema, field.unit);
      }
    }

    device.values = values;
    device.reportTime = latest;
    device.lastReadAt = Date.now();
    home.lastReadAt = Date.now();
    // 家庭侧 DP 字段：用本机影子回填（取首次有值）
    if (!home.familyValues) home.familyValues = {};
    for (const field of HOME_SHADOW_FIELDS) {
      if (home.familyValues[field.code] != null && home.familyValues[field.code] !== "") continue;
      if (values[field.code] != null && values[field.code] !== "") {
        home.familyValues[field.code] = values[field.code];
      }
    }
    ok = true;
    // 刷新只更新界面内存态，不把 value / SOC 写回 store
  } catch (err) {
    device.error = err.message || String(err);
    if (!batch) toast(`${device.name || device.deviceId}: ${device.error}`, "error");
  } finally {
    device.loading = false;
    if (!batch) {
      applyDp98ActualForHome(home);
      render();
    }
  }
  // 物模型补读；SOC 历史仅「历史趋势」页拉取，实时页不调 query-neko
  if (ok && !batch) {
    readDeviceHomeModelParams(home, device, { syncHome: true }).then(() => {
      applyDp98ActualForHome(home);
      render();
    });
  }
  return ok;
}

/** Fire-and-forget SOC fetch; patch chart when done without full re-render. */
function scheduleSocFetch(home, device) {
  const token = (device._socFetchToken = (device._socFetchToken || 0) + 1);
  device.socMeta = { ...(device.socMeta || {}), loading: true, error: null };
  patchDeviceSocStats(home, device);
  fetchSocSeries(home, device)
    .then(() => {
      if (device._socFetchToken !== token) return;
      if (device.socMeta) device.socMeta.loading = false;
      patchDeviceSocPanel(home, device);
    })
    .catch(() => {
      if (device._socFetchToken !== token) return;
      if (device.socMeta) device.socMeta.loading = false;
      patchDeviceSocPanel(home, device);
    });
}

function findDeviceCard(home, device) {
  if (!device?.uid) return null;
  return document.querySelector(`#flowHost .u3[data-device-uid="${CSS.escape(device.uid)}"]`) || null;
}

function findDeviceSocCard(device) {
  if (!device?.uid) return null;
  return document.querySelector(`#chartsHost .flow-soc-card[data-device-uid="${CSS.escape(device.uid)}"]`) || null;
}

function patchDeviceSocStats(home, device) {
  const card = findDeviceSocCard(device);
  if (!card) return;
  const statsEl = card.querySelector(".soc-stats");
  if (!statsEl) return;
  if (device.socMeta?.loading) {
    statsEl.innerHTML = `<span>SOC 加载中…</span>`;
    return;
  }
  if (device.socSeries?.length) {
    const last = device.socSeries[device.socSeries.length - 1];
    statsEl.innerHTML = `<span>${device.socSeries.length} 点</span>
      <span>近 ${device.socMeta?.hours || 24}h</span>
      <span>末值 ${escapeHtml(String(last.v))}%</span>`;
  } else if (device.socMeta?.error) {
    statsEl.innerHTML = `<span class="err">${escapeHtml(device.socMeta.error)}</span>`;
  } else {
    statsEl.innerHTML = `<span>暂无 SOC 历史</span>`;
  }
}

function patchDeviceSocPanel(home, device) {
  const card = findDeviceSocCard(device);
  if (!card) return;
  patchDeviceSocStats(home, device);
  const chartEl = card.querySelector("[data-soc-chart]");
  if (!chartEl) return;
  if (typeof chartEl._chartCleanup === "function") {
    chartEl._chartCleanup();
    chartEl._chartCleanup = null;
  }
  mountInteractiveChart(chartEl, device.socSeries || [], {
    unit: "%",
    emptyText: device.socMeta?.error || "暂无 SOC 历史",
    forceRange: [0, 100],
    height: 110,
  });
}

/** Load SOC history via query-neko (code=heap_soc by default). */
async function fetchSocSeries(home, device, hours = 24) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.max(1, hours) * 3600;
  const code = "heap_soc";
  device.socMeta = { code, start, end, hours, loading: true };
  try {
    const res = await apiGet("/api/proxy/query-neko", home, {
      energyDeviceId: device.deviceId,
      code,
      startTime: String(start),
      endTime: String(end),
      pageSize: "1000",
    });
    const raw = unwrapResult(res);
    const list = Array.isArray(raw) ? raw : raw?.items || raw?.list || [];
    const series = [];
    for (const it of list) {
      let t = Number(it.time ?? it.timestamp ?? it.ts);
      if (!t) continue;
      // normalize to ms
      if (t < 1e12) t *= 1000;
      const v = Number(it.value);
      if (Number.isNaN(v)) continue;
      series.push({ t, v });
    }
    series.sort((a, b) => a.t - b.t);
    device.socSeries = series;
    device.socMeta.error = null;
    device.socMeta.loading = false;
  } catch (err) {
    device.socSeries = [];
    device.socMeta.error = err.message || String(err);
    device.socMeta.loading = false;
  }
}

function buildSeriesChartSvg(series, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 110;
  const padL = 36;
  const padR = 10;
  const padT = 10;
  const padB = 18;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const emptyText = opts.emptyText || "暂无数据";
  const forceZeroMax = opts.forceZeroMax; // e.g. SOC 0-100

  if (!series.length) {
    return `<svg class="soc-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="soc-empty-text">${escapeHtml(
      emptyText
    )}</text>
    </svg>`;
  }

  const ys = series.map((p) => p.v);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (forceZeroMax) {
    yMin = 0;
    yMax = 100;
  } else {
    if (yMax === yMin) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
  }

  const t0 = series[0].t;
  const t1 = series[series.length - 1].t || t0 + 1;
  const xAt = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * innerW;
  const yAt = (v) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

  const points = series.map((p) => `${xAt(p.t).toFixed(1)},${yAt(p.v).toFixed(1)}`).join(" ");
  const areaPoints = `${padL},${padT + innerH} ${points} ${padL + innerW},${padT + innerH}`;
  const last = series[series.length - 1];

  const ticks = forceZeroMax
    ? [0, 50, 100]
    : [yMin, (yMin + yMax) / 2, yMax];
  const grid = ticks
    .map((v) => {
      const y = yAt(v);
      const label = forceZeroMax ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
      return `<line x1="${padL}" y1="${y}" x2="${padL + innerW}" y2="${y}" class="soc-grid" />
        <text x="${padL - 4}" y="${y + 3}" text-anchor="end" class="soc-axis">${label}</text>`;
    })
    .join("");

  const tLabel = (t) => {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return `<svg class="soc-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    ${grid}
    <polygon points="${areaPoints}" class="soc-area" />
    <polyline points="${points}" class="soc-line" fill="none" />
    <circle cx="${xAt(last.t)}" cy="${yAt(last.v)}" r="2.5" class="soc-dot" />
    <text x="${padL}" y="${height - 4}" class="soc-axis">${escapeHtml(tLabel(t0))}</text>
    <text x="${padL + innerW}" y="${height - 4}" text-anchor="end" class="soc-axis">${escapeHtml(
      tLabel(t1)
    )}</text>
  </svg>`;
}

function buildSocChartSvg(series) {
  return buildSeriesChartSvg(series, { emptyText: "暂无 SOC 历史", forceZeroMax: true, height: 96 });
}

function fmtHms(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Interactive power chart: tooltip, 0-axis, brush zoom, X=HH:mm:ss
 * opts.syncGroup: string — charts in same group sync zoom time-range only
 */
const chartSyncGroups = new Map(); // groupId -> Set<api>

function mountInteractiveChart(container, fullSeries, opts = {}) {
  const unit = opts.unit || "W";
  const emptyText = opts.emptyText || "暂无数据";
  const includeZero = opts.includeZero !== false;
  const forceRange = opts.forceRange || null; // e.g. [0, 100] for SOC
  const syncGroup = opts.syncGroup || null;

  if (typeof container._chartCleanup === "function") {
    container._chartCleanup();
    container._chartCleanup = null;
  }

  container.innerHTML = "";
  container.classList.add("chart-interactive");

  if (!fullSeries?.length) {
    container.innerHTML = `<div class="chart-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "chart-toolbar";
  toolbar.innerHTML = `<button type="button" class="btn btn-sm btn-ghost" data-act="reset" disabled>复位缩放</button>
    <span class="chart-hint">拖拽选区缩放 · 悬停看数值 · 缩放时间轴联动</span>`;
  const canvas = document.createElement("canvas");
  canvas.className = "chart-canvas";
  const tip = document.createElement("div");
  tip.className = "chart-tooltip hidden";
  container.append(toolbar, canvas, tip);

  const resetBtn = toolbar.querySelector('[data-act="reset"]');
  let range = null; // {t0,t1} or null = full
  let brush = null; // {x0,x1} in canvas css px while dragging
  let hoverIdx = -1;
  let syncingZoom = false;

  const seriesInRange = () => {
    if (!range) return fullSeries;
    return fullSeries.filter((p) => p.t >= range.t0 && p.t <= range.t1);
  };

  const layout = () => {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(280, container.clientWidth || 640);
    const cssH = opts.height || 110;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH, padL: 40, padR: 10, padT: 8, padB: 22 };
  };

  const draw = () => {
    const series = seriesInRange();
    const { ctx, w, h, padL, padR, padT, padB } = layout();
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    ctx.clearRect(0, 0, w, h);

    if (!series.length) {
      ctx.fillStyle = "#9aa3af";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(emptyText, w / 2, h / 2);
      return;
    }

    const ys = series.map((p) => p.v);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (forceRange) {
      yMin = forceRange[0];
      yMax = forceRange[1];
    } else {
      if (includeZero) {
        yMin = Math.min(yMin, 0);
        yMax = Math.max(yMax, 0);
      }
      if (yMax === yMin) {
        yMin -= 1;
        yMax += 1;
      }
      const pad = (yMax - yMin) * 0.08;
      yMin -= pad;
      yMax += pad;
    }

    const t0 = series[0].t;
    const t1 = series[series.length - 1].t || t0 + 1;
    const xAt = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * innerW;
    const yAt = (v) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

    const ticks = forceRange
      ? [forceRange[0], (forceRange[0] + forceRange[1]) / 2, forceRange[1]]
      : [yMin, (yMin + yMax) / 2, yMax];
    if (!forceRange && includeZero && yMin < 0 && yMax > 0) {
      ticks.push(0);
    }
    const uniqTicks = [...new Set(ticks.map((v) => Math.round(v * 10) / 10))];
    ctx.strokeStyle = "#e8edf3";
    ctx.fillStyle = "#9aa3af";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    for (const v of uniqTicks) {
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + innerW, y);
      ctx.stroke();
      ctx.fillText(String(v), padL - 6, y + 3);
    }

    if (!forceRange && includeZero && yMin < 0 && yMax > 0) {
      const y0 = yAt(0);
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y0);
      ctx.lineTo(padL + innerW, y0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.fillStyle = "#64748b";
      ctx.fillText("0", padL - 6, y0 + 3);
    }

    const yZero =
      !forceRange && includeZero && yMin < 0 && yMax > 0 ? yAt(0) : padT + innerH;
    ctx.beginPath();
    ctx.moveTo(xAt(series[0].t), yZero);
    series.forEach((p) => ctx.lineTo(xAt(p.t), yAt(p.v)));
    ctx.lineTo(xAt(series[series.length - 1].t), yZero);
    ctx.closePath();
    ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
    ctx.fill();

    ctx.beginPath();
    series.forEach((p, i) => {
      const x = xAt(p.t);
      const y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke();

    if (hoverIdx >= 0 && series[hoverIdx]) {
      const gx = xAt(series[hoverIdx].t);
      ctx.strokeStyle = "rgba(37, 99, 235, 0.35)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(gx, padT);
      ctx.lineTo(gx, padT + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      const x = xAt(p.t);
      const y = yAt(p.v);
      ctx.beginPath();
      ctx.arc(x, y, i === hoverIdx ? 3.5 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = i === hoverIdx ? "#1d4ed8" : "#2563eb";
      ctx.fill();
    }

    ctx.fillStyle = "#9aa3af";
    ctx.textAlign = "left";
    ctx.fillText(fmtHms(t0), padL, h - 6);
    ctx.textAlign = "end";
    ctx.fillText(fmtHms(t1), padL + innerW, h - 6);
    if (series.length > 2) {
      const mid = series[Math.floor(series.length / 2)];
      ctx.textAlign = "center";
      ctx.fillText(fmtHms(mid.t), padL + innerW / 2, h - 6);
    }

    if (brush) {
      const x0 = Math.min(brush.x0, brush.x1);
      const x1 = Math.max(brush.x0, brush.x1);
      ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
      ctx.fillRect(x0, padT, x1 - x0, innerH);
      ctx.strokeStyle = "rgba(37, 99, 235, 0.55)";
      ctx.strokeRect(x0, padT, x1 - x0, innerH);
    }

    canvas._chartMap = { series, xAt, yAt, t0, t1, padL, padR, padT, padB, innerW, innerH, w, h };
    resetBtn.disabled = !range;
  };

  const placeTip = (p) => {
    const m = canvas._chartMap;
    if (!m || !p) {
      tip.classList.add("hidden");
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const wrap = container.getBoundingClientRect();
    tip.textContent = `${fmtHms(p.t)}  ·  ${p.v}${unit}`;
    tip.classList.remove("hidden");
    const tx = m.xAt(p.t) + rect.left - wrap.left;
    const ty = m.yAt(p.v) + rect.top - wrap.top;
    tip.style.left = Math.min(Math.max(8, tx + 10), Math.max(8, wrap.width - 140)) + "px";
    tip.style.top = Math.max(8, ty - 28) + "px";
  };

  const applyRange = (next, fromPeer = false) => {
    range = next ? { t0: next.t0, t1: next.t1 } : null;
    hoverIdx = -1;
    tip.classList.add("hidden");
    draw();
    if (!fromPeer && syncGroup) {
      syncingZoom = true;
      for (const peer of chartSyncGroups.get(syncGroup) || []) {
        if (peer !== api) peer.setRange(next, true);
      }
      syncingZoom = false;
    }
  };

  const api = {
    setRange: (next, fromPeer) => applyRange(next, !!fromPeer),
  };

  if (syncGroup) {
    if (!chartSyncGroups.has(syncGroup)) chartSyncGroups.set(syncGroup, new Set());
    chartSyncGroups.get(syncGroup).add(api);
  }

  const cssX = (e) => {
    const rect = canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  };

  const nearestIndex = (x) => {
    const m = canvas._chartMap;
    if (!m?.series?.length) return -1;
    let best = -1;
    let bestDist = Infinity;
    m.series.forEach((p, i) => {
      const dx = Math.abs(m.xAt(p.t) - x);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    });
    return bestDist <= 24 ? best : -1;
  };

  canvas.addEventListener("mousemove", (e) => {
    const x = cssX(e);
    if (brush) {
      brush.x1 = x;
      tip.classList.add("hidden");
      draw();
      return;
    }
    const idx = nearestIndex(x);
    hoverIdx = idx;
    if (idx < 0) {
      tip.classList.add("hidden");
      draw();
      return;
    }
    const p = seriesInRange()[idx];
    draw();
    placeTip(p);
  });

  canvas.addEventListener("mouseleave", () => {
    if (brush) return;
    hoverIdx = -1;
    tip.classList.add("hidden");
    draw();
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    brush = { x0: cssX(e), x1: cssX(e) };
    tip.classList.add("hidden");
  });

  const onUp = () => {
    if (!brush || !canvas._chartMap || syncingZoom) {
      brush = null;
      return;
    }
    const m = canvas._chartMap;
    const x0 = Math.min(brush.x0, brush.x1);
    const x1 = Math.max(brush.x0, brush.x1);
    brush = null;
    if (x1 - x0 < 12) {
      draw();
      return;
    }
    const tAt = (x) => {
      const r = (x - m.padL) / (m.innerW || 1);
      return m.t0 + Math.min(1, Math.max(0, r)) * (m.t1 - m.t0);
    };
    applyRange({ t0: tAt(x0), t1: tAt(x1) }, false);
  };
  document.addEventListener("mouseup", onUp);

  resetBtn.addEventListener("click", () => {
    applyRange(null, false);
  });

  container._chartCleanup = () => {
    document.removeEventListener("mouseup", onUp);
    if (syncGroup && chartSyncGroups.has(syncGroup)) {
      chartSyncGroups.get(syncGroup).delete(api);
      if (!chartSyncGroups.get(syncGroup).size) chartSyncGroups.delete(syncGroup);
    }
  };

  draw();
  requestAnimationFrame(draw);
}

function parseBizlogPowerValue(detail) {
  if (!detail) return null;
  const m = String(detail).match(/value\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return Number(m[1]);
  const m2 = String(detail).match(/(-?\d+(?:\.\d+)?)\s*kW/i);
  if (m2) return Math.round(Number(m2[1]) * 1000);
  const m3 = String(detail).match(/(-?\d+(?:\.\d+)?)/);
  return m3 ? Number(m3[1]) : null;
}

function parseBizlogTime(eventTime) {
  // "2026-08-05 15:39:42:239"
  if (!eventTime) return null;
  const s = String(eventTime).replace(/:(\d{3})$/, ".$1");
  const t = Date.parse(s.replace(/-/g, "/"));
  return Number.isNaN(t) ? null : t;
}

function meterDpSpec(meter) {
  if (meter?.isThirdParty) {
    return { dpId: METER_THIRD_DP_ID, dpCode: METER_THIRD_DP_CODE, pid: null };
  }
  return { dpId: METER_DP_ID, dpCode: METER_DP_CODE, pid: METER_PID };
}

/**
 * 无实体电表时，电网节点所用的一体机（DP26 / grid_power / meter_power）。
 * 优先 home.lanMeterDeviceId；否则家庭内第一台。
 * @param {object} home
 * @returns {object|null}
 */
function resolveLanMeterDevice(home) {
  const devices = home?.devices || [];
  if (!devices.length) return null;
  const want = String(home.lanMeterDeviceId || "").trim();
  if (want) {
    const hit = devices.find((d) => String(d.deviceId) === want);
    if (hit) return hit;
  }
  return devices[0] || null;
}

/**
 * 一体机「局域网电表配对功率」DP26，单位 W。
 * @param {object|null} device
 * @returns {number|null} null = 尚未读到
 */
function lanMeterPowerFromDevice(device) {
  if (!device) return null;
  const v = device.values || {};
  const raw = v.meter_power ?? v.grid_power;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * 电网节点展示功率：有电表用 lastValue；无电表用选中一体机 DP26。
 * @returns {{ watts: number|null, source: "meter"|"lan"|"none", device: object|null, label: string }}
 */
function resolveGridNodePower(home) {
  const meters = home?.meters || [];
  const meter = meters[0];
  const hasMeter =
    meter?.lastValue != null &&
    meter.lastValue !== "" &&
    Number.isFinite(Number(meter.lastValue));
  if (hasMeter) {
    return {
      watts: Number(meter.lastValue),
      source: "meter",
      device: null,
      label: meter.name || meter.deviceId || "电表",
    };
  }
  const device = resolveLanMeterDevice(home);
  const watts = lanMeterPowerFromDevice(device);
  return {
    watts,
    source: device ? "lan" : "none",
    device,
    label: device
      ? `${device.name || device.deviceId} · DP26`
      : "未选一体机",
  };
}

async function readMeterShadowLive(home, meter) {
  /** Real-time power via ops query-shadow-property. */
  const spec = meterDpSpec(meter);
  const shadowRes = await apiPost("/api/proxy/shadow-property", home, {
    devId: meter.deviceId,
    propertyList: [{ dpId: String(spec.dpId), dpCode: spec.dpCode }],
  });
  const shadowList = unwrapResult(shadowRes);
  const items = Array.isArray(shadowList) ? shadowList : shadowList?.items || [];
  const hit =
    items.find((it) => String(it.propertyId) === String(spec.dpId)) ||
    items.find((it) => (it.code || it.dpCode) === spec.dpCode) ||
    items[0];
  if (!hit) {
    meter.lastValue = null;
    return;
  }
  const rawVal = hit.valueObject ?? hit.value ?? hit.dpValue;
  // 涂鸦电表 active_power：kW scale=3；三方一体机 grid_power：通常为 W
  const dpSchema = meter.isThirdParty
    ? { unit: "W", scale: 0, type: "value" }
    : { unit: "kW", scale: 3, type: "value" };
  meter.lastValue = toDisplayValue(rawVal, dpSchema, "W");
  const t = Number(hit.time || hit.reportTime || 0);
  meter.reportTime = t || meter.reportTime || null;
}

async function readMeterBizlogHistory(home, meter) {
  /** Historical curve via Hestia bizlog/search (charts tab). */
  const spec = meterDpSpec(meter);
  meter.hestiaHost = hestiaHostForHome(home);
  const res = await apiPost("/api/proxy/bizlog-search", meter.hestiaHost, {
    eventIds: BIZLOG_EVENT_IDS,
    devId: meter.deviceId,
    limit: 50,
    dpIds: spec.dpId,
    gmt: "+08:00",
    eventIdAll: "1",
  });
  const upstream = res.data || {};
  if (upstream.code !== undefined && upstream.code !== 0) {
    throw new Error(upstream.msg || upstream.message || `hestia code ${upstream.code}`);
  }
  const data = upstream.data || {};
  const events = data.events || [];
  const series = [];
  for (const ev of events) {
    const t = parseBizlogTime(ev.eventTime);
    const v = parseBizlogPowerValue(ev.eventDetail);
    if (t == null || v == null || Number.isNaN(v)) continue;
    series.push({ t, v });
  }
  series.sort((a, b) => a.t - b.t);
  meter.powerSeries = series;
  meter.deviceInfo = data.deviceInfo || meter.deviceInfo;
  if (
    !meter.isThirdParty &&
    meter.deviceInfo?.productId &&
    meter.deviceInfo.productId !== METER_PID
  ) {
    meter.error = `PID 非电表期望值（${meter.deviceInfo.productId}）`;
  }
  meter.powerMeta = {
    dpId: spec.dpId,
    dpCode: spec.dpCode,
    pid: spec.pid,
    isThirdParty: !!meter.isThirdParty,
    count: series.length,
  };
}

async function readMeter(home, meter, opts = {}) {
  const batch = !!opts.batch;
  // 实时功率只走影子；bizlog 仅 charts 页显式 history:true
  const wantHistory = opts.history === true;
  meter.loading = true;
  meter.error = null;
  if (!batch) render();
  try {
    await readMeterShadowLive(home, meter);
    if (wantHistory) {
      try {
        await readMeterBizlogHistory(home, meter);
      } catch (histErr) {
        // 实时值已到手；曲线失败不阻断
        if (!meter.powerSeries?.length) {
          meter.powerMeta = {
            ...(meter.powerMeta || {}),
            historyError: histErr.message || String(histErr),
          };
        }
      }
    }
    meter.lastReadAt = Date.now();
    home.lastReadAt = Date.now();
  } catch (err) {
    meter.error = err.message || String(err);
    if (!batch) toast(`${meter.name || meter.deviceId}: ${meter.error}`, "error");
  } finally {
    meter.loading = false;
    if (!batch) render();
  }
}

async function issueDevice(home, device, opts = {}) {
  const batch = !!opts.batch;
  const propertyList = [];
  const wmDraft = (device.drafts?.work_mode || "").trim();
  if (wmDraft !== "" && String(device.values?.work_mode ?? "") !== wmDraft) {
    const field = HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode");
    const entry = resolveSchemaEntry(device.schema || {}, field || { code: "work_mode", aliases: ["work_mode"] });
    propertyList.push({
      dpId: String(entry?.dpId || field?.fallbackDpId || "51"),
      dpValue: wmDraft,
    });
  }
  for (const field of DP_EDITABLE) {
    const draft = (device.drafts[field.code] || "").trim();
    if (draft === "") continue;
    const cur = device.values[field.code];
    if (cur != null && String(cur) === draft) continue;
    const entry = resolveSchemaEntry(device.schema, field);
    if (!entry?.dpId) {
      if (!batch) toast(`缺少 ${field.label} 的 dpId，请先读取`, "error");
      return false;
    }
    if (field.useModelMax) {
      const max = modelMeta(device).maxExport;
      const n = Number(draft);
      if (max != null && !Number.isNaN(n) && n > max) {
        if (!batch) toast(`${field.label} 不能超过型号上限 ${max}W`, "error");
        return false;
      }
    }
    const raw = isFiniteNumber(draft) ? toIssueRaw(draft, entry.dpSchema) : draft;
    propertyList.push({ dpId: String(entry.dpId), dpValue: raw });
  }
  if (!propertyList.length) {
    if (!batch) toast("没有待下发的改动", "error");
    return false;
  }
  device.loading = true;
  if (!batch) render();
  try {
    const res = await apiPost("/api/proxy/issue", home, {
      devId: device.deviceId,
      timestamp: null,
      propertyList,
    });
    const raw = unwrapResult(res);
    const upstream = res.data || {};
    const ok =
      res.ok !== false &&
      upstream.success !== false &&
      (raw?.success === true ||
        raw?.success === undefined ||
        Array.isArray(raw) ||
        res.status === 200);
    if (!ok) {
      throw new Error(upstream.errorMsg || raw?.errorMsg || raw?.message || "下发失败");
    }
    if (wmDraft !== "") {
      device.values.work_mode = wmDraft;
      device.drafts.work_mode = "";
    }
    for (const field of DP_EDITABLE) {
      const draft = (device.drafts[field.code] || "").trim();
      if (draft === "") continue;
      device.values[field.code] = isFiniteNumber(draft) ? Number(draft) : draft;
      device.drafts[field.code] = "";
    }
    if (!batch) {
      persist();
      toast(`${device.name || device.deviceId} 下发成功 (${propertyList.length})`, "ok");
    }
    return true;
  } catch (err) {
    if (!batch) toast(`${device.name || device.deviceId}: ${err.message || err}`, "error");
    else device.error = err.message || String(err);
    return false;
  } finally {
    device.loading = false;
    if (!batch) render();
  }
}

/**
 * Fetch 物模型 home_* 字段（不写 device，避免与影子并行时互相覆盖）。
 * @returns {{values: Object, regs: Object}|null}
 */
async function fetchDeviceHomeModelParams(home, device) {
  if (!device) return null;
  try {
    const res = await apiGet("/api/proxy/property-query", home, {
      page: "1",
      deviceId: device.deviceId,
    });
    const list = unwrapResult(res);
    const items = Array.isArray(list) ? list : list?.data || list?.items || [];
    const values = {};
    const regs = {};
    for (const it of items) {
      const code = it.code;
      if (!ALL_MODEL_CODES.includes(code)) continue;
      const field =
        HOME_FAMILY_FIELDS.find((f) => f.code === code) ||
        DEVICE_MODEL_READONLY.find((f) => f.code === code);
      if (!field) continue;
      const raw = it.value;
      const val = raw == null || raw === "" ? null : isFiniteNumber(raw) ? Number(raw) : String(raw);
      values[code] = val;
      const addr = parseRegAddr(it.model?.strategySpec);
      if (addr != null) {
        regs[code] = { addr, signed: !!field.signed };
      }
    }
    return { values, regs };
  } catch (err) {
    console.warn("fetchDeviceHomeModelParams", device.deviceId, err);
    return null;
  }
}

/** Apply fetched model params onto device / home.familyValues / familyRegs. */
function applyDeviceHomeModelParams(home, device, model, opts = {}) {
  if (!device || !model) return;
  if (!device.values) device.values = {};
  if (!home.familyValues) home.familyValues = {};
  Object.assign(device.values, model.values || {});
  if (opts.syncHome !== false) {
    for (const [code, val] of Object.entries(model.values || {})) {
      if (DEVICE_MODEL_READONLY.some((f) => f.code === code)) continue;
      if (opts.forceHome || home.familyValues[code] == null || home.familyValues[code] === "") {
        home.familyValues[code] = val;
      }
    }
  }
  home.familyRegs = { ...(home.familyRegs || {}), ...(model.regs || {}) };
}

/** Read 物模型 home_* fields into a device (and optionally sync home.familyValues). */
async function readDeviceHomeModelParams(home, device, opts = {}) {
  const model = await fetchDeviceHomeModelParams(home, device);
  applyDeviceHomeModelParams(home, device, model, opts);
}

/** @deprecated alias — sync home rail from first device */
async function readFamilyModelParams(home) {
  const device = (home.devices || [])[0];
  if (!device) return;
  await readDeviceHomeModelParams(home, device, { forceHome: true });
}

function effectiveFamilyValue(home, code) {
  const draft = (home.familyDrafts?.[code] || "").trim();
  if (draft !== "") return draft;
  const cur = home.familyValues?.[code];
  return cur == null ? "" : String(cur);
}

function buildFamilyIssueList(home, device) {
  const drafts = home.familyDrafts || {};
  const values = home.familyValues || {};
  const changed = HOME_FAMILY_FIELDS.filter((f) => {
    const v = (drafts[f.code] || "").trim();
    if (v === "") return false;
    return !(values[f.code] != null && String(values[f.code]) === v);
  });
  if (!changed.length) return [];

  const propertyList = [];
  const wantMode = changed.some((f) => f.code === "work_mode");
  const wantBase = changed.some((f) => f.code === "base_load");
  const wantFunc = changed.some((f) => f.via === "function_set");

  if (wantMode) {
    const field = HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode");
    const entry = resolveSchemaEntry(device.schema || {}, field);
    propertyList.push({
      dpId: String(entry?.dpId || field.fallbackDpId),
      dpValue: String(drafts.work_mode).trim(),
    });
  }
  if (wantBase) {
    const field = HOME_FAMILY_FIELDS.find((f) => f.code === "base_load");
    const entry = resolveSchemaEntry(device.schema || {}, field);
    const draft = String(drafts.base_load).trim();
    const raw = isFiniteNumber(draft) ? toIssueRaw(draft, entry?.dpSchema) : draft;
    propertyList.push({
      dpId: String(entry?.dpId || field.fallbackDpId),
      dpValue: raw,
    });
  }
  if (wantFunc) {
    const entries = [];
    for (const f of HOME_FAMILY_FIELDS.filter((x) => x.via === "function_set")) {
      const v = effectiveFamilyValue(home, f.code);
      if (v === "") continue;
      const reg = home.familyRegs?.[f.code];
      const addr = reg?.addr ?? f.regAddr;
      entries.push({ addr, value: Number(v), signed: !!(reg?.signed ?? f.signed) });
    }
    if (entries.length) {
      const entry = resolveSchemaEntry(device.schema || {}, {
        code: "function_set",
        aliases: ["function_set"],
      });
      propertyList.push({
        dpId: String(entry?.dpId || "52"),
        dpValue: packFunctionSetRaw(entries),
      });
    }
  }
  return propertyList;
}

/** Issue home-side drafts to every device in the home (parallel). */
async function issueFamilyToDevices(home) {
  if (!countFamilyDrafts(home)) {
    toast("没有家庭侧待下发改动", "error");
    return { ok: 0, fail: 0 };
  }
  const devices = home.devices || [];
  if (!devices.length) {
    toast("家庭内没有设备", "error");
    return { ok: 0, fail: 0 };
  }

  // 先并行补齐缺 schema 的设备，再并行下发
  await Promise.all(
    devices.map(async (device) => {
      if (Object.keys(device.schema || {}).length) return;
      try {
        const schemaRes = await apiGet("/api/proxy/pid-schema", home, { devId: device.deviceId });
        device.schema = indexSchema(unwrapResult(schemaRes));
      } catch (_) {}
    })
  );

  const results = await Promise.all(
    devices.map(async (device) => {
      const propertyList = buildFamilyIssueList(home, device);
      if (!propertyList.length) return null;
      try {
        const res = await apiPost("/api/proxy/issue", home, {
          devId: device.deviceId,
          timestamp: null,
          propertyList,
        });
        const raw = unwrapResult(res);
        const upstream = res.data || {};
        const success =
          res.ok !== false &&
          upstream.success !== false &&
          (raw?.success === true ||
            raw?.success === undefined ||
            Array.isArray(raw) ||
            res.status === 200);
        if (!success) {
          throw new Error(upstream.errorMsg || raw?.errorMsg || raw?.message || "下发失败");
        }
        return true;
      } catch (err) {
        console.warn("issueFamily", device.deviceId, err);
        return false;
      }
    })
  );

  const issued = results.filter((r) => r !== null);
  const ok = issued.filter(Boolean).length;
  const fail = issued.length - ok;

  if (ok > 0) {
    if (!home.familyValues) home.familyValues = {};
    for (const f of HOME_FAMILY_FIELDS) {
      const draft = (home.familyDrafts?.[f.code] || "").trim();
      if (!draft) continue;
      home.familyValues[f.code] = isFiniteNumber(draft) ? Number(draft) : draft;
      home.familyDrafts[f.code] = "";
    }
    persist();
  }
  return { ok, fail };
}

function isFiniteNumber(v) {
  const n = Number(v);
  return v !== "" && !Number.isNaN(n) && Number.isFinite(n);
}

/* ---------- Render ---------- */

function fillEnvSelect(selectEl, selected, includeHestia = false) {
  selectEl.innerHTML = "";
  const entries = Object.entries(ENV_CONFIG);
  if (includeHestia) {
    for (const [host, meta] of Object.entries(HESTIA_ENVS)) {
      entries.push([host, { ...meta, supported: true }]);
    }
  }
  for (const [host, meta] of entries) {
    const opt = document.createElement("option");
    opt.value = host;
    opt.textContent = `${meta.name} (${meta.short})${meta.supported === false ? " · 未开放" : ""}`;
    if (host === selected) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

function renderSidebar() {
  const list = document.getElementById("homeList");
  list.innerHTML = "";
  for (const home of state.homes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "home-item" + (home.uid === state.activeHomeId ? " active" : "");
    btn.innerHTML = `<div class="title">${escapeHtml(homeDisplayName(home))}</div>
      <div class="sub">家庭 ID ${escapeHtml(home.homeId || "—")}</div>
      <div class="sub">${home.devices.length} 台设备</div>`;
    btn.addEventListener("click", () => {
      state.activeHomeId = home.uid;
      persist();
      render();
    });
    list.appendChild(btn);
  }
}

/** @type {'live'|'charts'|'election'|'snapshots'} */
let homeTab = "live";

const SNAPSHOT_KEY = "groupAppControl.snapshots.v1";
const SNAPSHOT_MAX = 12;
const SNAPSHOT_MAX_W = 3600;
const SNAPSHOT_JPEG_Q = 0.7;

/* ---------------------------------------------------------------------------
 * Cluster election trend — master deviceId timeline by reportTime
 * --------------------------------------------------------------------------- */
const ELECTION_ROLE_CODE = "device_cluster_role";
const ELECTION_DEFAULT_INTERVAL_SEC = 5;
const ELECTION_POLL_KEY = "gac_election_poll";

let electionIntervalSec = ELECTION_DEFAULT_INTERVAL_SEC;
let electionPollEnabled = false;
let electionPollTimer = null;
let electionPollBusy = false;
/** @type {string|null} */
let electionLastMasterId = null;
/** @type {Array<{pollAt:number,reportTime:number,masterDeviceId:string,masterName:string,masterChanged:boolean,prevMasterDeviceId:string}>} */
let electionTimeline = [];
let electionMeta = { rowCount: 0, path: "", lastPollAt: null, lastError: null };

try {
  electionPollEnabled = localStorage.getItem(ELECTION_POLL_KEY) === "1";
} catch (_) {
  electionPollEnabled = false;
}

function electionHomeKey(home) {
  if (!home) return "";
  return String(home.homeId || home.uid || "").trim();
}

function electionRoleNum(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parsePropertyReportTime(it) {
  if (!it || typeof it !== "object") return null;
  const candidates = [it.time, it.reportTime, it.gmtModified, it.updateTime, it.ts, it.timestamp];
  for (const c of candidates) {
    const n = Number(c);
    if (!Number.isFinite(n) || n <= 0) continue;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  return null;
}

/**
 * Query one device's device_cluster_role (property-query + code).
 */
async function fetchDeviceClusterRole(home, device) {
  const base = {
    deviceId: device.deviceId,
    deviceName: device.name || device.deviceId,
    role: null,
    roleLabel: "—",
    reportTime: null,
  };
  try {
    const res = await apiGet("/api/proxy/property-query", home, {
      page: "1",
      deviceId: device.deviceId,
      code: ELECTION_ROLE_CODE,
    });
    const list = unwrapResult(res);
    const items = Array.isArray(list) ? list : list?.data || list?.items || [];
    const hit =
      items.find((it) => it && it.code === ELECTION_ROLE_CODE) ||
      (items.length === 1 ? items[0] : null);
    if (!hit) return { ...base, error: "未找到 device_cluster_role" };
    const role = electionRoleNum(hit.value ?? hit.dpValue ?? hit.valueObject);
    return {
      ...base,
      role,
      roleLabel: clusterRoleLabel(role) || "—",
      reportTime: parsePropertyReportTime(hit),
    };
  } catch (err) {
    return { ...base, error: err.message || String(err) };
  }
}

/**
 * Build election snapshot from poll samples.
 * Requires ≥1 master (role=0 + reportTime). Also collects slaves and full device table.
 */
function analyzeElectionMasters(samples) {
  const devices = (samples || [])
    .filter((s) => s && !s.error && s.deviceId != null && s.deviceId !== "")
    .map((s) => {
      const role = electionRoleNum(s.role);
      const rt = Number(s.reportTime);
      return {
        deviceId: s.deviceId,
        deviceName: s.deviceName || s.deviceId,
        role,
        roleLabel: s.roleLabel || clusterRoleLabel(role) || "—",
        reportTime: Number.isFinite(rt) && rt > 0 ? rt : null,
      };
    })
    .sort((a, b) => {
      const ra = a.role == null ? 99 : a.role;
      const rb = b.role == null ? 99 : b.role;
      if (ra !== rb) return ra - rb;
      return String(a.deviceId).localeCompare(String(b.deviceId));
    });

  const masters = devices.filter((d) => d.role === 0 && d.reportTime != null);
  if (!masters.length) return null;
  masters.sort((a, b) => {
    const dt = Number(b.reportTime) - Number(a.reportTime);
    if (dt) return dt;
    return String(a.deviceId).localeCompare(String(b.deviceId));
  });
  const slaves = devices.filter((d) => d.role === 1);
  const ids = masters.map((m) => m.deviceId);
  const conflict = masters.length > 1;
  const masterDeviceId = conflict ? ids.join(" | ") : ids[0];
  const masterName = conflict
    ? masters.map((m) => m.deviceName || m.deviceId).join(" | ")
    : masters[0].deviceName || masters[0].deviceId;
  // CSV reportTime = max(reportTime) across all devices in this poll
  const allTimes = devices.map((d) => d.reportTime).filter((t) => t != null && Number(t) > 0);
  if (!allTimes.length) return null;
  const reportTime = Math.max(...allTimes.map(Number));
  return {
    conflict,
    masters,
    slaves,
    devices,
    masterDeviceId,
    masterName,
    masterDeviceIds: ids.join(","),
    slaveDeviceIds: slaves.map((s) => s.deviceId).join(","),
    reportTime,
  };
}

function parseElectionDevicesJson(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function rowsToElectionTimeline(rows) {
  const points = [];
  for (const r of rows || []) {
    const masterDeviceId = String(r.masterDeviceId || "").trim();
    const reportTime = Number(r.reportTime);
    if (!masterDeviceId || !Number.isFinite(reportTime) || reportTime <= 0) continue;
    const idsRaw = String(r.masterDeviceIds || "").trim();
    const masterIds = idsRaw
      ? idsRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : masterDeviceId.split("|").map((x) => x.trim()).filter(Boolean);
    const slaveIds = String(r.slaveDeviceIds || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const devices = parseElectionDevicesJson(r.devicesJson);
    points.push({
      pollAt: r.pollAt ? Number(r.pollAt) : reportTime,
      reportTime,
      masterDeviceId,
      masterName: r.masterName || masterDeviceId,
      masterChanged: String(r.masterChanged) === "1",
      prevMasterDeviceId: r.prevMasterDeviceId || "",
      conflict: String(r.conflict) === "1" || masterIds.length > 1,
      masterIds,
      slaveIds,
      devices,
    });
  }
  points.sort((a, b) => a.reportTime - b.reportTime || a.pollAt - b.pollAt);
  let prev = "";
  for (const p of points) {
    const key = p.conflict ? `conflict:${(p.masterIds || []).slice().sort().join(",")}` : p.masterDeviceId;
    const changed = !!prev && key !== prev;
    p.masterChanged = changed || !!p.conflict;
    if (changed && !p.conflict) p.prevMasterDeviceId = prev.startsWith("conflict:") ? prev.slice(9) : prev;
    prev = key;
  }
  return points;
}

function stopElectionPollTimer() {
  if (electionPollTimer) {
    clearInterval(electionPollTimer);
    electionPollTimer = null;
  }
}

function syncElectionPollUi() {
  const btn = document.getElementById("btnElectionPollToggle");
  const label = document.getElementById("electionPollLabel");
  const input = document.getElementById("electionIntervalSec");
  if (input && document.activeElement !== input) {
    input.value = String(electionIntervalSec);
  }
  if (btn) {
    btn.classList.toggle("on", !!electionPollEnabled);
    btn.setAttribute("aria-checked", electionPollEnabled ? "true" : "false");
  }
  if (label) {
    label.textContent = electionPollEnabled ? `轮询 · ${electionIntervalSec}s` : "轮询";
  }
}

function ensureElectionPollTimer() {
  stopElectionPollTimer();
  if (!electionPollEnabled) return;
  const ms = Math.max(1, electionIntervalSec) * 1000;
  electionPollTimer = setInterval(() => {
    tickElectionPoll();
  }, ms);
}

async function loadElectionSettings(home) {
  const homeId = electionHomeKey(home);
  if (!homeId) return;
  try {
    const res = await fetch(`/api/election/settings?homeId=${encodeURIComponent(homeId)}`);
    const data = await res.json();
    if (data?.ok && data.intervalSec) {
      electionIntervalSec = Math.max(1, Math.min(3600, Number(data.intervalSec) || ELECTION_DEFAULT_INTERVAL_SEC));
    }
  } catch (err) {
    console.warn("loadElectionSettings", err);
  }
  syncElectionPollUi();
}

async function saveElectionInterval(home, sec) {
  const homeId = electionHomeKey(home);
  const n = Math.max(1, Math.min(3600, Math.round(Number(sec) || ELECTION_DEFAULT_INTERVAL_SEC)));
  electionIntervalSec = n;
  syncElectionPollUi();
  try {
    await fetch("/api/election/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homeId, intervalSec: n }),
    });
  } catch (err) {
    console.warn("saveElectionInterval", err);
  }
  if (electionPollEnabled) ensureElectionPollTimer();
  toast(`轮询周期已设为 ${n}s`, "ok");
}

async function ensureElectionTimelineLoaded(home) {
  if (electionTimeline.length) return;
  const homeId = electionHomeKey(home);
  if (!homeId) return;
  try {
    const res = await fetch(`/api/election/rows?homeId=${encodeURIComponent(homeId)}&limit=2000`);
    const data = await res.json();
    if (!data?.ok) return;
    electionMeta.rowCount = data.rowCount || 0;
    electionMeta.path = data.path || "";
    electionTimeline = rowsToElectionTimeline(data.rows || []);
    const last = electionTimeline[electionTimeline.length - 1];
    if (last?.masterDeviceId) electionLastMasterId = last.masterDeviceId;
  } catch (err) {
    console.warn("ensureElectionTimelineLoaded", err);
  }
}

async function loadElectionRows(home) {
  const host = document.getElementById("electionHost");
  const homeId = electionHomeKey(home);
  if (!homeId) {
    if (host) host.innerHTML = `<div class="election-empty">请先配置家庭 ID</div>`;
    return;
  }
  try {
    const res = await fetch(`/api/election/rows?homeId=${encodeURIComponent(homeId)}&limit=2000`);
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || "加载失败");
    electionMeta.rowCount = data.rowCount || 0;
    electionMeta.path = data.path || "";
    if (data.intervalSec) {
      electionIntervalSec = Math.max(1, Math.min(3600, Number(data.intervalSec)));
    }
    electionTimeline = rowsToElectionTimeline(data.rows || []);
    const last = electionTimeline[electionTimeline.length - 1];
    electionLastMasterId = last?.masterDeviceId || null;
  } catch (err) {
    electionMeta.lastError = err.message || String(err);
    if (host) {
      host.innerHTML = `<div class="election-empty">加载 CSV 失败：${escapeHtml(electionMeta.lastError)}</div>`;
    }
    return;
  }
  renderElectionPanel(home);
}

function renderElectionPanel(home) {
  const host = document.getElementById("electionHost");
  const summary = document.getElementById("electionSummary");
  if (!host || !summary) return;
  syncElectionPollUi();

  const points = electionTimeline;
  const changes = points.filter((p) => p.masterChanged && !p.conflict);
  const conflicts = points.filter((p) => p.conflict);
  const latest = points.length ? points[points.length - 1] : null;
  summary.innerHTML = `
    <div class="election-stat${latest?.conflict ? " warn" : ""}">
      <div class="k">当前主机</div>
      <div class="v">${escapeHtml(latest?.masterDeviceId || "—")}</div>
    </div>
    <div class="election-stat${changes.length ? " warn" : ""}">
      <div class="k">主机切换次数</div>
      <div class="v">${changes.length}</div>
    </div>
    <div class="election-stat${conflicts.length ? " warn" : ""}">
      <div class="k">双主机冲突</div>
      <div class="v">${conflicts.length}</div>
    </div>
    <div class="election-stat">
      <div class="k">上次采样</div>
      <div class="v">${electionMeta.lastPollAt ? fmtTime(electionMeta.lastPollAt) : "—"}</div>
    </div>
  `;

  if (!points.length) {
    host.innerHTML = `<div class="election-empty">暂无主机时间轴。开启轮询或点「立即采样」后，将按 reportTime 记录主机 deviceId。</div>`;
    return;
  }

  const ordered = [...points].reverse();
  host.innerHTML = `<ol class="election-timeline">${ordered
    .map((p, idx) => {
      const conflict = !!p.conflict;
      const changed = !!p.masterChanged && !conflict;
      // newest / conflict / change → expanded; stable older → collapsed
      const collapsed = !(idx === 0 || conflict || changed);
      const badge = conflict
        ? `<span class="election-badge conflict">双主机冲突 ×${(p.masterIds || []).length || 2}</span>`
        : changed
          ? `<span class="election-badge change">主机切换</span>`
          : `<span class="election-badge stable">稳定</span>`;
      const masterIds = p.masterIds?.length
        ? p.masterIds
        : String(p.masterDeviceId || "")
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean);
      const slaveIds =
        p.slaveIds?.length
          ? p.slaveIds
          : (p.devices || []).filter((d) => Number(d.role) === 1).map((d) => d.deviceId);
      const masterList = masterIds
        .map((id) => `<div class="election-tl-id master">${escapeHtml(id)}</div>`)
        .join("");
      const slaveList = slaveIds.length
        ? slaveIds.map((id) => `<div class="election-tl-id slave">${escapeHtml(id)}</div>`).join("")
        : `<div class="election-tl-muted">（无）</div>`;
      const tableRows = (p.devices || [])
        .map((d) => {
          const roleN = d.role;
          const roleTxt = d.roleLabel || clusterRoleLabel(roleN) || "—";
          const rt = d.reportTime ? fmtTime(d.reportTime) : "—";
          const cls =
            roleN === 0 ? "is-master" : roleN === 1 ? "is-slave" : roleN === 2 ? "is-electing" : "";
          return `<tr class="${cls}">
            <td class="col-name">${escapeHtml(d.deviceName || "—")}</td>
            <td class="col-id">${escapeHtml(d.deviceId || "—")}</td>
            <td class="col-role">${escapeHtml(roleTxt)}${roleN == null ? "" : ` (${roleN})`}</td>
            <td class="col-rt">${escapeHtml(rt)}</td>
          </tr>`;
        })
        .join("");
      const table = tableRows
        ? `<div class="election-tl-table-wrap">
            <table class="election-tl-table">
              <thead><tr><th>名称</th><th>设备 ID</th><th>角色</th><th>reportTime</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>`
        : `<div class="election-tl-muted">无设备明细（旧记录）</div>`;
      const summaryLine = conflict
        ? `冲突主机 ${masterIds.length} · 从机 ${slaveIds.length}`
        : `主机 ${escapeHtml(masterIds[0] || "—")} · 从机 ${slaveIds.length}`;
      return `<li class="election-tl-item${conflict ? " conflict" : changed ? " changed" : ""}${
        collapsed ? " is-collapsed" : ""
      }">
        <div class="election-tl-dot" aria-hidden="true"></div>
        <div class="election-tl-card">
          <button type="button" class="election-tl-head" data-act="election-fold" aria-expanded="${collapsed ? "false" : "true"}">
            <span class="election-tl-chevron" aria-hidden="true"></span>
            <div class="election-tl-head-main">
              <div class="election-tl-top">
                <div class="election-tl-time">reportTime ${escapeHtml(fmtTime(p.reportTime))}</div>
                ${badge}
              </div>
              <div class="election-tl-summary">${summaryLine}</div>
            </div>
          </button>
          <div class="election-tl-body">
            <div class="election-tl-cols">
              <div class="election-tl-master">
                <span class="k">${conflict ? "主机(冲突)" : "主机"}</span>
                <div class="election-tl-ids">${masterList}</div>
              </div>
              <div class="election-tl-master">
                <span class="k">从机${slaveIds.length ? ` · ${slaveIds.length}` : ""}</span>
                <div class="election-tl-ids">${slaveList}</div>
              </div>
            </div>
            ${
              changed
                ? `<div class="election-tl-change">${escapeHtml(p.prevMasterDeviceId || "—")} → ${escapeHtml(
                    p.masterDeviceId
                  )}</div>`
                : ""
            }
            ${
              conflict
                ? `<div class="election-tl-change">同时有 ${masterIds.length} 台 device_cluster_role=0</div>`
                : ""
            }
            ${table}
            <div class="election-tl-poll">采样 ${escapeHtml(fmtTime(p.pollAt))}</div>
          </div>
        </div>
      </li>`;
    })
    .join("")}</ol>`;

  host.querySelectorAll('[data-act="election-fold"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".election-tl-item");
      if (!item) return;
      const open = item.classList.toggle("is-collapsed");
      // open=true means now collapsed
      btn.setAttribute("aria-expanded", open ? "false" : "true");
    });
  });
}

async function tickElectionPoll(opts = {}) {
  if (electionPollBusy) return;
  const home = activeHome();
  if (!home) return;
  if (!opts.force && !electionPollEnabled) return;
  const devices = home.devices || [];
  if (!devices.length) {
    if (opts.force) toast("当前家庭没有一体机", "error");
    return;
  }
  electionPollBusy = true;
  try {
    const pollAt = Date.now();
    const samples = await Promise.all(devices.map((d) => fetchDeviceClusterRole(home, d)));
    for (const s of samples) {
      const d = devices.find((x) => x.deviceId === s.deviceId);
      if (!d) continue;
      if (!d.values) d.values = {};
      if (s.role != null) d.values.device_cluster_role = s.role;
    }
    const master = analyzeElectionMasters(samples);
    electionMeta.lastPollAt = pollAt;
    electionMeta.lastError = null;
    if (!master) {
      if (opts.force) toast("本轮未落盘：未找到主机（device_cluster_role=0）", "ok");
      if (homeTab === "election") await loadElectionRows(home);
      return;
    }
    await ensureElectionTimelineLoaded(home);
    const prev = electionLastMasterId || "";
    const changed = !!prev && prev !== master.masterDeviceId;
    // reportTime already in table/CSV → do not write again
    const existsSameReportTime = electionTimeline.some(
      (p) => Number(p.reportTime) === Number(master.reportTime)
    );
    if (existsSameReportTime) {
      electionMeta.lastPollAt = pollAt;
      if (opts.force) {
        toast(`reportTime ${fmtTime(master.reportTime)} 已存在，跳过写入`, "ok");
      }
      if (homeTab === "election") renderElectionPanel(home);
      return;
    }
    const homeId = electionHomeKey(home);
    const row = {
      pollAt: String(pollAt),
      reportTime: String(master.reportTime),
      homeId,
      masterDeviceId: master.masterDeviceId,
      masterName: master.masterName,
      masterChanged: changed || master.conflict ? "1" : "0",
      prevMasterDeviceId: changed ? prev : "",
      conflict: master.conflict ? "1" : "0",
      masterDeviceIds: master.masterDeviceIds,
      slaveDeviceIds: master.slaveDeviceIds || "",
      devicesJson: JSON.stringify(master.devices || []),
    };
    if (homeId) {
      const res = await fetch("/api/election/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeId, rows: [row] }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "写入 CSV 失败");
      electionMeta.rowCount = data.rowCount || electionMeta.rowCount;
      electionMeta.path = data.path || electionMeta.path;
    }
    electionLastMasterId = master.masterDeviceId;
    if (homeTab === "election") await loadElectionRows(home);
    if (master.conflict) {
      toast(`双主机冲突：${master.masterDeviceId}`, "error");
    } else if (opts.force) {
      toast(
        changed
          ? `主机切换 → ${master.masterDeviceId}`
          : `主机 ${master.masterDeviceId} · ${fmtTime(master.reportTime)}`,
        changed ? "error" : "ok"
      );
    } else if (changed) {
      toast(`主机切换 → ${master.masterDeviceId}`, "error");
    }
  } catch (err) {
    electionMeta.lastError = err.message || String(err);
    console.warn("tickElectionPoll", err);
    if (opts.force || homeTab === "election") {
      toast(`选举采样失败：${electionMeta.lastError}`, "error");
    }
  } finally {
    electionPollBusy = false;
  }
}

function setElectionPollEnabled(on) {
  electionPollEnabled = !!on;
  try {
    localStorage.setItem(ELECTION_POLL_KEY, electionPollEnabled ? "1" : "0");
  } catch (_) {}
  syncElectionPollUi();
  if (electionPollEnabled) {
    ensureElectionPollTimer();
    tickElectionPoll({ force: true });
    toast(`已开启选举轮询（每 ${electionIntervalSec}s）`, "ok");
  } else {
    stopElectionPollTimer();
    toast("已关闭选举轮询", "ok");
  }
}

async function mountElectionPanel(home) {
  if (!home) return;
  await loadElectionSettings(home);
  syncElectionPollUi();
  await loadElectionRows(home);
  if (electionPollEnabled) ensureElectionPollTimer();
}

function setHomeTab(tab) {
  homeTab =
    tab === "charts"
      ? "charts"
      : tab === "snapshots"
        ? "snapshots"
        : tab === "election"
          ? "election"
          : "live";
  document.querySelectorAll("#homeTabs .home-tab").forEach((btn) => {
    const on = btn.getAttribute("data-tab") === homeTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("tabLive")?.classList.toggle("hidden", homeTab !== "live");
  document.getElementById("tabCharts")?.classList.toggle("hidden", homeTab !== "charts");
  document.getElementById("tabElection")?.classList.toggle("hidden", homeTab !== "election");
  document.getElementById("tabSnapshots")?.classList.toggle("hidden", homeTab !== "snapshots");
  if (homeTab === "charts") {
    const home = activeHome();
    if (home) {
      mountChartsPanel(home);
      // 历史曲线：电表 bizlog + 设备 SOC query-neko（实时页不调）
      for (const m of home.meters || []) {
        if (m.powerSeries?.length) continue;
        readMeter(home, m, { batch: true, history: true }).then(() => {
          if (homeTab === "charts" && activeHome()?.uid === home.uid) mountChartsPanel(home);
        });
      }
      for (const d of home.devices || []) {
        if (d.socSeries?.length) continue;
        scheduleSocFetch(home, d);
      }
    }
  }
  if (homeTab === "election") {
    const home = activeHome();
    if (home) mountElectionPanel(home);
  }
  if (homeTab === "snapshots") {
    mountSnapshotsPanel();
  }
}

function renderMain() {
  const home = activeHome();
  const empty = document.getElementById("emptyState");
  const view = document.getElementById("homeView");
  if (!home) {
    empty.classList.remove("hidden");
    view.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  view.classList.remove("hidden");

  document.getElementById("homeTitle").textContent = homeDisplayName(home);
  const parts = [];
  if (home.homeId) parts.push(`家庭 ID ${home.homeId}`);
  parts.push(`${home.devices.length} 台设备`);
  if (home.authId) parts.push(`authId ${home.authId}`);
  if (home.lastReadAt) parts.push(`上次读取 ${fmtTime(home.lastReadAt)}`);
  document.getElementById("homeMeta").textContent = parts.join("，");

  const draftCount = countHomeDrafts(home);
  const issueAll = document.getElementById("btnIssueAll");
  issueAll.disabled = draftCount === 0;
  issueAll.textContent = draftCount ? `一键下发 (${draftCount})` : "一键下发";

  const hasCookie = !!(state.cookies[home.envHost] || "").trim() || Object.values(state.cookies).some(Boolean);
  document.getElementById("cookieBanner").classList.toggle("hidden", hasCookie);
  const onLocal = isLocalHostPage();
  const bannerText = document.getElementById("cookieBannerText");
  const bannerBtn = document.getElementById("btnAutoCookieBanner");
  if (bannerText) {
    bannerText.textContent = onLocal
      ? "当前环境尚未配置 Cookie。可点「自动获取」从本机浏览器 SSO 填入，再「推送到虚拟机」。"
      : "当前环境尚未配置 Cookie。请在本机自动获取后推送到虚拟机，或打开「登录态」手动粘贴。";
  }
  if (bannerBtn) bannerBtn.classList.toggle("hidden", !onLocal);

  document.getElementById("tabLive")?.classList.toggle("hidden", homeTab !== "live");
  document.getElementById("tabCharts")?.classList.toggle("hidden", homeTab !== "charts");
  document.getElementById("tabElection")?.classList.toggle("hidden", homeTab !== "election");
  document.getElementById("tabSnapshots")?.classList.toggle("hidden", homeTab !== "snapshots");
  document.querySelectorAll("#homeTabs .home-tab").forEach((btn) => {
    const on = btn.getAttribute("data-tab") === homeTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });

  const host = document.getElementById("flowHost");
  host.innerHTML = typeof renderHomeEnergyFlow === "function" ? renderHomeEnergyFlow(home) : "";
  bindFlowHost(home);

  if (homeTab === "charts") {
    mountChartsPanel(home);
  }
  if (homeTab === "election") {
    mountElectionPanel(home);
  }
  if (homeTab === "snapshots") {
    mountSnapshotsPanel();
  }
}

function renderMeterCard(home, meter) {
  meter.hestiaHost = hestiaHostForHome(home);
  const card = document.createElement("article");
  card.className = "card meter-card" + (meter.loading ? " status-loading" : "");
  if (meter.error) card.classList.add("status-error");
  const hestia = HESTIA_ENVS[meter.hestiaHost] || { short: meter.hestiaHost };
  const info = meter.deviceInfo || {};
  const lastText =
    meter.lastValue == null || Number.isNaN(Number(meter.lastValue))
      ? "—"
      : `${meter.lastValue}W`;

  card.innerHTML = `
    <div class="card-head">
      <div class="card-head-main">
        <div class="card-title-row">
          <input type="text" class="name-input" data-act="name"
            value="${escapeAttr(meter.name || "")}" placeholder="填写电表名称" />
          <span class="badge badge-meter">${meter.isThirdParty ? "三方电表" : "电表"}</span>
        </div>
        <div class="card-sub">
          <button type="button" class="id id-copy" data-act="copy-id"
            title="点击复制设备 ID">${escapeHtml(meter.deviceId)}</button>
          <span class="dot">·</span>
          <span class="note">${escapeHtml(hestia.short || "")}</span>
          ${info.productName ? `<span class="dot">·</span><span class="note">${escapeHtml(info.productName)}</span>` : ""}
          ${info.dbStatus ? `<span class="dot">·</span><span class="note">${escapeHtml(info.dbStatus)}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="soc-panel meter-power-panel">
      <div class="soc-head">
        <div class="soc-title">
          <span>功率曲线</span>
          <span class="dp-hint">${METER_DP_ID} · ${METER_DP_CODE}</span>
        </div>
        <div class="soc-stats">
          <span class="meter-power-now ${meter.lastValue != null && meter.lastValue < 0 ? "green" : ""}">${escapeHtml(lastText)}</span>
          ${
            meter.powerSeries?.length
              ? `<span>${meter.powerSeries.length} 点</span>`
              : meter.error
                ? `<span class="err">${escapeHtml(meter.error)}</span>`
                : `<span>读取后加载</span>`
          }
          ${meter.lastReadAt ? `<span>${escapeHtml(fmtTime(meter.lastReadAt))}</span>` : ""}
        </div>
      </div>
      <div class="soc-chart" data-power-chart></div>
    </div>
    <div class="card-foot">
      <div class="time">
        <span class="time-label">Hestia</span>
        <span>${escapeHtml(meter.hestiaHost)}</span>
        ${meter.error && meter.powerSeries?.length ? `<span class="err">· ${escapeHtml(meter.error)}</span>` : ""}
      </div>
      <div class="ops">
        <button type="button" class="btn-link" data-act="edit">编辑</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="read">读取</button>
        <button type="button" class="btn btn-sm btn-danger-outline" data-act="remove">移除</button>
      </div>
    </div>
  `;

  card.querySelector('[data-act="name"]').addEventListener("input", (e) => {
    meter.name = e.target.value.trim();
    persist();
  });
  card.querySelector('[data-act="copy-id"]').addEventListener("click", async () => {
    try {
      await copyText(meter.deviceId);
      toast("已复制电表设备 ID", "ok");
    } catch (err) {
      toast(`复制失败: ${err.message || err}`, "error");
    }
  });
  card.querySelector('[data-act="edit"]').addEventListener("click", () => openMeterDialog(meter));
  card.querySelector('[data-act="read"]').addEventListener("click", () => readMeter(home, meter));
  card.querySelector('[data-act="remove"]').addEventListener("click", () => {
    if (!confirm(`移除电表 ${meter.name || meter.deviceId}？`)) return;
    home.meters = home.meters.filter((x) => x.uid !== meter.uid);
    persist();
    render();
  });

  const chartEl = card.querySelector("[data-power-chart]");
  mountInteractiveChart(chartEl, meter.powerSeries || [], {
    unit: "W",
    includeZero: true,
    emptyText: "暂无功率历史",
    height: 160,
  });

  return card;
}

function renderDeviceCard(home, device) {
  const model = modelMeta(device);
  const card = document.createElement("article");
  card.className = "card";
  if (device.loading) card.classList.add("status-loading");
  if (device.error) card.classList.add("status-error");

  const draftsN = countDrafts(device);

  const visibleDisplay = DP_DISPLAY.filter((m) => resolveSchemaEntry(device.schema || {}, m));
  const visibleEditable = DP_EDITABLE.filter((f) => resolveSchemaEntry(device.schema || {}, f));

  const metricsHtml = visibleDisplay.length
    ? visibleDisplay
        .map((m) => {
          const raw = device.values[m.code];
          const cls = ["value", m.tone || (raw == null ? "muted" : "")].filter(Boolean).join(" ");
          return `<div class="metric">
      <div class="label">${fieldLabelHtml(device, m)}</div>
      <div class="${cls}">${escapeHtml(fmtNum(raw, m.unit))}</div>
    </div>`;
        })
        .join("")
    : `<div class="metric-empty">${
        Object.keys(device.schema || {}).length
          ? "当前 pid-schema 无匹配展示点"
          : "请先读取以加载 pid-schema"
      }</div>`;

  const limitsHtml = visibleEditable
    .map((f) => {
      const cur = device.values[f.code];
      const draft = (device.drafts[f.code] || "").trim();
      const echo = cur != null && cur !== "" && !Number.isNaN(Number(cur)) ? String(cur) : "";
      const shown = draft !== "" ? draft : echo;
      const isDirty = draft !== "" && draft !== echo;
      const maxHint = f.useModelMax && model.maxExport != null ? model.maxExport : null;
      const over =
        maxHint != null &&
        cur != null &&
        !Number.isNaN(Number(cur)) &&
        Number(cur) > maxHint;
      const maxAttr = maxHint != null ? ` max="${maxHint}"` : "";
      const curText = fmtNum(cur, f.unit);
      const capText = maxHint != null ? `上限 ${maxHint}${f.unit}` : "";
      const ph = echo || "—";
      return `<div class="limit-row" data-code="${f.code}">
      <div class="limit-meta">
        <div class="limit-title">
          <span class="field-name">${escapeHtml(f.label)}</span>
          ${over ? '<span class="warn">超限</span>' : ""}
        </div>
        <div class="dp-hint">${escapeHtml(fieldMatchHint(device, f))}</div>
        <div class="limit-cur">
          当前 <strong>${escapeHtml(curText)}</strong>
          ${capText ? `<span class="cap">· ${escapeHtml(capText)}</span>` : ""}
        </div>
      </div>
      <div class="limit-input-wrap">
        <input type="number" inputmode="numeric" placeholder="${escapeAttr(ph)}"
          value="${escapeAttr(shown)}" data-field="${f.code}" data-echo="${escapeAttr(echo)}"
          ${maxHint != null ? `data-max="${maxHint}"` : ""}${maxAttr}
          min="0" class="${isDirty ? "dirty" : ""}" />
        <span class="unit">${escapeHtml(f.unit)}</span>
      </div>
    </div>`;
    })
    .join("");

  card.innerHTML = `
    <div class="card-head">
      <div class="card-head-main">
        <div class="card-title-row">
          <input type="text" class="name-input" data-act="name"
            value="${escapeAttr(device.name || "")}"
            placeholder="填写设备名称" />
          <span class="badge" title="${escapeAttr(
            device.pid
              ? `PID ${device.pid}${model.maxExport != null ? ` · 上限 ${model.maxExport}W` : ""}`
              : "读取后按 PID 匹配型号"
          )}">${escapeHtml(model.badge)}${
            model.maxExport != null ? ` · ${model.maxExport}W` : ""
          }</span>
        </div>
        <div class="card-sub">
          <button type="button" class="id id-copy" data-act="copy-id"
            title="点击复制设备 ID">${escapeHtml(device.deviceId)}</button>
          ${device.pid ? `<span class="dot">·</span><span class="note">PID ${escapeHtml(device.pid)}</span>` : ""}
          ${device.note ? `<span class="dot">·</span><span class="note">${escapeHtml(device.note)}</span>` : ""}
        </div>
      </div>
      <div class="card-head-actions">
        <button type="button" class="btn-icon-refresh" data-act="refresh"
          title="读取该设备（影子 + SOC）" ${device.loading ? "disabled" : ""} aria-label="刷新">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
      </div>
    </div>
    <div class="metrics">${metricsHtml}</div>
    ${limitsHtml ? `<div class="limits">${limitsHtml}</div>` : ""}
    <div class="soc-panel">
      <div class="soc-head">
        <div class="soc-title">
          <span>SOC 曲线</span>
          <span class="dp-hint">${escapeHtml(
            device.socMeta?.code ? `query-neko · ${device.socMeta.code}` : "query-neko · heap_soc"
          )}</span>
        </div>
        <div class="soc-stats">
          ${
            device.socMeta?.loading
              ? `<span>SOC 加载中…</span>`
              : device.socSeries?.length
              ? `<span>${device.socSeries.length} 点</span>
                 <span>近 ${device.socMeta?.hours || 24}h</span>
                 <span>末值 ${escapeHtml(String(device.socSeries[device.socSeries.length - 1].v))}%</span>`
              : device.socMeta?.error
                ? `<span class="err">${escapeHtml(device.socMeta.error)}</span>`
                : `<span>读取后加载</span>`
          }
        </div>
      </div>
      <div class="soc-chart" data-soc-chart></div>
    </div>
    <div class="card-foot">
      <div class="time">
        <span class="time-label">最近上报</span>
        <span>${fmtTime(device.reportTime)}</span>
        ${device.reportTime ? `<span class="rel">${relativeTime(device.reportTime)}</span>` : ""}
        ${device.error ? `<span class="err">· ${escapeHtml(device.error)}</span>` : ""}
      </div>
      <div class="ops">
        <button type="button" class="btn-link" data-act="edit">编辑</button>
        <button type="button" class="btn btn-sm btn-danger-outline" data-act="remove">移除</button>
        <button type="button" class="btn btn-sm ${
          draftsN ? "btn-primary" : ""
        }" data-act="issue" ${draftsN ? "" : "disabled"}>
          ${draftsN ? `下发 (${draftsN})` : "下发"}
        </button>
      </div>
    </div>
  `;

  const nameInput = card.querySelector('[data-act="name"]');
  nameInput.addEventListener("input", () => {
    device.name = nameInput.value.trim();
    persist();
  });
  nameInput.addEventListener("change", () => {
    device.name = nameInput.value.trim();
    persist();
  });

  card.querySelector('[data-act="copy-id"]').addEventListener("click", async () => {
    try {
      await copyText(device.deviceId);
      toast("已复制设备 ID", "ok");
    } catch (err) {
      toast(`复制失败: ${err.message || err}`, "error");
    }
  });

  card.querySelectorAll("input[data-field]").forEach((input) => {
    const applyValue = ({ commitEmptyToEcho }) => {
      const code = input.getAttribute("data-field");
      const maxRaw = input.getAttribute("data-max");
      const echo = input.getAttribute("data-echo") || "";
      let v = input.value.trim();

      // Allow clearing digits while typing; only restore echo on blur
      if (v === "") {
        device.drafts[code] = "";
        input.classList.remove("dirty", "invalid");
        if (commitEmptyToEcho && echo) {
          input.value = echo;
        }
        persist();
        updateIssueButtons();
        return;
      }

      if (maxRaw != null && isFiniteNumber(v)) {
        const max = Number(maxRaw);
        let n = Number(v);
        if (n > max) {
          n = max;
          v = String(max);
          input.value = v;
          input.classList.add("invalid");
          toast(`${DP_EDITABLE.find((f) => f.code === code)?.label || "该值"}不能超过上限 ${max}`, "error");
        } else {
          input.classList.remove("invalid");
        }
        if (n < 0) {
          n = 0;
          v = "0";
          input.value = v;
        }
      }

      if (v === echo) {
        device.drafts[code] = "";
        input.classList.remove("dirty", "invalid");
      } else {
        device.drafts[code] = v;
        input.classList.add("dirty");
      }
      persist();
      updateIssueButtons();
    };

    input.addEventListener("input", () => applyValue({ commitEmptyToEcho: false }));
    input.addEventListener("change", () => applyValue({ commitEmptyToEcho: false }));
    input.addEventListener("blur", () => applyValue({ commitEmptyToEcho: true }));
  });

  card.querySelector('[data-act="edit"]').addEventListener("click", () => openDeviceDialog(device));
  card.querySelector('[data-act="refresh"]').addEventListener("click", () => readDevice(home, device));
  card.querySelector('[data-act="remove"]').addEventListener("click", () => {
    if (!confirm(`移除设备 ${device.name || device.deviceId}？`)) return;
    home.devices = home.devices.filter((d) => d.uid !== device.uid);
    persist();
    render();
  });
  card.querySelector('[data-act="issue"]').addEventListener("click", () => issueDevice(home, device));

  mountInteractiveChart(card.querySelector("[data-soc-chart]"), device.socSeries || [], {
    unit: "%",
    emptyText: device.socMeta?.error || "暂无 SOC 历史",
    forceRange: [0, 100],
    height: 110,
  });

  return card;
}

function updateIssueButtons() {
  const home = activeHome();
  if (!home) return;
  const draftCount = countHomeDrafts(home);
  const issueAll = document.getElementById("btnIssueAll");
  issueAll.disabled = draftCount === 0;
  issueAll.textContent = draftCount ? `一键下发 (${draftCount})` : "一键下发";

  const famN = countFamilyDrafts(home);
  const famBtn = document.querySelector('#flowHost [data-act="family-issue"]');
  if (famBtn) {
    famBtn.disabled = famN === 0;
    famBtn.textContent = famN ? `下发 (${famN})` : "下发";
    famBtn.classList.toggle("on", famN > 0);
  }
  const famHint = document.querySelector("#flowHost .fb-foot-hint");
  if (famHint) {
    famHint.textContent = famN ? `${famN} 项待下发` : "无草稿";
  }

  document.querySelectorAll("#flowHost .u3[data-device-uid]").forEach((card) => {
    const uid = card.getAttribute("data-device-uid");
    const device = home.devices.find((d) => d.uid === uid);
    if (!device) return;
    const n = countDrafts(device);
    const btn = card.querySelector('[data-act="issue"]');
    if (!btn) return;
    btn.disabled = n === 0;
    btn.textContent = n ? `下发 (${n})` : "下发";
    btn.classList.toggle("on", n > 0);
  });
}

/** Drag terminal nodes to reposition (always available). */
function bindBusMove(home, host) {
  const svg = host.querySelector("svg.flow-svg");
  if (!svg) return;

  const toSvg = (clientX, clientY) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };

  svg.querySelectorAll("[data-bus-move]").forEach((hit) => {
    hit.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // wire plug is separate; don't steal its events
      if (e.target.closest?.(".wire-plug, [data-wire-src]")) return;
      e.preventDefault();
      e.stopPropagation();
      const busId = hit.getAttribute("data-bus-id");
      const g = hit.closest(".wire-bus-node");
      if (!busId || !g) return;
      const box = hit.getBBox();
      const start = toSvg(e.clientX, e.clientY);
      const originX = box.x;
      const originY = box.y;
      let moved = false;

      const onMove = (ev) => {
        const p = toSvg(ev.clientX, ev.clientY);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        g.setAttribute("transform", `translate(${dx}, ${dy})`);
        g.classList.add("moving");
      };
      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        g.classList.remove("moving");
        if (!moved) {
          g.removeAttribute("transform");
          return;
        }
        const p = toSvg(ev.clientX, ev.clientY);
        const nx = originX + (p.x - start.x);
        const ny = originY + (p.y - start.y);
        setBusPosition(home, busId, nx, ny);
        persist();
        render();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });
}

/** On-canvas drag wiring: bus ↔ device port. */
function bindWiringDrag(home, host) {
  const svg = host.querySelector("svg.flow-svg");
  if (!svg) return;
  const rubber = svg.querySelector("#wireRubberBand");
  let drag = null;

  const toSvg = (clientX, clientY) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };

  const clearRubber = () => {
    if (rubber) rubber.innerHTML = "";
    svg.classList.remove("wire-dragging");
    host.querySelectorAll(".wire-port-pad.drop-ok, .wire-port-pad.drop-bad").forEach((el) => {
      el.classList.remove("drop-ok", "drop-bad");
    });
  };

  const drawRubber = (x1, y1, x2, y2, ok) => {
    if (!rubber) return;
    rubber.innerHTML = `<path d="M${x1} ${y1} L${x2} ${y2}" class="wire-rubber${ok ? " ok" : ""}" />
      <circle cx="${x2}" cy="${y2}" r="5" class="wire-rubber-dot${ok ? " ok" : ""}"/>`;
  };

  const parseSrc = (el) => {
    const raw = el?.getAttribute?.("data-wire-src") || "";
    if (raw.startsWith("bus:")) {
      return {
        type: "bus",
        busId: raw.slice(4),
        kind: el.getAttribute("data-bus-kind") || wiringBusById(home, raw.slice(4))?.kind,
      };
    }
    if (raw.startsWith("device:")) {
      const [, uid, port] = raw.split(":");
      return { type: "device", deviceUid: uid, port };
    }
    return null;
  };

  const padCompatible = (src, pad) => {
    const port = pad.getAttribute("data-port");
    if (src.type === "bus") return kindsAllowedForPort(port).includes(src.kind);
    return false;
  };

  /** Snap to nearest compatible device port within screen px. */
  const nearestPad = (clientX, clientY, src, maxPx = 56) => {
    let best = null;
    let bestD = maxPx;
    host.querySelectorAll(".wire-port-pad").forEach((pad) => {
      if (!padCompatible(src, pad)) return;
      const c = pad.querySelector("circle:not(.wire-hit)") || pad.querySelector("circle");
      if (!c) return;
      const r = c.getBoundingClientRect();
      const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = pad;
      }
    });
    return best;
  };

  const nearestBus = (clientX, clientY, src, maxPx = 56) => {
    if (src.type !== "device") return null;
    let best = null;
    let bestD = maxPx;
    host.querySelectorAll(".wire-bus-node[data-bus-id]").forEach((node) => {
      const busId = node.getAttribute("data-bus-id");
      const kind =
        node.querySelector("[data-bus-kind]")?.getAttribute("data-bus-kind") ||
        wiringBusById(home, busId)?.kind;
      if (!kindsAllowedForPort(src.port).includes(kind)) return;
      const plug = node.querySelector(".wire-plug");
      const box = plug || node.querySelector("rect");
      if (!box) return;
      const r = box.getBoundingClientRect();
      const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    });
    return best;
  };

  const highlightTargets = (src) => {
    host.querySelectorAll(".wire-port-pad").forEach((pad) => {
      pad.classList.remove("drop-ok", "drop-bad");
      if (!src) return;
      if (src.type === "bus") {
        pad.classList.add(padCompatible(src, pad) ? "drop-ok" : "drop-bad");
      }
    });
  };

  const onMove = (e) => {
    if (!drag) return;
    const p = toSvg(e.clientX, e.clientY);
    let ok = false;
    if (drag.src.type === "bus") {
      ok = !!nearestPad(e.clientX, e.clientY, drag.src, 56);
    } else if (drag.src.type === "device") {
      ok = !!nearestBus(e.clientX, e.clientY, drag.src, 56);
    }
    drawRubber(drag.x0, drag.y0, p.x, p.y, ok);
  };

  const onUp = (e) => {
    if (!drag) return;
    const src = drag.src;
    const cur = drag;
    clearRubber();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    drag = null;

    let changed = false;
    if (src.type === "bus") {
      const dstPad =
        document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-wire-dst]") ||
        nearestPad(e.clientX, e.clientY, src, 56);
      const hitOtherBus = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".wire-bus-node");
      if (dstPad) {
        const uid = dstPad.getAttribute("data-device-uid");
        const port = dstPad.getAttribute("data-port");
        if (setDeviceWiringPort(home, uid, port, src.busId)) {
          changed = true;
          toast(`已连接 ${src.kind} → ${port}`, "ok");
        } else {
          toast("端子类型与端口不匹配（Grid→Grid / PV→PV / 家庭·Bypass→离网）", "error");
        }
      } else if (hitOtherBus) {
        toast("端子之间不能直接接线，请拖到一体机端口（PV / Grid / 离网）", "error");
      } else {
        const p = toSvg(e.clientX, e.clientY);
        const dx = p.x - cur.x0;
        const dy = p.y - cur.y0;
        if (dx * dx + dy * dy > 400) {
          toast("未落到端口，接线取消", "error");
        }
      }
    } else if (src.type === "device") {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const dstBus =
        el?.closest?.("[data-bus-id]") || nearestBus(e.clientX, e.clientY, src, 56);
      if (dstBus) {
        const busId = dstBus.getAttribute("data-bus-id");
        if (setDeviceWiringPort(home, src.deviceUid, src.port, busId)) {
          changed = true;
          toast(`已连接 ${src.port} → 端子`, "ok");
        } else {
          toast("端子类型与端口不匹配", "error");
        }
      } else {
        const p = toSvg(e.clientX, e.clientY);
        const dx = p.x - cur.x0;
        const dy = p.y - cur.y0;
        if (dx * dx + dy * dy > 400) {
          setDeviceWiringPort(home, src.deviceUid, src.port, "");
          changed = true;
          toast(`已断开 ${src.port}`, "ok");
        }
      }
    }

    host.querySelectorAll(".wire-port-pad.drop-ok, .wire-port-pad.drop-bad").forEach((n) => {
      n.classList.remove("drop-ok", "drop-bad");
    });

    if (changed) {
      persist();
      render();
    }
  };

  svg.querySelectorAll("[data-wire-src]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const src = parseSrc(el);
      if (!src) return;
      if (src.type === "bus" && !src.kind) {
        src.kind = wiringBusById(home, src.busId)?.kind;
      }
      const p = toSvg(e.clientX, e.clientY);
      drag = { src, x0: p.x, y0: p.y };
      svg.classList.add("wire-dragging");
      highlightTargets(src);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });

  svg.querySelectorAll(".wire-port-pad").forEach((pad) => {
    pad.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const uid = pad.getAttribute("data-device-uid");
      const port = pad.getAttribute("data-port");
      setDeviceWiringPort(home, uid, port, "");
      persist();
      toast(`已断开 ${port}`, "ok");
      render();
    });
  });

  const unlink = (el) => {
    const uid = el.getAttribute("data-device-uid");
    const port = el.getAttribute("data-port");
    if (!uid || !port) return;
    setDeviceWiringPort(home, uid, port, "");
    persist();
    toast(`已断开 ${port}`, "ok");
    render();
  };

  svg.querySelectorAll("[data-wire-unlink]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      unlink(el);
    });
  });
}

/** Bind clicks / drafts inside energy-flow foreignObject cards + rail. */
function bindFlowHost(home) {
  const host = document.getElementById("flowHost");
  if (!host || !home) return;

  host.querySelector('[data-act="toggle-wiring"]')?.addEventListener("click", () => {
    toggleWiringEditMode();
  });
  host.querySelector('[data-act="toggle-auto-refresh"]')?.addEventListener("click", () => {
    toggleAutoRefresh();
  });
  host.querySelector('[data-act="toggle-high-freq"]')?.addEventListener("click", () => {
    toggleHighFreqReporting();
  });
  host.querySelector('[data-act="clear-drafts"]')?.addEventListener("click", () => {
    const n = countHomeDrafts(home);
    if (!n) {
      toast("没有待下发的缓存参数", "ok");
      return;
    }
    if (!confirm(`清除当前家庭 ${n} 项待下发草稿？不会影响设备已生效参数。`)) return;
    const cleared = clearHomeDrafts(home);
    persist();
    updateIssueButtons();
    render();
    toast(`已清空 ${cleared} 项待下发缓存`, "ok");
  });
  host.querySelector('[data-act="manage-buses"]')?.addEventListener("click", () => {
    if (typeof openWiringDialog === "function") openWiringDialog();
    else if (typeof window.openWiringDialog === "function") window.openWiringDialog();
  });
  // legacy
  host.querySelector('[data-act="edit-wiring"]')?.addEventListener("click", () => toggleWiringEditMode(true));

  bindBusMove(home, host);
  if (wiringEditMode) bindWiringDrag(home, host);

  host.querySelectorAll(".u3[data-device-uid]").forEach((card) => {
    const device = home.devices.find((d) => d.uid === card.getAttribute("data-device-uid"));
    if (!device) return;

    card.querySelectorAll("input[data-field]").forEach((input) => {
      const applyValue = ({ commitEmptyToEcho }) => {
        const code = input.getAttribute("data-field");
        const maxRaw = input.getAttribute("data-max");
        const echo = input.getAttribute("data-echo") || "";
        let v = input.value.trim();
        if (v === "") {
          device.drafts[code] = "";
          input.classList.remove("dirty", "invalid");
          if (commitEmptyToEcho && echo) input.value = echo;
          persist();
          updateIssueButtons();
          return;
        }
        if (maxRaw != null && isFiniteNumber(v)) {
          const max = Number(maxRaw);
          let n = Number(v);
          if (n > max) {
            n = max;
            v = String(max);
            input.value = v;
            input.classList.add("invalid");
            toast(`${DP_EDITABLE.find((f) => f.code === code)?.label || "该值"}不能超过上限 ${max}`, "error");
          } else {
            input.classList.remove("invalid");
          }
          if (n < 0) {
            v = "0";
            input.value = v;
          }
        }
        if (v === echo) {
          device.drafts[code] = "";
          input.classList.remove("dirty", "invalid");
        } else {
          device.drafts[code] = v;
          input.classList.add("dirty");
        }
        persist();
        updateIssueButtons();
      };
      input.addEventListener("input", () => applyValue({ commitEmptyToEcho: false }));
      input.addEventListener("change", () => applyValue({ commitEmptyToEcho: false }));
      input.addEventListener("blur", () => applyValue({ commitEmptyToEcho: true }));
    });

    card.querySelectorAll("select[data-field]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const code = sel.getAttribute("data-field");
        const echo = sel.getAttribute("data-echo") || "";
        const v = String(sel.value ?? "").trim();
        if (v === "" || v === echo) {
          device.drafts[code] = "";
          sel.classList.remove("dirty");
        } else {
          device.drafts[code] = v;
          sel.classList.add("dirty");
        }
        persist();
        updateIssueButtons();
        if (code === "work_mode" && v === "manual") {
          openManualScheduleDialog(home, device, { kind: "manual" });
        } else if (code === "work_mode" && v === "time_of_use") {
          openManualScheduleDialog(home, device, { kind: "time_of_use" });
        } else if (code === "work_mode") {
          // re-render so 配置时段 button shows/hides
          render();
        }
      });
    });

    card.querySelector('[data-act="manual-schedule"]')?.addEventListener("click", () => {
      openManualScheduleDialog(home, device, { kind: "manual" });
    });
    card.querySelector('[data-act="tou-schedule"]')?.addEventListener("click", () => {
      openManualScheduleDialog(home, device, { kind: "time_of_use" });
    });

    card.querySelector('[data-act="edit"]')?.addEventListener("click", () => openDeviceDialog(device));
    card.querySelector('[data-act="refresh"]')?.addEventListener("click", () => readDevice(home, device));
    card.querySelector('[data-act="more-points"]')?.addEventListener("click", () => openDevicePointsDialog(home, device));
    card.querySelector('[data-act="reg-query"]')?.addEventListener("click", () => openRegQueryDialog(home, device));
    card.querySelector('[data-act="owner-strat"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openOwnerStrategyDialog(home, device);
    });
    card.querySelector('[data-act="copy-id"]')?.addEventListener("click", async () => {
      try {
        await copyText(device.deviceId);
        toast("已复制设备 ID", "ok");
      } catch (err) {
        toast(`复制失败: ${err.message || err}`, "error");
      }
    });
    card.querySelector('[data-act="remove"]')?.addEventListener("click", () => {
      if (!confirm(`移除设备 ${device.name || device.deviceId}？`)) return;
      home.devices = home.devices.filter((d) => d.uid !== device.uid);
      if (home.wiring?.devices) delete home.wiring.devices[device.uid];
      ensureHomeWiring(home);
      persist();
      render();
    });
    card.querySelector('[data-act="issue"]')?.addEventListener("click", () => issueDevice(home, device));
  });

  host.querySelectorAll(".rail-meter[data-meter-uid]").forEach((el) => {
    const meter = (home.meters || []).find((m) => m.uid === el.getAttribute("data-meter-uid"));
    if (!meter) return;
    el.querySelector('[data-act="meter-name"]')?.addEventListener("input", (e) => {
      meter.name = e.target.value.trim();
      persist();
    });
    el.querySelector('[data-act="meter-read"]')?.addEventListener("click", () => readMeter(home, meter));
    el.querySelector('[data-act="meter-edit"]')?.addEventListener("click", () => openMeterDialog(meter));
    el.querySelector('[data-act="meter-remove"]')?.addEventListener("click", () => {
      if (!confirm(`移除电表 ${meter.name || meter.deviceId}？`)) return;
      home.meters = home.meters.filter((x) => x.uid !== meter.uid);
      persist();
      render();
    });
  });

  host.querySelectorAll(".rail-dev[data-device-uid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.getAttribute("data-device-uid");
      const device = (home.devices || []).find((d) => d.uid === uid);
      host.querySelectorAll(".u3").forEach((c) => c.classList.toggle("active", c.getAttribute("data-device-uid") === uid));
      host.querySelectorAll(".rail-dev").forEach((b) => b.classList.toggle("active", b === btn));
      const card = host.querySelector(`.u3[data-device-uid="${CSS.escape(uid)}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      if (device?.deviceId) {
        // 无电表时：选中一体机 → 电网节点用其 DP26
        const meters = home.meters || [];
        const hasMeterVal = meters.some(
          (m) =>
            m.lastValue != null &&
            m.lastValue !== "" &&
            Number.isFinite(Number(m.lastValue))
        );
        if (!meters.length || !hasMeterVal) {
          if (home.lanMeterDeviceId !== device.deviceId) {
            home.lanMeterDeviceId = device.deviceId;
            persist();
            render();
            toast(`电网功率来源：${device.name || device.deviceId}（DP26）`, "ok");
            return;
          }
        }
        try {
          await copyText(device.deviceId);
          toast("已复制设备 ID", "ok");
        } catch (err) {
          toast(`复制失败: ${err.message || err}`, "error");
        }
      }
    });
  });

  host.querySelector('[data-act="lan-meter-device"]')?.addEventListener("change", (e) => {
    home.lanMeterDeviceId = String(e.target.value || "").trim();
    persist();
    render();
    const d = resolveLanMeterDevice(home);
    toast(
      d
        ? `电网功率来源：${d.name || d.deviceId}（DP26）`
        : "已清空电网功率来源一体机",
      "ok"
    );
  });

  if (!home.familyDrafts) home.familyDrafts = {};
  host.querySelectorAll("[data-fam-field]").forEach((el) => {
    const apply = () => {
      const code = el.getAttribute("data-fam-field");
      const echo = el.getAttribute("data-echo") || "";
      const v = String(el.value ?? "").trim();
      if (v === "" || v === echo) {
        home.familyDrafts[code] = "";
        el.classList.remove("dirty");
      } else {
        home.familyDrafts[code] = v;
        el.classList.add("dirty");
      }
      persist();
      updateIssueButtons();
      if (code === "work_mode" && v === "manual") {
        const device = (home.devices || [])[0];
        if (!device) {
          toast("家庭内没有一体机，无法配置手动时段", "error");
          return;
        }
        openManualScheduleDialog(home, device, { fromFamily: true, kind: "manual" });
      } else if (code === "work_mode" && v === "time_of_use") {
        const device = (home.devices || [])[0];
        if (!device) {
          toast("家庭内没有一体机，无法配置分时时段", "error");
          return;
        }
        openManualScheduleDialog(home, device, { fromFamily: true, kind: "time_of_use" });
      } else if (code === "work_mode") {
        render();
      }
    };
    if (el.tagName === "SELECT") {
      el.addEventListener("change", apply);
    } else {
      el.addEventListener("input", apply);
      el.addEventListener("change", apply);
    }
  });
  host.querySelector('[data-act="family-manual-schedule"]')?.addEventListener("click", () => {
    const device = (home.devices || [])[0];
    if (!device) {
      toast("家庭内没有一体机，无法配置手动时段", "error");
      return;
    }
    openManualScheduleDialog(home, device, { fromFamily: true, kind: "manual" });
  });
  host.querySelector('[data-act="family-tou-schedule"]')?.addEventListener("click", () => {
    const device = (home.devices || [])[0];
    if (!device) {
      toast("家庭内没有一体机，无法配置分时时段", "error");
      return;
    }
    openManualScheduleDialog(home, device, { fromFamily: true, kind: "time_of_use" });
  });
  host.querySelectorAll('[data-act="fb-fold"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const block = btn.closest(".fb-fold");
      if (!block) return;
      const key = block.getAttribute("data-fold");
      const collapsed = block.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      if (key) {
        const st = loadFamilyRailFold();
        st[key] = collapsed;
        saveFamilyRailFold(st);
      }
    });
  });
  host.querySelector('[data-act="family-issue"]')?.addEventListener("click", async () => {
    const r = await issueFamilyToDevices(home);
    if (r.ok) toast(`家庭参数已下发至 ${r.ok} 台设备${r.fail ? `（失败 ${r.fail}）` : ""}`, "ok");
    else toast(`家庭参数下发失败`, "error");
    render();
  });
}

/** ---------- Live view snapshots (localStorage) ---------- */

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function saveSnapshots(list) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list));
}

function buildLiveSnapshotMeta(home) {
  return {
    homeId: home.homeId || "",
    homeName: homeDisplayName(home),
    envHost: home.envHost || "",
    deviceCount: (home.devices || []).length,
    meterCount: (home.meters || []).length,
    devices: (home.devices || []).map((d) => ({
      name: d.name || "",
      deviceId: d.deviceId,
      values: { ...(d.values || {}) },
    })),
    meters: (home.meters || []).map((m) => ({
      name: m.name || "",
      deviceId: m.deviceId,
      isThirdParty: !!m.isThirdParty,
      lastValue: m.lastValue,
    })),
    familyValues: { ...(home.familyValues || {}) },
  };
}

function canvasToJpegDataUrl(sourceCanvas, maxW, quality) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (!w || !h) return sourceCanvas.toDataURL("image/jpeg", quality);
  const scale = w > maxW ? maxW / w : 1;
  if (scale >= 0.999) return sourceCanvas.toDataURL("image/jpeg", quality);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(sourceCanvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

/** Temporarily expand scroll/overflow clips so html2canvas can see full live view. */
function prepareFlowHostForCapture(host) {
  const restore = [];
  const setStyle = (el, props) => {
    if (!el) return;
    const prev = {};
    for (const [k, v] of Object.entries(props)) {
      prev[k] = el.style[k];
      el.style[k] = v;
    }
    restore.push(() => {
      for (const [k, v] of Object.entries(prev)) el.style[k] = v;
    });
  };

  const svg = host.querySelector(".flow-svg");
  const wrap = host.querySelector(".flow-svg-wrap");
  const panel = host.querySelector(".flow-panel");
  const rail = host.querySelector(".flow-rail");
  const main = host.querySelector(".flow-main");
  const shell = host.querySelector(".home-flow-shell");
  const svgW = Math.ceil(
    Number(svg?.getAttribute("width") || 0) || svg?.scrollWidth || svg?.getBoundingClientRect().width || 0
  );
  const svgH = Math.ceil(
    Number(svg?.getAttribute("height") || 0) || svg?.scrollHeight || svg?.getBoundingClientRect().height || 0
  );
  const railW = Math.ceil(rail?.scrollWidth || rail?.offsetWidth || 260);
  const gap = 14;
  const shellW = Math.max(railW + gap + svgW, host.scrollWidth || 0);

  setStyle(host, {
    overflow: "visible",
    height: "auto",
    maxHeight: "none",
    width: `${shellW}px`,
    maxWidth: "none",
  });
  setStyle(shell, {
    overflow: "visible",
    height: "auto",
    maxHeight: "none",
    alignItems: "start",
    gridTemplateColumns: `${railW}px ${Math.max(svgW, 800)}px`,
    width: `${shellW}px`,
    maxWidth: "none",
  });
  setStyle(rail, {
    position: "static",
    maxHeight: "none",
    overflow: "visible",
    height: "auto",
    width: `${railW}px`,
  });
  setStyle(main, {
    overflow: "visible",
    minWidth: `${svgW}px`,
    width: `${Math.max(svgW, 800)}px`,
    maxWidth: "none",
  });
  setStyle(panel, {
    overflow: "visible",
    height: "auto",
    maxHeight: "none",
    width: `${Math.max(svgW, 800)}px`,
    maxWidth: "none",
  });
  setStyle(wrap, {
    overflow: "visible",
    position: "relative",
    width: svgW ? `${svgW}px` : "auto",
    maxWidth: "none",
    height: svgH ? `${svgH + 12}px` : "auto",
  });
  if (svg) {
    setStyle(svg, {
      maxWidth: "none",
      width: svgW ? `${svgW}px` : "auto",
      height: svgH ? `${svgH}px` : "auto",
    });
  }
  host.querySelectorAll(".u3").forEach((card) => {
    setStyle(card, { overflow: "visible", height: "auto", maxHeight: "none" });
    card.querySelectorAll(".layer.l1").forEach((layer) => {
      setStyle(layer, { overflow: "visible", maxHeight: "none", flex: "0 0 auto" });
    });
  });

  // Hoist foreignObject cards to HTML overlays so css (.u3 etc.) is preserved.
  // html2canvas often drops styles for XHTML inside SVG foreignObject.
  const padX = 6;
  const padY = 6;
  if (svg && wrap) {
    svg.querySelectorAll("foreignObject").forEach((fo) => {
      const content = fo.firstElementChild;
      if (!content) return;
      const x = Number(fo.getAttribute("x") || 0);
      const y = Number(fo.getAttribute("y") || 0);
      const w = Number(fo.getAttribute("width") || 0) || content.offsetWidth || 180;
      const h = Number(fo.getAttribute("height") || 0) || content.scrollHeight || 400;
      const overlay = document.createElement("div");
      overlay.className = "snap-fo-overlay";
      overlay.setAttribute("data-snap-fo", "1");
      overlay.style.cssText = [
        "position:absolute",
        `left:${padX + x}px`,
        `top:${padY + y}px`,
        `width:${w}px`,
        `height:${h}px`,
        "z-index:6",
        "pointer-events:none",
        "box-sizing:border-box",
        "overflow:visible",
      ].join(";");
      const clone = content.cloneNode(true);
      clone.removeAttribute("xmlns");
      if (clone.style) {
        clone.style.width = "100%";
        clone.style.height = "100%";
        clone.style.boxSizing = "border-box";
      }
      overlay.appendChild(clone);
      wrap.appendChild(overlay);
      const prevVis = fo.style.visibility;
      fo.style.visibility = "hidden";
      restore.push(() => {
        fo.style.visibility = prevVis;
        overlay.remove();
      });
    });
  }

  void host.offsetHeight;
  return () => {
    while (restore.length) restore.pop()();
  };
}

async function captureLiveViewCanvas() {
  const el = document.getElementById("flowHost") || document.getElementById("tabLive");
  if (!el) throw new Error("未找到实时运行区域");
  if (typeof html2canvas !== "function") throw new Error("截图库未加载");
  const livePanel = document.getElementById("tabLive");
  const wasHidden = !!livePanel?.classList.contains("hidden");
  if (wasHidden && livePanel) livePanel.classList.remove("hidden");

  const undoExpand = prepareFlowHostForCapture(el);
  const wrap = el.querySelector(".flow-svg-wrap");
  const prevScrollLeft = wrap?.scrollLeft || 0;
  const prevScrollTop = wrap?.scrollTop || 0;
  if (wrap) {
    wrap.scrollLeft = 0;
    wrap.scrollTop = 0;
  }
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const svg = el.querySelector(".flow-svg");
    const rail = el.querySelector(".flow-rail");
    const shell = el.querySelector(".home-flow-shell");
    const svgW = Math.ceil(Number(svg?.getAttribute("width") || 0) || svg?.scrollWidth || 0);
    const svgH = Math.ceil(Number(svg?.getAttribute("height") || 0) || svg?.scrollHeight || 0);
    const railW = Math.ceil(rail?.scrollWidth || rail?.offsetWidth || 0);
    const fullW = Math.ceil(
      Math.max(
        el.scrollWidth,
        el.offsetWidth,
        shell?.scrollWidth || 0,
        railW + 14 + svgW,
        el.getBoundingClientRect().width
      )
    );
    const fullH = Math.ceil(
      Math.max(
        el.scrollHeight,
        el.offsetHeight,
        shell?.scrollHeight || 0,
        svgH + 180,
        el.getBoundingClientRect().height
      )
    );
    // Large boards: keep scale=1 to avoid canvas memory limits / blank captures
    const scale = fullW > 2200 ? 1 : Math.min(1.25, window.devicePixelRatio || 1);
    return await html2canvas(el, {
      backgroundColor: "#f8fafc",
      scale,
      width: fullW,
      height: fullH,
      windowWidth: fullW,
      windowHeight: fullH,
      x: 0,
      y: 0,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      useCORS: true,
      allowTaint: true,
      // Cards are hoisted to HTML overlays; FO path not needed
      foreignObjectRendering: false,
      logging: false,
      onclone: (_doc, cloned) => {
        const root = cloned.id === "flowHost" ? cloned : cloned.querySelector?.("#flowHost") || cloned;
        if (!root || !root.style) return;
        const cSvg = root.querySelector?.(".flow-svg");
        const cRail = root.querySelector?.(".flow-rail");
        const cW = Math.ceil(Number(cSvg?.getAttribute("width") || 0) || svgW || 0);
        const cH = Math.ceil(Number(cSvg?.getAttribute("height") || 0) || svgH || 0);
        const cRailW = Math.ceil(cRail?.scrollWidth || railW || 260);
        const cShellW = cRailW + 14 + Math.max(cW, 800);
        root.style.overflow = "visible";
        root.style.height = "auto";
        root.style.maxHeight = "none";
        root.style.width = `${cShellW}px`;
        root.style.maxWidth = "none";
        root.querySelectorAll?.(".home-flow-shell").forEach((n) => {
          n.style.overflow = "visible";
          n.style.height = "auto";
          n.style.maxHeight = "none";
          n.style.alignItems = "start";
          n.style.gridTemplateColumns = `${cRailW}px ${Math.max(cW, 800)}px`;
          n.style.width = `${cShellW}px`;
          n.style.maxWidth = "none";
        });
        root.querySelectorAll?.(".flow-main").forEach((n) => {
          n.style.overflow = "visible";
          n.style.minWidth = `${cW}px`;
          n.style.width = `${Math.max(cW, 800)}px`;
          n.style.maxWidth = "none";
        });
        root.querySelectorAll?.(".flow-panel").forEach((n) => {
          n.style.overflow = "visible";
          n.style.width = `${Math.max(cW, 800)}px`;
          n.style.maxWidth = "none";
        });
        root.querySelectorAll?.(".flow-svg-wrap").forEach((n) => {
          n.style.overflow = "visible";
          n.style.position = "relative";
          n.style.maxWidth = "none";
          n.style.width = cW ? `${cW}px` : "auto";
          n.style.height = cH ? `${cH + 12}px` : "auto";
        });
        root.querySelectorAll?.(".flow-svg").forEach((n) => {
          n.style.maxWidth = "none";
          if (cW) n.style.width = `${cW}px`;
          if (cH) n.style.height = `${cH}px`;
        });
        root.querySelectorAll?.(".flow-rail").forEach((n) => {
          n.style.position = "static";
          n.style.maxHeight = "none";
          n.style.overflow = "visible";
          n.style.height = "auto";
          n.style.width = `${cRailW}px`;
        });
        root.querySelectorAll?.(".u3").forEach((n) => {
          n.style.overflow = "visible";
          n.style.height = "auto";
        });
        root.querySelectorAll?.(".layer.l1").forEach((n) => {
          n.style.overflow = "visible";
          n.style.maxHeight = "none";
          n.style.flex = "0 0 auto";
        });
        // Keep hoisted overlays; hide FO originals in clone too
        root.querySelectorAll?.("foreignObject").forEach((n) => {
          n.style.visibility = "hidden";
        });
      },
    });
  } finally {
    if (wrap) {
      wrap.scrollLeft = prevScrollLeft;
      wrap.scrollTop = prevScrollTop;
    }
    undoExpand();
    if (wasHidden && livePanel && homeTab !== "live") livePanel.classList.add("hidden");
  }
}

async function fetchScheduleWeekForSnapshot(home, device, kind) {
  const res = await apiGet("/api/proxy/property-query", home, {
    page: "1",
    deviceId: device.deviceId,
  });
  const list = unwrapResult(res);
  const items = Array.isArray(list) ? list : list?.data || list?.items || [];
  return msParsePropertyList(items, kind);
}

function scheduleModeLabel(mode) {
  return String(mode) === MS_MODE_DISCHARGE ? "放电" : "充电";
}

function scheduleDayLabel(dayKey) {
  const hit = MS_DAYS.find((d) => d.key === dayKey);
  return hit ? hit.label : dayKey === MS_TOU_DAY ? "分时" : dayKey;
}

/** Flatten active slots → table rows for snapshot footer. */
function buildScheduleTableModel(week, kind) {
  const isTou = kind === MS_KIND_TOU;
  const headers = isTou
    ? ["时段", "开始", "结束", "模式", "功率(W)", "目标SOC(%)", "弃光", "忽略防逆流"]
    : ["星期", "时段", "开始", "结束", "模式", "功率(W)", "目标SOC(%)", "弃光", "忽略防逆流"];
  const rows = [];
  for (const day of msDayKeys(kind)) {
    const slots = week?.[day] || [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const range = msSlotRange(slot);
      if (!range) continue;
      const cells = isTou
        ? [
            String(i + 1),
            msMinToLabel(range.start),
            msMinToLabel(range.end),
            scheduleModeLabel(slot.mode),
            String(slot.mode) === MS_MODE_DISCHARGE ? String(slot.power ?? "") : "—",
            String(slot.soc ?? ""),
            slot.pv_abandon ? "是" : "否",
            slot.ignore_anti_backflow ? "是" : "否",
          ]
        : [
            scheduleDayLabel(day),
            String(i + 1),
            msMinToLabel(range.start),
            msMinToLabel(range.end),
            scheduleModeLabel(slot.mode),
            String(slot.mode) === MS_MODE_DISCHARGE ? String(slot.power ?? "") : "—",
            String(slot.soc ?? ""),
            slot.pv_abandon ? "是" : "否",
            slot.ignore_anti_backflow ? "是" : "否",
          ];
      rows.push(cells);
    }
  }
  return { headers, rows };
}

function effectiveFamilyWorkMode(home) {
  return String(effectiveFamilyValue(home, "work_mode") || "").trim();
}

/**
 * Draw schedule table below base screenshot and return a new canvas.
 */
function composeSnapshotWithScheduleTable(baseCanvas, tableModel, title) {
  const pad = 24;
  const titleH = 36;
  const rowH = 28;
  const headH = 30;
  const colN = tableModel.headers.length;
  const emptyHint = !tableModel.rows.length;
  const bodyRows = emptyHint ? 1 : tableModel.rows.length;
  const tableH = titleH + headH + bodyRows * rowH + pad * 2;
  const width = Math.max(baseCanvas.width, 900);
  const height = baseCanvas.height + tableH;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);
  // top: live screenshot (centered if narrower)
  const dx = Math.max(0, Math.floor((width - baseCanvas.width) / 2));
  ctx.drawImage(baseCanvas, dx, 0);
  // bottom panel
  const top = baseCanvas.height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, top, width, tableH);
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(0, top + 0.5);
  ctx.lineTo(width, top + 0.5);
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(title, pad, top + pad + titleH / 2);

  const tableTop = top + pad + titleH;
  const tableWidth = width - pad * 2;
  const colW = tableWidth / colN;
  const drawRow = (cells, y, isHead) => {
    ctx.fillStyle = isHead ? "#eff6ff" : "#ffffff";
    ctx.fillRect(pad, y, tableWidth, isHead ? headH : rowH);
    ctx.strokeStyle = "#cbd5e1";
    ctx.strokeRect(pad + 0.5, y + 0.5, tableWidth - 1, (isHead ? headH : rowH) - 1);
    for (let c = 1; c < colN; c++) {
      const x = pad + colW * c;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + (isHead ? headH : rowH));
      ctx.stroke();
    }
    ctx.fillStyle = isHead ? "#1e40af" : "#0f172a";
    ctx.font = `${isHead ? "bold " : ""}12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    ctx.textBaseline = "middle";
    for (let c = 0; c < colN; c++) {
      const text = String(cells[c] ?? "");
      const cx = pad + colW * c + 8;
      ctx.fillText(text, cx, y + (isHead ? headH : rowH) / 2, colW - 16);
    }
  };
  drawRow(tableModel.headers, tableTop, true);
  if (emptyHint) {
    drawRow(["（未读到有效时段）", ...Array(colN - 1).fill("")], tableTop + headH, false);
  } else {
    tableModel.rows.forEach((r, i) => drawRow(r, tableTop + headH + i * rowH, false));
  }
  return out;
}

async function appendScheduleTableIfNeeded(home, baseCanvas) {
  const mode = effectiveFamilyWorkMode(home);
  if (mode !== MS_KIND_TOU && mode !== MS_KIND_MANUAL) {
    return { canvas: baseCanvas, schedule: null };
  }
  const device = (home.devices || [])[0];
  if (!device?.deviceId) {
    toast("家庭模式为时段类，但无一体机可读时段", "error");
    return { canvas: baseCanvas, schedule: null };
  }
  const kind = mode === MS_KIND_TOU ? MS_KIND_TOU : MS_KIND_MANUAL;
  const modeLabel = kind === MS_KIND_TOU ? "分时用电" : "手动设置";
  try {
    const parsed = await fetchScheduleWeekForSnapshot(home, device, kind);
    const table = buildScheduleTableModel(parsed.week, kind);
    const title = `${modeLabel}时段表 · 模板设备 ${device.name || device.deviceId} · 共 ${table.rows.length} 段`;
    const canvas = composeSnapshotWithScheduleTable(baseCanvas, table, title);
    return {
      canvas,
      schedule: {
        kind,
        modeLabel,
        deviceId: device.deviceId,
        deviceName: device.name || "",
        headers: table.headers,
        rows: table.rows,
      },
    };
  } catch (err) {
    console.warn("appendScheduleTableIfNeeded", err);
    toast(`时段表读取失败：${err.message || err}（已保存实况截图）`, "error");
    return { canvas: baseCanvas, schedule: null };
  }
}

async function saveLiveSnapshot() {
  const home = activeHome();
  if (!home) {
    toast("请先选择家庭", "error");
    return;
  }
  const btn = document.getElementById("btnSaveSnapshot");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "截图中…";
  }
  try {
    if (homeTab !== "live") setHomeTab("live");
    await new Promise((r) => setTimeout(r, 80));
    let canvas = await captureLiveViewCanvas();
    const mode = effectiveFamilyWorkMode(home);
    let scheduleMeta = null;
    if (mode === MS_KIND_TOU || mode === MS_KIND_MANUAL) {
      if (btn) btn.textContent = "读取时段…";
      const composed = await appendScheduleTableIfNeeded(home, canvas);
      canvas = composed.canvas;
      scheduleMeta = composed.schedule;
    }
    const image = canvasToJpegDataUrl(canvas, SNAPSHOT_MAX_W, SNAPSHOT_JPEG_Q);
    const thumb = canvasToJpegDataUrl(canvas, 360, 0.65);
    const defaultName = `场景 ${fmtTime(Date.now())}`;
    let sceneName = defaultName;
    const typed = window.prompt("请输入场景名称", defaultName);
    if (typed == null) {
      toast("已取消保存快照", "error");
      return;
    }
    sceneName = String(typed).trim() || defaultName;
    const meta = buildLiveSnapshotMeta(home);
    if (scheduleMeta) meta.schedule = scheduleMeta;
    meta.workMode = mode || meta.familyValues?.work_mode || "";
    const item = {
      id: uid(),
      at: Date.now(),
      name: sceneName,
      image,
      thumb,
      meta,
    };
    let list = loadSnapshots();
    list.unshift(item);
    while (list.length > SNAPSHOT_MAX) list.pop();
    try {
      saveSnapshots(list);
    } catch (quotaErr) {
      while (list.length > 1) {
        list.pop();
        try {
          saveSnapshots(list);
          break;
        } catch (_) {}
      }
      if (list.length === 1) {
        try {
          saveSnapshots(list);
        } catch (_) {
          throw new Error("浏览器存储空间不足，请先清空部分快照");
        }
      }
    }
    toast(`快照「${sceneName}」已保存（共 ${loadSnapshots().length} 条）`, "ok");
    setHomeTab("snapshots");
  } catch (err) {
    console.warn("saveLiveSnapshot", err);
    toast(`保存快照失败：${err.message || err}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "保存快照";
    }
  }
}

function snapshotDisplayName(item) {
  const n = String(item?.name || "").trim();
  if (n) return n;
  return item?.meta?.homeName ? `${item.meta.homeName} · ${fmtTime(item.at)}` : `场景 ${fmtTime(item?.at)}`;
}

/** Safe filename from scene name, keep CJK / letters / digits. */
function snapshotFileName(name, at) {
  let base = String(name || "").trim() || `场景_${at || Date.now()}`;
  base = base
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  if (!base) base = `场景_${at || Date.now()}`;
  return `${base}.jpg`;
}

function downloadSnapshot(id, preferredName) {
  const item = loadSnapshots().find((x) => x.id === id);
  if (!item?.image) {
    toast("找不到快照图片", "error");
    return;
  }
  const name = String(preferredName || "").trim() || snapshotDisplayName(item);
  const a = document.createElement("a");
  a.href = item.image;
  a.download = snapshotFileName(name, item.at);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renameSnapshot(id, name) {
  const next = String(name || "").trim();
  if (!next) {
    toast("场景名称不能为空", "error");
    mountSnapshotsPanel();
    return false;
  }
  const list = loadSnapshots();
  const hit = list.find((x) => x.id === id);
  if (!hit) return false;
  hit.name = next;
  try {
    saveSnapshots(list);
  } catch (err) {
    toast(`保存名称失败：${err.message || err}`, "error");
    return false;
  }
  return true;
}

function deleteSnapshot(id) {
  const list = loadSnapshots().filter((x) => x.id !== id);
  saveSnapshots(list);
  mountSnapshotsPanel();
  toast("已删除快照", "ok");
}

function clearAllSnapshots() {
  if (!loadSnapshots().length) return;
  if (!confirm("清空本机全部运行快照？此操作不可恢复。")) return;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch (_) {}
  mountSnapshotsPanel();
  toast("已清空快照", "ok");
}

function openSnapshotPreview(id) {
  const item = loadSnapshots().find((x) => x.id === id);
  if (!item?.image) return;
  const dlg = document.getElementById("dlgSnapshotPreview");
  const img = document.getElementById("snapPreviewImg");
  const meta = document.getElementById("snapPreviewMeta");
  if (!dlg || !img) {
    window.open(item.image, "_blank");
    return;
  }
  img.src = item.image;
  const m = item.meta || {};
  meta.textContent = `${snapshotDisplayName(item)} · ${m.homeName || "家庭"} · ${fmtTime(item.at)} · ${m.deviceCount || 0} 台设备`;
  dlg.showModal();
}

function openSnapshotFullscreen(src) {
  const layer = document.getElementById("snapFullscreen");
  const img = document.getElementById("snapFullscreenImg");
  if (!layer || !img || !src) return;
  img.src = src;
  layer.hidden = false;
  layer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeSnapshotFullscreen() {
  const layer = document.getElementById("snapFullscreen");
  const img = document.getElementById("snapFullscreenImg");
  if (!layer) return;
  layer.hidden = true;
  layer.classList.add("hidden");
  if (img) img.removeAttribute("src");
  document.body.style.overflow = "";
}

function mountSnapshotsPanel() {
  const host = document.getElementById("snapshotsHost");
  const maxHint = document.getElementById("snapMaxHint");
  if (maxHint) maxHint.textContent = String(SNAPSHOT_MAX);
  if (!host) return;
  const home = activeHome();
  const all = loadSnapshots();
  const list = home
    ? all.filter(
        (s) =>
          !s.meta?.homeId ||
          !home.homeId ||
          String(s.meta.homeId) === String(home.homeId) ||
          s.meta.homeName === homeDisplayName(home)
      )
    : all;
  const shown = list.length ? list : all;
  if (!shown.length) {
    host.innerHTML = `<div class="charts-empty">暂无快照。在「实时运行情况」点右上角「保存快照」即可。</div>`;
    return;
  }
  host.innerHTML = shown
    .map((s) => {
      const m = s.meta || {};
      const title = snapshotDisplayName(s);
      const sub = `${m.homeName || "家庭"} · ${fmtTime(s.at)} · ${m.deviceCount ?? "—"} 机 · ${(s.image?.length || 0) >> 10} KB`;
      return `<article class="snap-card" data-snap-id="${escapeAttr(s.id)}">
        <button type="button" class="snap-thumb" data-act="snap-preview" title="查看大图">
          <img src="${escapeAttr(s.thumb || s.image)}" alt="snapshot" loading="lazy" />
        </button>
        <div class="snap-body">
          <label class="snap-name-lab">
            <span>场景名称</span>
            <input type="text" class="snap-name-input" data-act="snap-rename"
              value="${escapeAttr(title)}" maxlength="64" placeholder="输入场景名称" />
          </label>
          <div class="snap-sub">${escapeHtml(sub)}</div>
          <div class="snap-ops">
            <button type="button" class="btn btn-sm btn-ghost" data-act="snap-preview">查看</button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="snap-download">下载</button>
            <button type="button" class="btn-link danger" data-act="snap-delete">删除</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
  host.querySelectorAll(".snap-card").forEach((card) => {
    const id = card.getAttribute("data-snap-id");
    card.querySelectorAll('[data-act="snap-preview"]').forEach((btn) => {
      btn.addEventListener("click", () => openSnapshotPreview(id));
    });
    const nameInput = card.querySelector('[data-act="snap-rename"]');
    nameInput?.addEventListener("change", () => {
      if (renameSnapshot(id, nameInput.value)) toast("场景名称已更新", "ok");
    });
    nameInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        nameInput.blur();
      }
    });
    card.querySelector('[data-act="snap-download"]')?.addEventListener("click", () => {
      const liveName = nameInput?.value?.trim() || "";
      // persist rename first if input differs from stored
      if (liveName) renameSnapshot(id, liveName);
      downloadSnapshot(id, liveName);
    });
    card.querySelector('[data-act="snap-delete"]')?.addEventListener("click", () => {
      if (!confirm("删除该快照？")) return;
      deleteSnapshot(id);
    });
  });
}

/** Historical charts tab: meter power + device SOC. */
function mountChartsPanel(home) {
  const row = document.getElementById("chartsHost");
  if (!row) return;
  row.querySelectorAll("[data-soc-chart], [data-power-chart]").forEach((el) => {
    if (typeof el._chartCleanup === "function") el._chartCleanup();
  });
  const parts = [];
  for (const meter of home.meters || []) {
    parts.push(`<div class="flow-soc-card" data-meter-uid="${escapeAttr(meter.uid)}">
      <div class="soc-title"><span>${escapeHtml(meter.name || meter.deviceId)} · 功率${
        meter.isThirdParty ? "（三方·grid_power）" : ""
      }</span>
        <span>${meter.lastValue == null ? "—" : `${meter.lastValue}W`}</span></div>
      <div class="soc-stats">
        ${meter.powerSeries?.length ? `<span>${meter.powerSeries.length} 点</span>` : ""}
        ${meter.error ? `<span class="err">${escapeHtml(meter.error)}</span>` : ""}
        ${meter.lastReadAt ? `<span>${escapeHtml(fmtTime(meter.lastReadAt))}</span>` : ""}
      </div>
      <div class="soc-chart" data-power-chart></div>
    </div>`);
  }
  for (const device of home.devices || []) {
    parts.push(`<div class="flow-soc-card" data-device-uid="${escapeAttr(device.uid)}">
      <div class="soc-title"><span>${escapeHtml(device.name || device.deviceId)} · SOC</span>
        <span>${device.values?.current_soc != null ? `${device.values.current_soc}%` : "—"}</span></div>
      <div class="soc-stats soc-stats-live"></div>
      <div class="soc-chart" data-soc-chart></div>
    </div>`);
  }
  row.innerHTML =
    parts.join("") ||
    `<div class="charts-empty">暂无曲线数据。请先在「实时运行情况」中添加电表/设备并点击「一键读取」。</div>`;

  row.querySelectorAll("[data-meter-uid]").forEach((card) => {
    const meter = (home.meters || []).find((m) => m.uid === card.getAttribute("data-meter-uid"));
    if (!meter) return;
    mountInteractiveChart(card.querySelector("[data-power-chart]"), meter.powerSeries || [], {
      unit: "W",
      includeZero: true,
      emptyText: "暂无功率历史",
      height: 110,
      syncGroup: "home-trends",
    });
  });
  row.querySelectorAll("[data-device-uid]").forEach((card) => {
    const device = home.devices.find((d) => d.uid === card.getAttribute("data-device-uid"));
    if (!device) return;
    patchDeviceSocStats(home, device);
    mountInteractiveChart(card.querySelector("[data-soc-chart]"), device.socSeries || [], {
      unit: "%",
      emptyText: device.socMeta?.error || "暂无 SOC 历史",
      forceRange: [0, 100],
      height: 110,
      syncGroup: "home-trends",
    });
  });
}

function render() {
  renderSidebar();
  renderMain();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/* ---------- Dialogs ---------- */

let editingHomeUid = null;
let editingDeviceUid = null;
let editingMeterUid = null;

function isLocalHostPage() {
  return /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
}

const REMOTE_PUSH_URL_KEY = "groupAppControl.remotePushUrl";
const DEFAULT_REMOTE_PUSH_URL = "http://172.16.239.236:5178";

function getRemotePushUrl() {
  const input = document.getElementById("remotePushUrl");
  const fromInput = (input?.value || "").trim();
  if (fromInput) return fromInput.replace(/\/$/, "");
  try {
    const saved = (localStorage.getItem(REMOTE_PUSH_URL_KEY) || "").trim();
    if (saved) return saved.replace(/\/$/, "");
  } catch (_) {
    /* ignore */
  }
  return DEFAULT_REMOTE_PUSH_URL;
}

function openLoginDialog() {
  const home = activeHome();
  const host = home?.envHost || Object.keys(ENV_CONFIG)[1];
  fillEnvSelect(document.getElementById("loginEnv"), host, true);
  document.getElementById("loginCookie").value = state.cookies[host] || "";
  const onLocal = isLocalHostPage();
  const pushRow = document.getElementById("remotePushRow");
  const autoBtn = document.getElementById("btnAutoCookie");
  if (pushRow) pushRow.classList.toggle("hidden", !onLocal);
  if (autoBtn) autoBtn.classList.toggle("hidden", !onLocal);
  const urlInput = document.getElementById("remotePushUrl");
  if (urlInput && onLocal) {
    try {
      urlInput.value =
        localStorage.getItem(REMOTE_PUSH_URL_KEY) || DEFAULT_REMOTE_PUSH_URL;
    } catch (_) {
      urlInput.value = DEFAULT_REMOTE_PUSH_URL;
    }
  }
  document.getElementById("loginHint").textContent = state.cookies[host]
    ? onLocal
      ? "已保存 Cookie。可「自动获取」刷新，或「推送到虚拟机」同步给别人用的服务。"
      : "已保存 Cookie。虚拟机端请用本机推送更新，或在此手动粘贴覆盖。"
    : onLocal
      ? "推荐：本机「自动获取」→「推送到虚拟机」。也可手动从 DevTools 粘贴。"
      : "虚拟机无法读你电脑的 Chrome。请在本机 http://127.0.0.1:5178 自动获取后点「推送到虚拟机」，或在此手动粘贴。";
  document.getElementById("dlgLogin").showModal();
}

/**
 * Pull SSO_USER_TOKEN via server-side tuya-sso-token (local Chrome only).
 * @param {{force?: boolean, quiet?: boolean, skipRender?: boolean, host?: string}} opts
 */
async function refreshSsoCookie(opts = {}) {
  const force = !!opts.force;
  const quiet = !!opts.quiet;
  const skipRender = !!opts.skipRender;
  const host =
    opts.host ||
    document.getElementById("loginEnv")?.value ||
    activeHome()?.envHost ||
    Object.keys(ENV_CONFIG)[1];
  const onLocal = isLocalHostPage();
  if (!onLocal) {
    const msg =
      "虚拟机页面不支持自动获取。请在本机打开 http://127.0.0.1:5178，自动获取后点「推送到虚拟机」，或在此手动粘贴 Cookie";
    if (!quiet) toast(msg, "error");
    const hint = document.getElementById("loginHint");
    if (hint) hint.textContent = msg;
    throw new Error(msg);
  }

  const payload = {
    force,
    host,
    applyAll: true,
    url: host ? `https://${host}` : "",
  };

  const res = await fetch("/api/sso/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) {
    let msg = json.error || "自动获取失败";
    if (json.hint) msg = `${msg}（${json.hint}）`;
    if (!quiet) toast(msg, "error");
    const hint = document.getElementById("loginHint");
    if (hint) {
      hint.textContent = json.detail
        ? `${msg}（${String(json.detail).slice(0, 180)}）`
        : msg;
    }
    throw new Error(msg);
  }
  if (json.cookies && typeof json.cookies === "object") {
    state.cookies = { ...state.cookies, ...json.cookies };
  }
  const ta = document.getElementById("loginCookie");
  if (ta && host) ta.value = state.cookies[host] || "";
  const n = (json.appliedHosts || []).length;
  if (!quiet) {
    toast(
      `已自动填入 SSO（${n} 个环境）${json.preview ? " · " + json.preview : ""}`,
      "ok"
    );
  }
  const hint = document.getElementById("loginHint");
  if (hint && !skipRender) {
    hint.textContent = `已自动更新 SSO_USER_TOKEN（来源：${
      json.source || "sso-token"
    }）。需要同步虚拟机时再点「推送到虚拟机」。`;
  }
  persist();
  if (!skipRender) render();
  return json;
}

/**
 * Push local cookies to a remote groupAppControl (VM).
 * @param {{url?: string, refreshFirst?: boolean, quiet?: boolean}} opts
 */
async function pushCookiesToRemote(opts = {}) {
  const quiet = !!opts.quiet;
  if (!isLocalHostPage()) {
    const msg = "请在本机页面执行推送";
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  if (opts.refreshFirst) {
    await refreshSsoCookie({ force: true, quiet: true, skipRender: true });
  }
  const remote = (opts.url || getRemotePushUrl()).replace(/\/$/, "");
  if (!remote) {
    const msg = "请填写虚拟机地址，例如 http://172.16.239.236:5178";
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  try {
    localStorage.setItem(REMOTE_PUSH_URL_KEY, remote);
  } catch (_) {
    /* ignore */
  }
  const cookies = state.cookies || {};
  const n = Object.keys(cookies).filter((k) => String(cookies[k] || "").trim()).length;
  if (!n) {
    const msg = "本机尚无 Cookie，请先「自动获取」或粘贴保存";
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  let res;
  try {
    res = await fetch(`${remote}/api/cookies/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookies, merge: true }),
    });
  } catch (err) {
    const msg = `连不上虚拟机 ${remote}（${err?.message || err}）`;
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const msg = json.error || `推送失败 HTTP ${res.status}`;
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  const imported = json.imported ?? n;
  if (!quiet) toast(`已推送 ${imported} 条 Cookie → ${remote}`, "ok");
  const hint = document.getElementById("loginHint");
  if (hint) hint.textContent = `已推送到 ${remote}（合并写入虚拟机 store）。`;
  return json;
}

function openHomeDialog(home) {
  editingHomeUid = home?.uid || null;
  const isEdit = !!home;
  document.getElementById("dlgHomeTitle").textContent = isEdit ? "编辑家庭" : "新增家庭";
  const envSel = document.getElementById("homeEnv");
  fillEnvSelect(envSel, home?.envHost || "newenergy-operation-cn.tuya-inc.com", false);
  envSel.disabled = isEdit;
  const hint = document.getElementById("homeEnvHint");
  if (hint) hint.hidden = !isEdit;
  document.getElementById("homeId").value = home?.homeId || "";
  document.getElementById("homeName").value = home?.name || "";
  document.getElementById("homeAuthId").value = home?.authId || "";
  document.getElementById("dlgHome").showModal();
}

function openDeviceDialog(device) {
  editingDeviceUid = device?.uid || null;
  document.getElementById("dlgDeviceTitle").textContent = device ? "编辑设备" : "新增设备";
  document.getElementById("deviceId").value = device?.deviceId || "";
  document.getElementById("deviceName").value = device?.name || "";
  document.getElementById("dlgDevice").showModal();
}

function syncMeterDialogMode() {
  const isThird = document.getElementById("meterThirdParty")?.value === "1";
  const idWrap = document.getElementById("meterIdWrap");
  const devWrap = document.getElementById("meterDeviceWrap");
  const meterId = document.getElementById("meterId");
  const meterSel = document.getElementById("meterDeviceSelect");
  const hint = document.getElementById("meterDlgHint");
  const regionHint = document.getElementById("meterRegionHint");
  idWrap?.classList.toggle("hidden", isThird);
  devWrap?.classList.toggle("hidden", !isThird);
  if (meterId) meterId.required = !isThird;
  if (meterSel) meterSel.required = isThird;
  if (hint) {
    hint.innerHTML = isThird
      ? "三方电表：选择一台一体机，实时/历史功率取该机 <code>dp 26 / grid_power</code>（局域网电表配对功率 / meter_power）。"
      : "PID 固定为 <code>7sndpedu8g2tkzvi</code>，功率曲线走 Hestia bizlog（dpId 29 / active_power）。";
  }
  if (regionHint) {
    regionHint.classList.toggle("hidden", isThird);
  }
}

function fillMeterDeviceSelect(home, selectedId) {
  const sel = document.getElementById("meterDeviceSelect");
  if (!sel) return;
  const devices = home?.devices || [];
  sel.innerHTML =
    `<option value="">请选择一体机</option>` +
    devices
      .map(
        (d) =>
          `<option value="${escapeAttr(d.deviceId)}" ${
            String(selectedId || "") === String(d.deviceId) ? "selected" : ""
          }>${escapeHtml(d.name || d.deviceId)}（${escapeHtml(d.deviceId)}）</option>`
      )
      .join("");
  if (!devices.length) {
    sel.innerHTML = `<option value="">家庭内暂无一体机，请先添加设备</option>`;
  }
}

function openMeterDialog(meter) {
  editingMeterUid = meter?.uid || null;
  const home = activeHome();
  document.getElementById("dlgMeterTitle").textContent = meter ? "编辑电表" : "添加电表";
  const isThird = !!meter?.isThirdParty;
  document.getElementById("meterThirdParty").value = isThird ? "1" : "0";
  document.getElementById("meterId").value = isThird ? "" : meter?.deviceId || "";
  document.getElementById("meterName").value = meter?.name || "";
  fillMeterDeviceSelect(home, isThird ? meter?.deviceId : "");
  syncMeterDialogMode();
  const hint = document.getElementById("meterRegionHint");
  if (hint && home && !isThird) {
    const hHost = hestiaHostForHome(home);
    hint.textContent = `Hestia 区域随家庭环境自动跟随：${envLabel(home.envHost)} → ${hHost}`;
  }
  document.getElementById("dlgMeter").showModal();
}

/* ---------- Schedule dialog: manual (按星期) / time_of_use (分时, 无星期) ---------- */

const MS_DAYS = [
  { key: "mon", label: "周一" },
  { key: "tue", label: "周二" },
  { key: "wed", label: "周三" },
  { key: "thu", label: "周四" },
  { key: "fri", label: "周五" },
  { key: "sat", label: "周六" },
  { key: "sun", label: "周日" },
];
const MS_KIND_MANUAL = "manual";
const MS_KIND_TOU = "time_of_use";
const MS_TOU_DAY = "tou";
const MS_SLOT_N = 8;
const MS_FIELDS = ["start", "end", "mode", "power", "soc", "pv_abandon", "ignore_anti_backflow"];
const MS_MODE_CHARGE = "0";
const MS_MODE_DISCHARGE = "1";
const MS_FUNC_BATCH = 20; // function_set raw maxlen 128 ≈ 21 entries

/** @type {any} */
let msCtx = null;

function msIsTou() {
  return msCtx?.kind === MS_KIND_TOU;
}

function msDayKeys(kind = msCtx?.kind) {
  return kind === MS_KIND_TOU ? [MS_TOU_DAY] : MS_DAYS.map((d) => d.key);
}

function msCode(day, slotIdx, field, kind = msCtx?.kind) {
  if (kind === MS_KIND_TOU) return `day_time${slotIdx + 1}_${field}`;
  return `user_${day}_day_time${slotIdx + 1}_${field}`;
}

function msEmptySlot() {
  return {
    start: "0000",
    end: "0000",
    mode: MS_MODE_CHARGE,
    power: "0",
    soc: "80",
    pv_abandon: false,
    ignore_anti_backflow: false,
  };
}

function msEmptyWeek(kind = MS_KIND_MANUAL) {
  const week = {};
  for (const key of msDayKeys(kind)) {
    week[key] = Array.from({ length: MS_SLOT_N }, () => msEmptySlot());
  }
  return week;
}

function msCloneWeek(week) {
  return JSON.parse(JSON.stringify(week));
}

/** HHMM string ↔ input[type=time] HH:MM */
function msHmmToTime(hmm) {
  const s = String(hmm || "0000").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

function msTimeToHmm(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "0000";
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const min = Math.max(0, Math.min(59, Number(m[2])));
  return `${String(h).padStart(2, "0")}${String(min).padStart(2, "0")}`;
}

/** register3_hourmin_1: high byte = hour, low byte = minute (e.g. 03:30 → 0x031e) */
function msHmmToReg(hmm) {
  const s = String(hmm || "0000").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  let h = Number(s.slice(0, 2));
  let m = Number(s.slice(2, 4));
  if (h === 24 && m === 0) {
    // 24:00 → end of day; store as 24:00 if device accepts, else 23:59
    return (24 << 8) | 0;
  }
  h = Math.max(0, Math.min(23, h));
  m = Math.max(0, Math.min(59, m));
  return ((h & 0xff) << 8) | (m & 0xff);
}

function msParseBool(v) {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "True") return true;
  return false;
}

function msSlotFromProps(byCode, day, slotIdx, kind) {
  const slot = msEmptySlot();
  const get = (f) => byCode[msCode(day, slotIdx, f, kind)];
  const start = get("start");
  const end = get("end");
  const mode = get("mode");
  const power = get("power");
  const soc = get("soc");
  const pv = get("pv_abandon");
  const ign = get("ignore_anti_backflow");
  if (start?.value != null && start.value !== "") slot.start = String(start.value).padStart(4, "0").slice(-4);
  if (end?.value != null && end.value !== "") slot.end = String(end.value).padStart(4, "0").slice(-4);
  if (mode?.value != null && mode.value !== "") slot.mode = String(mode.value);
  if (power?.value != null && power.value !== "") slot.power = String(power.value);
  if (soc?.value != null && soc.value !== "") slot.soc = String(soc.value);
  if (pv) slot.pv_abandon = msParseBool(pv.value);
  if (ign) slot.ignore_anti_backflow = msParseBool(ign.value);
  return slot;
}

function msParsePropertyList(items, kind = MS_KIND_MANUAL) {
  const byCode = {};
  const meta = {};
  for (const it of items || []) {
    const code = it?.code;
    if (!code) continue;
    let ok = false;
    if (kind === MS_KIND_TOU) {
      ok = /^day_time[1-8]_/.test(code);
    } else {
      ok = code.startsWith("user_") && code.includes("_day_time") && !code.startsWith("user_day_time");
    }
    if (!ok) continue;
    byCode[code] = it;
    const addr = parseRegAddr(it.model?.strategySpec);
    if (addr != null) {
      meta[code] = {
        addr,
        dataType: it.model?.dataType || it.model?.dataSpec?.type || "",
        strategyType: it.model?.strategySpec?.type || "",
      };
    }
  }
  const week = msEmptyWeek(kind);
  for (const day of msDayKeys(kind)) {
    for (let i = 0; i < MS_SLOT_N; i++) {
      week[day][i] = msSlotFromProps(byCode, day, i, kind);
    }
  }
  return { week, meta };
}

function msFieldRegValue(field, slot) {
  if (field === "start" || field === "end") return msHmmToReg(slot[field]);
  if (field === "mode") return Number(slot.mode) || 0;
  if (field === "power") return Math.max(0, Math.min(65535, Math.round(Number(slot.power) || 0)));
  if (field === "soc") return Math.max(0, Math.min(100, Math.round(Number(slot.soc) || 0)));
  if (field === "pv_abandon" || field === "ignore_anti_backflow") return slot[field] ? 1 : 0;
  return 0;
}

function msFieldEqual(field, a, b) {
  if (field === "pv_abandon" || field === "ignore_anti_backflow") {
    return !!a === !!b;
  }
  return String(a ?? "") === String(b ?? "");
}

function msCollectDirtyEntries(week, baseline, meta, kind = msCtx?.kind) {
  const entries = [];
  for (const day of msDayKeys(kind)) {
    for (let i = 0; i < MS_SLOT_N; i++) {
      const cur = week[day][i];
      const base = baseline?.[day]?.[i] || msEmptySlot();
      const slotDirty = MS_FIELDS.some((field) => !msFieldEqual(field, cur[field], base[field]));
      // 时段有任意改动时，整段字段一并下发（含未勾选的弃光/忽略防逆流 → 写 0/false）
      if (!slotDirty) continue;
      for (const field of MS_FIELDS) {
        const code = msCode(day, i, field, kind);
        const m = meta[code];
        if (!m || m.addr == null) {
          console.warn("schedule missing reg", code);
          continue;
        }
        entries.push({ code, addr: m.addr, value: msFieldRegValue(field, cur), signed: false });
      }
    }
  }
  return entries;
}

/* ---- timeline helpers (00:00–24:00, snap 15min, max 8 active) ---- */

const MS_DAY_MIN = 24 * 60;
const MS_SNAP = 15;

function msHmmToMin(hmm) {
  const s = String(hmm || "0000").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  if (h === 24 && m === 0) return MS_DAY_MIN;
  return Math.max(0, Math.min(MS_DAY_MIN - 1, h * 60 + m));
}

function msMinToHmm(min) {
  let n = Math.round(Number(min) || 0);
  if (n >= MS_DAY_MIN) return "2400";
  n = Math.max(0, Math.min(MS_DAY_MIN - 1, n));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

function msMinToLabel(min) {
  const hmm = msMinToHmm(min);
  if (hmm === "2400") return "24:00";
  return msHmmToTime(hmm);
}

function msSnapMin(min) {
  return Math.max(0, Math.min(MS_DAY_MIN, Math.round(min / MS_SNAP) * MS_SNAP));
}

function msIsActiveSlot(slot) {
  return !!msSlotRange(slot);
}

/** Active if start < end in minutes. Unused slots are 0000–0000. */
function msSlotRange(slot) {
  if (!slot) return null;
  if (slot.start === "0000" && (slot.end === "0000" || slot.end === "0")) return null;
  const a = msHmmToMin(slot.start);
  let b = msHmmToMin(slot.end);
  if (slot.end === "2400") b = MS_DAY_MIN;
  if (b <= a) return null;
  return { start: a, end: b };
}

function msActiveCount(dayKey) {
  const slots = msCtx?.week?.[dayKey] || [];
  return slots.filter((s) => msSlotRange(s)).length;
}

function msFirstFreeSlotIdx(dayKey) {
  const slots = msCtx?.week?.[dayKey] || [];
  for (let i = 0; i < slots.length; i++) {
    if (!msSlotRange(slots[i])) return i;
  }
  return -1;
}

function msEnsureSelected() {
  if (!msCtx) return;
  const slots = msCtx.week[msCtx.day] || [];
  if (msCtx.selectedIdx != null && msSlotRange(slots[msCtx.selectedIdx])) return;
  const first = slots.findIndex((s) => msSlotRange(s));
  msCtx.selectedIdx = first >= 0 ? first : null;
}

function msClearSlot(slot) {
  Object.assign(slot, msEmptySlot());
}

/** Clamp [start,end] against other active slots; returns null if too short / blocked. */
function msClampRange(dayKey, start, end, selfIdx) {
  let a = msSnapMin(Math.min(start, end));
  let b = msSnapMin(Math.max(start, end));
  a = Math.max(0, Math.min(a, MS_DAY_MIN - MS_SNAP));
  b = Math.max(a + MS_SNAP, Math.min(b, MS_DAY_MIN));
  const others = (msCtx.week[dayKey] || [])
    .map((s, i) => ({ i, r: msSlotRange(s) }))
    .filter((x) => x.r && x.i !== selfIdx)
    .sort((p, q) => p.r.start - q.r.start);
  for (const o of others) {
    if (!(a < o.r.end && b > o.r.start)) continue;
    // completely covering or inside other → reject
    if (a <= o.r.start && b >= o.r.end) return null;
    if (a >= o.r.start && b <= o.r.end) return null;
    if (a < o.r.start) b = Math.min(b, o.r.start);
    else a = Math.max(a, o.r.end);
  }
  if (b - a < MS_SNAP) return null;
  return { start: a, end: b };
}

function msApplyRangeToSlot(slot, range) {
  slot.start = msMinToHmm(range.start);
  slot.end = range.end >= MS_DAY_MIN ? "2400" : msMinToHmm(range.end);
}

function msClientToMin(trackEl, clientX) {
  const rect = trackEl.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  return msSnapMin((x / Math.max(1, rect.width)) * MS_DAY_MIN);
}

function renderMsTimeline() {
  const host = document.getElementById("msTimeline");
  if (!host || !msCtx) return;
  const slots = msCtx.week[msCtx.day] || [];
  const activeN = msActiveCount(msCtx.day);
  const ticks = [0, 6, 12, 18, 24].map(
    (h) =>
      `<span class="ms-tick" style="left:${(h / 24) * 100}%"><i></i>${String(h).padStart(2, "0")}:00</span>`
  );
  const segs = slots
    .map((slot, i) => {
      const r = msSlotRange(slot);
      if (!r) return "";
      const left = (r.start / MS_DAY_MIN) * 100;
      const width = ((r.end - r.start) / MS_DAY_MIN) * 100;
      const isChg = String(slot.mode) === MS_MODE_CHARGE;
      const sel = msCtx.selectedIdx === i ? " selected" : "";
      const kind = isChg ? "chg" : "dchg";
      const label = isChg ? `充 ${slot.soc}%` : `放 ${slot.power}W · ${slot.soc}%`;
      return `<div class="ms-seg ${kind}${sel}" data-ms-seg="${i}" style="left:${left}%;width:${width}%" title="时段${i + 1} ${msMinToLabel(r.start)}–${msMinToLabel(r.end)}">
        <span class="ms-seg-label">${label}</span>
        <i class="ms-handle ms-handle-l" data-ms-handle="start" data-ms-seg="${i}"></i>
        <i class="ms-handle ms-handle-r" data-ms-handle="end" data-ms-seg="${i}"></i>
      </div>`;
    })
    .join("");
  host.innerHTML = `
    <div class="ms-timeline-meta">
      <span class="ms-count"><b>${activeN}</b> / ${MS_SLOT_N} 段</span>
      <span class="ms-tip">拖拽空白添加 · 点选编辑 · 拖边缘调时长</span>
    </div>
    <div class="ms-timeline" id="msTrack">
      <div class="ms-track-line"></div>
      ${ticks.join("")}
      ${segs}
      <div class="ms-ghost hidden" id="msGhost"></div>
    </div>`;
}

function renderMsEditor() {
  const slotsEl = document.getElementById("msSlots");
  if (!slotsEl || !msCtx) return;
  const i = msCtx.selectedIdx;
  const slots = msCtx.week[msCtx.day] || [];
  if (i == null || !msSlotRange(slots[i])) {
    slotsEl.innerHTML = `<div class="ms-editor-empty">
      <div class="ms-empty-icon" aria-hidden="true"></div>
      <p>在时间轴上拖拽添加时段</p>
      <p class="hint">最多 ${MS_SLOT_N} 段 · 选中色块后在此配置参数</p>
    </div>`;
    return;
  }
  const slot = slots[i];
  const range = msSlotRange(slot);
  const isChg = String(slot.mode) === MS_MODE_CHARGE;
  const rangeLabel = range
    ? `${msMinToLabel(range.start)} – ${msMinToLabel(range.end)}`
    : "";
  const codeHint = escapeHtml(msCode(msCtx.day, i, "soc"));
  const socField = `<div class="ms-field">
        <div class="ms-field-main">
          <span class="ms-k">目标 SOC</span>
          <span class="ms-v ms-v-num">
            <input type="number" min="0" max="100" step="1" data-ms-slot="${i}" data-ms-field="soc" value="${escapeAttr(slot.soc)}" />
            <span class="ms-unit">%</span>
          </span>
        </div>
        <p class="ms-desc">物模型 <code>${codeHint}</code></p>
      </div>`;
  const params = isChg
    ? `${socField}
      <div class="ms-field ms-toggle">
        <div class="ms-field-main">
          <div>
            <span class="ms-k">弃光</span>
            <p class="ms-desc">需要完全用电网充电时开启</p>
          </div>
          <label class="ms-switch">
            <input type="checkbox" data-ms-slot="${i}" data-ms-field="pv_abandon" ${slot.pv_abandon ? "checked" : ""} />
            <span></span>
          </label>
        </div>
      </div>`
    : `<div class="ms-field">
        <div class="ms-field-main">
          <span class="ms-k">放电功率</span>
          <span class="ms-v ms-v-num">
            <input type="number" min="0" max="65535" step="1" data-ms-slot="${i}" data-ms-field="power" value="${escapeAttr(slot.power)}" />
            <span class="ms-unit">W</span>
          </span>
        </div>
        <p class="ms-desc">本时段按设定功率向家庭输出</p>
      </div>
      ${socField}
      <div class="ms-field ms-toggle">
        <div class="ms-field-main">
          <div>
            <span class="ms-k">忽略防逆流</span>
            <p class="ms-desc">防逆流开启时，可能降功率或停放</p>
          </div>
          <label class="ms-switch">
            <input type="checkbox" data-ms-slot="${i}" data-ms-field="ignore_anti_backflow" ${slot.ignore_anti_backflow ? "checked" : ""} />
            <span></span>
          </label>
        </div>
      </div>
      <div class="ms-field ms-toggle">
        <div class="ms-field-main">
          <div>
            <span class="ms-k">弃光</span>
            <p class="ms-desc">优先执行放电策略时可开启</p>
          </div>
          <label class="ms-switch">
            <input type="checkbox" data-ms-slot="${i}" data-ms-field="pv_abandon" ${slot.pv_abandon ? "checked" : ""} />
            <span></span>
          </label>
        </div>
      </div>`;

  slotsEl.innerHTML = `<section class="ms-editor" data-slot="${i}">
    <header class="ms-ed-head">
      <div class="ms-ed-title">
        <span class="ms-ed-badge ${isChg ? "chg" : "dchg"}">时段 ${i + 1}</span>
        <span class="ms-ed-range">${escapeHtml(rangeLabel)}</span>
        <code class="ms-ed-code">${escapeHtml(msCode(msCtx.day, i, "*").replace("_*", "_*"))}</code>
      </div>
      <button type="button" class="btn btn-sm btn-ghost ms-del" data-ms-del="${i}">删除</button>
    </header>
    <div class="ms-ed-grid">
      <div class="ms-ed-cell">
        <span class="ms-label">开始</span>
        <input type="time" data-ms-slot="${i}" data-ms-field="start" value="${escapeAttr(msHmmToTime(slot.start === "2400" ? "0000" : slot.start))}" />
      </div>
      <div class="ms-ed-cell">
        <span class="ms-label">结束</span>
        <input type="time" data-ms-slot="${i}" data-ms-field="end" value="${escapeAttr(slot.end === "2400" ? "23:59" : msHmmToTime(slot.end))}" />
      </div>
      <div class="ms-ed-cell ms-ed-mode">
        <span class="ms-label">模式</span>
        <div class="ms-seg-ctrl" role="group">
          <button type="button" class="ms-seg-opt ${isChg ? "on chg" : ""}" data-ms-slot="${i}" data-ms-mode="${MS_MODE_CHARGE}">充电</button>
          <button type="button" class="ms-seg-opt ${!isChg ? "on dchg" : ""}" data-ms-slot="${i}" data-ms-mode="${MS_MODE_DISCHARGE}">放电</button>
        </div>
      </div>
    </div>
    <div class="ms-ed-params">${params}</div>
  </section>`;
}

function renderManualScheduleDialog() {
  if (!msCtx) return;
  const daysEl = document.getElementById("msDays");
  if (!daysEl) return;
  if (msIsTou()) {
    daysEl.classList.add("hidden");
    daysEl.innerHTML = "";
  } else {
    daysEl.classList.remove("hidden");
    daysEl.innerHTML = MS_DAYS.map(
      (d) =>
        `<button type="button" class="ms-day-btn ${msCtx.day === d.key ? "active" : ""}" data-ms-day="${d.key}">${d.label}</button>`
    ).join("");
  }
  msEnsureSelected();
  renderMsTimeline();
  renderMsEditor();
}

function msApplyField(slotIdx, field, raw) {
  if (!msCtx) return;
  const slot = msCtx.week[msCtx.day][slotIdx];
  if (!slot) return;
  if (field === "start" || field === "end") {
    slot[field] = msTimeToHmm(raw);
    // keep range valid
    const r = msSlotRange(slot);
    if (!r) {
      // try interpret end before start as invalid — leave and let clamp on blur via timeline
    } else {
      const clamped = msClampRange(msCtx.day, r.start, r.end, slotIdx);
      if (clamped) msApplyRangeToSlot(slot, clamped);
    }
    renderMsTimeline();
  } else if (field === "mode") {
    slot.mode = String(raw);
  } else if (field === "power" || field === "soc") {
    slot[field] = String(raw);
  } else if (field === "pv_abandon" || field === "ignore_anti_backflow") {
    slot[field] = !!raw;
  }
}

function msBindTimelinePointer() {
  const dlg = document.getElementById("dlgManualSchedule");
  if (!dlg || dlg.dataset.tlBound === "1") return;
  dlg.dataset.tlBound = "1";

  const onMove = (e) => {
    if (!msCtx?.drag) return;
    const track = document.getElementById("msTrack");
    if (!track) return;
    const cur = msClientToMin(track, e.clientX);
    const d = msCtx.drag;
    if (d.type === "create") {
      const ghost = document.getElementById("msGhost");
      const a = Math.min(d.origin, cur);
      const b = Math.max(d.origin, cur);
      if (ghost) {
        ghost.classList.remove("hidden");
        ghost.style.left = `${(a / MS_DAY_MIN) * 100}%`;
        ghost.style.width = `${(Math.max(MS_SNAP, b - a) / MS_DAY_MIN) * 100}%`;
      }
    } else if (d.type === "resize-start" || d.type === "resize-end" || d.type === "move") {
      const slot = msCtx.week[msCtx.day][d.idx];
      const base = d.base;
      let start = base.start;
      let end = base.end;
      if (d.type === "resize-start") start = cur;
      else if (d.type === "resize-end") end = cur;
      else {
        const delta = cur - d.origin;
        start = base.start + delta;
        end = base.end + delta;
        const span = base.end - base.start;
        if (start < 0) {
          start = 0;
          end = span;
        }
        if (end > MS_DAY_MIN) {
          end = MS_DAY_MIN;
          start = MS_DAY_MIN - span;
        }
      }
      const clamped = msClampRange(msCtx.day, start, end, d.idx);
      if (clamped) {
        msApplyRangeToSlot(slot, clamped);
        renderMsTimeline();
      }
    }
  };

  const onUp = (e) => {
    if (!msCtx?.drag) return;
    const track = document.getElementById("msTrack");
    const d = msCtx.drag;
    msCtx.drag = null;
    document.getElementById("msGhost")?.classList.add("hidden");
    if (d.type === "create" && track) {
      const cur = msClientToMin(track, e.clientX);
      if (msActiveCount(msCtx.day) >= MS_SLOT_N) {
        toast(`最多 ${MS_SLOT_N} 个时段`, "error");
        return;
      }
      const free = msFirstFreeSlotIdx(msCtx.day);
      if (free < 0) {
        toast(`最多 ${MS_SLOT_N} 个时段`, "error");
        return;
      }
      const clamped = msClampRange(msCtx.day, d.origin, cur, free);
      if (!clamped) {
        toast("时段过短或与已有时段重叠", "error");
        return;
      }
      const slot = msCtx.week[msCtx.day][free];
      msClearSlot(slot);
      msApplyRangeToSlot(slot, clamped);
      slot.mode = MS_MODE_DISCHARGE;
      slot.power = "200";
      slot.soc = "80";
      msCtx.selectedIdx = free;
      renderManualScheduleDialog();
      return;
    }
    if (d.type === "resize-start" || d.type === "resize-end" || d.type === "move") {
      renderManualScheduleDialog();
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  dlg.addEventListener("pointerdown", (e) => {
    if (!msCtx) return;
    const handle = e.target.closest("[data-ms-handle]");
    const seg = e.target.closest("[data-ms-seg]");
    const track = e.target.closest("#msTrack");
    if (handle) {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(handle.getAttribute("data-ms-seg"));
      const r = msSlotRange(msCtx.week[msCtx.day][idx]);
      if (!r) return;
      msCtx.selectedIdx = idx;
      msCtx.drag = {
        type: handle.getAttribute("data-ms-handle") === "start" ? "resize-start" : "resize-end",
        idx,
        base: { ...r },
        origin: msClientToMin(document.getElementById("msTrack"), e.clientX),
      };
      renderMsTimeline();
      renderMsEditor();
      return;
    }
    if (seg) {
      e.preventDefault();
      const idx = Number(seg.getAttribute("data-ms-seg"));
      const r = msSlotRange(msCtx.week[msCtx.day][idx]);
      if (!r) return;
      msCtx.selectedIdx = idx;
      msCtx.drag = {
        type: "move",
        idx,
        base: { ...r },
        origin: msClientToMin(document.getElementById("msTrack"), e.clientX),
      };
      renderMsTimeline();
      renderMsEditor();
      return;
    }
    if (track) {
      if (e.target.closest(".ms-seg")) return;
      e.preventDefault();
      if (msActiveCount(msCtx.day) >= MS_SLOT_N) {
        toast(`最多 ${MS_SLOT_N} 个时段`, "error");
        return;
      }
      const origin = msClientToMin(document.getElementById("msTrack"), e.clientX);
      msCtx.drag = { type: "create", origin };
      msCtx.selectedIdx = null;
      renderMsEditor();
    }
  });
}

async function openManualScheduleDialog(home, device, opts = {}) {
  const dlg = document.getElementById("dlgManualSchedule");
  if (!dlg || !home || !device) return;
  const fromFamily = !!opts.fromFamily;
  const kind = opts.kind === MS_KIND_TOU ? MS_KIND_TOU : MS_KIND_MANUAL;
  const modeValue = kind === MS_KIND_TOU ? MS_KIND_TOU : MS_KIND_MANUAL;
  const title = document.getElementById("dlgManualScheduleTitle");
  const hint = dlg.querySelector(".manual-schedule-modal > .hint");
  if (title) {
    const tag = kind === MS_KIND_TOU ? "分时用电" : "手动设置";
    title.textContent = fromFamily
      ? `${tag} · 家庭（以 ${device.name || device.deviceId} 为模板）`
      : `${tag} · ${device.name || device.deviceId}`;
  }
  if (hint) {
    hint.textContent =
      kind === MS_KIND_TOU
        ? "分时用电：无星期，最多 8 段（day_time1…8_*）。拖拽选段后配置参数并下发。"
        : "手动设置：按星期配置，每天最多 8 段（user_{weekday}_day_timeN_*）。拖拽选段后配置并下发。";
  }
  msCtx = {
    home,
    device,
    fromFamily,
    kind,
    modeValue,
    day: kind === MS_KIND_TOU ? MS_TOU_DAY : MS_DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1].key,
    week: msEmptyWeek(kind),
    baseline: msEmptyWeek(kind),
    meta: {},
    loading: true,
    selectedIdx: null,
    drag: null,
  };
  document.getElementById("msDays").innerHTML = "";
  document.getElementById("msTimeline").innerHTML = "";
  document.getElementById("msSlots").innerHTML = `<p class="hint">正在读取物模型时段…</p>`;
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");

  try {
    const res = await apiGet("/api/proxy/property-query", home, {
      page: "1",
      deviceId: device.deviceId,
    });
    const list = unwrapResult(res);
    const items = Array.isArray(list) ? list : list?.data || list?.items || [];
    const parsed = msParsePropertyList(items, kind);
    msCtx.week = parsed.week;
    msCtx.baseline = msCloneWeek(parsed.week);
    msCtx.meta = parsed.meta;
    msCtx.loading = false;
    if (!Object.keys(parsed.meta).length) {
      const tip =
        kind === MS_KIND_TOU
          ? "未读到 day_time* 寄存器（请确认 Cookie / 机型是否支持分时用电）。"
          : "未读到 user_*_day_time* 寄存器（请确认 Cookie / 机型是否支持手动时段）。";
      document.getElementById("msSlots").innerHTML = `<p class="hint">${tip}</p>`;
      return;
    }
    renderManualScheduleDialog();
  } catch (err) {
    msCtx.loading = false;
    document.getElementById("msSlots").innerHTML = `<p class="hint">读取失败：${escapeHtml(err.message || err)}</p>`;
  }
}

async function saveManualScheduleAndIssue() {
  if (!msCtx?.device || !msCtx.home) return;
  const { home, device, week, baseline, meta, fromFamily, kind, modeValue } = msCtx;
  const dirty = msCollectDirtyEntries(week, baseline, meta, kind);
  const targets = fromFamily
    ? (home.devices || []).filter((d) => d?.deviceId)
    : [device];
  if (!targets.length) {
    toast("没有可下发的一体机", "error");
    return;
  }

  const modeNow = String(
    fromFamily
      ? home.familyValues?.work_mode ?? device.values?.work_mode ?? ""
      : device.values?.work_mode ?? ""
  );
  const needMode = fromFamily || modeNow !== modeValue;
  if (!dirty.length && modeNow === modeValue) {
    toast("时段无改动", "ok");
    document.getElementById("dlgManualSchedule")?.close();
    return;
  }

  const btn = document.getElementById("btnManualScheduleSave");
  if (btn) btn.disabled = true;
  try {
    const propertyList = [];
    if (needMode) {
      const field = HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode");
      const entry = resolveSchemaEntry(
        device.schema || {},
        field || { code: "work_mode", aliases: ["work_mode"] }
      );
      propertyList.push({
        dpId: String(entry?.dpId || field?.fallbackDpId || "51"),
        dpValue: modeValue,
      });
    }
    if (dirty.length) {
      const fsEntry = resolveSchemaEntry(device.schema || {}, {
        code: "function_set",
        aliases: ["function_set"],
      });
      const dpId = String(fsEntry?.dpId || "52");
      for (let i = 0; i < dirty.length; i += MS_FUNC_BATCH) {
        const chunk = dirty.slice(i, i + MS_FUNC_BATCH);
        propertyList.push({ dpId, dpValue: packFunctionSetRaw(chunk) });
      }
    }
    if (!propertyList.length) {
      toast("没有待下发内容", "error");
      return;
    }

    const results = await Promise.all(
      targets.map(async (d) => {
        try {
          const res = await apiPost("/api/proxy/issue", home, {
            devId: d.deviceId,
            timestamp: null,
            propertyList,
          });
          const raw = unwrapResult(res);
          const upstream = res.data || {};
          const ok =
            res.ok !== false &&
            upstream.success !== false &&
            (raw?.success === true ||
              raw?.success === undefined ||
              Array.isArray(raw) ||
              res.status === 200);
          if (!ok) {
            throw new Error(upstream.errorMsg || raw?.errorMsg || raw?.message || "下发失败");
          }
          return true;
        } catch (err) {
          d.error = err.message || String(err);
          return false;
        }
      })
    );
    const okN = results.filter(Boolean).length;
    const failN = results.length - okN;
    if (!okN) throw new Error(targets[0]?.error || "下发失败");

    if (!home.familyValues) home.familyValues = {};
    if (!home.familyDrafts) home.familyDrafts = {};
    home.familyValues.work_mode = modeValue;
    home.familyDrafts.work_mode = "";
    for (const d of targets) {
      if (!d.values) d.values = {};
      if (!d.drafts) d.drafts = {};
      d.values.work_mode = modeValue;
      d.drafts.work_mode = "";
    }
    if (dirty.length) {
      msCtx.baseline = msCloneWeek(week);
      device.manualSchedule = { kind, week: msCloneWeek(week), updatedAt: Date.now() };
    }

    const modeLabel = kind === MS_KIND_TOU ? "分时用电" : "手动设置";
    toast(
      fromFamily
        ? `${modeLabel}时段已下发至 ${okN}/${targets.length} 台${failN ? `（失败 ${failN}）` : ""}`
        : `已下发 ${modeLabel}${dirty.length ? ` + ${dirty.length} 个寄存器` : ""}`,
      failN ? "error" : "ok"
    );
    document.getElementById("dlgManualSchedule")?.close();
    persist();
    render();
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}


function bindManualScheduleDialog() {
  const dlg = document.getElementById("dlgManualSchedule");
  if (!dlg || dlg.dataset.bound === "1") return;
  dlg.dataset.bound = "1";
  msBindTimelinePointer();
  document.getElementById("btnManualScheduleClose")?.addEventListener("click", () => dlg.close());
  document.getElementById("btnManualScheduleSave")?.addEventListener("click", () => saveManualScheduleAndIssue());
  dlg.addEventListener("close", () => {
    if (msCtx?.device) render();
  });
  dlg.addEventListener("click", (e) => {
    const dayBtn = e.target.closest("[data-ms-day]");
    if (dayBtn && msCtx) {
      msCtx.day = dayBtn.getAttribute("data-ms-day");
      msCtx.selectedIdx = null;
      renderManualScheduleDialog();
      return;
    }
    const modeBtn = e.target.closest("[data-ms-mode]");
    if (modeBtn && msCtx) {
      const idx = Number(modeBtn.getAttribute("data-ms-slot"));
      const mode = modeBtn.getAttribute("data-ms-mode");
      msApplyField(idx, "mode", mode);
      renderMsTimeline();
      renderMsEditor();
      return;
    }
    const del = e.target.closest("[data-ms-del]");
    if (del && msCtx) {
      const idx = Number(del.getAttribute("data-ms-del"));
      const slot = msCtx.week[msCtx.day][idx];
      if (slot) msClearSlot(slot);
      msCtx.selectedIdx = null;
      renderManualScheduleDialog();
    }
  });
  dlg.addEventListener("change", (e) => {
    const el = e.target.closest("[data-ms-field]");
    if (!el || !msCtx) return;
    const slotIdx = Number(el.getAttribute("data-ms-slot"));
    const field = el.getAttribute("data-ms-field");
    const raw = el.type === "checkbox" ? el.checked : el.value;
    msApplyField(slotIdx, field, raw);
    if (field === "mode" || field === "start" || field === "end" || field === "power" || field === "soc") {
      renderMsTimeline();
      if (field === "mode") renderMsEditor();
    }
  });
}

/* ---------- Events ---------- */

function bindEvents() {
  bindManualScheduleDialog();
  const SIDEBAR_KEY = "groupAppControl.sidebarCollapsed";
  const appEl = document.getElementById("app");
  const btnToggle = document.getElementById("btnToggleSidebar");
  const applySidebar = (collapsed) => {
    appEl?.classList.toggle("sidebar-collapsed", !!collapsed);
    if (btnToggle) {
      btnToggle.title = collapsed ? "展开左侧栏" : "折叠左侧栏";
      btnToggle.setAttribute("aria-label", collapsed ? "展开左侧栏" : "折叠左侧栏");
      btnToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  };
  try {
    applySidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
  } catch (_) {}
  btnToggle?.addEventListener("click", () => {
    const next = !appEl.classList.contains("sidebar-collapsed");
    applySidebar(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
    } catch (_) {}
  });

  document.getElementById("homeTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".home-tab[data-tab]");
    if (!btn) return;
    setHomeTab(btn.getAttribute("data-tab"));
  });
  document.getElementById("btnElectionPollToggle")?.addEventListener("click", () => {
    setElectionPollEnabled(!electionPollEnabled);
  });
  document.getElementById("btnElectionApplyInterval")?.addEventListener("click", () => {
    const home = activeHome();
    const input = document.getElementById("electionIntervalSec");
    if (!home || !input) return;
    saveElectionInterval(home, input.value);
  });
  document.getElementById("electionIntervalSec")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.getElementById("btnElectionApplyInterval")?.click();
  });
  document.getElementById("btnElectionPollOnce")?.addEventListener("click", () => {
    tickElectionPoll({ force: true });
  });
  document.getElementById("btnElectionRefresh")?.addEventListener("click", () => {
    const home = activeHome();
    if (home) loadElectionRows(home);
  });
  document.getElementById("btnElectionExpandAll")?.addEventListener("click", () => {
    document.querySelectorAll("#electionHost .election-tl-item").forEach((item) => {
      item.classList.remove("is-collapsed");
      item.querySelector('[data-act="election-fold"]')?.setAttribute("aria-expanded", "true");
    });
  });
  document.getElementById("btnElectionCollapseAll")?.addEventListener("click", () => {
    document.querySelectorAll("#electionHost .election-tl-item").forEach((item) => {
      item.classList.add("is-collapsed");
      item.querySelector('[data-act="election-fold"]')?.setAttribute("aria-expanded", "false");
    });
  });
  document.getElementById("btnElectionDownload")?.addEventListener("click", () => {
    const home = activeHome();
    const homeId = electionHomeKey(home);
    if (!homeId) {
      toast("缺少家庭 ID", "error");
      return;
    }
    window.open(`/api/election/download?homeId=${encodeURIComponent(homeId)}`, "_blank");
  });
  document.getElementById("btnElectionClear")?.addEventListener("click", async () => {
    const home = activeHome();
    const homeId = electionHomeKey(home);
    if (!homeId) return;
    if (!(await appConfirm("清空该家庭的选举趋势 CSV 记录？", { title: "清空记录" }))) return;
    try {
      const res = await fetch("/api/election/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeId }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "清空失败");
      electionTimeline = [];
      electionLastMasterId = null;
      electionMeta.rowCount = 0;
      toast("已清空选举记录", "ok");
      renderElectionPanel(home);
    } catch (err) {
      toast(err.message || String(err), "error");
    }
  });
  document.getElementById("btnAddHome").addEventListener("click", () => openHomeDialog(null));
  document.getElementById("btnEmptyAdd").addEventListener("click", () => openHomeDialog(null));
  document.getElementById("btnLogin").addEventListener("click", openLoginDialog);
  document.getElementById("btnEditHome").addEventListener("click", () => {
    const h = activeHome();
    if (h) openHomeDialog(h);
  });
  document.getElementById("btnDeleteHome").addEventListener("click", () => {
    const h = activeHome();
    if (!h) return;
    if (!confirm(`删除家庭 ${homeDisplayName(h)}？`)) return;
    state.homes = state.homes.filter((x) => x.uid !== h.uid);
    state.activeHomeId = state.homes[0]?.uid || null;
    persist();
    render();
  });
  document.getElementById("btnAddDevice").addEventListener("click", () => openDeviceDialog(null));
  document.getElementById("btnAddMeter").addEventListener("click", () => openMeterDialog(null));

  document.getElementById("btnReadAll").addEventListener("click", () => readAllActiveHome());
  document.getElementById("btnSaveSnapshot")?.addEventListener("click", () => saveLiveSnapshot());
  document.getElementById("btnSnapRefresh")?.addEventListener("click", () => mountSnapshotsPanel());
  document.getElementById("btnSnapClearAll")?.addEventListener("click", () => clearAllSnapshots());
  document.getElementById("btnSnapPreviewClose")?.addEventListener("click", () => {
    closeSnapshotFullscreen();
    document.getElementById("dlgSnapshotPreview")?.close();
  });
  document.getElementById("snapPreviewImg")?.addEventListener("click", (e) => {
    e.preventDefault();
    const src = e.currentTarget?.src;
    if (src) openSnapshotFullscreen(src);
  });
  document.getElementById("btnSnapFsClose")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSnapshotFullscreen();
  });
  document.getElementById("snapFullscreen")?.addEventListener("click", () => {
    closeSnapshotFullscreen();
  });
  document.getElementById("snapFullscreenImg")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSnapshotFullscreen();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const layer = document.getElementById("snapFullscreen");
      if (layer && !layer.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeSnapshotFullscreen();
      }
    },
    true
  );
  document.getElementById("dlgSnapshotPreview")?.addEventListener("close", () => {
    closeSnapshotFullscreen();
  });

  document.getElementById("btnIssueAll").addEventListener("click", async () => {
    const home = activeHome();
    if (!home) return;
    const famN = countFamilyDrafts(home);
    const deviceTargets = (home.devices || []).filter((d) => countDrafts(d) > 0);
    // 家庭参数下发 + 各设备草稿下发：全部并行
    const [famResult, ...deviceResults] = await Promise.all([
      famN ? issueFamilyToDevices(home) : Promise.resolve({ ok: 0, fail: 0 }),
      ...deviceTargets.map((d) => issueDevice(home, d, { batch: true })),
    ]);
    const deviceOk = deviceResults.filter(Boolean).length;
    if (famN) {
      if (famResult.fail) toast(`家庭参数：${famResult.ok} 台成功 / ${famResult.fail} 台失败`, famResult.ok ? "ok" : "error");
      else if (famResult.ok) toast(`家庭参数已下发至 ${famResult.ok} 台设备`, "ok");
    }
    if (deviceTargets.length) {
      toast(`设备参数：成功 ${deviceOk} / ${deviceTargets.length}`, deviceOk === deviceTargets.length ? "ok" : "error");
    }
    if (!famN && !deviceTargets.length) toast("没有待下发改动", "error");
    persist();
    render();
  });

  document.getElementById("loginEnv").addEventListener("change", (e) => {
    const host = e.target.value;
    document.getElementById("loginCookie").value = state.cookies[host] || "";
  });

  const bindAutoCookie = (btn) => {
    btn?.addEventListener("click", async () => {
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = "获取中…";
      try {
        await refreshSsoCookie({ force: true });
        // Keep dialog open so user can review; banner path may not have dialog
        if (!document.getElementById("dlgLogin")?.open) {
          /* no-op */
        }
      } catch (_) {
        /* toast already shown */
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  };
  bindAutoCookie(document.getElementById("btnAutoCookie"));
  bindAutoCookie(document.getElementById("btnAutoCookieBanner"));

  document.getElementById("btnPushCookies")?.addEventListener("click", async () => {
    const btn = document.getElementById("btnPushCookies");
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "推送中…";
    }
    try {
      // Prefer current store; if empty for active host, refresh first
      const host =
        document.getElementById("loginEnv")?.value ||
        activeHome()?.envHost ||
        "";
      const needRefresh = !(state.cookies[host] || "").trim();
      await pushCookiesToRemote({ refreshFirst: needRefresh });
    } catch (_) {
      /* toast already shown */
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "推送到虚拟机";
      }
    }
  });

  document.getElementById("remotePushUrl")?.addEventListener("change", (e) => {
    const v = String(e.target.value || "").trim().replace(/\/$/, "");
    try {
      if (v) localStorage.setItem(REMOTE_PUSH_URL_KEY, v);
    } catch (_) {
      /* ignore */
    }
  });

  document.getElementById("btnLoginCancel").addEventListener("click", () => {
    document.getElementById("dlgLogin").close();
  });
  document.getElementById("formLogin").addEventListener("submit", (e) => {
    e.preventDefault();
    const host = document.getElementById("loginEnv").value;
    const cookie = document.getElementById("loginCookie").value.trim();
    state.cookies[host] = cookie;
    persist();
    document.getElementById("dlgLogin").close();
    toast(cookie ? `已保存 ${envLabel(host)} 登录态` : `已清空 ${envLabel(host)} Cookie`, "ok");
    render();
  });

  document.getElementById("btnHomeCancel").addEventListener("click", () => {
    document.getElementById("dlgHome").close();
  });
  document.getElementById("formHome").addEventListener("submit", (e) => {
    e.preventDefault();
    const envHost = document.getElementById("homeEnv").value;
    const homeId = document.getElementById("homeId").value.trim();
    const name = document.getElementById("homeName").value.trim();
    const authId = document.getElementById("homeAuthId").value.trim();
    if (!homeId) return;
    if (editingHomeUid) {
      const h = state.homes.find((x) => x.uid === editingHomeUid);
      if (h) {
        // envHost locked after create — keep bound region
        h.homeId = homeId;
        h.name = name;
        h.authId = authId;
        for (const m of h.meters || []) {
          m.hestiaHost = hestiaHostForHome(h);
        }
      }
    } else {
      const h = normalizeHome({
        uid: uid(),
        envHost,
        homeId,
        name,
        authId,
        devices: [],
      });
      state.homes.push(h);
      state.activeHomeId = h.uid;
    }
    persist();
    document.getElementById("dlgHome").close();
    render();
  });

  document.getElementById("btnDeviceCancel").addEventListener("click", () => {
    document.getElementById("dlgDevice").close();
  });
  document.getElementById("formDevice").addEventListener("submit", (e) => {
    e.preventDefault();
    const home = activeHome();
    if (!home) return;
    const deviceId = document.getElementById("deviceId").value.trim();
    const name = document.getElementById("deviceName").value.trim();
    if (!deviceId) return;
    if (editingDeviceUid) {
      const d = home.devices.find((x) => x.uid === editingDeviceUid);
      if (d) {
        if (d.deviceId !== deviceId) {
          d.pid = "";
          d.model = "";
        }
        d.deviceId = deviceId;
        d.name = name;
      }
    } else {
      home.devices.push(
        normalizeDevice({
          uid: uid(),
          deviceId,
          name,
        })
      );
    }
    ensureHomeWiring(home);
    persist();
    document.getElementById("dlgDevice").close();
    render();
  });

  /* ---- Wiring editor ---- */
  let _wiringDraft = null;

  function openWiringDialog() {
    const home = activeHome();
    if (!home) return;
    ensureHomeWiring(home);
    _wiringDraft = JSON.parse(JSON.stringify(home.wiring));
    renderWiringDialog(home);
    document.getElementById("dlgWiring").showModal();
  }

  function renderWiringDialog(home) {
    const draft = _wiringDraft;
    const busList = document.getElementById("wiringBusList");
    busList.innerHTML = draft.buses
      .map((b, idx) => {
        const kindLab = WIRING_BUS_KINDS.find((k) => k.kind === b.kind)?.label || b.kind;
        return `<div class="wiring-bus-row" data-bus-idx="${idx}">
          <span class="wiring-kind">${escapeHtml(kindLab)}</span>
          <input type="text" data-bus-label value="${escapeAttr(b.label)}" placeholder="端子名称" />
          <button type="button" class="btn-link danger" data-bus-del ${draft.buses.length <= 1 ? "disabled" : ""}>删除</button>
        </div>`;
      })
      .join("");

    busList.querySelectorAll("[data-bus-label]").forEach((input) => {
      input.addEventListener("input", () => {
        const idx = Number(input.closest("[data-bus-idx]").getAttribute("data-bus-idx"));
        if (draft.buses[idx]) draft.buses[idx].label = input.value;
      });
    });
    busList.querySelectorAll("[data-bus-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.closest("[data-bus-idx]").getAttribute("data-bus-idx"));
        const removed = draft.buses[idx];
        if (!removed || draft.buses.length <= 1) return;
        draft.buses.splice(idx, 1);
        for (const ports of Object.values(draft.devices)) {
          for (const p of ["pv", "grid", "offgrid"]) {
            if (ports[p] === removed.id) ports[p] = "";
          }
        }
        renderWiringDialog(home);
      });
    });
  }

  document.getElementById("btnWiringAddBus").addEventListener("click", () => {
    if (!_wiringDraft) return;
    const kind = document.getElementById("wiringNewBusKind").value;
    const meta = WIRING_BUS_KINDS.find((k) => k.kind === kind) || WIRING_BUS_KINDS[0];
    const n = _wiringDraft.buses.filter((b) => b.kind === kind).length + 1;
    _wiringDraft.buses.push({
      id: `bus_${kind}_${Date.now().toString(36)}`,
      kind,
      label: n > 1 ? `${meta.label} ${n}` : meta.label,
      x: null,
      y: null,
    });
    renderWiringDialog(activeHome());
  });

  document.getElementById("btnWiringReset").addEventListener("click", () => {
    const home = activeHome();
    if (!home) return;
    _wiringDraft = normalizeWiring(null, home.devices.map((d) => d.uid));
    renderWiringDialog(home);
  });

  document.getElementById("btnWiringCancel").addEventListener("click", () => {
    document.getElementById("dlgWiring").close();
    _wiringDraft = null;
  });

  document.getElementById("btnDevicePointsClose").addEventListener("click", () => {
    document.getElementById("dlgDevicePoints").close();
  });
  document.getElementById("dlgDevicePoints").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  document.getElementById("btnRegQueryClose")?.addEventListener("click", () => {
    document.getElementById("dlgRegQuery")?.close();
  });
  document.getElementById("btnRegQueryRun")?.addEventListener("click", () => runRegQuery());
  document.getElementById("regQueryAddr")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runRegQuery();
    }
  });
  document.getElementById("dlgRegQuery")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  document.getElementById("btnOwnerStratClose")?.addEventListener("click", () => {
    document.getElementById("dlgOwnerStrat")?.close();
  });
  document.getElementById("dlgOwnerStrat")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  document.getElementById("formWiring").addEventListener("submit", (e) => {
    e.preventDefault();
    const home = activeHome();
    if (!home || !_wiringDraft) return;
    home.wiring = normalizeWiring(
      _wiringDraft,
      home.devices.map((d) => d.uid)
    );
    _wiringDraft = null;
    persist();
    document.getElementById("dlgWiring").close();
    toast("接线已保存", "ok");
    render();
  });

  // expose for flow button
  window.openWiringDialog = openWiringDialog;

  document.getElementById("btnMeterCancel").addEventListener("click", () => {
    document.getElementById("dlgMeter").close();
  });
  document.getElementById("meterThirdParty")?.addEventListener("change", () => {
    syncMeterDialogMode();
    const home = activeHome();
    if (document.getElementById("meterThirdParty").value === "1") {
      fillMeterDeviceSelect(home, document.getElementById("meterDeviceSelect").value);
    } else {
      const hint = document.getElementById("meterRegionHint");
      if (hint && home) {
        const hHost = hestiaHostForHome(home);
        hint.textContent = `Hestia 区域随家庭环境自动跟随：${envLabel(home.envHost)} → ${hHost}`;
      }
    }
  });
  document.getElementById("formMeter").addEventListener("submit", (e) => {
    e.preventDefault();
    const home = activeHome();
    if (!home) return;
    if (!home.meters) home.meters = [];
    const isThirdParty = document.getElementById("meterThirdParty").value === "1";
    const deviceId = isThirdParty
      ? document.getElementById("meterDeviceSelect").value.trim()
      : document.getElementById("meterId").value.trim();
    const name = document.getElementById("meterName").value.trim();
    const hestiaHost = hestiaHostForHome(home);
    if (!deviceId) {
      toast(isThirdParty ? "请选择一体机" : "请填写电表设备 ID", "error");
      return;
    }
    if (editingMeterUid) {
      const m = home.meters.find((x) => x.uid === editingMeterUid);
      if (m) {
        m.deviceId = deviceId;
        m.name = name;
        m.isThirdParty = isThirdParty;
        m.hestiaHost = hestiaHost;
        m.pid = isThirdParty ? "" : METER_PID;
      }
    } else {
      home.meters.push(
        normalizeMeter(
          {
            uid: uid(),
            deviceId,
            name,
            isThirdParty,
            pid: isThirdParty ? "" : METER_PID,
          },
          home.envHost
        )
      );
    }
    persist();
    document.getElementById("dlgMeter").close();
    render();
  });
}

/** 电表：本机最近影子读取相对时间，如「7秒前已读」 */
function meterReadAgoLabel(meter) {
  if (!meter?.lastReadAt) return meter?.error ? "异常" : "未读";
  return `${relativeTime(meter.lastReadAt)}已读${meter.error ? " · 异常" : ""}`;
}

/** ③ 操作栏：本机最近读取相对时间，如「7秒前已读」 */
function deviceReadAgoLabel(device) {
  if (!device?.lastReadAt) return device?.error ? "异常" : "未读";
  return `${relativeTime(device.lastReadAt)}已读${device.error ? " · 异常" : ""}`;
}

function refreshRelativeTimes() {
  if (document.activeElement && document.activeElement.matches("input, textarea, select")) {
    return;
  }
  const home = activeHome();
  if (!home) return;
  document.querySelectorAll("#flowHost .u3[data-device-uid]").forEach((card) => {
    const device = home.devices.find((d) => d.uid === card.getAttribute("data-device-uid"));
    if (!device) return;
    const el = card.querySelector(".layer.l3 .lh span:last-child");
    if (!el) return;
    el.textContent = deviceReadAgoLabel(device);
  });
  const primaryMeter = (home.meters || [])[0];
  document.querySelectorAll("#flowHost [data-meter-ago]").forEach((el) => {
    el.textContent = meterReadAgoLabel(primaryMeter);
  });
  document.querySelectorAll("#flowHost [data-meter-ago-uid]").forEach((el) => {
    const uid = el.getAttribute("data-meter-ago-uid");
    const m = (home.meters || []).find((x) => x.uid === uid);
    el.textContent = meterReadAgoLabel(m);
  });
}

async function readAllActiveHome(opts = {}) {
  const quiet = !!opts.quiet;
  const home = activeHome();
  if (!home) return;
  const devices = home.devices || [];
  const meters = home.meters || [];
  if (!devices.length && !meters.length) {
    if (!quiet) toast("没有设备或电表", "error");
    return;
  }

  if (!quiet) {
    for (const d of devices) {
      d.loading = true;
      d.error = null;
    }
    for (const m of meters) {
      m.loading = true;
      m.error = null;
    }
    home.familyValues = {};
    render();
  }

  // 全并行：一体机影子 + 电表影子（电表实时功率必拉）
  const results = await Promise.all([
    ...devices.map(async (d) => {
      const [ok, model] = await Promise.all([
        readDevice(home, d, { batch: true }),
        fetchDeviceHomeModelParams(home, d),
      ]);
      applyDeviceHomeModelParams(home, d, model, { syncHome: false });
      return ok;
    }),
    ...meters.map((m) =>
      readMeter(home, m, { batch: true, quiet }).then(() => !m.error)
    ),
  ]);

  // 家庭侧栏：用第一台设备的影子 + 物模型回填（不再串行重拉）
  if (devices[0]?.values) {
    if (!home.familyValues) home.familyValues = {};
    for (const field of HOME_FAMILY_FIELDS) {
      const v = devices[0].values[field.code];
      if (v != null && v !== "") home.familyValues[field.code] = v;
    }
  }

  home.lastReadAt = Date.now();
  applyDp98ActualForHome(home);
  render();

  const deviceMeterResults = results.slice(0, devices.length + meters.length);
  const failN = deviceMeterResults.filter((ok) => !ok).length;
  if (!quiet) {
    if (failN) toast(`一键读取完成：${failN} 台失败`, "error");
    else toast("一键读取完成", "ok");
  }
}

async function init() {
  bindEvents();
  try {
    state = await loadStoreFromServer();
  } catch (err) {
    console.error(err);
    const legacy = loadLegacyLocalStorage();
    state = legacy || emptyState();
    toast(`读取本地文件失败，已回退浏览器缓存: ${err.message || err}`, "error");
  }
  if (!state.activeHomeId && state.homes.length) {
    state.activeHomeId = state.homes[0].uid;
  }
  render();
  setInterval(refreshRelativeTimes, 1000);
  syncAutoRefreshTimer();
  syncHighFreqTimer();
  if (electionPollEnabled) {
    const home = activeHome();
    if (home) {
      loadElectionSettings(home).then(() => {
        ensureElectionPollTimer();
      });
    } else {
      ensureElectionPollTimer();
    }
  }
  // Soft auto-fill when no SSO present (local Chrome / cache / env)
  const hasSso = Object.values(state.cookies || {}).some((c) =>
    /SSO_USER_TOKEN=/i.test(String(c || ""))
  );
  if (!hasSso) {
    try {
      await refreshSsoCookie({ quiet: true });
    } catch (_) {
      /* keep manual path */
    }
  }
  // 浏览器刷新 ≡ 一键读取：从接口拉取当前家庭全部数值
  await readAllActiveHome();
}

init();
