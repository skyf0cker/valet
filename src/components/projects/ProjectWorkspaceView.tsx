import React, { useEffect, useMemo, useRef, useState } from "react";
import { useValet } from "../../store/ValetContext";
import { DEFAULT_PROJECT_ID } from "../../types/valet";
import { countUnreadThreads } from "../../utils/chatUnread";
import { getPageBreadcrumbs } from "../../utils/notebookPages";
import { SidebarToggleButton } from "../Sidebar";
import { ChatView } from "../chat/ChatView";
import { FileTextIcon, MoreHorizontalIcon, PlusIcon, ProjectGlyph } from "../ui/Icons";
import { Modal } from "../ui/Modal";
import { CreateProjectModal } from "./CreateProjectModal";
import {
  ProjectNotebookView,
  exportPageMarkdownFile,
  exportProjectMarkdownFile,
} from "./ProjectNotebookView";
import { ProjectSessionsView } from "./ProjectSessionsView";

export const ProjectWorkspaceView: React.FC = () => {
  const {
    state,
    unreadChatCounts,
    sidebarCollapsed,
    setProjectTab,
    selectProject,
    openProjectPage,
    createProjectPage,
    deleteProjectPage,
    createNewChat,
    deleteProject,
  } = useValet();

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePageConfirmOpen, setDeletePageConfirmOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const activeProject = useMemo(
    () =>
      state.projects.find((p) => p.id === state.activeProjectId && !p.archived) ??
      state.projects.find((p) => p.id === DEFAULT_PROJECT_ID) ??
      state.projects[0],
    [state.activeProjectId, state.projects]
  );

  const activePage = useMemo(() => {
    if (state.activeProjectTab !== "page" || !state.activePageId || !activeProject) {
      return null;
    }
    return (activeProject.pages ?? []).find((p) => p.id === state.activePageId) ?? null;
  }, [activeProject, state.activePageId, state.activeProjectTab]);

  const pageBreadcrumbs = useMemo(() => {
    if (!activeProject || !activePage) return [];
    return getPageBreadcrumbs(activeProject, activePage.id);
  }, [activePage, activeProject]);

  useEffect(() => {
    setDeletePageConfirmOpen(false);
  }, [activePage?.id]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreMenuOpen]);

  if (!activeProject) return null;

  if (state.activeProjectTab === "session") {
    return <ChatView />;
  }

  const projectThreads = state.chatThreads.filter(
    (t) => (t.projectId || DEFAULT_PROJECT_ID) === activeProject.id
  );
  const activeSessionCount = projectThreads.filter((t) => !t.archived).length;
  const projectUnreadCount = countUnreadThreads(unreadChatCounts, projectThreads);
  const activeTab =
    state.activeProjectTab === "sessions"
      ? "sessions"
      : state.activeProjectTab === "page" && activePage
        ? "page"
        : "notebook";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {/* Project Top Toolbar */}
      <header
        className={`app-drag flex shrink-0 items-center gap-2.5 border-b border-[var(--border-light)] ${
          sidebarCollapsed ? "h-[44px] px-[22px]" : "h-[52px] px-6"
        }`}
      >
        <SidebarToggleButton />

        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => selectProject(activeProject.id, "notebook")}
            className="app-no-drag shrink-0 cursor-pointer rounded-[5px] px-1 py-0.5 text-[12.5px] text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
          >
            项目
          </button>
          <span className="shrink-0 text-[12px] text-[var(--ink-subtle)]">/</span>
          {activePage ? (
            <>
              <button
                type="button"
                onClick={() => selectProject(activeProject.id, "notebook")}
                className="app-no-drag inline-flex max-w-[140px] shrink-0 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[12.5px] font-medium text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                title={`返回「${activeProject.title}」Notebook`}
              >
                <ProjectGlyph
                  icon={activeProject.icon}
                  size={13}
                  className="shrink-0 text-[var(--ink-muted)]"
                />
                <span className="truncate">{activeProject.title}</span>
              </button>
              {pageBreadcrumbs.slice(0, -1).map((crumb) => (
                <React.Fragment key={crumb.id}>
                  <span className="shrink-0 text-[12px] text-[var(--ink-subtle)]">/</span>
                  <button
                    type="button"
                    onClick={() => openProjectPage(activeProject.id, crumb.id)}
                    className="app-no-drag max-w-[120px] shrink-0 cursor-pointer truncate rounded-[5px] px-1.5 py-0.5 text-[12.5px] text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                    title={crumb.title || "未命名页面"}
                  >
                    {crumb.title || "未命名页面"}
                  </button>
                </React.Fragment>
              ))}
              <span className="shrink-0 text-[12px] text-[var(--ink-subtle)]">/</span>
              <FileTextIcon size={13} className="shrink-0 text-[var(--ink-primary)]" />
              <span className="min-w-0 truncate text-[13.5px] font-semibold text-[var(--ink-strong)]">
                {activePage.title || "未命名页面"}
              </span>
            </>
          ) : (
            <>
              <ProjectGlyph
                icon={activeProject.icon}
                size={13.5}
                className="shrink-0 text-[var(--ink-muted)]"
              />
              <span className="min-w-0 truncate text-[13.5px] font-semibold text-[var(--ink-strong)]">
                {activeProject.title}
              </span>
            </>
          )}
        </div>

        <span className="shrink-0 rounded-[5px] border border-[var(--border-light)] bg-[var(--bg-subtle)] px-1.5 py-[1px] font-mono text-[10px] text-[var(--ink-muted)]">
          {activeProject.isDefault ? "系统默认" : "已自动保存"}
        </span>

        <div className="flex-1" />

        {/* Segmented Tab Control */}
        <div className="app-no-drag inline-flex items-center rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-subtle)] p-[2px]">
          <button
            type="button"
            onClick={() => setProjectTab("notebook")}
            className={`cursor-pointer rounded-[6px] px-2.5 py-1 text-[12px] transition-colors ${
              activeTab === "notebook"
                ? "bg-[var(--bg-elevated)] font-medium text-[var(--ink-strong)] shadow-xs"
                : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            }`}
          >
            Notebook
          </button>
          <button
            type="button"
            onClick={() => setProjectTab("sessions")}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[12px] transition-colors ${
              activeTab === "sessions"
                ? "bg-[var(--bg-elevated)] font-medium text-[var(--ink-strong)] shadow-xs"
                : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            }`}
          >
            <span>会话</span>
            <span className="font-mono text-[10.5px] text-[var(--ink-subtle)]">
              {activeSessionCount}
            </span>
            {projectUnreadCount > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-[var(--duty-dot)] px-1.5 py-[1px] font-mono text-[9.5px] font-bold leading-none text-[var(--ink-on-primary)]"
                title={`${projectUnreadCount} 个未读会话`}
              >
                {projectUnreadCount} 未读
              </span>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={() =>
            void createProjectPage({
              projectId: activeProject.id,
              parentPageId: activePage?.id,
              switchToPage: true,
            })
          }
          className={`app-no-drag inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 text-[12px] font-medium text-[var(--ink-strong)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] lg:rounded-[8px] ${
            sidebarCollapsed ? "h-[26px]" : "h-[30px]"
          }`}
        >
          <FileTextIcon size={12} />
          <span>{activePage ? "新建子页面" : "新建页面"}</span>
        </button>

        <button
          type="button"
          onClick={() => createNewChat(activeProject.id)}
          className={`app-no-drag inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 text-[12px] font-medium text-[var(--ink-strong)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] lg:rounded-[8px] ${
            sidebarCollapsed ? "h-[26px]" : "h-[30px]"
          }`}
        >
          <PlusIcon size={12} />
          <span>新建对话</span>
        </button>

        {/* More Actions Menu */}
        <div ref={moreMenuRef} className="app-no-drag relative">
          <button
            type="button"
            aria-label="项目操作菜单"
            onClick={() => setMoreMenuOpen((v) => !v)}
            className={`flex shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)] lg:rounded-[8px] ${
              sidebarCollapsed ? "h-[26px] w-[26px]" : "h-[30px] w-[30px]"
            }`}
          >
            <MoreHorizontalIcon size={14} />
          </button>

          {moreMenuOpen && (
            <div className="animate-valet-modal-in absolute top-full right-0 z-50 mt-1.5 w-44 overflow-hidden rounded-[10px] border border-[var(--border-control)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-popover)]">
              {activePage ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      exportPageMarkdownFile(
                        activeProject,
                        activePage,
                        projectThreads,
                        state.projects
                      );
                    }}
                    className="flex w-full cursor-pointer items-center rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-body)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                  >
                    导出页面 (.md)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void createProjectPage({
                        projectId: activeProject.id,
                        parentPageId: activePage.id,
                        switchToPage: true,
                      });
                    }}
                    className="flex w-full cursor-pointer items-center rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-body)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                  >
                    新建子页面
                  </button>
                  <div className="my-1 border-t border-[var(--border-light)]" />
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setDeletePageConfirmOpen(true);
                    }}
                    className="flex w-full cursor-pointer items-center rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--danger-fg,#c53030)] hover:bg-[var(--bg-subtle)]"
                  >
                    删除页面
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      exportProjectMarkdownFile(
                        activeProject,
                        projectThreads,
                        state.projects
                      );
                    }}
                    className="flex w-full cursor-pointer items-center rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-body)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                  >
                    导出 Notebook (.md)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void createProjectPage({
                        projectId: activeProject.id,
                        switchToPage: true,
                      });
                    }}
                    className="flex w-full cursor-pointer items-center rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-body)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                  >
                    新建页面
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setCreateModalOpen(true);
                    }}
                    className="flex w-full cursor-pointer items-center rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-body)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                  >
                    新建项目
                  </button>
                  {!activeProject.isDefault && (
                    <>
                      <div className="my-1 border-t border-[var(--border-light)]" />
                      <button
                        type="button"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          setDeleteConfirmOpen(true);
                        }}
                        className="flex w-full cursor-pointer items-center rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--danger-fg,#c53030)] hover:bg-[var(--bg-subtle)]"
                      >
                        删除项目
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "sessions" ? (
          <ProjectSessionsView project={activeProject} />
        ) : activePage ? (
          <ProjectNotebookView project={activeProject} page={activePage} />
        ) : (
          <ProjectNotebookView project={activeProject} />
        )}
      </div>

      <CreateProjectModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} />

      <Modal
        open={deletePageConfirmOpen && Boolean(activePage)}
        onClose={() => setDeletePageConfirmOpen(false)}
        title={`删除页面「${activePage?.title || "未命名页面"}」`}
        subtitle="该操作不可撤销；直属子页面不会丢失"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-[20px] text-[var(--ink-body)]">
            删除后，当前页面的文档内容将被移除；若该页面包含子页面，其直接子页面将自动提升至上一级，不会被连带删除。
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeletePageConfirmOpen(false)}
              className="h-[34px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3.5 text-[12px] font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                if (!activePage) return;
                setDeletePageConfirmOpen(false);
                deleteProjectPage(activeProject.id, activePage.id);
              }}
              className="h-[34px] cursor-pointer rounded-[8px] bg-[var(--danger-fg,#c53030)] px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              确认删除页面
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title={`删除项目「${activeProject.title}」`}
        subtitle="该操作不可撤销；项目下的会话不会丢失"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-[20px] text-[var(--ink-body)]">
            删除后，本项目下的{" "}
            <span className="font-mono font-medium text-[var(--ink-strong)]">
              {projectThreads.length}
            </span>{" "}
            个会话将自动安全迁移至「默认项目」，而 Notebook 文档内容将被移除。
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(false)}
              className="h-[34px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3.5 text-[12px] font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteConfirmOpen(false);
                deleteProject(activeProject.id);
              }}
              className="h-[34px] cursor-pointer rounded-[8px] bg-[var(--danger-fg,#c53030)] px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              确认删除项目
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
