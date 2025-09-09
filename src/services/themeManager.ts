import * as monaco from 'monaco-editor';

export interface ThemeDefinition {
  name: string;
  isDark: boolean;
  editorTheme: string;
  cssClassName?: string;
}

export class ThemeManager {
  private themes: Map<string, ThemeDefinition> = new Map();
  private currentTheme: string = 'dark';

  constructor() {
    this.initializeDefaultThemes();
  }

  private initializeDefaultThemes(): void {
    this.themes.set('dark', {
      name: 'Dark',
      isDark: true,
      editorTheme: 'vs-dark',
      cssClassName: 'theme-dark',
    });

    this.themes.set('light', {
      name: 'Light',
      isDark: false,
      editorTheme: 'vs',
      cssClassName: 'theme-light',
    });

    this.themes.set('hc-dark', {
      name: 'High Contrast Dark',
      isDark: true,
      editorTheme: 'hc-black',
      cssClassName: 'theme-hc-dark',
    });
  }

  getCurrentTheme(): ThemeDefinition | undefined {
    return this.themes.get(this.currentTheme);
  }

  setTheme(themeName: string): void {
    const theme = this.themes.get(themeName);
    if (!theme) {
      console.warn(`Theme '${themeName}' not found`);
      return;
    }

    this.currentTheme = themeName;
    this.applyTheme(theme);
  }

  private applyTheme(theme: ThemeDefinition): void {
    // Apply to Monaco editors
    monaco.editor.setTheme(theme.editorTheme);

    // Apply to document body: use data-theme so CSS variables switch instantly
    try {
      document.body.setAttribute('data-theme', theme.isDark ? 'dark' : 'light');
    } catch {}
    // Optionally keep a class for consumers that rely on it
    try {
      document.body.className = document.body.className
        .split(' ')
        .filter(cls => !cls.startsWith('theme-'))
        .join(' ');
      if (theme.cssClassName) {
        document.body.classList.add(theme.cssClassName);
      }
    } catch {}

    // Update meta theme-color for mobile browsers
    this.updateMetaThemeColor(theme.isDark);
  }

  private updateMetaThemeColor(isDark: boolean): void {
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement('meta');
      metaTheme.setAttribute('name', 'theme-color');
      document.head.appendChild(metaTheme);
    }
    
    metaTheme.setAttribute('content', isDark ? '#1e1e1e' : '#ffffff');
  }

  getAvailableThemes(): ThemeDefinition[] {
    return Array.from(this.themes.values());
  }

  registerTheme(id: string, theme: ThemeDefinition): void {
    this.themes.set(id, theme);
  }

  // Load custom theme from file
  async loadCustomTheme(themeData: any): Promise<string> {
    try {
      const themeId = `custom-${Date.now()}`;
      
      // Basic validation
      if (!themeData.name || typeof themeData.isDark !== 'boolean') {
        throw new Error('Invalid theme format');
      }

      const customTheme: ThemeDefinition = {
        name: themeData.name,
        isDark: themeData.isDark,
        editorTheme: themeData.editorTheme || (themeData.isDark ? 'vs-dark' : 'vs'),
        cssClassName: themeData.cssClassName,
      };

      // Register Monaco theme if provided
      if (themeData.monacoTheme) {
        monaco.editor.defineTheme(themeId, themeData.monacoTheme);
        customTheme.editorTheme = themeId;
      }

      this.registerTheme(themeId, customTheme);
      return themeId;
    } catch (error) {
      console.error('Failed to load custom theme:', error);
      throw error;
    }
  }

  // Get system theme preference
  getSystemTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Listen to system theme changes
  onSystemThemeChange(callback: (isDark: boolean) => void): () => void {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => callback(e.matches);
    
    mediaQuery.addEventListener('change', handler);
    
    return () => mediaQuery.removeEventListener('change', handler);
  }

  // Auto-switch theme based on system preference
  enableAutoTheme(): () => void {
    const updateTheme = (isDark: boolean) => {
      this.setTheme(isDark ? 'dark' : 'light');
    };

    // Set initial theme
    updateTheme(this.getSystemTheme() === 'dark');

    // Listen for changes
    return this.onSystemThemeChange(updateTheme);
  }
}

// Export singleton instance
export const themeManager = new ThemeManager();
