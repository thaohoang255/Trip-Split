// Các hàm tính tiền dùng chung cho trang chuyến đi và trang chủ (danh sách chuyến gần đây).

export function toVND(amount, currency, rates) {
  if (currency === "VND") return Number(amount);
  // Tỉ giá 0 hoặc thiếu không được lặng lẽ coi là 1 (100 USD thành 100 ₫)
  const rate = Number(rates[currency]);
  return rate > 0 ? Number(amount) * rate : 0;
}

export function computeBalances(entries, members, rates) {
  const bal = {};
  members.forEach((m) => (bal[m.id] = { paid: 0, share: 0, net: 0 }));

  entries.forEach((e) => {
    const vnd = toVND(e.amount, e.currency, rates);
    if (bal[e.payer_id]) bal[e.payer_id].paid += vnd;
    const perHead = vnd / e.participant_ids.length;
    e.participant_ids.forEach((pid) => {
      if (bal[pid]) bal[pid].share += perHead;
    });
  });

  members.forEach((m) => (bal[m.id].net = bal[m.id].paid - bal[m.id].share));
  return bal;
}

export function fmt(n) {
  return Math.round(n).toLocaleString("vi-VN") + " ₫";
}
