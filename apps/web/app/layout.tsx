import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Necro-Ops — The Incident Morgue",
  description:
    "Autopsy your dead production incidents. Stitch signals from every tool into one blameless postmortem.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-morgue-bg text-morgue-text font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
