import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";

// Tự host font qua next/font: không gọi Google lúc tải trang, chữ không bị nhảy khi font về
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata = {
  title: "TripSplit — Chia tiền du lịch nhóm",
  description: "Nhập khoản chi chung, app tự tính ai nợ ai khi kết thúc chuyến đi",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi" className={beVietnam.variable}>
      <body>{children}</body>
    </html>
  );
}
