import { tauriApi } from '../services/tauriApi';
import type { FileItem } from '../types';

export class FileExplorer {
  private container: HTMLElement;
  private addFolderBtn?: HTMLElement;
  private welcomeOpenFolderBtn?: HTMLElement;
  private ctxMenu: HTMLElement;
  private ctxRemoveProjectItem: HTMLElement;
  private contextTargetPath: string | null = null;
  private roots: string[] = [];
  private onOpenFile: (path: string, name: string) => void;

  constructor(onOpenFile: (path: string, name: string) => void) {
    this.container = document.getElementById('folder-tree')!;
    this.addFolderBtn = document.getElementById('add-folder-btn') ?? undefined;
    this.welcomeOpenFolderBtn = document.getElementById('welcome-open-folder') ?? undefined;
    this.ctxMenu = document.getElementById('sidebar-context-menu')!;
    this.ctxRemoveProjectItem = document.getElementById('ctx-remove-project')!;
    this.onOpenFile = onOpenFile;
    this.bindUI();
    this.restoreRoots();
  }

  private bindUI() {
    this.addFolderBtn?.addEventListener('click', () => this.openFolder());
    this.welcomeOpenFolderBtn?.addEventListener('click', () => this.openFolder());

    this.ctxRemoveProjectItem.addEventListener('click', () => {
      if (this.contextTargetPath) this.removeRoot(this.contextTargetPath);
      this.hideContextMenu();
    });
    const dismiss = () => this.hideContextMenu();
    document.addEventListener('click', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
  }

  async openFolder() {
    try {
      const picked = await tauriApi.openFolderDialog();
      if (!picked) return;
      this.addRoot(picked);
    } catch (e) { console.error('openFolder failed', e); }
  }

  addRoot(path: string, persist: boolean = true) {
    if (this.roots.includes(path)) return;
    if (persist) { this.roots.push(path); this.saveRoots(); }

    const el = document.createElement('div');
    el.className = 'folder-item collapsed';
    el.textContent = this.basename(path);
    el.dataset.path = path;
    el.dataset.root = 'true';
    el.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFolder(el); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.contextTargetPath = path; this.showContextMenu(e.clientX, e.clientY); });
    this.container.appendChild(el);
  }

  private removeRoot(path: string) {
    const roots = Array.from(this.container.querySelectorAll<HTMLElement>('[data-root="true"]'));
    for (const el of roots) {
      if (el.dataset.path === path) {
        const next = el.nextElementSibling as HTMLElement | null;
        if (next && next.classList.contains('subtree') && next.dataset.parentPath === path) next.remove();
        el.remove();
        break;
      }
    }
    this.roots = this.roots.filter(p => p !== path);
    this.saveRoots();
  }

  private renderTree(entries: FileItem[], container: HTMLElement) {
    container.innerHTML = '';
    entries.sort((a, b) => (a.is_dir === b.is_dir) ? a.name.localeCompare(b.name) : (a.is_dir ? -1 : 1));
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const el = document.createElement('div');
      el.className = entry.is_dir ? 'folder-item collapsed' : 'file-item';
      el.textContent = entry.name;
      el.dataset.path = entry.path;
      if (entry.is_dir) el.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFolder(el); });
      else el.addEventListener('click', () => this.onOpenFile(entry.path, entry.name));
      frag.appendChild(el);
    }
    container.appendChild(frag);
  }

  private async toggleFolder(element: HTMLElement) {
    const path = element.dataset.path!;
    const isExpanded = element.classList.contains('expanded');
    const next = element.nextElementSibling as HTMLElement | null;
    const hasSubtree = next && next.classList.contains('subtree') && next.dataset.parentPath === path;
    if (isExpanded) {
      element.classList.remove('expanded'); element.classList.add('collapsed'); if (hasSubtree && next) next.remove(); return;
    }
    element.classList.remove('collapsed'); element.classList.add('expanded');
    try {
      const entries = await tauriApi.readDir(path);
      const sub = document.createElement('div');
      sub.className = 'subtree';
      sub.dataset.parentPath = path;
      sub.style.paddingLeft = '16px';
      this.renderTree(entries, sub);
      element.parentNode!.insertBefore(sub, element.nextSibling);
    } catch (e) { console.error('Failed to load subdirectory', e); }
  }

  private restoreRoots() {
    try {
      const raw = localStorage.getItem('editrion.projectRoots');
      if (!raw) return;
      const paths: string[] = JSON.parse(raw);
      const unique = Array.from(new Set(paths)).filter(Boolean);
      this.roots = [];
      unique.forEach(p => this.addRoot(p, false));
      this.roots = unique;
      this.saveRoots();
    } catch (e) { console.error('Failed to restore project roots', e); }
  }

  private saveRoots() {
    try { localStorage.setItem('editrion.projectRoots', JSON.stringify(this.roots)); } catch {}
  }

  clearAllRoots() {
    // Remove all root elements and their subtrees
    const roots = Array.from(this.container.querySelectorAll<HTMLElement>('[data-root="true"]'));
    for (const el of roots) {
      const path = el.dataset.path || '';
      const next = el.nextElementSibling as HTMLElement | null;
      if (next && next.classList.contains('subtree') && next.dataset.parentPath === path) next.remove();
      el.remove();
    }
    this.roots = [];
    this.saveRoots();
  }

  private showContextMenu(x: number, y: number) {
    const menu = this.ctxMenu;
    menu.classList.remove('hidden');
    const { innerWidth, innerHeight } = window;
    const rect = menu.getBoundingClientRect();
    const posX = Math.min(x, innerWidth - rect.width - 4);
    const posY = Math.min(y, innerHeight - rect.height - 4);
    menu.style.left = `${posX}px`; menu.style.top = `${posY}px`;
  }

  private hideContextMenu() { this.ctxMenu.classList.add('hidden'); this.contextTargetPath = null; }

  private basename(path: string): string { const parts = path.split(/[/\\]/); return parts.pop() || path; }
}
