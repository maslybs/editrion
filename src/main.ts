import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import * as monaco from 'monaco-editor';
import './style.css';

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
  private welcomeOpenFileBtn?: HTMLElement;
  private welcomeOpenFolderBtn?: HTMLElement;
  private tabContextMenu!: HTMLElement;
  private ctxCloseOthersItem!: HTMLElement;
  private ctxCloseRightItem!: HTMLElement;
  private contextTargetTabId: string | null = null;
  private searchOptions = {
    caseSensitive: false,
    wholeWord: false,
    regex: false
  };
  
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
    
    this.init();
  }
  
  private async init() {
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
    
    monaco.editor.setTheme('sublime-dark');
    
    // Don't load directory by default - only when project is opened
    
    // Sidebar and welcome actions
    this.addFolderBtn?.addEventListener('click', () => this.openFolder());
    this.welcomeOpenFileBtn?.addEventListener('click', () => this.openFile());
    this.welcomeOpenFolderBtn?.addEventListener('click', () => this.openFolder());

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

  private addProjectRoot(path: string) {
    const root = document.createElement('div');
    root.className = 'folder-item collapsed';
    root.textContent = path.split('/').pop() || path;
    root.dataset.path = path;
    root.dataset.root = 'true';
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFolder(root);
    });
    this.sidebarContainer.appendChild(root);
  }
  
  private renderFileTree(entries: FileItem[], container: HTMLElement) {
    container.innerHTML = '';
    
    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      return a.name.localeCompare(b.name);
    });
    
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
      
      container.appendChild(element);
    });
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
      const content: string = await invoke('read_file', { path });
      const tabId = Date.now().toString();
      
      const tab: Tab = {
        id: tabId,
        name,
        path,
        isDirty: false
      };
      
      this.tabs.push(tab);
      this.renderTabs();
      this.createEditor(tab, content);
      this.switchToTab(tabId);
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }
  
  private renderTabs() {
    this.tabsContainer.innerHTML = '';
    
    this.tabs.forEach(tab => {
      const tabElement = document.createElement('div');
      tabElement.className = `tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabElement.dataset.tabId = tab.id;
      tabElement.innerHTML = `
        <span>${tab.name}${tab.isDirty ? ' •' : ''}</span>
        <span class="close" data-tab-id="${tab.id}">✕</span>
      `;
      
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
      
      this.tabsContainer.appendChild(tabElement);
    });
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
      theme: 'sublime-dark',
      automaticLayout: true,
      fontSize: 14,
      lineHeight: 20,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      folding: true,
      renderWhitespace: 'selection',
      multiCursorModifier: 'ctrlCmd',
      selectionHighlight: true,
      occurrencesHighlight: 'singleFile',
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: 'never',
        seedSearchStringFromSelection: 'always'
      }
    });
    
    // Enable multi-cursor with Cmd+Click (Mac) / Ctrl+Click (Windows/Linux)
    editor.onDidChangeModelContent(() => {
      if (!tab.isDirty) {
        tab.isDirty = true;
        this.renderTabs();
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
    
    tab.editor = editor;
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
    // Hide all editors
    this.tabs.forEach(tab => {
      if (tab.editor) {
        const element = document.getElementById(`editor-${tab.id}`);
        if (element) element.style.display = 'none';
      }
    });
    
    // Show active editor
    const activeTab = this.tabs.find(tab => tab.id === tabId);
    if (activeTab?.editor) {
      const element = document.getElementById(`editor-${tabId}`);
      if (element) {
        element.style.display = 'block';
        activeTab.editor.layout();
        activeTab.editor.focus();
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
          const defaultBase = tab.name && tab.name !== 'Untitled' ? tab.name : 'Untitled';
          const defaultPath = defaultBase.includes('.') ? defaultBase : `${defaultBase}.${defaultExt}`;
          const savedPath = await save({
            title: 'Save File',
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
          tab.name = filePath.split('/').pop() || tab.name;
        } catch (error) {
          console.error('Failed to open save dialog:', error);
          // Fallback - ask user to type path
          const path = prompt('Enter file path to save:');
          if (!path) return;
          
          filePath = path;
          tab.path = filePath;
          tab.name = filePath.split('/').pop() || tab.name;
        }
      }
      
      const content = tab.editor.getValue();
      await invoke('write_file', { path: filePath, content });
      tab.isDirty = false;
      this.renderTabs();
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
      const defaultBase = tab.name && tab.name !== 'Untitled' ? tab.name : 'Untitled';
      const defaultPath = defaultBase.includes('.') ? defaultBase : `${defaultBase}.${defaultExt}`;
      const savedPath = await save({
        title: 'Save As',
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
      tab.name = filePath.split('/').pop() || tab.name;
      tab.isDirty = false;
      this.renderTabs();
    } catch (error) {
      console.error('Failed to save as:', error);
    }
  }
  
  public async createNewFile() {
    try {
      const tempName: string = await invoke('create_new_file');
      const tabId = Date.now().toString();
      
      const tab: Tab = {
        id: tabId,
        name: 'Untitled',
        path: tempName,
        isDirty: false
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
        title: 'Open File',
        multiple: false,
        directory: false,
        filters: [{
          name: 'All Files',
          extensions: ['*']
        }]
      });
      
      if (!filePath) return; // User cancelled
      
      const fileName = (filePath as string).split('/').pop() || 'Untitled';
      await this.openFileByPath(filePath as string, fileName);
    } catch (error) {
      console.error('Failed to open file dialog:', error);
      // Fallback - ask user to type path
      const path = prompt('Enter file path to open:');
      if (path) {
        const name = path.split('/').pop() || 'Untitled';
        await this.openFileByPath(path, name);
      }
    }
  }
  
  public async openFolder() {
    try {
      const folderPath = await open({
        title: 'Open Folder',
        multiple: false,
        directory: true
      });
      
      if (!folderPath) return; // User cancelled
      this.addProjectRoot(folderPath as string);
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
      // Fallback - ask user to type path
      const path = prompt('Enter folder path to open:');
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
      const content: string = await invoke('read_file', { path });
      const tabId = Date.now().toString();
      
      const tab: Tab = {
        id: tabId,
        name,
        path,
        isDirty: false
      };
      
      this.tabs.push(tab);
      this.renderTabs();
      this.createEditor(tab, content);
      this.switchToTab(tabId);
    } catch (error) {
      console.error('Failed to open file:', error);
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
    document.addEventListener('keydown', (e) => {
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
        this.hideSearch();
      }
    });
    
    this.searchInput.addEventListener('input', () => this.updateSearch());
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
      }
    });
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
      
      this.searchCount.textContent = `${matches.length} matches`;
      
      // Highlight all matches
      const decorations = matches.map(match => ({
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
      this.searchCount.textContent = 'Invalid regex';
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

  // Utils
  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
