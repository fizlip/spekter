"use client"

import { 
  HomeIcon, 
  Logs, 
  MousePointer2, 
  MessageCircle, 
  ClockFading, 
  ShieldCheck 
} from "lucide-react"
import Link from "next/link"

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
const navItems = [{ title: "Home", href: "/", icon: HomeIcon }]

export function AppSidebar() {

  return (
    <Sidebar collapsible="none" className="bg-transparent">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <h1 className="text-base font-inter p-2">afryend</h1>
            <SidebarMenuButton
              render={<Link  href="/" />}
              className="font-inter hover:bg-[#e1e1e2] cursor-pointer text-sm hover:text-black text-gray-500"
            >
              <MousePointer2 size={12} /> Agent
            </SidebarMenuButton>
            <SidebarMenuButton
              render={<Link href="/" />}
              className="font-inter hover:bg-[#e1e1e2] cursor-pointer text-sm hover:text-black text-gray-500"
            >
              <MessageCircle  size={12}/> Sessions
            </SidebarMenuButton>
            <SidebarMenuButton
              render={<Link href="/logs" />}
              className="font-inter hover:bg-[#e1e1e2] cursor-pointer text-sm hover:text-black text-gray-500"
            >
              <Logs size={12}/> Logs
            </SidebarMenuButton>
            <SidebarMenuButton
              render={<Link href="/" />}
              className="font-inter hover:bg-[#e1e1e2] cursor-pointer text-sm hover:text-black text-gray-500"
            >
              <ClockFading size={12}/> Automations
            </SidebarMenuButton>
            <SidebarMenuButton
              render={<Link href="/" />}
              className="font-inter hover:bg-[#e1e1e2] cursor-pointer text-sm hover:text-black text-gray-500"
            >
              <ShieldCheck  size={12}/> Security
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
