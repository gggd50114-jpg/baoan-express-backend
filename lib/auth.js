// Xác thực Admin: băm mật khẩu bằng scrypt + token tự ký bằng HMAC-SHA256
// Không dùng thư viện ngoài (bcrypt/jsonwebtoken) để server chạy được ngay
// chỉ với "node server.js", không cần "npm install".
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // Token admin có hiệu lực 12 giờ

// ---- Lớp "ghi đè" mật khẩu, lưu trong data/admin_override.json (đã băm) ----
// Mật khẩu gốc (ADMIN_PASSWORD trong .env) vẫn luôn hoạt động như trước - đây chỉ là
// một lớp "phủ lên trên": nếu người dùng đã đổi mật khẩu qua web (hoặc khôi phục khẩn cấp),
// hệ thống sẽ ưu tiên dùng mật khẩu mới đó thay vì ADMIN_PASSWORD gốc.
const ADMIN_OVERRIDE_PATH = path.join(__dirname, "..", "data", "admin_override.json");

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

// So sánh 2 chuỗi an toàn với thời gian không đổi (không lộ độ dài/nội dung qua timing)
function timingSafeEqualStr(a, b) {
    const aBuf = Buffer.from(String(a));
    const bBuf = Buffer.from(String(b));
    const maxLen = Math.max(aBuf.length, bBuf.length, 1);
    const aPad = Buffer.concat([aBuf, Buffer.alloc(maxLen - aBuf.length)]);
    const bPad = Buffer.concat([bBuf, Buffer.alloc(maxLen - bBuf.length)]);
    return aBuf.length === bBuf.length && crypto.timingSafeEqual(aPad, bPad);
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

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

function readOverride() {
    if (!fs.existsSync(ADMIN_OVERRIDE_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(ADMIN_OVERRIDE_PATH, "utf8"));
    } catch (e) {
        return null;
    }
}

function writeOverride(data) {
    fs.mkdirSync(path.dirname(ADMIN_OVERRIDE_PATH), { recursive: true });
    const tmpPath = ADMIN_OVERRIDE_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, ADMIN_OVERRIDE_PATH);
}

// So sánh mật khẩu người dùng nhập với mật khẩu admin hiện tại.
// Ưu tiên mật khẩu đã đổi qua web (nếu có) - nếu chưa từng đổi, dùng ADMIN_PASSWORD trong .env.
function checkPassword(inputPassword) {
    const override = readOverride();
    if (override && override.passwordHash) {
        return verifyAgainstHash(inputPassword, override.passwordHash);
    }
    const real = process.env.ADMIN_PASSWORD || "";
    if (!real) return false;
    return timingSafeEqualStr(inputPassword, real);
}

// Đổi mật khẩu Admin (khi đã đăng nhập, biết mật khẩu hiện tại)
function changePassword(currentPassword, newPassword) {
    if (!checkPassword(currentPassword)) {
        return { ok: false, error: "Mật khẩu hiện tại không đúng." };
    }
    const next = String(newPassword || "");
    if (next.length < 6) {
        return { ok: false, error: "Mật khẩu mới phải có ít nhất 6 ký tự." };
    }
    if (checkPassword(next)) {
        return { ok: false, error: "Mật khẩu mới phải khác mật khẩu hiện tại." };
    }
    writeOverride({ passwordHash: hashPassword(next), updatedAt: new Date().toISOString() });
    return { ok: true };
}

// Khôi phục khẩn cấp: không cần biết mật khẩu hiện tại, chỉ cần đúng EMERGENCY_RESET_KEY
// (đặt trong biến môi trường, khác với ADMIN_PASSWORD - dùng khi quên mật khẩu Admin).
function emergencyResetPassword(resetKey, newPassword) {
    const realKey = process.env.EMERGENCY_RESET_KEY || "";
    if (!realKey) {
        return { ok: false, error: "Chưa cấu hình EMERGENCY_RESET_KEY trên server - không thể khôi phục khẩn cấp." };
    }
    if (!resetKey || !timingSafeEqualStr(resetKey, realKey)) {
        return { ok: false, error: "Khóa khôi phục khẩn cấp không đúng." };
    }
    const next = String(newPassword || "");
    if (next.length < 6) {
        return { ok: false, error: "Mật khẩu mới phải có ít nhất 6 ký tự." };
    }
    writeOverride({ passwordHash: hashPassword(next), updatedAt: new Date().toISOString(), resetVia: "emergency" });
    return { ok: true };
}

module.exports = { signToken, verifyToken, checkPassword, changePassword, emergencyResetPassword };
