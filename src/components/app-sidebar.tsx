"use client"

import { HomeIcon, PlusIcon } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useChatSession } from "@/components/chat/chat-session"

const navItems = [{ title: "Home", href: "/", icon: HomeIcon }]

export function AppSidebar() {
  const { newChat } = useChatSession()

  return (
    <Sidebar collapsible="none" className="bg-transparent">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <h1 className="font-bold font-gg-sans p-2">afryend</h1>
            <SidebarMenuButton onClick={newChat}>
              <PlusIcon /> New chat
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
