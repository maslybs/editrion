import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import type { FileItem } from '../types';

// Centralized API service for all Tauri commands

export class TauriAPI {
  // File System Operations
  async readFile(path: string): Promise<string> {
    return await invoke('read_file', { path });
  }

  async writeFile(path: string, content: string): Promise<void> {
    await invoke('write_file', { path, content });
  }

  async readDir(path: string): Promise<FileItem[]> {
    return await invoke('read_dir', { path });
  }

  async createNewFile(): Promise<string> {
    return await invoke('create_new_file');
  }

  async removeFile(path: string): Promise<void> {
    await invoke('remove_file', { path });
  }

  async clearDir(path: string): Promise<void> {
    await invoke('clear_dir', { path });
  }

  // Application Commands
  async quitApp(): Promise<void> {
    await invoke('quit_app');
  }

  async getDraftsDir(): Promise<string> {
    return await invoke('drafts_dir');
  }

  // External CLI (AI Integration)
  async codexExecStream(
    prompt: string, 
    cwd?: string, 
    runId?: string, 
    model?: string,
    config?: Record<string, string>
  ): Promise<void> {
    await invoke('codex_exec_stream', { 
      prompt, 
      cwd, 
      runId: runId || this.generateRunId(), 
      model, 
      config 
    });
  }

  async claudeExecStream(
    prompt: string, 
    cwd?: string, 
    runId?: string, 
    model?: string,
    config?: Record<string, string>
  ): Promise<void> {
    await invoke('claude_exec_stream', { 
      prompt, 
      cwd, 
      runId: runId || this.generateRunId(), 
      model, 
      config 
    });
  }

  async codexLoginStream(runId?: string): Promise<void> {
    await invoke('codex_login_stream', { runId: runId || this.generateRunId() });
  }

  async claudeLoginStream(runId?: string): Promise<void> {
    await invoke('claude_login_stream', { runId: runId || this.generateRunId() });
  }

  async codexCancel(runId: string): Promise<void> {
    await invoke('codex_cancel', { runId });
  }

  async claudeCancel(runId: string): Promise<void> {
    await invoke('claude_cancel', { runId });
  }

  // Configuration
  async getCodexConfigPath(): Promise<string> {
    return await invoke('codex_config_path');
  }

  async setCodexConfig(key: string, value: string): Promise<void> {
    await invoke('codex_config_set', { key, value });
  }

  // Menu Operations
  async rebuildMenu(labels: Record<string, string>): Promise<void> {
    await invoke('rebuild_menu', { labels });
  }

  // Dialog Operations
  async openFileDialog(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
    const result = await open({
      multiple: false,
      directory: false,
      filters: filters || [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Text Files', extensions: ['txt', 'md', 'json', 'ts', 'js', 'py', 'rs'] },
      ],
    });
    return result;
  }

  async openFolderDialog(): Promise<string | null> {
    const result = await open({
      multiple: false,
      directory: true,
    });
    return result;
  }

  async saveFileDialog(defaultName?: string): Promise<string | null> {
    const result = await save({
      defaultPath: defaultName,
    });
    return result;
  }

  // Utility methods
  private generateRunId(): string {
    return `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Error handling wrapper
  async safeInvoke<T>(command: string, args?: Record<string, any>): Promise<T | null> {
    try {
      return await invoke(command, args);
    } catch (error) {
      console.error(`API call failed: ${command}`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const tauriApi = new TauriAPI();
