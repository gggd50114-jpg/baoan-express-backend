// ==========================================================================
// BẢO AN EXPRESS - FRONTEND LOGIC
// Toàn bộ dữ liệu lấy từ backend riêng (không còn phụ thuộc claude.ai / window.storage)
// ==========================================================================

let appData = [];
let weightBrackets = [];
let pickupFeeData = { note: "", tiers: [] };
let surchargeData = { percent: 5 };
let settingsData = { showTableToViewers: true };
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
    initVNGlobe();
    await loadFromServer();
    if (adminToken) {
        const ok = await checkTokenValid();
        isAdminMode = ok;
        if (!ok) { adminToken = null; localStorage.removeItem("baoan_admin_token"); }
    }
    applyAdminUI();
    applyTableVisibility();
    renderRegionChips();
    renderRouteTabs();
    initCalculatorOptions();
    renderMainTable();
    renderPickupFeeTable();
    updateHeaderStats();
    connectRealtime();
    revealCards();
};

// ---------------- HIỆU ỨNG XUẤT HIỆN LẦN LƯỢT CHO CÁC CARD ----------------
function revealCards() {
    const cards = document.querySelectorAll(".card");
    cards.forEach((card, idx) => {
        card.classList.add("card-enter");
        setTimeout(() => card.classList.add("card-enter-active"), 60 + idx * 110);
    });
}

// ---------------- HIỆU ỨNG GỢN SÓNG (RIPPLE) KHI BẤM NÚT ----------------
document.addEventListener("click", function (e) {
    const btn = e.target.closest(".btn, .tab-btn, .region-chip");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement("span");
    const size = Math.max(rect.width, rect.height);
    ripple.className = "ripple-effect";
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
    ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
    btn.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
});

async function loadFromServer() {
    try {
        const res = await fetch("/api/data");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const db = await res.json();
        appData = db.routes || [];
        weightBrackets = db.weightBrackets || [];
        pickupFeeData = db.pickupFee || { note: "", tiers: [] };
        surchargeData = db.surcharge || { percent: 5 };
        settingsData = db.settings || { showTableToViewers: true };
        applySurchargeToUI();
        applyBannerImage();
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

// ---------------- BANNER "MỪNG XUÂN" - ĐỔI ẢNH & ĐỒNG BỘ QUA IMGBB ----------------
function applyBannerImage() {
    const img = document.getElementById("heroBannerImg");
    if (img) {
        const url = settingsData.bannerImageUrl || "assets/tet-banner.jpg";
        if (img.getAttribute("src") !== url) img.src = url;
    }
    const bannerResetBtn = document.getElementById("bannerResetBtn");
    if (bannerResetBtn) bannerResetBtn.classList.toggle("show", isAdminMode && !!settingsData.bannerImageUrl);
}

function onBannerFileSelected(input) {
    const file = input.files && input.files[0];
    input.value = ""; // cho phép chọn lại cùng 1 file lần sau nếu cần
    if (!file) return;
    if (!isAdminMode || !adminToken) { alert("Bạn cần đăng nhập Admin."); return; }
    if (!file.type.startsWith("image/")) { alert("Vui lòng chọn 1 file ảnh (jpg, png, webp...)."); return; }
    if (file.size > 6.5 * 1024 * 1024) { alert("Ảnh quá lớn (tối đa khoảng 6MB). Vui lòng chọn ảnh nhỏ hơn hoặc nén lại."); return; }

    const overlay = document.getElementById("bannerUploadOverlay");
    if (overlay) overlay.classList.add("show");

    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const res = await fetch("/api/upload-banner", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken },
                body: JSON.stringify({ imageBase64: reader.result })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Tải ảnh lên thất bại.");
            settingsData.bannerImageUrl = data.url;
            applyBannerImage();
        } catch (e) {
            alert("❌ " + e.message);
        } finally {
            if (overlay) overlay.classList.remove("show");
        }
    };
    reader.onerror = () => {
        if (overlay) overlay.classList.remove("show");
        alert("Không đọc được file ảnh này. Vui lòng thử ảnh khác.");
    };
    reader.readAsDataURL(file);
}

async function resetBannerImage() {
    if (!isAdminMode || !adminToken) { alert("Bạn cần đăng nhập Admin."); return; }
    if (!confirm("Khôi phục về ảnh banner mặc định (bỏ ảnh đã tải lên)?")) return;
    try {
        const res = await fetch("/api/reset-banner", {
            method: "POST",
            headers: { Authorization: "Bearer " + adminToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Khôi phục ảnh thất bại.");
        settingsData.bannerImageUrl = null;
        applyBannerImage();
    } catch (e) {
        alert("❌ " + e.message);
    }
}

// ---------------- ẨN/HIỆN BẢNG GIÁ CHI TIẾT CHO NGƯỜI XEM ----------------
// Admin luôn thấy đầy đủ bảng giá + bảng phí lấy hàng để chỉnh sửa. Người
// xem thường (chưa đăng nhập Admin) chỉ thấy 2 bảng này nếu Admin bật công
// tắc "Cho người xem thấy bảng giá chi tiết"; nếu tắt, người xem chỉ thấy
// hộp tính cước nhanh (gọn hơn, tránh lộ toàn bộ bảng giá công khai).
function applyTableVisibility() {
    const toggle = document.getElementById("showTableToggle");
    if (toggle) toggle.checked = !!settingsData.showTableToViewers;

    const topLayout = document.getElementById("topLayout");
    const priceTableCard = document.getElementById("priceTableCard");
    const pickupSection = document.getElementById("pickupFeeSection");
    const calcNote = document.getElementById("calcHiddenTableNote");

    const shouldShowToThisUser = isAdminMode || settingsData.showTableToViewers;

    // Lưu ý: KHÔNG đổi bố cục của topLayout (quả địa cầu + hộp tính cước) dù bảng giá
    // chi tiết đang ẩn hay hiện - giao diện lấp đầy màn hình theo tỉ lệ 1/3-2/3 phải
    // giữ nguyên như nhau trong mọi trường hợp, chỉ ẩn/hiện phần bảng giá bên dưới.
    if (shouldShowToThisUser) {
        if (priceTableCard) priceTableCard.style.display = "block";
        if (pickupSection) pickupSection.style.display = "grid";
        if (calcNote) calcNote.style.display = "none";
    } else {
        if (priceTableCard) priceTableCard.style.display = "none";
        if (pickupSection) pickupSection.style.display = "none";
        if (calcNote) calcNote.style.display = "block";
    }
}

function toggleShowTableToViewers(checked) {
    if (!isAdminMode) return;
    settingsData.showTableToViewers = checked;
    markDirty();
    applyTableVisibility();
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
                || JSON.stringify(db.surcharge) !== JSON.stringify(surchargeData)
                || JSON.stringify(db.settings) !== JSON.stringify(settingsData);
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
        if (JSON.stringify(db.settings) !== JSON.stringify(settingsData)) {
            settingsData = db.settings || settingsData;
            applyTableVisibility();
            applyBannerImage();
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
        applyTableVisibility();
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
    applyTableVisibility();
    renderMainTable();
}

// ---------------- KHÔI PHỤC KHẨN CẤP MẬT KHẨU (QUÊN MẬT KHẨU) ----------------
function openForgotPasswordModal() {
    closeLoginModal();
    document.getElementById("forgotPasswordError").style.display = "none";
    document.getElementById("resetKeyInput").value = "";
    document.getElementById("resetNewPasswordInput").value = "";
    document.getElementById("resetConfirmPasswordInput").value = "";
    document.getElementById("forgotPasswordModal").style.display = "flex";
    setTimeout(() => document.getElementById("resetKeyInput").focus(), 50);
}
function closeForgotPasswordModal() {
    document.getElementById("forgotPasswordModal").style.display = "none";
}
function showForgotPasswordError(msg) {
    const el = document.getElementById("forgotPasswordError");
    el.textContent = msg;
    el.style.display = "block";
}
async function submitForgotPassword() {
    const resetKey = document.getElementById("resetKeyInput").value;
    const newPassword = document.getElementById("resetNewPasswordInput").value;
    const confirmPassword = document.getElementById("resetConfirmPasswordInput").value;

    if (!resetKey || !newPassword) {
        showForgotPasswordError("Vui lòng nhập đầy đủ khóa khôi phục và mật khẩu mới.");
        return;
    }
    if (newPassword.length < 6) {
        showForgotPasswordError("Mật khẩu mới phải có ít nhất 6 ký tự.");
        return;
    }
    if (newPassword !== confirmPassword) {
        showForgotPasswordError("Mật khẩu mới nhập lại không khớp.");
        return;
    }

    try {
        const res = await fetch("/api/emergency-reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resetKey, newPassword })
        });
        const data = await res.json();
        if (!res.ok) {
            showForgotPasswordError(data.error || "Khôi phục mật khẩu thất bại.");
            return;
        }
        closeForgotPasswordModal();
        alert("✅ Đã đặt lại mật khẩu Admin thành công. Hãy đăng nhập lại bằng mật khẩu mới.");
        openLoginModal();
    } catch (e) {
        showForgotPasswordError("Không kết nối được server.");
    }
}

function applyAdminUI() {
    document.getElementById("adminControls").style.display = isAdminMode ? "flex" : "none";
    document.getElementById("viewerControls").style.display = isAdminMode ? "none" : "flex";
    document.getElementById("pickupAdminControls").style.display = isAdminMode ? "flex" : "none";
    const delBtn = document.getElementById("deleteRouteBtn");
    if (delBtn) delBtn.style.display = isAdminMode ? "inline-flex" : "none";
    const surchargeInput = document.getElementById("surchargePercentInput");
    if (surchargeInput) surchargeInput.disabled = !isAdminMode;

    const bannerChangeBtn = document.getElementById("bannerChangeBtn");
    if (bannerChangeBtn) bannerChangeBtn.classList.toggle("show", isAdminMode);
    const bannerResetBtn = document.getElementById("bannerResetBtn");
    if (bannerResetBtn) bannerResetBtn.classList.toggle("show", isAdminMode && !!settingsData.bannerImageUrl);
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
        btn.innerHTML = `📍 ${escapeHtml(route.name)}`;
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
            div.innerHTML = `<span>📍 ${escapeHtml(item.route.name)}</span><span class="region-tag ${regionTagClass(item.route.region)}">${escapeHtml(item.route.region || "Khác")}</span>`;
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
    updateVNGlobe(appData[routeIdx]); // ghim luôn quả địa cầu theo tuyến vừa chọn ở hộp tính cước nhanh
    runCalculation();
}

// ---------------- QUẢ ĐỊA CẦU 3D THẬT (globe.gl / three.js) - GHIM ĐỊNH VỊ TUYẾN ĐANG CHỌN ----------------
// Toạ độ thật (lat/lng) của kho tổng và từng tỉnh/thành theo route id, để ghim đúng vị trí thật trên quả địa cầu.
const GLOBE_HQ = { lat: 21.0285, lng: 105.8542, name: "Hà Nội (Kho tổng)" };
const GLOBE_ROUTE_COORDS = {
    route_hni:            { lat: 21.0285, lng: 105.8542 },
    route_bckn:           { lat: 22.1477, lng: 105.8348 },
    route_caobng:         { lat: 22.6666, lng: 106.2639 },
    route_locai:          { lat: 22.4809, lng: 103.9755 },
    route_hgiang:         { lat: 22.8025, lng: 104.9784 },
    route_hiphng:         { lat: 20.8449, lng: 106.6881 },
    route_tuynquang:      { lat: 21.8233, lng: 105.2280 },
    route_lngsn:          { lat: 21.8530, lng: 106.7610 },
    route_hobnh:          { lat: 20.8156, lng: 105.3373 },
    route_ynbi:           { lat: 21.7168, lng: 104.8986 },
    route_thibnh:         { lat: 20.4463, lng: 106.3365 },
    route_hnam:           { lat: 20.5835, lng: 105.9230 },
    route_bcninh:         { lat: 21.1861, lng: 106.0763 },
    route_bcgiang:        { lat: 21.2731, lng: 106.1946 },
    route_thinguyn:       { lat: 21.5942, lng: 105.8480 },
    route_ninhbnh:        { lat: 20.2506, lng: 105.9744 },
    route_namnh:          { lat: 20.4388, lng: 106.1621 },
    route_hidng:          { lat: 20.9373, lng: 106.3145 },
    route_vnhphc:         { lat: 21.3608, lng: 105.5474 },
    route_phth:           { lat: 21.4208, lng: 105.2306 },
    route_hngyn:          { lat: 20.6464, lng: 106.0511 },
    route_qungninh:       { lat: 20.9527, lng: 107.0700 },
    route_hu:             { lat: 16.4637, lng: 107.5909 },
    route_nng:            { lat: 16.0544, lng: 108.2022 },
    route_qungnamhian:    { lat: 15.8801, lng: 108.3380 },
    route_qungngi:        { lat: 15.1214, lng: 108.8044 },
    route_bnhnh:          { lat: 13.7757, lng: 109.2237 },
    route_kontum:         { lat: 14.3497, lng: 108.0005 },
    route_phyn:           { lat: 13.0882, lng: 109.0929 },
    route_khnhho:         { lat: 12.2388, lng: 109.1967 },
    route_gialaipleiku:   { lat: 13.9833, lng: 108.0000 },
    route_klk:            { lat: 12.6667, lng: 108.0500 },
    route_knng:           { lat: 12.2646, lng: 107.6098 },
    route_ngnai:          { lat: 10.9574, lng: 106.8426 },
    route_vngtu:          { lat: 10.3460, lng: 107.0843 },
    route_bnhdng:         { lat: 10.9804, lng: 106.6519 },
    route_sign:           { lat: 10.7769, lng: 106.7009 },
    route_longan:         { lat: 10.5333, lng: 106.4167 },
    route_tingiang:       { lat: 10.3600, lng: 106.3600 },
    route_vnhlong:        { lat: 10.2397, lng: 105.9722 },
    route_lmng:           { lat: 11.9404, lng: 108.4583 },
    route_cnth:           { lat: 10.0452, lng: 105.7469 },
    route_bntre:          { lat: 10.2433, lng: 106.3756 },
    route_tyninh:         { lat: 11.3100, lng: 106.0983 },
    route_trvinh:         { lat: 9.9349,  lng: 106.3452 },
    route_angiang:        { lat: 10.5216, lng: 105.1259 },
    route_hugiang:        { lat: 9.7845,  lng: 105.4700 },
    route_sctrng:         { lat: 9.6025,  lng: 105.9739 },
    route_bcliu:          { lat: 9.2940,  lng: 105.7215 },
    route_kingiangphqu:   { lat: 10.2270, lng: 103.9670 },
    route_ngthp:          { lat: 10.4938, lng: 105.6882 },
    route_cmau:           { lat: 9.1768,  lng: 105.1524 },
    route_hphn_qn_lienlinh:{ lat: 11.5357, lng: 106.9078 }
};
const GLOBE_DEST_DEFAULT = { lat: 16.0, lng: 108.0 };

let vnGlobe = null;
let vnGlobeReady = false;
let vnGlobeResumeTimer = null;

function initVNGlobe() {
    const el = document.getElementById("globeContainer");
    const overlay = document.getElementById("globeLoadingOverlay");
    if (!el || typeof Globe === "undefined") return; // thư viện 3D chưa tải xong / lỗi mạng -> bỏ qua an toàn

    const rect = el.getBoundingClientRect();
    const size = Math.min(Math.max(rect.width || 260, 180), 380);
    el.style.height = size + "px"; // đảm bảo khung luôn là hình vuông đúng bằng canvas 3D, không bị cắt/lệch

    vnGlobe = Globe()(el)
        .width(size)
        .height(size)
        .backgroundColor("rgba(0,0,0,0)")
        .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
        .bumpImageUrl("https://unpkg.com/three-globe/example/img/earth-topology.png")
        .showAtmosphere(true)
        .atmosphereColor("#fbbf24")
        .atmosphereAltitude(0.2)
        .pointOfView({ lat: 16, lng: 106, altitude: 2.1 }, 0)
        .onGlobeReady(() => {
            vnGlobeReady = true;
            if (overlay) overlay.classList.add("hidden");
        });

    // Xoay nhẹ tự động khi không thao tác. Bật zoom bằng cuộn chuột / chụm 2 ngón (mobile),
    // giới hạn khoảng cách zoom để không zoom lọt vào trong lòng đất hoặc ra quá xa mất hình.
    const controls = vnGlobe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.enableZoom = true;
    controls.minDistance = 100.6; // cho phép zoom rất sát bề mặt - để "tan chảy" mượt sang bản đồ phẳng chi tiết
    controls.maxDistance = 520;   // zoom xa nhất - không bị trôi mất hình ra ngoài khung
    controls.zoomSpeed = 0.75;

    // Theo dõi liên tục độ cao camera (dù zoom bằng cuộn chuột, chụm tay hay kéo) để đồng bộ
    // hiệu ứng "tan chảy" sang bản đồ phẳng chi tiết - giống cách Google Maps/Google Earth
    // hiển thị thêm chi tiết (đường, tên địa danh) khi camera tiến gần mặt đất.
    controls.addEventListener("change", () => vnGlobeUpdateZoomVisual());
    setInterval(() => { if (vnGlobeReady) vnGlobeUpdateZoomVisual(); }, 220);

    // Khi người dùng kéo/zoom bằng tay thì tạm dừng tự xoay, xoay lại sau vài giây ngừng thao tác
    controls.addEventListener("start", () => {
        controls.autoRotate = false;
        if (vnGlobeResumeTimer) clearTimeout(vnGlobeResumeTimer);
    });
    controls.addEventListener("end", () => {
        if (vnGlobeResumeTimer) clearTimeout(vnGlobeResumeTimer);
        vnGlobeResumeTimer = setTimeout(() => { if (vnGlobe) vnGlobe.controls().autoRotate = true; }, 4500);
    });

    // Phòng khi ảnh tải quá lâu / mạng chậm: vẫn ẩn overlay sau tối đa 4s để không che khuất quả cầu mãi
    setTimeout(() => { if (overlay) overlay.classList.add("hidden"); }, 4000);

    window.addEventListener("resize", () => {
        if (!vnGlobe) return;
        const r = el.getBoundingClientRect();
        const s = Math.min(Math.max(r.width || 260, 180), 380);
        el.style.height = s + "px";
        vnGlobe.width(s).height(s);
        if (vnFlatMap) vnFlatMap.invalidateSize();
    });
}

// Zoom bằng nút bấm (+/-): giữ nguyên hướng nhìn hiện tại, chỉ thay đổi khoảng cách camera
// (khi đã "tan chảy" hẳn sang bản đồ phẳng thì +/- sẽ điều khiển zoom của bản đồ phẳng thay vì quả cầu)
function vnGlobeZoomBy(factor) {
    if (!vnGlobe) return;
    const cur = vnGlobe.pointOfView();
    const nextAltitude = Math.max(0.015, Math.min(4, cur.altitude * factor));
    vnGlobe.controls().autoRotate = false;
    if (vnGlobeResumeTimer) clearTimeout(vnGlobeResumeTimer);
    vnGlobe.pointOfView({ lat: cur.lat, lng: cur.lng, altitude: nextAltitude }, 300);
    vnGlobeResumeTimer = setTimeout(() => { if (vnGlobe) vnGlobe.controls().autoRotate = true; }, 4500);
    setTimeout(() => vnGlobeUpdateZoomVisual(), 60);
}
function vnGlobeZoomIn() {
    if (vnFlatMapInteractive && vnFlatMap) { vnFlatMap.zoomIn(); return; }
    vnGlobeZoomBy(0.7);
}
function vnGlobeZoomOut() {
    if (vnFlatMapInteractive && vnFlatMap) { vnFlatMap.zoomOut(); return; }
    vnGlobeZoomBy(1.4);
}

// ---------------- HIỆU ỨNG "TAN CHẢY" TỪ QUẢ ĐỊA CẦU 3D SANG BẢN ĐỒ PHẲNG CHI TIẾT ----------------
// Mô phỏng đúng cảm giác zoom của Google Maps/Google Earth: càng phóng to (camera càng
// tiến gần mặt đất), quả địa cầu càng mờ dần và một bản đồ phẳng THẬT (tile OpenStreetMap
// với tên đường, tên địa danh thật) hiện rõ dần lên, đến khi chiếm trọn khung và nhận thao
// tác chuột/chạm y như Google Maps. Zoom ra lại (hoặc bấm nút quay lại) sẽ trả về quả cầu 3D.
const GM_FADE_START_ALT = 0.55; // độ cao camera bắt đầu mờ dần sang bản đồ phẳng
const GM_FADE_FULL_ALT  = 0.14; // độ cao camera đã "sang hẳn" bản đồ phẳng, chiếm trọn khung
const GM_EXIT_LEAFLET_ZOOM = 3; // zoom bản đồ phẳng xuống dưới mức này -> tự động quay lại quả cầu

let vnFlatMap = null;
let vnFlatMapMarker = null;
let vnFlatMapInteractive = false;
let vnFlatMapCenter = { lat: GLOBE_DEST_DEFAULT.lat, lng: GLOBE_DEST_DEFAULT.lng };
let vnGlobeVisualPending = false;

function initFlatMapIfNeeded() {
    if (vnFlatMap || typeof L === "undefined") return;
    const el = document.getElementById("globeFlatMap");
    if (!el) return;
    vnFlatMap = L.map(el, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: true,
        fadeAnimation: true,
        worldCopyJump: true
    }).setView([vnFlatMapCenter.lat, vnFlatMapCenter.lng], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "© OpenStreetMap"
    }).addTo(vnFlatMap);

    vnFlatMapMarker = L.marker([vnFlatMapCenter.lat, vnFlatMapCenter.lng]).addTo(vnFlatMap);

    // Nếu người dùng zoom bản đồ phẳng ra quá xa (muốn quay lại góc nhìn toàn cầu) -> tự chuyển về quả cầu 3D
    vnFlatMap.on("zoomend", () => {
        if (vnFlatMapInteractive && vnFlatMap.getZoom() <= GM_EXIT_LEAFLET_ZOOM) {
            vnGlobeExitFlatMap();
        }
    });
}

// Đọc độ cao camera hiện tại của quả cầu và cập nhật độ mờ/hiển thị của lớp bản đồ phẳng tương ứng
function vnGlobeUpdateZoomVisual() {
    if (!vnGlobe || vnFlatMapInteractive) return; // đã ở hẳn chế độ bản đồ phẳng thì không cần tính lại theo camera quả cầu nữa
    if (vnGlobeVisualPending) return;
    vnGlobeVisualPending = true;
    requestAnimationFrame(() => {
        vnGlobeVisualPending = false;
        const cur = vnGlobe.pointOfView();
        const alt = cur.altitude;
        const globeEl = document.getElementById("globeContainer");
        const flatEl = document.getElementById("globeFlatMap");
        const hintEl = document.getElementById("globeZoomHint");
        if (!globeEl || !flatEl) return;

        const t = Math.max(0, Math.min(1, (GM_FADE_START_ALT - alt) / (GM_FADE_START_ALT - GM_FADE_FULL_ALT)));

        if (t > 0.02) {
            initFlatMapIfNeeded();
            flatEl.classList.add("active");
            flatEl.style.opacity = t.toFixed(3);
            globeEl.classList.add("gm-fading");
            globeEl.style.opacity = String(1 - t * 0.6);
            if (vnFlatMap) {
                const zoomLevel = 4 + t * 11; // 4 (khu vực) -> 15 (chi tiết đường phố, toà nhà)
                vnFlatMap.setView([vnFlatMapCenter.lat, vnFlatMapCenter.lng], zoomLevel, { animate: false });
                setTimeout(() => { if (vnFlatMap) vnFlatMap.invalidateSize(); }, 0);
            }
        } else {
            flatEl.classList.remove("active");
            flatEl.style.opacity = "0";
            globeEl.classList.remove("gm-fading");
            globeEl.style.opacity = "1";
        }

        if (hintEl) {
            hintEl.textContent = alt > 1.3 ? "🌐 Toàn cầu" : (alt > GM_FADE_START_ALT ? "🗺️ Khu vực" : (t < 1 ? "🔍 Đang phóng vào bản đồ chi tiết..." : "📍 Bản đồ chi tiết"));
            hintEl.classList.add("show");
            clearTimeout(vnGlobeUpdateZoomVisual._hintTimer);
            vnGlobeUpdateZoomVisual._hintTimer = setTimeout(() => hintEl.classList.remove("show"), 1800);
        }

        if (t >= 1 && !vnFlatMapInteractive) vnGlobeEnterFlatMap();
    });
}

// Đã zoom đủ sâu: chuyển hẳn quyền điều khiển chuột/chạm sang bản đồ phẳng chi tiết (như Google Maps)
function vnGlobeEnterFlatMap() {
    vnFlatMapInteractive = true;
    const globeEl = document.getElementById("globeContainer");
    const flatEl = document.getElementById("globeFlatMap");
    const exitBtn = document.getElementById("globeFlatMapExit");
    if (globeEl) { globeEl.style.pointerEvents = "none"; globeEl.style.opacity = "0.001"; }
    if (flatEl) { flatEl.classList.add("interactive"); flatEl.style.opacity = "1"; }
    if (exitBtn) exitBtn.classList.add("show");
    if (vnGlobe) vnGlobe.controls().autoRotate = false;
    initFlatMapIfNeeded();
    if (vnFlatMap) setTimeout(() => vnFlatMap.invalidateSize(), 60);
}

// Quay lại quả địa cầu 3D (bấm nút "Quay lại quả địa cầu" hoặc tự động khi zoom bản đồ phẳng ra xa)
function vnGlobeExitFlatMap() {
    vnFlatMapInteractive = false;
    const globeEl = document.getElementById("globeContainer");
    const flatEl = document.getElementById("globeFlatMap");
    const exitBtn = document.getElementById("globeFlatMapExit");
    if (globeEl) { globeEl.style.pointerEvents = "auto"; globeEl.style.opacity = "1"; globeEl.classList.remove("gm-fading"); }
    if (flatEl) { flatEl.classList.remove("interactive", "active"); flatEl.style.opacity = "0"; }
    if (exitBtn) exitBtn.classList.remove("show");
    if (vnGlobe) {
        vnGlobe.controls().autoRotate = false;
        vnGlobe.pointOfView({ lat: vnFlatMapCenter.lat, lng: vnFlatMapCenter.lng, altitude: 0.85 }, 700);
        if (vnGlobeResumeTimer) clearTimeout(vnGlobeResumeTimer);
        vnGlobeResumeTimer = setTimeout(() => { if (vnGlobe) vnGlobe.controls().autoRotate = true; }, 4500);
    }
}

function updateVNGlobe(route) {
    const destLabelEl = document.getElementById("globeDestLabel");
    if (!destLabelEl || !route) return;

    // Lấy tên điểm đến từ tên tuyến, bỏ chữ "Tuyến " ở đầu (VD: "Tuyến Sài Gòn" -> "Sài Gòn")
    const destName = (route.name || "").replace(/^\s*Tuyến\s+/i, "").trim() || route.name;
    destLabelEl.textContent = `📍 ${destName}`;
    destLabelEl.classList.remove("pop");
    void destLabelEl.offsetWidth;
    destLabelEl.classList.add("pop");

    if (!vnGlobe) return; // thư viện 3D chưa sẵn sàng (vd. mất mạng CDN) -> chỉ cập nhật chữ, không lỗi trang

    const dest = GLOBE_ROUTE_COORDS[route.id] || GLOBE_DEST_DEFAULT;

    // Đổi tuyến -> cập nhật điểm đến cho bản đồ phẳng, và nếu đang ở chế độ bản đồ phẳng chi tiết thì quay lại quả cầu 3D trước
    vnFlatMapCenter = { lat: dest.lat, lng: dest.lng };
    if (vnFlatMapInteractive) vnGlobeExitFlatMap();
    if (vnFlatMapMarker) vnFlatMapMarker.setLatLng([dest.lat, dest.lng]);
    if (vnFlatMap && !vnFlatMapInteractive) vnFlatMap.setView([dest.lat, dest.lng], vnFlatMap.getZoom(), { animate: false });

    vnGlobe
        .pointsData([
            { lat: GLOBE_HQ.lat, lng: GLOBE_HQ.lng, size: 0.55, color: "#fde68a", label: GLOBE_HQ.name },
            { lat: dest.lat, lng: dest.lng, size: 0.85, color: "#dc2626", label: "📍 " + destName }
        ])
        .pointAltitude(0.012)
        .pointColor("color")
        .pointRadius("size")
        .pointLabel("label")
        .pointResolution(24)

        // Nhãn tên điểm đến: dùng phần tử HTML thật (không phải chữ vẽ lên texture canvas)
        // để không bao giờ bị lỗi font/dấu tiếng Việt (vd. "Sài Gòn" hiển thị thành "S?i G?n").
        .htmlElementsData([{ lat: dest.lat, lng: dest.lng, text: destName }])
        .htmlElement((d) => {
            const wrapper = document.createElement("div");
            const label = document.createElement("div");
            label.className = "globe-3d-label";
            label.textContent = d.text;
            wrapper.appendChild(label);
            return wrapper;
        })
        .htmlAltitude(0.02)

        .arcsData([{ startLat: GLOBE_HQ.lat, startLng: GLOBE_HQ.lng, endLat: dest.lat, endLng: dest.lng }])
        .arcColor(() => ["#f59e0b", "#dc2626"])
        .arcDashLength(0.5)
        .arcDashGap(0.35)
        .arcDashAnimateTime(1600)
        .arcStroke(0.55)
        .arcAltitudeAutoScale(0.4)

        // Vòng sóng "ghim" lan toả tại điểm đến - mô phỏng hiệu ứng ghim định vị đang được chọn
        .ringsData([{ lat: dest.lat, lng: dest.lng }])
        .ringColor(() => (t) => `rgba(220,38,38,${1 - t})`)
        .ringMaxRadius(3.4)
        .ringPropagationSpeed(2.6)
        .ringRepeatPeriod(900);

    // Tạm dừng tự xoay, lượn camera bay tới đúng điểm đến vừa chọn (hiệu ứng "bay tới nơi")
    const controls = vnGlobe.controls();
    controls.autoRotate = false;
    vnGlobe.pointOfView({ lat: dest.lat, lng: dest.lng, altitude: 1.6 }, 1400);

    // Sau vài giây, cho quả địa cầu tự xoay nhẹ trở lại để vẫn "sống động"
    if (vnGlobeResumeTimer) clearTimeout(vnGlobeResumeTimer);
    vnGlobeResumeTimer = setTimeout(() => {
        if (vnGlobe) vnGlobe.controls().autoRotate = true;
    }, 4500);
}

// ---------------- BẢNG GIÁ ĐỘNG (CHỈNH SỬA ĐƯỢC KHI LÀ ADMIN) ----------------
function renderMainTable() {
    const route = appData[currentRouteIndex];
    if (!route) return;
    document.getElementById("routeDesc").textContent = route.desc;
    updateVNGlobe(route);

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
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
// Bí danh dùng khi chèn dữ liệu không tin cậy (route.name, zone.name...) vào giữa nội dung HTML
// (khác với việc chèn vào bên trong một thuộc tính value="...").
const escapeHtml = escapeAttr;

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
            body: JSON.stringify({ routes: appData, pickupFee: pickupFeeData, surcharge: surchargeData, settings: settingsData })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast("⚠️ " + (data.error || "Lưu thất bại."), "error");
            if (res.status === 401) { logoutAdmin(); }
            return;
        }
        setSyncBanner(`🌐 Đã lưu & đồng bộ. Cập nhật lần cuối: ${formatDateTime(data.updatedAt)}`, true);
        clearDirty();
        showToast("🎉 Đã lưu & ĐỒNG BỘ! Mọi người mở link sẽ thấy cước mới gần như ngay lập tức.", "success");
        launchConfetti();
        runCalculation();
    } catch (e) {
        showToast("⚠️ Không kết nối được server để lưu dữ liệu.", "error");
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
        settingsData = db.settings || { showTableToViewers: true };
        if (currentRouteIndex >= appData.length) currentRouteIndex = 0;
        clearDirty();
        applySurchargeToUI();
        applyTableVisibility();
        applyBannerImage();
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
        applyTableVisibility();
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
    animateFinalTotal(finalTotal);
}

// ---------------- HIỆU ỨNG SỐ ĐẾM CHẠY CHO TỔNG CƯỚC CUỐI CÙNG ----------------
let _finalTotalAnimId = null;
let _finalTotalPrevValue = 0;
function animateFinalTotal(target) {
    const el = document.getElementById("outFinal");
    if (!el) return;
    if (_finalTotalAnimId) cancelAnimationFrame(_finalTotalAnimId);
    const start = _finalTotalPrevValue;
    const startTime = performance.now();
    const duration = 450;
    function step(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out
        const value = start + (target - start) * eased;
        el.textContent = formatMoney(Math.round(value));
        if (t < 1) {
            _finalTotalAnimId = requestAnimationFrame(step);
        } else {
            el.textContent = formatMoney(target);
            _finalTotalPrevValue = target;
            el.classList.remove("final-val-pop");
            void el.offsetWidth; // reset animation
            el.classList.add("final-val-pop");
        }
    }
    _finalTotalAnimId = requestAnimationFrame(step);
}

// ---------------- TOAST THÔNG BÁO (thay cho alert() cứng nhắc) ----------------
function showToast(message, type = "success") {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.className = "toast-container";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("toast-show"));
    setTimeout(() => {
        toast.classList.remove("toast-show");
        setTimeout(() => toast.remove(), 300);
    }, 3600);
}

// ---------------- PHÁO HOA MINI KHI LƯU THÀNH CÔNG ----------------
function launchConfetti() {
    const colors = ["#f59e0b", "#dc2626", "#15803d", "#fde68a", "#fff"];
    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    for (let i = 0; i < 24; i++) {
        const piece = document.createElement("span");
        piece.className = "confetti-piece";
        piece.style.left = Math.random() * 100 + "%";
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = (Math.random() * 0.3) + "s";
        piece.style.animationDuration = (1.8 + Math.random() * 1.2) + "s";
        layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3200);
}
