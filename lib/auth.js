// Xác thực Admin: băm mật khẩu bằng scrypt + token tự ký bằng HMAC-SHA256
// Không dùng thư viện ngoài (bcrypt/jsonwebtoken) để server chạy được ngay
// chỉ với "node server.js", không cần "npm install".
const crypto = require("crypto");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // Token admin có hiệu lực 12 giờ

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

// So sánh mật khẩu người dùng nhập với mật khẩu admin cấu hình trong .env (an toàn với thời gian không đổi)
function checkPassword(inputPassword) {
    const real = process.env.ADMIN_PASSWORD || "";
    if (!real) return false;
    const a = Buffer.from(String(inputPassword));
    const b = Buffer.from(real);
    // Đệm cho bằng độ dài để timingSafeEqual không báo lỗi, đồng thời tránh lộ độ dài qua timing
    const maxLen = Math.max(a.length, b.length, 1);
    const aPad = Buffer.concat([a, Buffer.alloc(maxLen - a.length)]);
    const bPad = Buffer.concat([b, Buffer.alloc(maxLen - b.length)]);
    return a.length === b.length && crypto.timingSafeEqual(aPad, bPad);
}

module.exports = { signToken, verifyToken, checkPassword };
