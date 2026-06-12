import "./globals.css";

export const metadata = {
  title: "TripSplit — Chia tiền du lịch nhóm",
  description: "Nhập khoản chi chung, app tự tính ai nợ ai khi kết thúc chuyến đi",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
