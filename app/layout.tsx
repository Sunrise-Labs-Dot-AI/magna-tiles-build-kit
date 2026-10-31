import type { Metadata } from "next";
import "./globals.css";
import "./experiments/experiments.css";
import Link from "next/link";

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
      <body suppressHydrationWarning>
        <div className="experimental-strip"><strong>Experimental preview</strong><span>New tile physics enabled · whole builds remain unverified</span><Link href="/experiments">Open experiments</Link><a href="http://127.0.0.1:3010/design">Previous version</a></div>
        {children}
      </body>
    </html>
  );
}
