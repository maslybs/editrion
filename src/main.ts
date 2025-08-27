import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import * as monaco from 'monaco-editor';
// Enable language features (formatting, diagnostics) for common languages
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import './style.css';
import { initI18n, setLocale, t, registerDictionaries, applyTranslations } from './i18n';
import en from './locales/en.json';
import uk from './locales/uk.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ja from './locales/ja.json';
import de from './locales/de.json';

interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
}

interface Tab {
  id: string;
  name: string;
  path: string;
  editor?: monaco.editor.IStandaloneCodeEditor;
  isDirty: boolean;
  // Keep track of search highlight decorations for this tab
  searchDecorationIds?: string[];
  originalContent?: string;
}

class Editrion {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private tabsContainer: HTMLElement;
  private editorContainer: HTMLElement;
  private sidebarContainer: HTMLElement;
  private searchPanel: HTMLElement;
  private searchInput: HTMLInputElement;
  private searchCount: HTMLElement;
  private caseSensitiveBtn: HTMLElement;
  private wholeWordBtn: HTMLElement;
  private regexBtn: HTMLElement;
  private welcomeContainer: HTMLElement;
  private addFolderBtn?: HTMLElement;
  // Removed sidebar toggle in favor of menu actions
  private welcomeOpenFileBtn?: HTMLElement;
  private welcomeOpenFolderBtn?: HTMLElement;
  private tabContextMenu!: HTMLElement;
  private ctxCloseOthersItem!: HTMLElement;
  private ctxCloseRightItem!: HTMLElement;
  private contextTargetTabId: string | null = null;
  private sidebarContextMenu!: HTMLElement;
  private ctxRemoveProjectItem!: HTMLElement;
  private sidebarContextTargetPath: string | null = null;
  private projectRoots: string[] = [];
  private searchOptions = {
    caseSensitive: false,
    wholeWord: false,
    regex: false
  };
  private searchDebounceHandle: number | null = null;
  private readonly searchDebounceMs = 150;
  private readonly maxSearchHighlights = 500;
  private uiTheme: 'dark' | 'light' | 'custom' = 'dark';
  private customThemeVars: string[] = [];
  private draftsDir: string | null = null;
  private draftSaveTimers: Record<string, number> = {};
  
  constructor() {
    this.tabsContainer = document.getElementById('tabs')!;
    this.editorContainer = document.getElementById('editor-container')!;
    this.sidebarContainer = document.getElementById('folder-tree')!;
    this.searchPanel = document.getElementById('search-panel')!;
    this.searchInput = document.getElementById('search-input')! as HTMLInputElement;
    this.searchCount = document.getElementById('search-results-count')!;
    this.caseSensitiveBtn = document.getElementById('case-sensitive-btn')!;
    this.wholeWordBtn = document.getElementById('whole-word-btn')!;
    this.regexBtn = document.getElementById('regex-btn')!;
    this.welcomeContainer = document.getElementById('welcome')!;
    this.addFolderBtn = document.getElementById('add-folder-btn') ?? undefined;
    this.welcomeOpenFileBtn = document.getElementById('welcome-open-file') ?? undefined;
    this.welcomeOpenFolderBtn = document.getElementById('welcome-open-folder') ?? undefined;
    this.tabContextMenu = document.getElementById('tab-context-menu')!;
    this.ctxCloseOthersItem = document.getElementById('ctx-close-others')!;
    this.ctxCloseRightItem = document.getElementById('ctx-close-right')!;
    this.sidebarContextMenu = document.getElementById('sidebar-context-menu')!;
    this.ctxRemoveProjectItem = document.getElementById('ctx-remove-project')!;

    // i18n dictionaries and initialization
    registerDictionaries('en', en as any);
    registerDictionaries('uk', uk as any);
    registerDictionaries('es', es as any);
    registerDictionaries('fr', fr as any);
    registerDictionaries('ja', ja as any);
    registerDictionaries('de', de as any);
    initI18n();
    applyTranslations();

    // Build native menu with current locale labels
    this.updateNativeMenuLabels();

    this.init();
  }
  
  private async init() {
    // Load and apply UI theme before editor init
    const savedTheme = localStorage.getItem('editrion.theme');
    if (savedTheme && savedTheme.startsWith('custom:')) {
      const name = savedTheme.slice('custom:'.length);
      const raw = localStorage.getItem('editrion.customThemes');
      const map = raw ? JSON.parse(raw) as Record<string, any> : {};
      const def = map[name];
      if (def) {
        this.applyCustomTheme(name, def);
      } else {
        this.setBuiltInTheme('dark');
      }
    } else if (savedTheme === 'light' || savedTheme === 'dark') {
      this.setBuiltInTheme(savedTheme);
    } else {
      this.setBuiltInTheme('dark');
    }

    // Setup Monaco theme
    monaco.editor.defineTheme('sublime-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'f8f8f2', background: '272822' },
        { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f92672' },
        { token: 'string', foreground: 'e6db74' },
        { token: 'number', foreground: 'ae81ff' },
        { token: 'regexp', foreground: 'fd971f' },
        { token: 'type', foreground: '66d9ef' },
        { token: 'function', foreground: 'a6e22e' },
      ],
      colors: {
        'editor.background': '#272822',
        'editor.foreground': '#f8f8f2',
        'editor.selectionBackground': '#49483e',
        'editor.lineHighlightBackground': '#3e3d32',
        'editorCursor.foreground': '#f8f8f0',
        'editorWhitespace.foreground': '#3b3a32',
        'editorIndentGuide.activeBackground': '#9d550fb0',
        'editor.selectionHighlightBorder': '#222218',
      }
    });
    // Monaco theme is applied in setBuiltInTheme/applyCustomTheme
    
    // Don't load directory by default - only when project is opened
    
    // Sidebar and welcome actions
    this.addFolderBtn?.addEventListener('click', () => this.openFolder());
    this.welcomeOpenFileBtn?.addEventListener('click', () => this.openFile());
    this.welcomeOpenFolderBtn?.addEventListener('click', () => this.openFolder());

    // Language switcher now moved to app menu (Settings -> Language)

    // Disable default browser context menu outside Monaco editor
    document.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.monaco-editor')) {
        e.preventDefault();
      }
    });

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();
    
    // Setup search panel
    this.setupSearchPanel();
    
    // Setup menu event listeners
    this.setupMenuListeners();

    // Initial UI state
    this.updateWelcomeState();

    // Context menu and tab scrolling
    this.setupTabContextMenu();
    this.setupSidebarContextMenu();

    // Restore saved projects
    this.restoreProjects();

    // Prepare drafts directory and try restoring drafts
    try {
      this.draftsDir = await invoke<string>('drafts_dir');
      await this.restoreDrafts();
    } catch (e) {
      console.warn('Drafts unavailable:', e);
    }
  }

  private async updateNativeMenuLabels() {
    // Pass translated labels to backend to rebuild native menu
    const labels = {
      'menu.file': t('menu.file'),
      'menu.edit': t('menu.edit'),
      'menu.view': t('menu.view'),
      'menu.window': t('menu.window'),
      'menu.settings': t('menu.settings'),
      'menu.language': t('menu.language'),
      'menu.theme': t('menu.theme'),

      'menu.item.newFile': t('menu.item.newFile'),
      'menu.item.openFile': t('menu.item.openFile'),
      'menu.item.openFolder': t('menu.item.openFolder'),
      'menu.item.save': t('menu.item.save'),
      'menu.item.saveAs': t('menu.item.saveAs'),
      'menu.item.closeTab': t('menu.item.closeTab'),
      'menu.item.quit': t('menu.item.quit'),

      // Edit menu items
      'menu.item.undo': t('menu.item.undo'),
      'menu.item.redo': t('menu.item.redo'),
      'menu.item.cut': t('menu.item.cut'),
      'menu.item.copy': t('menu.item.copy'),
      'menu.item.paste': t('menu.item.paste'),

      'menu.item.find': t('menu.item.find'),
      'menu.item.replace': t('menu.item.replace'),
      'menu.item.selectAllOccurrences': t('menu.item.selectAllOccurrences'),

      'menu.item.theme.dark': t('menu.item.theme.dark'),
      'menu.item.theme.light': t('menu.item.theme.light'),
      'menu.item.theme.loadCustom': t('menu.item.theme.loadCustom'),

      'menu.item.window.show': t('menu.item.window.show'),

      'menu.item.lang.en': t('menu.item.lang.en'),
      'menu.item.lang.uk': t('menu.item.lang.uk'),
      'menu.item.lang.es': t('menu.item.lang.es'),
      'menu.item.lang.fr': t('menu.item.lang.fr'),
      'menu.item.lang.ja': t('menu.item.lang.ja'),
      'menu.item.lang.de': t('menu.item.lang.de'),
    } as Record<string, string>;
    try {
      await invoke('rebuild_menu', { labels });
    } catch (e) {
      console.warn('Failed to rebuild native menu:', e);
    }
  }

  private setBuiltInTheme(theme: 'dark' | 'light') {
    this.uiTheme = theme;
    document.body.setAttribute('data-theme', theme);
    // Clear any custom CSS var overrides
    const root = document.documentElement;
    for (const key of this.customThemeVars) {
      root.style.removeProperty(`--${key}`);
    }
    this.customThemeVars = [];
    localStorage.setItem('editrion.theme', theme);
    monaco.editor.setTheme(theme === 'dark' ? 'sublime-dark' : 'vs');
  }

  private applyCustomTheme(name: string, def: any) {
    this.uiTheme = 'custom';
    document.body.setAttribute('data-theme', 'custom');
    const root = document.documentElement;
    // Apply UI vars from def.ui; accept keys with or without leading --
    this.customThemeVars = [];
    const ui = def.ui || {};
    for (const rawKey of Object.keys(ui)) {
      const key = rawKey.startsWith('--') ? rawKey.substring(2) : rawKey;
      const val = ui[rawKey];
      root.style.setProperty(`--${key}`, String(val));
      this.customThemeVars.push(key);
    }
    // Define Monaco theme
    const monacoDef = def.monaco || { base: 'vs-dark', inherit: true, rules: [], colors: {} };
    const themeId = `custom-${name}`;
    try {
      monaco.editor.defineTheme(themeId, monacoDef);
      monaco.editor.setTheme(themeId);
    } catch (_) {
      // Fallback to dark if invalid
      monaco.editor.setTheme('sublime-dark');
    }
    // Persist custom theme
    const raw = localStorage.getItem('editrion.customThemes');
    const map = raw ? JSON.parse(raw) as Record<string, any> : {};
    map[name] = def;
    localStorage.setItem('editrion.customThemes', JSON.stringify(map));
    localStorage.setItem('editrion.theme', `custom:${name}`);
  }

  private async loadCustomThemeFromFile() {
    try {
      const paths = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
      const path = Array.isArray(paths) ? paths[0] : paths;
      if (!path) return;
      const content = await invoke<string>('read_file', { path });
      const def = JSON.parse(content);
      const name = def.name || 'custom';
      this.applyCustomTheme(String(name), def);
    } catch (e) {
      console.error('Failed to load custom theme:', e);
      alert(t('alert.failedToLoadCustomTheme'));
    }
  }

  private basename(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts.pop() || path;
  }
  
  // Legacy single-folder loader (unused now). Kept for reference.
  public async loadDirectory(path: string) {
    try {
      const root = document.createElement('div');
      root.className = 'folder-item collapsed';
      root.textContent = path.split('/').pop() || path;
      root.dataset.path = path;
      root.addEventListener('click', () => this.toggleFolder(root));
      this.sidebarContainer.appendChild(root);
    } catch (error) {
      console.error('Failed to load directory:', error);
    }
  }

  private addProjectRoot(path: string, persist: boolean = true) {
    if (!this.projectRoots.includes(path)) {
      if (persist) {
        this.projectRoots.push(path);
        this.saveProjectRoots();
      }
    } else if (persist) {
      // Already present; do not add duplicate UI entry
      return;
    }

    const root = document.createElement('div');
    root.className = 'folder-item collapsed';
    root.textContent = this.basename(path);
    root.dataset.path = path;
    root.dataset.root = 'true';
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFolder(root);
    });
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.sidebarContextTargetPath = path;
      this.showSidebarContextMenu(e.clientX, e.clientY);
    });
    this.sidebarContainer.appendChild(root);
  }

  private saveProjectRoots() {
    try {
      localStorage.setItem('editrion.projectRoots', JSON.stringify(this.projectRoots));
    } catch (e) {
      console.error('Failed to save project roots', e);
    }
  }

  private restoreProjects() {
    try {
      const raw = localStorage.getItem('editrion.projectRoots');
      if (!raw) return;
      const paths: string[] = JSON.parse(raw);
      const unique = Array.from(new Set(paths)).filter(Boolean);
      this.projectRoots = [];
      unique.forEach(p => this.addProjectRoot(p, false));
      this.projectRoots = unique;
      this.saveProjectRoots();
    } catch (e) {
      console.error('Failed to restore project roots', e);
    }
  }
  
  private renderFileTree(entries: FileItem[], container: HTMLElement) {
    container.innerHTML = '';

    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      return a.name.localeCompare(b.name);
    });

    const frag = document.createDocumentFragment();
    entries.forEach(entry => {
      const element = document.createElement('div');
      element.className = entry.is_dir ? 'folder-item collapsed' : 'file-item';
      element.textContent = entry.name;
      element.dataset.path = entry.path;

      if (entry.is_dir) {
        element.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFolder(element); });
      } else {
        element.addEventListener('click', () => this.openFileFromTree(entry.path, entry.name));
      }

      frag.appendChild(element);
    });
    container.appendChild(frag);
  }
  
  private async toggleFolder(element: HTMLElement) {
    const path = element.dataset.path!;
    const isExpanded = element.classList.contains('expanded');

    // Find existing subcontainer right after this element
    const nextSibling = element.nextElementSibling as HTMLElement | null;
    const hasSubtree = nextSibling && nextSibling.classList.contains('subtree') && nextSibling.dataset.parentPath === path;

    if (isExpanded) {
      element.classList.remove('expanded');
      element.classList.add('collapsed');
      if (hasSubtree && nextSibling) {
        nextSibling.remove();
      }
      return;
    }

    element.classList.remove('collapsed');
    element.classList.add('expanded');

    try {
      const entries: FileItem[] = await invoke('read_dir', { path });
      const subContainer = document.createElement('div');
      subContainer.className = 'subtree';
      subContainer.dataset.parentPath = path;
      subContainer.style.paddingLeft = '16px';
      this.renderFileTree(entries, subContainer);
      element.parentNode!.insertBefore(subContainer, element.nextSibling);
    } catch (error) {
      console.error('Failed to load subdirectory:', error);
    }
  }
  
  private async openFileFromTree(path: string, name: string) {
    // Check if file is already open
    const existingTab = this.tabs.find(tab => tab.path === path);
    if (existingTab) {
      this.switchToTab(existingTab.id);
      return;
    }
    
    try {
      const tabId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? (crypto as any).randomUUID()
        : Date.now().toString();
      const isImage = this.isImagePath(path);
      let content: string | null = null;
      if (!isImage) {
        content = await invoke('read_file', { path });
      }
      const tab: Tab = { id: tabId, name, path, isDirty: false, originalContent: content ?? '' };
      this.tabs.push(tab);
      this.renderTabs();
      if (isImage) {
        this.createImageViewer(tab);
      } else {
        this.createEditor(tab, content || '');
      }
      this.switchToTab(tabId);
    } catch (error) {
      console.error('Failed to open file:', error);
      alert(t('alert.failedToOpenFile', { error: String(error) }));
    }
  }
  
  private renderTabs() {
    this.tabsContainer.innerHTML = '';

    const frag = document.createDocumentFragment();
    this.tabs.forEach(tab => {
      const tabElement = document.createElement('div');
      tabElement.className = `tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabElement.dataset.tabId = tab.id;

      const titleSpan = document.createElement('span');
      // Avoid XSS by using textContent instead of innerHTML
      titleSpan.textContent = tab.name + (tab.isDirty ? ' •' : '');

      const closeSpan = document.createElement('span');
      closeSpan.className = 'close';
      closeSpan.dataset.tabId = tab.id;
      closeSpan.textContent = '✕';

      tabElement.appendChild(titleSpan);
      tabElement.appendChild(closeSpan);

      tabElement.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('close')) {
          this.closeTab(tab.id);
        } else {
          this.switchToTab(tab.id);
        }
      });

      tabElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.contextTargetTabId = tab.id;
        this.showTabContextMenu(e.clientX, e.clientY);
      });

      frag.appendChild(tabElement);
    });
    this.tabsContainer.appendChild(frag);
    this.updateWelcomeState();
  }
  
  private createEditor(tab: Tab, content: string) {
    const editorElement = document.createElement('div');
    editorElement.id = `editor-${tab.id}`;
    editorElement.style.width = '100%';
    editorElement.style.height = '100%';
    editorElement.style.display = 'none';
    
    this.editorContainer.appendChild(editorElement);
    
    const editor = monaco.editor.create(editorElement, {
      value: content,
      language: this.getLanguageFromPath(tab.path),
      theme: this.uiTheme === 'dark' ? 'sublime-dark' : 'vs',
      automaticLayout: true,
      fontSize: 14,
      lineHeight: 20,
      fontFamily: 'Consolas, Monaco, Menlo, "Ubuntu Mono", monospace',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      folding: true,
      renderWhitespace: 'selection',
      multiCursorModifier: 'ctrlCmd',
      formatOnPaste: true,
      formatOnType: true,
      selectionHighlight: true,
      occurrencesHighlight: 'singleFile',
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: 'never',
        seedSearchStringFromSelection: 'always'
      }
    });
    
    // Enable multi-cursor with Cmd+Click (Mac) / Ctrl+Click (Windows/Linux)
    tab.originalContent = tab.originalContent ?? content;
    editor.onDidChangeModelContent(() => {
      const current = editor.getValue();
      const baseline = tab.originalContent ?? '';
      const wasDirty = tab.isDirty;
      tab.isDirty = current !== baseline;
      if (tab.isDirty !== wasDirty) {
        this.renderTabs();
      }
      if (this.draftsDir) {
        if (this.draftSaveTimers[tab.id]) {
          clearTimeout(this.draftSaveTimers[tab.id]);
        }
        this.draftSaveTimers[tab.id] = window.setTimeout(() => {
          this.saveDraft(tab).catch(err => console.warn('Failed to save draft', err));
        }, 400);
      }
    });
    
    // Save on Cmd+S / Ctrl+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      this.saveFile(tab);
    });
    
    // Custom search on Cmd+F / Ctrl+F
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      this.showSearch();
    });

    // Format document on Shift+Alt+F (standard Monaco/VS Code binding)
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      editor.getAction('editor.action.formatDocument')?.run();
    });
    
    tab.editor = editor;
  }

  private createImageViewer(tab: Tab) {
    const viewerElement = document.createElement('div');
    viewerElement.id = `editor-${tab.id}`;
    viewerElement.className = 'image-viewer';
    viewerElement.style.width = '100%';
    viewerElement.style.height = '100%';
    viewerElement.style.display = 'none';
    const img = document.createElement('img');
    img.src = convertFileSrc(tab.path);
    img.alt = tab.name;
    viewerElement.appendChild(img);
    this.editorContainer.appendChild(viewerElement);
  }
  
  private getLanguageFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap: { [key: string]: string } = {
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'sql': 'sql',
      'sh': 'shell',
    };
    
    return langMap[ext || ''] || 'plaintext';
  }
  
  private switchToTab(tabId: string) {
    // Hide all editors/viewers
    this.tabs.forEach(tab => {
      const element = document.getElementById(`editor-${tab.id}`);
      if (element) element.style.display = 'none';
    });
    
    // Show active editor
    const activeTab = this.tabs.find(tab => tab.id === tabId);
    if (activeTab) {
      const element = document.getElementById(`editor-${tabId}`);
      if (element) {
        element.style.display = 'block';
        if (activeTab.editor) {
          activeTab.editor.layout();
          activeTab.editor.focus();
          // Ensure minimap is enabled after making editor visible
          requestAnimationFrame(() => {
            activeTab.editor?.updateOptions({ minimap: { enabled: true } });
            activeTab.editor?.layout();
          });
        }
      }
    }
    
    this.activeTabId = tabId;
    this.renderTabs();
  }

  private updateWelcomeState() {
    const hasTabs = this.tabs.length > 0;
    if (hasTabs) {
      this.welcomeContainer.classList.add('hidden');
      this.editorContainer.style.display = 'block';
    } else {
      this.welcomeContainer.classList.remove('hidden');
      this.editorContainer.style.display = 'none';
    }
  }

  private setupTabContextMenu() {
    // Actions
    this.ctxCloseOthersItem.addEventListener('click', () => {
      if (this.contextTargetTabId) {
        this.closeOtherTabs(this.contextTargetTabId);
        this.switchToTab(this.contextTargetTabId);
      }
      this.hideTabContextMenu();
    });
    this.ctxCloseRightItem.addEventListener('click', () => {
      if (this.contextTargetTabId) {
        this.closeTabsToRight(this.contextTargetTabId);
        this.switchToTab(this.contextTargetTabId);
      }
      this.hideTabContextMenu();
    });

    // Dismiss menu
    document.addEventListener('click', () => this.hideTabContextMenu());
    window.addEventListener('blur', () => this.hideTabContextMenu());
    window.addEventListener('resize', () => this.hideTabContextMenu());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideTabContextMenu();
    });

    // Horizontal scroll for tabs (mouse wheel)
    this.tabsContainer.addEventListener('wheel', (e: WheelEvent) => {
      if (e.deltaY !== 0 && !e.shiftKey) {
        e.preventDefault();
        this.tabsContainer.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  private showTabContextMenu(x: number, y: number) {
    const menu = this.tabContextMenu;
    menu.classList.remove('hidden');
    // After showing, measure size to constrain within viewport
    const { innerWidth, innerHeight } = window;
    const rect = menu.getBoundingClientRect();
    const posX = Math.min(x, innerWidth - rect.width - 4);
    const posY = Math.min(y, innerHeight - rect.height - 4);
    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
  }

  private hideTabContextMenu() {
    this.tabContextMenu.classList.add('hidden');
    this.contextTargetTabId = null;
  }

  private setupSidebarContextMenu() {
    this.ctxRemoveProjectItem.addEventListener('click', () => {
      if (this.sidebarContextTargetPath) {
        this.removeProjectRoot(this.sidebarContextTargetPath);
      }
      this.hideSidebarContextMenu();
    });

    const dismiss = () => this.hideSidebarContextMenu();
    document.addEventListener('click', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
  }

  private showSidebarContextMenu(x: number, y: number) {
    const menu = this.sidebarContextMenu;
    menu.classList.remove('hidden');
    const { innerWidth, innerHeight } = window;
    const rect = menu.getBoundingClientRect();
    const posX = Math.min(x, innerWidth - rect.width - 4);
    const posY = Math.min(y, innerHeight - rect.height - 4);
    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
  }

  private hideSidebarContextMenu() {
    this.sidebarContextMenu.classList.add('hidden');
    this.sidebarContextTargetPath = null;
  }

  private removeProjectRoot(path: string) {
    // Remove UI root and its immediate subtree, if present
    const roots = Array.from(this.sidebarContainer.querySelectorAll<HTMLElement>('[data-root="true"]'));
    for (const el of roots) {
      if (el.dataset.path === path) {
        const next = el.nextElementSibling as HTMLElement | null;
        if (next && next.classList.contains('subtree') && next.dataset.parentPath === path) {
          next.remove();
        }
        el.remove();
        break;
      }
    }
    // Update list and persist
    this.projectRoots = this.projectRoots.filter(p => p !== path);
    this.saveProjectRoots();
  }

  private closeOtherTabs(keepTabId: string) {
    const ids = this.tabs.filter(t => t.id !== keepTabId).map(t => t.id);
    ids.forEach(id => this.closeTab(id));
  }

  private closeTabsToRight(startTabId: string) {
    const idx = this.tabs.findIndex(t => t.id === startTabId);
    if (idx === -1) return;
    const ids = this.tabs.slice(idx + 1).map(t => t.id);
    ids.forEach(id => this.closeTab(id));
  }
  
  private async saveFile(tab: Tab) {
    if (!tab.editor) return;
    
    try {
      let filePath = tab.path;
      
      // If it's a new file (starts with Untitled), show save dialog
      if (tab.path.startsWith('Untitled-')) {
        try {
          // Suggest a sensible default name based on language
          const lang = this.getLanguageFromPath(tab.path);
          const langToExt: Record<string, string> = {
            plaintext: 'txt', markdown: 'md', javascript: 'js', typescript: 'ts',
            python: 'py', rust: 'rs', go: 'go', java: 'java', cpp: 'cpp', c: 'c',
            csharp: 'cs', php: 'php', ruby: 'rb', html: 'html', css: 'css', scss: 'scss',
            json: 'json', xml: 'xml', yaml: 'yml', sql: 'sql', shell: 'sh'
          };
          const defaultExt = langToExt[lang] || 'txt';
          const untitled = t('common.untitled');
          const defaultBase = tab.name && tab.name !== untitled ? tab.name : untitled;
          const defaultPath = defaultBase.includes('.') ? defaultBase : `${defaultBase}.${defaultExt}`;
          const savedPath = await save({
            title: t('dialog.saveFile'),
            defaultPath,
            filters: [
              { name: 'Text', extensions: ['txt', 'md', 'log'] },
              { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'scss'] },
              { name: 'Data', extensions: ['json', 'yaml', 'yml', 'xml', 'csv'] },
              { name: 'Scripts', extensions: ['sh', 'py', 'rb', 'php'] },
              { name: 'C/C++', extensions: ['c', 'h', 'cpp', 'hpp'] },
              { name: 'Java/C#/Go/Rust', extensions: ['java', 'cs', 'go', 'rs'] },
              { name: 'Markdown', extensions: ['md'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          });
          
          if (!savedPath) return; // User cancelled
          
          // If user didn't include an extension, append a sensible default
          const hasExt = /\.[^\/\\]+$/.test(savedPath);
          filePath = hasExt ? savedPath : `${savedPath}.${defaultExt}`;
          tab.path = filePath;
          tab.name = this.basename(filePath) || tab.name;
        } catch (error) {
          console.error('Failed to open save dialog:', error);
          // Fallback - ask user to type path
          const path = prompt(t('prompt.enterFilePathToSave'));
          if (!path) return;
          
          filePath = path;
          tab.path = filePath;
          tab.name = filePath.split('/').pop() || tab.name;
        }
      }
      
      const content = tab.editor.getValue();
      await invoke('write_file', { path: filePath, content });
      tab.originalContent = content;
      tab.isDirty = false;
      this.renderTabs();
      if (this.draftsDir) {
        const draftPath = `${this.draftsDir}/${tab.id}.json`;
        try { await invoke('remove_file', { path: draftPath }); } catch {}
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }

  private async saveFileAs(tab: Tab) {
    if (!tab.editor) return;
    try {
      const lang = this.getLanguageFromPath(tab.path);
      const langToExt: Record<string, string> = {
        plaintext: 'txt', markdown: 'md', javascript: 'js', typescript: 'ts',
        python: 'py', rust: 'rs', go: 'go', java: 'java', cpp: 'cpp', c: 'c',
        csharp: 'cs', php: 'php', ruby: 'rb', html: 'html', css: 'css', scss: 'scss',
        json: 'json', xml: 'xml', yaml: 'yml', sql: 'sql', shell: 'sh'
      };
      const defaultExt = langToExt[lang] || 'txt';
      const untitled = t('common.untitled');
      const defaultBase = tab.name && tab.name !== untitled ? tab.name : untitled;
      const defaultPath = defaultBase.includes('.') ? defaultBase : `${defaultBase}.${defaultExt}`;
      const savedPath = await save({
        title: t('dialog.saveAs'),
        defaultPath,
        filters: [
          { name: 'Text', extensions: ['txt', 'md', 'log'] },
          { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'scss'] },
          { name: 'Data', extensions: ['json', 'yaml', 'yml', 'xml', 'csv'] },
          { name: 'Scripts', extensions: ['sh', 'py', 'rb', 'php'] },
          { name: 'C/C++', extensions: ['c', 'h', 'cpp', 'hpp'] },
          { name: 'Java/C#/Go/Rust', extensions: ['java', 'cs', 'go', 'rs'] },
          { name: 'Markdown', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!savedPath) return;

      const hasExt = /\.[^\/\\]+$/.test(savedPath);
      const filePath = hasExt ? savedPath : `${savedPath}.${defaultExt}`;
      const content = tab.editor.getValue();
      await invoke('write_file', { path: filePath, content });
      tab.path = filePath;
      tab.name = this.basename(filePath) || tab.name;
      tab.originalContent = content;
      tab.isDirty = false;
      this.renderTabs();
      if (this.draftsDir) {
        const draftPath = `${this.draftsDir}/${tab.id}.json`;
        try { await invoke('remove_file', { path: draftPath }); } catch {}
      }
    } catch (error) {
      console.error('Failed to save as:', error);
    }
  }
  
  public async createNewFile() {
    try {
      const tempName: string = await invoke('create_new_file');
      const tabId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? (crypto as any).randomUUID()
        : Date.now().toString();
      
      const tab: Tab = {
        id: tabId,
        name: t('common.untitled'),
        path: tempName,
        isDirty: false,
        originalContent: ''
      };
      
      this.tabs.push(tab);
      this.renderTabs();
      this.createEditor(tab, '');
      this.switchToTab(tabId);
    } catch (error) {
      console.error('Failed to create new file:', error);
    }
  }
  
  public async openFile() {
    try {
      const filePath = await open({
        title: t('dialog.openFile'),
        multiple: false,
        directory: false
      });
      
      if (!filePath) return; // User cancelled
      
      const fileName = this.basename(filePath as string) || t('common.untitled');
      await this.openFileByPath(filePath as string, fileName);
    } catch (error) {
      console.error('Failed to open file dialog:', error);
      // Fallback - ask user to type path
      const path = prompt(t('prompt.enterFilePathToOpen'));
      if (path) {
        const name = this.basename(path) || t('common.untitled');
        await this.openFileByPath(path, name);
      }
    }
  }
  
  public async openFolder() {
    try {
      const folderPath = await open({
        title: t('dialog.openFolder'),
        multiple: false,
        directory: true
      });
      
      if (!folderPath) return; // User cancelled
      this.addProjectRoot(folderPath as string);
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
      // Fallback - ask user to type path
      const path = prompt(t('prompt.enterFolderPathToOpen'));
      if (path) {
        this.addProjectRoot(path);
      }
    }
  }
  
  private async openFileByPath(path: string, name: string) {
    // Check if file is already open
    const existingTab = this.tabs.find(tab => tab.path === path);
    if (existingTab) {
      this.switchToTab(existingTab.id);
      return;
    }
    
    try {
      const tabId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? (crypto as any).randomUUID()
        : Date.now().toString();
      const isImage = this.isImagePath(path);
      let content: string | null = null;
      if (!isImage) {
        content = await invoke('read_file', { path });
      }
      const tab: Tab = { id: tabId, name, path, isDirty: false, originalContent: content ?? '' };
      this.tabs.push(tab);
      this.renderTabs();
      if (isImage) {
        this.createImageViewer(tab);
      } else {
        this.createEditor(tab, content || '');
      }
      this.switchToTab(tabId);
    } catch (error) {
      console.error('Failed to open file:', error);
      alert('Failed to open file: ' + (error as any));
    }
  }
  
  private closeTab(tabId: string) {
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) return;
    
    const tab = this.tabs[tabIndex];
    
    // Dispose editor
    if (tab.editor) {
      tab.editor.dispose();
      const element = document.getElementById(`editor-${tabId}`);
      if (element) element.remove();
    }
    
    // Remove tab
    this.tabs.splice(tabIndex, 1);
    
    // Switch to another tab if this was active
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const newActiveIndex = Math.min(tabIndex, this.tabs.length - 1);
        this.switchToTab(this.tabs[newActiveIndex].id);
      } else {
        this.activeTabId = null;
      }
    }
    
    this.renderTabs();
    this.updateWelcomeState();
  }
  
  private setupKeyboardShortcuts() {
    // Capture-phase handler: intercept Esc before it reaches system default.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!this.searchPanel.classList.contains('hidden')) {
          this.hideSearch();
        }
        return;
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      // Cmd+S / Ctrl+S - Save
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this.saveActiveFile();
        return;
      }
      // Cmd+Shift+S / Ctrl+Shift+S - Save As
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        this.saveActiveFileAs();
        return;
      }
      // Cmd+D / Ctrl+D - Add selection to next find match (multi-cursor)
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
        if (activeTab?.editor) {
          activeTab.editor.getAction('editor.action.addSelectionToNextFindMatch')?.run();
        }
      }
      
      // Cmd+Shift+L / Ctrl+Shift+L - Select all occurrences
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
        if (activeTab?.editor) {
          activeTab.editor.getAction('editor.action.selectHighlights')?.run();
        }
      }
      
      // Alt+Click for multiple cursors (handled by Monaco by default)
      // Cmd+Shift+K / Ctrl+Shift+K - Delete line
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
        if (activeTab?.editor) {
          activeTab.editor.getAction('editor.action.deleteLines')?.run();
        }
      }
      
      // Cmd+/ / Ctrl+/ - Toggle line comment
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
        if (activeTab?.editor) {
          activeTab.editor.getAction('editor.action.commentLine')?.run();
        }
      }
      
      // Cmd+F / Ctrl+F - Find
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        this.showSearch();
      }
      
      // Cmd+H / Ctrl+H - Find and Replace
      if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
        e.preventDefault();
        const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
        if (activeTab?.editor) {
          activeTab.editor.getAction('editor.action.startFindReplaceAction')?.run();
        }
      }
      
      // Cmd+W / Ctrl+W - Close tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (this.activeTabId) {
          this.closeTab(this.activeTabId);
        }
      }
      
      // Cmd+N / Ctrl+N - New file
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        this.createNewFile();
      }
      
      // Cmd+O / Ctrl+O - Open file
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        this.openFile();
      }
    });
  }
  
  private setupSearchPanel() {
    const findAllBtn = document.getElementById('find-all-btn')!;
    const findPrevBtn = document.getElementById('find-prev-btn')!;
    const findNextBtn = document.getElementById('find-next-btn')!;
    const closeSearchBtn = document.getElementById('close-search-btn')!;
    
    findAllBtn.addEventListener('click', () => this.findAll());
    findPrevBtn.addEventListener('click', () => this.findPrevious());
    findNextBtn.addEventListener('click', () => this.findNext());
    closeSearchBtn.addEventListener('click', () => this.hideSearch());
    
    // Toggle buttons
    this.caseSensitiveBtn.addEventListener('click', () => this.toggleSearchOption('caseSensitive'));
    this.wholeWordBtn.addEventListener('click', () => this.toggleSearchOption('wholeWord'));
    this.regexBtn.addEventListener('click', () => this.toggleSearchOption('regex'));
    
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          this.findPrevious();
        } else {
          this.findNext();
        }
      } else if (e.key === 'Escape') {
        // Prevent Esc from bubbling (e.g., leaving fullscreen) when closing search
        e.preventDefault();
        e.stopPropagation();
        this.hideSearch();
      }
    });
    
    this.searchInput.addEventListener('input', () => {
      // Debounce search updates to improve performance on large files
      if (this.searchDebounceHandle) {
        clearTimeout(this.searchDebounceHandle);
      }
      this.searchDebounceHandle = window.setTimeout(() => {
        this.updateSearch();
      }, this.searchDebounceMs);
    });
  }
  
  private async setupMenuListeners() {
    await listen('menu-event', (event) => {
      const action = event.payload as string;
      console.log('Menu event received:', action);
      
      switch (action) {
        case 'new_file':
          this.createNewFile();
          break;
        case 'open_file':
          this.openFile();
          break;
        case 'open_folder':
          this.openFolder();
          break;
        case 'save':
          this.saveActiveFile();
          break;
        case 'save_as':
          this.saveActiveFileAs();
          break;
        case 'close_tab':
          if (this.activeTabId) {
            this.closeTab(this.activeTabId);
          }
          break;
        case 'find':
          this.showSearch();
          break;
        case 'replace':
          this.showReplace();
          break;
        case 'select_all_occurrences':
          this.selectAllOccurrences();
          break;
        case 'quit_app':
          this.handleQuitRequest();
          break;
        case 'theme_dark':
          this.setBuiltInTheme('dark');
          break;
        case 'theme_light':
          this.setBuiltInTheme('light');
          break;
        case 'theme_load_custom':
          this.loadCustomThemeFromFile();
          break;
        case 'language_en':
          setLocale('en');
          applyTranslations();
          this.updateNativeMenuLabels();
          break;
        case 'language_uk':
          setLocale('uk');
          applyTranslations();
          this.updateNativeMenuLabels();
          break;
        case 'language_es':
          setLocale('es');
          applyTranslations();
          this.updateNativeMenuLabels();
          break;
        case 'language_fr':
          setLocale('fr');
          applyTranslations();
          this.updateNativeMenuLabels();
          break;
        case 'language_ja':
          setLocale('ja');
          applyTranslations();
          this.updateNativeMenuLabels();
          break;
        case 'language_de':
          setLocale('de');
          applyTranslations();
          this.updateNativeMenuLabels();
          break;
      }
    });
    // Handle native window close request (Windows/Linux)
    await listen('request-close', async () => {
      await this.handleQuitRequest();
    });
  }

  private async handleQuitRequest() {
    const hasDirty = this.tabs.some(t => t.isDirty);
    if (!hasDirty) {
      await invoke('quit_app');
      return;
    }
    // Flush drafts for all dirty tabs
    if (this.draftsDir) {
      const dirty = this.tabs.filter(t => t.isDirty);
      for (const t of dirty) {
        try { await this.saveDraft(t); } catch {}
      }
    }
    const deleteDrafts = confirm(t('confirm.deleteDraftsOnQuit'));
    if (deleteDrafts && this.draftsDir) {
      try { await invoke('clear_dir', { path: this.draftsDir }); } catch {}
    }
    await invoke('quit_app');
  }
  
  private toggleSearchOption(option: keyof typeof this.searchOptions) {
    this.searchOptions[option] = !this.searchOptions[option];
    
    const btn = option === 'caseSensitive' ? this.caseSensitiveBtn :
                option === 'wholeWord' ? this.wholeWordBtn : this.regexBtn;
    
    if (this.searchOptions[option]) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
    
    this.updateSearch();
  }
  
  public showSearch() {
    this.searchPanel.classList.remove('hidden');
    this.searchInput.focus();
    this.searchInput.select();
  }
  
  public hideSearch() {
    this.searchPanel.classList.add('hidden');
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab?.editor) {
      activeTab.editor.focus();
    }
  }
  
  private updateSearch() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (!activeTab?.editor) return;
    
    const searchText = this.searchInput.value;
    if (!searchText) {
      this.searchCount.textContent = '';
      return;
    }
    
    this.highlightMatches();
  }
  
  private highlightMatches() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (!activeTab?.editor) return;
    
    const searchText = this.searchInput.value;
    const model = activeTab.editor.getModel();
    if (!searchText || !model) {
      // Clear any previous decorations when search is empty
      if (activeTab.searchDecorationIds && activeTab.searchDecorationIds.length > 0) {
        const cleared = activeTab.editor.deltaDecorations(activeTab.searchDecorationIds, []);
        activeTab.searchDecorationIds = cleared;
      }
      this.searchCount.textContent = '';
      return;
    }
    
    try {
      // Prepare query respecting regex / wholeWord / caseSensitive
      let query = searchText;
      let isRegex = this.searchOptions.regex;
      if (this.searchOptions.wholeWord && !isRegex) {
        query = `\\b${this.escapeRegExp(searchText)}\\b`;
        isRegex = true;
      }
      const matches = model.findMatches(
        query,
        false,
        isRegex,
        this.searchOptions.caseSensitive,
        null,
        true
      );
      
      const total = matches.length;
      const limited = matches.slice(0, this.maxSearchHighlights);
      const limitedNote = total > this.maxSearchHighlights ? t('search.showingNote', { count: this.maxSearchHighlights }) : '';
      this.searchCount.textContent = `${t('search.matches', { count: total })}${limitedNote}`;
      
      // Highlight all matches
      const decorations = limited.map(match => ({
        range: match.range,
        options: {
          className: 'search-highlight',
          stickiness: 1
        }
      }));
      const newIds = activeTab.editor.deltaDecorations(activeTab.searchDecorationIds || [], decorations);
      activeTab.searchDecorationIds = newIds;
    } catch (error) {
      // Handle regex errors
      this.searchCount.textContent = t('search.invalidRegex');
      // On invalid regex, clear previous highlights to avoid stale state
      if (activeTab.searchDecorationIds && activeTab.searchDecorationIds.length > 0) {
        const cleared = activeTab.editor.deltaDecorations(activeTab.searchDecorationIds, []);
        activeTab.searchDecorationIds = cleared;
      }
    }
  }
  
  private findAll() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (!activeTab?.editor) return;
    
    const searchText = this.searchInput.value;
    if (!searchText) return;
    
    const model = activeTab.editor.getModel();
    if (!model) return;
    
    try {
      // Prepare query respecting regex / wholeWord / caseSensitive
      let query = searchText;
      let isRegex = this.searchOptions.regex;
      if (this.searchOptions.wholeWord && !isRegex) {
        query = `\\b${this.escapeRegExp(searchText)}\\b`;
        isRegex = true;
      }
      const matches = model.findMatches(
        query,
        false,
        isRegex,
        this.searchOptions.caseSensitive,
        null,
        true
      );
      
      if (matches.length === 0) return;
      
      // Set multiple selections for multi-cursor editing
      const selections = matches.map(match => ({
        selectionStartLineNumber: match.range.startLineNumber,
        selectionStartColumn: match.range.startColumn,
        positionLineNumber: match.range.endLineNumber,
        positionColumn: match.range.endColumn
      }));
      
      activeTab.editor.setSelections(selections);
      activeTab.editor.focus();
      
      // Keep search panel open so user can see what they're editing
      // this.hideSearch();
    } catch (error) {
      console.error('Search error:', error);
    }
  }
  
  private findNext() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (!activeTab?.editor) return;
    
    activeTab.editor.getAction('editor.action.nextMatchFindAction')?.run();
  }
  
  private findPrevious() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (!activeTab?.editor) return;
    
    activeTab.editor.getAction('editor.action.previousMatchFindAction')?.run();
  }
  
  public saveActiveFile() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab) {
      this.saveFile(activeTab);
    }
  }
  
  public saveActiveFileAs() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab) {
      this.saveFileAs(activeTab);
    }
  }
  
  public selectAllOccurrences() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab?.editor) {
      activeTab.editor.getAction('editor.action.selectHighlights')?.run();
    }
  }
  
  public showReplace() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab?.editor) {
      activeTab.editor.getAction('editor.action.startFindReplaceAction')?.run();
    }
  }

  private isImagePath(path: string): boolean {
    const ext = (path.split('.').pop() || '').toLowerCase();
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff'];
    return imageExts.includes(ext);
  }

  // Utils
  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getDraftPath(tabId: string) {
    return this.draftsDir ? `${this.draftsDir}/${tabId}.json` : null;
  }

  private async saveDraft(tab: Tab) {
    if (!this.draftsDir || !tab.editor) return;
    const draftPath = this.getDraftPath(tab.id);
    if (!draftPath) return;
    const payload = {
      id: tab.id,
      name: tab.name,
      path: tab.path,
      content: tab.editor.getValue(),
      ts: Date.now()
    };
    await invoke('write_file', { path: draftPath, content: JSON.stringify(payload) });
  }

  private async restoreDrafts() {
    if (!this.draftsDir) return;
    try {
      const entries: { name: string; path: string; is_dir: boolean }[] = await invoke('read_dir', { path: this.draftsDir });
      const files = entries.filter(e => !e.is_dir && e.name.endsWith('.json'));
      if (!files.length) return;
      for (const f of files) {
        try {
          const raw = await invoke<string>('read_file', { path: f.path });
          const draft = JSON.parse(raw) as { id: string; name: string; path: string; content: string };
          const tabId = draft.id || ((crypto as any).randomUUID?.() ?? Date.now().toString());
          const name = draft.name || this.basename(draft.path || '') || t('common.untitled');
          const tab: Tab = { id: tabId, name, path: draft.path || name, isDirty: true, originalContent: '' };
          this.tabs.push(tab);
          this.renderTabs();
          this.createEditor(tab, draft.content || '');
        } catch (e) {
          console.warn('Failed to restore draft', f.path, e);
        }
      }
      this.updateWelcomeState();
      alert(t('info.restoredDrafts'));
    } catch (e) {
      console.warn('Failed to scan drafts dir', e);
    }
  }
}

// Initialize the editor
const editor = new Editrion();

// Add global functions for menu access
(window as any).createNewFile = () => editor.createNewFile();
(window as any).openFile = () => editor.openFile();
(window as any).openFolder = () => editor.openFolder();
(window as any).saveActiveFile = () => editor.saveActiveFile();
(window as any).showFind = () => editor.showSearch();
(window as any).showReplace = () => editor.showReplace();
(window as any).selectAllOccurrences = () => editor.selectAllOccurrences();
