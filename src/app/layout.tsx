import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatSessionProvider } from "@/components/chat/chat-session";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
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

const inter = localFont({
  src: [
    {
      path: "../../fonts/Inter/Inter_18pt-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/Inter/Inter_18pt-Italic.ttf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../fonts/Inter/Inter_18pt-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/Inter/Inter_18pt-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../fonts/Inter/Inter_18pt-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--inter",
});

export const metadata: Metadata = {
  title: "Spekter",
  description: "Spekter",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ggSans.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="flex h-svh flex-col overflow-hidden bg-background">
        <TooltipProvider>
          <SidebarProvider>
            <ChatSessionProvider>
              <AppSidebar />
              <div className="shadow m-2 mr-4 flex min-h-0 max-w-full mx-auto flex-1 flex-col overflow-hidden rounded-md">
                <SidebarInset>
                  {children}
                </SidebarInset>
              </div>
            </ChatSessionProvider>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
