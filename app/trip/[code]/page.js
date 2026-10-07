"use client";

import { cloneElement, useEffect, useState, useCallback, useRef, useId } from "react";
import { useParams } from "next/navigation";
import { ArrowRight, CaretRight, Check, Plus, Scan, Trash, X } from "@phosphor-icons/react";
import { supabase } from "../../../lib/supabase";
import { toVND, computeBalances, fmt } from "../../../lib/money";

// ============================================================
// TRANG CHUYẾN ĐI — /trip/[code]
// Mọi thao tác đọc/ghi đều đi qua các hàm RPC trong Supabase,
// và đều phải trình đúng mã chuyến (code) lấy từ URL.
// ============================================================

// ---- Các hàm tính toán: bê nguyên từ bản demo, chỉ đổi từ "tên" sang "id" ----

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
//
// VND không có số lẻ: người Việt hay gõ dấu chấm làm phân cách hàng nghìn
// (1.500.000), nên với VND mọi dấu . và , đều bị coi là phân cách hàng nghìn.
function formatAmountInput(raw, prev, typedChar, allowDecimals = true) {
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
  // Bản đậm của màu tiền để dùng cho CHỮ (thanh và nền vẫn dùng màu tươi ở trên).
  // Màu tươi chỉ đạt 2.5–3.1:1 trên nền trắng; các màu này đạt trên 4.5:1.
  text2: "#56656E",      // chữ phụ, ghi chú
  tealText: "#0B6F88",   // chữ "nhận lại"
  orangeText: "#A84B00", // chữ "trả thêm"
};

// Lời giải thích nhỏ hiện khi rê chuột (máy tính) hoặc khi chọn nút bằng bàn phím.
// align: "start" | "center" | "end" để bong bóng không tràn ra mép màn hình.
// tone "light" dùng trên header nền xanh đậm.
function Tip({ text, align = "center", tone, style, children }) {
  const id = useId();
  return (
    <span className={`tip-wrap tip-${align}${tone === "light" ? " tip-light" : ""}`} style={style}>
      {cloneElement(children, { "aria-describedby": id })}
      <span role="tooltip" id={id} className="tip">{text}</span>
    </span>
  );
}

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
  const [helpOpen, setHelpOpen] = useState(false);         // modal Trợ giúp (hướng dẫn dùng app)
  const [tripNameInput, setTripNameInput] = useState("");   // ô sửa tên chuyến trong modal
  const [tripNameSaved, setTripNameSaved] = useState(false);
  const [memberModal, setMemberModal] = useState(null); // null | { mode: "add" } | { mode: "rename", id, oldName }
  const [memberNameInput, setMemberNameInput] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [ratesDraft, setRatesDraft] = useState(null); // tỉ giá đang sửa, chưa lưu (null = không sửa gì)
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
  const matrixHeadRef = useRef(null); // hàng tên dính của Bảng chia, cuộn ngang theo bảng
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
  const [sheetOpen, setSheetOpen] = useState(false); // tấm nhập khoản trượt từ dưới lên

  // ---- Tải toàn bộ dữ liệu chuyến (gọi RPC get_trip_data) ----
  const loadedOnce = useRef(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_trip_data", { p_code: code });
    setLoading(false);
    if (error || !data) {
      // Chỉ lần tải đầu mới là "không tìm thấy". Lần tải lại mà lỗi (mạng chập chờn)
      // thì giữ nguyên dữ liệu đang xem và báo nhẹ, không thay cả trang.
      if (!loadedOnce.current) setNotFound(true);
      else {
        if (error) console.error(error);
        setToast({ text: "Chưa tải lại được dữ liệu mới. Kiểm tra mạng rồi thử lại.", kind: "error", detail: "" });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 6500);
      }
      return;
    }
    loadedOnce.current = true;
    try {
      const recent = JSON.parse(localStorage.getItem("tripsplit_recent") || "[]").filter((x) => x.code !== code);
      recent.unshift({ code, at: new Date().toISOString() });
      localStorage.setItem("tripsplit_recent", JSON.stringify(recent.slice(0, 20)));
    } catch {}
    setTrip(data.trip);
    setMembers(data.members);
    setEntries(data.entries);
    setRates(data.trip.rates);
    setRatesDraft(null);
  }, [code]);

  useEffect(() => { load(); }, [load]);

  // Quay lại app (vd đang ở Zalo rồi mở lại tab) thì tải lại, để thấy khoản bạn bè vừa nhập
  useEffect(() => {
    function onVisible() { if (document.visibilityState === "visible") load(); }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

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
  // "Chia cho ai" được chọn sẵn cả nhóm mỗi lần mở tấm nhập (xem openAdd).
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

  // Esc đóng hộp thoại trên cùng. Hộp "Bạn là ai" cố ý không đóng bằng Esc (phải chọn hoặc bấm Để sau).
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (qrView) setQrView(null);
      else if (deleteTarget) { if (!deleting) setDeleteTarget(null); }
      else if (sheetOpen) closeSheet();
      else if (loginPrompt) setLoginPrompt(false);
      else if (memberModal) setMemberModal(null);
      else if (settingsOpen) { setSettingsOpen(false); setRatesDraft(null); setCurError(""); }
      else if (helpOpen) setHelpOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrView, deleteTarget, deleting, loginPrompt, memberModal, settingsOpen, sheetOpen, helpOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tấm nhập đang mở thì khóa cuộn trang phía sau; mở để thêm mới thì đưa con trỏ vào ô tên
  const sheetNameRef = useRef(null);
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!editingId) setTimeout(() => sheetNameRef.current?.focus(), 220);
    return () => { document.body.style.overflow = prev; };
  }, [sheetOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
    ? members.reduce((a, b) => (paidReal[b.id] > paidReal[a.id] ? b : a))
    : null;
  const hasTopSpender = topSpender && paidReal[topSpender.id] > 0;
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

    // Báo ngắn gọn đã lưu gì, rồi đóng tấm nhập: dòng mới hiện ngay đầu danh sách
    const label = fType === "transfer" ? `${nameOf(fPayer)} trả nợ ${nameOf(fReceiver)}` : payload.p_name;
    showToast(`${editingId ? "Đã cập nhật" : "Đã thêm"} ${label} · ${fmt(toVND(amount, fCurrency, rates))}`);

    setEditingId(null);
    setFName(""); setFAmount(""); setFPrepaid(false);
    setFParts([]);
    setSheetOpen(false);
    load();
  }

  // Nút "Thêm khoản chi": form trống, người trả = tôi, chia sẵn cho cả nhóm
  function openAdd() {
    setEditingId(null);
    setFType("expense");
    setFName(""); setFAmount(""); setFPrepaid(false);
    setFParts(members.map((m) => m.id));
    if (meId) setFPayer(meId);
    setFormError("");
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    cancelEdit();
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
    setFAmount(formatAmountInput(String(e.amount), "", null, e.currency !== "VND"));
    setFPrepaid(!!e.prepaid);
    setFormError("");
    setSheetOpen(true);
  }

  // Đổi sang VND thì làm tròn số đang nhập, vì VND không có số lẻ
  function changeCurrency(cur) {
    setFCurrency(cur);
    if (cur === "VND" && fAmount) setFAmount(formatAmountInput(String(Math.round(parseAmount(fAmount))), "", null, false));
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
    if (deleteTarget.id === editingId) closeSheet(); // khoản đang sửa đã bị xóa thì đóng tấm nhập
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

  // Tỉ giá chỉ có hiệu lực khi đã lưu: đang gõ dở không làm nhảy số của cả nhóm
  async function saveRates(next) {
    const clean = {};
    for (const [cur, v] of Object.entries(next)) {
      const rate = Number(v);
      if (!(rate > 0)) { setCurError(`Tỉ giá ${cur} phải lớn hơn 0.`); return false; }
      clean[cur] = rate;
    }
    const { error } = await supabase.rpc("update_rates", { p_code: code, p_rates: clean });
    if (error) { failToast("Chưa lưu được tỉ giá. Thử lại nhé.", error); return false; }
    setRates(clean);
    setCurError("");
    return true;
  }

  function addCurrency() {
    const cur = newCur.trim().toUpperCase();
    const rate = parseFloat(newRate);
    if (!/^[A-Z]{3}$/.test(cur)) { setCurError("Mã tiền tệ phải gồm 3 chữ cái (vd: JPY, CAD, KRW)"); return; }
    if (rates[cur]) { setCurError("Tiền tệ " + cur + " đã có rồi"); return; }
    if (!rate || rate <= 0) { setCurError("Nhập tỉ giá hợp lệ (1 " + cur + " = ? đồng)"); return; }
    // tiền tệ mới lưu thẳng lên Supabase luôn
    saveRates({ ...rates, [cur]: rate }).then((ok) => { if (ok) { setNewCur(""); setNewRate(""); } });
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

  function closeSettings() {
    setSettingsOpen(false);
    setRatesDraft(null); setCurError("");
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
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.text2, background: C.paper }}>Đang tải chuyến đi...</div>;
  }
  if (notFound) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, padding: 20 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 10 }}>Không tìm thấy chuyến đi</div>
          <div style={{ fontSize: 13.5, color: C.text2, marginTop: 8, lineHeight: 1.6 }}>
            Link có thể bị thiếu ký tự khi copy. Kiểm tra lại link trong group chat, hoặc về <a href="/" style={{ color: C.tealDark }}>trang chủ</a> tạo chuyến mới.
          </div>
        </div>
      </div>
    );
  }

  const currencyList = Object.keys(rates);
  const allIds = members.map((m) => m.id);
  const fieldLabel = { display: "block", fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 5 };
  const sectionHead = { fontSize: 16, fontWeight: 800, color: C.ink, margin: "26px 0 10px" };
  const settingsHead = { fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 8 };

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink }}>
      <style>{`
        .chip { display:inline-flex; align-items:center; gap:5px; padding:8px 14px; border:none; border-radius:999px; white-space:nowrap; background:#EDF5FA; color:${C.ink}; cursor:pointer; font:inherit; font-size:13.5px; user-select:none; transition: background-color .15s, color .15s; }
        .chip.on { background:${C.tealText}; color:#fff; }
        .entry { transition: box-shadow .15s, transform .1s; }
        .entry:hover { box-shadow: 0 2px 8px rgba(2,48,71,.12) !important; }
        .entry:active { transform: scale(.99); }
        @media (prefers-reduced-motion: reduce) { .chip, .entry { transition: none; } .entry:active { transform: none; } }
        .inp { width:100%; padding:10px 12px; border:none; border-radius:10px; background:#EDF5FA; font-size:14px; outline:none; box-shadow:0 0 0 0 rgba(33,158,188,0); transition: box-shadow .15s; }
        .inp:focus { box-shadow:0 0 0 2px ${C.teal}; }
        .receipt { background:#fff; border-radius:14px; position:relative; box-shadow:0 1px 3px rgba(2,48,71,.08); }
        .receipt:before { content:""; position:absolute; top:-7px; left:0; right:0; height:14px;
          background:radial-gradient(circle at 8px 0px, transparent 7px, #fff 7.5px); background-size:18px 14px; }
        .tabbtn { flex:1; padding:11px 0; border:none; background:transparent; font-size:14px; font-weight:600; cursor:pointer; border-bottom:3px solid transparent; color:${C.text2}; }
        .tabbtn.on { color:${C.tealDark}; border-bottom-color:${C.coral}; }
        .typebtn { flex:1; padding:11px 0; border:none; background:#EDF5FA; font-size:13.5px; font-weight:600; cursor:pointer; color:${C.text2}; }
        .typebtn.on { background:${C.ink}; color:#fff; }
        .sheet { animation: sheet-up .22s cubic-bezier(.16,1,.3,1); }
        .scrim { animation: scrim-in .2s ease-out; }
        @keyframes sheet-up { from { transform: translateY(24px); opacity: .6; } to { transform: none; opacity: 1; } }
        @keyframes scrim-in { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .sheet, .scrim { animation: none; } }
      `}</style>

      {/* ===== HEADER =====
          Gọn lại để danh sách khoản chi hiện ngay màn hình đầu: tên chuyến bên trái,
          "cuống vé" tổng chi bên phải, hàng nút bên dưới. Danh sách thành viên đầy đủ nằm ở Cài đặt. */}
      <header style={{ background: C.tealDark, color: "#fff", padding: "12px 16px 14px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14 }}>
            <div style={{ minWidth: 0 }}>
              <a href="/" aria-label="Về trang chủ TripSplit" style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none", color: "#fff", opacity: 0.9, padding: "4px 0" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#FFB703" style={{ transform: "rotate(45deg)" }} aria-hidden="true">
                  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                </svg>
                <span style={{ fontWeight: 800, fontSize: 12, letterSpacing: 1.2 }}>TripSplit</span>
              </a>
              <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.2, marginTop: 4, overflowWrap: "anywhere" }}>{trip.name}</h1>
              <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 3 }}>
                {members.length} người · {me
                  ? <>bạn là <b>{me.name}</b></>
                  : <button type="button" onClick={() => setAskWho(true)} style={{ border: "none", background: "none", color: "#fff", font: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0 }}>chọn bạn là ai</button>}
              </div>
            </div>
            {/* Cuống vé: vạch đứt như đường xé vé — ăn rơ với hóa đơn răng cưa ở tab Tổng kết */}
            <div style={{ borderLeft: "1.5px dashed rgba(255,255,255,.4)", paddingLeft: 12, textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 9.5, letterSpacing: 2, opacity: 0.7, fontWeight: 600 }}>TỔNG CHI</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2, color: "#FFB703", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(totalVND)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            <Tip tone="light" align="start" text="Copy link chuyến đi để gửi vào group chat. Ai có link đều xem và nhập khoản chi được, không cần tài khoản.">
              <button onClick={copyLink}
                style={{ background: copied ? "#fff" : "rgba(255,255,255,.15)", color: copied ? C.tealDark : "#fff", border: "none", borderRadius: 999, padding: "8px 9px", fontSize: 12.5, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                {copied ? "Đã copy" : "Mời bạn"}
              </button>
            </Tip>
            <Tip tone="light" text="Đổi tên chuyến, thêm hoặc sửa tên thành viên, chọn bạn là ai, và chỉnh tỉ giá ngoại tệ.">
              <button onClick={openSettings}
                style={{ background: "rgba(255,255,255,.15)", color: "#fff", border: "none", borderRadius: 999, padding: "8px 9px", fontSize: 12.5, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                Cài đặt
              </button>
            </Tip>
            {/* Lưu chuyến vào tài khoản Google, để mở lại từ trang chủ trên máy khác */}
            <Tip tone="light" align="end" text={saved
              ? "Chuyến này đã nằm trong tài khoản Google của bạn, mở lại được từ trang chủ trên mọi máy. Bấm lần nữa để bỏ lưu."
              : "Đăng nhập Google để lưu chuyến vào tài khoản, rồi mở lại từ trang chủ trên máy khác. Không bắt buộc."}>
              <button onClick={toggleSave}
                style={{ background: saved ? "#fff" : "rgba(255,255,255,.15)", color: saved ? C.tealDark : "#fff", border: "none", borderRadius: 999, padding: "8px 9px", fontSize: 12.5, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                {saved ? "Đã lưu" : "Lưu chuyến đi"}
              </button>
            </Tip>
            <Tip tone="light" align="end" text="Hướng dẫn dùng app: nhập khoản chi, trả nợ, xem ai chuyển cho ai và ý nghĩa từng nút.">
              <button onClick={() => setHelpOpen(true)}
                style={{ background: "rgba(255,255,255,.15)", color: "#fff", border: "none", borderRadius: 999, padding: "8px 9px", fontSize: 12.5, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                Trợ giúp
              </button>
            </Tip>
          </div>
        </div>
      </header>

      {/* ===== TABS ===== */}
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", boxShadow: "0 1px 0 rgba(2,48,71,.08)", background: C.paper, position: "sticky", top: 0, zIndex: 5 }}>
        <Tip align="start" style={{ flex: 1 }} text="Danh sách mọi khoản chi và trả nợ của chuyến. Bấm một khoản để sửa hoặc xóa.">
          <button className={`tabbtn ${tab === "expenses" ? "on" : ""}`} onClick={() => setTab("expenses")}>Sổ chi tiêu ({entries.length})</button>
        </Tip>
        <Tip style={{ flex: 1 }} text="Ai cần chuyển cho ai bao nhiêu, kèm mã QR để quét trả, và chi phí của từng người.">
          <button className={`tabbtn ${tab === "summary" ? "on" : ""}`} onClick={() => { setTab("summary"); load(); }}>Tổng kết</button>
        </Tip>
        <Tip align="end" style={{ flex: 1 }} text="Bảng chi tiết mỗi khoản chia cho từng người, để cả nhóm kiểm tra lại trước khi chuyển tiền.">
          <button className={`tabbtn ${tab === "matrix" ? "on" : ""}`} onClick={() => { setTab("matrix"); load(); }}>Bảng chia</button>
        </Tip>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "18px 16px 110px" }}>

        {/* ============ TAB 1: SỔ CHI TIÊU ============ */}
        {tab === "expenses" && (
          <>
            {showTips && !askWho && (
              <div style={{ background: "#F3F8FB", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.ink, marginBottom: 8 }}>Cách dùng</div>
                {[
                  "Chưa gửi link cho cả nhóm thì bấm Mời bạn ở trên để copy link, rồi dán vào group chat.",
                  "Ai trả tiền gì thì bấm Thêm khoản chi ở cuối màn hình. Mỗi người tự nhập khoản mình đã trả.",
                  "Cuối chuyến, vào tab Tổng kết để xem ai chuyển cho ai. Thêm mã QR ngân hàng của bạn ở đó để người khác quét trả.",
                ].map((t, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "22px 1fr", fontSize: 13.5, lineHeight: 1.5, color: C.text2, marginBottom: 6 }}>
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
                    style={{ border: "none", background: "none", color: C.text2, fontSize: 13.5, padding: "8px 4px", cursor: "pointer" }}>Sửa link</button>
                </>
              )}
              {!editingItin && !trip.itinerary_url && (
                <button onClick={() => { setItinInput(""); setEditingItin(true); }}
                  style={{ border: "none", background: "none", color: C.tealDark, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0 }}>
                  <Plus size={15} weight="bold" aria-hidden="true" style={{ verticalAlign: -2, marginRight: 6 }} />Gắn link lịch trình (Google Sheet, Docs...)
                </button>
              )}
              {editingItin && (
                <>
                  <input className="inp" aria-label="Link lịch trình" placeholder="Dán link lịch trình vào đây" value={itinInput}
                    onChange={(e) => setItinInput(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                  <button onClick={saveItinerary}
                    style={{ background: C.coral, color: C.ink, border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Lưu</button>
                  <button onClick={() => setEditingItin(false)}
                    style={{ border: "none", background: "none", color: C.text2, fontSize: 13.5, padding: "8px 4px", cursor: "pointer" }}>Hủy</button>
                </>
              )}
            </div>

            {entries.length > 0 && (
              <div style={{ fontSize: 12.5, color: C.text2, margin: "0 2px 8px" }}>Bấm vào một khoản để sửa hoặc xóa.</div>
            )}
            {[...entries].reverse().map((e) => {
              const vnd = toVND(e.amount, e.currency, rates);
              const isTransfer = e.type === "transfer";
              const isEditing = e.id === editingId;
              return (
                // Cả hàng là một nút: bấm để đổ khoản này lên form sửa
                <button type="button" key={e.id} className="btn-reset entry" onClick={() => startEdit(e)} aria-current={isEditing || undefined}
                  aria-label={`Sửa ${isTransfer ? `${nameOf(e.payer_id)} trả nợ ${nameOf(e.participant_ids[0])}` : e.name}, ${fmt(vnd)}`}
                  style={{ width: "100%", background: isTransfer ? "#E8F4F9" : "#fff", boxShadow: isEditing ? `0 0 0 2px ${C.coral}` : "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: "12px 12px 12px 14px", marginBottom: 9, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    {isTransfer ? (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 14.5, color: C.purple, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {nameOf(e.payer_id)} <ArrowRight size={14} weight="bold" aria-hidden="true" /> {nameOf(e.participant_ids[0])}
                        </div>
                        <div style={{ fontSize: 12.5, color: C.text2, marginTop: 3 }}>{e.name === "Chuyển tiền" ? "Trả nợ" : e.name}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                          {e.name}
                          {e.prepaid && <span style={{ marginLeft: 8, fontSize: 11, background: C.sand, color: C.ink, padding: "2px 8px", borderRadius: 999, fontWeight: 700, whiteSpace: "nowrap" }}>CHI TRƯỚC</span>}
                        </div>
                        <div style={{ fontSize: 12.5, color: C.text2, marginTop: 3 }}>
                          <b style={{ color: C.tealDark }}>{nameOf(e.payer_id)}</b> trả · chia {e.participant_ids.length === members.length ? "cả nhóm" : e.participant_ids.map(nameOf).join(", ")}
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 800, fontSize: 14.5, fontVariantNumeric: "tabular-nums" }}>{fmt(vnd)}</div>
                      {e.currency !== "VND" && (
                        <div style={{ fontSize: 11.5, color: C.text2 }}>{Number(e.amount).toLocaleString("vi-VN")} {e.currency}</div>
                      )}
                    </div>
                    <CaretRight size={16} color={C.text2} aria-hidden="true" />
                  </div>
                </button>
              );
            })}
            {entries.length === 0 && (
              <div style={{ textAlign: "center", color: C.text2, fontSize: 14, padding: "8px 0" }}>
                Chưa có khoản nào. Bấm Thêm khoản chi ở dưới để nhập khoản đầu tiên.
              </div>
            )}
          </>
        )}

        {/* ============ TAB 2: TỔNG KẾT ============ */}
        {tab === "summary" && (
          <>
            {/* "Phần của bạn": câu trả lời cuối chuyến (chuyển cho ai, bao nhiêu) nằm ngay đầu tab */}
            {(() => {
              const card = { background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 14, padding: 16, display: "grid", gap: 10 };
              const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#F3F8FB", borderRadius: 10, padding: "10px 12px" };
              const bigLabel = { fontSize: 13, color: C.text2 };
              const bigNum = (color) => ({ fontSize: 24, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 });

              if (!me) {
                return (
                  <div style={card}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Bạn là ai trong chuyến này?</div>
                    <div style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.5 }}>Chọn tên để xem bạn cần chuyển hay được nhận lại bao nhiêu.</div>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      {members.map((m) => (
                        <button type="button" key={m.id} className="chip" onClick={() => chooseMe(m.id)}>{m.name}</button>
                      ))}
                    </div>
                  </div>
                );
              }

              const outgoing = transactions.filter((t) => t.fromId === me.id);
              const incoming = transactions.filter((t) => t.toId === me.id);
              const sum = (list) => list.reduce((a, t) => a + t.amount, 0);

              if (outgoing.length > 0) {
                return (
                  <div style={{ ...card, borderTop: `3px solid ${C.coral}` }}>
                    <div>
                      <div style={bigLabel}>Bạn cần chuyển tổng cộng</div>
                      <div style={bigNum(C.orangeText)}>{fmt(sum(outgoing))}</div>
                    </div>
                    {outgoing.map((t) => {
                      const to = memberOf(t.toId);
                      return (
                        <div key={t.toId} style={row}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>
                            cho {t.to}
                            <div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmt(t.amount)}</div>
                          </div>
                          {to?.qr_url ? (
                            <button type="button" onClick={() => setQrView(t.toId)}
                              style={{ background: C.ink, border: "none", color: "#fff", borderRadius: 9, padding: "10px 13px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <Scan size={15} weight="bold" aria-hidden="true" />Quét QR
                            </button>
                          ) : (
                            <span style={{ fontSize: 12.5, color: C.text2, whiteSpace: "nowrap" }}>{t.to} chưa có QR</span>
                          )}
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.5 }}>
                      Trước khi chuyển, kiểm tra tên chủ tài khoản trong app ngân hàng đúng là người nhận.
                    </div>
                  </div>
                );
              }

              if (incoming.length > 0) {
                return (
                  <div style={{ ...card, borderTop: `3px solid ${C.tealText}` }}>
                    <div>
                      <div style={bigLabel}>Bạn được nhận lại tổng cộng</div>
                      <div style={bigNum(C.tealText)}>{fmt(sum(incoming))}</div>
                    </div>
                    {incoming.map((t) => (
                      <div key={t.fromId} style={row}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>từ {t.from}</span>
                        <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmt(t.amount)}</span>
                      </div>
                    ))}
                    {me.qr_url ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: C.text2 }}>
                        <img src={me.qr_url} alt="Mã QR nhận tiền của bạn" onClick={() => setQrView(me.id)}
                          style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", cursor: "pointer", boxShadow: "0 1px 3px rgba(2,48,71,.15)" }} />
                        Mã QR của bạn đã sẵn sàng để mọi người quét.
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.5 }}>
                          Thêm mã QR ngân hàng để người trả quét là chuyển được. Mở app ngân hàng, vào mã QR nhận tiền, chụp màn hình rồi chọn ảnh đó.
                        </div>
                        <label style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6, background: C.ink, color: "#fff", borderRadius: 10, padding: "11px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                          <Plus size={15} weight="bold" aria-hidden="true" />{qrBusyId === me.id ? "Đang tải ảnh..." : "Thêm mã QR"}
                          <input type="file" accept="image/*" className="sr-only"
                            onChange={(ev) => uploadQR(me, ev.target.files[0])} />
                        </label>
                      </>
                    )}
                  </div>
                );
              }

              return (
                <div style={card}>
                  <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                    {entries.length === 0 ? "Chưa có khoản chi nào." : <>Bạn đã cân bằng <Check size={16} weight="bold" color={C.tealText} aria-hidden="true" /></>}
                  </div>
                  <div style={{ fontSize: 13.5, color: C.text2 }}>
                    {entries.length === 0 ? "Nhập khoản chi ở tab Sổ chi tiêu, phần của bạn sẽ hiện ở đây." : "Bạn không cần chuyển hay nhận thêm gì."}
                  </div>
                </div>
              );
            })()}

            <h2 style={sectionHead}>Hóa đơn tất toán</h2>
            <div className="receipt" style={{ padding: "18px 14px 14px" }}>
              {transactions.length === 0 ? (
                <div style={{ textAlign: "center", color: C.text2, fontSize: 14 }}>Cả nhóm đã cân bằng, không ai nợ ai.</div>
              ) : (
                transactions.map((t, i) => {
                  const mineRow = meId && (t.fromId === meId || t.toId === meId);
                  const toMember = memberOf(t.toId);
                  const qrBtn = { gridColumn: 2, gridRow: "1 / span 2", borderRadius: 9, padding: "9px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5, border: "none" };
                  // Tên người trả → người nhận trên một hàng, số tiền bên dưới, nút QR canh phải:
                  // không còn tràn khỏi hóa đơn trên màn hình 375px
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", columnGap: 10, rowGap: 2, alignItems: "center", padding: "10px 8px", margin: "0 -4px", borderRadius: 10, background: mineRow ? "#F3F8FB" : "transparent" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                        <span style={{ color: C.orangeText }}>{t.from}{t.fromId === meId ? " (bạn)" : ""}</span>
                        <ArrowRight size={14} weight="bold" color={C.text2} aria-label="chuyển cho" />
                        <span style={{ color: C.tealText }}>{t.to}{t.toId === meId ? " (bạn)" : ""}</span>
                      </div>
                      {toMember?.qr_url ? (
                        <button type="button" onClick={() => setQrView(t.toId)} style={{ ...qrBtn, background: C.ink, color: "#fff" }}>
                          <Scan size={15} weight="bold" aria-hidden="true" />Quét QR
                        </button>
                      ) : t.toId === meId ? (
                        <label style={{ ...qrBtn, background: "#EDF5FA", color: C.ink }}>
                          <Plus size={14} weight="bold" aria-hidden="true" />{qrBusyId === meId ? "Đang tải..." : "Thêm QR"}
                          <input type="file" accept="image/*" className="sr-only"
                            onChange={(ev) => uploadQR(me, ev.target.files[0])} />
                        </label>
                      ) : (
                        <span style={{ gridColumn: 2, gridRow: "1 / span 2", fontSize: 12.5, color: C.text2, whiteSpace: "nowrap" }}>Chưa có QR</span>
                      )}
                      <div style={{ fontWeight: 800, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{fmt(t.amount)}</div>
                    </div>
                  );
                })
              )}
              {transactions.length > 0 && (
                <div style={{ textAlign: "center", fontSize: 11.5, color: C.text2, marginTop: 12, letterSpacing: 1.5 }}>
                  CHỈ CẦN {transactions.length} LẦN CHUYỂN KHOẢN
                </div>
              )}
            </div>

            {/* Chi phí THẬT mỗi người phải chịu cho chuyến (shareExp) — ai trả hộ cũng không đổi, chuyển tiền không tính */}
            <h2 style={sectionHead}>Chi phí mỗi người</h2>
            <div style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: "14px 16px" }}>
              {[...members].sort((a, b) => detail[b.id].shareExp - detail[a.id].shareExp).map((m) => {
                const cost = detail[m.id].shareExp;
                const maxCost = Math.max(...members.map((x) => detail[x.id].shareExp), 1);
                return (
                  <div key={m.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{m.name}{m.id === meId && <span style={{ fontWeight: 400, color: C.text2 }}> (bạn)</span>}</span>
                      <span style={{ fontWeight: 700 }}>{fmt(cost)}</span>
                    </div>
                    <div style={{ height: 6, background: "#E3EEF5", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(cost / maxCost) * 100}%`, background: C.ink, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11.5, color: C.text2, marginTop: 4 }}>
                Phần chi phí thật mỗi người phải chịu cho chuyến, ai trả hộ cũng không đổi.
              </div>
            </div>

            <h2 style={sectionHead}>Số dư từng người</h2>
            {orderedMembers.map((m) => {
              const b = balances[m.id];
              const pos = b.net >= 0;
              const settled = Math.abs(b.net) < 1;
              return (
                <div key={m.id} style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{m.name}{m.id === meId && <span style={{ fontWeight: 400, fontSize: 13, color: C.text2 }}> (bạn)</span>}</div>
                    <div style={{ fontWeight: 800, color: settled ? C.text2 : pos ? C.tealText : C.orangeText, fontSize: 15, display: "inline-flex", alignItems: "center", gap: 4, fontVariantNumeric: "tabular-nums" }}>
                      {settled ? <>đã cân bằng <Check size={14} weight="bold" aria-hidden="true" /></> : (pos ? "nhận lại " : "trả thêm ") + fmt(Math.abs(b.net))}
                    </div>
                  </div>
                  {/* Tóm tắt 1 dòng: đã chi bao nhiêu trên phần chi phí của mình */}
                  <div style={{ fontSize: 12.5, color: C.text2, marginTop: 3 }}>
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
                        <span style={{ fontSize: 13, color: C.text2 }}>Mã QR nhận tiền. Bấm ảnh để phóng to.</span>
                        <label style={{ fontSize: 13, color: C.ink, fontWeight: 600, cursor: "pointer", marginLeft: "auto", padding: "8px 0" }}>
                          {qrBusyId === m.id ? "Đang tải ảnh..." : "Đổi ảnh"}
                          <input type="file" accept="image/*" className="sr-only"
                            onChange={(ev) => uploadQR(m, ev.target.files[0])} />
                        </label>
                      </>
                    ) : (
                      <label style={{ display: "inline-block", fontSize: 13.5, color: C.ink, fontWeight: 600, background: "#EDF5FA", borderRadius: 10, padding: "10px 14px", cursor: "pointer", whiteSpace: "nowrap" }}>
                        {qrBusyId === m.id ? "Đang tải ảnh..." : m.id === meId ? "Thêm mã QR của bạn" : `Thêm mã QR của ${m.name}`}
                        <input type="file" accept="image/*" className="sr-only"
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

            <h2 style={sectionHead}>Fact thú vị</h2>
            {/* Luật phân cấp: số càng quan trọng nền càng đậm. 4 card = đủ 4 màu Riviera */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
              <div style={{ background: C.coral, color: C.ink, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, opacity: 0.75 }}>Đại gia của chuyến đi 👑</div>
                <div style={{ fontWeight: 800, fontSize: 17, marginTop: 3 }}>{hasTopSpender ? topSpender.name : "—"}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{hasTopSpender ? "ứng trước " + fmt(paidReal[topSpender.id]) : ""}</div>
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
          const subStyle = { fontSize: 11, color: C.text2, fontWeight: 400 };
          const thStyle = {
            padding: "10px 0 6px", fontSize: 12, fontWeight: 700, color: C.ink, background: C.paper,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            ...(scrollMode ? {} : { position: "sticky", top: 40, zIndex: 4 }),
          };
          const nameHeader = (
            <tr>
              <th style={{ ...thStyle, ...stickyLeft, zIndex: 2 }}></th>
              {orderedMembers.map((m) => <th key={m.id} scope="col" style={{ ...thStyle, ...(m.id === meId ? { background: "#E8F4F9", borderRadius: 6 } : {}) }}>{m.name}</th>)}
            </tr>
          );
          const tableStyle = { width: "100%", minWidth: 104 + members.length * 56, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 3 };
          const cols = (
            <colgroup>
              <col style={{ width: 104 }} />
              {orderedMembers.map((m) => <col key={m.id} />)}
            </colgroup>
          );

          const sectionRow = (label) => (
            <tr key={label}>
              <td colSpan={members.length + 1}
                style={{ background: "transparent", padding: "12px 4px 2px", textAlign: "left", fontSize: 11, letterSpacing: 1.5, fontWeight: 700, color: C.text2 }}>
                {/* Nhãn nhóm dính bên trái để không bị cắt khi cuộn ngang */}
                <span style={{ position: "sticky", left: 4, display: "inline-block", maxWidth: "calc(100vw - 48px)" }}>{label}</span>
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
                    <div style={{ ...subStyle, color: C.text2 }}>{Number(e.amount).toLocaleString("vi-VN")} {e.currency}</div>
                  )}
                </td>
                {orderedMembers.map((m) => {
                  const { net, involved } = netOf(e, m);
                  const zero = Math.round(net / 1000) === 0;
                  return (
                    <td key={m.id}
                      style={{ ...numCell, background: involved ? bgFor(net, isT ? "soft" : "normal") : "#fff", color: !involved || zero ? C.text2 : C.ink, fontWeight: involved && !zero ? 700 : 400 }}>
                      {involved ? signedK(net) : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          };

          if (entries.length === 0) {
            return (
              <div style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: 20, textAlign: "center", color: C.text2, fontSize: 14 }}>
                Chưa có khoản nào để tổng hợp.
              </div>
            );
          }

          return (
            <>
              <div style={{ fontSize: 12.5, color: C.text2, background: "#F3F8FB", borderRadius: 10, padding: "10px 12px", marginBottom: 12, lineHeight: 1.5 }}>
                Xem lại trước khi chuyển tiền: có khoản nào thừa hoặc thiếu không, mỗi khoản chia đúng người và đúng số tiền chưa.
                Thấy sai thì bấm tên khoản để sửa.
              </div>

              {/* Nhiều người thì bảng cuộn ngang, mà khung cuộn ngang làm hàng tên hết dính được.
                  Nên vẽ riêng một hàng tên dính dưới thanh tab, cuộn ngang đồng bộ với bảng:
                  cuộn tới đâu vẫn biết cột nào của ai. */}
              {scrollMode && (
                <div ref={matrixHeadRef} aria-hidden="true"
                  style={{ position: "sticky", top: 44, zIndex: 4, overflow: "hidden", background: C.paper, boxShadow: "0 1px 0 rgba(2,48,71,.08)" }}>
                  <table style={tableStyle}>{cols}<thead>{nameHeader}</thead></table>
                </div>
              )}
              <div style={scrollMode ? { overflowX: "auto" } : undefined}
                onScroll={scrollMode ? (ev) => { if (matrixHeadRef.current) matrixHeadRef.current.scrollLeft = ev.currentTarget.scrollLeft; } : undefined}>
                <table style={tableStyle}>
                  {cols}
                  {/* Ở chế độ cuộn, hàng tên thật vẫn nằm đây cho trình đọc màn hình, chỉ ẩn khỏi mắt */}
                  <thead style={scrollMode ? { visibility: "collapse" } : undefined}>{nameHeader}</thead>
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
                          <td key={m.id} style={{ ...numCell, background: bgFor(net, "strong"), color: Math.round(net / 1000) === 0 ? C.text2 : C.ink, fontWeight: 700 }}>
                            {signedK(net)}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: C.text2, marginTop: 12 }}>
                <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, marginRight: 6, background: "rgba(33,158,188,.6)" }}></i>Đã trả, được nhận lại</span>
                <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, marginRight: 6, background: "rgba(251,133,0,.6)" }}></i>Phải trả</span>
                <span>— Không liên quan</span>
                {me && <span>Cột nền xanh nhạt là của bạn</span>}
              </div>
              <div style={{ fontSize: 11.5, color: C.text2, marginTop: 6 }}>
                Số làm tròn đến nghìn đồng. Số chính xác xem ở tab Tổng kết.
              </div>
            </>
          );
        })()}
      </div>

      {/* Nút thêm khoản chi luôn nằm cuối màn hình ở tab Sổ chi tiêu */}
      {tab === "expenses" && !sheetOpen && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, padding: "0 16px calc(14px + env(safe-area-inset-bottom, 0px))", pointerEvents: "none" }}>
          <button type="button" onClick={openAdd}
            style={{ pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", maxWidth: 608, margin: "0 auto", padding: 14, background: C.coral, color: C.ink, border: "none", borderRadius: 14, fontWeight: 800, fontSize: 15, cursor: "pointer", boxShadow: "0 6px 18px rgba(2,48,71,.22)" }}>
            <Plus size={17} weight="bold" aria-hidden="true" />Thêm khoản chi
          </button>
        </div>
      )}

      {/* Tấm nhập / sửa khoản: trượt từ dưới lên, cả form và nút Lưu nằm gọn trong một màn hình */}
      {sheetOpen && (
        <div className="scrim" onClick={closeSheet}
          style={{ position: "fixed", inset: 0, background: "rgba(2,48,71,.45)", zIndex: 60, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}
            style={{ background: editingId ? "#FFF9F2" : "#fff", width: "100%", maxWidth: 640, maxHeight: "92dvh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "8px 16px calc(16px + env(safe-area-inset-bottom, 0px))", boxShadow: "0 -8px 30px rgba(2,48,71,.18)" }}>
            <div style={{ width: 38, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 8px" }} aria-hidden="true" />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
              <h2 id="sheet-title" style={{ flex: 1, fontSize: 17, fontWeight: 800, color: C.ink }}>{editingId ? "Sửa khoản đã nhập" : "Thêm khoản mới"}</h2>
              {editingId && (
                // Xóa nằm trong chế độ sửa: danh sách gọn hơn, xóa vẫn có hộp xác nhận
                <button type="button" onClick={() => setDeleteTarget(entries.find((x) => x.id === editingId))}
                  style={{ border: "none", background: "none", color: C.orangeText, cursor: "pointer", fontSize: 13.5, fontWeight: 700, padding: "8px 6px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Trash size={15} weight="bold" aria-hidden="true" />Xóa
                </button>
              )}
              <button type="button" onClick={closeSheet} aria-label="Đóng"
                style={{ border: "none", background: "#EDF5FA", color: C.ink, cursor: "pointer", borderRadius: 999, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={16} weight="bold" />
              </button>
            </div>
            <div>
              <div role="tablist" aria-label="Loại khoản" style={{ display: "flex", marginBottom: 14 }}>
                <Tip align="start" style={{ flex: 1 }} text="Một khoản tiền tiêu chung, ví dụ ăn uống, khách sạn, vé. Chọn ai trả và chia cho những ai.">
                <button type="button" role="tab" aria-selected={fType === "expense"} className={`typebtn ${fType === "expense" ? "on" : ""}`} style={{ borderRadius: "10px 0 0 10px" }}
                  onClick={() => setFType("expense")}>Khoản chi</button>
                </Tip>
                <Tip align="end" style={{ flex: 1 }} text="Khi một người chuyển tiền lại cho người khác để trả nợ. Không tính vào chi phí chuyến đi.">
                <button type="button" role="tab" aria-selected={fType === "transfer"} className={`typebtn ${fType === "transfer" ? "on" : ""}`} style={{ borderRadius: "0 10px 10px 0" }}
                  onClick={() => setFType("transfer")}>Trả nợ</button>
                </Tip>
              </div>

              {fType === "expense" ? (
                <>
                  <label htmlFor="f-name" style={fieldLabel}>Tên khoản chi</label>
                  <input id="f-name" ref={sheetNameRef} className="inp" placeholder="vd: Ăn trưa ngày 3" value={fName}
                    onChange={(e) => setFName(e.target.value)} style={{ marginBottom: 12 }} />

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) 88px minmax(0,1fr)", gap: 8, marginBottom: 12 }}>
                    <div>
                      <label htmlFor="f-amount" style={fieldLabel}>Số tiền</label>
                      <input id="f-amount" className="inp" type="text" inputMode="decimal" placeholder="0" value={fAmount}
                        onChange={(e) => setFAmount(formatAmountInput(e.target.value, fAmount, e.nativeEvent?.data, fCurrency !== "VND"))} />
                    </div>
                    <div>
                      <label htmlFor="f-currency" style={fieldLabel}>Tiền</label>
                      <select id="f-currency" className="inp" value={fCurrency} onChange={(e) => changeCurrency(e.target.value)}>
                        {currencyList.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="f-payer" style={fieldLabel}>Ai trả</label>
                      <select id="f-payer" className="inp" value={fPayer} onChange={(e) => setFPayer(e.target.value)}>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div id="f-parts-label" style={fieldLabel}>Chia cho ai <span style={{ fontWeight: 400, color: C.text2 }}>· chọn từng người hoặc Cả nhóm</span></div>
                  <div role="group" aria-labelledby="f-parts-label" style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
                    {members.map((m) => {
                      const on = fParts.includes(m.id);
                      return (
                        <button type="button" key={m.id} aria-pressed={on} className={`chip ${on ? "on" : ""}`}
                          onClick={() => setFParts((prev) => prev.includes(m.id) ? prev.filter((p) => p !== m.id) : [...prev, m.id])}>
                          {on && <Check size={13} weight="bold" aria-hidden="true" />}{m.name}
                        </button>
                      );
                    })}
                    {(() => {
                      const allOn = allIds.length > 0 && fParts.length === allIds.length;
                      return (
                        <button type="button" aria-pressed={allOn} className={`chip ${allOn ? "on" : ""}`}
                          onClick={() => setFParts(allOn ? [] : allIds)}>
                          {allOn && <Check size={13} weight="bold" aria-hidden="true" />}Cả nhóm
                        </button>
                      );
                    })()}
                  </div>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, marginBottom: 14, cursor: "pointer", lineHeight: 1.45 }}>
                    <input type="checkbox" checked={fPrepaid} onChange={(e) => setFPrepaid(e.target.checked)}
                      style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0, accentColor: C.ink }} />
                    <span>
                      Chi trước chuyến đi (đặt cọc, mua vé trước)
                      <br /><span style={{ fontSize: 12, color: C.text2 }}>Chỉ để gắn nhãn và gom riêng ở tab Tổng kết, không đổi cách chia tiền.</span>
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 8, alignItems: "end", marginBottom: 12 }}>
                    <div>
                      <label htmlFor="t-from" style={fieldLabel}>Người trả</label>
                      <select id="t-from" className="inp" value={fPayer} onChange={(e) => setFPayer(e.target.value)}>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <ArrowRight size={18} color={C.text2} aria-hidden="true" style={{ marginBottom: 11 }} />
                    <div>
                      <label htmlFor="t-to" style={fieldLabel}>Người nhận</label>
                      <select id="t-to" className="inp" value={fReceiver} onChange={(e) => setFReceiver(e.target.value)}>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 88px", gap: 8, marginBottom: 12 }}>
                    <div>
                      <label htmlFor="t-amount" style={fieldLabel}>Số tiền</label>
                      <input id="t-amount" className="inp" type="text" inputMode="decimal" placeholder="0" value={fAmount}
                        onChange={(e) => setFAmount(formatAmountInput(e.target.value, fAmount, e.nativeEvent?.data, fCurrency !== "VND"))} />
                    </div>
                    <div>
                      <label htmlFor="t-currency" style={fieldLabel}>Tiền</label>
                      <select id="t-currency" className="inp" value={fCurrency} onChange={(e) => changeCurrency(e.target.value)}>
                        {currencyList.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <label htmlFor="t-note" style={fieldLabel}>Ghi chú <span style={{ fontWeight: 400, color: C.text2 }}>(không bắt buộc)</span></label>
                  <input id="t-note" className="inp" placeholder="vd: Duyên trả lại tiền ăn tối" value={fName}
                    onChange={(e) => setFName(e.target.value)} style={{ marginBottom: 14 }} />
                  <div style={{ fontSize: 12, color: C.text2, background: "#F3F8FB", borderRadius: 10, padding: "8px 12px", marginBottom: 14, lineHeight: 1.5 }}>
                    Dùng khi A đưa tiền lại cho B để trả nợ. Khoản này không tính vào chi phí.
                    Nếu A trả hộ một khoản chi cho B (vd tiền homestay), nhập ở tab Khoản chi: A trả, chia cho B.
                  </div>
                </>
              )}

              {formError && (
                <div role="alert" style={{ fontSize: 13, color: C.ink, background: "#FFF3D6", borderRadius: 10, padding: "9px 12px", marginBottom: 10 }}>{formError}</div>
              )}
              <button type="button" onClick={addEntry} disabled={busy}
                style={{ width: "100%", padding: 12, background: busy ? "#c4ccd0" : (fType === "expense" ? C.coral : C.purple), color: fType === "expense" || busy ? C.ink : "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: busy ? "wait" : "pointer" }}>
                {busy ? "Đang lưu..." : editingId ? "Cập nhật khoản này" : (fType === "expense" ? "Lưu khoản chi" : "Ghi nhận trả nợ")}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Modal Trợ giúp: hướng dẫn đầy đủ, mở từ nút Trợ giúp trên header */}
      {helpOpen && (() => {
        const steps = [
          { title: "Mời cả nhóm", items: [
            "Bấm Mời bạn để copy link chuyến đi, rồi dán vào group chat (Zalo, Messenger...).",
            "Ai có link đều xem và nhập được, không cần tạo tài khoản.",
            "Lần đầu mở link, chọn tên của bạn. App sẽ điền sẵn bạn là người trả và đưa phần của bạn lên đầu. Đổi lại được trong Cài đặt.",
          ] },
          { title: "Nhập khoản chi", items: [
            "Bấm Thêm khoản chi ở cuối màn hình. Mỗi người tự nhập khoản mình đã trả.",
            "Điền tên khoản, số tiền, ai trả. Mặc định chia đều cho cả nhóm, bấm vào tên để bỏ người không tham gia.",
            "Trả bằng ngoại tệ? Chọn loại tiền ở ô Tiền. Thêm tiền tệ và tỉ giá trong Cài đặt.",
            "Đánh dấu Chi trước chuyến đi cho tiền cọc, vé mua trước. Chỉ để gom riêng, không đổi cách chia.",
            "Nhập sai? Bấm vào khoản đó trong Sổ chi tiêu để sửa hoặc xóa.",
          ] },
          { title: "Trả nợ giữa các thành viên", items: [
            "Khi A chuyển tiền lại cho B, mở Thêm khoản chi, chọn Trả nợ, chọn người trả và người nhận.",
            "Trả nợ không tính vào chi phí chuyến đi, chỉ làm số dư của hai người thay đổi.",
            "Nếu A trả hộ một khoản cho B (vd tiền phòng), hãy nhập là Khoản chi: A trả, chia cho B.",
          ] },
          { title: "Cuối chuyến", items: [
            "Mở Tổng kết. Ngay trên cùng là phần của bạn: cần chuyển cho ai bao nhiêu, hoặc được nhận lại bao nhiêu.",
            "Người được nhận tiền nên thêm mã QR ngân hàng (chụp màn hình mã QR nhận tiền trong app ngân hàng).",
            "Người trả bấm Quét QR để chuyển. Luôn kiểm tra tên chủ tài khoản trong app ngân hàng trước khi chuyển.",
            "Muốn kiểm tra kỹ từng khoản? Mở Bảng chia để xem mỗi khoản chia cho từng người bao nhiêu.",
          ] },
        ];
        const buttons = [
          ["Mời bạn", "Copy link chuyến đi để gửi cho cả nhóm."],
          ["Cài đặt", "Đổi tên chuyến, thêm hoặc sửa tên thành viên, chọn bạn là ai, tỉ giá ngoại tệ."],
          ["Lưu chuyến đi", "Không bắt buộc. Đăng nhập Google để mở lại chuyến từ trang chủ trên máy khác. Trên máy này, trang chủ đã tự nhớ các chuyến bạn mở gần đây."],
        ];
        return (
          <div onClick={() => setHelpOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(2,48,71,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, cursor: "pointer", padding: 16 }}>
            <div role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}
              style={{ background: "#fff", borderRadius: 18, padding: 22, maxWidth: 480, width: "100%", maxHeight: "85dvh", overflowY: "auto", cursor: "default" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <h2 id="help-title" style={{ fontWeight: 800, fontSize: 18, color: C.ink }}>Hướng dẫn dùng TripSplit</h2>
                <button onClick={() => setHelpOpen(false)} aria-label="Đóng hướng dẫn"
                  style={{ border: "none", background: "none", color: C.text2, cursor: "pointer", padding: 6, margin: -6, display: "flex" }}><X size={20} weight="bold" /></button>
              </div>
              <p style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.5, marginBottom: 6 }}>
                Cả nhóm cùng nhập khoản chi qua một link chung. Cuối chuyến, app tính ai chuyển cho ai bao nhiêu, với ít lần chuyển khoản nhất.
              </p>

              {steps.map((sec, si) => (
                <section key={sec.title} style={{ marginTop: 18 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: C.ink, display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 999, background: C.coral, color: C.ink, fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{si + 1}</span>
                    {sec.title}
                  </h3>
                  <ul style={{ listStyle: "none", display: "grid", gap: 6, paddingLeft: 30 }}>
                    {sec.items.map((t) => (
                      <li key={t} style={{ fontSize: 13.5, lineHeight: 1.5, color: C.ink, position: "relative" }}>
                        <span aria-hidden="true" style={{ position: "absolute", left: -14, top: 8, width: 5, height: 5, borderRadius: 9, background: C.text2 }} />
                        {t}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              <section style={{ marginTop: 20, background: "#F3F8FB", borderRadius: 12, padding: "12px 14px" }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Các nút trên cùng</h3>
                <dl style={{ display: "grid", gap: 8 }}>
                  {buttons.map(([name, desc]) => (
                    <div key={name}>
                      <dt style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{name}</dt>
                      <dd style={{ fontSize: 13, color: C.text2, lineHeight: 1.5 }}>{desc}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <button onClick={() => setHelpOpen(false)}
                style={{ marginTop: 18, width: "100%", padding: 12, background: C.coral, color: C.ink, border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                Đã hiểu
              </button>
            </div>
          </div>
        );
      })()}

      {/* Modal Cài đặt: gộp sửa tên chuyến, quản lý thành viên, và tỉ giá vào một chỗ */}
      {settingsOpen && (
        <div onClick={closeSettings}
          style={{ position: "fixed", inset: 0, background: "rgba(2,48,71,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, cursor: "pointer", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 18, padding: 22, maxWidth: 440, width: "100%", maxHeight: "85vh", overflowY: "auto", cursor: "default" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontWeight: 800, fontSize: 18, color: C.ink }}>Cài đặt chuyến đi</div>
              <button onClick={closeSettings}
                aria-label="Đóng cài đặt" style={{ border: "none", background: "none", color: C.text2, cursor: "pointer", padding: 6, margin: -6, display: "flex" }}><X size={20} weight="bold" /></button>
            </div>

            {/* --- Bạn là ai --- */}
            <h3 style={settingsHead}>Bạn là ai</h3>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 6 }}>
              {members.map((m) => (
                <button type="button" key={m.id} aria-pressed={m.id === meId} className={`chip ${m.id === meId ? "on" : ""}`} onClick={() => chooseMe(m.id)}>{m.name}</button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: C.text2, marginBottom: 24 }}>
              Chỉ nhớ trên máy này. App dùng để điền sẵn người trả và đưa phần của bạn lên đầu.
            </div>

            {/* --- Tên chuyến đi --- */}
            <h3 style={settingsHead}>Tên chuyến đi</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              <input className="inp" aria-label="Tên chuyến đi" value={tripNameInput} onChange={(e) => setTripNameInput(e.target.value)} style={{ flex: 1 }} />
              <button onClick={saveTripName}
                style={{ background: tripNameSaved ? C.tealText : C.coral, color: tripNameSaved ? "#fff" : C.ink, border: "none", borderRadius: 10, padding: "0 18px", fontWeight: 700, cursor: "pointer", fontSize: 13.5 }}>
                {tripNameSaved ? "Đã lưu" : "Lưu"}
              </button>
            </div>

            {/* --- Thành viên --- */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ ...settingsHead, marginBottom: 0 }}>Thành viên</h3>
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
                    style={{ border: "none", background: "none", color: C.text2, fontSize: 13.5, fontWeight: 600, padding: "8px 0", cursor: "pointer" }}>
                    Sửa tên
                  </button>
                </div>
              ))}
            </div>

            {/* --- Tỉ giá --- */}
            <h3 style={settingsHead}>Tỉ giá quy đổi ra VND</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
              {currencyList.filter((c) => c !== "VND").map((cur) => (
                <div key={cur} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                  <span style={{ width: 46, flexShrink: 0 }}>1 {cur} =</span>
                  <input type="number" inputMode="decimal" aria-label={`Tỉ giá 1 ${cur} ra VND`} value={ratesDraft?.[cur] ?? rates[cur]}
                    onChange={(e) => setRatesDraft({ ...ratesDraft, [cur]: e.target.value })}
                    className="inp" style={{ flex: 1 }} />
                  <span>₫</span>
                </div>
              ))}
              {ratesDraft && (
                <button onClick={() => saveRates({ ...rates, ...ratesDraft }).then((ok) => { if (ok) setRatesDraft(null); })}
                  style={{ background: C.tealText, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12.5, alignSelf: "flex-start" }}>
                  Lưu tỉ giá
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input placeholder="Mã (vd JPY)" aria-label="Mã tiền tệ mới" value={newCur} onChange={(e) => setNewCur(e.target.value)} className="inp" style={{ flex: 1, minWidth: 90 }} />
              <input type="number" placeholder="Tỉ giá ra VND" aria-label="Tỉ giá tiền tệ mới ra VND" value={newRate} onChange={(e) => setNewRate(e.target.value)} className="inp" style={{ flex: 1, minWidth: 100 }} />
              <button onClick={addCurrency}
                style={{ background: C.coral, color: C.ink, border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Plus size={14} weight="bold" aria-hidden="true" />Thêm
              </button>
            </div>
            {curError && <div style={{ fontSize: 13, color: C.ink, background: "#FFF3D6", borderRadius: 10, padding: "8px 12px", marginTop: 8 }}>{curError}</div>}
            <div style={{ fontSize: 11.5, color: C.text2, marginTop: 10 }}>
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
                style={{ flex: 1, background: memberBusy ? "#c4ccd0" : C.coral, border: "none", color: C.ink, borderRadius: 10, padding: "10px 0", fontWeight: 700, cursor: memberBusy ? "wait" : "pointer", fontSize: 14 }}>
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
            <div style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.5, marginBottom: 14 }}>
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
                style={{ border: "none", background: "none", color: C.text2, fontSize: 13.5, fontWeight: 600, padding: "10px 0", cursor: "pointer" }}>
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
            <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.5, marginBottom: 16 }}>
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
            <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.5, marginBottom: 16 }}>
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
            {/* Ai có link cũng đổi được ảnh QR, nên nhắc người chuyển tự kiểm tra tên chủ tài khoản */}
            <div style={{ fontSize: 13, color: C.ink, background: "#FFF3D6", borderRadius: 10, padding: "9px 12px", marginTop: 12, lineHeight: 1.45, textAlign: "left" }}>
              Trước khi chuyển, kiểm tra tên chủ tài khoản trong app ngân hàng đúng là {nameOf(qrView)}.
            </div>
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
