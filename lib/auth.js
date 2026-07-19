// Xác thực Admin: băm mật khẩu bằng scrypt + token tự ký bằng HMAC-SHA256
// Không dùng thư viện ngoài (bcrypt/jsonwebtoken) để server chạy được ngay
// chỉ với "node server.js", không cần "npm install".
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // Token admin có hiệu lực 12 giờ
const ADMIN_STORE_PATH = path.join(__dirname, "..", "data", "admin.json");

function base64url(buf) {
    return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64url(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return Buffer.from(str, "base64");
}

function getSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
        throw new Error("JWT_SECRET chưa được cấu hình đủ mạnh trong file .env (tối thiểu 16 ký tự).");
    }
    return secret;
}

// Tạo token cho phiên đăng nhập admin
function signToken(payload) {
    const secret = getSecret();
    const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
    const payloadB64 = base64url(JSON.stringify(body));
    const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest();
    return `${payloadB64}.${base64url(sig)}`;
}

// Kiểm tra token còn hợp lệ không, trả về payload nếu hợp lệ, null nếu không
function verifyToken(token) {
    try {
        const secret = getSecret();
        const [payloadB64, sigB64] = String(token).split(".");
        if (!payloadB64 || !sigB64) return null;
        const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest();
        const actualSig = fromBase64url(sigB64);
        if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
            return null;
        }
        const payload = JSON.parse(fromBase64url(payloadB64).toString("utf8"));
        if (!payload.exp || Date.now() > payload.exp) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

// ---- Lưu trữ mật khẩu Admin dưới dạng BĂM (scrypt) trong data/admin.json ----
// Không còn lưu mật khẩu dạng chữ thường lâu dài, để có thể đổi mật khẩu ngay
// trên web mà không cần sửa file .env / khởi động lại server.

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

// So sánh mật khẩu với chuỗi đã băm (an toàn với thời gian không đổi)
function verifyAgainstHash(password, stored) {
    try {
        const [salt, hashHex] = String(stored).split(":");
        if (!salt || !hashHex) return false;
        const actual = crypto.scryptSync(String(password), salt, 64);
        const expected = Buffer.from(hashHex, "hex");
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (e) {
        return false;
    }
}

function readAdminStore() {
    if (!fs.existsSync(ADMIN_STORE_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(ADMIN_STORE_PATH, "utf8"));
    } catch (e) {
        return null;
    }
}

function writeAdminStore(data) {
    fs.mkdirSync(path.dirname(ADMIN_STORE_PATH), { recursive: true });
    const tmpPath = ADMIN_STORE_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, ADMIN_STORE_PATH);
}

// Đảm bảo luôn có mật khẩu Admin đã băm sẵn sàng để so sánh.
// Lần chạy đầu tiên (chưa có data/admin.json): lấy mật khẩu chữ thường từ
// ADMIN_PASSWORD trong .env, băm lại rồi lưu vào data/admin.json.
// Từ lần sau, data/admin.json là nguồn dữ liệu chính; ADMIN_PASSWORD trong
// .env chỉ còn tác dụng "khởi tạo lần đầu", không cần sửa nó khi đổi mật khẩu nữa.
function ensureAdminStore() {
    let store = readAdminStore();
    if (store && store.passwordHash) return store;
    const legacyPassword = process.env.ADMIN_PASSWORD || "";
    if (!legacyPassword) return null; // chưa cấu hình mật khẩu nào cả
    store = { passwordHash: hashPassword(legacyPassword), updatedAt: new Date().toISOString() };
    writeAdminStore(store);
    return store;
}

// So sánh mật khẩu người dùng nhập với mật khẩu admin hiện tại
function checkPassword(inputPassword) {
    const store = ensureAdminStore();
    if (!store) return false;
    return verifyAgainstHash(inputPassword, store.passwordHash);
}

// Đổi mật khẩu Admin: cần đúng mật khẩu hiện tại, mật khẩu mới tối thiểu 6 ký tự
function changePassword(currentPassword, newPassword) {
    const store = ensureAdminStore();
    if (!store) {
        return { ok: false, error: "Chưa cấu hình mật khẩu Admin ban đầu (ADMIN_PASSWORD trong .env)." };
    }
    if (!verifyAgainstHash(currentPassword, store.passwordHash)) {
        return { ok: false, error: "Mật khẩu hiện tại không đúng." };
    }
    const next = String(newPassword || "");
    if (next.length < 6) {
        return { ok: false, error: "Mật khẩu mới phải có ít nhất 6 ký tự." };
    }
    if (next === String(currentPassword || "")) {
        return { ok: false, error: "Mật khẩu mới phải khác mật khẩu hiện tại." };
    }
    writeAdminStore({ passwordHash: hashPassword(next), updatedAt: new Date().toISOString() });
    return { ok: true };
}

// So sánh 2 chuỗi bí mật một cách an toàn với thời gian không đổi (chống dò qua timing attack)
function timingSafeStringEqual(a, b) {
    const aBuf = Buffer.from(String(a || ""));
    const bBuf = Buffer.from(String(b || ""));
    const maxLen = Math.max(aBuf.length, bBuf.length, 1);
    const aPad = Buffer.concat([aBuf, Buffer.alloc(maxLen - aBuf.length)]);
    const bPad = Buffer.concat([bBuf, Buffer.alloc(maxLen - bBuf.length)]);
    return aBuf.length === bBuf.length && crypto.timingSafeEqual(aPad, bPad);
}

// Khôi phục khẩn cấp: đặt lại mật khẩu Admin mà KHÔNG cần biết mật khẩu cũ,
// chỉ cần đúng "Khóa Khôi Phục Khẩn Cấp" (EMERGENCY_RESET_KEY) - một bí mật
// riêng, chỉ người quản trị Railway/.env mới biết, khác hoàn toàn với mật khẩu Admin.
// Dùng khi quên mật khẩu Admin mà không muốn phải vào Railway xóa file thủ công.
function emergencyResetPassword(resetKey, newPassword) {
    const configuredKey = process.env.EMERGENCY_RESET_KEY || "";
    if (!configuredKey || configuredKey.length < 16) {
        return { ok: false, error: "Chưa cấu hình EMERGENCY_RESET_KEY (tối thiểu 16 ký tự) trong biến môi trường, nên không thể khôi phục khẩn cấp." };
    }
    if (!timingSafeStringEqual(resetKey, configuredKey)) {
        return { ok: false, error: "Khóa khôi phục khẩn cấp không đúng." };
    }
    const next = String(newPassword || "");
    if (next.length < 6) {
        return { ok: false, error: "Mật khẩu mới phải có ít nhất 6 ký tự." };
    }
    writeAdminStore({ passwordHash: hashPassword(next), updatedAt: new Date().toISOString(), updatedVia: "emergency-reset" });
    return { ok: true };
}

module.exports = { signToken, verifyToken, checkPassword, changePassword, emergencyResetPassword, ensureAdminStore };
