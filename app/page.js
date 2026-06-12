"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

// ============================================================
// TRANG CHỦ
// - Ai cũng tạo được chuyến đi mới → nhận link bí mật để share
// - Admin (đăng nhập đúng Gmail) → thấy mục "Chuyến đi của tôi"
// ============================================================

const C = {
  ink: "#1B2A33", teal: "#0E7C7B", tealDark: "#0A5C5B", coral: "#FF7849",
  sand: "#F3EDE2", paper: "#FBFAF6", line: "#E4DFD3",
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

  // Theo dõi trạng thái đăng nhập (tự cập nhật khi login/logout xong)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Đăng nhập rồi thì thử tải danh sách chuyến — RLS chỉ cho admin thấy dữ liệu
  useEffect(() => {
    if (!session) { setMyTrips(null); return; }
    supabase
      .from("trips")
      .select("id, code, name, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setMyTrips(data || []));
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
    router.push(`/trip/${data.code}`); // nhảy thẳng vào trang chuyến đi vừa tạo
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
      <div style={{ background: C.teal, color: "#fff", padding: "44px 20px 36px", textAlign: "center" }}>
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
                style={{ border: `1.5px solid ${C.line}`, background: "#fff", borderRadius: 999, padding: "9px 22px", cursor: "pointer", fontSize: 13, color: "#7d8a90", fontWeight: 600 }}
              >
                Đăng nhập (dành cho chủ app)
              </button>
            </div>
          ) : (
            <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Chuyến đi của tôi</div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  style={{ border: "none", background: "none", color: "#9aa6ab", fontSize: 12.5, cursor: "pointer" }}
                >Đăng xuất</button>
              </div>

              {myTrips === null && <div style={{ fontSize: 13.5, color: "#7d8a90" }}>Đang tải...</div>}

              {myTrips !== null && myTrips.length === 0 && (
                <div style={{ fontSize: 13.5, color: "#7d8a90", lineHeight: 1.6 }}>
                  Không thấy chuyến nào. Nếu m là chủ app mà thấy dòng này: kiểm tra email đang đăng nhập
                  ({session.user?.email}) có trùng khớp với email trong bảng app_admins không (phân biệt hoa thường).
                </div>
              )}

              {myTrips !== null && myTrips.map((t) => (
                <a key={t.id} href={`/trip/${t.code}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div style={{ border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: "#9aa6ab" }}>
                      {new Date(t.created_at).toLocaleDateString("vi-VN")}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
