# RFID Gateway mẫu

Gateway Node.js nhỏ để nối một đầu đọc RFID có SDK/adapter riêng với endpoint của ứng dụng. Gateway chỉ lắng nghe trên `127.0.0.1`, không đưa reader token vào trình duyệt và không ghi token vào log.

## Cấu hình

1. Tạo reader trong `/admin-demo` → **Chuyên cần RFID** và sao chép token hiện một lần.
2. Sao chép `config.example.json` thành `config.json`.
3. Điền URL production `/api/rfid/scan` và reader token. `config.json` đã được `.gitignore`.
4. Cài Node.js 20 trở lên, rồi chạy `npm start` trong thư mục này.
5. Mở cổng local `http://127.0.0.1:8787/scan` cho adapter của thiết bị. Adapter gửi JSON `{ "tid": "..." }`, `{ "epc": "..." }` hoặc cả hai.

Đầu đọc có giao thức riêng cần một adapter để chuyển TID/EPC thành JSON này. Không mở cổng gateway ra Internet; chỉ cho tiến trình/adapter cục bộ gọi loopback.

## Kiểm tra giả lập

Trong terminal thứ nhất:

```powershell
npm start
```

Trong terminal thứ hai:

```powershell
npm run mock -- DEMO-TID-001
```

Thẻ chưa gắn sẽ trả `unknown_card`. Không dùng giá trị mẫu để điểm danh thật.

Máy chủ xác thực reader token, giới hạn 120 lần/phút/reader, ghi mọi lượt quét kể cả thẻ lạ, từ chối lượt trùng và tạo bản ghi điểm danh chỉ khi lớp đã bật tính năng và thời gian thuộc ca đã cấu hình. Ca chiều không hoạt động cho tới khi admin nhập đủ ba mốc giờ.
