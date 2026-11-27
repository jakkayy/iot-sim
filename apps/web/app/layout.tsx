import "./globals.css";

export const metadata = { title: "ESP32 IoT Simulator" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
