# PTA-hanhkiem

Đây là một dự án web riêng dùng Next.js App Router, TypeScript, Tailwind CSS và Supabase. Giao diện được làm lại theo kiểu đơn giản, dễ đọc và dùng được trên điện thoại.

## Chạy trên máy của bạn

1. Cài Node.js và npm.
2. Chạy `npm install`.
3. Chép `.env.example` thành `.env.local`.
4. Điền thông tin Supabase và cấu hình máy chủ AI nếu muốn dùng quét ảnh.
5. Chạy `npm run dev` rồi mở `http://localhost:3000`.

Không đưa `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY` hoặc `GEMINI_API_KEY` vào biến `NEXT_PUBLIC_*`. Các khóa bí mật chỉ được đọc ở phía máy chủ. Tệp `.env.local` đã bị Git bỏ qua.

## Chức năng hiện có

- Đăng nhập Supabase theo vai trò và đăng ký tài khoản giáo viên.
- Giáo viên quản lý lớp, học sinh, tổ, tài khoản lớp, điểm theo tuần và kết quả học tập.
- Quét ảnh danh sách hoặc sổ điểm bằng AI; người dùng xem và sửa bản nhận dạng trước khi lưu.
- BCS gửi ghi nhận trong phạm vi được cấp quyền.
- Bảng tin, bình luận, góp ý và kết quả học tập.
- Khu vực quản trị có kiểm tra vai trò ở phía máy chủ.
- Supabase RLS và các API hiện có tiếp tục kiểm tra quyền lưu dữ liệu.

## Cấu trúc

- `app/`: trang đăng nhập, đăng ký, dashboard, API OCR và trang quản trị.
- `components/dashboard/`: màn hình lớp, sổ điểm, quét ảnh, kết quả, bình luận và tài khoản.
- `components/ui/`: nút và ô nhập dùng chung.
- `lib/supabase/`: kết nối Supabase phía trình duyệt và máy chủ.
- `supabase/`: schema, migration và hướng dẫn rollback hiện có.

## Cấu hình Supabase

Dự án này tiếp tục dùng dữ liệu Supabase hiện tại. Hãy dùng đúng biến trong `.env.example` và chỉ chạy các migration cần thiết sau khi đọc hướng dẫn trong `HUONG-DAN.md` và `supabase/migrations/README.md`. Không chạy migration trên Production khi chưa được yêu cầu.

Lưu ý: hệ thống hiện tại dùng tài khoản phụ huynh/học sinh chung theo lớp và hồ sơ gắn với `class_id`; chưa có liên kết tài khoản tới một học sinh cụ thể. Muốn giới hạn riêng từng tài khoản vào từng học sinh cần thiết kế migration liên kết và cấp quyền riêng, không nên tự gán học sinh khi chưa có dữ liệu xác nhận.

Tuần học hiện được tạo theo lịch mẫu sẵn có trong mã và trạng thái chốt tuần được lưu ở trình duyệt. Đây chưa phải lịch tuần dùng chung trong Supabase.

