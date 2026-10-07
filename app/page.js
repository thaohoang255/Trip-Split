"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CaretRight, X } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { computeBalances, fmt } from "../lib/money";

// ============================================================
// TRANG CHỦ
// - Ai cũng tạo được chuyến đi mới → nhận link bí mật để share
// - Admin (đăng nhập đúng Gmail) → thấy mục "Chuyến đi của tôi"
// ============================================================

// Bảng màu "Biển": Sky Blue - Blue Green - Prussian Blue - Selective Yellow - UT Orange
const C = {
  ink: "#023047", teal: "#219EBC", tealDark: "#023047", coral: "#FB8500",
  sand: "#FFEDC2", paper: "#F6FBFE", line: "#D9E8F1",
  text2: "#56656E", // chữ phụ: đạt tương phản 4.5:1 trên nền trắng và nền ô nhập
  tealText: "#0B6F88", orangeText: "#A84B00", // chữ "nhận lại" / "trả thêm"
};

export default function HomePage() {
  const router = useRouter();

  // ---- Form tạo chuyến ----
  const [tripName, setTripName] = useState("");
  const [memberNames, setMemberNames] = useState(["", ""]); // bắt đầu với 2 ô tên
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const [errDetail, setErrDetail] = useState("");

  // ---- Admin ----
  const [session, setSession] = useState(null);
  const [myTrips, setMyTrips] = useState(null); // null = chưa tải, [] = không có/không phải admin
  const [myTripIds, setMyTripIds] = useState([]); // id các chuyến đã bookmark hoặc từng nhập giao dịch

  // ---- Chuyến gần đây trên máy này (không cần tài khoản) ----
  // Mỗi lần mở một chuyến, trang chuyến đi ghi mã chuyến vào bộ nhớ máy (tripsplit_recent).
  // Máy đã từng chọn "Bạn là ai" ở chuyến cũ (trước khi có danh sách này) cũng được tính.
  const [recent, setRecent] = useState([]); // [{ code, name, members, myNet }]

  useEffect(() => {
    let codes = [];
    try {
      codes = JSON.parse(localStorage.getItem("tripsplit_recent") || "[]").map((x) => x.code);
      for (const k of Object.keys(localStorage)) {
        const c = k.startsWith("tripsplit_me_") ? k.slice("tripsplit_me_".length) : null;
        if (c && !codes.includes(c)) codes.push(c);
      }
    } catch {}
    codes = codes.slice(0, 6);
    if (codes.length === 0) return;
    Promise.all(codes.map(async (code) => {
      const { data, error } = await supabase.rpc("get_trip_data", { p_code: code });
      if (error || !data) return null; // chuyến đã bị xóa hoặc link hỏng: bỏ qua
      let meId = null;
      try { meId = localStorage.getItem(`tripsplit_me_${code}`); } catch {}
      const bal = computeBalances(data.entries, data.members, data.trip.rates || { VND: 1 });
      return {
        code,
        name: data.trip.name,
        members: data.members.map((m) => m.name),
        myNet: bal[meId] ? bal[meId].net : null, // null = máy này chưa chọn "Bạn là ai"
      };
    })).then((list) => setRecent(list.filter(Boolean)));
  }, []);

  // Theo dõi trạng thái đăng nhập (tự cập nhật khi login/logout xong)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);


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
    setErr(""); setErrDetail("");
    const names = memberNames.map((n) => n.trim()).filter(Boolean);
    if (!tripName.trim()) { setErr("Nhập tên chuyến đi."); return; }
    if (names.length < 2) { setErr("Cần ít nhất 2 người để chia tiền."); return; }
    if (new Set(names).size !== names.length) { setErr("Có hai người trùng tên. Thêm chữ để phân biệt, ví dụ Minh A và Minh B."); return; }

    setCreating(true);
    const { data, error } = await supabase.rpc("create_trip", {
      p_name: tripName.trim(),
      p_member_names: names,
    });
    setCreating(false);

    if (error || !data?.code) {
      if (error) console.error(error);
      setErr("Chưa tạo được chuyến. Thử lại sau vài giây.");
      setErrDetail(error?.message ? String(error.message).slice(0, 140) : "");
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
        <div style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#219EBC" style={{ flexShrink: 0, transform: "rotate(45deg)" }}>
                <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
              </svg>
              {t.name}
            </div>
            {t.members?.length > 0 && (
              <div style={{ fontSize: 12, color: C.text2, marginTop: 3, paddingLeft: 23 }}>
                {t.members.map((m) => m.name).join(" · ")}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.text2, flexShrink: 0 }}>
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


  return (
    <div style={{ minHeight: "100vh", background: C.paper }}>
      {/* Hero */}
      <div style={{ background: C.tealDark, color: "#fff", padding: recent.length > 0 ? "28px 20px 24px" : "44px 20px 36px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: 3, opacity: 0.75, fontWeight: 600 }}>TRIPSPLIT</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.5, marginTop: 6 }}>
          Đi chơi cứ vui,<br />tiền nong để app tính
        </div>
        {recent.length === 0 && (
          <div style={{ fontSize: 14, opacity: 0.85, marginTop: 10, maxWidth: 420, margin: "10px auto 0" }}>
            Cả nhóm cùng nhập khoản chi qua một link chung. Cuối chuyến, app tính ai chuyển cho ai bao nhiêu.
          </div>
        )}
      </div>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "26px 16px 60px" }}>

        {/* ===== Chuyến gần đây: quay lại chuyến cũ không cần tìm link trong group chat ===== */}
        {recent.length > 0 && (
          <section style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Chuyến gần đây trên máy này</h2>
            {recent.map((t) => {
              const owes = t.myNet !== null && t.myNet < -1;
              const gets = t.myNet !== null && t.myNet > 1;
              return (
                <a key={t.code} href={`/trip/${t.code}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 12, padding: "12px 12px 12px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: C.text2, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.members.join(" · ")}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                      color: owes ? C.orangeText : gets ? C.tealText : C.text2 }}>
                      {owes ? `trả ${fmt(-t.myNet)}` : gets ? `nhận ${fmt(t.myNet)}` : t.myNet !== null ? "đã cân bằng" : ""}
                      <CaretRight size={15} color={C.text2} aria-hidden="true" />
                    </div>
                  </div>
                </a>
              );
            })}
          </section>
        )}

        {/* ===== Form tạo chuyến đi ===== */}
        <form onSubmit={(e) => { e.preventDefault(); createTrip(); }} style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 16, padding: 20 }}>
          <h2 style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>Tạo chuyến đi mới</h2>

          <label htmlFor="trip-name" style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Tên chuyến đi</label>
          <input
            id="trip-name"
            placeholder="vd: Đà Lạt tháng 7"
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
            style={{ width: "100%", padding: "11px 13px", border: "none", background: "#EDF5FA", borderRadius: 10, fontSize: 14, marginBottom: 14 }}
          />

          <div id="members-label" style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Thành viên <span style={{ fontWeight: 400, color: C.text2 }}>(nhập tên, không cần tài khoản)</span></div>
          {memberNames.map((name, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                placeholder={`Tên người ${i + 1}`}
                aria-labelledby="members-label"
                value={name}
                onChange={(e) => setMemberName(i, e.target.value)}
                style={{ flex: 1, padding: "10px 13px", border: "none", background: "#EDF5FA", borderRadius: 10, fontSize: 14 }}
              />
              {memberNames.length > 2 && (
                <button
                  type="button"
                  onClick={() => setMemberNames((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{ background: "#EDF5FA", border: "none", borderRadius: 10, padding: "0 14px", cursor: "pointer", color: C.text2, display: "flex", alignItems: "center" }}
                  aria-label={`Xóa ${name || `người ${i + 1}`}`}
                ><X size={16} weight="bold" /></button>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setMemberNames((prev) => [...prev, ""])}
            style={{ background: "#EDF5FA", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontSize: 13.5, color: C.tealDark, fontWeight: 600, marginBottom: 16, width: "100%" }}
          >Thêm thành viên</button>

          {err && (
            <div style={{ fontSize: 13, color: C.ink, background: "#FFF3D6", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
              {err}
              {errDetail && <div style={{ fontSize: 11.5, marginTop: 3, wordBreak: "break-word" }}>{errDetail}</div>}
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            style={{ width: "100%", padding: 13, background: C.coral, color: C.ink, opacity: creating ? 0.7 : 1, border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: creating ? "wait" : "pointer" }}
          >
            {creating ? "Đang tạo chuyến..." : "Tạo chuyến"}
          </button>

          <div style={{ fontSize: 12, color: C.text2, marginTop: 12, lineHeight: 1.5 }}>
            Tạo xong, chuyến có một link riêng. Gửi link vào group chat là cả nhóm vào nhập được.
            Chỉ người có link mới xem được chuyến.
          </div>
        </form>

        {/* ===== Khu vực admin ===== */}
        <div style={{ marginTop: 28 }}>
          {!session ? (
            <div style={{ textAlign: "center" }}>
              <button
                onClick={loginGoogle}
                style={{ background: "#EDF5FA", border: "none", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 999, padding: "12px 22px", cursor: "pointer", fontSize: 14, color: C.tealDark, fontWeight: 600, whiteSpace: "nowrap" }}
              >
                Đăng nhập với Google
              </button>
              <div style={{ fontSize: 12, color: C.text2, marginTop: 8 }}>
                Đăng nhập để lưu và xem lại các chuyến của bạn. Không bắt buộc, vào bằng link vẫn dùng được.
              </div>
            </div>
          ) : (
            <div style={{ background: "#fff", boxShadow: "0 1px 3px rgba(2,48,71,.08)", borderRadius: 16, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Chuyến đi của tôi</div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  style={{ border: "none", background: "none", color: C.text2, fontSize: 13.5, padding: "8px 0", cursor: "pointer" }}
                >Đăng xuất</button>
              </div>

              {myTrips === null && <div style={{ fontSize: 13.5, color: C.text2 }}>Đang tải...</div>}

              {myTrips !== null && myTrips.length === 0 && (
                <div style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.6 }}>
                  Chưa có chuyến nào. Tạo chuyến mới, hoặc mở link bạn bè gửi rồi bấm Lưu chuyến, chuyến đó sẽ hiện ở đây.
                </div>
              )}

              {myTrips !== null && mineTrips.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: "4px 0 8px" }}>Chuyến của tôi</h3>
                  {mineTrips.map(renderTripCard)}
                </>
              )}
              {myTrips !== null && otherTrips.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: "14px 0 8px" }}>Chuyến khác trong hệ thống</h3>
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
