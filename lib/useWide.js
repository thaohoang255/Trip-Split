import { useSyncExternalStore } from "react";

// Màn hình rộng (máy tính, tablet nằm ngang): các trang chia 2 cột.
// Điện thoại giữ nguyên bố cục một cột. Lúc render trên server luôn coi là điện thoại.
const WIDE_QUERY = "(min-width: 900px)";

export function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}
