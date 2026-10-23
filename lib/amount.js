// Định dạng và đọc số tiền: ô nhập số tiền (Sổ chi tiêu) và số rút gọn (Bảng chia, Chi tiết từng người).

// Rút gọn tiền: 1350000 -> "1.350k" (làm tròn đến nghìn đồng) — dùng cho Bảng chia
export function fmtK(n) {
  const k = Math.round(Math.abs(n) / 1000);
  return k === 0 ? "0" : k.toLocaleString("vi-VN") + "k";
}

// Định dạng số đang gõ: 2800000 -> "2,800,000", hỗ trợ tối đa 2 số thập phân,
// và chấp nhận CẢ dấu chấm lẫn dấu phẩy làm dấu thập phân (bàn phím số ở VN
// thường dùng dấu phẩy, vd gõ 9,7 nghĩa là 9.7 -- bản cũ coi mọi dấu phẩy là
// "phân cách hàng nghìn" nên xóa mất phần thập phân người dùng vừa gõ).
//
// Mấu chốt: dùng chính KÝ TỰ VỪA GÕ (typedChar, lấy từ e.nativeEvent.data) để biết
// chắc đây có phải lúc người dùng bấm dấu thập phân hay không, thay vì đoán mò từ
// chuỗi đã trộn sẵn dấu phẩy phân cách hàng nghìn -- đoán mò là nguyên nhân gây lỗi
// khi gõ số lớn (vd tiếp tục gõ số sau "2,800" bị hiểu nhầm thành "2.800").
//
// VND không có số lẻ: người Việt hay gõ dấu chấm làm phân cách hàng nghìn
// (1.500.000), nên với VND mọi dấu . và , đều bị coi là phân cách hàng nghìn.
export function formatAmountInput(raw, prev, typedChar, allowDecimals = true) {
  const s = String(raw).replace(/[^0-9.,]/g, "");
  if (!allowDecimals) return s.replace(/[.,]/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Đã đủ 2 số lẻ mà gõ thêm 1 CHỮ SỐ (không phải bấm thêm dấu thập phân) thì bỏ qua,
  // giữ nguyên giá trị cũ -- đúng yêu cầu "chỉ cho tối đa 2 số thập phân".
  if (typedChar && /[0-9]/.test(typedChar) && prev && prev.includes(".")) {
    if (prev.split(".")[1].length >= 2) return prev;
  }

  const hasNewSeparator = typedChar === "." || typedChar === ",";
  let sepIndex = -1;
  if (hasNewSeparator) {
    sepIndex = s.lastIndexOf(typedChar); // biết chắc đây là dấu thập phân vừa bấm
  } else {
    // Không có phím thập phân mới -> dấu . hoặc , CUỐI CÙNG (nếu có) chỉ được coi
    // là thập phân khi đứng sau nó có ≤2 chữ số (dấu phân cách hàng nghìn do máy tự
    // chèn luôn có ĐÚNG 3 chữ số theo sau, nên ≥3 chữ số nghĩa là đang gõ số nguyên).
    const seps = [...s.matchAll(/[.,]/g)];
    if (seps.length > 0) {
      const last = seps[seps.length - 1];
      const digitsAfter = s.slice(last.index + 1).replace(/[.,]/g, "");
      if (digitsAfter.length <= 2) sepIndex = last.index;
    }
  }

  if (sepIndex === -1) {
    const intDigits = s.replace(/[.,]/g, "");
    return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  const intDigits = s.slice(0, sepIndex).replace(/[.,]/g, "");
  const decDigits = s.slice(sepIndex + 1).replace(/[.,]/g, "").slice(0, 2);
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return grouped + "." + decDigits;
}

// Đọc ngược chuỗi có dấu phẩy về con số thật: "2,800,000" -> 2800000
export function parseAmount(s) {
  return parseFloat(String(s).replace(/,/g, "")) || 0;
}
