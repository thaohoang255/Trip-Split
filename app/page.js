"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

// ============================================================
// TRANG CHỦ
// - Ai cũng tạo được chuyến đi mới → nhận link bí mật để share
// - Admin (đăng nhập đúng Gmail) → thấy mục "Chuyến đi của tôi"
// ============================================================

// Bảng màu "Biển": Sky Blue - Blue Green - Prussian Blue - Selective Yellow - UT Orange
const C = {
  ink: "#023047", teal: "#219EBC", tealDark: "#023047", coral: "#FB8500",
  sand: "#FFEDC2", paper: "#F6FBFE", line: "#D9E8F1",
};

export default function HomePage() {
  const router = useRouter();

  // ---- Form tạo chuyến ----
  const [tripName, setTripName] = useState("");
  const [memberNames, setMemberNames] = useState(["", ""]); // bắt đầu với 2 ô tên
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  // ---- Admin ----
  const [session, setSession] = useState(null);
  const [myTrips, setMyTrips] = useState(null); // null = chưa tải, [] = không có/không phải admin
  const [myName, setMyName] = useState("");     // "tên của tôi" trong các chuyến — để in đậm trong danh sách
  const [myTripIds, setMyTripIds] = useState([]); // id các chuyến đã bookmark hoặc từng nhập giao dịch

  // Theo dõi trạng thái đăng nhập (tự cập nhật khi login/logout xong)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Đọc "tên của tôi" từ hồ sơ tài khoản (lưu trong user_metadata của Supabase Auth)
  useEffect(() => {
    setMyName(session?.user?.user_metadata?.tripsplit_name || "");
  }, [session]);

  // Đăng nhập rồi thì thử tải danh sách chuyến — RLS chỉ cho admin thấy dữ liệu
  useEffect(() => {
    if (!session) { setMyTrips(null); setMyTripIds([]); return; }
    supabase
      .from("trips")
      .select("id, code, name, created_at, members(name)") // members(name) = kéo kèm tên thành viên qua liên kết bảng
      .order("created_at", { ascending: false })
      .then(({ data }) => setMyTrips(data || []));
    // Hỏi database: chuyến nào đã bookmark hoặc từng nhập giao dịch?
    supabase.rpc("my_trip_ids").then(({ data }) => setMyTripIds(data || []));
  }, [session]);

  function setMemberName(i, value) {
    setMemberNames((prev) => prev.map((n, idx) => (idx === i ? value : n)));
  }

  async function createTrip() {
    setErr("");
    const names = memberNames.map((n) => n.trim()).filter(Boolean);
    if (!tripName.trim()) { setErr("Đặt tên chuyến đi đã nha"); return; }
    if (names.length < 2) { setErr("Cần ít nhất 2 thành viên mới có gì để chia 😄"); return; }
    if (new Set(names).size !== names.length) { setErr("Có 2 người trùng tên — thêm ký tự phân biệt nhé (vd Minh A, Minh B)"); return; }

    setCreating(true);
    const { data, error } = await supabase.rpc("create_trip", {
      p_name: tripName.trim(),
      p_member_names: names,
    });
    setCreating(false);

    if (error || !data?.code) {
      setErr("Tạo chuyến bị lỗi: " + (error?.message || "không rõ nguyên nhân"));
      return;
    }
    // Đang đăng nhập thì tự lưu chuyến vừa tạo vào tài khoản luôn
    if (session) {
      await supabase.rpc("save_trip_to_account", { p_code: data.code });
    }
    router.push(`/trip/${data.code}`); // nhảy thẳng vào trang chuyến đi vừa tạo
  }

  // Chia danh sách: chuyến của tôi lên trên, chuyến khác (admin mới thấy) xuống dưới
  const mineTrips = (myTrips || []).filter((t) => myTripIds.includes(t.id));
  const otherTrips = (myTrips || []).filter((t) => !myTripIds.includes(t.id));

  // Card chuyến đi dùng chung cho cả 2 nhóm
  function renderTripCard(t) {
    return (
      <a key={t.id} href={`/trip/${t.code}`} style={{ textDecoration: "none", color: "inherit" }}>
        <div style={{ border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#219EBC" style={{ flexShrink: 0, transform: "rotate(45deg)" }}>
                <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
              </svg>
              {t.name}
            </div>
            {t.members?.length > 0 && (
              <div style={{ fontSize: 12, color: "#7d8a90", marginTop: 3, paddingLeft: 23 }}>
                {t.members.map((m, i) => {
                  const mine = myName && m.name.trim().toLowerCase() === myName.trim().toLowerCase();
                  return (
                    <span key={i}>
                      {i > 0 && " · "}
                      {mine ? <b style={{ color: "#219EBC" }}>{m.name}</b> : m.name}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#9aa6ab", flexShrink: 0 }}>
            {new Date(t.created_at).toLocaleDateString("vi-VN")}
          </div>
        </div>
      </a>
    );
  }

  function loginGoogle() {
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  // Đặt/đổi "tên của tôi" — lưu thẳng vào hồ sơ tài khoản, không cần bảng mới
  async function changeMyName() {
    const name = prompt("Tên m hay dùng trong các chuyến đi (vd: Thảo):", myName);
    if (name === null) return; // bấm Cancel thì thôi
    const { error } = await supabase.auth.updateUser({ data: { tripsplit_name: name.trim() } });
    if (error) { alert("Lưu tên bị lỗi: " + error.message); return; }
    setMyName(name.trim());
  }

  return (
    <div style={{ minHeight: "100vh", background: C.paper }}>
      {/* Hero */}
      <div style={{ background: C.tealDark, color: "#fff", padding: "44px 20px 36px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: 3, opacity: 0.75, fontWeight: 600 }}>TRIPSPLIT</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.5, marginTop: 6 }}>
          Đi chơi cứ vui,<br />tiền nong để app tính
        </div>
        <div style={{ fontSize: 14, opacity: 0.85, marginTop: 10, maxWidth: 420, margin: "10px auto 0" }}>
          Cả nhóm cùng nhập khoản chi qua 1 link chung — kết thúc chuyến, app chốt ai chuyển ai bao nhiêu.
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "26px 16px 60px" }}>

        {/* ===== Form tạo chuyến đi ===== */}
        <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>Tạo chuyến đi mới</div>

          <input
            placeholder="Tên chuyến đi (vd: Đà Lạt tháng 7)"
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
            style={{ width: "100%", padding: "11px 13px", border: `1.5px solid ${C.line}`, borderRadius: 10, fontSize: 14, outline: "none", marginBottom: 14 }}
          />

          <div style={{ fontSize: 12.5, color: "#7d8a90", marginBottom: 8 }}>Thành viên (nhập tên, không cần tài khoản)</div>
          {memberNames.map((name, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                placeholder={`Tên người ${i + 1}`}
                value={name}
                onChange={(e) => setMemberName(i, e.target.value)}
                style={{ flex: 1, padding: "10px 13px", border: `1.5px solid ${C.line}`, borderRadius: 10, fontSize: 14, outline: "none" }}
              />
              {memberNames.length > 2 && (
                <button
                  onClick={() => setMemberNames((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{ border: `1.5px solid ${C.line}`, background: "#fff", borderRadius: 10, padding: "0 14px", cursor: "pointer", color: "#9aa6ab" }}
                >✕</button>
              )}
            </div>
          ))}

          <button
            onClick={() => setMemberNames((prev) => [...prev, ""])}
            style={{ border: `1.5px dashed ${C.line}`, background: "transparent", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontSize: 13.5, color: C.tealDark, fontWeight: 600, marginBottom: 16, width: "100%" }}
          >＋ Thêm thành viên</button>

          {err && <div style={{ fontSize: 13, color: "#C9442A", marginBottom: 12 }}>⚠ {err}</div>}

          <button
            onClick={createTrip}
            disabled={creating}
            style={{ width: "100%", padding: 13, background: creating ? "#f0a583" : C.coral, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: creating ? "wait" : "pointer" }}
          >
            {creating ? "Đang tạo chuyến..." : "Tạo chuyến & lấy link share"}
          </button>

          <div style={{ fontSize: 12, color: "#9aa6ab", marginTop: 12, lineHeight: 1.5 }}>
            Tạo xong m sẽ nhận được 1 link bí mật — gửi vào group chat là cả nhóm vào nhập chung được.
            Ai có link mới thấy chuyến đi, mỗi chuyến một thế giới riêng.
          </div>
        </div>

        {/* ===== Khu vực admin ===== */}
        <div style={{ marginTop: 28 }}>
          {!session ? (
            <div style={{ textAlign: "center" }}>
              <button
                onClick={loginGoogle}
                style={{ border: `1.5px solid ${C.line}`, background: "#fff", borderRadius: 999, padding: "9px 22px", cursor: "pointer", fontSize: 13, color: C.tealDark, fontWeight: 600 }}
              >
                Đăng nhập với Google
              </button>
              <div style={{ fontSize: 12, color: "#9aa6ab", marginTop: 8 }}>
                Để lưu và xem lại các chuyến đi của bạn — không bắt buộc, vào bằng link vẫn vô tư
              </div>
            </div>
          ) : (
            <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Chuyến đi của tôi</div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  style={{ border: "none", background: "none", color: "#9aa6ab", fontSize: 12.5, cursor: "pointer" }}
                >Đăng xuất</button>
              </div>

              {/* Tên hay dùng: chuyến nào có tên này sẽ được in đậm trong danh sách */}
              <div style={{ fontSize: 12.5, color: "#7d8a90", marginBottom: 12 }}>
                Tên của m trong các chuyến:{" "}
                {myName ? <b style={{ color: "#219EBC" }}>{myName}</b> : <span style={{ fontStyle: "italic" }}>chưa đặt</span>}
                <button onClick={changeMyName}
                  style={{ border: "none", background: "none", color: "#219EBC", fontSize: 12.5, cursor: "pointer", fontWeight: 600, marginLeft: 6, textDecoration: "underline" }}>
                  {myName ? "Đổi" : "Đặt tên"}
                </button>
              </div>

              {myTrips === null && <div style={{ fontSize: 13.5, color: "#7d8a90" }}>Đang tải...</div>}

              {myTrips !== null && myTrips.length === 0 && (
                <div style={{ fontSize: 13.5, color: "#7d8a90", lineHeight: 1.6 }}>
                  Chưa có chuyến nào trong tài khoản. Tạo chuyến mới, hoặc mở một chuyến từ link bạn bè gửi
                  rồi bấm "Lưu chuyến" trên đó — nó sẽ xuất hiện ở đây.
                </div>
              )}

              {myTrips !== null && mineTrips.length > 0 && (
                <>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa6ab", fontWeight: 700, margin: "4px 0 8px" }}>CHUYẾN CỦA TÔI</div>
                  {mineTrips.map(renderTripCard)}
                </>
              )}
              {myTrips !== null && otherTrips.length > 0 && (
                <>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#9aa6ab", fontWeight: 700, margin: "14px 0 8px" }}>CHUYẾN KHÁC TRONG HỆ THỐNG</div>
                  {otherTrips.map(renderTripCard)}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
