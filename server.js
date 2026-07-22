// ==========================================================================
// BẢO AN EXPRESS - BACKEND SERVER RIÊNG (không phụ thuộc claude.ai)
// Chạy bằng: node server.js   (không cần "npm install" - chỉ dùng thư viện lõi Node.js)
// ==========================================================================
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { loadEnv } = require("./lib/env");
loadEnv();

const { readDb, writeDb, ensureDb, buildSeedData } = require("./lib/store");
const { signToken, verifyToken, checkPassword, changePassword, emergencyResetPassword } = require("./lib/auth");
const { validateRoutes, validatePickupFee, validateSurcharge } = require("./lib/validate");

const PORT = parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");

ensureDb();

// ---- Giới hạn số lần đăng nhập sai (chống dò mật khẩu) ----
const loginAttempts = new Map(); // ip -> { count, firstAt }
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000; // 10 phút

function isRateLimited(ip) {
    const rec = loginAttempts.get(ip);
    if (!rec) return false;
    if (Date.now() - rec.firstAt > WINDOW_MS) {
        loginAttempts.delete(ip);
        return false;
    }
    return rec.count >= MAX_ATTEMPTS;
}
function recordFailedLogin(ip) {
    const rec = loginAttempts.get(ip);
    if (!rec || Date.now() - rec.firstAt > WINDOW_MS) {
        loginAttempts.set(ip, { count: 1, firstAt: Date.now() });
    } else {
        rec.count++;
    }
}
function clearLoginAttempts(ip) {
    loginAttempts.delete(ip);
}

// ---- Giới hạn số lần thử khóa khôi phục khẩn cấp (khóa dài hơn vì đây là "chìa khóa cuối") ----
const emergencyAttempts = new Map();
const EMERGENCY_MAX_ATTEMPTS = 5;
const EMERGENCY_WINDOW_MS = 30 * 60 * 1000; // 30 phút

function isEmergencyRateLimited(ip) {
    const rec = emergencyAttempts.get(ip);
    if (!rec) return false;
    if (Date.now() - rec.firstAt > EMERGENCY_WINDOW_MS) {
        emergencyAttempts.delete(ip);
        return false;
    }
    return rec.count >= EMERGENCY_MAX_ATTEMPTS;
}
function recordFailedEmergency(ip) {
    const rec = emergencyAttempts.get(ip);
    if (!rec || Date.now() - rec.firstAt > EMERGENCY_WINDOW_MS) {
        emergencyAttempts.set(ip, { count: 1, firstAt: Date.now() });
    } else {
        rec.count++;
    }
}
function clearEmergencyAttempts(ip) {
    emergencyAttempts.delete(ip);
}

// ---- SSE: danh sách client đang lắng nghe để đẩy realtime khi admin lưu ----
const sseClients = new Set();
function broadcastUpdate() {
    for (const res of sseClients) {
        try { res.write(`event: update\ndata: ${Date.now()}\n\n`); } catch (e) { /* ignore */ }
    }
}

function sendJson(res, statusCode, obj) {
    if (res.writableEnded || res.destroyed) return;
    try {
        const body = JSON.stringify(obj);
        res.writeHead(statusCode, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control": "no-store"
        });
        res.end(body);
    } catch (e) { /* client đã ngắt kết nối giữa chừng - bỏ qua */ }
}

function readBody(req, maxBytes = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let data = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error("Payload quá lớn"));
                req.destroy();
                return;
            }
            data.push(chunk);
        });
        req.on("end", () => {
            const raw = Buffer.concat(data).toString("utf8");
            if (!raw) return resolve({});
            try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("JSON không hợp lệ")); }
        });
        req.on("error", reject);
    });
}

function getClientIp(req) {
    const fwd = req.headers["x-forwarded-for"];
    if (fwd) return fwd.split(",")[0].trim();
    return req.socket.remoteAddress || "unknown";
}

function requireAdmin(req) {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return null;
    return verifyToken(token);
}

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

function serveStatic(req, res) {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
    // Chặn path traversal ra ngoài thư mục public.
    // Lưu ý: chỉ dùng startsWith(PUBLIC_DIR) là chưa đủ an toàn, vì nó cũng khớp với
    // một thư mục anh em có tên chung tiền tố (vd PUBLIC_DIR + "-evil"). Phải đảm bảo
    // filePath là chính PUBLIC_DIR hoặc nằm ngay dưới nó (có dấu phân cách theo sau).
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("Không tìm thấy trang.");
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(content);
    });
}

const server = http.createServer(async (req, res) => {
    const urlPath = req.url.split("?")[0];

    try {
        // ---------------- API: lấy toàn bộ dữ liệu cước (công khai, ai cũng xem được) ----------------
        if (urlPath === "/api/data" && req.method === "GET") {
            const db = readDb();
            return sendJson(res, 200, db);
        }

        // ---------------- API: theo dõi cập nhật realtime (Server-Sent Events) ----------------
        if (urlPath === "/api/stream" && req.method === "GET") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            });
            res.write(": connected\n\n");
            sseClients.add(res);
            const keepAlive = setInterval(() => {
                try { res.write(": ping\n\n"); } catch (e) { /* ignore */ }
            }, 25000);
            req.on("close", () => {
                clearInterval(keepAlive);
                sseClients.delete(res);
            });
            return;
        }

        // ---------------- API: đăng nhập admin ----------------
        if (urlPath === "/api/login" && req.method === "POST") {
            const ip = getClientIp(req);
            if (isRateLimited(ip)) {
                return sendJson(res, 429, { error: "Bạn nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút." });
            }
            const body = await readBody(req);
            if (!body.password || !checkPassword(body.password)) {
                recordFailedLogin(ip);
                return sendJson(res, 401, { error: "Sai mật khẩu Admin." });
            }
            clearLoginAttempts(ip);
            const token = signToken({ role: "admin" });
            return sendJson(res, 200, { token, expiresInHours: 12 });
        }

        // ---------------- API: khôi phục khẩn cấp mật khẩu Admin (quên mật khẩu, không cần mật khẩu cũ) ----------------
        if (urlPath === "/api/emergency-reset-password" && req.method === "POST") {
            const ip = getClientIp(req);
            if (isEmergencyRateLimited(ip)) {
                return sendJson(res, 429, { error: "Bạn nhập sai quá nhiều lần. Vui lòng thử lại sau 30 phút." });
            }
            const body = await readBody(req);
            const result = emergencyResetPassword(body.resetKey, body.newPassword);
            if (!result.ok) {
                recordFailedEmergency(ip);
                return sendJson(res, 400, { error: result.error });
            }
            clearEmergencyAttempts(ip);
            return sendJson(res, 200, { ok: true });
        }

        // ---------------- API: đổi mật khẩu Admin (đang đăng nhập, biết mật khẩu hiện tại) ----------------
        if (urlPath === "/api/change-password" && req.method === "POST") {
            const admin = requireAdmin(req);
            if (!admin) return sendJson(res, 401, { error: "Bạn cần đăng nhập Admin (token hết hạn hoặc không hợp lệ)." });

            const body = await readBody(req);
            const result = changePassword(body.currentPassword, body.newPassword);
            if (!result.ok) {
                return sendJson(res, 400, { error: result.error });
            }
            return sendJson(res, 200, { ok: true });
        }

        // ---------------- API: admin lưu toàn bộ bảng giá + phí lấy hàng ----------------
        if (urlPath === "/api/data" && req.method === "PUT") {
            const admin = requireAdmin(req);
            if (!admin) return sendJson(res, 401, { error: "Bạn cần đăng nhập Admin (token hết hạn hoặc không hợp lệ)." });

            const body = await readBody(req);
            const current = readDb();

            // ---- Validate kỹ toàn bộ dữ liệu trước khi ghi, tránh làm hỏng db.json ----
            const expectedRatesLength = Array.isArray(current.weightBrackets) ? current.weightBrackets.length : 0;

            const routesCheck = validateRoutes(body.routes, expectedRatesLength);
            if (!routesCheck.ok) {
                return sendJson(res, 400, { error: routesCheck.error });
            }

            const pickupFeeCheck = validatePickupFee(body.pickupFee);
            if (!pickupFeeCheck.ok) {
                return sendJson(res, 400, { error: pickupFeeCheck.error });
            }

            // Chặn phụ thu (%) âm hoặc vượt quá 100%
            const surchargeCheck = validateSurcharge(body.surcharge);
            if (!surchargeCheck.ok) {
                return sendJson(res, 400, { error: surchargeCheck.error });
            }

            const next = {
                routes: routesCheck.value,
                weightBrackets: current.weightBrackets, // khung cân cố định, không cho sửa qua API
                pickupFee: pickupFeeCheck.value !== undefined ? pickupFeeCheck.value : current.pickupFee,
                surcharge: surchargeCheck.value !== undefined ? surchargeCheck.value : current.surcharge,
                settings: body.settings && typeof body.settings.showTableToViewers === "boolean"
                    ? { showTableToViewers: body.settings.showTableToViewers }
                    : current.settings,
                updatedAt: new Date().toISOString(),
                updatedBy: "admin"
            };
            writeDb(next);
            broadcastUpdate();
            return sendJson(res, 200, { ok: true, updatedAt: next.updatedAt });
        }

        // ---------------- API: khôi phục toàn bộ bảng giá về đúng dữ liệu gốc ban đầu ----------------
        if (urlPath === "/api/reset-to-seed" && req.method === "POST") {
            const admin = requireAdmin(req);
            if (!admin) return sendJson(res, 401, { error: "Bạn cần đăng nhập Admin (token hết hạn hoặc không hợp lệ)." });

            const seed = buildSeedData();
            writeDb(seed);
            broadcastUpdate();
            return sendJson(res, 200, { ok: true, updatedAt: seed.updatedAt });
        }

        // ---------------- API: kiểm tra token còn hạn không (để giữ trạng thái đăng nhập khi F5) ----------------
        if (urlPath === "/api/whoami" && req.method === "GET") {
            const admin = requireAdmin(req);
            return sendJson(res, 200, { isAdmin: !!admin });
        }

        // ---------------- Còn lại: phục vụ file tĩnh (giao diện web) ----------------
        if (req.method === "GET") {
            return serveStatic(req, res);
        }

        sendJson(res, 404, { error: "Không tìm thấy endpoint." });
    } catch (err) {
        if (err && (err.code === "ECONNRESET" || err.message === "aborted")) return;
        console.error(err);
        if (err.message === "JSON không hợp lệ" || err.message === "Payload quá lớn") {
            return sendJson(res, 400, { error: err.message });
        }
        sendJson(res, 500, { error: "Lỗi máy chủ: " + err.message });
    }
});

process.on("uncaughtException", (err) => {
    if (err && (err.code === "ECONNRESET" || err.message === "aborted")) return;
    console.error("⚠️  uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
    if (err && (err.code === "ECONNRESET" || err.message === "aborted")) return;
    console.error("⚠️  unhandledRejection:", err);
});

server.listen(PORT, () => {
    console.log(`🚚 Bảo An Express backend đang chạy tại http://localhost:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) {
        console.warn("⚠️  CẢNH BÁO: Chưa đặt ADMIN_PASSWORD trong file .env — đăng nhập Admin sẽ luôn thất bại.");
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
        console.warn("⚠️  CẢNH BÁO: Chưa đặt JWT_SECRET đủ mạnh (>=16 ký tự) trong file .env.");
    }
});
