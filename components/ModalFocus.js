"use client";

import { useEffect } from "react";

// Quản lý focus cho mọi hộp thoại [role="dialog"][aria-modal="true"] trên trang:
// - mở hộp thoại: đưa focus vào trong (ưu tiên phần tử có data-autofocus, rồi phần tử bấm được đầu tiên)
// - đang mở: Tab / Shift+Tab chỉ đi vòng trong hộp thoại trên cùng, focus không lọt ra phía sau lớp phủ
// - đóng: trả focus về nút đã mở nó
// Hoạt động chung cho cả các hộp thoại chồng nhau (vd: đổi tên thành viên mở từ trong Cài đặt).

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function layerOf(dialog) {
  let e = dialog;
  while (e && e !== document.body) {
    const z = parseInt(getComputedStyle(e).zIndex, 10);
    if (!Number.isNaN(z)) return z;
    e = e.parentElement;
  }
  return 0;
}

function topDialog() {
  const all = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')];
  if (all.length === 0) return null;
  // Hộp thoại nằm trên cùng là cái có lớp phủ z-index cao nhất (cùng z thì cái render sau)
  return all.reduce((top, d) => (layerOf(d) >= layerOf(top) ? d : top), all[0]);
}

function focusables(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 || el.classList.contains("sr-only"),
  );
}

function focusInto(dialog) {
  if (dialog.contains(document.activeElement)) return;
  const target = dialog.querySelector("[data-autofocus]") || focusables(dialog)[0] || dialog;
  if (target === dialog && !dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

export default function ModalFocus() {
  useEffect(() => {
    const stack = []; // [{ dialog, returnTo }]

    function sync() {
      // Hộp thoại đã đóng: bỏ khỏi ngăn xếp và trả focus về nơi đã mở nó
      let restore = null;
      while (stack.length && !stack[stack.length - 1].dialog.isConnected) {
        restore = stack.pop().returnTo;
      }
      const top = topDialog();
      if (top && !stack.some((s) => s.dialog === top)) {
        stack.push({ dialog: top, returnTo: document.activeElement });
        // setTimeout thay vì requestAnimationFrame: rAF bị hoãn khi tab đang ẩn hoặc trình duyệt tiết kiệm pin
        setTimeout(() => top.isConnected && focusInto(top), 0);
        return;
      }
      if (restore && restore.isConnected && !top) restore.focus({ preventScroll: true });
      else if (top && restore) focusInto(top);
    }

    function onKey(e) {
      if (e.key !== "Tab") return;
      const top = topDialog();
      if (!top) return;
      const list = focusables(top);
      if (list.length === 0) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function onFocusIn(e) {
      const top = topDialog();
      if (top && !top.contains(e.target)) focusInto(top);
    }

    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    sync();
    return () => {
      mo.disconnect();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);
  return null;
}
