"use client";

import { useEffect, useState, useCallback } from "react";
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

// Định dạng số đang gõ: 2800000 -> "2,800,000" (cho phép 1 dấu chấm thập phân)
function formatAmountInput(raw) {
  let s = String(raw).replace(/,/g, "").replace(/[^0-9.]/g, "");
  const parts = s.split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.length > 1 ? intPart + "." + parts.slice(1).join("") : intPart;
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
  green: "#1E8E5A",    // tiền nhận lại (luật ngữ nghĩa giữ nguyên)
  red: "#D1453B",      // tiền phải trả
  purple: "#126782",   // xanh biển đậm - màu của chuyển tiền
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
  const [showRates, setShowRates] = useState(false);
  const [ratesDirty, setRatesDirty] = useState(false); // tỉ giá sửa rồi nhưng chưa lưu
  const [copied, setCopied] = useState(false);
  const [session, setSession] = useState(null); // đăng nhập hay chưa
  const [saved, setSaved] = useState(false);    // chuyến này đã lưu vào tài khoản chưa
  const [qrView, setQrView] = useState(null); // member id đang xem QR phóng to

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

  // Khi danh sách thành viên về tới nơi → điền mặc định cho form
  useEffect(() => {
    if (members.length > 0 && !fPayer) {
      setFPayer(members[0].id);
      setFReceiver(members[1]?.id || members[0].id);
      setFParts(members.map((m) => m.id));
    }
  }, [members, fPayer]);

  const nameOf = (id) => members.find((m) => m.id === id)?.name || "?";
  const memberOf = (id) => members.find((m) => m.id === id);

  const balances = computeBalances(entries, members, rates);
  const transactions = settleDebts(balances, nameOf);

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
    if (!amount || amount <= 0) return;

    let payload;
    if (fType === "transfer") {
      if (fPayer === fReceiver) return;
      payload = {
        p_type: "transfer",
        p_name: fName.trim() || "Chuyển tiền",
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
    if (error) { alert("Lưu bị lỗi: " + error.message); return; }

    setEditingId(null);
    setFName(""); setFAmount(""); setFPrepaid(false);
    setFParts(members.map((m) => m.id));
    load();
  }

  // Bấm "Sửa" trên 1 khoản: đổ dữ liệu khoản đó ngược vào form
  function startEdit(e) {
    setEditingId(e.id);
    setFType(e.type);
    setFName(e.type === "transfer" && e.name === "Chuyển tiền" ? "" : e.name);
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
    setFParts(members.map((m) => m.id));
  }

  // Đổi tên thành viên qua hộp thoại nhập nhanh
  async function renameMember(m) {
    const newName = prompt(`Sửa tên cho "${m.name}":`, m.name);
    if (!newName || !newName.trim() || newName.trim() === m.name) return;
    const { error } = await supabase.rpc("rename_member", {
      p_code: code, p_member_id: m.id, p_name: newName.trim(),
    });
    if (error) { alert("Đổi tên bị lỗi: " + error.message); return; }
    load();
  }

  async function removeEntry(id) {
    if (!confirm("Xóa khoản này?")) return;
    const { error } = await supabase.rpc("delete_entry", { p_code: code, p_entry_id: id });
    if (error) { alert("Xóa bị lỗi: " + error.message); return; }
    load();
  }

  async function saveRates(next) {
    const { error } = await supabase.rpc("update_rates", { p_code: code, p_rates: next });
    if (error) { alert("Lưu tỉ giá bị lỗi: " + error.message); return; }
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
    setBusy(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${trip.id}/${member.id}-${Date.now()}.${ext}`; // tên file ngẫu nhiên, không ai đoán được

    const { error: upErr } = await supabase.storage.from("qr-codes").upload(path, file);
    if (upErr) { setBusy(false); alert("Up ảnh bị lỗi: " + upErr.message); return; }

    const { data: pub } = supabase.storage.from("qr-codes").getPublicUrl(path);
    const { error } = await supabase.rpc("set_member_qr", {
      p_code: code, p_member_id: member.id, p_qr_url: pub.publicUrl,
    });
    setBusy(false);
    if (error) { alert("Gắn QR bị lỗi: " + error.message); return; }
    load();
  }

  // Lưu / bỏ lưu chuyến. Chưa đăng nhập mà bấm Lưu -> ghi nhớ ý định
  // vào bộ nhớ trình duyệt rồi đưa đi đăng nhập, quay về sẽ tự lưu nốt.
  async function toggleSave() {
    if (!session) {
      localStorage.setItem("tripsplit_pending_save", code);
      supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href }, // đăng nhập xong quay về ĐÚNG trang chuyến này
      });
      return;
    }
    const fn = saved ? "unsave_trip" : "save_trip_to_account";
    const { error } = await supabase.rpc(fn, { p_code: code });
    if (error) { alert("Thao tác lưu bị lỗi: " + error.message); return; }
    setSaved(!saved);
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ---- Màn hình chờ / lỗi ----
  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#7d8a90", background: C.paper }}>Đang tải chuyến đi...</div>;
  }
  if (notFound) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, padding: 20 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 40 }}>🧭</div>
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
        .chip { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; border:1.5px solid ${C.line}; background:#fff; cursor:pointer; font-size:13px; user-select:none; transition: all .15s; }
        .chip.on { background:${C.teal}; border-color:${C.teal}; color:#fff; }
        .inp { width:100%; padding:10px 12px; border:1.5px solid ${C.line}; border-radius:10px; background:#fff; font-size:14px; outline:none; }
        .inp:focus { border-color:${C.teal}; }
        .receipt { background:#fff; border-radius:14px; position:relative; box-shadow:0 2px 10px rgba(27,42,51,.07); }
        .receipt:before { content:""; position:absolute; top:-7px; left:0; right:0; height:14px;
          background:radial-gradient(circle at 8px 0px, transparent 7px, #fff 7.5px); background-size:18px 14px; }
        .tabbtn { flex:1; padding:11px 0; border:none; background:transparent; font-size:14px; font-weight:600; cursor:pointer; border-bottom:3px solid transparent; color:#7d8a90; }
        .tabbtn.on { color:${C.tealDark}; border-bottom-color:${C.coral}; }
        .typebtn { flex:1; padding:9px 0; border:1.5px solid ${C.line}; background:#fff; font-size:13.5px; font-weight:600; cursor:pointer; color:#7d8a90; }
        .typebtn.on { background:${C.ink}; border-color:${C.ink}; color:#fff; }
      `}</style>

      {/* ===== HEADER ===== */}
      <div style={{ background: C.tealDark, color: "#fff", padding: "14px 20px 20px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {/* Logo TripSplit — bấm vào về trang chủ (quy ước chung của mọi website) */}
          <a href="/" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, textDecoration: "none", color: "#fff", marginBottom: 18 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#FFB703" style={{ transform: "rotate(45deg)" }}>
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: 1.5 }}>TripSplit</span>
          </a>

          <div style={{ fontSize: 11, letterSpacing: 2.5, opacity: 0.75, fontWeight: 600 }}>CHUYẾN ĐI</div>
          {/* Icon máy bay SVG: fill="currentColor" = tự ăn theo màu chữ (trắng trên nền teal) */}
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, transform: "rotate(45deg)" }}>
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
            <span>{trip.name}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              {members.map((m) => m.name).join(" · ")} — tổng chi <b>{fmt(totalVND)}</b>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={toggleSave}
                style={{ background: saved ? "#fff" : "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.35)", color: saved ? C.tealDark : "#fff", borderRadius: 999, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                {saved ? "✓ Đã lưu" : "☆ Lưu chuyến"}
              </button>
              <button onClick={copyLink}
                style={{ background: copied ? "#fff" : "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.35)", color: copied ? C.tealDark : "#fff", borderRadius: 999, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                {copied ? "✓ Đã copy" : "🔗 Mời bạn nhập chung"}
              </button>
              <button onClick={() => setShowRates(!showRates)}
                style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.35)", color: "#fff", borderRadius: 999, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}>
                Tỉ giá chốt {showRates ? "▲" : "▼"}
              </button>
            </div>
          </div>

          {showRates && (
            <div style={{ marginTop: 12, background: "rgba(255,255,255,.12)", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                {currencyList.filter((c) => c !== "VND").map((cur) => (
                  <label key={cur} style={{ fontSize: 13 }}>
                    1 {cur} =
                    <input type="number" value={rates[cur]}
                      onChange={(e) => { setRates({ ...rates, [cur]: parseFloat(e.target.value) || 0 }); setRatesDirty(true); }}
                      style={{ width: 90, margin: "0 6px", padding: "4px 8px", borderRadius: 8, border: "none", color: "#1B2A33", background: "#fff" }} />
                    ₫
                  </label>
                ))}
                {ratesDirty && (
                  <button onClick={() => saveRates(rates)}
                    style={{ background: "#fff", color: C.tealDark, border: "none", borderRadius: 8, padding: "5px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12.5 }}>
                    Lưu tỉ giá
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input placeholder="Mã (vd JPY)" value={newCur} onChange={(e) => setNewCur(e.target.value)}
                  style={{ width: 100, padding: "6px 10px", borderRadius: 8, border: "none", fontSize: 13, color: "#1B2A33", background: "#fff" }} />
                <input type="number" placeholder="Tỉ giá ra VND" value={newRate} onChange={(e) => setNewRate(e.target.value)}
                  style={{ width: 120, padding: "6px 10px", borderRadius: 8, border: "none", fontSize: 13, color: "#1B2A33", background: "#fff" }} />
                <button onClick={addCurrency}
                  style={{ background: C.coral, color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                  ＋ Thêm tiền tệ
                </button>
              </div>
              {curError && <div style={{ fontSize: 12, color: "#FFD9CC", marginTop: 8 }}>⚠ {curError}</div>}
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 10 }}>
                Tỉ giá chốt 1 lần cho cả chuyến — đổi xong nhớ bấm Lưu để cả nhóm cùng thấy.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== TABS ===== */}
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", borderBottom: `1.5px solid ${C.line}`, background: C.paper, position: "sticky", top: 0, zIndex: 5 }}>
        <button className={`tabbtn ${tab === "expenses" ? "on" : ""}`} onClick={() => setTab("expenses")}>Sổ chi tiêu ({entries.length})</button>
        <button className={`tabbtn ${tab === "summary" ? "on" : ""}`} onClick={() => { setTab("summary"); load(); }}>Tổng kết</button>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "18px 16px 60px" }}>

        {/* ============ TAB 1: SỔ CHI TIÊU ============ */}
        {tab === "expenses" && (
          <>
            <div style={{ background: "#fff", border: `1.5px solid ${editingId ? C.coral : C.line}`, borderRadius: 14, padding: 16, marginBottom: 22 }}>
              {editingId && (
                <div style={{ background: "#FFF3D6", color: "#946C2F", borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  ✏️ Đang sửa khoản đã nhập
                  <button onClick={cancelEdit} style={{ border: "none", background: "none", color: "#946C2F", cursor: "pointer", fontSize: 12.5, textDecoration: "underline" }}>Hủy</button>
                </div>
              )}
              <div style={{ display: "flex", marginBottom: 14, borderRadius: 10, overflow: "hidden" }}>
                <button className={`typebtn ${fType === "expense" ? "on" : ""}`} style={{ borderRadius: "10px 0 0 10px" }}
                  onClick={() => setFType("expense")}>🧾 Khoản chi</button>
                <button className={`typebtn ${fType === "transfer" ? "on" : ""}`} style={{ borderRadius: "0 10px 10px 0", borderLeft: "none" }}
                  onClick={() => setFType("transfer")}>💸 Chuyển tiền</button>
              </div>

              {fType === "expense" ? (
                <>
                  <input className="inp" placeholder="Tên khoản chi (vd: Ăn trưa ngày 3)" value={fName}
                    onChange={(e) => setFName(e.target.value)} style={{ marginBottom: 10 }} />

                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <input className="inp" type="text" inputMode="decimal" placeholder="Số tiền" value={fAmount}
                      onChange={(e) => setFAmount(formatAmountInput(e.target.value))} style={{ flex: 2 }} />
                    <select className="inp" value={fCurrency} onChange={(e) => setFCurrency(e.target.value)} style={{ flex: 1 }}>
                      {currencyList.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select className="inp" value={fPayer} onChange={(e) => setFPayer(e.target.value)} style={{ flex: 1.4 }}>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name} trả</option>)}
                    </select>
                  </div>

                  <div style={{ fontSize: 12.5, color: "#7d8a90", marginBottom: 6 }}>Chia cho ai?</div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
                    {members.map((m) => (
                      <span key={m.id} className={`chip ${fParts.includes(m.id) ? "on" : ""}`}
                        onClick={() => setFParts((prev) => prev.includes(m.id) ? prev.filter((p) => p !== m.id) : [...prev, m.id])}>
                        {fParts.includes(m.id) ? "✓ " : ""}{m.name}
                      </span>
                    ))}
                    <span className="chip" style={{ borderStyle: "dashed" }} onClick={() => setFParts(allIds)}>Cả nhóm</span>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, marginBottom: 14, cursor: "pointer" }}>
                    <input type="checkbox" checked={fPrepaid} onChange={(e) => setFPrepaid(e.target.checked)} />
                    Khoản đặt cọc / mua trước chuyến đi
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
                      onChange={(e) => setFAmount(formatAmountInput(e.target.value))} style={{ flex: 2 }} />
                    <select className="inp" value={fCurrency} onChange={(e) => setFCurrency(e.target.value)} style={{ flex: 1 }}>
                      {currencyList.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <input className="inp" placeholder="Ghi chú (vd: chuyển trước tiền cọc)" value={fName}
                    onChange={(e) => setFName(e.target.value)} style={{ marginBottom: 14 }} />
                  {fPayer === fReceiver && (
                    <div style={{ fontSize: 12.5, color: C.red, marginBottom: 10 }}>⚠ Người chuyển và người nhận phải khác nhau</div>
                  )}
                </>
              )}

              <button onClick={addEntry} disabled={busy}
                style={{ width: "100%", padding: 12, background: busy ? "#c4ccd0" : (fType === "expense" ? C.coral : C.purple), color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: busy ? "wait" : "pointer" }}>
                {busy ? "Đang lưu..." : editingId ? "Cập nhật khoản này" : (fType === "expense" ? "Lưu khoản chi" : "Ghi nhận chuyển tiền")}
              </button>
            </div>

            {[...entries].reverse().map((e) => {
              const vnd = toVND(e.amount, e.currency, rates);
              const isTransfer = e.type === "transfer";
              return (
                <div key={e.id} style={{ background: isTransfer ? "#E8F4F9" : "#fff", border: `1.5px solid ${isTransfer ? "#C9E2EE" : C.line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 9, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    {isTransfer ? (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 14.5, color: C.purple }}>
                          💸 {nameOf(e.payer_id)} ──→ {nameOf(e.participant_ids[0])}
                        </div>
                        <div style={{ fontSize: 12.5, color: "#7d8a90", marginTop: 3 }}>{e.name}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                          {e.name}
                          {e.prepaid && <span style={{ marginLeft: 8, fontSize: 10.5, background: C.sand, color: "#8a6d3b", padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>TRẢ TRƯỚC</span>}
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
                    <div style={{ marginTop: 2 }}>
                      <button onClick={() => startEdit(e)} style={{ border: "none", background: "none", color: "#023047", fontSize: 11.5, cursor: "pointer", fontWeight: 600 }}>Sửa</button>
                      <span style={{ color: "#dde3e6", fontSize: 11 }}> · </span>
                      <button onClick={() => removeEntry(e.id)} style={{ border: "none", background: "none", color: "#c4ccd0", fontSize: 11.5, cursor: "pointer" }}>Xóa</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ============ TAB 2: TỔNG KẾT ============ */}
        {tab === "summary" && (
          <>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#9aa6ab", fontWeight: 700, marginBottom: 10 }}>SỐ DƯ TỪNG NGƯỜI</div>
            {members.map((m) => {
              const b = balances[m.id];
              const pos = b.net >= 0;
              const settled = Math.abs(b.net) < 1;
              return (
                <div key={m.id} style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                      {m.name}
                      <button onClick={() => renameMember(m)} title="Sửa tên"
                        style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, color: "#b5bec2", padding: 0 }}>✏️</button>
                    </div>
                    <div style={{ fontWeight: 800, color: settled ? "#9aa6ab" : pos ? C.green : C.red, fontSize: 15 }}>
                      {settled ? "đã cân bằng ✓" : (pos ? "nhận lại " : "trả thêm ") + fmt(Math.abs(b.net))}
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#7d8a90", marginTop: 3 }}>
                    Đã ứng/chuyển {fmt(b.paid)} · phần phải chịu {fmt(b.share)}
                  </div>
                  <div style={{ height: 6, background: "#E3EEF5", borderRadius: 99, marginTop: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, (b.paid / Math.max(b.share, 1)) * 100)}%`, background: pos ? C.green : C.red, borderRadius: 99 }} />
                  </div>
                  {/* QR nhận tiền */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                    {m.qr_url ? (
                      <>
                        <img src={m.qr_url} alt={`QR của ${m.name}`} onClick={() => setQrView(m.id)}
                          style={{ width: 38, height: 38, borderRadius: 6, border: `1.5px solid ${C.line}`, cursor: "pointer", objectFit: "cover" }} />
                        <span style={{ fontSize: 12, color: "#7d8a90" }}>QR nhận tiền · bấm để phóng to</span>
                        <label style={{ fontSize: 12, color: C.tealDark, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>
                          Đổi ảnh
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={(ev) => uploadQR(m, ev.target.files[0])} />
                        </label>
                      </>
                    ) : (
                      <label style={{ fontSize: 12.5, color: C.tealDark, fontWeight: 600, cursor: "pointer" }}>
                        ＋ Thêm QR nhận tiền
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
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "#8a6d3b" }}>Phát sinh trước chuyến đi</div>
                  <div style={{ fontSize: 12, color: "#a08a5f" }}>{prepaidList.length} khoản đặt cọc / mua trước · chiếm {Math.round((prepaidTotal / Math.max(totalVND, 1)) * 100)}% tổng chi</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#8a6d3b" }}>{fmt(prepaidTotal)}</div>
              </div>
            )}

            <div style={{ fontSize: 11, letterSpacing: 2, color: "#9aa6ab", fontWeight: 700, margin: "24px 0 10px" }}>HÓA ĐƠN TẤT TOÁN</div>
            <div className="receipt" style={{ padding: "20px 18px 16px" }}>
              {transactions.length === 0 ? (
                <div style={{ textAlign: "center", color: "#7d8a90", fontSize: 14 }}>Cả nhóm đã cân bằng, không ai nợ ai 🎉</div>
              ) : (
                transactions.map((t, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < transactions.length - 1 ? `1.5px dashed ${C.line}` : "none" }}>
                    <div style={{ fontSize: 14.5 }}>
                      <b style={{ color: C.red }}>{t.from}</b>
                      <span style={{ color: "#9aa6ab", margin: "0 8px" }}>──→</span>
                      <b style={{ color: C.green }}>{t.to}</b>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{fmt(t.amount)}</div>
                      {memberOf(t.toId)?.qr_url && (
                        <button onClick={() => setQrView(t.toId)}
                          style={{ border: `1.5px solid ${C.teal}`, background: "#fff", color: C.tealDark, borderRadius: 8, padding: "3px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                          QR
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div style={{ textAlign: "center", fontSize: 11.5, color: "#b5bec2", marginTop: 14, letterSpacing: 1.5 }}>
                {transactions.length > 0 ? `CHỈ CẦN ${transactions.length} LẦN CHUYỂN KHOẢN · ` : ""}CẢM ƠN VÀ HẸN GẶP LẠI ✦
              </div>
            </div>

            <div style={{ fontSize: 11, letterSpacing: 2, color: "#9aa6ab", fontWeight: 700, margin: "24px 0 10px" }}>FACT THÚ VỊ</div>
            {/* Luật phân cấp: số càng quan trọng nền càng đậm. 4 card = đủ 4 màu Riviera */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
              <div style={{ background: C.coral, color: C.ink, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, opacity: 0.75 }}>Đại gia của chuyến đi 👑</div>
                <div style={{ fontWeight: 800, fontSize: 17, marginTop: 3 }}>{topSpender?.name || "—"}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{topSpender ? "ứng trước " + fmt(paidReal[topSpender.id]) : ""}</div>
              </div>
              <div style={{ background: "#FFB703", color: "#6B4D00", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, opacity: 0.85 }}>Khoản chi khủng nhất 💸</div>
                <div style={{ fontWeight: 800, fontSize: 14.5, marginTop: 3, color: C.ink }}>{biggestExpense?.name || "—"}</div>
                <div style={{ fontSize: 12 }}>{biggestExpense ? fmt(toVND(biggestExpense.amount, biggestExpense.currency, rates)) : ""}</div>
              </div>
              <div style={{ background: "#8ECAE6", color: "#0F5570", borderRadius: 12, padding: 14 }}>
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
      </div>

      {/* Modal phóng to QR */}
      {qrView && memberOf(qrView)?.qr_url && (
        <div onClick={() => setQrView(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(27,42,51,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, cursor: "pointer", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 20, textAlign: "center", maxWidth: 320, width: "100%", cursor: "default" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Chuyển tiền cho {nameOf(qrView)} 💸</div>
            <img src={memberOf(qrView).qr_url} alt={`QR của ${nameOf(qrView)}`} style={{ width: "100%", borderRadius: 10 }} />
            <button onClick={() => setQrView(null)}
              style={{ marginTop: 14, width: "100%", padding: 10, background: "#1B2A33", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
