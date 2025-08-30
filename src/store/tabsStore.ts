import { BaseStore } from './BaseStore';
import type { Tab } from '../types';
import * as monaco from 'monaco-editor';

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  nextTabId: number;
}

const initialState: TabsState = {
  tabs: [],
  activeTabId: null,
  nextTabId: 1,
};

class TabsStore extends BaseStore<TabsState> {
  constructor() {
    super(initialState);
  }

  // Tab creation
  createTab(name: string, path: string = '', content: string = ''): Tab {
    const state = this.getState();
    const id = `tab-${state.nextTabId}`;
    
    const tab: Tab = {
      id,
      name,
      path,
      isDirty: false,
      originalContent: content,
    };

    this.setState({
      tabs: [...state.tabs, tab],
      activeTabId: id,
      nextTabId: state.nextTabId + 1,
    });

    return tab;
  }

  // Tab management
  closeTab(tabId: string): void {
    const state = this.getState();
    const tabs = state.tabs.filter(tab => tab.id !== tabId);
    
    let activeTabId = state.activeTabId;
    if (state.activeTabId === tabId) {
      // Set active tab to the next or previous tab
      const closingIndex = state.tabs.findIndex(tab => tab.id === tabId);
      if (tabs.length > 0) {
        const nextIndex = Math.min(closingIndex, tabs.length - 1);
        activeTabId = tabs[nextIndex].id;
      } else {
        activeTabId = null;
      }
    }

    // Dispose of the editor if it exists
    const closingTab = state.tabs.find(tab => tab.id === tabId);
    if (closingTab?.editor) {
      closingTab.editor.dispose();
    }

    this.setState({ tabs, activeTabId });
  }

  // Tab switching
  setActiveTab(tabId: string): void {
    const state = this.getState();
    if (state.tabs.some(tab => tab.id === tabId)) {
      this.setState({ activeTabId: tabId });
    }
  }

  // Tab editing
  updateTab(tabId: string, updates: Partial<Tab>): void {
    const state = this.getState();
    const tabs = state.tabs.map(tab =>
      tab.id === tabId ? { ...tab, ...updates } : tab
    );
    this.setState({ tabs });
  }

  markTabDirty(tabId: string, isDirty: boolean = true): void {
    this.updateTab(tabId, { isDirty });
  }

  setTabEditor(tabId: string, editor: monaco.editor.IStandaloneCodeEditor): void {
    this.updateTab(tabId, { editor });
  }

  setTabContent(tabId: string, content: string): void {
    const tab = this.getTab(tabId);
    if (tab) {
      const isDirty = content !== (tab.originalContent || '');
      this.updateTab(tabId, { isDirty });
    }
  }

  saveTab(tabId: string, content: string): void {
    this.updateTab(tabId, { 
      isDirty: false,
      originalContent: content,
    });
  }

  // Tab queries
  getTab(tabId: string): Tab | undefined {
    return this.getState().tabs.find(tab => tab.id === tabId);
  }

  getActiveTab(): Tab | undefined {
    const state = this.getState();
    return state.activeTabId ? this.getTab(state.activeTabId) : undefined;
  }

  hasUnsavedTabs(): boolean {
    return this.getState().tabs.some(tab => tab.isDirty);
  }

  getTabByPath(path: string): Tab | undefined {
    return this.getState().tabs.find(tab => tab.path === path);
  }

  // Search decorations
  setSearchDecorations(tabId: string, decorationIds: string[]): void {
    this.updateTab(tabId, { searchDecorationIds: decorationIds });
  }

  clearSearchDecorations(tabId: string): void {
    const tab = this.getTab(tabId);
    if (tab?.editor && tab.searchDecorationIds) {
      tab.editor.removeDecorations(tab.searchDecorationIds);
      this.updateTab(tabId, { searchDecorationIds: [] });
    }
  }

  // Bulk operations
  closeAllTabs(): void {
    const state = this.getState();
    // Dispose all editors
    state.tabs.forEach(tab => {
      if (tab.editor) {
        tab.editor.dispose();
      }
    });
    
    this.setState({
      tabs: [],
      activeTabId: null,
    });
  }

  closeOtherTabs(keepTabId: string): void {
    const state = this.getState();
    const tabToKeep = this.getTab(keepTabId);
    
    if (!tabToKeep) return;

    // Dispose other editors
    state.tabs.forEach(tab => {
      if (tab.id !== keepTabId && tab.editor) {
        tab.editor.dispose();
      }
    });

    this.setState({
      tabs: [tabToKeep],
      activeTabId: keepTabId,
    });
  }

  closeTabsToRight(tabId: string): void {
    const state = this.getState();
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    const keep = state.tabs.slice(0, idx + 1);
    // Dispose editors for removed tabs
    state.tabs.slice(idx + 1).forEach(t => { try { t.editor?.dispose(); } catch {} });
    const activeId = state.activeTabId && state.tabs.findIndex(t => t.id === state.activeTabId) > idx ? tabId : state.activeTabId;
    this.setState({ tabs: keep, activeTabId: activeId || tabId });
  }
}

// Export singleton instance
export const tabsStore = new TabsStore();
