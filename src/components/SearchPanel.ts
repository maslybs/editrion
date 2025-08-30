import type { SearchOptions } from '../types';
import { appStore } from '../store/appStore';
import { tabsStore } from '../store/tabsStore';
import type * as monacoNS from 'monaco-editor';
import { t } from '../services/i18n';

export class SearchPanel {
  private root: HTMLElement;
  private input: HTMLInputElement;
  private countEl: HTMLElement;
  private caseBtn: HTMLElement;
  private wordBtn: HTMLElement;
  private regexBtn: HTMLElement;
  private findAllBtn: HTMLElement;
  private findPrevBtn: HTMLElement;
  private findNextBtn: HTMLElement;
  private closeBtn: HTMLElement;

  private options: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };
  private maxHighlights = 500;
  private debounceHandle: number | null = null;
  private debounceMs = 150;
  private lastMatches: monacoNS.editor.FindMatch[] = [];
  private currentIndex: number = -1;

  constructor() {
    this.root = document.getElementById('search-panel')!;
    this.input = document.getElementById('search-input') as HTMLInputElement;
    this.countEl = document.getElementById('search-results-count')!;
    this.caseBtn = document.getElementById('case-sensitive-btn')!;
    this.wordBtn = document.getElementById('whole-word-btn')!;
    this.regexBtn = document.getElementById('regex-btn')!;
    this.findAllBtn = document.getElementById('find-all-btn')!;
    this.findPrevBtn = document.getElementById('find-prev-btn')!;
    this.findNextBtn = document.getElementById('find-next-btn')!;
    this.closeBtn = document.getElementById('close-search-btn')!;

    this.bindEvents();
  }

  public isVisible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  private bindEvents() {
    this.caseBtn.addEventListener('click', () => this.toggle('caseSensitive'));
    this.wordBtn.addEventListener('click', () => this.toggle('wholeWord'));
    this.regexBtn.addEventListener('click', () => this.toggle('regex'));
    this.findAllBtn.addEventListener('click', () => this.findAll());
    this.findPrevBtn.addEventListener('click', () => this.findPrev());
    this.findNextBtn.addEventListener('click', () => this.findNext());
    this.closeBtn.addEventListener('click', () => this.hide());

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) this.findPrev(); else this.findNext();
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); this.hide();
      }
    });

    this.input.addEventListener('input', () => {
      if (this.debounceHandle) window.clearTimeout(this.debounceHandle);
      this.debounceHandle = window.setTimeout(() => this.updateSearch(), this.debounceMs);
    });
  }

  show() {
    this.root.classList.remove('hidden');
    this.input.focus();
    this.input.select();
    appStore.showSearchPanel();
  }

  hide() {
    this.root.classList.add('hidden');
    appStore.hideSearchPanel();
    const active = tabsStore.getActiveTab();
    if (active?.editor) {
      // Clear highlights
      tabsStore.clearSearchDecorations(active.id);
      // Collapse multi-cursor to a single caret at current primary position
      const ed = active.editor;
      const pos = ed.getPosition() || ed.getSelection()?.getPosition();
      if (pos) {
        ed.setSelections([
          {
            selectionStartLineNumber: pos.lineNumber,
            selectionStartColumn: pos.column,
            positionLineNumber: pos.lineNumber,
            positionColumn: pos.column,
          },
        ]);
      }
      ed.focus();
    }
    // Reset search state
    this.lastMatches = [];
    this.currentIndex = -1;
  }

  private toggle(option: keyof SearchOptions) {
    this.options[option] = !this.options[option];
    const btn = option === 'caseSensitive' ? this.caseBtn : option === 'wholeWord' ? this.wordBtn : this.regexBtn;
    if (this.options[option]) btn.classList.add('active'); else btn.classList.remove('active');
    this.updateSearch();
  }

  private updateSearch() {
    const query = this.input.value;
    const active = tabsStore.getActiveTab();
    const editor = active?.editor;
    if (!query || !editor) {
      this.countEl.textContent = '';
      if (active) {
        tabsStore.clearSearchDecorations(active.id);
      }
      this.lastMatches = [];
      this.currentIndex = -1;
      return;
    }
    this.highlightMatches(editor, query, this.options);
  }

  private highlightMatches(editor: monacoNS.editor.IStandaloneCodeEditor, searchText: string, opts: SearchOptions) {
    const model = editor.getModel();
    if (!model) return;
    try {
      let query = searchText;
      let isRegex = opts.regex;
      if (opts.wholeWord && !isRegex) { query = `\\b${this.escapeRegExp(searchText)}\\b`; isRegex = true; }
      const matches = model.findMatches(query, false, isRegex, opts.caseSensitive, null, true);
      this.lastMatches = matches;
      const total = matches.length;
      const limited = matches.slice(0, this.maxHighlights);
      this.countEl.textContent = `${t('search.matches', { count: total })}`;
      const decorations = limited.map(m => ({ range: m.range, options: { className: 'search-highlight', stickiness: 1 as const } }));
      const newIds = editor.deltaDecorations((tabsStore.getActiveTab()?.searchDecorationIds || []), decorations);
      const active = tabsStore.getActiveTab();
      if (active) tabsStore.setSearchDecorations(active.id, newIds as unknown as string[]);
      // Reset current index to first match if selection not on a match
      this.currentIndex = this.indexOfSelection(editor);
    } catch {
      this.countEl.textContent = '';
      const active = tabsStore.getActiveTab();
      if (active) tabsStore.clearSearchDecorations(active.id);
      this.lastMatches = [];
      this.currentIndex = -1;
    }
  }

  private findAll() {
    const query = this.input.value; if (!query) return;
    const active = tabsStore.getActiveTab(); const editor = active?.editor; if (!editor) return;
    const model = editor.getModel(); if (!model) return;
    try {
      let q = query; let isRegex = this.options.regex;
      if (this.options.wholeWord && !isRegex) { q = `\\b${this.escapeRegExp(query)}\\b`; isRegex = true; }
      const matches = model.findMatches(q, false, isRegex, this.options.caseSensitive, null, true);
      if (!matches.length) return;
      editor.setSelection(matches[0].range);
      editor.getAction('editor.action.selectHighlights')?.run();
      editor.focus();
    } catch {}
  }

  private findNext() {
    const active = tabsStore.getActiveTab(); const editor = active?.editor; if (!editor) return;
    if (!this.lastMatches.length) { this.updateSearch(); }
    if (!this.lastMatches.length) return;
    this.currentIndex = this.indexOfSelection(editor);
    const next = (this.currentIndex >= 0) ? (this.currentIndex + 1) % this.lastMatches.length : 0;
    this.revealMatch(editor, next);
  }

  private findPrev() {
    const active = tabsStore.getActiveTab(); const editor = active?.editor; if (!editor) return;
    if (!this.lastMatches.length) { this.updateSearch(); }
    if (!this.lastMatches.length) return;
    this.currentIndex = this.indexOfSelection(editor);
    const prev = (this.currentIndex >= 0) ? (this.currentIndex - 1 + this.lastMatches.length) % this.lastMatches.length : (this.lastMatches.length - 1);
    this.revealMatch(editor, prev);
  }

  private revealMatch(editor: monacoNS.editor.IStandaloneCodeEditor, index: number) {
    const match = this.lastMatches[index]; if (!match) return;
    editor.setSelection(match.range);
    editor.revealRangeInCenter(match.range);
    editor.focus();
    this.currentIndex = index;
  }

  private indexOfSelection(editor: monacoNS.editor.IStandaloneCodeEditor): number {
    if (!this.lastMatches.length) return -1;
    const sel = editor.getSelection(); if (!sel) return -1;
    for (let i = 0; i < this.lastMatches.length; i++) {
      const r = this.lastMatches[i].range;
      if (r.startLineNumber === sel.startLineNumber && r.startColumn === sel.startColumn && r.endLineNumber === sel.endLineNumber && r.endColumn === sel.endColumn) {
        return i;
      }
    }
    return -1;
  }

  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
