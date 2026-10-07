"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

// ============================================================
// TRANG CHUYẾN ĐI — /trip/[code]
// Mọi thao tác đọc/ghi đều đi qua các hàm RPC trong Supabase,
// và đều phải trình đúng mã chuyến (code) lấy từ URL.
// ============================================================

// ---- Các hàm tính toán: bê nguyên từ bản demo, chỉ đổi từ "tên" sang "id" ----

function toVND(amount, currency, rates) {
  return Number(amount) * (rates[currency] || 1);
}

function computeBalances(entries, members, rates) {
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

function settleDebts(balances, nameOf) {
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

function fmt(n) {
  return Math.round(n).toLocaleString("vi-VN") + " ₫";
}

// Rút gọn tiền: 1350000 -> "1.350k" (làm tròn đến nghìn đồng) — dùng cho Bảng chia
function fmtK(n) {
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
function formatAmountInput(raw, prev, typedChar) {
  const s = String(raw).replace(/[^0-9.,]/g, "");

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
function parseAmount(s) {
  return parseFloat(String(s).replace(/,/g, "")) || 0;
}

// Bảng màu "Biển": Sky Blue - Blue Green - Prussian Blue - Selective Yellow - UT Orange
const C = {
  ink: "#023047",      // Prussian Blue - chữ chính
  teal: "#219EBC",     // Blue Green - màu chủ đạo (chip, viền focus)
  tealDark: "#023047", // Prussian Blue - header, card fact đậm
  coral: "#FB8500",    // UT Orange - nút hành động chính
  sand: "#FFEDC2",     // Selective Yellow nhạt - tag, dải trả trước
  paper: "#F6FBFE",    // nền giấy ngả trời
  line: "#D9E8F1",     // đường viền xanh nhạt
  green: "#219EBC",    // Blue Green - tiền NHẬN LẠI
  red: "#FB8500",      // UT Orange - tiền PHẢI TRẢ
  purple: "#023047",   // Prussian - màu của chuyển tiền (tách khỏi xanh nhận lại)
};

export default function TripPage() {
  const params = useParams();
  const code = params.code; // mã bí mật lấy từ URL

  // ---- Dữ liệu chuyến đi tải từ Supabase ----
  const [trip, setTrip] = useState(null);
  const [members, setMembers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [rates, setRates] = useState({ VND: 1 });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false); // đang lưu gì đó

  const [tab, setTab] = useState("expenses");
  const [settingsOpen, setSettingsOpen] = useState(false); // modal Cài đặt
  const [tripNameInput, setTripNameInput] = useState("");   // ô sửa tên chuyến trong modal
  const [tripNameSaved, setTripNameSaved] = useState(false);
  const [memberModal, setMemberModal] = useState(null); // null | { mode: "add" } | { mode: "rename", id, oldName }
  const [memberNameInput, setMemberNameInput] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [ratesDirty, setRatesDirty] = useState(false); // tỉ giá sửa rồi nhưng chưa lưu
  const [copied, setCopied] = useState(false);
  const [session, setSession] = useState(null); // đăng nhập hay chưa
  const [saved, setSaved] = useState(false);    // chuyến này đã lưu vào tài khoản chưa
  const [qrView, setQrView] = useState(null); // member id đang xem QR phóng to
  const [editingItin, setEditingItin] = useState(false);
  const [itinInput, setItinInput] = useState("");

  // "Bạn là ai": nhớ trên từng máy, theo từng chuyến
  const [meId, setMeId] = useState(null);
  const [meChecked, setMeChecked] = useState(false); // đã đọc bộ nhớ máy chưa
  const [askWho, setAskWho] = useState(false);       // hiện hộp "Bạn là ai trong chuyến này?"
  const [showTips, setShowTips] = useState(false);   // thẻ "Cách dùng"
  const [toast, setToast] = useState(null);          // { text, detail, kind }
  const toastTimer = useRef(null);
  const [formError, setFormError] = useState("");    // nhắc khi bấm Lưu mà còn thiếu
  const [deleteTarget, setDeleteTarget] = useState(null); // khoản đang chờ xác nhận xóa
  const [deleting, setDeleting] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(false);  // giải thích trước khi sang Google
  const [qrBusyId, setQrBusyId] = useState(null);    // thành viên đang tải ảnh QR

  // State thêm tiền tệ mới
  const [newCur, setNewCur] = useState("");
  const [newRate, setNewRate] = useState("");
  const [curError, setCurError] = useState("");

  // State form nhập (khoản chi / chuyển tiền)
  const [fType, setFType] = useState("expense");
  const [fName, setFName] = useState("");
  const [fPayer, setFPayer] = useState("");
  const [fReceiver, setFReceiver] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fCurrency, setFCurrency] = useState("VND");
  const [fParts, setFParts] = useState([]);
  const [fPrepaid, setFPrepaid] = useState(false);
  const [editingId, setEditingId] = useState(null); // id khoản đang sửa (null = đang thêm mới)

  // ---- Tải toàn bộ dữ liệu chuyến (gọi RPC get_trip_data) ----
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_trip_data", { p_code: code });
    setLoading(false);
    if (error || !data) { setNotFound(true); return; }
    setTrip(data.trip);
    setMembers(data.members);
    setEntries(data.entries);
    setRates(data.trip.rates);
  }, [code]);

  useEffect(() => { load(); }, [load]);

  // Theo dõi trạng thái đăng nhập (để hiện nút Lưu chuyến)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Đã đăng nhập: kiểm tra trạng thái lưu + hoàn tất "lưu đang chờ"
  // (trường hợp bấm Lưu chuyến TRƯỚC khi đăng nhập -> app ghi nhớ ý định,
  //  đăng nhập xong quay lại đây thì tự lưu nốt, khỏi bắt bấm lần 2)
  useEffect(() => {
    if (!session) { setSaved(false); return; }

    const pending = localStorage.getItem("tripsplit_pending_save");
    if (pending === code) {
      localStorage.removeItem("tripsplit_pending_save");
      supabase.rpc("save_trip_to_account", { p_code: code }).then(() => setSaved(true));
      return;
    }

    supabase.rpc("is_trip_saved", { p_code: code }).then(({ data }) => setSaved(!!data));
  }, [session, code]);

  // Lần đầu danh sách thành viên về tới nơi: đọc "tôi là ai" đã nhớ trên máy,
  // điền sẵn người trả = tôi, rồi quyết định có hỏi "Bạn là ai?" và hiện thẻ cách dùng không.
  // "Chia cho ai" vẫn để trống để người dùng chủ động chọn hoặc bấm "Cả nhóm".
  useEffect(() => {
    if (members.length === 0 || meChecked) return;
    let stored = null;
    let tipsDone = null;
    try {
      stored = localStorage.getItem(`tripsplit_me_${code}`);
      tipsDone = localStorage.getItem(`tripsplit_tips_${code}`);
    } catch {}
    const found = members.find((m) => m.id === stored);
    if (found) setMeId(found.id);
    else if (stored !== "skip") setAskWho(true);
    const start = found || members[0];
    setFPayer(start.id);
    setFReceiver((members.find((m) => m.id !== start.id) || start).id);
    setShowTips(tipsDone !== "done");
    setMeChecked(true);
  }, [members, meChecked, code]);

  // Sửa form thì xóa lời nhắc cũ
  useEffect(() => { setFormError(""); }, [fName, fAmount, fParts, fPayer, fReceiver, fType]);

  const nameOf = (id) => members.find((m) => m.id === id)?.name || "?";
  const memberOf = (id) => members.find((m) => m.id === id);
  const me = members.find((m) => m.id === meId) || null;
  // Thành viên "tôi" luôn đứng đầu trong Tổng kết và Bảng chia
  const orderedMembers = me ? [me, ...members.filter((m) => m.id !== me.id)] : members;

  const balances = computeBalances(entries, members, rates);
  const transactions = settleDebts(balances, nameOf);

  // Bảng chi tiết CHỈ ĐỂ HIỂN THỊ: tách khoản chi thật và chuyển tiền tay đôi
  // (bộ máy tính tất toán ở trên vẫn gộp chung — toán đúng, chỉ trình bày là tách)
  const detail = {};
  members.forEach((m) => (detail[m.id] = { paidExp: 0, shareExp: 0, sent: 0, got: 0 }));
  entries.forEach((e) => {
    const vnd = toVND(e.amount, e.currency, rates);
    if (e.type === "expense") {
      if (detail[e.payer_id]) detail[e.payer_id].paidExp += vnd;
      const perHead = vnd / e.participant_ids.length;
      e.participant_ids.forEach((pid) => { if (detail[pid]) detail[pid].shareExp += perHead; });
    } else {
      if (detail[e.payer_id]) detail[e.payer_id].sent += vnd;
      if (detail[e.participant_ids[0]]) detail[e.participant_ids[0]].got += vnd;
    }
  });
  // Tiền THỰC TẾ mỗi người đã bỏ ra = trả cho chuyến + chuyển cho người khác - nhận từ người khác.
  // Cộng cả nhóm lại luôn bằng tổng chi (vì chuyển tiền cộng trừ triệt tiêu nhau).
  members.forEach((m) => {
    detail[m.id].outlay = detail[m.id].paidExp + detail[m.id].sent - detail[m.id].got;
  });

  const realExpenses = entries.filter((e) => e.type === "expense");
  const totalVND = realExpenses.reduce((s, e) => s + toVND(e.amount, e.currency, rates), 0);
  const prepaidList = realExpenses.filter((e) => e.prepaid);
  const prepaidTotal = prepaidList.reduce((s, e) => s + toVND(e.amount, e.currency, rates), 0);

  const paidReal = {};
  members.forEach((m) => (paidReal[m.id] = 0));
  realExpenses.forEach((e) => { if (paidReal[e.payer_id] !== undefined) paidReal[e.payer_id] += toVND(e.amount, e.currency, rates); });
  const topSpender = members.length > 0
    ? members.reduce((a, b) => (paidReal[a.id] > paidReal[b.id] ? a : b))
    : null;
  const biggestExpense = realExpenses.length > 0
    ? realExpenses.reduce((a, b) => (toVND(a.amount, a.currency, rates) > toVND(b.amount, b.currency, rates) ? a : b))
    : null;

  // ---- Các thao tác ghi vào Supabase ----

  async function addEntry() {
    const amount = parseAmount(fAmount);
    // Thiếu gì thì nói rõ, không để nút bấm mà im lặng
    if (fType === "expense" && !fName.trim()) { setFormError("Nhập tên khoản chi."); return; }
    if (!amount || amount <= 0) { setFormError("Nhập số tiền."); return; }
    if (fType === "expense" && fParts.length === 0) { setFormError("Chọn ít nhất một người để chia khoản này."); return; }
    if (fType === "transfer" && fPayer === fReceiver) { setFormError("Người trả và người nhận phải khác nhau."); return; }
    setFormError("");

    let payload;
    if (fType === "transfer") {
      payload = {
        p_type: "transfer",
        p_name: fName.trim() || "Trả nợ",
        p_payer_id: fPayer, p_amount: amount, p_currency: fCurrency,
        p_participant_ids: [fReceiver], p_prepaid: false,
      };
    } else {
      if (!fName.trim() || fParts.length === 0) return;
      payload = {
        p_type: "expense",
        p_name: fName.trim(),
        p_payer_id: fPayer, p_amount: amount, p_currency: fCurrency,
        p_participant_ids: fParts, p_prepaid: fPrepaid,
      };
    }

    setBusy(true);
    // Đang sửa thì gọi update_entry, đang thêm mới thì gọi add_entry
    const { error } = editingId
      ? await supabase.rpc("update_entry", { p_code: code, p_entry_id: editingId, ...payload })
      : await supabase.rpc("add_entry", { p_code: code, ...payload });
    setBusy(false);
    if (error) { failToast("Chưa lưu được khoản này. Thử lại nhé.", error); return; }

    // Dòng mới nằm dưới form, thường ngoài màn hình, nên báo ngắn gọn đã lưu gì
    const label = fType === "transfer" ? `${nameOf(fPayer)} trả nợ ${nameOf(fReceiver)}` : payload.p_name;
    showToast(`${editingId ? "Đã cập nhật" : "Đã thêm"} ${label} · ${fmt(toVND(amount, fCurrency, rates))}`);

    setEditingId(null);
    setFName(""); setFAmount(""); setFPrepaid(false);
    setFParts([]);
    load();
  }

  // Bấm "Sửa" trên 1 khoản: đổ dữ liệu khoản đó ngược vào form
  function startEdit(e) {
    setEditingId(e.id);
    setFType(e.type);
    setFName(e.type === "transfer" && (e.name === "Chuyển tiền" || e.name === "Trả nợ") ? "" : e.name);
    setFPayer(e.payer_id);
    if (e.type === "transfer") setFReceiver(e.participant_ids[0]);
    else setFParts(e.participant_ids);
    setFCurrency(e.currency);
    setFAmount(formatAmountInput(String(e.amount)));
    setFPrepaid(!!e.prepaid);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setFName(""); setFAmount(""); setFPrepaid(false);
    setFParts([]);
  }

  // Mở modal thêm thành viên mới (vd: có thêm bạn rủ đi sau khi đã tạo chuyến)
  function openAddMember() {
    setMemberNameInput("");
    setMemberModal({ mode: "add" });
  }

  // Mở modal đổi tên thành viên, có sẵn tên cũ trong ô nhập
  function openRenameMember(m) {
    setMemberNameInput(m.name);
    setMemberModal({ mode: "rename", id: m.id, oldName: m.name });
  }

  // Lưu modal thêm/sửa thành viên — dùng chung cho cả 2 việc, chỉ khác hàm RPC gọi
  async function submitMemberModal() {
    const name = memberNameInput.trim();
    if (!name || !memberModal) return;
    if (memberModal.mode === "rename" && name === memberModal.oldName) { setMemberModal(null); return; }

    setMemberBusy(true);
    const { error } = memberModal.mode === "add"
      ? await supabase.rpc("add_member", { p_code: code, p_name: name })
      : await supabase.rpc("rename_member", { p_code: code, p_member_id: memberModal.id, p_name: name });
    setMemberBusy(false);

    if (error) { failToast(memberModal.mode === "add" ? "Chưa thêm được thành viên. Thử lại nhé." : "Chưa đổi được tên. Thử lại nhé.", error); return; }
    setMemberModal(null);
    load();
  }

  // Xóa thật, không khôi phục được, nên có hộp xác nhận nói rõ xóa khoản nào
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.rpc("delete_entry", { p_code: code, p_entry_id: deleteTarget.id });
    setDeleting(false);
    if (error) { failToast("Chưa xóa được. Thử lại nhé.", error); return; }
    setDeleteTarget(null);
    load();
  }

  // Đổi tên chuyến đi (trong modal Cài đặt)
  async function saveTripName() {
    if (!tripNameInput.trim()) return;
    const { error } = await supabase.rpc("rename_trip", { p_code: code, p_name: tripNameInput.trim() });
    if (error) { failToast("Chưa đổi được tên chuyến. Thử lại nhé.", error); return; }
    setTrip({ ...trip, name: tripNameInput.trim() });
    setTripNameSaved(true);
    setTimeout(() => setTripNameSaved(false), 1500);
  }

  async function saveRates(next) {
    const { error } = await supabase.rpc("update_rates", { p_code: code, p_rates: next });
    if (error) { failToast("Chưa lưu được tỉ giá. Thử lại nhé.", error); return; }
    setRatesDirty(false);
  }

  function addCurrency() {
    const cur = newCur.trim().toUpperCase();
    const rate = parseFloat(newRate);
    if (!/^[A-Z]{3}$/.test(cur)) { setCurError("Mã tiền tệ phải gồm 3 chữ cái (vd: JPY, CAD, KRW)"); return; }
    if (rates[cur]) { setCurError("Tiền tệ " + cur + " đã có rồi"); return; }
    if (!rate || rate <= 0) { setCurError("Nhập tỉ giá hợp lệ (1 " + cur + " = ? đồng)"); return; }
    const next = { ...rates, [cur]: rate };
    setRates(next);
    setNewCur(""); setNewRate(""); setCurError("");
    saveRates(next); // tiền tệ mới lưu thẳng lên Supabase luôn
  }

  // ---- Upload ảnh QR lên Supabase Storage rồi gắn link vào member ----
  async function uploadQR(member, file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("Chọn một file ảnh, ví dụ ảnh chụp màn hình mã QR.", "error"); return; }
    setQrBusyId(member.id);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${trip.id}/${member.id}-${Date.now()}.${ext}`; // tên file ngẫu nhiên, không ai đoán được

    const { error: upErr } = await supabase.storage.from("qr-codes").upload(path, file);
    if (upErr) { setQrBusyId(null); failToast("Chưa tải được ảnh lên. Thử lại nhé.", upErr); return; }

    const { data: pub } = supabase.storage.from("qr-codes").getPublicUrl(path);
    const { error } = await supabase.rpc("set_member_qr", {
      p_code: code, p_member_id: member.id, p_qr_url: pub.publicUrl,
    });
    setQrBusyId(null);
    if (error) { failToast("Ảnh đã tải lên nhưng chưa gắn được vào mã QR. Thử lại nhé.", error); return; }
    load();
  }

  // Lưu / bỏ lưu chuyến. Chưa đăng nhập mà bấm Lưu -> ghi nhớ ý định
  // vào bộ nhớ trình duyệt rồi đưa đi đăng nhập, quay về sẽ tự lưu nốt.
  async function toggleSave() {
    if (!session) { setLoginPrompt(true); return; } // nói rõ sắp đăng nhập Google rồi mới đưa đi
    const fn = saved ? "unsave_trip" : "save_trip_to_account";
    const { error } = await supabase.rpc(fn, { p_code: code });
    if (error) { failToast("Chưa lưu được chuyến. Thử lại nhé.", error); return; }
    setSaved(!saved);
  }

  function startLogin() {
    localStorage.setItem("tripsplit_pending_save", code);
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href }, // đăng nhập xong quay về ĐÚNG trang chuyến này
    });
  }

  async function saveItinerary() {
    const { error } = await supabase.rpc("set_itinerary", { p_code: code, p_url: itinInput });
    if (error) { failToast("Chưa lưu được link lịch trình. Thử lại nhé.", error); return; }
    setTrip({ ...trip, itinerary_url: itinInput.trim() || null });
    setEditingItin(false);
  }

  function openSettings() {
    setTripNameInput(trip.name);
    setSettingsOpen(true);
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => showToast("Máy không cho copy tự động. Hãy copy link trên thanh địa chỉ.", "error"),
    );
  }

  function showToast(text, kind = "ok", detail = "") {
    setToast({ text, kind, detail });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), kind === "error" ? 6500 : 2800);
  }

  // Lỗi: một câu tiếng Việt cho người dùng, chi tiết kỹ thuật ở dòng nhỏ cho người quản lý chuyến
  function failToast(text, error) {
    if (error) console.error(error);
    showToast(text, "error", error?.message ? String(error.message).slice(0, 140) : "");
  }

  function chooseMe(id) {
    try { localStorage.setItem(`tripsplit_me_${code}`, id); } catch {}
    setMeId(id);
    if (!editingId) {
      setFPayer(id);
      setFReceiver((members.find((m) => m.id !== id) || members[0]).id);
    }
    setAskWho(false);
  }

  function skipWho() {
    try { localStorage.setItem(`tripsplit_me_${code}`, "skip"); } catch {}
    setAskWho(false);
  }

  function dismissTips() {
    try { localStorage.setItem(`tripsplit_tips_${code}`, "done"); } catch {}
    setShowTips(false);
  }

  // ---- Màn hình chờ / lỗi ----
  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#7d8a90", background: C.paper }}>Đang tải chuyến đi...</div>;
  }
  if (notFound) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, padding: 20 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 10 }}>Không tìm thấy chuyến đi</div>
          <div style={{ fontSize: 13.5, color: "#7d8a90", marginTop: 8, lineHeight: 1.6 }}>
            Link có thể bị thiếu ký tự khi copy. Kiểm tra lại link trong group chat, hoặc về <a href="/" style={{ color: C.tealDark }}>trang chủ</a> tạo chuyến mới.
          </div>
        </div>
      </div>
    );
  }

  const currencyList = Object.keys(rates);
  const allIds = members.map((m) => m.id);

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink }}>
      <style>{`
        .chip { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:999px; white-space:nowrap; background:#EDF5FA; color:${C.ink}; cursor:pointer; font-size:13.5px; user-select:none; transition: all .15s; }
        .chip.on { background:${C.teal}; color:#fff; }
        .inp { width:100%; padding:10px 12px; border:none; border-radius:10px; background:#EDF5FA; font-size:14px; outline:none; box-shadow:0 0 0 0 rgba(33,158,188,0); transition: box-shadow .15s; }
        .inp:focus { box-shadow:0 0 0 2px ${C.teal}; }
        .receipt { background:#fff; border-radius:14px; position:relative; box-shadow:0 1px 3px rgba(2,48,71,.08); }
        .receipt:before { content:""; position:absolute; top:-7px; left:0; right:0; height:14px;
          background:radial-gradient(circle at 8px 0px, transparent 7px, #fff 7.5px); background-size:18px 14px; }
        .tabbtn { flex:1; padding:11px 0; border:none; background:transparent; font-size:14px; font-weight:600; cursor:pointer; border-bottom:3px solid transparent; color:#7d8a90; }
        .tabbtn.on { color:${C.tealDark}; border-bottom-color:${C.coral}; }
        .typebtn { flex:1; padding:11px 0; border:none; background:#EDF5FA; font-size:13.5px; font-weight:600; cursor:pointer; color:#7d8a90; }
        .typebtn.on { background:${C.ink}; color:#fff; }
        .hero { display:flex; justify-content:space-between; align-items:flex-end; gap:18px; flex-wrap:wrap; }
        .stub { border-left:1.5px dashed rgba(255,255,255,.4); padding-left:16px; }
        /* Màn hình hẹp: cuống vé chiếm trọn hàng, đường xé xoay ngang như xé ngang thân vé */
        @media (max-width: 560px) {
          .stub { border-left:none; border-top:1.5px dashed rgba(255,255,255,.35); padding:12px 0 0; width:100%; margin-top:2px; }
        }
      `}</style>

      {/* ===== HEADER ===== */}
      <div style={{ background: C.tealDark, color: "#fff", padding: "14px 20px 20px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {/* Logo TripSplit ở góc trái như măng-sét báo — cả header chung MỘT trục trái */}
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", color: "#fff", marginBottom: 24, opacity: 0.9 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#FFB703" style={{ transform: "rotate(45deg)" }}>
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
            <span style={{ fontWeight: 800, fontSize: 13.5, letterSpacing: 1.5 }}>TripSplit</span>
          </a>

          {/* Hero trục trái kiểu dàn trang tạp chí; "cuống vé" tổng chi làm đối trọng bên phải */}
          <div className="hero">
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2.5, opacity: 0.75, fontWeight: 600 }}>CHUYẾN ĐI</div>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, transform: "rotate(45deg)" }}>
                  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                </svg>
                <span>{trip.name}</span>
              </div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>
                {members.map((m, i) => (
                  <span key={m.id}>{i > 0 && " · "}{m.id === meId ? <b>{m.name} (bạn)</b> : m.name}</span>
                ))}
              </div>
            </div>
            {/* Cuống vé: vạch đứt như đường xé vé — ăn rơ với hóa đơn răng cưa ở tab Tổng kết */}
            <div className="stub">
              <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.7, fontWeight: 600 }}>TỔNG CHI</div>
              {/* Số vàng Selective trên nền Prussian — bắt cặp với máy bay vàng của logo */}
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2, color: "#FFB703" }}>{fmt(totalVND)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            <button onClick={toggleSave}
              style={{ background: saved ? "#fff" : "rgba(255,255,255,.15)", border: "none", color: saved ? C.tealDark : "#fff", borderRadius: 999, padding: "10px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
              {saved ? "Đã lưu" : "Lưu chuyến"}
            </button>
            <button onClick={copyLink}
              style={{ background: copied ? "#fff" : "rgba(255,255,255,.15)", border: "none", color: copied ? C.tealDark : "#fff", borderRadius: 999, padding: "10px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
              {copied ? "Đã copy" : "Copy link mời"}
            </button>
            <button onClick={openSettings}
              style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 999, padding: "10px 16px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
              Cài đặt
            </button>
          </div>
        </div>
      </div>

      {/* ===== TABS ===== */}
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", boxShadow: "0 1px 0 rgba(2,48,71,.08)", background: C.paper, position: "sticky", top: 0, zIndex: 5 }}>
        <button className={`tabbtn ${tab === "expenses" ? "on" : ""}`} onClick={() => setTab("expenses")}>Sổ chi tiêu ({entries.length})</button>
        <button className={`tabbtn ${tab === "summary" ? "on" : ""}`} onClick={() => { setTab("summary"); load(); }}>Tổng kết</button>
        <button className={`tabbtn ${tab === "matrix" ? "on" : ""}`} onClick={() => { setTab("matrix"); load(); }}>Bảng chia</button>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "18px 16px 60px" }}>

        {/* ============ TAB 1: SỔ CHI TIÊU ============ */}
        {tab === "expenses" && (
          <>
            {showTips && !askWho && (
              <div style={{ background: "#F3F8FB", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.ink, marginBottom: 8 }}>Cách dùng</div>
                {[
                  "Chưa gửi link cho cả nhóm thì bấm Copy link mời ở trên rồi dán vào group chat.",
                  "Ai trả tiền gì thì nhập ở khung bên dưới. Mỗi người tự nhập khoản mình đã trả.",
                  "Cuối chuyến, vào tab Tổng kết để xem ai chuyển cho ai. Thêm mã QR ngân hàng của bạn ở đó để người khác quét trả.",
                ].map((t, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "22px 1fr", fontSize: 13.5, lineHeight: 1.5, color: "#5d6d77", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: C.ink }}>{i + 1}.</span>
                    <span>{t}</span>
                  </div>
                ))}
                <button onClick={dismissTips}
                  style={{ border: "none", background: "none", color: C.ink, fontWeight: 700, fontSize: 13.5, padding: "10px 0 0", cursor: "pointer", textDecoration: "underline" }}>
                  Đã hiểu
                </button>
              </div>
            )}

            <div style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 14, padding: "13px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {!editingItin && trip.itinerary_url && (
                <>
                  <a href={trip.itinerary_url} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, minWidth: 120, color: C.tealDark, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
                    Xem lịch trình chuyến đi →
                  </a>
                  <button onClick={() => { setItinInput(trip.itinerary_url); setEditingItin(true); }}
                    style={{ border: "none", background: "none", color: "#5d6d77", fontSize: 13.5, padding: "8px 4px", cursor: "pointer" }}>Sửa link</button>
                </>
              )}
              {!editingItin && !trip.itinerary_url && (
                <button onClick={() => { setItinInput(""); setEditingItin(true); }}
                  style={{ border: "none", background: "none", color: C.tealDark, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0 }}>
                  ＋ Gắn link lịch trình (Google Sheet, Docs...)
                </button>
              )}
              {editingItin && (
                <>
                  <input className="inp" placeholder="Dán link lịch trình vào đây" value={itinInput}
                    onChange={(e) => setItinInput(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                  <button onClick={saveItinerary}
                    style={{ background: C.coral, color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Lưu</button>
                  <button onClick={() => setEditingItin(false)}
                    style={{ border: "none", background: "none", color: "#5d6d77", fontSize: 13.5, padding: "8px 4px", cursor: "pointer" }}>Hủy</button>
                </>
              )}
            </div>

            <div style={{ background: editingId ? "#FFF6EC" : "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 14, padding: 16, marginBottom: 22 }}>
              {editingId && (
                <div style={{ background: "#FFF3D6", color: C.ink, borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  Đang sửa khoản đã nhập
                  <button onClick={cancelEdit} style={{ border: "none", background: "none", color: C.ink, cursor: "pointer", fontSize: 13.5, padding: "6px 4px", textDecoration: "underline" }}>Hủy</button>
                </div>
              )}
              <div style={{ display: "flex", marginBottom: 14, borderRadius: 10, overflow: "hidden" }}>
                <button className={`typebtn ${fType === "expense" ? "on" : ""}`} style={{ borderRadius: "10px 0 0 10px" }}
                  onClick={() => setFType("expense")}>Khoản chi</button>
                <button className={`typebtn ${fType === "transfer" ? "on" : ""}`} style={{ borderRadius: "0 10px 10px 0" }}
                  onClick={() => setFType("transfer")}>Trả nợ</button>
              </div>

              {fType === "expense" ? (
                <>
                  <input className="inp" placeholder="Tên khoản chi (vd: Ăn trưa ngày 3)" value={fName}
                    onChange={(e) => setFName(e.target.value)} style={{ marginBottom: 10 }} />

                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <input className="inp" type="text" inputMode="decimal" placeholder="Số tiền" value={fAmount}
                      onChange={(e) => setFAmount(formatAmountInput(e.target.value, fAmount, e.nativeEvent?.data))} style={{ flex: 2 }} />
                    <select className="inp" value={fCurrency} onChange={(e) => setFCurrency(e.target.value)} style={{ flex: 1 }}>
                      {currencyList.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select className="inp" value={fPayer} onChange={(e) => setFPayer(e.target.value)} style={{ flex: 1.4 }}>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name} trả</option>)}
                    </select>
                  </div>

                  <div style={{ fontSize: 12.5, color: "#7d8a90", marginBottom: 6 }}>Chia cho ai? <span style={{ color: "#9aa6ab" }}>Chọn từng người hoặc bấm Cả nhóm</span></div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
                    {members.map((m) => (
                      <span key={m.id} className={`chip ${fParts.includes(m.id) ? "on" : ""}`}
                        onClick={() => setFParts((prev) => prev.includes(m.id) ? prev.filter((p) => p !== m.id) : [...prev, m.id])}>
                        {fParts.includes(m.id) ? "✓ " : ""}{m.name}
                      </span>
                    ))}
                    <span className={`chip ${allIds.length > 0 && fParts.length === allIds.length ? "on" : ""}`}
                      onClick={() => setFParts(fParts.length === allIds.length ? [] : allIds)}>
                      {fParts.length === allIds.length && allIds.length > 0 ? "✓ " : ""}Cả nhóm
                    </span>
                  </div>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, marginBottom: 14, cursor: "pointer", lineHeight: 1.45 }}>
                    <input type="checkbox" checked={fPrepaid} onChange={(e) => setFPrepaid(e.target.checked)}
                      style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }} />
                    <span>
                      Chi trước chuyến đi (đặt cọc, mua vé trước)
                      <br /><span style={{ fontSize: 12, color: "#7d8a90" }}>Chỉ để gắn nhãn và gom riêng ở tab Tổng kết, không đổi cách chia tiền.</span>
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <select className="inp" value={fPayer} onChange={(e) => setFPayer(e.target.value)} style={{ flex: 1 }}>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <span style={{ color: "#9aa6ab", flexShrink: 0 }}>──→</span>
                    <select className="inp" value={fReceiver} onChange={(e) => setFReceiver(e.target.value)} style={{ flex: 1 }}>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <input className="inp" type="text" inputMode="decimal" placeholder="Số tiền" value={fAmount}
                      onChange={(e) => setFAmount(formatAmountInput(e.target.value, fAmount, e.nativeEvent?.data))} style={{ flex: 2 }} />
                    <select className="inp" value={fCurrency} onChange={(e) => setFCurrency(e.target.value)} style={{ flex: 1 }}>
                      {currencyList.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <input className="inp" placeholder="Ghi chú (vd: Duyên trả lại tiền ăn tối)" value={fName}
                    onChange={(e) => setFName(e.target.value)} style={{ marginBottom: 14 }} />
                  <div style={{ fontSize: 12, color: "#7d8a90", background: "#F3F8FB", borderRadius: 10, padding: "8px 12px", marginBottom: 14, lineHeight: 1.5 }}>
                    Dùng khi A đưa tiền lại cho B để trả nợ. Khoản này không tính vào chi phí.
                    Nếu A trả hộ một khoản chi cho B (vd tiền homestay), nhập ở tab Khoản chi: A trả, chia cho B.
                  </div>
                </>
              )}

              {formError && (
                <div style={{ fontSize: 13, color: C.ink, background: "#FFF3D6", borderRadius: 10, padding: "9px 12px", marginBottom: 10 }}>{formError}</div>
              )}
              <button onClick={addEntry} disabled={busy}
                style={{ width: "100%", padding: 12, background: busy ? "#c4ccd0" : (fType === "expense" ? C.coral : C.purple), color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: busy ? "wait" : "pointer" }}>
                {busy ? "Đang lưu..." : editingId ? "Cập nhật khoản này" : (fType === "expense" ? "Lưu khoản chi" : "Ghi nhận trả nợ")}
              </button>
            </div>

            {[...entries].reverse().map((e) => {
              const vnd = toVND(e.amount, e.currency, rates);
              const isTransfer = e.type === "transfer";
              return (
                <div key={e.id} style={{ background: isTransfer ? "#E8F4F9" : "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 9, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    {isTransfer ? (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 14.5, color: C.purple }}>
                          {nameOf(e.payer_id)} ──→ {nameOf(e.participant_ids[0])}
                        </div>
                        <div style={{ fontSize: 12.5, color: "#7d8a90", marginTop: 3 }}>{e.name === "Chuyển tiền" ? "Trả nợ" : e.name}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                          {e.name}
                          {e.prepaid && <span style={{ marginLeft: 8, fontSize: 11, background: C.sand, color: C.ink, padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>CHI TRƯỚC</span>}
                        </div>
                        <div style={{ fontSize: 12.5, color: "#7d8a90", marginTop: 3 }}>
                          <b style={{ color: C.tealDark }}>{nameOf(e.payer_id)}</b> trả · chia {e.participant_ids.length === members.length ? "cả nhóm" : e.participant_ids.map(nameOf).join(", ")}
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14.5 }}>{fmt(vnd)}</div>
                    {e.currency !== "VND" && (
                      <div style={{ fontSize: 11.5, color: "#9aa6ab" }}>{Number(e.amount).toLocaleString("vi-VN")} {e.currency}</div>
                    )}
                    <div style={{ marginTop: 4, marginRight: -10, display: "flex", justifyContent: "flex-end", gap: 4 }}>
                      <button onClick={() => startEdit(e)} style={{ border: "none", background: "none", color: C.ink, fontSize: 13, cursor: "pointer", fontWeight: 600, padding: "8px 10px" }}>Sửa</button>
                      <button onClick={() => setDeleteTarget(e)} style={{ border: "none", background: "none", color: "#7d8a90", fontSize: 13, cursor: "pointer", padding: "8px 10px" }}>Xóa</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {entries.length === 0 && (
              <div style={{ textAlign: "center", color: "#7d8a90", fontSize: 14, padding: "8px 0" }}>
                Chưa có khoản nào. Nhập khoản đầu tiên ở khung phía trên.
              </div>
            )}
          </>
        )}

        {/* ============ TAB 2: TỔNG KẾT ============ */}
        {tab === "summary" && (
          <>
            {me && !me.qr_url && balances[me.id].net > 1 && (
              <div style={{ background: "#F3F8FB", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>Bạn đang được nhận lại {fmt(balances[me.id].net)}</div>
                <div style={{ fontSize: 13.5, color: "#5d6d77", lineHeight: 1.5, margin: "4px 0 12px" }}>
                  Thêm mã QR ngân hàng để người trả quét là chuyển được. Mở app ngân hàng, vào mã QR nhận tiền, chụp màn hình rồi chọn ảnh đó ở đây.
                </div>
                <label style={{ display: "inline-block", background: C.ink, color: "#fff", borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {qrBusyId === me.id ? "Đang tải ảnh..." : "Thêm mã QR"}
                  <input type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(ev) => uploadQR(me, ev.target.files[0])} />
                </label>
              </div>
            )}

            {/* Chi phí THẬT mỗi người phải chịu cho chuyến (shareExp) — ai trả hộ cũng không đổi, chuyển tiền không tính */}
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#9aa6ab", fontWeight: 700, marginBottom: 10 }}>CHI PHÍ MỖI NGƯỜI</div>
            <div style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: "14px 16px", marginBottom: 22 }}>
              {[...members].sort((a, b) => detail[b.id].shareExp - detail[a.id].shareExp).map((m) => {
                const cost = detail[m.id].shareExp;
                const maxCost = Math.max(...members.map((x) => detail[x.id].shareExp), 1);
                return (
                  <div key={m.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{m.name}{m.id === meId && <span style={{ fontWeight: 400, color: "#7d8a90" }}> (bạn)</span>}</span>
                      <span style={{ fontWeight: 700 }}>{fmt(cost)}</span>
                    </div>
                    <div style={{ height: 6, background: "#E3EEF5", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(cost / maxCost) * 100}%`, background: C.ink, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11.5, color: "#9aa6ab", marginTop: 4 }}>
                Phần chi phí thật mỗi người phải chịu cho chuyến, ai trả hộ cũng không đổi.
              </div>
            </div>

            <div style={{ fontSize: 11, letterSpacing: 2, color: "#9aa6ab", fontWeight: 700, marginBottom: 10 }}>SỐ DƯ TỪNG NGƯỜI</div>
            {orderedMembers.map((m) => {
              const b = balances[m.id];
              const pos = b.net >= 0;
              const settled = Math.abs(b.net) < 1;
              return (
                <div key={m.id} style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{m.name}{m.id === meId && <span style={{ fontWeight: 400, fontSize: 13, color: "#7d8a90" }}> (bạn)</span>}</div>
                    <div style={{ fontWeight: 800, color: settled ? "#9aa6ab" : pos ? C.green : C.red, fontSize: 15 }}>
                      {settled ? "đã cân bằng ✓" : (pos ? "nhận lại " : "trả thêm ") + fmt(Math.abs(b.net))}
                    </div>
                  </div>
                  {/* Tóm tắt 1 dòng: đã chi bao nhiêu trên phần chi phí của mình */}
                  <div style={{ fontSize: 12.5, color: "#7d8a90", marginTop: 3 }}>
                    Đã chi {fmt(detail[m.id].outlay)} trên phần chi phí {fmt(detail[m.id].shareExp)}
                  </div>
                  <div style={{ height: 6, background: "#E3EEF5", borderRadius: 99, marginTop: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, (Math.max(detail[m.id].outlay, 0) / Math.max(detail[m.id].shareExp, 1)) * 100)}%`, background: pos ? C.green : C.red, borderRadius: 99 }} />
                  </div>
                  {/* Mã QR nhận tiền của người này */}
                  <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {m.qr_url ? (
                      <>
                        <img src={m.qr_url} alt={`Mã QR của ${m.name}`} onClick={() => setQrView(m.id)}
                          style={{ width: 44, height: 44, borderRadius: 6, boxShadow: "0 1px 3px rgba(2,48,71,.15)", cursor: "pointer", objectFit: "cover" }} />
                        <span style={{ fontSize: 13, color: "#7d8a90" }}>Mã QR nhận tiền. Bấm ảnh để phóng to.</span>
                        <label style={{ fontSize: 13, color: C.ink, fontWeight: 600, cursor: "pointer", marginLeft: "auto", padding: "8px 0" }}>
                          {qrBusyId === m.id ? "Đang tải ảnh..." : "Đổi ảnh"}
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={(ev) => uploadQR(m, ev.target.files[0])} />
                        </label>
                      </>
                    ) : (
                      <label style={{ display: "inline-block", fontSize: 13.5, color: C.ink, fontWeight: 600, background: "#EDF5FA", borderRadius: 10, padding: "10px 14px", cursor: "pointer", whiteSpace: "nowrap" }}>
                        {qrBusyId === m.id ? "Đang tải ảnh..." : m.id === meId ? "Thêm mã QR của bạn" : `Thêm mã QR của ${m.name}`}
                        <input type="file" accept="image/*" style={{ display: "none" }}
                          onChange={(ev) => uploadQR(m, ev.target.files[0])} />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}

            {prepaidList.length > 0 && (
              <div style={{ background: C.sand, borderRadius: 12, padding: "12px 14px", marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>Chi trước chuyến đi</div>
                  <div style={{ fontSize: 12, color: C.ink }}>{prepaidList.length} khoản, chiếm {Math.round((prepaidTotal / Math.max(totalVND, 1)) * 100)}% tổng chi</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 16, color: C.ink }}>{fmt(prepaidTotal)}</div>
              </div>
            )}

            <div style={{ fontSize: 11, letterSpacing: 2, color: "#9aa6ab", fontWeight: 700, margin: "24px 0 10px" }}>HÓA ĐƠN TẤT TOÁN</div>
            <div className="receipt" style={{ padding: "20px 18px 16px" }}>
              {transactions.length === 0 ? (
                <div style={{ textAlign: "center", color: "#7d8a90", fontSize: 14 }}>Cả nhóm đã cân bằng, không ai nợ ai.</div>
              ) : (
                transactions.map((t, i) => {
                  const mineRow = meId && (t.fromId === meId || t.toId === meId);
                  const toMember = memberOf(t.toId);
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 10px", margin: "0 -10px", borderRadius: 10, background: mineRow ? "#F3F8FB" : "transparent" }}>
                      <div style={{ fontSize: 14.5 }}>
                        <b style={{ color: C.red }}>{t.from}{t.fromId === meId ? " (bạn)" : ""}</b>
                        <span style={{ color: "#9aa6ab", margin: "0 8px" }}>──→</span>
                        <b style={{ color: C.green }}>{t.to}{t.toId === meId ? " (bạn)" : ""}</b>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{fmt(t.amount)}</div>
                        {toMember?.qr_url ? (
                          <button onClick={() => setQrView(t.toId)}
                            style={{ background: C.ink, border: "none", color: "#fff", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            Quét QR
                          </button>
                        ) : t.toId === meId ? (
                          <label style={{ background: "#EDF5FA", color: C.ink, borderRadius: 8, padding: "9px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            {qrBusyId === meId ? "Đang tải..." : "Thêm QR"}
                            <input type="file" accept="image/*" style={{ display: "none" }}
                              onChange={(ev) => uploadQR(me, ev.target.files[0])} />
                          </label>
                        ) : (
                          <span style={{ fontSize: 12, color: "#7d8a90", whiteSpace: "nowrap" }}>Chưa có QR</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {transactions.length > 0 && (
                <div style={{ textAlign: "center", fontSize: 11.5, color: "#7d8a90", marginTop: 14, letterSpacing: 1.5 }}>
                  CHỈ CẦN {transactions.length} LẦN CHUYỂN KHOẢN
                </div>
              )}
            </div>

            <div style={{ fontSize: 11, letterSpacing: 2, color: "#9aa6ab", fontWeight: 700, margin: "24px 0 10px" }}>FACT THÚ VỊ</div>
            {/* Luật phân cấp: số càng quan trọng nền càng đậm. 4 card = đủ 4 màu Riviera */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
              <div style={{ background: C.coral, color: C.ink, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, opacity: 0.75 }}>Đại gia của chuyến đi 👑</div>
                <div style={{ fontWeight: 800, fontSize: 17, marginTop: 3 }}>{topSpender?.name || "—"}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{topSpender ? "ứng trước " + fmt(paidReal[topSpender.id]) : ""}</div>
              </div>
              <div style={{ background: "#FFB703", color: C.ink, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, opacity: 0.85 }}>Khoản chi khủng nhất 💸</div>
                <div style={{ fontWeight: 800, fontSize: 14.5, marginTop: 3, color: C.ink }}>{biggestExpense?.name || "—"}</div>
                <div style={{ fontSize: 12 }}>{biggestExpense ? fmt(toVND(biggestExpense.amount, biggestExpense.currency, rates)) : ""}</div>
              </div>
              <div style={{ background: "#8ECAE6", color: "#023047", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, opacity: 0.85 }}>Chi trung bình mỗi người</div>
                <div style={{ fontWeight: 800, fontSize: 17, marginTop: 3, color: C.ink }}>{members.length > 0 ? fmt(totalVND / members.length) : "—"}</div>
              </div>
              <div style={{ background: C.tealDark, color: "#fff", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, opacity: 0.8 }}>Tổng "thiệt hại" cả chuyến</div>
                <div style={{ fontWeight: 800, fontSize: 19, marginTop: 3 }}>{fmt(totalVND)}</div>
              </div>
            </div>
          </>
        )}

        {/* ============ TAB 3: BẢNG CHIA — cả nhóm xem lại lần cuối trước khi chuyển tiền ============ */}
        {tab === "matrix" && (() => {
          const scrollMode = members.length > 4; // nhiều người thì cuộn ngang, cột tên khoản đứng yên
          const newestFirst = [...entries].reverse(); // giống Sổ chi tiêu: mới nhất ở trên
          const expRows = newestFirst.filter((e) => e.type === "expense");
          const trfRows = newestFirst.filter((e) => e.type === "transfer");

          // Bộ Biển: Blue Green = đã trả / được nhận lại, UT Orange = phải trả
          const T = {
            pos: "rgba(33,158,188,.20)", neg: "rgba(251,133,0,.22)",
            pos2: "rgba(33,158,188,.10)", neg2: "rgba(251,133,0,.12)",
            posStrong: "rgba(33,158,188,.32)", negStrong: "rgba(251,133,0,.34)",
          };

          // Số ròng của 1 người ở 1 dòng = đã trả - phải chịu
          const netOf = (e, m) => {
            const vnd = toVND(e.amount, e.currency, rates);
            const share = e.participant_ids.includes(m.id) ? vnd / e.participant_ids.length : 0;
            const paid = e.payer_id === m.id ? vnd : 0;
            return { net: paid - share, involved: paid > 0 || share > 0 };
          };
          const signedK = (net) => {
            const k = Math.round(net / 1000);
            return k === 0 ? "0" : (k > 0 ? "+" : "−") + Math.abs(k).toLocaleString("vi-VN") + "k";
          };
          const bgFor = (net, level) => {
            const k = Math.round(net / 1000);
            if (k === 0) return "#fff";
            const set = level === "soft" ? [T.pos2, T.neg2] : level === "strong" ? [T.posStrong, T.negStrong] : [T.pos, T.neg];
            return k > 0 ? set[0] : set[1];
          };

          const stickyLeft = scrollMode ? { position: "sticky", left: 0, zIndex: 1 } : {};
          const itemCell = { padding: "7px 8px", borderRadius: 6, textAlign: "left", fontSize: 12, lineHeight: 1.35, ...stickyLeft };
          const numCell = { padding: "10px 2px", borderRadius: 6, textAlign: "center", fontSize: 12, whiteSpace: "nowrap" };
          const subStyle = { fontSize: 11, color: "#7d8a90", fontWeight: 400 };
          const thStyle = {
            padding: "10px 0 6px", fontSize: 12, fontWeight: 700, color: C.ink, background: C.paper,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            ...(scrollMode ? {} : { position: "sticky", top: 40, zIndex: 4 }),
          };

          const sectionRow = (label) => (
            <tr key={label}>
              <td colSpan={members.length + 1}
                style={{ background: "transparent", padding: "12px 4px 2px", textAlign: "left", fontSize: 11, letterSpacing: 1.5, fontWeight: 700, color: "#9aa6ab" }}>
                {label}
              </td>
            </tr>
          );

          // Bấm vào tên khoản để sửa nếu phát hiện sai
          const renderRow = (e) => {
            const vnd = toVND(e.amount, e.currency, rates);
            const isT = e.type === "transfer";
            const defaultNote = e.name === "Chuyển tiền" || e.name === "Trả nợ";
            return (
              <tr key={e.id}>
                <td onClick={() => { setTab("expenses"); startEdit(e); }}
                  style={{ ...itemCell, background: isT ? "#E8F4F9" : "#fff", cursor: "pointer" }}>
                  <div style={{ fontWeight: 700, color: C.ink }}>{isT ? "Trả nợ" : e.name}</div>
                  <div style={subStyle}>
                    {isT ? `${nameOf(e.payer_id)} → ${nameOf(e.participant_ids[0])}` : `${nameOf(e.payer_id)} trả`} · {fmtK(vnd)}
                  </div>
                  {isT && !defaultNote && <div style={subStyle}>{e.name}</div>}
                  {e.currency !== "VND" && (
                    <div style={{ ...subStyle, color: "#9aa6ab" }}>{Number(e.amount).toLocaleString("vi-VN")} {e.currency}</div>
                  )}
                </td>
                {orderedMembers.map((m) => {
                  const { net, involved } = netOf(e, m);
                  const zero = Math.round(net / 1000) === 0;
                  return (
                    <td key={m.id}
                      style={{ ...numCell, background: involved ? bgFor(net, isT ? "soft" : "normal") : "#fff", color: !involved || zero ? "#9aa6ab" : C.ink, fontWeight: involved && !zero ? 700 : 400 }}>
                      {involved ? signedK(net) : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          };

          if (entries.length === 0) {
            return (
              <div style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: 20, textAlign: "center", color: "#7d8a90", fontSize: 14 }}>
                Chưa có khoản nào để tổng hợp.
              </div>
            );
          }

          return (
            <>
              <div style={{ fontSize: 12.5, color: "#5d6d77", background: "#F3F8FB", borderRadius: 10, padding: "10px 12px", marginBottom: 12, lineHeight: 1.5 }}>
                Xem lại trước khi chuyển tiền: có khoản nào thừa hoặc thiếu không, mỗi khoản chia đúng người và đúng số tiền chưa.
                Thấy sai thì bấm tên khoản để sửa.
              </div>

              <div style={scrollMode ? { overflowX: "auto" } : undefined}>
                <table style={{ width: "100%", minWidth: 104 + members.length * 56, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 3 }}>
                  <colgroup>
                    <col style={{ width: 104 }} />
                    {orderedMembers.map((m) => <col key={m.id} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, ...stickyLeft }}></th>
                      {orderedMembers.map((m) => <th key={m.id} style={{ ...thStyle, ...(m.id === meId ? { background: "#E8F4F9", borderRadius: 6 } : {}) }}>{m.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {expRows.length > 0 && sectionRow("KHOẢN CHI")}
                    {expRows.map(renderRow)}
                    {trfRows.length > 0 && sectionRow("TRẢ NỢ GIỮA CÁC THÀNH VIÊN (KHÔNG TÍNH VÀO CHI PHÍ)")}
                    {trfRows.map(renderRow)}
                    <tr><td colSpan={members.length + 1} style={{ height: 8, padding: 0, background: "transparent" }}></td></tr>
                    <tr>
                      <td style={{ ...itemCell, background: "#fff" }}>
                        <div style={{ fontWeight: 700, color: C.ink }}>Chi phí</div>
                        <div style={subStyle}>phần phải chịu</div>
                      </td>
                      {orderedMembers.map((m) => (
                        <td key={m.id} style={{ ...numCell, background: "#fff", color: C.ink, fontWeight: 700 }}>{fmtK(detail[m.id].shareExp)}</td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ ...itemCell, background: "#fff" }}>
                        <div style={{ fontWeight: 700, color: C.ink }}>Số dư</div>
                        <div style={subStyle}>nhận lại / trả thêm</div>
                      </td>
                      {orderedMembers.map((m) => {
                        const net = balances[m.id].net;
                        return (
                          <td key={m.id} style={{ ...numCell, background: bgFor(net, "strong"), color: Math.round(net / 1000) === 0 ? "#9aa6ab" : C.ink, fontWeight: 700 }}>
                            {signedK(net)}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#7d8a90", marginTop: 12 }}>
                <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, marginRight: 6, background: "rgba(33,158,188,.6)" }}></i>Đã trả, được nhận lại</span>
                <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, marginRight: 6, background: "rgba(251,133,0,.6)" }}></i>Phải trả</span>
                <span>— Không liên quan</span>
                {me && <span>Cột nền xanh nhạt là của bạn</span>}
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa6ab", marginTop: 6 }}>
                Số làm tròn đến nghìn đồng. Số chính xác xem ở tab Tổng kết.
              </div>
            </>
          );
        })()}
      </div>

      {/* Modal Cài đặt: gộp sửa tên chuyến, quản lý thành viên, và tỉ giá vào một chỗ */}
      {settingsOpen && (
        <div onClick={() => setSettingsOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(2,48,71,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, cursor: "pointer", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 18, padding: 22, maxWidth: 440, width: "100%", maxHeight: "85vh", overflowY: "auto", cursor: "default" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontWeight: 800, fontSize: 18, color: C.ink }}>Cài đặt chuyến đi</div>
              <button onClick={() => setSettingsOpen(false)}
                style={{ border: "none", background: "none", fontSize: 20, color: "#9aa6ab", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>

            {/* --- Bạn là ai --- */}
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa6ab", fontWeight: 700, marginBottom: 8 }}>BẠN LÀ AI</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 6 }}>
              {members.map((m) => (
                <span key={m.id} className={`chip ${m.id === meId ? "on" : ""}`} onClick={() => chooseMe(m.id)}>{m.name}</span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#7d8a90", marginBottom: 24 }}>
              Chỉ nhớ trên máy này. App dùng để điền sẵn người trả và đưa phần của bạn lên đầu.
            </div>

            {/* --- Tên chuyến đi --- */}
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa6ab", fontWeight: 700, marginBottom: 8 }}>TÊN CHUYẾN ĐI</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              <input className="inp" value={tripNameInput} onChange={(e) => setTripNameInput(e.target.value)} style={{ flex: 1 }} />
              <button onClick={saveTripName}
                style={{ background: tripNameSaved ? C.green : C.coral, color: "#fff", border: "none", borderRadius: 10, padding: "0 18px", fontWeight: 700, cursor: "pointer", fontSize: 13.5 }}>
                {tripNameSaved ? "✓ Đã lưu" : "Lưu"}
              </button>
            </div>

            {/* --- Thành viên --- */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa6ab", fontWeight: 700 }}>THÀNH VIÊN</div>
              <button onClick={openAddMember}
                style={{ border: "none", background: "none", color: C.ink, fontSize: 13.5, fontWeight: 700, padding: "8px 0", cursor: "pointer" }}>
                Thêm thành viên
              </button>
            </div>
            <div style={{ marginBottom: 24 }}>
              {members.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0" }}>
                  <span style={{ fontSize: 14.5 }}>{m.name}</span>
                  <button onClick={() => openRenameMember(m)}
                    style={{ border: "none", background: "none", color: "#5d6d77", fontSize: 13.5, fontWeight: 600, padding: "8px 0", cursor: "pointer" }}>
                    Sửa tên
                  </button>
                </div>
              ))}
            </div>

            {/* --- Tỉ giá --- */}
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa6ab", fontWeight: 700, marginBottom: 8 }}>TỈ GIÁ QUY ĐỔI RA VND</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
              {currencyList.filter((c) => c !== "VND").map((cur) => (
                <div key={cur} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                  <span style={{ width: 46, flexShrink: 0 }}>1 {cur} =</span>
                  <input type="number" value={rates[cur]}
                    onChange={(e) => { setRates({ ...rates, [cur]: parseFloat(e.target.value) || 0 }); setRatesDirty(true); }}
                    className="inp" style={{ flex: 1 }} />
                  <span>₫</span>
                </div>
              ))}
              {ratesDirty && (
                <button onClick={() => saveRates(rates)}
                  style={{ background: C.teal, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12.5, alignSelf: "flex-start" }}>
                  Lưu tỉ giá
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input placeholder="Mã (vd JPY)" value={newCur} onChange={(e) => setNewCur(e.target.value)} className="inp" style={{ flex: 1, minWidth: 90 }} />
              <input type="number" placeholder="Tỉ giá ra VND" value={newRate} onChange={(e) => setNewRate(e.target.value)} className="inp" style={{ flex: 1, minWidth: 100 }} />
              <button onClick={addCurrency}
                style={{ background: C.coral, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                ＋ Thêm
              </button>
            </div>
            {curError && <div style={{ fontSize: 13, color: C.ink, background: "#FFF3D6", borderRadius: 10, padding: "8px 12px", marginTop: 8 }}>{curError}</div>}
            <div style={{ fontSize: 11.5, color: "#9aa6ab", marginTop: 10 }}>
              Cả nhóm dùng chung các tỉ giá này. Sửa xong nhớ bấm Lưu tỉ giá.
            </div>
          </div>
        </div>
      )}

      {/* Modal thêm / sửa tên thành viên — thay cho window.prompt() xấu xí trước đây.
          Nằm trên cả modal Cài đặt (z-index cao hơn) vì được mở từ bên trong đó. */}
      {memberModal && (
        <div onClick={() => setMemberModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(2,48,71,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, cursor: "pointer", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 340, width: "100%", cursor: "default" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: 14 }}>
              {memberModal.mode === "add" ? "Thêm thành viên" : `Đổi tên "${memberModal.oldName}"`}
            </div>
            <input className="inp" autoFocus value={memberNameInput}
              placeholder={memberModal.mode === "add" ? "Tên thành viên mới" : "Tên mới"}
              onChange={(e) => setMemberNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitMemberModal(); }}
              style={{ marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setMemberModal(null)}
                style={{ flex: 1, background: "#EDF5FA", border: "none", color: C.ink, borderRadius: 10, padding: "10px 0", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
                Hủy
              </button>
              <button onClick={submitMemberModal} disabled={memberBusy || !memberNameInput.trim()}
                style={{ flex: 1, background: memberBusy ? "#c4ccd0" : C.coral, border: "none", color: "#fff", borderRadius: 10, padding: "10px 0", fontWeight: 700, cursor: memberBusy ? "wait" : "pointer", fontSize: 14 }}>
                {memberBusy ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hỏi "Bạn là ai?" lần đầu mở chuyến trên một máy. Không đóng khi bấm ra ngoài, phải chọn hoặc bấm Để sau. */}
      {askWho && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(2,48,71,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 65, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 360, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.ink, marginBottom: 4 }}>Bạn là ai trong chuyến này?</div>
            <div style={{ fontSize: 13.5, color: "#5d6d77", lineHeight: 1.5, marginBottom: 14 }}>
              App sẽ điền sẵn tên bạn khi nhập khoản chi và đưa phần của bạn lên đầu. Chỉ nhớ trên máy này.
            </div>
            {members.map((m) => (
              <button key={m.id} onClick={() => chooseMe(m.id)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "#EDF5FA", border: "none", borderRadius: 10, padding: "14px 16px", fontSize: 15, fontWeight: 600, color: C.ink, cursor: "pointer", marginBottom: 8 }}>
                {m.name}
              </button>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <button onClick={openAddMember}
                style={{ border: "none", background: "none", color: C.ink, fontSize: 13.5, fontWeight: 600, padding: "10px 0", cursor: "pointer", textDecoration: "underline" }}>
                Tên mình chưa có
              </button>
              <button onClick={skipWho}
                style={{ border: "none", background: "none", color: "#5d6d77", fontSize: 13.5, fontWeight: 600, padding: "10px 0", cursor: "pointer" }}>
                Để sau
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Xác nhận xóa: xóa thật, không khôi phục được */}
      {deleteTarget && (
        <div onClick={() => { if (!deleting) setDeleteTarget(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(2,48,71,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 72, cursor: "pointer", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 340, width: "100%", cursor: "default" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: 6 }}>Xóa khoản này?</div>
            <div style={{ fontSize: 14, color: "#5d6d77", lineHeight: 1.5, marginBottom: 16 }}>
              {deleteTarget.type === "transfer"
                ? `${nameOf(deleteTarget.payer_id)} trả nợ ${nameOf(deleteTarget.participant_ids[0])}`
                : deleteTarget.name}
              {" "}· {fmt(toVND(deleteTarget.amount, deleteTarget.currency, rates))}. Xóa rồi không khôi phục lại được.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                style={{ flex: 1, background: "#EDF5FA", border: "none", color: C.ink, borderRadius: 10, padding: "12px 0", fontWeight: 600, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" }}>
                Giữ lại
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                style={{ flex: 1, background: C.ink, border: "none", color: "#fff", borderRadius: 10, padding: "12px 0", fontWeight: 700, cursor: deleting ? "wait" : "pointer", fontSize: 14, whiteSpace: "nowrap" }}>
                {deleting ? "Đang xóa..." : "Xóa khoản này"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Giải thích trước khi đưa sang đăng nhập Google */}
      {loginPrompt && (
        <div onClick={() => setLoginPrompt(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(2,48,71,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 72, cursor: "pointer", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 340, width: "100%", cursor: "default" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: 6 }}>Lưu chuyến này vào tài khoản?</div>
            <div style={{ fontSize: 14, color: "#5d6d77", lineHeight: 1.5, marginBottom: 16 }}>
              Bạn sẽ đăng nhập bằng Google. Sau đó chuyến này nằm trong danh sách ở trang chủ, mở lại lúc nào cũng được, kể cả khi đổi máy.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setLoginPrompt(false)}
                style={{ flex: 1, background: "#EDF5FA", border: "none", color: C.ink, borderRadius: 10, padding: "12px 0", fontWeight: 600, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" }}>
                Để sau
              </button>
              <button onClick={startLogin}
                style={{ flex: 1, background: C.ink, border: "none", color: "#fff", borderRadius: 10, padding: "12px 0", fontWeight: 700, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" }}>
                Đăng nhập Google
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thông báo ngắn ở đáy màn hình: cố định, không đẩy nội dung. Bấm để tắt. */}
      {toast && (
        <div onClick={() => setToast(null)}
          style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(20px + env(safe-area-inset-bottom, 0px))", zIndex: 90, maxWidth: "calc(100% - 32px)", width: "max-content",
            background: toast.kind === "error" ? C.coral : C.ink, color: toast.kind === "error" ? C.ink : "#fff",
            borderRadius: 12, padding: "11px 16px", fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, cursor: "pointer" }}>
          <div>{toast.text}</div>
          {toast.detail && <div style={{ fontSize: 11.5, fontWeight: 400, marginTop: 3, wordBreak: "break-word" }}>{toast.detail}</div>}
        </div>
      )}

      {/* Modal phóng to QR */}
      {qrView && memberOf(qrView)?.qr_url && (
        <div onClick={() => setQrView(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(27,42,51,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, cursor: "pointer", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 20, textAlign: "center", maxWidth: 320, width: "100%", cursor: "default" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Chuyển tiền cho {nameOf(qrView)}</div>
            <img src={memberOf(qrView).qr_url} alt={`QR của ${nameOf(qrView)}`} style={{ width: "100%", borderRadius: 10 }} />
            <button onClick={() => setQrView(null)}
              style={{ marginTop: 14, width: "100%", padding: 10, background: "#023047", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
