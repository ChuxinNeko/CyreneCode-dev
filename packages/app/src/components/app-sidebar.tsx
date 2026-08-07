import { createMemo, createSignal, For, Show } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { Mark } from "@opencode-ai/ui/logo"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import { type LocalProject } from "@/context/layout"
import { ServerConnection } from "@/context/server"
import { displayName, errorMessage } from "@/pages/layout/helpers"
import { sessionTitle } from "@/utils/session-title"
import { showToast } from "@/utils/toast"
import type { HomeSessionRecord } from "@/pages/home/home-sessions-controller"
import { TitlebarUpdateIconButton, type TitlebarUpdatePillState } from "./titlebar"
import { createAppSidebarController, type AppSidebarController } from "./app-sidebar-controller"

export function AppSidebar() {
  const c = createAppSidebarController()
  const language = c.language

  const updateState = createMemo<TitlebarUpdatePillState>(() => {
    const state = c.platform.updater?.state()
    const installing = state?.status === "installing"
    const version = state?.status === "ready" ? state.version : undefined
    return {
      visible: version !== undefined || installing,
      installing,
      label: language.t("titlebar.update"),
      ariaLabel: language.t("toast.update.action.installRestart"),
      title: version ? language.t("titlebar.updateVersion", { version }) : undefined,
      onInstall: () => void c.platform.updater?.install(),
    }
  })

  return (
    <aside
      data-slot="app-sidebar"
      class="window-pane flex h-full w-[22%] min-w-[224px] max-w-80 shrink-0 flex-col border-r border-v2-border-border-base bg-v2-background-bg-deep/70"
    >
      {/* Header: 品牌 + 搜索 */}
      <div class="flex h-11 shrink-0 items-center gap-2 px-3">
        <Mark class="size-5 shrink-0" />
        <span class="min-w-0 truncate text-[13px] font-semibold tracking-[-0.04px] text-v2-text-text-base">
          NekoCode
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-v2-icon-icon-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-none"
          onClick={() => void c.openCommandPalette()}
          aria-label={language.t("command.palette")}
        >
          <IconV2 name="magnifying-glass" />
        </button>
      </div>

      {/* 新对话 */}
      <div class="px-2 pb-2">
        <button
          type="button"
          data-component="sidebar-new-session"
          class="flex h-8 w-full shrink-0 items-center gap-2 rounded-[6px] bg-v2-background-bg-layer-01 px-2 text-left text-v2-text-text-base transition-[background-color] duration-150 ease-in-out hover:bg-v2-background-bg-layer-02 focus-visible:bg-v2-background-bg-layer-02 focus-visible:outline-none"
          onClick={() => c.home.project.openNewSession()}
        >
          <IconV2 name="edit" size="small" />
          <span class="min-w-0 truncate text-[13px] font-medium tracking-[-0.04px]">
            {language.t("command.session.new")}
          </span>
        </button>
      </div>

      {/* 滚动区 */}
      <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <SidebarGroupLabel>项目</SidebarGroupLabel>
        <For each={c.serverGroups()}>
          {(group) => (
            <For each={group.projects}>
              {(project) => <SidebarProjectRow c={c} conn={group.conn} project={project} />}
            </For>
          )}
        </For>

        <SidebarGroupLabel>最近</SidebarGroupLabel>
        <Show
          when={c.recentRecords().length > 0}
          fallback={<SidebarEmpty>没有聊天</SidebarEmpty>}
        >
          <For each={c.recentRecords()}>
            {(record) => <SidebarSessionRow c={c} record={record} highlightActive={false} />}
          </For>
        </Show>
      </div>

      {/* Footer: 设置 + 更新 */}
      <div class="flex h-10 shrink-0 items-center gap-1 border-t border-v2-border-border-base px-1.5">
        <button
          type="button"
          class="flex h-7 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-v2-text-text-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none"
          onClick={c.settings}
        >
          <IconV2 name="settings-gear" size="small" />
          <span>设置</span>
        </button>
        <Show when={updateState().visible}>
          <TitlebarUpdateIconButton state={updateState()} />
        </Show>
      </div>
    </aside>
  )
}

function SidebarGroupLabel(props: { children: string }) {
  return (
    <div class="flex h-7 shrink-0 items-center px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-v2-text-text-faint">
      {props.children}
    </div>
  )
}

function SidebarEmpty(props: { children: string }) {
  return (
    <div class="px-2 py-1 text-[13px] tracking-[-0.04px] text-v2-text-text-faint">{props.children}</div>
  )
}

function SidebarProjectRow(props: {
  c: AppSidebarController
  conn: ServerConnection.Any
  project: LocalProject
}) {
  const expanded = () => props.c.isExpanded(props.project.worktree)
  const records = () => props.c.recordsForProject(props.project.worktree)
  const selected = () => props.c.home.selection.value().directory === props.project.worktree

  return (
    <div data-component="sidebar-project-row">
      <div class="group/project relative flex h-8 min-w-0 items-center rounded-[6px]">
        <button
          type="button"
          class="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[6px] bg-transparent px-1.5 text-left text-v2-text-text-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base focus-visible:outline-none"
          data-selected={selected() ? "" : undefined}
          onClick={() => {
            props.c.toggleExpanded(props.project.worktree)
            // Selecting the project keeps the sidebar highlight in sync with the
            // active project instead of leaving a stale earlier project selected.
            props.c.home.selection.set({
              server: ServerConnection.key(props.conn),
              directory: props.project.worktree,
            })
          }}
        >
          <IconV2 name={expanded() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0" />
          <IconV2 name="folder" class="size-4 shrink-0 text-v2-icon-icon-muted" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.04px]">
            {displayName(props.project)}
          </span>
        </button>
        <div class="hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 group-hover/project:opacity-100 focus-within:opacity-100">
          <IconButtonV2
            data-action="sidebar-project-new-session"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="edit" />}
            aria-label={props.c.language.t("command.session.new")}
            onClick={() => props.c.home.project.openProjectNewSession(props.conn, props.project.worktree)}
          />
        </div>
      </div>
      <Show when={expanded()}>
        <Show when={records().length > 0} fallback={<SidebarEmpty>没有聊天</SidebarEmpty>}>
          <For each={records()}>
            {(record) => <SidebarSessionRow c={props.c} record={record} nested />}
          </For>
        </Show>
      </Show>
    </div>
  )
}

function SidebarSessionRow(props: {
  c: AppSidebarController
  record: HomeSessionRecord
  nested?: boolean
  highlightActive?: boolean
}) {
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)
  const active = () => {
    if (props.highlightActive === false) return false
    const route = props.c.layout.route()
    return (
      route.type === "session" &&
      route.sessionId === props.record.session.id &&
      (route.server === undefined || route.server === props.c.sessions.session.server())
    )
  }

  return (
    <div
      data-component="sidebar-session-row"
      data-active={active() ? "" : undefined}
      class="group/session relative flex h-8 min-w-0 items-center rounded-[6px] text-v2-text-text-muted transition-[background-color,color] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base data-[active]:bg-v2-background-bg-layer-03 data-[active]:text-v2-text-text-base focus-within:bg-v2-overlay-simple-overlay-hover focus-within:text-v2-text-text-base"
    >
      <button
        type="button"
        class="flex h-8 min-w-0 flex-1 cursor-pointer items-center rounded-[6px] bg-transparent py-0 pl-12 pr-2 text-left focus-visible:outline-none"
        onClick={() => props.c.sessions.session.open(props.record.session)}
      >
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium tracking-[-0.04px]">
          {title()}
        </span>
      </button>
      <div class="hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center group-hover/session:opacity-100 focus-within:opacity-100">
        <SessionRowMenu c={props.c} record={props.record} />
      </div>
    </div>
  )
}

function SessionRowMenu(props: { c: AppSidebarController; record: HomeSessionRecord }) {
  const language = props.c.language
  const dialog = useDialog()
  const session = () => props.record.session

  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <MenuV2.Trigger
        as={IconButtonV2}
        icon={<IconV2 name="outline-dots" />}
        variant="ghost-muted"
        size="small"
        aria-label={language.t("common.moreOptions")}
      />
      <MenuV2.Portal>
        <MenuV2.Content style={{ width: "120px", "min-width": "120px" }}>
          <MenuV2.Item
            onSelect={() => dialog.show(() => <DialogRenameSession c={props.c} session={session()} />)}
          >
            {language.t("common.rename")}
          </MenuV2.Item>
          <Show when={props.c.sessions.session.shareEnabled()}>
            <MenuV2.Item
              onSelect={() => dialog.show(() => <DialogShareSession c={props.c} session={session()} />)}
            >
              {language.t("session.share.action.share")}...
            </MenuV2.Item>
          </Show>
          <MenuV2.Item onSelect={() => void props.c.sessions.session.archive(session())}>
            {language.t("common.archive")}
          </MenuV2.Item>
          <MenuV2.Separator />
          <MenuV2.Item
            onSelect={() => dialog.show(() => <DialogDeleteSession c={props.c} session={session()} />)}
          >
            {language.t("common.delete")}...
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function DialogRenameSession(props: { c: AppSidebarController; session: Session }) {
  const language = props.c.language
  const dialog = useDialog()
  const [draft, setDraft] = createSignal(sessionTitle(props.session.title) ?? "")
  const [pending, setPending] = createSignal(false)

  const save = async () => {
    const next = draft().trim()
    if (!next) return
    setPending(true)
    await props.c.sessions.session.rename(props.session, next)
    setPending(false)
    dialog.close()
  }

  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("common.rename")} />
      </DialogHeader>
      <div class="flex flex-col gap-3 px-3 pb-1">
        <input
          class="h-8 w-full rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base outline-none focus:border-v2-border-border-strong"
          value={draft()}
          disabled={pending()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save()
            if (e.key === "Escape") dialog.close()
          }}
        />
      </div>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" onClick={save} disabled={pending() || !draft().trim()}>
          {language.t("common.save")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function DialogDeleteSession(props: { c: AppSidebarController; session: Session }) {
  const language = props.c.language
  const dialog = useDialog()
  const name = () => sessionTitle(props.session.title) ?? language.t("command.session.new")
  const [pending, setPending] = createSignal(false)

  const handleDelete = async () => {
    setPending(true)
    await props.c.sessions.session.remove(props.session)
    setPending(false)
    dialog.close()
  }

  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.delete.title")}
          description={language.t("session.delete.confirm", { name: name() })}
        />
      </DialogHeader>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" onClick={handleDelete} disabled={pending()}>
          {language.t("session.delete.button")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function DialogShareSession(props: { c: AppSidebarController; session: Session }) {
  const language = props.c.language
  const dialog = useDialog()
  const [url, setUrl] = createSignal<string | undefined>(undefined)
  const [publishing, setPublishing] = createSignal(false)
  const [unpublishing, setUnpublishing] = createSignal(false)

  // Publish on open if no URL yet.
  void (async () => {
    setPublishing(true)
    const result = await props.c.sessions.session.share(props.session)
    setUrl(result)
    setPublishing(false)
  })()

  const copy = () => {
    const link = url()
    if (!link) return
    void navigator.clipboard
      .writeText(link)
      .then(() =>
        showToast({ variant: "success", icon: "circle-check", title: language.t("session.share.copy.copied"), description: link }),
      )
      .catch((err: unknown) =>
        showToast({ title: language.t("common.requestFailed"), description: errorMessage(err) }),
      )
  }

  const unshare = async () => {
    setUnpublishing(true)
    await props.c.sessions.session.unshare(props.session)
    setUnpublishing(false)
    setUrl(undefined)
  }

  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.share.popover.title")}
          description={
            url()
              ? language.t("session.share.popover.description.shared")
              : language.t("session.share.popover.description.unshared")
          }
        />
      </DialogHeader>
      <div class="flex flex-col gap-3 px-3 pb-1">
        <Show
          when={url()}
          fallback={
            <ButtonV2 variant="contrast" class="w-full" disabled>
              {publishing() ? language.t("session.share.action.publishing") : language.t("session.share.action.publish")}
            </ButtonV2>
          }
        >
          <div class="flex items-center gap-2">
            <input
              class="h-8 min-w-0 flex-1 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base outline-none"
              value={url() ?? ""}
              readOnly
            />
            <ButtonV2 variant="outline" onClick={copy}>
              {language.t("session.share.copy.copyLink")}
            </ButtonV2>
          </div>
        </Show>
      </div>
      <DialogFooter>
        <Show when={url()}>
          <ButtonV2 variant="ghost" onClick={unshare} disabled={unpublishing()}>
            {unpublishing() ? language.t("session.share.action.unpublishing") : language.t("session.share.action.unpublish")}
          </ButtonV2>
        </Show>
        <ButtonV2 variant="contrast" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}