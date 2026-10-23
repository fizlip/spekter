"use client"

import {
  Logs,
  MousePointer2,
  ClockFading,
} from "lucide-react"
import Link from "next/link"

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { SessionList } from "@/components/session-list"
import { WorkspaceTree } from "@/components/workspace-tree"

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
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <WorkspaceTree />
        <SessionList />
      </SidebarContent>
    </Sidebar>
  )
}
