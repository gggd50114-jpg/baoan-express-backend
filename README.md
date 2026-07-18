# Bảo An Express - Backend/Server riêng cho hệ thống tra cứu & tính cước

Đây là bản nâng cấp so với bản "artifact" trước đó: dữ liệu cước được lưu trên
**server thật của bạn** (không còn phụ thuộc claude.ai). Ai có link cũng thấy
đúng bảng giá mới nhất mà Admin đã lưu, gần như ngay lập tức (đẩy realtime qua
server, có làm mới dự phòng mỗi 30 giây phòng khi mất kết nối tạm thời).

**Không cần `npm install`** — toàn bộ server chỉ dùng thư viện lõi có sẵn của
Node.js (`http`, `fs`, `crypto`), nên chạy được ngay ở bất kỳ máy/host nào có
cài Node.js, không phụ thuộc gói ngoài nào có thể bị lỗi/độc hại.

## Cấu trúc thư mục

```
baoan-express-backend/
├── server.js          # Server chính (API + phục vụ giao diện web)
├── lib/
│   ├── env.js          # Đọc file .env
│   ├── auth.js         # Đăng nhập Admin + ký/kiểm tra token
│   └── store.js        # Đọc/ghi dữ liệu (file JSON, ghi an toàn)
├── data/
│   ├── seed_routes.json          # Dữ liệu cước ban đầu (55 tuyến, đã đồng bộ từ Excel)
│   ├── seed_weightBrackets.json  # Khung bậc cân cố định
│   └── db.json                   # (tự tạo khi chạy lần đầu) - dữ liệu đang dùng thật
├── public/
│   ├── index.html      # Giao diện web
│   └── app.js           # Logic gọi API + tính cước
├── scripts/gen-secret.js
├── package.json
└── .env.example
```

## 1. Chạy thử trên máy tính của bạn

Yêu cầu: đã cài [Node.js](https://nodejs.org) bản 18 trở lên.

```bash
cd baoan-express-backend
cp .env.example .env
```

Mở file `.env` vừa tạo, sửa 2 dòng:

```
ADMIN_PASSWORD=mật-khẩu-mạnh-của-bạn
JWT_SECRET=<dán chuỗi ngẫu nhiên vào đây>
```

Để tạo chuỗi `JWT_SECRET` ngẫu nhiên mạnh, chạy:

```bash
npm run gen-secret
```

rồi dán kết quả in ra vào `.env`. Sau đó khởi động server:

```bash
npm start
```

Mở trình duyệt vào `http://localhost:3000` — bạn sẽ thấy hệ thống tính cước.
Bấm "🔑 Đăng Nhập Admin", nhập mật khẩu đã đặt ở `ADMIN_PASSWORD` để sửa/lưu
bảng giá.

## 2. Đưa lên Internet để "ai có link cũng xem được"

Bạn cần **host** server này ở một nơi có địa chỉ công khai. Vài lựa chọn phổ
biến, từ dễ đến chủ động nhất:

### Cách A — Render.com (miễn phí, dễ nhất, khuyến nghị để bắt đầu)
1. Đưa toàn bộ thư mục này lên một GitHub repository (có thể để private).
2. Vào [render.com](https://render.com) → New → Web Service → chọn repo vừa tạo.
3. Build Command: để trống (không cần). Start Command: `node server.js`.
4. Vào tab Environment, thêm 2 biến: `ADMIN_PASSWORD`, `JWT_SECRET` (giá trị
   giống như bạn đặt trong `.env`, KHÔNG upload file `.env` lên GitHub).
5. Deploy xong, Render cho bạn 1 link dạng `https://ten-app.onrender.com` —
   gửi link này cho mọi người.
   
   Lưu ý gói miễn phí của Render sẽ "ngủ" server sau ~15 phút không có ai
   truy cập, lần mở tiếp theo mất khoảng 30-50 giây để server "thức dậy". Nếu
   cần server luôn sẵn sàng 24/7, nâng lên gói trả phí thấp nhất là đủ.

### Cách B — Railway.app (tương tự Render, cũng dễ)
Các bước gần giống Render: kết nối GitHub repo, thêm biến môi trường
`ADMIN_PASSWORD` và `JWT_SECRET`, Railway tự phát hiện `npm start`.

### Cách C — VPS riêng (chủ động nhất, ví dụ máy chủ ở Việt Nam)
1. Cài Node.js 18+ trên VPS (Ubuntu ví dụ: dùng NodeSource hoặc `nvm`).
2. Copy thư mục này lên VPS (`scp` hoặc `git clone`), tạo file `.env` như
   bước 1.
3. Cài `pm2` để server tự chạy nền và tự khởi động lại nếu crash:
   ```bash
   npm install -g pm2
   pm2 start server.js --name baoan-express
   pm2 save
   pm2 startup
   ```
4. Cài Nginx làm reverse proxy + chứng chỉ HTTPS miễn phí bằng Certbot, trỏ
   tên miền của bạn (VD: `cuoc.baoanexpress.vn`) về server Node đang chạy ở
   cổng 3000. Đây là bước giúp bạn có link đẹp, HTTPS an toàn, không lộ cổng.

## 3. Sao lưu / khôi phục dữ liệu

Toàn bộ dữ liệu cước hiện tại nằm trong `data/db.json`. Nên định kỳ tải file
này về máy làm bản sao lưu (đặc biệt trước khi deploy phiên bản mới). Muốn
khôi phục lại dữ liệu gốc ban đầu (55 tuyến đã đồng bộ từ Excel), chỉ cần xoá
`data/db.json` rồi khởi động lại server — hệ thống sẽ tự tạo lại từ
`seed_routes.json`.

## 4. Bảo mật cần lưu ý

- **Đổi `ADMIN_PASSWORD` mặc định** trong `.env.example` trước khi dùng thật.
- **Không commit file `.env` thật lên Git/GitHub công khai** — chỉ commit
  `.env.example`. Thêm `.env` vào `.gitignore`.
- Nên luôn chạy sau HTTPS (Render/Railway tự có HTTPS; VPS thì dùng Nginx +
  Certbot) để mật khẩu Admin không bị lộ khi truyền qua mạng.
- Hệ thống tự khoá đăng nhập 10 phút nếu nhập sai mật khẩu Admin quá 8 lần
  liên tiếp từ cùng một IP, để chống dò mật khẩu.
- Token Admin hết hạn sau 12 giờ, cần đăng nhập lại.

## 5. API tham khảo (nếu muốn tích hợp thêm, VD app di động riêng)

| Method | Endpoint       | Quyền  | Mô tả |
|--------|----------------|--------|-------|
| GET    | `/api/data`    | Công khai | Lấy toàn bộ bảng giá + khung cân + phí lấy hàng |
| GET    | `/api/stream`  | Công khai | Server-Sent Events, báo realtime khi có cập nhật |
| POST   | `/api/login`   | Công khai | Đăng nhập Admin, body `{ "password": "..." }`, trả về token |
| GET    | `/api/whoami`  | Cần token | Kiểm tra token còn hạn không |
| PUT    | `/api/data`    | Cần token Admin | Ghi đè toàn bộ `routes` + `pickupFee`, body `{ "routes": [...], "pickupFee": {...} }` |
