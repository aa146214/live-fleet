import type { Metadata, Viewport } from "next";
import { Arimo } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const arimo = Arimo({
  variable: "--font-arimo",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Leavesden Shuttle · Live map",
  description: "Live positions of the Warner Bros. Studios Leavesden shuttle minibuses.",
};

export const viewport: Viewport = {
  themeColor: "#04006c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={arimo.variable}>
      <body>{children}</body>
    </html>
  );
}
