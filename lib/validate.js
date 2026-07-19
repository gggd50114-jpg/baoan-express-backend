// Kiểm tra (validate) dữ liệu bảng giá do Admin gửi lên trước khi ghi vào db.json.
// Mục tiêu: KHÔNG BAO GIỜ để dữ liệu sai/thiếu/âm/lệch cấu trúc lọt vào file lưu trữ,
// vì chỉ cần 1 route hỏng là toàn bộ trang tra cứu cước (public) sẽ tính sai hoặc lỗi.
//
// Mọi hàm ở đây trả về { ok: true, value } hoặc { ok: false, error } — không throw,
// để server.js chỉ cần kiểm tra "ok" và trả lỗi rõ ràng cho Admin.

const MAX_STRING_LEN = 500;      // chặn chuỗi quá dài (phòng gửi rác/payload khổng lồ)
const MAX_ROUTES = 200;          // giới hạn hợp lý số tuyến
const MAX_ZONES_PER_ROUTE = 200; // giới hạn hợp lý số khu vực/tuyến
const MAX_MONEY = 100_000_000;   // 100 triệu đ - trần hợp lý cho 1 đơn giá/phí (chặn số nhập nhầm kiểu gõ thừa số 0)
const MAX_SURCHARGE_PERCENT = 100; // phụ thu tối đa 100%

function isNonEmptyString(v, maxLen = MAX_STRING_LEN) {
    return typeof v === "string" && v.trim().length > 0 && v.length <= maxLen;
}

function isPlainString(v, maxLen = MAX_STRING_LEN) {
    // Cho phép chuỗi rỗng (vd desc, note có thể để trống) nhưng phải là string thực sự
    return typeof v === "string" && v.length <= maxLen;
}

// Số tiền/đơn giá hợp lệ: số hữu hạn, không âm, không NaN, không vượt trần
function isValidMoney(v) {
    return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MONEY;
}

function validateZone(zone, zoneIdx, routeLabel, expectedRatesLength) {
    const where = `${routeLabel} / khu vực #${zoneIdx + 1}`;

    if (!zone || typeof zone !== "object" || Array.isArray(zone)) {
        return { ok: false, error: `${where}: dữ liệu khu vực không hợp lệ.` };
    }
    if (!isNonEmptyString(zone.name)) {
        return { ok: false, error: `${where}: thiếu hoặc sai tên khu vực (name).` };
    }
    if (!isPlainString(zone.details)) {
        return { ok: false, error: `${where}: trường "details" phải là chuỗi ký tự.` };
    }
    if (!isPlainString(zone.time)) {
        return { ok: false, error: `${where}: trường "time" phải là chuỗi ký tự.` };
    }
    if (!isValidMoney(zone.base_rate)) {
        return { ok: false, error: `${where}: "base_rate" phải là số >= 0 và hợp lý (tối đa ${MAX_MONEY.toLocaleString("vi-VN")}đ).` };
    }
    if (!Array.isArray(zone.rates) || zone.rates.length !== expectedRatesLength) {
        return {
            ok: false,
            error: `${where}: "rates" phải là mảng đúng ${expectedRatesLength} phần tử (khớp số khung cân hiện tại).`
        };
    }
    for (let i = 0; i < zone.rates.length; i++) {
        if (!isValidMoney(zone.rates[i])) {
            return { ok: false, error: `${where}: đơn giá khung cân #${i + 1} trong "rates" không hợp lệ (phải là số >= 0).` };
        }
    }
    return { ok: true };
}

function validateRoute(route, routeIdx, expectedRatesLength, seenIds) {
    const label = `Tuyến #${routeIdx + 1}`;

    if (!route || typeof route !== "object" || Array.isArray(route)) {
        return { ok: false, error: `${label}: dữ liệu tuyến không hợp lệ.` };
    }
    if (!isNonEmptyString(route.id, 100)) {
        return { ok: false, error: `${label}: thiếu hoặc sai "id" (bắt buộc, không rỗng).` };
    }
    if (seenIds.has(route.id)) {
        return { ok: false, error: `${label}: "id" bị trùng ("${route.id}"). Mỗi tuyến phải có id duy nhất.` };
    }
    seenIds.add(route.id);

    if (!isNonEmptyString(route.name, 200)) {
        return { ok: false, error: `${label} (id: ${route.id}): thiếu hoặc sai "name".` };
    }
    if (route.region !== undefined && !isPlainString(route.region, 100)) {
        return { ok: false, error: `${label} (id: ${route.id}): trường "region" phải là chuỗi ký tự.` };
    }
    if (route.desc !== undefined && !isPlainString(route.desc, 1000)) {
        return { ok: false, error: `${label} (id: ${route.id}): trường "desc" phải là chuỗi ký tự.` };
    }
    if (!Array.isArray(route.zones) || route.zones.length === 0) {
        return { ok: false, error: `${label} (id: ${route.id}): phải có ít nhất 1 khu vực trong "zones".` };
    }
    if (route.zones.length > MAX_ZONES_PER_ROUTE) {
        return { ok: false, error: `${label} (id: ${route.id}): số khu vực vượt giới hạn cho phép (${MAX_ZONES_PER_ROUTE}).` };
    }

    const routeLabel = `${label} (id: ${route.id})`;
    for (let i = 0; i < route.zones.length; i++) {
        const res = validateZone(route.zones[i], i, routeLabel, expectedRatesLength);
        if (!res.ok) return res;
    }
    return { ok: true };
}

// Kiểm tra toàn bộ "routes" gửi lên. expectedRatesLength lấy từ weightBrackets hiện có trong DB
// (weightBrackets là cố định, không cho sửa qua API - xem server.js).
function validateRoutes(routes, expectedRatesLength) {
    if (!Array.isArray(routes)) {
        return { ok: false, error: `Dữ liệu "routes" không hợp lệ (phải là mảng).` };
    }
    if (routes.length === 0) {
        return { ok: false, error: `Danh sách tuyến ("routes") không được để trống.` };
    }
    if (routes.length > MAX_ROUTES) {
        return { ok: false, error: `Số lượng tuyến vượt giới hạn cho phép (${MAX_ROUTES}).` };
    }

    const seenIds = new Set();
    for (let i = 0; i < routes.length; i++) {
        const res = validateRoute(routes[i], i, expectedRatesLength, seenIds);
        if (!res.ok) return res;
    }
    return { ok: true, value: routes };
}

// pickupFee là tuỳ chọn khi lưu (nếu không hợp lệ, server.js sẽ tự giữ nguyên giá trị cũ)
// nhưng NẾU Admin có gửi lên thì phải đúng cấu trúc, không được âm thầm ghi đè bằng rác.
function validatePickupFee(pickupFee) {
    if (pickupFee === undefined || pickupFee === null) {
        return { ok: true, value: undefined }; // không gửi -> giữ nguyên giá trị cũ, không lỗi
    }
    if (typeof pickupFee !== "object" || Array.isArray(pickupFee)) {
        return { ok: false, error: `"pickupFee" phải là một object.` };
    }
    if (pickupFee.note !== undefined && !isPlainString(pickupFee.note, 1000)) {
        return { ok: false, error: `"pickupFee.note" phải là chuỗi ký tự.` };
    }
    if (!Array.isArray(pickupFee.tiers) || pickupFee.tiers.length === 0) {
        return { ok: false, error: `"pickupFee.tiers" phải là mảng và không được để trống.` };
    }
    for (let i = 0; i < pickupFee.tiers.length; i++) {
        const tier = pickupFee.tiers[i];
        const where = `pickupFee.tiers[${i + 1}]`;
        if (!tier || typeof tier !== "object" || Array.isArray(tier)) {
            return { ok: false, error: `${where}: dữ liệu không hợp lệ.` };
        }
        if (!isNonEmptyString(tier.label, 200)) {
            return { ok: false, error: `${where}: thiếu hoặc sai "label".` };
        }
        if (!isValidMoney(tier.standard)) {
            return { ok: false, error: `${where}: "standard" phải là số >= 0 và hợp lý.` };
        }
        if (!isValidMoney(tier.remote)) {
            return { ok: false, error: `${where}: "remote" phải là số >= 0 và hợp lý.` };
        }
    }
    return { ok: true, value: pickupFee };
}

// surcharge cũng tuỳ chọn - nếu gửi lên thì percent phải là số hợp lệ trong khoảng cho phép
function validateSurcharge(surcharge) {
    if (surcharge === undefined || surcharge === null) {
        return { ok: true, value: undefined };
    }
    if (typeof surcharge !== "object" || Array.isArray(surcharge)) {
        return { ok: false, error: `"surcharge" phải là một object.` };
    }
    const percent = surcharge.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > MAX_SURCHARGE_PERCENT) {
        return { ok: false, error: `"surcharge.percent" phải là số từ 0 đến ${MAX_SURCHARGE_PERCENT}.` };
    }
    return { ok: true, value: { percent } };
}

module.exports = {
    validateRoutes,
    validatePickupFee,
    validateSurcharge,
    MAX_ROUTES,
    MAX_ZONES_PER_ROUTE,
    MAX_MONEY,
    MAX_SURCHARGE_PERCENT
};
