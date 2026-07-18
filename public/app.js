// ==========================================================================
// BẢO AN EXPRESS - FRONTEND LOGIC
// Toàn bộ dữ liệu lấy từ backend riêng (không còn phụ thuộc claude.ai / window.storage)
// ==========================================================================

let appData = [];
let weightBrackets = [];
let pickupFeeData = { note: "", tiers: [] };
let surchargeData = { percent: 5 };
let currentRouteIndex = 0;
let currentRegionFilter = "Tất cả";
let adminToken = localStorage.getItem("baoan_admin_token") || null;
let isAdminMode = false;
let hasUnsavedChanges = false;

function markDirty() {
    hasUnsavedChanges = true;
    const pill = document.getElementById("unsavedPill");
    if (pill) pill.classList.add("show");
}
function clearDirty() {
    hasUnsavedChanges = false;
    const pill = document.getElementById("unsavedPill");
    if (pill) pill.classList.remove("show");
}
window.addEventListener("beforeunload", function (e) {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
    }
});

// ---------------- KHỞI CHẠY ----------------
window.onload = async function () {
    await loadFromServer();
    if (adminToken) {
        const ok = await checkTokenValid();
        isAdminMode = ok;
        if (!ok) { adminToken = null; localStorage.removeItem("baoan_admin_token"); }
    }
    applyAdminUI();
    renderRegionChips();
    renderRouteTabs();
    initCalculatorOptions();
    renderMainTable();
    renderPickupFeeTable();
    updateHeaderStats();
    connectRealtime();
};

async function loadFromServer() {
    try {
        const res = await fetch("/api/data");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const db = await res.json();
        appData = db.routes || [];
        weightBrackets = db.weightBrackets || [];
        pickupFeeData = db.pickupFee || { note: "", tiers: [] };
        surchargeData = db.surcharge || { percent: 5 };
        applySurchargeToUI();
        setSyncBanner(`🌐 Đã kết nối server. Cập nhật lần cuối: ${formatDateTime(db.updatedAt)}`, true);
        document.getElementById("syncStatusPill").textContent = "🟢 Server đang hoạt động";
    } catch (e) {
        console.error(e);
        setSyncBanner("⚠️ Không kết nối được server. Kiểm tra lại backend đang chạy chưa.", false);
        document.getElementById("syncStatusPill").textContent = "🔴 Mất kết nối server";
    }
}

function applySurchargeToUI() {
    const input = document.getElementById("surchargePercentInput");
    if (input) input.value = surchargeData.percent;
    const label = document.getElementById("outTaxLabel");
    if (label) label.textContent = `Phụ thu (${surchargeData.percent}%):`;
}

function formatDateTime(iso) {
    if (!iso) return "--";
    try {
        const d = new Date(iso);
        return d.toLocaleString("vi-VN");
    } catch (e) { return iso; }
}

function setSyncBanner(text, ok) {
    const el = document.getElementById("syncStatusBanner");
    if (!el) return;
    el.textContent = text;
    el.style.background = ok ? "#f0fdf4" : "#fef2f2";
    el.style.color = ok ? "#166534" : "#991b1b";
    el.style.border = ok ? "1px solid #bbf7d0" : "1px solid #fecaca";
}

// ---------------- REALTIME (Server-Sent Events + làm mới dự phòng) ----------------
function connectRealtime() {
    if (!("EventSource" in window)) {
        setInterval(refreshSilently, 15000); // trình duyệt cũ: quay lại dùng polling
        return;
    }
    try {
        const es = new EventSource("/api/stream");
        es.addEventListener("update", () => { refreshSilently(); });
        es.onerror = () => {
            // Kết nối SSE rớt (mất mạng, server restart...) - vẫn có polling dự phòng bên dưới
        };
    } catch (e) { /* ignore, polling dự phòng vẫn chạy */ }
    // Luôn duy trì một polling dự phòng nhẹ mỗi 30s để chắc chắn không bao giờ lệch dữ liệu quá lâu
    setInterval(refreshSilently, 30000);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refreshSilently();
    });
}

async function refreshSilently() {
    try {
        const res = await fetch("/api/data", { cache: "no-store" });
        if (!res.ok) return;
        const db = await res.json();

        if (isAdminMode && hasUnsavedChanges) {
            // Có thay đổi đang sửa dở chưa lưu: KHÔNG ghi đè dữ liệu (tránh mất
            // công sức đang chỉnh), chỉ báo cho admin biết có bản mới đang chờ.
            const remoteChanged = JSON.stringify(db.routes) !== JSON.stringify(appData)
                || JSON.stringify(db.pickupFee) !== JSON.stringify(pickupFeeData)
                || JSON.stringify(db.surcharge) !== JSON.stringify(surchargeData);
            if (remoteChanged) {
                setSyncBanner("🟠 Có bản cập nhật mới trên server, nhưng bạn đang có thay đổi CHƯA LƯU. Hãy bấm \"Lưu & Đồng Bộ\" trước để không bị mất, sau đó làm mới sẽ lấy đúng bản mới nhất.", false);
            }
            document.getElementById("syncStatusPill").textContent = "🟢 Server đang hoạt động";
            return;
        }

        const remoteStr = JSON.stringify(db.routes);
        if (remoteStr !== JSON.stringify(appData)) {
            appData = db.routes || [];
            if (currentRouteIndex >= appData.length) currentRouteIndex = 0;
            renderRegionChips();
            renderRouteTabs();
            initCalculatorOptions();
            renderMainTable();
            updateHeaderStats();
        }
        if (JSON.stringify(db.pickupFee) !== JSON.stringify(pickupFeeData)) {
            pickupFeeData = db.pickupFee || pickupFeeData;
            renderPickupFeeTable();
        }
        if (JSON.stringify(db.surcharge) !== JSON.stringify(surchargeData)) {
            surchargeData = db.surcharge || surchargeData;
            applySurchargeToUI();
            runCalculation();
        }
        weightBrackets = db.weightBrackets || weightBrackets;
        setSyncBanner(`🌐 Đã đồng bộ. Cập nhật lần cuối: ${formatDateTime(db.updatedAt)}`, true);
        document.getElementById("syncStatusPill").textContent = "🟢 Server đang hoạt động";
    } catch (e) {
        document.getElementById("syncStatusPill").textContent = "🔴 Mất kết nối server";
    }
}

async function manualRefresh() {
    if (isAdminMode && hasUnsavedChanges) {
        alert("⚠️ Bạn đang có thay đổi CHƯA LƯU. Vui lòng bấm \"Lưu & Đồng Bộ\" trước, nếu không làm mới sẽ không lấy được bản mới (để tránh mất thay đổi của bạn).");
        return;
    }
    await refreshSilently();
    alert("🔄 Đã lấy bảng giá mới nhất từ server!");
}

// ---------------- ĐĂNG NHẬP / ĐĂNG XUẤT ADMIN ----------------
function openLoginModal() {
    document.getElementById("loginError").style.display = "none";
    document.getElementById("loginPasswordInput").value = "";
    document.getElementById("loginModal").style.display = "flex";
    setTimeout(() => document.getElementById("loginPasswordInput").focus(), 50);
}
function closeLoginModal() { document.getElementById("loginModal").style.display = "none"; }

async function submitLogin() {
    const password = document.getElementById("loginPasswordInput").value;
    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok) {
            document.getElementById("loginError").textContent = data.error || "Sai mật khẩu.";
            document.getElementById("loginError").style.display = "block";
            return;
        }
        adminToken = data.token;
        localStorage.setItem("baoan_admin_token", adminToken);
        isAdminMode = true;
        closeLoginModal();
        applyAdminUI();
        renderMainTable();
        alert("✅ Đăng nhập Admin thành công. Mọi thay đổi bạn lưu sẽ đồng bộ ngay tới tất cả mọi người có link.");
    } catch (e) {
        document.getElementById("loginError").textContent = "Không kết nối được server.";
        document.getElementById("loginError").style.display = "block";
    }
}

async function checkTokenValid() {
    try {
        const res = await fetch("/api/whoami", { headers: { Authorization: "Bearer " + adminToken } });
        const data = await res.json();
        return !!data.isAdmin;
    } catch (e) { return false; }
}

function logoutAdmin() {
    if (hasUnsavedChanges && !confirm("Bạn đang có thay đổi CHƯA LƯU. Đăng xuất bây giờ sẽ mất các thay đổi đó. Vẫn muốn đăng xuất?")) {
        return;
    }
    adminToken = null;
    isAdminMode = false;
    clearDirty();
    localStorage.removeItem("baoan_admin_token");
    applyAdminUI();
    renderMainTable();
}

function applyAdminUI() {
    document.getElementById("adminControls").style.display = isAdminMode ? "flex" : "none";
    document.getElementById("viewerControls").style.display = isAdminMode ? "none" : "flex";
    document.getElementById("pickupAdminControls").style.display = isAdminMode ? "flex" : "none";
    const delBtn = document.getElementById("deleteRouteBtn");
    if (delBtn) delBtn.style.display = isAdminMode ? "inline-flex" : "none";
    const surchargeInput = document.getElementById("surchargePercentInput");
    if (surchargeInput) surchargeInput.disabled = !isAdminMode;
}

function updateSurchargePercent(val) {
    if (!isAdminMode) return;
    const percent = parseFloat(val);
    surchargeData.percent = isNaN(percent) || percent < 0 ? 0 : percent;
    document.getElementById("surchargePercentInput").value = surchargeData.percent;
    applySurchargeToUI();
    markDirty();
    runCalculation();
}

// ---------------- HEADER STATS ----------------
function updateHeaderStats() {
    const totalRoutes = appData.length;
    const totalZones = appData.reduce((sum, r) => sum + r.zones.length, 0);
    const elR = document.getElementById("statRoutes");
    const elZ = document.getElementById("statZones");
    if (elR) elR.textContent = `📍 ${totalRoutes} tuyến`;
    if (elZ) elZ.textContent = `🗺️ ${totalZones} khu vực`;
}

// ---------------- CHIP LỌC MIỀN ----------------
function regionTagClass(region) {
    if (region === "Miền Bắc") return "tag-bac";
    if (region === "Miền Trung") return "tag-trung";
    if (region === "Tây Nguyên") return "tag-taynguyen";
    return "tag-nam";
}

function renderRegionChips() {
    const container = document.getElementById("regionChips");
    if (!container) return;
    const regions = ["Tất cả", ...new Set(appData.map(r => r.region || "Khác"))];
    container.innerHTML = "";
    regions.forEach(region => {
        const chip = document.createElement("button");
        chip.className = `region-chip ${region === currentRegionFilter ? "active" : ""}`;
        chip.textContent = region;
        chip.onclick = () => { currentRegionFilter = region; renderRegionChips(); renderRouteTabs(); };
        container.appendChild(chip);
    });
}

// ---------------- TABS TUYẾN ----------------
function renderRouteTabs() {
    const container = document.getElementById("routeTabs");
    const searchInput = document.getElementById("routeSearchInput");
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : "";
    container.innerHTML = "";
    let visibleCount = 0;
    appData.forEach((route, idx) => {
        const matchesRegion = currentRegionFilter === "Tất cả" || (route.region || "Khác") === currentRegionFilter;
        const matchesKeyword = !keyword || route.name.toLowerCase().includes(keyword);
        if (!matchesRegion || !matchesKeyword) return;
        visibleCount++;
        const btn = document.createElement("button");
        const noAccept = route.zones.length > 0 && route.zones.every(z => z.base_rate <= 0);
        btn.className = `tab-btn ${idx === currentRouteIndex ? "active" : ""} ${noAccept ? "no-accept-flag" : ""}`;
        btn.innerHTML = `📍 ${route.name}`;
        btn.onclick = () => { currentRouteIndex = idx; renderRouteTabs(); renderMainTable(); initCalculatorOptions(); };
        container.appendChild(btn);
    });
    if (visibleCount === 0) container.innerHTML = `<div style="padding:10px; color:var(--text-muted); font-size:13px;">Không tìm thấy tuyến nào phù hợp.</div>`;
}

// ---------------- HỘP TÍNH CƯỚC NHANH ----------------
function initCalculatorOptions() {
    const routeSelect = document.getElementById("calcRoute");
    routeSelect.innerHTML = "";
    appData.forEach((route, idx) => {
        const opt = document.createElement("option");
        opt.value = idx; opt.textContent = route.name;
        routeSelect.appendChild(opt);
    });
    routeSelect.value = currentRouteIndex;
    const searchInput = document.getElementById("calcRouteSearch");
    if (searchInput && appData[currentRouteIndex]) searchInput.value = appData[currentRouteIndex].name;
    onCalcRouteChange();
}

function onCalcRouteSearchInput() {
    const keyword = document.getElementById("calcRouteSearch").value.trim().toLowerCase();
    const dropdown = document.getElementById("calcRouteDropdown");
    dropdown.innerHTML = "";
    const matches = appData.map((route, idx) => ({ route, idx })).filter(item => !keyword || item.route.name.toLowerCase().includes(keyword));
    if (matches.length === 0) {
        dropdown.innerHTML = `<div style="padding:12px; font-size:13px; color:var(--text-muted); text-align:center;">Không tìm thấy tuyến nào phù hợp 🙁</div>`;
    } else {
        matches.forEach(item => {
            const div = document.createElement("div");
            div.className = "autocomplete-item";
            div.innerHTML = `<span>📍 ${item.route.name}</span><span class="region-tag ${regionTagClass(item.route.region)}">${item.route.region || "Khác"}</span>`;
            div.onclick = () => selectCalcRoute(item.idx);
            dropdown.appendChild(div);
        });
    }
    dropdown.style.display = "block";
}

function selectCalcRoute(idx) {
    document.getElementById("calcRoute").value = idx;
    document.getElementById("calcRouteSearch").value = appData[idx].name;
    document.getElementById("calcRouteDropdown").style.display = "none";
    onCalcRouteChange();
}

document.addEventListener("click", function (e) {
    const dropdown = document.getElementById("calcRouteDropdown");
    const searchInput = document.getElementById("calcRouteSearch");
    if (dropdown && searchInput && !dropdown.contains(e.target) && e.target !== searchInput) dropdown.style.display = "none";
});

function onCalcRouteChange() {
    const routeIdx = document.getElementById("calcRoute").value;
    const zoneSelect = document.getElementById("calcZone");
    zoneSelect.innerHTML = "";
    if (!appData[routeIdx]) return;
    appData[routeIdx].zones.forEach((zone, idx) => {
        const opt = document.createElement("option");
        opt.value = idx; opt.textContent = zone.name;
        zoneSelect.appendChild(opt);
    });
    runCalculation();
}

// ---------------- BẢNG GIÁ ĐỘNG (CHỈNH SỬA ĐƯỢC KHI LÀ ADMIN) ----------------
function renderMainTable() {
    const route = appData[currentRouteIndex];
    if (!route) return;
    document.getElementById("routeDesc").textContent = route.desc;

    const table = document.getElementById("dynamicTable");
    table.innerHTML = "";

    const thead = document.createElement("thead");
    const row1 = document.createElement("tr");
    const thForm = document.createElement("th");
    thForm.textContent = "Hình Thức Giao / Vùng";
    thForm.rowSpan = 2;
    row1.appendChild(thForm);

    route.zones.forEach((zone, zIdx) => {
        const th = document.createElement("th");
        const delBtn = isAdminMode ? `<button class="delete-zone-btn" onclick="deleteZone(${zIdx})">Xóa</button>` : "";
        const dis = isAdminMode ? "" : "disabled";
        th.innerHTML = `<input type="text" value="${escapeAttr(zone.name)}" ${dis} style="background:transparent; color:white; border:none; text-align:center; font-weight:bold; font-size:13px;" onchange="updateZoneData(${zIdx}, 'name', this.value)"><br>${delBtn}`;
        row1.appendChild(th);
    });
    thead.appendChild(row1);

    const row2 = document.createElement("tr");
    route.zones.forEach((zone, zIdx) => {
        const th = document.createElement("th");
        th.className = "th-delivery";
        const dis = isAdminMode ? "" : "disabled";
        th.innerHTML = `
            <input type="text" value="${escapeAttr(zone.details)}" ${dis} placeholder="Chi tiết quận huyện" style="width:90%; font-size:11px; margin-bottom:4px;" onchange="updateZoneData(${zIdx}, 'details', this.value)">
            <input type="text" value="${escapeAttr(zone.time)}" ${dis} placeholder="TG giao hàng" style="width:90%; font-size:11px;" onchange="updateZoneData(${zIdx}, 'time', this.value)">
        `;
        row2.appendChild(th);
    });
    thead.appendChild(row2);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const baseRow = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.innerHTML = "<strong>10 kg đầu tiên (Cước cố định)</strong>";
    tdLabel.style.textAlign = "left";
    baseRow.appendChild(tdLabel);
    route.zones.forEach((zone, zIdx) => {
        const td = document.createElement("td");
        const dis = isAdminMode ? "" : "disabled";
        td.innerHTML = `<input type="number" value="${zone.base_rate}" ${dis} step="1000" style="width:100px;" onchange="updateZoneData(${zIdx}, 'base_rate', this.value)">`;
        baseRow.appendChild(td);
    });
    tbody.appendChild(baseRow);

    weightBrackets.forEach((bracket) => {
        const tr = document.createElement("tr");
        const tdLbl = document.createElement("td");
        tdLbl.textContent = bracket.label;
        tdLbl.style.textAlign = "left";
        tr.appendChild(tdLbl);
        route.zones.forEach((zone, zIdx) => {
            const td = document.createElement("td");
            const dis = isAdminMode ? "" : "disabled";
            const rateValue = zone.rates[bracket.index] || 0;
            td.innerHTML = `<input type="number" value="${rateValue}" ${dis} step="50" style="width:100px;" onchange="updateBracketRate(${zIdx}, ${bracket.index}, this.value)">`;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const delRouteBtn = document.getElementById("deleteRouteBtn");
    if (delRouteBtn) delRouteBtn.style.display = isAdminMode ? "inline-flex" : "none";
}

function escapeAttr(str) {
    return String(str ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function updateZoneData(zoneIdx, key, val) {
    if (!isAdminMode) return;
    if (key === "base_rate") val = parseFloat(val) || 0;
    appData[currentRouteIndex].zones[zoneIdx][key] = val;
    markDirty();
    initCalculatorOptions();
}

function updateBracketRate(zoneIdx, rateIdx, val) {
    if (!isAdminMode) return;
    appData[currentRouteIndex].zones[zoneIdx].rates[rateIdx] = parseFloat(val) || 0;
    markDirty();
}

function addNewZoneToCurrentRoute() {
    if (!isAdminMode) { alert("Bạn cần đăng nhập Admin."); return; }
    appData[currentRouteIndex].zones.push({
        name: "Vùng mới thêm", details: "Ghi chú khu vực quận/huyện áp dụng", time: "1 - 2 ngày",
        base_rate: 80000, rates: [2000, 2000, 1900, 1800, 1700, 1600]
    });
    markDirty();
    renderMainTable(); initCalculatorOptions(); renderRouteTabs(); updateHeaderStats();
}

function deleteZone(zIdx) {
    if (!isAdminMode) { alert("Bạn cần đăng nhập Admin."); return; }
    if (confirm("Bạn có chắc chắn muốn xóa cột vùng này không?")) {
        appData[currentRouteIndex].zones.splice(zIdx, 1);
        markDirty();
        renderMainTable(); initCalculatorOptions(); renderRouteTabs(); updateHeaderStats();
    }
}

function openRouteModal() {
    if (!isAdminMode) { alert("Bạn cần đăng nhập Admin."); return; }
    document.getElementById("routeModal").style.display = "flex";
}
function closeRouteModal() { document.getElementById("routeModal").style.display = "none"; }

function submitCreateRoute() {
    const name = document.getElementById("newRouteName").value.trim();
    const desc = document.getElementById("newRouteDesc").value.trim();
    const region = document.getElementById("newRouteRegion").value;
    if (!name) { alert("Vui lòng nhập tên tuyến gốc!"); return; }
    appData.push({
        id: "route_" + Date.now(), region, name, desc: desc || "Tuyến vận chuyển mới cấu hình.",
        zones: [{ name: "Khu vực trung tâm", details: "Các quận nội thành", time: "1 - 2 ngày", base_rate: 80000, rates: [2500, 2500, 2400, 2300, 2200, 2100] }]
    });
    currentRouteIndex = appData.length - 1;
    currentRegionFilter = "Tất cả";
    markDirty();
    closeRouteModal();
    renderRegionChips(); renderRouteTabs(); renderMainTable(); initCalculatorOptions(); updateHeaderStats();
    document.getElementById("newRouteName").value = "";
    document.getElementById("newRouteDesc").value = "";
}

function deleteCurrentRoute() {
    if (!isAdminMode) { alert("Bạn cần đăng nhập Admin."); return; }
    if (appData.length <= 1) { alert("Hệ thống phải có ít nhất một tuyến đường vận chuyển!"); return; }
    if (confirm(`Bạn có chắc chắn muốn XÓA HOÀN TOÀN tuyến [${appData[currentRouteIndex].name}] không?`)) {
        appData.splice(currentRouteIndex, 1);
        currentRouteIndex = 0;
        markDirty();
        renderRegionChips(); renderRouteTabs(); renderMainTable(); initCalculatorOptions(); updateHeaderStats();
    }
}

// ---------------- LƯU & ĐỒNG BỘ LÊN SERVER ----------------
async function saveDataToServer() {
    if (!isAdminMode || !adminToken) { alert("Bạn cần đăng nhập Admin để lưu thay đổi."); return; }
    try {
        const res = await fetch("/api/data", {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken },
            body: JSON.stringify({ routes: appData, pickupFee: pickupFeeData, surcharge: surchargeData })
        });
        const data = await res.json();
        if (!res.ok) {
            alert("⚠️ " + (data.error || "Lưu thất bại."));
            if (res.status === 401) { logoutAdmin(); }
            return;
        }
        setSyncBanner(`🌐 Đã lưu & đồng bộ. Cập nhật lần cuối: ${formatDateTime(data.updatedAt)}`, true);
        clearDirty();
        alert("🎉 Đã lưu & ĐỒNG BỘ lên server! Mọi người mở link này sẽ thấy cước mới gần như ngay lập tức.");
        runCalculation();
    } catch (e) {
        alert("⚠️ Không kết nối được server để lưu dữ liệu.");
    }
}

// ---------------- BẢNG PHÍ LẤY HÀNG TẬN NƠI ----------------
function renderPickupFeeTable() {
    const tbody = document.getElementById("pickupFeeTableBody");
    if (!tbody || !pickupFeeData) return;
    tbody.innerHTML = "";
    const noteEl = document.getElementById("pickupFeeNote");
    if (noteEl) noteEl.textContent = "* " + (pickupFeeData.note || "");
    (pickupFeeData.tiers || []).forEach((tier, idx) => {
        const tr = document.createElement("tr");
        const dis = isAdminMode ? "" : "disabled";
        tr.innerHTML = `
            <td style="text-align:left;"><input type="text" value="${escapeAttr(tier.label)}" ${dis} style="width:95%;" onchange="updatePickupFeeField(${idx}, 'label', this.value)"></td>
            <td><input type="number" value="${tier.standard}" ${dis} step="1000" style="width:100px;" onchange="updatePickupFeeField(${idx}, 'standard', this.value)"></td>
            <td><input type="number" value="${tier.remote}" ${dis} step="1000" style="width:100px;" onchange="updatePickupFeeField(${idx}, 'remote', this.value)"></td>
        `;
        tbody.appendChild(tr);
    });
    populatePickupTierSelect();
}

function updatePickupFeeField(idx, key, val) {
    if (!isAdminMode) return;
    if (key !== "label") val = parseFloat(val) || 0;
    pickupFeeData.tiers[idx][key] = val;
    markDirty();
    populatePickupTierSelect();
}

function populatePickupTierSelect() {
    const sel = document.getElementById("pickupTierSelect");
    if (!sel || !pickupFeeData) return;
    const prevValue = sel.value;
    sel.innerHTML = "";
    (pickupFeeData.tiers || []).forEach((tier, idx) => {
        const opt = document.createElement("option");
        opt.value = idx; opt.textContent = tier.label;
        sel.appendChild(opt);
    });
    if (prevValue !== "" && sel.options[prevValue]) sel.value = prevValue;
    runCalculation();
}

// ---------------- HOÀN TÁC / KHÔI PHỤC BẢNG GIÁ ----------------

// Bỏ các thay đổi CHƯA LƯU trong phiên hiện tại, lấy lại đúng bản đang có
// trên server (dùng khi vừa sửa nhầm và muốn quay lại nhanh, chưa cần đụng
// tới server).
async function discardUnsavedChanges() {
    if (!hasUnsavedChanges) { alert("Hiện không có thay đổi nào chưa lưu."); return; }
    if (!confirm("Bỏ toàn bộ thay đổi CHƯA LƯU trong phiên này và lấy lại đúng bảng giá đang có trên server?")) return;

    try {
        const res = await fetch("/api/data", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const db = await res.json();
        appData = db.routes || [];
        weightBrackets = db.weightBrackets || [];
        pickupFeeData = db.pickupFee || { note: "", tiers: [] };
        surchargeData = db.surcharge || { percent: 5 };
        if (currentRouteIndex >= appData.length) currentRouteIndex = 0;
        clearDirty();
        applySurchargeToUI();
        renderRegionChips(); renderRouteTabs(); initCalculatorOptions(); renderMainTable(); renderPickupFeeTable(); updateHeaderStats();
        setSyncBanner(`🌐 Đã hoàn tác, lấy lại bản đang lưu trên server. Cập nhật lần cuối: ${formatDateTime(db.updatedAt)}`, true);
        alert("↩️ Đã hoàn tác các thay đổi chưa lưu.");
    } catch (e) {
        alert("⚠️ Không lấy được dữ liệu từ server để hoàn tác.");
    }
}

// Khôi phục TOÀN BỘ hệ thống về đúng bảng giá gốc ban đầu (dữ liệu import
// lần đầu từ Excel) - kể cả những tuyến/vùng admin đã thêm hoặc xoá trước đó.
// Đây là thao tác trên server, ảnh hưởng tới TẤT CẢ mọi người đang xem, và
// không thể hoàn tác lại được.
async function resetToSeedData() {
    if (!isAdminMode || !adminToken) { alert("Bạn cần đăng nhập Admin."); return; }
    if (!confirm("⚠️ Thao tác này sẽ XOÁ MỌI chỉnh sửa đã lưu trước đó và đưa TOÀN BỘ bảng giá (kể cả tuyến/vùng đã thêm/xoá) về ĐÚNG bản gốc ban đầu, áp dụng ngay cho TẤT CẢ mọi người đang xem trang. KHÔNG THỂ hoàn tác lại. Bạn có chắc chắn muốn tiếp tục?")) return;
    if (!confirm("Xác nhận LẦN CUỐI: khôi phục về bảng giá gốc ban đầu?")) return;

    try {
        const res = await fetch("/api/reset-to-seed", {
            method: "POST",
            headers: { Authorization: "Bearer " + adminToken }
        });
        const data = await res.json();
        if (!res.ok) {
            alert("⚠️ " + (data.error || "Khôi phục thất bại."));
            if (res.status === 401) logoutAdmin();
            return;
        }
        clearDirty();
        await loadFromServer();
        renderRegionChips(); renderRouteTabs(); initCalculatorOptions(); renderMainTable(); renderPickupFeeTable(); updateHeaderStats();
        alert("⏮️ Đã khôi phục về bảng giá gốc ban đầu và đồng bộ tới mọi người!");
    } catch (e) {
        alert("⚠️ Không kết nối được server để khôi phục dữ liệu.");
    }
}

// ---------------- ĐIỀU CHỈNH GIÁ HÀNG LOẠT ----------------
function openBulkModal() {
    if (!isAdminMode) { alert("Bạn cần đăng nhập Admin."); return; }
    document.getElementById("bulkValue").value = "";
    updateBulkPreview();
    document.getElementById("bulkModal").style.display = "flex";
}
function closeBulkModal() { document.getElementById("bulkModal").style.display = "none"; }

function getBulkTargetRoutes() {
    const scope = document.querySelector('input[name="bulkScope"]:checked').value;
    return scope === "all" ? appData : [appData[currentRouteIndex]].filter(Boolean);
}

function updateBulkPreview() {
    const modeEl = document.querySelector('input[name="bulkMode"]:checked');
    const valueLabel = document.getElementById("bulkValueLabel");
    const box = document.getElementById("bulkPreviewBox");
    if (!modeEl || !box) return;

    valueLabel.textContent = modeEl.value === "percent"
        ? "Giá trị điều chỉnh % (VD: 5 nghĩa là tăng 5%, -5 là giảm 5%):"
        : "Số tiền cố định điều chỉnh (đ) (VD: 5000 là +5.000đ, -5000 là -5.000đ):";

    const routes = getBulkTargetRoutes();
    const zoneCount = routes.reduce((sum, r) => sum + r.zones.length, 0);
    const applyBase = document.getElementById("bulkApplyBase").checked;
    const applyRates = document.getElementById("bulkApplyRates").checked;
    const rawVal = parseFloat(document.getElementById("bulkValue").value);

    if (!applyBase && !applyRates) {
        box.textContent = "⚠️ Bạn cần chọn ít nhất một mục để áp dụng (Cước cơ bản hoặc Đơn giá/kg).";
        return;
    }
    if (isNaN(rawVal) || rawVal === 0) {
        box.textContent = `Sẽ áp dụng lên ${routes.length} tuyến / ${zoneCount} khu vực. Nhập giá trị điều chỉnh khác 0 để xem trước ví dụ.`;
        return;
    }

    // Ví dụ minh hoạ trên khu vực đầu tiên tìm thấy có dữ liệu
    const sampleRoute = routes.find(r => r.zones && r.zones.length);
    const sampleZone = sampleRoute ? sampleRoute.zones[0] : null;
    let exampleText = "";
    if (sampleZone) {
        const mode = modeEl.value;
        const newBase = applyBase ? computeAdjustedValue(sampleZone.base_rate, mode, rawVal) : sampleZone.base_rate;
        exampleText = ` Ví dụ: cước cơ bản của "${sampleRoute.name}" sẽ đổi từ ${sampleZone.base_rate.toLocaleString("vi-VN")}đ → ${newBase.toLocaleString("vi-VN")}đ.`;
    }

    box.textContent = `Sẽ áp dụng lên ${routes.length} tuyến / ${zoneCount} khu vực.${exampleText} (Chưa lưu — bạn vẫn cần bấm "Lưu & Đồng Bộ" sau khi áp dụng.)`;
}

function computeAdjustedValue(current, mode, value) {
    let next = mode === "percent" ? current * (1 + value / 100) : current + value;
    next = Math.max(0, Math.round(next));
    return next;
}

function applyBulkAdjustment() {
    const applyBase = document.getElementById("bulkApplyBase").checked;
    const applyRates = document.getElementById("bulkApplyRates").checked;
    const mode = document.querySelector('input[name="bulkMode"]:checked').value;
    const rawVal = parseFloat(document.getElementById("bulkValue").value);

    if (!applyBase && !applyRates) { alert("Vui lòng chọn ít nhất một mục để áp dụng."); return; }
    if (isNaN(rawVal) || rawVal === 0) { alert("Vui lòng nhập giá trị điều chỉnh khác 0."); return; }

    const routes = getBulkTargetRoutes();
    const zoneCount = routes.reduce((sum, r) => sum + r.zones.length, 0);
    const label = mode === "percent" ? `${rawVal > 0 ? "+" : ""}${rawVal}%` : `${rawVal > 0 ? "+" : ""}${rawVal.toLocaleString("vi-VN")}đ`;

    if (!confirm(`Áp dụng điều chỉnh ${label} lên ${routes.length} tuyến / ${zoneCount} khu vực?\n\nThao tác này CHƯA lưu lên server — bạn có thể xem lại bảng giá và bấm "Lưu & Đồng Bộ" sau, hoặc tải lại trang (chưa lưu) để huỷ bỏ.`)) {
        return;
    }

    routes.forEach((route) => {
        route.zones.forEach((zone) => {
            if (applyBase) zone.base_rate = computeAdjustedValue(zone.base_rate, mode, rawVal);
            if (applyRates) zone.rates = zone.rates.map((r) => computeAdjustedValue(r, mode, rawVal));
        });
    });

    markDirty();
    closeBulkModal();
    renderMainTable();
    initCalculatorOptions();
    alert(`✅ Đã điều chỉnh ${label} cho ${routes.length} tuyến / ${zoneCount} khu vực. Đừng quên bấm "💾 Lưu & Đồng Bộ Bảng Giá" để áp dụng thật lên hệ thống!`);
}

// ---------------- TÍNH CƯỚC ----------------
function formatMoney(num) {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num).replace("₫", "VND");
}

function runCalculation() {
    const routeIdx = document.getElementById("calcRoute").value;
    const zoneIdx = document.getElementById("calcZone").value;
    const actualWeight = parseFloat(document.getElementById("calcWeight").value) || 0;
    const length = parseFloat(document.getElementById("calcLength").value) || 0;
    const width = parseFloat(document.getElementById("calcWidth").value) || 0;
    const height = parseFloat(document.getElementById("calcHeight").value) || 0;

    let volumetricWeight = 0;
    if (length > 0 && width > 0 && height > 0) volumetricWeight = (length * width * height) / 5000;

    let weight = actualWeight;
    let usedVolumetric = false;
    if (volumetricWeight > actualWeight) { weight = volumetricWeight; usedVolumetric = true; }

    const outWeightUsedEl = document.getElementById("outWeightUsed");
    if (outWeightUsedEl) {
        if (volumetricWeight > 0) {
            outWeightUsedEl.innerHTML = `${weight.toFixed(1)} kg <span class="weight-used-badge">${usedVolumetric ? "📦 Cân quy đổi (" + volumetricWeight.toFixed(1) + " kg)" : "⚖️ Cân thực tế"}</span>`;
        } else {
            outWeightUsedEl.innerHTML = `${weight.toFixed(1)} kg <span class="weight-used-badge">⚖️ Cân thực tế</span>`;
        }
    }

    if (!appData[routeIdx] || !appData[routeIdx].zones[zoneIdx]) return;

    const zone = appData[routeIdx].zones[zoneIdx];
    const resultBox = document.querySelector(".calc-result");
    const noAcceptBox = document.getElementById("noAcceptWarning");

    if (!zone.base_rate || zone.base_rate <= 0) {
        if (resultBox) resultBox.style.display = "none";
        if (noAcceptBox) noAcceptBox.style.display = "block";
        return;
    } else {
        if (resultBox) resultBox.style.display = "block";
        if (noAcceptBox) noAcceptBox.style.display = "none";
    }

    document.getElementById("outTime").textContent = zone.time;
    document.getElementById("outBase").textContent = formatMoney(zone.base_rate);

    let overWeight = 0, unitPrice = 0, overFee = 0;
    if (weight > 10) {
        overWeight = weight - 10;
        if (weight <= 99) unitPrice = zone.rates[0];
        else if (weight <= 299) unitPrice = zone.rates[1];
        else if (weight <= 499) unitPrice = zone.rates[2];
        else if (weight <= 699) unitPrice = zone.rates[3];
        else if (weight <= 999) unitPrice = zone.rates[4];
        else unitPrice = zone.rates[5] ?? zone.rates[4];
        overFee = overWeight * unitPrice;
    }

    const rawTotal = zone.base_rate + overFee;
    const taxFee = rawTotal * ((surchargeData.percent || 0) / 100);

    let pickupFee = 0;
    const pickupCheckbox = document.getElementById("calcNeedPickup");
    if (pickupCheckbox && pickupCheckbox.checked && pickupFeeData && pickupFeeData.tiers) {
        const tierIdx = document.getElementById("pickupTierSelect").value;
        const zoneType = document.getElementById("pickupZoneType").value;
        const tier = pickupFeeData.tiers[tierIdx];
        if (tier) pickupFee = zoneType === "remote" ? tier.remote : tier.standard;
    }
    const pickupRow = document.getElementById("pickupFeeRow");
    if (pickupRow) {
        pickupRow.style.display = pickupCheckbox && pickupCheckbox.checked ? "flex" : "none";
        document.getElementById("outPickupFee").textContent = formatMoney(pickupFee);
    }

    const finalTotal = rawTotal + taxFee + pickupFee;

    document.getElementById("outOverWeight").textContent = overWeight.toFixed(1) + " kg";
    document.getElementById("outUnitPrice").textContent = formatMoney(unitPrice) + "/kg";
    document.getElementById("outOverFee").textContent = formatMoney(overFee);
    document.getElementById("outRawTotal").textContent = formatMoney(rawTotal);
    document.getElementById("outTax").textContent = formatMoney(taxFee);
    document.getElementById("outFinal").textContent = formatMoney(finalTotal);
}
