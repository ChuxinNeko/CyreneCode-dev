import { createSignal } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout, type LocalProject } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import type { ServerConnection } from "@/context/server"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import {
  createHomeSessionsController,
  type HomeSessionRecord,
} from "@/pages/home/home-sessions-controller"

const PROJECT_SESSIONS_LIMIT = 4
const SIDEBAR_RECENT_LIMIT = 8

export type SidebarProjectGroup = {
  conn: ServerConnection.Any
  projects: LocalProject[]
}

export function createAppSidebarController() {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()

  // Projects are expanded by default; track the explicitly-collapsed set so
  // newly discovered projects start expanded without needing to be seeded.
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const toggleExpanded = (worktree: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(worktree)) next.delete(worktree)
      else next.add(worktree)
      return next
    })
  const isExpanded = (worktree: string) => !collapsed().has(worktree)

  const serverGroups = (): SidebarProjectGroup[] =>
    home
      .server.list()
      .map((conn) => ({ conn, projects: home.project.forServer(conn) }))
      .filter((group) => group.projects.length > 0)

  const recordsForProject = (worktree: string): HomeSessionRecord[] =>
    sessions
      .data.allProjectRecords()
      .filter((record) => record.project.worktree === worktree)
      .slice(0, PROJECT_SESSIONS_LIMIT)

  const recentRecords = () => sessions.data.allProjectRecords().slice(0, SIDEBAR_RECENT_LIMIT)

  const openCommandPalette = async () => {
    const conn = home.server.focused()
    if (!conn) return
    await command.trigger("command.palette")
  }

  // Register new-layout commands the text menu (file/edit/view/help) depends on.
  // They used to be registered only by LegacyLayout, so without this the menu
  // entries render disabled.
  command.register("app.sidebar", () => [
    {
      id: "session.new",
      title: language.t("command.session.new"),
      category: language.t("command.category.file"),
      onSelect: () => home.project.openNewSession(),
    },
    {
      id: "project.open",
      title: language.t("command.project.open"),
      category: language.t("command.category.file"),
      onSelect: () => {
        const conn = home.server.focused()
        if (conn) projects.project.choose(conn)
      },
    },
    {
      id: "sidebar.toggle",
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      onSelect: () => layout.sidebar.toggle(),
    },
  ])

  return {
    home,
    projects,
    sessions,
    command,
    language,
    layout,
    platform,
    serverGroups,
    recordsForProject,
    recentRecords,
    isExpanded,
    toggleExpanded,
    openCommandPalette,
    settings: projects.utility.settings,
  }
}

export type AppSidebarController = ReturnType<typeof createAppSidebarController>
