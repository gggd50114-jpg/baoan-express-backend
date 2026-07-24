// Kho dữ liệu dạng file JSON, ghi an toàn (atomic write) để không hỏng dữ liệu
// khi mất điện/crash giữa lúc ghi. Đủ dùng cho quy mô 1 công ty vận chuyển
// (vài chục lượt lưu/ngày). Nếu sau này cần scale lớn hơn, có thể thay bằng
// SQLite/Postgres mà không cần đổi API phía client.
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const SEED_ROUTES_PATH = path.join(__dirname, "..", "data", "seed_routes.json");
const SEED_WEIGHT_PATH = path.join(__dirname, "..", "data", "seed_weightBrackets.json");

function buildSeedData() {
    const routes = JSON.parse(fs.readFileSync(SEED_ROUTES_PATH, "utf8"));
    const weightBrackets = JSON.parse(fs.readFileSync(SEED_WEIGHT_PATH, "utf8"));
    const pickupFee = {
        note: "Nếu khách gửi cùng lúc nhiều đơn, tính phí lấy tận nơi theo từng đơn, không gộp chung và không chia đều cho từng đơn.",
        tiers: [
            { label: "Đến 499,000 đ", standard: 65000, remote: 85000 },
            { label: "Đến 999,000 đ", standard: 100000, remote: 120000 },
            { label: "Từ 1,000,000 - 1,999,000 đ", standard: 150000, remote: 170000 },
            { label: "Từ 2,000,000 - 4,999,000 đ", standard: 200000, remote: 220000 },
            { label: "Từ 5,000,000 đ trở lên", standard: 250000, remote: 270000 }
        ]
    };
    return {
        routes, weightBrackets, pickupFee, surcharge: { percent: 5 },
        settings: { showTableToViewers: true, bannerImageUrl: null },
        updatedAt: new Date().toISOString(), updatedBy: "seed"
    };
}

function ensureDb() {
    if (!fs.existsSync(DB_PATH)) {
        const seed = buildSeedData();
        fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2), "utf8");
    }
}

function readDb() {
    ensureDb();
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const data = JSON.parse(raw);
    // File db.json cũ (tạo trước khi có tính năng phụ thu %) sẽ không có
    // trường "surcharge" - gán mặc định 5% để giữ đúng hành vi tính cước cũ.
    if (!data.surcharge || typeof data.surcharge.percent !== "number") {
        data.surcharge = { percent: 5 };
    }
    // File db.json cũ (tạo trước khi có tính năng ẩn/hiện bảng giá cho người
    // xem) sẽ không có trường "settings" - mặc định HIỂN THỊ (giữ đúng hành
    // vi cũ, không tự động ẩn dữ liệu người dùng đã quen thấy).
    if (!data.settings || typeof data.settings.showTableToViewers !== "boolean") {
        data.settings = { showTableToViewers: true };
    }
    // File db.json cũ (tạo trước khi có tính năng đổi ảnh banner qua imgbb)
    // sẽ chưa có trường "bannerImageUrl" - mặc định null (dùng ảnh gốc trong assets/).
    if (!("bannerImageUrl" in data.settings)) {
        data.settings.bannerImageUrl = null;
    }
    return data;
}

// Ghi file an toàn: ghi ra file tạm rồi đổi tên (rename là thao tác nguyên tử trên hầu hết hệ điều hành)
function writeDb(data) {
    const tmpPath = DB_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, DB_PATH);
}

module.exports = { readDb, writeDb, ensureDb, buildSeedData };
