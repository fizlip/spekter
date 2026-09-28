import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
  variable: "--font-gg-sans",
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
      <body className="min-h-full flex flex-col bg-[#f5f5f5]">
        <SidebarProvider>
          <AppSidebar />
          <div className="w-full h-full m-2 rounded-md border border-[#e0e0e0]">
            <SidebarInset>
              <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger className="-ml-1" />
              </header>
              {children}
            </SidebarInset>
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
