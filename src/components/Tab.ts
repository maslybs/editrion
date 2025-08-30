import type { Tab as TabData } from '../types';
import { tabsStore } from '../store/tabsStore';

export class Tab {
  private element: HTMLElement;
  private data: TabData;

  constructor(tabData: TabData, container: HTMLElement) {
    this.data = tabData;
    this.element = this.createElement();
    container.appendChild(this.element);
    this.setupEventListeners();
  }

  private createElement(): HTMLElement {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.tabId = this.data.id;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-label';
    titleSpan.textContent = this.data.name + (this.data.isDirty ? ' •' : '');
    titleSpan.title = this.data.path || this.data.name;

    const closeSpan = document.createElement('span');
    closeSpan.className = 'close';
    closeSpan.textContent = '✕';

    tab.appendChild(titleSpan);
    tab.appendChild(closeSpan);

    return tab;
  }

  // Removed icon rendering to match original minimal tab style

  private setupEventListeners(): void {
    // Tab click - activate tab
    this.element.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Don't activate if clicking close button
      if ((e.target as HTMLElement).classList.contains('close')) {
        return;
      }
      
      tabsStore.setActiveTab(this.data.id);
    });

    // Close button
    const closeBtn = this.element.querySelector('.close');
    closeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const api = (window as any).requestCloseTab;
      if (api) api(this.data.id); else tabsStore.closeTab(this.data.id);
    });

    // Context menu
    this.element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e);
    });

    // Middle click to close
    this.element.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        this.closeTab();
      }
    });

    // Double click on label to rename
    const label = this.element.querySelector('.tab-label');
    label?.addEventListener('dblclick', () => {
      this.startRename();
    });
  }

  private closeTab(): void {
    if (this.data.isDirty) {
      // Show confirmation dialog for unsaved changes
      const shouldClose = confirm(`File "${this.data.name}" has unsaved changes. Close anyway?`);
      if (!shouldClose) return;
    }

    tabsStore.closeTab(this.data.id);
  }

  private showContextMenu(e: MouseEvent): void {
    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'context-menu tab-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    
    menu.innerHTML = `
      <div class="context-menu-item" data-action="close">Close</div>
      <div class="context-menu-item" data-action="close-others">Close Others</div>
      <div class="context-menu-item" data-action="close-right">Close Tabs to the Right</div>
      <div class="context-menu-item" data-action="close-all">Close All</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="rename">Rename</div>
      ${this.data.path ? `<div class="context-menu-item" data-action="reveal">Show in Explorer</div>` : ''}
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="copy-path">Copy Path</div>
    `;

    // Add event listeners
    menu.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const action = target.dataset.action;
      
      switch (action) {
        case 'close':
          { const api = (window as any).requestCloseTab; if (api) api(this.data.id); else tabsStore.closeTab(this.data.id); }
          break;
        case 'close-others':
          { const api = (window as any).requestCloseOthers; if (api) api(this.data.id); else tabsStore.closeOtherTabs(this.data.id); }
          break;
        case 'close-right':
          { const api = (window as any).requestCloseRight; if (api) api(this.data.id); else tabsStore.closeTabsToRight(this.data.id); }
          break;
        case 'close-all':
          { const api = (window as any).requestCloseAll; if (api) api(); else tabsStore.closeAllTabs(); }
          break;
        case 'rename':
          this.startRename();
          break;
        case 'reveal':
          // Could emit event to show in file explorer
          console.log('Reveal in explorer:', this.data.path);
          break;
        case 'copy-path':
          navigator.clipboard.writeText(this.data.path);
          break;
      }
      
      menu.remove();
    });

    // Remove menu when clicking outside
    const removeMenu = () => {
      menu.remove();
      document.removeEventListener('click', removeMenu);
    };
    setTimeout(() => document.addEventListener('click', removeMenu), 0);

    document.body.appendChild(menu);
  }

  private startRename(): void {
    const label = this.element.querySelector('.tab-label') as HTMLElement;
    const currentName = this.data.name;
    
    // Create input element
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'tab-rename-input';
    
    // Replace label with input
    label.style.display = 'none';
    label.parentNode?.insertBefore(input, label);
    
    input.focus();
    input.select();

    const finishRename = () => {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        // Update tab data
        tabsStore.updateTab(this.data.id, { name: newName });
        this.updateDisplay();
      }
      
      input.remove();
      label.style.display = '';
    };

    const cancelRename = () => {
      input.remove();
      label.style.display = '';
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finishRename();
      } else if (e.key === 'Escape') {
        cancelRename();
      }
    });
  }

  // Update tab display when data changes
  updateDisplay(): void {
    const updatedTab = tabsStore.getTab(this.data.id);
    if (!updatedTab) return;

    this.data = updatedTab;
    
    // Update label (append dirty dot at end)
    const label = this.element.querySelector('.tab-label');
    if (label) {
      label.textContent = this.data.name + (this.data.isDirty ? ' •' : '');
      label.setAttribute('title', this.data.path || this.data.name);
    }

    // Update active state
    if (tabsStore.getState().activeTabId === this.data.id) {
      this.element.classList.add('active');
    } else {
      this.element.classList.remove('active');
    }
  }

  // Get the DOM element
  getElement(): HTMLElement {
    return this.element;
  }

  // Get tab data
  getData(): TabData {
    return this.data;
  }

  // Remove from DOM
  destroy(): void {
    this.element.remove();
  }
}
