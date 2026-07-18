// Chạy: npm run gen-secret
// In ra một chuỗi ngẫu nhiên mạnh để dán vào JWT_SECRET trong file .env
const crypto = require("crypto");
console.log(crypto.randomBytes(32).toString("hex"));
