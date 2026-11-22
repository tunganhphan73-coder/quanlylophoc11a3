# Hướng dẫn chạy bản Tuần 4, điện thoại/máy tính và quét AI

## 1. Bản này có gì?

- Mẫu lịch hiển thị **Tuần 1 đến Tuần 4**, trong đó **Tuần 4 là tuần hiện tại**. Các tuần được tính theo thứ Hai của tuần đang xem; Tuần 4 không tự chốt. Giáo viên bấm **Chốt sổ tuần** thì tuần mới khóa.
- Nút **Điện thoại / Máy tính** ở đầu dashboard đổi giữa khung xem hẹp và khung rộng. Chế độ được lưu trên trình duyệt; dù chọn Máy tính, trang vẫn tự thu gọn trên màn hình điện thoại.
- Công cụ quét hỗ trợ **Groq**, **Gemini** hoặc **Tự động**. Chế độ tự động thử Groq trước rồi chuyển sang Gemini khi gặp lỗi tạm thời hoặc chạm giới hạn. Gemini tự thử các model Flash 3.8, 3.7, 3.6 và 3.5 nếu model đang chọn bận hoặc không khả dụng.
- Ảnh chụp lớn được thu nhỏ trên trình duyệt trước khi gửi. Kết quả OCR vẫn hiện ở bảng kiểm tra để giáo viên sửa tên/số liệu rồi mới lưu vào Supabase.
- Mỗi giáo viên được giới hạn **10 lượt quét trong một phút** để hạn chế yêu cầu AI dồn dập.

Tuần là dữ liệu mẫu về lịch. Điểm học sinh và danh sách lớp vẫn được đọc từ Supabase của dự án bạn cấu hình.

## 2. Chuẩn bị cấu hình

1. Đổi tên `.env.example` thành `.env.local` (hoặc sao chép nội dung vào file `.env.local`).
2. Điền địa chỉ Supabase và khóa công khai anon trong `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Nếu cần tạo tài khoản dùng chung cho phụ huynh/học sinh, điền `SUPABASE_SERVICE_ROLE_KEY`. Khóa này chỉ được dùng trên server; không đăng vào chat, GitHub hay mã trình duyệt.
4. Điền ít nhất một khóa AI:
   - Groq: tạo khóa tại [console.groq.com/keys](https://console.groq.com/keys), thêm `GROQ_API_KEY`; model quét mặc định là `qwen/qwen3.8-27b`.
   - Gemini: `GEMINI_API_KEY`. `GEMINI_MODEL` nhận danh sách model cách nhau bằng dấu phẩy; mặc định thử `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-flash`, rồi `gemini-3-flash-preview`. Hệ thống chuyển model khi gặp lỗi tạm thời hoặc model không hỗ trợ. Hạn mức miễn phí tùy dự án và có thể thay đổi.
5. `OCR_DEFAULT_PROVIDER=groq` đặt Groq làm nhà cung cấp ưu tiên trong chế độ **Tự động**; đổi thành `gemini` nếu muốn đảo thứ tự. Groq Free có hạn mức sử dụng; khi chạm giới hạn, hệ thống thử Gemini nếu đã cấu hình khóa Gemini.

`.env.example` chỉ liệt kê tên biến và để trống giá trị. Hãy sao chép thành `.env.local` rồi tự điền giá trị riêng; không đưa `.env.local` lên Git hoặc gửi khóa vào chat.

Khóa API chỉ nằm trong `.env.local` hoặc Environment Variables của máy chủ. Không thêm tiền tố `NEXT_PUBLIC_` vào khóa AI.

### Lối đăng nhập quản trị ẩn

`ADMIN_LOGIN_CODE` là biến server-only để mở form đăng nhập quản trị nằm bên trong lựa chọn **Giáo viên**. Biến này không được đặt tiền tố `NEXT_PUBLIC_`. Mã chỉ mở form; người dùng vẫn phải đăng nhập Supabase bằng tài khoản có role `admin`. Đường `/admin-demo` được kiểm tra role ở middleware và ở Server Component. Dùng chuỗi ngẫu nhiên dài, không dùng mã dễ đoán.

### Thêm khóa Groq vào Vercel

1. Mở [Groq Console](https://console.groq.com/keys), đăng nhập/tạo tài khoản và tạo API key. Đừng gửi key vào chat hoặc đưa vào mã nguồn.
2. Mở dự án Vercel → **Settings → Environment Variables**.
3. Thêm tên `GROQ_API_KEY`, dán key vào ô Value, chọn **Production**, rồi lưu.
4. Vào **Deployments**, mở menu ở deployment mới nhất và chọn **Redeploy** để ứng dụng nhận biến mới.
5. Đăng nhập website → dashboard giáo viên → công cụ quét ảnh; chọn **Groq** để ép dùng Groq hoặc **Tự động (Groq ↔ Gemini)** để có dự phòng.

Để chạy local, mở `.env.local`, dán key sau `GROQ_API_KEY=` rồi khởi động lại `npm run dev`. Không dùng `NEXT_PUBLIC_GROQ_API_KEY`; ứng dụng chỉ gọi Groq từ server.

## 3. Chạy thử trên máy

Mở PowerShell tại thư mục dự án rồi chạy:

```powershell
npm install
npm run dev
```

Mở `http://localhost:3000`, đăng nhập tài khoản giáo viên và vào dashboard. Chọn nhà cung cấp AI phía trên công cụ quét. Chọn **Tự động** để hệ thống tự chuyển sang khóa AI còn lại khi dịch vụ ưu tiên không dùng được.

Nếu cần tạo cơ sở dữ liệu mới, chạy `supabase/schema.sql` trong SQL Editor của Supabase một lần. Nếu các bảng đã có rồi thì không chạy lại toàn bộ schema.

Với dự án Supabase đang dùng, trước khi đưa bản mới lên website, chạy `supabase/hardening-and-performance.sql` một lần. File này thêm index cho truy vấn tuần/bình luận, giới hạn kích thước bình luận, chặn người dùng tự sửa vai trò/lớp trong hồ sơ, giới hạn lượt quét AI và chỉ cho phép các emoji mà giao diện hỗ trợ.

Chạy thêm `supabase/class-account-rate-limit.sql` một lần để giới hạn tối đa 10 lần tạo tài khoản phụ huynh/học sinh mỗi giáo viên trong một giờ. File này chỉ thêm bảng quota riêng, không sửa hay xóa tài khoản/lớp hiện có.

Lưu ý: dữ liệu học sinh, điểm và bình luận được đọc/ghi từ Supabase. Bộ chọn tuần hiện vẫn tạo lịch khởi đầu trong trình duyệt và lưu trạng thái chốt trên chính trình duyệt đó; chưa có bảng lịch tuần dùng chung giữa thiết bị. Vì vậy không xem trạng thái chốt tuần hiện tại là khóa dữ liệu có hiệu lực trên máy chủ.

## 4. Thêm ảnh nền

Dashboard hiện dùng `public/school-campus-background.png` cho chế độ điện thoại và `public/school-campus-background.jpg` cho máy tính. Thay ảnh đúng tên file để đổi nền; trang phủ lớp tối để chữ vẫn dễ đọc.

## 5. Khi muốn đưa lên website

Bản ZIP này **chưa được tải lên hoặc triển khai**. Sau khi bạn chạy thử, gửi lại ZIP hoặc nói rõ muốn dùng bản này để cập nhật website; lúc đó cần cấu hình các biến `.env.local` tương ứng trong phần Environment Variables của nơi chạy ứng dụng. Không đưa `.env.local` vào ZIP hoặc kho Git.
