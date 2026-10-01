import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import "./globals.css";

const ggSans = localFont({
  src: [
    { path: "../../fonts/gg sans Regular.ttf", weight: "400", style: "normal" },
    { path: "../../fonts/gg sans Medium.ttf", weight: "500", style: "normal" },
    {
      path: "../../fonts/gg sans Semibold.ttf",
      weight: "600",
      style: "normal",
    },
    { path: "../../fonts/gg sans Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--gg-sans",
});

export const metadata: Metadata = {
  title: "Spekter",
  description: "Spekter",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ggSans.variable} h-full antialiased`}
    >
      <body className="flex h-svh flex-col overflow-hidden bg-[#fdfdfd]">
        <SidebarProvider>
          <AppSidebar />
          <div className="m-2 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-md border border-[#e0e0e0]">
            <SidebarInset>
              {children}
            </SidebarInset>
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
