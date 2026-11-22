import type { Metadata } from "next";
import { ErrorTelemetry } from "@/components/monitoring/ErrorTelemetry";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://class-emulation-management.vercel.app"),
  title: {
    default: "PTA-hanhkiem",
    template: "%s | PTA-hanhkiem",
  },
  description: "PTA-hanhkiem — sổ liên lạc, điểm thi đua và kết quả hạnh kiểm cho giáo viên, phụ huynh và học sinh.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: "PTA-hanhkiem",
    title: "PTA-hanhkiem",
    description: "Sổ liên lạc, điểm thi đua và thông tin lớp học cho giáo viên, phụ huynh và học sinh.",
    images: [{ url: "/school-campus-background.jpg", width: 1280, height: 720, alt: "Khuôn viên trường học" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PTA-hanhkiem",
    description: "Sổ liên lạc và điểm thi đua của lớp học.",
    images: ["/school-campus-background.jpg"],
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="font-sans"><ErrorTelemetry />{children}</body>
    </html>
  );
}
