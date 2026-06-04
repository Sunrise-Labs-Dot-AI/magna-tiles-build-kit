import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magnetic Tile Builder",
  description: "Generate realistic magnetic tile builds from a prompt."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
