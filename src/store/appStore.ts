import { BaseStore } from './BaseStore';
import type { AppSettings } from '../types';

interface AppState {
  theme: string;
  locale: string;
  openFolders: string[];
  aiOverrides: Record<string, string>;
  isLoading: boolean;
  error: string | null;
  sidebarVisible: boolean;
  searchPanelVisible: boolean;
}

const initialState: AppState = {
  theme: 'dark',
  locale: 'en',
  openFolders: [],
  aiOverrides: {},
  isLoading: false,
  error: null,
  sidebarVisible: true,
  searchPanelVisible: false,
};

class AppStore extends BaseStore<AppState> {
  constructor() {
    super(initialState);
    this.loadFromStorage();
  }

  // Theme management
  setTheme(theme: string): void {
    this.setState({ theme });
    this.saveToStorage();
  }

  // Locale management
  setLocale(locale: string): void {
    this.setState({ locale });
    this.saveToStorage();
  }

  // Folder management
  addFolder(folderPath: string): void {
    const openFolders = [...this.getState().openFolders];
    if (!openFolders.includes(folderPath)) {
      openFolders.push(folderPath);
      this.setState({ openFolders });
      this.saveToStorage();
    }
  }

  removeFolder(folderPath: string): void {
    const openFolders = this.getState().openFolders.filter(path => path !== folderPath);
    this.setState({ openFolders });
    this.saveToStorage();
  }

  // AI overrides
  setAIOverrides(overrides: Record<string, string>): void {
    this.setState({ aiOverrides: overrides });
    this.saveToStorage();
  }

  // UI state
  toggleSidebar(): void {
    this.setState({ sidebarVisible: !this.getState().sidebarVisible });
  }

  toggleSearchPanel(): void {
    this.setState({ searchPanelVisible: !this.getState().searchPanelVisible });
  }

  showSearchPanel(): void {
    this.setState({ searchPanelVisible: true });
  }

  hideSearchPanel(): void {
    this.setState({ searchPanelVisible: false });
  }

  // Loading and error states
  setLoading(isLoading: boolean): void {
    this.setState({ isLoading });
  }

  setError(error: string | null): void {
    this.setState({ error });
  }

  // Persistence
  private saveToStorage(): void {
    const { theme, locale, openFolders, aiOverrides } = this.getState();
    const settings: AppSettings = { theme, locale, openFolders, aiOverrides };
    localStorage.setItem('editrion-settings', JSON.stringify(settings));
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('editrion-settings');
      if (stored) {
        const settings: AppSettings = JSON.parse(stored);
        this.setState({
          theme: settings.theme || initialState.theme,
          locale: settings.locale || initialState.locale,
          openFolders: settings.openFolders || initialState.openFolders,
          aiOverrides: settings.aiOverrides || initialState.aiOverrides,
        });
      }
    } catch (error) {
      console.warn('Failed to load app settings from storage:', error);
    }
  }
}

// Export singleton instance
export const appStore = new AppStore();
