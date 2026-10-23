"use client";

import { cloneElement, useId } from "react";

// Lời giải thích nhỏ hiện khi rê chuột (máy tính) hoặc khi chọn nút bằng bàn phím.
// align: "start" | "center" | "end" để bong bóng không tràn ra mép màn hình.
// tone "light" dùng trên header nền xanh đậm.
export default function Tip({ text, align = "center", tone, style, children }) {
  const id = useId();
  return (
    <span className={`tip-wrap tip-${align}${tone === "light" ? " tip-light" : ""}`} style={style}>
      {cloneElement(children, { "aria-describedby": id })}
      <span role="tooltip" id={id} className="tip">{text}</span>
    </span>
  );
}
