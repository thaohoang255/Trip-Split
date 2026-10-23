// Bảng màu "Biển" của TripSplit: định nghĩa MỘT lần, mọi trang dùng chung.
// Thêm màu mới ở đây chứ không viết mã màu trực tiếp trong trang, để giao diện không trôi thành nhiều tông gần giống nhau.
// (app/globals.css lặp lại 4 giá trị cho viền focus, chữ gợi ý và vùng bôi đen vì CSS không đọc được file JS.)

export const COLORS = {
  // Cấu trúc
  ink: "#023047",       // chữ chính, header, lớp phủ sau hộp thoại
  text2: "#56656E",     // chữ phụ, ghi chú (đạt 4.5:1 trên nền trắng và nền fill)
  white: "#FFFFFF",     // thẻ

  // Nhấn
  action: "#FB8500",    // CHỈ cho nút hành động chính và tab đang chọn
  oweText: "#A84B00",   // chữ "trả thêm" (cam đậm, đạt 4.5:1)
  getText: "#0B6F88",   // chữ "nhận lại", chip đang chọn (xanh đậm, đạt 4.5:1)
  teal: "#219EBC",      // thanh số liệu, viền focus, nền nhạt trong Bảng chia
  sun: "#FFB703",       // điểm nhấn: tổng chi, logo máy bay, fact thú vị

  // Nền nhạt: chỉ 3 tông xanh + 1 trạng thái "đang chọn"
  paper: "#F6FBFE",     // nền trang
  fill: "#EDF5FA",      // ô nhập, chip, thẻ ghi chú, dòng trả nợ, nút sáng
  selected: "#DCEEF3",  // nút sáng đang bật ("Đã lưu"), vùng bôi đen chữ
  line: "#D9E8F1",      // đường kẻ, viền

  // Ấm: "chú ý" và nhãn
  attention: "#FFF3D6", // cảnh báo, nhắc nhở, khung đang sửa
  tag: "#FFEDC2",       // nhãn "CHI TRƯỚC", thẻ fact phụ
};
