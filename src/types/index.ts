import * as monaco from 'monaco-editor';

export interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface Tab {
  id: string;
  name: string;
  path: string;
  editor?: monaco.editor.IStandaloneCodeEditor;
  isDirty: boolean;
  // Keep track of search highlight decorations for this tab
  searchDecorationIds?: string[];
  originalContent?: string;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface Theme {
  name: string;
  isDark: boolean;
}

export interface AppSettings {
  theme: string;
  locale: string;
  openFolders: string[];
  aiOverrides?: Record<string, string>;
}

// Events
export interface MenuEvent {
  event: string;
  payload?: any;
}

// AI Integration
export interface AIRequest {
  prompt: string;
  context?: string;
  model?: string;
}

export interface AIResponse {
  content: string;
  model: string;
}

// Tauri API types
export interface TauriResponse<T = any> {
  data: T;
}

export interface TauriError {
  message: string;
  code?: string;
}