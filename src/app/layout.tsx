import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatSessionProvider } from "@/components/chat/chat-session";
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
          <ChatSessionProvider>
            <AppSidebar />
            <div className="m-2 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-md border border-[#ebebeb]">
              <SidebarInset>
                {children}
              </SidebarInset>
            </div>
          </ChatSessionProvider>
        </SidebarProvider>
      </body>
    </html>
  );
}
