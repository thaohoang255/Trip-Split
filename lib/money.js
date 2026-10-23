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

// Tất toán: ghép người nợ nhiều nhất với người được nhận nhiều nhất cho tới khi hết,
// cho ra ít lần chuyển khoản nhất. Bỏ qua chênh lệch dưới 1 đồng.
export function settleDebts(balances, nameOf) {
  const debtors = [];
  const creditors = [];
  Object.entries(balances).forEach(([id, b]) => {
    if (b.net < -1) debtors.push({ id, amount: -b.net });
    else if (b.net > 1) creditors.push({ id, amount: b.net });
  });
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    transactions.push({ fromId: debtors[i].id, toId: creditors[j].id, from: nameOf(debtors[i].id), to: nameOf(creditors[j].id), amount: pay });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount < 1) i++;
    if (creditors[j].amount < 1) j++;
  }
  return transactions;
}
