import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import * as monaco from 'monaco-editor';
import { initI18n, setLocale, t, registerDictionaries, applyTranslations } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { tauriApi } from '../services/tauriApi';
// import { appStore } from '../store/appStore';
import { tabsStore } from '../store/tabsStore';
import { Editor } from '../components/Editor';
import { Tab } from '../components/Tab';
import { SearchPanel } from '../components/SearchPanel';
import { FileExplorer } from '../components/FileExplorer';
import type { Tab as TabData } from '../types';

import en from '../locales/en.json';
import uk from '../locales/uk.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import ja from '../locales/ja.json';
import de from '../locales/de.json';

export class App {
  private tabsContainer: HTMLElement;
  private welcomeContainer: HTMLElement;
  private editorContainer: HTMLElement;
  private tabsOverflowBtn: HTMLButtonElement;
  private tabsOverflowMenu: HTMLElement;
  private editor: Editor;
  private searchPanel: SearchPanel;
  private fileExplorer: FileExplorer;
  private tabComponents: Map<string, Tab> = new Map();
  private draftsDir: string | null = null;
  private draftTimers: Record<string, number> = {};
  private aiOverrides: { model?: string; effort?: 'minimal'|'low'|'medium'|'high'; summary?: 'auto'|'concise'|'detailed'|'none'; verbosity?: 'low'|'medium'|'high' } = {};
  private confirmOverlay?: HTMLElement;
  private confirmMessageEl?: HTMLElement;
  private confirmResolve?: (v: 'save' | 'discard' | 'cancel') => void;

  constructor() {
    this.tabsContainer = document.getElementById('tabs')!;
    this.welcomeContainer = document.getElementById('welcome')!;
    this.editorContainer = document.getElementById('editor-container')!;
    this.tabsOverflowBtn = document.getElementById('tabs-overflow-btn') as HTMLButtonElement;
    this.tabsOverflowMenu = document.getElementById('tabs-overflow-menu')!;

    // i18n
    registerDictionaries('en', en as any);
    registerDictionaries('uk', uk as any);
    registerDictionaries('es', es as any);
    registerDictionaries('fr', fr as any);
    registerDictionaries('ja', ja as any);
    registerDictionaries('de', de as any);
    initI18n();
    applyTranslations();

    // Theme
    const savedTheme = localStorage.getItem('editrion.theme') || 'dark';
    const isLight = savedTheme.includes('light');
    themeManager.setTheme(isLight ? 'light' : 'dark');
    document.body.setAttribute('data-theme', isLight ? 'light' : 'dark');

    // Components
    this.editor = new Editor(this.editorContainer);
    this.editor.onContentChanged = (tab, content) => this.onContentChanged(tab, content);
    this.searchPanel = new SearchPanel();
    this.fileExplorer = new FileExplorer((path, name) => this.openFileByPath(path, name));

    // Welcome actions
    const welcomeOpenFileBtn = document.getElementById('welcome-open-file');
    welcomeOpenFileBtn?.addEventListener('click', () => this.openFile());
    const welcomeNewFileBtn = document.getElementById('welcome-new-file');
    welcomeNewFileBtn?.addEventListener('click', () => this.createNewFile());

    // Events
    this.setupShortcuts();
    this.setupMenuListeners();
    this.setupTabsOverflowMenu();
    // Horizontal wheel scroll over tabs
    this.tabsContainer.addEventListener('wheel', (e: WheelEvent) => {
      if (e.deltaY !== 0 && !e.shiftKey) { e.preventDefault(); this.tabsContainer.scrollLeft += e.deltaY; }
    }, { passive: false });

    // Disable default context menu outside Monaco editor to avoid actions like Reload
    document.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.monaco-editor')) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Initial state
    this.subscribeToTabs();
    this.updateWelcomeState();

    // Drafts
    this.prepareDrafts();
    // Init unsaved changes modal
    this.initConfirmModal();
  }

  private async prepareDrafts() {
    try {
      this.draftsDir = await tauriApi.getDraftsDir();
      await this.restoreDrafts();
    } catch (e) { console.warn('Drafts unavailable:', e); }
  }

  private async restoreDrafts() {
    if (!this.draftsDir) return;
    try {
      const entries: { name: string; path: string; is_dir: boolean }[] = await tauriApi.readDir(this.draftsDir);
      const files = entries.filter(e => !e.is_dir && e.name.endsWith('.json'));
      for (const f of files) {
        try {
          const raw = await tauriApi.readFile(f.path);
          const draft = JSON.parse(raw) as { id: string; name: string; path: string; content: string };
          const name = draft.name || this.basename(draft.path || '') || t('common.untitled');
          const tab = tabsStore.createTab(name, draft.path || name, draft.content || '');
          // create editor now
          this.editor.createEditor(tab, draft.content || '');
        } catch (e) { console.warn('Failed to restore draft', f.path, e); }
      }
      this.updateWelcomeState();
    } catch (e) { console.warn('Failed to scan drafts dir', e); }
  }

  private async onContentChanged(tab: TabData, content: string) {
    if (!this.draftsDir) return;
    if (this.draftTimers[tab.id]) window.clearTimeout(this.draftTimers[tab.id]);
    this.draftTimers[tab.id] = window.setTimeout(async () => {
      try {
        const draftPath = `${this.draftsDir}/${tab.id}.json`;
        const payload = { id: tab.id, name: tab.name, path: tab.path, content, ts: Date.now() };
        await tauriApi.writeFile(draftPath, JSON.stringify(payload));
      } catch (e) { console.warn('Failed to save draft', e); }
    }, 400);
  }

  private subscribeToTabs() {
    tabsStore.subscribe(() => this.renderTabs());
  }

  private renderTabs() {
    const state = tabsStore.getState();
    this.tabsContainer.innerHTML = '';
    this.tabComponents.clear();
    for (const t of state.tabs) {
      const tabComp = new Tab(t, this.tabsContainer);
      this.tabComponents.set(t.id, tabComp);
      // Ensure visual state reflects store values immediately
      tabComp.updateDisplay();
    }
    // Switch editor to active tab
    const active = tabsStore.getActiveTab();
    if (active) {
      if (active.path && this.isImagePath(active.path)) {
        // Render simple image viewer
        this.editorContainer.innerHTML = '';
        const viewer = document.createElement('div');
        viewer.className = 'image-viewer';
        viewer.style.width = '100%';
        viewer.style.height = '100%';
        const img = document.createElement('img');
        img.src = convertFileSrc(active.path);
        img.alt = active.name;
        viewer.appendChild(img);
        this.editorContainer.appendChild(viewer);
      } else {
        this.editor.switchToTab(active);
      }
    }
    this.updateWelcomeState();
  }

  private updateWelcomeState() {
    const hasTabs = tabsStore.getState().tabs.length > 0;
    if (hasTabs) { this.welcomeContainer.classList.add('hidden'); this.editorContainer.style.display = 'block'; }
    else { this.welcomeContainer.classList.remove('hidden'); this.editorContainer.style.display = 'none'; }
  }

  private setupShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ignore app shortcuts while typing in modal dialogs (AI etc.)
      const target = e.target as HTMLElement;
      if (target && target.closest('.modal')) return;
      // Block page reload in Tauri (Cmd/Ctrl+R, Shift+Cmd/Ctrl+R, F5)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.saveActiveFile(); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); this.saveActiveFileAs(); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); this.searchPanel.show(); return; }
      // Multi-cursor: add selection to next match (Ctrl/Cmd + D)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        const active = tabsStore.getActiveTab(); const ed = active?.editor; if (ed) { e.preventDefault(); ed.getAction('editor.action.addSelectionToNextFindMatch')?.run(); return; }
      }
      // Multi-cursor: select all occurrences (Ctrl/Cmd + Shift + L)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        const active = tabsStore.getActiveTab(); const ed = active?.editor; if (ed) { e.preventDefault(); ed.getAction('editor.action.selectHighlights')?.run(); return; }
      }
      // Delete line (Ctrl/Cmd + Shift + K)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        const active = tabsStore.getActiveTab(); const ed = active?.editor; if (ed) { e.preventDefault(); ed.getAction('editor.action.deleteLines')?.run(); return; }
      }
      // Toggle line comment (Ctrl/Cmd + /)
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        const active = tabsStore.getActiveTab(); const ed = active?.editor; if (ed) { e.preventDefault(); ed.getAction('editor.action.commentLine')?.run(); return; }
      }
      if (e.key === 'Escape') {
        // Mirror legacy behavior: only intercept Esc to close search when visible
        if (this.searchPanel.isVisible()) {
          e.preventDefault();
          e.stopPropagation();
          this.searchPanel.hide();
          return;
        }
        // Otherwise do not prevent defaults for Esc to avoid breaking OS/Monaco behavior
      }
    }, true);
  }

  private setupTabsOverflowMenu() {
    const hide = () => this.hideTabsOverflowMenu();
    this.tabsOverflowBtn.addEventListener('click', (e) => {
      e.stopPropagation(); this.populateTabsOverflowMenu();
      const rect = this.tabsOverflowBtn.getBoundingClientRect();
      this.showTabsOverflowMenu(rect.left, rect.bottom + 4);
    });
    document.addEventListener('click', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
  }

  private populateTabsOverflowMenu() {
    const menu = this.tabsOverflowMenu; menu.innerHTML = '';
    for (const tab of tabsStore.getState().tabs) {
      const item = document.createElement('div'); item.className = 'context-menu-item';
      const title = `${tab.name}${tab.isDirty ? ' •' : ''}`; item.textContent = title; item.title = tab.path;
      const close = document.createElement('span');
      close.textContent = '✕';
      close.style.float = 'right';
      close.style.opacity = '0.8';
      close.style.marginLeft = '8px';
      close.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.closeTab(tab.id);
        this.populateTabsOverflowMenu();
      });
      item.appendChild(close);
      item.addEventListener('click', (e) => { e.stopPropagation(); tabsStore.setActiveTab(tab.id); this.hideTabsOverflowMenu(); });
      menu.appendChild(item);
    }
  }

  private showTabsOverflowMenu(x: number, y: number) {
    const menu = this.tabsOverflowMenu; menu.classList.remove('hidden');
    const { innerWidth, innerHeight } = window; const rect = menu.getBoundingClientRect();
    const posX = Math.min(x, innerWidth - rect.width - 4); const posY = Math.min(y, innerHeight - rect.height - 4);
    menu.style.left = `${posX}px`; menu.style.top = `${posY}px`;
  }
  private hideTabsOverflowMenu() { this.tabsOverflowMenu.classList.add('hidden'); }

  private async setupMenuListeners() {
    await listen('menu-event', async (event) => {
      const action = event.payload as string;
      switch (action) {
        case 'new_file': await this.createNewFile(); break;
        case 'open_file': await this.openFile(); break;
        case 'open_folder': await this.fileExplorer.openFolder(); break;
        case 'save': await this.saveActiveFile(); break;
        case 'save_as': await this.saveActiveFileAs(); break;
        case 'close_tab': { const active = tabsStore.getActiveTab(); if (active) await this.closeTab(active.id); } break;
        case 'find': this.searchPanel.show(); break;
        case 'replace': /* future */ this.searchPanel.show(); break;
        case 'select_all_occurrences': {
          const active = tabsStore.getActiveTab(); const ed = active?.editor; if (ed) ed.getAction('editor.action.selectHighlights')?.run();
          break;
        }
        case 'quit_app': await this.handleQuitRequest(); break;
        case 'theme_dark': themeManager.setTheme('dark'); document.body.setAttribute('data-theme', 'dark'); monaco.editor.setTheme('sublime-dark'); localStorage.setItem('editrion.theme', 'dark'); break;
        case 'theme_light': themeManager.setTheme('light'); document.body.setAttribute('data-theme', 'light'); localStorage.setItem('editrion.theme', 'light'); break;
        case 'theme_load_custom':
          try {
            const picked = await tauriApi.openFileDialog([{ name: 'JSON', extensions: ['json'] }]);
            const path = Array.isArray(picked) ? picked?.[0] : (picked as any);
            if (!path) break;
            const content = await tauriApi.readFile(String(path));
            const def = JSON.parse(content);
            const id = await themeManager.loadCustomTheme(def);
            themeManager.setTheme(id);
            document.body.setAttribute('data-theme', 'custom');
            if (def && def.name) {
              const raw = localStorage.getItem('editrion.customThemes');
              const map = raw ? JSON.parse(raw) as Record<string, any> : {};
              map[String(def.name)] = def;
              localStorage.setItem('editrion.customThemes', JSON.stringify(map));
              localStorage.setItem('editrion.theme', `custom:${String(def.name)}`);
            }
          } catch (e) {
            console.error('Failed to load custom theme:', e);
            alert(t('alert.failedToLoadCustomTheme'));
          }
          break;
        case 'language_en': setLocale('en'); applyTranslations(); await this.updateNativeMenuLabels(); break;
        case 'language_uk': setLocale('uk'); applyTranslations(); await this.updateNativeMenuLabels(); break;
        case 'language_es': setLocale('es'); applyTranslations(); await this.updateNativeMenuLabels(); break;
        case 'language_fr': setLocale('fr'); applyTranslations(); await this.updateNativeMenuLabels(); break;
        case 'language_ja': setLocale('ja'); applyTranslations(); await this.updateNativeMenuLabels(); break;
        case 'language_de': setLocale('de'); applyTranslations(); await this.updateNativeMenuLabels(); break;
        case 'ai_open_config': await this.openAiConfig(); break;
        case 'ai_model_o3': this.setAiOverrideModel('o3'); break;
        case 'ai_model_gpt5': this.setAiOverrideModel('gpt-5'); break;
        case 'ai_reasoning_effort_minimal': this.setAiOverrideEffort('minimal'); break;
        case 'ai_reasoning_effort_low': this.setAiOverrideEffort('low'); break;
        case 'ai_reasoning_effort_medium': this.setAiOverrideEffort('medium'); break;
        case 'ai_reasoning_effort_high': this.setAiOverrideEffort('high'); break;
        case 'ai_reasoning_summary_auto': this.setAiOverrideSummary('auto'); break;
        case 'ai_reasoning_summary_concise': this.setAiOverrideSummary('concise'); break;
        case 'ai_reasoning_summary_detailed': this.setAiOverrideSummary('detailed'); break;
        case 'ai_reasoning_summary_none': this.setAiOverrideSummary('none'); break;
        case 'ai_model_verbosity_low': this.setAiOverrideVerbosity('low'); break;
        case 'ai_model_verbosity_medium': this.setAiOverrideVerbosity('medium'); break;
        case 'ai_model_verbosity_high': this.setAiOverrideVerbosity('high'); break;
        case 'reset_settings': this.resetAllSettings(); break;
      }
    });

    await listen('request-close', async () => {
      await this.handleQuitRequest();
    });
  }

  private async updateNativeMenuLabels() {
    const labels = {
      'menu.file': t('menu.file'), 'menu.edit': t('menu.edit'), 'menu.view': t('menu.view'), 'menu.window': t('menu.window'), 'menu.settings': t('menu.settings'), 'menu.language': t('menu.language'), 'menu.theme': t('menu.theme'),
      'menu.item.newFile': t('menu.item.newFile'), 'menu.item.openFile': t('menu.item.openFile'), 'menu.item.openFolder': t('menu.item.openFolder'), 'menu.item.save': t('menu.item.save'), 'menu.item.saveAs': t('menu.item.saveAs'), 'menu.item.closeTab': t('menu.item.closeTab'), 'menu.item.quit': t('menu.item.quit'),
      'menu.item.undo': t('menu.item.undo'), 'menu.item.redo': t('menu.item.redo'), 'menu.item.cut': t('menu.item.cut'), 'menu.item.copy': t('menu.item.copy'), 'menu.item.paste': t('menu.item.paste'),
      'menu.item.find': t('menu.item.find'), 'menu.item.replace': t('menu.item.replace'), 'menu.item.selectAllOccurrences': t('menu.item.selectAllOccurrences'),
      'menu.item.theme.dark': t('menu.item.theme.dark'), 'menu.item.theme.light': t('menu.item.theme.light'), 'menu.item.theme.loadCustom': t('menu.item.theme.loadCustom'),
      'menu.item.window.show': t('menu.item.window.show'), 'menu.item.lang.en': t('menu.item.lang.en'), 'menu.item.lang.uk': t('menu.item.lang.uk'), 'menu.item.lang.es': t('menu.item.lang.es'), 'menu.item.lang.fr': t('menu.item.lang.fr'), 'menu.item.lang.ja': t('menu.item.lang.ja'), 'menu.item.lang.de': t('menu.item.lang.de'),
      'menu.item.resetSettings': t('menu.item.resetSettings'),
    } as Record<string,string>;
    try { await tauriApi.rebuildMenu(labels); } catch (e) { console.warn('Failed to rebuild native menu:', e); }
  }

  // ---------- File operations ----------
  async createNewFile() {
    try {
      const tempPath = await tauriApi.createNewFile();
      const tab = tabsStore.createTab(t('common.untitled'), tempPath, '');
      this.editor.createEditor(tab, '');
    } catch (e) { console.error('createNewFile failed', e); }
  }

  async openFile() {
    try {
      const path = await tauriApi.openFileDialog(); if (!path) return;
      const name = this.basename(path);
      await this.openFileByPath(path, name);
    } catch (e) { console.error('openFile failed', e); }
  }

  async openFileByPath(path: string, name: string) {
    const existing = tabsStore.getTabByPath(path); if (existing) { tabsStore.setActiveTab(existing.id); return; }
    try {
      if (this.isImagePath(path)) {
        tabsStore.createTab(name, path, '');
        // viewer will render on active switch
      } else {
        const content = await tauriApi.readFile(path);
        const tab = tabsStore.createTab(name, path, content);
        this.editor.createEditor(tab, content);
      }
    } catch (e) { console.error('Failed to open file:', e); alert(t('alert.failedToOpenFile', { error: String(e) })); }
  }

  async saveActiveFile() {
    const tab = tabsStore.getActiveTab(); if (!tab || !tab.editor) return;
    try {
      let filePath = tab.path;
      if (!filePath) {
        const saved = await tauriApi.saveFileDialog(tab.name || t('common.untitled')); if (!saved) return;
        const hasExt = /\.[^\/\\]+$/.test(saved); filePath = hasExt ? saved : `${saved}.txt`;
        tab.path = filePath; tabsStore.updateTab(tab.id, { path: filePath, name: this.basename(filePath) });
      }
      const content = tab.editor.getValue();
      await tauriApi.writeFile(filePath, content);
      tabsStore.saveTab(tab.id, content);
      if (this.draftsDir) { try { await tauriApi.removeFile(`${this.draftsDir}/${tab.id}.json`); } catch {} }
    } catch (e) { console.error('saveActiveFile failed', e); }
  }

  async saveActiveFileAs() {
    const tab = tabsStore.getActiveTab(); if (!tab || !tab.editor) return;
    try {
      const saved = await tauriApi.saveFileDialog(tab.name || t('common.untitled')); if (!saved) return;
      const filePath = saved;
      const content = tab.editor.getValue();
      await tauriApi.writeFile(filePath, content);
      tabsStore.updateTab(tab.id, { path: filePath, name: this.basename(filePath) });
      tabsStore.saveTab(tab.id, content);
      if (this.draftsDir) { try { await tauriApi.removeFile(`${this.draftsDir}/${tab.id}.json`); } catch {} }
    } catch (e) { console.error('saveActiveFileAs failed', e); }
  }

  async closeTab(tabId: string) {
    const tab = tabsStore.getTab(tabId); if (!tab) return;
    if (tab.isDirty) {
      const choice = await this.askUnsavedSingle(tab.name);
      if (choice === 'cancel') return;
      if (choice === 'save') { await this.saveActiveFile(); }
      if (choice === 'discard' && this.draftsDir) { try { await tauriApi.removeFile(`${this.draftsDir}/${tab.id}.json`); } catch {} }
    }
    // Always attempt to remove draft file on close (avoid restoring closed tabs)
    if (this.draftsDir) { try { await tauriApi.removeFile(`${this.draftsDir}/${tab.id}.json`); } catch {} }
    tabsStore.closeTab(tabId);
  }

  async closeAllTabs() {
    const ids = tabsStore.getState().tabs.map(t => t.id);
    for (const id of ids) { await this.closeTab(id); }
  }

  async closeOtherTabs(keepId: string) {
    const ids = tabsStore.getState().tabs.filter(t => t.id !== keepId).map(t => t.id);
    for (const id of ids) { await this.closeTab(id); }
  }

  async closeTabsToRight(keepId: string) {
    const tabs = tabsStore.getState().tabs;
    const idx = tabs.findIndex(t => t.id === keepId);
    if (idx === -1) return;
    const ids = tabs.slice(idx + 1).map(t => t.id);
    for (const id of ids) { await this.closeTab(id); }
  }

  private async askUnsavedSingle(name: string): Promise<'save' | 'discard' | 'cancel'> {
    if (!this.confirmOverlay || !this.confirmMessageEl) return 'cancel';
    this.confirmMessageEl.textContent = t('confirm.unsavedSingle', { name });
    this.confirmOverlay.classList.add('show');
    return new Promise(resolve => { this.confirmResolve = resolve; });
  }

  private async handleQuitRequest() {
    const dirty = tabsStore.getState().tabs.filter(t => t.isDirty);
    if (dirty.length === 0) { await tauriApi.quitApp(); return; }
    const choice = await this.askUnsavedMulti(dirty.length);
    if (choice === 'cancel') return;
    if (choice === 'save') {
      for (const tab of dirty) { tabsStore.setActiveTab(tab.id); await this.saveActiveFile(); if (tab.isDirty) return; }
      await tauriApi.quitApp();
      return;
    }
    // discard: clear drafts dir so closed tabs are not restored next launch
    if (this.draftsDir) { try { await tauriApi.clearDir(this.draftsDir); } catch {} }
    await tauriApi.quitApp();
  }

  private async openAiConfig() {
    try {
      const path = await tauriApi.getCodexConfigPath();
      try { await tauriApi.readFile(path); } catch { await tauriApi.writeFile(path, ''); }
      const name = this.basename(path);
      await this.openFileByPath(path, name);
    } catch (e) { console.error('Failed to open AI config:', e); alert('Failed to open AI config.'); }
  }

  private basename(path: string): string { const parts = path.split(/[/\\]/); return parts.pop() || path; }
  private isImagePath(path: string): boolean {
    return /(\.png|\.jpe?g|\.gif|\.webp|\.bmp|\.svg)$/i.test(path);
  }
  private saveAiOverrides() { try { localStorage.setItem('editrion.aiOverrides', JSON.stringify(this.aiOverrides)); } catch {} }
  private setAiOverrideModel(model: string) { this.aiOverrides.model = model; this.saveAiOverrides(); }
  private setAiOverrideEffort(effort: 'minimal'|'low'|'medium'|'high') { this.aiOverrides.effort = effort; this.saveAiOverrides(); }
  private setAiOverrideSummary(summary: 'auto'|'concise'|'detailed'|'none') { this.aiOverrides.summary = summary; this.saveAiOverrides(); }
  private setAiOverrideVerbosity(verbosity: 'low'|'medium'|'high') { this.aiOverrides.verbosity = verbosity; this.saveAiOverrides(); }

  resetAllSettings() {
    try {
      const ok = confirm(t('confirm.resetSettings') || 'Reset all settings to defaults?');
      if (!ok) return;
      const keys: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) keys.push(k); }
      for (const k of keys) { if (k === 'editrion-settings' || k.startsWith('editrion.')) { try { localStorage.removeItem(k); } catch {} } }
      themeManager.setTheme('dark');
      document.body.setAttribute('data-theme', 'dark');
      monaco.editor.setTheme('sublime-dark');
      localStorage.setItem('editrion.theme', 'dark');
      setLocale('en'); applyTranslations(); this.updateNativeMenuLabels();
      try { this.fileExplorer.clearAllRoots(); } catch {}
      // No success alert per UX: one confirm is enough
    } catch (e) { console.error('Failed to reset settings:', e); }
  }

  private initConfirmModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    const msg = document.createElement('p');
    const actions = document.createElement('div');
    actions.className = 'actions';
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn';
    btnCancel.textContent = t('button.cancel');
    const btnDont = document.createElement('button');
    btnDont.className = 'btn';
    btnDont.textContent = t('button.dontSave');
    const btnSave = document.createElement('button');
    btnSave.className = 'btn primary';
    btnSave.textContent = t('button.save');
    actions.append(btnCancel, btnDont, btnSave);
    modal.append(msg, actions);
    overlay.append(modal);
    document.body.append(overlay);
    this.confirmOverlay = overlay;
    this.confirmMessageEl = msg;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.finishConfirm('cancel'); });
    btnSave.addEventListener('click', () => this.finishConfirm('save'));
    btnDont.addEventListener('click', () => this.finishConfirm('discard'));
    btnCancel.addEventListener('click', () => this.finishConfirm('cancel'));
    document.addEventListener('keydown', (e) => {
      if (!this.confirmOverlay || !this.confirmOverlay.classList.contains('show')) return;
      if (e.key === 'Escape') this.finishConfirm('cancel');
    });
  }

  private finishConfirm(choice: 'save' | 'discard' | 'cancel') {
    if (this.confirmOverlay) this.confirmOverlay.classList.remove('show');
    if (this.confirmResolve) this.confirmResolve(choice);
    this.confirmResolve = undefined;
  }

  private async askUnsavedMulti(count: number): Promise<'save' | 'discard' | 'cancel'> {
    if (!this.confirmOverlay || !this.confirmMessageEl) return 'cancel';
    this.confirmMessageEl.textContent = t('confirm.unsavedMulti', { count });
    this.confirmOverlay.classList.add('show');
    return new Promise(resolve => { this.confirmResolve = resolve; });
  }
}
