/**
 * Home energy-flow view — ported/adapted from algo_core/webapp energy flow.
 * Binds real device shadow values + meter power (not simulation inputs).
 */

function flowEsc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function flowNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function flowEdgeClass(base, watts) {
  const w = Math.abs(Number(watts) || 0);
  if (w <= 0) return `flow-edge ${base}`;
  return `flow-edge ${base} on${w >= 1000 ? " strong" : ""}`;
}

/** Hit-path + attrs so wiring mode can click a line to disconnect. */
function flowWireUnlinkAttrs(uid, port) {
  return `data-wire-unlink="${flowEsc(uid)}:${flowEsc(port)}" data-device-uid="${flowEsc(uid)}" data-port="${flowEsc(port)}"`;
}

function flowWireUnlinkHit(d, uid, port) {
  return `<path class="wire-unlink-hit" ${flowWireUnlinkAttrs(uid, port)} d="${d}"><title>点击断开此线</title></path>`;
}

function flowCurveCtrl(x1, y1, x2, y2, bendX = 0, bendY = 0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const pull = Math.min(0.58, Math.max(0.38, 110 / dist));
  return {
    c1x: x1 + dx * pull + bendX,
    c1y: y1 + dy * (pull * 0.55) + bendY,
    c2x: x2 - dx * pull + bendX,
    c2y: y2 - dy * (pull * 0.55) + bendY,
  };
}

function flowCurve(x1, y1, x2, y2, bendX = 0, bendY = 0) {
  const { c1x, c1y, c2x, c2y } = flowCurveCtrl(x1, y1, x2, y2, bendX, bendY);
  return `M${x1} ${y1} C${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
}

function flowCurveMid(x1, y1, x2, y2, bendX = 0, bendY = 0) {
  const { c1x, c1y, c2x, c2y } = flowCurveCtrl(x1, y1, x2, y2, bendX, bendY);
  return {
    x: 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2,
    y: 0.125 * y1 + 0.375 * c1y + 0.375 * c2y + 0.125 * y2,
  };
}

function flowBmsSvg(bx, by, bw, bh, mode, wattsLabel, limLabel, capLabel = "") {
  const padX = 8;
  const padY = 6;
  const bodyW = bw - 20;
  const bodyH = 16;
  const bodyX = bx + padX;
  const bodyY = by + padY;
  const capW = 5;
  const capH = 9;
  const cells = 4;
  const gap = 2;
  const innerPad = 2;
  const cellW = (bodyW - innerPad * 2 - gap * (cells - 1)) / cells;
  const cellH = bodyH - innerPad * 2;
  const stroke = mode === "chg" ? "#16a34a" : mode === "dchg" ? "#e11d48" : "#94a3b8";
  const fillBg = mode === "chg" ? "#f0fdf4" : mode === "dchg" ? "#fff1f2" : "#f8fafc";
  const capFill = mode === "chg" ? "#166534" : mode === "dchg" ? "#9f1239" : "#334155";
  let cellRects = "";
  for (let i = 0; i < cells; i++) {
    const cx = bodyX + innerPad + i * (cellW + gap);
    const cy = bodyY + innerPad;
    const cls = mode === "idle" ? "bat-cell idle" : `bat-cell ${mode} c${i}`;
    cellRects += `<rect class="${cls}" x="${cx}" y="${cy}" width="${cellW}" height="${cellH}" rx="1.5"/>`;
  }
  // 功率已在连线旁展示，卡片内去掉「充 xxxW」；突出电池容量
  void wattsLabel;
  return `
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="8" fill="${fillBg}" stroke="${stroke}" stroke-width="${mode === "idle" ? 1 : 2}"/>
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="3" fill="#fff" stroke="${stroke}" stroke-width="1.4"/>
    <rect x="${bodyX + bodyW}" y="${bodyY + (bodyH - capH) / 2}" width="${capW}" height="${capH}" rx="1.5" fill="${stroke}"/>
    ${cellRects}
    <text x="${bx + bw / 2}" y="${by + 40}" text-anchor="middle" font-size="13" font-weight="800" fill="${capFill}">${flowEsc(capLabel || "—")}</text>
    <text x="${bx + bw / 2}" y="${by + 54}" text-anchor="middle" font-size="8" fill="#94a3b8">${flowEsc(limLabel)}</text>`;
}

/** Build per-device geometry + power from live shadow values. */
function buildDeviceFlowGeo(home, device, i, layout) {
  const v = device.values || {};
  const pv = Math.max(0, flowNum(v.pv_power_total));
  const grid = flowNum(v.grid_port_power ?? v.inverter_output_power);
  const bat = flowNum(v.battery_power);
  const offgrid = flowNum(v.offgrid1_export_power ?? v.battery_charging_power_grid);
  const soc = flowNum(v.current_soc ?? v.main_soc);
  const backup = flowNum(v.backup_soc);
  const batCapRaw = v.battery_capacity;
  const batCap =
    batCapRaw == null || batCapRaw === "" || Number.isNaN(Number(batCapRaw))
      ? null
      : Number(batCapRaw);
  const load = offgrid > 0 ? offgrid : 0;
  const micro = offgrid < 0 ? -offgrid : 0;
  // grid_port_power: 正数=馈网(放)，负数=买电(充)
  const acDchg = grid > 0 ? grid : 0;
  const acChg = grid < 0 ? -grid : 0;
  // battery_power: 正数=放电，负数=充电
  const absorb = bat < 0 ? -bat : 0;
  const bmsDchg = bat > 0 ? bat : 0;
  const x = layout.clusterX + layout.pad + i * (layout.unitW + layout.unitGap);
  const model = typeof modelMeta === "function" ? modelMeta(device) : { badge: device.model || "" };
  return {
    device,
    uid: device.uid,
    name: device.name || device.deviceId,
    model,
    i,
    x,
    ux: x + layout.unitW / 2,
    left: x,
    right: x + layout.unitW,
    top: layout.unitY,
    bottom: layout.unitY + layout.unitH,
    pv,
    grid,
    bat,
    batCap,
    soc,
    backup,
    load,
    micro,
    absorb,
    bmsDchg,
    acChg,
    acDchg,
    exportLimit: flowNum(v.regulation_grid_export_p_limit),
    outputLimit: flowNum(v.output_power_limit),
    inputLimit: flowNum(v.inverter_input_power_limit),
  };
}

/**
 * Estimate device card height so ① realtime rows are fully visible (no clip/scroll).
 * foreignObject height is fixed in SVG, so we size it from field counts + wrap labels.
 * @param {object} [device]
 * @returns {number}
 */
function estimateUnitCardHeight(device) {
  const liveCount =
    (typeof DP_DISPLAY !== "undefined" ? DP_DISPLAY.length : 5) +
    (typeof HOME_FAMILY_FIELDS !== "undefined" ? HOME_FAMILY_FIELDS.length : 5) +
    2; // cluster role + node id
  const liveRows = Math.ceil(liveCount / 2);
  let wrapExtra = 0;
  if (typeof HOME_FAMILY_FIELDS !== "undefined") {
    for (const f of HOME_FAMILY_FIELDS) {
      const len = String(f.label || "").length;
      if (len > 18) wrapExtra += 24;
      else if (len > 10) wrapExtra += 12;
    }
  }
  const editCount = 1 + (typeof DP_EDITABLE !== "undefined" ? DP_EDITABLE.length : 4);
  const editRows = Math.ceil(editCount / 2);
  const workShown = String(
    (device?.drafts?.work_mode || "").trim() || device?.values?.work_mode || ""
  );
  const scheduleExtra =
    workShown === "manual" || workShown === "time_of_use" ? 30 : 0;
  const headerH = 44;
  const l1H = 24 + liveRows * 20 + wrapExtra;
  const l2H = 24 + editRows * 44 + scheduleExtra;
  const l3H = 56;
  const l4H = 66;
  return Math.max(520, Math.min(800, headerH + l1H + l2H + l3H + l4H));
}

/** Field exists in device pid-schema (or schema not loaded yet → treat as available). */
function flowFieldInSchema(device, fieldOrCode) {
  if (typeof resolveSchemaEntry !== "function") return true;
  const schema = device.schema || {};
  if (!Object.keys(schema).length) return true; // 未拉 schema 前先正常展示
  const field =
    typeof fieldOrCode === "string"
      ? { code: fieldOrCode, aliases: [fieldOrCode] }
      : fieldOrCode;
  return !!resolveSchemaEntry(schema, field);
}

function unitCardHtml(g) {
  const d = g.device;
  const draftsN = typeof countDrafts === "function" ? countDrafts(d) : 0;
  const loading = d.loading ? "loading" : "";
  const schemaReady = Object.keys(d.schema || {}).length > 0;

  const kv = (lab, val, unit = "W", opts = {}) => {
    const missing = !!opts.missing;
    const cls = missing ? "kv missing" : "kv";
    const title = missing ? ' title="当前 PID 未定义此 DP"' : "";
    return `<div class="${cls}"${title}><span class="k">${flowEsc(lab)}</span><span class="v">${
      missing ? "—" : val == null || val === "" ? "—" : `${flowEsc(val)}${unit}`
    }</span></div>`;
  };

  const draftInput = (field, lab, unit, maxHint) => {
    const code = field.code;
    const missing = schemaReady && !flowFieldInSchema(d, field);
    // pid 未定义：删除线灰色展示，不可编辑（不计入可下发）
    if (missing) {
      return `<label class="fld missing" title="当前 PID 未定义此 DP（${flowEsc(code)}）">
        <span>${flowEsc(lab)}</span>
        <input type="text" value="—" disabled />
        <span class="u">${flowEsc(unit)}</span>
      </label>`;
    }
    const cur = d.values?.[code];
    const draft = (d.drafts?.[code] || "").trim();
    const echo = cur != null && cur !== "" && !Number.isNaN(Number(cur)) ? String(cur) : "";
    const shown = draft !== "" ? draft : echo;
    const dirty = draft !== "" && draft !== echo ? "dirty" : "";
    const maxAttr = maxHint != null ? ` max="${maxHint}" data-max="${maxHint}"` : "";
    return `<label class="fld">
      <span>${flowEsc(lab)}</span>
      <input type="number" inputmode="numeric" data-device-uid="${flowEsc(d.uid)}" data-field="${flowEsc(code)}"
        data-echo="${flowEsc(echo)}" value="${flowEsc(shown)}" placeholder="${flowEsc(echo || "—")}"
        min="0"${maxAttr} class="${dirty}" />
      <span class="u">${flowEsc(unit)}</span>
    </label>`;
  };

  const maxExport = g.model?.maxExport;
  const v = d.values || {};
  const displayFields =
    typeof DP_DISPLAY !== "undefined"
      ? DP_DISPLAY
      : [
          { code: "pv_power_total", label: "PV", unit: "W", aliases: ["pv_power_total"] },
          {
            code: "grid_port_power",
            label: "Grid",
            unit: "W",
            aliases: ["grid_port_power", "inverter_output_power"],
          },
          { code: "battery_power", label: "电池", unit: "W", aliases: ["battery_power"] },
          { code: "current_soc", label: "SOC", unit: "%", aliases: ["current_soc", "main_soc"] },
          { code: "backup_soc", label: "备用", unit: "%", aliases: ["backup_soc", "backup_reserve"] },
          {
            code: "battery_charging_power_grid",
            label: "离网口",
            unit: "W",
            aliases: ["offgrid1_export_power", "battery_charging_power_grid"],
          },
        ];
  const editableFields =
    typeof DP_EDITABLE !== "undefined"
      ? DP_EDITABLE
      : [
          { code: "backup_soc", label: "备用 SOC", unit: "%" },
          { code: "regulation_grid_export_p_limit", label: "法规输出上限(取小)", unit: "W", useModelMax: true },
          { code: "output_power_limit", label: "AC输出限制", unit: "W" },
          { code: "inverter_input_power_limit", label: "AC输入限制", unit: "W" },
        ];

  const workModeOpts =
    typeof HOME_FAMILY_FIELDS !== "undefined"
      ? HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode")?.options || []
      : [];
  const workCur = v.work_mode;
  const workDraft = (d.drafts?.work_mode || "").trim();
  const workShown = workDraft !== "" ? workDraft : workCur == null ? "" : String(workCur);
  const workDirty = workDraft !== "" && String(workDraft) !== String(workCur ?? "");
  const workMissing = schemaReady && workModeOpts.length && !flowFieldInSchema(d, { code: "work_mode", aliases: ["work_mode"] });
  const workModeHtml = workMissing
    ? `<label class="fld missing" title="当前 PID 未定义 work_mode"><span>工作模式</span><input type="text" value="—" disabled /><span class="u"></span></label>`
    : `<label class="fld">
        <span>工作模式</span>
        <select data-device-uid="${flowEsc(d.uid)}" data-field="work_mode" data-echo="${flowEsc(workCur == null ? "" : String(workCur))}" class="${workDirty ? "dirty" : ""}">
          <option value="">—</option>
          ${workModeOpts
            .map(
              (o) =>
                `<option value="${flowEsc(o.value)}" ${String(workShown) === String(o.value) ? "selected" : ""}>${flowEsc(o.label)}</option>`
            )
            .join("")}
        </select>
        <span class="u"></span>
      </label>
      ${
        String(workShown) === "manual"
          ? `<button type="button" class="btn btn-sm btn-ghost" data-act="manual-schedule" style="grid-column:1/-1">配置手动时段（8段）</button>`
          : String(workShown) === "time_of_use"
            ? `<button type="button" class="btn btn-sm btn-ghost" data-act="tou-schedule" style="grid-column:1/-1">配置分时时段（8段）</button>`
            : ""
      }`;

  // ①：固定顺序展示；PID 未定义 → 删除线灰色占位（不隐藏，保证各卡对齐）
  const liveHtml = displayFields
    .map((f) => {
      const missing = schemaReady && !flowFieldInSchema(d, f);
      let val = v[f.code];
      if (f.code === "current_soc" && (val == null || val === "")) val = v.main_soc;
      if (f.code === "backup_soc" && (val == null || val === "")) val = v.backup_reserve;
      if (f.code === "grid_port_power" && (val == null || val === "")) {
        val = v.inverter_output_power;
      }
      if (f.code === "battery_charging_power_grid" && (val == null || val === "")) {
        val = v.offgrid1_export_power;
      }
      if (!missing) {
        if (f.code === "pv_power_total") val = g.pv;
        if (f.code === "grid_port_power" || f.code === "grid_power") val = g.grid;
        if (f.code === "battery_power") val = g.bat;
        if (f.code === "current_soc") val = g.soc;
        if (f.code === "backup_soc") val = g.backup;
        if (f.code === "battery_charging_power_grid") val = g.load || g.micro || val;
      } else {
        val = null;
      }
      const short =
        f.label === "发电功率" ? "PV" : f.label === "并网口" ? "Grid" : f.label;
      return kv(short, val, f.unit || "W", { missing });
    })
    .join("");

  // 家庭侧：物模型始终展示；DP 类若不在 schema → 删除线灰色
  const workModeLabel = (() => {
    const raw = v.work_mode;
    if (raw == null || raw === "") return null;
    const field =
      typeof HOME_FAMILY_FIELDS !== "undefined"
        ? HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode")
        : null;
    const hit = (field?.options || []).find((o) => String(o.value) === String(raw));
    return hit ? hit.label : String(raw);
  })();
  const famLiveHtml = (typeof HOME_FAMILY_FIELDS !== "undefined" ? HOME_FAMILY_FIELDS : [])
    .map((f) => {
      const isDp = f.via === "dp";
      const missing = isDp && schemaReady && !flowFieldInSchema(d, f);
      if (f.code === "work_mode") {
        return kv("工作模式", missing ? null : workModeLabel, "", { missing });
      }
      const shortLab = f.label.replace(/(限制|功率)/g, "").trim() || f.label;
      return kv(shortLab, v[f.code], f.unit || "W", { missing });
    })
    .join("");

  // device_cluster_node_id：有值进对应集群；无值单机。角色仍用 device_cluster_role 展示。
  const clusterRaw = v.device_cluster_role;
  const clusterTxt =
    typeof clusterRoleLabel === "function" ? clusterRoleLabel(clusterRaw) : null;
  const nodeId =
    typeof deviceClusterNodeId === "function" ? deviceClusterNodeId(d) : v.device_cluster_node_id || null;
  const inClusterBox =
    typeof isClusterBoxMember === "function" ? isClusterBoxMember(d) : nodeId != null && nodeId !== "";
  const clusterHtml = kv(
    "集群角色",
    clusterTxt == null ? null : `${clusterTxt}${clusterRaw != null && clusterRaw !== "" ? ` (${clusterRaw})` : ""}`,
    ""
  );
  const nodeIdHtml = kv("集群身份", nodeId == null ? null : nodeId, "");

  // grid 口充放策略：理论状态放在 ④ 工况；实际状态来自主机 DP98
  const owner =
    typeof classifyOwnerWorkModel === "function" ? classifyOwnerWorkModel(d) : null;
  const actual = d.ownerActual || null;

  // ②：可下发区列出全部；PID 无此 dpcode → 删除线灰色、不可编辑
  const editHtml = editableFields
    .map((f) => draftInput(f, f.label, f.unit || "W", f.useModelMax ? maxExport : null))
    .join("");

  const roleNum = Number(clusterRaw);
  const roleKind =
    !inClusterBox || nodeId == null || nodeId === ""
      ? "solo"
      : roleNum === 0
        ? "master"
        : roleNum === 1
          ? "slave"
          : roleNum === 2
            ? "electing"
            : "solo";
  const roleBadge = inClusterBox
    ? `<span class="u3-role role-${roleKind}" title="node=${flowEsc(nodeId)} · role=${flowEsc(clusterRaw)}">${flowEsc(clusterTxt || "集群")}</span>`
    : clusterTxt
      ? `<span class="u3-role role-${roleKind}" title="device_cluster_role=${flowEsc(clusterRaw)}">${flowEsc(clusterTxt)}</span>`
      : `<span class="u3-role role-solo" title="无 device_cluster_node_id">单机</span>`;

  const theorBadge = owner
    ? `<button type="button" class="owner-chip m${owner.model}" data-act="owner-strat"
        title="点击查看判定公式">${flowEsc(owner.label)}</button>
       <span class="owner-caps">充${owner.chgCapW}/放${owner.dchgCapW}W</span>`
    : `<span class="hint">—</span>`;

  const actualTip = actual
    ? `DP98 编号 ${actual.numer === 10 ? "0x0A" : actual.numer}` +
      (actual.fromMaster ? " · 自主机报文" : " · 本机报文") +
      ` · 充${actual.chgCapW}W / 放${actual.dchgCapW}W`
    : "尚未解析到 DP98 / command_receive";
  const actualBadge = actual
    ? `<span class="owner-chip m${actual.model}" title="${flowEsc(actualTip)}">${flowEsc(actual.label)}</span>
       <span class="owner-caps" title="${flowEsc(actualTip)}">#${
         actual.numer === 10 ? "A" : actual.numer
       } · 充${actual.chgCapW}/放${actual.dchgCapW}W</span>`
    : `<span class="hint">—</span>`;

  return `<div xmlns="http://www.w3.org/1999/xhtml" class="u3 ${loading}" data-uid="${flowEsc(d.uid)}" data-device-uid="${flowEsc(d.uid)}">
    <div class="u3-name">
      <div class="u3-title">
        <span class="u3-devname" title="${flowEsc(g.name)}">${flowEsc(g.name)}</span>
        <button type="button" class="u3-devid" data-act="copy-id" title="点击复制设备 ID">${flowEsc(d.deviceId)}</button>
      </div>
      <span class="u3-actions">
        <button type="button" class="u3-btn" data-act="refresh" title="读取">↻</button>
        ${roleBadge}
        <span style="font-size:10px;color:#94a3b8">${flowEsc(g.model.badge || "")}</span>
      </span>
    </div>
    <div class="layer l1">
      <div class="lh"><span>① 实时上报</span><span>影子</span></div>
      <div class="grid2">
        ${liveHtml}
        ${famLiveHtml}
        ${clusterHtml}
        ${nodeIdHtml}
      </div>
    </div>
    <div class="layer l2">
      <div class="lh"><span>② 可下发</span><span>草稿</span></div>
      <div class="grid2">
        ${workModeHtml}
        ${editHtml}
      </div>
    </div>
    <div class="layer l3">
      <div class="lh"><span>③ 操作</span><span>${
        typeof deviceReadAgoLabel === "function"
          ? deviceReadAgoLabel(d)
          : d.lastReadAt
            ? "已读"
            : "未读"
      }</span></div>
      <div class="u3-foot">
        <button type="button" class="u3-eye" data-act="more-points" title="展示更多点位">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
        <button type="button" class="u3-link" data-act="reg-query" title="按寄存器地址反查物模型并读值">寄存器查询</button>
        <span class="u3-foot-spacer"></span>
        <button type="button" class="u3-link" data-act="edit">编辑</button>
        <button type="button" class="u3-link danger" data-act="remove">移除</button>
        <button type="button" class="u3-issue ${draftsN ? "on" : ""}" data-act="issue" ${draftsN ? "" : "disabled"}>
          ${draftsN ? `下发 (${draftsN})` : "下发"}
        </button>
      </div>
    </div>
    <div class="layer l4">
      <div class="lh"><span>④ 工况</span><span>理论 / 实际</span></div>
      <div class="owner-status-rows">
        <div class="owner-status-row">
          <span class="owner-status-lab">理论状态</span>
          <span class="owner-status-val">${theorBadge}</span>
        </div>
        <div class="owner-status-row">
          <span class="owner-status-lab">实际状态</span>
          <span class="owner-status-val">${actualBadge}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function renderFamilyRail(home) {
  const meters = home.meters || [];
  const devices = home.devices || [];
  const meter = meters[0];
  const gridPow =
    typeof resolveGridNodePower === "function"
      ? resolveGridNodePower(home)
      : {
          watts:
            meter?.lastValue == null || Number.isNaN(Number(meter.lastValue))
              ? null
              : Number(meter.lastValue),
          source: "meter",
          label: meter?.name || meter?.deviceId || "未添加电表",
        };
  const meterW =
    gridPow.watts == null || Number.isNaN(Number(gridPow.watts))
      ? "—"
      : `${gridPow.watts}W`;
  const meterName =
    gridPow.source === "lan"
      ? gridPow.label
      : meter?.name || meter?.deviceId || "未添加电表";
  const meterAgo =
    typeof meterReadAgoLabel === "function" && meter
      ? meterReadAgoLabel(meter)
      : meter?.lastReadAt
        ? "已读"
        : gridPow.source === "lan"
          ? "来自选中一体机 DP26"
          : "未读";
  const lanSelId = String(
    home.lanMeterDeviceId ||
      (typeof resolveLanMeterDevice === "function"
        ? resolveLanMeterDevice(home)?.deviceId
        : "") ||
      ""
  ).trim();
  const lanSelect =
    !meters.length && devices.length
      ? `<label class="fb-lan-src">电网功率来源一体机
          <select data-act="lan-meter-device">
            ${devices
              .map(
                (d) =>
                  `<option value="${flowEsc(d.deviceId)}" ${
                    lanSelId === String(d.deviceId) ? "selected" : ""
                  }>${flowEsc(d.name || d.deviceId)}</option>`
              )
              .join("")}
          </select>
          <span class="fb-hint">无电表时取 DP26 局域网电表配对功率</span>
        </label>`
      : "";

  const meterCards = meters.length
    ? meters
        .map(
          (m) => `<div class="rail-meter" data-meter-uid="${flowEsc(m.uid)}">
      <div class="rm-title">
        <input class="rm-name" data-act="meter-name" value="${flowEsc(m.name || "")}" placeholder="电表名称" />
        <span class="badge-meter">${m.isThirdParty ? "三方电表" : "电表"}</span>
      </div>
      <div class="rm-sub">${flowEsc(m.deviceId)}</div>
      <div class="rm-power ${m.lastValue != null && m.lastValue < 0 ? "neg" : ""}">${
            m.lastValue == null ? "—" : `${m.lastValue}W`
          }</div>
      <div class="rm-ago" data-meter-ago-uid="${flowEsc(m.uid)}">${flowEsc(
            typeof meterReadAgoLabel === "function" ? meterReadAgoLabel(m) : ""
          )}</div>
      <div class="rm-ops">
        <button type="button" class="btn btn-sm btn-ghost" data-act="meter-read">读取</button>
        <button type="button" class="btn-link" data-act="meter-edit">编辑</button>
        <button type="button" class="btn-link danger" data-act="meter-remove">移除</button>
      </div>
    </div>`
        )
        .join("")
    : `<div class="rail-empty">尚未添加电表${
        devices.length ? " · 电网功率可用一体机 DP26" : ""
      }</div>`;

  const devList = devices
    .map(
      (d) => `<button type="button" class="rail-dev${
        !meters.length && lanSelId === String(d.deviceId) ? " active" : ""
      }" data-device-uid="${flowEsc(d.uid)}" title="${
        !meters.length ? "选为电网功率来源（DP26）" : "点击复制设备 ID"
      }">
      <span class="rd-name">${flowEsc(d.name || d.deviceId)}</span>
      <span class="rd-meta">${flowEsc(d.deviceId)}</span>
    </button>`
    )
    .join("");

  const values = home.familyValues || {};
  const drafts = home.familyDrafts || {};
  const famDraftN = typeof countFamilyDrafts === "function" ? countFamilyDrafts(home) : 0;

  const famFields =
    typeof HOME_FAMILY_FIELDS !== "undefined"
      ? HOME_FAMILY_FIELDS.map((f) => {
          const echo = values[f.code];
          const echoStr = echo == null || echo === "" ? "" : String(echo);
          const draft = (drafts[f.code] || "").trim();
          const shown = draft !== "" ? draft : echoStr;
          const dirty = draft !== "" && draft !== echoStr ? "dirty" : "";
          if (f.type === "enum") {
            const opts = (f.options || [])
              .map(
                (o) =>
                  `<option value="${flowEsc(o.value)}" ${
                    String(shown) === String(o.value) ? "selected" : ""
                  }>${flowEsc(o.label)}</option>`
              )
              .join("");
            const extra =
              f.code === "work_mode" && String(shown) === "manual"
                ? `<button type="button" class="btn btn-sm btn-ghost fam-manual-btn" data-act="family-manual-schedule">配置手动时段</button>`
                : f.code === "work_mode" && String(shown) === "time_of_use"
                  ? `<button type="button" class="btn btn-sm btn-ghost fam-manual-btn" data-act="family-tou-schedule">配置分时时段</button>`
                  : "";
            return `<label class="fam-fld">
              <span class="ff-lab">${flowEsc(f.label)}</span>
              <select data-fam-field="${flowEsc(f.code)}" data-echo="${flowEsc(echoStr)}" class="${dirty}">
                <option value="">—</option>
                ${opts}
              </select>
              ${extra}
            </label>`;
          }
          return `<label class="fam-fld">
            <span class="ff-lab">${flowEsc(f.label)}</span>
            <span class="ff-input">
              <input type="number" inputmode="numeric" data-fam-field="${flowEsc(f.code)}"
                data-echo="${flowEsc(echoStr)}" value="${flowEsc(shown)}" placeholder="${flowEsc(echoStr || "—")}"
                class="${dirty}" />
              <span class="u">${flowEsc(f.unit || "")}</span>
            </span>
          </label>`;
        }).join("")
      : "";

  const fold = (typeof loadFamilyRailFold === "function" ? loadFamilyRailFold() : {}) || {};
  // 设备多时默认折叠列表，避免挤掉参数区；用户折叠偏好优先生效
  const metersFolded = fold.meters === true;
  const paramsFolded = fold.params === true;
  const devicesFolded =
    fold.devices === true || (fold.devices == null && devices.length >= 5);

  return `
    <div class="family-bar">
      <div class="fb-hd">
        <strong>家庭侧</strong>
        <span class="fb-sub">电表 · 可下发参数 · 设备列表</span>
      </div>
      <div class="fb-scroll">
        <div class="fb-block">
          <div class="fb-label">入户电表功率</div>
          <div class="fb-meter-val">${flowEsc(meterW)}</div>
          <div class="fb-hint">${flowEsc(meterName)}</div>
          <div class="fb-hint meter-read-ago" data-meter-ago>${flowEsc(meterAgo)}</div>
          ${lanSelect}
        </div>
        <div class="fb-block fb-fold${metersFolded ? " is-collapsed" : ""}" data-fold="meters">
          <button type="button" class="fb-fold-hd" data-act="fb-fold" aria-expanded="${metersFolded ? "false" : "true"}">
            <span class="fb-label">电表设备</span>
            <span class="fb-chevron" aria-hidden="true"></span>
          </button>
          <div class="fb-fold-body">${meterCards}</div>
        </div>
        <div class="fb-block fam-params fb-fold${paramsFolded ? " is-collapsed" : ""}" data-fold="params">
          <button type="button" class="fb-fold-hd" data-act="fb-fold" aria-expanded="${paramsFolded ? "false" : "true"}">
            <span class="fb-label">家庭参数（下发到全部一体机）</span>
            <span class="fb-chevron" aria-hidden="true"></span>
          </button>
          <div class="fb-fold-body">
            <div class="fam-fields">${famFields}</div>
            <div class="fb-hint">改动后将对家庭内 ${devices.length} 台设备逐台下发</div>
          </div>
        </div>
        <div class="fb-block fb-fold${devicesFolded ? " is-collapsed" : ""}" data-fold="devices">
          <button type="button" class="fb-fold-hd" data-act="fb-fold" aria-expanded="${devicesFolded ? "false" : "true"}">
            <span class="fb-label">一体机 (${devices.length})</span>
            <span class="fb-chevron" aria-hidden="true"></span>
          </button>
          <div class="fb-fold-body">
            <div class="rail-dev-list">${devList || '<div class="rail-empty">暂无设备</div>'}</div>
          </div>
        </div>
      </div>
      <div class="fb-foot">
        <span class="fb-foot-hint">${famDraftN ? `${famDraftN} 项待下发` : "无草稿"}</span>
        <button type="button" class="u3-issue ${famDraftN ? "on" : ""}" data-act="family-issue"
          ${famDraftN ? "" : "disabled"}>${famDraftN ? `下发 (${famDraftN})` : "下发"}</button>
      </div>
    </div>`;
}

/**
 * Render algo_core-style energy flow for a live home.
 * @returns {string} HTML
 */
function renderHomeEnergyFlow(home) {
  const devices = home.devices || [];
  const meters = home.meters || [];
  const meter = meters[0];
  const gridPow =
    typeof resolveGridNodePower === "function"
      ? resolveGridNodePower(home)
      : {
          watts: flowNum(meter?.lastValue),
          source: "meter",
        };
  const meterW = gridPow.watts == null ? 0 : flowNum(gridPow.watts);
  const hasGridPow =
    gridPow.watts != null && Number.isFinite(Number(gridPow.watts));
  const meterAgoTxt =
    typeof meterReadAgoLabel === "function" && meter
      ? meterReadAgoLabel(meter)
      : meter?.lastReadAt
        ? "已读"
        : gridPow.source === "lan"
          ? "DP26"
          : "未读";

  if (!devices.length) {
    return `<div class="home-flow-shell">
      <aside class="flow-rail">${renderFamilyRail(home)}</aside>
      <div class="flow-main"><div class="flow-empty">暂无储能设备。点击「+ 新增设备」添加后，将在此展示能量流向。</div></div>
    </div>`;
  }

  const grouped =
    typeof groupDevicesByCluster === "function"
      ? groupDevicesByCluster(devices)
      : {
          clusters: (() => {
            const members = devices.filter((d) =>
              typeof isClusterBoxMember === "function" ? isClusterBoxMember(d) : false
            );
            return members.length ? [{ nodeId: "?", devices: members }] : [];
          })(),
          solos: devices.filter(
            (d) => !(typeof isClusterBoxMember === "function" ? isClusterBoxMember(d) : false)
          ),
        };
  const clusterGroups = grouped.clusters || [];
  const soloDevices = grouped.solos || [];
  const ncTotal = clusterGroups.reduce((n, g) => n + (g.devices?.length || 0), 0);
  const ns = soloDevices.length;
  const nn = devices.length;
  const unitW = 248;
  const unitGap = 18;
  const unitH = Math.max(
    520,
    ...devices.map((d) => estimateUnitCardHeight(d))
  );
  const pad = 14;
  const soloGap = 28;
  const leftLane = 28 + nn * 16;
  const rightLane = 36 + nn * 16;

  const clusterBoxes = [];
  let xCursor = 24 + leftLane;
  for (const cg of clusterGroups) {
    const n = cg.devices.length;
    if (!n) continue;
    const w = pad * 2 + n * unitW + Math.max(0, n - 1) * unitGap;
    clusterBoxes.push({ nodeId: cg.nodeId, devices: cg.devices, x: xCursor, w, n });
    xCursor += w + soloGap;
  }
  const soloStartX = clusterBoxes.length ? xCursor : 24 + leftLane;
  const soloBlockW = ns > 0 ? ns * unitW + Math.max(0, ns - 1) * unitGap : 0;
  const clusterSpanW = clusterBoxes.length
    ? clusterBoxes[clusterBoxes.length - 1].x +
      clusterBoxes[clusterBoxes.length - 1].w -
      clusterBoxes[0].x
    : 0;
  const firstClusterX = clusterBoxes.length ? clusterBoxes[0].x : soloStartX;
  const unitsSpanW =
    (clusterBoxes.length ? clusterSpanW : 0) +
    (clusterBoxes.length && ns > 0 ? soloGap : 0) +
    soloBlockW;
  const gridTop = 10;
  const gridH =
    typeof busDefaultSize === "function" ? busDefaultSize("grid").h : 72;
  const topBand = 48 + nn * 10;
  const clusterY = gridTop + gridH + topBand;
  const clusterTopPad = 36;
  const clusterBotPad = 88;
  const clusterH = clusterTopPad + unitH + clusterBotPad;
  const unitY = clusterY + clusterTopPad;
  const bmsH = 62;
  const bmsW = Math.min(96, unitW - 36);
  const bmsY = clusterY + clusterH + 36;
  const avgBarH = 30;
  const avgBarY = bmsY + bmsH + 14;
  const loadY = avgBarY + avgBarH + 28;
  const vbW0 = Math.max(960, firstClusterX + unitsSpanW + rightLane + 280);
  let vbW = vbW0;
  let vbH = loadY + 100;
  const gridCx = firstClusterX + (ncTotal > 0 || ns > 0 ? unitsSpanW : 0) / 2;

  const geos = [];
  for (const box of clusterBoxes) {
    const layoutCluster = {
      clusterX: box.x,
      pad,
      unitW,
      unitGap,
      unitY,
      unitH,
      nodeId: box.nodeId,
    };
    box.devices.forEach((d, i) => {
      geos.push(buildDeviceFlowGeo(home, d, i, layoutCluster));
    });
  }
  const layoutSolo = { clusterX: soloStartX, pad: 0, unitW, unitGap, unitY, unitH };
  soloDevices.forEach((d, i) => {
    geos.push(buildDeviceFlowGeo(home, d, i, layoutSolo));
  });
  // edges / fan still need a layout ref for unitW etc.
  const layout = {
    clusterX: firstClusterX,
    pad,
    unitW,
    unitGap,
    unitY,
    unitH,
  };
  const clusterX = firstClusterX;
  const nc = ncTotal;

  // ---- wiring buses layout ----
  const wiring =
    typeof ensureHomeWiring === "function"
      ? ensureHomeWiring(home)
      : home.wiring || { buses: [], devices: {} };
  const busBoxes = {};
  const kindIdx = { pv: 0, grid: 0, bypass: 0, family: 0 };
  const layoutCtx = { vbW: vbW0, gridTop, gridCx, loadY };
  for (const b of wiring.buses) {
    const size = typeof busDefaultSize === "function" ? busDefaultSize(b.kind) : { w: 120, h: 56 };
    const idx = kindIdx[b.kind] || 0;
    kindIdx[b.kind] = idx + 1;
    const def =
      typeof defaultBusPosition === "function"
        ? defaultBusPosition(b.kind, idx, layoutCtx)
        : { x: 24, y: 16 };
    const pos =
      typeof parseBusCoord === "function"
        ? parseBusCoord(b.x, b.y)
        : {
            x: b.x != null && b.x !== "" && Number.isFinite(Number(b.x)) ? Number(b.x) : null,
            y: b.y != null && b.y !== "" && Number.isFinite(Number(b.y)) ? Number(b.y) : null,
          };
    // (0,0) was a legacy normalize bug for "unset" — use default layout
    const useDef = pos.x == null || pos.y == null;
    const x = useDef ? def.x : pos.x;
    const y = useDef ? def.y : pos.y;
    busBoxes[b.id] = { x, y, w: size.w, h: size.h, bus: b };
    vbW = Math.max(vbW, x + size.w + 32);
    vbH = Math.max(vbH, y + size.h + 32);
  }
  const pvBuses = wiring.buses.filter((b) => b.kind === "pv");
  const gridBuses = wiring.buses.filter((b) => b.kind === "grid");
  const bypassBuses = wiring.buses.filter((b) => b.kind === "bypass");
  const familyBuses = wiring.buses.filter((b) => b.kind === "family");

  const portOf = (g) =>
    typeof deviceWiringPorts === "function"
      ? deviceWiringPorts(home, g.device)
      : wiring.devices?.[g.device.uid] || { pv: "", grid: "", offgrid: "" };

  const busPower = (busId, kind) => {
    let pv = 0;
    let load = 0;
    let micro = 0;
    let dchg = 0;
    let chg = 0;
    for (const g of geos) {
      const p = portOf(g);
      if (kind === "pv" && p.pv === busId) pv += g.pv;
      if (kind === "grid" && p.grid === busId) {
        dchg += g.acDchg;
        chg += g.acChg;
      }
      if ((kind === "bypass" || kind === "family") && p.offgrid === busId) {
        load += g.load;
        micro += g.micro;
      }
    }
    return { pv, load, micro, dchg, chg };
  };

  const pvTotal = geos.reduce((s, g) => s + g.pv, 0);
  const microSum = geos.reduce((s, g) => s + g.micro, 0);
  const loadSum = geos.reduce((s, g) => s + g.load, 0);
  const gridDchgTot = geos.reduce((s, g) => s + g.acDchg, 0);
  const gridChgTot = geos.reduce((s, g) => s + g.acChg, 0);
  // 家庭负载功率（能量守恒 / algo_core）：
  //   有电表或 DP26：P = meter − Σ(−grid口) = meter + Σ(grid)
  //   都没有：P = 基础负载 + 插座
  // 注：逆流上限（feedin）是限值，不参与负载估算
  const sumNegGrid = geos.reduce((s, g) => s + -g.grid, 0);
  const hasMeter =
    meter?.lastValue != null && meter.lastValue !== "" && Number.isFinite(Number(meter.lastValue));
  const famPower = hasMeter || (gridPow.source === "lan" && hasGridPow)
    ? Math.round(meterW - sumNegGrid)
    : Math.round(
        flowNum(home.familyValues?.base_load) + flowNum(home.familyValues?.total_plug_power)
      );
  const famFromGrid = Math.max(0, famPower);
  const famOn = famFromGrid > 0;
  const gridTake = hasGridPow && meterW > 0;
  const gridFeed = hasGridPow && meterW < 0;
  const gridNetTxt = !hasGridPow
    ? gridPow.source === "lan"
      ? `DP26 —`
      : `净交换 —`
    : gridFeed
      ? `馈网 ${-meterW}W`
      : gridTake
        ? `取电 ${meterW}W`
        : `净交换 0W`;
  const gridSubTxt =
    gridPow.source === "lan"
      ? `DP26 · 机放 ${gridDchgTot} · 机充 ${gridChgTot}`
      : `机放 ${gridDchgTot} · 机充 ${gridChgTot}`;

  let gridFill = "#f8fafc";
  let gridStroke = "#94a3b8";
  let gridSw = 1;
  let gridCls = "";
  let gridTitleFill = "#475569";
  let gridNetFill = "#64748b";
  let gridNetSize = 11;
  if (gridTake) {
    gridFill = "#fef2f2";
    gridStroke = "#ef4444";
    gridSw = 3;
    gridCls = "grid-node-alert";
    gridTitleFill = "#991b1b";
    gridNetFill = "#dc2626";
    gridNetSize = 14;
  } else if (gridFeed) {
    gridFill = "#eff6ff";
    gridStroke = "#2563eb";
    gridSw = 3;
    gridCls = "grid-node-alert";
    gridTitleFill = "#1e40af";
    gridNetFill = "#2563eb";
    gridNetSize = 14;
  } else if (gridDchgTot || gridChgTot) {
    gridFill = "#ecfdf5";
    gridStroke = "#22c55e";
    gridSw = 2;
    gridTitleFill = "#166534";
    gridNetFill = "#15803d";
  }

  const wireMode = typeof wiringEditMode !== "undefined" && wiringEditMode;

  const edges = geos
    .map((g) => {
      const parts = [];
      const ports = portOf(g);
      const midI = (nn - 1) / 2;
      const fan = (g.i - midI) * 28;
      const topPv = g.x + unitW * 0.18;
      const topChg = g.x + unitW * 0.4;
      const topDchg = g.x + unitW * 0.62;
      const topOff = g.x + unitW * 0.82;
      const botLoad = g.x + unitW * 0.72;

      // PV bus → device：已接线就画拓扑线；有功率时再叠功率流
      if (ports.pv && busBoxes[ports.pv]) {
        const box = busBoxes[ports.pv];
        const sx = box.x + box.w;
        const sy = box.y + box.h / 2;
        const ex = topPv;
        const ey = g.top;
        const bx = -48 - (nn - 1 - g.i) * 22;
        const by = 22 + fan * 0.25;
        const mid = flowCurveMid(sx, sy, ex, ey, bx, by);
        const d = flowCurve(sx, sy, ex, ey, bx, by);
        if (g.pv > 0) {
          parts.push(
            `<path class="${flowEdgeClass("pv", g.pv)}" d="${d}" marker-end="url(#arrAmber)"/>`
          );
          parts.push(
            `<text class="flow-label active" x="${mid.x}" y="${mid.y - 4}" text-anchor="middle" fill="#b45309">${g.pv}W</text>`
          );
        } else {
          parts.push(`<path class="flow-edge wired pv" d="${d}" />`);
        }
        if (wireMode) parts.push(flowWireUnlinkHit(d, g.uid, "pv"));
      }

      // Offgrid ↔ bypass/family
      if (ports.offgrid && busBoxes[ports.offgrid]) {
        const box = busBoxes[ports.offgrid];
        if (g.load > 0) {
          const sx = botLoad;
          const sy = g.bottom;
          const ex = box.x;
          const ey = box.y + box.h / 2;
          const bx = 56 + g.i * 20;
          const by = 36 + fan * 0.3;
          const mid = flowCurveMid(sx, sy, ex, ey, bx, by);
          const d = flowCurve(sx, sy, ex, ey, bx, by);
          parts.push(
            `<path class="${flowEdgeClass("load", g.load)}" d="${d}" marker-end="url(#arrGray)"/>`
          );
          parts.push(
            `<text class="flow-label active" x="${mid.x}" y="${mid.y - 4}" text-anchor="middle" fill="#475569">${g.load}W</text>`
          );
          if (wireMode) parts.push(flowWireUnlinkHit(d, g.uid, "offgrid"));
        } else if (g.micro > 0) {
          const sx = box.x;
          const sy = box.y + box.h / 2;
          const ex = topOff;
          const ey = g.top;
          const bx = 48 + g.i * 22;
          const by = 20 + fan * 0.2;
          const mid = flowCurveMid(sx, sy, ex, ey, bx, by);
          const d = flowCurve(sx, sy, ex, ey, bx, by);
          parts.push(
            `<path class="${flowEdgeClass("micro", g.micro)}" d="${d}" marker-end="url(#arrSky)"/>`
          );
          parts.push(
            `<text class="flow-label active" x="${mid.x}" y="${mid.y - 4}" text-anchor="middle" fill="#0369a1">${g.micro}W</text>`
          );
          if (wireMode) parts.push(flowWireUnlinkHit(d, g.uid, "offgrid"));
        } else {
          const sx = botLoad;
          const sy = g.bottom;
          const ex = box.x;
          const ey = box.y + box.h / 2;
          const bx = 56 + g.i * 20;
          const by = 36 + fan * 0.3;
          const d = flowCurve(sx, sy, ex, ey, bx, by);
          parts.push(`<path class="flow-edge wired offgrid" d="${d}" />`);
          if (wireMode) parts.push(flowWireUnlinkHit(d, g.uid, "offgrid"));
        }
      }

      // Grid ↔ device
      if (ports.grid && busBoxes[ports.grid]) {
        const box = busBoxes[ports.grid];
        if (g.acDchg > 0) {
          const sx = topDchg;
          const sy = g.top;
          const ex = box.x + box.w / 2 + 18;
          const ey = box.y + box.h;
          const bx = 24 + fan * 0.5;
          const by = -28 - g.i * 8;
          const mid = flowCurveMid(sx, sy, ex, ey, bx, by);
          const d = flowCurve(sx, sy, ex, ey, bx, by);
          parts.push(
            `<path class="${flowEdgeClass("discharge", g.acDchg)}" d="${d}" marker-end="url(#arrPurple)"/>`
          );
          parts.push(
            `<text class="flow-label active" x="${mid.x}" y="${mid.y - 4}" text-anchor="middle" fill="#7e22ce">${g.acDchg}W</text>`
          );
          if (wireMode) parts.push(flowWireUnlinkHit(d, g.uid, "grid"));
        } else if (g.acChg > 0) {
          const sx = box.x + box.w / 2 - 18;
          const sy = box.y + box.h;
          const ex = topChg;
          const ey = g.top;
          const bx = -20 + fan * 0.5;
          const by = -24 - (nn + g.i) * 6;
          const mid = flowCurveMid(sx, sy, ex, ey, bx, by);
          const d = flowCurve(sx, sy, ex, ey, bx, by);
          parts.push(
            `<path class="${flowEdgeClass("charge", g.acChg)}" d="${d}" marker-end="url(#arrBlue)"/>`
          );
          parts.push(
            `<text class="flow-label active" x="${mid.x}" y="${mid.y - 4}" text-anchor="middle" fill="#1d4ed8">${g.acChg}W</text>`
          );
          if (wireMode) parts.push(flowWireUnlinkHit(d, g.uid, "grid"));
        } else {
          const sx = box.x + box.w / 2;
          const sy = box.y + box.h;
          const ex = topChg;
          const ey = g.top;
          const bx = 0;
          const by = -30 - g.i * 6;
          const d = flowCurve(sx, sy, ex, ey, bx, by);
          parts.push(`<path class="flow-edge wired grid" d="${d}" />`);
          if (wireMode) parts.push(flowWireUnlinkHit(d, g.uid, "grid"));
        }
      }
      return parts.join("");
    })
    .join("");

  // Grid → family load (meter path): link first grid bus to first family bus when meter taking power
  let famEdge = "";
  const primaryGrid = gridBuses[0] && busBoxes[gridBuses[0].id];
  const primaryFam = familyBuses[0] && busBoxes[familyBuses[0].id];
  if (famOn && primaryGrid && primaryFam) {
    const sx = primaryGrid.x + primaryGrid.w / 2 + 28;
    const sy = primaryGrid.y + primaryGrid.h;
    const ex = primaryFam.x + primaryFam.w / 2;
    const ey = primaryFam.y;
    const mid = flowCurveMid(sx, sy, ex, ey, 40, 20);
    famEdge = `
      <path class="${flowEdgeClass("other", famFromGrid)}" d="${flowCurve(sx, sy, ex, ey, 40, 20)}" marker-end="url(#arrOrange)"/>
      <text class="flow-label active" x="${mid.x}" y="${mid.y - 4}" text-anchor="middle" fill="#c2410c">${famFromGrid}W</text>`;
  }

  const busNodesSvg = wiring.buses
    .map((b) => {
      const box = busBoxes[b.id];
      if (!box) return "";
      const pwr = busPower(b.id, b.kind);
      const moveHit = `<rect class="bus-move-hit" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
          data-bus-move data-bus-id="${flowEsc(b.id)}" />`;
      const plug = wireMode
        ? `<circle class="wire-plug" cx="${box.x + box.w / 2}" cy="${box.y + box.h}" r="8"
            data-wire-src="bus:${flowEsc(b.id)}" data-bus-id="${flowEsc(b.id)}" data-bus-kind="${flowEsc(b.kind)}">
            <title>拖到设备端口接线</title></circle>`
        : "";
      let body = "";
      if (b.kind === "pv") {
        const on = pwr.pv > 0;
        body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10" fill="#fff7ed" stroke="#f59e0b" stroke-width="${on ? 2 : 1}"/>
          <text x="${box.x + box.w / 2}" y="${box.y + 22}" text-anchor="middle" font-size="12" font-weight="700" fill="#9a3412">${flowEsc(b.label)}</text>
          <text x="${box.x + box.w / 2}" y="${box.y + 40}" text-anchor="middle" font-size="11" fill="#b45309">${on ? pwr.pv + "W" : "—"}</text>`;
      } else if (b.kind === "grid") {
        body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
            class="${gridCls}" fill="${gridFill}" stroke="${gridStroke}" stroke-width="${gridSw}"/>
          <text x="${box.x + box.w / 2}" y="${box.y + 14}" text-anchor="middle" font-size="12" font-weight="700" fill="${gridTitleFill}">${flowEsc(b.label)}</text>
          <text x="${box.x + box.w / 2}" y="${box.y + 32}" text-anchor="middle" font-size="${gridNetSize}" font-weight="700" fill="${gridNetFill}">${flowEsc(gridNetTxt)}</text>
          <text x="${box.x + box.w / 2}" y="${box.y + 48}" text-anchor="middle" font-size="10" fill="#64748b">机放 ${pwr.dchg} · 机充 ${pwr.chg}</text>
          <text class="meter-read-ago" data-meter-ago x="${box.x + box.w / 2}" y="${box.y + 64}" text-anchor="middle" font-size="9" fill="#94a3b8">${flowEsc(meterAgoTxt)}</text>`;
      } else if (b.kind === "bypass") {
        const on = pwr.load > 0 || pwr.micro > 0;
        const sub = pwr.micro > 0 ? `微逆 ${pwr.micro}W` : pwr.load > 0 ? `${pwr.load}W` : "—";
        body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
            fill="${on ? "#f1f5f9" : "#f8fafc"}" stroke="${on ? "#334155" : "#94a3b8"}" stroke-width="${on ? 2 : 1}"/>
          <text x="${box.x + box.w / 2}" y="${box.y + 20}" text-anchor="middle" font-size="11" font-weight="700">${flowEsc(b.label)}</text>
          <text x="${box.x + box.w / 2}" y="${box.y + 38}" text-anchor="middle" font-size="12">${flowEsc(sub)}</text>`;
      } else {
        // 家庭负载：能量守恒算出的 P_family（可正可负）
        const on = famOn || famPower !== 0 || pwr.load > 0;
        const sub = pwr.load > 0 ? `离网 ${pwr.load}W` : `${famPower}W`;
        body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
          fill="${on ? "#fff7ed" : "#f8fafc"}" stroke="${on ? "#f97316" : "#94a3b8"}" stroke-width="${on ? 2 : 1}"/>
        <text x="${box.x + box.w / 2}" y="${box.y + 18}" text-anchor="middle" font-size="11" font-weight="700" fill="#9a3412">${flowEsc(b.label)}</text>
        <text x="${box.x + box.w / 2}" y="${box.y + 36}" text-anchor="middle" font-size="13" font-weight="700" fill="#c2410c">${flowEsc(sub)}</text>`;
      }
      return `<g class="wire-bus-node movable${wireMode ? " editable" : ""}" data-bus-id="${flowEsc(b.id)}">${body}${moveHit}${plug}</g>`;
    })
    .join("");

  const portPadsSvg = wireMode
    ? geos
        .map((g) => {
          const ports = portOf(g);
          const pad = (port, x, y, lab) => {
            const on = !!ports[port];
            return `<g class="wire-port-pad${on ? " on" : ""}" data-wire-dst="device:${flowEsc(g.uid)}:${port}"
                data-wire-src="device:${flowEsc(g.uid)}:${port}" data-port="${port}" data-device-uid="${flowEsc(g.uid)}">
              <circle class="wire-hit" cx="${x}" cy="${y}" r="22" fill="transparent" stroke="none"/>
              <circle cx="${x}" cy="${y}" r="11" />
              <text x="${x}" y="${y + 3}" text-anchor="middle" font-size="9" font-weight="700">${lab}</text>
              ${on ? `<title>已接 · 点线或双击断开</title>` : `<title>拖到此处接线</title>`}
            </g>`;
          };
          return `${pad("pv", g.x + unitW * 0.22, g.top - 2, "PV")}
            ${pad("grid", g.x + unitW * 0.78, g.top - 2, "Grid")}
            ${pad("offgrid", g.ux, g.bottom + 6, "离网")}`;
        })
        .join("")
    : "";

  const unitBodies = geos
    .map((g) => {
      const bx = g.ux - bmsW / 2;
      const bmsBend = (g.i - (nn - 1) / 2) * 6;
      const charging = g.absorb > 0;
      const discharging = !charging && g.bmsDchg > 0;
      const mode = charging ? "chg" : discharging ? "dchg" : "idle";
      let bmsEdge = "";
      let wattsLabel = "待机";
      if (charging) {
        const bmsPath = flowCurve(g.ux, g.bottom, g.ux, bmsY, bmsBend, 0);
        const bmsMid = flowCurveMid(g.ux, g.bottom, g.ux, bmsY, bmsBend, 0);
        bmsEdge = `<path class="${flowEdgeClass("bms", g.absorb)}" d="${bmsPath}" marker-end="url(#arrBms)"/>
          <text class="flow-label active" x="${bmsMid.x + 14}" y="${bmsMid.y + 3}" fill="#15803d">${g.absorb}W↓充</text>`;
        wattsLabel = `充 ${g.absorb}W`;
      } else if (discharging) {
        const bmsPath = flowCurve(g.ux, bmsY, g.ux, g.bottom, bmsBend, 0);
        const bmsMid = flowCurveMid(g.ux, bmsY, g.ux, g.bottom, bmsBend, 0);
        bmsEdge = `<path class="${flowEdgeClass("bms-dchg", g.bmsDchg)}" d="${bmsPath}" marker-end="url(#arrBmsDchg)"/>
          <text class="flow-label active" x="${bmsMid.x + 14}" y="${bmsMid.y + 3}" fill="#be123c">${g.bmsDchg}W↑放</text>`;
        wattsLabel = `放 ${g.bmsDchg}W`;
      }
      // 待机时不再画固定 BMS 曲线
      const capLabel =
        g.batCap == null ? "—" : `${Number(g.batCap).toFixed(3)}kWh`;
      return `<g>
      <foreignObject x="${g.x}" y="${unitY}" width="${unitW}" height="${unitH}" style="${wireMode ? "pointer-events:none" : ""}">${unitCardHtml(g)}</foreignObject>
      ${bmsEdge}
      ${flowBmsSvg(bx, bmsY, bmsW, bmsH, mode, wattsLabel, `SOC ${g.soc}%`, capLabel)}
    </g>`;
    })
    .join("");

  // 家庭平均 SOC = Σ(soc×容量) / Σ(容量)
  let capSum = 0;
  let socCapSum = 0;
  for (const g of geos) {
    if (g.batCap == null || !(g.batCap > 0)) continue;
    socCapSum += flowNum(g.soc) * g.batCap;
    capSum += g.batCap;
  }
  const homeAvgSoc = capSum > 0 ? socCapSum / capSum : null;
  const avgBarX = geos.length ? Math.min(...geos.map((g) => g.x)) : clusterX;
  const avgBarRight = geos.length
    ? Math.max(...geos.map((g) => g.x + unitW))
    : clusterX + unitsSpanW;
  const avgBarW = Math.max(200, avgBarRight - avgBarX);
  const avgSocTxt =
    homeAvgSoc == null ? "—" : `${homeAvgSoc.toFixed(3)}%`;
  const avgSocBarSvg = `<g class="home-avg-soc">
      <rect x="${avgBarX}" y="${avgBarY}" width="${avgBarW}" height="${avgBarH}" rx="6"
        fill="#f0fdf4" stroke="#86efac" stroke-width="1.5"/>
      <text x="${avgBarX + avgBarW / 2}" y="${avgBarY + avgBarH / 2 + 5}" text-anchor="middle"
        font-size="14" font-weight="700" fill="#166534">家庭平均 SOC  ${flowEsc(avgSocTxt)}</text>
      <title>Σ(SOC × 容量) / Σ(容量)${capSum > 0 ? ` · 总容量 ${capSum.toFixed(3)}kWh` : ""}</title>
    </g>`;

  const caption = `PV ${pvTotal}W · ${
    gridPow.source === "lan" ? "DP26" : "电表"
  } ${hasGridPow ? `${meterW}W` : "—"} · 家庭负载 ${famPower}W · 集群放电 ${gridDchgTot}W · 集群充电 ${gridChgTot}W · Bypass ${loadSum}W · 家庭平均SOC ${avgSocTxt}`;
  const wiredN = geos.reduce((n, g) => {
    const p = portOf(g);
    return n + (p.pv ? 1 : 0) + (p.grid ? 1 : 0) + (p.offgrid ? 1 : 0);
  }, 0);

  const autoOn = typeof autoRefreshEnabled !== "undefined" && autoRefreshEnabled;
  const pendingN =
    typeof countHomeDrafts === "function" ? countHomeDrafts(home) : 0;
  const svg = `<div class="flow-panel${wireMode ? " wiring-mode" : ""}">
    <div class="flow-hd">
      <span class="flow-hd-left">
        <span>家庭实况 · 能量流向</span>
        <button type="button" class="auto-refresh-switch${autoOn ? " on" : ""}"
          data-act="toggle-auto-refresh"
          role="switch"
          aria-checked="${autoOn ? "true" : "false"}"
          title="${autoOn ? "关闭后停止定时读取" : "开启后每 7 秒自动一键读取"}">
          <span class="auto-refresh-text">自动刷新${autoOn ? " · 7s" : ""}</span>
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
        </button>
        <button type="button" class="auto-refresh-switch${typeof highFreqEnabled !== "undefined" && highFreqEnabled ? " on" : ""}"
          data-act="toggle-high-freq"
          role="switch"
          aria-checked="${typeof highFreqEnabled !== "undefined" && highFreqEnabled ? "true" : "false"}"
          title="${typeof highFreqEnabled !== "undefined" && highFreqEnabled ? "关闭后停止每分钟自动下发" : "开启后立即下发，并每 1 分钟自动再下发一次"}">
          <span class="auto-refresh-text">高频上报${typeof highFreqEnabled !== "undefined" && highFreqEnabled ? " · 1m" : ""}</span>
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
        </button>
        <button type="button" class="btn btn-sm btn-ghost clear-drafts-btn"
          data-act="clear-drafts"
          ${pendingN ? "" : "disabled"}
          title="清除家庭侧与各一体机卡片上尚未下发的草稿参数">
          缓存清空${pendingN ? ` (${pendingN})` : ""}
        </button>
      </span>
      <span class="flow-hd-actions">
        <button type="button" class="btn btn-sm ${wireMode ? "btn-primary" : ""}" data-act="toggle-wiring"
          title="进入后拖拽端子到一体机端口">${wireMode ? "完成接线" : "拖拽接线"}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="manage-buses" title="增删改家庭端子">管理端子</button>
        <span class="badge">${flowEsc(home.name || home.homeId || "")}</span>
      </span>
    </div>
    ${
      wireMode
        ? `<div class="wire-hint">从端子蓝点拖到一体机端口接线（不能端子对端子）。<b>删除线</b>：点连线 / 双击端口。PV→PV · Grid→Grid · Bypass/家庭→离网</div>`
        : `<div class="flow-cap">${flowEsc(caption)} · 已接 ${wiredN} 口 · 端子可拖动</div>`
    }
    <div class="flow-svg-wrap">
      <svg class="flow-svg" width="${vbW}" height="${vbH}" viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrAmber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#f59e0b"/></marker>
          <marker id="arrBlue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#3b82f6"/></marker>
          <marker id="arrSky" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#38bdf8"/></marker>
          <marker id="arrPurple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#a855f7"/></marker>
          <marker id="arrGray" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#64748b"/></marker>
          <marker id="arrOrange" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#ea580c"/></marker>
          <marker id="arrBms" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#22c55e"/></marker>
          <marker id="arrBmsDchg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#fb7185"/></marker>
        </defs>
        ${busNodesSvg}
        ${
          clusterBoxes
            .map(
              (box) =>
                `<rect x="${box.x}" y="${clusterY}" width="${box.w}" height="${clusterH}" rx="12" fill="#fff" stroke="#334155"/>
        <text x="${box.x + 12}" y="${clusterY + 22}" font-size="12" font-weight="700">一体机集群 · id ${flowEsc(box.nodeId)} · ${box.n} 台</text>`
            )
            .join("\n")
        }
        ${
          ns > 0
            ? `<text x="${soloStartX}" y="${clusterY + 22}" font-size="12" font-weight="700" fill="#64748b">单机 · ${ns} 台</text>`
            : ""
        }
        ${edges}
        ${unitBodies}
        ${avgSocBarSvg}
        ${famEdge}
        ${portPadsSvg}
        <g id="wireRubberBand" pointer-events="none"></g>
      </svg>
    </div>
    <div class="flow-legend-row">
      <span><i style="background:#f59e0b"></i>PV→各机</span>
      <span><i style="background:#a855f7"></i>各机→电网(放)</span>
      <span><i style="background:#3b82f6"></i>电网→各机(充)</span>
      <span><i style="background:#22c55e"></i>一体机→BMS(充)</span>
      <span><i style="background:#fb7185"></i>BMS→一体机(放)</span>
      <span><i style="background:#64748b"></i>离网口负载</span>
    </div>
  </div>`;

  return `<div class="home-flow-shell">
    <aside class="flow-rail">${renderFamilyRail(home)}</aside>
    <div class="flow-main">${svg}</div>
  </div>`;
}
